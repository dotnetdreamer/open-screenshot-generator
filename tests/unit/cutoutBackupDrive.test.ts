// The pictures' backup in Google Drive, one call at a time: files named after
// the picture with the media id in appProperties, renamed when the picture is,
// removed ones in the trash, and the removals and renames Drive refused
// reported back; and why adding a picture failed. cutoutLibrarySync.test.ts
// runs whole syncs.

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { googleDriveLibrary } from '@/lib/account/providers/googleDrive';
import { AccountAuthError, type AccountSession } from '@/lib/account/types';
import { notKeptMessage } from '@/lib/cutout/add';

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
  else Reflect.deleteProperty(globalThis, 'window');
});

const session = {
  provider: 'google',
  accessToken: 'test-token',
  account: { id: '1', name: 'Test' },
  expiresAt: Date.now() + 3_600_000,
} as AccountSession;

interface Sent {
  method: string;
  url: string;
  body: string;
}

/** A Drive that answers with `answer` and keeps every request it was sent. */
function fakeDrive(answer: (request: Sent) => unknown): Sent[] {
  const sent: Sent[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      fetch: async (url: string, init: RequestInit = {}) => {
        const body = init.body instanceof Blob ? await init.body.text() : typeof init.body === 'string' ? init.body : '';
        const request = { method: init.method ?? 'GET', url, body };
        sent.push(request);
        const value = answer(request);
        return value instanceof Response ? value : new Response(JSON.stringify(value ?? {}), { status: 200 });
      },
    },
  });
  return sent;
}

/** The JSON metadata part of a multipart upload. */
function metadataOf(body: string): { name: string; appProperties?: Record<string, string> } {
  const start = body.indexOf('{');
  return JSON.parse(body.slice(start, body.indexOf('\r\n', start)));
}

test('a picture goes to Drive under its own name, with its media id kept out of sight', async () => {
  const sent = fakeDrive((request) => ({ id: `file-${request.body.length}` }));
  const state = { manifest: null, mediaIds: new Set<string>(), handle: 'folder-1', files: new Map<string, unknown>() };
  const next = await googleDriveLibrary.upload(session, state, [
    { mediaId: 'asset_1', blob: new Blob(['a'], { type: 'image/png' }), mimeType: 'image/png', name: 'Dog: on grass?' },
    { mediaId: 'libsrc_1', blob: new Blob(['b'], { type: 'image/jpeg' }), mimeType: 'image/jpeg', name: 'Dog: on grass? (photo)' },
    { mediaId: 'libmask_1', blob: new Blob(['c'], { type: 'image/png' }), mimeType: 'image/png' },
  ]);
  const uploads = sent.filter((request) => request.url.includes('/upload/'));
  assert.equal(uploads.length, 3);
  assert.deepEqual(uploads.map((request) => metadataOf(request.body).name), ['Dog on grass.png', 'Dog on grass (photo).jpg', 'libmask_1.png']);
  assert.deepEqual(uploads.map((request) => metadataOf(request.body).appProperties), [
    { absMedia: 'asset_1' },
    { absMedia: 'libsrc_1' },
    { absMedia: 'libmask_1' },
  ]);
  assert.deepEqual([...next.mediaIds].sort(), ['asset_1', 'libmask_1', 'libsrc_1']);
});

test('reading the folder finds pictures by their appProperties and by the older id names', async () => {
  const manifest = { formatVersion: 1, updatedAt: 1, images: [], deleted: [] };
  fakeDrive((request) => {
    if (request.url.includes('alt=media')) return new Response(JSON.stringify(manifest));
    if (request.url.includes('absLibrary')) return { files: [{ id: 'folder-1' }] };
    return {
      files: [
        { id: 'f1', name: 'Dog.png', appProperties: { absMedia: 'asset_new' } },
        { id: 'f2', name: 'image__asset_old', appProperties: {} },
        { id: 'f3', name: 'library.json' },
        { id: 'f4', name: 'notes.txt' },
      ],
    };
  });
  const state = await googleDriveLibrary.read(session);
  assert.deepEqual([...state.mediaIds].sort(), ['asset_new', 'asset_old']);
  assert.deepEqual(state.files.get('asset_new'), { fileId: 'f1', name: 'Dog.png', tagged: true });
  assert.deepEqual(state.files.get('asset_old'), { fileId: 'f2', name: 'image__asset_old', tagged: false });
  assert.deepEqual(state.files.get('library.json'), { fileId: 'f3', name: 'library.json', tagged: false });
  assert.deepEqual(state.manifest, manifest);
});

const folderWith = (files: Array<[string, string, string, boolean]>) => ({
  manifest: null,
  mediaIds: new Set(files.map(([mediaId]) => mediaId)),
  handle: 'folder-1',
  files: new Map<string, unknown>(files.map(([mediaId, fileId, name, tagged]) => [mediaId, { fileId, name, tagged }])),
});

