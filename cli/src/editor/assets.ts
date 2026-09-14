/**
 * Artwork hydration.
 *
 * The published tarball carries the *program* (the Next shell, the 101 template
 * JSONs and the AI catalog, together a few megabytes) and none of the artwork
 * the templates paint, which is an order of magnitude larger and, for the image
 * library, licensed to this project rather than owned by it. See
 * THIRD-PARTY-ASSETS.md.
 *
 * So a missing file under a manifest path is fetched from the project's own
 * deployment on first use, exactly as a browser visiting the site would fetch
 * it, checked against the sha256 in the manifest, and written into a
 * machine-wide content-addressed cache. Any given file is downloaded once per
 * machine, ever, across every CLI version.
 *
 * A miss with --offline is a hard error rather than a silent gap, because
 * src/services/projectService.ts warns-and-drops a template it cannot load and
 * a store screenshot with a hole in it is worse than a failed run.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assetCacheDir, ensureDir } from '../paths.js';
import { debug, warn } from '../log.js';
import { OsgError, EXIT } from '../errors.js';

export interface AssetEntry {
  /** Root absolute path as the page requests it, e.g. /data/projects/foo.json */
  path: string;
  bytes: number;
  sha256: string;
}

export interface AssetManifest {
  version: string;
  /** Tier each entry belongs to, so `osg cache warm --tier` can select. */
  tiers: Record<string, string[]>;
  entries: Record<string, AssetEntry>;
}

const EMPTY: AssetManifest = { version: '0', tiers: {}, entries: {} };

export function loadManifest(file: string): AssetManifest {
  try {
    if (!fs.existsSync(file)) return EMPTY;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AssetManifest;
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) return EMPTY;
    return parsed;
  } catch (error) {
    warn(`asset manifest unreadable, hydration disabled: ${(error as Error).message}`);
    return EMPTY;
  }
}

/** Where a digest lives on disk. Two hex chars of fan-out keeps directories small. */
export function cachePathFor(sha256: string): string {
  return path.join(assetCacheDir(), sha256.slice(0, 2), sha256);
}

export function isCached(sha256: string): boolean {
  return fs.existsSync(cachePathFor(sha256));
}

export function readCached(sha256: string): Buffer | null {
  const file = cachePathFor(sha256);
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

function writeCached(sha256: string, body: Buffer): void {
  const file = cachePathFor(sha256);
  ensureDir(path.dirname(file));
  // Write then rename, so a killed run never leaves a half file that would
  // then fail its digest check forever.
  const tmp = `${file}.${process.pid}.part`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

export function digestOf(body: Buffer): string {
  return crypto.createHash('sha256').update(body).digest('hex');
}

export interface HydrateOptions {
  manifest: AssetManifest;
  assetsBaseUrl: string;
  offline: boolean;
  /** Called once per network fetch, for progress reporting. */
  onFetch?: (entry: AssetEntry) => void;
}

/**
 * Return the bytes for a manifest path, from cache or from the network.
 * Returns null when the path is not in the manifest at all (a genuine 404).
 */
export async function hydrate(requestPath: string, options: HydrateOptions): Promise<Buffer | null> {
  const entry = options.manifest.entries[requestPath];
  if (!entry) return null;

  const cached = readCached(entry.sha256);
  if (cached) {
    debug(`asset cache hit ${requestPath}`);
    return cached;
  }

  if (options.offline) {
    throw new OsgError(`Missing asset in offline mode: ${requestPath}`, {
      code: EXIT.driver,
      fix: 'Run `osg cache warm` once with a network, or `osg cache warm --from ./public` from a checkout.',
      detail: { path: requestPath, sha256: entry.sha256 },
    });
  }

  const url = `${options.assetsBaseUrl.replace(/\/+$/, '')}${requestPath}`;
  debug(`asset fetch ${url}`);
  options.onFetch?.(entry);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new OsgError(`Could not fetch ${requestPath}: ${(error as Error).message}`, {
      code: EXIT.driver,
      fix: `Check the network, or point --assets-base-url at a mirror of ${options.assetsBaseUrl}.`,
    });
  }
  if (!response.ok) {
    throw new OsgError(`Could not fetch ${requestPath}: HTTP ${response.status}`, {
      code: EXIT.driver,
      fix: 'The asset host may be mid-deploy. Retry, or use --assets-base-url to point elsewhere.',
    });
  }

  const body = Buffer.from(await response.arrayBuffer());
  const actual = digestOf(body);
  if (actual !== entry.sha256) {
    // A digest mismatch means the deployment moved on from the packaged
    // manifest. Serving it anyway would render a design nobody authored.
    throw new OsgError(`Asset digest mismatch for ${requestPath}`, {
      code: EXIT.driver,
      fix: 'The asset host is a different version than this CLI. Upgrade with `npm i -g open-screenshot-generator@latest`.',
      detail: { expected: entry.sha256, actual },
    });
  }

  writeCached(entry.sha256, body);
  return body;
}

/** Copy a local public/ checkout into the cache, so nothing is fetched at all. */
export function seedFromDirectory(manifest: AssetManifest, publicDir: string): { seeded: number; missing: string[] } {
  let seeded = 0;
  const missing: string[] = [];
  for (const [requestPath, entry] of Object.entries(manifest.entries)) {
    if (isCached(entry.sha256)) {
      seeded++;
      continue;
    }
    const source = path.join(publicDir, requestPath.replace(/^\//, ''));
    if (!fs.existsSync(source)) {
      missing.push(requestPath);
      continue;
    }
    const body = fs.readFileSync(source);
    if (digestOf(body) !== entry.sha256) {
      missing.push(requestPath);
      continue;
    }
    writeCached(entry.sha256, body);
    seeded++;
  }
  return { seeded, missing };
}

export function cacheStats(manifest: AssetManifest): { cached: number; total: number; cachedBytes: number; totalBytes: number } {
  let cached = 0;
  let cachedBytes = 0;
  let totalBytes = 0;
  const entries = Object.values(manifest.entries);
  for (const entry of entries) {
    totalBytes += entry.bytes;
    if (isCached(entry.sha256)) {
      cached++;
      cachedBytes += entry.bytes;
    }
  }
  return { cached, total: entries.length, cachedBytes, totalBytes };
}
