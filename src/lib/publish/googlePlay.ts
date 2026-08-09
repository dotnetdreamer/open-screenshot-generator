// Google Play: put store listing images on an app, from the editor.
//
// Play's model is an "edit": a staged transaction over the whole listing. You
// open one, change things inside it, then commit it, and only the commit makes
// anything public. Nothing is live until then, and an abandoned edit expires on
// its own, which makes this considerably safer to retry than it looks.
//
//   1. POST .../edits                       open the transaction
//   2. DELETE .../listings/{lang}/{type}    optional, clear the slot
//   3. POST /upload/.../listings/{lang}/{type}?uploadType=media   one per image
//   4. POST .../edits/{id}:validate then :commit
//
// Auth is a service account: the JSON key signs an RS256 assertion, Google
// swaps it for an access token. The service account has to be invited into the
// Play Console (Users and permissions) and granted access to the app, which is
// the single most common reason this fails with a 401 that reads like a bug.
// Note for anyone updating the setup copy: Google removed the "link a Cloud
// project" requirement and the old Setup > API access menu is gone, so any
// instructions mentioning either are stale.
//
// Desktop only, same reason as the App Store side: bridgeFetch's Tauri branch
// keeps these calls out of the webview's CORS rules.

import { bridgeFetch } from '@/lib/account/transport';
import { createServiceAccountAssertion } from './jwt';
import { PLAY_IMAGE_TARGETS, validatePlayImage } from './storeTargets';
import {
  StoreAuthError,
  StoreRejectedError,
  type PlayCredentials,
  type PublishImage,
  type PublishProgressFn,
  type PublishResult,
} from './types';

const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD_BASE = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Play rejects anything larger, per the Play Console asset requirements. */
const MAX_PLAY_IMAGE_BYTES = 8 * 1024 * 1024;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
  project_id?: string;
}

/** Read the downloaded key file, with messages aimed at the wrong-file case. */
export function parseServiceAccount(json: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new StoreAuthError('That does not look like JSON. Pick the key file you downloaded from Google Cloud.');
  }
  const account = parsed as Partial<ServiceAccount> & { type?: string };
  if (!account.client_email || !account.private_key) {
    throw new StoreAuthError(
      'That JSON has no client_email or private_key. Use the service account key, not the OAuth client file.'
    );
  }
  return {
    client_email: account.client_email,
    private_key: account.private_key,
    private_key_id: account.private_key_id,
    token_uri: account.token_uri || DEFAULT_TOKEN_URI,
    project_id: account.project_id,
  };
}

/** The service account address, so the dialog can show who it will publish as. */
export function serviceAccountEmail(credentials: PlayCredentials): string | null {
  try {
    return parseServiceAccount(credentials.serviceAccountJson).client_email;
  } catch {
    return null;
  }
}

// --- transport --------------------------------------------------------------

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(credentials: PlayCredentials): Promise<string> {
  const account = parseServiceAccount(credentials.serviceAccountJson);
  const cached = tokenCache.get(account.client_email);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const tokenUri = account.token_uri || DEFAULT_TOKEN_URI;
  const assertion = await createServiceAccountAssertion({
    clientEmail: account.client_email,
    privateKeyPem: account.private_key,
    privateKeyId: account.private_key_id,
    scope: SCOPE,
    tokenUri,
  });

  const doFetch = await bridgeFetch();
  const response = await doFetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new StoreAuthError(
      `Google refused the service account key: ${describeGoogleError(response.status, text)}`
    );
  }
  const body = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new StoreAuthError('Google returned no access token.');

  tokenCache.set(account.client_email, {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}

/** Drop the cached token, e.g. after the user swaps the key file. */
export function forgetPlayToken(credentials: PlayCredentials): void {
  const email = serviceAccountEmail(credentials);
  if (email) tokenCache.delete(email);
}

function describeGoogleError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      error_description?: string;
    };
    const message =
      typeof parsed.error === 'string'
        ? parsed.error_description || parsed.error
        : parsed.error?.message;
    if (message) return `${message} (HTTP ${status})`;
  } catch {
    // Not JSON, fall through.
  }
  const trimmed = body.trim().slice(0, 240);
  return trimmed ? `${trimmed} (HTTP ${status})` : `Google Play returned HTTP ${status}`;
}

