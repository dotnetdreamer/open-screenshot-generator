import { test, expect } from '../fixtures/test';
import type { Locator, Page } from '@playwright/test';
import type { TauriUptimeConfig } from '../fixtures/tauri-runtime';

// Uptime (src/lib/uptime, src-tauri/src/uptime): the user's sites, servers
// and store listings watched from the desktop app. The checks are Rust's, so
// here the Tauri runtime models the engine (tests/e2e/fixtures/tauri-runtime.ts):
// a check answers from `outcomes`, and a spec makes a monitor go down with
// window.__E2E_TAURI__.uptimeCheck(id, outcome). UPTIME_SHOTS=<folder> saves
// a picture of each screen there.

const UPTIME_VIEW = 'Uptime: know when your website or server goes down';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function shot(page: Page, name: string) {
  const folder = process.env.UPTIME_SHOTS;
  if (!folder) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${folder}/${test.info().project.name}-${name}.png` });
}

async function openUptime(page: Page, app: { dismissStartDialog(): Promise<void> }): Promise<Locator> {
  await app.dismissStartDialog();
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: UPTIME_VIEW, exact: true }).click();
  const view = page.getByTestId('uptime-view');
  // A cold dev server compiles the view on its first open.
  await expect(view).toBeVisible({ timeout: 60_000 });
  return view;
}

function monitor(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    kind: 'http',
    interval: 60,
    timeout: 10,
    retries: 0,
    retryInterval: 20,
    paused: false,
    pausedUntil: null,
    skipAlerts: [],
    slowMs: 0,
    created: Date.now() - 40 * DAY,
    url: `https://${id}.example`,
    method: 'GET',
    headers: [],
    body: '',
    accept: '200-299',
    redirects: 10,
    ignoreTls: false,
    certDays: 14,
    keyword: '',
    keywordAbsent: false,
    keywordCase: false,
    jsonPath: '',
    jsonOp: 'eq',
    jsonExpected: '',
    host: '',
    port: 443,
    dnsType: 'A',
    dnsServer: '',
    dnsExpect: '',
    store: 'apple',
    appId: '',
    country: 'us',
    ...extra,
  };
}

/** A made-up history: checks every minute, answer times with some noise, and the bad stretches given. */
function history(id: string, state: 'up' | 'down' | 'paused', bad: Array<[number, number]> = [], base = 180) {
  const now = Date.now();
  const recent = Array.from({ length: 100 }, (_, index) => {
    const t = now - (100 - index) * 60_000;
    const down = bad.some(([from, to]) => t >= now - from && t < now - to) || (state === 'down' && index >= 94);
    return down ? { t, s: 'down', why: 'status', msg: 'The page answered 503 Service Unavailable', code: 503 } : { t, s: 'up', ms: Math.round(base + 40 * Math.sin(index / 5) + (index % 7) * 9), code: 200 };
  });
  const hours = Array.from({ length: 90 * 24 }, (_, index) => {
    const t = Math.floor(now / HOUR) * HOUR - (90 * 24 - index) * HOUR;
    const daysAgo = Math.floor((now - t) / DAY);
    // A day each under 100% (4 min), under 99% (20 and 50 min) and under 95% (6 hours).
    const down = daysAgo === 12 && index % 24 === 3 ? 1_200_000 : daysAgo === 41 && index % 24 === 15 ? 240_000 : daysAgo === 63 && index % 24 === 9 ? 3_000_000 : daysAgo === 70 && index % 24 < 6 ? HOUR : 0;
    return { t, up: HOUR - down, down, n: 60, fails: down ? 4 : 0, sum: 60 * base, cnt: 60, min: base - 40, max: base + 120 };
  });
  const last = recent[recent.length - 1];
  return {
    summary: {
      id,
      state,
      since: state === 'down' ? now - 6 * 60_000 : now - 9 * DAY,
      last,
      recent,
      next: now + 42_000,
      running: false,
      fails: state === 'down' ? 6 : 0,
      uptime24: state === 'down' ? 99.58 : 100,
      uptime7: state === 'down' ? 99.94 : 99.99,
      uptime30: 99.97,
      avg24: base + 12,
      detail: { at: now - 18_000, ip: '93.184.215.14', server: 'nginx', bytes: 48_211, cert: { expires: now + 61 * DAY + HOUR, issued: now - 29 * DAY, issuer: 'R11', subject: `${id}.example` } },
      downSince: state === 'down' ? now - 6 * 60_000 : null,
      downMsg: state === 'down' ? 'The page answered 503 Service Unavailable' : '',
      version: null,
    },
    hours,
  };
}

function seeded(): TauriUptimeConfig {
  const now = Date.now();
  const site = history('mludo', 'up', [[38 * 60_000, 36 * 60_000]]);
  const api = history('mapi', 'down', [], 240);
  const port = history('mmatch', 'up', [], 40);
  const store = history('mstore', 'up', [], 420);
  store.summary.detail = { at: now - 30_000, version: '2.4.1', appName: 'Ludo Wala' } as never;
  store.summary.version = '2.4.1' as never;
  const paused = history('mprivacy', 'paused');
  return {
    seed: {
      monitors: [
        monitor('mludo', 'Ludo Wala website', { url: 'https://ludowala.example' }),
        monitor('mapi', 'Game API', { url: 'https://api.ludowala.example/health', jsonPath: 'status', jsonExpected: 'ok' }),
        monitor('mmatch', 'Matchmaking server', { kind: 'port', host: 'mm.ludowala.example', port: 7777 }),
        monitor('mstore', 'Ludo Wala on the App Store', { kind: 'store', appId: '1234567890' }),
        monitor('mprivacy', 'Privacy policy', { url: 'https://ludowala.example/privacy/', paused: true }),
      ],
      summaries: [site.summary, api.summary, port.summary, store.summary, paused.summary],
      events: [
        { id: 'mapi', t: now - 6 * 60_000, kind: 'down', msg: 'The page answered 503 Service Unavailable', why: 'status', code: 503 },
        { id: 'mludo', t: now - 36 * 60_000, kind: 'up', dur: 2 * 60_000, seen: 2 * 60_000 },
        { id: 'mludo', t: now - 38 * 60_000, kind: 'down', msg: 'No answer within 10 seconds', why: 'timeout' },
        { id: 'mstore', t: now - 3 * HOUR, kind: 'version', msg: 'Version 2.4.1 is live' },
        { id: 'mprivacy', t: now - 5 * HOUR, kind: 'paused' },
        { id: 'mludo', t: now - 12 * DAY, kind: 'up', dur: 20 * 60_000, seen: 20 * 60_000 },
        { id: 'mludo', t: now - 12 * DAY - 20 * 60_000, kind: 'down', msg: 'The address couldn\'t be found', why: 'dns' },
      ],
      hours: { mludo: site.hours, mapi: api.hours, mmatch: port.hours, mstore: store.hours, mprivacy: paused.hours },
    },
    outcomes: {},
    notifications: 'native',
    autoCheck: true,
  };
}

