/**
 * osg studio: the same editor, with a person in it.
 *
 * An agent gets a project 90 percent of the way there and then somebody wants
 * to nudge one headline. This opens that project in a real window so they can,
 * and writes every change back to the project file, so the tweak is a diff the
 * next prompt builds on rather than a change that only ever existed in a
 * browser profile the next run throws away.
 *
 * There is no separate studio app to maintain. This is the same bundle every
 * headless command drives, opened with a head on it: the tools an agent calls
 * and the buttons a person clicks are the same code, so the two cannot drift,
 * and nothing in this file has to know what the editor looks like.
 *
 * Saving is a poll rather than a save button, because a window can be closed
 * with the mouse and a closed page cannot be read. The poll keeps the file
 * within one interval of the canvas whatever happens to the window.
 */
import fs from 'node:fs';
import path from 'node:path';
import { flagBool, flagNumber, flagString } from '../args.js';
import { DEFAULTS } from '../config.js';
import type { CommandContext } from '../context.js';
import type { Session } from '../driver/session.js';
import { EXIT, usageError } from '../errors.js';
import { loadManifest } from '../editor/assets.js';
import { manifestPath, resolveEditor } from '../editor/resolve.js';
import { startEditorServer } from '../editor/server.js';
import { bold, debug, dim, emit, humanBytes, info, ok, step, warn } from '../log.js';
import { openProject } from './render.js';

/** Long enough not to sit in the tool queue while somebody drags an element. */
const POLL_MS = 5_000;

/**
 * Everything in the file except the boards, read before the browser starts so a
 * malformed project costs no browser boot.
 *
 * The rest of the file is kept and written back verbatim, and that is not
 * tidiness: `mediaData` and `fontData` are the base64 payloads of the screen
 * recordings and imported fonts the document only references. Rewriting the
 * file without them would leave every video element pointing at nothing, with
 * no error anywhere.
 */
function readSidecar(file: string): Record<string, unknown> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw usageError(
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'Fix the file, or re-create it with `osg new`.'
    );
  }
  if (!Array.isArray(parsed.projectData)) {
    throw usageError(`${file} has no artboard data.`, 'A project file carries a "projectData" array.');
  }
  // The boards come back from the page on every save, so holding a second copy
  // of the largest key in the file would be for nothing.
  delete parsed.projectData;
  return parsed;
}

/** Media ids the file already carries, so a save never re-encodes them. */
function mediaIdsOf(sidecar: Record<string, unknown>): Set<string> {
  const metas = Array.isArray(sidecar.media) ? (sidecar.media as { id?: unknown }[]) : [];
  return new Set(metas.map((meta) => String(meta.id ?? '')).filter(Boolean));
}

function collectAssetRefs(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith('asset:')) into.add(value.slice('asset:'.length));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetRefs(item, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAssetRefs(item, into);
  }
}

function inlineAssetRefs(value: unknown, urls: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return value.startsWith('asset:') ? urls.get(value.slice('asset:'.length)) ?? value : value;
  }
  if (Array.isArray(value)) return value.map((item) => inlineAssetRefs(item, urls));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = inlineAssetRefs(item, urls);
    return out;
  }
  return value;
}

/** Recordings are referenced by row id, never by an `asset:` string. */
function collectMediaIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMediaIds(item, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'mediaId' || key === 'screenVideoMediaId') && typeof item === 'string' && item) into.add(item);
      else collectMediaIds(item, into);
    }
  }
}

/**
 * Read image blobs back out of the page as data URLs.
 *
 * Straight IndexedDB rather than a tool call, for the same reason render.ts's
 * open script writes it that way: the `media` table is where both uploaded
 * images and recordings live, and nothing in the tool surface hands back bytes.
 */
async function resolveAssets(session: Session, ids: string[]): Promise<Record<string, string>> {
  const script = `(async () => {
  const ids = ${JSON.stringify(ids)};
  const out = {};
  const db = await new Promise(function (resolve, reject) {
    const request = indexedDB.open('ProjectDatabase');
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
  if (!db.objectStoreNames.contains('media')) { db.close(); return out; }
  const tx = db.transaction('media', 'readonly');
  const table = tx.objectStore('media');
  const rows = await Promise.all(ids.map(function (id) {
    return new Promise(function (resolve) {
      const get = table.get(id);
      get.onsuccess = function () { resolve(get.result || null); };
      get.onerror = function () { resolve(null); };
    });
  }));
  db.close();
  for (const row of rows) {
    if (!row || !row.blob) continue;
    out[row.id] = await new Promise(function (resolve) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { resolve(''); };
      reader.readAsDataURL(row.blob);
    });
  }
  return out;
})()`;
  return await session.evaluate<Record<string, string>>(script);
}