async function apiRequest<T>(
  credentials: PlayCredentials,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const doFetch = await bridgeFetch();
  const token = await accessToken(credentials);
  const response = await doFetch(`${API_BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  if (response.status === 401) {
    throw new StoreAuthError(
      `${describeGoogleError(response.status, text)}. The service account key may be revoked.`
    );
  }
  if (response.status === 403) {
    throw new StoreAuthError(
      `${describeGoogleError(response.status, text)}. Invite the service account in Play Console under Users and permissions, give it access to this app, and make sure the Google Play Android Developer API is enabled.`
    );
  }
  if (response.status === 404) {
    throw new StoreRejectedError(
      `Google Play does not know the package "${credentials.packageName}". Check the package name, and note that an app with no published release yet cannot be edited over the API.`
    );
  }
  if (!response.ok) {
    throw new Error(describeGoogleError(response.status, text));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const encodePath = (value: string) => encodeURIComponent(value.trim());

// --- edits ------------------------------------------------------------------

async function openEdit(credentials: PlayCredentials): Promise<string> {
  const edit = await apiRequest<{ id?: string }>(
    credentials,
    `/applications/${encodePath(credentials.packageName)}/edits`,
    { method: 'POST', body: {} }
  );
  if (!edit.id) throw new Error('Google Play did not return an edit id.');
  return edit.id;
}

async function discardEdit(credentials: PlayCredentials, editId: string): Promise<void> {
  try {
    await apiRequest(credentials, `/applications/${encodePath(credentials.packageName)}/edits/${editId}`, {
      method: 'DELETE',
    });
  } catch {
    // Abandoned edits expire on their own; never mask the real error with this.
  }
}

/**
 * Open and immediately discard an edit. This is the cheapest proof that the
 * key works, the API is enabled, and the service account can reach this app.
 */
export async function verifyPlayAccess(credentials: PlayCredentials): Promise<void> {
  if (!credentials.packageName.trim()) {
    throw new StoreRejectedError('Enter the app package name first.');
  }
  const editId = await openEdit(credentials);
  await discardEdit(credentials, editId);
}

export interface PlayListing {
  language: string;
  title?: string;
}

/** The languages this listing already has, for the language picker. */
export async function listPlayLanguages(credentials: PlayCredentials): Promise<PlayListing[]> {
  const editId = await openEdit(credentials);
  try {
    const body = await apiRequest<{ listings?: Array<{ language?: string; title?: string }> }>(
      credentials,
      `/applications/${encodePath(credentials.packageName)}/edits/${editId}/listings`
    );
    return (body.listings ?? [])
      .filter((listing): listing is { language: string; title?: string } => !!listing.language)
      .map((listing) => ({ language: listing.language, title: listing.title }))
      .sort((a, b) => a.language.localeCompare(b.language));
  } finally {
    await discardEdit(credentials, editId);
  }
}

// --- upload -----------------------------------------------------------------

export interface PlayUploadOptions {
  language: string;
  imageType: string;
  images: PublishImage[];
  /** Clear the slot first. Play appends otherwise, up to the slot's limit. */
  replaceExisting: boolean;
  /**
   * Commit without sending the listing for review. Play requires this for some
   * accounts and rejects the commit with a message saying so, which we also
   * handle by retrying automatically.
   */
  changesNotSentForReview?: boolean;
}

export async function uploadPlayScreenshots(
  credentials: PlayCredentials,
  options: PlayUploadOptions,
  onProgress?: PublishProgressFn
): Promise<PublishResult> {
  const warnings: string[] = [];
  const target = PLAY_IMAGE_TARGETS.find((entry) => entry.imageType === options.imageType);
  const slotLabel = target?.label ?? options.imageType;

  const usable = options.images.filter((image) => {
    const problem = validatePlayImage(image.width, image.height, options.imageType);
    if (problem) {
      warnings.push(`${image.fileName} skipped: ${problem}`);
      return false;
    }
    // Play's own cap. Only checkable here, where the real bytes exist.
    if (image.bytes.length > MAX_PLAY_IMAGE_BYTES) {
      warnings.push(`${image.fileName} skipped: Play caps images at 8 MB and this one is larger`);
      return false;
    }
    return true;
  });

  if (usable.length === 0) {
    throw new StoreRejectedError(
      warnings[0] ?? `None of these artboards fit the ${slotLabel} slot.`
    );
  }
  if (target && usable.length > target.max) {
    throw new StoreRejectedError(
      `Play keeps at most ${target.max} image${target.max === 1 ? '' : 's'} in ${slotLabel}. Select fewer.`
    );
  }

  onProgress?.({ stage: 'authenticating', message: 'Signing in with the service account' });
  const token = await accessToken(credentials);

  onProgress?.({ stage: 'preparing', message: 'Opening a Play Console edit' });
  const editId = await openEdit(credentials);
  const packageName = encodePath(credentials.packageName);
  const language = encodePath(options.language);
  const imageType = encodePath(options.imageType);

  try {
    if (options.replaceExisting) {
      onProgress?.({ stage: 'clearing', message: `Clearing the existing ${slotLabel}` });
      await apiRequest(
        credentials,
        `/applications/${packageName}/edits/${editId}/listings/${language}/${imageType}`,
        { method: 'DELETE' }
      );
    }

    const doFetch = await bridgeFetch();
    for (const [index, image] of usable.entries()) {
      onProgress?.({
        stage: 'uploading',
        message: `Uploading ${image.fileName}`,
        current: index + 1,
        total: usable.length,
      });

      const response = await doFetch(
        `${UPLOAD_BASE}/applications/${packageName}/edits/${editId}/listings/${language}/${imageType}?uploadType=media`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'image/png',
          },
          body: image.bytes as unknown as BodyInit,
        }
      );
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Uploading ${image.fileName} failed: ${describeGoogleError(response.status, text)}`);
      }
    }

    onProgress?.({ stage: 'committing', message: 'Committing the edit' });
    await apiRequest(credentials, `/applications/${packageName}/edits/${editId}:validate`, {
      method: 'POST',
    });

    const commit = async (skipReview: boolean) =>
      apiRequest(
        credentials,
        `/applications/${packageName}/edits/${editId}:commit${skipReview ? '?changesNotSentForReview=true' : ''}`,
        { method: 'POST' }
      );

    try {
      await commit(options.changesNotSentForReview === true);
    } catch (error) {
      // Play refuses to auto-submit for review on some accounts and says so in
      // the error. Retrying with the flag is exactly what it is asking for.
      const message = error instanceof Error ? error.message : '';
      if (!options.changesNotSentForReview && /changesNotSentForReview/i.test(message)) {
        await commit(true);
        warnings.push('Committed without sending for review, which is what Play asked for. Submit the release in Play Console when you are ready.');
      } else {
        throw error;
      }
    }
  } catch (error) {
    await discardEdit(credentials, editId);
    throw error;
  }

  onProgress?.({ stage: 'done', message: 'Done' });

  return {
    uploaded: usable.length,
    warnings,
    reviewUrl: 'https://play.google.com/console',
  };
}
