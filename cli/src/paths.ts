/**
 * Where the CLI keeps things on each OS.
 *
 * The cache is shared across CLI versions on purpose: artwork is
 * content-addressed by sha256, so a file downloaded by 0.1.27 is still the
 * right file for 0.2.0 and nobody pays for it twice.
 *
 * Windows notes, because this repo's own author is on Windows: %LOCALAPPDATA%
 * routinely contains spaces, and a content-addressed <sha[0:2]>/<sha> layout
 * under a deep project path can cross the 260 character limit. Both are why
 * the cache lives under a short, absolute, OS-owned root rather than beside
 * the project.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const APP = 'open-screenshot-generator';

/** Root of every cache this CLI owns. Override with OSG_CACHE_DIR. */
export function cacheRoot(): string {
  const override = process.env.OSG_CACHE_DIR?.trim();
  if (override) return path.resolve(override);
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, APP, 'Cache');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', APP);
  }
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  return path.join(xdg || path.join(os.homedir(), '.cache'), APP);
}

/** Content-addressed artwork the local server hydrates on demand. */
export const assetCacheDir = () => path.join(cacheRoot(), 'assets');
/** Google Fonts CSS and woff2 responses, so a warm machine renders offline. */
export const fontCacheDir = () => path.join(cacheRoot(), 'fonts');
/** Editor bundles downloaded for a version other than the packaged one. */
export const editorCacheDir = () => path.join(cacheRoot(), 'editor');
/** Browsers fetched by `osg doctor --install-browser`. */
export const browserCacheDir = () => path.join(cacheRoot(), 'browsers');
/** Live session lockfiles, so `osg studio` and `osg mcp` can share one window. */
export const sessionDir = () => path.join(cacheRoot(), 'sessions');

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A path is inside a root. Used to refuse to serve outside the editor dir. */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
