// A live editing session: the peers, the document, and everything that has to
// happen before two browsers can see each other's cursors.
//
// ## The shape of it
//
//     snapshot   the cloud share link, downloaded once when somebody joins
//     document   a Yjs CRDT, replicated peer to peer over WebRTC data channels
//     presence   Yjs awareness on the same connections: who is here, what they
//                have selected, where their pointer is
//     signalling one small WebSocket server whose only job is introducing two
//                browsers to each other. It never sees the document
//     relay      coturn, used only by the pairs whose networks refuse a direct
//                connection. Credentials are minted per client and expire
//
// Nothing about the design travels through a server of ours once the session is
// up, and the signalling messages are encrypted with the room key from the
// invite's fragment, which no server ever receives (see links.ts).
//
// ## The parts that are loaded late
//
// yjs, y-webrtc and y-indexeddb are imported dynamically. They are ~120KB that
// nobody who never opens a session should pay for, and y-webrtc reaches for
// `window` at module scope, which a static export cannot do while pre-rendering.
//
// ## Seeding, and why it cannot duplicate anything
//
// Somebody has to put the project into an empty room. The rule is "the room
// wins if it has anything at all, otherwise the first person in seeds it", and
// the reason it is safe to race is in ydoc.ts: boards and elements are keyed by
// id, so two peers writing the same project into the same empty room converge
// on one copy rather than two.

import { db } from '@/database';
import { collectMediaIds } from '@/lib/account/projectBundle';
import { cloudApi } from '@/lib/cloud/api';
import { notifyMediaChanged } from '@/lib/mediaStore';
import type { ArtboardState } from '@/types/artboard';
import { roomIdFor } from './links';
import type { CollabPeer, CollabStatus, CollabUser } from './types';
import { isEmptyDoc, LOCAL_ORIGIN, readArtboards, writeArtboards } from './ydoc';

/**
 * Where the signalling server is.
 *
 * It lives in the same small container as the MCP relay, so a box that already
 * runs that needs no second service, no second hostname and no second
 * certificate: see infra/vps/mcp-relay/README.md. Unset means live editing is
 * simply not part of this build, exactly as an unset Discover URL means there
 * is no feed.
 */
const COLLAB_URL = (
  process.env.NEXT_PUBLIC_COLLAB_URL ??
  process.env.NEXT_PUBLIC_MCP_RELAY_URL ??
  ''
)
  .trim()
  .replace(/\/+$/, '');

/**
 * Where expiring TURN credentials come from.
 *
 * A relay credential must never be a build time constant: every NEXT_PUBLIC_
 * value is inlined into the bundle and readable in devtools, so a static
 * password there would let anyone relay their own traffic through the box
 * forever. The endpoint holds the shared secret and hands out derived,
 * expiring credentials. Unset means STUN only, which still connects most pairs.
 */
const TURN_ENDPOINT = (process.env.NEXT_PUBLIC_TURN_ENDPOINT ?? '').trim();

/** Public STUN, overridable. Only used to discover this machine's own address. */
const STUN_URLS = (process.env.NEXT_PUBLIC_STUN_URLS ?? 'stun:stun.l.google.com:19302')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

/** Remote changes are applied in batches this far apart, at most. */
const APPLY_DEBOUNCE_MS = 40;
/** A pointer moves continuously; this is how often that is told to the room. */
const CURSOR_THROTTLE_MS = 60;
/** How long to wait for somebody else's document before seeding our own. */
const SEED_GRACE_MS = 2_500;
/** How often the signalling connection is checked. */
const WATCHDOG_MS = 5_000;
/**
 * How long signalling may stay down before the session is rebuilt.
 *
 * y-webrtc reconnects on its own, to the same URL, and that is enough for a
 * blip. It is NOT enough for a ticket that has expired or a server that has
 * been redeployed since, and those failures are invisible: the room looks
 * connected and no peer is ever found again. So after this long the whole
 * provider is rebuilt behind a fresh ticket.
 */
