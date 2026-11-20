/**
 * Where Limelight keeps its scenes and their pictures on this device: a
 * Dexie database of its own (`OpenScreenshotGeneratorLimelight`), so adding
 * it never moves the projects database to a new version, which would lock
 * older builds out of their projects (see src/lib/cutout/libraryDb.ts).
 *
 * A scene row holds the scene as plain data and a small picture of its first
 * frame for the list. Pictures are rows of their own, shared by every scene
 * that shows them, and kept as ArrayBuffers: Playwright's WebKit cannot put a
 * Blob in IndexedDB (rule 63). Deleting a scene deletes the pictures nothing
 * else shows: no other scene, no template, and no undo step. A scene row
 * keeps the pictures its undo steps show (`held`), and the open view says
 * what its steps show right now (`holdPictures`), so an undo never brings
 * back a phone whose picture went with another scene.
 */

import Dexie, { type Table } from 'dexie';
import { newId, normalizeScene, sceneMediaIds } from './scene';
import type { LimelightMedia, LimelightScene, ScreenOrigin } from './types';

export interface StoredScene {
  id: string;
  name: string;
  updatedAt: number;
  scene: LimelightScene;
  /** A small JPEG of the first frame, for the list. */
  thumb?: ArrayBuffer;
  thumbType?: string;
  /** Pictures the scene's undo and redo steps show and the scene itself doesn't, as of its last save. */
  held?: string[];
}

export interface SceneSummary {
  id: string;
  name: string;
  updatedAt: number;
  duration: number;
  width: number;
  height: number;
  devices: number;
  thumb?: ArrayBuffer;
  thumbType?: string;
}

interface MetaRow {
  key: string;
  value: unknown;
}

/** A scene the user kept to start other scenes from. Its pictures stay in the media table. */
export interface MyTemplate {
  id: string;
  name: string;
  createdAt: number;
  scene: LimelightScene;
  thumb?: ArrayBuffer;
  thumbType?: string;
}

class LimelightDatabase extends Dexie {
  scenes!: Table<StoredScene, string>;
  media!: Table<LimelightMedia, string>;
  meta!: Table<MetaRow, string>;
  templates!: Table<MyTemplate, string>;

  constructor() {
    super('OpenScreenshotGeneratorLimelight');
    this.version(1).stores({ scenes: 'id, updatedAt', media: 'id, createdAt', meta: 'key' });
    // The user's own templates. A later version lists only what it adds.
    this.version(2).stores({ templates: 'id, createdAt' });
  }
}

let instance: LimelightDatabase | null = null;

function db(): LimelightDatabase {
  if (!instance) {
    instance = new LimelightDatabase();
    // Another window upgrading the database: let go so it can.
    instance.on('versionchange', () => {
      instance?.close();
      instance = null;
      return false;
    });
  }
  return instance;
}

/** The largest picture a screen takes, in bytes. */
export const MAX_PICTURE_BYTES = 40 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

export async function listScenes(): Promise<SceneSummary[]> {
  const rows = await db().scenes.orderBy('updatedAt').reverse().toArray();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    duration: row.scene.format?.duration ?? 0,
    width: row.scene.format?.width ?? 0,
    height: row.scene.format?.height ?? 0,
    devices: Array.isArray(row.scene.actors) ? row.scene.actors.filter((actor) => actor?.kind === 'device').length : 0,
    thumb: row.thumb,
    thumbType: row.thumbType,
  }));
}

export async function getScene(id: string): Promise<LimelightScene | null> {
  const row = await db().scenes.get(id);
  return row ? normalizeScene(row.scene) : null;
}

/**
 * Writes a scene, keeping its list picture. `held` is what its undo steps
 * show; left out, the row keeps the list it had.
 */
export async function putScene(scene: LimelightScene, held?: string[]): Promise<void> {
  const store = db();
  await store.transaction('rw', store.scenes, async () => {
    const existing = await store.scenes.get(scene.id);
    const row: StoredScene = { id: scene.id, name: scene.name, updatedAt: scene.updatedAt, scene, thumb: existing?.thumb, thumbType: existing?.thumbType };
    const keep = held ?? existing?.held;
    if (keep && keep.length > 0) row.held = keep;
    await store.scenes.put(row);
  });
}

export async function setSceneThumb(id: string, thumb: Blob): Promise<void> {
  const data = await thumb.arrayBuffer();
  await db().scenes.update(id, { thumb: data, thumbType: thumb.type || 'image/jpeg' });
}

// ---------------------------------------------------------------------------
// Which pictures may go
// ---------------------------------------------------------------------------

type PictureHolder = () => Iterable<string>;
const holders = new Set<PictureHolder>();

/**
 * The open view's undo steps, asked whenever a delete decides which pictures
 * go: a scene row's `held` list is only as new as its last save. Gives back
 * the function that stops it.
 */
export function holdPictures(holder: PictureHolder): () => void {
  holders.add(holder);
  return () => {
    holders.delete(holder);
  };
}

function heldHere(): Set<string> {
  const ids = new Set<string>();
  for (const holder of holders) {
    try {
      for (const id of holder()) ids.add(id);
    } catch (error) {
      console.error('Limelight could not read the pictures undo holds', error);
    }
  }
  return ids;
}

