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
//
// Two computers can back up at the same moment. Neither storage can refuse a
// write made over one the writer did not read, so each computer writes a list
// of its own and reads everyone's (src/lib/account/libraryFiles.ts): no write
// can drop another computer's pictures. The files are the one thing two
// backups share, and a file goes only when no list names it. Two rules keep
// that true while lists change under a sync:
//
// - A backup names every file it is about to send, or to keep for a picture
//   changed here, in its list (`sending`) before it sends any. Another backup
//   reads the lists after it looked at the files, so a file it saw is a file
//   it knows is wanted.
// - Taking files out and naming one are each checked afterwards, by the
//   computer that did it: one that took files out reads the lists again and
//   puts back any a list named meanwhile, and one that named files it did not
//   send looks again whether they are still there, and puts them back. Of two
//   computers doing these at once, whichever checks second sees what the
//   other did, so a file a picture needs never stays out.

import { db } from '@/database';
import { libraryDb } from './libraryDb';
import { getProvider, getSession, withFreshSession } from '@/lib/account';
import { ConnectionError } from '@/lib/account/transport';
import { LEGACY_DEVICE, LEGACY_LIST, listFileName } from '@/lib/account/libraryFiles';
import {
  AccountAuthError,
  type AccountSession,
  type CloudProviderId,
  type LibraryRemote,
  type RemoteLibraryImage,
  type RemoteLibraryList,
  type RemoteLibraryState,
} from '@/lib/account/types';
import { googleDriveLibrary } from '@/lib/account/providers/googleDrive';
import { githubLibrary } from '@/lib/account/providers/github';
import { getMediaAsset, notifyMediaChanged, type MediaAsset } from '@/lib/mediaStore';
import { isOutOfRoom, OUT_OF_ROOM, purgeDeletedLibraryImages, type LibraryImageRow } from './library';
import { decodePicture, thumbnailOf } from './picture';

const REMOTES: Record<CloudProviderId, LibraryRemote> = { google: googleDriveLibrary, github: githubLibrary };

/** Where the pictures go, in the words the button uses. */
export function libraryBackupLabel(provider: CloudProviderId): string {
  return provider === 'google' ? 'Google Drive' : 'GitHub';
}

const DAY = 24 * 60 * 60 * 1000;
/** A deletion is remembered this long, upstream and here, then forgotten. */
const TOMBSTONE_DAYS = 120;
/**
 * How long a list's `sending` keeps its files in: a backup takes minutes, and
 * this is that with room for a computer whose clock is days out. One that
 * never finished stops holding its files after this.
 */
const SENDING_DAYS = 7;

const DEVICE_KEY = 'osg.library.computer';
let windowDevice: string | undefined;

/**
 * This computer's name in the account's lists, made the first time and kept
 * with the browser's storage, so the list it writes is its own each time. A
 * browser that keeps nothing gets one for as long as the window is open.
 */
