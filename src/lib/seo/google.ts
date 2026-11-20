// Google's free numbers for a site: Search Console (how people find it in
// Google), Analytics (who visits), PageSpeed Insights (lab speed scores) and
// the Chrome UX Report (real visitors' Core Web Vitals).
//
// Search Console and Analytics read as the service account, with a token
// minted the way Growth mints one for Google Play (playAccessToken), so the
// same key works for both once its email is added to the property. The
// desktop app makes these calls; a web page cannot keep a private key safe.
// PageSpeed and the Chrome UX Report take an API key and answer any web page
// (both send the cross-site headers), so they work in the browser too.
// PageSpeed without a key answered 429 RESOURCE_EXHAUSTED, a daily quota of
// 0 for keyless callers (measured 2026-11-19), so Speed asks for the key.

import { bridgeFetch } from '@/lib/account/transport';
import { describeGoogleError, forgetPlayToken, playAccessToken } from '@/lib/publish/googlePlay';
import { disabledApiUrl } from '@/lib/growth/play';
import { isTauri } from '@/lib/desktop';
import type { ActiveKey } from './googleSettings';

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** Google says an API is turned off for the key's project, with the page that turns it on. */
export class GoogleApiOffError extends Error {
  constructor(readonly api: string, readonly activationUrl: string | null) {
    super(`The ${api} is turned off for this key's Google Cloud project. Turn it on, wait a minute and try again`);
  }
}

/** The service account can't see that property: its email isn't added there yet. */
export class GoogleAccessError extends Error {}

