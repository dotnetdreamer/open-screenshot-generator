// One check of a site: read robots.txt and the sitemap, pick the pages, read
// them, then hand everything to report.ts. Live sites are fetched; a site the
// Website view hasn't published yet is checked from the pages it would
// publish, rendered here the same way (render.ts draws both).

import { MAX_SITEMAP_BYTES, parseRobots, readSitemapBody, urlMatchKey } from './checks';
import { FETCH_PROBLEM_WORDS, fetchUrl, isHtml, type Fetched, type Transport } from './fetch';
import { buildRun, pageLinks, readPage, type PageInput, type SiteExtras } from './report';
import type { PageReport, RunProgress, SeoSite, SiteRun } from './types';
import { readSiteRow, flushWebsiteSaves } from '@/lib/website/store';
import { pageUrl, renderPage, renderSiteFiles, type ShotRef } from '@/lib/website/render';
import { projectTranslations } from '@/lib/website/translate';
import { captionOf, siteBoards } from '@/lib/website/content';
import { projectArtboards } from '@/lib/i18n/project';
import { SITE_PAGES, type SitePage } from '@/lib/website/types';
import type { ArtboardState } from '@/types/artboard';

/** How many pages one run reads. A site with more names how many it left out. */
export const MAX_PAGES = 30;
const PARALLEL = 3;
const GAP_MS = 250;

function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * In a browser, a site's answer can only be read when the site allows other
 * sites to read it. GitHub Pages allows it for a 200 and not for its 404, a
 * redirect to another host may not allow it at all, and the browser says the
 * same "blocked" for each. So a blocked address is one this check couldn't
 * read, never a missing file or a broken page; the run lists it (`unread`).
 */
async function fetchNoting(url: string, accept: string, unread: string[], signal?: AbortSignal, transport?: Transport, more: { keepBody?: boolean; maxBytes?: number } = {}): Promise<Fetched> {
  const answer = await fetchUrl(url, { signal, accept, transport, ...more });
  if (answer.problem === 'blocked') unread.push(url);
  return answer;
}

/** The same site with or without "www.", the address a browser may be able to read when the other redirects. */
function otherHostForm(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.startsWith('www.')) parsed.hostname = parsed.hostname.slice(4);
    else if (parsed.hostname.split('.').length === 2) parsed.hostname = `www.${parsed.hostname}`;
    else return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** Whether `url` is a page of the site in `folder`: the same host, at or under its folder. */
export function inFolder(url: string, folder: string): boolean {
  try {
    const page = new URL(url);
    const base = new URL(folder);
    return page.host === base.host && page.pathname.startsWith(base.pathname);
  } catch {
    return false;
  }
}

const SITEMAP_ACCEPT = 'application/xml,text/xml,*/*;q=0.5';

const isFound = (answer: Fetched) => answer.status !== null && answer.status >= 200 && answer.status < 300;

/**
 * What an answer says about a file: it's there, it isn't (a 404 or a 410,
 * nothing else), or nothing is known. A browser that couldn't read the
 * answer, a server error, a refusal, a rate limit or a timeout says nothing
 * either way, so it never becomes "missing".
 */
export function fileState(answer: Fetched): 'there' | 'gone' | 'unknown' {
  if (answer.status === null || answer.text === null) return 'unknown';
  if (answer.status === 404 || answer.status === 410) return 'gone';
  return answer.status >= 200 && answer.status < 300 ? 'there' : 'unknown';
}

/**
 * What one sitemap answer says, read the way claude-seo reads it
 * (checks/sitemap.ts, from sitemap_discovery.py): the addresses it lists
 * (pages, or an index's sitemaps); a web page in its place, as a site
 * that answers every address with a page gives; a file claude-seo can't
 * read as a sitemap, and why; or nothing known.
 */
export type SitemapAnswer =
  | { state: 'gone' }
  | { state: 'unknown' }
  | { state: 'page' }
  | { state: 'unreadable'; reason: string }
  | { state: 'read'; index: boolean; urls: string[]; incomplete: boolean };

/** claude-seo's reasons, in the app's words, for the finding's evidence. */
const UNREADABLE_WORDS: Record<string, string> = {
  'invalid XML': "it isn't valid XML",
  'unsupported XML root': "it's XML, but not a sitemap",
  'DOCTYPE is not allowed in sitemap XML': "it has a DOCTYPE, which a sitemap can't have",
  'response is not a supported sitemap format': "it isn't a sitemap",
  'invalid text sitemap': "it's a list, but not every line is a web address",
  'text sitemap exceeds the 50,000 URL protocol limit': 'it lists more than 50,000 addresses',
  'empty response': "it's empty",
  'invalid gzip data': "it's a broken gzip file",
  'Sitemap exceeds the 50 MiB uncompressed protocol limit': "it's larger than 50 MB",
};