export function libraryDevice(): string {
  const made = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    const storage = globalThis.localStorage;
    if (storage) {
      const known = storage.getItem(DEVICE_KEY);
      if (known && /^[a-z0-9]{4,40}$/.test(known)) return known;
      const device = made();
      storage.setItem(DEVICE_KEY, device);
      return device;
    }
  } catch {
    // Storage refused (a private window): the window's own name below.
  }
  return (windowDevice ??= made());
}

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
  /**
   * Pictures brought down without the photo and mask the account lists for
   * them, because one of those files is missing there (taken out by hand,
   * say). They cannot be cut again from that photo here. The list keeps naming
   * both, so the one still there is not taken out, and a picture whose files
   * come back (out of the trash) gets them at the next backup.
   */
  withoutOriginal: number;
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
  if (result.withoutOriginal) {
    const one = result.withoutOriginal === 1;
    sentences.push(
      `${pictures(result.withoutOriginal)} came back without ${one ? 'its original photo' : 'their original photos'}, because ${where} is missing some of ${one ? 'its' : 'their'} files.`
    );
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

/** Each computer's latest list: its last backup's, or the one it has under way. */
function latestLists(lists: RemoteLibraryList[]): RemoteLibraryList[] {
  const latest = new Map<string, RemoteLibraryList>();
  for (const list of lists) {
    const had = latest.get(list.device);
    if (!had || list.updatedAt > had.updatedAt || (list.updatedAt === had.updatedAt && (list.sendingAt ?? 0) > (had.sendingAt ?? 0))) {
      latest.set(list.device, list);
    }
  }
  return [...latest.values()];
}

/**
 * The lists that say something: each computer's latest, less any another
 * list took in since (by its `seen`), whose pictures and deletions that one
 * holds already.
 */
export function currentLists(lists: RemoteLibraryList[]): RemoteLibraryList[] {
  const latest = latestLists(lists);
  return latest.filter((list) => !latest.some((other) => other !== list && (other.seen?.[list.device] ?? -1) >= list.updatedAt));
}

/**
 * Every computer's lists as one: each picture as it was changed last, and a
 * deletion over any picture not changed after it, the way the merge below
 * decides between this computer and the account. Two copies changed at the
 * same moment go by their file, so every computer picks the same one.
 */
export function mergeLists(lists: RemoteLibraryList[], cutoff: number): { images: RemoteLibraryImage[]; deleted: Array<{ id: string; at: number }> } {
  const current = currentLists(lists);
  const deleted = new Map<string, number>();
  for (const list of current) {
    for (const entry of list.deleted ?? []) if (entry.at > cutoff) deleted.set(entry.id, Math.max(deleted.get(entry.id) ?? 0, entry.at));
  }
  const images = new Map<string, RemoteLibraryImage>();
  for (const list of current) {
    for (const image of list.images ?? []) {
      const had = images.get(image.id);
      if (!had || image.updatedAt > had.updatedAt || (image.updatedAt === had.updatedAt && image.mediaId > had.mediaId)) images.set(image.id, image);
    }
  }
  for (const [id, image] of images) {
    const gone = deleted.get(id);
    if (gone !== undefined && image.updatedAt <= gone) images.delete(id);
  }
  return {
    images: [...images.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    deleted: [...deleted.entries()].map(([id, at]) => ({ id, at })),
  };
}

/**
 * Every file the lists want kept: their pictures' files, and the ones a
 * backup still under way is sending or keeping (a list's `sending`, up to
 * SENDING_DAYS old, even once another list took that list in).
 */
export function namedFiles(lists: RemoteLibraryList[], cutoff: number, now = Date.now()): Set<string> {
  const named = new Set(mergeLists(lists, cutoff).images.flatMap(filesOf));
  for (const list of latestLists(lists)) {
    if ((list.sendingAt ?? 0) > now - SENDING_DAYS * DAY) for (const id of list.sending ?? []) named.add(id);
  }
  return named;
}

/** The lists a list written now takes in: every other computer's it read, as it read it. */
const seenOf = (lists: RemoteLibraryList[], device: string): Record<string, number> =>
  Object.fromEntries(latestLists(lists).filter((list) => list.device !== device).map((list) => [list.device, list.updatedAt]));

/** The photo and mask a picture here was cut from, when this computer has both of them. */
async function ownOriginal(row: LibraryImageRow): Promise<{ source: MediaAsset; mask: MediaAsset } | undefined> {
  if (!row.sourceMediaId || !row.maskMediaId) return undefined;
  const [source, mask] = await Promise.all([getMediaAsset(row.sourceMediaId), getMediaAsset(row.maskMediaId)]);
  return source && mask ? { source, mask } : undefined;
}

/** Merges this device's pictures with the account's, both ways. */
export async function syncLibrary(onProgress?: (step: string) => void): Promise<SyncResult> {
  const run = async (): Promise<SyncResult> => {
    const stored = getSession();
    if (!stored) throw new AccountAuthError('Sign in to back up your pictures.');
    const session = await withFreshSession(stored);
    const remote = REMOTES[session.provider];
    const here = accountKey(session);
    const device = libraryDevice();
    const cutoff = Date.now() - TOMBSTONE_DAYS * DAY;
    onProgress?.('Looking at your backup');
    // The account as this sync found it, which everything below decides from.
    const first = await remote.read(session);
    let state = first;
    // The files this sync may take out: the ones there when it started. One
    // that turns up later was sent by another computer backing up meanwhile.
    const seen = new Set(first.mediaIds);
    const mine = latestLists(first.lists).find((list) => list.device === device);
    // This computer's own list is written again when it cannot be read.
    // Another one that cannot may name any file, so nothing is taken out.
    const ownFile = listFileName(device);
    const blindTo = (read: RemoteLibraryState) => read.unreadable.some((name) => name !== ownFile);
    const manifest = mergeLists(first.lists, cutoff);
    // Each list this computer writes is later than the one before, by its clock.
    let stamped = mine?.updatedAt ?? 0;
    const stamp = () => (stamped = Math.max(Date.now(), stamped + 1));

    const localRows = await libraryDb.images.toArray();
    const local = new Map(localRows.map((row) => [row.id, row]));
    const remoteImages = new Map(manifest.images.map((image) => [image.id, image]));
    const deletedAt = new Map<string, number>();
    for (const entry of manifest.deleted) deletedAt.set(entry.id, entry.at);
    for (const row of localRows) if (row.deletedAt) deletedAt.set(row.id, Math.max(deletedAt.get(row.id) ?? 0, row.deletedAt));

    const result: SyncResult = {
      uploaded: 0,
      downloaded: 0,
      notDownloaded: 0,
      removed: 0,
      removedThere: 0,
      notRemovedThere: 0,
      notRenamedThere: 0,
      withoutOriginal: 0,
    };
    const finalImages = new Map<string, RemoteLibraryImage>();
    const toSend: Array<{ mediaId: string; blob: Blob; mimeType: string; name: string }> = [];
    // The versions this sync sends: the ones here that are newer than the account's.
    const sent: RemoteLibraryImage[] = [];
    // Each with the row here as this merge saw it, which the restore checks
    // again before it writes over it.
    const toFetch: Array<{ image: RemoteLibraryImage; seen: LibraryImageRow | undefined }> = [];
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
          if (await removeLocal(row, gone)) result.removed++;
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
      const own = remote.keepsSources && row && !row.deletedAt ? await ownOriginal(row) : undefined;
      // This very picture (the same file) is listed in the account with a
      // photo and mask this computer cannot send in their place: a restore
      // whose photo did not come down, one that came back without them
      // because the account is missing one of the two, a copy of the picture
      // standing in as its photo since, or a photo or mask whose file went
      // missing here. The account's are the ones it was cut from, so they
      // stay in the list even when this computer sends the picture again (a
      // rename), and the one still there is never taken for a file nothing
      // names. When the account has both, they come down as well.
      const originalThere =
        remote.keepsSources && row && !row.deletedAt && up && row.mediaId === up.mediaId && up.sourceMediaId
        && (row.sourceMediaId !== up.sourceMediaId || row.maskMediaId !== up.maskMediaId || !own)
          ? up
          : undefined;
      const original = originalThere && hasOriginal(originalThere, state) ? originalThere : undefined;
      if (usable && (!up || row.updatedAt > up.updatedAt || fileMissing)) {
        const picture = await getMediaAsset(row.mediaId as string);
        if (!picture) {
          // Its file is missing here: the account's version stays listed, so
          // its files are not taken for ones nothing names.
          if (up) finalImages.set(id, up);
          continue;
        }
        toSend.push({ mediaId: picture.id, blob: picture.blob, mimeType: picture.mimeType, name: row.name });
        let entry: RemoteLibraryImage;
        if (originalThere) {
          entry = { ...toRemote(row, picture.mimeType, undefined, false), ...originalOf(originalThere) };
          if (original) toRepair.push(original);
        } else {
          entry = toRemote(row, picture.mimeType, own?.source.mimeType, !!own);
          if (own) {
            toSend.push({ mediaId: own.source.id, blob: own.source.blob, mimeType: own.source.mimeType, name: photoName(row.name) });
            toSend.push({ mediaId: own.mask.id, blob: own.mask.blob, mimeType: own.mask.mimeType, name: maskName(row.name) });
          }
        }
        finalImages.set(id, entry);
        sent.push(entry);
        if (!up || !state.mediaIds.has(picture.id)) result.uploaded++;
      } else if (up) {
        finalImages.set(id, up);
        if (!row || row.deletedAt || row.updatedAt < up.updatedAt || !row.mediaId) toFetch.push({ image: up, seen: row });
        else if (original) toRepair.push(original);
      } else if (row && !row.deletedAt) {
        // Not finished here yet (waiting or failed): it goes up next time.
      }
    }

    // Before anything goes up: this computer's list names every file its
    // newer versions use, the ones about to be sent and the ones already
    // there, so a backup elsewhere keeps them. Its pictures stay the last
    // backup's until this one has sent the new ones.
    const sending = [...new Set(sent.flatMap(filesOf))];
    if (sending.length) {
      if (!state.handle) state = await remote.upload(session, state, [], { device });
      state = await remote.writeList(session, state, {
        ...(mine ?? { formatVersion: 1, device, updatedAt: 0, seen: {}, images: [], deleted: [] }),
        device,
        sending,
        sendingAt: Date.now(),
      });
      // A file those versions keep that another computer took out since this
      // sync looked (it went by an older list) comes back; one that cannot
      // goes up again from here below, where this computer has it.
      const kept = sending.filter((id) => seen.has(id));
      if (kept.length) {
        let now = await remote.refresh(session, state);
        const gone = kept.filter((id) => !now.mediaIds.has(id));
        if (gone.length) {
          await remote.restore(session, first, gone);
          now = await remote.refresh(session, state);
        }
        state = now;
      }
    }

    if (toSend.length) {
      onProgress?.('Sending pictures');
      // What the account holds once this sync is done: a gist counts these
      // against its file limit, not the old versions about to go.
      const kept = new Set([...finalImages.values()].flatMap(filesOf));
      state = await remote.upload(session, state, toSend, { kept, device });
    }
    // One picture that cannot come down (its file gone from the account, a
    // file the app cannot read, a connection that dropped) does not stop the
    // others; the list keeps it, so the next sync tries again.
    const notBack = (image: RemoteLibraryImage, error: unknown) => {
      if (error instanceof AccountAuthError) throw error;
      console.error('Bringing a picture back failed', image.id, error);
      result.notDownloaded++;
      result.problem ??= reasonOf(error);
    };
    for (const { image, seen: row } of toFetch) {
      onProgress?.(`Bringing back ${image.name}`);
      try {
        const brought = await fetchImage(remote, session, state, image, row);
        // Changed here while it came down: that change is newer, and the next
        // backup sends it.
        if (brought === 'changed here') continue;
        result.downloaded++;
        if (brought === 'without original') result.withoutOriginal++;
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

    // This computer's list: every picture as this sync leaves it, and the
    // deletions still remembered. It takes in every list read at the start.
    const next: RemoteLibraryList = {
      formatVersion: 1,
      device,
      updatedAt: stamp(),
      seen: seenOf(first.lists, device),
      images: [...finalImages.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      deleted: [...deletedAt.entries()].filter(([, at]) => at > cutoff).map(([id, at]) => ({ id, at })),
    };
    if (!state.handle) state = await remote.upload(session, state, [], { device });
    // Noted before the list stops naming them: a sync that stops after the
    // write (a sign-in that ran out) still knows next time what to take out.
    for (const [id, files] of leaving) await noteLeftThere(id, here, files);
    // library.json becomes the note now that this list holds its pictures,
    // unless it could not be read.
    state = await remote.writeList(session, state, next, { fence: !first.unreadable.includes(LEGACY_LIST) });
    // A file whose name no longer matches its picture (renamed here, or named
    // by its media id) gets the picture's name.
    if (remote.rename) {
      const renamed = await remote.rename(session, state, next.images.flatMap(namedFilesOf));
      state = renamed.state;
      const kept = new Set(renamed.left);
      result.notRenamedThere = next.images.filter((image) => filesOf(image).some((mediaId) => kept.has(mediaId))).length;
    }

    // Files no list names any more: the old versions of changed pictures, and
    // deleted pictures'. Only files this sync saw at the start, and only while
    // every list can be read.
    let wanted = namedFiles([...first.lists, next], cutoff);
    let latest = state;
    const removed = new Set<string>();
    const candidates = blindTo(first) ? [] : [...seen].filter((id) => state.mediaIds.has(id) && !wanted.has(id));
    if (candidates.length) {
      // The lists as they are now, which another computer may have changed.
      const before = await remote.refresh(session, state);
      latest = before;
      if (!blindTo(before)) {
        wanted = namedFiles([...before.lists, next], cutoff);
        const orphans = candidates.filter((id) => before.mediaIds.has(id) && !wanted.has(id));
        const refused = new Set(orphans.length ? await remote.remove(session, before, orphans) : []);
        const out = orphans.filter((id) => !refused.has(id));
        if (out.length) {
          // And again once they are out: one a list named meanwhile comes back.
          const after = await remote.refresh(session, before);
          const blind = blindTo(after);
          wanted = namedFiles([...after.lists, next], cutoff);
          const back = out.filter((id) => blind || wanted.has(id));
          const notBack = new Set(back.length ? await remote.restore(session, before, back) : []);
          for (const id of notBack) console.error('A file another computer wants could not be put back', id);
          for (const id of out) if (!back.includes(id) || notBack.has(id)) removed.add(id);
        }
      }
    }

    // A deletion counts once its files are out of this account. One whose
    // files are still there keeps them noted until a sync gets them out. One
    // whose files a list wants again was changed on another computer after
    // it was deleted here: that change is the later one, so the picture stays
    // there and comes back here at the next backup.
    for (const [id, files] of leaving) {
      if (files.some((mediaId) => wanted.has(mediaId))) {
        await noteLeftThere(id, here, []);
        continue;
      }
      const kept = files.filter((mediaId) => latest.mediaIds.has(mediaId) && !removed.has(mediaId));
      if (kept.length) result.notRemovedThere++;
      else result.removedThere++;
      await noteLeftThere(id, here, kept);
    }
    // A gist holds 300 files: the lists this one took in that no computer has
    // written for as long as a deletion is remembered go.
    if (remote.dropLists && !blindTo(first)) {
      const old = latestLists(first.lists).filter(
        (list) => list.device !== device && list.device !== LEGACY_DEVICE && list.updatedAt < cutoff && (list.sendingAt ?? 0) < cutoff
      );
      if (old.length) {
        await remote.dropLists(session, state, old.map((list) => list.device)).catch((error) => {
          if (error instanceof AccountAuthError) throw error;
          console.error('Taking old lists out of the gist failed', error);
        });
      }
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

/**
 * Takes a picture off this computer that another one deleted after its last
 * change. The row is read again in the write: one changed here since the
 * merge read it (an edit saved, a rename) is newer than that deletion, so it
 * stays and the next backup sends it. Whether an artboard may show the
 * picture is read then too, so one put on an artboard meanwhile keeps its
 * file. False when the picture stayed.
 */
async function removeLocal(seenRow: LibraryImageRow, gone: number): Promise<boolean> {
  const removed = await libraryDb.transaction('rw', libraryDb.images, async () => {
    const row = await libraryDb.images.get(seenRow.id);
    if (!row || row.deletedAt || row.updatedAt > gone || !unchanged(row, seenRow)) return null;
    await libraryDb.images.delete(row.id);
    return row;
  });
  if (!removed) return false;
  const media = [removed.sourceMediaId, removed.maskMediaId, removed.placed ? undefined : removed.mediaId].filter(
    (value): value is string => !!value
  );
  if (media.length) await db.media.bulkDelete(media);
  return true;
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

/**
 * Media rows this restore writes, by id: the ones that were not here before,
 * which go again when the restore does not finish. One that was here before
 * (an older picture an artboard shows, a file of this very picture) stays.
 */
function newMedia() {
  const added: string[] = [];
  return {
    async put(row: Parameters<typeof db.media.put>[0]): Promise<void> {
      const here = !!(await db.media.get(row.id));
      await db.media.put(row);
      if (!here) added.push(row.id);
    },
    /** Takes out the ones added that `keep` does not name. */
    async undo(keep?: LibraryImageRow): Promise<void> {
      const named = new Set([keep?.mediaId, keep?.sourceMediaId, keep?.maskMediaId]);
      const unused = added.filter((id) => !named.has(id));
      if (unused.length) await db.media.bulkDelete(unused).catch((error) => console.error('Clearing the files of a picture that did not come back failed', error));
    },
  };
}

/** Whether the row here is still the one the merge saw: nothing saved, renamed, cut or deleted since. */
const unchanged = (now: LibraryImageRow | undefined, seen: LibraryImageRow | undefined): boolean =>
  !now ? !seen : !!seen && now.updatedAt === seen.updatedAt && !!now.deletedAt === !!seen.deletedAt && now.mediaId === seen.mediaId;

/** Whether the only change since the merge saw the row is its name. */
const onlyRenamed = (now: LibraryImageRow | undefined, seen: LibraryImageRow | undefined): now is LibraryImageRow =>
  !!now && !!seen && !now.deletedAt && !seen.deletedAt && now.name !== seen.name && now.mediaId === seen.mediaId
  && now.sourceMediaId === seen.sourceMediaId && now.maskMediaId === seen.maskMediaId && now.state === seen.state;

/**
 * Brings a picture down and keeps it in place of the row here, which the
 * merge saw as `seen`. That row may have changed while the files came down
 * (an edit saved, a deletion): the change here is newer then, so the restore
 * keeps nothing, and the next backup sends that change. A name changed
 * meanwhile is kept, with the restored picture. 'without original' when the
 * account lists a photo and mask for it that it does not have both of.
 */
async function fetchImage(
  remote: LibraryRemote,
  session: AccountSession,
  state: RemoteLibraryState,
  image: RemoteLibraryImage,
  seen: LibraryImageRow | undefined
): Promise<'whole' | 'without original' | 'changed here'> {
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
  const written = newMedia();
  try {
    // The ids travel with the files, so the next sync finds them already here.
    await written.put({ id: image.mediaId, blob: picture, name: image.name, mimeType: image.mimeType, width: image.width, height: image.height, createdAt: now });
    if (source && mask) {
      await written.put({ id: image.sourceMediaId!, blob: source, name: image.name, mimeType: source.type || image.sourceMimeType || 'image/jpeg', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
      await written.put({ id: image.maskMediaId!, blob: mask, name: `${image.name} mask`, mimeType: 'image/png', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
    }
  } catch (error) {
    await written.undo(await libraryDb.images.get(image.id));
    throw error;
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
  let outcome: { before: LibraryImageRow | undefined; kept: LibraryImageRow } | { changed: LibraryImageRow | undefined };
  try {
    outcome = await libraryDb.transaction('rw', libraryDb.images, async () => {
      const current = await libraryDb.images.get(image.id);
      if (unchanged(current, seen)) {
        await libraryDb.images.put(row);
        return { before: current, kept: row };
      }
      if (onlyRenamed(current, seen)) {
        // The new name is the later change: it stays, and goes up next time.
        const renamed = { ...row, name: current.name, updatedAt: Math.max(current.updatedAt, image.updatedAt + 1) };
        await libraryDb.images.put(renamed);
        return { before: current, kept: renamed };
      }
      return { changed: current };
    });
  } catch (error) {
    await written.undo(await libraryDb.images.get(image.id));
    throw error;
  }
  if ('changed' in outcome) {
    await written.undo(outcome.changed);
    return 'changed here';
  }
  if (outcome.before) await letGo(outcome.before, outcome.kept);
  notifyMediaChanged();
  return !whole && remote.keepsSources && (image.sourceMediaId || image.maskMediaId) ? 'without original' : 'whole';
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
  const written = newMedia();
  try {
    await written.put({ id: sourceMediaId, blob: source, name: image.name, mimeType: source.type || image.sourceMimeType || 'image/jpeg', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
    await written.put({ id: maskMediaId, blob: mask, name: `${image.name} mask`, mimeType: 'image/png', width: image.sourceWidth, height: image.sourceHeight, createdAt: now });
  } catch (error) {
    await written.undo(await libraryDb.images.get(image.id));
    throw error;
  }
  const replaced = await libraryDb
    .transaction('rw', libraryDb.images, async () => {
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
    })
    .catch(async (error) => {
      await written.undo(await libraryDb.images.get(image.id));
      throw error;
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
