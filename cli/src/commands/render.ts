/**
 * `osg render`: the store PNG run.
 *
 * Every pixel comes from the editor's own export path. This command opens the
 * committed project file, tells the bridge which formats and languages to
 * produce, and then does the one thing the browser cannot do for itself:
 * confirm that the files actually landed on disk.
 *
 * That confirmation is the reason this file is longer than "call exportImages".
 * handleConfirmExport returns the exact filename manifest it wrote, and a web
 * build saves through an anchor download, so the bytes arrive *after* the
 * promise resolves and arrive under a name the browser chooses. Counting files
 * in the directory would pass on somebody else's leftovers; waiting for the
 * named files, freshly written, is the only check that means anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { flagList, flagString, flagNumber } from '../args.js';
import { DEFAULTS } from '../config.js';
import type { CommandContext } from '../context.js';
import type { SavedFile, Session, SessionStatus } from '../driver/session.js';
import { EXIT, driverError, usageError } from '../errors.js';
import { bold, debug, dim, emit, humanBytes, humanMs, info, ok, step, warn } from '../log.js';

/**
 * The format ids `exportImages` understands (DeviceFormat in
 * src/lib/deviceRegistry.ts). They name a *conversion*, not a canvas size.
 */
type DeviceFormatId = 'ios' | 'android' | 'ipad-pro-13' | 'ipad-11' | 'tablet-7' | 'tablet-10';

/**
 * Config and flags speak the size-preset ids people see in the editor
 * (src/lib/sizePresets.ts, e.g. 'ios-6-9'); the bridge speaks DeviceFormat.
 * Only the presets whose canvas is byte-identical to a DeviceFormat preset are
 * here, because anything else would silently render at a size nobody asked for.
 */
const FORMAT_ALIASES: Record<string, DeviceFormatId> = {
  ios: 'ios',
  android: 'android',
  'ipad-pro-13': 'ipad-pro-13',
  'ipad-11': 'ipad-11',
  'tablet-7': 'tablet-7',
  'tablet-10': 'tablet-10',
  // sizePresets.ts ids, matched on canvas size against DEVICE_FORMAT_PRESETS.
  'ios-6-9': 'ios', // 1290x2796
  iphone: 'ios',
  'ipad-13': 'ipad-pro-13', // 2064x2752
  ipad: 'ipad-pro-13',
  'play-phone': 'android', // 1080x1920
  play: 'android',
  'play-10-hd': 'tablet-10', // 1440x2560
};

/** Ways of saying "export the boards at the size they already are". */
const CANVAS_IDS = new Set(['as-is', 'asis', 'canvas', 'current', 'none']);

const POLL_MS = 200;
/** How long a file has to sit unchanged before it counts as finished. */
const QUIET_MS = 400;
const DEFAULT_FILE_WAIT_MS = 120_000;
/** Inlining a project into a CDP expression is fine for a document, not for blobs. */
const MAX_INLINE_PROJECT_BYTES = 8 * 1024 * 1024;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// --- the committed project file ---------------------------------------------

/** One board, read straight off the file. Only the fields any command needs. */
export interface ProjectBoard {
  id: string;
  name: string;
  size?: { width: number; height: number };
  elements?: unknown[];
  localization?: { baseLocale?: string; locales?: { code: string; label?: string }[] };
}

export interface ProjectMediaMeta {
  id: string;
  name?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
}

export interface ProjectFontMeta {
  id: string;
  family: string;
  fileName?: string;
  format?: string;
  mimeType?: string;
  size?: number;
}

export interface ProjectFileContents {
  file: string;
  bytes: number;
  id: string;
  name: string;
  timestamp: string | null;
  boards: ProjectBoard[];
  media: ProjectMediaMeta[];
  fonts: ProjectFontMeta[];
  /** True when the file carries blob payloads, not just their metadata. */
  carriesBlobs: boolean;
}

/**
 * Read and validate the project file.
 *
 * The shape is the single-file bundle src/lib/account/projectBundle.ts writes:
 * a ProjectManifest plus `mediaData` / `fontData` maps of base64 payloads. The
 * older pre-bundle export (`{ id, timestamp, projectData }` and nothing else)
 * parses too, exactly as bundleFromJson accepts it, so files people already
 * have on disk keep working.
 */
