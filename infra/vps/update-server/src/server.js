// The update server's HTTP side. createUpdateServer builds the server and
// never listens: main.js does that, and the tests start it on a free port.
//
// Public:
//   GET /healthz
//   GET /v1/desktop/{target}/{arch}/{bundle}/{current}?channel=&bucket=   the Tauri updater's check
//   GET /v1/files/{version}/{file}                                        an artifact, with Range
//
// Admin, behind a bearer token, and answering 404 when no token is set:
//   PUT /v1/admin/releases/{version}/files/{file}   upload one artifact
//   PUT /v1/admin/releases/{version}                publish its manifest
//   GET /v1/admin/releases
//   GET /v1/admin/channels
//   PUT /v1/admin/channels/{channel}                move a pointer
//   GET /v1/admin/stats
//
// A release is published by its manifest, and from then on nothing about it
// changes: a different upload or manifest for it is a 409. What installs are
// offered changes only through the two channel pointers, which carry the
// rollout and the pause.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { pipeline } from 'node:stream';
import { ARCHES, BUNDLES, CHANNELS, TARGETS, resolveUpdate } from './resolve.js';
import { isVersion } from './semver.js';
import { discard, openStore } from './store.js';
import { SHA256_RE, isFileName, mergePointer, normalizeManifest } from './validate.js';

const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
/** A shorter token keeps the admin API off. It is meant to be generated, not typed. */
const MIN_TOKEN_LENGTH = 32;
/** Manifests and pointer changes. Artifacts go through the upload route. */
const MAX_JSON_BYTES = 1024 * 1024;
/** Long enough for the largest artifact over a slow link from CI. */
const REQUEST_TIMEOUT_MS = 15 * 60_000;
/** Rows kept for /v1/admin/stats. `current` comes from the client, so the table needs a ceiling. */
const MAX_STAT_ROWS = 10_000;
/** A refused request body up to this size is read and dropped. A larger one closes the connection instead. */
const DRAIN_LIMIT_BYTES = 64 * 1024;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest();

function sendJson(res, status, body, headers) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

/**
 * An error answered before the request body is read. When a large body, or
 * one of unknown length, is still arriving, the connection is closed after
 * the answer, so a refused upload is not read to the end only to be thrown
 * away. A small one is read and dropped, which keeps the connection usable.
 */
