// Zero-dependency static file server for the `next build` output in `out/`.
//
// The desktop shell loads `frontendDist: "../out"` in a release build, so the
// static export is the bundle desktop users actually run. `npm run test:e2e:static`
// points the suite at this server instead of the dev server, which is what
// catches anything that only works because Turbopack is in the loop.
//
// Usage: node tests/e2e/tools/static-server.mjs [--port 9003] [--dir out]

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const port = Number(flag('port', process.env.E2E_STATIC_PORT ?? 9003));
const root = resolve(process.cwd(), flag('dir', 'out'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

async function resolveFile(pathname) {
  // normalize() plus the prefix check is what keeps `../` out of the tree.
  const candidate = normalize(join(root, decodeURIComponent(pathname)));
  if (!candidate.startsWith(root)) return null;

  try {
    const info = await stat(candidate);
    if (info.isFile()) return candidate;
    if (info.isDirectory()) {
      const index = join(candidate, 'index.html');
      await stat(index);
      return index;
    }
  } catch {
    // `output: 'export'` writes /foo as foo.html, so try that before giving up.
    try {
      const html = `${candidate}.html`;
      await stat(html);
      return html;
    } catch {
      return null;
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const file = (await resolveFile(url.pathname)) ?? (await resolveFile('/index.html'));

  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    // The suite must never be served a stale bundle from a previous build.
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`static export served from ${root} on http://localhost:${port}`);
});