export function readProjectFile(file: string): ProjectFileContents {
  if (!fs.existsSync(file)) {
    throw usageError(
      `No project file at ${file}`,
      'Run `osg new` to create one, or point --project at an existing project.json.'
    );
  }
  const raw = fs.readFileSync(file, 'utf8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw usageError(
      `${file} is not valid JSON: ${(error as Error).message}`,
      'It should be a project exported by the app or written by `osg new`.'
    );
  }
  const boards = parsed.projectData;
  if (!Array.isArray(boards)) {
    throw usageError(
      `${file} has no artboard data.`,
      'A project file carries a "projectData" array. Re-export it, or run `osg new`.'
    );
  }

  const media = Array.isArray(parsed.media) ? (parsed.media as ProjectMediaMeta[]) : [];
  const fonts = Array.isArray(parsed.fonts) ? (parsed.fonts as ProjectFontMeta[]) : [];
  return {
    file,
    bytes: Buffer.byteLength(raw),
    id: typeof parsed.id === 'string' ? parsed.id : `project_${Date.now()}`,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Untitled project',
    timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
    boards: boards as ProjectBoard[],
    media,
    fonts,
    carriesBlobs: !!parsed.mediaData || !!parsed.fontData,
  };
}

/** The project's export languages, base first, read off the file. */
export function localesOf(boards: ProjectBoard[]): { base: string | null; codes: string[] } {
  const localization = boards.find((board) => board.localization)?.localization;
  if (!localization) return { base: null, codes: [] };
  const base = localization.baseLocale ?? null;
  const rest = (localization.locales ?? []).map((entry) => entry.code).filter((code) => code && code !== base);
  return { base, codes: base ? [base, ...rest] : rest };
}

/**
 * The page-side half of opening a project.
 *
 * `window.__osg.loadProject` takes the document and nothing else, but a project
 * file also carries the blobs its elements only *reference*: screen recordings
 * and, since the issue #19 memory work, uploaded screenshots as `asset:<id>`.
 * Those live in the Dexie `media` table, so they are written there before the
 * document is opened, or the render comes out with empty device frames and no
 * error anywhere. Imported fonts get the same treatment plus a real
 * CSSFontFaceRule, because html-to-image can only carry faces it finds in
 * document.styleSheets (see src/services/customFonts.ts) and a face added
 * through the JS API alone would export as a system serif.
 */
function openScript(sourceExpression: string): string {
  return `(async () => {
  const file = ${sourceExpression};
  if (!file || !Array.isArray(file.projectData)) throw new Error('The project file has no artboard data.');
  const toBlob = function (b64, type) {
    const bin = atob(b64);
    const parts = [];
    for (let offset = 0; offset < bin.length; offset += 65536) {
      const slice = bin.slice(offset, offset + 65536);
      const bytes = new Uint8Array(slice.length);
      for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i);
      parts.push(bytes);
    }
    return new Blob(parts, { type: type || 'application/octet-stream' });
  };
  const putRows = function (store, rows) {
    return new Promise(function (resolve, reject) {
      if (!rows.length) { resolve(0); return; }
      const request = indexedDB.open('ProjectDatabase');
      request.onerror = function () { reject(request.error); };
      request.onsuccess = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(store)) { db.close(); resolve(0); return; }
        const tx = db.transaction(store, 'readwrite');
        const table = tx.objectStore(store);
        for (const row of rows) table.put(row);
        tx.oncomplete = function () { db.close(); resolve(rows.length); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      };
    });
  };
  const mediaData = file.mediaData || {};
  const mediaRows = (file.media || [])
    .filter(function (meta) { return !!mediaData[meta.id]; })
    .map(function (meta) {
      return {
        id: meta.id,
        blob: toBlob(mediaData[meta.id], meta.mimeType),
        name: meta.name || meta.id,
        mimeType: meta.mimeType || 'application/octet-stream',
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        createdAt: meta.createdAt ? new Date(meta.createdAt) : new Date(),
      };
    });
  const restoredMedia = await putRows('media', mediaRows);
  const fontData = file.fontData || {};
  const fontRows = (file.fonts || [])
    .filter(function (meta) { return !!fontData[meta.id]; })
    .map(function (meta) {
      return {
        id: meta.id,
        family: meta.family,
        fileName: meta.fileName || meta.family,
        format: meta.format || 'woff2',
        mimeType: meta.mimeType || 'font/woff2',
        size: meta.size || 0,
        createdAt: meta.createdAt ? new Date(meta.createdAt) : new Date(),
        blob: toBlob(fontData[meta.id], meta.mimeType),
      };
    });
  const restoredFonts = await putRows('fonts', fontRows);
  if (fontRows.length) {
    const rules = fontRows.map(function (row) {
      return '@font-face{font-family:"' + row.family + '";src:url(data:' + row.mimeType +
        ';base64,' + fontData[row.id] + ") format('" + row.format + "');font-display:swap;}";
    });
    let style = document.getElementById('osg-restored-font-faces');
    if (!style) {
      style = document.createElement('style');
      style.id = 'osg-restored-font-faces';
      document.head.appendChild(style);
    }
    style.textContent = rules.join('');
    await Promise.all(fontRows.map(function (row) {
      return document.fonts.load('16px "' + row.family + '"').catch(function () {});
    }));
  }
  const opened = await window.__osg.loadProject(file.projectData, file.name || 'Untitled project', file.id);
  return {
    opened: !!opened,
    mediaPayloads: mediaRows.length,
    restoredMedia: restoredMedia,
    restoredFonts: restoredFonts,
  };
})()`;
}

