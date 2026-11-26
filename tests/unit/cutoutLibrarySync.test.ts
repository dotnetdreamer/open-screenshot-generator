// The pictures' library and its backup, run for real against tables kept in
// memory and Google Drives kept in memory: what a picture with no photo of its
// own is edited from, and how an edit keeps its mask with that photo; and what
// a backup does when Drive refuses a deletion or a rename, a sign-in runs out
// partway, a download stops halfway, the computer backs up to a second
// account, a picture is renamed, or a file it should bring back is gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { build as Esbuild } from 'esbuild';
import type { LibraryImageRow } from '@/lib/cutout/library';

const { build } = createRequire(path.join(process.cwd(), 'package.json'))('esbuild') as { build: typeof Esbuild };

// Storage, the signed in account and the canvas are swapped for these; the
// library, the backup and the Drive adapter are the real ones.
// Each test sets up its own storage, so the stubs look it up on every call.
const STUBS: Record<string, string> = {
  '@/database': 'export const db = { get media() { return globalThis.__libraryTest.db.media; } };',
  './libraryDb': `export const libraryDb = {
    get images() { return globalThis.__libraryTest.libraryDb.images; },
    transaction: (...args) => globalThis.__libraryTest.libraryDb.transaction(...args),
  };`,
  '@/lib/mediaStore': `
    export const ASSET_REF_PREFIX = 'asset:';
    export function notifyMediaChanged() {}
    export async function getMediaAsset(id) { return globalThis.__libraryTest.db.media.get(id); }
  `,
  '@/lib/account': `
    export function getSession() { return globalThis.__libraryTest.session; }
    export async function withFreshSession(session) { return session; }
    export function getProvider() { return {}; }
  `,
  './picture': `
    export async function decodePicture(blob) {
      if (blob && (await blob.text()).startsWith('not a picture')) throw new Error('The browser could not decode it');
      return { rgba: new Uint8ClampedArray(4), width: 1, height: 1, hasAlpha: true };
    }
    export async function encodeRgba() { return new Blob(['png'], { type: 'image/png' }); }
    export async function thumbnailOf() { return new Blob(['thumb'], { type: 'image/png' }); }
  `,
};

type Library = typeof import('@/lib/cutout/library') & typeof import('@/lib/cutout/backup') & typeof import('@/lib/cutout/add');
const modules: Promise<Library> = (async () => {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osg-library-')), 'library.mjs');
  await build({
    stdin: {
      contents: "export * from '@/lib/cutout/library'; export * from '@/lib/cutout/backup'; export * from '@/lib/cutout/add';",
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    absWorkingDir: process.cwd(),
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    alias: { '@': path.join(process.cwd(), 'src') },
    banner: { js: "import { createRequire as __osgCreateRequire } from 'node:module'; const require = __osgCreateRequire(import.meta.url);" },
    logLevel: 'error',
    plugins: [{
      name: 'library-test-io',
      setup(builder) {
        // Only for the library's own modules: the providers' imports stay real.
        const cutout = path.join(process.cwd(), 'src', 'lib', 'cutout');
        builder.onResolve({ filter: /.*/ }, ({ path: name, importer }) =>
          name in STUBS && (importer.startsWith(cutout) || importer === '<stdin>') ? { path: name, namespace: 'library-test' } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: 'library-test' }, ({ path: name }) => ({ contents: STUBS[name], loader: 'js' }));
      },
    }],
  });
  return import(pathToFileURL(outfile).href) as Promise<Library>;
})();

let loaded: Library | undefined;
void modules.then((library) => {
  loaded = library;
});

const LIST_FILE = /^library\.[a-z0-9]+\.json$/;

/** Every computer's lists in an account as one, the way a backup reads them. */
const mergedView = (lists: any[]) => loaded!.mergeLists(lists, 0);

/** A Dexie table's few calls the library makes, over a Map. */
function table<T extends { id: string }>(refusePut?: (row: T) => Error | undefined, onGet?: (id: string) => Promise<void> | void) {
  const rows = new Map<string, T>();
  return {
    rows,
    async get(id: string) {
      await onGet?.(id);
      const row = rows.get(id);
      return row && { ...row };
    },
    async put(row: T) {
      const refused = refusePut?.(row);
      if (refused) throw refused;
      rows.set(row.id, { ...row });
      return row.id;
    },
    async update(id: string, changes: Partial<T>) {
      const row = rows.get(id);
      if (!row) return 0;
      rows.set(id, { ...row, ...changes });
      return 1;
    },
    async delete(id: string) { rows.delete(id); },
    async bulkDelete(ids: string[]) { ids.forEach((id) => rows.delete(id)); },
    async toArray() { return [...rows.values()].map((row) => ({ ...row })); },
    orderBy() { return { reverse: () => ({ toArray: async () => [...rows.values()].map((row) => ({ ...row })) }) }; },
  };
}

interface Media { id: string; blob: Blob; name: string; mimeType: string; width?: number; height?: number; createdAt: Date }

/** A computer's storage, in use from now on. `use` goes back to it, for a test with two computers. */
function storage(options: {
  refuseMedia?: (row: Media) => Error | undefined;
  /** Runs as a file is read here, before it is: another window acting while a backup goes through the pictures. */
  onMediaGet?: (id: string) => Promise<void> | void;
} = {}) {
  const media = table<Media>(options.refuseMedia, options.onMediaGet);
  const images = table<LibraryImageRow>();
  const libraryDb = { images, transaction: async (_mode: string, _table: unknown, job: () => Promise<unknown>) => job() };
  // Each computer's own browser storage, where it keeps its name in the lists.
  const kept = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, String(value)),
    removeItem: (key: string) => void kept.delete(key),
  };
  const install = (session: unknown) => {
    (globalThis as any).__libraryTest = { db: { media }, libraryDb, session };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });
  };
  install(GOOGLE);
  const use = () => install((globalThis as any).__libraryTest.session);
  return { media, images, use, kept };
}

const GOOGLE = { provider: 'google', accessToken: 'test-token', account: { id: '1', name: 'Test' }, expiresAt: Date.now() + 3_600_000 };
const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
const blob = (text: string, type = 'image/png') => new Blob([text], { type });
const media = (id: string, text: string, type = 'image/png'): Media => ({ id, blob: blob(text, type), name: id, mimeType: type, width: 10, height: 20, createdAt: new Date() });

// --- what a picture is edited from ------------------------------------------------

test('a picture edited by hand before it had a photo opens from itself, without the old mask', async () => {
  const { photoOf } = await modules;
  const store = storage();
  // A restore that a build before this one edited by hand: its mask is over the
  // picture as it was then, and the picture is now that edit's output.
  await store.media.put(media('asset_2', 'trimmed picture'));
  await store.media.put(media('libmask_1', 'mask over the older picture'));
  await store.images.put({
    id: 'img_1', name: 'Dog', state: 'ready', mediaId: 'asset_2', width: 10, height: 20, maskMediaId: 'libmask_1',
    settings: { edge: -3, softness: 4, cleanColors: false, trim: true }, rect: { x: 5, y: 5, width: 10, height: 20 },
    createdAt: 1, updatedAt: 2,
  });

  const source = await photoOf('img_1');
  assert.ok(source);
  assert.equal(await source.photo.blob.text(), 'trimmed picture');
  assert.equal(source.mask, undefined, 'the old mask is not used');
  assert.deepEqual(source.row.settings, { edge: 0, softness: 0, cleanColors: false, trim: true }, 'the edge settings are in the picture already');

  const row = store.images.rows.get('img_1')!;
  assert.match(row.sourceMediaId ?? '', /^libsrc_/);
  assert.equal(row.maskMediaId, undefined);
  assert.equal(row.rect, undefined);
  assert.equal(store.media.rows.has('libmask_1'), false, 'the old mask is let go');
  assert.equal(await store.media.rows.get(row.sourceMediaId!)!.blob.text(), 'trimmed picture');

  const again = await photoOf('img_1');
  assert.equal(again?.photo.id, row.sourceMediaId, 'the next open uses the same photo');
});

test('a picture with no room for its photo is edited from itself and nothing is written', async () => {
  const { photoOf } = await modules;
  const store = storage({ refuseMedia: (row) => (row.id.startsWith('libsrc_') ? quota() : undefined) });
  await store.media.put(media('asset_1', 'picture'));
  await store.media.put(media('libmask_1', 'mask'));
  const before: LibraryImageRow = {
    id: 'img_1', name: 'Cat', state: 'ready', mediaId: 'asset_1', maskMediaId: 'libmask_1',
    settings: { edge: 2, softness: 1, cleanColors: true, trim: true }, createdAt: 1, updatedAt: 2,
  };
  await store.images.put(before);

  const source = await photoOf('img_1');
  assert.equal(await source?.photo.blob.text(), 'picture');
  assert.equal(source?.mask, undefined);
  assert.deepEqual(source?.row.settings, { edge: 0, softness: 0, cleanColors: true, trim: true });
  assert.deepEqual(store.images.rows.get('img_1'), before);
  assert.deepEqual([...store.media.rows.keys()].sort(), ['asset_1', 'libmask_1']);
});

test('a picture with a photo of its own opens with its own mask and settings', async () => {
  const { photoOf } = await modules;
  const store = storage();
  await store.media.put(media('libsrc_1', 'photo', 'image/jpeg'));
  await store.media.put(media('libmask_1', 'mask'));
  await store.media.put(media('asset_1', 'picture'));
  const settings = { edge: -2, softness: 3, cleanColors: true, trim: true };
  await store.images.put({ id: 'img_1', name: 'Mug', state: 'ready', mediaId: 'asset_1', sourceMediaId: 'libsrc_1', maskMediaId: 'libmask_1', settings, createdAt: 1, updatedAt: 2 });

  const source = await photoOf('img_1');
  assert.equal(source?.photo.id, 'libsrc_1');
  assert.equal(source?.mask?.id, 'libmask_1');
  assert.deepEqual(source?.row.settings, settings);
  assert.equal(store.media.rows.size, 3, 'nothing copied');
});

