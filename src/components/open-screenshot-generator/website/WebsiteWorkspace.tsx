"use client";

// Website: a free website for the user's app, made from the project open in
// the editor and published to the developer's own GitHub Pages. It is one of
// the views on the activity bar (ActivityBar.tsx), under Discover.
//
// Apple and Google both ask every app for a support address and a privacy
// policy address. The site is those two pages and a home page, in every
// language the site has. Its screenshots, colours, heading face and languages
// come from the project; the words come from the screenshots' own captions,
// from a few questions, and from the AI Growth writes with, which the
// developer can also ask for changes (src/lib/website).
//
// The view stays mounted once opened, like Growth, so a publish carries on
// while the editor is in front, and work under way lives here rather than in
// a section's screen, so moving between sections never stops it. Work started
// for one project lands in that project's site, even when another project is
// open by the time it ends.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindowIcon,
  BotIcon,
  ExternalLinkIcon,
  GlobeIcon,
  HomeIcon,
  LanguagesIcon,
  LifeBuoyIcon,
  Loader2Icon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  RocketIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SunIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { subscribe as onAccountChange } from '@/lib/account/store';
import { AccountCancelledError } from '@/lib/account/types';
import { track } from '@/lib/analytics';
import { isTauri, openExternal, saveBlobToDisk } from '@/lib/desktop';
import { readMeta } from '@/lib/growth/db';
import { appsListKey } from '@/lib/growth/monitor';
import { availableEngines, detectTranslateEngines, engineLabel, onTranslateEnginesChange } from '@/lib/i18n/engines';
import { getBaseLocale, getProjectLocales } from '@/lib/i18n/localization';
import { getLocaleDef } from '@/lib/i18n/locales';
import { projectArtboards } from '@/lib/i18n/project';
import { useStoreCredentials } from '@/lib/publish';
import { askSite, writeSite } from '@/lib/website/ai';
import { appStoreIdOf, fetchHeadingFace, iconFromFile, iconFromUrl, importedHeadingFace, isGoogleFamily, lookupStoreFacts, pictureColors, webJpeg } from '@/lib/website/assets';
import { applyChanges, boardsFingerprint, captionOf, factsFromProject, newDraft, newId, siteBoards, type Caption, type ChangeContext } from '@/lib/website/content';
import {
  githubIdentities,
  isServing,
  mayPublish,
  onWebsiteGithubChange,
  publishSite,
  repoNameProblem,
  signInForWebsite,
  signOutWebsiteGithub,
  siteAddress,
  suggestedRepoName,
  waitUntilLive,
  GithubPublishError,
} from '@/lib/website/github';
import { defaultPrivacy, privacyProblems } from '@/lib/website/privacy';
import { faceCss, pageDir, pageUrl, renderSiteFiles } from '@/lib/website/render';
import { changeSite, useSiteDraft, type SiteChatItem } from '@/lib/website/store';
import { missingCounts, prunedTranslations, siteFingerprint, siteTexts, translator, type TranslationBook } from '@/lib/website/strings';
import { boardColours, suggestColours, suggestHeading, type Weighted } from '@/lib/website/theme';
import { projectTranslations, translateSite } from '@/lib/website/translate';
import type { PublishRecord, SiteDraft, SitePage, SiteShot, SiteTheme } from '@/lib/website/types';
import { zipFiles } from '@/lib/website/zip';
import type { AscApp } from '@/lib/growth/asc';
import type { ArtboardState } from '@/types/artboard';
import { isCustomFontFamily, useCustomFonts } from '@/services/customFonts';
import { cn } from '@/lib/utils';
import { AppSection, HomeSection, LanguagesSection, LookSection, PrivacySection, SupportSection, type GrowthAppChoice, type Update } from './WebsiteForms';
import { WebsiteChat } from './WebsiteChat';
import { WebsitePreview, type PreviewDevice, type PreviewScheme } from './WebsitePreview';
import { WebsitePublish, type IdentityState, type PublishJob } from './WebsitePublish';
import { WebsiteSetupDialog, WebsiteWelcome, type SetupResult } from './WebsiteSetup';
import { useAiStatus } from './WebsiteShared';

/** One artboard as the editor captured it, at most `maxWidth` wide. */
export interface CapturedBoard {
  boardId: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface CaptureRequest {
  /** The project the capture is for; the editor refuses it when another one is open. */
  projectId: string;
  /** The language to show the artboards in, null for the base language. */
  locale: string | null;
  boardIds: string[];
  maxWidth: number;
}

export interface WebsiteProject {
  id: string | null;
  name: string;
  /** The base document, as the editor holds it. */
  artboards: ArtboardState[];
}

export interface WebsiteWorkspaceProps {
  /** True while Website is the view on screen. */
  active: boolean;
  project: WebsiteProject;
  captureBoards: (request: CaptureRequest) => Promise<CapturedBoard[]>;
  onBackToEditor: () => void;
}

type Section = 'ask' | 'app' | 'look' | 'home' | 'support' | 'privacy' | 'languages' | 'publish';

const NAV: Array<{ id: Section; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'ask', label: 'Ask AI', icon: BotIcon },
  { id: 'app', label: 'Your app', icon: AppWindowIcon },
  { id: 'look', label: 'Look', icon: PaletteIcon },
  { id: 'home', label: 'Home page', icon: HomeIcon },
  { id: 'support', label: 'Support page', icon: LifeBuoyIcon },
  { id: 'privacy', label: 'Privacy policy', icon: ShieldCheckIcon },
  { id: 'languages', label: 'Languages', icon: LanguagesIcon },
  { id: 'publish', label: 'Publish', icon: RocketIcon },
];

const PAGES: Array<{ id: SitePage; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'support', label: 'Support' },
  { id: 'privacy', label: 'Privacy policy' },
];

const SHOT_WIDTH = 760;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isStop(error: unknown): boolean {
  return (error as Error)?.name === 'AbortError';
}

/** Screenshots are taken from the canvas, so they stop when another project is opened while they are taken. */
class ProjectChangedError extends Error {
  constructor() {
    super('Another project was opened while the screenshots were being taken');
    this.name = 'ProjectChangedError';
  }
}

/** Fonts the site can carry: the app's Google ones, and the developer's own (which go on only when they say so). */
function fontAllowed(family: string): boolean {
  return isGoogleFamily(family) || isCustomFontFamily(family);
}

function mergeBooks(into: TranslationBook, from: TranslationBook): TranslationBook {
  const out: TranslationBook = { ...into };
  for (const [locale, entries] of Object.entries(from)) out[locale] = { ...(into[locale] ?? {}), ...entries };
  return out;
}

/**
 * A capture that has not come back in this long is not coming back: a font
 * file that never answers keeps html-to-image waiting for good. The queue of
 * captures moves on without it.
 */
