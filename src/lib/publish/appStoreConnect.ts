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
//   5. App Preview VIDEOS run the same three steps against appPreviews and
//      appPreviewSets, with a different enum, a different size table, a cap of
//      3 per set instead of 10, and a SECOND delivery state: Apple transcodes
//      the file after receiving it, and a bad codec or length only surfaces
//      there. See the preview half of ./storeTargets.
//
// Everything here is desktop only: api.appstoreconnect.apple.com sends no CORS
// headers, so bridgeFetch's Tauri branch (tauri-plugin-http, which goes out
// through Rust) is the only transport that can reach it.

import { bridgeFetch } from '@/lib/account/transport';
import { createAppStoreConnectJwt } from './jwt';
import { md5Hex } from './md5';
import {
  appleTargetForSize,
  applePreviewTargetForSize,
  MAX_PREVIEWS_PER_SET,
  nearestAppleSizes,
  nearestApplePreviewSizes,
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_SECONDS,
  PREVIEW_MIN_SECONDS,
} from './storeTargets';
import {
  StoreAuthError,
  StoreRejectedError,
  type AppStoreCredentials,
  type PublishImage,
  type PublishProgressFn,
  type PublishResult,
  type PublishVideo,
} from './types';

const API_BASE = 'https://api.appstoreconnect.apple.com';

/** Apple's own cap per set. Going over is rejected at reservation time. */
export const MAX_SCREENSHOTS_PER_SET = 10;

/** How long to watch Apple's processing before telling the user to check later. */
const SCREENSHOT_DELIVERY_TIMEOUT_MS = 90_000;
/** Transcoding a 30-second preview takes minutes, where a PNG takes seconds. */
const PREVIEW_DELIVERY_TIMEOUT_MS = 240_000;

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

interface DeliveryState {
  state?: string;
  errors?: Array<{ code?: string; description?: string }>;
}