test('a picture taken out of the backup goes to the Drive trash, not away for good', async () => {
  const sent = fakeDrive(() => ({ id: 'x' }));
  const left = await googleDriveLibrary.remove(session, folderWith([['asset_1', 'file-9', 'Dog.png', true]]), ['asset_1', 'asset_not_there']);
  assert.deepEqual(left, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'PATCH');
  assert.match(sent[0].url, /\/files\/file-9\?/);
  assert.deepEqual(JSON.parse(sent[0].body), { trashed: true });
});

test('a file Drive refuses to trash is reported back, one already gone is not', async () => {
  fakeDrive((request) => {
    const status = request.url.includes('file-1') ? 403 : request.url.includes('file-2') ? 404 : 200;
    return new Response(JSON.stringify(status === 200 ? { id: 'x' } : { error: { message: 'No' } }), { status });
  });
  const state = folderWith([['asset_1', 'file-1', 'Dog.png', true], ['asset_2', 'file-2', 'Cat.png', true], ['asset_3', 'file-3', 'Mug.png', true]]);
  assert.deepEqual(await googleDriveLibrary.remove(session, state, ['asset_1', 'asset_2', 'asset_3']), ['asset_1']);

  fakeDrive(() => new Response(JSON.stringify({ error: { message: 'Invalid Credentials' } }), { status: 401 }));
  await assert.rejects(googleDriveLibrary.remove(session, state, ['asset_3']), AccountAuthError, 'a lapsed sign-in still stops the sync');
});

test('a file is renamed only when its name or its appProperties are out of date', async () => {
  const sent = fakeDrive(() => ({ id: 'x' }));
  const state = folderWith([
    ['asset_1', 'file-1', 'Dog.png', true],
    ['asset_2', 'file-2', 'Old name.png', true],
    ['asset_3', 'file-3', 'image__asset_3', false],
  ]);
  const { state: next, left } = await googleDriveLibrary.rename!(session, state, [
    { mediaId: 'asset_1', mimeType: 'image/png', name: 'Dog' },
    { mediaId: 'asset_2', mimeType: 'image/png', name: 'New name' },
    { mediaId: 'asset_3', mimeType: 'image/jpeg', name: 'Cat (photo)' },
    { mediaId: 'asset_not_there', mimeType: 'image/png', name: 'Gone' },
  ]);
  assert.deepEqual(sent.map((request) => [request.method, request.url.match(/files\/([^?]+)/)?.[1], JSON.parse(request.body)]), [
    ['PATCH', 'file-2', { name: 'New name.png', appProperties: { absMedia: 'asset_2' } }],
    ['PATCH', 'file-3', { name: 'Cat (photo).jpg', appProperties: { absMedia: 'asset_3' } }],
  ]);
  assert.deepEqual(next.files.get('asset_3'), { fileId: 'file-3', name: 'Cat (photo).jpg', tagged: true });
  assert.deepEqual(left, []);
});

test('a rename Drive refuses is reported back and keeps the old name', async () => {
  fakeDrive((request) => (request.url.includes('file-2') ? new Response(JSON.stringify({ error: { message: 'No' } }), { status: 403 }) : { id: 'x' }));
  const state = folderWith([['asset_1', 'file-1', 'Old.png', true], ['asset_2', 'file-2', 'Old too.png', true]]);
  const { state: next, left } = await googleDriveLibrary.rename!(session, state, [
    { mediaId: 'asset_1', mimeType: 'image/png', name: 'New' },
    { mediaId: 'asset_2', mimeType: 'image/png', name: 'New too' },
  ]);
  assert.deepEqual(left, ['asset_2']);
  assert.equal((next.files.get('asset_1') as { name: string }).name, 'New.png');
  assert.equal((next.files.get('asset_2') as { name: string }).name, 'Old too.png');

  fakeDrive(() => new Response(JSON.stringify({ error: { message: 'Invalid Credentials' } }), { status: 401 }));
  await assert.rejects(googleDriveLibrary.rename!(session, state, [{ mediaId: 'asset_1', mimeType: 'image/png', name: 'New' }]), AccountAuthError);
});

test('a picture the storage would not keep is not blamed on the file', () => {
  const quota = Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
  assert.match(notKeptMessage(quota), /out of room/);
  const wrapped = Object.assign(new Error('Dexie'), { name: 'DexieError', inner: { name: 'QuotaExceededError' } });
  assert.match(notKeptMessage(wrapped), /out of room/);
  const privateWindow = Object.assign(new Error('Error preparing Blob/File data to be stored in object store'), { name: 'UnknownError' });
  const message = notKeptMessage(privateWindow);
  assert.match(message, /private window/);
  assert.doesNotMatch(message, /isn't a photo/);
});