/**
 * Load the committed project into the session and wait until the canvas has it.
 * Shared with `osg video`, which needs exactly the same starting state.
 */
export async function openProject(ctx: CommandContext, session: Session): Promise<SessionStatus> {
  const project = readProjectFile(ctx.projectFile);
  const boardWord = project.boards.length === 1 ? 'board' : 'boards';
  step(`project: ${project.name}, ${project.boards.length} ${boardWord}, ${humanBytes(project.bytes)}`);

  // A project with recordings or uploaded screenshots is tens of megabytes of
  // base64. Serving it and letting the page fetch keeps that out of the CDP
  // expression, which is the same reason `upload_recording` prefers a URL.
  let source: string;
  if (session.server) {
    source = `await (await fetch(${JSON.stringify(session.serveFile(project.file, 'project.json'))})).json()`;
  } else if (project.carriesBlobs || project.bytes > MAX_INLINE_PROJECT_BYTES) {
    throw driverError(
      'This project carries its media inline and cannot be handed to a remote editor.',
      'Drop --editor-url so the CLI serves the editor, and the project file with it.'
    );
  } else {
    source = fs.readFileSync(project.file, 'utf8');
  }

  const result = await session.evaluate<{
    opened: boolean;
    mediaPayloads: number;
    restoredMedia: number;
    restoredFonts: number;
  }>(openScript(source));
  if (!result.opened) {
    throw driverError(
      `The editor refused to open ${project.file}.`,
      'Open the same file in the app to see what it objects to, or re-export it.'
    );
  }
  debug(`restored ${result.restoredMedia} media and ${result.restoredFonts} fonts into the page`);
  if (project.media.length > result.mediaPayloads) {
    // Metadata with no payload beside it is what a bundle looks like after it
    // was hand-edited, or after a Drive-shaped export was flattened into one
    // file by hand. The elements pointing at those ids will render empty.
    warn(
      `${project.media.length - result.mediaPayloads} referenced media items carry no data in the project file, ` +
        'their frames will render empty'
    );
  }

  // loadProject resolves when the state is set, not when React has mounted the
  // boards, and a capture against an unmounted board is a blank PNG.
  const deadline = Date.now() + 30_000;
  let status = await session.status();
  while (status.artboards.length === 0 && Date.now() < deadline) {
    await delay(250);
    status = await session.status();
  }
  return status;
}

// --- waiting for the bytes ---------------------------------------------------

export interface WrittenFile {
  filename: string;
  path: string;
  bytes: number;
}

/**
 * Wait for exactly these filenames to appear, freshly written.
 *
 * `since` is what makes this a check rather than a formality: a same-named file
 * left over from an earlier run already satisfies "exists", and the browser
 * would have saved the new one as "name (1).png" beside it. Requiring a recent
 * mtime catches that case, and reportDuplicates() below turns it into a fix.
 */
