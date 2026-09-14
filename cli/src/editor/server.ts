/**
 * The local origin.
 *
 * Binding to 127.0.0.1 is mandatory, not a preference: a page served from a
 * file:// URL or a non-loopback plain-http origin is not a "secure context",
 * and without one the browser hides `crypto.subtle`, `VideoEncoder` and a
 * usable IndexedDB. That would silently take out MP4 export, id hashing and
 * the whole Dexie layer the editor stores projects in. Loopback http is
 * treated as trustworthy, so everything works with no certificate.
 *
 * The server does three jobs:
 *   - serve the editor bundle
 *   - hydrate artwork the tarball does not carry (see assets.ts)
 *   - expose local files the page needs to fetch by URL, under /__osg/media/,
 *     so a large screen recording reaches `upload_recording` as a URL rather
 *     than as base64 through a JSON-RPC body cap
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { hydrate, type AssetManifest } from './assets.js';
import { isInside } from '../paths.js';
import { debug, warn } from '../log.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const mimeFor = (file: string) => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

export interface EditorServerOptions {
  dir: string;
  manifest: AssetManifest;
  assetsBaseUrl: string;
  offline: boolean;
  /** Counted so doctor and --verbose can report hydration volume. */
  onFetch?: (bytes: number) => void;
}

export interface EditorServer {
  origin: string;
  port: number;
  /** Publish a local file at /__osg/media/<name> and return the absolute URL. */
  serveFile(absolutePath: string, name?: string): string;
  hydratedBytes(): number;
  close(): Promise<void>;
}

type MediaEntry = { file: string };

export async function startEditorServer(options: EditorServerOptions): Promise<EditorServer> {
  const root = path.resolve(options.dir);
  const media = new Map<string, MediaEntry>();
  let hydrationBytes = 0;

  const sendBuffer = (res: http.ServerResponse, body: Buffer, type: string) => {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': String(body.length),
      // Nothing here should be cached by the browser across runs, because
      // `osg editor use` can swap the bundle underneath a reused profile.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  };

  const sendFile = (req: http.IncomingMessage, res: http.ServerResponse, file: string) => {
    const stat = fs.statSync(file);
    const type = mimeFor(file);
    const range = req.headers.range;
    // Range matters for exactly one case: a screen recording the page plays
    // back through a video element. Chrome will not seek a 200 response.
    if (range && range.startsWith('bytes=')) {
      const [startRaw, endRaw] = range.slice('bytes='.length).split('-');
      const start = Number(startRaw) || 0;
      const end = endRaw ? Math.min(Number(endRaw), stat.size - 1) : stat.size - 1;
      if (start >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        let pathname = decodeURIComponent(url.pathname);

        if (pathname.startsWith('/__osg/media/')) {
          const key = pathname.slice('/__osg/media/'.length);
          const entry = media.get(key);
          if (!entry || !fs.existsSync(entry.file)) {
            res.writeHead(404).end('not found');
            return;
          }
          sendFile(req, res, entry.file);
          return;
        }

        // A liveness probe the driver waits on instead of guessing a boot delay.
        if (pathname === '/__osg/ping') {
          sendBuffer(res, Buffer.from(JSON.stringify({ ok: true, root })), 'application/json');
          return;
        }

        if (pathname === '/') pathname = '/index.html';

        const candidate = path.join(root, pathname);
        if (!isInside(root, candidate)) {
          res.writeHead(403).end('forbidden');
          return;
        }

        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          sendFile(req, res, candidate);
          return;
        }

        // Not on disk. If the packaged manifest knows this path, it is artwork
        // the tarball deliberately does not carry: fetch, verify, cache, serve.
        const hydrated = await hydrate(pathname, {
          manifest: options.manifest,
          assetsBaseUrl: options.assetsBaseUrl,
          offline: options.offline,
          onFetch: (entry) => {
            hydrationBytes += entry.bytes;
            options.onFetch?.(entry.bytes);
          },
        });
        if (hydrated) {
          sendBuffer(res, hydrated, mimeFor(pathname));
          return;
        }

        // A route with no extension is the static export's single page.
        if (!path.extname(pathname)) {
          const index = path.join(root, 'index.html');
          if (fs.existsSync(index)) {
            sendFile(req, res, index);
            return;
          }
        }

        debug(`404 ${pathname}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      } catch (error) {
        warn(`server: ${(error as Error).message}`);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end((error as Error).message);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Port 0 lets the OS pick, so two runs never collide. 127.0.0.1 rather
    // than localhost, because localhost can resolve to ::1 first and the page
    // origin would then differ from the one the driver navigated to.
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  debug(`editor server ${origin} -> ${root}`);

  let counter = 0;
  return {
    origin,
    port,
    serveFile(absolutePath: string, name?: string): string {
      const file = path.resolve(absolutePath);
      // Keep the real extension: the page sniffs on it for video and images.
      const raw = `${(counter++).toString(36)}-${name ?? path.basename(file)}`;
      const key = raw.replace(/[^A-Za-z0-9._-]/g, '_');
      media.set(key, { file });
      return `${origin}/__osg/media/${key}`;
    },
    hydratedBytes: () => hydrationBytes,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      debug(`editor server closed after ${hydrationBytes} hydrated bytes`);
    },
  };
}
