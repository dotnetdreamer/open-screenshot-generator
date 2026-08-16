// The MCP relay: a switchboard between an AI client and an open editor tab.
//
// The desktop app can host the MCP server itself — Rust opens a socket on
// 127.0.0.1 and hands each JSON-RPC request to the webview (see
// src-tauri/src/mcp_server.rs). A browser tab has no socket and cannot be
// dialled, so on the web that same bridge needs a meeting point with a public
// address. This is it, and it is the whole of it:
//
//     Claude Code ──POST /mcp/<code>──►  relay  ──SSE /tab/<code>──►  editor tab
//                 ◄─────── JSON ───────        ◄── POST .../reply ───
//
// It holds no design state, parses no tool call and knows nothing about
// artboards. It matches a request to a stream by the code in the URL, waits for
// the answer, and hands it back. Every tool still runs in the tab, on the same
// code path the desktop app uses.
//
// The code in the URL is the only credential. The tab generates 128 bits of it,
// keeps it in localStorage and shows the client URL for you to paste; anyone
// without it can reach no tab at all, and the codes belonging to other people
// are not enumerable from here. That is a deliberately small security model for
// a deliberately small service: it grants no access to anything but one browser
// tab that is already open, and closing the tab ends it.
//
// No dependencies, on purpose. SSE plus POST needs nothing that node: does not
// already ship, so the image is FROM node + COPY, there is no lockfile to keep
// current and no build-time registry access.

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 8722);

// Generous: `upload_asset` sends a base64 image as a tool argument, and an
// `export_png` reply comes back the same way. Matches MAX_BODY in mcp_server.rs.
const MAX_BODY = Number(process.env.MCP_MAX_BODY || 32 * 1024 * 1024);

// The backstop, not the real timeout.
//
// The tab answers every request itself, including the ones it cannot finish: a
// watchdog in desktopMcpServer.ts resolves at 10s (170s for the render/persist
// tools) with an error naming the tool, which is what a client actually sees
// when something wedges. This budget only covers the case where the tab stopped
// answering altogether — throttled to a crawl in a background window, say — so
// it sits just above the slowest watchdog rather than trying to second-guess
// which tool is slow. Keeping the tool list in one place beats mirroring it in
// a third.
const CALL_TIMEOUT_MS = Number(process.env.MCP_CALL_TIMEOUT_MS || 190_000);

// A comment line often enough to beat any idle-connection reaper between here
// and the browser.
const STREAM_PING_MS = 20_000;

// Blunt caps so an open endpoint cannot be turned into free memory. Both are
// far above real use: one person drives one tab from one client.
const MAX_TABS = Number(process.env.MCP_MAX_TABS || 500);
const MAX_INFLIGHT_PER_TAB = 8;

// What the tab is allowed to call itself. Hex, long enough to be unguessable,
// bounded so the key of a Map cannot be a megabyte of someone's choosing.
const CODE_RE = /^[a-f0-9]{24,64}$/i;

/**
 * code -> { streams: ServerResponse[], pending: Map<callId, {resolve, timer}> }
 *
 * `streams` is a list rather than one socket because two editor tabs on the
 * same browser share a code (localStorage is per origin, not per tab). Requests
 * go to the newest one, which is the tab the user most recently opened.
 */
const tabs = new Map();

let sessionSeq = 0;

// ---------------------------------------------------------------------------
// Small HTTP helpers
// ---------------------------------------------------------------------------

// Native MCP clients send no Origin; browser-hosted ones do. Nothing here is
// protected by the browser's origin rules — the code in the path is the whole
// credential — so a permissive policy costs nothing and keeps both working.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

function sendJson(res, status, body, extraHeaders) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    ...CORS,
    ...extraHeaders,
  });
  res.end(text);
}

function sendEmpty(res, status) {
  res.writeHead(status, CORS);
  res.end();
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/** A JSON-RPC message with a method and a real id expects an answer. Anything
 *  else (a notification, a stray response) is acknowledged and dropped —
 *  matches is_request() in mcp_server.rs. */
function isRequest(msg) {
  return (
    msg && typeof msg === 'object' && !Array.isArray(msg) &&
    typeof msg.method === 'string' && msg.id !== undefined && msg.id !== null
  );
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// The tab side: one SSE stream per open editor, replies come back over POST
// ---------------------------------------------------------------------------

function entryFor(code, create) {
  let entry = tabs.get(code);
  if (!entry && create) {
    if (tabs.size >= MAX_TABS) return null;
    entry = { streams: [], pending: new Map() };
    tabs.set(code, entry);
  }
  return entry ?? null;
}

function dropIfIdle(code, entry) {
  if (entry.streams.length === 0 && entry.pending.size === 0) tabs.delete(code);
}

function openStream(code, req, res) {
  const entry = entryFor(code, true);
  if (!entry) return sendJson(res, 503, { error: 'too many connected tabs, try later' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // no-transform matters as much as no-cache: a proxy that gzips this stream
    // buffers it, and a buffered event stream is silence.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...CORS,
  });
  res.write(': connected\n\n');
  // Nagle would sit on the small frames this sends.
  req.socket.setNoDelay(true);
  // The stream is meant to be idle for long stretches; nothing may time it out.
  req.socket.setTimeout(0);

  entry.streams.push(res);

  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, STREAM_PING_MS);

  const close = () => {
    clearInterval(ping);
    const i = entry.streams.indexOf(res);
    if (i >= 0) entry.streams.splice(i, 1);
    dropIfIdle(code, entry);
  };
  res.on('close', close);
  res.on('error', close);
}

function pushToTab(entry, payload) {
  // Newest stream first: with two tabs open on one code, the one the user just
  // opened is the one they are looking at.
  for (let i = entry.streams.length - 1; i >= 0; i--) {
    const stream = entry.streams[i];
    if (stream.writableEnded) continue;
    stream.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  }
  return false;
}

async function handleReply(code, req, res) {
  const entry = tabs.get(code);
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req, MAX_BODY));
  } catch (e) {
    return sendJson(res, e?.tooLarge ? 413 : 400, { error: 'bad reply body' });
  }
  const waiter = entry?.pending.get(parsed?.callId);
  // A late reply (the call already timed out) is not an error worth reporting:
  // the client has moved on and the tab did nothing wrong.
  if (waiter) waiter.resolve(parsed.response);
  sendEmpty(res, 204);
}

