// Google Drive: the media-capable target.
//
// Layout in the user's Drive:
//   Open Screenshot Generator/           <- one folder, created on first save
//     <project name>/                    <- one folder per project
//       project.json                     <- the manifest
//       media__<mediaId>                 <- one file per recording
//
// Scope is drive.file only: we can see files this app created and nothing
// else. That keeps us out of Google's sensitive-scope verification (and the
// CASA assessment that comes with it), and means connecting the app cannot
// expose the rest of someone's Drive.
//
// Auth differs by build, for reasons that are about origin, not engine:
//   web     - Google Identity Services token client. No secret, no redirect.
//             Tokens last ~1h and GIS can reissue silently while the user's
//             Google session is alive.
//   desktop - loopback + PKCE via the system browser (see transport.ts).
//             Returns a refresh token, so the sign-in survives restarts.

import { isTauri } from '@/lib/desktop';
import {
  AccountAuthError,
  AccountCancelledError,
  type Account,
  type AccountSession,
  type CloudProvider,
  type CloudProjectSummary,
  type ProgressFn,
  type ProjectBundle,
  type ProjectManifest,
} from '../types';
import { bridgeFetch, createPkcePair, formEncode, randomState, requestJson, runLoopbackFlow } from '../transport';

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const DESKTOP_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID ?? CLIENT_ID;

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SCOPES = `${DRIVE_SCOPE} openid email profile`;

/**
 * Google's consent screen has per-permission checkboxes ("granular consent"),
 * and it hands back a perfectly valid token even when the Drive box was left
 * unticked. Without this check the first Drive call fails with a bare
 * "Request had insufficient authentication scopes", which tells the user
 * nothing about what to do. Fail at sign-in instead, with instructions.
 */
function assertDriveGranted(granted: string | undefined): void {
  // An absent scope field means the provider did not report it; do not block on
  // that, the API call will surface any real problem.
  if (granted && !granted.split(/\s+/).includes(DRIVE_SCOPE)) {
    throw new Error(
      'Drive access was not granted. Sign in again and tick the checkbox that ' +
        'lets the app "see, edit, create and delete only the specific Drive files you use with this app".'
    );
  }
}
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const ROOT_FOLDER_NAME = 'Open Screenshot Generator';
const MEDIA_PREFIX = 'media__';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// --- Google Identity Services (web) -----------------------------------------

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  /** Space-separated list of what the user ACTUALLY granted. */
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
  callback: (response: TokenResponse) => void;
}

interface GoogleIdentityApi {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        prompt?: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done: () => void): void;
    };
  };
}

let gisPromise: Promise<GoogleIdentityApi> | null = null;

