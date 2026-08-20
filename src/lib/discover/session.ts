// The Discover sign-in: where the community token lives, and how it is got.
//
// There is no second password to remember. The editor already signs people in
// to Google or GitHub for "save to your own storage" (src/lib/account), and this
// module takes the access token that sign-in already produced and swaps it for a
// PocketBase one at /api/openscreengen/auth/{google,github}. The server verifies the token
// with the provider and checks it was issued to this app before it mints
// anything: see infra/vps/pb-hooks/040_auth.pb.js.
//
// Three consequences worth stating, because they are the whole shape of the
// feature:
//
//   1. **Signed out is a supported state, not an error.** Every read works
//      without a token. Guests browse, search, open posts and read comments;
//      they cannot post, comment, like, save or follow. That split is enforced
//      on the server — this module only decides which buttons to show.
//   2. **Connecting storage is what signs you in.** Somebody who has connected
//      Drive or GitHub gets a community session on their next visit to Discover
//      without being asked anything.
//   3. **With no backend configured, Discover is simply off.** The whole feature
//      keys off NEXT_PUBLIC_DISCOVER_URL, so a fork of this repo with no VPS
//      builds and runs exactly as before, minus one dialog.

import { useCallback, useEffect, useState } from 'react';
import { getSession as getAccountSession, subscribe as subscribeAccount } from '@/lib/account/store';
import type { DiscoverAuthor } from '@/types/discover';

/**
 * Where the community backend lives. Empty means the feature is off.
 *
 * A build-time value, like every other NEXT_PUBLIC_ here, because a static
 * export has nothing to read at runtime. Trailing slashes are stripped so
 * `${BASE}/api/...` cannot become a double slash, which PocketBase's router
 * treats as a different (missing) route.
 */
export const DISCOVER_URL = (process.env.NEXT_PUBLIC_DISCOVER_URL ?? '').trim().replace(/\/+$/, '');

/** True when this build has a backend to talk to at all. */
export function isDiscoverConfigured(): boolean {
  return !!DISCOVER_URL;
}

const STORAGE_KEY = 'open-screenshot-generator.discover.session';

export interface DiscoverSession {
  token: string;
  viewer: DiscoverAuthor;
  /** Which storage account was swapped for this token, so a change re-swaps. */
  provider: 'google' | 'github';
  /**
   * The provider account id this token was minted from.
   *
   * Signing out of Drive and into somebody else's GitHub has to drop this
   * session rather than keep posting as the first person, and comparing ids is
   * how that is noticed without a round trip.
   */
  accountId: string;
}

/** What the server says the box will accept right now. */
export interface DiscoverCapabilities {
  enabled: boolean;
  writes: boolean;
  signin: boolean;
  google: boolean;
  github: boolean;
  githubPat: boolean;
  /**
   * Whether this box will also store editable projects (src/lib/cloud).
   *
   * Its own switch on the server rather than a facet of `enabled`: the feed and
   * cloud projects are separate features that happen to share a box and an
   * account. Absent from an older backend's answer, which is why every reader
   * treats `undefined` as "on" rather than as "off" — a box that predates the
   * feature answers 404 on the routes anyway, and defaulting to off would hide
   * the feature on a box that has it.
   */
  cloudProjects?: boolean;
  note?: string;
}

let current: DiscoverSession | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

/**
 * Make the viewer's picture something an `<img>` can actually load.
 *
 * The box hands back a server-relative path (`/api/files/users/...`), which is
 * right: the same record then renders against a local box and the live one
 * without either side rewriting anything. Every OTHER consumer resolves it on
 * the way in (see api.ts), but the viewer on the session was going out raw, so
 * anything that rendered it pointed at the EDITOR's origin and got a 404 and a
 * broken-image glyph. Resolved here, once, so nobody has to remember.
 */
function normalizeViewer(viewer: DiscoverAuthor): DiscoverAuthor {
  if (!viewer?.avatarUrl) return viewer;
  const resolved = discoverUrl(viewer.avatarUrl);
  return resolved === viewer.avatarUrl ? viewer : { ...viewer, avatarUrl: resolved };
}

function read(): DiscoverSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DiscoverSession>;
    if (!parsed.token || !parsed.viewer?.id) return null;
    // Sessions stored before this was fixed hold the raw path, so the repair
    // happens on the way out rather than only at sign-in.
    return { ...parsed, viewer: normalizeViewer(parsed.viewer) } as DiscoverSession;
  } catch {
    return null;
  }
}

function write(session: DiscoverSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or a full quota: the sign-in holds for this tab only.
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  current = read();
}

export function getDiscoverSession(): DiscoverSession | null {
  hydrate();
  return current;
}

export function setDiscoverSession(session: DiscoverSession | null): void {
  hydrate();
  current = session;
  write(session);
  listeners.forEach((fn) => fn());
}

export function clearDiscoverSession(): void {
  setDiscoverSession(null);
}

