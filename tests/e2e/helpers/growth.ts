import { generateKeyPairSync } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';
import {
  SAMPLE_APP,
  sampleEvents,
  sampleListing,
  sampleRatings,
  sampleRecords,
  sampleReviews,
} from '../../fixtures/growthSample';

/**
 * Growth, as a spec reaches it: a view on the activity bar (ActivityBar.tsx),
 * its sections, the reason a disabled action gives, and a connected test
 * account whose numbers are written straight into the growth database.
 */

export const GROWTH_BUTTON = 'Growth: downloads, reviews and your store page';

/** The activity bar. */
export function views(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Views' });
}

export function viewButton(page: Page, name: 'Editor' | typeof GROWTH_BUTTON): Locator {
  return views(page).getByRole('button', { name, exact: true });
}

/** Switch to Growth with the activity bar. */
export async function openGrowth(page: Page): Promise<Locator> {
  await viewButton(page, GROWTH_BUTTON).click();
  const view = page.getByTestId('growth-view');
  await expect(view).toBeVisible();
  return view;
}

/** Switch back to the editor. Growth stays mounted, out of sight. */
export async function backToEditor(page: Page): Promise<void> {
  await viewButton(page, 'Editor').click();
  await expect(page.getByTestId('growth-view')).toBeHidden();
}

export function section(view: Locator, name: string): Locator {
  return view.getByRole('navigation', { name: 'Growth sections' }).getByRole('button', { name: new RegExp(`^${name}`) });
}

/**
 * The wrapper a disabled action sits in (`Gated` in GrowthShared.tsx), whose
 * data-gated-reason is the reason it shows on hover.
 */
export function gateOf(button: Locator): Locator {
  return button.locator('xpath=..');
}

// --- an App Store Connect key, as Apple writes the .p8 ---------------------------

interface Der {
  tag: number;
  body: Buffer;
  /** The element as it was read, header and all. */
  raw: Buffer;
}

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  return Buffer.from([0x82, length >> 8, length & 0xff]);
}

