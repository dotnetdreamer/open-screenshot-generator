/**
 * `osg doctor`: the command a person, and more often an agent, runs first.
 *
 * Half of what can go wrong with this CLI is invisible until the very end of a
 * long render: a Chromium build with no proprietary codecs produces a perfect
 * PNG set and then cannot encode a single MP4 frame; a software rasteriser
 * renders every 3D device frame subtly differently from the app; a cold asset
 * cache with no network turns into a missing background four minutes in. So
 * doctor answers all of it up front, in one browser boot, with a one line fix
 * per row.
 *
 * Two groups of checks. The first group is out of page and cheap. The second
 * group needs the real page, because the only honest way to know whether this
 * browser can encode H.264 is to ask this browser.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CommandContext } from '../context.js';
import { flagBool, flagString } from '../args.js';
import { DEFAULTS } from '../config.js';
import { EXIT } from '../errors.js';
import { info, step, ok, warn, fail, debug, dim, bold, emit, humanBytes } from '../log.js';
import { findBrowser, browserHint } from '../browser/find.js';
import { resolveEditor, manifestPath } from '../editor/resolve.js';
import { loadManifest, cacheStats } from '../editor/assets.js';
import { browserCacheDir, fontCacheDir, ensureDir } from '../paths.js';

/**
 * Mirrors H264_CODEC_CANDIDATES in src/lib/video/videoExport.ts. The export
 * walks this exact list and takes the first profile the browser accepts, so
 * probing the same list is the difference between "MP4 works here" and a
 * guess from the browser's name.
 */
const H264_CODEC_CANDIDATES = [
  'avc1.640033',
  'avc1.64002A',
  'avc1.640028',
  'avc1.4D0028',
  'avc1.42E01F',
];

/** Below this a video run will run out of room part way through. */
const DISK_FAIL_BYTES = 500 * 1024 * 1024;
const DISK_WARN_BYTES = 2 * 1024 * 1024 * 1024;

const MIN_NODE = [20, 12, 0];

/**
 * The in page rows, in order. Kept in one place so a run that could not boot
 * reports the same check ids as one that did, and an agent keying on them does
 * not have to handle two vocabularies.
 */
const PAGE_ROW_IDS: [string, string][] = [
  ['secure-context', 'secure context'],
  ['webgl', 'webgl'],
  ['h264', 'h264 mp4'],
  ['compression', 'compression'],
  ['indexeddb', 'indexeddb'],
  ['web-fonts', 'web fonts'],
];

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  id: string;
  label: string;
  status: Status;
  detail: string;
  fix?: string;
}

interface PageProbe {
  secureContext: boolean;
  compressionStream: boolean;
  videoEncoder: boolean;
  webgl: string | null;
  webglSoftware: boolean;
  indexedDb: string;
  fontStatus: string;
  fontCount: number;
  h264: string | null;
  notes: string[];
}

/**
 * Evaluated as one expression in the page (Session.evaluate takes a source
 * string), so it is written as an async IIFE returning a plain object. Nothing
 * in here mutates the editor: the probe opens its own IndexedDB database and
 * deletes it again, and drops the WebGL context it made.
 */
const PAGE_PROBE = `(async () => {
  const out = {
    secureContext: !!window.isSecureContext,
    compressionStream: typeof CompressionStream === 'function',
    videoEncoder: typeof VideoEncoder !== 'undefined',
    webgl: null,
    webglSoftware: false,
    indexedDb: 'unknown',
    fontStatus: 'unavailable',
    fontCount: 0,
    h264: null,
    notes: []
  };

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      out.notes.push('no webgl context');
    } else {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      out.webgl = String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      out.webglSoftware = /swiftshader|llvmpipe|software|basic render/i.test(out.webgl);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (error) {
    out.notes.push('webgl: ' + error.message);
  }

  out.indexedDb = await Promise.race([
    new Promise((resolve) => {
      try {
        const request = indexedDB.open('__osg_doctor', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('probe');
        request.onerror = () => resolve('blocked: ' + (request.error ? request.error.name : 'unknown'));
        request.onsuccess = () => {
          const db = request.result;
          try {
            const tx = db.transaction('probe', 'readwrite');
            tx.objectStore('probe').put(1, 'k');
            tx.oncomplete = () => { db.close(); indexedDB.deleteDatabase('__osg_doctor'); resolve('ok'); };
            tx.onerror = () => { db.close(); resolve('read only'); };
          } catch (error) { db.close(); resolve('error: ' + error.message); }
        };
      } catch (error) {
        resolve('error: ' + error.message);
      }
    }),
    new Promise((resolve) => setTimeout(() => resolve('timed out'), 8000))
  ]);

  try {
    if (document.fonts) {
      await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 15000))]);
      out.fontStatus = document.fonts.status;
      out.fontCount = document.fonts.size;
    }
  } catch (error) {
    out.notes.push('fonts: ' + error.message);
  }

  if (typeof VideoEncoder !== 'undefined') {
    for (const codec of ${JSON.stringify(H264_CODEC_CANDIDATES)}) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: codec,
          width: 886,
          height: 1920,
          bitrate: 12000000,
          framerate: 30,
          latencyMode: 'quality',
          avc: { format: 'avc' }
        });
        if (support && support.supported) { out.h264 = codec; break; }
      } catch (error) {
        // An unsupported profile is allowed to throw rather than answer false.
      }
    }
  }

  return out;
})()`;