function loadGis(): Promise<GoogleIdentityApi> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google sign-in is only available in the browser.'));
      return;
    }
    const existing = (window as unknown as { google?: GoogleIdentityApi }).google;
    if (existing?.accounts?.oauth2) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = (window as unknown as { google?: GoogleIdentityApi }).google;
      if (api?.accounts?.oauth2) resolve(api);
      else reject(new Error('Google sign-in failed to initialize.'));
    };
    script.onerror = () => {
      gisPromise = null; // let a later attempt retry the network load
      reject(new Error('Could not reach Google sign-in. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

/** One access token from GIS. `prompt: ''` reuses consent when we already have it. */
function requestWebToken(
  prompt: string
): Promise<{ token: string; expiresIn: number; scope?: string }> {
  return new Promise((resolve, reject) => {
    loadGis()
      .then((api) => {
        const client = api.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          prompt,
          callback: (response) => {
            if (response.error || !response.access_token) {
              // popup_closed / access_denied are the user backing out, not faults.
              if (/popup_closed|access_denied|user_cancel/i.test(response.error ?? '')) {
                reject(new AccountCancelledError());
              } else {
                reject(new Error(response.error_description ?? response.error ?? 'Google sign-in failed.'));
              }
              return;
            }
            resolve({
              token: response.access_token,
              expiresIn: response.expires_in ?? 3600,
              scope: response.scope,
            });
          },
          error_callback: (error) => {
            if (/popup_closed|popup_failed_to_open/i.test(error.type ?? '')) {
              reject(new AccountCancelledError());
            } else {
              reject(new Error(error.message ?? 'Google sign-in failed.'));
            }
          },
        });
        client.requestAccessToken({ prompt });
      })
      .catch(reject);
  });
}

// --- desktop loopback -------------------------------------------------------

async function signInDesktop(): Promise<AccountSession> {
  const { verifier, challenge } = await createPkcePair();
  const state = randomState();

  const { code, redirectUri } = await runLoopbackFlow(
    (redirect) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${formEncode({
        client_id: DESKTOP_CLIENT_ID,
        redirect_uri: redirect,
        response_type: 'code',
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        // Required to get a refresh token back on the first consent.
        access_type: 'offline',
        prompt: 'consent',
      })}`,
    { expectedState: state }
  );

  const tokens = await requestJson<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      client_id: DESKTOP_CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  const account = await fetchAccount(tokens.access_token);
  return {
    provider: 'google',
    account,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
}

async function refreshDesktopToken(session: AccountSession): Promise<AccountSession> {
  if (!session.refreshToken) throw new AccountAuthError('Your Google sign-in expired.');
  const tokens = await requestJson<{ access_token: string; expires_in?: number }>(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({
        client_id: DESKTOP_CLIENT_ID,
        refresh_token: session.refreshToken,
        grant_type: 'refresh_token',
      }),
    }
  ).catch(() => {
    // A revoked or expired refresh token is unrecoverable; re-prompt.
    throw new AccountAuthError('Your Google sign-in expired. Please connect again.');
  });

  return {
    ...session,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
}

// --- Drive REST -------------------------------------------------------------

async function fetchAccount(accessToken: string): Promise<Account> {
  const info = await requestJson<{
    sub: string;
    name?: string;
    email?: string;
    picture?: string;
  }>('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return {
    id: info.sub,
    name: info.name ?? info.email ?? 'Google account',
    email: info.email,
    avatarUrl: info.picture,
  };
}

function authHeaders(session: AccountSession): Record<string, string> {
  return { Authorization: `Bearer ${session.accessToken}` };
}

/** Map Drive's 401/403 onto the "sign in again" path the UI understands. */
async function driveJson<T>(session: AccountSession, url: string, init: RequestInit = {}): Promise<T> {
  try {
    return await requestJson<T>(url, {
      ...init,
      headers: { ...authHeaders(session), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 401/.test(message)) {
      throw new AccountAuthError('Your Google sign-in expired. Please connect again.');
    }
    // Google's wording for "this token lacks the scope" is opaque, and the only
    // way out is a fresh consent, so say that instead of relaying it.
    if (/insufficient authentication scope|insufficientPermissions|ACCESS_TOKEN_SCOPE/i.test(message)) {
      throw new AccountAuthError(
        'This sign-in did not include Drive access. Sign in again and allow the Drive permission.'
      );
    }
    throw error;
  }
}

async function findOrCreateFolder(
  session: AccountSession,
  name: string,
  parentId?: string
): Promise<string> {
  const clauses = [
    `name = '${escapeQuery(name)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ];
  const query = encodeURIComponent(clauses.join(' and '));
  const found = await driveJson<{ files: { id: string }[] }>(
    session,
    `${DRIVE_API}/files?q=${query}&fields=files(id)&pageSize=1`
  );
  if (found.files?.[0]) return found.files[0].id;

  const created = await driveJson<{ id: string }>(session, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : undefined,
    }),
  });
  return created.id;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Upload (or replace) one file via a multipart request. */