const API_NAMES: Array<[RegExp, string]> = [
  [/searchconsole\.googleapis\.com|\/webmasters\//, 'Google Search Console API'],
  [/analyticsadmin\.googleapis\.com/, 'Google Analytics Admin API'],
  [/analyticsdata\.googleapis\.com/, 'Google Analytics Data API'],
  [/pagespeedonline/, 'PageSpeed Insights API'],
  [/chromeuxreport\.googleapis\.com/, 'Chrome UX Report API'],
];

function apiName(url: string): string {
  return API_NAMES.find(([pattern]) => pattern.test(url))?.[1] ?? 'Google API';
}

async function http(url: string, init: RequestInit): Promise<Response> {
  const doFetch = isTauri() ? await bridgeFetch() : window.fetch.bind(window);
  return doFetch(url, init);
}

async function failFrom(url: string, response: Response): Promise<never> {
  const text = await response.text();
  const activation = disabledApiUrl(response.status, text);
  if (activation !== null) throw new GoogleApiOffError(apiName(url), activation || null);
  if (response.status === 403 || response.status === 404) {
    let reason = '';
    try {
      reason = (JSON.parse(text) as { error?: { status?: string } }).error?.status ?? '';
    } catch {
      // not JSON
    }
    if (reason === 'PERMISSION_DENIED' || response.status === 403) throw new GoogleAccessError(describeGoogleError(response.status, text));
  }
  throw new Error(describeGoogleError(response.status, text));
}

/** A JSON call as the service account, with one more try after a 401 on a fresh token. */
async function asServiceAccount<T>(key: ActiveKey, scope: string, url: string, init: RequestInit = {}): Promise<T> {
  const credentials = { serviceAccountJson: key.json, packageName: '' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await playAccessToken(credentials, scope);
    const response = await http(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (response.status === 401 && attempt === 0) {
      forgetPlayToken(credentials);
      continue;
    }
    if (!response.ok) return failFrom(url, response);
    return (await response.json()) as T;
  }
  throw new Error('Google refused the key twice');
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The window both Google reports cover: the 28 days up to yesterday, and the 28 before for comparison. */
export function reportWindow(now = new Date(), days = 28): { start: string; end: string; previousStart: string; previousEnd: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const previousEnd = new Date(start.getTime() - 86_400_000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86_400_000);
  return { start: isoDay(start), end: isoDay(end), previousStart: isoDay(previousStart), previousEnd: isoDay(previousEnd) };
}

// --- Search Console ---------------------------------------------------------

export interface SearchConsoleSite {
  siteUrl: string;
  permissionLevel: string;
}

export async function listSearchConsoleSites(key: ActiveKey): Promise<SearchConsoleSite[]> {
  const body = await asServiceAccount<{ siteEntry?: SearchConsoleSite[] }>(key, SEARCH_CONSOLE_SCOPE, 'https://www.googleapis.com/webmasters/v3/sites');
  return (body.siteEntry ?? []).filter((entry) => entry.permissionLevel !== 'siteUnverifiedUser');
}

/** The property that covers a site: its domain property first, else the longest URL prefix it starts with. */
export function propertyFor(siteUrl: string, sites: SearchConsoleSite[]): string | null {
  let host: string;
  try {
    host = new URL(siteUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const domain = sites
    .map((entry) => entry.siteUrl)
    .filter((property) => property.startsWith('sc-domain:'))
    .find((property) => {
      const name = property.slice('sc-domain:'.length).toLowerCase();
      return host === name || host.endsWith(`.${name}`);
    });
  if (domain) return domain;
  const prefixes = sites.map((entry) => entry.siteUrl).filter((property) => /^https?:\/\//.test(property) && siteUrl.startsWith(property));
  return prefixes.sort((a, b) => b.length - a.length)[0] ?? null;
}

export interface SearchRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchConsoleReport {
  property: string;
  window: ReturnType<typeof reportWindow>;
  totals: SearchTotals;
  previous: SearchTotals;
  days: Array<{ date: string } & SearchTotals>;
  queries: SearchRow[];
  pages: SearchRow[];
  fetchedAt: number;
}

const NO_TOTALS: SearchTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

async function searchQuery(key: ActiveKey, property: string, body: Record<string, unknown>): Promise<SearchRow[]> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const answer = await asServiceAccount<{ rows?: SearchRow[] }>(key, SEARCH_CONSOLE_SCOPE, url, { method: 'POST', body: JSON.stringify(body) });
  return answer.rows ?? [];
}

export async function searchConsoleReport(key: ActiveKey, property: string, now = new Date()): Promise<SearchConsoleReport> {
  const window = reportWindow(now);
  const range = { startDate: window.start, endDate: window.end, dataState: 'all' };
  const [totals, previous, days, queries, pages] = await Promise.all([
    searchQuery(key, property, { ...range }),
    searchQuery(key, property, { startDate: window.previousStart, endDate: window.previousEnd, dataState: 'all' }),
    searchQuery(key, property, { ...range, dimensions: ['date'], rowLimit: 100 }),
    searchQuery(key, property, { ...range, dimensions: ['query'], rowLimit: 50 }),
    searchQuery(key, property, { ...range, dimensions: ['page'], rowLimit: 25 }),
  ]);
  const toTotals = (rows: SearchRow[]): SearchTotals => (rows[0] ? { clicks: rows[0].clicks, impressions: rows[0].impressions, ctr: rows[0].ctr, position: rows[0].position } : NO_TOTALS);
  return {
    property,
    window,
    totals: toTotals(totals),
    previous: toTotals(previous),
    days: days.map((row) => ({ date: row.keys[0], clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })).sort((a, b) => a.date.localeCompare(b.date)),
    queries,
    pages,
    fetchedAt: Date.now(),
  };
}

/** Searches the site shows up for but rarely gets clicked from: on page one's edge, with people seeing it. */
export function closeToPageOne(queries: SearchRow[]): SearchRow[] {
  return queries.filter((row) => row.position > 7 && row.position <= 20 && row.impressions >= 10).sort((a, b) => b.impressions - a.impressions).slice(0, 8);
}

export interface Inspection {
  url: string;
  verdict: string;
  coverageState: string;
  indexingState?: string;
  robotsTxtState?: string;
  pageFetchState?: string;
  lastCrawlTime?: string;
  googleCanonical?: string;
  userCanonical?: string;
  inspectedAt: number;
}

/** Ask Google whether a page is in its index, and if not, why. */
export async function inspectUrl(key: ActiveKey, property: string, url: string): Promise<Inspection> {
  const body = await asServiceAccount<{ inspectionResult?: { indexStatusResult?: Record<string, string> } }>(
    key,
    SEARCH_CONSOLE_SCOPE,
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    { method: 'POST', body: JSON.stringify({ inspectionUrl: url, siteUrl: property, languageCode: 'en-US' }) },
  );
  const status = body.inspectionResult?.indexStatusResult ?? {};
  return {
    url,
    verdict: status.verdict ?? 'VERDICT_UNSPECIFIED',
    coverageState: status.coverageState ?? '',
    indexingState: status.indexingState,
    robotsTxtState: status.robotsTxtState,
    pageFetchState: status.pageFetchState,
    lastCrawlTime: status.lastCrawlTime,
    googleCanonical: status.googleCanonical,
    userCanonical: status.userCanonical,
    inspectedAt: Date.now(),
  };
}

// --- Analytics --------------------------------------------------------------

export interface AnalyticsProperty {
  property: string;
  name: string;
  account: string;
}

export async function listAnalyticsProperties(key: ActiveKey): Promise<AnalyticsProperty[]> {
  const body = await asServiceAccount<{ accountSummaries?: Array<{ displayName?: string; propertySummaries?: Array<{ property?: string; displayName?: string }> }> }>(
    key,
    ANALYTICS_SCOPE,
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
  );
  const out: AnalyticsProperty[] = [];
  for (const account of body.accountSummaries ?? []) {
    for (const summary of account.propertySummaries ?? []) {
      if (summary.property) out.push({ property: summary.property, name: summary.displayName ?? summary.property, account: account.displayName ?? '' });
    }
  }
  return out;
}

export interface AnalyticsReport {
  property: string;
  window: ReturnType<typeof reportWindow>;
  totals: { users: number; sessions: number; engaged: number; views: number };
  previous: { users: number; sessions: number; engaged: number; views: number };
  days: Array<{ date: string; users: number; sessions: number }>;
  channels: Array<{ channel: string; sessions: number }>;
  pages: Array<{ path: string; views: number; users: number }>;
  fetchedAt: number;
}

interface GaReport {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
}

const number = (value: string | undefined) => Number(value ?? 0) || 0;

export async function analyticsReport(key: ActiveKey, property: string, now = new Date()): Promise<AnalyticsReport> {
  const window = reportWindow(now);
  const range = [{ startDate: window.start, endDate: window.end }];
  const metrics = [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'engagedSessions' }, { name: 'screenPageViews' }];
  const body = await asServiceAccount<{ reports?: GaReport[] }>(key, ANALYTICS_SCOPE, `https://analyticsdata.googleapis.com/v1beta/${property}:batchRunReports`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { dateRanges: range, metrics },
        { dateRanges: [{ startDate: window.previousStart, endDate: window.previousEnd }], metrics },
        { dateRanges: range, dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }], orderBys: [{ dimension: { dimensionName: 'date' } }] },
        { dateRanges: range, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 },
        { dateRanges: range, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 10 },
      ],
    }),
  });
  const [totals, previous, days, channels, pages] = body.reports ?? [];
  const sum = (report?: GaReport) => {
    const values = report?.rows?.[0]?.metricValues ?? [];
    return { users: number(values[0]?.value), sessions: number(values[1]?.value), engaged: number(values[2]?.value), views: number(values[3]?.value) };
  };
  const dateOf = (value = '') => (/^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value);
  return {
    property,
    window,
    totals: sum(totals),
    previous: sum(previous),
    days: (days?.rows ?? []).map((row) => ({ date: dateOf(row.dimensionValues?.[0]?.value), users: number(row.metricValues?.[0]?.value), sessions: number(row.metricValues?.[1]?.value) })),
    channels: (channels?.rows ?? []).map((row) => ({ channel: row.dimensionValues?.[0]?.value ?? '', sessions: number(row.metricValues?.[0]?.value) })),
    pages: (pages?.rows ?? []).map((row) => ({ path: row.dimensionValues?.[0]?.value ?? '', views: number(row.metricValues?.[0]?.value), users: number(row.metricValues?.[1]?.value) })),
    fetchedAt: Date.now(),
  };
}