test('a copy made of a picture that another window changed meanwhile is not given to the new picture', async () => {
  const { photoOf } = await modules;
  let changed = false;
  const store = storage({
    refuseMedia: (row) => {
      // While the first copy is written, another window saves a new version.
      if (row.id.startsWith('libsrc_') && !changed) {
        changed = true;
        store.media.rows.set('asset_2', media('asset_2', 'picture 2'));
        store.images.rows.set('img_1', { ...store.images.rows.get('img_1')!, mediaId: 'asset_2', updatedAt: 3 });
      }
      return undefined;
    },
  });
  await store.media.put(media('asset_1', 'picture 1'));
  await store.images.put({ id: 'img_1', name: 'Dog', state: 'ready', mediaId: 'asset_1', width: 10, height: 20, createdAt: 1, updatedAt: 2 });

  const source = await photoOf('img_1');
  assert.equal(await source?.photo.blob.text(), 'picture 2');
  const row = store.images.rows.get('img_1')!;
  assert.equal(row.mediaId, 'asset_2');
  assert.equal(await store.media.rows.get(row.sourceMediaId!)!.blob.text(), 'picture 2', 'its photo is the new picture');
  assert.deepEqual([...store.media.rows.keys()].filter((id) => id.startsWith('libsrc_')), [row.sourceMediaId], 'the copy of the old one went');
});

/** An edit over `photo`, started from the picture `basis` (the version the edit opened at). */
const anEdit = (photo: Media, basis: string | undefined = 'asset_1') => ({
  mask: blob('the new mask'),
  picture: blob('a smaller picture'),
  width: 5,
  height: 6,
  thumb: new ArrayBuffer(1),
  settings: { edge: 0, softness: 0, cleanColors: true, trim: true },
  rect: { x: 1, y: 1, width: 5, height: 6 },
  photo,
  basis,
});

test('an edit of a picture that had no room for its photo is kept only with that photo', async () => {
  const { photoOf, saveLibraryCut, isOutOfRoom } = await modules;
  let room = false;
  const store = storage({ refuseMedia: (row) => (row.id.startsWith('libsrc_') && !room ? quota() : undefined) });
  await store.media.put(media('asset_1', 'the whole picture'));
  await store.images.put({ id: 'img_1', name: 'Dog', state: 'ready', mediaId: 'asset_1', width: 10, height: 20, createdAt: 1, updatedAt: 2 });
  const before = store.images.rows.get('img_1');

  const source = (await photoOf('img_1'))!;
  assert.equal(source.photo.id, 'asset_1', 'the picture itself, nothing kept');
  await assert.rejects(saveLibraryCut('img_1', anEdit(source.photo)), (error: unknown) => isOutOfRoom(error));
  assert.deepEqual(store.images.rows.get('img_1'), before, 'nothing changed');
  assert.deepEqual([...store.media.rows.keys()], ['asset_1']);

  room = true;
  const saved = (await saveLibraryCut('img_1', anEdit(source.photo)))!;
  assert.match(saved.sourceMediaId ?? '', /^libsrc_/);
  assert.equal(await store.media.rows.get(saved.sourceMediaId!)!.blob.text(), 'the whole picture', 'the photo the mask is over');
  assert.equal(store.media.rows.has('asset_1'), false, 'the old picture goes; its copy is the photo now');
  const reopened = (await photoOf('img_1'))!;
  assert.equal(reopened.photo.id, saved.sourceMediaId);
  assert.equal(await reopened.mask?.blob.text(), 'the new mask', 'the saved mask, over its own photo');
});

test('an edit made over a photo the picture no longer has is refused, and nothing is written', async () => {
  const { saveLibraryCut } = await modules;
  const store = storage();
  await store.media.put(media('libsrc_new', 'the real photo', 'image/jpeg'));
  await store.media.put(media('asset_1', 'picture'));
  await store.images.put({ id: 'img_1', name: 'Dog', state: 'ready', mediaId: 'asset_1', sourceMediaId: 'libsrc_new', createdAt: 1, updatedAt: 2 });
  const before = store.images.rows.get('img_1');
  const changed = (error: unknown) => (error as Error).name === 'PictureChangedError';

  // A stand-in photo the backup replaced with the real one, and the picture
  // itself, opened before the picture had a photo kept.
  await assert.rejects(saveLibraryCut('img_1', anEdit(media('libsrc_old', 'a stand-in'))), changed);
  await assert.rejects(saveLibraryCut('img_1', anEdit(media('asset_1', 'picture'))), changed);
  assert.deepEqual(store.images.rows.get('img_1'), before);
  assert.deepEqual([...store.media.rows.keys()].sort(), ['asset_1', 'libsrc_new']);
});

test('a rename made while an edit is written is kept', async () => {
  const { saveLibraryCut } = await modules;
  const store = storage({
    refuseMedia: (row) => {
      if (row.id.startsWith('libmask_')) store.images.rows.set('img_1', { ...store.images.rows.get('img_1')!, name: 'Renamed meanwhile', updatedAt: 3 });
      return undefined;
    },
  });
  await store.media.put(media('libsrc_1', 'photo', 'image/jpeg'));
  await store.media.put(media('asset_1', 'picture'));
  await store.images.put({ id: 'img_1', name: 'Dog', state: 'ready', mediaId: 'asset_1', sourceMediaId: 'libsrc_1', createdAt: 1, updatedAt: 2 });
  const saved = await saveLibraryCut('img_1', anEdit(media('libsrc_1', 'photo', 'image/jpeg')));
  assert.equal(saved?.name, 'Renamed meanwhile');
  assert.equal(store.images.rows.get('img_1')?.name, 'Renamed meanwhile');
});

test('an edit whose picture gets another photo while it is written is refused, and what it wrote goes', async () => {
  const { saveLibraryCut } = await modules;
  const store = storage({
    refuseMedia: (row) => {
      // Another window gives the picture a photo while the mask is written.
      if (row.id.startsWith('libmask_')) store.images.rows.set('img_1', { ...store.images.rows.get('img_1')!, sourceMediaId: 'libsrc_other' });
      return undefined;
    },
  });
  await store.media.put(media('asset_1', 'picture'));
  await store.images.put({ id: 'img_1', name: 'Dog', state: 'ready', mediaId: 'asset_1', createdAt: 1, updatedAt: 2 });
  await assert.rejects(saveLibraryCut('img_1', anEdit(media('asset_1', 'picture'))), (error: unknown) => (error as Error).name === 'PictureChangedError');
  assert.deepEqual([...store.media.rows.keys()], ['asset_1'], 'the copy, the picture and the mask it wrote went');
  assert.equal(store.images.rows.get('img_1')!.mediaId, 'asset_1');
});

// --- adding pictures ----------------------------------------------------------------

test('a batch says which files were not added and why, and keeps the rest', async () => {
  const { addPictureFiles } = await modules;
  let room = 1;
  const store = storage({ refuseMedia: () => (room-- > 0 ? undefined : quota()) });
  const files = [
    new File(['photo a'], 'a.jpg', { type: 'image/jpeg' }),
    new File(['not a picture'], 'notes.png', { type: 'image/png' }),
    new File(['photo b'], 'b.jpg', { type: 'image/jpeg' }),
  ];
  const result = await addPictureFiles(files, { cut: true });
  assert.deepEqual(result.added.map((row) => row.name), ['a']);
  assert.equal(result.notAdded, 2);
  assert.equal(
    result.reason,
    "This computer is out of room for more pictures. Delete some pictures or projects, then try again. notes.png isn't a photo the app can open."
  );
  assert.equal(store.images.rows.size, 1);

  const none = await addPictureFiles([files[1], new File(['not a picture'], 'more.png')], { cut: true }).catch((error: Error) => error.message);
  assert.equal(none, "None of the 2 files are photos the app can open.");
  room = 10;
  const all = await addPictureFiles([files[0]], { cut: false });
  assert.equal(all.reason, null, 'a batch that all went in has nothing to say');
});

test('a dropped file that is plainly not a picture is counted and named, and not opened', async () => {
  const { addPictureFiles } = await modules;
  const store = storage();
  const result = await addPictureFiles([
    new File(['photo a'], 'a.jpg', { type: 'image/jpeg' }),
    // These bytes would open as a picture here, so only its type keeps it out.
    new File(['would open'], 'notes.pdf', { type: 'application/pdf' }),
    new File(['photo b'], 'IMG_0042', { type: '' }),
  ], { cut: true });
  assert.deepEqual(result.added.map((row) => row.name), ['a', 'IMG 0042'], 'a file with no type is tried');
  assert.equal(result.notAdded, 1);
  assert.equal(result.reason, "notes.pdf isn't a photo the app can open.");
  assert.equal(store.images.rows.size, 2);
});

// --- the backup ---------------------------------------------------------------------

interface DriveFile { name: string; appProperties: Record<string, string>; content: string; trashed: boolean }

/**
 * Google Drive, in memory, behind window.fetch. `refuse` answers a request
 * with that status instead, when it returns one; `breakBody` makes a file's
 * download stop halfway, as a dropped connection does. `use` puts this Drive
 * back behind window.fetch, for a test that signs in to another one between.
 */
