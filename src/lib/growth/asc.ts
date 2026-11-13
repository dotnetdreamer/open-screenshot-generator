// App Store Connect, read (and in two places written) for the growth feature.
//
// Same key, same token cache and same transport as the screenshot upload
// (src/lib/publish/appStoreConnect.ts): bridgeFetch goes out through Rust on
// desktop, because api.appstoreconnect.apple.com sends no CORS headers.
//
// The errors differ from the upload's on purpose. Upload needs one role and
// can say which; here every feed needs a different one (Sales and Trends wants
// Sales or Finance, analytics wants an Admin once to switch the reports on,
// replies want Customer Support or App Manager), so a 403 is reported per feed
// with the role that feed needs, and the other feeds carry on.

import { bearerToken, describeApiError, forgetAppStoreToken, noteAppleClock } from '@/lib/publish/appStoreConnect';
import type { AppStoreCredentials } from '@/lib/publish/types';
import { fetchWithStop, pause, retryAfter } from './http';
import { territoryCode } from './territories';
import type {
  GrowthApp,
  ListingLocale,
  ListingSnapshot,
  ReviewResponse,
  StoreReview,
} from './types';

const API_BASE = 'https://api.appstoreconnect.apple.com';

/** The key itself was refused: wrong issuer, wrong key id, revoked, or a damaged .p8. */
export class AscAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AscAuthError';
  }
}

/** The key works, but its role cannot do this. */
export class AscForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AscForbiddenError';
  }
}

export class AscNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AscNotFoundError';
  }
}

interface RequestInitLite {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * One request, with the two second chances App Store Connect needs. Under a
 * burst of requests (a year of Sales and Trends, four days at a time) it now
 * and then answers a valid key with a 401, or with a 500: seen live in
 * November 2026, once in a few hundred requests, and the same request a
 * moment later went through. So a 401 is tried once more with a freshly
 * minted token before it counts as a bad key, which would stop the whole
 * feed, and a 429 or 5xx is tried once more after a pause, for reads only:
 * a reply or a listing change that hit a server error may have gone through.
 */
async function send(
  credentials: AppStoreCredentials,
  path: string,
  init: RequestInitLite & { accept?: string } = {}
): Promise<Response> {
  const method = init.method ?? 'GET';
  const attempt = async () => {
    const answer = await fetchWithStop(
      path.startsWith('http') ? path : `${API_BASE}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${await bearerToken(credentials)}`,
          ...(init.accept ? { Accept: init.accept } : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      },
      init.signal
    );
    // A 401 here can be this computer's clock: the retry below dates its new
    // token by the clock this answer shows (appStoreConnect.ts).
    noteAppleClock(answer);
    return answer;
  };
  const response = await attempt();
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    forgetAppStoreToken(credentials);
    await pause(1500, init.signal);
    return attempt();
  }
  if (method === 'GET' && (response.status === 429 || response.status >= 500)) {
    const wait = retryAfter(response, response.status === 429 ? 5000 : 2000);
    await response.body?.cancel().catch(() => undefined);
    await pause(wait, init.signal);
    return attempt();
  }
  return response;
}

async function fail(response: Response): Promise<never> {
  const text = await response.text().catch(() => '');
  const message = describeApiError(response.status, text);
  if (response.status === 401) {
    throw new AscAuthError(`${message}. Check the Issuer ID, Key ID and private key under Setup`);
  }
  if (response.status === 403) throw new AscForbiddenError(message);
  if (response.status === 404) throw new AscNotFoundError(message);
  throw new Error(message);
}