export async function waitForFiles(
  dir: string,
  filenames: string[],
  options: { timeoutMs: number; since: number }
): Promise<{ written: WrittenFile[]; missing: string[]; unexpected: string[] }> {
  const pending = new Set(filenames);
  const written: WrittenFile[] = [];
  const lastSize = new Map<string, number>();
  const deadline = Date.now() + options.timeoutMs;
  // A browser download is renamed into place from a .crdownload, so the file
  // usually appears whole. A desktop-style write lands in pieces, so a file
  // also has to have stopped changing, by size and by mtime, before it counts.
  const settleFloor = options.since - 2000;

  while (pending.size > 0 && Date.now() < deadline) {
    for (const filename of [...pending]) {
      const file = path.join(dir, filename);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size === 0) continue;
      if (stat.mtimeMs < settleFloor) continue;
      if (fs.existsSync(`${file}.crdownload`)) continue;
      if (lastSize.get(filename) !== stat.size) {
        lastSize.set(filename, stat.size);
        continue;
      }
      if (Date.now() - stat.mtimeMs < QUIET_MS) continue;
      pending.delete(filename);
      written.push({ filename, path: file, bytes: stat.size });
    }
    if (pending.size === 0) break;
    await delay(POLL_MS);
  }

  return {
    written,
    missing: [...pending],
    unexpected: pending.size ? arrivedUnasked(dir, filenames, settleFloor) : [],
  };
}

/**
 * Files that landed during the run under a name nobody asked for. There are two
 * ways that happens and both are worth naming rather than guessing at: the
 * directory already held the name, so the browser saved "name (1).png" beside
 * it, or the name contained something the browser strips from a download.
 */
function arrivedUnasked(dir: string, expected: string[], since: number): string[] {
  const wanted = new Set(expected);
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !wanted.has(entry.name))
      .filter((entry) => {
        try {
          return fs.statSync(path.join(dir, entry.name)).mtimeMs >= since;
        } catch {
          return false;
        }
      })
      .map((entry) => entry.name)
      .slice(0, 6);
  } catch {
    return [];
  }
}

export function printFileTable(files: WrittenFile[]): void {
  if (files.length === 0) return;
  const width = Math.min(64, Math.max(...files.map((file) => file.filename.length)));
  for (const file of files) {
    info(`  ${file.filename.padEnd(width)}  ${dim(humanBytes(file.bytes))}`);
  }
}

// --- selection ---------------------------------------------------------------

function resolveFormats(ctx: CommandContext): {
  asIs: boolean;
  generateFormats: DeviceFormatId[];
  requested: string[];
} {
  const requested = flagList(ctx.args.flags, 'formats') ?? ctx.config.formats ?? DEFAULTS.formats;
  if (requested.length === 0 || requested.some((id) => CANVAS_IDS.has(id.trim().toLowerCase()))) {
    return { asIs: true, generateFormats: [], requested };
  }

  const generateFormats: DeviceFormatId[] = [];
  for (const id of requested) {
    const mapped = FORMAT_ALIASES[id.trim().toLowerCase()];
    if (!mapped) {
      throw usageError(
        `Unknown format "${id}".`,
        `Convertible formats: ${Object.keys(FORMAT_ALIASES).sort().join(', ')}. ` +
          'Use --formats as-is to export the boards at the size they already are.'
      );
    }
    if (!generateFormats.includes(mapped)) generateFormats.push(mapped);
  }
  // asIs is off whenever a format was asked for: the conversion pass writes the
  // same filename the as-is pass would, so running both writes each file twice
  // and the browser resolves the collision by renaming.
  return { asIs: false, generateFormats, requested };
}

function resolveLocales(ctx: CommandContext, status: SessionStatus): string[] | undefined {
  const fromFlag = flagList(ctx.args.flags, 'locales');
  const asked = fromFlag ?? ctx.config.locales;
  if (!asked || asked.length === 0) return undefined;

  // A project with no languages at all renders whatever is on the canvas, which
  // is what `locales: undefined` means to handleConfirmExport. A config that
  // names languages the project has not got yet is a plan, not a mistake, so it
  // says so and renders. A --locales the user typed IS a mistake, and falls
  // through to the error below.
  if (!status.baseLocale && status.locales.length === 0) {
    if (!fromFlag) {
      warn(`the config asks for ${asked.join(', ')} but this project has no languages yet, rendering as it is`);
      info('      Add them with `osg localize --add <codes>`, then render again');
      return undefined;
    }
  }

  // status.locales is the *additional* languages (getProjectLocales drops the
  // base one), so the full set is the base plus those, base first, which is the
  // order the export dialog hands over and the order the files are numbered in.
  const available = [status.baseLocale, ...status.locales].filter((code): code is string => !!code);
  if (asked.length === 1 && asked[0].toLowerCase() === 'all') {
    return available.length > 1 ? available : undefined;
  }

  const unknown = asked.filter((code) => !available.includes(code));
  if (unknown.length) {
    throw usageError(
      `This project has no language "${unknown.join('", "')}".`,
      available.length
        ? `It has: ${available.join(', ')}.`
        : 'It has no export languages yet. Add some with `osg localize`.'
    );
  }
  // Keep the project's own order rather than the order they were typed, so the
  // file numbering matches every other run.
  return available.filter((code) => asked.includes(code));
}

