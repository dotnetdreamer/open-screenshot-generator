// The lists the pictures' backup keeps beside the pictures, in the Drive folder
// or the gist: one list for each computer that backs up there,
// `library.<computer>.json`, and the older shared `library.json`.
//
// Each computer writes its own list and no other. Neither Drive nor a gist can
// refuse a write made over one the writer did not read, so with one shared list
// two computers backing up at the same moment could both read it, and the
// later write dropped the pictures of the earlier one (an audit, November
// 2026). Every computer reads every list, and src/lib/cutout/backup.ts merges
// them.
//
// `library.json` was that shared list, and the builds from before the lists
// read only it. Such a build that finds pictures missing from it takes their
// files out of the account, and one that finds no list at all takes out every
// picture it does not have itself. So library.json becomes a note those builds
// cannot read as a list (its `images` is null): they stop with an error before
// they change anything. A library.json that still has pictures in it, from such
// a build, is read as one more list until a newer build has taken it in.

import { AccountBlockedError, type RemoteLibraryList, type RemoteLibraryManifest } from './types';

/** The shared list from before, and the note it becomes. */
export const LEGACY_LIST = 'library.json';
/** What a list read from library.json is filed under. */
export const LEGACY_DEVICE = 'legacy';

const LIST_FILE = /^library\.([a-z0-9]{4,40})\.json$/;

/** The file a computer's list goes in. */
export function listFileName(device: string): string {
  return `library.${device}.json`;
}

/** The computer whose list a file is, or null for any other file. */
export function deviceOfListFile(name: string): string | null {
  return name.match(LIST_FILE)?.[1] ?? null;
}

/** The format the note has. A library.json with a later one was written by a newer build. */
const FENCE_FORMAT = 2;

/** library.json's text once the lists are there. */
export const FENCE_TEXT = JSON.stringify({
  formatVersion: FENCE_FORMAT,
  images: null,
  deleted: null,
  note: 'Each computer keeps its list of your pictures in a library file of its own next to this one. Update Open Screenshot Generator to back up your pictures.',
});

/** What a list file holds: a list, library.json's note, or nothing this build can read. */
export type ReadListFile = { kind: 'list'; list: RemoteLibraryList } | { kind: 'fence' } | { kind: 'unreadable' };

const NEWER = 'These pictures were backed up by a newer version of Open Screenshot Generator. Update the app to back up to this account';

const isEntryList = (value: unknown): value is unknown[] => Array.isArray(value);

/**
 * Reads one of the lists. A computer's list, or library.json: a list a build
 * from before wrote, or the note. One written by a newer build stops the sync,
 * and one that does not read as a list at all is reported as such (nothing is
 * taken out of the account while one is: what it names is not known).
 */
export function readListFile(name: string, text: string): ReadListFile {
  const device = name === LEGACY_LIST ? LEGACY_DEVICE : deviceOfListFile(name);
  if (!device) return { kind: 'unreadable' };
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { kind: 'unreadable' };
  }
  if (!value || typeof value !== 'object') return { kind: 'unreadable' };
  const format = typeof value.formatVersion === 'number' ? value.formatVersion : 1;
  if (device === LEGACY_DEVICE) {
    if (format > FENCE_FORMAT) throw new AccountBlockedError(NEWER);
    if (format === FENCE_FORMAT) return { kind: 'fence' };
    const legacy = value as unknown as RemoteLibraryManifest;
    if (!isEntryList(legacy.images)) return { kind: 'unreadable' };
    return {
      kind: 'list',
      list: {
        formatVersion: 1,
        device,
        updatedAt: typeof legacy.updatedAt === 'number' ? legacy.updatedAt : 0,
        seen: {},
        images: legacy.images,
        deleted: isEntryList(legacy.deleted) ? legacy.deleted : [],
      },
    };
  }
  if (format > 1) throw new AccountBlockedError(NEWER);
  const list = value as unknown as RemoteLibraryList;
  if (!isEntryList(list.images) || typeof list.updatedAt !== 'number') return { kind: 'unreadable' };
  return {
    kind: 'list',
    list: {
      ...list,
      // The file's name says whose it is.
      device,
      seen: list.seen && typeof list.seen === 'object' ? list.seen : {},
      deleted: isEntryList(list.deleted) ? list.deleted : [],
    },
  };
}