export async function run(ctx: CommandContext): Promise<number> {
  const wantsInstall = flagBool(ctx.args.flags, 'install-browser', false);
  const assetsBaseUrl =
    flagString(ctx.args.flags, 'assets-base-url') ?? ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl;

  const checks: Check[] = [];
  const add = (check: Check): void => {
    checks.push(check);
  };

  if (wantsInstall) {
    await installBrowser(checks);
  }

  step(`osg ${cliVersion()} doctor`);

  // ---------------------------------------------------------------- out of page

  const node = process.versions.node;
  const nodeOk = compareVersion(node, MIN_NODE) >= 0;
  add({
    id: 'node',
    label: 'node',
    status: nodeOk ? 'ok' : 'fail',
    detail: `v${node} on ${process.platform} ${process.arch}, ${os.release()}`,
    fix: nodeOk ? undefined : 'Install Node 20.12 or newer. Older releases lack the fetch and statfs APIs this CLI uses.',
  });

  const browser = findBrowser({ explicit: flagString(ctx.args.flags, 'browser') ?? ctx.config.browser });
  if (!browser) {
    add({
      id: 'browser',
      label: 'browser',
      status: 'fail',
      detail: 'no Chrome, Edge or Chromium found',
      fix: browserHint(),
    });
  } else {
    add({
      id: 'browser',
      label: 'browser',
      status: browser.likelyHasH264 ? 'ok' : 'warn',
      detail: `${browser.flavor}${browser.likelyHasH264 ? ' (branded)' : ' (open build)'} ${browser.executablePath}`,
      fix: browser.likelyHasH264
        ? undefined
        : 'Open builds ship no proprietary codecs, so osg video cannot encode MP4. Install Chrome or Edge and pass --browser <path>.',
    });
  }

  const editor = resolveEditor({
    editorUrl: flagString(ctx.args.flags, 'editor-url') ?? ctx.config.editorUrl,
    cwd: ctx.root,
    assetsBaseUrl,
  });
  add({
    id: 'editor',
    label: 'editor',
    status: editor.kind === 'local' ? 'ok' : 'warn',
    detail: editor.label,
    fix:
      editor.kind === 'local'
        ? undefined
        : 'A remote editor needs a network for every run and can be a different version than this CLI. Point OSG_EDITOR_DIR at a build, or reinstall the package so it carries its own.',
  });

  const manifestFile = manifestPath();
  const manifest = loadManifest(manifestFile);
  const manifestCount = Object.keys(manifest.entries).length;
  add({
    id: 'manifest',
    label: 'asset manifest',
    status: manifestCount > 0 ? 'ok' : 'warn',
    detail: manifestCount > 0 ? `${manifestCount} entries, version ${manifest.version}` : `missing at ${manifestFile}`,
    fix:
      manifestCount > 0
        ? undefined
        : 'Artwork hydration is off, so templates that paint a bundled image will render with holes. Reinstall the package.',
  });

  const stats = cacheStats(manifest);
  const cold = stats.total > 0 && stats.cached === 0;
  add({
    id: 'assets',
    label: 'asset cache',
    status: manifestCount === 0 ? 'ok' : cold && ctx.offline ? 'fail' : 'ok',
    detail:
      manifestCount === 0
        ? 'nothing to cache'
        : `${stats.cached} of ${stats.total} files, ${humanBytes(stats.cachedBytes)} of ${humanBytes(stats.totalBytes)}`,
    fix: cold && ctx.offline ? 'The cache is empty and --offline forbids fetching. Run `osg cache warm` once with a network.' : undefined,
  });

  const fonts = directorySize(fontCacheDir());
  add({
    id: 'fonts',
    label: 'font cache',
    status: fonts.files === 0 && ctx.offline ? 'warn' : 'ok',
    detail:
      fonts.files === 0
        ? 'empty, faces are fetched on the first run'
        : `${fonts.files} files, ${humanBytes(fonts.bytes)}`,
    fix:
      fonts.files === 0 && ctx.offline
        ? 'With --offline and no cached faces, text falls back to a system font and a non-Latin locale loses its glyphs. Run `osg cache warm` once online.'
        : undefined,
  });

  const network = await checkNetwork(assetsBaseUrl, ctx.offline, cold);
  add(network);

  add(checkOutDir(ctx.outDir));

  const ffmpeg = probeFfmpeg();
  add({
    id: 'ffmpeg',
    label: 'ffmpeg',
    status: ffmpeg ? 'ok' : 'warn',
    detail: ffmpeg ?? 'not on PATH (optional)',
    fix: ffmpeg
      ? undefined
      : 'Only used to advise on a remux when a store rejects a preview container. Every osg video run encodes MP4 in the browser without it.',
  });

  // -------------------------------------------------------------------- in page

  let probe: PageProbe | null = null;
  if (!browser) {
    // No point booting: the page checks would all fail for the same reason,
    // and the fix is already printed against the browser row.
    for (const row of pageRowsUnprobed('no browser to boot')) add(row);
  } else {
    step('booting one session for the in page checks');
    try {
      const session = await ctx.session();
      probe = await session.evaluate<PageProbe>(PAGE_PROBE);
      for (const note of probe.notes) debug(`probe note: ${note}`);
      for (const row of pageRows(probe, browser.flavor)) add(row);
    } catch (error) {
      for (const row of pageRowsUnprobed((error as Error).message)) add(row);
    }
  }

  // -------------------------------------------------------------------- report

  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;

  const width = Math.max(...checks.map((c) => c.label.length));
  info('');
  for (const check of checks) {
    const line = `${check.label.padEnd(width)}  ${check.detail}`;
    // ok() prefixes 2 characters where warn() and fail() prefix 4, so an ok
    // row carries two extra spaces and the whole table lines up.
    if (check.status === 'ok') ok(`  ${line}`);
    else if (check.status === 'warn') warn(line);
    else fail(line);
    if (check.status !== 'ok' && check.fix) info(dim(`     ${check.fix}`));
  }
  info('');
  const summary = `${checks.length - failed - warned} ok, ${warned} warn, ${failed} failed`;
  info(failed ? `${bold(summary)}` : summary);

  if (ctx.json) {
    emit({
      ok: failed === 0,
      version: cliVersion(),
      node,
      platform: `${process.platform} ${process.arch}`,
      browser: browser
        ? { path: browser.executablePath, flavor: browser.flavor, likelyHasH264: browser.likelyHasH264 }
        : null,
      editor: editor.kind === 'local' ? { kind: 'local', dir: editor.dir } : { kind: 'remote', origin: editor.origin },
      assets: { manifest: manifestFile, entries: manifestCount, ...stats },
      video: { h264: probe?.h264 ?? null, mp4: !!probe?.h264 },
      webgl: probe ? { renderer: probe.webgl, software: probe.webglSoftware } : null,
      checks,
    });
  }

  return failed ? EXIT.usage : EXIT.ok;
}

