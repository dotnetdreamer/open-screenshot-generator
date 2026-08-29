/**
 * `osg cache` - the two caches that decide whether a run is fast, and whether
 * an offline run is possible at all.
 *
 * The published tarball carries the program and none of the artwork (see
 * editor/assets.ts and THIRD-PARTY-ASSETS.md), so the first render on a cold
 * machine spends its time downloading files it will then never download again.
 * `warm` moves that cost to a moment the user chose, which is what makes `osg
 * all --offline` in CI a sensible thing to ask for.
 *
 * Fonts are a separate cache and a separate problem. The editor asks Google
 * Fonts for one stylesheet at boot and then for a woff2 per family, per subset,
 * on demand, so a machine that has only ever rendered English has nothing
 * cached for Japanese. `--fonts` boots the real editor, reads the @font-face
 * sheet the app itself installed (src/services/fontService.ts inlines it under
 * the id `google-font-faces`), and asks the page for every face in it. Each of
 * those requests goes through the interceptor in browser/launch.ts, which is
 * what actually writes the font cache. Deriving the list from the app's own
 * sheet rather than from a list copied into the CLI means a family added to
 * fontService is warmed the day it ships, with no second list to update.
 *
 * Progress is a count rather than a spinner, on purpose: this output is read as
 * often by a CI log and an agent as by a person, and a spinner is noise in both.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CommandContext } from '../context.js';
import { flagBool, flagString } from '../args.js';
import { EXIT, usageError } from '../errors.js';
import { debug, dim, emit, humanBytes, info, ok, step, warn } from '../log.js';
import { manifestPath } from '../editor/resolve.js';
import {
  cacheStats,
  hydrate,
  isCached,
  loadManifest,
  seedFromDirectory,
  type AssetManifest,
} from '../editor/assets.js';
import { assetCacheDir, browserCacheDir, cacheRoot, fontCacheDir } from '../paths.js';
import { DEFAULTS } from '../config.js';

/** How many artwork fetches are in flight at once. */
const FETCH_CONCURRENCY = 8;
/** How many font faces one page-side batch asks for. */
const FONT_BATCH = 24;

export async function run(ctx: CommandContext): Promise<number> {
  const sub = (ctx.args.positionals[0] ?? 'info').toLowerCase();
  const manifest = loadManifest(manifestPath());

  switch (sub) {
    case 'info':
      return showInfo(ctx, manifest);
    case 'warm':
      return warm(ctx, manifest);
    case 'prune':
      return prune(ctx, manifest);
    case 'seed':
      return seed(ctx, manifest);
    default:
      throw usageError(`Unknown cache action: ${sub}`, 'Use one of: warm, info, prune, seed');
  }
}

// --- info -------------------------------------------------------------------

function showInfo(ctx: CommandContext, manifest: AssetManifest): number {
  const stats = cacheStats(manifest);
  const fonts = dirStats(fontCacheDir());
  const browsers = dirStats(browserCacheDir());
  const tiers = Object.entries(manifest.tiers).map(([name, paths]) => ({ name, files: paths.length }));

  if (ctx.json) {
    emit({
      ok: true,
      root: cacheRoot(),
      manifest: { path: manifestPath(), version: manifest.version, entries: stats.total, tiers },
      assets: {
        dir: assetCacheDir(),
        cached: stats.cached,
        total: stats.total,
        cachedBytes: stats.cachedBytes,
        totalBytes: stats.totalBytes,
      },
      fonts: { dir: fontCacheDir(), files: fonts.files, bytes: fonts.bytes },
      browsers: { dir: browserCacheDir(), files: browsers.files, bytes: browsers.bytes },
    });
    return EXIT.ok;
  }

  info(`\n  ${dim('cache')}     ${cacheRoot()}`);
  if (stats.total === 0) {
    info(`  ${dim('artwork')}   no asset manifest in this build, nothing to hydrate`);
  } else {
    const percent = Math.round((stats.cached / stats.total) * 100);
    info(
      `  ${dim('artwork')}   ${stats.cached} of ${stats.total} files (${percent}%), ` +
        `${humanBytes(stats.cachedBytes)} of ${humanBytes(stats.totalBytes)}`
    );
    if (tiers.length) info(`  ${dim('tiers')}     ${tiers.map((t) => `${t.name} (${t.files})`).join(', ')}`);
  }
  info(`  ${dim('fonts')}     ${fonts.files} files, ${humanBytes(fonts.bytes)}`);
  if (browsers.files) info(`  ${dim('browsers')}  ${browsers.files} files, ${humanBytes(browsers.bytes)}`);
  info('');
  if (stats.total && stats.cached < stats.total) {
    info(`  ${dim('Run `osg cache warm` to fetch the rest, or `osg cache warm --fonts` for the faces too')}\n`);
  }
  return EXIT.ok;
}

// --- warm -------------------------------------------------------------------

