// App Store Connect: put screenshots on a version, from the editor.
//
// The shape of Apple's asset upload is unusual enough to be worth stating up
// front, because none of it is guessable:
//
//   1. Screenshots hang off an app screenshot SET, and a set is scoped to one
//      (version, locale, display type) triple. So a 1290x2796 PNG and a
//      2064x2752 PNG never share a set, and we create the sets we need.
//   2. Uploading is a three-step reservation. POST /v1/appScreenshots with the
//      file size and name returns `uploadOperations`: a list of chunk
//      instructions, each with its own method, URL, byte range and headers.
//      Those URLs point at Apple storage hosts, not at the API host.
//   3. The upload only counts once you PATCH the reservation with
//      `uploaded: true` and an MD5 of the exact bytes you sent.
//   4. Apple then processes the asset ASYNCHRONOUSLY. A wrong size does not
//      fail any of the calls above; it fails minutes later as
//      assetDeliveryState.state = FAILED, which is why we poll and report.
//
// Everything here is desktop only: api.appstoreconnect.apple.com sends no CORS
// headers, so bridgeFetch's Tauri branch (tauri-plugin-http, which goes out
// through Rust) is the only transport that can reach it.

import { bridgeFetch } from '@/lib/account/transport';
import { createAppStoreConnectJwt } from './jwt';
import { md5Hex } from './md5';
import { appleTargetForSize, nearestAppleSizes } from './storeTargets';
import {
  StoreAuthError,
  StoreRejectedError,
  type AppStoreCredentials,
  type PublishImage,
  type PublishProgressFn,
  type PublishResult,
} from './types';

const API_BASE = 'https://api.appstoreconnect.apple.com';

/** Apple's own cap per set. Going over is rejected at reservation time. */
export const MAX_SCREENSHOTS_PER_SET = 10;

/**
 * Versions whose SCREENSHOTS App Store Connect still lets you replace.
 *
 * Deliberately narrower than fastlane's "edit version" filter, which also
 * includes `WAITING_FOR_REVIEW`. That filter answers "which version am I
 * working on", not "what can I write". Once a version is submitted, Apple
 * freezes screenshots along with the description: the handful of fields still
 * editable in review (support URL, marketing URL, promotional text) does not
 * include them, and an upload attempt comes back 409. Listing such a version as
 * editable here would promise something Apple refuses.
 *
 * `READY_FOR_REVIEW` is the newer enum's "filled in but not yet submitted", so
 * it stays.
 */
const EDITABLE_VERSION_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
  'READY_FOR_REVIEW',
]);

/** Submitted and frozen. Surfaced so the dialog can say what to do about it. */
const IN_REVIEW_STATES = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_APPLE_RELEASE']);

// --- transport --------------------------------------------------------------

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}
const tokenCache = new Map<string, TokenCacheEntry>();

async function bearerToken(credentials: AppStoreCredentials): Promise<string> {
  const cacheKey = `${credentials.issuerId}:${credentials.keyId}`;
  const cached = tokenCache.get(cacheKey);
  // Re-mint a minute early so a slow upload never runs past expiry mid-flight.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  if (!credentials.issuerId.trim() || !credentials.keyId.trim() || !credentials.privateKey.trim()) {
    throw new StoreAuthError('Add your issuer id, key id and .p8 private key first.');
  }

  const lifetimeSeconds = 900;
  const token = await createAppStoreConnectJwt({
    issuerId: credentials.issuerId.trim(),
    keyId: credentials.keyId.trim(),
    privateKeyPem: credentials.privateKey,
    lifetimeSeconds,
  });
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + lifetimeSeconds * 1000 });
  return token;
}

/** Drop the cached JWT, e.g. after the user edits their key. */
export function forgetAppStoreToken(credentials: AppStoreCredentials): void {
  tokenCache.delete(`${credentials.issuerId}:${credentials.keyId}`);
}

interface JsonApiResource<A> {
  id: string;
  type: string;
  attributes: A;
}

interface JsonApiCollection<A> {
  data: JsonApiResource<A>[];
  links?: { next?: string };
}

/** Apple explains failures well, so the detail is surfaced verbatim. */
function describeApiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      errors?: Array<{ title?: string; detail?: string; code?: string }>;
    };
    const first = parsed.errors?.[0];
    if (first) {
      const text = [first.detail, first.title].filter(Boolean).join(' ');
      if (text) return `${text} (HTTP ${status})`;
    }
  } catch {
    // Not JSON, fall through.
  }
  const trimmed = body.trim().slice(0, 240);
  return trimmed ? `${trimmed} (HTTP ${status})` : `App Store Connect returned HTTP ${status}`;
}