function fakeDrive(options: {
  refuse?: (method: string, url: string, body: string) => number | undefined;
  breakBody?: (file: DriveFile) => boolean;
  /** Runs before a request is answered: another computer, or this one, acting while a sync waits. */
  hook?: (method: string, url: string, body: string) => Promise<void> | void;
  /** Runs while a file comes down, before its bytes are sent. */
  onDownload?: (file: DriveFile) => Promise<void> | void;
} = {}) {
  const files = new Map<string, DriveFile>();
  let next = 1;
  let folder: string | null = null;
  const sent: Array<{ method: string; url: string; body: string }> = [];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body instanceof Blob ? await init.body.text() : typeof init.body === 'string' ? init.body : '';
    sent.push({ method, url, body });
    await options.hook?.(method, url, body);
    const refused = options.refuse?.(method, url, body);
    if (refused) return json({ error: { message: 'Drive said no' } }, refused);
    const query = new URL(url).searchParams.get('q') ?? '';
    if (method === 'GET' && query.includes('absLibrary')) return json({ files: folder ? [{ id: folder }] : [] });
    if (method === 'GET' && query.includes('in parents')) {
      // The folder's files, or the ones of it in the trash.
      const inTrash = query.includes('trashed = true');
      return json({ files: [...files].filter(([, file]) => file.trashed === inTrash).map(([id, file]) => ({ id, name: file.name, appProperties: file.appProperties })) });
    }
    const media = url.match(/\/files\/([^/?]+)\?alt=media/);
    if (media) {
      const file = files.get(media[1]);
      if (!file) return json({ error: { message: 'File not found' } }, 404);
      await options.onDownload?.(file);
      if (options.breakBody?.(file)) {
        return new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError('network error')) }));
      }
      // Drive sends a file with the type it was stored with.
      const type = file.name.endsWith('.jpg') ? 'image/jpeg' : file.name.endsWith('.json') ? 'application/json' : 'image/png';
      return new Response(file.content, { headers: { 'Content-Type': type } });
    }
    if (method === 'POST' && url.endsWith('/files?fields=id')) {
      folder = `folder-${next++}`;
      return json({ id: folder });
    }
    const boundary = String((init.headers as Record<string, string>)?.['Content-Type'] ?? '').match(/boundary=(.+)$/)?.[1];
    if (boundary) {
      const [metadataPart, contentPart] = body.split(`--${boundary}`).slice(1, 3);
      const metadata = JSON.parse(metadataPart.slice(metadataPart.indexOf('\r\n\r\n') + 4).trim());
      const content = contentPart.slice(contentPart.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
      const existing = url.match(/\/upload\/drive\/v3\/files\/([^/?]+)/)?.[1];
      const id = existing ?? `file-${next++}`;
      const before = files.get(id);
      files.set(id, { name: metadata.name ?? before?.name, appProperties: { ...before?.appProperties, ...metadata.appProperties }, content, trashed: false });
      return json({ id, version: '1' });
    }
    const patch = url.match(/\/files\/([^/?]+)\?fields=id/);
    if (method === 'PATCH' && patch) {
      const file = files.get(patch[1]);
      if (!file) return json({ error: { message: 'File not found' } }, 404);
      const change = JSON.parse(body);
      files.set(patch[1], { ...file, ...change, appProperties: { ...file.appProperties, ...change.appProperties } });
      return json({ id: patch[1] });
    }
    return json({ error: { message: `Not faked: ${method} ${url}` } }, 500);
  };
  const use = () => Object.defineProperty(globalThis, 'window', { configurable: true, value: { fetch } });
  use();
  return {
    files,
    sent,
    use,
    live: () => [...files.values()].filter((file) => !file.trashed),
    /** The picture files, by name: not the lists. */
    names: () => [...files.values()].filter((file) => !file.trashed && file.name !== 'library.json' && !LIST_FILE.test(file.name)).map((file) => file.name).sort(),
    /** Each computer's list. */
    lists: () => [...files.values()].filter((file) => !file.trashed && LIST_FILE.test(file.name)).map((file) => JSON.parse(file.content)),
    /** What library.json holds. */
    legacy: () => JSON.parse([...files.values()].find((file) => !file.trashed && file.name === 'library.json')!.content),
    /** The pictures every list together has. */
    manifest: () => mergedView([...files.values()].filter((file) => !file.trashed && LIST_FILE.test(file.name)).map((file) => JSON.parse(file.content))),
  };
}

/** Signs in to the Google account `id`, whose Drive is `drive`. */
function signIn(id: string, drive: ReturnType<typeof fakeDrive>) {
  drive.use();
  (globalThis as any).__libraryTest.session = { ...GOOGLE, account: { id, name: `Account ${id}` } };
}

// The gist adapter reads a picture with FileReader, which Node has not got.
class TestFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(file: Blob) {
    file.arrayBuffer().then(
      (bytes) => {
        this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload?.();
      },
      () => this.onerror?.()
    );
  }
}
(globalThis as any).FileReader ??= TestFileReader;

/**
 * GitHub's gists, in memory, behind window.fetch: the calls the pictures'
 * gist makes. `hook` runs before a request is answered.
 */
function fakeGist(options: {
  hook?: (method: string, url: string, body: string) => Promise<void> | void;
  /** Answers a request with this status instead, when it returns one. */
  refuse?: (method: string, url: string, body: string) => number | undefined;
} = {}) {
  const gists = new Map<string, { id: string; description: string; files: Map<string, string> }>();
  let next = 1;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const view = (gist: { id: string; description: string; files: Map<string, string> }) => ({
    id: gist.id,
    description: gist.description,
    files: Object.fromEntries([...gist.files].map(([filename, content]) => [filename, { filename, content, truncated: false }])),
  });
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : '';
    await options.hook?.(method, url, body);
    const refused = options.refuse?.(method, url, body);
    if (refused) return json({ message: 'Gist cannot be updated.' }, refused);
    const { pathname, searchParams } = new URL(url);
    if (method === 'GET' && pathname === '/gists') {
      return json(searchParams.get('page') === '1' ? [...gists.values()].map((gist) => ({ id: gist.id, description: gist.description, files: {} })) : []);
    }
    if (method === 'POST' && pathname === '/gists') {
      const created = JSON.parse(body) as { description: string; files: Record<string, { content: string }> };
      const id = `gist-${next++}`;
      gists.set(id, { id, description: created.description, files: new Map(Object.entries(created.files).map(([name, file]) => [name, file.content])) });
      return json(view(gists.get(id)!));
    }
    const gist = gists.get(pathname.match(/^\/gists\/([^/]+)$/)?.[1] ?? '');
    if (!gist) return json({ message: 'Not Found' }, 404);
    if (method === 'GET') return json(view(gist));
    if (method === 'PATCH') {
      for (const [name, file] of Object.entries(JSON.parse(body).files as Record<string, { content: string } | null>)) {
        if (file === null) gist.files.delete(name);
        else gist.files.set(name, file.content);
      }
      return json(view(gist));
    }
    return json({ message: `Not faked: ${method} ${url}` }, 500);
  };
  const use = () => Object.defineProperty(globalThis, 'window', { configurable: true, value: { fetch } });
  use();
  const only = () => [...gists.values()][0];
  return {
    use,
    /** Writes a file into the pictures' gist directly, as another computer's request would. */
    put: (name: string, content: string) => only().files.set(name, content),
    /** Takes a file out of the pictures' gist directly. */
    remove: (name: string) => only().files.delete(name),
    /** The media ids the pictures' gist holds files for. */
    mediaIds: () => [...only().files.keys()].filter((name) => name.startsWith('media-')).map((name) => name.slice('media-'.length, -'.b64'.length)).sort(),
    /** Each computer's list. */
    lists: () => [...only().files].filter(([name]) => LIST_FILE.test(name)).map(([, content]) => JSON.parse(content)),
    /** What library.json holds. */
    legacy: () => JSON.parse(only().files.get('library.json')!),
    /** The pictures every list together has. */
    manifest: () => mergedView([...only().files].filter(([name]) => LIST_FILE.test(name)).map(([, content]) => JSON.parse(content))),
  };
}

/** Signs in to a GitHub account, whose gists are `gist`. */
function signInGithub(gist: ReturnType<typeof fakeGist>) {
  gist.use();
  (globalThis as any).__libraryTest.session = { provider: 'github', accessToken: 'test-token', account: { id: '9', name: 'Octo' } };
}

/**
 * Two computers share no lock. The sync takes one so two windows of the same
 * computer never back up at once, and Node has one for the whole test.
 */
async function withoutLocks(job: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    await job();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
}

/** The request bodies Drive's own calls send: a trash, and a rename. */
const isTrash = (method: string, body: string) => method === 'PATCH' && body.includes('"trashed"');
const isRename = (method: string, body: string) => method === 'PATCH' && body.startsWith('{"name"');
const isAuthError = (error: Error) => error.name === 'AccountAuthError';

/** A picture kept here, with its media. */
async function addPicture(store: ReturnType<typeof storage>, id: string, name: string, updatedAt: number) {
  await store.media.put(media(`asset_${id}`, `picture ${id}`));
  await store.images.put({ id, name, state: 'plain', mediaId: `asset_${id}`, width: 10, height: 20, createdAt: 1, updatedAt });
}

const CUT = { edge: -2, softness: 3, cleanColors: true, trim: true };

/** A picture cut here: the picture, the photo it was cut from, and the mask. */
async function addCutPicture(store: ReturnType<typeof storage>, id: string, name: string, updatedAt: number) {
  await store.media.put(media(`asset_${id}`, `picture ${id}`));
  await store.media.put(media(`libsrc_${id}`, `photo ${id}`, 'image/jpeg'));
  await store.media.put(media(`libmask_${id}`, `mask ${id}`));
  await store.images.put({
    id, name, state: 'ready', mediaId: `asset_${id}`, width: 10, height: 20,
    sourceMediaId: `libsrc_${id}`, sourceWidth: 40, sourceHeight: 50, maskMediaId: `libmask_${id}`,
    settings: CUT, rect: { x: 1, y: 2, width: 10, height: 20 }, engine: 'model', createdAt: 1, updatedAt,
  });
}