export function readSitemapAnswer(answer: Fetched): SitemapAnswer {
  const state = fileState(answer);
  if (state !== 'there') return { state };
  if (!answer.body) return { state: 'unknown' };
  const read = readSitemapBody(answer.body, answer.headers['content-type'] ?? '', answer.finalUrl);
  if (read.kind === null) {
    // What the port can't follow (an encoding, an xml:base) says nothing either way.
    if (read.unread) return { state: 'unknown' };
    if (isHtml(answer)) return { state: 'page' };
    return { state: 'unreadable', reason: UNREADABLE_WORDS[read.error ?? ''] ?? "it isn't a sitemap" };
  }
  if (read.kind === 'text') return { state: 'read', index: false, urls: read.lines ?? [], incomplete: false };
  const urls = read.entries.flatMap((entry) => (entry.loc ? [entry.loc] : []));
  return { state: 'read', index: read.kind === 'sitemapindex', urls, incomplete: !!read.unread };
}

/** The most sitemaps robots.txt names that are read, and the most an index lists that are read. */
const MAX_NAMED_SITEMAPS = 3;
const MAX_CHILD_SITEMAPS = 3;

export interface SitemapSearch {
  /** The first sitemap that lists pages of the site. */
  url: string | null;
  /** The pages of the site the sitemaps list. */
  urls: string[];
  problem?: string;
  /** No sitemap found, but a place one could be wasn't read: nothing is known. */
  unknown: boolean;
  /** None of the site's found, and one place answered with a file claude-seo can't read as a sitemap. */
  unreadable?: { url: string; reason: string };
}

/**
 * The site's sitemaps: the ones robots.txt names, then sitemap.xml in the
 * site's folder and at the host root. Only pages in the site's folder count:
 * on a shared host (name.github.io/app/) the root's sitemap is another
 * site's. "No sitemap" needs every place one could be to have answered:
 * robots.txt read (`named` null when it wasn't), every sitemap it names
 * read, and each of those either missing or listing none of the site's
 * pages. A web page where sitemap.xml would be is no sitemap there; where
 * robots.txt or an index points, it's a sitemap that can't be read, and so
 * is any other file claude-seo can't read as one: never "no sitemap".
 * "Can't be read" needs the same: every place read, none of the site's found.
 */
export async function findSitemaps(named: string[] | null, folder: string, origin: string, read: (url: string) => Promise<Fetched>): Promise<SitemapSearch> {
  // robots.txt unread, or naming more sitemaps than are read: one of them may be the site's.
  let unknown = named === null || named.length > MAX_NAMED_SITEMAPS;
  let foreign = false;
  let unreadable: { url: string; reason: string } | undefined;
  let url: string | null = null;
  const urls: string[] = [];
  const listed = new Set((named ?? []).slice(0, MAX_NAMED_SITEMAPS));
  const candidates = [...new Set([...listed, `${folder}sitemap.xml`, `${origin}/sitemap.xml`])];
  for (const candidate of candidates) {
    const sitemap = readSitemapAnswer(await read(candidate));
    if (sitemap.state === 'unknown') {
      unknown = true;
      continue;
    }
    if (sitemap.state === 'gone') continue;
    if (sitemap.state === 'page') {
      if (listed.has(candidate)) unreadable ??= { url: candidate, reason: "it's a web page, not a sitemap" };
      continue;
    }
    if (sitemap.state === 'unreadable') {
      unreadable ??= { url: candidate, reason: sitemap.reason };
      continue;
    }
    const found: string[] = [];
    let partial = sitemap.incomplete;
    if (sitemap.index) {
      // Each child once, and the site's own first, when an index lists several sites'.
      const children = [...new Set(sitemap.urls)].sort((a, b) => Number(inFolder(b, folder)) - Number(inFolder(a, folder)));
      if (children.length > MAX_CHILD_SITEMAPS) partial = true;
      for (const child of children.slice(0, MAX_CHILD_SITEMAPS)) {
        const childMap = readSitemapAnswer(await read(child));
        if (childMap.state === 'unknown') partial = true;
        // A sitemap the index names that's a page, or that can't be read, is the site's broken sitemap.
        else if (childMap.state === 'page') unreadable ??= { url: child, reason: "it's a web page, not a sitemap" };
        else if (childMap.state === 'unreadable') unreadable ??= { url: child, reason: childMap.reason };
        // An index inside an index is one Google doesn't read: what it lists are sitemaps, not pages.
        else if (childMap.state === 'read' && !childMap.index) {
          found.push(...childMap.urls);
          if (childMap.incomplete) partial = true;
        }
      }
    } else {
      found.push(...sitemap.urls);
    }
    // Read in part (an index past three, an entry this check can't place) says nothing about the rest.
    if (partial && !found.some((page) => inFolder(page, folder))) {
      unknown = true;
      continue;
    }
    const ours = found.filter((page) => inFolder(page, folder));
    if (!ours.length) {
      foreign = true;
      continue;
    }
    url ??= candidate;
    urls.push(...ours);
  }
  if (url) return { url, urls, unknown: false };
  // A place not read may hold the site's sitemap, so a broken file elsewhere doesn't make the sitemap broken.
  if (unknown) return { url: null, urls: [], unknown: true, problem: "Some places a sitemap could be couldn't be read, so this check can't tell whether the site has one" };
  if (unreadable) return { url: null, urls: [], unknown: false, unreadable, problem: `${unreadable.url}: ${unreadable.reason}` };
  return { url: null, urls: [], unknown: false, problem: foreign ? 'The sitemaps found list no pages of this site' : undefined };
}

