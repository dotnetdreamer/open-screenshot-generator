// The user's own pictures: what the palette's Custom tab shows and the
// background remover lists. One row per picture, in a database of the
// pictures' own (libraryDb.ts); the pictures themselves are media rows.
//
// A row points at media rows rather than holding pictures, for the reason the
// rest of the app does (issue #19): the finished picture is an `asset_` row in
// `media`, so placing it on an artboard is an `asset:<id>` reference the
// project bundle, the exports and the agents already understand. The photo it
// was cut from and the mask are media rows of their own (`libsrc_`, `libmask_`),
// which only this module reads, so a cut can be changed later without the
// quality a second cut of a cut-out would lose.
//
// A changed cut is a new `asset_` row, never new bytes under the old id: an
// artboard that shows the old picture keeps showing it, and a gist that holds
// the old file never needs it again (account/providers/github.ts relies on ids
// being immutable).

import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/database';
import { libraryDb } from './libraryDb';
import { ASSET_REF_PREFIX, notifyMediaChanged, type MediaAsset } from '@/lib/mediaStore';
import type { Rect } from './refine';
import type { CutoutEngine, RenderSettings } from './worker/protocol';

export type LibraryImageState =
  /** Waiting its turn to be cut. */
  | 'waiting'
  | 'cutting'
  | 'ready'
  /** Kept as it came, background and all. */
  | 'plain'
  | 'failed';

export interface LibraryImageRow {
  id: string;
  name: string;
  state: LibraryImageState;
  /** The finished picture, an `asset_` media row. Absent while the first cut runs. */
  mediaId?: string;
  width?: number;
  height?: number;
  /** A small PNG for lists. ArrayBuffer, not Blob: Playwright's WebKit cannot store a Blob here. */
  thumb?: ArrayBuffer;
  /** The photo as it came in, at its working size. */
  sourceMediaId?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  /** The mask over the photo, a greyscale PNG. */
  maskMediaId?: string;
  settings?: RenderSettings;
  /** Where the finished picture sits in the photo. */
  rect?: Rect;
  engine?: CutoutEngine;
  /** Why the cut failed, in words for the user. */
  error?: string;
  /** Set once it was put on an artboard: deleting it then keeps the picture. */
  placed?: boolean;
  createdAt: number;
  updatedAt: number;
  /** Deleted here. The row is kept for as long as a backup remembers a deletion (backup.ts). */
  deletedAt?: number;
  /**
   * A deleted picture's files an account may still have, by account
   * (`provider:account id`): written before a sync takes the picture out of
   * that account's list, and cleared once its files are out.
   */
  leftThere?: Record<string, string[]>;
}

