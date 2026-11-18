// Where the playbook lives on this computer: a Dexie database of its own
// (`OpenScreenshotGeneratorStoreCompliance`), apart from the projects like
// Growth's and the Website's, so a project export or a cloud save never
// carries it and clearing it loses nothing GitHub cannot send again. Only the
// boxes ticked in the checklist are the user's own, and the code folder each
// project lets Claude Code read (codeFolder.ts), which is quick to pick again.
//
// The update (sync.ts) talks to a `RulesStore`, so the unit tests can give it
// one in memory; the app uses the Dexie one.

import Dexie, { type Table } from 'dexie';
import type { SyncCatalog, SyncHead, SyncNews, StoredFile } from './types';

interface MetaRow {
  key: string;
  value: unknown;
}

/** A ticked box: the checklist (a project, by id) and the item. */
export interface TickRow {
  key: string;
  list: string;
  item: string;
  at: number;
  /** Set when the box was marked as not applying, with the user's reason. */
  na?: string;
}

/** A box's state: ticked, or not applying with a reason. */
export interface Tick {
  at: number;
  na?: string;
}

/** Everything one update writes, in one transaction. */
export interface RulesCommit {
  put: StoredFile[];
  remove: string[];
  head: SyncHead;
  catalog?: SyncCatalog;
  news?: SyncNews | null;
}

export interface RulesStore {
  readHead(): Promise<SyncHead | null>;
  writeHead(head: SyncHead): Promise<void>;
  readCatalog(): Promise<SyncCatalog | null>;
  readNews(): Promise<SyncNews | null>;
  writeNews(news: SyncNews | null): Promise<void>;
  readFiles(): Promise<StoredFile[]>;
  readFile(path: string): Promise<StoredFile | undefined>;
  /** A guide read after the update, outside its transaction. */
  putFile(file: StoredFile): Promise<void>;
  commit(update: RulesCommit): Promise<void>;
}

class RulesDatabase extends Dexie {
  files!: Table<StoredFile, string>;
  meta!: Table<MetaRow, string>;
  ticks!: Table<TickRow, string>;

  constructor() {
    super('OpenScreenshotGeneratorStoreCompliance');
    this.version(1).stores({
      files: 'path',
      meta: 'key',
      ticks: 'key, list',
    });
  }
}

let instance: RulesDatabase | null = null;

function db(): RulesDatabase {
  if (!instance) instance = new RulesDatabase();
  return instance;
}

async function readMeta<T>(key: string): Promise<T | null> {
  const row = await db().meta.get(key);
  return (row?.value as T | undefined) ?? null;
}

export const dexieRulesStore: RulesStore = {
  readHead: () => readMeta<SyncHead>('head'),
  writeHead: async (head) => {
    await db().meta.put({ key: 'head', value: head });
  },
  readCatalog: () => readMeta<SyncCatalog>('catalog'),
  readNews: () => readMeta<SyncNews>('news'),
  writeNews: async (news) => {
    if (news) await db().meta.put({ key: 'news', value: news });
    else await db().meta.delete('news');
  },
  readFiles: () => db().files.toArray(),
  readFile: (path) => db().files.get(path),
  putFile: async (file) => {
    await db().files.put(file);
  },
  commit: async (update) => {
    const database = db();
    await database.transaction('rw', database.files, database.meta, async () => {
      if (update.remove.length > 0) await database.files.bulkDelete(update.remove);
      if (update.put.length > 0) await database.files.bulkPut(update.put);
      await database.meta.put({ key: 'head', value: update.head });
      if (update.catalog) await database.meta.put({ key: 'catalog', value: update.catalog });
      if (update.news !== undefined) {
        if (update.news) await database.meta.put({ key: 'news', value: update.news });
        else await database.meta.delete('news');
      }
    });
  },
};

/** For the unit tests. */
export function memoryRulesStore(): RulesStore & { files: Map<string, StoredFile> } {
  const files = new Map<string, StoredFile>();
  let head: SyncHead | null = null;
  let catalog: SyncCatalog | null = null;
  let news: SyncNews | null = null;
  return {
    files,
    readHead: async () => head,
    writeHead: async (next) => {
      head = next;
    },
    readCatalog: async () => catalog,
    readNews: async () => news,
    writeNews: async (next) => {
      news = next;
    },
    readFiles: async () => [...files.values()],
    readFile: async (path) => files.get(path),
    putFile: async (file) => {
      files.set(file.path, file);
    },
    commit: async (update) => {
      for (const path of update.remove) files.delete(path);
      for (const file of update.put) files.set(file.path, file);
      head = update.head;
      if (update.catalog) catalog = update.catalog;
      if (update.news !== undefined) news = update.news;
    },
  };
}

// --- the checklist's ticks ------------------------------------------------------

export async function readTicks(list: string): Promise<Map<string, Tick>> {
  const rows = await db().ticks.where('list').equals(list).toArray();
  return new Map(rows.map((row) => [row.item, row.na ? { at: row.at, na: row.na } : { at: row.at }]));
}

/** Tick a box, mark it as not applying (`na`, the reason), or clear it (null). */
export async function setTick(list: string, item: string, tick: Tick | null): Promise<void> {
  const key = `${list}|${item}`;
  if (tick) await db().ticks.put({ key, list, item, ...tick });
  else await db().ticks.delete(key);
}

export async function clearTicks(list: string): Promise<void> {
  await db().ticks.where('list').equals(list).delete();
}

// --- the last check of a project --------------------------------------------

export async function readMetaValue<T>(key: string): Promise<T | null> {
  return readMeta<T>(key);
}

export async function writeMetaValue(key: string, value: unknown): Promise<void> {
  if (value === null || value === undefined) await db().meta.delete(key);
  else await db().meta.put({ key, value });
}

/** Every value whose key starts with `prefix`, such as each project's code folder. */
export async function readMetaValues<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
  const rows = await db().meta.where('key').startsWith(prefix).toArray();
  return rows.map((row) => ({ key: row.key, value: row.value as T }));
}
