// Where a tab's undo stack waits while the tab is out of memory.
//
// Rule 28 holds: the undo stack belongs to one sitting and starts over on a
// reload. What changes with tabs is that a tab can leave memory without the
// sitting ending: it sleeps (parking.ts), it is closed and may be reopened, or
// it moves to another window. Each of those writes the tab's stack here once,
// at that moment, and opening the tab again reads it back. Nothing is written
// while a tab is in memory, so the open tab costs no writes at all.
//
// A stack counts only while the window that wrote it is alive (its presence
// lock, presence.ts), or when it was written for another window to take (a
// hand-over). A reload ends a window, so its stacks stop counting and the next
// start deletes them: undo after a reload starts over, as it always has. The
// window that reads a stack takes it over, so it then ends with that window.
//
// Every undo entry is a whole-project snapshot and a stack can hold a hundred
// of them, so a stack is stored as one row per entry plus one row naming them
// in order. An entry never changes once made, so writing the same tab's stack
// again (it woke, then slept again) writes only the entries that are new and
// deletes the ones that left.

import Dexie, { type Table } from 'dexie';
import {
  HISTORY_LIMIT,
  HISTORY_MAX_BYTES,
  type HistoryEntry,
} from '@/lib/historyLabels';
import type { ArtboardState } from '@/types/artboard';

/** Bumped when an entry's shape changes in a way old snapshots cannot follow. */
const FORMAT = 1;

/** What a save takes: the stack as the editor holds it. */
export interface UndoSnapshot {
  history: HistoryEntry[];
  historyIndex: number;
  selectedElementIds: string[];
  /** Nothing has been edited since the project was opened (see openedSnapshot). */
  unedited: boolean;
}

/** What a load gives back. */
export interface StoredUndo extends UndoSnapshot {
  /** This window wrote it, so the "Before this session" version is already decided. */
  sameSitting: boolean;
  savedAt: number;
}

export interface StackRow {
  projectId: string;
  /** Entry keys, bottom of the stack first. */
  keys: string[];
  index: number;
  selected: string[];
  unedited: boolean;
  /** The window that wrote it (EDITOR_WINDOW_ID). */
  sitting: string;
  /** Written for another window to take, so it counts whoever is alive. */
  handOver: boolean;
  /** The app version that wrote it. */
  build: string;
  format: number;
  savedAt: number;
}

export interface EntryRow {
  key: string;
  projectId: string;
  entry: HistoryEntry;
}

/** The reads and writes one save or load makes, all inside one transaction. */
export interface UndoTx {
  getStack(projectId: string): Promise<StackRow | undefined>;
  putStack(row: StackRow): Promise<unknown>;
  deleteStack(projectId: string): Promise<unknown>;
  entriesOf(projectId: string): Promise<EntryRow[]>;
  putEntries(rows: EntryRow[]): Promise<unknown>;
  deleteEntries(keys: string[]): Promise<unknown>;
  deleteEntriesOf(projectId: string): Promise<unknown>;
  allStacks(): Promise<StackRow[]>;
}

export interface UndoStorage {
  transaction<T>(work: (tx: UndoTx) => Promise<T>): Promise<T>;
}

export interface SaveOptions {
  /** For another window to take: it counts even after this window is gone. */
  handOver?: boolean;
  /** Write once this settles (an idle moment), still in order with the loads after it. */
  after?: Promise<unknown>;
}

export interface UndoStore {
  /** Write a project's stack. Saves and loads of one project run in the order asked for. */
  save(projectId: string, snapshot: UndoSnapshot, options?: SaveOptions): Promise<void>;
  /** Read a project's stack. Null when there is none that counts. */
  load(projectId: string): Promise<StoredUndo | null>;
  /** Mark a stack already written as one for another window to take. */
  handOver(projectId: string): Promise<void>;
  remove(projectId: string): Promise<void>;
  /** Delete every stack `keep` says no to. Returns how many went. */
  prune(keep: (row: StackRow) => boolean): Promise<number>;
}