// --- PageSpeed Insights and the Chrome UX Report ------------------------------

export type Strategy = 'mobile' | 'desktop';
export type Rating = 'good' | 'okay' | 'poor';

/** Google's Core Web Vitals lines (web.dev): good up to the first number, poor past the second. */
export const VITALS = {
  lcp: { name: 'Largest Contentful Paint', short: 'Main picture shows', good: 2500, poor: 4000, unit: 'ms' },
  inp: { name: 'Interaction to Next Paint', short: 'Reacts to a tap', good: 200, poor: 500, unit: 'ms' },
  cls: { name: 'Cumulative Layout Shift', short: 'Page stays still', good: 0.1, poor: 0.25, unit: '' },
  fcp: { name: 'First Contentful Paint', short: 'Something shows', good: 1800, poor: 3000, unit: 'ms' },
  ttfb: { name: 'Time to First Byte', short: 'Server answers', good: 800, poor: 1800, unit: 'ms' },
} as const;

export type VitalId = keyof typeof VITALS;

export function rate(vital: VitalId, value: number): Rating {
  const spec = VITALS[vital];
  return value <= spec.good ? 'good' : value <= spec.poor ? 'okay' : 'poor';
}

export interface Opportunity {
  id: string;
  title: string;
  saving: string;
}