/** Rebuilt from the live boards: no tool hands back a whole project at once. */
async function readBoards(session: Session): Promise<{ id: string | null; name: string; boards: unknown[] }> {
  const status = await session.status();
  if (!status.projectId) return { id: null, name: status.projectName, boards: [] };
  const boards: unknown[] = [];
  for (const board of status.artboards) {
    const full = (await session.call('get_artboard', { artboardId: board.id })) as Record<string, unknown>;
    const state = { ...full };
    // `active` is a view flag the tool adds, not part of the document.
    delete state.active;
    boards.push(state);
  }
  return { id: status.projectId, name: status.projectName, boards };
}

function writeProjectFile(
  file: string,
  sidecar: Record<string, unknown>,
  id: string,
  name: string,
  boards: unknown[]
): number {
  const next = { ...sidecar, id, name, timestamp: new Date().toISOString(), projectData: boards };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return fs.statSync(file).size;
}

type QuitReason = 'quit' | 'closed';

/**
 * Resolves on Ctrl+C, on a TERM, or when the window goes away. The signal
 * listeners are `once`, so a second Ctrl+C gets the default behaviour and kills
 * the process outright: a save that hangs must never trap somebody in here.
 */
function waitForQuit(session: Session | null): Promise<QuitReason> {
  return new Promise<QuitReason>((resolve) => {
    const browser = session?.page.browser() ?? null;
    let done = false;

    const finish = (reason: QuitReason) => {
      if (done) return;
      done = true;
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      browser?.off('disconnected', onGone);
      session?.page.off('close', onGone);
      resolve(reason);
    };
    const onSignal = () => finish('quit');
    const onGone = () => finish('closed');

    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    browser?.once('disconnected', onGone);
    session?.page.once('close', onGone);
  });
}

/** --port is a request: this build's editor server picks its own free port. */
function notePort(requested: number | undefined, actual: number): void {
  if (requested && requested !== actual) {
    warn(`the editor server picks its own port, serving on ${actual} rather than ${requested}`);
  }
}

/**
 * --no-open: the origin, and nothing driving it. Useful for pointing a browser
 * you already have open at the bundled editor, or for a machine where the
 * window would come up on the wrong screen.
 */
async function serveOnly(ctx: CommandContext, port: number | undefined): Promise<number> {
  const assetsBaseUrl =
    flagString(ctx.args.flags, 'assets-base-url') ?? ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl;
  const source = resolveEditor({
    editorUrl: flagString(ctx.args.flags, 'editor-url') ?? ctx.config.editorUrl,
    cwd: ctx.root,
    assetsBaseUrl,
  });

  if (source.kind === 'remote') {
    step(`editor: ${source.label}`);
    info(bold(source.origin));
    if (ctx.json) emit({ command: 'studio', url: source.origin, served: false, opened: false, editor: source.label });
    return EXIT.ok;
  }

  const server = await startEditorServer({
    dir: source.dir,
    manifest: loadManifest(manifestPath()),
    assetsBaseUrl,
    offline: ctx.offline,
  });
  notePort(port, server.port);
  step(`editor: ${source.label}`);
  info(bold(server.origin));
  // A browser this command did not start has storage of its own, and a project
  // lives in that storage, so there is nothing to seed it with from here.
  info(dim('this browser is not driven by osg, open the project from its start screen'));
  info(dim('Ctrl+C to stop serving'));
  if (ctx.json) emit({ command: 'studio', url: server.origin, served: true, opened: false, editor: source.label });

  await waitForQuit(null);
  await server.close();
  return EXIT.ok;
}