// ---------------------------------------------------------------------------

function pageRows(probe: PageProbe, flavor: string): Check[] {
  const rows: Check[] = [];
  // Labels come from the shared table, so a probed run and an unprobed one
  // cannot end up naming the same check two different things.
  const push = (id: string, check: Omit<Check, 'id' | 'label'>) =>
    rows.push({ id, label: PAGE_ROW_IDS.find(([known]) => known === id)?.[1] ?? id, ...check });

  push('page', {
    status: 'ok',
    detail: 'editor loaded and the bridge answered',
  });

  push('secure-context', {
    status: probe.secureContext ? 'ok' : 'fail',
    detail: probe.secureContext ? 'true' : 'false',
    fix: probe.secureContext
      ? undefined
      : 'Without a secure context the browser hides crypto.subtle, VideoEncoder and IndexedDB. Drop --editor-url, or serve that deployment over https.',
  });

  push('webgl', {
    status: probe.webgl ? (probe.webglSoftware ? 'warn' : 'ok') : 'fail',
    detail: probe.webgl ?? 'no context',
    fix: probe.webgl
      ? probe.webglSoftware
        ? 'This is a software rasteriser, so 3D device frames render differently than they do in the app. Fine for a draft, check the real thing before you ship.'
        : undefined
      : 'Templates with 3D device mockups will render empty. Update the graphics driver, or run with --headed to see what the browser reports.',
  });

  const mp4 = !!probe.h264;
  push('h264', {
    status: mp4 ? 'ok' : 'warn',
    detail: mp4
      ? `${probe.h264} accepted`
      : probe.videoEncoder
        ? `no H.264 profile accepted on this ${flavor} build`
        : 'no WebCodecs VideoEncoder',
    fix: mp4
      ? undefined
      : 'This build ships no proprietary codecs, so osg video cannot produce an MP4. PNG export, the 49 tools and the AI agent all still work. Install Chrome or Edge and pass --browser <path>.',
  });

  push('compression', {
    status: probe.compressionStream ? 'ok' : 'fail',
    detail: probe.compressionStream ? 'CompressionStream present' : 'CompressionStream missing',
    fix: probe.compressionStream ? undefined : 'Project save and the CSV round trip both need it. Use a newer browser build.',
  });

  push('indexeddb', {
    status: probe.indexedDb === 'ok' ? 'ok' : 'fail',
    detail: probe.indexedDb,
    fix:
      probe.indexedDb === 'ok'
        ? undefined
        : 'Projects, media and fonts all live in IndexedDB, so nothing can be opened without it. A locked down profile or a full disk is the usual cause.',
  });

  push('web-fonts', {
    status: probe.fontStatus === 'loaded' ? 'ok' : 'warn',
    detail: `${probe.fontStatus}, ${probe.fontCount} faces`,
    fix:
      probe.fontStatus === 'loaded'
        ? undefined
        : 'Headlines may render in a fallback face and measure differently. Run `osg cache warm` so the faces are on disk before the render.',
  });

  return rows;
}