const SIGNALING_DOWN_MS = 15_000;

export function isCollabConfigured(): boolean {
  return !!COLLAB_URL;
}

// ---------------------------------------------------------------------------
// ICE
// ---------------------------------------------------------------------------

interface IceConfig {
  iceServers: RTCIceServer[];
  fetchedAt: number;
  ttl: number;
}

let iceCache: IceConfig | null = null;

/**
 * The servers a peer connection may use.
 *
 * STUN alone is enough for most pairs: it only tells a browser its own public
 * address. TURN is what carries the rest, and it is the expensive half, so it
 * is fetched rather than configured and a failure is not fatal. A session with
 * no relay works for everybody except the pairs behind symmetric NAT, which is
 * a better outcome than refusing to start.
 */
async function iceServers(): Promise<RTCIceServer[]> {
  const base: RTCIceServer[] = STUN_URLS.length ? [{ urls: STUN_URLS }] : [];
  if (!TURN_ENDPOINT) return base;

  const now = Date.now();
  if (iceCache && now - iceCache.fetchedAt < iceCache.ttl * 1000 * 0.8) {
    return iceCache.iceServers;
  }
  try {
    const response = await fetch(TURN_ENDPOINT, { method: 'GET' });
    if (!response.ok) throw new Error(`turn endpoint answered ${response.status}`);
    const payload = (await response.json()) as { iceServers?: RTCIceServer[]; ttl?: number };
    const servers = Array.isArray(payload.iceServers) ? payload.iceServers : [];
    if (!servers.length) throw new Error('turn endpoint answered no servers');
    iceCache = { iceServers: servers, fetchedAt: now, ttl: payload.ttl || 3600 };
    return servers;
  } catch (error) {
    console.warn('Could not get relay credentials, carrying on with STUN only', error);
    return base;
  }
}

// ---------------------------------------------------------------------------
// signalling
// ---------------------------------------------------------------------------

/** Raised when the signalling server refused because nobody is signed in. */
export class CollabSignInRequiredError extends Error {
  constructor(message = 'Sign in to join a live session.') {
    super(message);
    this.name = 'CollabSignInRequiredError';
  }
}

/**
 * Swap the account token for a short lived signalling ticket.
 *
 * The ticket rather than the token is what goes in the WebSocket URL, and the
 * difference matters: a URL is written to proxy logs and browser history, so
 * whatever is in it must be worthless a minute later. The ticket is single use,
 * expires in a minute, and grants nothing but an introduction.
 *
 * A server with no PocketBase configured answers "auth off" and everything
 * still works, which is what makes a local dev box possible.
 */
