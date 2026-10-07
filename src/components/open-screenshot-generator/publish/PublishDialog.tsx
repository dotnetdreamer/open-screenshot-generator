"use client";

// Send the finished artboards straight to App Store Connect or Google Play.
//
// The dialog is one screen rather than a wizard because every field except the
// credentials is a dropdown with a sensible default: pick the store, confirm
// where it lands, tick the boards, upload. Rendering happens at upload time
// through the callback the editor passes in, since only the layout can reach
// the live canvas DOM (and can convert the canvas to another App Store size
// first, exactly like the export dialog does).
//
// An artboard carrying a recording is an App Preview, and goes up as a VIDEO
// rather than as a still of its first frame. That takes a second capture
// callback, because a preview is encoded rather than photographed: minutes of
// work per board instead of milliseconds, its own accepted sizes, and Apple's
// 15 to 30 second rule. Google Play has no video upload at all (its listing
// takes a YouTube link, typed into the Play console), so preview boards are
// blocked there rather than flattened.
//
// Desktop only. api.appstoreconnect.apple.com sends no CORS headers, so a
// browser tab cannot call it at all; the Tauri build goes out through Rust.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClapperboardIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LanguagesIcon,
  Loader2Icon,
  MonitorDownIcon,
  RefreshCwIcon,
  UploadCloudIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { openExternal } from '@/lib/desktop';
import { DEVICE_FORMAT_PRESETS, detectArtboardsFormat, type DeviceFormat } from '@/lib/deviceRegistry';
import { localeLabel } from '@/lib/i18n/locales';
import { analyzeArtboardForVideo, projectHasVideoContent } from '@/lib/video/videoExport';
import { getBaseLocale, getProjectLocales } from '@/lib/i18n/localization';
import type { ArtboardState, Size } from '@/types/artboard';
import { uploadAppStoreScreenshotsForLocales } from '@/lib/publish/appStoreConnect';
import { uploadPlayScreenshotsForLanguages } from '@/lib/publish/googlePlay';
import {
  appleLocaleFor,
  defaultAppStoreUploadSize,
  localeForAppleLocale,
  localeForPlayLanguage,
  missesRequiredIphoneSlot,
  playLanguageFor,
} from '@/lib/publish/storeTargets';
import {
  MAX_PREVIEWS_PER_SET,
  MAX_SCREENSHOTS_PER_SET,
  PLAY_IMAGE_TARGETS,
  PREVIEW_MAX_SECONDS,
  PREVIEW_MIN_SECONDS,
  StoreAuthError,
  appleTargetForSize,
  isStorePublishingAvailable,
  listAppStoreApps,
  listAppStoreLocalizations,
  listAppStoreVersions,
  listPlayLanguages,
  nearestAppleSizes,
  previewRenderSizeFor,
  serviceAccountEmail,
  suggestPlayImageType,
  uploadAppStoreScreenshots,
  uploadPlayScreenshots,
  useStoreCredentials,
  validatePlayImage,
  type AppStoreApp,
  type AppStoreLocalization,
  type AppStoreVersion,
  type PlayListing,
  type PublishImage,
  type PublishProgress,
  type PublishResult,
  type PublishVideo,
  type StoreId,
} from '@/lib/publish';
import { AppStoreCredentialsForm, PlayCredentialsForm } from './StoreCredentialsForms';

const DESKTOP_DOWNLOAD_URL = 'https://openscrgen.app';

/** "Current canvas" plus the store's own sizes, reusing the export presets. */
const FORMAT_CHOICES: Record<StoreId, DeviceFormat[]> = {
  appstore: ['ios', 'ipad-pro-13', 'ipad-11'],
  playstore: ['android', 'tablet-7', 'tablet-10'],
};

const STORE_LABELS: Record<StoreId, string> = {
  appstore: 'App Store Connect',
  playstore: 'Google Play',
};

