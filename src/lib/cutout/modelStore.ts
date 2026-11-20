// Where a downloaded model is kept: an IndexedDB database of its own, in 8 MB
// pieces, so it works offline from then on.
//
// Pieces rather than one value because of memory. The Mac app's web view was
// killed at about 500 MB before (issue #19), and one 120 MB download held in a
// buffer, copied into a Blob for storage and copied again for the runtime is
// most of that. Pieces are written and hashed as they arrive, and read back
// into the one buffer the runtime gets.
//
// Raw IndexedDB rather than Dexie: the worker reads and writes it too, and the
// worker bundle stays small. Pieces are ArrayBuffers, never Blobs, because
// Playwright's WebKit cannot store a Blob in IndexedDB (tests/e2e/README.md).

import { Sha256 } from './sha256';
import type { CutoutModelId, CutoutModelSpec } from './models';

const DB_NAME = 'OpenScreenshotGeneratorModels';
const DB_VERSION = 1;
export const PIECE_BYTES = 8 * 1024 * 1024;

interface ModelRow {
  id: CutoutModelId;
  bytes: number;
  sha256: string;
  /** Pieces written so far, in order. */
  pieces: number;
  complete: boolean;
  savedAt: number;
}

interface PieceRow {
  key: string;
  data: ArrayBuffer;
}

const pieceKey = (id: string, index: number) => `${id}:${String(index).padStart(5, '0')}`;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB refused the request'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB refused the change'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB dropped the change'));
  });
}

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pieces')) db.createObjectStore('pieces', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer page asking for a newer schema: let go rather than block it.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error('This browser has no IndexedDB, so the model cannot be kept'));
    };
  });
  return opening;
}

async function readRow(id: CutoutModelId): Promise<ModelRow | undefined> {
  const db = await openDb();
  return request(db.transaction('models').objectStore('models').get(id) as IDBRequest<ModelRow | undefined>);
}

async function writeRow(row: ModelRow): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('models', 'readwrite');
  tx.objectStore('models').put(row);
  await done(tx);
}

async function writePiece(id: CutoutModelId, index: number, data: ArrayBuffer, row: ModelRow): Promise<void> {
  const db = await openDb();
  // One transaction for the piece and the count, so a crash between them
  // cannot leave a count that names a piece that is not there.
  const tx = db.transaction(['pieces', 'models'], 'readwrite');
  tx.objectStore('pieces').put({ key: pieceKey(id, index), data } satisfies PieceRow);
  tx.objectStore('models').put(row);
  await done(tx);
}

async function readPiece(id: CutoutModelId, index: number): Promise<ArrayBuffer | null> {
  const db = await openDb();
  const row = await request(db.transaction('pieces').objectStore('pieces').get(pieceKey(id, index)) as IDBRequest<PieceRow | undefined>);
  return row?.data ?? null;
}

/** True when the whole model is on this device and passed its check. */
export async function hasModel(spec: CutoutModelSpec): Promise<boolean> {
  try {
    const row = await readRow(spec.id);
    return !!row?.complete && row.sha256 === spec.sha256 && row.bytes === spec.bytes;
  } catch {
    return false;
  }
}

/** The models kept on this device, for the size shown beside Remove. */
export async function storedModels(): Promise<Array<{ id: CutoutModelId; bytes: number; complete: boolean }>> {
  try {
    const db = await openDb();
    const rows = await request(db.transaction('models').objectStore('models').getAll() as IDBRequest<ModelRow[]>);
    return rows.map((row) => ({ id: row.id, bytes: row.complete ? row.bytes : row.pieces * PIECE_BYTES, complete: row.complete }));
  } catch {
    return [];
  }
}

