/**
 * `window.__osg.publish`: the upload half of the headless bridge, for
 * `osg upload`.
 *
 * A facade over src/lib/publish like the rest of the bridge: it routes to the
 * functions the upload dialog calls and adds no store logic of its own. The
 * contract is the CLI's, written out at the top of cli/src/commands/upload.ts,
 * and the CLI lends the page node's socket for the length of the run, because
 * the store hosts send no CORS headers. bridgeFetch() reads window.fetch at
 * call time, so the store clients send through that socket unchanged.
 *
 *   apps, versions, localizations   App Store Connect lookups
 *   languages                       the Play listing's languages
 *   stage, clear                    images held here between calls
 *   upload                          every staged image, by language; with
 *                                   dryRun, the plan and nothing sent
 *
 * The credentials come with each call and are never stored: the dialog keeps
 * a key in localStorage for a person, a CLI run does not.
 */
import type {
  AppStoreCredentials,
  PlayCredentials,
  PublishImage,
  PublishResult,
} from '@/lib/publish/types';

/** One captured image, as the CLI stages it: base64 PNG bytes. */
export interface HeadlessStagedImage {
  artboardId: string;
  fileName: string;
  base64: string;
  width: number;
  height: number;
  /** Null on a single-language project. Matched exactly against the sets. */
  locale: string | null;
}

export interface HeadlessPublishRequest {
  store: 'appstore' | 'play';
  action: 'apps' | 'versions' | 'localizations' | 'languages' | 'stage' | 'clear' | 'upload';
  credentials: AppStoreCredentials | PlayCredentials | null;
  appId?: string;
  versionId?: string;
  images?: HeadlessStagedImage[];
  /** App Store: one per language, the version localization it goes to. */
  sets?: Array<{ locale: string | null; localizationId: string; label: string }>;
  /** Play: one per language. No imageType means each image's suggested slot. */
  entries?: Array<{ locale: string | null; language: string; imageType?: string }>;
  replaceExisting?: boolean;
  dryRun?: boolean;
}

export interface HeadlessPublishResponse {
  ok: boolean;
  error?: string;
  /** auth is a key the store refused, rejected a store rule. The CLI exits differently. */
  kind?: 'auth' | 'rejected' | 'other';
  data?: unknown;
}

/** One row of a dry run: a language, the slot or set it goes in, and its files. */
export interface HeadlessPlanRow {
  label: string;
  target: string;
  count: number;
  files: string[];
}

type PublishModule = typeof import('@/lib/publish');

function failure(error: unknown): HeadlessPublishResponse {
  const name = error instanceof Error ? error.name : '';
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    kind: name === 'StoreAuthError' ? 'auth' : name === 'StoreRejectedError' ? 'rejected' : 'other',
  };
}

/** The images staged for one language. A null locale is a single-language project. */
function imagesFor(staged: PublishImage[], locale: string | null): PublishImage[] {
  return staged.filter((image) => (image.locale ?? null) === locale);
}

/** What the store said happened, minus what the CLI does not print. */
function outcome(result: PublishResult) {
  return { uploaded: result.uploaded, warnings: result.warnings, reviewUrl: result.reviewUrl };
}

async function uploadToAppStore(lib: PublishModule, request: HeadlessPublishRequest, staged: PublishImage[]) {
  const credentials = request.credentials as AppStoreCredentials;
  const options = {
    sets: (request.sets ?? []).map((set) => ({
      localizationId: set.localizationId,
      label: set.label,
      images: imagesFor(staged, set.locale),
    })),
    replaceExisting: request.replaceExisting === true,
    appId: request.appId,
  };
  if (!request.dryRun) return outcome(await lib.uploadAppStoreScreenshotsForLocales(credentials, options, progress));

  const warnings: string[] = [];
  const plan: HeadlessPlanRow[] = [];
  for (const entry of lib.planAppStoreUpload(options, warnings)) {
    for (const [displayType, images] of entry.groups) {
      const target = lib.APPLE_DISPLAY_TARGETS.find((item) => item.displayType === displayType)?.label ?? displayType;
      // Apple turns down a set past its cap whatever it already holds, so a
      // dry run says so now rather than an upload saying it later.
      if (images.length > lib.MAX_SCREENSHOTS_PER_SET) {
        throw new lib.StoreRejectedError(
          `The App Store keeps at most ${lib.MAX_SCREENSHOTS_PER_SET} screenshots per size, and ${entry.set.label ?? 'this language'} has ${images.length} for ${target}. Upload fewer.`
        );
      }
      plan.push({ label: entry.set.label ?? 'Images', target, count: images.length, files: images.map((image) => image.fileName) });
    }
  }
  return { plan, warnings };
}