async function uploadFile(
  session: AccountSession,
  options: {
    name: string;
    parentId: string;
    blob: Blob;
    mimeType: string;
    existingId?: string;
    appProperties?: Record<string, string>;
  }
): Promise<string> {
  const metadata: Record<string, unknown> = { name: options.name };
  if (!options.existingId) metadata.parents = [options.parentId];
  if (options.appProperties) metadata.appProperties = options.appProperties;

  const boundary = `abs${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${options.mimeType}\r\n\r\n`,
    options.blob,
    `\r\n--${boundary}--\r\n`,
  ]);

  const url = options.existingId
    ? `${DRIVE_UPLOAD}/${options.existingId}?uploadType=multipart&fields=id`
    : `${DRIVE_UPLOAD}?uploadType=multipart&fields=id`;

  const result = await driveJson<{ id: string }>(session, url, {
    method: options.existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return result.id;
}

async function listChildren(
  session: AccountSession,
  parentId: string
): Promise<{ id: string; name: string; size?: string }[]> {
  const query = encodeURIComponent(`'${parentId}' in parents and trashed = false`);
  const result = await driveJson<{ files: { id: string; name: string; size?: string }[] }>(
    session,
    `${DRIVE_API}/files?q=${query}&fields=files(id,name,size)&pageSize=200`
  );
  return result.files ?? [];
}

async function downloadBlob(session: AccountSession, fileId: string): Promise<Blob> {
  const doFetch = await bridgeFetch();
  const response = await doFetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: authHeaders(session),
  });
  if (!response.ok) {
    if (response.status === 401) throw new AccountAuthError('Your Google sign-in expired.');
    throw new Error(`Could not download from Drive (HTTP ${response.status}).`);
  }
  return response.blob();
}

// --- provider ---------------------------------------------------------------