async function apiRequest<T>(
  credentials: AppStoreCredentials,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const doFetch = await bridgeFetch();
  const token = await bearerToken(credentials);
  const response = await doFetch(path.startsWith('http') ? path : `${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    // A bad key and a key without the right role look identical from here, so
    // the message covers both rather than guessing.
    throw new StoreAuthError(
      `${describeApiError(response.status, text)}. Check the issuer id, the key id, the .p8 file, and that the key has the App Manager or Developer role.`
    );
  }
  if (response.status === 409) {
    throw new StoreRejectedError(describeApiError(response.status, text));
  }
  if (!response.ok) {
    throw new Error(describeApiError(response.status, text));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** GET a collection, following Apple's cursor pagination to the end. */
async function listAll<A>(
  credentials: AppStoreCredentials,
  path: string
): Promise<JsonApiResource<A>[]> {
  const out: JsonApiResource<A>[] = [];
  let next: string | undefined = path;
  // Bounded so a pathological account cannot spin forever.
  for (let page = 0; next && page < 25; page += 1) {
    const body: JsonApiCollection<A> = await apiRequest<JsonApiCollection<A>>(credentials, next);
    out.push(...(body.data ?? []));
    next = body.links?.next;
  }
  return out;
}

// --- destination pickers ----------------------------------------------------

export interface AppStoreApp {
  id: string;
  name: string;
  bundleId: string;
}

export async function listAppStoreApps(credentials: AppStoreCredentials): Promise<AppStoreApp[]> {
  const rows = await listAll<{ name?: string; bundleId?: string }>(
    credentials,
    '/v1/apps?limit=200&fields[apps]=name,bundleId'
  );
  return rows
    .map((row) => ({
      id: row.id,
      name: row.attributes?.name ?? row.id,
      bundleId: row.attributes?.bundleId ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AppStoreVersion {
  id: string;
  versionString: string;
  state: string;
  platform: string;
  editable: boolean;
  /** Submitted and frozen, as opposed to simply not editable (already live). */
  inReview: boolean;
}

export async function listAppStoreVersions(
  credentials: AppStoreCredentials,
  appId: string
): Promise<AppStoreVersion[]> {
  // No fields[] filter on purpose: Apple renamed appStoreState to
  // appVersionState, and asking for a field the account's API version does not
  // know is a 400. Reading whichever one comes back is the stable move.
  const rows = await listAll<{
    versionString?: string;
    appStoreState?: string;
    appVersionState?: string;
    platform?: string;
  }>(credentials, `/v1/apps/${appId}/appStoreVersions?limit=50`);

  return rows.map((row) => {
    const state = row.attributes?.appStoreState ?? row.attributes?.appVersionState ?? 'UNKNOWN';
    return {
      id: row.id,
      versionString: row.attributes?.versionString ?? '',
      state,
      platform: row.attributes?.platform ?? 'IOS',
      editable: EDITABLE_VERSION_STATES.has(state),
      inReview: IN_REVIEW_STATES.has(state),
    };
  });
}

export interface AppStoreLocalization {
  id: string;
  locale: string;
}

export async function listAppStoreLocalizations(
  credentials: AppStoreCredentials,
  versionId: string
): Promise<AppStoreLocalization[]> {
  const rows = await listAll<{ locale?: string }>(
    credentials,
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200&fields[appStoreVersionLocalizations]=locale`
  );
  return rows
    .map((row) => ({ id: row.id, locale: row.attributes?.locale ?? '' }))
    .sort((a, b) => a.locale.localeCompare(b.locale));
}

// --- upload -----------------------------------------------------------------

interface UploadOperation {
  method?: string;
  url?: string;
  length?: number;
  offset?: number;
  requestHeaders?: Array<{ name?: string; value?: string }>;
}

interface ScreenshotAttributes {
  fileName?: string;
  fileSize?: number;
  uploadOperations?: UploadOperation[];
  assetDeliveryState?: { state?: string; errors?: Array<{ code?: string; description?: string }> };
}

