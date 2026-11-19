// Backing the user's pictures up to their own storage: the Google Drive or the
// GitHub account they signed in with (src/lib/account), in a folder or gist of
// the pictures' own, apart from every project.
//
// A sync merges both ways, so pressing it on a new computer brings the pictures
// down instead of wiping them upstream: a picture only here is sent, one only
// there is fetched, one on both keeps whichever copy changed last, and one
// deleted on either side goes on both (the deletion travels in the manifest).
// It runs when the user asks, never on a timer, which is what rule 25a asks of
// a writer to storage the user owns.

import { db } from '@/database';
import { libraryDb } from './libraryDb';
import { getProvider, getSession, withFreshSession } from '@/lib/account';
import { AccountAuthError, type CloudProviderId, type LibraryRemote, type RemoteLibraryImage, type RemoteLibraryManifest } from '@/lib/account/types';
import { googleDriveLibrary } from '@/lib/account/providers/googleDrive';
import { githubLibrary } from '@/lib/account/providers/github';
import { getMediaAsset, notifyMediaChanged } from '@/lib/mediaStore';
import { deletedLibraryImages, purgeDeletedLibraryImages, type LibraryImageRow } from './library';
import { decodePicture, thumbnailOf } from './picture';

const REMOTES: Record<CloudProviderId, LibraryRemote> = { google: googleDriveLibrary, github: githubLibrary };

/** Where the pictures go, in the words the button uses. */
export function libraryBackupLabel(provider: CloudProviderId): string {
  return provider === 'google' ? 'Google Drive' : 'GitHub';
}

/** A deletion is remembered upstream this long, then forgotten. */
const TOMBSTONE_DAYS = 120;

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  removed: number;
}