const CAPTURE_TIMEOUT_MS = 120_000;

function stopped(): DOMException {
  return new DOMException('Stopped', 'AbortError');
}

/** `work`, unless `signal` stops first. Work that cannot be stopped carries on unseen. */
function unlessStopped<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(stopped());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(stopped());
    signal.addEventListener('abort', stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      }
    );
  });
}

/** `work`, or an error once `ms` have gone by. */
function withinTime<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** One language's screenshots, and the boardsFingerprint of the artboards they show: null when the artboards changed while they were taken. */
interface TakenShots {
  list: SiteShot[];
  print: string | null;
}

function captionText(caption: Caption | undefined): string {
  return caption ? [caption.title, caption.body].filter(Boolean).join('. ') : '';
}

export function WebsiteWorkspace({ active, project, captureBoards, onBackToEditor }: WebsiteWorkspaceProps) {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const desktop = mounted && isTauri();
  const site = useSiteDraft(project.id);
  const draft = site.draft;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const projectIdRef = useRef(project.id);
  projectIdRef.current = project.id;
  const ai = useAiStatus(active);

  useEffect(() => {
    if (active) track('website_open', { site: !!draft });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // --- the project --------------------------------------------------------------------
  // Every edit in the editor reaches this view as a new project. While another
  // view is in front, the one last shown stands in, so nothing here is worked
  // out again until the view shows; work under way reads the project as it is
  // now (latestProject below).
  const shown = useRef(project);
  if (active || shown.current.id !== project.id) shown.current = project;
  const artboards = shown.current.artboards;
  const baseLocale = useMemo(() => getBaseLocale(artboards), [artboards]);
  const projectLocales = useMemo(() => getProjectLocales(artboards).map((entry) => entry.code), [artboards]);
  const boards = useMemo(() => siteBoards(artboards), [artboards]);
  const captions = useMemo(() => boards.map(captionOf), [boards]);
  const hasShots = boards.length > 0;

  // --- screenshots, per language --------------------------------------------------------
  // Taken from the canvas one language at a time, never two at once: a capture
  // switches the canvas to its language and back.
  // By language, with the project and the document they were taken from: a
  // list from an older document of the same project shows until the new one
  // is taken, and one from another project never shows.
  const [shots, setShots] = useState<Record<string, { projectId: string; doc: ArtboardState[]; list: SiteShot[]; print: string }>>({});
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const [capturing, setCapturing] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latestProject = useRef(project);
  latestProject.current = project;
  // Every project the view is given counts one more, in render order. The
  // canvas only ever shows a project this view has been given, so a capture
  // that ends under another count saw another project's artboards at some
  // point, even when its own project is back by then (A, then B, then A
  // again: two blank projects share their artboard ids).
  const projectCount = useRef(0);
  const countedProject = useRef(project.id);
  if (countedProject.current !== project.id) {
    countedProject.current = project.id;
    projectCount.current += 1;
  }

  const takeShots = useCallback(
    (locale: string, forProject?: string): Promise<TakenShots> => {
      const run = async (): Promise<TakenShots> => {
        const now = latestProject.current;
        // Work for one project never takes another one's screenshots.
        if (forProject && now.id !== forProject) throw new ProjectChangedError();
        const count = projectCount.current;
        const doc = now.artboards;
        const base = getBaseLocale(doc);
        const own = getProjectLocales(doc).map((entry) => entry.code);
        const target = locale !== base && own.includes(locale) ? locale : null;
        const key = target ?? base;
        const cached = shotsRef.current[key];
        if (cached && cached.doc === doc && cached.projectId === now.id) return { list: cached.list, print: cached.print };
        const print = boardsFingerprint(doc);
        const list = siteBoards(doc);
        if (!now.id || list.length === 0) return { list: [], print };
        setCapturing(key);
        try {
          const captured = await withinTime(
            captureBoards({ projectId: now.id, locale: target, boardIds: list.map((board) => board.id), maxWidth: SHOT_WIDTH }),
            CAPTURE_TIMEOUT_MS,
            'Taking the screenshots took too long. Try again'
          );
          if (projectCount.current !== count || latestProject.current.id !== now.id) throw new ProjectChangedError();
          // An edit that landed while the boards were drawn: the pictures may
          // show the artboards before it or after it, so they are kept for
          // nothing and say they are of no one version.
          const steady = boardsFingerprint(latestProject.current.artboards) === print;
          const localized = (target ? siteBoards(projectArtboards(doc, target)) : list).map(captionOf);
          const made: SiteShot[] = [];
          for (const [index, board] of captured.entries()) {
            const image = await webJpeg(board.dataUrl, SHOT_WIDTH);
            made.push({
              boardId: board.boardId,
              caption: captionText(localized[index]),
              width: image.width,
              height: image.height,
              bytes: image.bytes,
              hash: image.hash,
              url: URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: 'image/jpeg' })),
            });
          }
          if (!steady) {
            window.setTimeout(() => made.forEach((shot) => URL.revokeObjectURL(shot.url)), 10_000);
            return { list: made, print: null };
          }
          setShots((current) => {
            const old = current[key]?.list ?? [];
            // The preview may still be drawing the old ones for a moment.
            window.setTimeout(() => old.forEach((shot) => URL.revokeObjectURL(shot.url)), 10_000);
            return { ...current, [key]: { projectId: now.id!, doc, list: made, print } };
          });
          shotsRef.current = { ...shotsRef.current, [key]: { projectId: now.id!, doc, list: made, print } };
          return { list: made, print };
        } finally {
          setCapturing(null);
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next.catch(() => undefined);
      return next;
    },
    [captureBoards]
  );

  // The base language's screenshots, whenever the view shows and the project changed.
  useEffect(() => {
    if (!active || !project.id || !hasShots) return;
    if (shotsRef.current[baseLocale]?.doc === artboards) return;
    const timer = window.setTimeout(() => {
      void takeShots(baseLocale).catch((error) => console.error('The screenshots for the website could not be taken', error));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [active, project.id, hasShots, artboards, baseLocale, takeShots]);

  // --- colours and the heading face the project gives -----------------------------------
  const colours = useMemo(() => boardColours(artboards), [artboards]);
  const [sampled, setSampled] = useState<Weighted[]>([]);
  const baseShots = shots[baseLocale]?.projectId === project.id ? shots[baseLocale].list : undefined;
  useEffect(() => {
    setSampled([]);
    if (!baseShots || colours.pictured.length === 0) return;
    let cancelled = false;
    const pictured = baseShots.filter((shot) => colours.pictured.includes(shot.boardId));
    void Promise.all(pictured.map((shot) => pictureColors(shot.url, 0.3).catch(() => [] as Weighted[]))).then((lists) => {
      if (!cancelled) setSampled(lists.flat().map((entry) => ({ ...entry, weight: entry.weight * 1000 })));
    });
    return () => {
      cancelled = true;
    };
  }, [baseShots, colours]);
  const [iconColours, setIconColours] = useState<Weighted[]>([]);
  const icon = draft?.facts.icon ?? '';
  useEffect(() => {
    setIconColours([]);
    if (!icon) return;
    let cancelled = false;
    void pictureColors(icon)
      .then((list) => {
        if (!cancelled) setIconColours(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [icon]);
  const suggested = useMemo(
    () => ({ ...suggestColours({ boards: colours, sampled, icon: iconColours }), ...suggestHeading(artboards) }),
    [colours, sampled, iconColours, artboards]
  );

  const update: Update = site.update;

  // A site that follows its screenshots or icon takes their colours when they change.
  useEffect(() => {
    const current = draftRef.current;
    if (!current || current.theme.source === 'custom') return;
    if (current.theme.brand === suggested.brand && current.theme.brand2 === suggested.brand2 && current.theme.accent === suggested.accent && current.theme.source === suggested.source) return;
    if (current.theme.source === 'screenshots' && suggested.source !== 'screenshots') return;
    update((now) => (now.theme.source === 'custom' ? now : { ...now, theme: { ...now.theme, source: suggested.source, brand: suggested.brand, brand2: suggested.brand2, accent: suggested.accent } }));
  }, [suggested, update]);

  // --- translations ------------------------------------------------------------------------
  const languages = draft?.languages;
  const known = useMemo(() => (languages ? projectTranslations(artboards, languages) : {}), [artboards, languages]);
  const missing = useMemo(() => (draft ? missingCounts(draft, known) : {}), [draft, known]);
  const outstanding = Object.values(missing).reduce((sum, count) => sum + count, 0);
  const [engines, setEngines] = useState<string[]>([]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => setEngines(availableEngines());
    refresh();
    detectTranslateEngines();
    return onTranslateEnginesChange(refresh);
  }, [active]);
  const translateReason = !mounted ? 'Loading' : engines.length === 0 ? 'Set up an AI to translate the site: sign in to Claude Code or Codex, or add one in the AI panel' : null;
  const [translating, setTranslating] = useState<{ done: number; total: number; engine: string } | null>(null);
  const translateStop = useRef<AbortController | null>(null);

  /** Change the site of `projectId`, whether or not it is the one on screen now (store.ts). */
  const updateSiteOf = useCallback((projectId: string, change: (draft: SiteDraft) => SiteDraft) => changeSite(projectId, (row) => ({ ...row, draft: change(row.draft) })), []);

  const runTranslate = useCallback(async () => {
    const current = draftRef.current;
    if (!current || current.projectId !== projectIdRef.current || translateStop.current) return;
    const projectId = current.projectId;
    const stop = new AbortController();
    translateStop.current = stop;
    setTranslating({ done: 0, total: 0, engine: '' });
    try {
      const result = await translateSite(current, {
        known,
        signal: stop.signal,
        onProgress: (done, total, engine) => setTranslating({ done, total, engine: engineLabel(engine) }),
      });
      await updateSiteOf(projectId, (now) => {
        const merged = { ...now, translations: mergeBooks(now.translations, result.translations) };
        return { ...merged, translations: prunedTranslations(merged) };
      });
      if (result.incomplete.length > 0 && !stop.signal.aborted) {
        toast({
          title: 'Some lines are not translated yet',
          description: result.error ?? `${result.incomplete.map((code) => getLocaleDef(code)?.nativeName ?? code).join(', ')}: try again in a moment.`,
        });
      }
    } catch (error) {
      if (!isStop(error)) toast({ title: 'The site could not be translated', description: messageOf(error, 'Try again in a moment.'), variant: 'destructive' });
    } finally {
      translateStop.current = null;
      setTranslating(null);
    }
  }, [known, toast, updateSiteOf]);

  // --- Growth's apps, to fill the facts in from ----------------------------------------------
  const { credentials } = useStoreCredentials();
  const [ascApps, setAscApps] = useState<AscApp[]>([]);
  const appleKey = credentials.appstore;
  useEffect(() => {
    if (!desktop || !appleKey) {
      setAscApps([]);
      return;
    }
    let cancelled = false;
    void readMeta<AscApp[]>(appsListKey(appleKey)).then((list) => {
      if (!cancelled) setAscApps(list ?? []);
    });
    return () => {
      cancelled = true;
    };
    // The key object is rebuilt on every store change; its ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, appleKey?.issuerId, appleKey?.keyId]);
  const growthApps = useMemo<GrowthAppChoice[]>(() => {
    const name = project.name.trim().toLowerCase();
    const list: GrowthAppChoice[] = ascApps.map((app) => ({ id: app.id, name: app.name, store: 'appstore' }));
    const playPackage = desktop ? credentials.playstore?.packageName.trim() : '';
    if (playPackage) list.push({ id: `play:${playPackage}`, name: playPackage, store: 'playstore' });
    // The app the project seems to be about first.
    return list.sort((a, b) => Number(b.name.toLowerCase().includes(name) && !!name) - Number(a.name.toLowerCase().includes(name) && !!name));
  }, [ascApps, credentials.playstore, desktop, project.name]);

  const [lookingUp, setLookingUp] = useState(false);
  const lookUp = useCallback(
    async (appStoreUrl: string) => {
      const id = appStoreIdOf(appStoreUrl);
      if (!id) return null;
      setLookingUp(true);
      try {
        const found = await lookupStoreFacts(id);
        if (!found) {
          toast({ title: "The App Store doesn't have that app", description: 'Check the link. A new app shows up there once Apple has released it.' });
          return null;
        }
        let iconData = '';
        if (found.iconUrl) iconData = await iconFromUrl(found.iconUrl).catch(() => '');
        return { appName: found.name, developer: found.developer, icon: iconData, appStoreUrl: found.storeUrl };
      } catch (error) {
        console.error('The App Store lookup failed', error);
        toast({ title: "The App Store didn't answer", description: 'Check your internet connection and try again.' });
        return null;
      } finally {
        setLookingUp(false);
      }
    },
    [toast]
  );

  // --- making a site ---------------------------------------------------------------------------
  const [setupOpen, setSetupOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const writeStop = useRef<AbortController | null>(null);
  const [section, setSection] = useState<Section>('ask');

  const startTheme = useMemo<SiteTheme>(
    () => ({ source: suggested.source, brand: suggested.brand, brand2: suggested.brand2, accent: suggested.accent, headingFont: suggested.headingFont, headingWeight: suggested.headingWeight }),
    [suggested]
  );
  const startLanguages = useMemo(() => [baseLocale, ...projectLocales], [baseLocale, projectLocales]);
  const previewDraft = useMemo(
    () =>
      !draft && project.id
        ? newDraft({ projectId: project.id, facts: factsFromProject(project.name), theme: startTheme, captions, baseLocale, languages: startLanguages, now: 0 })
        : null,
    [draft, project.id, project.name, startTheme, captions, baseLocale, startLanguages]
  );

  const addChat = useCallback((item: Omit<SiteChatItem, 'id' | 'at'>) => site.setChat((chat) => [...chat, { ...item, id: newId('m'), at: Date.now() }]), [site]);

  /** A chat line for a project's site, on screen or not. */
  const addChatTo = useCallback(
    (projectId: string, item: Omit<SiteChatItem, 'id' | 'at'>) =>
      changeSite(projectId, (row) => ({ ...row, chat: [...row.chat, { ...item, id: newId('m'), at: Date.now() }] })).catch((error) =>
        console.error('The answer could not be saved with its site', error)
      ),
    []
  );

  const runWrite = useCallback(
    async (start: SiteDraft, notes = '') => {
      const projectId = start.projectId;
      const stop = new AbortController();
      writeStop.current = stop;
      setWriting(true);
      const text = `I wrote the home and support pages from your screenshots${notes.trim() ? ' and your notes' : ''}. Tell me what to change.`;
      try {
        const written = await writeSite({ draft: start, captions, notes, signal: stop.signal });
        const label = ai.label ?? undefined;
        // Into the site as it is when the answer lands, which can be another
        // project's than the one on screen by then (store.ts).
        await changeSite(projectId, ({ draft: now, chat }) => {
          const report = applyChanges(now, written.changes, captions.length);
          const next = { ...report.draft, content: written.whole ? { ...report.draft.content, lang: report.draft.baseLocale } : report.draft.content, writtenBy: label };
          const item: SiteChatItem = { role: 'assistant', text, changed: report.changed, refused: report.refused, before: now, after: siteFingerprint(next), id: newId('m'), at: Date.now() };
          return { draft: next, chat: [...chat, item] };
        });
      } catch (error) {
        if (isStop(error)) return;
        await addChatTo(projectId, { role: 'assistant', text: `The AI couldn't write the site: ${messageOf(error, 'try again')}. The site has your screenshots' words for now.`, failed: true });
      } finally {
        writeStop.current = null;
        setWriting(false);
      }
    },
    [captions, ai.label, addChatTo]
  );

  const finishSetup = useCallback(
    (result: SetupResult) => {
      setSetupOpen(false);
      if (!project.id) return;
      const created = newDraft({
        projectId: project.id,
        facts: result.facts,
        theme: result.theme,
        captions,
        baseLocale,
        languages: result.languages,
        privacy: result.privacy,
      });
      site.create(created);
      track('website_create', { ai: result.writeWithAi, languages: result.languages.length, shots: boards.length });
      setSection(result.writeWithAi ? 'ask' : 'home');
      if (result.writeWithAi) void runWrite(created, result.notes);
    },
    [project.id, captions, baseLocale, site, boards.length, runWrite]
  );

  // --- the chat ------------------------------------------------------------------------------
  const [asking, setAsking] = useState(false);
  const askStop = useRef<AbortController | null>(null);
  const send = useCallback(
    async (message: string) => {
      const current = draftRef.current;
      if (!current || current.projectId !== projectIdRef.current || askStop.current) return;
      const projectId = current.projectId;
      const history = site.chat.filter((item) => !item.failed).map((item) => ({ role: item.role, text: item.text }));
      // An email address or store link the AI sends has to be one the developer wrote.
      const context: ChangeContext = { said: [...site.chat.filter((item) => item.role === 'user').map((item) => item.text), message].join('\n'), fontAllowed };
      addChat({ role: 'user', text: message });
      const stop = new AbortController();
      askStop.current = stop;
      setAsking(true);
      try {
        const answer = await askSite({ draft: current, captions, history, message, signal: stop.signal });
        if (stop.signal.aborted) return;
        await changeSite(projectId, ({ draft: now, chat }) => {
          const report = applyChanges(now, answer.changes, captions.length, context);
          const touched = report.changed.length > 0;
          const suggestion = report.suggested.privacyExtra;
          const item: SiteChatItem = {
            role: 'assistant',
            text:
              answer.reply ||
              (touched ? `Done: I changed the ${report.changed.join(', ')}.` : suggestion ? 'I wrote a paragraph for the privacy policy. Put it in if it says what your app does.' : "I didn't change anything."),
            changed: report.changed,
            refused: report.refused,
            before: touched ? now : undefined,
            after: touched ? siteFingerprint(report.draft) : undefined,
            suggestion: suggestion ? { privacyExtra: suggestion } : undefined,
            id: newId('m'),
            at: Date.now(),
          };
          return { draft: touched ? report.draft : now, chat: [...chat, item] };
        });
      } catch (error) {
        if (!isStop(error)) await addChatTo(projectId, { role: 'assistant', text: `The AI couldn't answer: ${messageOf(error, 'try again')}`, failed: true });
      } finally {
        askStop.current = null;
        setAsking(false);
      }
    },
    [site, captions, addChat, addChatTo]
  );

  /** Put the paragraph an answer suggested into the privacy policy. */
  const takeSuggestion = useCallback(
    (id: string) => {
      const text = site.chat.find((entry) => entry.id === id)?.suggestion?.privacyExtra;
      if (!text) return;
      site.update((now) => ({ ...now, content: { ...now.content, privacyExtra: text } }));
      site.setChat((chat) => chat.map((entry) => (entry.id === id && entry.suggestion ? { ...entry, suggestion: { ...entry.suggestion, used: true } } : entry)));
    },
    [site]
  );

  const undo = useCallback(
    (id: string) => {
      const item = site.chat.find((entry) => entry.id === id);
      if (!item?.before) return;
      const before = item.before;
      // Back to the site before the answer, but not to before a publish since.
      site.update((now) => ({ ...before, publish: now.publish }));
      site.setChat((chat) => chat.map((entry) => (entry.id === id ? { ...entry, before: undefined, text: `${entry.text}\n(Undone)` } : entry)));
    },
    [site]
  );

  // --- GitHub -----------------------------------------------------------------------------------
  const [identity, setIdentity] = useState<IdentityState>({ state: 'checking' });
  const [signingIn, setSigningIn] = useState(false);
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const signInStop = useRef<AbortController | null>(null);
  const checkIdentity = useCallback(async () => {
    try {
      const all = await githubIdentities();
      const ready = all.find((who) => mayPublish(who.scopes));
      setIdentity(ready ? { state: 'ready', who: ready } : all[0] ? { state: 'needs-scope', who: all[0] } : { state: 'none' });
    } catch (error) {
      setIdentity({ state: 'error', message: messageOf(error, "GitHub didn't answer. Try again in a moment") });
    }
  }, []);
  const wantsGithub = active && (section === 'publish' || !!draft?.publish);
  useEffect(() => {
    if (!wantsGithub) return;
    void checkIdentity();
    const stopAccount = onAccountChange(() => void checkIdentity());
    const stopOwn = onWebsiteGithubChange(() => void checkIdentity());
    return () => {
      stopAccount();
      stopOwn();
    };
  }, [wantsGithub, checkIdentity]);

  const signIn = useCallback(
    async (token?: string) => {
      signInStop.current?.abort();
      const stop = new AbortController();
      signInStop.current = stop;
      setSigningIn(true);
      setDeviceCode(null);
      try {
        const who = await signInForWebsite({ token, signal: stop.signal, onUserCode: (info) => !stop.signal.aborted && setDeviceCode(info) });
        if (mayPublish(who.scopes)) setIdentity({ state: 'ready', who });
        else {
          setIdentity({ state: 'needs-scope', who });
          toast({
            title: "GitHub didn't give access to public repositories",
            description: desktop ? 'Sign in again, and allow it when GitHub asks.' : 'Paste a GitHub token with public_repo access instead.',
          });
        }
      } catch (error) {
        if (!(error instanceof AccountCancelledError) && !stop.signal.aborted) {
          toast({ title: "Couldn't sign in to GitHub", description: messageOf(error, 'Try again in a moment.'), variant: 'destructive' });
        }
      } finally {
        if (signInStop.current === stop) signInStop.current = null;
        setSigningIn(false);
        setDeviceCode(null);
      }
    },
    [toast, desktop]
  );

  // --- publishing --------------------------------------------------------------------------------
  const [repoName, setRepoName] = useState('');
  useEffect(() => {
    setRepoName(draft?.publish?.repo ?? suggestedRepoName(draft?.facts.appName || project.name));
    // A new project's site, or a first publish, sets the name; typing does not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, draft?.publish?.repo, !!draft]);
  const [job, setJob] = useState<PublishJob | null>(null);
  const publishStop = useRef<AbortController | null>(null);
  /** Answers the question a publish asks about untranslated lines. */
  const goOn = useRef<((go: boolean) => void) | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const fingerprint = useMemo(() => (draft ? siteFingerprint(draft) : ''), [draft]);
  const boardsPrint = useMemo(() => boardsFingerprint(artboards), [artboards]);
  const published = draft?.publish;
  // The screenshots and the project's translations of their captions are
  // part of what goes out too, and they change in the editor.
  const changedSince = !!published && (published.fingerprint !== fingerprint || (published.boards !== undefined && published.boards !== boardsPrint));

  /** Every language's screenshots, for the files, and the boardsFingerprint each was taken from. */
  const allShots = useCallback(
    async (current: SiteDraft, signal?: AbortSignal): Promise<{ shots: Record<string, SiteShot[]>; prints: Array<string | null> }> => {
      const shots: Record<string, SiteShot[]> = {};
      const prints: Array<string | null> = [];
      if (!current.options.screenshots || !hasShots) return { shots, prints };
      for (const locale of current.languages) {
        if (signal?.aborted) throw stopped();
        if (locale !== baseLocale && !projectLocales.includes(locale)) continue;
        // Stop works while a screenshot is still being taken.
        const taken = await unlessStopped(takeShots(locale, current.projectId), signal);
        shots[locale] = taken.list;
        prints.push(taken.print);
      }
      return { shots, prints };
    },
    [hasShots, baseLocale, projectLocales, takeShots]
  );

  /** The heading face cut to the headings' letters in every language, or null to use the visitor's own. */
  const headingFace = useCallback(
    async (current: SiteDraft, signal?: AbortSignal) => {
      if (!current.theme.headingFont) return null;
      if (!isGoogleFamily(current.theme.headingFont)) {
        // A font the developer imported goes on the site only when they said its license allows it.
        if (!current.theme.shareFont) return null;
        return importedHeadingFace(current.theme.headingFont).catch((error) => {
          console.warn('The imported heading font could not be read; the site uses the visitor’s own', error);
          return null;
        });
      }
      const texts = siteTexts(current);
      const headings = [current.content.headline, current.content.galleryTitle, current.content.ctaTitle, ...current.content.features.map((feature) => feature.title), current.facts.appName];
      const letters = current.languages
        .flatMap((locale) => {
          const t = translator(current, locale, known);
          return [...headings.map((text) => t(text)), ...texts.template.map((text) => t(text, true))];
        })
        .join('');
      try {
        return await fetchHeadingFace(current.theme.headingFont, current.theme.headingWeight || 700, letters, signal);
      } catch (error) {
        console.warn('The heading face could not be fetched; the site uses the visitor’s own', error);
        return null;
      }
    },
    [known]
  );

  const blocked: string | null = !project.id
    ? 'Open a project first'
    : !draft
      ? 'Make the website first'
      : privacyProblems(draft.facts, draft.privacy)[0] === 'Add a support email'
        ? 'Add a support email under Your app first'
        : !draft.privacy.answered
          ? 'Answer the privacy questions under Privacy policy first'
          : identity.state === 'checking'
            ? 'Checking your GitHub sign-in'
            : identity.state === 'needs-scope'
              ? 'Allow access to public repositories first'
              : identity.state !== 'ready'
                ? 'Sign in to GitHub first'
                : repoNameProblem(repoName);

  const publish = useCallback(async () => {
    const start = draftRef.current;
    if (!start || start.projectId !== projectIdRef.current || identity.state !== 'ready' || publishStop.current) return;
    // Everything below is this project's, whichever project is open by the time it ends.
    const projectId = start.projectId;
    const who = identity.who;
    const repo = repoName;
    const stop = new AbortController();
    publishStop.current = stop;
    track('website_publish', { languages: start.languages.length, again: !!start.publish });
    const appName = start.facts.appName.trim();
    const setPhase = (next: Omit<PublishJob, 'appName'>) => setJob({ ...next, appName });
    let sent = false;
    try {
      setPhase({ phase: 'shots' });
      // The artboards the text comes from: the project's translations of the
      // captions (`known`) were read from them.
      const textBoards = boardsFingerprint(latestProject.current.artboards);
      const taken = await allShots(start, stop.signal);
      const shotsByLocale = taken.shots;
      // The record says which artboards went out only when every screenshot
      // and those translations came from the same ones. Otherwise it names
      // none, and the site shows as changed until it is published again.
      const boards = taken.prints.every((print) => print === textBoards) ? textBoards : '';
      const latest = draftRef.current;
      let current = latest && latest.projectId === projectId ? latest : start;
      if (Object.values(missingCounts(current, known)).some((count) => count > 0) && availableEngines().length > 0) {
        setPhase({ phase: 'translate' });
        const result = await translateSite(current, { known, signal: stop.signal, onProgress: (done, total) => setPhase({ phase: 'translate', done, total }) });
        current = { ...current, translations: result.translations };
        current = { ...current, translations: prunedTranslations(current) };
        const translated = current.translations;
        await updateSiteOf(projectId, (now) => {
          const merged = { ...now, translations: mergeBooks(now.translations, translated) };
          return { ...merged, translations: prunedTranslations(merged) };
        });
      }
      // Lines still in the site's own language go out only when the developer says so.
      const untranslated = Object.entries(missingCounts(current, known))
        .filter(([, count]) => count > 0)
        .map(([locale, count]) => ({ locale, count }));
      if (untranslated.length > 0) {
        setPhase({ phase: 'translate', untranslated });
        const go = await new Promise<boolean>((resolve) => {
          goOn.current = resolve;
          stop.signal.addEventListener('abort', () => resolve(false), { once: true });
        });
        goOn.current = null;
        if (!go) throw new DOMException('Stopped', 'AbortError');
      }
      setPhase({ phase: 'build' });
      const siteUrl = siteAddress(who.login, repo);
      const face = await headingFace(current, stop.signal);
      const build = newId('b');
      const files = renderSiteFiles(current, { shots: shotsByLocale, siteUrl, face, known, build });
      const outcome = await publishSite({
        token: who.token,
        owner: who.login,
        repo,
        files,
        appName: current.facts.appName,
        siteUrl,
        signal: stop.signal,
        onProgress: (progress) => setPhase({ phase: progress.step, done: progress.done, total: progress.total }),
      });
      sent = true;
      const pagesPending = outcome.pages === 'needs-you';
      const record: PublishRecord = {
        owner: who.login,
        repo,
        branch: outcome.branch,
        url: siteUrl,
        at: Date.now(),
        build,
        fingerprint: siteFingerprint(current),
        live: false,
        pagesPending,
        boards,
      };
      await updateSiteOf(projectId, (now) => ({ ...now, publish: record }));
      setPhase({ phase: 'live', needsPages: pagesPending, branch: outcome.branch, site: { owner: who.login, repo } });
      const live = await waitUntilLive({ siteUrl, build, signal: stop.signal, timeoutMs: pagesPending ? 20 * 60_000 : 6 * 60_000 });
      await updateSiteOf(projectId, (now) => (now.publish?.build === build ? { ...now, publish: { ...now.publish, live, pagesPending: live ? false : now.publish.pagesPending } } : now));
      toast(
        live
          ? { title: 'Your website is online', description: `${siteUrl}. The links for App Store Connect and Play Console are under Publish.` }
          : pagesPending
            ? { title: 'GitHub Pages is still off', description: 'Switch it on in the repository settings. The steps are under Publish.' }
            : { title: 'GitHub is still putting the site online', description: 'It can take a few more minutes the first time. The links are under Publish.' }
      );
    } catch (error) {
      if (isStop(error)) {
        toast(
          sent
            ? { title: 'Stopped waiting for GitHub', description: 'The site is on GitHub and goes online by itself. Its links are under Publish.' }
            : { title: 'Publishing stopped', description: 'Nothing on GitHub changed after the step that was running.' }
        );
      } else if (error instanceof ProjectChangedError) {
        toast({ title: 'Publishing stopped', description: 'Another project was opened while its screenshots were being taken. Open the project again and publish.' });
      } else {
        console.error('Publishing the website failed', error);
        toast({ title: "The website didn't go out", description: messageOf(error, 'Try again in a moment.'), variant: 'destructive' });
        if (error instanceof GithubPublishError && (error.problem === 'auth' || error.problem === 'scope')) void checkIdentity();
      }
    } finally {
      goOn.current = null;
      publishStop.current = null;
      setJob(null);
    }
  }, [identity, repoName, allShots, known, headingFace, updateSiteOf, toast, checkIdentity]);

  // A site GitHub has not served yet is looked at now and then while the
  // view is open, so it shows as online once it is, also when the developer
  // stopped waiting, or switched Pages on by hand after the app could not.
  const watchUrl = !job && published && !published.live ? published.url : null;
  const watchBuild = published?.build;
  const watchProject = draft?.projectId;
  const watchPending = !!published?.pagesPending;
  // Through a ref, so a new toast function never starts the look over.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    if (!active || !watchUrl || !watchBuild || !watchProject) return;
    const stop = new AbortController();
    let timer = 0;
    const look = async () => {
      const live = await isServing({ siteUrl: watchUrl, build: watchBuild, signal: stop.signal }).catch(() => false);
      if (stop.signal.aborted) return;
      if (live) {
        await updateSiteOf(watchProject, (now) => (now.publish?.build === watchBuild ? { ...now, publish: { ...now.publish, live: true, pagesPending: false } } : now));
        if (watchPending) toastRef.current({ title: 'Your website is online', description: 'GitHub Pages is on now. The links are under Publish.' });
        return;
      }
      timer = window.setTimeout(() => void look(), 15_000);
    };
    void look();
    return () => {
      stop.abort();
      window.clearTimeout(timer);
    };
  }, [active, watchUrl, watchBuild, watchProject, watchPending, updateSiteOf]);

  const saveZip = useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    setZipBusy(true);
    try {
      const shotsByLocale = (await allShots(current)).shots;
      const face = await headingFace(current);
      const siteUrl = identity.state === 'ready' && !repoNameProblem(repoName) ? siteAddress(identity.who.login, repoName) : undefined;
      const files = renderSiteFiles(current, { shots: shotsByLocale, siteUrl, face, known, build: newId('b') });
      const name = suggestedRepoName(current.facts.appName || project.name);
      const saved = await saveBlobToDisk(zipFiles(files, { folder: name }), `${name}-website.zip`);
      if (saved !== null) {
        toast({
          title: 'The site is saved as a ZIP',
          description: outstanding > 0 ? `${outstanding} lines aren't translated yet and show in the base language.` : 'Put the folder inside on any web server.',
        });
      }
    } catch (error) {
      console.error('Saving the website failed', error);
      toast({ title: "The site couldn't be saved", description: messageOf(error, 'Try again.'), variant: 'destructive' });
    } finally {
      setZipBusy(false);
    }
  }, [allShots, headingFace, identity, repoName, known, project.name, outstanding, toast]);

  // Work under way stops when the view goes with its window.
  useEffect(
    () => () => {
      for (const stop of [writeStop, askStop, translateStop, publishStop, signInStop]) stop.current?.abort();
    },
    []
  );

  // --- the preview --------------------------------------------------------------------------------
  // An imported heading font the developer put on the site, from this device's copy.
  const customFonts = useCustomFonts();
  const shareFamily = draft?.theme.shareFont && draft.theme.headingFont && !isGoogleFamily(draft.theme.headingFont) ? draft.theme.headingFont : '';
  const shareWeight = draft?.theme.headingWeight || 700;
  const [previewFace, setPreviewFace] = useState('');
  useEffect(() => {
    setPreviewFace('');
    if (!shareFamily || !customFonts.some((font) => font.family === shareFamily)) return;
    let cancelled = false;
    let url = '';
    void importedHeadingFace(shareFamily).then((face) => {
      if (cancelled || !face) return;
      url = URL.createObjectURL(new Blob([face.bytes as BlobPart]));
      setPreviewFace(faceCss(shareFamily, url, face.format, shareWeight));
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shareFamily, shareWeight, customFonts]);

  const [page, setPage] = useState<SitePage>('home');
  const [previewLocale, setPreviewLocale] = useState<string | null>(null);
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [scheme, setScheme] = useState<PreviewScheme>('light');
  const locale = draft && previewLocale && draft.languages.includes(previewLocale) ? previewLocale : draft?.baseLocale ?? baseLocale;
  const shotKey = locale !== baseLocale && projectLocales.includes(locale) ? locale : baseLocale;
  const ownShots = (key: string) => (shots[key]?.projectId === project.id ? shots[key].list : undefined);
  const previewShots = (shots[shotKey]?.doc === artboards ? ownShots(shotKey) : undefined) ?? ownShots(baseLocale) ?? [];
  useEffect(() => {
    if (!active || !draft || shotKey === baseLocale || shots[shotKey]?.doc === artboards) return;
    void takeShots(shotKey).catch((error) => console.error('The screenshots for the website could not be taken', error));
  }, [active, draft, shotKey, baseLocale, shots, artboards, takeShots]);
  const address =
    published?.url
      ? pageUrl(published.url, draft!, locale, page)
      : identity.state === 'ready' && !repoNameProblem(repoName)
        ? pageUrl(siteAddress(identity.who.login, repoName), draft ?? { baseLocale }, locale, page)
        : `https://your-name.github.io/${repoName || 'your-app'}/${draft ? pageDir(draft, locale, page) : ''}`;
  const busy = capturing ? (capturing === baseLocale ? 'Getting your screenshots' : `Getting the ${getLocaleDef(capturing)?.nativeName ?? capturing} screenshots`) : writing ? `${ai.label ?? 'The AI'} is writing your site` : null;

  // --- drawing --------------------------------------------------------------------------------------
  const status = !draft
    ? null
    : !published
      ? { tone: 'muted', text: 'Not online yet' }
      : !published.live
        ? { tone: 'amber', text: 'Going online' }
        : changedSince
          ? { tone: 'amber', text: 'Changes not online yet' }
          : { tone: 'good', text: 'Online' };

  const navBadge = (id: Section): React.ReactNode => {
    if (!draft) return null;
    const warn = (id === 'app' && !draft.facts.supportEmail.trim()) || (id === 'privacy' && !draft.privacy.answered);
    if (warn) return <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="Needs you" />;
    if (id === 'languages' && outstanding > 0) return <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] tabular-nums text-amber-700 dark:text-amber-300">{outstanding > 99 ? '99+' : outstanding}</span>;
    if (id === 'publish' && published) return <span className={cn('h-2 w-2 rounded-full', published.live && !changedSince ? 'bg-[hsl(var(--growth-good))]' : 'bg-amber-500')} aria-hidden />;
    if (id === 'ask' && (writing || asking)) return <Loader2Icon className="h-3.5 w-3.5 animate-spin" />;
    return null;
  };

  let panel: React.ReactNode = null;
  if (draft) {
    if (section === 'ask') {
      panel = (
        <WebsiteChat
          chat={site.chat}
          ai={ai}
          busy={asking || writing}
          fingerprint={fingerprint}
          onSend={(text) => void send(text)}
          onStop={() => {
            askStop.current?.abort();
            writeStop.current?.abort();
          }}
          onUndo={undo}
          onUseSuggestion={takeSuggestion}
        />
      );
    } else {
      const body =
        section === 'app' ? (
          <AppSection
            draft={draft}
            update={update}
            growthApps={growthApps}
            lookingUp={lookingUp}
            onLookup={() =>
              void lookUp(draft.facts.appStoreUrl).then((found) => {
                if (found) update((now) => ({ ...now, facts: { ...now.facts, ...Object.fromEntries(Object.entries(found).filter(([, value]) => value)) } }));
              })
            }
            onPickGrowthApp={(app) => {
              if (app.store === 'appstore') {
                const url = `https://apps.apple.com/app/id${app.id}`;
                update((now) => ({ ...now, facts: { ...now.facts, appStoreUrl: url } }));
                void lookUp(url).then((found) => {
                  if (found) update((now) => ({ ...now, facts: { ...now.facts, ...Object.fromEntries(Object.entries(found).filter(([key, value]) => value && (key === 'icon' || !now.facts[key as keyof SiteDraft['facts']]))) } }));
                });
              } else {
                update((now) => ({ ...now, facts: { ...now.facts, playStoreUrl: `https://play.google.com/store/apps/details?id=${app.id.replace(/^play:/, '')}` } }));
              }
            }}
            onIconFile={(file) =>
              void iconFromFile(file)
                .then((png) => update((now) => ({ ...now, facts: { ...now.facts, icon: png } })))
                .catch(() => toast({ title: "That picture couldn't be read", description: 'Use a PNG or a JPEG.' }))
            }
            onStoreIcon={() =>
              void lookUp(draft.facts.appStoreUrl).then((found) => {
                if (found?.icon) update((now) => ({ ...now, facts: { ...now.facts, icon: found.icon } }));
              })
            }
          />
        ) : section === 'look' ? (
          <LookSection draft={draft} update={update} suggested={suggested} hasShots={hasShots} />
        ) : section === 'home' ? (
          <HomeSection draft={draft} update={update} shots={ownShots(baseLocale) ?? []} />
        ) : section === 'support' ? (
          <SupportSection draft={draft} update={update} />
        ) : section === 'privacy' ? (
          <PrivacySection draft={draft} update={update} />
        ) : section === 'languages' ? (
          <LanguagesSection
            draft={draft}
            update={update}
            missing={missing}
            projectLocales={projectLocales}
            translating={translating}
            translateReason={translateReason}
            onTranslate={() => void runTranslate()}
            onStop={() => translateStop.current?.abort()}
          />
        ) : (
          <WebsitePublish
            draft={draft}
            desktop={desktop}
            identity={identity}
            signingIn={signingIn}
            deviceCode={deviceCode}
            onSignIn={(token) => void signIn(token)}
            onCancelSignIn={() => signInStop.current?.abort()}
            onSignOut={identity.state !== 'checking' && 'who' in identity && identity.who.source === 'website' ? () => signOutWebsiteGithub() : undefined}
            repo={repoName}
            onRepo={setRepoName}
            checklist={[
              { ok: !!draft.facts.supportEmail.trim(), label: draft.facts.supportEmail.trim() ? `Support email: ${draft.facts.supportEmail}` : 'Add a support email under Your app' },
              { ok: draft.privacy.answered, label: draft.privacy.answered ? 'Privacy questions answered' : 'Answer the privacy questions under Privacy policy' },
              {
                ok: outstanding === 0,
                label: outstanding === 0 ? `Every language is ready (${draft.languages.length})` : `${outstanding} lines aren't translated yet`,
                detail: outstanding > 0 ? (translateReason ? `They show in ${getLocaleDef(draft.baseLocale)?.nativeName ?? draft.baseLocale} until they're translated` : 'Publishing translates them first') : undefined,
              },
              {
                ok: hasShots || !draft.options.screenshots,
                label: hasShots ? `${boards.length} screenshots from ${project.name}` : 'No screenshots',
                detail: hasShots ? undefined : 'The home page shows your icon and colors instead',
              },
            ]}
            blocked={blocked}
            job={job}
            onPublish={() => void publish()}
            onStop={() => publishStop.current?.abort()}
            onGoOn={() => goOn.current?.(true)}
            onZip={() => void saveZip()}
            zipBusy={zipBusy}
            changed={changedSince}
          />
        );
      panel = <div className="h-full overflow-y-auto p-4">{body}</div>;
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" data-testid="website-view" aria-labelledby="website-view-title">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {draft?.facts.icon ? <img src={draft.facts.icon} alt="" className="h-full w-full object-cover" /> : <GlobeIcon className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <h1 id="website-view-title" className="text-sm font-semibold">
            Website
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {project.id ? `Home, support and privacy pages for ${draft?.facts.appName || factsFromProject(project.name).appName || project.name}` : 'Home, support and privacy pages for your app'}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {status && (
            <span
              data-testid="website-status"
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium',
                status.tone === 'good' && 'bg-[hsl(var(--growth-good))]/10 text-[hsl(var(--growth-good))]',
                status.tone === 'amber' && 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
                status.tone === 'muted' && 'bg-muted text-muted-foreground'
              )}
            >
              {status.text}
            </span>
          )}
          {published && (
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={() => void openExternal(published.url)}>
              Open the site
              <ExternalLinkIcon className="h-3.5 w-3.5" />
            </Button>
          )}
          {draft && (
            <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => setSection('publish')}>
              <RocketIcon className="h-3.5 w-3.5" />
              {published ? 'Publish changes' : 'Publish'}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onBackToEditor}>
            Back to the editor
          </Button>
        </div>
      </header>

      {!project.id ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-sm space-y-2">
            <GlobeIcon className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Open a project first</p>
            <p className="text-xs text-muted-foreground">The website uses its screenshots, colors and languages.</p>
            <Button type="button" variant="outline" size="sm" onClick={onBackToEditor}>
              Back to the editor
            </Button>
          </div>
        </div>
      ) : !site.loaded ? (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" />
          Loading the website
        </p>
      ) : !draft ? (
        <div className="min-h-0 flex-1">
          <WebsiteWelcome
            appName={factsFromProject(project.name).appName}
            previewDraft={previewDraft}
            shots={ownShots(baseLocale) ?? []}
            known={{}}
            languages={startLanguages}
            hasShots={hasShots}
            onStart={() => setSetupOpen(true)}
          />
          {previewDraft && (
            <WebsiteSetupDialog
              open={setupOpen}
              onOpenChange={setSetupOpen}
              initial={{ facts: previewDraft.facts, privacy: defaultPrivacy(), theme: startTheme, languages: startLanguages }}
              baseLocale={baseLocale}
              projectLocales={projectLocales}
              growthApps={growthApps}
              ai={ai}
              onLookup={lookUp}
              onFinish={finishSetup}
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 lg:w-48 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:border-b-0 lg:border-r" aria-label="Website sections">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                aria-current={section === item.id ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  section === item.id ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {navBadge(item.id)}
              </button>
            ))}
          </nav>
          <aside className="flex min-h-[420px] shrink-0 flex-col border-b lg:min-h-0 lg:w-[380px] lg:border-b-0 lg:border-r" aria-label="Edit the website">
            {panel}
          </aside>
          <main className="flex min-h-[560px] min-w-0 flex-1 flex-col bg-muted/30 lg:min-h-0" aria-label="Preview">
            <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
              <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Page">
                {PAGES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={page === item.id}
                    onClick={() => setPage(item.id)}
                    className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', page === item.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {draft.languages.length > 1 && (
                <Select value={locale} onValueChange={setPreviewLocale}>
                  <SelectTrigger className="h-8 w-auto min-w-[150px] gap-2 text-xs" aria-label="Language of the preview">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {draft.languages.map((code) => (
                      <SelectItem key={code} value={code} className="text-xs">
                        {getLocaleDef(code)?.nativeName ?? code}
                        {(missing[code] ?? 0) > 0 ? ` (${missing[code]} to translate)` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="ml-auto flex items-center gap-1">
                <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Screen">
                  <button type="button" aria-pressed={device === 'desktop'} aria-label="Computer" title="Computer" onClick={() => setDevice('desktop')} className={cn('rounded-md p-1.5', device === 'desktop' ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                    <MonitorIcon className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-pressed={device === 'phone'} aria-label="Phone" title="Phone" onClick={() => setDevice('phone')} className={cn('rounded-md p-1.5', device === 'phone' ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                    <SmartphoneIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Look">
                  <button type="button" aria-pressed={scheme === 'light'} aria-label="Light" title="Light" onClick={() => setScheme('light')} className={cn('rounded-md p-1.5', scheme === 'light' ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                    <SunIcon className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-pressed={scheme === 'dark'} aria-label="Dark" title="Dark" onClick={() => setScheme('dark')} className={cn('rounded-md p-1.5', scheme === 'dark' ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                    <MoonIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 p-4">
              <WebsitePreview
                draft={draft}
                page={page}
                locale={locale}
                device={device}
                scheme={scheme}
                shots={draft.options.screenshots ? previewShots : []}
                known={known}
                address={address}
                busy={busy}
                faceCss={previewFace}
                onNavigate={(nextPage, nextLocale) => {
                  setPage(nextPage);
                  setPreviewLocale(nextLocale);
                }}
              />
            </div>
          </main>
        </div>
      )}
    </section>
  );
}