export const googleDriveProvider: CloudProvider = {
  id: 'google',
  label: 'Google',
  supportsMedia: true,
  configHint:
    'Google sign-in needs NEXT_PUBLIC_GOOGLE_CLIENT_ID to be set at build time. See docs/ACCOUNT-SYNC.md.',

  isConfigured() {
    return !!(isTauri() ? DESKTOP_CLIENT_ID : CLIENT_ID);
  },

  async signIn(): Promise<AccountSession> {
    if (!this.isConfigured()) throw new Error(this.configHint);
    if (isTauri()) return signInDesktop();

    const { token, expiresIn, scope } = await requestWebToken('consent');
    assertDriveGranted(scope);
    const account = await fetchAccount(token);
    return {
      provider: 'google',
      account,
      accessToken: token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  },

  async signOut(session: AccountSession): Promise<void> {
    try {
      if (!isTauri()) {
        const api = await loadGis();
        await new Promise<void>((resolve) => api.accounts.oauth2.revoke(session.accessToken, resolve));
        return;
      }
      await requestJson('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({ token: session.refreshToken ?? session.accessToken }),
      });
    } catch {
      // Revocation is best effort; the local session is cleared regardless.
    }
  },

  async ensureFreshSession(session: AccountSession): Promise<AccountSession> {
    const stillValid = session.expiresAt && session.expiresAt - Date.now() > 60_000;
    if (stillValid) return session;

    if (isTauri()) return refreshDesktopToken(session);

    // Web has no refresh token: ask GIS for a new one without a prompt. This
    // works while the user's Google session is alive, which is the common case.
    try {
      const { token, expiresIn, scope } = await requestWebToken('');
      assertDriveGranted(scope);
      return { ...session, accessToken: token, expiresAt: Date.now() + expiresIn * 1000 };
    } catch (error) {
      if (error instanceof AccountCancelledError) throw error;
      throw new AccountAuthError('Your Google sign-in expired. Please connect again.');
    }
  },

  async listProjects(session: AccountSession): Promise<CloudProjectSummary[]> {
    const rootId = await findOrCreateFolder(session, ROOT_FOLDER_NAME);
    const query = encodeURIComponent(
      `'${rootId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`
    );
    const result = await driveJson<{
      files: { id: string; name: string; modifiedTime: string; appProperties?: Record<string, string> }[];
    }>(session, `${DRIVE_API}/files?q=${query}&fields=files(id,name,modifiedTime,appProperties)&orderBy=modifiedTime desc&pageSize=100`);

    return (result.files ?? []).map((file) => ({
      remoteId: file.id,
      projectId: file.appProperties?.absProjectId ?? file.id,
      name: file.name,
      modifiedAt: new Date(file.modifiedTime),
    }));
  },

  async saveProject(
    session: AccountSession,
    bundle: ProjectBundle,
    onProgress?: ProgressFn
  ): Promise<CloudProjectSummary> {
    onProgress?.('Opening your Drive folder', 0);
    const rootId = await findOrCreateFolder(session, ROOT_FOLDER_NAME);

    // Match on our project id, not the folder name, so renaming a project in
    // the app updates the same folder instead of orphaning it.
    const query = encodeURIComponent(
      `'${rootId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='absProjectId' and value='${escapeQuery(bundle.manifest.id)}' }`
    );
    const existing = await driveJson<{ files: { id: string }[] }>(
      session,
      `${DRIVE_API}/files?q=${query}&fields=files(id)&pageSize=1`
    );

    let folderId = existing.files?.[0]?.id;
    if (folderId) {
      await driveJson(session, `${DRIVE_API}/files/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: bundle.manifest.name }),
      });
    } else {
      const created = await driveJson<{ id: string }>(session, `${DRIVE_API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: bundle.manifest.name,
          mimeType: FOLDER_MIME,
          parents: [rootId],
          appProperties: { absProjectId: bundle.manifest.id },
        }),
      });
      folderId = created.id;
    }

    const children = await listChildren(session, folderId);
    const byName = new Map(children.map((child) => [child.name, child.id]));

    const total = bundle.media.length + 1;
    onProgress?.('Uploading project', 1 / total);
    await uploadFile(session, {
      name: 'project.json',
      parentId: folderId,
      blob: new Blob([JSON.stringify(bundle.manifest)], { type: 'application/json' }),
      mimeType: 'application/json',
      existingId: byName.get('project.json'),
    });

    for (const [index, item] of bundle.media.entries()) {
      const fileName = `${MEDIA_PREFIX}${item.meta.id}`;
      // Same id means the same recording, so skip anything already uploaded.
      if (byName.has(fileName)) continue;
      onProgress?.(`Uploading media ${index + 1} of ${bundle.media.length}`, (index + 2) / total);
      await uploadFile(session, {
        name: fileName,
        parentId: folderId,
        blob: item.blob,
        mimeType: item.meta.mimeType || 'application/octet-stream',
      });
    }

    // Drop blobs the project no longer references so Drive does not accumulate
    // dead recordings across saves.
    const keep = new Set(bundle.media.map((item) => `${MEDIA_PREFIX}${item.meta.id}`));
    for (const child of children) {
      if (child.name.startsWith(MEDIA_PREFIX) && !keep.has(child.name)) {
        await driveJson(session, `${DRIVE_API}/files/${child.id}`, { method: 'DELETE' }).catch(() => {});
      }
    }

    onProgress?.('Saved', 1);
    return {
      remoteId: folderId,
      projectId: bundle.manifest.id,
      name: bundle.manifest.name,
      modifiedAt: new Date(),
    };
  },

  async loadProject(
    session: AccountSession,
    remoteId: string,
    onProgress?: ProgressFn
  ): Promise<ProjectBundle> {
    onProgress?.('Opening project', 0);
    const children = await listChildren(session, remoteId);
    const manifestFile = children.find((child) => child.name === 'project.json');
    if (!manifestFile) throw new Error('This Drive folder has no project.json.');

    const manifestBlob = await downloadBlob(session, manifestFile.id);
    const manifest = JSON.parse(await manifestBlob.text()) as ProjectManifest;

    const media: ProjectBundle['media'] = [];
    const metas = manifest.media ?? [];
    for (const [index, meta] of metas.entries()) {
      const file = children.find((child) => child.name === `${MEDIA_PREFIX}${meta.id}`);
      if (!file) continue; // uploaded from a build that skipped media
      onProgress?.(`Downloading media ${index + 1} of ${metas.length}`, (index + 1) / (metas.length + 1));
      media.push({ meta, blob: await downloadBlob(session, file.id) });
    }

    onProgress?.('Loaded', 1);
    return { manifest, media };
  },

  async deleteProject(session: AccountSession, remoteId: string): Promise<void> {
    await driveJson(session, `${DRIVE_API}/files/${remoteId}`, { method: 'DELETE' });
  },
};