/** "9 screenshots and 2 App Previews", counting only what there is. */
function uploadedSummary(result: PublishResult): string {
  const videos = result.uploadedVideos ?? 0;
  const images = result.uploaded - videos;
  const parts: string[] = [];
  if (images > 0) parts.push(`${images} screenshot${images === 1 ? '' : 's'}`);
  if (videos > 0) parts.push(`${videos} App Preview${videos === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' and ') : 'Nothing';
}

/**
 * Both stores show the uploaded file name and nothing else, and the editor
 * names a board "01_Feature_One.png", so five languages arrive looking
 * identical and a converted size is indistinguishable from the original.
 * Tokens are appended, never substituted, and only when the name does not
 * already carry them.
 */
function describeImage(image: PublishImage, locale: string | null): PublishImage {
  const stem = image.fileName.replace(/\.png$/i, '');
  const size = `${image.width}x${image.height}`;
  const parts = [stem];
  if (locale && !stem.includes(locale)) parts.push(locale);
  if (!stem.includes(size)) parts.push(size);
  return { ...image, locale: locale ?? undefined, fileName: `${parts.join('_')}.png` };
}

/** The same for a preview, whose name has to survive next to its stills. */
function describeVideo(video: PublishVideo, locale: string | null): PublishVideo {
  const stem = video.fileName.replace(/\.mp4$/i, '');
  const size = `${video.width}x${video.height}`;
  const parts = [stem];
  if (locale && !stem.includes(locale)) parts.push(locale);
  if (!stem.includes(size)) parts.push(size);
  return { ...video, locale: locale ?? undefined, fileName: `${parts.join('_')}.mp4` };
}

export interface PublishDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The BASE document, every language. The project's locales are read off it. */
  artboards: ArtboardState[];
  /** The language the editor is showing, null for the base language. */
  activeLocale?: string | null;
  /**
   * Render the chosen artboards to PNG bytes. `formatId` null keeps the canvas
   * as it is; a preset converts it in memory first and restores afterwards.
   * `locale` null renders the base language, anything else renders that
   * language's projection, which is the whole point of uploading per language.
   */
  onCapture: (
    artboardIds: string[],
    formatId: DeviceFormat | null,
    locale?: string | null
  ) => Promise<PublishImage[]>;
  /**
   * Encode the chosen App Preview boards to MP4 bytes, in memory.
   *
   * Separate from onCapture because the work is different in kind: the boards
   * have to be mounted and played through frame by frame, at the sizes Apple
   * takes for video, which are not the screenshot sizes. Absent on a build
   * that cannot encode, in which case preview boards are blocked with a reason.
   */
  onCaptureVideos?: (
    artboardIds: string[],
    options: {
      locale?: string | null;
      /** The chosen size, applied to a preview exactly as it is to a screenshot. */
      formatId?: DeviceFormat | null;
      platform?: string | null;
      keepOverlays: boolean;
      onProgress?: (progress: {
        boardName: string;
        boardIndex: number;
        boardCount: number;
        frame: number;
        totalFrames: number;
      }) => void;
      /** Aborts the encode in flight. Encoding a board runs for minutes. */
      signal?: AbortSignal;
    }
  ) => Promise<{ videos: PublishVideo[]; warnings: string[] }>;
}

/** What the dialog needs to know about one App Preview board before uploading. */
interface PreviewInfo {
  /** What the encoder will actually produce, which Apple holds to 15 to 30 seconds. */
  durationSeconds: number;
  /** False when the board has motion but no recording, which is not uploadable. */
  hasVideo: boolean;
}

export function PublishDialog({
  isOpen,
  onOpenChange,
  artboards,
  activeLocale = null,
  onCapture,
  onCaptureVideos,
}: PublishDialogProps) {
  const { credentials, saveAppStore, savePlay } = useStoreCredentials();
  const [mounted, setMounted] = useState(false);
  const [store, setStore] = useState<StoreId>('appstore');
  const [editingCredentials, setEditingCredentials] = useState(false);

  // App Store destination
  const [apps, setApps] = useState<AppStoreApp[] | null>(null);
  const [appId, setAppId] = useState('');
  const [versions, setVersions] = useState<AppStoreVersion[] | null>(null);
  const [versionId, setVersionId] = useState('');
  const [localizations, setLocalizations] = useState<AppStoreLocalization[] | null>(null);
  const [localizationId, setLocalizationId] = useState('');

  // Play destination
  const [languages, setLanguages] = useState<PlayListing[] | null>(null);
  const [language, setLanguage] = useState('en-US');
  const [imageType, setImageType] = useState('phoneScreenshots');
  // Until the user picks a slot themselves, the slot follows the board size.
  const [imageTypePicked, setImageTypePicked] = useState(false);

  // Which project language gets rendered, and whether every one of them goes up
  // in a single run. Both are inert on a project with no languages.
  const [captureLocale, setCaptureLocale] = useState<string>(
    () => activeLocale ?? getBaseLocale(artboards)
  );
  const [uploadAllLanguages, setUploadAllLanguages] = useState(false);

  const [formatId, setFormatId] = useState<DeviceFormat | 'current'>('current');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Off by default: adding is recoverable, deleting someone's live screenshots
  // is not. The user opts into the destructive path deliberately.
  const [replaceExisting, setReplaceExisting] = useState(false);

  // What each App Preview board will encode to. Null until the analysis below
  // has run, which is async because recording lengths live in the media table.
  const [previewInfos, setPreviewInfos] = useState<Record<string, PreviewInfo> | null>(null);
  // On by default, matching the App Preview export dialog: guideline 2.3.4
  // allows text and gesture hints over the footage, and a preview stripped of
  // the words the board was designed around is rarely what the user meant.
  const [keepOverlays, setKeepOverlays] = useState(true);
  const [encoding, setEncoding] = useState<{ boardName: string; percent: number } | null>(null);
  // Encoding is the only stage long enough to be worth interrupting, so it is
  // the only one with a way out.
  const encodeAbortRef = useRef<AbortController | null>(null);

  const [loadingDestination, setLoadingDestination] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const storeCredentials = store === 'appstore' ? credentials.appstore : credentials.playstore;
  const hasCredentials = !!storeCredentials;

  // Fresh dialog, fresh outcome: a stale success panel from the previous run
  // would read as if this one had already finished.
  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setError(null);
    setProgress(null);
    setSelectedIds(artboards.map((artboard) => artboard.id));
    setCaptureLocale(activeLocale ?? getBaseLocale(artboards));
    setUploadAllLanguages(false);
    setEncoding(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Screenshot boards only: an App Preview board goes up as a video.
  const screenshotBoards = useMemo(
    () => artboards.filter((artboard) => !projectHasVideoContent([artboard])),
    [artboards]
  );
  const requiredIphoneMissing = useMemo(
    () => missesRequiredIphoneSlot(screenshotBoards.map((artboard) => artboard.size)),
    [screenshotBoards]
  );

  // The size starts where the store wants it. iPhone boards at a size App Store
  // Connect does not require go up at the required one, so the listing can be
  // submitted. Switching store starts that store over, which also keeps an App
  // Store size from staying picked on the Play side.
  useEffect(() => {
    if (!isOpen) return;
    setFormatId(
      store === 'appstore'
        ? defaultAppStoreUploadSize(
            screenshotBoards.map((artboard) => artboard.size),
            detectArtboardsFormat(screenshotBoards)
          )
        : 'current'
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, store]);

  /**
   * Work out how long each App Preview board runs, so the row can say whether
   * Apple will take it BEFORE the user spends minutes encoding one that gets
   * rejected for being 8 seconds long.
   */
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const infos: Record<string, PreviewInfo> = {};
      for (const artboard of artboards) {
        if (!projectHasVideoContent([artboard])) continue;
        try {
          const info = await analyzeArtboardForVideo(artboard);
          infos[artboard.id] = {
            durationSeconds: artboard.previewDurationSeconds ?? info.suggestedDuration,
            hasVideo: info.hasVideo,
          };
        } catch {
          // An unreadable recording should not take the dialog down; the row
          // falls back to "no recording yet", which is the safe answer.
          infos[artboard.id] = { durationSeconds: 0, hasVideo: false };
        }
      }
      if (!cancelled) setPreviewInfos(infos);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, artboards]);

  useEffect(() => {
    setEditingCredentials(false);
  }, [store]);

  const loadAppStoreDestination = useCallback(async () => {
    if (!credentials.appstore) return;
    setLoadingDestination(true);
    setError(null);
    try {
      const list = await listAppStoreApps(credentials.appstore);
      setApps(list);
      if (list.length && !list.some((app) => app.id === appId)) setAppId(list[0].id);
    } catch (loadError) {
      setApps(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not reach App Store Connect.');
      if (loadError instanceof StoreAuthError) setEditingCredentials(true);
    } finally {
      setLoadingDestination(false);
    }
  }, [credentials.appstore, appId]);

  const loadPlayDestination = useCallback(async () => {
    if (!credentials.playstore) return;
    setLoadingDestination(true);
    setError(null);
    try {
      const list = await listPlayLanguages(credentials.playstore);
      setLanguages(list);
      if (list.length && !list.some((listing) => listing.language === language)) {
        setLanguage(list[0].language);
      }
    } catch (loadError) {
      setLanguages(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not reach Google Play.');
      if (loadError instanceof StoreAuthError) setEditingCredentials(true);
    } finally {
      setLoadingDestination(false);
    }
  }, [credentials.playstore, language]);

  // Load the destination lists once the dialog is open with usable keys. Only
  // fires when there is nothing loaded yet, so reopening the dialog does not
  // re-hit the API on every render.
  useEffect(() => {
    if (!isOpen || !isStorePublishingAvailable() || editingCredentials) return;
    if (store === 'appstore' && credentials.appstore && apps === null) void loadAppStoreDestination();
    if (store === 'playstore' && credentials.playstore && languages === null) void loadPlayDestination();
  }, [
    isOpen,
    store,
    editingCredentials,
    credentials.appstore,
    credentials.playstore,
    apps,
    languages,
    loadAppStoreDestination,
    loadPlayDestination,
  ]);

  // Versions follow the app, localizations follow the version.
  useEffect(() => {
    if (!appId || !credentials.appstore) return;
    let cancelled = false;
    setVersions(null);
    setVersionId('');
    (async () => {
      try {
        const list = await listAppStoreVersions(credentials.appstore!, appId);
        if (cancelled) return;
        setVersions(list);
        // Only ever preselect a version Apple will actually accept screenshots
        // for. Falling back to list[0] would arm the Upload button against a
        // frozen version and turn a clear warning into a 409 mid-upload.
        const editable = list.find((version) => version.editable);
        if (editable) setVersionId(editable.id);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not list versions.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, credentials.appstore]);

  useEffect(() => {
    if (!versionId || !credentials.appstore) return;
    let cancelled = false;
    setLocalizations(null);
    setLocalizationId('');
    (async () => {
      try {
        const list = await listAppStoreLocalizations(credentials.appstore!, versionId);
        if (cancelled) return;
        setLocalizations(list);
        const preferred = list.find((entry) => entry.locale === 'en-US') ?? list[0];
        if (preferred) setLocalizationId(preferred.id);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Could not list languages.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [versionId, credentials.appstore]);

  /** The size each selected board will actually be uploaded at. */
  const targetSize = useCallback(
    (artboard: ArtboardState): Size => {
      if (formatId === 'current') return artboard.size;
      const preset = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === formatId);
      return preset ? preset.artboard : artboard.size;
    },
    [formatId]
  );

  const selected = useMemo(
    () => artboards.filter((artboard) => selectedIds.includes(artboard.id)),
    [artboards, selectedIds]
  );

  // --- Languages ------------------------------------------------------------

  const baseLocale = useMemo(() => getBaseLocale(artboards), [artboards]);
  const projectLocales = useMemo(
    () => [baseLocale, ...getProjectLocales(artboards).map((entry) => entry.code)],
    [artboards, baseLocale]
  );
  const isMultiLanguage = projectLocales.length > 1;

  /**
   * Every project language, paired with the listing it would go into.
   *
   * `destinationId` null is the case worth showing: the language exists in the
   * editor but not in the store. There is no create-localization call in this
   * app (and Apple's is a separate resource with its own required fields), so
   * the only fix is adding it in the store console first.
   */
  const localeRows = useMemo(() => {
    return projectLocales.map((code) => {
      const storeCode = store === 'appstore' ? appleLocaleFor(code) : playLanguageFor(code);
      const lower = storeCode?.toLowerCase();
      const destinationId =
        !lower
          ? null
          : store === 'appstore'
            ? localizations?.find((entry) => entry.locale.toLowerCase() === lower)?.id ?? null
            : languages?.find((entry) => entry.language.toLowerCase() === lower)?.language ?? null;
      return { code, label: localeLabel(code), storeCode, destinationId };
    });
  }, [projectLocales, store, localizations, languages]);

  const matchedLocales = localeRows.filter((row) => row.destinationId);
  /** The listing list has not arrived yet, so "not set up" would be a guess. */
  const destinationsLoaded = store === 'appstore' ? localizations !== null : languages !== null;

  /** The store code the single-language path is currently pointed at. */
  const pickedStoreCode =
    store === 'appstore'
      ? localizations?.find((entry) => entry.id === localizationId)?.locale ?? null
      : language || null;

  // Picking a store language re-targets which language gets RENDERED, and
  // re-defaults the board selection with it. Without this, picking German and
  // pressing Upload sends the English pixels into the German set, and Apple
  // only reveals that hours later when asset processing finishes.
  useEffect(() => {
    if (!isMultiLanguage || uploadAllLanguages || !pickedStoreCode) return;
    const mapped =
      store === 'appstore'
        ? localeForAppleLocale(pickedStoreCode)
        : localeForPlayLanguage(pickedStoreCode);
    if (!mapped || !projectLocales.includes(mapped)) return;
    setCaptureLocale(mapped);
    // Every board belongs to every language here: there is one layout and the
    // language is a projection over it. Re-selecting them all is what "the
    // boards for this language" means in this model, and it undoes any manual
    // unticking that was meant for the language the user just moved off.
    setSelectedIds(artboards.map((artboard) => artboard.id));
  }, [
    isMultiLanguage,
    uploadAllLanguages,
    pickedStoreCode,
    store,
    projectLocales,
    artboards,
  ]);

  /**
   * The store language the user picked has no counterpart in this project, so
   * whatever is uploaded will be in the wrong language. Not a hard block: a
   * single-language project pointed at a German listing is a legitimate thing
   * to do on purpose.
   */
  const localeMismatch =
    isMultiLanguage &&
    !uploadAllLanguages &&
    pickedStoreCode &&
    !projectLocales.includes(
      (store === 'appstore'
        ? localeForAppleLocale(pickedStoreCode)
        : localeForPlayLanguage(pickedStoreCode)) ?? ''
    )
      ? pickedStoreCode
      : null;

  // Suggest a Play slot from the first selected board, until the user picks one.
  useEffect(() => {
    if (store !== 'playstore' || imageTypePicked || selected.length === 0) return;
    const size = targetSize(selected[0]);
    setImageType(suggestPlayImageType(size.width, size.height));
  }, [store, selected, targetSize, imageTypePicked]);

  /**
   * The version the user picked, for its platform. Previews need it and
   * screenshots do not: 1920x1080 is a legal preview size for an iPhone in
   * landscape, for Mac and for Apple TV, and only the version says which.
   */
  const selectedVersion = useMemo(
    () => versions?.find((entry) => entry.id === versionId) ?? null,
    [versions, versionId]
  );
  const platform = selectedVersion?.platform ?? null;

  const rows = useMemo(
    () =>
      artboards.map((artboard) => {
        const size = targetSize(artboard);
        const info = previewInfos?.[artboard.id] ?? null;
        // projectHasVideoContent is the cheap sync test the PNG export uses,
        // and it says yes to a board that merely has an entrance animation. An
        // animated still is still a screenshot, so once the measurement has
        // come back, only a board with actual footage counts as a preview.
        // Before it comes back, assume preview: the row says "measuring" for a
        // moment rather than offering to upload a video board as a PNG.
        const isPreview = projectHasVideoContent([artboard]) && (info ? info.hasVideo : true);
        const render = isPreview ? previewRenderSizeFor(size.width, size.height, platform) : null;
        const seconds = Math.round(info?.durationSeconds ?? 0);

        const previewProblem = (): string | null => {
          if (store !== 'appstore') {
            return 'Google Play takes a YouTube link for a preview video, not an upload. Add it in the Play console';
          }
          if (!onCaptureVideos) return 'This build cannot encode an App Preview';
          if (!render) return 'The App Store takes no App Preview for this platform';
          if (!info) return null; // Still measuring; the row says so.
          if (seconds < PREVIEW_MIN_SECONDS || seconds > PREVIEW_MAX_SECONDS) {
            return `Runs ${seconds}s. Apple takes App Previews between ${PREVIEW_MIN_SECONDS} and ${PREVIEW_MAX_SECONDS} seconds`;
          }
          return null;
        };

        const appleTarget = appleTargetForSize(size.width, size.height);
        const imageProblem =
          store === 'appstore'
            ? appleTarget
              ? null
              : `Not an App Store size. Closest: ${nearestAppleSizes(size.width, size.height)}`
            : validatePlayImage(size.width, size.height, imageType);

        return {
          artboard,
          size,
          isPreview,
          /** What a preview encodes at, which is not the board size. */
          renderSize: render ? { width: render.width, height: render.height } : null,
          durationSeconds: info?.durationSeconds ?? 0,
          measured: !isPreview || !!info,
          slot: isPreview
            ? render
              ? `${render.target.label} App Preview`
              : null
            : store === 'appstore'
              ? appleTarget?.label ?? null
              : PLAY_IMAGE_TARGETS.find((entry) => entry.imageType === imageType)?.label ?? null,
          problem: isPreview ? previewProblem() : imageProblem,
        };
      }),
    [artboards, targetSize, store, imageType, previewInfos, platform, onCaptureVideos]
  );

  const blockedCount = rows.filter(
    (row) => selectedIds.includes(row.artboard.id) && row.problem
  ).length;
  /** Selected boards that will go up as video, which changes the copy below. */
  const previewRows = rows.filter(
    (row) => row.isPreview && selectedIds.includes(row.artboard.id) && !row.problem
  );
  const readyCount = selected.length - blockedCount;

  const destinationReady = (() => {
    const hasKey = store === 'appstore' ? !!credentials.appstore : !!credentials.playstore;
    if (!hasKey) return false;
    // Uploading every language needs at least one of them to exist in the
    // store, and nothing else: the per-language picker is not in play.
    if (uploadAllLanguages) return matchedLocales.length > 0;
    return store === 'appstore' ? !!localizationId : true;
  })();

  /** Images per language times languages, which is what the button counts. */
  const localeMultiplier = uploadAllLanguages ? matchedLocales.length : 1;

  // Apple freezes screenshots the moment a version is submitted, so "no
  // editable version" is usually "it is sitting in review". Saying that beats
  // a greyed-out dropdown the user cannot explain.
  const noEditableVersion = !!versions && versions.length > 0 && !versions.some((v) => v.editable);
  const reviewBlocked = noEditableVersion && versions!.some((v) => v.inReview);

  const playSlot = PLAY_IMAGE_TARGETS.find((entry) => entry.imageType === imageType);
  const playSlotLabel = playSlot?.label.toLowerCase() ?? 'this slot';
  const playSlotMax = playSlot?.max ?? 8;

  const toggle = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );

  const handleUpload = async () => {
    setError(null);
    setResult(null);
    encodeAbortRef.current = new AbortController();
    setIsUploading(true);
    setProgress({ stage: 'preparing', message: 'Rendering the artboards' });
    try {
      const uploadable = rows.filter(
        (row) => selectedIds.includes(row.artboard.id) && !row.problem
      );
      const boardIds = uploadable.filter((row) => !row.isPreview).map((row) => row.artboard.id);
      const previewIds = uploadable.filter((row) => row.isPreview).map((row) => row.artboard.id);
      const format = formatId === 'current' ? null : formatId;

      /** Capture one language and label every image with what it actually is. */
      const capture = async (locale: string | null): Promise<PublishImage[]> => {
        if (boardIds.length === 0) return [];
        const images: PublishImage[] = await onCapture(boardIds, format, locale);
        return images.map((image) => describeImage(image, image.locale ?? locale));
      };

      /**
       * The same for the App Preview boards, which are encoded rather than
       * photographed. Minutes per board, so this drives its own progress line
       * instead of sitting inside the "rendering" one.
       */
      const encodeWarnings: string[] = [];
      const captureVideos = async (locale: string | null): Promise<PublishVideo[]> => {
        if (previewIds.length === 0 || !onCaptureVideos) return [];
        try {
          const outcome = await onCaptureVideos(previewIds, {
            locale,
            formatId: format,
            platform,
            keepOverlays,
            signal: encodeAbortRef.current?.signal,
            onProgress: ({ boardName, frame, totalFrames }) =>
              setEncoding({
                boardName,
                percent: totalFrames > 0 ? Math.round((frame / totalFrames) * 100) : 0,
              }),
          });
          encodeWarnings.push(...outcome.warnings);
          return outcome.videos.map((video) => describeVideo(video, video.locale ?? locale));
        } finally {
          setEncoding(null);
        }
      };

      let outcome: PublishResult;

      if (uploadAllLanguages) {
        // Rendering is serial because there is one canvas: each language is
        // projected onto it, photographed, and the next one takes its place.
        const captured: Array<{
          row: (typeof matchedLocales)[number];
          images: PublishImage[];
          videos: PublishVideo[];
        }> = [];
        for (const [index, row] of matchedLocales.entries()) {
          setProgress({
            stage: 'preparing',
            message: `Rendering ${row.label}`,
            current: index + 1,
            total: matchedLocales.length,
          });
          const images = await capture(row.code);
          if (previewIds.length > 0) {
            setProgress({
              stage: 'rendering',
              message: `Encoding the App Previews for ${row.label}`,
              current: index + 1,
              total: matchedLocales.length,
            });
          }
          const videos = await captureVideos(row.code);
          if (images.length > 0 || videos.length > 0) captured.push({ row, images, videos });
        }
        if (captured.length === 0) {
          throw new Error('Nothing was rendered, so there is nothing to upload.');
        }

        outcome =
          store === 'appstore'
            ? await uploadAppStoreScreenshotsForLocales(
                credentials.appstore!,
                {
                  sets: captured.map((entry) => ({
                    localizationId: entry.row.destinationId!,
                    images: entry.images,
                    videos: entry.videos,
                    label: entry.row.label,
                  })),
                  replaceExisting,
                  platform,
                  appId,
                },
                setProgress
              )
            : await uploadPlayScreenshotsForLanguages(
                credentials.playstore!,
                {
                  entries: captured.map((entry) => ({
                    language: entry.row.destinationId!,
                    imageType,
                    images: entry.images,
                  })),
                  replaceExisting,
                },
                setProgress
              );
      } else {
        const captureLocaleOrBase = isMultiLanguage ? captureLocale : null;
        const images = await capture(captureLocaleOrBase);
        if (previewIds.length > 0) {
          setProgress({ stage: 'rendering', message: 'Encoding the App Previews' });
        }
        const videos = await captureVideos(captureLocaleOrBase);
        if (images.length === 0 && videos.length === 0) {
          throw new Error('Nothing was rendered, so there is nothing to upload.');
        }

        outcome =
          store === 'appstore'
            ? await uploadAppStoreScreenshots(
                credentials.appstore!,
                { localizationId, images, videos, replaceExisting, platform, appId },
                setProgress
              )
            : await uploadPlayScreenshots(
                credentials.playstore!,
                { language, imageType, images, replaceExisting },
                setProgress
              );
      }
      setResult(
        encodeWarnings.length > 0
          ? { ...outcome, warnings: [...encodeWarnings, ...outcome.warnings] }
          : outcome
      );
    } catch (uploadError) {
      // Stopping an encode is a choice, not a failure, so it leaves no error.
      const stopped = uploadError instanceof DOMException && uploadError.name === 'AbortError';
      if (!stopped) {
        setError(uploadError instanceof Error ? uploadError.message : 'The upload failed.');
        if (uploadError instanceof StoreAuthError) setEditingCredentials(true);
      }
    } finally {
      setIsUploading(false);
      setProgress(null);
      setEncoding(null);
    }
  };

  const available = mounted && isStorePublishingAvailable();

  // Why Upload is disabled, in the footer. A dead button with no explanation
  // sends people hunting, especially while the credential form is open and the
  // Save key button that unblocks it is below the fold in the scroll area.
  const blockedReason = (() => {
    if (!available) return '';
    if (!hasCredentials || editingCredentials) return 'Fill in the fields below, then Save key';
    if (!destinationReady) {
      if (uploadAllLanguages) {
        return `None of this project's languages exist in ${STORE_LABELS[store]} yet`;
      }
      return store === 'appstore'
        ? 'Pick an app, a version and a language above'
        : 'Pick a language above';
    }
    if (readyCount === 0) {
      return blockedCount > 0
        ? 'Nothing selected that this store accepts'
        : 'Tick at least one artboard';
    }
    // A blocked screenshot is always a size problem; a blocked preview can be a
    // length or a format one, so the reason is only named when it is the truth.
    const anyBlockedPreview = rows.some(
      (row) => row.isPreview && selectedIds.includes(row.artboard.id) && row.problem
    );
    const blocked = blockedCount
      ? `, ${blockedCount} cannot be uploaded${anyBlockedPreview ? '' : ' at this size'}`
      : '';
    const ready = `${readyCount} of ${artboards.length} ready${blocked}`;
    return uploadAllLanguages ? `${ready}, in ${matchedLocales.length} languages` : ready;
  })();
  const percent =
    progress?.total && progress.total > 0
      ? Math.round(((progress.current ?? 0) / progress.total) * 100)
      : undefined;

  // The dialog stays put mid-upload so a half-sent batch is not abandoned by a
  // stray Escape. The processing wait is the exception: by then every byte is
  // committed and we are only watching Apple's asset pipeline, which can take
  // a minute and a half, so walking away is allowed.
  const canLeaveWhileBusy = progress?.stage === 'processing' || progress?.stage === 'rendering';

  /**
   * Leaving the dialog. An encode is the one stage that is still doing work the
   * user can call off, so closing stops it rather than leaving it running
   * against a canvas nobody is watching.
   */
  const dismiss = () => {
    encodeAbortRef.current?.abort();
    onOpenChange(false);
  };
  const locked = isUploading && !canLeaveWhileBusy;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (locked) return;
        if (!next) dismiss();
        else onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloudIcon className="h-5 w-5" />
            Upload to the store
          </DialogTitle>
          <DialogDescription>
            Send these artboards straight to your app listing with your own developer
            credentials. Nothing passes through our servers, because there are none.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {/* Segmented control. The selected half uses the primary fill, not
              `secondary`, which in this theme is indistinguishable from
              `outline` and left the focus ring as the only visible cue. */}
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(STORE_LABELS) as StoreId[]).map((id) => (
              <Button
                key={id}
                variant={store === id ? 'default' : 'outline'}
                aria-pressed={store === id}
                className="h-10 justify-center"
                onClick={() => setStore(id)}
                disabled={isUploading}
              >
                {STORE_LABELS[id]}
              </Button>
            ))}
          </div>

          {!available ? (
            <div className="space-y-3 rounded-md border p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <MonitorDownIcon className="h-4 w-4" />
                Store uploads need the desktop app
              </p>
              <p className="text-sm text-muted-foreground">
                Apple and Google block browser tabs from calling their publishing APIs, so this
                has to run outside the browser. The desktop app is the same editor with a native
                shell around it, and your projects come with you.
              </p>
              <Button variant="outline" size="sm" onClick={() => void openExternal(DESKTOP_DOWNLOAD_URL)}>
                Get the desktop app
                <ExternalLinkIcon className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <>
              {/* Credentials */}
              {editingCredentials || !hasCredentials ? (
                store === 'appstore' ? (
                  <AppStoreCredentialsForm
                    value={credentials.appstore}
                    onSave={(next) => {
                      saveAppStore(next);
                      setApps(null);
                      setEditingCredentials(false);
                      setError(null);
                    }}
                    onCancel={hasCredentials ? () => setEditingCredentials(false) : undefined}
                  />
                ) : (
                  <PlayCredentialsForm
                    value={credentials.playstore}
                    onSave={(next) => {
                      savePlay(next);
                      setLanguages(null);
                      setEditingCredentials(false);
                      setError(null);
                    }}
                    onCancel={hasCredentials ? () => setEditingCredentials(false) : undefined}
                  />
                )
              ) : (
                <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <KeyRoundIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {store === 'appstore'
                        ? `Key ${credentials.appstore?.keyId}`
                        : credentials.playstore?.packageName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {store === 'appstore'
                        ? `Issuer ${credentials.appstore?.issuerId}`
                        : serviceAccountEmail(credentials.playstore!) ?? 'Service account key'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isUploading}
                    onClick={() => setEditingCredentials(true)}
                  >
                    Change
                  </Button>
                </div>
              )}

              {/* Destination */}
              {hasCredentials && !editingCredentials && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Where it goes</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={loadingDestination || isUploading}
                      onClick={() =>
                        store === 'appstore' ? void loadAppStoreDestination() : void loadPlayDestination()
                      }
                      title="Reload from the store"
                    >
                      {loadingDestination ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCwIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {store === 'appstore' ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <LabelledSelect
                        label="App"
                        value={appId}
                        onValueChange={setAppId}
                        disabled={isUploading || !apps?.length}
                        placeholder={apps ? 'Pick an app' : 'Loading'}
                        options={(apps ?? []).map((app) => ({ value: app.id, label: app.name }))}
                      />
                      <LabelledSelect
                        label="Version"
                        value={versionId}
                        onValueChange={setVersionId}
                        disabled={isUploading || !versions?.length}
                        placeholder={versions ? 'Pick a version' : 'Loading'}
                        options={(versions ?? []).map((version) => ({
                          value: version.id,
                          label: `${version.versionString || 'Version'} (${version.state
                            .toLowerCase()
                            .replace(/_/g, ' ')})`,
                          disabled: !version.editable,
                        }))}
                      />
                      <LabelledSelect
                        label="Language"
                        value={localizationId}
                        onValueChange={setLocalizationId}
                        disabled={isUploading || uploadAllLanguages || !localizations?.length}
                        placeholder={localizations ? 'Pick a language' : 'Loading'}
                        options={(localizations ?? []).map((entry) => ({
                          value: entry.id,
                          label: entry.locale,
                        }))}
                      />
                    </div>
                  ) : null}

                  {store === 'appstore' && noEditableVersion && (
                    <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                      <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {reviewBlocked
                          ? 'This version is waiting for review or in review, and Apple locks screenshots once a version is submitted. Remove it from review in App Store Connect to change them, or add a new version.'
                          : 'This app has no version whose screenshots can be edited. Add a new version in App Store Connect first.'}
                      </span>
                    </p>
                  )}

                  {store === 'playstore' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <LabelledSelect
                        label="Language"
                        value={language}
                        onValueChange={setLanguage}
                        disabled={isUploading || uploadAllLanguages || !languages?.length}
                        placeholder={languages ? 'Pick a language' : 'Loading'}
                        options={(languages ?? []).map((entry) => ({
                          value: entry.language,
                          label: entry.title ? `${entry.language} (${entry.title})` : entry.language,
                        }))}
                      />
                      <LabelledSelect
                        label="Listing slot"
                        value={imageType}
                        onValueChange={(value) => {
                          setImageTypePicked(true);
                          setImageType(value);
                        }}
                        disabled={isUploading}
                        options={PLAY_IMAGE_TARGETS.map((entry) => ({
                          value: entry.imageType,
                          label: entry.label,
                        }))}
                      />
                    </div>
                  ) : null}

                  {/* Languages. Absent entirely until the project has some, so
                      a single-language project sees the dialog it always saw. */}
                  {isMultiLanguage && (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="publish-all-languages"
                          checked={uploadAllLanguages}
                          disabled={isUploading}
                          onCheckedChange={(value) => setUploadAllLanguages(value === true)}
                        />
                        <div className="grid gap-1 leading-none">
                          <Label
                            htmlFor="publish-all-languages"
                            className="flex items-center gap-1.5"
                          >
                            <LanguagesIcon className="h-3.5 w-3.5" />
                            Upload every language
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            All {projectLocales.length} languages, rendered from this one layout
                            and sent to their own listings in a single run
                          </p>
                        </div>
                      </div>

                      {uploadAllLanguages ? (
                        <>
                          <ul className="space-y-1">
                            {localeRows.map((row) => {
                              const unmatched = destinationsLoaded && !row.destinationId;
                              return (
                                <li
                                  key={row.code}
                                  className={`flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-xs ${
                                    unmatched ? 'border-amber-500/40 bg-amber-500/10' : ''
                                  }`}
                                >
                                  <span className="truncate">{row.label}</span>
                                  <span className="shrink-0 text-muted-foreground">
                                    {row.destinationId
                                      ? row.storeCode
                                      : !destinationsLoaded
                                        ? 'Checking'
                                        : row.storeCode
                                          ? `Not set up in ${STORE_LABELS[store]}`
                                          : `${STORE_LABELS[store]} has no such language`}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                          {destinationsLoaded && matchedLocales.length < localeRows.length && (
                            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                              <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>
                                A language has to exist in {STORE_LABELS[store]} before anything
                                can be written to it, and this app cannot create one. Add it
                                there, then press the reload button above
                              </span>
                            </p>
                          )}
                        </>
                      ) : (
                        <LabelledSelect
                          label="Language to render"
                          value={captureLocale}
                          onValueChange={setCaptureLocale}
                          disabled={isUploading}
                          options={localeRows.map((row) => ({
                            value: row.code,
                            label: row.label,
                          }))}
                        />
                      )}

                      {localeMismatch && (
                        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                          <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            This project has no {localeMismatch} version, so{' '}
                            {localeLabel(captureLocale)} is what would be uploaded there. Add that
                            language in the editor first, or pick a different listing
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* What gets uploaded */}
              {hasCredentials && !editingCredentials && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">What gets uploaded</h3>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Size</Label>
                      <Select
                        value={formatId}
                        onValueChange={(value) => setFormatId(value as DeviceFormat | 'current')}
                        disabled={isUploading}
                      >
                        <SelectTrigger className="h-9 w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="current">Current canvas</SelectItem>
                          {FORMAT_CHOICES[store].map((id) => {
                            const preset = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === id)!;
                            return (
                              <SelectItem key={preset.id} value={preset.id}>
                                {preset.label} {preset.artboard.width}x{preset.artboard.height}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {formatId !== 'current' && (
                    <p className="text-xs text-muted-foreground">
                      The canvas is converted in memory before capture, then restored. Your project
                      is not modified.
                    </p>
                  )}
                  {store === 'appstore' && requiredIphoneMissing && (
                    <p className="text-xs text-muted-foreground">
                      App Store Connect needs one iPhone set at 1206×2622 before it will submit. Your
                      canvas size only fills an optional set.
                    </p>
                  )}

                  <ul className="space-y-1">
                    {rows.map((row) => {
                      const checked = selectedIds.includes(row.artboard.id);
                      return (
                        <li
                          key={row.artboard.id}
                          className="flex items-start gap-2 rounded-md border px-3 py-2"
                        >
                          <Checkbox
                            id={`publish-${row.artboard.id}`}
                            className="mt-0.5"
                            checked={checked}
                            disabled={isUploading}
                            onCheckedChange={() => toggle(row.artboard.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <Label
                              htmlFor={`publish-${row.artboard.id}`}
                              className="flex items-center gap-1.5 truncate font-normal"
                            >
                              {row.isPreview && (
                                <ClapperboardIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                              )}
                              <span className="truncate">{row.artboard.name}</span>
                            </Label>
                            {/* A preview does not go up at the board's size:
                                it is encoded at one of Apple's video sizes, so
                                that is the number worth showing. */}
                            <p className="truncate text-xs text-muted-foreground">
                              {(row.isPreview
                                ? [
                                    row.renderSize
                                      ? `${row.renderSize.width}x${row.renderSize.height}`
                                      : null,
                                    row.slot,
                                    row.measured && row.durationSeconds
                                      ? `${Math.round(row.durationSeconds)}s`
                                      : null,
                                  ]
                                : [`${row.size.width}x${row.size.height}`, row.slot]
                              )
                                .filter(Boolean)
                                .join(', ')}
                            </p>
                            {checked && row.problem && (
                              <p className="mt-0.5 flex items-start gap-1 text-xs text-destructive">
                                <AlertTriangleIcon className="mt-0.5 h-3 w-3 shrink-0" />
                                <span>{row.problem}</span>
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {previewRows.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="publish-keep-overlays"
                        checked={keepOverlays}
                        disabled={isUploading}
                        onCheckedChange={(value) => setKeepOverlays(value === true)}
                      />
                      <div className="grid gap-1 leading-none">
                        <Label htmlFor="publish-keep-overlays">
                          Keep your text over the App Preview
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {keepOverlays
                            ? 'Your recording fills the frame, with the artboard text and gesture hints animating over it. Apple allows overlays that explain what the video alone does not'
                            : 'Your recording goes up on its own, resized to the size Apple takes, with nothing over it'}
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                          {'The phone frame and the designed background are left out either way: an App Preview may only use a capture of the app itself'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Both outcomes are spelled out, not just the active one:
                      the question this checkbox raises is "what happens if I
                      turn it off", and answering that should not require
                      toggling it to find out. */}
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="publish-replace"
                      checked={replaceExisting}
                      disabled={isUploading}
                      onCheckedChange={(value) => setReplaceExisting(value === true)}
                    />
                    <div className="grid gap-1 leading-none">
                      <Label htmlFor="publish-replace">Replace what is already there</Label>
                      <p className={replaceExisting ? 'text-xs' : 'text-xs text-muted-foreground/60'}>
                        <span className="font-medium">On:</span>{' '}
                        {store === 'appstore'
                          ? 'the screenshots currently on this version are deleted first, for each size you are uploading, and yours take their place'
                          : `the images currently in ${playSlotLabel} are deleted first, and yours take their place`}
                      </p>
                      <p className={replaceExisting ? 'text-xs text-muted-foreground/60' : 'text-xs'}>
                        <span className="font-medium">Off:</span>{' '}
                        {store === 'appstore'
                          ? previewRows.length > 0
                            ? `yours are added alongside what is already there. The App Store holds ${MAX_SCREENSHOTS_PER_SET} screenshots and ${MAX_PREVIEWS_PER_SET} App Previews per size, and refuses the upload if either total would go over`
                            : `yours are added alongside the screenshots already there. The App Store holds ${MAX_SCREENSHOTS_PER_SET} per size and refuses the upload if the total would go over`
                          : `yours are added alongside the images already there. ${playSlotLabel} holds ${playSlotMax} image${playSlotMax === 1 ? '' : 's'} in total`}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2Icon className="h-4 w-4" />
                {uploadedSummary(result)} uploaded to {STORE_LABELS[store]}
              </p>
              {result.warnings.map((warning) => (
                <p key={warning} className="text-xs text-muted-foreground">
                  {warning}
                </p>
              ))}
              {result.reviewUrl && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => void openExternal(result.reviewUrl!)}
                >
                  Open {STORE_LABELS[store]}
                  <ExternalLinkIcon className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>

        {isUploading && progress && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs text-muted-foreground">
              {progress.message}
              {progress.total ? ` (${progress.current ?? 0} of ${progress.total})` : ''}
            </p>
            {/* Encoding is the one stage that runs for minutes, so it drives
                the bar itself rather than leaving it parked on the language
                count while nothing appears to happen. */}
            {encoding ? (
              <>
                <Progress value={encoding.percent} />
                <p className="text-xs text-muted-foreground">
                  {`${encoding.boardName}, ${encoding.percent}%`}
                </p>
              </>
            ) : (
              <Progress
                value={percent ?? undefined}
                className={percent === undefined ? 'opacity-60' : ''}
              />
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <p className="hidden text-xs text-muted-foreground sm:block">{blockedReason}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={locked} onClick={dismiss}>
              {progress?.stage === 'rendering'
                ? 'Stop encoding'
                : canLeaveWhileBusy
                  ? 'Stop waiting'
                  : result
                    ? 'Close'
                    : 'Cancel'}
            </Button>
            <Button
              onClick={handleUpload}
              disabled={
                !available ||
                isUploading ||
                editingCredentials ||
                !destinationReady ||
                readyCount === 0
              }
            >
              {isUploading ? (
                <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <UploadCloudIcon className="mr-1.5 h-4 w-4" />
              )}
              Upload {readyCount > 0 ? readyCount * localeMultiplier : ''}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabelledSelect({
  label,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={placeholder ?? 'Select'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