async function findOrCreateScreenshotSet(
  credentials: AppStoreCredentials,
  localizationId: string,
  displayType: string
): Promise<string> {
  const existing = await listAll<{ screenshotDisplayType?: string }>(
    credentials,
    `/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=200`
  );
  const match = existing.find((row) => row.attributes?.screenshotDisplayType === displayType);
  if (match) return match.id;

  const created = await apiRequest<{ data: JsonApiResource<unknown> }>(
    credentials,
    '/v1/appScreenshotSets',
    {
      method: 'POST',
      body: {
        data: {
          type: 'appScreenshotSets',
          attributes: { screenshotDisplayType: displayType },
          relationships: {
            appStoreVersionLocalization: {
              data: { type: 'appStoreVersionLocalizations', id: localizationId },
            },
          },
        },
      },
    }
  );
  return created.data.id;
}

async function listSetScreenshotIds(
  credentials: AppStoreCredentials,
  setId: string
): Promise<string[]> {
  const rows = await listAll<unknown>(
    credentials,
    `/v1/appScreenshotSets/${setId}/appScreenshots?limit=200`
  );
  return rows.map((row) => row.id);
}

/**
 * Reserve, PUT every chunk Apple asked for, then commit with the checksum.
 * Returns the screenshot id so the caller can poll its delivery state.
 */
async function uploadOneScreenshot(
  credentials: AppStoreCredentials,
  setId: string,
  image: PublishImage
): Promise<string> {
  const reservation = await apiRequest<{ data: JsonApiResource<ScreenshotAttributes> }>(
    credentials,
    '/v1/appScreenshots',
    {
      method: 'POST',
      body: {
        data: {
          type: 'appScreenshots',
          attributes: { fileSize: image.bytes.length, fileName: image.fileName },
          relationships: {
            appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } },
          },
        },
      },
    }
  );

  const screenshotId = reservation.data.id;
  const operations = reservation.data.attributes?.uploadOperations ?? [];
  if (operations.length === 0) {
    throw new Error(`App Store Connect returned no upload instructions for ${image.fileName}.`);
  }

  const doFetch = await bridgeFetch();
  for (const operation of operations) {
    if (!operation.url) continue;
    const offset = operation.offset ?? 0;
    const length = operation.length ?? image.bytes.length - offset;
    const chunk = image.bytes.slice(offset, offset + length);

    const headers: Record<string, string> = {};
    for (const header of operation.requestHeaders ?? []) {
      // Content-Length is computed by the transport and is a forbidden header
      // to set by hand, so copying it through would be dropped anyway.
      if (!header.name || !header.value) continue;
      if (header.name.toLowerCase() === 'content-length') continue;
      headers[header.name] = header.value;
    }

    // Deliberately no Authorization header: these URLs are pre-signed by
    // Apple and carry their own credentials in requestHeaders.
    const response = await doFetch(operation.url, {
      method: operation.method ?? 'PUT',
      headers,
      body: chunk as unknown as BodyInit,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Uploading ${image.fileName} failed (HTTP ${response.status}). ${text.slice(0, 200)}`.trim()
      );
    }
  }

  await apiRequest(credentials, `/v1/appScreenshots/${screenshotId}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'appScreenshots',
        id: screenshotId,
        attributes: { uploaded: true, sourceFileChecksum: md5Hex(image.bytes) },
      },
    },
  });

  return screenshotId;
}

/**
 * Ask Apple how the asset processing went.
 *
 * This is the only place a wrong-sized or corrupt screenshot surfaces, and it
 * happens after every HTTP call has already returned 2xx, so it is worth the
 * wait: without it the dialog would claim success for images the App Store
 * silently drops.
 */