export interface UndoStoreOptions {
  /** The app version. A stack another version wrote is never used. */
  build: string;
  /** This window's id (EDITOR_WINDOW_ID). */
  sitting: string;
  /** The ids of the windows alive now, or null when this browser cannot tell. */
  liveSittings?: () => Promise<Set<string> | null>;
}

const randomKey = () => Math.random().toString(36).slice(2, 12);

export function createUndoStore(storage: UndoStorage, options: UndoStoreOptions): UndoStore {
  const { build, sitting } = options;
  // The key each entry was stored under. Entries are compared by identity:
  // the editor never changes one in place, it makes a new one.
  const keyOf = new WeakMap<HistoryEntry, string>();
  // One chain per project, so a load always sees the save asked for before it.
  const chains = new Map<string, Promise<unknown>>();

  const inOrder = <T,>(projectId: string, work: () => Promise<T>): Promise<T> => {
    const before = chains.get(projectId) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(work);
    chains.set(projectId, next);
    const settle = () => {
      if (chains.get(projectId) === next) chains.delete(projectId);
    };
    next.then(settle, settle);
    return next;
  };

  const save = (projectId: string, snapshot: UndoSnapshot, saveOptions: SaveOptions = {}) =>
    inOrder(projectId, async () => {
      await saveOptions.after?.catch(() => undefined);
      await storage.transaction(async (tx) => {
        if (snapshot.history.length === 0) return;
        const keys = snapshot.history.map((entry) => {
          let key = keyOf.get(entry);
          if (!key) {
            key = `${projectId}/${randomKey()}`;
            keyOf.set(entry, key);
          }
          return key;
        });
        const stored = await tx.getStack(projectId);
        // A stack another build wrote is replaced whole, never added to.
        const reusable = stored && stored.format === FORMAT && stored.build === build;
        const had = new Set(stored?.keys ?? []);
        const fresh: EntryRow[] = [];
        snapshot.history.forEach((entry, i) => {
          if (!reusable || !had.has(keys[i])) fresh.push({ key: keys[i], projectId, entry });
        });
        if (fresh.length > 0) await tx.putEntries(fresh);
        const keep = new Set(keys);
        const gone = [...had].filter((key) => !keep.has(key));
        if (gone.length > 0) await tx.deleteEntries(gone);
        await tx.putStack({
          projectId,
          keys,
          index: Math.max(0, Math.min(keys.length - 1, snapshot.historyIndex)),
          selected: snapshot.selectedElementIds,
          unedited: snapshot.unedited,
          sitting,
          handOver: saveOptions.handOver === true,
          build,
          format: FORMAT,
          savedAt: Date.now(),
        });
      });
    });

  const load = (projectId: string) =>
    inOrder(projectId, async () => {
      // Asked before the transaction, which must not wait on anything else.
      const live = await (options.liveSittings?.() ?? Promise.resolve(null)).catch(() => null);
      return storage.transaction(async (tx): Promise<StoredUndo | null> => {
        const stack = await tx.getStack(projectId);
        if (!stack) return null;
        const counts =
          stack.format === FORMAT &&
          stack.build === build &&
          stack.keys.length > 0 &&
          (stack.handOver || stack.sitting === sitting || live?.has(stack.sitting) === true);
        if (!counts) {
          // Left by a window that has gone (a reload ends one), or by another
          // version of the app: nobody will ask for it again.
          await tx.deleteEntriesOf(projectId);
          await tx.deleteStack(projectId);
          return null;
        }
        const rows = await tx.entriesOf(projectId);
        const byKey = new Map(rows.map((row) => [row.key, row]));
        const history: HistoryEntry[] = [];
        for (const key of stack.keys) {
          const row = byKey.get(key);
          // A stack missing an entry cannot be trusted to undo correctly.
          if (!row) return null;
          // The key becomes the id: ids are a per-window counter, so one written
          // by another window could equal an id this window has handed out.
          const entry: HistoryEntry = { ...row.entry, id: key };
          keyOf.set(entry, key);
          history.push(entry);
        }
        // Another window's stack (handed over, or left when it closed the tab)
        // is this window's from now on, so it ends with this window: a reload
        // here starts undo over, as rule 28 says, and nobody else takes it.
        if (stack.sitting !== sitting || stack.handOver) {
          await tx.putStack({ ...stack, sitting, handOver: false });
        }
        return {
          history,
          historyIndex: Math.max(0, Math.min(history.length - 1, stack.index)),
          selectedElementIds: stack.selected ?? [],
          unedited: stack.unedited,
          sameSitting: stack.sitting === sitting,
          savedAt: stack.savedAt,
        };
      });
    });

  const handOver = (projectId: string) =>
    inOrder(projectId, () =>
      storage.transaction(async (tx) => {
        const stack = await tx.getStack(projectId);
        if (stack && !stack.handOver) await tx.putStack({ ...stack, handOver: true });
      })
    );

  const remove = (projectId: string) =>
    inOrder(projectId, () =>
      storage.transaction(async (tx) => {
        await tx.deleteEntriesOf(projectId);
        await tx.deleteStack(projectId);
      })
    );

  const prune = (keep: (row: StackRow) => boolean) =>
    storage.transaction(async (tx) => {
      let removed = 0;
      for (const stack of await tx.allStacks()) {
        if (keep(stack)) continue;
        await tx.deleteEntriesOf(stack.projectId);
        await tx.deleteStack(stack.projectId);
        removed += 1;
      }
      return removed;
    });

  return { save, load, handOver, remove, prune };
}

