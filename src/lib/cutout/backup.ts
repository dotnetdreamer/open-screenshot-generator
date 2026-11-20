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
//
// A picture deleted here keeps its row, marked, for as long as the manifests
// remember a deletion (TOMBSTONE_DAYS), so every account this computer backs up
// to in that time hears of it, not only the first. The row also notes, per
// account, the files that account may still have, so a sync that stopped
// partway, or one that the storage refused, still takes them out next time.

import { db } from '@/database';
import { libraryDb } from './libraryDb';
import { getProvider, getSession, withFreshSession } from '@/lib/account';
import { ConnectionError } from '@/lib/account/transport';
import {
  AccountAuthError,
  type AccountSession,
  type CloudProviderId,
  type LibraryRemote,
  type RemoteLibraryImage,
  type RemoteLibraryManifest,
  type RemoteLibraryState,
} from '@/lib/account/types';
import { googleDriveLibrary } from '@/lib/account/providers/googleDrive';
import { githubLibrary } from '@/lib/account/providers/github';
import { getMediaAsset, notifyMediaChanged } from '@/lib/mediaStore';
import { isOutOfRoom, OUT_OF_ROOM, purgeDeletedLibraryImages, type LibraryImageRow } from './library';
import { decodePicture, thumbnailOf } from './picture';

const REMOTES: Record<CloudProviderId, LibraryRemote> = { google: googleDriveLibrary, github: githubLibrary };

/** Where the pictures go, in the words the button uses. */
export function libraryBackupLabel(provider: CloudProviderId): string {
  return provider === 'google' ? 'Google Drive' : 'GitHub';
}

/** A deletion is remembered this long, upstream and here, then forgotten. */
const TOMBSTONE_DAYS = 120;

/** Which account a sync talks to, the way a deleted row's `leftThere` names it. */
const accountKey = (session: AccountSession) => `${session.provider}:${session.account.id}`;

export interface SyncResult {
  /** Pictures sent to the account. */
  uploaded: number;
  /** Pictures brought down to this device. */
  downloaded: number;
  /**
   * Pictures the account has that did not come down this time: the picture,
   * or the photo and mask it was cut from where the account keeps them.
   */
  notDownloaded: number;
  /** Pictures deleted on another device, so taken off this one. */
  removed: number;
  /** Pictures deleted on this device, so taken out of the account. */
  removedThere: number;
  /** Pictures deleted on this device whose files the account still has: removing them failed. */
  notRemovedThere: number;
  /** Pictures whose files in the account kept an old name: renaming them failed. */
  notRenamedThere: number;
  /** Why a picture did not come down, where the words help: no connection, or no room here. */
  problem?: string;
}

const pictures = (count: number) => `${count} ${count === 1 ? 'picture' : 'pictures'}`;

/** Clauses joined the way a sentence lists them: "a, and b", "a, b, and c". */
const listed = (clauses: string[]) =>
  clauses.length < 3 ? clauses.join(', and ') : `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;

/** What one sync did, in the words the toast shows. `where` is `libraryBackupLabel`'s. */
export function describeSync(result: SyncResult, where: string): { title: string; description: string } {
  const moved: string[] = [];
  if (result.uploaded) moved.push(`${result.uploaded} saved to ${where}`);
  if (result.downloaded) moved.push(`${result.downloaded} brought back to this computer`);
  if (result.removedThere) moved.push(`${result.removedThere} deleted from ${where}`);
  const sentences = moved.length ? [`${moved.join(', ')}.`] : [];
  if (result.removed) {
    const one = result.removed === 1;
    sentences.push(`${pictures(result.removed)} you deleted on another computer ${one ? 'is' : 'are'} gone from this one too.`);
  }
  const failed: string[] = [];
  if (result.notDownloaded) failed.push(`${pictures(result.notDownloaded)} couldn't be brought back from ${where}`);
  if (result.notRemovedThere) failed.push(`${pictures(result.notRemovedThere)} couldn't be deleted from ${where}`);
  if (result.notRenamedThere) failed.push(`${pictures(result.notRenamedThere)} couldn't be renamed in ${where}`);
  if (failed.length) sentences.push(`${listed(failed)}. ${result.problem ?? 'The next backup tries again.'}`);
  return {
    title: failed.length ? "Part of the backup didn't finish" : 'Your pictures are backed up',
    description: sentences.length ? sentences.join(' ') : `${where} already had all your pictures.`,
  };
}

