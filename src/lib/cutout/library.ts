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
  /** Deleted here, kept until a sync has told the account. */
  deletedAt?: number;
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
  await putMedia(sourceMediaId, input.source, input.name, input);
  let mediaId: string | undefined;
  if (!input.cut) {
    mediaId = newId('asset_');
    await putMedia(mediaId, input.source, input.name, input);
  }
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
  await libraryDb.images.put(row);
  return row;
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
  // names a picture that is not there.
  if (input.cut && sourceMediaId && maskMediaId) {
    const size = { width: input.cut.sourceWidth, height: input.cut.sourceHeight };
    await putMedia(sourceMediaId, input.cut.source, input.name, size);
    await putMedia(maskMediaId, input.cut.mask, `${input.name} mask`, size);
  }
  await libraryDb.images.put(row);
  return row;
}

export async function setLibraryImageState(id: string, state: LibraryImageState, error?: string): Promise<void> {
  await libraryDb.images.update(id, { state, error, updatedAt: Date.now() });
}

/**
 * Keeps a finished cut: the mask, the settings, and the picture they make.
 * The picture before it is let go unless an artboard may still show it.
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
  }
): Promise<LibraryImageRow | null> {
  const row = await libraryDb.images.get(id);
  if (!row || row.deletedAt) return null;
  const mediaId = newId('asset_');
  const maskMediaId = newId('libmask_');
  await putMedia(mediaId, cut.picture, row.name, cut);
  await putMedia(maskMediaId, cut.mask, `${row.name} mask`, row.sourceWidth && row.sourceHeight ? { width: row.sourceWidth, height: row.sourceHeight } : undefined);
  const next: LibraryImageRow = {
    ...row,
    state: 'ready',
    error: undefined,
    mediaId,
    width: cut.width,
    height: cut.height,
    thumb: cut.thumb,
    maskMediaId,
    settings: cut.settings,
    rect: cut.rect,
    engine: cut.engine ?? row.engine,
    // A new picture: nothing has placed it yet.
    placed: false,
    updatedAt: Date.now(),
  };
  await libraryDb.images.put(next);
  const stale = [row.maskMediaId, row.placed ? undefined : row.mediaId].filter((value): value is string => !!value && value !== mediaId && value !== maskMediaId);
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
 * by id. The row stays, marked, until a sync has told the account.
 */
export async function deleteLibraryImage(id: string): Promise<void> {
  const row = await libraryDb.images.get(id);
  if (!row) return;
  const media = [row.sourceMediaId, row.maskMediaId, row.placed ? undefined : row.mediaId].filter((value): value is string => !!value);
  // The row first, then the media: a failure in between leaves a file nobody
  // names, never a row that names a missing file.
  await libraryDb.images.put({
    id: row.id,
    name: row.name,
    state: row.state,
    mediaId: row.placed ? row.mediaId : undefined,
    createdAt: row.createdAt,
    updatedAt: Date.now(),
    deletedAt: Date.now(),
  });
  if (media.length) await db.media.bulkDelete(media);
}

/** Rows deleted here that the account has not heard about. */
export async function deletedLibraryImages(): Promise<LibraryImageRow[]> {
  const rows = await libraryDb.images.toArray();
  return rows.filter((row) => !!row.deletedAt);
}

/** Forgets deleted rows once the account knows. */
export async function purgeDeletedLibraryImages(ids: string[]): Promise<void> {
  if (ids.length) await libraryDb.images.bulkDelete(ids);
}

/** Pictures left waiting or half cut, which the background remover picks up again. */
export async function unfinishedLibraryImages(): Promise<LibraryImageRow[]> {
  const rows = await listLibraryImages();
  return rows.filter((row) => row.state === 'waiting' || row.state === 'cutting').reverse();
}