test.describe('Uptime', () => {
  test('the web build says where Uptime runs', async ({ page, app, isDesktop }) => {
    test.skip(isDesktop, 'The desktop build runs the checks');
    const view = await openUptime(page, app);
    await expect(view.getByRole('heading', { name: 'Uptime runs in the desktop app' })).toBeVisible();
    await expect(view.getByRole('button', { name: 'Get the desktop app' })).toBeVisible();
    await shot(page, 'web');
  });

  test.describe('in the desktop app', () => {
    test.beforeEach(({ isDesktop }) => {
      test.skip(!isDesktop, 'Uptime needs the desktop app');
    });

    test('a pasted address becomes a monitor, tested before it is saved', async ({ page, app, tauri }) => {
      const view = await openUptime(page, app);
      const welcome = view.getByTestId('uptime-welcome');
      await expect(welcome.getByRole('heading', { name: 'Know the moment your website goes down' })).toBeVisible();
      await shot(page, 'welcome');

      await welcome.getByTestId('uptime-welcome-input').fill('shop.example.com/health');
      await welcome.getByRole('button', { name: 'Start watching' }).click();
      const form = view.getByTestId('uptime-form');
      await expect(form.getByTestId('uptime-url')).toHaveValue('https://shop.example.com/health');
      await expect(form.getByTestId('uptime-name')).toHaveValue('shop.example.com/health');
      await expect(form.getByRole('radio', { name: /Website/ })).toHaveAttribute('aria-checked', 'true');

      await form.getByTestId('uptime-test').click();
      await expect(form.getByTestId('uptime-test-result')).toHaveAttribute('data-ok', 'true');
      await expect(form.getByTestId('uptime-test-result')).toContainText('It works');
      await shot(page, 'form');

      await form.getByTestId('uptime-name').fill('Shop');
      await form.getByTestId('uptime-save').click();
      const page_ = view.getByTestId('uptime-monitor');
      await expect(page_.getByTestId('uptime-monitor-name')).toHaveText('Shop');
      await expect(page_.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up', { timeout: 10_000 });
      await expect(view.getByTestId('uptime-row')).toHaveCount(1);
      const saved = await tauri.callsTo('abs_uptime_save');
      expect(saved).toHaveLength(1);
      expect((saved[0].args as { monitor: { url: string; kind: string } }).monitor).toMatchObject({ url: 'https://shop.example.com/health', kind: 'http' });
    });

    test('the pages of a published website and its store link are one click away', async ({ page, app, tauri }) => {
      // A site the Website view published, stored the way website/store.ts keeps it.
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('OpenScreenshotGeneratorWebsite', 10);
            open.onupgradeneeded = () => {
              const store = open.result.createObjectStore('sites', { keyPath: 'projectId' });
              store.createIndex('updatedAt', 'updatedAt');
            };
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('sites', 'readwrite');
              const now = Date.now();
              tx.objectStore('sites').put({
                projectId: 'p-pebble',
                updatedAt: now,
                chat: [],
                draft: { projectId: 'p-pebble', updatedAt: now, facts: { appName: 'Pebble', appStoreUrl: 'https://apps.apple.com/app/id1234567890', playStoreUrl: '' }, publish: { url: 'https://pebble.example/' } },
              });
              tx.oncomplete = () => {
                db.close();
                resolve(null);
              };
              tx.onerror = () => reject(tx.error);
            };
            open.onerror = () => reject(open.error);
          })
      );
      const view = await openUptime(page, app);
      const welcome = view.getByTestId('uptime-welcome');
      for (const title of ['Pebble website', 'Pebble support page', 'Pebble privacy policy', 'Pebble on the App Store']) {
        await expect(welcome.getByText(title, { exact: true })).toBeVisible();
      }
      await welcome.getByText('Pebble privacy policy', { exact: true }).locator('xpath=../..').getByRole('button', { name: 'Watch' }).click();
      await expect(view.getByTestId('uptime-monitor-name')).toHaveText('Pebble privacy policy');
      const saved = (await tauri.callsTo('abs_uptime_save'))[0].args as { monitor: { url: string; kind: string } };
      expect(saved.monitor).toMatchObject({ kind: 'http', url: 'https://pebble.example/privacy/' });
    });

    test('Rust\'s refusal shows in the form in its own words', async ({ page, app }) => {
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByTestId('uptime-url').fill('shop.example.com');
      await form.getByTestId('uptime-save').click();
      await expect(form.getByTestId('uptime-form-problem')).toHaveText('Type the full web address, starting with https://');
    });

    test('a monitor that goes down turns the badge red and comes back with a toast', async ({ page, app }) => {
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByTestId('uptime-paste').fill('https://shop.example.com');
      await form.getByLabel('Call it down after').click();
      await page.getByRole('option', { name: 'The first failed check' }).click();
      await form.getByTestId('uptime-save').click();
      const monitorPage = view.getByTestId('uptime-monitor');
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up', { timeout: 10_000 });
      const id = await monitorPage.getAttribute('data-monitor');

      await page.evaluate((monitorId) => {
        (window as unknown as { __E2E_TAURI__: { uptimeCheck: (id: string, outcome: unknown) => void } }).__E2E_TAURI__.uptimeCheck(monitorId!, { ok: false, why: 'timeout', msg: 'No answer within 10 seconds' });
      }, id);
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'down');
      await expect(monitorPage.getByTestId('uptime-state')).toContainText('No answer within 10 seconds');
      await expect(page.getByText('shop.example.com is down', { exact: true })).toBeVisible();
      await expect(page.getByTestId('uptime-badge')).toHaveText('1');

      await page.evaluate((monitorId) => {
        (window as unknown as { __E2E_TAURI__: { uptimeCheck: (id: string, outcome: unknown) => void } }).__E2E_TAURI__.uptimeCheck(monitorId!, { ok: true, ms: 140, code: 200 });
      }, id);
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up');
      await expect(page.getByText('shop.example.com is back up', { exact: true })).toBeVisible();
      await expect(page.getByTestId('uptime-badge')).toHaveCount(0);
    });

    test('a test answer for settings the form no longer has is not shown', async ({ page, app }) => {
      // The first test is slow; the address changes while it runs.
      await page.evaluate(() => {
        const state = (window as unknown as { __E2E_TAURI__: { config: { responses: Record<string, unknown>; held: string[] } } }).__E2E_TAURI__;
        state.config.responses.abs_uptime_test = { ok: true, ms: 140, code: 200, why: '', msg: '', detail: { at: 1 } };
        state.config.held.push('abs_uptime_test');
      });
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByTestId('uptime-url').fill('https://slow.example.com');
      await form.getByTestId('uptime-test').click();
      await form.getByTestId('uptime-url').fill('https://broken.example.com');
      await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseCommands: () => void } }).__E2E_TAURI__.releaseCommands());
      await page.waitForTimeout(500);
      await expect(form.getByTestId('uptime-test-result')).toHaveCount(0);
      await expect(form.getByTestId('uptime-test')).toBeEnabled();
    });

    test('suggestions stay on offer after the first one is watched', async ({ page, app }) => {
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('OpenScreenshotGeneratorWebsite', 10);
            open.onupgradeneeded = () => {
              const store = open.result.createObjectStore('sites', { keyPath: 'projectId' });
              store.createIndex('updatedAt', 'updatedAt');
            };
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('sites', 'readwrite');
              const now = Date.now();
              tx.objectStore('sites').put({ projectId: 'p-pebble', updatedAt: now, chat: [], draft: { projectId: 'p-pebble', updatedAt: now, facts: { appName: 'Pebble', appStoreUrl: '', playStoreUrl: '' }, publish: { url: 'https://pebble.example/' } } });
              tx.oncomplete = () => {
                db.close();
                resolve(null);
              };
              tx.onerror = () => reject(tx.error);
            };
            open.onerror = () => reject(open.error);
          })
      );
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-welcome').getByText('Pebble website', { exact: true }).locator('xpath=../..').getByRole('button', { name: 'Watch' }).click();
      await expect(view.getByTestId('uptime-monitor-name')).toHaveText('Pebble website');
      await view.getByRole('button', { name: 'Overview', exact: true }).click();
      const offered = view.getByTestId('uptime-suggestions');
      await expect(offered.getByText('Pebble support page', { exact: true })).toBeVisible();
      await expect(offered.getByText('Pebble privacy policy', { exact: true })).toBeVisible();
      await expect(offered.getByText('Pebble website', { exact: true })).toHaveCount(0);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByRole('button', { name: 'Pebble support page', exact: true }).click();
      await expect(form.getByTestId('uptime-url')).toHaveValue('https://pebble.example/support/');
      await expect(form.getByTestId('uptime-name')).toHaveValue('Pebble support page');
    });

    test('a name typed during a slow store test stays', async ({ page, app }) => {
      await page.evaluate(() => {
        const state = (window as unknown as { __E2E_TAURI__: { config: { responses: Record<string, unknown>; held: string[] } } }).__E2E_TAURI__;
        state.config.responses.abs_uptime_test = { ok: true, ms: 900, code: 200, why: '', msg: '', detail: { at: 1, appName: 'WhatsApp', offer: 'Install' } };
        state.config.held.push('abs_uptime_test');
      });
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByRole('radio', { name: /Store listing/ }).click();
      await form.getByTestId('uptime-app').fill('1234567890');
      await form.getByTestId('uptime-test').click();
      await form.getByTestId('uptime-name').fill('My listing');
      await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseCommands: () => void } }).__E2E_TAURI__.releaseCommands());
      await expect(form.getByTestId('uptime-test-result')).toContainText('It works');
      await expect(form.getByTestId('uptime-name')).toHaveValue('My listing');
    });

    test('a Google Play app open for pre-registration can count its page as up', async ({ page, app, tauri }) => {
      await page.evaluate(() => {
        const state = (window as unknown as { __E2E_TAURI__: { config: { responses: Record<string, unknown> } } }).__E2E_TAURI__;
        state.config.responses.abs_uptime_test = { ok: true, ms: 640, code: 200, why: '', msg: '', detail: { at: 1, appName: 'Petal', offer: 'Listed' } };
      });
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByRole('radio', { name: /Store listing/ }).click();
      // The App Store has no such page, so the choice is Google Play's alone.
      await expect(form.getByRole('combobox', { name: 'Counts as up when' })).toHaveCount(0);
      await form.getByRole('combobox', { name: 'Store', exact: true }).click();
      await page.getByRole('option', { name: 'Google Play' }).click();
      await form.getByTestId('uptime-app').fill('com.example.petal');
      await form.getByRole('combobox', { name: 'Counts as up when' }).click();
      await page.getByRole('option', { name: 'Its page is there, for an app open for pre-registration' }).click();
      await form.getByTestId('uptime-test').click();
      await expect(form.getByTestId('uptime-test-result')).toContainText('The page only');
      await form.getByTestId('uptime-save').click();
      await expect(view.getByTestId('uptime-monitor-name')).toHaveText('Petal on Google Play');
      const saved = (await tauri.callsTo('abs_uptime_save'))[0].args as { monitor: Record<string, unknown> };
      expect(saved.monitor).toMatchObject({ kind: 'store', store: 'google', appId: 'com.example.petal', listedOk: true });
    });

    test('a name the store gave follows the monitor to another app', async ({ page, app }) => {
      const storeAnswers = (appName: string) =>
        page.evaluate((name) => {
          (window as unknown as { __E2E_TAURI__: { uptimeOutcomes?: Record<string, unknown> } }).__E2E_TAURI__.uptimeOutcomes = { store: { ok: true, ms: 300, code: 200, detail: { appName: name } } };
        }, appName);
      await storeAnswers('Pages');
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      let form = view.getByTestId('uptime-form');
      await form.getByRole('radio', { name: /Store listing/ }).click();
      await form.getByTestId('uptime-app').fill('361309726');
      await expect(form.getByTestId('uptime-name')).toHaveValue('361309726 on the App Store');
      await form.getByTestId('uptime-test').click();
      await expect(form.getByTestId('uptime-name')).toHaveValue('Pages on the App Store');
      // Another interval watches the same app, so the store's name stays.
      await form.getByRole('combobox', { name: 'How often' }).click();
      await page.getByRole('option', { name: 'Every 5 minutes' }).click();
      await expect(form.getByTestId('uptime-name')).toHaveValue('Pages on the App Store');
      await form.getByTestId('uptime-save').click();
      const monitorPage = view.getByTestId('uptime-monitor');
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up', { timeout: 10_000 });
      await monitorPage.getByRole('button', { name: 'Edit', exact: true }).click();
      form = view.getByTestId('uptime-form');
      await form.getByTestId('uptime-app').fill('324684580');
      await expect(form.getByTestId('uptime-name')).toHaveValue('324684580 on the App Store');
      await storeAnswers('Spotify');
      await form.getByTestId('uptime-test').click();
      await expect(form.getByTestId('uptime-name')).toHaveValue('Spotify on the App Store');
      await form.getByTestId('uptime-save').click();
      await expect(view.getByTestId('uptime-monitor-name')).toHaveText('Spotify on the App Store');
    });

    test('a name the store gave still follows a new app after a clear', async ({ page, app }) => {
      // The third audit: named by the store, paused, cleared, then pointed at another app.
      await page.evaluate(() => {
        (window as unknown as { __E2E_TAURI__: { uptimeOutcomes?: Record<string, unknown> } }).__E2E_TAURI__.uptimeOutcomes = { store: { ok: true, ms: 300, code: 200, detail: { appName: 'Pages' } } };
      });
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      let form = view.getByTestId('uptime-form');
      await form.getByRole('radio', { name: /Store listing/ }).click();
      await form.getByTestId('uptime-app').fill('361309726');
      await form.getByTestId('uptime-test').click();
      await expect(form.getByTestId('uptime-name')).toHaveValue('Pages on the App Store');
      await form.getByTestId('uptime-save').click();
      const monitorPage = view.getByTestId('uptime-monitor');
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up', { timeout: 10_000 });
      await monitorPage.getByRole('button', { name: 'Pause' }).click();
      await page.getByRole('menuitem', { name: 'Until I resume it' }).click();
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'paused');
      await monitorPage.getByRole('button', { name: 'More for this monitor' }).click();
      await page.getByRole('menuitem', { name: 'Clear the history' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Clear the history' }).click();
      await expect(monitorPage.getByText('No outages so far', { exact: false })).toBeVisible();
      await monitorPage.getByRole('button', { name: 'Edit', exact: true }).click();
      form = view.getByTestId('uptime-form');
      await expect(form.getByTestId('uptime-name')).toHaveValue('Pages on the App Store');
      await form.getByTestId('uptime-app').fill('324684580');
      await expect(form.getByTestId('uptime-name')).toHaveValue('324684580 on the App Store');
    });

    test('a name made from a pasted link follows the monitor to another app', async ({ page, app }) => {
      // The fourth audit: pasted on the welcome screen, never typed, saved as typed.
      const view = await openUptime(page, app);
      const welcome = view.getByTestId('uptime-welcome');
      await welcome.getByTestId('uptime-welcome-input').fill('https://apps.apple.com/us/app/pages/id361309726');
      await welcome.getByRole('button', { name: 'Start watching' }).click();
      let form = view.getByTestId('uptime-form');
      await expect(form.getByTestId('uptime-name')).toHaveValue('Pages');
      await form.getByTestId('uptime-save').click();
      const monitorPage = view.getByTestId('uptime-monitor');
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up', { timeout: 10_000 });
      await monitorPage.getByRole('button', { name: 'Edit', exact: true }).click();
      form = view.getByTestId('uptime-form');
      await form.getByTestId('uptime-app').fill('324684580');
      await expect(form.getByTestId('uptime-name')).toHaveValue('324684580 on the App Store');
    });

    test("a suggestion's name is Uptime's, so it follows a new address", async ({ page, app }) => {
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('OpenScreenshotGeneratorWebsite', 10);
            open.onupgradeneeded = () => {
              const store = open.result.createObjectStore('sites', { keyPath: 'projectId' });
              store.createIndex('updatedAt', 'updatedAt');
            };
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('sites', 'readwrite');
              const now = Date.now();
              tx.objectStore('sites').put({ projectId: 'p-pebble', updatedAt: now, chat: [], draft: { projectId: 'p-pebble', updatedAt: now, facts: { appName: 'Pebble', appStoreUrl: '', playStoreUrl: '' }, publish: { url: 'https://pebble.example/' } } });
              tx.oncomplete = () => {
                db.close();
                resolve(null);
              };
              tx.onerror = () => reject(tx.error);
            };
            open.onerror = () => reject(open.error);
          })
      );
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByRole('button', { name: 'Pebble support page', exact: true }).click();
      await expect(form.getByTestId('uptime-name')).toHaveValue('Pebble support page');
      await form.getByTestId('uptime-url').fill('https://pebble.example/help/');
      await expect(form.getByTestId('uptime-name')).toHaveValue('pebble.example/help');
    });

    test('a name typed to match the address stays when the address changes', async ({ page, app, tauri }) => {
      // The fourth audit: typed, saved as typed, and still renamed because it matched.
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      let form = view.getByTestId('uptime-form');
      await form.getByTestId('uptime-url').fill('https://shop.example.com');
      await expect(form.getByTestId('uptime-name')).toHaveValue('shop.example.com');
      // Typed over, the same words: filling in the same value would change nothing.
      await form.getByTestId('uptime-name').fill('');
      await form.getByTestId('uptime-name').pressSequentially('shop.example.com');
      await form.getByTestId('uptime-save').click();
      const saved = (await tauri.callsTo('abs_uptime_save'))[0].args as { monitor: { autoName: boolean } };
      expect(saved.monitor.autoName).toBe(false);
      const monitorPage = view.getByTestId('uptime-monitor');
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up', { timeout: 10_000 });
      await monitorPage.getByRole('button', { name: 'Edit', exact: true }).click();
      form = view.getByTestId('uptime-form');
      await form.getByTestId('uptime-url').fill('https://api.example.com');
      await expect(form.getByTestId('uptime-name')).toHaveValue('shop.example.com');
    });

    test('a copy of a long name is still told apart', async ({ page, app, tauri }) => {
      // The sixth audit: " copy" added to an 80-character name was cut off again.
      const long = 'The checkout page of the shop, where each order of the day is paid and confirmed';
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByTestId('uptime-url').fill('https://shop.example.com');
      await form.getByTestId('uptime-name').fill(long);
      await form.getByTestId('uptime-save').click();
      const monitorPage = view.getByTestId('uptime-monitor');
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up', { timeout: 10_000 });
      await monitorPage.getByRole('button', { name: 'More for this monitor' }).click();
      await page.getByRole('menuitem', { name: 'Make a copy' }).click();
      await expect(view.getByTestId('uptime-monitor-name')).not.toHaveText(long);
      const saves = await tauri.callsTo('abs_uptime_save');
      const copy = (saves[saves.length - 1].args as { monitor: { name: string } }).monitor.name;
      expect(copy).not.toBe(long);
      expect(copy.length).toBeLessThanOrEqual(80);
      expect(copy.endsWith(' copy')).toBe(true);
    });

    test('a copy of a name with an emoji at the cut is made', async ({ page, app }) => {
      // The seventh audit: 74 As and "💚tail", cut through the emoji, and the copy failed.
      const name = 'A'.repeat(74) + '💚tail';
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByTestId('uptime-url').fill('https://shop.example.com');
      await form.getByTestId('uptime-name').fill(name);
      await form.getByTestId('uptime-save').click();
      const monitorPage = view.getByTestId('uptime-monitor');
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up', { timeout: 10_000 });
      await monitorPage.getByRole('button', { name: 'More for this monitor' }).click();
      await page.getByRole('menuitem', { name: 'Make a copy' }).click();
      await expect(view.getByTestId('uptime-row')).toHaveCount(2);
      await expect(page.getByText("The copy wasn't made")).toHaveCount(0);
    });

    test('a copy of a monitor keeps the name it was given', async ({ page, app, tauri }) => {
      // The fifth audit: the copy's "copy" went at its first good check, leaving two of one name.
      await page.evaluate(() => {
        (window as unknown as { __E2E_TAURI__: { uptimeOutcomes?: Record<string, unknown> } }).__E2E_TAURI__.uptimeOutcomes = { store: { ok: true, ms: 300, code: 200, detail: { appName: 'Pages' } } };
      });
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const form = view.getByTestId('uptime-form');
      await form.getByRole('radio', { name: /Store listing/ }).click();
      await form.getByTestId('uptime-app').fill('361309726');
      await form.getByTestId('uptime-test').click();
      await expect(form.getByTestId('uptime-name')).toHaveValue('Pages on the App Store');
      await form.getByTestId('uptime-save').click();
      const monitorPage = view.getByTestId('uptime-monitor');
      await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up', { timeout: 10_000 });
      await monitorPage.getByRole('button', { name: 'More for this monitor' }).click();
      await page.getByRole('menuitem', { name: 'Make a copy' }).click();
      await expect(view.getByTestId('uptime-monitor-name')).toHaveText('Pages on the App Store copy');
      const saves = await tauri.callsTo('abs_uptime_save');
      expect((saves[saves.length - 1].args as { monitor: Record<string, unknown> }).monitor).toMatchObject({ name: 'Pages on the App Store copy', autoName: false });
    });

    test('a suggestion hidden in the form is gone everywhere', async ({ page, app }) => {
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('OpenScreenshotGeneratorWebsite', 10);
            open.onupgradeneeded = () => {
              const store = open.result.createObjectStore('sites', { keyPath: 'projectId' });
              store.createIndex('updatedAt', 'updatedAt');
            };
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('sites', 'readwrite');
              const now = Date.now();
              tx.objectStore('sites').put({ projectId: 'p-pebble', updatedAt: now, chat: [], draft: { projectId: 'p-pebble', updatedAt: now, facts: { appName: 'Pebble', appStoreUrl: '', playStoreUrl: '' }, publish: { url: 'https://pebble.example/' } } });
              tx.oncomplete = () => {
                db.close();
                resolve(null);
              };
              tx.onerror = () => reject(tx.error);
            };
            open.onerror = () => reject(open.error);
          })
      );
      const view = await openUptime(page, app);
      await view.getByTestId('uptime-add').click();
      const offered = view.getByTestId('uptime-form-suggestions');
      await offered.getByRole('button', { name: "Don't suggest Pebble support page again" }).click();
      await expect(offered.getByRole('button', { name: /Pebble support page/ })).toHaveCount(0);
      await expect(offered.getByRole('button', { name: /Pebble privacy policy/ })).toHaveCount(2);
      await view.getByRole('button', { name: 'Back' }).click();
      await expect(view.getByTestId('uptime-suggestions').getByText('Pebble support page', { exact: true })).toHaveCount(0);
      await expect(view.getByTestId('uptime-suggestions').getByText('Pebble privacy policy', { exact: true })).toBeVisible();
    });

    test.describe('while the window opens', () => {
      test.use({ tauriConfig: { uptime: { ...seeded(), holdFirstState: true } } });

      test('a check made while the window opens is shown', async ({ page, app }) => {
        // The ninth audit: a Down came while the window's first read of the
        // state was held; the window showed Unknown, and no badge, until a fresh read.
        await app.dismissStartDialog();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __E2E_TAURI__: { calls: Array<{ cmd: string }> } }).__E2E_TAURI__.calls.some((call) => call.cmd === 'abs_uptime_state')), { timeout: 60_000 }).toBe(true);
        await page.evaluate(() => {
          const tauri = (window as unknown as { __E2E_TAURI__: { uptimeCheck: (id: string, outcome: unknown) => void; releaseUptimeState: () => void } }).__E2E_TAURI__;
          tauri.uptimeCheck('mludo', { ok: false, code: 503, why: 'status', msg: 'The page answered 503 Service Unavailable' });
          tauri.releaseUptimeState();
        });
        const view = await openUptime(page, app);
        await expect(view.getByTestId('uptime-row').filter({ hasText: 'Ludo Wala website' })).toHaveAttribute('data-state', 'down');
        await expect(page.getByTestId('uptime-badge')).toHaveText('2');
      });
    });

    test.describe('with a history', () => {
      test.use({ tauriConfig: { uptime: seeded() } });

      test('the overview leads with what is down and shows every monitor\'s 90 days', async ({ page, app }) => {
        const view = await openUptime(page, app);
        const hero = view.getByTestId('uptime-hero');
        await expect(hero).toHaveAttribute('data-tone', 'critical');
        await expect(hero).toContainText('Game API is down');
        await expect(hero).toContainText('The page answered 503 Service Unavailable');
        await expect(view.getByTestId('uptime-tile-down')).toContainText('1');
        await expect(view.getByTestId('uptime-board').locator('li')).toHaveCount(5);
        await expect(view.getByTestId('uptime-changes')).toContainText('Game API went down');
        await expect(view.getByTestId('uptime-changes')).toContainText('Ludo Wala on the App Store: Version 2.4.1 is live');
        // Down first in the list.
        await expect(view.getByTestId('uptime-row').first()).toHaveAttribute('data-state', 'down');
        await expect(page.getByTestId('uptime-badge')).toHaveText('1');
        await shot(page, 'overview');

        await hero.getByRole('button', { name: 'See what happened' }).click();
        const monitorPage = view.getByTestId('uptime-monitor');
        await expect(monitorPage.getByTestId('uptime-monitor-name')).toHaveText('Game API');
        await expect(monitorPage.getByTestId('uptime-state')).toContainText('Down for');
        await expect(monitorPage.getByTestId('uptime-outages')).toContainText('Still down');
        await expect(monitorPage.getByTestId('uptime-check-bars').locator('[data-status="down"]')).toHaveCount(6);
        await shot(page, 'monitor-down');
      });

      test('a monitor\'s page shows its certificate, outages and answer times', async ({ page, app }) => {
        const view = await openUptime(page, app);
        await view.getByTestId('uptime-row').filter({ hasText: 'Ludo Wala website' }).click();
        const monitorPage = view.getByTestId('uptime-monitor');
        await expect(monitorPage.getByTestId('uptime-state')).toContainText('Up for 9 days');
        await expect(monitorPage.getByTestId('uptime-cert')).toContainText('61 days');
        const outages = monitorPage.getByTestId('uptime-outages');
        await expect(outages.locator('tbody tr')).toHaveCount(2);
        await expect(outages).toContainText('No answer within 10 seconds');
        await expect(outages).toContainText('The address couldn\'t be found');
        await monitorPage.getByRole('button', { name: '7 days' }).click();
        await expect(monitorPage.getByRole('img', { name: /^Response time/ })).toBeVisible();
        await shot(page, 'monitor-up');
      });

      test('clearing a paused monitor\'s history clears its page', async ({ page, app }) => {
        const view = await openUptime(page, app);
        await view.getByTestId('uptime-row').filter({ hasText: 'Ludo Wala website' }).click();
        const monitorPage = view.getByTestId('uptime-monitor');
        await expect(monitorPage.getByTestId('uptime-outages').locator('tbody tr')).toHaveCount(2);
        await monitorPage.getByRole('button', { name: 'Pause' }).click();
        await page.getByRole('menuitem', { name: 'Until I resume it' }).click();
        await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'paused');
        await monitorPage.getByRole('button', { name: 'More for this monitor' }).click();
        await page.getByRole('menuitem', { name: 'Clear the history' }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Clear the history' }).click();
        await expect(monitorPage.getByTestId('uptime-outages')).toHaveCount(0);
        await expect(monitorPage.getByText('No outages so far', { exact: false })).toBeVisible();
      });

      test('clearing a monitor that is down clears its page and the badge', async ({ page, app }) => {
        const view = await openUptime(page, app);
        await expect(page.getByTestId('uptime-badge')).toHaveText('1');
        await view.getByTestId('uptime-row').filter({ hasText: 'Game API' }).click();
        const monitorPage = view.getByTestId('uptime-monitor');
        await expect(monitorPage.getByTestId('uptime-outages').locator('tbody tr')).toHaveCount(1);
        await monitorPage.getByRole('button', { name: 'More for this monitor' }).click();
        await page.getByRole('menuitem', { name: 'Clear the history' }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Clear the history' }).click();
        await expect(monitorPage.getByTestId('uptime-outages')).toHaveCount(0);
        await expect(monitorPage.getByTestId('uptime-state')).not.toHaveAttribute('data-state', 'down');
        await expect(page.getByTestId('uptime-badge')).toHaveCount(0);
      });

      test('a store answer that can\'t be read calls nothing down', async ({ page, app }) => {
        const view = await openUptime(page, app);
        await expect(page.getByTestId('uptime-badge')).toHaveText('1');
        await view.getByTestId('uptime-row').filter({ hasText: 'Ludo Wala on the App Store' }).click();
        const monitorPage = view.getByTestId('uptime-monitor');
        await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up');
        // Two in a row: with one retry, two failed checks would call it down.
        for (let i = 0; i < 2; i++) {
          await page.evaluate(() => {
            (window as unknown as { __E2E_TAURI__: { uptimeCheck: (id: string, outcome: unknown) => void } }).__E2E_TAURI__.uptimeCheck('mstore', { ok: false, inconclusive: true, why: 'error', msg: "The App Store's answer couldn't be read" });
          });
        }
        await expect(monitorPage.getByTestId('uptime-unclear')).toHaveText("The App Store's answer couldn't be read. That check couldn't tell, so it doesn't count as up or down.");
        await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'up');
        await expect(page.getByText('Ludo Wala on the App Store is down', { exact: true })).toHaveCount(0);
        await expect(page.getByTestId('uptime-badge')).toHaveText('1');
        await expect(monitorPage.getByTestId('uptime-check-bars').locator('[data-status="unclear"]')).toHaveCount(2);
      });

      test('a store name saved before names were marked still follows the app', async ({ page, app }) => {
        // The fifth audit: saved by an earlier build, without autoName.
        const view = await openUptime(page, app);
        await view.getByTestId('uptime-row').filter({ hasText: 'Ludo Wala on the App Store' }).click();
        await view.getByTestId('uptime-monitor').getByRole('button', { name: 'Edit', exact: true }).click();
        const form = view.getByTestId('uptime-form');
        await form.getByTestId('uptime-app').fill('324684580');
        await expect(form.getByTestId('uptime-name')).toHaveValue('324684580 on the App Store');
      });

      test('a name the user gave stays when the address changes', async ({ page, app }) => {
        const view = await openUptime(page, app);
        await view.getByTestId('uptime-row').filter({ hasText: 'Game API' }).click();
        await view.getByTestId('uptime-monitor').getByRole('button', { name: 'Edit', exact: true }).click();
        const form = view.getByTestId('uptime-form');
        await expect(form.getByTestId('uptime-name')).toHaveValue('Game API');
        await form.getByTestId('uptime-url').fill('https://api2.ludowala.example/health');
        await expect(form.getByTestId('uptime-name')).toHaveValue('Game API');
      });

      test('a change made while the one before is saving builds on it', async ({ page, app }) => {
        // The eighth audit: Remove, then the Dock badge switch while the
        // removal still waited for a request under way. The switch saved the
        // settings the page still showed, and the removed place came back.
        // Any switch does it; the sound one shows on every system.
        await openUptime(page, app);
        await page.evaluate(() => {
          const tauri = (window as unknown as { __E2E_TAURI__: { uptime: { settings: Record<string, unknown>; stamp: number; settingsHoldNextMs?: number; monitors: unknown[]; summaries: unknown[] }; emitFromBackend: (event: string, payload: unknown) => void } }).__E2E_TAURI__;
          const uptime = tauri.uptime;
          uptime.settings = { ...uptime.settings, desktop: true, sound: true, targets: [{ id: 'aoverlap1', kind: 'webhook', name: 'Overlap receiver', url: 'http://127.0.0.1:9/hook', token: '', chat: '', topic: '', enabled: true, down: true, up: true, cert: true, news: true }] };
          uptime.stamp += 1;
          tauri.emitFromBackend('uptime://state', JSON.parse(JSON.stringify({ loaded: true, monitors: uptime.monitors, summaries: uptime.summaries, settings: uptime.settings, offlineSince: null, deliveries: [], notifications: 'native', now: Date.now(), stamp: uptime.stamp })));
          uptime.settingsHoldNextMs = 2000;
        });
        await page.getByRole('navigation', { name: 'Uptime' }).getByRole('button', { name: /^Alerts/ }).click();
        const remove = page.getByRole('button', { name: 'Remove Overlap receiver' });
        await remove.click();
        await page.getByRole('switch', { name: 'Play a sound' }).click();
        // The row goes at once, not when the removal is done. Soft, so a
        // failure here still shows what was saved.
        await expect.soft(remove).toHaveCount(0, { timeout: 800 });
        const saved = () => page.evaluate(() => {
          const settings = (window as unknown as { __E2E_TAURI__: { uptime: { settings: { targets: Array<{ id: string }>; sound: boolean } } } }).__E2E_TAURI__.uptime.settings;
          return { ids: settings.targets.map((target) => target.id), sound: settings.sound };
        });
        await expect.poll(saved, { timeout: 10_000 }).toEqual({ ids: [], sound: false });
        await page.waitForTimeout(2500);
        expect(await saved()).toEqual({ ids: [], sound: false });
        await expect(remove).toHaveCount(0);
        await expect(page.getByRole('switch', { name: 'Play a sound' })).not.toBeChecked();
      });

      test('a change from another window is never undone by an older copy', async ({ page, app }) => {
        // The ninth audit: two editor windows. This one removed a place while
        // a request to it was under way, the other removed a second place,
        // then this one switched a setting from its own older copy and the
        // second place came back. Here the other window's change lands just
        // after this one last read the settings, so this one never hears of it.
        await openUptime(page, app);
        await page.evaluate(() => {
          const tauri = (window as unknown as { __E2E_TAURI__: { uptime: { settings: Record<string, unknown>; stamp: number; settingsHoldNextMs?: number; monitors: unknown[]; summaries: unknown[] }; emitFromBackend: (event: string, payload: unknown) => void } }).__E2E_TAURI__;
          const uptime = tauri.uptime;
          const place = (id: string, name: string) => ({ id, kind: 'webhook', name, url: `http://127.0.0.1:9/${id}`, token: '', chat: '', topic: '', enabled: true, down: true, up: true, cert: true, news: true });
          uptime.settings = { ...uptime.settings, desktop: true, sound: true, targets: [place('afirstplace', 'First receiver'), place('asecondplace', 'Second receiver')] };
          uptime.stamp += 1;
          tauri.emitFromBackend('uptime://state', JSON.parse(JSON.stringify({ loaded: true, monitors: uptime.monitors, summaries: uptime.summaries, settings: uptime.settings, offlineSince: null, deliveries: [], notifications: 'native', now: Date.now(), stamp: uptime.stamp })));
          uptime.settingsHoldNextMs = 2000;
        });
        await page.getByRole('navigation', { name: 'Uptime' }).getByRole('button', { name: /^Alerts/ }).click();
        await page.getByRole('button', { name: 'Remove First receiver' }).click();
        await page.evaluate(() => {
          const uptime = (window as unknown as { __E2E_TAURI__: { uptime: { settings: { targets: Array<{ id: string }>; rev?: number }; onStateRead?: (() => void) | null } } }).__E2E_TAURI__.uptime;
          // The other window removes the second place right after this one's next read.
          uptime.onStateRead = () => {
            uptime.settings = { ...uptime.settings, targets: uptime.settings.targets.filter((target) => target.id !== 'asecondplace'), rev: (uptime.settings.rev ?? 0) + 1 };
          };
        });
        await page.getByRole('switch', { name: 'Play a sound' }).click();
        const saved = () => page.evaluate(() => {
          const settings = (window as unknown as { __E2E_TAURI__: { uptime: { settings: { targets: Array<{ id: string }>; sound: boolean } } } }).__E2E_TAURI__.uptime.settings;
          return { ids: settings.targets.map((target) => target.id), sound: settings.sound };
        });
        await expect.poll(saved, { timeout: 10_000 }).toEqual({ ids: [], sound: false });
        await page.waitForTimeout(2500);
        expect(await saved()).toEqual({ ids: [], sound: false });
        await expect(page.getByRole('button', { name: 'Remove Second receiver' })).toHaveCount(0);
      });

      test("a change made after hearing of another window's is made to that", async ({ page, app }) => {
        // As above, but this window hears of the other's change before its
        // own next one: that one is made to the newer settings at once, not
        // refused and made again.
        await openUptime(page, app);
        await page.evaluate(() => {
          const tauri = (window as unknown as { __E2E_TAURI__: { uptime: { settings: Record<string, unknown>; stamp: number; settingsHoldNextMs?: number; refusals?: number; monitors: unknown[]; summaries: unknown[] }; emitFromBackend: (event: string, payload: unknown) => void } }).__E2E_TAURI__;
          const uptime = tauri.uptime;
          const place = (id: string, name: string) => ({ id, kind: 'webhook', name, url: `http://127.0.0.1:9/${id}`, token: '', chat: '', topic: '', enabled: true, down: true, up: true, cert: true, news: true });
          uptime.settings = { ...uptime.settings, desktop: true, sound: true, targets: [place('afirstplace', 'First receiver'), place('asecondplace', 'Second receiver')] };
          uptime.stamp += 1;
          uptime.refusals = 0;
          tauri.emitFromBackend('uptime://state', JSON.parse(JSON.stringify({ loaded: true, monitors: uptime.monitors, summaries: uptime.summaries, settings: uptime.settings, offlineSince: null, deliveries: [], notifications: 'native', now: Date.now(), stamp: uptime.stamp })));
          uptime.settingsHoldNextMs = 2000;
        });
        await page.getByRole('navigation', { name: 'Uptime' }).getByRole('button', { name: /^Alerts/ }).click();
        await page.getByRole('button', { name: 'Remove First receiver' }).click();
        await page.getByRole('switch', { name: 'Play a sound' }).click();
        // The other window removes the second place, and this one hears of it.
        await page.evaluate(() => {
          const tauri = (window as unknown as { __E2E_TAURI__: { uptime: { settings: { targets: Array<{ id: string }>; rev?: number }; stamp: number; monitors: unknown[]; summaries: unknown[] }; emitFromBackend: (event: string, payload: unknown) => void } }).__E2E_TAURI__;
          const uptime = tauri.uptime;
          uptime.settings = { ...uptime.settings, targets: uptime.settings.targets.filter((target) => target.id !== 'asecondplace'), rev: (uptime.settings.rev ?? 0) + 1 };
          uptime.stamp += 1;
          tauri.emitFromBackend('uptime://state', JSON.parse(JSON.stringify({ loaded: true, monitors: uptime.monitors, summaries: uptime.summaries, settings: uptime.settings, offlineSince: null, deliveries: [], notifications: 'native', now: Date.now(), stamp: uptime.stamp })));
        });
        await expect(page.getByRole('button', { name: 'Remove Second receiver' })).toHaveCount(0);
        const saved = () => page.evaluate(() => {
          const uptime = (window as unknown as { __E2E_TAURI__: { uptime: { settings: { targets: Array<{ id: string }>; sound: boolean }; refusals?: number } } }).__E2E_TAURI__.uptime;
          return { ids: uptime.settings.targets.map((target) => target.id), sound: uptime.settings.sound, refusals: uptime.refusals ?? 0 };
        });
        await expect.poll(saved, { timeout: 10_000 }).toEqual({ ids: [], sound: false, refusals: 0 });
        await expect(page.getByRole('button', { name: 'Remove Second receiver' })).toHaveCount(0);
      });

      test("a paused monitor's figures are worked out again", async ({ page, app }) => {
        // The ninth audit: once a paused monitor's last outage left the 24
        // hours, its figure was 100%, but the page showed 59.28% until
        // something else sent a view, even after going away and back.
        const view = await openUptime(page, app);
        const setFigure = (value: number) => page.evaluate((figure) => {
          const uptime = (window as unknown as { __E2E_TAURI__: { uptime: { summaries: Array<{ id: string; uptime24: number | null }> } } }).__E2E_TAURI__.uptime;
          // As Rust works it out for a view made now, with nothing sent.
          uptime.summaries.find((summary) => summary.id === 'mprivacy')!.uptime24 = figure;
        }, value);
        const tile = () => view.getByTestId('uptime-monitor').locator('div.rounded-xl', { has: page.getByText('Uptime, 24 hours', { exact: true }) });
        await view.getByTestId('uptime-row').filter({ hasText: 'Privacy policy' }).click();
        await expect(tile()).toContainText('100%');
        await setFigure(59.28);
        await view.getByTestId('uptime-row').filter({ hasText: 'Game API' }).click();
        await view.getByTestId('uptime-row').filter({ hasText: 'Privacy policy' }).click();
        await expect(tile()).toContainText('59.28%', { timeout: 5_000 });
        // Staying on the page, it catches up too.
        await setFigure(100);
        await expect(tile()).toContainText('100%', { timeout: 20_000 });
      });

      test('a new monitor whose first check comes before it shows that check', async ({ page, app }) => {
        // The eighth audit: the view that added a monitor came after its
        // first check, a 503. The page showed Unknown and no red badge.
        const view = await openUptime(page, app);
        await expect(page.getByTestId('uptime-badge')).toHaveText('1');
        await page.evaluate(() => {
          const tauri = (window as unknown as { __E2E_TAURI__: { uptime: { monitors: Array<Record<string, unknown>>; summaries: Array<Record<string, unknown>>; settings: unknown; stamp: number }; uptimeCheck: (id: string, outcome: unknown) => void; emitFromBackend: (event: string, payload: unknown) => void } }).__E2E_TAURI__;
          const uptime = tauri.uptime;
          const base = uptime.monitors.find((m) => m.id === 'mludo')!;
          uptime.monitors.push(JSON.parse(JSON.stringify({ ...base, id: 'mnewone', name: 'New checkout', url: 'https://checkout.example' })));
          uptime.stamp += 1;
          uptime.summaries.push({ id: 'mnewone', state: 'unknown', since: null, last: null, recent: [], next: Date.now() + 60_000, running: false, fails: 0, uptime24: null, uptime7: null, uptime30: null, avg24: null, detail: { at: 0 }, downSince: null, downMsg: '', version: null, revision: 1, stamp: uptime.stamp });
          const held = JSON.parse(JSON.stringify({ loaded: true, monitors: uptime.monitors, summaries: uptime.summaries, settings: uptime.settings, offlineSince: null, deliveries: [], notifications: 'native', now: Date.now(), stamp: uptime.stamp }));
          // Its first check, a 503, comes before the view that adds it.
          tauri.uptimeCheck('mnewone', { ok: false, code: 503, why: 'status', msg: 'The page answered 503 Service Unavailable' });
          tauri.emitFromBackend('uptime://state', held);
        });
        await expect(view.getByTestId('uptime-row').filter({ hasText: 'New checkout' })).toHaveAttribute('data-state', 'down');
        await expect(page.getByTestId('uptime-badge')).toHaveText('2');
      });

      test('a delete reaches the page after a newer check of another monitor', async ({ page, app }) => {
        // The seventh audit: the delete's view, held back until another monitor's check had come, was dropped.
        const view = await openUptime(page, app);
        await expect(page.getByTestId('uptime-badge')).toHaveText('1');
        await page.evaluate(() => {
          const tauri = (window as unknown as { __E2E_TAURI__: { uptime: { monitors: Array<{ id: string }>; summaries: Array<{ id: string }>; settings: unknown; stamp: number }; uptimeCheck: (id: string, outcome: unknown) => void; emitFromBackend: (event: string, payload: unknown) => void } }).__E2E_TAURI__;
          const uptime = tauri.uptime;
          uptime.stamp = (uptime.stamp || 0) + 1;
          const deleted = JSON.parse(JSON.stringify({ loaded: true, monitors: uptime.monitors.filter((m) => m.id !== 'mapi'), summaries: uptime.summaries.filter((s) => s.id !== 'mapi'), settings: uptime.settings, offlineSince: null, deliveries: [], notifications: 'native', now: Date.now(), stamp: uptime.stamp }));
          // Another monitor's check, made after the delete, comes first.
          tauri.uptimeCheck('mludo', { ok: true, ms: 120, code: 200 });
          tauri.emitFromBackend('uptime://state', deleted);
        });
        await expect(view.getByTestId('uptime-row').filter({ hasText: 'Game API' })).toHaveCount(0);
        await expect(page.getByTestId('uptime-badge')).toHaveCount(0);
      });

      test('a late event never brings back what the page has moved past', async ({ page, app }) => {
        // The sixth audit: a view from before a delete, and an older offline
        // check, both arriving after the page had moved on.
        const view = await openUptime(page, app);
        await expect(page.getByTestId('uptime-badge')).toHaveText('1');
        const older = await page.evaluate(() => {
          const uptime = (window as unknown as { __E2E_TAURI__: { uptime: { monitors: unknown[]; summaries: unknown[]; settings: unknown; stamp: number } } }).__E2E_TAURI__.uptime;
          return JSON.parse(JSON.stringify({ loaded: true, monitors: uptime.monitors, summaries: uptime.summaries, settings: uptime.settings, offlineSince: null, deliveries: [], notifications: 'native', now: Date.now(), stamp: uptime.stamp }));
        });
        await view.getByTestId('uptime-row').filter({ hasText: 'Game API' }).click();
        await view.getByTestId('uptime-monitor').getByRole('button', { name: 'More for this monitor' }).click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(view.getByTestId('uptime-row').filter({ hasText: 'Game API' })).toHaveCount(0);
        await expect(page.getByTestId('uptime-badge')).toHaveCount(0);
        await page.evaluate((late) => {
          const tauri = (window as unknown as { __E2E_TAURI__: { emitFromBackend: (event: string, payload: unknown) => void } }).__E2E_TAURI__;
          tauri.emitFromBackend('uptime://state', late);
          const summary = (late as { summaries: Array<{ id: string }> }).summaries.find((one) => one.id === 'mludo');
          tauri.emitFromBackend('uptime://beat', { id: 'mludo', beat: { t: Date.now() - 120_000, s: 'offline', msg: 'No route' }, summary, offlineSince: Date.now() - 120_000 });
        }, older);
        await page.waitForTimeout(500);
        await expect(view.getByTestId('uptime-row').filter({ hasText: 'Game API' })).toHaveCount(0);
        await expect(page.getByTestId('uptime-badge')).toHaveCount(0);
        await view.getByRole('button', { name: 'Overview', exact: true }).click();
        await expect(view.getByTestId('uptime-hero')).not.toContainText('This computer is offline');
      });

      test('a worse day is a taller bar, not only a redder one', async ({ page, app }) => {
        const view = await openUptime(page, app);
        const bars = view.getByTestId('uptime-board').locator('li').first().locator('[data-tone]');
        const heights = await bars.evaluateAll((nodes) => {
          const byTone: Record<string, number> = {};
          for (const node of nodes as HTMLElement[]) byTone[node.dataset.tone!] = parseFloat(node.style.height);
          return byTone;
        });
        expect(heights.good).toBeLessThan(heights.warning);
        expect(heights.warning).toBeLessThan(heights.serious);
        expect(heights.serious).toBeLessThan(heights.critical);
      });

      test('pause and resume from a monitor\'s page', async ({ page, app, tauri }) => {
        const view = await openUptime(page, app);
        await view.getByTestId('uptime-row').filter({ hasText: 'Matchmaking server' }).click();
        const monitorPage = view.getByTestId('uptime-monitor');
        await monitorPage.getByRole('button', { name: 'Pause' }).click();
        await page.getByRole('menuitem', { name: 'For 1 hour' }).click();
        await expect(monitorPage.getByTestId('uptime-state')).toHaveAttribute('data-state', 'paused');
        await expect(monitorPage.getByTestId('uptime-state')).toContainText('Paused until');
        const pause = (await tauri.callsTo('abs_uptime_pause'))[0].args as { until: number };
        expect(pause.until - Date.now()).toBeGreaterThan(HOUR - 60_000);
        await monitorPage.getByRole('button', { name: 'Resume' }).click();
        await expect(monitorPage.getByTestId('uptime-state')).not.toHaveAttribute('data-state', 'paused');
      });

      test('alerts go to Slack after a test reaches it', async ({ page, app, tauri }) => {
        const view = await openUptime(page, app);
        await view.getByRole('button', { name: /^Alerts/ }).click();
        const alerts = view.getByTestId('uptime-alerts');
        await alerts.getByTestId('uptime-add-place').click();
        const form = alerts.getByTestId('uptime-place-form');
        await form.getByLabel('Webhook address').fill('https://hooks.slack.com/services/T000/B000/xyz');
        await form.getByLabel('Name').fill('Team chat');
        await form.getByRole('button', { name: 'Send a test' }).click();
        await expect(page.getByText('Test sent to Team chat', { exact: true })).toBeVisible();
        await form.getByRole('button', { name: 'Add' }).click();
        await expect(alerts.getByTestId('uptime-place')).toContainText('Team chat');
        const settings = (await tauri.callsTo('abs_uptime_settings')).pop()?.args as { settings: { targets: Array<{ kind: string; url: string }> } };
        expect(settings.settings.targets).toEqual([expect.objectContaining({ kind: 'slack', url: 'https://hooks.slack.com/services/T000/B000/xyz' })]);
        await shot(page, 'alerts');
      });
    });
  });
});
