// GitHub: one secret gist per project.
//
// Gists hold text, not binaries, so this provider stores the manifest only.
// Projects whose artwork is inline (the normal case) round-trip perfectly;
// projects carrying screen recordings are refused with a pointer at Drive,
// because silently dropping a 40MB recording would be worse than not saving.
//
// Auth differs by build for a reason unrelated to the webview engine:
//   web     - a popup sign-in brokered by the Cloudflare Worker in
//             workers/github-oauth. GitHub's token exchange needs a client
//             secret and its OAuth endpoints send no CORS headers, so the
//             browser cannot finish the flow alone; the Worker holds the
//             secret and does nothing else. With no Worker configured this
//             falls back to a pasted token, which still works.
//   desktop - the real device flow, which needs no secret at all. Requests go
//             through the Tauri HTTP bridge, which is not subject to CORS.
//
// The gist REST API itself (api.github.com) does send CORS headers, so reads
// and writes work from the browser once a token exists.

import { isTauri } from '@/lib/desktop';
import {
  AccountAuthError,
  AccountBlockedError,
  AccountCancelledError,
  type AccountSaveOptions,
  type Account,
  type AccountSession,
  type CloudProvider,
  type CloudProjectSummary,
  type ProgressFn,
  type ProjectBundle,
  type ProjectManifest,
  type SignInOptions,
} from '../types';
import { bridgeFetch, formEncode, randomState, requestJson } from '../transport';
import {
  decodeFontPayloads,
  encodeFontPayloads,
  fontBytes,
  formatBytes,
  mediaBytes,
} from '../projectBundle';

const CLIENT_ID = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID ?? '';
/** Base URL of the sign-in Worker. Empty = fall back to a pasted token. */
const OAUTH_PROXY = (process.env.NEXT_PUBLIC_GITHUB_OAUTH_PROXY ?? '').replace(/\/$/, '');
/** Must match MESSAGE_SOURCE in workers/github-oauth/src/index.js. */
const MESSAGE_SOURCE = 'abs-github-oauth';
const API = 'https://api.github.com';
const MANIFEST_FILE = 'project.json';
/**
 * Imported fonts, base64 in their own gist file. A gist holds text only, which
 * rules out video, but a font is small enough to survive the encoding, and
 * keeping it out of project.json means the manifest stays readable in GitHub's
 * viewer. Absent unless the project uses an imported family.
 */
const FONTS_FILE = 'fonts.json';
/** Past this, a gist is the wrong home for the payload. */
/**
 * Ceiling on imported fonts, measured on the RAW blobs.
 *
 * A gist carries them base64 encoded, which is four bytes on the wire for every
 * three of font, so the raw figure the user is shown has to be compared against
 * three quarters of the real limit or the guard passes a payload GitHub then
 * refuses.
 */
const MAX_GIST_FONT_BYTES = 10 * 1024 * 1024;
const MAX_GIST_RAW_FONT_BYTES = Math.floor((MAX_GIST_FONT_BYTES * 3) / 4);
/** Marks a gist as ours, and carries the project id so re-saves overwrite. */
const DESCRIPTION_TAG = '[open-screenshot-generator]';
const API_VERSION_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

function authHeaders(session: AccountSession): Record<string, string> {
  return { ...API_VERSION_HEADERS, Authorization: `Bearer ${session.accessToken}` };
}

async function githubJson<T>(
  session: AccountSession,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  try {
    return await requestJson<T>(`${API}${path}`, {
      ...init,
      headers: { ...authHeaders(session), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 401/.test(message)) {
      throw new AccountAuthError('Your GitHub token is no longer valid. Please connect again.');
    }
    if (/HTTP 403/.test(message) && /rate limit/i.test(message)) {
      throw new Error('GitHub rate limit reached. Try again in a few minutes.');
    }
    if (/HTTP 404/.test(message)) {
      throw new Error('That gist no longer exists, or the token cannot see it (needs gist access).');
    }
    throw error;
  }
}

async function fetchAccount(accessToken: string): Promise<Account> {
  const user = await requestJson<{ id: number; login: string; name?: string; email?: string; avatar_url?: string }>(
    `${API}/user`,
    { headers: { ...API_VERSION_HEADERS, Authorization: `Bearer ${accessToken}` } }
  ).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 401/.test(message)) throw new AccountAuthError('That GitHub token was rejected.');
    throw error;
  });

  return {
    id: String(user.id),
    name: user.name || user.login,
    email: user.email ?? undefined,
    avatarUrl: user.avatar_url,
  };
}