// --- the command -------------------------------------------------------------

export async function run(ctx: CommandContext): Promise<number> {
  const started = Date.now();
  const flags = ctx.args.flags;
  const only = flagString(flags, 'only');
  const { asIs, generateFormats, requested } = resolveFormats(ctx);
  // --timeout is seconds, like every other timeout a person types.
  const timeoutFlag = flagNumber(flags, 'timeout');
  const waitMs = timeoutFlag && timeoutFlag > 0 ? timeoutFlag * 1000 : DEFAULT_FILE_WAIT_MS;

  const session = await ctx.session();
  const status = await openProject(ctx, session);
  if (status.artboards.length === 0) {
    throw driverError(
      'The project opened with no artboards.',
      'Check the project file, or rebuild it with `osg new` or `osg design`.'
    );
  }

  if (only) {
    const board = status.artboards.find((artboard) => artboard.id === only || artboard.name === only);
    if (!board) {
      throw usageError(
        `No artboard "${only}" in this project.`,
        `It has: ${status.artboards.map((artboard) => `${artboard.id} (${artboard.name})`).join(', ')}.`
      );
    }
    // currentArtboardOnly scopes to whatever the canvas has selected, so the
    // selection is the flag.
    await session.call('set_active_artboard', { artboardId: board.id });
  }

  const locales = resolveLocales(ctx, status);
  const boardCount = only ? 1 : status.artboards.length;
  const passes = asIs ? 1 : generateFormats.length;
  const expected = boardCount * passes * (locales?.length ?? 1);

  step(
    `render: ${asIs ? 'as-is' : generateFormats.join(', ')}` +
      `, ${boardCount} ${boardCount === 1 ? 'board' : 'boards'}` +
      (locales ? `, ${locales.length} languages` : '') +
      `, ${expected} ${expected === 1 ? 'file' : 'files'} expected`
  );

  const since = Date.now();
  let saved: SavedFile[];
  try {
    saved = await session.exportImages({ asIs, generateFormats, currentArtboardOnly: !!only, locales });
  } catch (error) {
    throw driverError(
      `The PNG export failed: ${(error as Error).message}`,
      'Re-run with --verbose to see the page console, or with --headed to watch it.'
    );
  }

  if (saved.length === 0) {
    throw driverError('The editor exported nothing.', 'Nothing matched the selection. Check --only and --formats.');
  }

  const filenames = [...new Set(saved.map((file) => file.filename))];
  if (filenames.length !== saved.length) {
    warn(`${saved.length - filenames.length} exported files share a name, only the last of each survives on disk`);
  }

  const { written, missing, unexpected } = await waitForFiles(ctx.outDir, filenames, { timeoutMs: waitMs, since });
  if (missing.length) {
    throw driverError(
      `${missing.length} of ${filenames.length} files never arrived in ${ctx.outDir}: ${missing.join(', ')}`,
      unexpected.length
        ? `The browser saved these instead: ${unexpected.join(', ')}. Clear the output directory, or render into a fresh --out.`
        : `The download may still be in flight. Raise --timeout above ${Math.round(waitMs / 1000)}s, or check that ${ctx.outDir} is writable.`,
      { missing, unexpected, written: written.map((file) => file.filename) }
    );
  }

  const bytes = written.reduce((sum, file) => sum + file.bytes, 0);
  printFileTable(written);
  ok(
    `${written.length} ${written.length === 1 ? 'file' : 'files'}, ${humanBytes(bytes)}, ` +
      `${humanMs(Date.now() - started)} ${bold('->')} ${ctx.outDir}`
  );

  if (ctx.json) {
    emit({
      command: 'render',
      outDir: ctx.outDir,
      project: { file: ctx.projectFile, name: status.projectName, boards: status.artboards.length },
      formats: requested,
      asIs,
      generateFormats,
      locales: locales ?? null,
      artboardId: only ?? null,
      files: written.map((file) => ({ filename: file.filename, path: file.path, bytes: file.bytes })),
      bytes,
      durationMs: Date.now() - started,
    });
  }

  return EXIT.ok;
}
