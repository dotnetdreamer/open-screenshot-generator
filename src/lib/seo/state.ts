// The SEO view's state, outside the screen: the sites, the check that is
// running, each site's results, plans and Google numbers. The view mounts a
// fresh screen per section, so anything that must outlive a section change
// lives here (as Growth's rule 54 asks of its own screens).

import { useSyncExternalStore } from 'react';
import { makeFixPlan, type FixPlan, type GoogleDigestInput } from './ai';
import {
  GoogleAccessError,
  GoogleApiOffError,
  PageSpeedBusyError,
  analyticsReport,
  cruxHistory,
  inspectUrl,
  runPageSpeed,
  searchConsoleReport,
  type AnalyticsReport,
  type CruxHistory,
  type Inspection,
  type PageSpeedResult,
  type SearchConsoleReport,
  type Strategy,
} from './google';
import { activeServiceAccount, getSeoGoogle } from './googleSettings';
import { normaliseStart } from './fetch';
import { scoreFindings } from './report';
import { checkDraftSite, checkLiveSite, inFolder, siteFolder } from './run';
import { putRun, putSite, readMeta, readRuns, readSites, removeSite, writeMeta } from './store';
import { getKnowledgeState } from './sync';
import type { RunProgress, SeoSite, SiteRun } from './types';
import { listSiteDrafts } from '@/lib/website/store';
import { isTauri } from '@/lib/desktop';
import { canOpenAsProject } from '@/lib/projectCanvas';
import { normalizeLocalization } from '@/lib/i18n/localization';
import type { ArtboardState } from '@/types/artboard';

export interface SiteData {
  /** Newest first. */
  runs: SiteRun[];
  plan: FixPlan | null;
  search: SearchConsoleReport | null;
  analytics: AnalyticsReport | null;
  speed: Partial<Record<Strategy, PageSpeedResult>>;
  crux: CruxHistory | null;
  inspections: Record<string, Inspection>;
}

export type Job = 'check' | 'plan' | 'google' | 'speed' | 'crux' | 'inspect' | 'search' | 'analytics';

export interface JobError {
  siteId: string;
  message: string;
  /** For a Google API that is turned off: the page that turns it on. */
  activationUrl?: string | null;
  kind?: 'api-off' | 'access' | 'busy' | 'other';
}

export interface SeoState {
  loaded: boolean;
  sites: SeoSite[];
  activeId: string | null;
  data: Record<string, SiteData>;
  progress: (RunProgress & { siteId: string; mode: SiteRun['mode'] }) | null;
  /** Which site each job is busy with. */
  busy: Partial<Record<Job, string>>;
  errors: Partial<Record<Job, JobError>>;
}

const EMPTY_DATA: SiteData = { runs: [], plan: null, search: null, analytics: null, speed: {}, crux: null, inspections: {} };
const INITIAL: SeoState = { loaded: false, sites: [], activeId: null, data: {}, progress: null, busy: {}, errors: {} };
const ACTIVE_KEY = 'open-screenshot-generator.seo.active-site';

let state: SeoState = INITIAL;
const listeners = new Set<() => void>();
const controllers = new Map<Job, AbortController>();