function pageRowsUnprobed(reason: string): Check[] {
  return [
    {
      id: 'page',
      label: 'page boot',
      status: 'fail',
      detail: reason,
      fix: 'Every in page check below was skipped. Fix the rows above, then run `osg doctor` again.',
    },
    ...PAGE_ROW_IDS.map(
      ([id, label]): Check => ({
        id,
        label,
        status: 'fail',
        detail: 'not probed',
      })
    ),
  ];
}

async function checkNetwork(assetsBaseUrl: string, offline: boolean, coldCache: boolean): Promise<Check> {
  if (offline) {
    return {
      id: 'network',
      label: 'assets host',
      status: 'ok',
      detail: '--offline, nothing is fetched',
    };
  }
  try {
    const response = await fetch(assetsBaseUrl, { signal: AbortSignal.timeout(8000) });
    return {
      id: 'network',
      label: 'assets host',
      status: response.ok ? 'ok' : 'warn',
      detail: `${assetsBaseUrl} HTTP ${response.status}`,
      fix: response.ok ? undefined : 'The host answered but not with a page. It may be mid deploy, or --assets-base-url points somewhere else.',
    };
  } catch (error) {
    return {
      id: 'network',
      label: 'assets host',
      // Unreachable only matters when something still has to be downloaded.
      status: coldCache ? 'fail' : 'warn',
      detail: `${assetsBaseUrl} unreachable: ${(error as Error).message}`,
      fix: coldCache
        ? 'The asset cache is empty, so a render would have nothing to paint. Connect once, or seed from a checkout with `osg cache warm --from ./public`.'
        : 'The cache is warm enough to render offline. Pass --offline to stop the CLI reaching for the network at all.',
    };
  }
}