export async function run(ctx: CommandContext): Promise<number> {
  const { flags } = ctx.args;
  const port = flagNumber(flags, 'port');
  if (!flagBool(flags, 'open', true)) return await serveOnly(ctx, port);

  const file = ctx.projectFile;
  if (!fs.existsSync(file)) {
    throw usageError(
      `No project at ${file}`,
      'Make one first: `osg new --template <slug>`, `osg fill`, or `osg design "<instruction>"`.'
    );
  }
  const sidecar = readSidecar(file);
  const carried = mediaIdsOf(sidecar);
  const fileId = typeof sidecar.id === 'string' ? sidecar.id : `project_${Date.now()}`;
  const fileName =
    typeof sidecar.name === 'string' && sidecar.name.trim() ? sidecar.name : path.basename(file, path.extname(file));

  const session = await ctx.session({ headed: true });
  if (session.server) notePort(port, session.server.port);
  const status = await openProject(ctx, session);
  const projectId = status.projectId ?? '';
  // The name the page reports at open, which is not always the file's: the
  // editor can finish creating its own empty project after the load lands. It
  // is the baseline a real rename is measured against, not a name to save.
  const nameAtOpen = status.projectName;

  const url = `${session.origin}/?projectId=${encodeURIComponent(projectId)}`;
  step(`studio: ${status.projectName}`);
  info(bold(url));
  info(`edits are written back to ${path.relative(ctx.root, file) || file}`);
  info(dim('Ctrl+C here, or close the window, when you are done'));

  let lastWritten = '';
  let lastName = fileName;
  let saves = 0;
  let warnedForeign = false;
  let warnedRecording = false;
  // Content addressed and immutable, so a resolved image is resolved for the
  // life of the session. Without this every save re-encodes every screenshot.
  const resolved = new Map<string, string>();

  const sync = async (): Promise<void> => {
    const live = await readBoards(session);
    if (!live.id) return;
    // A different project in the window means the person opened something else.
    // Writing it here would lose the project they came to edit, so say it once
    // and leave the file alone.
    if (live.id !== projectId) {
      if (!warnedForeign) {
        warnedForeign = true;
        warn(`the window is showing another project (${live.name}), nothing is being written back`);
      }
      return;
    }
    const serialized = JSON.stringify(live.boards);
    if (serialized === lastWritten) return;
    // The first read is the project as it was opened, so it sets the baseline
    // rather than counting as an edit.
    const first = lastWritten === '';
    lastWritten = serialized;
    if (first) return;

    // The editor externalizes inline media as it opens a project (issue #19),
    // so a screenshot that arrived in the file as a data URL comes back as an
    // `asset:<id>` pointing into a browser profile this run throws away.
    // Writing that reference to disk would empty the frame on the next run, so
    // anything the file does not already carry is read back and inlined, which
    // is the same shape `osg new` writes.
    const refs = new Set<string>();
    collectAssetRefs(live.boards, refs);
    const wanted = [...refs].filter((id) => !carried.has(id) && !resolved.has(id));
    if (wanted.length > 0) {
      for (const [id, dataUrl] of Object.entries(await resolveAssets(session, wanted))) {
        if (dataUrl) resolved.set(id, dataUrl);
      }
    }
    const boards = inlineAssetRefs(live.boards, resolved) as unknown[];

    const recordings = new Set<string>();
    collectMediaIds(live.boards, recordings);
    const orphans = [...recordings].filter((id) => !carried.has(id));
    if (orphans.length > 0 && !warnedRecording) {
      warnedRecording = true;
      warn(
        `${orphans.length} recordings were added in this window and cannot travel in the project file, ` +
          'export the project from the editor to keep them'
      );
    }

    // The name only changes when a person changed it, measured against what the
    // page said at open rather than against the file.
    lastName = live.name === nameAtOpen ? fileName : live.name;
    const bytes = writeProjectFile(file, sidecar, fileId, lastName, boards);
    saves += 1;
    debug(`saved ${file} (${humanBytes(bytes)})`);
  };

  await sync();

  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void sync()
      .catch((error: unknown) => debug(`studio sync: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        busy = false;
      });
  }, POLL_MS);

  const reason = await waitForQuit(session);
  clearInterval(timer);

  // On Ctrl+C the page is still there, so the last edit is still readable. On a
  // closed window it is not, and the last poll is the best that exists. The
  // beat is for the edit that landed in the same frame as the interrupt: the
  // tools read whatever the last render closed over.
  if (reason === 'quit') {
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await sync();
    } catch (error) {
      debug(`final sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (ctx.json) {
    emit({
      command: 'studio',
      url,
      served: !!session.server,
      opened: true,
      projectFile: file,
      projectId,
      name: lastName,
      saves,
      reason,
    });
  } else if (saves > 0) {
    ok(`${saves === 1 ? '1 save' : `${saves} saves`} written to ${path.relative(ctx.root, file) || file}`);
  } else {
    info('closed with nothing changed');
  }

  return EXIT.ok;
}