export interface PageSpeedResult {
  /** The address the test was asked for. */
  url: string;
  /**
   * Where PageSpeed says the test ended, after any redirects: the page these
   * numbers are about. Missing from results kept before it was read.
   */
  testedUrl?: string;
  /** Every address PageSpeed names as the page it tested, so a redirect to another site shows. */
  testedUrls?: string[];
  strategy: Strategy;
  scores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
  lab: Partial<Record<'lcp' | 'cls' | 'fcp' | 'tbt' | 'si', { value: number; display: string }>>;
  /** Real Chrome visitors' numbers for this page, or for the whole site when the page has too few. */
  field: { scope: 'page' | 'site'; metrics: Partial<Record<VitalId, number>> } | null;
  opportunities: Opportunity[];
  fetchedAt: number;
}

/** PageSpeed is busy or out of free turns for callers without a key. */
export class PageSpeedBusyError extends Error {}

const FIELD_KEYS: Record<string, VitalId> = {
  LARGEST_CONTENTFUL_PAINT_MS: 'lcp',
  INTERACTION_TO_NEXT_PAINT: 'inp',
  CUMULATIVE_LAYOUT_SHIFT_SCORE: 'cls',
  FIRST_CONTENTFUL_PAINT_MS: 'fcp',
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: 'ttfb',
};

interface PsiBody {
  /** The page tested, after redirects (PageSpeed's own words: "canonicalized and final URL"). */
  id?: string;
  lighthouseResult?: {
    requestedUrl?: string;
    finalUrl?: string;
    mainDocumentUrl?: string;
    finalDisplayedUrl?: string;
    categories?: Record<string, { score?: number | null }>;
    audits?: Record<string, { title?: string; score?: number | null; numericValue?: number; displayValue?: string; details?: { type?: string; overallSavingsMs?: number } }>;
  };
  loadingExperience?: { id?: string; origin_fallback?: boolean; metrics?: Record<string, { percentile?: number }> };
  originLoadingExperience?: { metrics?: Record<string, { percentile?: number }> };
}