/** Why a picture did not come down, in words that help the user: no connection, or no room for it here. */
function reasonOf(error: unknown): string | undefined {
  if (error instanceof ConnectionError) return error.message;
  if (isOutOfRoom(error)) return OUT_OF_ROOM;
  return undefined;
}

/** The files a picture has in the account. */
const filesOf = (image: RemoteLibraryImage): string[] =>
  [image.mediaId, image.sourceMediaId, image.maskMediaId].filter((id): id is string => !!id);

/** Whether the account has the photo and the mask a picture was cut from, and not only their names in the list. */
const hasOriginal = (image: RemoteLibraryImage, state: RemoteLibraryState): boolean =>
  !!image.sourceMediaId && !!image.maskMediaId && state.mediaIds.has(image.sourceMediaId) && state.mediaIds.has(image.maskMediaId);

/** A picture's entry fields about the photo and mask it was cut from. */
const originalOf = (image: RemoteLibraryImage): Partial<RemoteLibraryImage> => ({
  sourceMediaId: image.sourceMediaId,
  sourceMimeType: image.sourceMimeType,
  sourceWidth: image.sourceWidth,
  sourceHeight: image.sourceHeight,
  maskMediaId: image.maskMediaId,
  settings: image.settings,
  rect: image.rect,
});

/** A picture's photo and mask go by its name too, where the storage shows names. */
const photoName = (name: string) => `${name} (photo)`;
const maskName = (name: string) => `${name} (mask)`;