// ---------------------------------------------------------------------------
// The client side: MCP Streamable HTTP, the same narrow subset Rust serves
// ---------------------------------------------------------------------------

function bridge(code, message) {
  const id = message.id ?? null;
  const entry = tabs.get(code);
  if (!entry || entry.streams.length === 0) {
    return Promise.resolve(
      rpcError(id, -32000, 'No editor tab is connected to this link. Open the editor, then turn on the MCP connection from the MCP pill at the bottom right of the canvas.')
    );
  }
  if (entry.pending.size >= MAX_INFLIGHT_PER_TAB) {
    return Promise.resolve(rpcError(id, -32000, 'too many requests in flight for this tab'));
  }

  const callId = randomUUID();
  return new Promise((resolve) => {
    const settle = (value) => {
      const waiter = entry.pending.get(callId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      entry.pending.delete(callId);
      dropIfIdle(code, entry);
      resolve(value);
    };

    const timer = setTimeout(
      () => settle(rpcError(id, -32001, `The editor tab did not answer within ${Math.round(CALL_TIMEOUT_MS / 1000)}s, so the call was dropped. Check that the tab is still open and try again.`)),
      CALL_TIMEOUT_MS
    );
    entry.pending.set(callId, { resolve: settle, timer });

    if (!pushToTab(entry, { callId, message })) {
      settle(rpcError(id, -32000, 'the editor tab disconnected'));
    }
  });
}

async function handleMcp(code, req, res) {
  switch (req.method) {
    case 'OPTIONS':
      return sendEmpty(res, 204);
    // No server->client stream is ever opened, so there is nothing to GET.
    case 'GET':
      return sendEmpty(res, 405);
    // Session teardown is a no-op: all state lives in the tab.
    case 'DELETE':
      return sendEmpty(res, 200);
    case 'POST':
      break;
    default:
      return sendEmpty(res, 405);
  }

  let raw;
  try {
    raw = await readBody(req, MAX_BODY);
  } catch (e) {
    return sendJson(res, e?.tooLarge ? 413 : 400, rpcError(null, -32700, 'could not read request body'));
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, rpcError(null, -32700, 'invalid JSON'));
  }

  if (Array.isArray(parsed)) {
    // Batch: answer the requests, drop the notifications. Rare, but cheap.
    const out = [];
    for (const item of parsed) {
      if (isRequest(item)) out.push(await bridge(code, item));
    }
    return out.length ? sendJson(res, 200, out) : sendEmpty(res, 202);
  }

  if (!parsed || typeof parsed !== 'object') {
    return sendJson(res, 400, rpcError(null, -32600, 'invalid request'));
  }
  if (!isRequest(parsed)) return sendEmpty(res, 202);

  const response = await bridge(code, parsed);
  const headers = parsed.method === 'initialize' ? { 'Mcp-Session-Id': `osg-mcp-${++sessionSeq}` } : undefined;
  sendJson(res, 200, response, headers);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (path === '/healthz') {
    return sendJson(res, 200, { ok: true, tabs: tabs.size });
  }

  const mcp = path.match(/^\/mcp\/([^/]+)$/);
  if (mcp) {
    if (!CODE_RE.test(mcp[1])) return sendJson(res, 404, rpcError(null, -32000, 'unknown link'));
    return void handleMcp(mcp[1], req, res);
  }

  const reply = path.match(/^\/tab\/([^/]+)\/reply$/);
  if (reply) {
    // The preflight has to be answered here rather than falling through to the
    // 404 below: this POST is JSON, which is not a CORS-safelisted content type,
    // so the browser asks first and a non-2xx answer means the reply never
    // leaves the tab. Native clients never send it, which is exactly why this is
    // the kind of thing only a real browser finds.
    if (req.method === 'OPTIONS') return sendEmpty(res, 204);
    if (req.method !== 'POST') return sendEmpty(res, 405);
    if (!CODE_RE.test(reply[1])) return sendJson(res, 404, { error: 'unknown link' });
    return void handleReply(reply[1], req, res);
  }

  const tab = path.match(/^\/tab\/([^/]+)$/);
  if (tab) {
    if (req.method === 'OPTIONS') return sendEmpty(res, 204);
    if (req.method !== 'GET') return sendEmpty(res, 405);
    if (!CODE_RE.test(tab[1])) return sendJson(res, 404, { error: 'unknown link' });
    return openStream(tab[1], req, res);
  }

  sendEmpty(res, 404);
});

// Node's default 5-minute request timeout would cut a slow tool call short at
// the wrong end. The call has its own budget above.
server.requestTimeout = 0;
server.headersTimeout = 60_000;

server.listen(PORT, () => {
  console.log(`[mcp-relay] listening on :${PORT}`);
});

let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (shuttingDown) return process.exit(0);
    shuttingDown = true;
    // End the streams first: they are long-lived by design, so close() on its
    // own would wait for every tab to leave.
    for (const entry of tabs.values()) for (const stream of entry.streams) stream.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
