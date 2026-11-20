// From the pages a run read to the findings and the score. Pure: the run
// itself (fetching, the Website view's pages) lives in run.ts.

import {
  AI_AGENTS,
  analyseMetadataPairs,
  analyseText,
  auditRobots,
  isAllowed,
  lighthouseLlmsTxt,
  parseHtml,
  parseRobots,
  runPageChecks,
  selectGroup,
  serverRendered,
  visibleText,
  SEVERITY_ORDER,
  type HeaderMap,
  type LlmsVerdict,
  type RobotsAudit,
  type Severity,
} from './checks';
import { plainFinding, severityOf } from './plain';
import { AREA_WEIGHTS, type AgentPages, type CheckArea, type PageReport, type SiteFinding, type SiteRun, type SiteScore } from './types';

/** What a run knows about one page before the checks: the answer, or the Website view's file. */
export interface PageInput {
  url: string;
  finalUrl: string;
  redirects: string[];
  status: number | null;
  problem?: string;
  label: string;
  foundBy: PageReport['foundBy'];
  html: string | null;
  headers: HeaderMap | null;
  bytes?: number;
}

/** The copy check needs real sentences: shorter text says nothing about how it was written. */
const COPY_MIN_WORDS = 80;
const EXCERPT_CHARS = 2500;

export function readPage(input: PageInput, robots: ReturnType<typeof parseRobots> | null): PageReport {
  const googleAllowed = robots ? isAllowed(selectGroup(robots, 'Googlebot').rules, pathOf(input.finalUrl)) : true;
  const report: PageReport = {
    url: input.url,
    finalUrl: input.finalUrl,
    redirects: input.redirects,
    status: input.status,
    problem: input.problem,
    label: input.label,
    googleAllowed,
    foundBy: input.foundBy,
  };
  if (input.html === null) return report;
  report.checks = runPageChecks(input.html, input.finalUrl, input.headers, input.bytes);
  const words = visibleText(parseHtml(input.html));
  report.excerpt = words.slice(0, EXCERPT_CHARS);
  if (words.split(/\s+/).filter(Boolean).length >= COPY_MIN_WORDS) report.copy = analyseText(words);
  return report;
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/';
  }
}

export interface SiteExtras {
  robotsStatus: number | null;
  robotsText: string | null;
  /** A robots.txt found in the site's folder when the host root has none (a GitHub Pages project site). */
  robotsInFolder: boolean;
  /** The host root has no robots.txt, and the folder's couldn't be read. */
  robotsFolderUnknown?: boolean;
  llmsStatus: number | null;
  llmsText: string | null;
  sitemap: SiteRun['sitemap'];
  homeHtml: string | null;
  /** Whether the site's address is https. */
  https: boolean;
  /** Addresses a browser couldn't read (run.ts, fetchNoting). */
  unread?: string[];
}

const COPY_FLAGS: Record<string, string> = {
  filler: 'copy-filler',
  'ai-patterns': 'copy-ai-phrasing',
  repetitive: 'copy-repetitive',
  'low-density': 'copy-low-density',
};

const APP_TYPES = /"@type"\s*:\s*"(MobileApplication|SoftwareApplication|WebApplication|VideoGame)"/;

/**
 * Each AI crawler and agent against the pages read: robots.txt for the
 * site's home page (its folder, on a shared host) and for each page, not for
 * "/" alone. Null when robots.txt couldn't be read: nothing is known then.
 */
export function agentPages(robots: RobotsAudit, robotsText: string | null, pages: PageReport[], root: string): AgentPages[] | null {
  if (robots.reachable === 'failed' || robots.reachable === 'rate-limited') return null;
  const read = pages.filter((page) => page.checks);
  if (robots.reachable !== 'yes') {
    // No file lets everyone in; a server error tells crawlers the whole site is closed.
    const closed = robots.reachable === 'server-error';
    return AI_AGENTS.map((agent) => ({ token: agent.token, homeAllowed: !closed, blocked: closed ? read.map((page) => page.label) : [] }));
  }
  const parsed = parseRobots(robotsText ?? '');
  return AI_AGENTS.map((agent) => {
    const rules = selectGroup(parsed, agent.token).rules;
    return {
      token: agent.token,
      homeAllowed: isAllowed(rules, pathOf(root)),
      blocked: read.filter((page) => !isAllowed(rules, pathOf(page.finalUrl))).map((page) => page.label),
    };
  });
}