async function uploadToPlay(lib: PublishModule, request: HeadlessPublishRequest, staged: PublishImage[]) {
  const credentials = request.credentials as PlayCredentials;
  const entries = (request.entries ?? []).flatMap((entry) => {
    const images = imagesFor(staged, entry.locale);
    if (entry.imageType) return [{ language: entry.language, imageType: entry.imageType, images }];
    // Each image in the slot the upload dialog starts it in.
    const bySlot = new Map<string, PublishImage[]>();
    for (const image of images) {
      const imageType = lib.suggestPlayImageType(image.width, image.height);
      bySlot.set(imageType, [...(bySlot.get(imageType) ?? []), image]);
    }
    return [...bySlot].map(([imageType, list]) => ({ language: entry.language, imageType, images: list }));
  });
  const options = { entries, replaceExisting: request.replaceExisting === true };
  if (!request.dryRun) return outcome(await lib.uploadPlayScreenshotsForLanguages(credentials, options, progress));

  const warnings: string[] = [];
  const plan = lib.planPlayUpload(options, warnings).map((entry) => ({
    label: entry.language,
    target: entry.slotLabel,
    count: entry.usable.length,
    files: entry.usable.map((image) => image.fileName),
  }));
  return { plan, warnings };
}

/** Progress lines in the page console, which `osg upload --verbose` shows. */
function progress(update: { message: string; current?: number; total?: number }): void {
  const count = update.current && update.total ? ` (${update.current} of ${update.total})` : '';
  console.info(`publish: ${update.message}${count}`);
}

/**
 * The publish entry point. Images staged by one call wait here for the upload
 * call that takes them, and `clear` drops them.
 */
export function createHeadlessPublisher(): (request: HeadlessPublishRequest) => Promise<HeadlessPublishResponse> {
  let staged: PublishImage[] = [];

  return async (request) => {
    try {
      const lib = await import('@/lib/publish');
      switch (request.action) {
        case 'stage':
          for (const image of request.images ?? []) {
            staged.push({
              artboardId: image.artboardId,
              fileName: image.fileName,
              bytes: lib.decodeDataUrl(image.base64),
              width: image.width,
              height: image.height,
              ...(image.locale ? { locale: image.locale } : {}),
            });
          }
          return { ok: true, data: null };
        case 'clear':
          staged = [];
          return { ok: true, data: null };
        default:
          break;
      }

      if (!request.credentials) return failure(new Error(`publish ${request.action} needs the store key`));
      if (request.store === 'appstore') {
        const credentials = request.credentials as AppStoreCredentials;
        switch (request.action) {
          case 'apps':
            return { ok: true, data: await lib.listAppStoreApps(credentials) };
          case 'versions':
            return { ok: true, data: await lib.listAppStoreVersions(credentials, request.appId ?? '') };
          case 'localizations': {
            const rows = await lib.listAppStoreLocalizations(credentials, request.versionId ?? '');
            return { ok: true, data: rows.map((row) => ({ ...row, code: lib.localeForAppleLocale(row.locale) })) };
          }
          case 'upload':
            return { ok: true, data: await uploadToAppStore(lib, request, staged) };
          default:
            return failure(new Error(`The App Store has no publish action "${request.action}"`));
        }
      }
      if (request.store === 'play') {
        switch (request.action) {
          case 'languages': {
            const rows = await lib.listPlayLanguages(request.credentials as PlayCredentials);
            return { ok: true, data: rows.map((row) => ({ ...row, code: lib.localeForPlayLanguage(row.language) })) };
          }
          case 'upload':
            return { ok: true, data: await uploadToPlay(lib, request, staged) };
          default:
            return failure(new Error(`Google Play has no publish action "${request.action}"`));
        }
      }
      return failure(new Error(`Unknown store "${String(request.store)}"`));
    } catch (error) {
      return failure(error);
    }
  };
}
