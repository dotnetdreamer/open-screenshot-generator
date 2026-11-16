// Apple Ads, for one thing only: how often people search a word on the App
// Store, in each country (popularity.ts). Growth reads that and nothing else.
// It never makes or changes an ad, so it never spends money.
//
// The Apple Ads Platform API (api.ads.apple.com/v1) signs in a machine much
// as App Store Connect does, with a self-signed ES256 token, plus one step:
// the token is a "client secret" that appleid.apple.com trades for an access
// token good for an hour. That trade answers no web page (its OPTIONS answer
// carried no Access-Control-Allow-Origin on 2026-11-15), so popularity works
// in the desktop app only, through tauri-plugin-http.
//
// The key is an EC P-256 pair. The private half stays on this computer, in
// localStorage, as the store keys do (src/lib/publish/credentials.ts). The
// public half is pasted into Apple Ads, which answers with a client id, a
// team id and a key id. The app can make the pair itself (generateEcKeyPair),
// so nobody has to run OpenSSL, and the pair is kept as a draft from the
// moment it is made, so closing the dialog half way loses nothing.
//
// Every request names an ad account (the X-AP-Context header). Any account
// the user can read works for popularity, so the first one is used unless
// the user picks another.

import { useEffect, useState } from 'react';
import { appleNow, noteAppleClock } from '@/lib/publish/appStoreConnect';
import { createAppleAdsClientSecret } from '@/lib/publish/jwt';
import { fetchWithStop, pause, retryAfter } from './http';

const STORAGE_KEY = 'open-screenshot-generator.apple-ads';
const TOKEN_URL = 'https://appleid.apple.com/auth/oauth2/token';
const API_URL = 'https://api.ads.apple.com/v1';

/** Where the user signs in to Apple Ads, to save the public key under Account Settings, then API. */
export const APPLE_ADS_URL = 'https://ads.apple.com';
/** Apple's own guide to the key, for the details the dialog leaves out. */
export const APPLE_ADS_GUIDE_URL = 'https://developer.apple.com/documentation/apple-ads-platform-api/implementing-oauth-for-the-apple-ads-platform-api';

// --- what is kept ----------------------------------------------------------------

export interface AppleAdsKey {
  clientId: string;
  teamId: string;
  keyId: string;
  /** PKCS#8, or the "EC PRIVATE KEY" OpenSSL writes. */
  privateKeyPem: string;
  /** Kept when the app made the pair, so Setup can show it again. */
  publicKeyPem?: string;
}

export interface AppleAdsAccount {
  id: string;
  name: string;
  roles: string[];
}

export interface AppleAdsSetup {
  key?: AppleAdsKey;
  /** The ad account every request is scoped to. */
  account?: AppleAdsAccount;
  /** A pair made here whose public half may not be in Apple Ads yet. */
  draft?: { privateKeyPem: string; publicKeyPem: string; madeAt: number };
}

let current: AppleAdsSetup | null = null;
const listeners = new Set<() => void>();
let listening = false;
/** False once a save to localStorage failed: then the copy in memory is the only one, and storage is not read again. */
let storageWorks = true;

function read(): AppleAdsSetup {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AppleAdsSetup) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** A key saved in another editor window arrives as a `storage` event. */
function listenAcrossWindows(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = read();
    listeners.forEach((listener) => listener());
  });
}

export function getAppleAdsSetup(): AppleAdsSetup {
  listenAcrossWindows();
  if (!current) current = read();
  return current;
}

/**
 * The setup as stored right now. A window learns of another window's change
 * only from a storage event, which can be missed, so code that acts on the
 * setup after waiting (for Apple, or for the database) reads it this way.
 * A difference from the copy in memory replaces it and tells the screens.
 */
export function freshAppleAdsSetup(): AppleAdsSetup {
  listenAcrossWindows();
  if (!storageWorks) return getAppleAdsSetup();
  const stored = read();
  if (!current) {
    current = stored;
  } else if (JSON.stringify(stored) !== JSON.stringify(current)) {
    current = stored;
    listeners.forEach((listener) => listener());
  }
  return current;
}

/** Which key something belongs to, such as a list of ad accounts: the same three IDs and private key. */
export function appleAdsKeyStamp(key: AppleAdsKey | null | undefined): string | null {
  return key ? JSON.stringify([key.clientId, key.teamId, key.keyId, key.privateKeyPem]) : null;
}

/** A fingerprint of the stored setup, to tell later whether anything changed it meanwhile. */
export function appleAdsSetupStamp(): string {
  return JSON.stringify(freshAppleAdsSetup());
}

/** Change what is kept, on top of what is stored now (never an old copy). Null fields are removed. */
export function setAppleAdsSetup(patch: { [K in keyof AppleAdsSetup]?: AppleAdsSetup[K] | null }): void {
  const next: AppleAdsSetup = { ...freshAppleAdsSetup() };
  for (const [field, value] of Object.entries(patch) as Array<[keyof AppleAdsSetup, unknown]>) {
    if (value === null || value === undefined) delete next[field];
    else (next as Record<string, unknown>)[field] = value;
  }
  current = next;
  try {
    if (!next.key && !next.account && !next.draft) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the key lasts until reload.
    storageWorks = false;
  }
  listeners.forEach((listener) => listener());
}