async function warm(ctx: CommandContext, manifest: AssetManifest): Promise<number> {
  if (ctx.offline) {
    throw usageError(
      'Warming the cache is the one thing --offline cannot do.',
      'Run `osg cache warm` once with a network, or `osg cache seed --from ./public` from a checkout.'
    );
  }

  const wantsFonts = flagBool(ctx.args.flags, 'fonts', false);
  // --no-assets --fonts is the "only warm the faces" case, which is what you
  // want after adding a language to a project whose artwork is already here.
  const wantsAssets = flagBool(ctx.args.flags, 'assets', true);
  const assetsBaseUrl =
    flagString(ctx.args.flags, 'assets-base-url') ?? ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl;

  let fetched = 0;
  let alreadyHad = 0;
  let bytes = 0;
  const failures: { path: string; error: string }[] = [];
  let tierLabel = 'none';

  if (wantsAssets) {
    const selection = selectPaths(manifest, flagString(ctx.args.flags, 'tier'));
    tierLabel = selection.label;
    const missing = selection.paths.filter((p) => {
      const entry = manifest.entries[p];
      if (!entry) return false;
      if (isCached(entry.sha256)) {
        alreadyHad++;
        return false;
      }
      return true;
    });

    step(`artwork: ${selection.paths.length} files in ${selection.label}, ${missing.length} to fetch`);
    let done = 0;
    await pool(missing, FETCH_CONCURRENCY, async (requestPath) => {
      try {
        const body = await hydrate(requestPath, { manifest, assetsBaseUrl, offline: false });
        if (body) {
          fetched++;
          bytes += body.length;
        }
      } catch (error) {
        failures.push({ path: requestPath, error: (error as Error).message });
      }
      done++;
      // Every 25 rather than every file: a count is for watching progress, not
      // for reading every line of it.
      if (done % 25 === 0 || done === missing.length) info(dim(`  fetched ${done} of ${missing.length}`));
    });
  }

  let faces = 0;
  if (wantsFonts) {
    faces = await warmFonts(ctx);
  }

  if (ctx.json) {
    emit({
      ok: failures.length === 0,
      tier: tierLabel,
      fetched,
      alreadyCached: alreadyHad,
      bytes,
      fonts: faces,
      failed: failures,
    });
  } else {
    if (wantsAssets) {
      ok(`artwork: ${fetched} fetched, ${alreadyHad} already here, ${humanBytes(bytes)} downloaded`);
    }
    if (wantsFonts) ok(`fonts: ${faces} faces cached`);
    for (const failure of failures.slice(0, 5)) warn(`${failure.path}: ${failure.error}`);
    if (failures.length > 5) warn(`and ${failures.length - 5} more`);
  }

  // A partial warm is still a broken offline run later, so it is a failure now
  // rather than a surprise in the middle of a render.
  return failures.length ? EXIT.driver : EXIT.ok;
}

/**
 * Cache every font face the editor declares.
 *
 * The list comes from the page rather than from the CLI, so it is exactly what
 * this bundle asks Google for, including the per-subset slices of the CJK
 * families that a Japanese render needs and an English one never touches.
 */
async function warmFonts(ctx: CommandContext): Promise<number> {
  const session = await ctx.session();
  step('fonts: reading the face list from the editor');

  const urls = await session.evaluate<string[]>(`(async () => {
    const style = document.getElementById('google-font-faces');
    let css = style && style.textContent ? style.textContent : '';
    if (!css) {
      // fontService falls back to a <link> when it cannot inline the sheet.
      const link = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .find((node) => String(node.href).includes('fonts.googleapis.com'));
      if (link) css = await fetch(link.href).then((r) => r.text()).catch(() => '');
    }
    const found = new Set();
    const pattern = /url\\((['"]?)(https:\\/\\/fonts\\.gstatic\\.com\\/[^)'"]+)\\1\\)/g;
    let match;
    while ((match = pattern.exec(css))) found.add(match[2]);
    return Array.from(found);
  })()`);

  if (!urls.length) {
    warn('The editor declared no Google faces, so there was nothing to warm.');
    return 0;
  }

  let done = 0;
  for (let index = 0; index < urls.length; index += FONT_BATCH) {
    const batch = urls.slice(index, index + FONT_BATCH);
    // Fetched from the page so each request passes through the launch.ts
    // interceptor, which is the thing that writes the cache. A face that 404s
    // is not fatal: the sheet can outlive a file Google reorganised.
    const cached = await session.evaluate<number>(`(async () => {
      const urls = ${jsLiteral(batch)};
      let ok = 0;
      await Promise.all(urls.map(async (url) => {
        try {
          const response = await fetch(url);
          await response.arrayBuffer();
          if (response.ok) ok++;
        } catch (error) {
          // Counted as a miss below.
        }
      }));
      return ok;
    })()`);
    done += cached;
    info(dim(`  fonts ${Math.min(index + batch.length, urls.length)} of ${urls.length}`));
  }

  if (done < urls.length) debug(`${urls.length - done} faces did not come back and were skipped`);
  return done;
}

// --- prune ------------------------------------------------------------------