export async function ascJson<T>(credentials: AppStoreCredentials, path: string, init: RequestInitLite = {}): Promise<T> {
  const response = await send(credentials, path, init);
  if (!response.ok) await fail(response);
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

interface Resource<A> {
  id: string;
  type: string;
  attributes?: A;
  relationships?: Record<string, { data?: { id: string; type: string } | Array<{ id: string; type: string }> | null; meta?: { paging?: { total?: number } } }>;
}

interface Collection<A> {
  data: Resource<A>[];
  included?: Resource<Record<string, unknown>>[];
  links?: { next?: string };
}

/** Every page of a collection, up to `maxPages`, with `included` resources pooled. */
export async function ascCollect<A>(
  credentials: AppStoreCredentials,
  path: string,
  options: { maxPages?: number; signal?: AbortSignal; stop?: (page: Resource<A>[]) => boolean } = {}
): Promise<{ data: Resource<A>[]; included: Resource<Record<string, unknown>>[] }> {
  const data: Resource<A>[] = [];
  const included: Resource<Record<string, unknown>>[] = [];
  let next: string | undefined = path;
  for (let page = 0; next && page < (options.maxPages ?? 25); page += 1) {
    const body: Collection<A> = await ascJson<Collection<A>>(credentials, next, { signal: options.signal });
    data.push(...(body.data ?? []));
    included.push(...(body.included ?? []));
    if (options.stop?.(body.data ?? [])) break;
    next = body.links?.next;
  }
  return { data, included };
}

// --- apps --------------------------------------------------------------------

export interface AscApp extends GrowthApp {
  sku?: string;
  primaryLocale?: string;
}

export async function listApps(credentials: AppStoreCredentials, signal?: AbortSignal): Promise<AscApp[]> {
  const { data } = await ascCollect<{ name?: string; bundleId?: string; sku?: string; primaryLocale?: string }>(
    credentials,
    '/v1/apps?limit=200&fields[apps]=name,bundleId,sku,primaryLocale',
    { signal }
  );
  return data
    .map((row) => ({
      id: row.id,
      name: row.attributes?.name ?? row.id,
      bundleId: row.attributes?.bundleId ?? '',
      sku: row.attributes?.sku,
      primaryLocale: row.attributes?.primaryLocale,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- reviews -----------------------------------------------------------------

interface ReviewAttributes {
  rating?: number;
  title?: string;
  body?: string;
  reviewerNickname?: string;
  createdDate?: string;
  territory?: string;
}

function readResponse(resource: Resource<Record<string, unknown>> | undefined): ReviewResponse | undefined {
  if (!resource) return undefined;
  const attributes = resource.attributes ?? {};
  return {
    id: resource.id,
    body: String(attributes.responseBody ?? ''),
    lastModified: String(attributes.lastModifiedDate ?? ''),
    state: String(attributes.state ?? 'PUBLISHED'),
  };
}

/**
 * Written reviews, newest first, with the reply to each when there is one.
 * Stops at the first page that reaches reviews older than `since` (the newest
 * one already stored), so a routine refresh is one or two requests.
 */
export async function fetchReviews(
  credentials: AppStoreCredentials,
  appId: string,
  options: { since?: string; maxPages?: number; signal?: AbortSignal } = {}
): Promise<StoreReview[]> {
  const { data, included } = await ascCollect<ReviewAttributes>(
    credentials,
    `/v1/apps/${appId}/customerReviews?limit=200&sort=-createdDate&include=response`,
    {
      maxPages: options.maxPages ?? 10,
      signal: options.signal,
      stop: (page) =>
        !!options.since && page.some((row) => (row.attributes?.createdDate ?? '') < options.since!),
    }
  );
  const responses = new Map(
    included.filter((row) => row.type === 'customerReviewResponses').map((row) => [row.id, row])
  );
  return data.map((row) => {
    const attributes = row.attributes ?? {};
    const link = row.relationships?.response?.data;
    const responseId = link && !Array.isArray(link) ? link.id : undefined;
    return {
      id: row.id,
      appId,
      rating: Number(attributes.rating ?? 0),
      title: attributes.title ?? '',
      body: attributes.body ?? '',
      nickname: attributes.reviewerNickname ?? '',
      createdDate: attributes.createdDate ?? '',
      territory: territoryCode(attributes.territory),
      response: readResponse(responseId ? responses.get(responseId) : undefined),
    };
  });
}

/** Apple's limit on a reply, from the customerReviewResponses schema. */
export const MAX_REPLY_LENGTH = 5970;

/** Create a reply, or replace the one already there: the endpoint does both. */
export async function replyToReview(
  credentials: AppStoreCredentials,
  reviewId: string,
  body: string
): Promise<ReviewResponse> {
  const text = body.trim();
  if (!text) throw new Error('Write a reply first');
  if (Array.from(text).length > MAX_REPLY_LENGTH) {
    throw new Error(`A reply can have up to ${MAX_REPLY_LENGTH} characters`);
  }
  const created = await ascJson<{ data: Resource<Record<string, unknown>> }>(credentials, '/v1/customerReviewResponses', {
    method: 'POST',
    body: {
      data: {
        type: 'customerReviewResponses',
        attributes: { responseBody: text },
        relationships: { review: { data: { type: 'customerReviews', id: reviewId } } },
      },
    },
  });
  return readResponse(created.data) ?? { id: '', body: text, lastModified: new Date().toISOString(), state: 'PENDING_PUBLISH' };
}

export async function deleteReviewReply(credentials: AppStoreCredentials, responseId: string): Promise<void> {
  await ascJson(credentials, `/v1/customerReviewResponses/${responseId}`, { method: 'DELETE' });
}

// --- Sales and Trends ---------------------------------------------------------

export type SalesDayResult =
  | { kind: 'report'; bytes: Uint8Array }
  /** Apple has the day and there were no sales in it. */
  | { kind: 'empty' }
  /** Apple has not published the day yet. */
  | { kind: 'not-yet' };

/**
 * One day's SALES SUMMARY report. The body is a gzip file, not a
 * Content-Encoding, which is why this reads bytes. A 404 means either "no
 * sales that day" or "not published yet", and only the detail says which.
 */
export async function fetchSalesDay(
  credentials: AppStoreCredentials,
  vendorNumber: string,
  day: string,
  signal?: AbortSignal
): Promise<SalesDayResult> {
  const query = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportType]': 'SALES',
    'filter[reportSubType]': 'SUMMARY',
    'filter[vendorNumber]': vendorNumber.trim(),
    'filter[reportDate]': day,
    'filter[version]': '1_0',
  });
  const response = await send(credentials, `/v1/salesReports?${query.toString()}`, {
    accept: 'application/a-gzip',
    signal,
  });
  if (response.status === 404) {
    const text = await response.text().catch(() => '');
    return /not (yet )?available|not been published|try again later|is not ready/i.test(text)
      ? { kind: 'not-yet' }
      : { kind: 'empty' };
  }
  if (!response.ok) await fail(response);
  return { kind: 'report', bytes: new Uint8Array(await response.arrayBuffer()) };
}

// --- Analytics Reports --------------------------------------------------------

export interface ReportRequest {
  id: string;
  accessType: 'ONGOING' | 'ONE_TIME_SNAPSHOT' | string;
  stoppedDueToInactivity: boolean;
}

export async function listReportRequests(
  credentials: AppStoreCredentials,
  appId: string,
  signal?: AbortSignal
): Promise<ReportRequest[]> {
  const { data } = await ascCollect<{ accessType?: string; stoppedDueToInactivity?: boolean }>(
    credentials,
    `/v1/apps/${appId}/analyticsReportRequests?limit=200`,
    { signal }
  );
  return data.map((row) => ({
    id: row.id,
    accessType: row.attributes?.accessType ?? 'ONGOING',
    stoppedDueToInactivity: !!row.attributes?.stoppedDueToInactivity,
  }));
}

/** Ask Apple to start making reports. Needs an Admin key, once per app and access type. */
export async function createReportRequest(
  credentials: AppStoreCredentials,
  appId: string,
  accessType: 'ONGOING' | 'ONE_TIME_SNAPSHOT'
): Promise<ReportRequest> {
  const created = await ascJson<{ data: Resource<{ accessType?: string; stoppedDueToInactivity?: boolean }> }>(
    credentials,
    '/v1/analyticsReportRequests',
    {
      method: 'POST',
      body: {
        data: {
          type: 'analyticsReportRequests',
          attributes: { accessType },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      },
    }
  );
  return {
    id: created.data.id,
    accessType: created.data.attributes?.accessType ?? accessType,
    stoppedDueToInactivity: !!created.data.attributes?.stoppedDueToInactivity,
  };
}

export interface AnalyticsReportRef {
  id: string;
  name: string;
  category: string;
}

export async function listReports(
  credentials: AppStoreCredentials,
  requestId: string,
  signal?: AbortSignal
): Promise<AnalyticsReportRef[]> {
  const { data } = await ascCollect<{ name?: string; category?: string }>(
    credentials,
    `/v1/analyticsReportRequests/${requestId}/reports?limit=200`,
    { signal }
  );
  return data.map((row) => ({ id: row.id, name: row.attributes?.name ?? '', category: row.attributes?.category ?? '' }));
}

export interface ReportInstance {
  id: string;
  processingDate: string;
}

export async function listInstances(
  credentials: AppStoreCredentials,
  reportId: string,
  signal?: AbortSignal
): Promise<ReportInstance[]> {
  const { data } = await ascCollect<{ processingDate?: string; granularity?: string }>(
    credentials,
    `/v1/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=200`,
    { signal, maxPages: 10 }
  );
  return data
    .map((row) => ({ id: row.id, processingDate: row.attributes?.processingDate ?? '' }))
    .sort((a, b) => a.processingDate.localeCompare(b.processingDate));
}

export interface ReportSegment {
  id: string;
  url: string;
  sizeInBytes: number;
}

export async function listSegments(
  credentials: AppStoreCredentials,
  instanceId: string,
  signal?: AbortSignal
): Promise<ReportSegment[]> {
  const { data } = await ascCollect<{ url?: string; sizeInBytes?: number }>(
    credentials,
    `/v1/analyticsReportInstances/${instanceId}/segments?limit=200`,
    { signal }
  );
  return data
    .filter((row) => !!row.attributes?.url)
    .map((row) => ({ id: row.id, url: row.attributes!.url!, sizeInBytes: Number(row.attributes?.sizeInBytes ?? 0) }));
}

/**
 * A segment file. The URL is pre-signed storage that expires five minutes
 * after it was listed, and must NOT carry our bearer token: it has its own
 * signature, and sending Apple's token to a storage host would leak it.
 */
export async function downloadSegment(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetchWithStop(url, { method: 'GET' }, signal);
  if (!response.ok) {
    throw new Error(`Part of App Analytics could not be downloaded (HTTP ${response.status}). Refresh to try again`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// --- listing -------------------------------------------------------------------

/** Version states whose own text fields App Store Connect still lets you change. */
const EDITABLE_VERSION_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
  'READY_FOR_REVIEW',
]);

/** On the store now. A version approved and waiting for its release is not. */
const LIVE_VERSION_STATES = new Set(['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION']);

interface VersionAttributes {
  versionString?: string;
  appStoreState?: string;
  appVersionState?: string;
  platform?: string;
  createdDate?: string;
}

export interface VersionRef {
  id: string;
  versionString: string;
  state: string;
  platform: string;
  createdDate: string;
  editable: boolean;
  live: boolean;
}

export async function listVersions(credentials: AppStoreCredentials, appId: string, signal?: AbortSignal): Promise<VersionRef[]> {
  const { data } = await ascCollect<VersionAttributes>(credentials, `/v1/apps/${appId}/appStoreVersions?limit=50`, {
    signal,
    maxPages: 2,
  });
  return data
    .map((row) => {
      const state = row.attributes?.appStoreState ?? row.attributes?.appVersionState ?? 'UNKNOWN';
      return {
        id: row.id,
        versionString: row.attributes?.versionString ?? '',
        state,
        platform: row.attributes?.platform ?? 'IOS',
        createdDate: row.attributes?.createdDate ?? '',
        editable: EDITABLE_VERSION_STATES.has(state),
        live: LIVE_VERSION_STATES.has(state),
      };
    })
    .sort((a, b) => b.createdDate.localeCompare(a.createdDate));
}

interface VersionLocalizationAttributes {
  locale?: string;
  description?: string;
  keywords?: string;
  promotionalText?: string;
  whatsNew?: string;
}

interface AppInfoAttributes {
  appStoreState?: string;
  state?: string;
}

const EDITABLE_INFO_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'WAITING_FOR_REVIEW',
]);

async function screenshotCounts(
  credentials: AppStoreCredentials,
  localizationId: string,
  signal?: AbortSignal
): Promise<Record<string, number> | undefined> {
  try {
    const { data } = await ascCollect<{ screenshotDisplayType?: string }>(
      credentials,
      `/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=50&include=appScreenshots&limit[appScreenshots]=10`,
      { signal, maxPages: 1 }
    );
    const counts: Record<string, number> = {};
    for (const set of data) {
      const linked = set.relationships?.appScreenshots;
      const total = linked?.meta?.paging?.total ?? (Array.isArray(linked?.data) ? linked!.data!.length : 0);
      counts[set.attributes?.screenshotDisplayType ?? set.id] = Number(total ?? 0);
    }
    return counts;
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    // Counting is a nicety for one check; a listing without it is still a listing.
    return undefined;
  }
}

/**
 * The listing as the store shows it or will show it: the version being
 * prepared when there is one (that is what the user can still change), and the
 * live version otherwise, joined with the app info's name and subtitle.
 */
export async function fetchListing(
  credentials: AppStoreCredentials,
  app: Pick<AscApp, 'id' | 'primaryLocale'>,
  signal?: AbortSignal
): Promise<ListingSnapshot | null> {
  const versions = await listVersions(credentials, app.id, signal);
  // An app on iPhone and Mac lists both platforms' versions together, and the
  // Mac one can be the version in preparation while the iPhone one is live.
  // The iPhone listing is the one this editor's screenshots are for, so it
  // wins; an app with no iOS version falls back to whatever it has.
  const ios = versions.filter((entry) => entry.platform === 'IOS');
  const version =
    ios.find((entry) => entry.editable) ??
    ios.find((entry) => entry.live) ??
    ios[0] ??
    versions.find((entry) => entry.editable) ??
    versions.find((entry) => entry.live) ??
    versions[0];
  if (!version) return null;

  const [{ data: versionLocales }, { data: infos }] = await Promise.all([
    ascCollect<VersionLocalizationAttributes>(
      credentials,
      `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`,
      { signal }
    ),
    ascCollect<AppInfoAttributes>(credentials, `/v1/apps/${app.id}/appInfos?limit=10`, { signal }),
  ]);

  const infoState = (row: Resource<AppInfoAttributes>) => row.attributes?.state ?? row.attributes?.appStoreState ?? '';
  const info = infos.find((row) => EDITABLE_INFO_STATES.has(infoState(row))) ?? infos[0];
  const infoLocales = info
    ? (
        await ascCollect<{ locale?: string; name?: string; subtitle?: string }>(
          credentials,
          `/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`,
          { signal }
        )
      ).data
    : [];
  const infoByLocale = new Map(infoLocales.map((row) => [row.attributes?.locale ?? '', row]));

  const locales: ListingLocale[] = [];
  for (const row of versionLocales) {
    const locale = row.attributes?.locale ?? '';
    const infoRow = infoByLocale.get(locale);
    locales.push({
      locale,
      versionLocalizationId: row.id,
      appInfoLocalizationId: infoRow?.id,
      name: infoRow?.attributes?.name ?? '',
      subtitle: infoRow?.attributes?.subtitle ?? '',
      keywords: row.attributes?.keywords ?? '',
      promotionalText: row.attributes?.promotionalText ?? '',
      description: row.attributes?.description ?? '',
      whatsNew: row.attributes?.whatsNew ?? '',
      screenshotCounts: await screenshotCounts(credentials, row.id, signal),
    });
  }
  const primaryLocale = app.primaryLocale ?? locales[0]?.locale ?? 'en-US';
  locales.sort((a, b) => (a.locale === primaryLocale ? -1 : b.locale === primaryLocale ? 1 : a.locale.localeCompare(b.locale)));

  return {
    appId: app.id,
    versionId: version.id,
    versionString: version.versionString,
    state: version.state,
    platform: version.platform,
    editable: version.editable,
    appInfoEditable: info ? EDITABLE_INFO_STATES.has(infoState(info)) : false,
    primaryLocale,
    locales,
    fetchedAt: Date.now(),
  };
}

/**
 * Write approved changes. Name and subtitle go to the app info localization,
 * everything else to the version localization, one PATCH per language and
 * record. A record that refuses its edit becomes a warning naming the
 * language, and the others still go through. `applied` lists what Apple took,
 * as `locale:field`, so the caller can keep what it refused.
 */
export async function applyListingChanges(
  credentials: AppStoreCredentials,
  listing: ListingSnapshot,
  changes: Array<{ locale: string; field: string; after: string }>
): Promise<{ applied: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const applied: string[] = [];
  const took = (locale: string, fields: Record<string, string>) => {
    for (const field of Object.keys(fields)) applied.push(`${locale}:${field}`);
  };
  const byLocale = new Map<string, Record<string, string>>();
  for (const change of changes) {
    const fields = byLocale.get(change.locale) ?? {};
    fields[change.field] = change.after;
    byLocale.set(change.locale, fields);
  }
  for (const [locale, fields] of byLocale) {
    const target = listing.locales.find((entry) => entry.locale === locale);
    if (!target) {
      warnings.push(`${locale} is not a language of version ${listing.versionString}, so the changes were skipped.`);
      continue;
    }
    const infoFields = Object.fromEntries(Object.entries(fields).filter(([field]) => field === 'name' || field === 'subtitle'));
    const versionFields = Object.fromEntries(Object.entries(fields).filter(([field]) => field !== 'name' && field !== 'subtitle'));
    if (Object.keys(infoFields).length > 0) {
      if (!target.appInfoLocalizationId) {
        warnings.push(`${locale}: the name and subtitle were not found and were not changed.`);
      } else {
        try {
          await ascJson(credentials, `/v1/appInfoLocalizations/${target.appInfoLocalizationId}`, {
            method: 'PATCH',
            body: { data: { type: 'appInfoLocalizations', id: target.appInfoLocalizationId, attributes: infoFields } },
          });
          took(locale, infoFields);
        } catch (error) {
          if (error instanceof AscAuthError) throw error;
          warnings.push(`${locale}, name and subtitle: ${error instanceof Error ? error.message : 'Apple did not accept the changes'}`);
        }
      }
    }
    if (Object.keys(versionFields).length > 0) {
      if (!target.versionLocalizationId) {
        warnings.push(`${locale}: the language was not found in version ${listing.versionString}, so the changes were skipped.`);
      } else {
        try {
          await ascJson(credentials, `/v1/appStoreVersionLocalizations/${target.versionLocalizationId}`, {
            method: 'PATCH',
            body: { data: { type: 'appStoreVersionLocalizations', id: target.versionLocalizationId, attributes: versionFields } },
          });
          took(locale, versionFields);
        } catch (error) {
          if (error instanceof AscAuthError) throw error;
          warnings.push(`${locale}: ${error instanceof Error ? error.message : 'Apple did not accept the changes'}`);
        }
      }
    }
  }
  return { applied, warnings };
}

/**
 * Add a listing language to the version being prepared. The app info side
 * needs a name, so the new language starts with the primary language's name;
 * the user then translates it with the rest.
 */
export async function addListingLanguage(
  credentials: AppStoreCredentials,
  listing: ListingSnapshot,
  locale: string,
  appInfoId: string | null,
  name: string
): Promise<void> {
  await ascJson(credentials, '/v1/appStoreVersionLocalizations', {
    method: 'POST',
    body: {
      data: {
        type: 'appStoreVersionLocalizations',
        attributes: { locale },
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: listing.versionId } } },
      },
    },
  });
  if (appInfoId) {
    try {
      await ascJson(credentials, '/v1/appInfoLocalizations', {
        method: 'POST',
        body: {
          data: {
            type: 'appInfoLocalizations',
            attributes: { locale, name },
            relationships: { appInfo: { data: { type: 'appInfos', id: appInfoId } } },
          },
        },
      });
    } catch (error) {
      // 409 when the app info already has the language from an earlier version.
      if (!(error instanceof Error) || !/409|already exists/i.test(error.message)) throw error;
    }
  }
}

/** The app info record a new language hangs its name off, for addListingLanguage. */
export async function editableAppInfoId(credentials: AppStoreCredentials, appId: string): Promise<string | null> {
  const { data } = await ascCollect<AppInfoAttributes>(credentials, `/v1/apps/${appId}/appInfos?limit=10`);
  const state = (row: Resource<AppInfoAttributes>) => row.attributes?.state ?? row.attributes?.appStoreState ?? '';
  return (data.find((row) => EDITABLE_INFO_STATES.has(state(row))) ?? data[0])?.id ?? null;
}