function toRemote(row: LibraryImageRow, mimeType: string, sourceMimeType: string | undefined, keepsSources: boolean): RemoteLibraryImage {
  return {
    id: row.id,
    name: row.name,
    mediaId: row.mediaId as string,
    mimeType,
    width: row.width ?? 0,
    height: row.height ?? 0,
    engine: row.engine,
    ...(keepsSources && row.sourceMediaId && row.maskMediaId
      ? {
          sourceMediaId: row.sourceMediaId,
          sourceMimeType,
          sourceWidth: row.sourceWidth,
          sourceHeight: row.sourceHeight,
          maskMediaId: row.maskMediaId,
          settings: row.settings,
          rect: row.rect,
        }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Merges this device's pictures with the account's, both ways. */
export async function syncLibrary(onProgress?: (step: string) => void): Promise<SyncResult> {
  const run = async (): Promise<SyncResult> => {
    const stored = getSession();
    if (!stored) throw new AccountAuthError('Sign in to back up your pictures.');
    const session = await withFreshSession(stored);
    const remote = REMOTES[session.provider];
    onProgress?.('Looking at your backup');
    let state = await remote.read(session);
    const manifest: RemoteLibraryManifest = state.manifest ?? { formatVersion: 1, updatedAt: 0, images: [], deleted: [] };

    const localRows = await libraryDb.images.toArray();
    const local = new Map(localRows.map((row) => [row.id, row]));
    const remoteImages = new Map(manifest.images.map((image) => [image.id, image]));
    const deletedAt = new Map<string, number>();
    for (const entry of manifest.deleted ?? []) deletedAt.set(entry.id, entry.at);
    for (const row of await deletedLibraryImages()) deletedAt.set(row.id, Math.max(deletedAt.get(row.id) ?? 0, row.deletedAt ?? 0));

    const result: SyncResult = { uploaded: 0, downloaded: 0, removed: 0 };
    const finalImages = new Map<string, RemoteLibraryImage>();
    const toSend: Array<{ mediaId: string; blob: Blob; mimeType: string }> = [];
    const toFetch: RemoteLibraryImage[] = [];

    const ids = new Set([...local.keys(), ...remoteImages.keys()]);
    for (const id of ids) {
      const row = local.get(id);
      const up = remoteImages.get(id);
      const gone = deletedAt.get(id);
      if (gone !== undefined && (!row || row.deletedAt || row.updatedAt <= gone) && (!up || up.updatedAt <= gone)) {
        // Deleted somewhere after its last change: it goes here too.
        if (row && !row.deletedAt) {
          await removeLocal(row);
          result.removed++;
        }
        continue;
      }
      const usable = row && !row.deletedAt && row.mediaId && (row.state === 'ready' || row.state === 'plain');
      // The same version on both sides, but its file never arrived up there.
      const fileMissing = !!up && !state.mediaIds.has(up.mediaId) && row?.mediaId === up.mediaId;
      if (usable && (!up || row.updatedAt > up.updatedAt || fileMissing)) {
        const picture = await getMediaAsset(row.mediaId as string);
        if (!picture) continue;
        const source = remote.keepsSources && row.sourceMediaId ? await getMediaAsset(row.sourceMediaId) : undefined;
        const mask = remote.keepsSources && row.maskMediaId ? await getMediaAsset(row.maskMediaId) : undefined;
        finalImages.set(id, toRemote(row, picture.mimeType, source?.mimeType, remote.keepsSources && !!source && !!mask));
        toSend.push({ mediaId: picture.id, blob: picture.blob, mimeType: picture.mimeType });
        if (source && mask) {
          toSend.push({ mediaId: source.id, blob: source.blob, mimeType: source.mimeType });
          toSend.push({ mediaId: mask.id, blob: mask.blob, mimeType: mask.mimeType });
        }
        if (!up || !state.mediaIds.has(picture.id)) result.uploaded++;
      } else if (up) {
        finalImages.set(id, up);
        if (!row || row.deletedAt || row.updatedAt < up.updatedAt || !row.mediaId) toFetch.push(up);
      } else if (row && !row.deletedAt) {
        // Not finished here yet (waiting or failed): it goes up next time.
      }
    }

    if (toSend.length) {
      onProgress?.('Sending pictures');
      state = await remote.upload(session, state, toSend);
    }
    for (const image of toFetch) {
      onProgress?.(`Bringing back ${image.name}`);
      await fetchImage(remote, session, state, image);
      result.downloaded++;
    }

    const cutoff = Date.now() - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
    const next: RemoteLibraryManifest = {
      formatVersion: 1,
      updatedAt: Date.now(),
      images: [...finalImages.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      deleted: [...deletedAt.entries()].filter(([, at]) => at > cutoff).map(([id, at]) => ({ id, at })),
    };
    if (!state.handle) state = await remote.upload(session, state, []);
    state = await remote.writeManifest(session, state, next);

    // Files no picture in the manifest names any more. Decided from the merged
    // list, which holds every picture either side had, so nothing still kept
    // anywhere is removed.
    const named = new Set<string>();
    for (const image of next.images) {
      named.add(image.mediaId);
      if (image.sourceMediaId) named.add(image.sourceMediaId);
      if (image.maskMediaId) named.add(image.maskMediaId);
    }
    const orphans = [...state.mediaIds].filter((id) => !named.has(id));
    if (orphans.length) await remote.remove(session, state, orphans);

    await purgeDeletedLibraryImages(localRows.filter((row) => row.deletedAt).map((row) => row.id));
    return result;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('osg-library-sync', run) : run();
}

async function removeLocal(row: LibraryImageRow): Promise<void> {
  const media = [row.sourceMediaId, row.maskMediaId, row.placed ? undefined : row.mediaId].filter((value): value is string => !!value);
  await libraryDb.images.delete(row.id);
  if (media.length) await db.media.bulkDelete(media);
}

async function fetchImage(
  remote: LibraryRemote,
  session: Parameters<LibraryRemote['download']>[0],
  state: Parameters<LibraryRemote['download']>[1],
  image: RemoteLibraryImage
): Promise<void> {
  const picture = await remote.download(session, state, image.mediaId, image.mimeType);
  let source: Blob | null = null;
  let mask: Blob | null = null;
  if (remote.keepsSources && image.sourceMediaId && image.maskMediaId) {
    source = await remote.download(session, state, image.sourceMediaId, image.sourceMimeType ?? 'image/jpeg').catch(() => null);
    mask = source ? await remote.download(session, state, image.maskMediaId, 'image/png').catch(() => null) : null;
  }
  const decoded = await decodePicture(picture);
  const thumb = await (await thumbnailOf(decoded.rgba, decoded.width, decoded.height)).arrayBuffer();
  const now = new Date();
  {
    // The ids travel with the files, so the next sync finds them already here.
    await db.media.put({ id: image.mediaId, blob: picture, name: image.name, mimeType: image.mimeType, width: image.width, height: image.height, createdAt: now });
    if (source && mask && image.sourceMediaId && image.maskMediaId) {
      await db.media.put({ id: image.sourceMediaId, blob: source, name: image.name, mimeType: source.type || image.sourceMimeType || 'image/jpeg', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
      await db.media.put({ id: image.maskMediaId, blob: mask, name: `${image.name} mask`, mimeType: 'image/png', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
    }
    const kept = !!(source && mask);
    const row: LibraryImageRow = {
      id: image.id,
      name: image.name,
      state: image.engine ? 'ready' : 'plain',
      mediaId: image.mediaId,
      width: image.width,
      height: image.height,
      thumb,
      sourceMediaId: kept ? image.sourceMediaId : undefined,
      sourceWidth: kept ? image.sourceWidth : undefined,
      sourceHeight: kept ? image.sourceHeight : undefined,
      maskMediaId: kept ? image.maskMediaId : undefined,
      settings: kept ? image.settings : undefined,
      rect: kept ? image.rect : undefined,
      engine: image.engine as LibraryImageRow['engine'],
      // A project from another computer may show this very picture.
      placed: true,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt,
    };
    await libraryDb.images.put(row);
  }
  notifyMediaChanged();
}

/** Whether the signed in account can hold the pictures (both providers can). */
export function canBackUpLibrary(): boolean {
  const session = getSession();
  return !!session && !!getProvider(session.provider);
}