function der(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

/** The elements one after another in `bytes`. Lengths of up to two bytes, which is all a key needs. */
function readDer(bytes: Buffer): Der[] {
  const out: Der[] = [];
  let at = 0;
  while (at < bytes.length) {
    const tag = bytes[at];
    let length = bytes[at + 1];
    let header = 2;
    if (length & 0x80) {
      const count = length & 0x7f;
      length = 0;
      for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[at + 2 + index];
      header += count;
    }
    out.push({ tag, body: bytes.subarray(at + header, at + header + length), raw: bytes.subarray(at, at + header + length) });
    at += header + length;
  }
  return out;
}

/** The [0] parameters element naming prime256v1, which every .p8 from Apple carries. */
const P256_PARAMETERS = der(0xa0, der(0x06, Buffer.from('2a8648ce3d030107', 'hex')));

/**
 * A P-256 key in PKCS#8, shaped like the .p8 App Store Connect hands out.
 * Node writes the ECPrivateKey inside without its optional [0] parameters;
 * Apple's always has them, between the private key and the [1] public key,
 * and WebKit's WebCrypto refuses to import that shape directly, so a test key
 * without them would pass where every real key fails. 150 bytes of DER, as
 * Apple's are.
 */
export function appleShapedKey(): string {
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const [outer] = readDer(Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64'));
  const [version, algorithm, wrapped] = readDer(outer.body);
  const [ecPrivateKey] = readDer(wrapped.body);
  const [ecVersion, privateKey, ...rest] = readDer(ecPrivateKey.body);
  if (rest.some((element) => element.tag === 0xa0)) throw new Error('The key already names its curve');
  const body = Buffer.concat([ecVersion.raw, privateKey.raw, P256_PARAMETERS, ...rest.map((element) => element.raw)]);
  const shaped = der(0x30, Buffer.concat([version.raw, algorithm.raw, der(0x04, der(0x30, body))]));
  if (shaped.length !== 150) throw new Error(`The key came out as ${shaped.length} bytes, not Apple's 150`);
  const lines = shaped.toString('base64').match(/.{1,64}/g) ?? [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
}

/** The test account's key. Nothing checks its signature here; WebKit only has to import it. */
export const TEST_KEY = appleShapedKey();

/** The test account lists one app, the fixture's. Anything else Apple is asked answers 404. */
export const TEST_ACCOUNT_RULES: TauriHttpRule[] = [
  {
    match: '^GET https://api\\.appstoreconnect\\.apple\\.com/v1/apps\\?',
    body: JSON.stringify({
      data: [
        {
          type: 'apps',
          id: SAMPLE_APP.id,
          attributes: { name: SAMPLE_APP.name, bundleId: SAMPLE_APP.bundleId, sku: 'JUNIPER', primaryLocale: 'en-US' },
        },
      ],
    }),
  },
];

export const TEST_APP = SAMPLE_APP;

/**
 * Connect the test account: the key where the upload dialog keeps it, Growth
 * set to the app, and the app's numbers, reviews, ratings, events and listing
 * in the growth database, synced a moment ago so no automatic sync starts.
 * The app reads the key once, so reload (`app.goto()`) afterwards.
 */
export async function connectTestAccount(page: Page): Promise<void> {
  await page.evaluate(
    ({ key, appId }) => {
      localStorage.setItem(
        'open-screenshot-generator.store-credentials',
        JSON.stringify({ appstore: { issuerId: '69a6de70-0000-47e3-e053-5b8c7c11a4d1', keyId: 'ABCD123456', privateKey: key } })
      );
      localStorage.setItem('open-screenshot-generator.growth', JSON.stringify({ appId, vendorNumber: '85012345' }));
    },
    { key: TEST_KEY, appId: SAMPLE_APP.id }
  );
  await putGrowthRows(page, {
    days: sampleRecords(),
    reviews: sampleReviews(),
    ratings: sampleRatings(),
    events: sampleEvents(),
    listings: [sampleListing()],
    meta: [{ key: `sync:last:${SAMPLE_APP.id}`, value: Date.now() }],
  });
}

/** Rows to put in the growth database, by table. */
export type GrowthRows = Partial<Record<'days' | 'reviews' | 'ratings' | 'events' | 'listings' | 'meta', unknown[]>>;

/**
 * Write rows straight into the growth database. The app reads the database
 * when Growth opens, so put rows in before that, or reload (`app.goto()`).
 */
export async function putGrowthRows(page: Page, rows: GrowthRows): Promise<void> {
  await page.evaluate(async (rows) => {
    // Dexie's version 1 is IndexedDB's version 10. When the app has not
    // opened the database yet, it is made here with the stores and indexes
    // src/lib/growth/db.ts declares, so Dexie opens it as its own; when it
    // has, the version the app made is opened as it is.
    const exists = (await indexedDB.databases()).some((database) => database.name === 'OpenScreenshotGeneratorGrowth');
    const open = exists ? indexedDB.open('OpenScreenshotGeneratorGrowth') : indexedDB.open('OpenScreenshotGeneratorGrowth', 10);
    open.onupgradeneeded = () => {
      const db = open.result;
      const store = (name: string, keyPath: string, indexes: Array<[string, string | string[]]>) => {
        const created = db.createObjectStore(name, { keyPath });
        for (const [index, path] of indexes) created.createIndex(index, path);
      };
      store('days', 'key', [['appId', 'appId'], ['[appId+date]', ['appId', 'date']]]);
      store('reviews', 'id', [['appId', 'appId'], ['[appId+createdDate]', ['appId', 'createdDate']]]);
      store('ratings', 'key', [['appId', 'appId']]);
      store('events', 'id', [['appId', 'appId'], ['[appId+date]', ['appId', 'date']]]);
      store('listings', 'appId', []);
      store('meta', 'key', []);
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const names = Object.keys(rows) as Array<keyof typeof rows>;
    const tx = db.transaction(names, 'readwrite');
    for (const name of names) for (const row of rows[name] ?? []) tx.objectStore(name).put(row);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, rows);
}

/** One meta row of the growth database, or undefined. */
export async function growthMeta<T>(page: Page, key: string): Promise<T | undefined> {
  return page.evaluate(async (key) => {
    const open = indexedDB.open('OpenScreenshotGeneratorGrowth');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const request = db.transaction('meta').objectStore('meta').get(key);
      const row = await new Promise<{ value: unknown } | undefined>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as { value: unknown } | undefined);
        request.onerror = () => reject(request.error);
      });
      return row?.value as T | undefined;
    } finally {
      db.close();
    }
  }, key) as Promise<T | undefined>;
}

/** The keys of the growth database's meta rows that start with `prefix`, such as the report summaries kept. */
export async function growthMetaKeys(page: Page, prefix: string): Promise<string[]> {
  return page.evaluate(async (prefix) => {
    const open = indexedDB.open('OpenScreenshotGeneratorGrowth');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const request = db.transaction('meta').objectStore('meta').getAllKeys();
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return keys.map(String).filter((key) => key.startsWith(prefix));
    } finally {
      db.close();
    }
  }, prefix);
}

/** Answer every command the spec holds in flight (`held` in the Tauri mock). Returns how many there were. */
export function releaseHeldCommands(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseCommands(): number } }).__E2E_TAURI__.releaseCommands());
}