function prune(ctx: CommandContext, manifest: AssetManifest): number {
  const dryRun = flagBool(ctx.args.flags, 'dry-run', false);
  const alsoFonts = flagBool(ctx.args.flags, 'fonts', false);
  const keep = new Set(Object.values(manifest.entries).map((entry) => entry.sha256));

  if (keep.size === 0) {
    throw usageError(
      'This build has no asset manifest, so every cached file would look stale.',
      'Refusing to delete a cache the CLI cannot describe. Upgrade the CLI, or delete ' +
        `${assetCacheDir()} by hand if you really mean to.`
    );
  }

  const stale: { file: string; bytes: number }[] = [];
  for (const file of walk(assetCacheDir())) {
    const name = path.basename(file);
    // Digest-named, so the name is the whole test. A leftover .part is a killed
    // run's half file and is never valid.
    if (keep.has(name)) continue;
    stale.push({ file, bytes: sizeOf(file) });
  }

  let fontFiles = 0;
  let fontBytes = 0;
  if (alsoFonts) {
    for (const file of walk(fontCacheDir())) {
      fontFiles++;
      fontBytes += sizeOf(file);
    }
  }

  const bytes = stale.reduce((sum, entry) => sum + entry.bytes, 0);
  if (!dryRun) {
    for (const entry of stale) {
      try {
        fs.unlinkSync(entry.file);
      } catch (error) {
        debug(`could not delete ${entry.file}: ${(error as Error).message}`);
      }
    }
    if (alsoFonts) fs.rmSync(fontCacheDir(), { recursive: true, force: true });
  }

  if (ctx.json) {
    emit({
      ok: true,
      dryRun,
      removed: stale.length,
      bytes,
      fonts: alsoFonts ? { removed: fontFiles, bytes: fontBytes } : null,
      dir: assetCacheDir(),
    });
    return EXIT.ok;
  }

  const verb = dryRun ? 'would remove' : 'removed';
  ok(`artwork: ${verb} ${stale.length} stale files, ${humanBytes(bytes)}`);
  if (alsoFonts) ok(`fonts: ${verb} ${fontFiles} files, ${humanBytes(fontBytes)}`);
  else info(dim('  The font cache is keyed by URL, not by the manifest, so it is left alone. Add --fonts to clear it'));
  return EXIT.ok;
}

// --- seed -------------------------------------------------------------------

function seed(ctx: CommandContext, manifest: AssetManifest): number {
  const from = flagString(ctx.args.flags, 'from') ?? ctx.args.positionals[1];
  if (!from) {
    throw usageError('`osg cache seed` needs a directory to copy from.', 'osg cache seed --from ./public');
  }
  const dir = path.resolve(process.cwd(), from);
  if (!fs.existsSync(dir)) {
    throw usageError(`No such directory: ${dir}`, 'Point --from at the public/ directory of a checkout of this repo.');
  }

  step(`seeding from ${dir}`);
  const result = seedFromDirectory(manifest, dir);
  const stats = cacheStats(manifest);

  if (ctx.json) {
    emit({ ok: true, from: dir, seeded: result.seeded, missing: result.missing.length, cached: stats.cached, total: stats.total });
    return EXIT.ok;
  }

  ok(`${result.seeded} of ${stats.total} files are now cached, with no network`);
  if (result.missing.length) {
    // A miss here is nearly always the wrong directory or a checkout at a
    // different version, and naming one file is what makes that obvious.
    warn(`${result.missing.length} files were not in that directory, starting with ${result.missing[0]}`);
    info(dim('  Those get fetched on first use. `osg cache warm` fetches them now.'));
  }
  return EXIT.ok;
}

// --- helpers ----------------------------------------------------------------

function selectPaths(manifest: AssetManifest, tier: string | undefined): { label: string; paths: string[] } {
  const known = Object.keys(manifest.tiers);
  if (tier) {
    const paths = manifest.tiers[tier];
    if (!paths) {
      throw usageError(
        `No such tier: ${tier}`,
        known.length ? `This build has: ${known.join(', ')}` : 'This build has no tiers, so drop --tier.'
      );
    }
    return { label: tier, paths: paths.filter((p) => !!manifest.entries[p]) };
  }
  // The default is what a template render actually paints, which is a fraction
  // of the whole library. Everything else is fetched on the day it is used.
  const templates = manifest.tiers.templates;
  if (templates?.length) return { label: 'templates', paths: templates.filter((p) => !!manifest.entries[p]) };
  return { label: 'everything', paths: Object.keys(manifest.entries) };
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function dirStats(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const file of walk(dir)) {
    files++;
    bytes += sizeOf(file);
  }
  return { files, bytes };
}

/**
 * A value as a JavaScript literal inside an evaluated expression.
 *
 * session.evaluate takes an expression string, and puppeteer drops the extra
 * arguments when the page function is a string rather than a function, so
 * embedding the data is the only way it actually arrives. U+2028 and U+2029 are
 * valid in JSON and are line terminators in JavaScript, which is a syntax error
 * waiting for the first font URL that contains one.
 */
function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