function checkOutDir(outDir: string): Check {
  let writable = false;
  let reason = '';
  // Probe the nearest directory that already exists rather than creating the
  // output tree. `osg doctor` answers a question, so it must not leave an empty
  // osg/out/ behind in whatever directory it was run from, and people run it
  // from directories that are not projects.
  let probeDir = outDir;
  while (!fs.existsSync(probeDir)) {
    const parent = path.dirname(probeDir);
    if (parent === probeDir) break;
    probeDir = parent;
  }
  try {
    const probe = path.join(probeDir, `.osg-doctor-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    writable = true;
  } catch (error) {
    reason = (error as Error).message;
  }

  if (!writable) {
    return {
      id: 'out',
      label: 'output dir',
      status: 'fail',
      detail: `${outDir} not writable: ${reason}`,
      fix: 'Pass --out <dir> somewhere writable, or fix the permissions on that path.',
    };
  }

  const free = freeBytes(probeDir);
  if (free === null) {
    return { id: 'out', label: 'output dir', status: 'ok', detail: `${outDir} writable` };
  }
  const status: Status = free < DISK_FAIL_BYTES ? 'fail' : free < DISK_WARN_BYTES ? 'warn' : 'ok';
  return {
    id: 'out',
    label: 'output dir',
    status,
    detail: `${outDir} writable, ${humanBytes(free)} free`,
    fix:
      status === 'ok'
        ? undefined
        : 'A localised PNG set plus preview videos runs to gigabytes. Free some space, or send --out to another volume.',
  };
}

/** Free bytes on the volume holding a path that may not exist yet. */
function freeBytes(dir: string): number | null {
  let probe = path.resolve(dir);
  for (let depth = 0; depth < 12; depth++) {
    if (fs.existsSync(probe)) break;
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  try {
    const stat = fs.statfsSync(probe);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch (error) {
    debug(`statfs failed for ${probe}: ${(error as Error).message}`);
    return null;
  }
}

function directorySize(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (current: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      try {
        bytes += fs.statSync(full).size;
        files++;
      } catch {
        // Vanished between readdir and stat, which a parallel run can do.
      }
    }
  };
  walk(dir, 0);
  return { files, bytes };
}

function probeFfmpeg(): string | null {
  try {
    const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (result.error || result.status !== 0) return null;
    const first = (result.stdout ?? '').split('\n')[0]?.trim();
    return first || 'present';
  } catch {
    return null;
  }
}

/**
 * `--install-browser`. Deliberately a last resort rather than the happy path:
 * the only build @puppeteer/browsers can fetch is Chrome for Testing, which is
 * an open build with no H.264, so a machine that installs one gets working PNG
 * exports and a video command that cannot encode. Say that out loud, and do
 * not download at all when a branded Chrome or Edge is already installed.
 */
async function installBrowser(checks: Check[]): Promise<void> {
  const existing = findBrowser();
  if (existing?.likelyHasH264) {
    info(`${existing.flavor} is already installed at ${existing.executablePath}`);
    info('Nothing downloaded: a branded build is the better browser for this CLI, because it can encode MP4');
    return;
  }

  const cacheDir = ensureDir(browserCacheDir());
  step(`downloading Chrome for Testing into ${cacheDir}`);
  try {
    const { install, resolveBuildId, detectBrowserPlatform, Browser } = await import('@puppeteer/browsers');
    const platform = detectBrowserPlatform();
    if (!platform) {
      checks.push({
        id: 'install-browser',
        label: 'install browser',
        status: 'fail',
        detail: `no download is published for ${process.platform} ${process.arch}`,
        fix: 'Install Chrome or Edge from your package manager and pass --browser <path>.',
      });
      return;
    }

    const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
    let lastReported = -1;
    const installed = await install({
      browser: Browser.CHROME,
      platform,
      buildId,
      cacheDir,
      // The library's own progress bar writes to stdout, which would corrupt
      // --json. Report to stderr in tenths instead.
      downloadProgressCallback: (downloaded: number, total: number) => {
        if (!total) return;
        const tenth = Math.floor((downloaded / total) * 10);
        if (tenth === lastReported) return;
        lastReported = tenth;
        info(dim(`  ${tenth * 10}%`));
      },
    });

    checks.push({
      id: 'install-browser',
      label: 'install browser',
      status: 'warn',
      detail: `Chrome for Testing ${buildId} at ${installed.executablePath}`,
      fix: 'This build carries no H.264, so osg video cannot produce an MP4 on it. Install a branded Chrome or Edge when you need preview videos.',
    });
    warn('Chrome for Testing has no proprietary codecs, so `osg video` will not encode MP4 on it');
    info('Everything else works: PNG export, the 49 design tools, the AI agent and localisation');
  } catch (error) {
    checks.push({
      id: 'install-browser',
      label: 'install browser',
      status: 'fail',
      detail: (error as Error).message,
      fix: browserHint(),
    });
  }
}

function compareVersion(actual: string, minimum: number[]): number {
  const parts = actual.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < minimum.length; i++) {
    const diff = (parts[i] ?? 0) - minimum[i];
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Walks up from the built file, because dist/ depth differs bundled and not. */
function cliVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth++) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (parsed.name === 'open-screenshot-generator' && parsed.version) return parsed.version;
    } catch {
      // Keep walking: not every level has a package.json.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'unknown';
}