// --- web popup sign-in ------------------------------------------------------

/** True when a sign-in Worker is configured, so the web build can show a real button. */
export function hasGithubLogin(): boolean {
  return !!OAUTH_PROXY;
}

function encodeState(payload: { n: string; o: string }): string {
  return btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Open GitHub in a popup and wait for the Worker to post the token back.
 *
 * A popup rather than a full-page redirect: this is an editor, and navigating
 * the whole tab away would throw out whatever the user has on the canvas.
 */
function signInWebPopup(options: SignInOptions = {}): Promise<AccountSession> {
  return new Promise((resolve, reject) => {
    const nonce = randomState();
    const state = encodeState({ n: nonce, o: window.location.origin });
    const proxyOrigin = new URL(OAUTH_PROXY).origin;

    const opened = window.open(
      `${OAUTH_PROXY}/start?state=${encodeURIComponent(state)}`,
      'abs-github-signin',
      'width=620,height=780,menubar=no,toolbar=no'
    );
    if (!opened) {
      reject(new Error('Your browser blocked the sign-in window. Allow popups for this site and try again.'));
      return;
    }
    // Bound to a non-nullable local so the callbacks below can use it.
    const popup = opened;

    let settled = false;
    // Set the moment a usable message arrives. The popup closes itself right
    // after posting, so without this the "did the user close it?" watchdog
    // races the account lookup and reports a cancellation on every success.
    let resultInFlight = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    function onMessage(event: MessageEvent) {
      // Only the Worker may deliver a token, and only for the sign-in we started.
      if (event.origin !== proxyOrigin) return;
      const data = event.data as { source?: string; nonce?: string; token?: string; error?: string };
      if (data?.source !== MESSAGE_SOURCE || data.nonce !== nonce) return;
      resultInFlight = true;

      if (data.error) {
        finish(() =>
          /denied|cancel/i.test(data.error!)
            ? reject(new AccountCancelledError('GitHub access was declined.'))
            : reject(new Error(data.error!))
        );
        return;
      }
      if (!data.token) {
        finish(() => reject(new Error('GitHub did not return a token.')));
        return;
      }
      const token = data.token;
      fetchAccount(token).then(
        (account) => finish(() => resolve({ provider: 'github', account, accessToken: token })),
        (error) => finish(() => reject(error))
      );
    }

    function onAbort() {
      finish(() => {
        popup.close();
        reject(new AccountCancelledError());
      });
    }

    // The popup cannot tell us it was dismissed, so watch for it disappearing.
    // A close that follows a delivered token is the normal ending, not a cancel.
    const closedTimer = setInterval(() => {
      if (popup.closed && !resultInFlight) finish(() => reject(new AccountCancelledError()));
    }, 500);

    const timeout = setTimeout(() => {
      finish(() => {
        popup.close();
        reject(new Error('The sign-in window timed out. Please try again.'));
      });
    }, 5 * 60 * 1000);

    window.addEventListener('message', onMessage);
    options.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// --- desktop device flow ----------------------------------------------------

async function signInDesktop(options: SignInOptions = {}): Promise<AccountSession> {
  if (!CLIENT_ID) throw new Error('GitHub device sign-in needs NEXT_PUBLIC_GITHUB_CLIENT_ID.');

  const start = await requestJson<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }>('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formEncode({ client_id: CLIENT_ID, scope: 'gist' }),
  });

  options.onUserCode?.({ userCode: start.user_code, verificationUri: start.verification_uri });

  const deadline = Date.now() + start.expires_in * 1000;
  let intervalMs = Math.max(start.interval, 5) * 1000;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new AccountCancelledError();
    await sleep(intervalMs, options.signal);

    const poll = await requestJson<{
      access_token?: string;
      error?: string;
      interval?: number;
    }>('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formEncode({
        client_id: CLIENT_ID,
        device_code: start.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (poll.access_token) {
      const account = await fetchAccount(poll.access_token);
      return { provider: 'github', account, accessToken: poll.access_token };
    }
    switch (poll.error) {
      case 'authorization_pending':
        break; // keep waiting
      case 'slow_down':
        intervalMs += (poll.interval ?? 5) * 1000;
        break;
      case 'access_denied':
        throw new AccountCancelledError('GitHub access was declined.');
      case 'expired_token':
        throw new Error('The sign-in code expired. Please try again.');
      default:
        if (poll.error) throw new Error(`GitHub sign-in failed: ${poll.error}`);
    }
  }
  throw new Error('The sign-in code expired. Please try again.');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new AccountCancelledError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// --- gist helpers -----------------------------------------------------------

interface GistFile {
  filename: string;
  size?: number;
  truncated?: boolean;
  content?: string;
  raw_url?: string;
}

interface Gist {
  id: string;
  description?: string;
  updated_at: string;
  files: Record<string, GistFile>;
  /**
   * Revisions, newest first, on a single gist read. Absent from the list
   * endpoint, so it is only ever there after `GET /gists/{id}`, and it is the
   * fallback for the stamp when the commits endpoint cannot be reached.
   */
  history?: { version: string; committed_at?: string }[];
}

function describe(manifest: ProjectManifest): string {
  return `${manifest.name} ${DESCRIPTION_TAG}#${manifest.id}`;
}

function projectIdOf(gist: Gist): string | null {
  const match = gist.description?.match(/\[open-screenshot-generator\]#(.+)$/);
  return match ? match[1] : null;
}

function nameOf(gist: Gist): string {
  const description = gist.description ?? '';
  const index = description.indexOf(DESCRIPTION_TAG);
  const name = index > 0 ? description.slice(0, index).trim() : description;
  return name || 'Untitled project';
}

/**
 * Gist responses truncate files over ~1MB, and a project with inlined images
 * clears that easily, so fall back to the raw URL when GitHub says so.
 */
/**
 * Every gist on the account, following GitHub's paging to the end.
 *
 * The same correctness point the Drive listing makes, and it is not about
 * speed: a truncated list makes `findAccountProject` answer "not saved" for a
 * project that IS saved, so the overwrite prompt is skipped, and the lookup
 * inside `saveProject` then POSTs a SECOND gist on top of the first. The user
 * who is most exposed is the one with the most gists.
 *
 * `githubJson` hands back only the parsed body, so there is no Link header to
 * follow: stop on a short page. The upper bound is a backstop, not a limit
 * anybody should reach.
 */
async function listOwnGists(session: AccountSession): Promise<Gist[]> {
  const all: Gist[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubJson<Gist[]>(session, `/gists?per_page=100&page=${page}`);
    if (!batch?.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function readGistFile(file: GistFile): Promise<string> {
  if (file.content && !file.truncated) return file.content;
  if (!file.raw_url) throw new Error('This gist is missing its project data.');
  const doFetch = await bridgeFetch();
  // Same reason requestJson sets it: a raw gist URL is served cacheable, and a
  // stale one here means opening the document as it was, not as it is.
  const response = await doFetch(file.raw_url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not read the gist contents (HTTP ${response.status}).`);
  return response.text();
}

// --- provider ---------------------------------------------------------------

export const githubProvider: CloudProvider = {
  id: 'github',
  label: 'GitHub',
  supportsMedia: false,
  configHint: 'GitHub device sign-in needs NEXT_PUBLIC_GITHUB_CLIENT_ID. See docs/ACCOUNT-SYNC.md.',

  isConfigured() {
    // Web always works: with a Worker it is a real login, without one the user
    // can still paste a token.
    return isTauri() ? !!CLIENT_ID : true;
  },

  async signIn(options: SignInOptions = {}): Promise<AccountSession> {
    if (isTauri() && CLIENT_ID) return signInDesktop(options);

    // A pasted token always wins when one is supplied, so the fallback stays
    // available even where the Worker is configured.
    const token = options.token?.trim();
    if (token) {
      const account = await fetchAccount(token);
      return { provider: 'github', account, accessToken: token };
    }

    if (!isTauri() && hasGithubLogin()) return signInWebPopup(options);
    throw new Error('Paste a GitHub token with gist access to continue.');
  },

  async signOut(): Promise<void> {
    // Nothing to revoke: a PAT is owned by the user and a device-flow grant is
    // revoked from GitHub settings. Clearing the local session is enough.
  },

  async ensureFreshSession(session: AccountSession): Promise<AccountSession> {
    return session; // GitHub tokens here do not expire on a timer
  },

  async listProjects(session: AccountSession): Promise<CloudProjectSummary[]> {
    const gists = await listOwnGists(session);
    return gists
      .filter((gist) => gist.description?.includes(DESCRIPTION_TAG))
      .map((gist) => ({
        remoteId: gist.id,
        projectId: projectIdOf(gist) ?? gist.id,
        name: nameOf(gist),
        modifiedAt: new Date(gist.updated_at),
        size: gist.files?.[MANIFEST_FILE]?.size,
      }));
  },

  async saveProject(
    session: AccountSession,
    bundle: ProjectBundle,
    onProgress?: ProgressFn,
    options: AccountSaveOptions = {}
  ): Promise<CloudProjectSummary> {
    // A gist holds text and nothing else, so this refusal is the feature: it is
    // the difference between telling somebody their recording cannot go here
    // and silently saving a project whose video elements are dead on the other
    // side. Worded by what is actually in the bundle, because a media row is as
    // often an uploaded screenshot as it is a recording, and being told to move
    // to Drive because of "video" you never added reads as a bug.
    if (bundle.media.length) {
      const videos = bundle.media.filter((item) => item.meta.mimeType.startsWith('video/')).length;
      const what =
        videos === bundle.media.length
          ? `${videos} recording${videos > 1 ? 's' : ''}`
          : videos === 0
            ? `${bundle.media.length} uploaded image${bundle.media.length > 1 ? 's' : ''}`
            : `${bundle.media.length} uploaded file${bundle.media.length > 1 ? 's' : ''}`;
      throw new AccountBlockedError(
        `This project has ${what} (${formatBytes(mediaBytes(bundle))}). Gists hold text only. ` +
          'Connect Google Drive to save it with them'
      );
    }

    if (fontBytes(bundle) > MAX_GIST_RAW_FONT_BYTES) {
      throw new AccountBlockedError(
        `This project's imported fonts come to ${formatBytes(fontBytes(bundle))}. ` +
          'That is too much for a gist. Connect Google Drive to save it with its fonts'
      );
    }

    // With the gist already known there is nothing to look up, which also
    // removes the case where a user with more than 100 gists falls off the end
    // of this listing and a second copy of their project is created instead.
    let existing: Gist | undefined;
    if (options.knownRemoteId) {
      existing = { id: options.knownRemoteId, updated_at: '', files: {} };
    } else {
      onProgress?.('Looking for an existing gist', 0.1);
      const gists = await listOwnGists(session);
      existing = gists.find((gist) => projectIdOf(gist) === bundle.manifest.id);
    }

    const files: Record<string, { content: string } | null> = {
      [MANIFEST_FILE]: { content: JSON.stringify(bundle.manifest) },
    };
    if (bundle.fonts.length) {
      onProgress?.('Encoding fonts', 0.3);
      files[FONTS_FILE] = {
        content: JSON.stringify({ fontData: await encodeFontPayloads(bundle.fonts) }),
      };
    } else if (existing?.files?.[FONTS_FILE]) {
      // The project dropped its last imported font; null deletes the file.
      // Only reachable when the gist was actually read: the knownRemoteId fast
      // path carries no file list, so a font removal is tidied up by the next
      // save that goes the long way rather than by an unattended one.
      files[FONTS_FILE] = null;
    }

    const payload = { description: describe(bundle.manifest), files };

    onProgress?.('Uploading project', 0.5);
    const saved = existing
      ? await githubJson<Gist>(session, `/gists/${existing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await githubJson<Gist>(session, '/gists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, public: false }),
        });

    onProgress?.('Saved', 1);
    // Every gist write is a git commit, so the sha of the one just made is the
    // stamp. The write response normally carries it at the front of `history`
    // and it costs nothing; the follow up read is the fallback for when it does
    // not, and it is worth the extra request because a null stamp here is not a
    // small loss: it would leave `link.stamp` null forever, and the conflict
    // check is written to skip a null rather than block on one, so GitHub would
    // silently degrade to last writer wins.
    let stamp = saved.history?.[0]?.version ?? null;
    if (!stamp) {
      stamp =
        (await githubJson<{ version: string }[]>(session, `/gists/${saved.id}/commits?per_page=1`)
          .then((commits) => commits?.[0]?.version ?? null)
          .catch(() => null));
    }
    return {
      remoteId: saved.id,
      projectId: bundle.manifest.id,
      name: bundle.manifest.name,
      modifiedAt: new Date(saved.updated_at ?? Date.now()),
      stamp,
    };
  },

  /**
   * The gist's HEAD revision sha.
   *
   * Two ways to the same answer, and the commits endpoint is asked first
   * because it is the one that stays small: a gist edited all day has a long
   * history, and `GET /gists/{id}` would carry the whole document back with it
   * every time this is called. GitHub does not document the ordering of
   * /commits, so this was checked against a live gist rather than read out of
   * the docs: `per_page=1` returns the newest, matching `history[0]`.
   *
   * Like Drive, this can only notice a clobber, never prevent one. A gist PATCH
   * accepts no precondition, so read-then-write is a race with a real window.
   */
  async readRemoteStamp(
    session: AccountSession,
    remote: { remoteId: string }
  ): Promise<{ stamp: string; modifiedAt: Date } | null> {
    try {
      const commits = await githubJson<{ version: string; committed_at?: string }[]>(
        session,
        `/gists/${remote.remoteId}/commits?per_page=1`
      );
      const head = commits?.[0];
      if (head?.version) {
        return {
          stamp: head.version,
          modifiedAt: head.committed_at ? new Date(head.committed_at) : new Date(),
        };
      }
      const gist = await githubJson<Gist>(session, `/gists/${remote.remoteId}`);
      const first = gist.history?.[0];
      if (!first?.version) return null;
      return { stamp: first.version, modifiedAt: new Date(gist.updated_at || Date.now()) };
    } catch (error) {
      if (error instanceof AccountAuthError) throw error;
      // githubJson turns a 404 into its own sentence, so match on that too.
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP 404|no longer exists/.test(message)) return null;
      throw error;
    }
  },

  async loadProject(
    session: AccountSession,
    remoteId: string,
    onProgress?: ProgressFn
  ): Promise<ProjectBundle> {
    onProgress?.('Downloading project', 0.3);
    const gist = await githubJson<Gist>(session, `/gists/${remoteId}`);
    const file = gist.files?.[MANIFEST_FILE];
    if (!file) throw new Error('This gist does not contain a project.');

    const manifest = JSON.parse(await readGistFile(file)) as ProjectManifest;

    // Absent on gists written before fonts travelled, and on projects that only
    // use built-in families.
    let fonts: ProjectBundle['fonts'] = [];
    const fontsFile = gist.files?.[FONTS_FILE];
    if (fontsFile && manifest.fonts?.length) {
      onProgress?.('Downloading fonts', 0.6);
      try {
        const parsed = JSON.parse(await readGistFile(fontsFile)) as {
          fontData?: Record<string, string>;
        };
        fonts = decodeFontPayloads(manifest.fonts, parsed.fontData);
      } catch (error) {
        // A project that opens with the wrong typeface beats one that does not
        // open at all.
        console.error('Could not read the fonts stored with this gist', error);
      }
    }

    onProgress?.('Loaded', 1);
    return { manifest, media: [], fonts, missingMedia: [] };
  },

  async deleteProject(session: AccountSession, remoteId: string): Promise<void> {
    await githubJson(session, `/gists/${remoteId}`, { method: 'DELETE' });
  },
};