test('a deletion Drive refuses is not reported done, and the next backup finishes it', async () => {
  const { syncLibrary, describeSync, deleteLibraryImage } = await modules;
  const store = storage();
  let refuseTrash = true;
  const drive = fakeDrive({ refuse: (method, _url, body) => (refuseTrash && isTrash(method, body) ? 403 : undefined) });
  await addPicture(store, 'img_1', 'Dog', 2);
  await addPicture(store, 'img_2', 'Cat', 2);
  await syncLibrary();
  assert.equal(drive.names().length, 2);

  await deleteLibraryImage('img_1');
  const refused = await syncLibrary();
  assert.equal(refused.removedThere, 0);
  assert.equal(refused.notRemovedThere, 1);
  assert.deepEqual(describeSync(refused, 'Google Drive'), {
    title: "Part of the backup didn't finish",
    description: "1 picture couldn't be deleted from Google Drive. The next backup tries again.",
  });
  assert.ok(drive.live().some((file) => file.name === 'Dog.png'), 'the file is still in Drive');
  assert.deepEqual(store.images.rows.get('img_1')?.leftThere, { 'google:1': ['asset_img_1'] }, 'the file is noted here, for this account');
  assert.deepEqual(drive.manifest().images.map((image: { id: string }) => image.id), ['img_2'], 'the backup itself no longer lists it');

  refuseTrash = false;
  const finished = await syncLibrary();
  assert.equal(finished.removedThere, 1);
  assert.equal(finished.notRemovedThere, 0);
  assert.equal(describeSync(finished, 'Google Drive').description, '1 deleted from Google Drive.');
  assert.ok(!drive.live().some((file) => file.name === 'Dog.png'));
  assert.equal(store.images.rows.get('img_1')?.leftThere, undefined, 'the note goes once the file is out');
  assert.ok(store.images.rows.get('img_1')?.deletedAt, 'the deleted row stays, out of sight, for other accounts to hear of');

  const quiet = await syncLibrary();
  assert.equal(describeSync(quiet, 'Google Drive').description, 'Google Drive already had all your pictures.', 'counted once');
});

test('a deletion that a lapsed sign-in stopped partway is finished, or reported, by the next backup', async () => {
  const { syncLibrary, deleteLibraryImage } = await modules;
  const store = storage();
  let trash: number | undefined;
  const drive = fakeDrive({ refuse: (method, _url, body) => (isTrash(method, body) ? trash : undefined) });
  await addPicture(store, 'img_1', 'Dog', 2);
  await addPicture(store, 'img_2', 'Cat', 2);
  await syncLibrary();
  await deleteLibraryImage('img_1');

  // The sign-in runs out after the list was written without the picture.
  trash = 401;
  await assert.rejects(syncLibrary(), isAuthError);
  assert.deepEqual(drive.manifest().images.map((image: { id: string }) => image.id), ['img_2']);
  assert.deepEqual(store.images.rows.get('img_1')?.leftThere, { 'google:1': ['asset_img_1'] }, 'noted before the list changed');

  trash = 403;
  const refused = await syncLibrary();
  assert.equal(refused.notRemovedThere, 1);
  assert.equal(refused.removedThere, 0);
  assert.deepEqual(store.images.rows.get('img_1')?.leftThere, { 'google:1': ['asset_img_1'] });
  assert.ok(drive.live().some((file) => file.name === 'Dog.png'));

  trash = undefined;
  const done = await syncLibrary();
  assert.equal(done.removedThere, 1);
  assert.ok(!drive.live().some((file) => file.name === 'Dog.png'));
  assert.equal(store.images.rows.get('img_1')?.leftThere, undefined);
});

test('a deletion goes to every account this computer backs up to, and is counted only where its files were', async () => {
  const { syncLibrary, describeSync, deleteLibraryImage } = await modules;
  const store = storage();
  let refuseFirst = false;
  const first = fakeDrive({ refuse: (method, _url, body) => (refuseFirst && isTrash(method, body) ? 403 : undefined) });
  const second = fakeDrive();
  await addPicture(store, 'img_1', 'Dog', 2);
  await addPicture(store, 'img_2', 'Cat', 2);
  signIn('1', first);
  await syncLibrary();
  signIn('2', second);
  await syncLibrary();
  await deleteLibraryImage('img_1');

  signIn('1', first);
  refuseFirst = true;
  assert.equal((await syncLibrary()).notRemovedThere, 1);

  // The other account still has the picture: it goes from there too, and
  // does not come back here.
  signIn('2', second);
  const there = await syncLibrary();
  assert.equal(describeSync(there, 'Google Drive').description, '1 deleted from Google Drive.');
  assert.deepEqual(second.names(), ['Cat.png']);
  assert.ok(store.images.rows.get('img_1')?.deletedAt, 'not brought back');
  assert.deepEqual(store.images.rows.get('img_1')?.leftThere, { 'google:1': ['asset_img_1'] }, 'the first account still has its file');

  // Nothing of it is left in this account, so nothing is said of it here.
  assert.equal(describeSync(await syncLibrary(), 'Google Drive').description, 'Google Drive already had all your pictures.');

  signIn('1', first);
  refuseFirst = false;
  const back = await syncLibrary();
  assert.equal(back.removedThere, 1);
  assert.deepEqual(first.names(), ['Cat.png']);
  assert.equal(store.images.rows.get('img_1')?.leftThere, undefined);
});

test('a picture deleted here is not brought back by another account that has it, and the deletion is forgotten in time', async () => {
  const { syncLibrary, deleteLibraryImage } = await modules;
  const store = storage();
  const first = fakeDrive();
  const second = fakeDrive();
  await addPicture(store, 'img_1', 'Dog', 2);
  signIn('1', first);
  await syncLibrary();
  signIn('2', second);
  await syncLibrary();
  await deleteLibraryImage('img_1');

  signIn('1', first);
  assert.equal((await syncLibrary()).removedThere, 1);
  signIn('2', second);
  const later = await syncLibrary();
  assert.equal(later.removedThere, 1);
  assert.equal(later.downloaded, 0);
  assert.deepEqual(second.names(), []);

  // Older than a backup remembers a deletion: the row goes here too.
  const row = store.images.rows.get('img_1')!;
  store.images.rows.set('img_1', { ...row, deletedAt: Date.now() - 121 * 24 * 60 * 60 * 1000 });
  await syncLibrary();
  assert.equal(store.images.rows.has('img_1'), false);
});

test('a restore whose photo does not come down brings the picture back next time, and a rename keeps the photo in Drive', async () => {
  const { syncLibrary, describeSync, renameLibraryImage } = await modules;
  let store = storage();
  let dropPhoto = true;
  const drive = fakeDrive({ breakBody: (file) => dropPhoto && file.name.endsWith('(photo).jpg') });
  await addCutPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  assert.deepEqual(drive.names(), ['Dog (mask).png', 'Dog (photo).jpg', 'Dog.png']);

  // Another computer restores, and the photo's download stops halfway.
  store = storage();
  const broken = await syncLibrary();
  assert.equal(broken.downloaded, 0);
  assert.equal(broken.notDownloaded, 1);
  assert.deepEqual(describeSync(broken, 'Google Drive'), {
    title: "Part of the backup didn't finish",
    description: "1 picture couldn't be brought back from Google Drive. The app couldn't connect. Check your internet connection, then try again.",
  });
  assert.equal(store.images.rows.size, 0, 'not kept without the photo it was cut from');

  dropPhoto = false;
  assert.equal((await syncLibrary()).downloaded, 1);
  const row = store.images.rows.get('img_1')!;
  assert.equal(row.sourceMediaId, 'libsrc_img_1');
  assert.equal(row.maskMediaId, 'libmask_img_1');
  assert.deepEqual(row.settings, CUT);
  assert.equal(await store.media.rows.get('libsrc_img_1')!.blob.text(), 'photo img_1');

  await renameLibraryImage('img_1', 'Puppy');
  await syncLibrary();
  assert.deepEqual(drive.names(), ['Puppy (mask).png', 'Puppy (photo).jpg', 'Puppy.png']);
});

test('a picture an earlier build restored without its photo gets the photo back, and a rename leaves it in Drive', async () => {
  const { syncLibrary, describeSync } = await modules;
  let store = storage();
  const drive = fakeDrive();
  await addCutPicture(store, 'img_1', 'Dog', 2);
  await addCutPicture(store, 'img_2', 'Cat', 2);
  await syncLibrary();

  // What that build left on another computer when the photos did not come
  // down: the pictures alone. The dog was opened since, so a copy of the
  // picture stands in as its photo, and it was renamed.
  store = storage();
  for (const id of ['img_1', 'img_2']) await store.media.put(media(`asset_${id}`, `picture ${id}`));
  await store.media.put(media('libsrc_copy', 'picture img_1'));
  await store.images.put({
    id: 'img_1', name: 'Puppy', state: 'ready', mediaId: 'asset_img_1', width: 10, height: 20, sourceMediaId: 'libsrc_copy', sourceWidth: 10, sourceHeight: 20,
    settings: { ...CUT, edge: 0, softness: 0 }, engine: 'model', placed: true, createdAt: 1, updatedAt: 5,
  });
  await store.images.put({ id: 'img_2', name: 'Cat', state: 'ready', mediaId: 'asset_img_2', width: 10, height: 20, engine: 'model', placed: true, createdAt: 1, updatedAt: 2 });

  const result = await syncLibrary();
  assert.equal(describeSync(result, 'Google Drive').title, 'Your pictures are backed up');
  assert.deepEqual(drive.names(), ['Cat (mask).png', 'Cat (photo).jpg', 'Cat.png', 'Puppy (mask).png', 'Puppy (photo).jpg', 'Puppy.png']);
  for (const id of ['img_1', 'img_2']) {
    const row = store.images.rows.get(id)!;
    assert.equal(row.sourceMediaId, `libsrc_${id}`);
    assert.equal(row.maskMediaId, `libmask_${id}`);
    assert.deepEqual(row.settings, CUT);
    assert.equal(await store.media.rows.get(`libsrc_${id}`)!.blob.text(), `photo ${id}`);
  }
  assert.equal(store.images.rows.get('img_1')!.name, 'Puppy', 'the rename stays');
  assert.equal(store.media.rows.has('libsrc_copy'), false, 'the stand-in photo goes');
});

test('a picture whose own file is missing here leaves the account\'s copy where it is', async () => {
  const { syncLibrary, renameLibraryImage } = await modules;
  const store = storage();
  const drive = fakeDrive();
  await addPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  store.media.rows.delete('asset_img_1');
  await renameLibraryImage('img_1', 'Puppy');
  await syncLibrary();
  assert.deepEqual(drive.names(), ['Dog.png']);
  assert.deepEqual(drive.manifest().images.map((image: { id: string }) => image.id), ['img_1']);
});