/** Shared by appScreenshots and appPreviews, which differ only in the tail. */
interface AssetAttributes {
  fileName?: string;
  fileSize?: number;
  uploadOperations?: UploadOperation[];
  assetDeliveryState?: DeliveryState;
  /** Previews only: Apple's transcode, reported separately from the bytes. */
  videoDeliveryState?: DeliveryState;
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
 * The preview equivalent. Same shape as the screenshot one, and deliberately
 * not merged with it: the attribute that identifies a set is `previewType`
 * here and `screenshotDisplayType` there, so a merged version would take both
 * names as parameters and read worse than two short functions.
 */
async function findOrCreatePreviewSet(
  credentials: AppStoreCredentials,
  localizationId: string,
  previewType: string
): Promise<string> {
  const existing = await listAll<{ previewType?: string }>(
    credentials,
    `/v1/appStoreVersionLocalizations/${localizationId}/appPreviewSets?limit=200`
  );
  const match = existing.find((row) => row.attributes?.previewType === previewType);
  if (match) return match.id;

  const created = await apiRequest<{ data: JsonApiResource<unknown> }>(
    credentials,
    '/v1/appPreviewSets',
    {
      method: 'POST',
      body: {
        data: {
          type: 'appPreviewSets',
          attributes: { previewType },
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

async function listSetPreviewIds(
  credentials: AppStoreCredentials,
  setId: string
): Promise<string[]> {
  const rows = await listAll<unknown>(
    credentials,
    `/v1/appPreviewSets/${setId}/appPreviews?limit=200`
  );
  return rows.map((row) => row.id);
}

/**
 * Reserve, PUT every chunk Apple asked for, then commit with the checksum.
 *
 * Shared by screenshots and previews. The reservation/chunk/commit dance is
 * identical for both resources: the same uploadOperations shape, the same rule
 * that the pre-signed URLs must NOT carry our Authorization header, the same
 * MD5 that makes the upload count. Only the resource names and a couple of
 * attributes differ, and those are passed in.
 */
interface AssetUpload {
  resource: 'appScreenshots' | 'appPreviews';
  setType: 'appScreenshotSets' | 'appPreviewSets';
  /** The relationship the reservation hangs the asset off its set with. */
  setRelationship: 'appScreenshotSet' | 'appPreviewSet';
  setId: string;
  fileName: string;
  bytes: Uint8Array;
  /** Anything beyond fileSize and fileName, e.g. a preview's mimeType. */
  extraReserveAttributes?: Record<string, unknown>;
  /** Anything beyond uploaded and sourceFileChecksum, e.g. a poster timecode. */
  extraCommitAttributes?: Record<string, unknown>;
}

async function reserveUploadCommit(
  credentials: AppStoreCredentials,
  upload: AssetUpload
): Promise<string> {
  const reservation = await apiRequest<{ data: JsonApiResource<AssetAttributes> }>(
    credentials,
    `/v1/${upload.resource}`,
    {
      method: 'POST',
      body: {
        data: {
          type: upload.resource,
          attributes: {
            fileSize: upload.bytes.length,
            fileName: upload.fileName,
            ...upload.extraReserveAttributes,
          },
          relationships: {
            [upload.setRelationship]: { data: { type: upload.setType, id: upload.setId } },
          },
        },
      },
    }
  );

  const assetId = reservation.data.id;
  const operations = reservation.data.attributes?.uploadOperations ?? [];
  if (operations.length === 0) {
    throw new Error(`App Store Connect returned no upload instructions for ${upload.fileName}.`);
  }

  const doFetch = await bridgeFetch();
  for (const operation of operations) {
    if (!operation.url) continue;
    const offset = operation.offset ?? 0;
    const length = operation.length ?? upload.bytes.length - offset;
    const chunk = upload.bytes.slice(offset, offset + length);

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
        `Uploading ${upload.fileName} failed (HTTP ${response.status}). ${text.slice(0, 200)}`.trim()
      );
    }
  }

  await apiRequest(credentials, `/v1/${upload.resource}/${assetId}`, {
    method: 'PATCH',
    body: {
      data: {
        type: upload.resource,
        id: assetId,
        attributes: {
          uploaded: true,
          sourceFileChecksum: md5Hex(upload.bytes),
          ...upload.extraCommitAttributes,
        },
      },
    },
  });

  return assetId;
}

/** Returns the screenshot id so the caller can poll its delivery state. */
async function uploadOneScreenshot(
  credentials: AppStoreCredentials,
  setId: string,
  image: PublishImage
): Promise<string> {
  return reserveUploadCommit(credentials, {
    resource: 'appScreenshots',
    setType: 'appScreenshotSets',
    setRelationship: 'appScreenshotSet',
    setId,
    fileName: image.fileName,
    bytes: image.bytes,
  });
}

/**
 * The same, for one App Preview.
 *
 * Two attributes a screenshot does not send. `mimeType`, because Apple does not
 * infer it from the extension for video. And `previewFrameTimeCode`, the poster
 * frame: left unset, Apple takes the frame at 5 seconds, which on a preview
 * that opens on a title card is a poster of the title card.
 */
async function uploadOnePreview(
  credentials: AppStoreCredentials,
  setId: string,
  video: PublishVideo
): Promise<string> {
  return reserveUploadCommit(credentials, {
    resource: 'appPreviews',
    setType: 'appPreviewSets',
    setRelationship: 'appPreviewSet',
    setId,
    fileName: video.fileName,
    bytes: video.bytes,
    extraReserveAttributes: { mimeType: 'video/mp4' },
    extraCommitAttributes: video.previewFrameTimeCode
      ? { previewFrameTimeCode: video.previewFrameTimeCode }
      : undefined,
  });
}

/**
 * Ask Apple how the asset processing went.
 *
 * This is the only place a wrong-sized or corrupt asset surfaces, and it
 * happens after every HTTP call has already returned 2xx, so it is worth the
 * wait: without it the dialog would claim success for files the App Store
 * silently drops.
 *
 * A preview reports in two stages. `assetDeliveryState` covers the bytes
 * arriving, then `videoDeliveryState` covers Apple's transcode, and only the
 * second one can reject a file for being the wrong length or the wrong codec.
 * Both have to read COMPLETE before a preview is done.
 */
interface DeliveryWatch {
  resource: 'appScreenshots' | 'appPreviews';
  ids: string[];
  /** Singular noun for the progress line and the warnings. */
  noun: string;
  timeoutMs: number;
}

/**
 * How long to keep waiting for `videoDeliveryState` to appear after the bytes
 * have landed. Apple populates it a moment after the commit, but treating its
 * absence as "not done" without a bound would make every successful preview sit
 * out the full deadline if Apple ever stopped sending the field.
 */
const VIDEO_STATE_GRACE_MS = 45_000;

async function waitForDelivery(
  credentials: AppStoreCredentials,
  watch: DeliveryWatch,
  onProgress?: PublishProgressFn
): Promise<string[]> {
  const { resource, ids, noun, timeoutMs } = watch;
  const isPreview = resource === 'appPreviews';
  const fields = isPreview
    ? 'fields[appPreviews]=assetDeliveryState,videoDeliveryState,fileName'
    : 'fields[appScreenshots]=assetDeliveryState,fileName';

  const warnings: string[] = [];
  const pending = new Set(ids);
  /** When each preview's bytes finished, so the grace window can be measured. */
  const bytesDoneAt = new Map<string, number>();
  const deadline = Date.now() + timeoutMs;

  while (pending.size > 0 && Date.now() < deadline) {
    onProgress?.({
      stage: 'processing',
      message: `Waiting for App Store Connect to process ${pending.size} ${noun}${pending.size === 1 ? '' : 's'}`,
      current: ids.length - pending.size,
      total: ids.length,
    });

    for (const id of Array.from(pending)) {
      try {
        const row = await apiRequest<{ data: JsonApiResource<AssetAttributes> }>(
          credentials,
          `/v1/${resource}/${id}?${fields}`
        );
        const name = row.data.attributes?.fileName ?? id;
        const asset = row.data.attributes?.assetDeliveryState;
        const video = isPreview ? row.data.attributes?.videoDeliveryState : undefined;

        const failed = [asset, video].find((state) => state?.state === 'FAILED');
        if (failed) {
          pending.delete(id);
          const reason =
            failed.errors?.map((error) => error.description).filter(Boolean).join(', ') ||
            'Apple did not say why';
          warnings.push(`${name} was rejected during processing: ${reason}`);
          continue;
        }

        if (asset?.state !== 'COMPLETE') continue;
        if (!isPreview) {
          pending.delete(id);
          continue;
        }

        if (video?.state === 'COMPLETE') {
          pending.delete(id);
          continue;
        }
        if (video) continue; // Still transcoding, which is normal and slow.

        const since = bytesDoneAt.get(id);
        if (since === undefined) bytesDoneAt.set(id, Date.now());
        else if (Date.now() - since > VIDEO_STATE_GRACE_MS) pending.delete(id);
      } catch {
        // A transient read failure here should not fail an upload that already
        // committed; the next loop retries, and the deadline bounds it.
      }
    }

    if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (pending.size > 0) {
    warnings.push(
      `${pending.size} ${noun}${pending.size === 1 ? ' is' : 's are'} still processing. Check App Store Connect in a few minutes.`
    );
  }
  return warnings;
}

/**
 * Bucket images by the display type their pixel size resolves to, so a mixed
 * project (iPhone plus iPad boards) lands in the right sets in one run. Sizes
 * the App Store takes for nothing become a warning rather than a failure.
 */
function groupByDisplayType(
  images: PublishImage[],
  warnings: string[]
): Map<string, PublishImage[]> {
  const groups = new Map<string, PublishImage[]>();
  for (const image of images) {
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
  return groups;
}

/**
 * The same for App Previews, with the checks Apple only applies during the
 * transcode: length and file size. Both are cheap to test here and expensive to
 * learn about four minutes into a poll, so a preview that cannot pass becomes a
 * warning naming the reason and the rest of the run goes ahead.
 *
 * `platform` comes from the version being published to. Without it, 1920x1080
 * resolves to an iPhone 5.5-inch landscape preview on a Mac or Apple TV app.
 */
function groupByPreviewType(
  videos: PublishVideo[],
  platform: string | null | undefined,
  warnings: string[]
): Map<string, PublishVideo[]> {
  const groups = new Map<string, PublishVideo[]>();
  for (const video of videos) {
    const target = applePreviewTargetForSize(video.width, video.height, platform);
    if (!target) {
      warnings.push(
        `${video.fileName} is ${video.width}x${video.height}, which the App Store does not accept for an App Preview. Closest accepted: ${nearestApplePreviewSizes(video.width, video.height, platform)}.`
      );
      continue;
    }

    const seconds = Math.round(video.durationSeconds);
    if (seconds < PREVIEW_MIN_SECONDS || seconds > PREVIEW_MAX_SECONDS) {
      warnings.push(
        `${video.fileName} runs ${seconds} seconds. Apple takes App Previews between ${PREVIEW_MIN_SECONDS} and ${PREVIEW_MAX_SECONDS} seconds, so it was left out.`
      );
      continue;
    }
    if (video.bytes.length > PREVIEW_MAX_BYTES) {
      warnings.push(
        `${video.fileName} is ${Math.round(video.bytes.length / 1024 / 1024)} MB, over Apple's ${Math.round(PREVIEW_MAX_BYTES / 1024 / 1024)} MB limit for an App Preview, so it was left out.`
      );
      continue;
    }

    const bucket = groups.get(target.previewType);
    if (bucket) bucket.push(video);
    else groups.set(target.previewType, [video]);
  }
  return groups;
}

/** Running 1-based image number across a whole run, so a multi-language upload
 *  counts 1..45 rather than restarting at 1 for every language. */
interface UploadCounter {
  done: number;
  total: number;
}

/**
 * Put already-grouped images into one version localization's sets.
 *
 * Everything up to (but not including) the delivery poll, because the poll is
 * the expensive part and a multi-language run pools every reserved id into a
 * single one instead of paying the 90 second deadline once per language.
 */
async function uploadGroupsToLocalization(
  credentials: AppStoreCredentials,
  localizationId: string,
  groups: Map<string, PublishImage[]>,
  replaceExisting: boolean,
  counter: UploadCounter,
  onProgress?: PublishProgressFn
): Promise<{ uploadedIds: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const uploadedIds: string[] = [];

  for (const [displayType, images] of groups) {
    const setId = await findOrCreateScreenshotSet(credentials, localizationId, displayType);
    let keptIds = await listSetScreenshotIds(credentials, setId);

    if (replaceExisting && keptIds.length > 0) {
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
      counter.done += 1;
      onProgress?.({
        stage: 'uploading',
        message: `Uploading ${image.fileName}`,
        current: counter.done,
        total: counter.total,
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

  return { uploadedIds, warnings };
}

/**
 * Put already-grouped previews into one version localization's preview sets.
 *
 * Mirrors uploadGroupsToLocalization, with Apple's preview numbers: 3 per set
 * rather than 10, and appPreviews rather than appScreenshots throughout.
 */
async function uploadPreviewGroupsToLocalization(
  credentials: AppStoreCredentials,
  localizationId: string,
  groups: Map<string, PublishVideo[]>,
  replaceExisting: boolean,
  counter: UploadCounter,
  onProgress?: PublishProgressFn
): Promise<{ uploadedIds: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const uploadedIds: string[] = [];

  for (const [previewType, videos] of groups) {
    const setId = await findOrCreatePreviewSet(credentials, localizationId, previewType);
    let keptIds = await listSetPreviewIds(credentials, setId);

    if (replaceExisting && keptIds.length > 0) {
      onProgress?.({
        stage: 'clearing',
        message: `Removing ${keptIds.length} existing App Preview${keptIds.length === 1 ? '' : 's'}`,
      });
      for (const id of keptIds) {
        try {
          await apiRequest(credentials, `/v1/appPreviews/${id}`, { method: 'DELETE' });
        } catch (error) {
          warnings.push(
            `Could not remove an existing App Preview: ${error instanceof Error ? error.message : 'unknown error'}`
          );
        }
      }
      keptIds = [];
    }

    // A warning rather than a throw, unlike the screenshot cap. Previews are
    // uploaded AFTER the screenshots in the same run, so throwing here would
    // report a run whose screenshots already landed as a total failure, and
    // the obvious retry would upload those screenshots a second time.
    if (keptIds.length + videos.length > MAX_PREVIEWS_PER_SET) {
      warnings.push(
        `The App Store keeps at most ${MAX_PREVIEWS_PER_SET} App Previews per size. The ${previewType} set already has ${keptIds.length} and you are adding ${videos.length}, so they were left out. Turn on "Replace what is already there" or upload fewer.`
      );
      continue;
    }

    const newIds: string[] = [];
    for (const video of videos) {
      counter.done += 1;
      onProgress?.({
        stage: 'uploading',
        message: `Uploading ${video.fileName}`,
        current: counter.done,
        total: counter.total,
      });
      newIds.push(await uploadOnePreview(credentials, setId, video));
    }
    uploadedIds.push(...newIds);

    // Order in the set is what the App Store shows, and it is not implied by
    // upload order. A failure here is cosmetic: the previews are already up.
    try {
      await apiRequest(credentials, `/v1/appPreviewSets/${setId}/relationships/appPreviews`, {
        method: 'PATCH',
        body: {
          data: [...keptIds, ...newIds].map((id) => ({ type: 'appPreviews', id })),
        },
      });
    } catch {
      warnings.push('App Previews uploaded, but App Store Connect kept its own ordering.');
    }
  }

  return { uploadedIds, warnings };
}

function reviewUrlFor(appId?: string): string {
  return appId
    ? `https://appstoreconnect.apple.com/apps/${appId}/distribution`
    : 'https://appstoreconnect.apple.com/apps';
}

export interface AppStoreUploadOptions {
  localizationId: string;
  images: PublishImage[];
  /** App Preview videos for the same localization. Empty on a screenshot run. */
  videos?: PublishVideo[];
  /**
   * The version's platform: IOS, MAC_OS, TV_OS or VISION_OS. Only previews need
   * it, to tell an iPhone landscape preview from a Mac or Apple TV one, which
   * share 1920x1080.
   */
  platform?: string | null;
  /** Delete whatever is already in each set before uploading. */
  replaceExisting: boolean;
  /** Only used to build the "open App Store Connect" link in the summary. */
  appId?: string;
}

/**
 * Upload a batch of rendered artboards to one version localization.
 *
 * Images are grouped by the display type their pixel size resolves to and
 * previews by their preview type, so a mixed project (iPhone plus iPad boards,
 * screenshots plus App Previews) lands in the right sets in one run.
 */
export async function uploadAppStoreScreenshots(
  credentials: AppStoreCredentials,
  options: AppStoreUploadOptions,
  onProgress?: PublishProgressFn
): Promise<PublishResult> {
  const warnings: string[] = [];

  onProgress?.({ stage: 'preparing', message: 'Matching files to App Store sizes' });

  const groups = groupByDisplayType(options.images, warnings);
  const previewGroups = groupByPreviewType(options.videos ?? [], options.platform, warnings);
  if (groups.size === 0 && previewGroups.size === 0) {
    throw new StoreRejectedError(
      warnings[0] ?? 'None of these artboards are an App Store screenshot or App Preview size.'
    );
  }

  const counter: UploadCounter = {
    done: 0,
    total:
      Array.from(groups.values()).reduce((sum, list) => sum + list.length, 0) +
      Array.from(previewGroups.values()).reduce((sum, list) => sum + list.length, 0),
  };

  const imageIds: string[] = [];
  const videoIds: string[] = [];

  if (groups.size > 0) {
    const outcome = await uploadGroupsToLocalization(
      credentials,
      options.localizationId,
      groups,
      options.replaceExisting,
      counter,
      onProgress
    );
    imageIds.push(...outcome.uploadedIds);
    warnings.push(...outcome.warnings);
  }

  if (previewGroups.size > 0) {
    // Screenshots are already committed by this point, so a preview failure is
    // a warning on a partial success, never a thrown-away run. The exception is
    // auth, where every remaining call would fail the same way.
    try {
      const outcome = await uploadPreviewGroupsToLocalization(
        credentials,
        options.localizationId,
        previewGroups,
        options.replaceExisting,
        counter,
        onProgress
      );
      videoIds.push(...outcome.uploadedIds);
      warnings.push(...outcome.warnings);
    } catch (error) {
      if (error instanceof StoreAuthError) throw error;
      if (imageIds.length === 0) throw error;
      warnings.push(
        `The App Previews failed: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  warnings.push(...(await pollBothKinds(credentials, imageIds, videoIds, onProgress)));

  onProgress?.({ stage: 'done', message: 'Done' });

  return {
    uploaded: imageIds.length + videoIds.length,
    uploadedVideos: videoIds.length,
    warnings,
    reviewUrl: reviewUrlFor(options.appId),
  };
}

/**
 * Poll whichever kinds actually went up, screenshots first.
 *
 * Screenshots finish in seconds and previews in minutes, so doing them in this
 * order means the dialog stops saying "processing screenshots" as early as it
 * honestly can rather than hiding them behind the slower job.
 */
async function pollBothKinds(
  credentials: AppStoreCredentials,
  imageIds: string[],
  videoIds: string[],
  onProgress?: PublishProgressFn
): Promise<string[]> {
  const warnings: string[] = [];
  if (imageIds.length > 0) {
    warnings.push(
      ...(await waitForDelivery(
        credentials,
        {
          resource: 'appScreenshots',
          ids: imageIds,
          noun: 'screenshot',
          timeoutMs: SCREENSHOT_DELIVERY_TIMEOUT_MS,
        },
        onProgress
      ))
    );
  }
  if (videoIds.length > 0) {
    warnings.push(
      ...(await waitForDelivery(
        credentials,
        {
          resource: 'appPreviews',
          ids: videoIds,
          noun: 'App Preview',
          timeoutMs: PREVIEW_DELIVERY_TIMEOUT_MS,
        },
        onProgress
      ))
    );
  }
  return warnings;
}

/** One language's worth of a multi-language run. */
export interface AppStoreLocaleUpload {
  /** The appStoreVersionLocalizations id this language's sets hang off. */
  localizationId: string;
  images: PublishImage[];
  /** App Preview videos rendered in this language. */
  videos?: PublishVideo[];
  /**
   * What to call this language in progress lines and warnings. Never sent to
   * Apple, which only ever sees `localizationId`.
   */
  label?: string;
}

export interface AppStoreBatchUploadOptions {
  sets: AppStoreLocaleUpload[];
  /** Delete whatever is already in each set before uploading. */
  replaceExisting: boolean;
  /** The version's platform, used to resolve preview types. See the single-set options. */
  platform?: string | null;
  /** Only used to build the "open App Store Connect" link in the summary. */
  appId?: string;
}

/**
 * Upload every language in one run.
 *
 * The reason this exists rather than a loop over uploadAppStoreScreenshots:
 * Apple processes assets asynchronously and the only place a wrong-sized or
 * corrupt file ever surfaces is the delivery poll, which waits up to 90 seconds
 * for a screenshot and four minutes for a preview. Per-language calls pay that
 * deadline once each, so five languages can sit there for many minutes doing
 * nothing but waiting. Here every reserved id from every language goes into ONE
 * poll per kind, because they all process in parallel on Apple's side anyway.
 *
 * A language that fails does not take the run down with it: its error becomes a
 * warning naming the language and the remaining languages still go up. An auth
 * failure is the exception, since every remaining call would fail the same way.
 */
export async function uploadAppStoreScreenshotsForLocales(
  credentials: AppStoreCredentials,
  options: AppStoreBatchUploadOptions,
  onProgress?: PublishProgressFn
): Promise<PublishResult> {
  const warnings: string[] = [];

  onProgress?.({ stage: 'preparing', message: 'Matching files to App Store sizes' });

  const planned: Array<{
    set: AppStoreLocaleUpload;
    groups: Map<string, PublishImage[]>;
    previewGroups: Map<string, PublishVideo[]>;
  }> = [];
  for (const set of options.sets) {
    const groups = groupByDisplayType(set.images, warnings);
    const previewGroups = groupByPreviewType(set.videos ?? [], options.platform, warnings);
    if (groups.size === 0 && previewGroups.size === 0) {
      warnings.push(
        `${set.label ?? 'One language'} had nothing the App Store accepts at these sizes, so it was skipped.`
      );
      continue;
    }
    planned.push({ set, groups, previewGroups });
  }

  if (planned.length === 0) {
    throw new StoreRejectedError(
      warnings[0] ?? 'None of these artboards are an App Store screenshot or App Preview size.'
    );
  }

  const countIn = (groups: Map<string, unknown[]>) =>
    Array.from(groups.values()).reduce((sum, list) => sum + list.length, 0);
  const counter: UploadCounter = {
    done: 0,
    total: planned.reduce(
      (sum, entry) => sum + countIn(entry.groups) + countIn(entry.previewGroups),
      0
    ),
  };

  const imageIds: string[] = [];
  const videoIds: string[] = [];
  let firstFailure: unknown = null;

  for (const entry of planned) {
    try {
      if (entry.groups.size > 0) {
        const outcome = await uploadGroupsToLocalization(
          credentials,
          entry.set.localizationId,
          entry.groups,
          options.replaceExisting,
          counter,
          onProgress
        );
        imageIds.push(...outcome.uploadedIds);
        warnings.push(...outcome.warnings);
      }
      if (entry.previewGroups.size > 0) {
        const outcome = await uploadPreviewGroupsToLocalization(
          credentials,
          entry.set.localizationId,
          entry.previewGroups,
          options.replaceExisting,
          counter,
          onProgress
        );
        videoIds.push(...outcome.uploadedIds);
        warnings.push(...outcome.warnings);
      }
    } catch (error) {
      if (error instanceof StoreAuthError) throw error;
      if (!firstFailure) firstFailure = error;
      warnings.push(
        `${entry.set.label ?? 'One language'} failed: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  // Nothing landed anywhere, so the failure is the story, not a footnote.
  if (imageIds.length === 0 && videoIds.length === 0 && firstFailure) throw firstFailure;

  warnings.push(...(await pollBothKinds(credentials, imageIds, videoIds, onProgress)));

  onProgress?.({ stage: 'done', message: 'Done' });

  return {
    uploaded: imageIds.length + videoIds.length,
    uploadedVideos: videoIds.length,
    warnings,
    reviewUrl: reviewUrlFor(options.appId),
  };
}