export function subscribeAppleAdsSetup(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Connected: a key and the ad account it reads through. */
export function isAppleAdsConnected(setup: AppleAdsSetup = getAppleAdsSetup()): setup is AppleAdsSetup & { key: AppleAdsKey; account: AppleAdsAccount } {
  return !!setup.key && !!setup.account;
}

/** What is kept, re-rendering on change; empty until mounted so the static export never mismatches. */
export function useAppleAdsSetup(): AppleAdsSetup {
  const [setup, setSetup] = useState<AppleAdsSetup>({});
  useEffect(() => {
    setSetup(getAppleAdsSetup());
    return subscribeAppleAdsSetup(() => setSetup({ ...getAppleAdsSetup() }));
  }, []);
  return setup;
}

// --- the three ids Apple Ads shows ------------------------------------------------

export type AppleAdsIds = Partial<Pick<AppleAdsKey, 'clientId' | 'teamId' | 'keyId'>>;

const ID_PATTERNS: Record<keyof AppleAdsIds, RegExp> = {
  clientId: /\bclient[\s_-]?id\b["'\s]*[:=]?["'\s]*([A-Za-z0-9][A-Za-z0-9._-]*)/i,
  teamId: /\bteam[\s_-]?id\b["'\s]*[:=]?["'\s]*([A-Za-z0-9][A-Za-z0-9._-]*)/i,
  keyId: /\bkey[\s_-]?id\b["'\s]*[:=]?["'\s]*([A-Za-z0-9][A-Za-z0-9._-]*)/i,
};

/**
 * The client id, team id and key id in what the user pasted. Apple Ads shows
 * them as three lines, "clientId SEARCHADS.…", "teamId SEARCHADS.…" and
 * "keyId …", after the public key is saved; JSON and "key: value" lines are
 * read too.
 */
export function parseAppleAdsIds(text: string): AppleAdsIds {
  const out: AppleAdsIds = {};
  for (const [field, pattern] of Object.entries(ID_PATTERNS) as Array<[keyof AppleAdsIds, RegExp]>) {
    const value = pattern.exec(text)?.[1];
    if (value) out[field] = value;
  }
  return out;
}

export function hasAllIds(ids: AppleAdsIds): ids is Required<AppleAdsIds> {
  return !!ids.clientId && !!ids.teamId && !!ids.keyId;
}

// --- requests ---------------------------------------------------------------------

/** What went wrong, in a sentence for the screen, and which kind of thing it was. */
export class AppleAdsError extends Error {
  constructor(
    message: string,
    readonly kind: 'key' | 'access' | 'account' | 'limit' | 'request' | 'network',
    readonly status?: number
  ) {
    super(message);
    this.name = 'AppleAdsError';
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (error as Error)?.name === 'AbortError' || !!signal?.aborted;
}

/** Apple's own words for a refusal, from either of the error shapes its servers send. */
export function appleAdsMessage(text: string): string | null {
  try {
    const body = JSON.parse(text) as {
      message?: string;
      error?: string | { message?: string | null; details?: Array<{ message?: string | null }>; errors?: Array<{ message?: string | null }> };
      error_description?: string;
    };
    if (typeof body.error === 'object' && body.error) {
      return body.error.details?.find((detail) => detail.message)?.message ?? body.error.errors?.find((entry) => entry.message)?.message ?? body.error.message ?? null;
    }
    return body.error_description ?? body.message ?? (typeof body.error === 'string' ? body.error : null);
  } catch {
    return null;
  }
}

const tokens = new Map<string, { token: string; until: number }>();

function tokenId(key: Pick<AppleAdsKey, 'clientId' | 'keyId'>): string {
  return `${key.clientId}|${key.keyId}`;
}

/** Forget the access token of a key, after the key changed or Apple refused it. */
export function forgetAppleAdsToken(key: Pick<AppleAdsKey, 'clientId' | 'keyId'>): void {
  tokens.delete(tokenId(key));
}

async function accessToken(key: AppleAdsKey, signal?: AbortSignal): Promise<string> {
  const cached = tokens.get(tokenId(key));
  if (cached && cached.until > Date.now()) return cached.token;
  // Dated by Apple's clock as last seen (rule 56), not this computer's.
  const secret = await createAppleAdsClientSecret({ ...key, now: appleNow() });
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: key.clientId, client_secret: secret, scope: 'searchadsorg' });
  let response: Response;
  try {
    response = await fetchWithStop(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), cache: 'no-store' }, signal);
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    console.error('Apple sign-in could not be reached for Apple Ads', error);
    throw new AppleAdsError("Apple's sign-in couldn't be reached. Check your connection and try again", 'network');
  }
  noteAppleClock(response);
  const text = await response.text();
  if (!response.ok) {
    console.error('Apple sign-in refused the Apple Ads key', response.status, text);
    // A key Apple does not know is a 400 or 401 with "invalid_client".
    if (response.status === 400 || response.status === 401) {
      throw new AppleAdsError(
        "Apple Ads didn't accept the key. Check that Apple Ads has the public key from this app, and that the three IDs are the ones Apple Ads showed for the key",
        'key',
        response.status
      );
    }
    throw new AppleAdsError(`Apple's sign-in answered with error ${response.status}. Try again later`, 'request', response.status);
  }
  const body = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new AppleAdsError("Apple's sign-in sent no access token. Try again later", 'request');
  const seconds = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
  // Two minutes early, so a token never runs out between here and Apple.
  tokens.set(tokenId(key), { token: body.access_token, until: Date.now() + Math.max(60, seconds - 120) * 1000 });
  return body.access_token;
}

/**
 * One request to the Apple Ads API. A 401 gets one more try with a new
 * token, a 429 waits as long as Apple asks (twice at most), and a server
 * error gets one more try: every call here only reads.
 */
async function apiRequest<T>(path: string, options: { method: 'GET' | 'POST'; body?: unknown; accountId?: string }, key: AppleAdsKey, signal?: AbortSignal): Promise<T> {
  let limited = 0;
  let renewed = false;
  let retried = false;
  for (;;) {
    const token = await accessToken(key, signal);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (options.accountId) headers['X-AP-Context'] = `adAccountId=${options.accountId}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetchWithStop(
        `${API_URL}${path}`,
        { method: options.method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store' },
        signal
      );
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      console.error('Apple Ads could not be reached', error);
      throw new AppleAdsError("Apple Ads couldn't be reached. Check your connection and try again", 'network');
    }
    noteAppleClock(response);
    if (response.status === 401 && !renewed) {
      renewed = true;
      forgetAppleAdsToken(key);
      continue;
    }
    if (response.status === 429 && limited < 2) {
      limited += 1;
      await pause(retryAfter(response, 5_000 * limited), signal);
      continue;
    }
    if (response.status >= 500 && !retried) {
      retried = true;
      await pause(2_000, signal);
      continue;
    }
    const text = await response.text();
    if (response.ok) return (text ? JSON.parse(text) : {}) as T;
    const said = appleAdsMessage(text);
    console.error(`Apple Ads answered ${response.status} for ${path}`, text);
    if (response.status === 401) throw new AppleAdsError("Apple Ads didn't accept the key. Connect Apple Ads again", 'key', 401);
    if (response.status === 403) {
      throw new AppleAdsError(
        "Your Apple Ads user can't read popularity. In Apple Ads, give the user an API role, such as API Account Read Only",
        'access',
        403
      );
    }
    if (response.status === 429) throw new AppleAdsError('Apple Ads asked Growth to slow down. Growth tries again later', 'limit', 429);
    throw new AppleAdsError(said ? `Apple Ads said: ${said}` : `Apple Ads answered with error ${response.status}. Try again later`, 'request', response.status);
  }
}

/** The ad accounts the key can read. */
export async function listAdAccounts(key: AppleAdsKey, signal?: AbortSignal): Promise<AppleAdsAccount[]> {
  const body = await apiRequest<{
    result?: { acls?: Array<{ adAccount?: { id?: number | string; name?: string | null }; roles?: string[] }> };
  }>('/acls', { method: 'GET' }, key, signal);
  const acls = body.result?.acls;
  // An answer in another shape says nothing about the accounts, so it is not "no ad account".
  if (!Array.isArray(acls)) {
    console.error('Apple Ads answered the account list in a shape Growth does not read', body);
    throw new AppleAdsError("Apple Ads sent an answer Growth couldn't read. Try again later", 'request');
  }
  const out: AppleAdsAccount[] = [];
  for (const acl of acls) {
    const id = acl.adAccount?.id;
    if (id === undefined || id === null || id === '') continue;
    out.push({ id: String(id), name: acl.adAccount?.name?.trim() || `Ad account ${id}`, roles: Array.isArray(acl.roles) ? acl.roles : [] });
  }
  return out;
}

/**
 * Check a key with Apple: an access token, then the ad accounts it reads.
 * Throws an AppleAdsError the screen can show as it is.
 */
export async function testAppleAdsKey(key: AppleAdsKey, signal?: AbortSignal): Promise<AppleAdsAccount[]> {
  forgetAppleAdsToken(key);
  const accounts = await listAdAccounts(key, signal);
  if (accounts.length === 0) {
    throw new AppleAdsError('This Apple Ads user has no ad account to read. Make an ad account in Apple Ads, then try again', 'account');
  }
  return accounts;
}

/** One page of search term popularity, as Apple sends it (popularity.ts builds the body and reads the rows). */
export async function queryPopularityPage(key: AppleAdsKey, accountId: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  return apiRequest<unknown>('/insights/apps/search-term-popularity/query', { method: 'POST', body, accountId }, key, signal);
}