test('a picture deleted here but changed on another computer since comes back, and stays', async () => {
  const { syncLibrary, deleteLibraryImage, renameLibraryImage } = await modules;
  const here = storage();
  fakeDrive();
  await addPicture(here, 'img_1', 'Dog', 2);
  await syncLibrary();
  const there = storage();
  await syncLibrary();

  here.use();
  await deleteLibraryImage('img_1');
  await new Promise((resolve) => setTimeout(resolve, 5));
  there.use();
  await renameLibraryImage('img_1', 'Puppy');
  await syncLibrary();

  here.use();
  const result = await syncLibrary();
  assert.equal(result.downloaded, 1);
  const row = here.images.rows.get('img_1');
  assert.equal(row?.name, 'Puppy');
  assert.equal(row?.deletedAt, undefined, 'the later change wins over the deletion, and the row is not purged after');
});

test('a newer version from the account replaces the one here, and the files only the old one used go', async () => {
  const { syncLibrary } = await modules;
  const first = storage();
  fakeDrive();
  await addCutPicture(first, 'img_1', 'Dog', 2);
  await syncLibrary();
  const second = storage();
  await syncLibrary();

  // The first computer changes the cut: a new picture and mask over the same photo.
  first.use();
  await first.media.put(media('asset_v2', 'picture v2'));
  await first.media.put(media('libmask_v2', 'mask v2'));
  first.images.rows.set('img_1', { ...first.images.rows.get('img_1')!, mediaId: 'asset_v2', maskMediaId: 'libmask_v2', updatedAt: 9 });
  await syncLibrary();

  second.use();
  assert.equal((await syncLibrary()).downloaded, 1);
  assert.equal(second.images.rows.get('img_1')?.mediaId, 'asset_v2');
  assert.deepEqual([...second.media.rows.keys()].sort(), ['asset_img_1', 'asset_v2', 'libmask_v2', 'libsrc_img_1'], 'the old mask goes; the old picture stays, an artboard may show it');
});

test('a rename Drive refuses is reported, and the next backup renames the file', async () => {
  const { syncLibrary, describeSync, renameLibraryImage } = await modules;
  const store = storage();
  let refuse = false;
  const drive = fakeDrive({ refuse: (method, _url, body) => (refuse && isRename(method, body) ? 403 : undefined) });
  await addPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  await renameLibraryImage('img_1', 'Puppy');

  refuse = true;
  const refused = await syncLibrary();
  assert.deepEqual(describeSync(refused, 'Google Drive'), {
    title: "Part of the backup didn't finish",
    description: "1 picture couldn't be renamed in Google Drive. The next backup tries again.",
  });
  assert.deepEqual(drive.names(), ['Dog.png']);

  refuse = false;
  assert.equal((await syncLibrary()).notRenamedThere, 0);
  assert.deepEqual(drive.names(), ['Puppy.png']);
});

test('a renamed picture and a file named by its id get the picture\'s name in Drive', async () => {
  const { syncLibrary, renameLibraryImage } = await modules;
  const store = storage();
  const drive = fakeDrive();
  await addPicture(store, 'img_1', 'IMG 2033', 2);
  await addPicture(store, 'img_2', 'Logo', 2);
  await syncLibrary();
  assert.deepEqual(drive.names(), ['IMG 2033.png', 'Logo.png']);

  // A file the way the first builds named it: no appProperties, the id as its name.
  const logo = [...drive.files.values()].find((file) => file.name === 'Logo.png')!;
  logo.name = 'image__asset_img_2';
  logo.appProperties = {};
  await renameLibraryImage('img_1', 'Product shot');
  await syncLibrary();
  assert.deepEqual(drive.names(), ['Logo.png', 'Product shot.png']);
  assert.deepEqual([...drive.files.values()].find((file) => file.name === 'Logo.png')?.appProperties, { absMedia: 'asset_img_2' });
  assert.equal(drive.names().length, 2, 'renamed, not sent again');
});

