// Shared plumbing for the cloud providers: an HTTP call that works in both
// builds, and the desktop OAuth loopback.
//
// Why desktop differs from web at all, given the shell is a browser engine:
// the packaged app is served from a custom protocol (tauri://localhost /
// http://tauri.localhost), which Google will not accept as an authorized
// JavaScript origin, and there is no public URL to redirect back to. The
// installed-app loopback flow is the supported answer, and it hands back a
// refresh token so desktop stays signed in across restarts (the browser token
// flow cannot). GitHub additionally serves no CORS headers on its OAuth
// endpoints, so those calls have to leave the webview entirely.

import { isTauri, openExternal } from '@/lib/desktop';
import { AccountCancelledError } from './types';

/**
 * fetch that ignores CORS on desktop. Dynamic import keeps the Tauri HTTP
 * plugin out of the web bundle, mirroring src/lib/desktop.ts and
 * src/lib/ai/freeProviders.ts.
 */
export async function bridgeFetch(): Promise<typeof fetch> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch as typeof fetch;
  }
  return window.fetch.bind(window);
}

/**
 * JSON request with the error body surfaced, since these APIs explain failures
 * well.
 *
 * `no-store` by default, and it is not a micro optimisation in reverse: GitHub
 * serves its REST API with `Cache-Control: private, max-age=60`, so without
 * this the browser answers a GET from its own cache for a minute and the app
 * reads a version of the world that is up to a minute out of date. Three things
 * go wrong with that, in rising order of seriousness:
 *
 *   - the account dialog does not list a project that was just saved, which is
 *     the visible symptom, and "it appears once I open devtools with Disable
 *     cache ticked" is the fingerprint
 *   - a sync reads a stale HEAD sha, which is the same sha it stored, so it
 *     concludes nothing has changed remotely and pushes over a copy that did
 *   - worst: the gist save decides "update or create" from a listing. A second
 *     save inside that minute cannot see the gist the first one created, so it
 *     creates a SECOND gist for the same project
 *
 * Drive is less exposed (its API sends no-store style headers already) but the
 * same rule is right for it, and one place to say so beats two. The cost is a
 * real request every time instead of a possible 304; at the handful of calls
 * this app makes, against a 5000 an hour budget, that is not a cost.
 *
 * The desktop build goes through tauri-plugin-http, which has no browser cache
 * at all, so there it is simply inert.
 */
export async function requestJson<T>(
  url: string,
  init: RequestInit & { fetchImpl?: typeof fetch } = {}
): Promise<T> {
  const { fetchImpl, ...rest } = init;
  const doFetch = fetchImpl ?? (await bridgeFetch());
  const response = await doFetch(url, { cache: 'no-store', ...rest });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(describeHttpError(response.status, text));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function describeHttpError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const message =
      parsed?.error?.message ?? parsed?.error_description ?? parsed?.message ?? parsed?.error;
    if (typeof message === 'string' && message) return `${message} (HTTP ${status})`;
  } catch {
    // Not JSON; fall through to the raw body.
  }
  const trimmed = body.trim().slice(0, 200);
  return trimmed ? `${trimmed} (HTTP ${status})` : `Request failed (HTTP ${status})`;
}

// --- PKCE -------------------------------------------------------------------

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function randomState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- desktop loopback -------------------------------------------------------

export interface LoopbackResult {
  code: string;
  state?: string;
  redirectUri: string;
}

/**
 * Open `buildUrl(redirectUri)` in the system browser and wait for the provider
 * to redirect back to a one-shot local listener.
 *
 * The listener is Rust-side (src-tauri/src/oauth.rs) because a webview cannot
 * bind a socket. Using the real browser also means the user's existing Google
 * session is already there, so consent is usually one click.
 */
export async function runLoopbackFlow(
  buildUrl: (redirectUri: string) => string,
  options: { expectedState?: string; timeoutSecs?: number } = {}
): Promise<LoopbackResult> {
  const { invoke } = await import('@tauri-apps/api/core');

  // Rust binds first and reports the port, so the redirect URI is known before
  // the browser opens and there is no race with the provider's redirect.
  const { port, redirect_uri: redirectUri } = await invoke<{ port: number; redirect_uri: string }>(
    'abs_oauth_start'
  );

  try {
    await openExternal(buildUrl(redirectUri));
    const result = await invoke<{ code?: string; state?: string; error?: string }>(
      'abs_oauth_await',
      { port, timeoutSecs: options.timeoutSecs ?? 300 }
    );

    if (result.error) {
      if (/access_denied/i.test(result.error)) throw new AccountCancelledError();
      throw new Error(result.error);
    }
    if (!result.code) throw new AccountCancelledError('No authorization code came back.');
    if (options.expectedState && result.state !== options.expectedState) {
      throw new Error('The sign-in response did not match this request. Please try again.');
    }
    return { code: result.code, state: result.state, redirectUri };
  } finally {
    // Idempotent; releases the socket if the flow threw before it was consumed.
    try {
      await invoke('abs_oauth_cancel', { port });
    } catch {
      // Already gone.
    }
  }
}

export function formEncode(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}
