// The SEO view's own database, kept apart from projects (rule 1 would drop
// anything stored on a Project) and from Growth's store numbers.
//
// sites: the sites the user checks. runs: the last few checks of each site.
// files: the claude-seo knowledge files, each as the git hash says it should
// be. meta: the sync head and catalog, Google numbers and the last plan.

import Dexie, { type Table } from 'dexie';
import type { SeoSite, SiteRun } from './types';

export interface StoredFile {
  path: string;
  sha: string;
  size: number;
  text: string;
  fetchedAt: number;
}

interface MetaRow {
  key: string;
  value: unknown;
}

class SeoDatabase extends Dexie {
  sites!: Table<SeoSite, string>;
  runs!: Table<SiteRun, string>;
  files!: Table<StoredFile, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('OpenScreenshotGeneratorSeo');
    this.version(1).stores({
      sites: 'id, addedAt',
      runs: 'id, siteId, finishedAt, [siteId+finishedAt]',
      files: 'path',
      meta: 'key',
    });
  }
}

let instance: SeoDatabase | null = null;
function db(): SeoDatabase {
  instance ??= new SeoDatabase();
  return instance;
}

/** How many checks of one site are kept, newest first: enough for "since last time". */
export const RUNS_KEPT = 5;

export async function readSites(): Promise<SeoSite[]> {
  return (await db().sites.toArray()).sort((a, b) => a.addedAt - b.addedAt);
}

export async function putSite(site: SeoSite): Promise<void> {
  await db().sites.put(site);
}

/** Remove a site and everything kept about it. */
export async function removeSite(id: string): Promise<void> {
  await db().transaction('rw', db().sites, db().runs, db().meta, async () => {
    await db().sites.delete(id);
    await db().runs.where('siteId').equals(id).delete();
    const keys = (await db().meta.toCollection().primaryKeys()).filter((key) => String(key).endsWith(`:${id}`));
    await db().meta.bulkDelete(keys as string[]);
  });
}

export async function readRuns(siteId: string): Promise<SiteRun[]> {
  const runs = await db().runs.where('siteId').equals(siteId).toArray();
  return runs.sort((a, b) => b.finishedAt - a.finishedAt);
}

/** Keep a run and drop the oldest beyond RUNS_KEPT, in one transaction. */
export async function putRun(run: SiteRun): Promise<void> {
  await db().transaction('rw', db().runs, async () => {
    await db().runs.put(run);
    const runs = (await db().runs.where('siteId').equals(run.siteId).toArray()).sort((a, b) => b.finishedAt - a.finishedAt);
    const extra = runs.slice(RUNS_KEPT).map((old) => old.id);
    if (extra.length) await db().runs.bulkDelete(extra);
  });
}

export async function readMeta<T>(key: string): Promise<T | null> {
  return ((await db().meta.get(key))?.value as T | undefined) ?? null;
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  if (value === null || value === undefined) await db().meta.delete(key);
  else await db().meta.put({ key, value });
}

// --- the knowledge files ---------------------------------------------------

export interface SyncHead {
  commit: string | null;
  etag: string | null;
  checkedAt: number | null;
  attemptedAt: number;
  waitUntil: number | null;
  problem: { kind: 'offline' | 'limited' | 'broken' | 'failed'; at: number; path?: string; commit?: string } | null;
}

export interface SyncCatalog {
  commit: string;
  /** Every file the app uses at that commit, with its git hash. */
  files: Record<string, { sha: string; size: number }>;
}

export interface KnowledgeCommit {
  put: StoredFile[];
  remove: string[];
  head: SyncHead;
  catalog: SyncCatalog;
}

/** Where the knowledge is kept. A plain object so the unit tests can hand in a memory one. */
export interface KnowledgeStore {
  readHead(): Promise<SyncHead | null>;
  writeHead(head: SyncHead): Promise<void>;
  readCatalog(): Promise<SyncCatalog | null>;
  readFiles(): Promise<StoredFile[]>;
  commit(update: KnowledgeCommit): Promise<void>;
}

export const dexieKnowledgeStore: KnowledgeStore = {
  readHead: () => readMeta<SyncHead>('head'),
  writeHead: (head) => writeMeta('head', head),
  readCatalog: () => readMeta<SyncCatalog>('catalog'),
  readFiles: () => db().files.toArray(),
  async commit(update) {
    await db().transaction('rw', db().files, db().meta, async () => {
      if (update.remove.length) await db().files.bulkDelete(update.remove);
      if (update.put.length) await db().files.bulkPut(update.put);
      await db().meta.put({ key: 'head', value: update.head });
      await db().meta.put({ key: 'catalog', value: update.catalog });
    });
  },
};

export function memoryKnowledgeStore(): KnowledgeStore & { files: Map<string, StoredFile> } {
  const files = new Map<string, StoredFile>();
  let head: SyncHead | null = null;
  let catalog: SyncCatalog | null = null;
  return {
    files,
    readHead: async () => head,
    writeHead: async (next) => {
      head = next;
    },
    readCatalog: async () => catalog,
    readFiles: async () => [...files.values()],
    commit: async (update) => {
      for (const path of update.remove) files.delete(path);
      for (const file of update.put) files.set(file.path, file);
      head = update.head;
      catalog = update.catalog;
    },
  };
}