function refuse(req, res, status, message, headers) {
  const close =
    !req.complete &&
    (req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length']) > DRAIN_LIMIT_BYTES);
  sendJson(res, status, { error: message }, close ? { ...headers, Connection: 'close' } : headers);
}

/** One path segment, percent-decoded, or null when it does not decode. */
function decodeSegment(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The single byte range a Range header asks for, as { start, end } with both
 * ends included, 'unsatisfiable' when it asks for nothing the file has, or
 * null to send the whole file. Several ranges, another unit or a malformed
 * header get the whole file too, which HTTP allows.
 */
function parseRange(header, size, ifRange, etag) {
  if (typeof header !== 'string') return null;
  // If-Range names the copy the client holds part of. Any other copy is sent whole.
  if (ifRange !== undefined && ifRange !== etag) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  if (match[2] !== '' && Number(match[2]) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1) };
}

function describePointer(pointer) {
  if (!pointer) return 'unset';
  return `${pointer.version} at ${pointer.rollout}%${pointer.paused ? ', paused' : ''}`;
}

/**
 * @typedef {object} UpdateServerOptions
 * @property {string} dataDir  where releases, channel pointers and uploads in progress live
 * @property {string} publicUrl  the base of every download URL the updater is handed
 * @property {string} [adminToken]  the admin API is off unless this is at least 32 characters
 * @property {number} [maxUploadBytes]  the largest artifact the upload route takes, 1 GiB unless set
 * @property {(line: string) => void} [log]
 */

/**
 * Builds the update server without starting it. `ready` resolves once
 * `dataDir` has been read; a request that arrives earlier waits for it.
 *
 * @param {UpdateServerOptions} options
 * @returns {{ server: import('node:http').Server, ready: Promise<void>, adminEnabled: boolean }}
 */
export function createUpdateServer({
  dataDir,
  publicUrl,
  adminToken = '',
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  log = console.log,
}) {
  if (typeof dataDir !== 'string' || dataDir === '') throw new TypeError('dataDir is required');
  const base = String(publicUrl ?? '').replace(/\/+$/, '');
  let protocol = '';
  try {
    protocol = new URL(base).protocol;
  } catch {
    // reported below
  }
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new TypeError(`publicUrl must be an http or https URL, not ${JSON.stringify(publicUrl)}`);
  }
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) {
    throw new TypeError(`maxUploadBytes must be a positive whole number, not ${maxUploadBytes}`);
  }

  // Compared as SHA-256 digests, which are always 32 bytes, so neither the
  // comparison nor its timing says anything about the token's length.
  const tokenDigest =
    typeof adminToken === 'string' && adminToken.length >= MIN_TOKEN_LENGTH ? sha256(adminToken) : null;

  const store = openStore(dataDir, log);

  // Since the last start. Counting happens in memory and is lost on restart.
  const stats = { since: new Date().toISOString(), checks: new Map(), offered: new Map(), full: false };

  function countCheck(channel, platform, current) {
    const key = `${channel} ${platform} ${current}`;
    const row = stats.checks.get(key);
    if (row) {
      row.count += 1;
    } else if (stats.checks.size < MAX_STAT_ROWS) {
      stats.checks.set(key, { channel, platform, current, count: 1 });
    } else if (!stats.full) {
      stats.full = true;
      log(`[updates] stats hold ${MAX_STAT_ROWS} rows, so new combinations are not counted until a restart`);
    }
  }

  function authorized(req) {
    const match = /^Bearer +(\S+) *$/i.exec(req.headers.authorization ?? '');
    return match !== null && crypto.timingSafeEqual(sha256(match[1]), tokenDigest);
  }

  /**
   * Parses the request body as JSON. When there is no usable body it answers
   * the request itself, 413 or 400, and returns undefined.
   */
  function readJsonBody(req, res) {
    return new Promise((resolve) => {
      const tooLarge = () => {
        refuse(req, res, 413, `the body is larger than ${MAX_JSON_BYTES} bytes`);
        resolve(undefined);
      };
      if (Number(req.headers['content-length']) > MAX_JSON_BYTES) {
        tooLarge();
        return;
      }
      const chunks = [];
      let size = 0;
      const onData = (chunk) => {
        size += chunk.length;
        if (size <= MAX_JSON_BYTES) {
          chunks.push(chunk);
          return;
        }
        // Read and drop the rest, so the answer is not cut off by a reset.
        req.off('data', onData);
        req.resume();
        tooLarge();
      };
      req.on('data', onData);
      req.on('end', () => {
        if (size > MAX_JSON_BYTES) return;
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          sendJson(res, 400, { error: 'the body is not JSON' });
          resolve(undefined);
        }
      });
      // The client went away. Nobody is left to answer, and settling a second
      // time after 'end' does nothing.
      req.on('error', () => resolve(undefined));
      req.on('close', () => resolve(undefined));
    });
  }

  function healthz(req, res) {
    const channels = Object.fromEntries(CHANNELS.map((channel) => [channel, store.pointers[channel]?.version ?? null]));
    sendJson(res, 200, { ok: true, channels });
  }

  /** GET /v1/desktop/{target}/{arch}/{bundle}/{current}: the question the Tauri updater asks. */
  function check(req, res, params, query) {
    const noStore = { 'Cache-Control': 'no-store' };
    const fail = (error) => sendJson(res, 400, { error }, noStore);
    const [target, arch, bundle, raw] = params.map(decodeSegment);
    if (!TARGETS.includes(target)) return fail(`target must be one of ${TARGETS.join(', ')}`);
    if (!ARCHES.includes(arch)) return fail(`arch must be one of ${ARCHES.join(', ')}`);
    if (bundle !== 'unknown' && !BUNDLES.includes(bundle)) return fail(`bundle must be one of ${BUNDLES.join(', ')} or unknown`);
    const current = raw?.startsWith('v') ? raw.slice(1) : raw;
    if (!isVersion(current)) return fail('the installed version must look like 1.0.6');
    const channel = query.get('channel') ?? 'stable';
    if (!CHANNELS.includes(channel)) return fail(`channel must be ${CHANNELS.join(' or ')}`);
    const rawBucket = query.get('bucket');
    if (rawBucket !== null && !/^\d{1,2}$/.test(rawBucket)) return fail('bucket must be a whole number from 0 to 99');
    // An install that sends no bucket gets a release only once it reaches everybody.
    const bucket = rawBucket === null ? 99 : Number(rawBucket);

    countCheck(channel, `${target}-${arch}-${bundle}`, current);
    const offer = resolveUpdate({
      pointers: store.pointers,
      manifestOf: store.manifestOf,
      channel,
      bucket,
      target,
      arch,
      bundle,
      current,
    });
    if (!offer) {
      res.writeHead(204, noStore);
      res.end();
      return;
    }

    const { manifest, artifact } = offer;
    stats.offered.set(manifest.version, (stats.offered.get(manifest.version) ?? 0) + 1);
    // snake_case because that is what Tauri reads. It reads version, pub_date,
    // notes, url and signature; the rest reach the app through the raw JSON.
    sendJson(
      res,
      200,
      {
        version: manifest.version,
        pub_date: manifest.pubDate,
        ...(manifest.notes ? { notes: manifest.notes } : {}),
        url: `${base}/v1/files/${encodeURIComponent(manifest.version)}/${encodeURIComponent(artifact.file)}`,
        signature: artifact.signature,
        size: artifact.size,
        sha256: artifact.sha256,
        critical: manifest.critical,
        channel: offer.channel,
        download_page: manifest.downloadPage,
      },
      noStore
    );
  }

  /** GET and HEAD /v1/files/{version}/{file}: only what a published manifest lists. */
  async function download(req, res, params) {
    const [version, name] = params.map(decodeSegment);
    const manifest = isVersion(version) ? store.manifestOf(version) : null;
    const artifact =
      manifest && isFileName(name) ? Object.values(manifest.artifacts).find((entry) => entry.file === name) : undefined;
    if (!artifact) return refuse(req, res, 404, 'not found');

    const file = store.filePath(version, name);
    let size;
    try {
      size = (await fsp.stat(file)).size;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      log(`[updates] ${version}/${name} is in the manifest and missing from disk`);
      return refuse(req, res, 404, 'not found');
    }
    if (size !== artifact.size) {
      log(`[updates] ${version}/${name} is ${size} bytes on disk and ${artifact.size} in the manifest, so it is not served`);
      return sendJson(res, 500, { error: 'this file does not match its manifest' });
    }

    const etag = `"${artifact.sha256}"`;
    const range = parseRange(req.headers.range, size, req.headers['if-range'], etag);
    if (range === 'unsatisfiable') {
      return sendJson(res, 416, { error: 'range not satisfiable' }, { 'Content-Range': `bytes */${size}` });
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    res.writeHead(range ? 206 : 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      'Accept-Ranges': 'bytes',
      ETag: etag,
      // A published file never changes, so it can be cached for good.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD' || size === 0) {
      res.end();
      return;
    }
    // pipeline closes the file when the client goes away part way through.
    pipeline(fs.createReadStream(file, { start, end }), res, (error) => {
      if (error && !['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'EPIPE'].includes(error.code)) {
        log(`[updates] sending ${version}/${name} stopped: ${error.message}`);
      }
    });
  }

  /** PUT /v1/admin/releases/{version}/files/{file}: one artifact, streamed to disk while it is hashed. */
  async function upload(req, res, params) {
    const [version, name] = params.map(decodeSegment);
    if (!isVersion(version)) return refuse(req, res, 400, 'the version in the URL must look like 1.0.7');
    if (!isFileName(name)) {
      return refuse(
        req,
        res,
        400,
        'the file name must be letters, digits, dots, hyphens and underscores, at most 200 of them, starting with a letter or digit, and not manifest.json'
      );
    }
    const declared = req.headers['content-length'];
    if (declared === undefined) return refuse(req, res, 411, 'Content-Length is required');
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) return refuse(req, res, 400, 'Content-Length must be a number of bytes');
    if (length > maxUploadBytes) return refuse(req, res, 413, `the largest file this server takes is ${maxUploadBytes} bytes`);
    const claimed = req.headers['x-content-sha256'];
    if (typeof claimed !== 'string' || !SHA256_RE.test(claimed)) {
      return refuse(req, res, 400, 'X-Content-SHA256 must be the sha256 of the body, as 64 lowercase hex characters');
    }

    let received;
    try {
      received = await store.receive(req, length);
    } catch (error) {
      log(`[updates] upload of ${version}/${name} stopped: ${error.message}`);
      return refuse(req, res, 400, 'the upload stopped before the whole file arrived');
    }
    if (received.size !== length || received.sha256 !== claimed) {
      await discard(received.file);
      const error =
        received.size !== length
          ? `received ${received.size} bytes, and Content-Length said ${length}`
          : `the body's sha256 is ${received.sha256}, and X-Content-SHA256 said ${claimed}`;
      return sendJson(res, 400, { error });
    }

    let status;
    try {
      status = await store.exclusive(() => store.commitFile(version, name, received));
    } catch (error) {
      await discard(received.file);
      throw error;
    }
    if (status === 409) {
      return sendJson(res, 409, {
        error: `${version} is published and does not hold these bytes as ${name}. A published release never changes`,
      });
    }
    if (status === 201) log(`[updates] stored ${version}/${name}, ${received.size} bytes`);
    sendJson(res, status, { file: name, size: received.size, sha256: received.sha256 });
  }

  /** PUT /v1/admin/releases/{version}: the manifest, whose arrival publishes the release. */
  async function publish(req, res, params) {
    const version = decodeSegment(params[0]);
    if (!isVersion(version)) return refuse(req, res, 400, 'the version in the URL must look like 1.0.7');
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    const result = normalizeManifest(body, version);
    if (result.error) return sendJson(res, 400, { error: result.error });
    const outcome = await store.exclusive(() => store.publish(result.manifest));
    if (outcome.error) return sendJson(res, outcome.status, { error: outcome.error });
    if (outcome.status === 201) log(`[updates] published ${version}: ${Object.keys(outcome.manifest.artifacts).join(', ')}`);
    sendJson(res, outcome.status, outcome.manifest);
  }

  /** PUT /v1/admin/channels/{channel}: merges the body onto the pointer. */
  async function moveChannel(req, res, params) {
    const channel = decodeSegment(params[0]);
    if (!CHANNELS.includes(channel)) return refuse(req, res, 400, `the channel must be ${CHANNELS.join(' or ')}`);
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    const outcome = await store.exclusive(async () => {
      const current = store.pointers[channel];
      const result = mergePointer(current, body, store.isPublished, new Date().toISOString());
      if (result.error) return result;
      const next = result.pointer;
      // Nothing changes, so nothing is written and history gets no line.
      if (current && next.version === current.version && next.rollout === current.rollout && next.paused === current.paused) {
        return { pointer: current };
      }
      await store.setPointer(channel, next);
      log(`[updates] ${channel} is ${describePointer(next)}, was ${describePointer(current)}`);
      return { pointer: next };
    });
    if (outcome.error) return sendJson(res, 400, { error: outcome.error });
    sendJson(res, 200, outcome.pointer);
  }

  function listReleases(req, res) {
    sendJson(res, 200, store.listReleases());
  }

  function listChannels(req, res) {
    sendJson(res, 200, Object.fromEntries(CHANNELS.map((channel) => [channel, store.pointers[channel]])));
  }

  function statsRoute(req, res) {
    sendJson(res, 200, {
      since: stats.since,
      checks: [...stats.checks.values()].sort((a, b) => b.count - a.count),
      offered: Object.fromEntries(stats.offered),
    });
  }

  // A route without its own HEAD answers HEAD with its GET handler; node
  // leaves the body out.
  const routes = [
    { pattern: /^\/healthz$/, methods: { GET: healthz } },
    { pattern: /^\/v1\/desktop\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/, methods: { GET: check } },
    { pattern: /^\/v1\/files\/([^/]+)\/([^/]+)$/, methods: { GET: download, HEAD: download } },
    { pattern: /^\/v1\/admin\/releases$/, methods: { GET: listReleases } },
    { pattern: /^\/v1\/admin\/releases\/([^/]+)$/, methods: { PUT: publish } },
    { pattern: /^\/v1\/admin\/releases\/([^/]+)\/files\/([^/]+)$/, methods: { PUT: upload } },
    { pattern: /^\/v1\/admin\/channels$/, methods: { GET: listChannels } },
    { pattern: /^\/v1\/admin\/channels\/([^/]+)$/, methods: { PUT: moveChannel } },
    { pattern: /^\/v1\/admin\/stats$/, methods: { GET: statsRoute } },
  ];

  async function handle(req, res) {
    const url = req.url || '/';
    const mark = url.indexOf('?');
    const pathname = (mark === -1 ? url : url.slice(0, mark)).replace(/\/+$/, '') || '/';
    const query = new URLSearchParams(mark === -1 ? '' : url.slice(mark + 1));
    try {
      if (pathname === '/v1/admin' || pathname.startsWith('/v1/admin/')) {
        if (!tokenDigest) return refuse(req, res, 404, 'not found');
        if (!authorized(req)) return refuse(req, res, 401, 'this needs the admin token', { 'WWW-Authenticate': 'Bearer' });
      }
      for (const route of routes) {
        const match = route.pattern.exec(pathname);
        if (!match) continue;
        const handler = route.methods[req.method] ?? (req.method === 'HEAD' ? route.methods.GET : undefined);
        if (!handler) {
          const allowed = Object.keys(route.methods);
          if (allowed.includes('GET') && !allowed.includes('HEAD')) allowed.push('HEAD');
          return refuse(req, res, 405, 'method not allowed', { Allow: allowed.join(', ') });
        }
        return await handler(req, res, match.slice(1), query);
      }
      return refuse(req, res, 404, 'not found');
    } catch (error) {
      log(`[updates] ${req.method} ${pathname} failed: ${error?.stack ?? error}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' }, { Connection: 'close' });
      else res.destroy();
    }
  }

  let loaded = false;
  const ready = store.load().then(() => {
    loaded = true;
    const published = [...store.releases.values()].filter((release) => release.published).length;
    const channels = CHANNELS.map((channel) => `${channel} ${describePointer(store.pointers[channel])}`).join(', ');
    log(`[updates] read ${dataDir}. Release folders: ${store.releases.size}, published: ${published}. ${channels}`);
  });

  const server = http.createServer((req, res) => {
    if (loaded) {
      void handle(req, res);
      return;
    }
    ready.then(
      () => handle(req, res),
      () => sendJson(res, 503, { error: 'the update server could not read its data' })
    );
  });
  // Node's default of 5 minutes would cut off a large upload.
  server.requestTimeout = REQUEST_TIMEOUT_MS;

  return { server, ready, adminEnabled: tokenDigest !== null };
}