async function waitForDelivery(
  credentials: AppStoreCredentials,
  ids: string[],
  onProgress?: PublishProgressFn,
  timeoutMs = 90_000
): Promise<string[]> {
  const warnings: string[] = [];
  const pending = new Set(ids);
  const deadline = Date.now() + timeoutMs;

  while (pending.size > 0 && Date.now() < deadline) {
    onProgress?.({
      stage: 'processing',
      message: `Waiting for App Store Connect to process ${pending.size} screenshot${pending.size === 1 ? '' : 's'}`,
      current: ids.length - pending.size,
      total: ids.length,
    });

    for (const id of Array.from(pending)) {
      try {
        const row = await apiRequest<{ data: JsonApiResource<ScreenshotAttributes> }>(
          credentials,
          `/v1/appScreenshots/${id}?fields[appScreenshots]=assetDeliveryState,fileName`
        );
        const delivery = row.data.attributes?.assetDeliveryState;
        const state = delivery?.state;
        if (state === 'COMPLETE') {
          pending.delete(id);
        } else if (state === 'FAILED') {
          pending.delete(id);
          const reason =
            delivery?.errors?.map((error) => error.description).filter(Boolean).join(', ') ||
            'Apple did not say why';
          warnings.push(
            `${row.data.attributes?.fileName ?? id} was rejected during processing: ${reason}`
          );
        }
      } catch {
        // A transient read failure here should not fail an upload that already
        // committed; the next loop retries, and the deadline bounds it.
      }
    }

    if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (pending.size > 0) {
    warnings.push(
      `${pending.size} screenshot${pending.size === 1 ? ' is' : 's are'} still processing. Check App Store Connect in a few minutes.`
    );
  }
  return warnings;
}

export interface AppStoreUploadOptions {
  localizationId: string;
  images: PublishImage[];
  /** Delete whatever is already in each set before uploading. */
  replaceExisting: boolean;
  /** Only used to build the "open App Store Connect" link in the summary. */
  appId?: string;
}

/**
 * Upload a batch of rendered artboards to one version localization.
 *
 * Images are grouped by the display type their pixel size resolves to, so a
 * mixed project (iPhone plus iPad boards) lands in the right sets in one run.
 */
export async function uploadAppStoreScreenshots(
  credentials: AppStoreCredentials,
  options: AppStoreUploadOptions,
  onProgress?: PublishProgressFn
): Promise<PublishResult> {
  const warnings: string[] = [];

  onProgress?.({ stage: 'preparing', message: 'Matching screenshots to App Store display sizes' });

  const groups = new Map<string, PublishImage[]>();
  for (const image of options.images) {
    const target = appleTargetForSize(image.width, image.height);
    if (!target) {
      warnings.push(
        `${image.fileName} is ${image.width}x${image.height}, which the App Store does not accept. Closest accepted: ${nearestAppleSizes(image.width, image.height)}.`
      );
      continue;
    }
    const bucket = groups.get(target.displayType);
    if (bucket) bucket.push(image);
    else groups.set(target.displayType, [image]);
  }

  if (groups.size === 0) {
    throw new StoreRejectedError(
      warnings[0] ?? 'None of these artboards are an App Store screenshot size.'
    );
  }

  const uploadedIds: string[] = [];
  let uploadedCount = 0;
  const totalImages = Array.from(groups.values()).reduce((sum, list) => sum + list.length, 0);

  for (const [displayType, images] of groups) {
    const setId = await findOrCreateScreenshotSet(credentials, options.localizationId, displayType);
    let keptIds = await listSetScreenshotIds(credentials, setId);

    if (options.replaceExisting && keptIds.length > 0) {
      onProgress?.({
        stage: 'clearing',
        message: `Removing ${keptIds.length} existing screenshot${keptIds.length === 1 ? '' : 's'}`,
      });
      for (const id of keptIds) {
        try {
          await apiRequest(credentials, `/v1/appScreenshots/${id}`, { method: 'DELETE' });
        } catch (error) {
          warnings.push(
            `Could not remove an existing screenshot: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }
      }
      keptIds = [];
    }

    if (keptIds.length + images.length > MAX_SCREENSHOTS_PER_SET) {
      throw new StoreRejectedError(
        `The App Store keeps at most ${MAX_SCREENSHOTS_PER_SET} screenshots per size. This set already has ${keptIds.length} and you are adding ${images.length}. Turn on "Replace what is already there" or upload fewer.`
      );
    }

    const newIds: string[] = [];
    for (const image of images) {
      uploadedCount += 1;
      onProgress?.({
        stage: 'uploading',
        message: `Uploading ${image.fileName}`,
        current: uploadedCount,
        total: totalImages,
      });
      newIds.push(await uploadOneScreenshot(credentials, setId, image));
    }
    uploadedIds.push(...newIds);

    // Screenshot order in the set is what the App Store shows, and it is not
    // implied by upload order, so state it explicitly. A failure here is
    // cosmetic: the screenshots are already uploaded.
    try {
      await apiRequest(credentials, `/v1/appScreenshotSets/${setId}/relationships/appScreenshots`, {
        method: 'PATCH',
        body: {
          data: [...keptIds, ...newIds].map((id) => ({ type: 'appScreenshots', id })),
        },
      });
    } catch {
      warnings.push('Screenshots uploaded, but App Store Connect kept its own ordering.');
    }
  }

  warnings.push(...(await waitForDelivery(credentials, uploadedIds, onProgress)));

  onProgress?.({ stage: 'done', message: 'Done' });

  return {
    uploaded: uploadedIds.length,
    warnings,
    reviewUrl: options.appId
      ? `https://appstoreconnect.apple.com/apps/${options.appId}/distribution`
      : 'https://appstoreconnect.apple.com/apps',
  };
}