test('a picture whose file is gone from Drive does not stop the others coming back', async () => {
  const { syncLibrary, describeSync } = await modules;
  let store = storage();
  const drive = fakeDrive();
  await addPicture(store, 'img_1', 'Dog', 2);
  await addPicture(store, 'img_2', 'Cat', 3);
  await syncLibrary();
  // Someone deletes one file by hand in Drive; a new computer restores.
  drive.files.forEach((file) => {
    if (file.name === 'Dog.png') file.trashed = true;
  });
  store = storage();
  const result = await syncLibrary();
  assert.equal(result.downloaded, 1);
  assert.equal(result.notDownloaded, 1);
  assert.deepEqual([...store.images.rows.keys()], ['img_2']);
  assert.match(describeSync(result, 'Google Drive').description, /^1 brought back to this computer\. 1 picture couldn't be brought back from Google Drive\. The next backup tries again\.$/);
  assert.deepEqual(drive.manifest().images.map((image: { id: string }) => image.id).sort(), ['img_1', 'img_2'], 'the backup keeps the picture it could not send down');
});

test('the toast says what a sync did, failures included', async () => {
  const { describeSync, OUT_OF_ROOM } = await modules;
  const none = { uploaded: 0, downloaded: 0, notDownloaded: 0, removed: 0, removedThere: 0, notRemovedThere: 0, notRenamedThere: 0, withoutOriginal: 0 };
  assert.deepEqual(describeSync(none, 'Google Drive'), { title: 'Your pictures are backed up', description: 'Google Drive already had all your pictures.' });
  assert.equal(describeSync({ ...none, uploaded: 4 }, 'Google Drive').description, '4 saved to Google Drive.');
  assert.equal(describeSync({ ...none, uploaded: 2, downloaded: 1 }, 'GitHub').description, '2 saved to GitHub, 1 brought back to this computer.');
  assert.equal(describeSync({ ...none, removedThere: 1 }, 'Google Drive').description, '1 deleted from Google Drive.');
  assert.equal(describeSync({ ...none, removed: 1 }, 'Google Drive').description, '1 picture you deleted on another computer is gone from this one too.');
  assert.equal(
    describeSync({ ...none, uploaded: 1, removed: 2, removedThere: 1 }, 'GitHub').description,
    '1 saved to GitHub, 1 deleted from GitHub. 2 pictures you deleted on another computer are gone from this one too.'
  );
  assert.deepEqual(describeSync({ ...none, notDownloaded: 2, notRemovedThere: 1 }, 'GitHub'), {
    title: "Part of the backup didn't finish",
    description: "2 pictures couldn't be brought back from GitHub, and 1 picture couldn't be deleted from GitHub. The next backup tries again.",
  });
  assert.equal(
    describeSync({ ...none, notDownloaded: 1, notRemovedThere: 2, notRenamedThere: 1, problem: OUT_OF_ROOM }, 'Google Drive').description,
    "1 picture couldn't be brought back from Google Drive, 2 pictures couldn't be deleted from Google Drive, and 1 picture couldn't be renamed in Google Drive. This computer is out of room for more pictures. Delete some pictures or projects, then try again."
  );
  assert.deepEqual(describeSync({ ...none, downloaded: 3, withoutOriginal: 2 }, 'Google Drive'), {
    title: 'Your pictures are backed up',
    description: '3 brought back to this computer. 2 pictures came back without their original photos, because Google Drive is missing some of their files.',
  });
});

// --- the third audit (20 Nov 2026) ---------------------------------------------------

test('an edit from a window that shows an older version is refused, and the newer version stays', async () => {
  const { saveLibraryCut } = await modules;
  const store = storage();
  // Another window turned "Cut off empty space" off and saved: asset_2.
  await store.media.put(media('libsrc_1', 'photo', 'image/jpeg'));
  await store.media.put(media('asset_2', 'the whole frame, saved in the other window'));
  await store.media.put(media('libmask_2', 'its mask'));
  await store.images.put({
    id: 'img_1', name: 'Dog', state: 'ready', mediaId: 'asset_2', sourceMediaId: 'libsrc_1', maskMediaId: 'libmask_2',
    settings: { edge: 0, softness: 0, cleanColors: true, trim: false }, createdAt: 1, updatedAt: 3,
  });
  const before = store.images.rows.get('img_1');
  const photo = media('libsrc_1', 'photo', 'image/jpeg');

  // This window opened the picture at asset_1, over the same photo.
  await assert.rejects(saveLibraryCut('img_1', anEdit(photo, 'asset_1')), (error: unknown) => (error as Error).name === 'PictureChangedError');
  assert.deepEqual(store.images.rows.get('img_1'), before, "the other window's edit stays");
  assert.deepEqual([...store.media.rows.keys()].sort(), ['asset_2', 'libmask_2', 'libsrc_1'], 'nothing written');

  // Opened again as it is now, the edit goes in.
  const saved = await saveLibraryCut('img_1', anEdit(photo, 'asset_2'));
  assert.ok(saved?.mediaId && saved.mediaId !== 'asset_2');
});

test('a picture that cannot be kept leaves none of its files behind', async () => {
  const { addPictureFiles, syncLibrary } = await modules;
  // Room for the photo, none for the picture kept beside it.
  let store = storage({ refuseMedia: (row) => (row.id.startsWith('asset_') ? quota() : undefined) });
  await assert.rejects(addPictureFiles([new File(['photo a'], 'a.jpg', { type: 'image/jpeg' })], { cut: false }), /out of room/);
  assert.equal(store.media.rows.size, 0, 'the photo written first went again');
  assert.equal(store.images.rows.size, 0);

  // A restore with room for the picture and the photo, but not the mask.
  store = storage();
  fakeDrive();
  await addCutPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  store = storage({ refuseMedia: (row) => (row.id.startsWith('libmask_') ? quota() : undefined) });
  const result = await syncLibrary();
  assert.equal(result.notDownloaded, 1);
  assert.equal(store.images.rows.size, 0);
  assert.equal(store.media.rows.size, 0, 'the picture and photo written first went again');
});

test('a picture whose mask is missing from Drive comes back without its photo, says so, and leaves the photo in Drive through a rename', async () => {
  const { syncLibrary, describeSync, renameLibraryImage } = await modules;
  let store = storage();
  const drive = fakeDrive();
  await addCutPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  // Someone puts the mask in the Drive trash by hand.
  const mask = [...drive.files.values()].find((file) => file.name === 'Dog (mask).png')!;
  mask.trashed = true;

  store = storage();
  const restored = await syncLibrary();
  assert.equal(restored.downloaded, 1);
  assert.equal(restored.withoutOriginal, 1);
  assert.deepEqual(describeSync(restored, 'Google Drive'), {
    title: 'Your pictures are backed up',
    description: '1 brought back to this computer. 1 picture came back without its original photo, because Google Drive is missing some of its files.',
  });
  assert.equal(store.images.rows.get('img_1')!.sourceMediaId, undefined);

  await renameLibraryImage('img_1', 'Puppy');
  await syncLibrary();
  assert.deepEqual(drive.names(), ['Puppy (photo).jpg', 'Puppy.png'], 'the photo stays, under the new name');
  const entry = drive.manifest().images[0];
  assert.equal(entry.name, 'Puppy');
  assert.equal(entry.sourceMediaId, 'libsrc_img_1', 'the list still names the photo');
  assert.equal(entry.maskMediaId, 'libmask_img_1');

  // Out of the trash, the mask comes down with the photo at the next backup.
  mask.trashed = false;
  await syncLibrary();
  const row = store.images.rows.get('img_1')!;
  assert.equal(row.name, 'Puppy');
  assert.equal(row.sourceMediaId, 'libsrc_img_1');
  assert.equal(row.maskMediaId, 'libmask_img_1');
  assert.deepEqual(row.settings, CUT);
});

test('a restore keeps a change made here while the picture came down', async () => {
  const { syncLibrary, renameLibraryImage, deleteLibraryImage } = await modules;
  for (const change of ['edit', 'delete', 'rename'] as const) {
    const first = storage();
    let during: (() => Promise<void>) | null = null;
    fakeDrive({
      onDownload: async (file) => {
        if (!during || file.content !== 'picture v2') return;
        const run = during;
        during = null;
        await run();
      },
    });
    await addPicture(first, 'img_1', 'Dog', 2);
    await syncLibrary();
    const second = storage();
    await syncLibrary();

    // The first computer saves a second version.
    first.use();
    await first.media.put(media('asset_v2', 'picture v2'));
    first.images.rows.set('img_1', { ...first.images.rows.get('img_1')!, mediaId: 'asset_v2', updatedAt: 9 });
    await syncLibrary();

    // The second one brings it down, and the picture changes here meanwhile.
    second.use();
    during = async () => {
      if (change === 'edit') {
        await second.media.put(media('asset_mine', 'an edit made here'));
        second.images.rows.set('img_1', { ...second.images.rows.get('img_1')!, mediaId: 'asset_mine', updatedAt: Date.now() });
      } else if (change === 'delete') await deleteLibraryImage('img_1');
      else await renameLibraryImage('img_1', 'Puppy');
    };
    const result = await syncLibrary();
    assert.equal(during, null, `${change}: made while the picture came down`);
    const row = second.images.rows.get('img_1')!;
    if (change === 'rename') {
      assert.equal(result.downloaded, 1);
      assert.equal(row.mediaId, 'asset_v2', 'the newer picture came back');
      assert.equal(row.name, 'Puppy', 'and the name given meanwhile stays');
    } else {
      assert.equal(result.downloaded, 0, `${change}: not counted as brought back`);
      assert.equal(second.media.rows.has('asset_v2'), false, `${change}: the version that did not stay goes`);
      if (change === 'edit') assert.equal(row.mediaId, 'asset_mine', 'the edit made here stays');
      else assert.ok(row.deletedAt, 'the deleted picture is not brought back');
    }

    // The next backup sends what changed here.
    await syncLibrary();
    first.use();
    await syncLibrary();
    const there = first.images.rows.get('img_1');
    if (change === 'edit') assert.equal(there?.mediaId, 'asset_mine');
    if (change === 'delete') assert.ok(!there || there.deletedAt, 'deleted on the first computer too');
    if (change === 'rename') assert.deepEqual([there?.name, there?.mediaId], ['Puppy', 'asset_v2']);
  }
});

test('a Drive backup another computer made meanwhile keeps its pictures, in the list and in Drive', async () => {
  const { syncLibrary } = await modules;
  await withoutLocks(async () => {
    const a = storage();
    let meanwhile: (() => Promise<void>) | null = null;
    const drive = fakeDrive({
      hook: async (method, _url, body) => {
        if (!meanwhile || method !== 'POST' || !body.includes('"Fox.png"')) return;
        const run = meanwhile;
        meanwhile = null;
        await run();
      },
    });
    await addPicture(a, 'img_1', 'Dog', 2);
    await syncLibrary();
    const b = storage();
    await syncLibrary();
    await addPicture(b, 'img_2', 'Cat', 3);
    a.use();
    await addPicture(a, 'img_3', 'Fox', 4);

    // While the first computer sends its fox, the second backs up its cat.
    meanwhile = async () => {
      b.use();
      await syncLibrary();
      a.use();
    };
    await syncLibrary();
    assert.equal(meanwhile, null);
    assert.deepEqual(drive.manifest().images.map((image: { id: string }) => image.id).sort(), ['img_1', 'img_2', 'img_3']);
    assert.deepEqual(drive.names(), ['Cat.png', 'Dog.png', 'Fox.png']);

    // The cat comes down to the first computer next time, and stays in Drive.
    const next = await syncLibrary();
    assert.equal(next.downloaded, 1);
    assert.deepEqual(drive.names(), ['Cat.png', 'Dog.png', 'Fox.png']);
  });
});

test('a gist backup another computer made meanwhile keeps its file, and the list names only files the gist has', async () => {
  const { syncLibrary } = await modules;
  await withoutLocks(async () => {
    const a = storage();
    let meanwhile: (() => Promise<void>) | null = null;
    const gist = fakeGist({
      hook: async (method, _url, body) => {
        if (!meanwhile || method !== 'PATCH' || !body.includes('media-asset_img_3.b64')) return;
        const run = meanwhile;
        meanwhile = null;
        await run();
      },
    });
    signInGithub(gist);
    await addPicture(a, 'img_1', 'Dog', 2);
    await syncLibrary();
    const b = storage();
    signInGithub(gist);
    await syncLibrary();
    await addPicture(b, 'img_2', 'Cat', 3);
    a.use();
    await addPicture(a, 'img_3', 'Fox', 4);

    // The second computer backs up while the first sends its fox; the first
    // then reads the gist's files again, the cat's among them.
    meanwhile = async () => {
      b.use();
      await syncLibrary();
      a.use();
    };
    await syncLibrary();
    assert.equal(meanwhile, null);
    assert.deepEqual(gist.mediaIds(), ['asset_img_1', 'asset_img_2', 'asset_img_3'], "the cat's file is still there");
    const listed = gist.manifest().images.map((image: { mediaId: string }) => image.mediaId).sort();
    assert.deepEqual(listed, ['asset_img_1', 'asset_img_2', 'asset_img_3'], 'and listed');
  });
});

test("a file another computer sent meanwhile stays, though its list comes after this backup's", async () => {
  const { syncLibrary } = await modules;
  const store = storage();
  let landed = false;
  const gist = fakeGist({
    hook: (method, _url, body) => {
      // Just before this computer's fox goes up, the other computer's cat
      // lands in the gist. This sync then reads the gist's files again (and
      // finds the cat) and the list (which does not name it yet).
      if (landed || method !== 'PATCH' || !body.includes('media-asset_img_3.b64')) return;
      landed = true;
      gist.put('media-asset_cat.b64', Buffer.from('cat').toString('base64'));
    },
  });
  signInGithub(gist);
  await addPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  const before = gist.manifest();
  await addPicture(store, 'img_3', 'Fox', 4);
  await syncLibrary();
  assert.ok(landed);
  assert.deepEqual(gist.mediaIds(), ['asset_cat', 'asset_img_1', 'asset_img_3'], "the cat's file is not taken out");

  // The other computer's list arrives, made from the list it read before:
  // every file it names is there.
  const cat = { id: 'img_cat', name: 'Cat', mediaId: 'asset_cat', mimeType: 'image/png', width: 10, height: 20, createdAt: 1, updatedAt: 5 };
  gist.put('library.cother.json', JSON.stringify({ formatVersion: 1, device: 'cother', updatedAt: 5, seen: {}, images: [cat, ...before.images], deleted: [] }));
  const files = new Set(gist.mediaIds());
  assert.ok(gist.manifest().images.every((image: { mediaId: string }) => files.has(image.mediaId)));
  // The next backup here takes the cat in, and keeps the fox.
  const next = await syncLibrary();
  assert.equal(next.downloaded, 1);
  assert.deepEqual(gist.manifest().images.map((image: { id: string }) => image.id).sort(), ['img_1', 'img_3', 'img_cat']);
});

test('a gist busy with another computer\'s backup takes this one a moment later', async () => {
  const { syncLibrary } = await modules;
  const store = storage();
  // GitHub answers 409 to a change made while another is under way, as it
  // did to two real backups at once (20 Nov 2026): once to the files, once
  // to the list.
  let filesBusy = 1;
  let listBusy = 1;
  const gist = fakeGist({
    refuse: (method, _url, body) => {
      if (method !== 'PATCH') return undefined;
      if (/"library(\.[a-z0-9]+)?\.json"/.test(body)) return listBusy-- > 0 ? 409 : undefined;
      return filesBusy-- > 0 ? 409 : undefined;
    },
  });
  signInGithub(gist);
  await addPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  await addPicture(store, 'img_2', 'Cat', 3);
  const result = await syncLibrary();
  assert.equal(result.uploaded, 1);
  assert.deepEqual(gist.mediaIds(), ['asset_img_1', 'asset_img_2']);
  assert.deepEqual(gist.manifest().images.map((image: { id: string }) => image.id).sort(), ['img_1', 'img_2']);
});

test('a gist with as many pictures as it holds still takes a changed picture', async () => {
  const { syncLibrary, deleteLibraryImage } = await modules;
  const store = storage();
  const gist = fakeGist();
  signInGithub(gist);
  for (let i = 0; i < 298; i++) await addPicture(store, `img_${i}`, `Picture ${i}`, 2);
  await syncLibrary();
  assert.equal(gist.mediaIds().length, 298);

  // One more does not fit.
  await addPicture(store, 'img_more', 'One too many', 3);
  await assert.rejects(syncLibrary(), /A gist holds 298 pictures/);
  await deleteLibraryImage('img_more');

  // A changed picture swaps its old file for the new one, so it fits.
  await store.media.put(media('asset_v2', 'picture 0, cut again'));
  store.images.rows.set('img_0', { ...store.images.rows.get('img_0')!, mediaId: 'asset_v2', updatedAt: 9 });
  const result = await syncLibrary();
  assert.equal(result.uploaded, 1);
  assert.equal(gist.mediaIds().length, 298);
  assert.ok(gist.mediaIds().includes('asset_v2'));
  assert.ok(!gist.mediaIds().includes('asset_img_0'));
});

// --- two computers backing up at once --------------------------------------------

/** A request that writes a list of the pictures: library.json, or a computer's own. */
const writesList = (method: string, body: string) => method !== 'GET' && /"library(\.[a-z0-9]+)?\.json"/.test(body);

/**
 * Runs `meanwhile` once, before the first list write that comes after a
 * request `after` picks (or after nothing, when left out): another computer
 * backing up at that moment.
 */
function beforeListWrite(meanwhile: () => Promise<void>, after?: (method: string, body: string) => boolean) {
  let armed = false;
  let seenAfter = !after;
  let ran = false;
  return {
    arm: () => {
      armed = true;
    },
    ran: () => ran,
    hook: async (method: string, _url: string, body: string) => {
      if (!armed || ran) return;
      if (!seenAfter) {
        if (after?.(method, body)) seenAfter = true;
        return;
      }
      if (!writesList(method, body)) return;
      ran = true;
      await meanwhile();
    },
  };
}

for (const kind of ['gist', 'Drive'] as const) {
  const account = () => {
    if (kind === 'gist') {
      const gist = fakeGist({ hook: (...args) => hooks.current?.(...args) });
      return { signIn: () => signInGithub(gist), gist, drive: null };
    }
    const drive = fakeDrive({ hook: (...args) => hooks.current?.(...args) });
    return { signIn: () => signIn('1', drive), gist: null, drive };
  };
  const hooks: { current: ((method: string, url: string, body: string) => Promise<void>) | null } = { current: null };

  test(`two computers that both read the lists before either writes keep both their pictures (${kind})`, async () => {
    const { syncLibrary } = await modules;
    await withoutLocks(async () => {
      hooks.current = null;
      const a = storage();
      const { signIn: to } = account();
      to();
      await addPicture(a, 'img_1', 'Dog', 2);
      await syncLibrary();
      const b = storage();
      to();
      await syncLibrary();
      await addPicture(b, 'img_cat', 'Cat', 3);
      a.use();
      await addPicture(a, 'img_fox', 'Fox', 4);

      // The first computer has read the lists and sent its fox. Just before it
      // writes its list, the second backs up its cat from the lists as they
      // were: the fox in none of them, its file already there.
      const other = beforeListWrite(
        async () => {
          b.use();
          await syncLibrary();
          a.use();
        },
        (method, body) => method !== 'GET' && (body.includes('media-asset_img_fox.b64') || body.includes('"name":"Fox.png"'))
      );
      hooks.current = other.hook;
      other.arm();
      await syncLibrary();
      hooks.current = null;
      assert.ok(other.ran(), 'the second computer backed up in between');

      // A third computer gets all three, every file there.
      storage();
      to();
      const third = await syncLibrary();
      assert.equal(third.notDownloaded, 0);
      assert.equal(third.downloaded, 3);
    });
  });

  test(`a picture deleted on one computer and renamed after on another keeps its file, though the first took it out meanwhile (${kind})`, async () => {
    const { syncLibrary, deleteLibraryImage, renameLibraryImage } = await modules;
    await withoutLocks(async () => {
      hooks.current = null;
      const a = storage();
      const { signIn: to } = account();
      to();
      await addPicture(a, 'img_1', 'Dog', 2);
      await addPicture(a, 'img_2', 'Cat', 2);
      await syncLibrary();
      const b = storage();
      to();
      await syncLibrary();

      // The second computer deletes the dog, and the first renames it a moment later.
      await deleteLibraryImage('img_1');
      await new Promise((resolve) => setTimeout(resolve, 5));
      a.use();
      await renameLibraryImage('img_1', 'Puppy');

      // The first backs up; just before its first list write, the second
      // backs up from the lists as they were, and takes the dog's file out.
      const other = beforeListWrite(async () => {
        b.use();
        await syncLibrary();
        a.use();
      });
      hooks.current = other.hook;
      other.arm();
      await syncLibrary();
      hooks.current = null;
      assert.ok(other.ran());

      // The rename is the later change: the picture stays, with its file.
      storage();
      to();
      const third = await syncLibrary();
      assert.equal(third.notDownloaded, 0);
      assert.equal(third.downloaded, 2);
      // And it comes back to the second computer.
      b.use();
      const back = await syncLibrary();
      assert.equal(back.downloaded, 1);
      assert.equal(b.images.rows.get('img_1')?.name, 'Puppy');
      assert.equal(b.images.rows.get('img_1')?.deletedAt, undefined);
    });
  });

  test(`a computer that takes a file out puts it back when a list names it meanwhile (${kind})`, async () => {
    const { syncLibrary, deleteLibraryImage, renameLibraryImage } = await modules;
    await withoutLocks(async () => {
      hooks.current = null;
      const a = storage();
      const { signIn: to } = account();
      to();
      await addPicture(a, 'img_1', 'Dog', 2);
      await addPicture(a, 'img_2', 'Cat', 2);
      await syncLibrary();
      const b = storage();
      to();
      await syncLibrary();
      await deleteLibraryImage('img_1');
      await new Promise((resolve) => setTimeout(resolve, 5));
      a.use();
      await renameLibraryImage('img_1', 'Puppy');

      // The second computer backs up its deletion. As it takes the dog's file
      // out, the first one backs up its rename, start to end: it finds the
      // file still there, and names it in its list.
      let ran = false;
      hooks.current = async (method, _url, body) => {
        const takesOut = isTrash(method, body) || (method === 'PATCH' && body.includes('"media-asset_img_1.b64":null'));
        if (ran || !takesOut) return;
        ran = true;
        a.use();
        await syncLibrary();
        b.use();
      };
      b.use();
      await syncLibrary();
      hooks.current = null;
      assert.ok(ran, 'the first computer backed up in between');

      storage();
      to();
      const third = await syncLibrary();
      assert.equal(third.notDownloaded, 0);
      assert.equal(third.downloaded, 2);
    });
  });
}

test('a file another computer put in the Drive trash comes back out of it, not up again as a second copy', async () => {
  const { syncLibrary, deleteLibraryImage, renameLibraryImage } = await modules;
  await withoutLocks(async () => {
    let hook: ((method: string, url: string, body: string) => Promise<void>) | null = null;
    const a = storage();
    const drive = fakeDrive({ hook: (method, url, body) => hook?.(method, url, body) });
    await addCutPicture(a, 'img_1', 'Dog', 2);
    await addPicture(a, 'img_2', 'Cat', 2);
    await syncLibrary();
    const b = storage();
    await syncLibrary();
    await deleteLibraryImage('img_1');
    await new Promise((resolve) => setTimeout(resolve, 5));
    a.use();
    await renameLibraryImage('img_1', 'Puppy');

    // The second computer backs up its deletion. As it puts the dog's last
    // file in the trash (the picture and the photo are there already), the
    // first computer backs up its rename, start to end.
    const mask = [...drive.files].find(([, file]) => file.appProperties.absMedia === 'libmask_img_1')![0];
    let ran = false;
    hook = async (method, url, body) => {
      if (ran || !isTrash(method, body) || !url.includes(`/files/${mask}?`)) return;
      ran = true;
      a.use();
      await syncLibrary();
      b.use();
    };
    b.use();
    await syncLibrary();
    hook = null;
    assert.ok(ran, 'the first computer backed up in between');

    const copies = new Map<string, number>();
    for (const file of drive.live()) {
      const id = file.appProperties.absMedia;
      if (id) copies.set(id, (copies.get(id) ?? 0) + 1);
    }
    assert.deepEqual([...copies].filter(([, count]) => count > 1), [], 'no picture file twice');
    assert.deepEqual(drive.names(), ['Cat.png', 'Puppy (mask).png', 'Puppy (photo).jpg', 'Puppy.png']);
    storage();
    const third = await syncLibrary();
    assert.equal(third.notDownloaded, 0);
    assert.equal(third.downloaded, 2);
  });
});

test('a rename on a computer missing its own copy of a mask keeps the photo and mask in Drive, and gets the mask back', async () => {
  const { syncLibrary, renameLibraryImage } = await modules;
  const a = storage();
  const drive = fakeDrive();
  await addCutPicture(a, 'img_1', 'Dog', 2);
  await syncLibrary();
  const b = storage();
  assert.equal((await syncLibrary()).downloaded, 1);
  // Its mask's file goes missing on the second computer.
  b.media.rows.delete('libmask_img_1');
  await renameLibraryImage('img_1', 'Puppy');
  await syncLibrary();
  assert.deepEqual(drive.names(), ['Puppy (mask).png', 'Puppy (photo).jpg', 'Puppy.png'], 'nothing went to the trash');
  const entry = drive.manifest().images[0];
  assert.equal(entry.name, 'Puppy');
  assert.equal(entry.sourceMediaId, 'libsrc_img_1');
  assert.equal(entry.maskMediaId, 'libmask_img_1');
  assert.equal(await b.media.rows.get('libmask_img_1')?.blob.text(), 'mask img_1', 'the mask came back here');
});

test('a picture deleted on another computer stays here when it is edited, or is put on an artboard, while the backup runs', async () => {
  const { syncLibrary, deleteLibraryImage, renameLibraryImage } = await modules;
  for (const change of ['edit', 'placement'] as const) {
    let meanwhile: (() => void) | null = null;
    const a = storage();
    const drive = fakeDrive();
    await addPicture(a, 'img_y', 'Cat', 2);
    await addPicture(a, 'img_x', 'Dog', 2);
    await syncLibrary();
    // The second computer has both, the cat first, so a backup reads the
    // cat's file before it gets to the dog.
    const b = storage({
      onMediaGet: (id) => {
        if (id !== 'asset_img_y' || !meanwhile) return;
        const run = meanwhile;
        meanwhile = null;
        run();
      },
    });
    await addPicture(b, 'img_y', 'Cat', 2);
    await addPicture(b, 'img_x', 'Dog', 2);
    await syncLibrary();
    a.use();
    await deleteLibraryImage('img_x');
    await syncLibrary();
    // The edit comes after the deletion. A deletion wins a tie, and a fast run
    // made both in the same millisecond about one time in five.
    await new Promise((resolve) => setTimeout(resolve, 2));

    // While the second computer backs up (it sends the renamed cat), another
    // window there saves an edit of the dog, or puts it on an artboard.
    b.use();
    await renameLibraryImage('img_y', 'Kitten');
    meanwhile = () => {
      if (change === 'edit') {
        b.media.rows.set('asset_x2', media('asset_x2', 'the dog, edited'));
        b.images.rows.set('img_x', { ...b.images.rows.get('img_x')!, mediaId: 'asset_x2', updatedAt: Date.now() });
      } else {
        b.images.rows.set('img_x', { ...b.images.rows.get('img_x')!, placed: true });
      }
    };
    const result = await syncLibrary();
    assert.equal(meanwhile, null, `the ${change} happened during the backup`);
    if (change === 'edit') {
      assert.equal(result.removed, 0, 'the edit is newer than the deletion');
      assert.equal(b.images.rows.get('img_x')?.mediaId, 'asset_x2');
      assert.ok(b.media.rows.has('asset_x2'));
      // It goes up next time, a newer version than the deletion.
      await syncLibrary();
      assert.ok(drive.names().includes('Dog.png'));
    } else {
      assert.equal(result.removed, 1, 'a placement is not a change to the picture: the deletion still comes here');
      assert.equal(b.images.rows.has('img_x'), false);
      assert.ok(b.media.rows.has('asset_img_x'), 'the artboard keeps its picture');
    }
  }
});

// --- the lists -----------------------------------------------------------------------

test('a computer writes only its own list, and library.json becomes the note that stops older builds', async () => {
  const { syncLibrary } = await modules;
  const store = storage();
  const gist = fakeGist();
  signInGithub(gist);
  await addPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  const lists = gist.lists();
  assert.equal(lists.length, 1);
  assert.equal(lists[0].device, store.kept.get('osg.library.computer'), 'the list carries this computer\'s name');
  assert.deepEqual(lists[0].images.map((image: { id: string }) => image.id), ['img_1']);
  // A build from before the lists stops at the note: `images` is not a list.
  assert.equal(gist.legacy().images, null);

  // A library.json an older build wrote pictures into is read as one more list.
  gist.put('media-asset_old.b64', Buffer.from('old').toString('base64'));
  const old = { id: 'img_old', name: 'Old', mediaId: 'asset_old', mimeType: 'image/png', width: 1, height: 1, createdAt: 1, updatedAt: 3 };
  gist.put('library.json', JSON.stringify({ formatVersion: 1, updatedAt: 5, images: [old], deleted: [] }));
  const result = await syncLibrary();
  assert.equal(result.downloaded, 1);
  assert.equal(gist.legacy().images, null, 'the note again, its picture in this computer\'s list');
  assert.deepEqual(gist.manifest().images.map((image: { id: string }) => image.id).sort(), ['img_1', 'img_old']);
  assert.deepEqual(gist.mediaIds(), ['asset_img_1', 'asset_old']);
});

test('a backup from a newer version of the app is left alone, with words', async () => {
  const { syncLibrary } = await modules;
  const store = storage();
  const gist = fakeGist();
  signInGithub(gist);
  await addPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  gist.put('library.json', JSON.stringify({ formatVersion: 3 }));
  await assert.rejects(syncLibrary(), /backed up by a newer version of Open Screenshot Generator/);
});

test('a list that cannot be read stops nothing but taking files out, until it can', async () => {
  const { syncLibrary } = await modules;
  const store = storage();
  const gist = fakeGist();
  signInGithub(gist);
  await addPicture(store, 'img_1', 'Dog', 2);
  await syncLibrary();
  gist.put('library.cbroken.json', '{ not a list');
  // A new version of the dog: its old file is one nothing names, but the
  // unreadable list may.
  await store.media.put(media('asset_v2', 'the dog again'));
  store.images.rows.set('img_1', { ...store.images.rows.get('img_1')!, mediaId: 'asset_v2', updatedAt: 9 });
  await addPicture(store, 'img_2', 'Cat', 9);
  const blind = await syncLibrary();
  assert.equal(blind.uploaded, 2, 'the backup itself goes on');
  assert.deepEqual(gist.mediaIds(), ['asset_img_1', 'asset_img_2', 'asset_v2'], 'the old file stays');

  gist.remove('library.cbroken.json');
  await syncLibrary();
  assert.deepEqual(gist.mediaIds(), ['asset_img_2', 'asset_v2']);
});

test('a gist lets go of lists no computer has written for as long as a deletion is remembered', async () => {
  const { syncLibrary } = await modules;
  const a = storage();
  const gist = fakeGist();
  signInGithub(gist);
  await addPicture(a, 'img_1', 'Dog', 2);
  await syncLibrary();
  const b = storage();
  signInGithub(gist);
  await syncLibrary();
  assert.equal(gist.lists().length, 2);

  // The first computer's list is four months old, and the second's took it in.
  const first = a.kept.get('osg.library.computer')!;
  const old = gist.lists().find((list: { device: string }) => list.device === first);
  const aged = Date.now() - 121 * 24 * 60 * 60 * 1000;
  gist.put(`library.${first}.json`, JSON.stringify({ ...old, updatedAt: aged }));
  const second = b.kept.get('osg.library.computer')!;
  const seen = gist.lists().find((list: { device: string }) => list.device === second);
  gist.put(`library.${second}.json`, JSON.stringify({ ...seen, seen: { [first]: aged } }));
  await syncLibrary();
  assert.deepEqual(gist.lists().map((list: { device: string }) => list.device), [second]);
  assert.deepEqual(gist.manifest().images.map((image: { id: string }) => image.id), ['img_1'], 'its pictures are in the list that took it in');
});

test('the lists merge picture by picture, leave out the ones another took in, and keep what a backup under way is sending', async () => {
  const { mergeLists, currentLists, namedFiles } = await modules;
  const image = (id: string, updatedAt: number) => ({ id, name: id, mediaId: `asset_${id}_${updatedAt}`, mimeType: 'image/png', width: 1, height: 1, createdAt: 1, updatedAt });
  const list = (device: string, updatedAt: number, rest: Record<string, unknown> = {}) => ({ formatVersion: 1 as const, device, updatedAt, seen: {}, images: [], deleted: [], ...rest });
  const ours = list('ca', 100, { images: [image('a', 5), image('b', 9), image('c', 3)], deleted: [{ id: 'x', at: 50 }] });
  const theirs = list('cb', 200, { images: [image('a', 7), image('b', 4), image('d', 2), image('x', 40)], deleted: [{ id: 'c', at: 6 }, { id: 'old', at: 1 }] });
  const merged = mergeLists([ours, theirs], 2);
  assert.deepEqual(merged.images.map((entry) => [entry.id, entry.updatedAt]).sort(), [['a', 7], ['b', 9], ['d', 2]]);
  assert.deepEqual(merged.deleted.map((entry) => entry.id).sort(), ['c', 'x'], 'a deletion older than the cutoff is forgotten');

  // A list another one took in is left out: its picture, deleted since and
  // the deletion forgotten, does not come back.
  const stale = list('cc', 10, { images: [image('gone', 1)] });
  const later = list('cd', 300, { seen: { cc: 10 } });
  assert.deepEqual(currentLists([stale, later]).map((entry) => entry.device), ['cd']);
  assert.deepEqual(mergeLists([stale, later], 0).images, []);
  // Written again since, it counts again.
  assert.deepEqual(currentLists([{ ...stale, updatedAt: 11 }, later]).map((entry) => entry.device).sort(), ['cc', 'cd']);
  // Each computer's latest list only.
  assert.deepEqual(mergeLists([list('ca', 1, { images: [image('a', 1)] }), list('ca', 2)], 0).images, []);
  // Two copies changed at the same moment: every computer picks the same one.
  const tie = (first: string, second: string) =>
    mergeLists([list('ca', 1, { images: [{ ...image('t', 5), mediaId: first }] }), list('cb', 1, { images: [{ ...image('t', 5), mediaId: second }] })], 0).images[0].mediaId;
  assert.equal(tie('asset_1', 'asset_2'), tie('asset_2', 'asset_1'));

  // Files a backup under way is sending stay wanted, even from a list
  // another took in, until they are SENDING_DAYS old.
  const now = Date.now();
  const sending = list('ce', 50, { sending: ['asset_new'], sendingAt: now - 1000 });
  const reader = list('cf', 400, { seen: { ce: 50 } });
  assert.ok(namedFiles([sending, reader], 0, now).has('asset_new'));
  assert.ok(!namedFiles([{ ...sending, sendingAt: now - 8 * 24 * 60 * 60 * 1000 }, reader], 0, now).has('asset_new'));
});