/** Whether `url` is in the site at `root`: the same host, at or under its folder (run.ts, inFolder). */
function pageInRoot(url: string, root: string): boolean {
  try {
    const page = new URL(url);
    const base = new URL(root);
    return page.host === base.host && page.pathname.startsWith(base.pathname);
  } catch {
    return false;
  }
}

/**
 * Lighthouse's verdict for an llms.txt the check couldn't read (no answer,
 * a browser block, a server error): "fetch failed". Nothing is known then,
 * so the screens and the AI say so instead of "has mistakes".
 */
export function llmsUnread(verdict: LlmsVerdict): boolean {
  return verdict.lighthouse === 'fail' && verdict.errors.length === 1 && verdict.errors[0] === 'fetch failed';
}

/** Every finding of a run: the page checks joined across pages, then the site's own checks. */
export function siteFindings(
  pages: PageReport[],
  extras: SiteExtras,
  robots: RobotsAudit,
  llms: LlmsVerdict,
  rendered: SiteRun['rendered'],
  access: AgentPages[] | null = null,
  root: string | null = null
): SiteFinding[] {
  const byId = new Map<string, SiteFinding>();
  const add = (id: string, page: { url: string; label: string } | null, evidence: string, count?: number) => {
    let finding = byId.get(id);
    if (!finding) {
      finding = { id, severity: severityOf(id), area: plainFinding(id).area, pages: [] };
      byId.set(id, finding);
    }
    finding.pages.push({ url: page?.url ?? '', label: page?.label ?? '', evidence, count });
  };

  for (const page of pages) {
    // A page that redirects out of the site isn't counted: what it ends at is another site's.
    if (root && !pageInRoot(page.finalUrl, root)) continue;
    const where = { url: page.finalUrl, label: page.label };
    if (page.status !== null && page.status >= 400) add('page-broken', where, `HTTP ${page.status}`);
    if (page.redirects.length > 2) add('redirect-chain', where, page.redirects.join(' > '), page.redirects.length - 1);
    if (!page.googleAllowed) add('blocked-for-google', where, 'robots.txt disallows Googlebot here');
    for (const finding of page.checks?.findings ?? []) add(finding.id, where, finding.evidence, finding.count);
    if (page.copy && !page.copy.coverage) {
      for (const flag of page.copy.flags) {
        const id = COPY_FLAGS[flag];
        if (!id) continue;
        const hits = [...page.copy.matches.filler, ...page.copy.matches.ai_patterns];
        add(id, where, hits.length && (flag === 'filler' || flag === 'ai-patterns') ? hits.slice(0, 4).map((hit) => `"${hit}"`).join(', ') : `${page.copy.tokens} words`);
      }
    }
  }

  // The same title or description on several pages of one language.
  const groups = (pick: (page: PageReport) => string) => {
    const seen = new Map<string, PageReport[]>();
    for (const page of pages) {
      const value = pick(page).trim().toLowerCase();
      if (!value) continue;
      const key = `${page.checks?.facts.lang ?? ''}|${value}`;
      seen.set(key, [...(seen.get(key) ?? []), page]);
    }
    return [...seen.values()].filter((list) => list.length > 1);
  };
  for (const list of groups((page) => page.checks?.facts.title ?? '')) {
    for (const page of list) add('duplicate-title', { url: page.finalUrl, label: page.label }, page.checks?.facts.title ?? '', list.length);
  }
  for (const list of groups((page) => page.checks?.facts.meta_description ?? '')) {
    for (const page of list) add('duplicate-description', { url: page.finalUrl, label: page.label }, page.checks?.facts.meta_description ?? '', list.length);
  }

  if (!extras.https) add('not-https', null, 'the site is served over http://');
  if (robots.reachable === 'server-error') add('robots-server-error', null, `robots.txt answered HTTP ${robots.status}`);
  else if (robots.reachable === 'missing') {
    if (extras.robotsInFolder) add('robots-in-folder', null, `robots.txt answered HTTP ${robots.status} at the root, and the site's folder has one`);
    // Only a 404 or a 410 means there's no file; robots.txt that answers 401 or 403 is one Google can't read.
    else if (!extras.robotsFolderUnknown && (robots.status === 404 || robots.status === 410)) add('no-robots-txt', null, `robots.txt answered HTTP ${robots.status}`);
  }
  // A file in a sitemap's place that can't be read is a broken sitemap, never a missing one.
  if (!extras.sitemap.url && extras.sitemap.unreadable) add('sitemap-unreadable', null, extras.sitemap.problem ?? extras.sitemap.unreadable.url);
  else if (!extras.sitemap.url && !extras.sitemap.pages && !extras.sitemap.unknown) add('no-sitemap', null, extras.sitemap.problem ?? 'no sitemap.xml found');
  // An AI search crawler kept from the site's own home page, which on a
  // shared host is its folder rather than "/".
  const searchTokens = new Set(AI_AGENTS.filter((agent) => agent.role === 'search').map((agent) => agent.token));
  const searchBlocked = access
    ? access.filter((entry) => searchTokens.has(entry.token) && !entry.homeAllowed).map((entry) => entry.token)
    : robots.aiGroups.searchCrawlersBlockedAtRoot;
  if (searchBlocked.length) add('ai-search-blocked', null, searchBlocked.join(', '));
  // A browser that couldn't read llms.txt knows nothing about it (llmsStatus null).
  if (extras.llmsStatus !== null) {
    if (llms.lighthouse === 'not-applicable') add('no-llms-txt', null, llms.notes[0] ?? 'no /llms.txt');
    else if (llms.lighthouse === 'fail') add('llms-txt-invalid', null, llms.errors.join('; '));
  }
  if (rendered?.status === 'fail') add('not-server-rendered', null, `${rendered.words} words without JavaScript`);
  // A plain page with few words is thin, which thin-content says already.
  // This one is for pages that load scripts, which may be filling them in.
  else if (rendered?.status === 'warn' && extras.homeHtml && /<script[^>]+\bsrc\s*=/i.test(extras.homeHtml)) add('thin-without-javascript', null, `${rendered.words} words without JavaScript`);

  const metadata = analyseMetadataPairs(pages.filter((page) => page.checks).map((page) => ({ url: page.finalUrl, title: page.checks?.facts.title, description: page.checks?.facts.meta_description })));
  if (metadata.site_risk !== 'low') {
    for (const page of metadata.pages.filter((entry) => entry.templated)) {
      const report = pages.find((entry) => entry.finalUrl === page.url);
      add('templated-metadata', { url: page.url ?? '', label: report?.label ?? '' }, page.cta_phrase ? `ends with "${page.cta_phrase}"` : 'repeats the title');
    }
  }

  const home = pages.find((page) => page.foundBy === 'start' || (page.foundBy === 'draft' && /^Home/.test(page.label)));
  if (home?.checks && extras.homeHtml) {
    const appBlock = APP_TYPES.exec(extras.homeHtml);
    if (!home.checks.facts.jsonld_blocks) add('no-structured-data', { url: home.finalUrl, label: home.label }, 'no JSON-LD on the home page');
    else if (appBlock && (!/"offers"\s*:/.test(extras.homeHtml) || !/"applicationCategory"\s*:/.test(extras.homeHtml))) {
      const missing = [!/"offers"\s*:/.test(extras.homeHtml) && 'offers (price)', !/"applicationCategory"\s*:/.test(extras.homeHtml) && 'applicationCategory'].filter(Boolean).join(' and ');
      add('app-details-incomplete', { url: home.finalUrl, label: home.label }, `${appBlock[1]} has no ${missing}`);
    }
  }

  return [...byId.values()].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.pages.length - a.pages.length);
}