/** A scene row's pictures: the scene's own, and the ones its undo steps show. */
export function rowPictures(row: { scene: unknown; held?: string[] }): Set<string> {
  const ids = sceneMediaIds(normalizeScene(row.scene));
  for (const id of row.held ?? []) ids.add(id);
  return ids;
}

/**
 * Of `candidates`, the pictures nothing keeps any more: no scene row (its
 * scene or its undo steps), no template, nothing the open view's undo holds.
 */
export function picturesToDelete(candidates: Iterable<string>, rows: Iterable<{ scene: unknown; held?: string[] }>, held: Iterable<string>): string[] {
  const used = new Set(held);
  for (const row of rows) for (const id of rowPictures(row)) used.add(id);
  return [...new Set(candidates)].filter((id) => !used.has(id));
}

async function deleteUnused(store: LimelightDatabase, candidates: Iterable<string>, held: Set<string>) {
  const rows: Array<{ scene: unknown; held?: string[] }> = [];
  await store.scenes.each((row) => {
    rows.push(row);
  });
  await store.templates.each((template) => {
    rows.push({ scene: template.scene });
  });
  await store.media.bulkDelete(picturesToDelete(candidates, rows, held));
}

/** Deletes a scene and every picture nothing else shows: no other scene, no template, no undo step. */
export async function deleteScene(id: string): Promise<void> {
  const store = db();
  // Asked before the transaction: it may only wait on the database.
  const held = heldHere();
  await store.transaction('rw', store.scenes, store.media, store.templates, async () => {
    const row = await store.scenes.get(id);
    await store.scenes.delete(id);
    if (!row) return;
    await deleteUnused(store, rowPictures(row), held);
  });
}

/** A copy of a scene under a new id and name; the pictures are shared, not copied. */
export async function duplicateScene(id: string, name?: string): Promise<LimelightScene | null> {
  const scene = await getScene(id);
  if (!scene) return null;
  const now = Date.now();
  const copy = normalizeScene({ ...scene, id: newId('scene'), name: name ?? `${scene.name} copy`, createdAt: now, updatedAt: now });
  await putScene(copy);
  return copy;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db().meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db().meta.put({ key, value });
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

async function pictureSize(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('That file is not a picture this app can read'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Keeps a picture for the screens and gives back its id. */
export async function addPicture(blob: Blob, name: string, from?: ScreenOrigin): Promise<LimelightMedia> {
  if (!blob.type.startsWith('image/')) throw new Error('That file is not a picture');
  if (blob.size > MAX_PICTURE_BYTES) throw new Error('That picture is over 40 MB');
  const size = await pictureSize(blob);
  const media: LimelightMedia = {
    id: newId('media'),
    kind: 'image',
    type: blob.type,
    name: name.slice(0, 120) || 'Picture',
    width: size.width,
    height: size.height,
    bytes: blob.size,
    data: await blob.arrayBuffer(),
    createdAt: Date.now(),
  };
  if (from) media.from = from;
  await db().media.put(media);
  return media;
}

export async function getPicture(id: string): Promise<LimelightMedia | undefined> {
  return db().media.get(id);
}

export async function getPictureBlob(id: string): Promise<Blob | null> {
  const media = await db().media.get(id);
  return media ? new Blob([media.data], { type: media.type }) : null;
}

/** Every picture kept, newest first, without their bytes. */
export async function listPictures(): Promise<Array<Omit<LimelightMedia, 'data'>>> {
  const rows = await db().media.orderBy('createdAt').reverse().toArray();
  return rows.map(({ data: _data, ...rest }) => rest);
}

/** Puts pictures read from elsewhere (Google Drive) in under the ids they had there. */
export async function putPictures(media: LimelightMedia[]): Promise<void> {
  await db().media.bulkPut(media);
}

export async function hasPictures(ids: Iterable<string>): Promise<Set<string>> {
  const list = [...ids];
  const rows = await db().media.bulkGet(list);
  return new Set(list.filter((_, i) => rows[i] !== undefined));
}

// ---------------------------------------------------------------------------
// The user's own templates
// ---------------------------------------------------------------------------

export async function listMyTemplates(): Promise<MyTemplate[]> {
  return db().templates.orderBy('createdAt').reverse().toArray();
}

/** Keeps a copy of a scene to start others from, with the picture of its first frame. */
export async function saveMyTemplate(scene: LimelightScene, name: string, thumb?: Blob): Promise<MyTemplate> {
  const template: MyTemplate = {
    id: newId('template'),
    name: name.trim().slice(0, 80) || scene.name,
    createdAt: Date.now(),
    scene: normalizeScene(scene),
  };
  if (thumb) {
    template.thumb = await thumb.arrayBuffer();
    template.thumbType = thumb.type || 'image/jpeg';
  }
  await db().templates.put(template);
  return template;
}

export async function renameMyTemplate(id: string, name: string): Promise<void> {
  await db().templates.update(id, { name: name.trim().slice(0, 80) });
}

/** Deletes one of the user's templates, and the pictures nothing else shows. */
export async function deleteMyTemplate(id: string): Promise<void> {
  const store = db();
  const held = heldHere();
  await store.transaction('rw', store.scenes, store.media, store.templates, async () => {
    const row = await store.templates.get(id);
    await store.templates.delete(id);
    if (!row) return;
    await deleteUnused(store, sceneMediaIds(normalizeScene(row.scene)), held);
  });
}
