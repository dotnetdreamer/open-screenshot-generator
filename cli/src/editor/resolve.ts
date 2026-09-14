/**
 * Where the editor comes from.
 *
 * The whole point of this CLI is that it never contains a second renderer: it
 * drives the real editor bundle, so what it produces is what the app produces.
 * That bundle can come from four places, tried in this order.
 *
 *   1. --editor-url          a running `npm run dev` on 9002, or any deployment
 *   2. OSG_EDITOR_DIR, or `osg editor use <dir>`   a checkout's out/
 *   3. the bundle inside this package (cli/editor/), present in the tarball
 *   4. a repo checkout we appear to be sitting inside (out/), for contributors
 *
 * If none of those exist the CLI falls back to driving the project's own
 * deployment directly. That keeps `npx open-screenshot-generator` working from
 * a bare directory on a machine that has never seen this repo, at the cost of
 * needing a network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheRoot, ensureDir } from '../paths.js';
import { debug } from '../log.js';
import { DEFAULTS } from '../config.js';

export type EditorSource =
  | { kind: 'local'; dir: string; label: string }
  | { kind: 'remote'; origin: string; label: string };

const here = path.dirname(fileURLToPath(import.meta.url));
/** dist/ sits one level under the package root, so the packaged editor is ../editor. */
const packageRoot = path.resolve(here, '..');

const pinFile = () => path.join(cacheRoot(), 'editor-dir.json');

export function readPinnedDir(): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(pinFile(), 'utf8')) as { dir?: string };
    return parsed.dir && fs.existsSync(parsed.dir) ? parsed.dir : null;
  } catch {
    return null;
  }
}

export function writePinnedDir(dir: string | null): void {
  const file = pinFile();
  ensureDir(path.dirname(file));
  if (dir === null) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.writeFileSync(file, JSON.stringify({ dir: path.resolve(dir) }, null, 2));
}

/** A directory is an editor bundle if it has the exported shell in it. */
export function looksLikeEditor(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, '_next'));
}

/** Walk up looking for a checkout of this repository with a build in out/. */
function findCheckoutBuild(from: string): string | null {
  let dir = path.resolve(from);
  for (let depth = 0; depth < 8; depth++) {
    const out = path.join(dir, 'out');
    const pkg = path.join(dir, 'package.json');
    if (looksLikeEditor(out) && fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
        if (parsed.name === 'open-screenshot-generator') return out;
      } catch {
        // fall through
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface ResolveOptions {
  editorUrl?: string;
  cwd?: string;
  assetsBaseUrl?: string;
}

export function resolveEditor(options: ResolveOptions = {}): EditorSource {
  const url = options.editorUrl?.trim() || process.env.OSG_EDITOR_URL?.trim();
  if (url) {
    debug(`editor: remote ${url}`);
    return { kind: 'remote', origin: url.replace(/\/+$/, ''), label: `--editor-url ${url}` };
  }

  const envDir = process.env.OSG_EDITOR_DIR?.trim();
  if (envDir && looksLikeEditor(envDir)) {
    debug(`editor: OSG_EDITOR_DIR ${envDir}`);
    return { kind: 'local', dir: path.resolve(envDir), label: `OSG_EDITOR_DIR ${envDir}` };
  }

  const pinned = readPinnedDir();
  if (pinned && looksLikeEditor(pinned)) {
    debug(`editor: pinned ${pinned}`);
    return { kind: 'local', dir: pinned, label: `osg editor use ${pinned}` };
  }

  const packaged = path.join(packageRoot, 'editor');
  if (looksLikeEditor(packaged)) {
    debug(`editor: packaged ${packaged}`);
    return { kind: 'local', dir: packaged, label: 'bundled with this package' };
  }

  const checkout = findCheckoutBuild(options.cwd ?? process.cwd());
  if (checkout) {
    debug(`editor: checkout ${checkout}`);
    return { kind: 'local', dir: checkout, label: `repository build ${checkout}` };
  }

  const hosted = (options.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl).replace(/\/+$/, '');
  debug(`editor: hosted fallback ${hosted}`);
  return { kind: 'remote', origin: hosted, label: `hosted ${hosted}` };
}

export function manifestPath(): string {
  return path.join(packageRoot, 'assets.manifest.json');
}