export async function deleteModel(id: CutoutModelId): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['pieces', 'models'], 'readwrite');
  tx.objectStore('pieces').delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`));
  tx.objectStore('models').delete(id);
  await done(tx);
}

/** The whole model in one buffer, read from its pieces. */
export async function readModel(spec: CutoutModelSpec): Promise<Uint8Array> {
  const row = await readRow(spec.id);
  if (!row?.complete) throw new Error("The download isn't finished yet");
  const out = new Uint8Array(row.bytes);
  let offset = 0;
  for (let index = 0; index < row.pieces; index++) {
    const piece = await readPiece(spec.id, index);
    if (!piece) throw new Error('Part of the download is missing. Download it again');
    out.set(new Uint8Array(piece), offset);
    offset += piece.byteLength;
  }
  if (offset !== row.bytes) throw new Error('Part of the download is missing. Download it again');
  return out;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

export class DownloadStoppedError extends Error {
  constructor() {
    super('The download was stopped');
    this.name = 'DownloadStoppedError';
  }
}

/**
 * Downloads the model into this database, piece by piece, checking it against
 * its SHA-256 on the way. A download cut off part way carries on from the last
 * whole piece next time when the server answers a range request, and starts
 * over when it does not.
 */
export async function downloadModel(
  spec: CutoutModelSpec,
  options: { onProgress?: (progress: DownloadProgress) => void; signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  if (await hasModel(spec)) return;
  let row = await readRow(spec.id);
  if (row && (row.complete || row.sha256 !== spec.sha256 || row.bytes !== spec.bytes)) {
    await deleteModel(spec.id);
    row = undefined;
  }
  let lastError: unknown = null;
  for (const url of spec.urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (options.signal?.aborted) throw new DownloadStoppedError();
      try {
        await downloadFrom(url, spec, row, doFetch, options);
        return;
      } catch (error) {
        if (error instanceof DownloadStoppedError || options.signal?.aborted) throw new DownloadStoppedError();
        lastError = error;
        row = await readRow(spec.id).catch(() => undefined);
        // A failed check means the pieces are wrong, not short: start over.
        if (error instanceof ChecksumError) {
          await deleteModel(spec.id).catch(() => undefined);
          row = undefined;
        }
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The download didn't work. Check your internet and try again");
}

class ChecksumError extends Error {
  constructor() {
    super('The download came through damaged. Try again');
    this.name = 'ChecksumError';
  }
}

async function downloadFrom(
  url: string,
  spec: CutoutModelSpec,
  resumeFrom: ModelRow | undefined,
  doFetch: typeof fetch,
  options: { onProgress?: (progress: DownloadProgress) => void; signal?: AbortSignal }
): Promise<void> {
  const hash = new Sha256();
  let pieces = 0;
  let received = 0;
  // Pieces already here are hashed again, since the hash cannot be stored.
  if (resumeFrom && resumeFrom.pieces > 0) {
    for (let index = 0; index < resumeFrom.pieces; index++) {
      const piece = await readPiece(spec.id, index);
      if (!piece || piece.byteLength !== PIECE_BYTES) break;
      hash.update(new Uint8Array(piece));
      pieces++;
      received += piece.byteLength;
    }
  }
  const headers: Record<string, string> = {};
  if (received > 0) headers.Range = `bytes=${received}-`;
  let response: Response;
  try {
    response = await doFetch(url, { signal: options.signal, cache: 'no-store', headers });
  } catch (error) {
    if (received > 0) {
      // A range request the browser or the server would not make: start over.
      return downloadFrom(url, spec, undefined, doFetch, options);
    }
    throw error;
  }
  if (received > 0 && response.status !== 206) {
    response.body?.cancel().catch(() => undefined);
    await deleteModel(spec.id);
    return downloadFrom(url, spec, undefined, doFetch, options);
  }
  if (!response.ok || !response.body) {
    throw new Error("The download didn't work. Try again later");
  }
  const row: ModelRow = { id: spec.id, bytes: spec.bytes, sha256: spec.sha256, pieces, complete: false, savedAt: Date.now() };
  if (pieces === 0) await writeRow(row);
  const reader = response.body.getReader();
  let buffer = new Uint8Array(PIECE_BYTES);
  let filled = 0;
  options.onProgress?.({ received, total: spec.bytes });
  const flush = async () => {
    if (filled === 0) return;
    const piece = buffer.slice(0, filled).buffer;
    hash.update(new Uint8Array(piece));
    row.pieces += 1;
    await writePiece(spec.id, row.pieces - 1, piece, row);
    buffer = new Uint8Array(PIECE_BYTES);
    filled = 0;
  };
  try {
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      if (options.signal?.aborted) throw new DownloadStoppedError();
      let offset = 0;
      while (offset < value.length) {
        const take = Math.min(PIECE_BYTES - filled, value.length - offset);
        buffer.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === PIECE_BYTES) await flush();
      }
      received += value.length;
      if (received > spec.bytes) throw new ChecksumError();
      options.onProgress?.({ received, total: spec.bytes });
    }
    await flush();
  } catch (error) {
    reader.cancel().catch(() => undefined);
    throw error;
  }
  if (received !== spec.bytes || hash.hex() !== spec.sha256) throw new ChecksumError();
  await writeRow({ ...row, complete: true, savedAt: Date.now() });
}