export function readPageSpeed(url: string, strategy: Strategy, body: PsiBody): PageSpeedResult {
  const categories = body.lighthouseResult?.categories ?? {};
  const score = (id: string) => {
    const value = categories[id]?.score;
    return typeof value === 'number' ? Math.round(value * 100) : null;
  };
  const audits = body.lighthouseResult?.audits ?? {};
  const lab: PageSpeedResult['lab'] = {};
  const labIds = { lcp: 'largest-contentful-paint', cls: 'cumulative-layout-shift', fcp: 'first-contentful-paint', tbt: 'total-blocking-time', si: 'speed-index' } as const;
  for (const [key, id] of Object.entries(labIds) as Array<[keyof typeof labIds, string]>) {
    const audit = audits[id];
    if (typeof audit?.numericValue === 'number') lab[key] = { value: audit.numericValue, display: audit.displayValue ?? '' };
  }
  const fieldSource = body.loadingExperience?.metrics && !body.loadingExperience.origin_fallback ? { scope: 'page' as const, metrics: body.loadingExperience.metrics } : body.originLoadingExperience?.metrics ? { scope: 'site' as const, metrics: body.originLoadingExperience.metrics } : null;
  let field: PageSpeedResult['field'] = null;
  if (fieldSource) {
    const metrics: Partial<Record<VitalId, number>> = {};
    for (const [name, value] of Object.entries(fieldSource.metrics)) {
      const id = FIELD_KEYS[name];
      if (id && typeof value.percentile === 'number') metrics[id] = id === 'cls' ? value.percentile / 100 : value.percentile;
    }
    if (Object.keys(metrics).length) field = { scope: fieldSource.scope, metrics };
  }
  const opportunities = Object.entries(audits)
    .filter(([, audit]) => audit.details?.type === 'opportunity' && typeof audit.score === 'number' && audit.score < 0.9)
    .sort((a, b) => (b[1].details?.overallSavingsMs ?? 0) - (a[1].details?.overallSavingsMs ?? 0))
    .slice(0, 6)
    .map(([id, audit]) => ({ id, title: audit.title ?? id, saving: audit.displayValue ?? '' }));
  const lighthouse = body.lighthouseResult;
  const testedUrls = [...new Set([lighthouse?.finalDisplayedUrl, lighthouse?.mainDocumentUrl, lighthouse?.finalUrl, body.id].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))];
  return {
    url,
    testedUrl: testedUrls[0] ?? url,
    // Only what PageSpeed says it tested: an answer that names no page can't be placed on a site (state.ts, speedIsOfSite).
    testedUrls,
    strategy,
    scores: { performance: score('performance'), accessibility: score('accessibility'), bestPractices: score('best-practices'), seo: score('seo') },
    lab,
    field,
    opportunities,
    fetchedAt: Date.now(),
  };
}

export async function runPageSpeed(url: string, strategy: Strategy, apiKey: string | null, signal?: AbortSignal): Promise<PageSpeedResult> {
  const query = new URLSearchParams({ url, strategy: strategy.toUpperCase() });
  for (const category of ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO']) query.append('category', category);
  if (apiKey) query.set('key', apiKey);
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${query}`;
  const response = await http(endpoint, { signal });
  if (response.status === 429) throw new PageSpeedBusyError(apiKey ? 'PageSpeed has had too many requests from this key today. Try again tomorrow' : 'PageSpeed only answers with a Google API key. Add a free one under Setup');
  if (!response.ok) return failFrom(endpoint, response);
  return readPageSpeed(url, strategy, (await response.json()) as PsiBody);
}

export interface CruxHistory {
  origin: string;
  weeks: string[];
  series: Partial<Record<VitalId, Array<number | null>>>;
  fetchedAt: number;
}

const CRUX_METRICS: Record<string, VitalId> = {
  largest_contentful_paint: 'lcp',
  interaction_to_next_paint: 'inp',
  cumulative_layout_shift: 'cls',
  first_contentful_paint: 'fcp',
  experimental_time_to_first_byte: 'ttfb',
};

/** The site's real-visitor numbers week by week, or null when Chrome has too few visitors to report. */
export async function cruxHistory(origin: string, apiKey: string, signal?: AbortSignal): Promise<CruxHistory | null> {
  const endpoint = 'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord';
  const response = await http(endpoint, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({ origin, formFactor: 'PHONE', metrics: Object.keys(CRUX_METRICS) }),
  });
  if (response.status === 404) return null;
  if (!response.ok) return failFrom(endpoint, response);
  const body = (await response.json()) as {
    record?: {
      collectionPeriods?: Array<{ lastDate?: { year: number; month: number; day: number } }>;
      metrics?: Record<string, { percentilesTimeseries?: { p75s?: Array<number | string | null> } }>;
    };
  };
  const weeks = (body.record?.collectionPeriods ?? []).map((period) => {
    const date = period.lastDate;
    return date ? `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}` : '';
  });
  const series: CruxHistory['series'] = {};
  for (const [name, metric] of Object.entries(body.record?.metrics ?? {})) {
    const id = CRUX_METRICS[name];
    if (!id) continue;
    series[id] = (metric.percentilesTimeseries?.p75s ?? []).map((value) => (value === null || value === undefined ? null : Number(value)));
  }
  return { origin, weeks, series, fetchedAt: Date.now() };
}
