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

/** JSON request with the error body surfaced, since these APIs explain failures well. */
export async function requestJson<T>(
  url: string,
  init: RequestInit & { fetchImpl?: typeof fetch } = {}
): Promise<T> {
  const { fetchImpl, ...rest } = init;
  const doFetch = fetchImpl ?? (await bridgeFetch());
  const response = await doFetch(url, rest);
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
