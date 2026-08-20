// The signalling server for live editing: two browsers, one introduction.
//
// It is the smallest half of the feature by a distance. Two people editing a
// project together exchange the document itself over WebRTC data channels,
// encrypted end to end with a key that only exists in the link they passed each
// other. This server never sees the document, never sees the key, and cannot
// tell which project a room belongs to: a room id is a hash of the share slug
// and that key (see src/lib/collab/links.ts). All it does is hold a set of
// sockets per room and copy a message to the others.
//
// ## The protocol
//
// It is y-webrtc's, exactly, so the client is the stock library rather than a
// fork of it:
//
//   {type:'subscribe',   topics:[...]}   join those rooms
//   {type:'unsubscribe', topics:[...]}   leave them
//   {type:'publish',     topic, ...}     copy this to everybody in that room
//   {type:'ping'}                        answered with {type:'pong'}
//
// ## Why it lives in this container
//
// It could be its own service. It is here because the alternative costs the
// operator a DNS record, a Caddy site block in a repo this one does not own,
// and a second container to remember, for about 200 lines of code with no state
// and no disk. Same shape as the relay it sits next to: in memory, no
// credential, restart-and-forget.
//
// ## Why the WebSocket is hand rolled
//
// This image is `FROM node` plus a COPY, with no package install and no
// lockfile, and that is a promise worth more than the 150 lines below: nothing
// here can be broken by a registry, a transitive dependency or an audit. The
// frames it has to speak are small JSON messages, which is the easy half of
// RFC 6455.
//
// ## Auth
//
// Live editing requires an account. The client swaps its PocketBase token for a
// short lived ticket over HTTP, then puts the TICKET in the socket URL rather
// than the token: a URL ends up in proxy logs and browser history, so whatever
// is in it has to expire and has to grant as little as possible. With
// POCKETBASE_URL unset there is nothing to check a token against, so the whole
// check is skipped and the server is open, which is the right behaviour for a
// laptop and stated plainly in the README.

import crypto from 'node:crypto';

/** PocketBase, for turning a bearer token into an account id. Unset = auth off. */
const POCKETBASE_URL = (process.env.POCKETBASE_URL || '').replace(/\/+$/, '');
/** The route that answers "who is this token", added by pb-hooks/070_collab.pb.js. */
const WHOAMI_PATH = '/api/openscreengen/collab/whoami';

/**
 * How long a ticket opens a socket for.
 *
 * Fifteen minutes rather than one, and reusable rather than single use, and
 * both of those are a bug fix rather than a relaxation. y-webrtc's signalling
 * connection **reconnects by itself, to the same URL**, whenever the socket
 * drops: an idle timeout, a wifi blip, a redeploy of this container. With a
 * single-use ticket every one of those reconnects is refused, and the failure
 * is invisible on both sides. The session looks alive, nobody can find anybody,
 * and only a page reload fixes it.
 *
 * What a ticket grants is worth this: an introduction to browsers that already
 * hold a room id, which is a hash nobody can guess and which this server cannot
 * reverse. It carries no access to a project, an account or a document.
 */
const TICKET_TTL_MS = 15 * 60_000;
/** Bounded so an open endpoint cannot be turned into free memory. */
const MAX_TICKETS = 5_000;
const MAX_ROOMS = 5_000;
const MAX_SOCKETS_PER_ROOM = 64;
/** Signalling messages are SDP and ICE candidates. This is far above any of them. */
const MAX_MESSAGE_BYTES = 512 * 1024;
const PING_MS = 30_000;

/** ticket -> {expires, user} */
const tickets = new Map();
/** room id -> Set<socket state> */
const rooms = new Map();

const now = () => Date.now();

function sweepTickets() {
  const cutoff = now();
  for (const [ticket, entry] of tickets) {
    if (entry.expires < cutoff) tickets.delete(ticket);
  }
}

/**
 * Who this token belongs to, or null.
 *
 * One request per session start, never per message. A failure is treated as
 * "not signed in" rather than "server error": the caller's only decision is
 * whether to let this socket in.
 */