const PENALTY: Record<Severity, number> = { Critical: 40, High: 20, Medium: 8, Low: 3 };

/**
 * The score, by claude-seo's area weights. Each finding costs its area points
 * by severity, the full amount when every page has it and half when one page
 * of many does. Speed counts only once PageSpeed has run.
 */
export function scoreFindings(findings: SiteFinding[], pagesRead: number, speed: number | null = null): SiteScore {
  const penalty: Record<CheckArea, number> = { technical: 0, content: 0, onpage: 0, schema: 0, speed: 0, ai: 0, images: 0 };
  for (const finding of findings) {
    const onPages = new Set(finding.pages.map((page) => page.url).filter(Boolean)).size;
    const share = onPages === 0 || pagesRead === 0 ? 1 : Math.min(1, onPages / pagesRead);
    penalty[finding.area] += PENALTY[finding.severity] * (0.5 + 0.5 * share);
  }
  const areas = {} as Record<CheckArea, number | null>;
  for (const area of Object.keys(AREA_WEIGHTS) as CheckArea[]) {
    areas[area] = area === 'speed' ? speed : pagesRead ? Math.max(0, Math.round(100 - penalty[area])) : null;
  }
  return { overall: overallScore(areas), areas };
}

export function overallScore(areas: Record<CheckArea, number | null>): number {
  let total = 0;
  let weight = 0;
  for (const [area, score] of Object.entries(areas) as Array<[CheckArea, number | null]>) {
    if (score === null) continue;
    total += score * AREA_WEIGHTS[area];
    weight += AREA_WEIGHTS[area];
  }
  return weight ? Math.round(total / weight) : 0;
}