/**
 * A stored stack, carried on to the document that was actually read.
 *
 * Normally the two agree: the stack was written as the tab left memory, after
 * the document's last change. They differ when the project changed somewhere
 * that kept no stack. The document read is the truth either way, so it goes on
 * top as one more state, and undo steps back from it into the stored history.
 */
export function resumeUndo(
  stored: StoredUndo,
  document: ArtboardState[],
  makeEntry: (artboards: ArtboardState[]) => HistoryEntry
): { history: HistoryEntry[]; historyIndex: number; matched: boolean } {
  const current = stored.history[stored.historyIndex];
  if (current && JSON.stringify(current.artboards) === JSON.stringify(document)) {
    return { history: stored.history, historyIndex: stored.historyIndex, matched: true };
  }
  let history = [...stored.history.slice(0, stored.historyIndex + 1), makeEntry(document)];
  if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);
  let total = 0;
  for (const entry of history) total += entry.bytes;
  let drop = 0;
  while (drop < history.length - 1 && total > HISTORY_MAX_BYTES) {
    total -= history[drop].bytes;
    drop += 1;
  }
  if (drop > 0) history = history.slice(drop);
  return { history, historyIndex: history.length - 1, matched: false };
}

// --- IndexedDB -----------------------------------------------------------------

class UndoDatabase extends Dexie {
  stacks!: Table<StackRow, string>;
  entries!: Table<EntryRow, string>;

  constructor() {
    // Its own database, so a change to the project database's schema and this
    // never have to be migrated together.
    super('OpenScreenshotGeneratorUndo');
    this.version(1).stores({
      stacks: 'projectId, savedAt',
      entries: 'key, projectId',
    });
  }
}

let undoDatabase: UndoDatabase | null = null;

/** The store's tables in IndexedDB. Opened on first use. */
export function indexedDbUndoStorage(): UndoStorage {
  return {
    transaction(work) {
      undoDatabase ??= new UndoDatabase();
      const database = undoDatabase;
      return database.transaction('rw', database.stacks, database.entries, () =>
        work({
          getStack: (projectId) => database.stacks.get(projectId),
          putStack: (row) => database.stacks.put(row),
          deleteStack: (projectId) => database.stacks.delete(projectId),
          entriesOf: (projectId) => database.entries.where('projectId').equals(projectId).toArray(),
          putEntries: (rows) => database.entries.bulkPut(rows),
          deleteEntries: (keys) => database.entries.bulkDelete(keys),
          deleteEntriesOf: (projectId) => database.entries.where('projectId').equals(projectId).delete(),
          allStacks: () => database.stacks.toArray(),
        })
      );
    },
  };
}