function problemWords(fetched: Fetched): string | undefined {
  return fetched.problem ? FETCH_PROBLEM_WORDS[fetched.problem] : undefined;
}

function labelFor(url: string, root: string): string {
  try {
    const page = new URL(url);
    const base = new URL(root);
    let path = page.pathname.startsWith(base.pathname) ? page.pathname.slice(base.pathname.length) : page.pathname;
    path = decodeURIComponent(path).replace(/index\.html?$/i, '').replace(/\/$/, '');
    return path ? `/${path}${page.search}` : 'Home page';
  } catch {
    return url;
  }
}

/** The folder a site lives in: "https://name.github.io/app/" for a GitHub Pages project site. */
export function siteFolder(url: string): string {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/[^/]*$/, '');
  return parsed.href;
}

async function eachLimited<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      await work(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

/** Check a live site. Throws only for a Stop, or when the start page itself can't be read. */
export async function checkLiveSite(site: SeoSite, options: { signal?: AbortSignal; onProgress?: (progress: RunProgress) => void; transport?: Transport; pauseMs?: number } = {}): Promise<SiteRun> {
  const { signal, onProgress, transport } = options;
  const gap = options.pauseMs ?? GAP_MS;
  const startedAt = Date.now();
  const unread: string[] = [];
  let note: string | undefined;
  onProgress?.({ phase: 'start', done: 0, total: 1, current: site.url });
  let home = await fetchUrl(site.url, { signal, transport });
  // A browser can't follow a redirect that doesn't let other sites read it,
  // which www.example.com to example.com often is. The other form is tried
  // once, and the run says which one it read.
  const other = home.problem === 'blocked' ? otherHostForm(site.url) : null;
  if (other) {
    const retry = await fetchUrl(other, { signal, transport });
    if (retry.text !== null && retry.status !== null && retry.status < 400) {
      note = `Your browser couldn't read ${new URL(site.url).host}, so this check read ${new URL(other).host} instead. The desktop app reads both.`;
      home = retry;
    }
  }
  if (home.problem === 'stopped') throw new DOMException('Stopped', 'AbortError');
  if (home.text === null || home.status === null) throw new Error(problemWords(home) ?? `The home page answered HTTP ${home.status}`);

  const start = home.finalUrl;
  const origin = new URL(start).origin;
  const folder = siteFolder(start);

  onProgress?.({ phase: 'robots', done: 0, total: 1, current: `${origin}/robots.txt` });
  const robotsAnswer = await fetchNoting(`${origin}/robots.txt`, 'text/plain,*/*;q=0.5', unread, signal, transport);
  const robotsOk = robotsAnswer.status !== null && robotsAnswer.status >= 200 && robotsAnswer.status < 300 && !/^\s*</.test(robotsAnswer.text ?? '');
  const robotsState = fileState(robotsAnswer);
  let robotsInFolder = false;
  /** The root has no robots.txt and the folder's couldn't be read: which finding is true isn't known. */
  let robotsFolderUnknown = false;
  if (robotsState === 'gone' && folder !== `${origin}/`) {
    const inFolderAnswer = await fetchNoting(`${folder}robots.txt`, 'text/plain,*/*;q=0.5', unread, signal, transport);
    const state = fileState(inFolderAnswer);
    robotsInFolder = state === 'there' && !/^\s*</.test(inFolderAnswer.text ?? '');
    robotsFolderUnknown = state === 'unknown';
  }
  const robots = robotsOk ? parseRobots(robotsAnswer.text ?? '') : null;

  // A robots.txt that is there names its sitemaps; one that's missing, or a
  // page served in its place, names none; any other answer leaves them unknown.
  const named = robots ? robots.sitemaps : robotsState === 'gone' || (robotsState === 'there' && !robotsOk) ? [] : null;
  const sitemap = await findSitemaps(named, folder, origin, (url) => fetchNoting(url, SITEMAP_ACCEPT, unread, signal, transport, { keepBody: true, maxBytes: MAX_SITEMAP_BYTES }));
  const sitemapUrls = sitemap.urls;

  // The pages: the start page, the sitemap's, then the start page's links, in the site's folder only.
  const homeReport = readPage(toInput(home, 'Home page', 'start', home.url), robots);
  const seen = new Set([urlMatchKey(start), urlMatchKey(site.url), urlMatchKey(home.url)]);
  const queue: Array<{ url: string; foundBy: PageReport['foundBy'] }> = [];
  const pushUrl = (url: string, foundBy: PageReport['foundBy']) => {
    const key = urlMatchKey(url);
    if (seen.has(key) || !inFolder(url, folder)) return;
    seen.add(key);
    queue.push({ url, foundBy });
  };
  for (const url of sitemapUrls) pushUrl(url, 'sitemap');
  for (const url of pageLinks(homeReport.checks?.links ?? [], start)) pushUrl(url, 'link');
  const wanted = queue.slice(0, MAX_PAGES - 1);
  const leftOut = Math.max(0, queue.length - wanted.length);

  const pages: PageReport[] = [homeReport];
  let done = 0;
  onProgress?.({ phase: 'pages', done: 1, total: wanted.length + 1 });
  const results: PageReport[] = new Array(wanted.length);
  await eachLimited(wanted, PARALLEL, async (item, index) => {
    if (signal?.aborted) return;
    const answer = await fetchNoting(item.url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', unread, signal, transport);
    // A page of the site that redirects out of it: what it ends at is another site's, and isn't read.
    const left = answer.status !== null && !inFolder(answer.finalUrl, folder);
    const input = toInput(answer, labelFor(left ? item.url : answer.finalUrl, folder), item.foundBy, item.url);
    results[index] = readPage(left ? { ...input, html: null, problem: `Redirects out of this site, to ${answer.finalUrl}, so it isn't counted` } : input, robots);
    done++;
    onProgress?.({ phase: 'pages', done: done + 1, total: wanted.length + 1, current: item.url });
    await pause(gap, signal);
  });
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  // Two addresses that end at the same page (/about and /about/) are one page.
  const counted = new Set([urlMatchKey(start)]);
  for (const page of results) {
    if (!page) continue;
    const key = urlMatchKey(page.finalUrl);
    if (counted.has(key)) continue;
    counted.add(key);
    pages.push(page);
  }

  onProgress?.({ phase: 'extras', done: 0, total: 1, current: `${origin}/llms.txt` });
  // llms.txt at the host root, else, on a shared host, in the site's folder,
  // which is that site's own root: its answer stands, a 404 or one the
  // browser couldn't read (that says nothing either way).
  const rootLlms = await fetchNoting(`${origin}/llms.txt`, 'text/markdown,text/plain,*/*;q=0.5', unread, signal, transport);
  let llms = rootLlms;
  let llmsState = fileState(rootLlms);
  if (llmsState !== 'there' && folder !== `${origin}/`) {
    llms = await fetchNoting(`${folder}llms.txt`, 'text/markdown,text/plain,*/*;q=0.5', unread, signal, transport);
    const folderState = fileState(llms);
    // Missing only when both answered 404 or 410: an llms.txt at the root would count too.
    llmsState = folderState === 'there' ? 'there' : folderState === 'gone' && llmsState === 'gone' ? 'gone' : 'unknown';
  }
  const llmsUnknown = llmsState === 'unknown';
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');

  const extras: SiteExtras = {
    robotsStatus: robotsAnswer.status,
    robotsText: robotsOk ? robotsAnswer.text : null,
    robotsInFolder,
    ...(robotsFolderUnknown ? { robotsFolderUnknown: true } : {}),
    llmsStatus: llmsUnknown ? null : llms.status,
    llmsText: llmsUnknown ? null : llms.text,
    sitemap: { url: sitemap.url, pages: sitemapUrls.length, problem: sitemap.problem, ...(sitemap.unknown ? { unknown: true } : {}), ...(sitemap.unreadable ? { unreadable: sitemap.unreadable } : {}) },
    homeHtml: home.text,
    https: start.startsWith('https://'),
    unread,
  };
  onProgress?.({ phase: 'done', done: 1, total: 1 });
  return buildRun({ id: newRunId(), siteId: site.id, startedAt, finishedAt: Date.now(), mode: 'live', root: folder, pages, leftOut, extras, note, site: site.url });
}

function toInput(answer: Fetched, label: string, foundBy: PageReport['foundBy'], asked: string): PageInput {
  const html = answer.text !== null && answer.status !== null && answer.status < 400 && isHtml(answer) ? answer.text : null;
  const problem =
    answer.problem === 'blocked'
      ? "Your browser couldn't read this page, so it isn't counted. The desktop app can read it"
      : problemWords(answer) ?? (answer.text !== null && answer.status !== null && answer.status < 400 && !isHtml(answer) ? 'Not a web page' : undefined);
  return {
    url: asked,
    finalUrl: answer.finalUrl,
    redirects: answer.redirects,
    status: answer.status,
    problem,
    label,
    foundBy,
    html,
    headers: answer.status === null ? null : answer.headers,
    bytes: answer.bytes,
  };
}

// --- The Website view's pages, before they are published ------------------

const PAGE_WORDS: Record<SitePage, string> = { home: 'Home page', support: 'Support page', privacy: 'Privacy policy' };
/** Stands in for the site's address until the first publish, so canonical links and languages are still drawn. */
export const DRAFT_ADDRESS = 'https://your-site.example/';
const SHOT_WIDTH = 760;

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Check the pages the Website view would publish for a project. Null when
 * the project has no website yet. Nothing is fetched and no screenshot is
 * taken: the screenshots are stood in by their size and caption.
 */
export async function checkDraftSite(site: SeoSite, artboards: ArtboardState[]): Promise<SiteRun | null> {
  if (!site.projectId) return null;
  await flushWebsiteSaves();
  const row = await readSiteRow(site.projectId);
  if (!row) return null;
  const { draft } = row;
  const startedAt = Date.now();
  const siteUrl = draft.publish?.url ?? DRAFT_ADDRESS;
  const known = projectTranslations(artboards, draft.languages);
  const shotsFor = (locale: string): ShotRef[] => {
    if (!draft.options.screenshots) return [];
    return siteBoards(projectArtboards(artboards, locale === draft.baseLocale ? null : locale)).map((board) => {
      const caption = captionOf(board);
      return {
        path: `assets/shots/${board.id}.jpg`,
        width: SHOT_WIDTH,
        height: Math.round((SHOT_WIDTH * board.size.height) / Math.max(1, board.size.width)),
        caption: [caption.title, caption.body].filter(Boolean).join('. '),
      };
    });
  };
  const files = renderSiteFiles(draft, { shots: {}, siteUrl, known, build: 'seo-check', now: startedAt });
  const robotsText = files.find((file) => file.path === 'robots.txt')?.text ?? null;
  const sitemapText = files.find((file) => file.path === 'sitemap.xml')?.text ?? null;
  const robots = robotsText ? parseRobots(robotsText) : null;
  const pages: PageReport[] = [];
  let homeHtml: string | null = null;
  const many = draft.languages.length > 1;
  for (const locale of draft.languages) {
    for (const page of SITE_PAGES) {
      const html = renderPage(draft, page, locale, shotsFor(locale), { siteUrl, known, year: new Date(startedAt).getFullYear() });
      if (page === 'home' && locale === draft.baseLocale) homeHtml = html;
      const url = pageUrl(siteUrl, draft, locale, page);
      pages.push(readPage({ url, finalUrl: url, redirects: [], status: 200, label: many ? `${PAGE_WORDS[page]}, ${languageName(locale)}` : PAGE_WORDS[page], foundBy: 'draft', html, headers: null }, robots));
    }
  }
  const extras: SiteExtras = {
    robotsStatus: robotsText !== null ? 200 : 404,
    robotsText,
    robotsInFolder: false,
    llmsStatus: 404,
    llmsText: null,
    sitemap: { url: sitemapText ? `${siteUrl}sitemap.xml` : null, pages: sitemapText ? readSitemapBody(new TextEncoder().encode(sitemapText), 'application/xml', `${siteUrl}sitemap.xml`).entries.length : 0 },
    homeHtml,
    https: siteUrl.startsWith('https://'),
  };
  return buildRun({ id: newRunId(), siteId: site.id, startedAt, finishedAt: Date.now(), mode: 'draft', root: siteUrl, pages, leftOut: 0, extras, site: site.url });
}