function set(next: Partial<SeoState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function setData(siteId: string, patch: Partial<SiteData>): void {
  set({ data: { ...state.data, [siteId]: { ...(state.data[siteId] ?? EMPTY_DATA), ...patch } } });
}

function setBusy(job: Job, siteId: string | null): void {
  const busy = { ...state.busy };
  if (siteId) busy[job] = siteId;
  else delete busy[job];
  set({ busy });
}

function setError(job: Job, error: JobError | null): void {
  const errors = { ...state.errors };
  if (error) errors[job] = error;
  else delete errors[job];
  set({ errors });
}

export function subscribeSeo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSeoState(): SeoState {
  return state;
}

export function useSeo(): SeoState {
  return useSyncExternalStore(subscribeSeo, getSeoState, () => INITIAL);
}

export function siteData(siteId: string | null, from: SeoState = state): SiteData {
  return (siteId && from.data[siteId]) || EMPTY_DATA;
}

/** Unit tests only: sites and their data, without IndexedDB. */
export function seedSeoState(next: Partial<SeoState>): void {
  set(next);
}

/** Unit tests only. */
export function resetSeoState(): void {
  state = INITIAL;
  controllers.clear();
}

async function readSiteData(siteId: string): Promise<SiteData> {
  const [runs, plan, search, analytics, mobile, desktop, crux, inspections] = await Promise.all([
    readRuns(siteId),
    readMeta<FixPlan>(`plan:${siteId}`),
    readMeta<SearchConsoleReport>(`search:${siteId}`),
    readMeta<AnalyticsReport>(`analytics:${siteId}`),
    readMeta<PageSpeedResult>(`speed-mobile:${siteId}`),
    readMeta<PageSpeedResult>(`speed-desktop:${siteId}`),
    readMeta<CruxHistory>(`crux:${siteId}`),
    readMeta<Record<string, Inspection>>(`inspect:${siteId}`),
  ]);
  const speed: SiteData['speed'] = {};
  if (mobile) speed.mobile = mobile;
  if (desktop) speed.desktop = desktop;
  return { runs, plan, search, analytics, speed, crux, inspections: inspections ?? {} };
}

function storedActive(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

/** Read everything kept. The view calls this when it first shows. */
export async function loadSeo(): Promise<void> {
  const sites = await readSites();
  const data: Record<string, SiteData> = {};
  for (const site of sites) data[site.id] = await readSiteData(site.id);
  const wanted = storedActive();
  set({ loaded: true, sites, data, activeId: sites.some((site) => site.id === wanted) ? wanted : (sites[0]?.id ?? null) });
}

export function selectSite(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // The choice lasts for this sitting.
  }
  set({ activeId: id });
}

/** Add a site by its address. Null with a reason when the address isn't one. */
export async function addSiteAddress(input: string): Promise<{ site: SeoSite } | { problem: string }> {
  const url = normaliseStart(input);
  if (!url) return { problem: "That doesn't look like a web address. Try something like myapp.com" };
  const id = `url:${url}`;
  const existing = state.sites.find((site) => site.id === id || site.url === url);
  if (existing) {
    selectSite(existing.id);
    return { site: existing };
  }
  const parsed = new URL(url);
  const name = `${parsed.host.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`;
  const site: SeoSite = { id, url, name, source: 'address', addedAt: Date.now() };
  await putSite(site);
  set({ sites: [...state.sites, site], data: { ...state.data, [id]: EMPTY_DATA } });
  selectSite(id);
  return { site };
}

/**
 * Bring in the Website view's sites: every published one, and the open
 * project's site before it's published (checked from its pages). A site
 * keeps its place and results when its address changes.
 */
export async function syncWebsiteSites(openProjectId: string | null): Promise<void> {
  const drafts = await listSiteDrafts();
  const sites = [...state.sites];
  let changed = false;
  for (const draft of drafts) {
    if (!draft.publish?.url && draft.projectId !== openProjectId) continue;
    const id = `web:${draft.projectId}`;
    const name = draft.facts.appName.trim() || 'Your app';
    const url = draft.publish?.url ?? '';
    const index = sites.findIndex((site) => site.id === id);
    if (index < 0) {
      const site: SeoSite = { id, url, name, source: 'website', projectId: draft.projectId, addedAt: Date.now() };
      sites.push(site);
      await putSite(site);
      changed = true;
    } else if (sites[index].url !== url || sites[index].name !== name) {
      sites[index] = { ...sites[index], url, name };
      await putSite(sites[index]);
      changed = true;
    }
  }
  if (changed) {
    const data = { ...state.data };
    for (const site of sites) data[site.id] ??= EMPTY_DATA;
    set({ sites, data, activeId: state.activeId ?? sites[0]?.id ?? null });
  }
}

export async function forgetSite(id: string): Promise<void> {
  await removeSite(id);
  const sites = state.sites.filter((site) => site.id !== id);
  const data = { ...state.data };
  delete data[id];
  set({ sites, data, activeId: state.activeId === id ? (sites[0]?.id ?? null) : state.activeId });
}

function messageOf(error: unknown): JobError['message'] {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again';
}

function jobError(siteId: string, error: unknown): JobError {
  if (error instanceof GoogleApiOffError) return { siteId, message: error.message, activationUrl: error.activationUrl, kind: 'api-off' };
  if (error instanceof GoogleAccessError) return { siteId, message: "The key's email doesn't have access to this property yet. Add it as a user in Search Console or Analytics, then try again", kind: 'access' };
  if (error instanceof PageSpeedBusyError) return { siteId, message: error.message, kind: 'busy' };
  return { siteId, message: messageOf(error), kind: 'other' };
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

async function runJob<T>(job: Job, siteId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  if (state.busy[job]) return null;
  const controller = new AbortController();
  controllers.set(job, controller);
  setBusy(job, siteId);
  setError(job, null);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (!isAbort(error) && !controller.signal.aborted) {
      console.error(`SEO ${job} failed`, error);
      setError(job, jobError(siteId, error));
    }
    return null;
  } finally {
    if (controllers.get(job) === controller) controllers.delete(job);
    setBusy(job, null);
  }
}

export function stopJob(job: Job): void {
  controllers.get(job)?.abort();
}

/** The project open in the editor, as the SEO view reads it. */
export interface OpenProject {
  id: string | null;
  artboards: ArtboardState[];
}

/**
 * The artboards a site's pages are drawn from before it's published: the
 * open project's as they are on screen, or else the saved ones of the site's
 * own project. A site stays on the list after its project is closed, and it
 * must never be drawn from another project's artboards.
 */
export async function draftArtboards(site: SeoSite, open: OpenProject, readSaved: (projectId: string) => Promise<unknown> = readSavedProject): Promise<ArtboardState[]> {
  if (!site.projectId) throw new Error('This site has no project to check');
  if (open.id === site.projectId) return open.artboards;
  const saved = await readSaved(site.projectId);
  if (!canOpenAsProject(saved)) throw new Error("This site's project isn't on this device anymore, so its pages can't be checked before publishing");
  return normalizeLocalization(saved);
}

async function readSavedProject(projectId: string): Promise<unknown> {
  const { db } = await import('@/database');
  return (await db.projects.get(projectId))?.projectData ?? null;
}

/** Check a site: live, or the Website view's pages before they are published. */
export function startCheck(siteId: string, mode: SiteRun['mode'], readOpen: () => OpenProject): Promise<SiteRun | null> {
  const site = state.sites.find((entry) => entry.id === siteId);
  if (!site) return Promise.resolve(null);
  return runJob('check', siteId, async (signal) => {
    set({ progress: { siteId, mode, phase: 'start', done: 0, total: 1 } });
    try {
      const run =
        mode === 'draft'
          ? await checkDraftSite(site, await draftArtboards(site, readOpen()))
          : await checkLiveSite(site, { signal, onProgress: (progress) => set({ progress: { ...progress, siteId, mode } }) });
      if (!run) throw new Error("This project has no website yet. Make one in the Website view first");
      if (signal.aborted) return null;
      await putRun(run);
      setData(siteId, { runs: [run, ...siteData(siteId).runs].slice(0, 5) });
      return run;
    } finally {
      set({ progress: null });
    }
  });
}

export function makePlan(siteId: string, siteName: string): Promise<FixPlan | null> {
  const run = siteData(siteId).runs[0];
  if (!run) return Promise.resolve(null);
  return runJob('plan', siteId, async (signal) => {
    const plan = await makeFixPlan({ run, siteName, google: googleInput(siteId), knowledge: getKnowledgeState(), signal });
    await writeMeta(`plan:${siteId}`, plan);
    setData(siteId, { plan });
    return plan;
  });
}

export function googleInput(siteId: string): GoogleDigestInput {
  const site = state.sites.find((entry) => entry.id === siteId) ?? null;
  return { search: searchOf(siteId), analytics: analyticsOf(siteId), speed: speedOf(site, 'mobile') ?? null };
}

/**
 * The site's Search Console numbers, when they are of the property picked
 * for it now: after a change of property the old numbers are never shown
 * under the new one's name.
 */
export function searchOf(siteId: string | null, from: SeoState = state): SearchConsoleReport | null {
  const report = siteData(siteId, from).search;
  const property = siteId ? getSeoGoogle().sites[siteId]?.searchConsole : undefined;
  return report && property && report.property === property ? report : null;
}

/** The site's Analytics numbers, when they are of the property picked for it now. */
export function analyticsOf(siteId: string | null, from: SeoState = state): AnalyticsReport | null {
  const report = siteData(siteId, from).analytics;
  const property = siteId ? getSeoGoogle().sites[siteId]?.analytics : undefined;
  return report && property && report.property === property ? report : null;
}

/**
 * The site's latest check, when it read the site live at the address it has
 * now. A Website view site keeps its results when it moves to another
 * address, but a check of the old one says nothing about the new one: not
 * where it redirects, not whose host it shares. A check from before runs
 * kept their address (SiteRun.site) counts for nothing here.
 */
export function liveRunOf(site: SeoSite, run: SiteRun | null): SiteRun | null {
  return run?.mode === 'live' && !!site.url && run.site === site.url ? run : null;
}

/**
 * Whether `url` is one of `site`'s pages: in the site's folder, or in the
 * folder its last live check of this address ended up in (www.example.com/
 * redirecting to example.com/, say).
 */
export function pageOfSite(site: SeoSite, url: string, run: SiteRun | null = siteData(site.id).runs[0] ?? null): boolean {
  if (!site.url) return false;
  const live = liveRunOf(site, run);
  return inFolder(url, siteFolder(site.url)) || (live !== null && inFolder(url, live.root));
}

/**
 * The site's PageSpeed result, when it is for one of the site's own pages.
 * Kept per site, but a result tested on another site's page (which the Speed
 * screen once allowed after a switch of site) is never shown or scored.
 */
export function speedOf(site: SeoSite | null, strategy: Strategy, from: SeoState = state): PageSpeedResult | undefined {
  if (!site) return undefined;
  const data = siteData(site.id, from);
  const result = data.speed[strategy];
  return result && speedIsOfSite(site, result, data.runs[0] ?? null) ? result : undefined;
}

/**
 * Whether a PageSpeed result is about one of the site's pages: the one asked
 * for, and every one PageSpeed says it tested. A result that names no page
 * it tested (one kept before the app read them) can't be placed, so it isn't.
 */
function speedIsOfSite(site: SeoSite, result: PageSpeedResult, run: SiteRun | null): boolean {
  if (!result.testedUrls?.length) return false;
  return [result.url, ...result.testedUrls].every((url) => pageOfSite(site, url, run));
}

/**
 * Whether the site is a whole host (example.com/) rather than a folder on one
 * (name.github.io/app/). Chrome's site-wide numbers are for a whole host, so
 * for a folder they'd be other sites' visitors too.
 */
export function siteIsWholeHost(site: SeoSite | null, run: SiteRun | null = site ? siteData(site.id).runs[0] ?? null : null): boolean {
  if (!site?.url) return false;
  const folder = liveRunOf(site, run)?.root ?? siteFolder(site.url);
  try {
    return folder === `${new URL(folder).origin}/`;
  } catch {
    return false;
  }
}

/** The host Chrome's site-wide numbers are for: where the last live check of this address ended up (www.example.com may send everyone to example.com). */
export function siteOrigin(site: SeoSite | null, run: SiteRun | null = site ? siteData(site.id).runs[0] ?? null : null): string | null {
  if (!site?.url) return null;
  try {
    return new URL(liveRunOf(site, run)?.root ?? site.url).origin;
  } catch {
    return null;
  }
}

/** Why a site in a folder has no history of its own (siteIsWholeHost). */
export const CRUX_SHARED_HOST = "Chrome counts real visitors for a whole address, and this site is a folder at an address other sites share, so there's no history for this site alone";

/** Whether Google's own numbers (Search Console, Analytics) can be read here: the desktop app with a key. */
export function googleReason(): string | null {
  if (!isTauri()) return "Search Console and Analytics need the desktop app. A web page can't keep your Google key safe";
  if (!activeServiceAccount()) return 'Add a Google key under Setup first';
  return null;
}

/** Sites whose Google numbers were asked for while another refresh ran: they're read when it ends. */
const googleAgain = new Set<string>();
/** The refresh under way: its site and the properties it reads. */
let googleReading: { siteId: string; properties: string } | null = null;

/**
 * Read the site's Search Console and Analytics numbers for the properties
 * picked now. Each is kept on its own: one that fails (an API that's off, a
 * property the key can't see) leaves the other's new numbers in place and
 * puts its own error under errors.search or errors.analytics. True when both
 * were read.
 */
export function refreshGoogle(siteId: string): Promise<boolean | null> {
  const key = activeServiceAccount();
  const properties = getSeoGoogle().sites[siteId] ?? {};
  if (!key || (!properties.searchConsole && !properties.analytics)) return Promise.resolve(null);
  const reading = JSON.stringify([properties.searchConsole ?? null, properties.analytics ?? null]);
  if (state.busy.google) {
    // The same numbers on their way already need no second trip.
    if (googleReading?.siteId !== siteId || googleReading.properties !== reading) googleAgain.add(siteId);
    return Promise.resolve(null);
  }
  googleReading = { siteId, properties: reading };
  const done = runJob('google', siteId, async () => {
    setError('search', null);
    setError('analytics', null);
    // Each shows as soon as it's read: a slow Analytics never holds back Search Console's numbers.
    const read = async <T,>(job: 'search' | 'analytics', property: string | undefined, fetch: (property: string) => Promise<T>, keep: (value: T) => Partial<SiteData>): Promise<boolean> => {
      if (!property) return true;
      try {
        const value = await fetch(property);
        await writeMeta(`${job}:${siteId}`, value);
        setData(siteId, keep(value));
        return true;
      } catch (error) {
        console.error(`${job === 'search' ? 'Search Console' : 'Analytics'} refresh failed`, error);
        setError(job, jobError(siteId, error));
        return false;
      }
    };
    const [search, analytics] = await Promise.all([
      read('search', properties.searchConsole, (property) => searchConsoleReport(key, property), (value) => ({ search: value })),
      read('analytics', properties.analytics, (property) => analyticsReport(key, property), (value) => ({ analytics: value })),
    ]);
    return search && analytics;
  });
  return done.then((result) => {
    googleReading = null;
    // A property picked, or another site asked for, while this one ran.
    const next = [...googleAgain][0];
    if (next) {
      googleAgain.delete(next);
      void refreshGoogle(next);
    }
    return result;
  });
}

export function runSpeed(siteId: string, url: string, strategy: Strategy): Promise<PageSpeedResult | null> {
  return runJob('speed', siteId, async (signal) => {
    const site = state.sites.find((entry) => entry.id === siteId);
    if (!site || !pageOfSite(site, url)) throw new Error("That page isn't on this site. Pick one of its pages");
    const result = await runPageSpeed(url, strategy, getSeoGoogle().apiKey, signal);
    if (!result.testedUrls?.length) throw new Error("PageSpeed didn't say which page it tested, so the result isn't kept. Try again");
    // The page redirected out of the site, so PageSpeed tested another site's page: nothing of it is kept.
    const away = result.testedUrls.find((tested) => !pageOfSite(site, tested));
    if (away) throw new Error(`PageSpeed ended up at ${away}, which isn't on this site, so the result isn't kept. Pick a page that doesn't redirect away`);
    await writeMeta(`speed-${strategy}:${siteId}`, result);
    setData(siteId, { speed: { ...siteData(siteId).speed, [strategy]: result } });
    return result;
  });
}

export function loadCrux(siteId: string, origin: string): Promise<CruxHistory | null> {
  const apiKey = getSeoGoogle().apiKey;
  if (!apiKey) return Promise.resolve(null);
  return runJob('crux', siteId, async (signal) => {
    const site = state.sites.find((entry) => entry.id === siteId) ?? null;
    if (!siteIsWholeHost(site)) throw new Error(CRUX_SHARED_HOST);
    const history = await cruxHistory(origin, apiKey, signal);
    if (!history) throw new Error("Chrome doesn't have enough real visitors to this site yet to report its numbers");
    await writeMeta(`crux:${siteId}`, history);
    setData(siteId, { crux: history });
    return history;
  });
}

export function inspectPage(siteId: string, url: string): Promise<Inspection | null> {
  const key = activeServiceAccount();
  const property = getSeoGoogle().sites[siteId]?.searchConsole;
  if (!key || !property) return Promise.resolve(null);
  return runJob('inspect', siteId, async () => {
    const site = state.sites.find((entry) => entry.id === siteId);
    if (!site || !pageOfSite(site, url)) throw new Error("That page isn't on this site");
    const result = await inspectUrl(key, property, url);
    const inspections = { ...siteData(siteId).inspections, [url]: result };
    await writeMeta(`inspect:${siteId}`, inspections);
    setData(siteId, { inspections });
    return result;
  });
}

/** The latest run's score with speed folded in, once PageSpeed has run. */
export function scoreWithSpeed(run: SiteRun, speed: PageSpeedResult | undefined) {
  const performance = speed?.scores.performance ?? null;
  if (performance === null) return run.score;
  return scoreFindings(run.findings, run.pages.filter((page) => page.checks).length, performance);
}
