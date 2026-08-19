// The invite link, and what each half of it is allowed to know.
//
// A live session needs two things to travel together: WHERE the starting
// snapshot is, and the key that unlocks the conversation. They are put in
// different halves of the URL on purpose:
//
//     https://editor.example/?collab=<share slug>#k=<room key>
//                             ─────┬─────         ───┬───
//        the query, which the server sees ─┘          └─ the fragment, which it never does
//
// A URL fragment is not sent in an HTTP request. So the key that encrypts every
// signalling message and every peer connection is known only to the people
// holding the link: our signalling server sees a room id it cannot reverse, and
// the box that stores the project never sees the key at all. That is what makes
// the live half of this end to end encrypted even though the snapshot half is
// an ordinary authenticated download.
//
// The room id is `sha256(slug:key)`, so the two are bound together: rotating
// the key mints a new room rather than letting a revoked link back into the old
// one, and the slug alone (which the server does know) cannot name the room.

import { BASE_PATH } from '@/lib/basePath';

/** How the room key is generated and how long it is. 128 bits, base64url. */
const KEY_BYTES = 16;

/** Rooms this browser has joined, so a second visit reuses its local copy. */
const JOINED_KEY = 'open-screenshot-generator.collab.joined';

export interface CollabInvite {
  /** The cloud share slug: where the starting snapshot is downloaded from. */
  slug: string;
  /** The room key, from the fragment. Never sent to any server. */
  key: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh room key. Called once per project, then remembered on its cloud link. */
export function newRoomKey(): string {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * The room both sides will meet in.
 *
 * Hashed rather than composed so the signalling server, which necessarily sees
 * the room id, learns neither the key nor which project this is. Prefixed
 * because that server is shared with anything else that ever speaks this
 * protocol on the box.
 */
export async function roomIdFor(slug: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${slug}:${key}`));
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `osg-${hex}`;
}

/** The URL somebody sends to the people they want in the room. */
export function buildInviteUrl(slug: string, key: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${BASE_PATH}/?collab=${encodeURIComponent(slug)}#k=${encodeURIComponent(key)}`;
}

/**
 * Parse an invite out of one URL.
 *
 * Both halves or nothing: a link that lost its fragment (a chat app that
 * "cleaned" it, a copy that stopped at the hash) cannot open a session, and
 * treating it as a plain share would silently drop somebody into a private copy
 * while they believed they had joined the room.
 */
function parseInvite(href: string): CollabInvite | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const slug = url.searchParams.get('collab');
  if (!slug || !/^[a-z0-9]{22}$/.test(slug)) return null;
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  const key = new URLSearchParams(hash).get('k');
  if (!key || !/^[A-Za-z0-9_-]{16,64}$/.test(key)) return null;
  return { slug, key };
}

/**
 * The invite this page was opened with, captured at module load.
 *
 * It has to be captured this early, and finding that out cost an afternoon:
 * Next's app router runs `history.replaceState` while it hydrates and the
 * replacement it writes has NO FRAGMENT. So by the time any effect runs, the
 * room key is gone from the address bar and an invite reads as an ordinary
 * share link. A module body runs before the first render, which is the last
 * moment the whole URL still exists.
 */
const openedWith: CollabInvite | null =
  typeof window === 'undefined' ? null : parseInvite(window.location.href);

/** The invite this page was opened with, or null. Stable for the session. */
export function readInviteFromUrl(): CollabInvite | null {
  return openedWith;
}

/**
 * Opened with `?collab=` but no usable key.
 *
 * This is what a link looks like after something helpful has "cleaned" it: a
 * chat app that strips fragments, a copy that stopped at the hash, a redirect
 * that rebuilt the URL. Without the key there is no room to join and no way to
 * decrypt one, so the only correct thing to do is say so. Silently opening the
 * project as an ordinary copy would be worse than useless: both people would
 * believe they were in a session, and neither would ever see the other.
 */
const openedWithBrokenInvite: boolean =
  typeof window !== 'undefined' &&
  !openedWith &&
  !!new URLSearchParams(window.location.search).get('collab');

export function invitedWithoutKey(): boolean {
  return openedWithBrokenInvite;
}

/**
 * Take the invite back off the address bar once it has been acted on.
 *
 * The fragment goes with it: a key that stays in the URL is a key that goes
 * into the next screenshot, the next "copy this link", and the browser history
 * of a shared machine.
 */
export function clearInviteFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('collab') && !url.hash) return;
  url.searchParams.delete('collab');
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

function readJoined(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(JOINED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Which local project a previously joined room turned into, if any. */
export function joinedProjectFor(slug: string): string | null {
  return readJoined()[slug] ?? null;
}

/**
 * Remember that this room is this local project.
 *
 * Without it, opening the same invite twice imports the project twice and the
 * second copy is the one being edited while the first sits in Recent projects
 * looking like the work was lost.
 */
export function rememberJoined(slug: string, projectId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const all = readJoined();
    all[slug] = projectId;
    window.localStorage.setItem(JOINED_KEY, JSON.stringify(all));
  } catch {
    // Storage is off. The session still works; a second visit re-imports.
  }
}