async function signalingUrl(token: string | null): Promise<string> {
  const base = COLLAB_URL.replace(/^http/, 'ws');
  let response: Response;
  try {
    response = await fetch(`${COLLAB_URL}/collab/ticket`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new Error('The live session server could not be reached.');
  }
  if (response.status === 401) throw new CollabSignInRequiredError();
  if (!response.ok) throw new Error('The live session server refused to start a session.');
  const payload = (await response.json().catch(() => ({}))) as { ticket?: string };
  return payload.ticket ? `${base}/collab?t=${encodeURIComponent(payload.ticket)}` : `${base}/collab`;
}

// ---------------------------------------------------------------------------
// the session
// ---------------------------------------------------------------------------

export interface CollabSessionOptions {
  /** The cloud share slug the snapshot came from. Half of the room id. */
  slug: string;
  /** The room key from the invite's fragment. The other half, and the cipher. */
  key: string;
  /** Who this device is in the room. */
  user: CollabUser;
  /** The account token, for the signalling ticket. */
  token: string | null;
  /**
   * The canvas as it stands, read only if the room turns out to be empty.
   *
   * A getter rather than a value because seeding happens seconds after the
   * session opens, and the usual way in is "import the project, then join":
   * a snapshot captured at open time would be the state from before the import
   * finished, which is an empty canvas.
   */
  getInitialBoards: () => ArtboardState[];
  getProjectName: () => string;
  /** The room's document, whenever it changes. Never called for our own writes. */
  onRemote: (boards: ArtboardState[], projectName: string | null) => void;
  onPeers: (peers: CollabPeer[]) => void;
  onStatus: (status: CollabStatus) => void;
}

export class CollabSession {
  readonly roomId: string;
  readonly slug: string;
  private readonly options: CollabSessionOptions;
  // The libraries, held as `any` because they are loaded at runtime and their
  // types would drag yjs into every bundle that merely imports this file.
  private doc: any;
  private provider: any;
  private persistence: any;
  private awareness: any;
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** When signalling was first seen down, or 0 while it is up. */
  private signalingDownSince = 0;
  private reopening = false;
  private cursorAt = 0;
  private destroyed = false;
  /** Asset ids already looked for, so a missing one is chased once, not forever. */
  private readonly triedAssets = new Set<string>();
  private assetMetaPromise: Promise<Map<string, Record<string, unknown>>> | null = null;

  private constructor(roomId: string, options: CollabSessionOptions) {
    this.roomId = roomId;
    this.slug = options.slug;
    this.options = options;
  }

  static async open(options: CollabSessionOptions): Promise<CollabSession> {
    if (!isCollabConfigured()) throw new Error('Live editing is not available in this build.');

    const roomId = await roomIdFor(options.slug, options.key);
    const session = new CollabSession(roomId, options);
    await session.start();
    return session;
  }

  private async start(): Promise<void> {
    this.options.onStatus('connecting');

    const [{ Doc }, { WebrtcProvider }, { IndexeddbPersistence }, signaling, servers] =
      await Promise.all([
        import('yjs'),
        import('y-webrtc'),
        import('y-indexeddb'),
        signalingUrl(this.options.token),
        iceServers(),
      ]);
    if (this.destroyed) return;

    this.doc = new Doc();
    // Local persistence, keyed by room. It is what lets somebody close the tab
    // mid session and come back to their work rather than to an empty room, and
    // what makes the last person out still hold the finished document.
    this.persistence = new IndexeddbPersistence(`osg-collab-${this.roomId}`, this.doc);

    this.provider = new WebrtcProvider(this.roomId, this.doc, {
      signaling: [signaling],
      // The room key encrypts every signalling payload. The server that relays
      // them holds no key and can decrypt nothing.
      password: this.options.key,
      peerOpts: { config: { iceServers: servers } },
    });
    this.awareness = this.provider.awareness;

    this.awareness.setLocalStateField('user', this.options.user);
    this.awareness.on('change', this.handleAwareness);
    this.doc.on('update', this.handleUpdate);
    this.provider.on('status', ({ connected }: { connected: boolean }) => {
      if (this.destroyed) return;
      this.options.onStatus(connected ? 'live' : 'connecting');
    });

    await this.persistence.whenSynced.catch(() => undefined);
    if (this.destroyed) return;

    // Whatever the room already knows goes on the canvas straight away, before
    // any peer has answered: an earlier session of our own is already the
    // newest thing we hold.
    if (!isEmptyDoc(this.doc)) this.emitRemote();
    this.options.onStatus('live');

    // Then the seeding decision, once peers have had a moment to answer.
    setTimeout(() => {
      if (this.destroyed) return;
      if (isEmptyDoc(this.doc)) {
        writeArtboards(this.doc, this.options.getInitialBoards(), this.options.getProjectName());
      }
    }, SEED_GRACE_MS);

    this.startWatchdog();
  }

  /**
   * Notice when signalling has gone, and rebuild rather than wait.
   *
   * Polling the connection rather than listening for an event, deliberately:
   * the event names belong to lib0's websocket client, two libraries down, and
   * `connected` is the one thing about it that is public. Five seconds is
   * nothing next to the cost of the thing it catches.
   */
  private startWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (this.destroyed || this.reopening) return;
      const conns = (this.provider?.signalingConns ?? []) as Array<{ connected?: boolean }>;
      const connected = conns.length > 0 && conns.every((conn) => conn.connected);
      if (connected) {
        if (this.signalingDownSince) {
          this.signalingDownSince = 0;
          this.options.onStatus('live');
        }
        return;
      }
      if (!this.signalingDownSince) {
        this.signalingDownSince = Date.now();
        this.options.onStatus('connecting');
        return;
      }
      if (Date.now() - this.signalingDownSince > SIGNALING_DOWN_MS) {
        this.signalingDownSince = 0;
        void this.reopenSignaling();
      }
    }, WATCHDOG_MS);
  }

  /**
   * Rebuild the peer provider behind a fresh ticket.
   *
   * The document and everything in it survive: only the transport is replaced,
   * so peers see this browser leave and come back rather than losing anything.
   * The awareness state has to be re-stated, because the new provider brings a
   * new awareness instance with it.
   */
  private async reopenSignaling(): Promise<void> {
    if (this.destroyed || this.reopening) return;
    this.reopening = true;
    try {
      const [{ WebrtcProvider }, signaling, servers] = await Promise.all([
        import('y-webrtc'),
        signalingUrl(this.options.token),
        iceServers(),
      ]);
      if (this.destroyed) return;

      try {
        this.awareness?.off('change', this.handleAwareness);
        this.provider?.destroy();
      } catch {
        // Already gone. Rebuilding is the point; how it ended is not.
      }

      this.provider = new WebrtcProvider(this.roomId, this.doc, {
        signaling: [signaling],
        password: this.options.key,
        peerOpts: { config: { iceServers: servers } },
      });
      this.awareness = this.provider.awareness;
      this.awareness.setLocalStateField('user', this.options.user);
      this.awareness.on('change', this.handleAwareness);
      this.options.onStatus('live');
      console.warn('Live session signalling was rebuilt after a disconnection');
    } catch (error) {
      // Still down. The watchdog will come back around.
      this.options.onStatus('connecting');
      console.warn('Could not rebuild the live session signalling', error);
    } finally {
      this.reopening = false;
    }
  }

  /** The canvas changed here. Push it, as one transaction. */
  publish(boards: ArtboardState[], projectName?: string): void {
    if (this.destroyed || !this.doc) return;
    writeArtboards(this.doc, boards, projectName);
  }

  /** What this person has selected, so the room can draw a ring around it. */
  setSelection(selection: { artboardId: string | null; elementId: string | null } | null): void {
    if (this.destroyed || !this.awareness) return;
    this.awareness.setLocalStateField('selection', selection);
  }

  /**
   * Where this person's pointer is, in board coordinates.
   *
   * Throttled rather than sent per event: a pointer produces a hundred events a
   * second and awareness is broadcast to every peer, so unthrottled it is the
   * single largest thing on the wire in a session where nothing is happening.
   */
  setCursor(cursor: { artboardId: string; x: number; y: number } | null): void {
    if (this.destroyed || !this.awareness) return;
    const now = Date.now();
    if (cursor && now - this.cursorAt < CURSOR_THROTTLE_MS) return;
    this.cursorAt = now;
    this.awareness.setLocalStateField('cursor', cursor);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.applyTimer) clearTimeout(this.applyTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    try {
      this.awareness?.off('change', this.handleAwareness);
      this.doc?.off('update', this.handleUpdate);
      this.provider?.destroy();
      this.persistence?.destroy();
      this.doc?.destroy();
    } catch (error) {
      console.warn('Could not close the live session cleanly', error);
    }
    this.options.onPeers([]);
    this.options.onStatus('off');
  }

  // --- internals -----------------------------------------------------------

  private handleUpdate = (_update: Uint8Array, origin: unknown): void => {
    // Our own write, already on the canvas.
    if (origin === LOCAL_ORIGIN || this.destroyed) return;
    if (this.applyTimer) return;
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null;
      this.emitRemote();
    }, APPLY_DEBOUNCE_MS);
  };

  private emitRemote(): void {
    if (this.destroyed) return;
    const boards = readArtboards(this.doc);
    const name = this.doc.getMap('meta').get('name');
    this.options.onRemote(boards, typeof name === 'string' ? name : null);
    void this.fetchMissingAssets(boards);
  }

  private handleAwareness = (): void => {
    if (this.destroyed) return;
    const peers: CollabPeer[] = [];
    const states = this.awareness.getStates() as Map<number, Record<string, unknown>>;
    for (const [clientId, state] of states) {
      if (clientId === this.awareness.clientID) continue;
      const user = state?.user as CollabUser | undefined;
      if (!user?.id) continue;
      peers.push({
        clientId,
        user,
        selection: (state.selection as CollabPeer['selection']) ?? null,
        cursor: (state.cursor as CollabPeer['cursor']) ?? null,
      });
    }
    this.options.onPeers(peers);
  };

  /**
   * Pull down any blob this document references that this browser lacks.
   *
   * The document carries references, never bytes, so a screenshot somebody else
   * added is a dead reference here until its bytes arrive. They come from the
   * project's own cloud copy over the share link, which the auto saver keeps
   * current, so in practice a new image appears for everybody within a minute
   * of it being dropped on the canvas.
   *
   * Every id is attempted once. A blob that is not up there yet stays missing
   * until the next session rather than being retried in a loop, because the
   * thing being waited for is somebody else's save, not a flaky download.
   */
  private async fetchMissingAssets(boards: ArtboardState[]): Promise<void> {
    let wanted: string[];
    try {
      wanted = collectMediaIds(boards).filter((id) => !this.triedAssets.has(id));
    } catch {
      return;
    }
    if (!wanted.length) return;

    const missing: string[] = [];
    for (const id of wanted) {
      this.triedAssets.add(id);
      try {
        if (!(await db.media.get(id))) missing.push(id);
      } catch {
        return; // IndexedDB is unavailable; nothing here can help
      }
    }
    if (!missing.length) return;

    const meta = await this.assetMeta();
    let stored = 0;
    for (const id of missing) {
      const info = meta.get(id);
      if (!info) continue; // not in the cloud copy yet
      try {
        const blob = await cloudApi.fetchSharedAsset(this.slug, id);
        await db.media.put({
          id,
          blob,
          name: String(info.name ?? id),
          mimeType: String(info.mimeType ?? blob.type ?? 'application/octet-stream'),
          width: typeof info.width === 'number' ? info.width : undefined,
          height: typeof info.height === 'number' ? info.height : undefined,
          duration: typeof info.duration === 'number' ? info.duration : undefined,
          createdAt: new Date(),
        });
        stored += 1;
      } catch (error) {
        // One missing recording must not stop the session, or the rest of it.
        console.warn(`Could not fetch ${id} for the live session`, error);
        this.triedAssets.delete(id); // it may land on the next save
      }
    }
    if (stored) notifyMediaChanged();
  }

  /** The shared project's asset index, fetched once per session. */
  private assetMeta(): Promise<Map<string, Record<string, unknown>>> {
    if (!this.assetMetaPromise) {
      this.assetMetaPromise = cloudApi
        .getShared(this.slug)
        .then((project) => {
          const map = new Map<string, Record<string, unknown>>();
          for (const asset of project?.assets ?? []) {
            map.set(asset.assetId, (asset.meta ?? {}) as Record<string, unknown>);
          }
          return map;
        })
        .catch(() => new Map<string, Record<string, unknown>>());
    }
    return this.assetMetaPromise;
  }
}
