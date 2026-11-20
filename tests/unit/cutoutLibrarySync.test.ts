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

/** A Dexie table's few calls the library makes, over a Map. */
function table<T extends { id: string }>(refusePut?: (row: T) => Error | undefined) {
  const rows = new Map<string, T>();
  return {
    rows,
    async get(id: string) { const row = rows.get(id); return row && { ...row }; },
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
function storage(options: { refuseMedia?: (row: Media) => Error | undefined } = {}) {
  const media = table<Media>(options.refuseMedia);
  const images = table<LibraryImageRow>();
  const libraryDb = { images, transaction: async (_mode: string, _table: unknown, job: () => Promise<unknown>) => job() };
  (globalThis as any).__libraryTest = { db: { media }, libraryDb, session: GOOGLE };
  const use = () => {
    (globalThis as any).__libraryTest = { db: { media }, libraryDb, session: (globalThis as any).__libraryTest.session };
  };
  return { media, images, use };
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

const anEdit = (photo: Media) => ({
  mask: blob('the new mask'),
  picture: blob('a smaller picture'),
  width: 5,
  height: 6,
  thumb: new ArrayBuffer(1),
  settings: { edge: 0, softness: 0, cleanColors: true, trim: true },
  rect: { x: 1, y: 1, width: 5, height: 6 },
  photo,
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
function fakeDrive(options: { refuse?: (method: string, url: string, body: string) => number | undefined; breakBody?: (file: DriveFile) => boolean } = {}) {
  const files = new Map<string, DriveFile>();
  let next = 1;
  let folder: string | null = null;
  const sent: Array<{ method: string; url: string; body: string }> = [];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body instanceof Blob ? await init.body.text() : typeof init.body === 'string' ? init.body : '';
    sent.push({ method, url, body });
    const refused = options.refuse?.(method, url, body);
    if (refused) return json({ error: { message: 'Drive said no' } }, refused);
    const query = new URL(url).searchParams.get('q') ?? '';
    if (method === 'GET' && query.includes('absLibrary')) return json({ files: folder ? [{ id: folder }] : [] });
    if (method === 'GET' && query.includes('in parents')) {
      return json({ files: [...files].filter(([, file]) => !file.trashed).map(([id, file]) => ({ id, name: file.name, appProperties: file.appProperties })) });
    }
    const media = url.match(/\/files\/([^/?]+)\?alt=media/);
    if (media) {
      const file = files.get(media[1]);
      if (!file) return json({ error: { message: 'File not found' } }, 404);
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
    names: () => [...files.values()].filter((file) => !file.trashed).map((file) => file.name).sort(),
    manifest: () => JSON.parse([...files.values()].find((file) => file.name === 'library.json')!.content),
  };
}

/** Signs in to the Google account `id`, whose Drive is `drive`. */
function signIn(id: string, drive: ReturnType<typeof fakeDrive>) {
  drive.use();
  (globalThis as any).__libraryTest.session = { ...GOOGLE, account: { id, name: `Account ${id}` } };
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
  assert.equal(drive.live().filter((file) => file.name !== 'library.json').length, 2);

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
  assert.deepEqual(second.names(), ['Cat.png', 'library.json']);
  assert.ok(store.images.rows.get('img_1')?.deletedAt, 'not brought back');
  assert.deepEqual(store.images.rows.get('img_1')?.leftThere, { 'google:1': ['asset_img_1'] }, 'the first account still has its file');

  // Nothing of it is left in this account, so nothing is said of it here.
  assert.equal(describeSync(await syncLibrary(), 'Google Drive').description, 'Google Drive already had all your pictures.');

  signIn('1', first);
  refuseFirst = false;
  const back = await syncLibrary();
  assert.equal(back.removedThere, 1);
  assert.deepEqual(first.names(), ['Cat.png', 'library.json']);
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
  assert.deepEqual(second.names(), ['library.json']);

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
  assert.deepEqual(drive.names(), ['Dog (mask).png', 'Dog (photo).jpg', 'Dog.png', 'library.json']);

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
  assert.deepEqual(drive.names(), ['Puppy (mask).png', 'Puppy (photo).jpg', 'Puppy.png', 'library.json']);
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
  assert.deepEqual(drive.names(), ['Cat (mask).png', 'Cat (photo).jpg', 'Cat.png', 'Puppy (mask).png', 'Puppy (photo).jpg', 'Puppy.png', 'library.json']);
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
  assert.deepEqual(drive.names(), ['Dog.png', 'library.json']);
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
  assert.deepEqual(drive.names(), ['Dog.png', 'library.json']);

  refuse = false;
  assert.equal((await syncLibrary()).notRenamedThere, 0);
  assert.deepEqual(drive.names(), ['Puppy.png', 'library.json']);
});

test('a renamed picture and a file named by its id get the picture\'s name in Drive', async () => {
  const { syncLibrary, renameLibraryImage } = await modules;
  const store = storage();
  const drive = fakeDrive();
  await addPicture(store, 'img_1', 'IMG 2033', 2);
  await addPicture(store, 'img_2', 'Logo', 2);
  await syncLibrary();
  assert.deepEqual(drive.live().map((file) => file.name).sort(), ['IMG 2033.png', 'Logo.png', 'library.json']);

  // A file the way the first builds named it: no appProperties, the id as its name.
  const logo = [...drive.files.values()].find((file) => file.name === 'Logo.png')!;
  logo.name = 'image__asset_img_2';
  logo.appProperties = {};
  await renameLibraryImage('img_1', 'Product shot');
  await syncLibrary();
  const names = drive.live().map((file) => file.name).sort();
  assert.deepEqual(names, ['Logo.png', 'Product shot.png', 'library.json']);
  assert.deepEqual([...drive.files.values()].find((file) => file.name === 'Logo.png')?.appProperties, { absMedia: 'asset_img_2' });
  assert.equal(drive.live().length, 3, 'renamed, not sent again');
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
  const none = { uploaded: 0, downloaded: 0, notDownloaded: 0, removed: 0, removedThere: 0, notRemovedThere: 0, notRenamedThere: 0 };
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
});