export function subscribeDiscoverSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Authorization header, or nothing at all when signed out. */
export function authHeaders(): Record<string, string> {
  const session = getDiscoverSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

/**
 * Join a server-relative path to the backend.
 *
 * Every image the API hands back is a path (`/api/files/posts/...`) rather than
 * an absolute URL, so the same record renders against a box running on
 * localhost and against the live one without either side rewriting anything.
 */
export function discoverUrl(path: string): string {
  if (!path) return '';
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  return `${DISCOVER_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

/** Raised when the backend refuses the exchange for a reason worth showing. */
export class DiscoverAuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DiscoverAuthError';
    this.status = status;
  }
}

let capabilitiesPromise: Promise<DiscoverCapabilities> | null = null;

/**
 * Which doors the box has open, fetched once per page load.
 *
 * Cached in a module promise rather than per component, so the dialog, the start
 * panel and the toolbar all share one request. A failure resolves to everything
 * off rather than rejecting: a backend that is down should render as "Discover
 * is unavailable", not as an unhandled rejection in three components.
 */
export function discoverCapabilities(): Promise<DiscoverCapabilities> {
  if (!isDiscoverConfigured()) {
    return Promise.resolve({
      enabled: false,
      writes: false,
      signin: false,
      google: false,
      github: false,
      githubPat: false,
    });
  }
  if (!capabilitiesPromise) {
    capabilitiesPromise = fetch(`${DISCOVER_URL}/api/openscreengen/auth/methods`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('unavailable'))))
      .catch(() => ({
        enabled: false,
        writes: false,
        signin: false,
        google: false,
        github: false,
        githubPat: false,
      }));
  }
  return capabilitiesPromise;
}

/**
 * Swap the connected storage account for a community session.
 *
 * Returns null when there is nothing to swap — no backend, or nobody connected —
 * which is the ordinary signed-out case and not a failure. Throws only when the
 * exchange was attempted and refused, so a caller can tell "you are a guest"
 * from "the door said no".
 */
export async function signInToDiscover(): Promise<DiscoverSession | null> {
  if (!isDiscoverConfigured()) return null;

  const account = getAccountSession();
  if (!account?.accessToken) return null;

  const response = await fetch(`${DISCOVER_URL}/api/openscreengen/auth/${account.provider}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: account.accessToken }),
  }).catch(() => null);

  if (!response) {
    throw new DiscoverAuthError('The community backend could not be reached.', 0);
  }

  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) {
    throw new DiscoverAuthError(
      typeof payload.error === 'string' ? payload.error : 'That sign-in was refused.',
      response.status
    );
  }

  const session: DiscoverSession = {
    token: String(payload.token ?? ''),
    viewer: normalizeViewer(payload.record as DiscoverAuthor),
    provider: account.provider,
    accountId: account.account.id,
  };
  if (!session.token || !session.viewer?.id) {
    throw new DiscoverAuthError('That sign-in came back incomplete.', response.status);
  }

  setDiscoverSession(session);
  return session;
}

/**
 * Make the community session agree with the storage account, quietly.
 *
 * Called when Discover opens. Three cases, and the third is the one worth
 * having: the storage account changed underneath a stale community session, so
 * the old token is dropped and a new one fetched rather than leaving somebody
 * posting under the account they signed out of an hour ago.
 *
 * Never throws. A backend that is down leaves the viewer as a guest, which is a
 * working state, rather than putting an error in front of a feed they could
 * otherwise read.
 */
export async function reconcileDiscoverSession(): Promise<DiscoverSession | null> {
  if (!isDiscoverConfigured()) return null;

  const account = getAccountSession();
  const session = getDiscoverSession();

  if (!account) {
    // Signed out of storage: the community session goes with it.
    if (session) clearDiscoverSession();
    return null;
  }

  if (session && session.provider === account.provider && session.accountId === account.account.id) {
    return session;
  }

  try {
    return await signInToDiscover();
  } catch {
    if (session) clearDiscoverSession();
    return null;
  }
}

/**
 * The community session, re-rendering on change, plus what the box allows.
 *
 * Starts signed out on the server and on the first client render, so a static
 * export hydration pass never sees a value the server could not produce — the
 * same treatment the account store and the theme use.
 */
export function useDiscoverSession(): {
  session: DiscoverSession | null;
  viewer: DiscoverAuthor | null;
  isSignedIn: boolean;
  /** True once the first reconcile has settled, so the UI can wait to judge. */
  isReady: boolean;
  capabilities: DiscoverCapabilities | null;
  signIn: () => Promise<DiscoverSession | null>;
  signOut: () => void;
} {
  const [session, setLocal] = useState<DiscoverSession | null>(null);
  const [capabilities, setCapabilities] = useState<DiscoverCapabilities | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLocal(getDiscoverSession());
    const unsubscribeSession = subscribeDiscoverSession(() => setLocal(getDiscoverSession()));
    // A storage sign-in or sign-out has to move the community session with it,
    // so this listens to both stores rather than only its own.
    const unsubscribeAccount = subscribeAccount(() => {
      void reconcileDiscoverSession().then(() => {
        if (!cancelled) setLocal(getDiscoverSession());
      });
    });

    void discoverCapabilities().then((value) => {
      if (!cancelled) setCapabilities(value);
    });
    void reconcileDiscoverSession().then(() => {
      if (cancelled) return;
      setLocal(getDiscoverSession());
      setIsReady(true);
    });

    return () => {
      cancelled = true;
      unsubscribeSession();
      unsubscribeAccount();
    };
  }, []);

  const signIn = useCallback(async () => {
    const next = await signInToDiscover();
    setLocal(getDiscoverSession());
    return next;
  }, []);

  const signOut = useCallback(() => clearDiscoverSession(), []);

  return {
    session,
    viewer: session?.viewer ?? null,
    isSignedIn: !!session,
    isReady,
    capabilities,
    signIn,
    signOut,
  };
}