/** Build the run from what was read. */
export function buildRun(input: {
  id: string;
  siteId: string;
  startedAt: number;
  finishedAt: number;
  mode: SiteRun['mode'];
  root: string;
  pages: PageReport[];
  leftOut: number;
  extras: SiteExtras;
  note?: string;
  /** The site's address the check started from (SiteRun.site). */
  site?: string;
}): SiteRun {
  const robots = auditRobots(input.extras.robotsStatus, input.extras.robotsText);
  const llms = lighthouseLlmsTxt(input.extras.llmsStatus, input.extras.llmsText);
  const rendered = input.extras.homeHtml !== null && input.mode === 'live' ? serverRendered(input.extras.homeHtml) : null;
  const aiAccess = agentPages(robots, input.extras.robotsText, input.pages, input.root);
  const findings = siteFindings(input.pages, input.extras, robots, llms, rendered, aiAccess, input.root);
  const pagesRead = input.pages.filter((page) => page.checks).length;
  const metadata = analyseMetadataPairs(input.pages.filter((page) => page.checks).map((page) => ({ url: page.finalUrl, title: page.checks?.facts.title, description: page.checks?.facts.meta_description })));
  return {
    id: input.id,
    siteId: input.siteId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    mode: input.mode,
    root: input.root,
    pages: input.pages,
    leftOut: input.leftOut,
    robots,
    robotsText: input.extras.robotsText,
    llms,
    llmsText: input.extras.llmsText,
    sitemap: input.extras.sitemap,
    rendered,
    metadata,
    findings,
    score: scoreFindings(findings, pagesRead),
    aiAccess,
    ...(input.extras.unread?.length ? { unread: [...new Set(input.extras.unread)] } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.site ? { site: input.site } : {}),
  };
}

/** Links worth following from a page: same host, a page and not a file, no fragment. */
export function pageLinks(links: string[], root: string): string[] {
  let host: string;
  try {
    host = new URL(root).host;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const link of links) {
    try {
      const parsed = new URL(link);
      if (parsed.host !== host) continue;
      if (/\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|dmg|apk|ipa|mp4|mov|mp3|css|js|json|xml|txt)$/i.test(parsed.pathname)) continue;
      parsed.hash = '';
      out.push(parsed.href);
    } catch {
      // not an address
    }
  }
  return out;
}