const newId = (prefix: string) => `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** The `asset:` reference an element's imageSrc takes. */
export function refOf(row: Pick<LibraryImageRow, 'mediaId'>): string | null {
  return row.mediaId ? `${ASSET_REF_PREFIX}${row.mediaId}` : null;
}

/** A file's name without its extension, the way a picture is named here. */
export function nameFromFile(fileName: string): string {
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();
  return (stem || 'Picture').slice(0, 80);
}

async function putMedia(id: string, blob: Blob, name: string, size?: { width: number; height: number }): Promise<void> {
  const row: MediaAsset = {
    id,
    blob,
    name,
    mimeType: blob.type || 'image/png',
    width: size?.width,
    height: size?.height,
    createdAt: new Date(),
  };
  await db.media.put(row);
}

/** Every picture not deleted, newest first. */
export async function listLibraryImages(): Promise<LibraryImageRow[]> {
  const rows = await libraryDb.images.orderBy('updatedAt').reverse().toArray();
  return rows.filter((row) => !row.deletedAt);
}

export function getLibraryImage(id: string): Promise<LibraryImageRow | undefined> {
  return libraryDb.images.get(id);
}

/** The library, live across every window of the app. Null until the first read. */
export function useLibraryImages(): LibraryImageRow[] | null {
  const [rows, setRows] = useState<LibraryImageRow[] | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => listLibraryImages()).subscribe({
      next: (value) => setRows(value),
      error: (error) => {
        console.error('Reading your images failed', error);
        setRows([]);
      },
    });
    return () => subscription.unsubscribe();
  }, []);
  return rows;
}

/**
 * Adds a picture. With `cut` it waits for the background remover (state
 * `waiting`); without, it is kept as it is and is ready to place at once.
 */
export async function addLibraryImage(input: {
  name: string;
  /** The picture at its working size (picture.ts). */
  source: Blob;
  width: number;
  height: number;
  thumb: ArrayBuffer;
  cut: boolean;
}): Promise<LibraryImageRow> {
  const now = Date.now();
  const id = newId('img_');
  const sourceMediaId = newId('libsrc_');
  const mediaId = input.cut ? undefined : newId('asset_');
  const row: LibraryImageRow = {
    id,
    name: input.name,
    state: input.cut ? 'waiting' : 'plain',
    mediaId,
    width: input.cut ? undefined : input.width,
    height: input.cut ? undefined : input.height,
    thumb: input.thumb,
    sourceMediaId,
    sourceWidth: input.width,
    sourceHeight: input.height,
    createdAt: now,
    updatedAt: now,
  };
  await keepAll(async (written) => {
    await putMedia(sourceMediaId, input.source, input.name, input);
    written.push(sourceMediaId);
    if (mediaId) {
      await putMedia(mediaId, input.source, input.name, input);
      written.push(mediaId);
    }
    await libraryDb.images.put(row);
  });
  return row;
}

/**
 * Runs `job`, which writes media rows and notes each one in `written`, then
 * the row that names them. When any write fails (no room) the media already
 * written go again: nothing would name them, and nothing shows them, so they
 * would only take up room.
 */
async function keepAll(job: (written: string[]) => Promise<void>): Promise<void> {
  const written: string[] = [];
  try {
    await job(written);
  } catch (error) {
    if (written.length) await db.media.bulkDelete(written).catch((cleanup) => console.error('Clearing the files of a picture that was not added failed', cleanup));
    throw error;
  }
}

/** Adds an existing media row, keeping its photo and mask when the picture was cut here. */
export async function addLibraryImageFromMedia(input: {
  name: string;
  mediaId: string;
  width: number;
  height: number;
  thumb: ArrayBuffer;
  id?: string;
  engine?: CutoutEngine;
  cut?: {
    source: Blob;
    sourceWidth: number;
    sourceHeight: number;
    mask: Blob;
    settings: RenderSettings;
    rect: Rect;
  };
  /** Its picture may already be on an artboard (an agent was given its ref). */
  placed?: boolean;
  createdAt?: number;
  updatedAt?: number;
}): Promise<LibraryImageRow> {
  const now = Date.now();
  const sourceMediaId = input.cut ? newId('libsrc_') : undefined;
  const maskMediaId = input.cut ? newId('libmask_') : undefined;
  const row: LibraryImageRow = {
    id: input.id ?? newId('img_'),
    name: input.name,
    state: input.engine ? 'ready' : 'plain',
    mediaId: input.mediaId,
    width: input.width,
    height: input.height,
    thumb: input.thumb,
    engine: input.engine,
    ...(input.cut ? {
      sourceMediaId,
      sourceWidth: input.cut.sourceWidth,
      sourceHeight: input.cut.sourceHeight,
      maskMediaId,
      settings: input.cut.settings,
      rect: input.cut.rect,
    } : {}),
    placed: input.placed,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  // Two databases, so no one transaction: the media first, so a row never
  // names a picture that is not there. The picture itself was there before,
  // so a failure leaves it.
  await keepAll(async (written) => {
    if (input.cut && sourceMediaId && maskMediaId) {
      const size = { width: input.cut.sourceWidth, height: input.cut.sourceHeight };
      await putMedia(sourceMediaId, input.cut.source, input.name, size);
      written.push(sourceMediaId);
      await putMedia(maskMediaId, input.cut.mask, `${input.name} mask`, size);
      written.push(maskMediaId);
    }
    await libraryDb.images.put(row);
  });
  return row;
}

/** True when the browser's storage refused a write because the computer is out of room. */
export function isOutOfRoom(error: unknown): boolean {
  const names = [(error as { name?: string })?.name, (error as { inner?: { name?: string } })?.inner?.name];
  return names.includes('QuotaExceededError');
}

export const OUT_OF_ROOM = 'This computer is out of room for more pictures. Delete some pictures or projects, then try again.';

/** What a picture is cut and edited from. */
export interface PictureSource {
  /** The picture's row as it is now. */
  row: LibraryImageRow;
  photo: MediaAsset;
  /** The saved mask over `photo`. Absent when there is none: the photo's own transparency is the mask then. */
  mask?: MediaAsset;
}

/**
 * The row of a picture that is its own photo. A mask such a row names was
 * saved over an earlier version of the picture, which is gone, so it does not
 * fit and goes, with the rect. The edge settings are in the picture already,
 * so they start again from none.
 */
function asOwnPhoto(row: LibraryImageRow): LibraryImageRow {
  return {
    ...row,
    maskMediaId: undefined,
    rect: undefined,
    settings: row.settings && { ...row.settings, edge: 0, softness: 0 },
  };
}

/**
 * The photo a picture is cut from, and the mask over it. A picture with no
 * photo of its own gets a copy of itself as one: a gist keeps no photos, and
 * Google Drive keeps none for a picture kept as it came, so pictures that came
 * back from either have only the picture. With the copy they can be cut again,
 * and a mask saved by a hand edit fits the same photo every time it opens. When
 * the copy cannot be stored (no room), the picture itself is the photo this
 * time and nothing is written; saveLibraryCut then keeps the copy with the
 * mask, or fails for the same lack of room. Null when the picture is gone as
 * well.
 */
export async function photoOf(id: string): Promise<PictureSource | null> {
  // Another window can change the row while the copy is written: a new
  // version of the picture (an edit, a backup bringing a newer one), or a photo
  // of its own. The copy is then of a picture the row no longer shows, so it
  // goes and the row is read again. The third read keeps what it finds.
  for (let round = 0; ; round++) {
    const row = await libraryDb.images.get(id);
    if (!row || row.deletedAt) return null;
    const kept = row.sourceMediaId ? await db.media.get(row.sourceMediaId) : undefined;
    if (kept) {
      const mask = row.maskMediaId ? await db.media.get(row.maskMediaId) : undefined;
      return { row, photo: kept, mask };
    }
    const picture = row.mediaId ? await db.media.get(row.mediaId) : undefined;
    if (!picture) return null;
    const unkept = (error?: unknown): PictureSource => {
      if (error) console.error('Keeping a copy of a picture as its photo failed', error);
      return { row: asOwnPhoto(row), photo: picture };
    };
    if (round === 2) return unkept();
    const width = picture.width ?? row.width;
    const height = picture.height ?? row.height;
    const sourceMediaId = newId('libsrc_');
    // The media first, then the row.
    try {
      await putMedia(sourceMediaId, picture.blob, row.name, width && height ? { width, height } : undefined);
    } catch (error) {
      return unkept(error);
    }
    let outcome: { row: LibraryImageRow; staleMask?: string } | 'changed' | null;
    try {
      outcome = await libraryDb.transaction('rw', libraryDb.images, async () => {
        const now = await libraryDb.images.get(id);
        if (!now || now.deletedAt) return null;
        if (now.mediaId !== row.mediaId || (now.sourceMediaId && now.sourceMediaId !== row.sourceMediaId)) return 'changed';
        const next = { ...asOwnPhoto(now), sourceMediaId, sourceWidth: width, sourceHeight: height };
        await libraryDb.images.put(next);
        return { row: next, staleMask: now.maskMediaId };
      });
    } catch (error) {
      await db.media.delete(sourceMediaId).catch(() => undefined);
      return unkept(error);
    }
    if (outcome === 'changed' || !outcome) {
      await db.media.delete(sourceMediaId);
      if (!outcome) return null;
      continue;
    }
    if (outcome.staleMask) await db.media.delete(outcome.staleMask).catch(() => undefined);
    const photo = await db.media.get(sourceMediaId);
    if (!photo) return null;
    return { row: outcome.row, photo };
  }
}

/** The picture changed while it was being cut or edited, so the mask made for it no longer fits its photo. */
export class PictureChangedError extends Error {
  constructor() {
    super('The picture changed in the meantime. Try again.');
    this.name = 'PictureChangedError';
  }
}

export async function setLibraryImageState(id: string, state: LibraryImageState, error?: string): Promise<void> {
  await libraryDb.images.update(id, { state, error, updatedAt: Date.now() });
}

/**
 * The end of a cut that kept nothing (it failed, or was stopped), for a
 * picture still waiting for one. A picture finished meanwhile (an edit saved
 * in a window, a version a backup brought down) keeps its state: that
 * version is newer than the cut. False when it was left so.
 */
export async function settleUnfinishedImage(id: string, state: 'waiting' | 'failed', error?: string): Promise<boolean> {
  return libraryDb.transaction('rw', libraryDb.images, async () => {
    const row = await libraryDb.images.get(id);
    if (!row || row.deletedAt || (row.state !== 'waiting' && row.state !== 'cutting')) return false;
    await libraryDb.images.put({ ...row, state, error, updatedAt: Date.now() });
    return true;
  });
}

/** Whether a picture still waits for its cut, rather than having a finished version (or being gone). */
export async function stillUnfinished(id: string): Promise<boolean> {
  const row = await libraryDb.images.get(id);
  return !!row && !row.deletedAt && (row.state === 'waiting' || row.state === 'cutting');
}

/**
 * Keeps a finished cut: the mask, the settings, and the picture they make.
 * The mask fits the photo it was made over and no other, so that photo comes
 * too: the row's own photo, or the picture itself when photoOf had no room to
 * keep a copy, which is kept now (a save with no room for it fails, and
 * nothing changes). The cut starts from one version of the picture, `basis`:
 * a row that has another picture by now (an edit saved in another window, a
 * newer version a backup brought) or another photo throws
 * PictureChangedError, and nothing changes either, so a window showing an
 * older version never writes over a newer one. The picture before it is let
 * go unless an artboard may still show it.
 */
export async function saveLibraryCut(
  id: string,
  cut: {
    mask: Blob;
    picture: Blob;
    width: number;
    height: number;
    thumb: ArrayBuffer;
    settings: RenderSettings;
    rect: Rect;
    /** How the mask was made; left as it was when absent (a brush edit). */
    engine?: CutoutEngine;
    /** The photo the mask is over, as photoOf gave it. */
    photo: MediaAsset;
    /** The picture the cut or edit started from: the row's `mediaId` then, none before a first cut. */
    basis: string | undefined;
  }
): Promise<LibraryImageRow | null> {
  const row = await libraryDb.images.get(id);
  if (!row || row.deletedAt) return null;
  if (row.mediaId !== cut.basis) throw new PictureChangedError();
  const own = !!row.sourceMediaId && row.sourceMediaId === cut.photo.id;
  // The picture as its own photo, the row having no photo kept yet.
  const itself = !own && cut.photo.id === row.mediaId && !(row.sourceMediaId && (await db.media.get(row.sourceMediaId)));
  if (!own && !itself) throw new PictureChangedError();
  const photoSize = itself
    ? { width: cut.photo.width ?? row.width, height: cut.photo.height ?? row.height }
    : { width: row.sourceWidth, height: row.sourceHeight };
  const size = photoSize.width && photoSize.height ? { width: photoSize.width, height: photoSize.height } : undefined;
  const sourceMediaId = itself ? newId('libsrc_') : (row.sourceMediaId as string);
  const mediaId = newId('asset_');
  const maskMediaId = newId('libmask_');
  const written: string[] = [];
  const unwrite = () => (written.length ? db.media.bulkDelete(written).catch(() => undefined) : undefined);
  let outcome: { next: LibraryImageRow; before: LibraryImageRow } | 'changed' | null;
  try {
    if (itself) {
      await putMedia(sourceMediaId, cut.photo.blob, row.name, size);
      written.push(sourceMediaId);
    }
    await putMedia(mediaId, cut.picture, row.name, cut);
    written.push(mediaId);
    await putMedia(maskMediaId, cut.mask, `${row.name} mask`, size);
    written.push(maskMediaId);
    // The row again, in the write: what it shows has to be what the mask was
    // made for, and a rename since is kept.
    outcome = await libraryDb.transaction('rw', libraryDb.images, async () => {
      const now = await libraryDb.images.get(id);
      if (!now || now.deletedAt) return null;
      if (now.mediaId !== row.mediaId || now.sourceMediaId !== row.sourceMediaId) return 'changed';
      const next: LibraryImageRow = {
        ...now,
        state: 'ready',
        error: undefined,
        mediaId,
        width: cut.width,
        height: cut.height,
        thumb: cut.thumb,
        ...(itself ? { sourceMediaId, sourceWidth: size?.width, sourceHeight: size?.height } : {}),
        maskMediaId,
        settings: cut.settings,
        rect: cut.rect,
        engine: cut.engine ?? now.engine,
        // A new picture: nothing has placed it yet.
        placed: false,
        updatedAt: Date.now(),
      };
      await libraryDb.images.put(next);
      return { next, before: now };
    });
  } catch (error) {
    await unwrite();
    throw error;
  }
  if (outcome === 'changed' || !outcome) {
    await unwrite();
    if (outcome === 'changed') throw new PictureChangedError();
    return null;
  }
  const { next, before } = outcome;
  const stale = [before.maskMediaId, before.placed ? undefined : before.mediaId].filter(
    (value): value is string => !!value && value !== mediaId && value !== maskMediaId && value !== sourceMediaId
  );
  if (stale.length) await db.media.bulkDelete(stale);
  notifyMediaChanged();
  return next;
}

export async function renameLibraryImage(id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return;
  await libraryDb.images.update(id, { name: clean, updatedAt: Date.now() });
}

/**
 * Notes that the picture may be on an artboard, so a new cut or a delete keeps
 * it. Called wherever its ref leaves the library: a Custom tile, Add to
 * artboard, and every MCP tool that hands a ref to an agent, since the agent
 * may place it with add_element and nothing here would know.
 */
export async function markLibraryImagePlaced(id: string): Promise<void> {
  await libraryDb.images.update(id, { placed: true });
}

/**
 * Deletes a picture from the library. Its photo and mask go now. The finished
 * picture stays when an artboard may show it, since a project references it
 * by id. The row stays, marked, for as long as a backup remembers a deletion,
 * so every account this computer backs up to in that time hears of it.
 */
export async function deleteLibraryImage(id: string): Promise<void> {
  // Read and marked in one write, so the files that go are the ones the row
  // names then: an edit another window saved a moment before, or a picture
  // put on an artboard, is what is deleted, and what an artboard shows stays.
  const row = await libraryDb.transaction('rw', libraryDb.images, async () => {
    const now = await libraryDb.images.get(id);
    if (!now || now.deletedAt) return null;
    await libraryDb.images.put({
      id: now.id,
      name: now.name,
      state: now.state,
      mediaId: now.placed ? now.mediaId : undefined,
      createdAt: now.createdAt,
      updatedAt: Date.now(),
      deletedAt: Date.now(),
    });
    return now;
  });
  if (!row) return;
  // The row first, then the media: a failure in between leaves a file nobody
  // names, never a row that names a missing file.
  const media = [row.sourceMediaId, row.maskMediaId, row.placed ? undefined : row.mediaId].filter((value): value is string => !!value);
  if (media.length) await db.media.bulkDelete(media);
}

/** Rows deleted here and not forgotten yet. */
export async function deletedLibraryImages(): Promise<LibraryImageRow[]> {
  const rows = await libraryDb.images.toArray();
  return rows.filter((row) => !!row.deletedAt);
}

/** Forgets deleted rows. */
export async function purgeDeletedLibraryImages(ids: string[]): Promise<void> {
  if (ids.length) await libraryDb.images.bulkDelete(ids);
}

/** Pictures left waiting or half cut, which the background remover picks up again. */
export async function unfinishedLibraryImages(): Promise<LibraryImageRow[]> {
  const rows = await listLibraryImages();
  return rows.filter((row) => row.state === 'waiting' || row.state === 'cutting').reverse();
}