/** Every file a picture has in the account, with the name and type upload gives it. */
function namedFilesOf(image: RemoteLibraryImage): Array<{ mediaId: string; mimeType: string; name: string }> {
  const files = [{ mediaId: image.mediaId, mimeType: image.mimeType, name: image.name }];
  if (image.sourceMediaId) files.push({ mediaId: image.sourceMediaId, mimeType: image.sourceMimeType ?? 'image/jpeg', name: photoName(image.name) });
  if (image.maskMediaId) files.push({ mediaId: image.maskMediaId, mimeType: 'image/png', name: maskName(image.name) });
  return files;
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
    const here = accountKey(session);
    onProgress?.('Looking at your backup');
    let state = await remote.read(session);
    const manifest: RemoteLibraryManifest = state.manifest ?? { formatVersion: 1, updatedAt: 0, images: [], deleted: [] };

    const localRows = await libraryDb.images.toArray();
    const local = new Map(localRows.map((row) => [row.id, row]));
    const remoteImages = new Map(manifest.images.map((image) => [image.id, image]));
    const deletedAt = new Map<string, number>();
    for (const entry of manifest.deleted ?? []) deletedAt.set(entry.id, entry.at);
    for (const row of localRows) if (row.deletedAt) deletedAt.set(row.id, Math.max(deletedAt.get(row.id) ?? 0, row.deletedAt));

    const result: SyncResult = { uploaded: 0, downloaded: 0, notDownloaded: 0, removed: 0, removedThere: 0, notRemovedThere: 0, notRenamedThere: 0 };
    const finalImages = new Map<string, RemoteLibraryImage>();
    const toSend: Array<{ mediaId: string; blob: Blob; mimeType: string; name: string }> = [];
    const toFetch: RemoteLibraryImage[] = [];
    // Pictures here without the photo and mask the account has for them.
    const toRepair: RemoteLibraryImage[] = [];
    // Pictures deleted here whose files this account may have, by id: counted
    // once the files are out, below.
    const leaving = new Map<string, string[]>();

    const ids = new Set([...local.keys(), ...remoteImages.keys()]);
    for (const id of ids) {
      const row = local.get(id);
      const up = remoteImages.get(id);
      const gone = deletedAt.get(id);
      if (gone !== undefined && (!row || row.deletedAt || row.updatedAt <= gone) && (!up || up.updatedAt <= gone)) {
        // Deleted somewhere after its last change: it goes here too, or
        // leaves the account when it was deleted here.
        if (row && !row.deletedAt) {
          await removeLocal(row);
          result.removed++;
        } else if (row?.deletedAt) {
          // Out of this account go the files its list names for the picture,
          // and any an earlier sync with it noted and could not get out.
          // Files noted for another account wait for a sync with that one.
          const files = new Set([...(up ? filesOf(up) : []), ...(row.leftThere?.[here] ?? [])]);
          if (files.size) leaving.set(id, [...files]);
        }
        continue;
      }
      const usable = row && !row.deletedAt && row.mediaId && (row.state === 'ready' || row.state === 'plain');
      // The same version on both sides, but its file never arrived up there.
      const fileMissing = !!up && !state.mediaIds.has(up.mediaId) && row?.mediaId === up.mediaId;
      // This very picture (the same file) has a photo and mask in the account
      // that it lacks here: a restore whose photo did not come down, or a copy
      // of the picture standing in as its photo since. The account's are the
      // ones it was cut from, so they come down, and they stay in the list
      // even when this computer sends the picture again (a rename).
      const original =
        remote.keepsSources && row && !row.deletedAt && up && row.mediaId === up.mediaId && hasOriginal(up, state) && row.sourceMediaId !== up.sourceMediaId
          ? up
          : undefined;
      if (usable && (!up || row.updatedAt > up.updatedAt || fileMissing)) {
        const picture = await getMediaAsset(row.mediaId as string);
        if (!picture) {
          // Its file is missing here: the account's version stays listed, so
          // its files are not taken for ones nothing names.
          if (up) finalImages.set(id, up);
          continue;
        }
        toSend.push({ mediaId: picture.id, blob: picture.blob, mimeType: picture.mimeType, name: row.name });
        if (original) {
          finalImages.set(id, { ...toRemote(row, picture.mimeType, undefined, false), ...originalOf(original) });
          toRepair.push(original);
        } else {
          const source = remote.keepsSources && row.sourceMediaId ? await getMediaAsset(row.sourceMediaId) : undefined;
          const mask = remote.keepsSources && row.maskMediaId ? await getMediaAsset(row.maskMediaId) : undefined;
          finalImages.set(id, toRemote(row, picture.mimeType, source?.mimeType, remote.keepsSources && !!source && !!mask));
          if (source && mask) {
            toSend.push({ mediaId: source.id, blob: source.blob, mimeType: source.mimeType, name: photoName(row.name) });
            toSend.push({ mediaId: mask.id, blob: mask.blob, mimeType: mask.mimeType, name: maskName(row.name) });
          }
        }
        if (!up || !state.mediaIds.has(picture.id)) result.uploaded++;
      } else if (up) {
        finalImages.set(id, up);
        if (!row || row.deletedAt || row.updatedAt < up.updatedAt || !row.mediaId) toFetch.push(up);
        else if (original) toRepair.push(original);
      } else if (row && !row.deletedAt) {
        // Not finished here yet (waiting or failed): it goes up next time.
      }
    }

    if (toSend.length) {
      onProgress?.('Sending pictures');
      state = await remote.upload(session, state, toSend);
    }
    // One picture that cannot come down (its file gone from the account, a
    // file the app cannot read, a connection that dropped) does not stop the
    // others; the manifest keeps it, so the next sync tries again.
    const notBack = (image: RemoteLibraryImage, error: unknown) => {
      if (error instanceof AccountAuthError) throw error;
      console.error('Bringing a picture back failed', image.id, error);
      result.notDownloaded++;
      result.problem ??= reasonOf(error);
    };
    for (const image of toFetch) {
      onProgress?.(`Bringing back ${image.name}`);
      try {
        await fetchImage(remote, session, state, image);
        result.downloaded++;
      } catch (error) {
        notBack(image, error);
      }
    }
    for (const image of toRepair) {
      onProgress?.(`Bringing back the photo of ${image.name}`);
      try {
        await fetchOriginal(remote, session, state, image);
      } catch (error) {
        notBack(image, error);
      }
    }

    const cutoff = Date.now() - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
    const next: RemoteLibraryManifest = {
      formatVersion: 1,
      updatedAt: Date.now(),
      images: [...finalImages.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      deleted: [...deletedAt.entries()].filter(([, at]) => at > cutoff).map(([id, at]) => ({ id, at })),
    };
    if (!state.handle) state = await remote.upload(session, state, []);
    // Noted before the manifest stops naming them: a sync that stops after the
    // write (a sign-in that ran out) still knows next time what to take out.
    for (const [id, files] of leaving) await noteLeftThere(id, here, files);
    state = await remote.writeManifest(session, state, next);
    // A file whose name no longer matches its picture (renamed here, or named
    // by its media id) gets the picture's name.
    if (remote.rename) {
      const renamed = await remote.rename(session, state, next.images.flatMap(namedFilesOf));
      state = renamed.state;
      const kept = new Set(renamed.left);
      result.notRenamedThere = next.images.filter((image) => filesOf(image).some((mediaId) => kept.has(mediaId))).length;
    }

    // Files no picture in the manifest names any more. Decided from the merged
    // list, which holds every picture either side had, so nothing still kept
    // anywhere is removed. The old files of a changed picture are among them;
    // one the storage refuses is found unnamed and tried again next time.
    const named = new Set(next.images.flatMap(filesOf));
    const orphans = [...state.mediaIds].filter((id) => !named.has(id));
    const left = new Set(orphans.length ? await remote.remove(session, state, orphans) : []);

    // A deletion counts once its files are out of this account. One whose
    // files are still there keeps them noted until a sync gets them out.
    for (const [id, files] of leaving) {
      const kept = files.filter((mediaId) => left.has(mediaId));
      if (kept.length) result.notRemovedThere++;
      else result.removedThere++;
      await noteLeftThere(id, here, kept);
    }
    const expired = (await libraryDb.images.toArray()).filter((row) => row.deletedAt && row.deletedAt <= cutoff);
    await purgeDeletedLibraryImages(expired.map((row) => row.id));
    return result;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('osg-library-sync', run) : run();
}

/** Notes the files of a deleted picture that `account` may still have; none clears the note. */
async function noteLeftThere(id: string, account: string, files: string[]): Promise<void> {
  await libraryDb.transaction('rw', libraryDb.images, async () => {
    const row = await libraryDb.images.get(id);
    if (!row?.deletedAt) return;
    const leftThere = { ...row.leftThere };
    if (files.length) leftThere[account] = files;
    else delete leftThere[account];
    await libraryDb.images.put({ ...row, leftThere: Object.keys(leftThere).length ? leftThere : undefined });
  });
}

async function removeLocal(row: LibraryImageRow): Promise<void> {
  const media = [row.sourceMediaId, row.maskMediaId, row.placed ? undefined : row.mediaId].filter((value): value is string => !!value);
  await libraryDb.images.delete(row.id);
  if (media.length) await db.media.bulkDelete(media);
}

/**
 * Deletes the media a row named before a newer version took its place and
 * names no more: an older mask, a photo it no longer has, and the older
 * picture unless an artboard may show it. A deleted row kept its picture only
 * for that reason.
 */
async function letGo(before: LibraryImageRow, after: LibraryImageRow | undefined): Promise<void> {
  const named = new Set([after?.mediaId, after?.sourceMediaId, after?.maskMediaId]);
  const picture = before.placed || before.deletedAt ? undefined : before.mediaId;
  const stale = [before.sourceMediaId, before.maskMediaId, picture].filter((id): id is string => !!id && !named.has(id));
  if (stale.length) await db.media.bulkDelete(stale);
}

async function fetchImage(remote: LibraryRemote, session: AccountSession, state: RemoteLibraryState, image: RemoteLibraryImage): Promise<void> {
  const picture = await remote.download(session, state, image.mediaId, image.mimeType);
  // The photo and mask come with it wherever the account has them. Without
  // them the picture could not be cut again here, and its next backup from
  // here would leave them out of the list, which takes them out of the
  // account. When one does not come down, neither does the picture this time.
  const whole = remote.keepsSources && hasOriginal(image, state);
  const source = whole ? await remote.download(session, state, image.sourceMediaId!, image.sourceMimeType ?? 'image/jpeg') : null;
  const mask = whole ? await remote.download(session, state, image.maskMediaId!, 'image/png') : null;
  const decoded = await decodePicture(picture);
  const thumb = await (await thumbnailOf(decoded.rgba, decoded.width, decoded.height)).arrayBuffer();
  const now = new Date();
  // The ids travel with the files, so the next sync finds them already here.
  await db.media.put({ id: image.mediaId, blob: picture, name: image.name, mimeType: image.mimeType, width: image.width, height: image.height, createdAt: now });
  if (source && mask) {
    await db.media.put({ id: image.sourceMediaId!, blob: source, name: image.name, mimeType: source.type || image.sourceMimeType || 'image/jpeg', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
    await db.media.put({ id: image.maskMediaId!, blob: mask, name: `${image.name} mask`, mimeType: 'image/png', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
  }
  const row: LibraryImageRow = {
    id: image.id,
    name: image.name,
    state: image.engine ? 'ready' : 'plain',
    mediaId: image.mediaId,
    width: image.width,
    height: image.height,
    thumb,
    sourceMediaId: whole ? image.sourceMediaId : undefined,
    sourceWidth: whole ? image.sourceWidth : undefined,
    sourceHeight: whole ? image.sourceHeight : undefined,
    maskMediaId: whole ? image.maskMediaId : undefined,
    settings: whole ? image.settings : undefined,
    rect: whole ? image.rect : undefined,
    engine: image.engine as LibraryImageRow['engine'],
    // A project from another computer may show this very picture.
    placed: true,
    createdAt: image.createdAt,
    updatedAt: image.updatedAt,
  };
  const before = await libraryDb.images.get(image.id);
  await libraryDb.images.put(row);
  if (before) await letGo(before, row);
  notifyMediaChanged();
}

/**
 * Brings down the photo and mask a picture here was cut from, which it came
 * back without, and gives them to it. Only while it is still the same picture:
 * one cut again or deleted meanwhile keeps what it has.
 */
async function fetchOriginal(remote: LibraryRemote, session: AccountSession, state: RemoteLibraryState, image: RemoteLibraryImage): Promise<void> {
  const sourceMediaId = image.sourceMediaId!;
  const maskMediaId = image.maskMediaId!;
  const source = await remote.download(session, state, sourceMediaId, image.sourceMimeType ?? 'image/jpeg');
  const mask = await remote.download(session, state, maskMediaId, 'image/png');
  const now = new Date();
  await db.media.put({ id: sourceMediaId, blob: source, name: image.name, mimeType: source.type || image.sourceMimeType || 'image/jpeg', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
  await db.media.put({ id: maskMediaId, blob: mask, name: `${image.name} mask`, mimeType: 'image/png', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
  const replaced = await libraryDb.transaction('rw', libraryDb.images, async () => {
    const row = await libraryDb.images.get(image.id);
    if (!row || row.deletedAt || row.mediaId !== image.mediaId || row.sourceMediaId === sourceMediaId) return null;
    // A name changed here stays: only what the picture was cut from changes.
    await libraryDb.images.put({
      ...row,
      sourceMediaId,
      sourceWidth: image.sourceWidth,
      sourceHeight: image.sourceHeight,
      maskMediaId,
      settings: image.settings ?? row.settings,
      rect: image.rect,
    });
    return row;
  });
  const current = await libraryDb.images.get(image.id);
  if (replaced) await letGo(replaced, current);
  else if (current?.sourceMediaId !== sourceMediaId) {
    const named = new Set([current?.mediaId, current?.sourceMediaId, current?.maskMediaId]);
    const unused = [sourceMediaId, maskMediaId].filter((id) => !named.has(id));
    if (unused.length) await db.media.bulkDelete(unused);
  }
  notifyMediaChanged();
}

/** Whether the signed in account can hold the pictures (both providers can). */
export function canBackUpLibrary(): boolean {
  const session = getSession();
  return !!session && !!getProvider(session.provider);
}
