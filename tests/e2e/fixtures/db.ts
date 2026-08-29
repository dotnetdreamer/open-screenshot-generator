import type { Page } from '@playwright/test';

/**
 * Direct access to the app's local database from a test.
 *
 * The editor keeps every project in Dexie (`ProjectDatabase`, src/database.ts),
 * so "did the edit persist" is answerable without a reload, and a test can
 * start from a known project instead of clicking one into existence.
 *
 * Everything here uses the raw IndexedDB API rather than Dexie: the test runs
 * in the page, the page's Dexie instance is a module-local binding the app
 * never exposes on `window`, and opening the same database a second time with
 * a version number would fight the app's own connection. Opening WITHOUT a
 * version joins whatever schema is already there, which is exactly what a test
 * wants.
 */

export const DB_NAME = 'ProjectDatabase';

/** The eight tables in src/database.ts. */
export type StoreName =
  | 'projects'
  | 'operations'
  | 'media'
  | 'fonts'
  | 'discoverPosts'
  | 'cloudLinks'
  | 'projectVersions'
  | 'accountLinks';

/** A project row, narrowed to the fields a test cares about. */
export interface StoredProject {
  id: string;
  name: string;
  timestamp: number;
  projectData: unknown;
}

/** Read every row of one table. */
export function readAll<T>(page: Page, store: StoreName): Promise<T[]> {
  return page.evaluate(
    ({ dbName, storeName }) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve([]);
            return;
          }
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            db.close();
            resolve(request.result as T[]);
          };
        };
      }),
    { dbName: DB_NAME, storeName: store }
  ) as Promise<T[]>;
}

/** Every project the editor has saved locally. */
export function readProjects(page: Page): Promise<StoredProject[]> {
  return readAll<StoredProject>(page, 'projects');
}

/** Write a row straight into a table. Reload the page for the app to see it. */
export async function put(page: Page, store: StoreName, row: unknown): Promise<void> {
  await page.evaluate(
    ({ dbName, storeName, value }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(value);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    { dbName: DB_NAME, storeName: store, value: row }
  );
}

/**
 * Wait until the editor has committed a project row that satisfies `predicate`.
 *
 * Saving is debounced behind `handleArtboardsUpdate`, so asserting on the
 * database straight after a click is a race. This polls instead.
 */
export async function waitForProject(
  page: Page,
  predicate: (project: StoredProject) => boolean,
  timeout = 15_000
): Promise<StoredProject> {
  const deadline = Date.now() + timeout;
  let last: StoredProject[] = [];
  while (Date.now() < deadline) {
    last = await readProjects(page);
    const hit = last.find(predicate);
    if (hit) return hit;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `No project matched within ${timeout}ms. ${last.length} row(s) present: ${last
      .map((p) => `${p.id}:${p.name}`)
      .join(', ')}`
  );
}

/**
 * Delete the whole database.
 *
 * Playwright gives every test a fresh browser context, so this is NOT needed
 * for isolation. It is here for the tests that reload mid-test and want the
 * app to take the empty-database branch again.
 */
export async function deleteDatabase(page: Page): Promise<void> {
  await page.evaluate(
    (dbName) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        // A live connection in the page blocks the delete. The caller reloads
        // straight after, which drops it, so do not hang here.
        request.onblocked = () => resolve();
      }),
    DB_NAME
  );
}