async function accountFor(token) {
  if (!POCKETBASE_URL) return { id: 'anonymous' };
  if (!token) return null;
  try {
    const response = await fetch(`${POCKETBASE_URL}${WHOAMI_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload && payload.id ? { id: String(payload.id) } : null;
  } catch (error) {
    console.warn('[collab] could not check a token:', String(error));
    return null;
  }
}

/**
 * POST /collab/ticket
 *
 * Answers `{ticket}` for a signed-in caller, `{auth:false}` on a box with no
 * PocketBase configured, and 401 otherwise. Returns true when it handled the
 * request, so the relay's router can fall through for everything else.
 */
export function handleCollabHttp(req, res, { sendJson, sendEmpty }) {
  const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (path !== '/collab/ticket') return false;

  if (req.method === 'OPTIONS') {
    sendEmpty(res, 204);
    return true;
  }
  if (req.method !== 'POST') {
    sendEmpty(res, 405);
    return true;
  }

  const header = String(req.headers.authorization || '');
  const token = header.replace(/^Bearer\s+/i, '').trim();

  void (async () => {
    const user = await accountFor(token);
    if (!user) {
      sendJson(res, 401, { error: 'sign in to start a live session' });
      return;
    }
    if (!POCKETBASE_URL) {
      // Nothing to authenticate against, so no ticket is minted and the socket
      // below lets everybody in. Saying so beats a ticket that means nothing.
      sendJson(res, 200, { auth: false });
      return;
    }
    sweepTickets();
    if (tickets.size >= MAX_TICKETS) {
      sendJson(res, 503, { error: 'too many sessions starting at once, try again' });
      return;
    }
    const ticket = crypto.randomBytes(24).toString('hex');
    tickets.set(ticket, { expires: now() + TICKET_TTL_MS, user });
    sendJson(res, 200, { ticket, expiresIn: Math.floor(TICKET_TTL_MS / 1000) });
  })();

  return true;
}

// ---------------------------------------------------------------------------
// The WebSocket, by hand
// ---------------------------------------------------------------------------

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

/** One frame, unmasked, from this server to a client. */
function frame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '', 'utf8');
  const length = body.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    // High 32 bits stay zero: nothing here is ever 4GB.
    header.writeUInt32BE(Math.floor(length / 2 ** 32), 2);
    header.writeUInt32BE(length >>> 0, 6);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, body]);
}

function send(state, message) {
  if (state.closed) return;
  try {
    state.socket.write(frame(0x1, JSON.stringify(message)));
  } catch {
    closeSocket(state);
  }
}

function closeSocket(state) {
  if (state.closed) return;
  state.closed = true;
  clearInterval(state.pingTimer);
  for (const topic of state.topics) {
    const room = rooms.get(topic);
    if (!room) continue;
    room.delete(state);
    if (room.size === 0) rooms.delete(topic);
  }
  state.topics.clear();
  try {
    state.socket.end();
  } catch {
    // already gone
  }
}

function handleMessage(state, text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (!message || typeof message.type !== 'string') return;

  switch (message.type) {
    case 'subscribe': {
      for (const topic of message.topics || []) {
        if (typeof topic !== 'string' || topic.length > 128) continue;
        let room = rooms.get(topic);
        if (!room) {
          if (rooms.size >= MAX_ROOMS) continue;
          room = new Set();
          rooms.set(topic, room);
        }
        if (room.size >= MAX_SOCKETS_PER_ROOM) continue;
        room.add(state);
        state.topics.add(topic);
      }
      break;
    }
    case 'unsubscribe': {
      for (const topic of message.topics || []) {
        const room = rooms.get(topic);
        if (!room) continue;
        room.delete(state);
        state.topics.delete(topic);
        if (room.size === 0) rooms.delete(topic);
      }
      break;
    }
    case 'publish': {
      const room = typeof message.topic === 'string' ? rooms.get(message.topic) : null;
      if (!room) break;
      // Only to rooms this socket is in. Without it, anybody who learned a room
      // id could inject signalling into a session they never joined.
      if (!state.topics.has(message.topic)) break;
      message.clients = room.size;
      for (const peer of room) send(peer, message);
      break;
    }
    case 'ping':
      send(state, { type: 'pong' });
      break;
    default:
      break;
  }
}

/**
 * Pull whole frames out of whatever has arrived so far.
 *
 * Client frames are always masked. Continuations are joined, control frames are
 * answered inline, and anything oversized closes the socket rather than being
 * buffered: this endpoint is open to the internet and a length field is
 * attacker-controlled.
 */
function readFrames(state) {
  for (;;) {
    const buffer = state.buffer;
    if (buffer.length < 2) return;
    const first = buffer[0];
    const second = buffer[1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buffer.length < offset + 2) return;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.length < offset + 8) return;
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      length = high * 2 ** 32 + low;
      offset += 8;
    }
    if (!masked) return closeSocket(state); // a client frame must be masked
    if (length > MAX_MESSAGE_BYTES || state.pending.length + length > MAX_MESSAGE_BYTES) {
      return closeSocket(state);
    }
    if (buffer.length < offset + 4 + length) return;

    const mask = buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i += 1) payload[i] = buffer[offset + i] ^ mask[i & 3];
    state.buffer = buffer.subarray(offset + length);

    if (opcode === 0x8) return closeSocket(state);
    if (opcode === 0x9) {
      try {
        state.socket.write(frame(0xa, payload));
      } catch {
        return closeSocket(state);
      }
      continue;
    }
    if (opcode === 0xa) {
      state.alive = true;
      continue;
    }
    if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
      state.pending = state.pending.length ? Buffer.concat([state.pending, payload]) : payload;
      if (fin) {
        const text = state.pending.toString('utf8');
        state.pending = Buffer.alloc(0);
        handleMessage(state, text);
      }
      continue;
    }
    // Anything else is a frame this server does not speak.
    return closeSocket(state);
  }
}

function refuse(socket, status, reason) {
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  } catch {
    // gone already
  }
}

/**
 * Wire the signalling endpoint onto the relay's HTTP server.
 *
 * Only `/collab` upgrades. Everything else is left alone, so the relay's own
 * routes behave exactly as they did.
 */
export function attachCollab(server) {
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://relay');
    if (url.pathname.replace(/\/+$/, '') !== '/collab') return refuse(socket, 404, 'Not Found');

    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      return refuse(socket, 400, 'Bad Request');
    }

    if (POCKETBASE_URL) {
      const ticket = url.searchParams.get('t') || '';
      sweepTickets();
      const entry = tickets.get(ticket);
      // NOT spent on use: see TICKET_TTL_MS. The reconnect that y-webrtc does
      // on its own has to be able to present the same one.
      if (!entry) return refuse(socket, 401, 'Unauthorized');
    }

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(String(key))}\r\n\r\n`
    );
    socket.setNoDelay(true);
    socket.setTimeout(0);

    const state = {
      socket,
      topics: new Set(),
      buffer: head && head.length ? Buffer.from(head) : Buffer.alloc(0),
      pending: Buffer.alloc(0),
      closed: false,
      alive: true,
    };

    state.pingTimer = setInterval(() => {
      if (!state.alive) return closeSocket(state);
      state.alive = false;
      try {
        socket.write(frame(0x9, Buffer.alloc(0)));
      } catch {
        closeSocket(state);
      }
    }, PING_MS);

    socket.on('data', (chunk) => {
      state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
      readFrames(state);
    });
    socket.on('close', () => closeSocket(state));
    socket.on('error', () => closeSocket(state));

    if (state.buffer.length) readFrames(state);
  });
}

/** For /healthz, so an operator can see whether anybody is collaborating. */
export function collabStats() {
  let sockets = 0;
  for (const room of rooms.values()) sockets += room.size;
  return { rooms: rooms.size, sockets, auth: !!POCKETBASE_URL };
}
