import type { Locator } from '@playwright/test';
import { test, expect, type Page } from '../fixtures/test';

interface HttpRequest {
  rid: number;
  url: string;
  sending: boolean;
  body?: string;
  read: boolean;
  resolve?: (response: unknown) => void;
}

interface SignInMock {
  ports: number[];
  starts: Map<number, (result: unknown) => void>;
  callbacks: Map<number, (result: unknown) => void>;
  requests: HttpRequest[];
}

interface SignInWindow extends Window {
  __SIGNIN_E2E__: SignInMock;
  __TAURI_INTERNALS__: {
    invoke: (command: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
  };
  __E2E_TAURI__: {
    calls: { cmd: string; args: Record<string, unknown>; options: unknown }[];
    openedUrls: string[];
  };
}

async function mockDesktopSignIn(page: Page, holdStart = false): Promise<void> {
  await page.evaluate((pendingStart) => {
    const browser = window as unknown as SignInWindow;
    const original = browser.__TAURI_INTERNALS__.invoke;
    const state: SignInMock = {
      ports: [], starts: new Map(), callbacks: new Map(), requests: [],
    };
    browser.__SIGNIN_E2E__ = state;
    browser.__TAURI_INTERNALS__.invoke = async (cmd, args = {}, options) => {
      if (!cmd.startsWith('abs_oauth_') && !cmd.startsWith('plugin:http|')) {
        return original(cmd, args, options);
      }

      const config = args.clientConfig as { url: string; method: string } | undefined;
      // Keep OAuth request bodies out of the IPC log, which Playwright can save.
      const logged = config ? { clientConfig: { url: config.url, method: config.method } } : args;
      browser.__E2E_TAURI__.calls.push({ cmd, args: logged, options: null });
      if (cmd === 'abs_oauth_start') {
        const port = 41000 + state.ports.length;
        state.ports.push(port);
        const result = { port, redirect_uri: `http://127.0.0.1:${port}/callback` };
        if (!pendingStart) return result;
        return new Promise((resolve) => state.starts.set(port, resolve));
      }
      if (cmd === 'abs_oauth_await') {
        return new Promise((resolve) => state.callbacks.set(Number(args.port), resolve));
      }
      if (cmd === 'abs_oauth_cancel' || cmd === 'plugin:http|fetch_cancel' || cmd === 'plugin:http|fetch_cancel_body') {
        return null;
      }
      if (cmd === 'plugin:http|fetch') {
        const rid = 100 + state.requests.length;
        state.requests.push({ rid, url: config!.url, sending: false, read: false });
        return rid;
      }
      const request = state.requests.find((item) => item.rid === Number(args.rid));
      if (!request) throw new Error(`Unknown HTTP request ${String(args.rid)}`);
      if (cmd === 'plugin:http|fetch_send') {
        request.sending = true;
        return new Promise((resolve) => { request.resolve = resolve; });
      }
      if (cmd === 'plugin:http|fetch_read_body') {
        if (request.read) return [1];
        request.read = true;
        return [...new TextEncoder().encode(request.body ?? '{}'), 0];
      }
      throw new Error(`Unexpected sign-in command ${cmd}`);
    };
  }, holdStart);
}

async function releaseLoopback(page: Page, port: number): Promise<void> {
  await page.evaluate(async (value) => {
    const browser = window as unknown as SignInWindow;
    const url = browser.__E2E_TAURI__.openedUrls.find((address) =>
      new URL(address).searchParams.get('redirect_uri') === `http://127.0.0.1:${value}/callback`
    );
    browser.__SIGNIN_E2E__.callbacks.get(value)?.({
      code: 'late-test-code', state: url ? new URL(url).searchParams.get('state') : '',
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }, port);
}

async function waitForHttp(page: Page, url: string, index = 0): Promise<number> {
  await page.waitForFunction(({ address, occurrence }) => {
    const state = (window as unknown as SignInWindow).__SIGNIN_E2E__;
    return state.requests.filter((request) => request.url === address && request.sending).length > occurrence;
  }, { address: url, occurrence: index });
  return page.evaluate(({ address, occurrence }) =>
    (window as unknown as SignInWindow).__SIGNIN_E2E__.requests.filter((request) => request.url === address)[occurrence].rid,
  { address: url, occurrence: index });
}

async function releaseHttp(page: Page, rid: number, body: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (response) => {
    const request = (window as unknown as SignInWindow).__SIGNIN_E2E__.requests.find((item) => item.rid === response.rid)!;
    request.body = JSON.stringify(response.body);
    request.resolve?.({
      status: 200, statusText: 'OK', url: request.url,
      headers: [['content-type', 'application/json']], rid: request.rid,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }, { rid, body });
}

function accountDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Save to your own storage', exact: true }) });
}

async function expectIdle(dialog: Locator): Promise<void> {
  await expect(dialog.getByRole('button', { name: 'Continue with Google', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: /^Continue with GitHub/ })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Cancel sign-in', exact: true })).toHaveCount(0);
}

async function expectNoSession(page: Page): Promise<void> {
  expect(await page.evaluate(() => localStorage.getItem('open-screenshot-generator.account'))).toBeNull();
  await expect(page.getByText(/^Connected to (Google|GitHub)$/)).toHaveCount(0);
  await expect(page.getByText(/^Could not connect to (Google|GitHub)$/)).toHaveCount(0);
}

test.describe('account sign-in cancellation', () => {
  test('Google cancels its listener, retries, and ignores callbacks after cancel or close', async ({ app, page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'desktop Google sign-in uses the native OAuth listener');
    await app.dismissStartDialog();
    await mockDesktopSignIn(page);
    await app.sidebarButton('Account').click();
    const dialog = accountDialog(page);
    const google = dialog.getByRole('button', { name: 'Continue with Google', exact: true });

    await google.click();
    const first = Number((await tauri.waitForCall('abs_oauth_await')).args.port);
    await expect(google).toHaveAttribute('aria-busy', 'true');
    await expect(google.locator('..').getByRole('button', { name: 'Cancel sign-in', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
    await expect.poll(async () => (await tauri.callsTo('abs_oauth_cancel')).some((call) => call.args.port === first)).toBe(true);
    await expectIdle(dialog);

    await google.click();
    await expect.poll(async () => (await tauri.callsTo('abs_oauth_await')).length).toBe(2);
    const second = Number((await tauri.callsTo('abs_oauth_await'))[1].args.port);
    expect(second).not.toBe(first);
    await releaseLoopback(page, first);
    await expect(google).toHaveAttribute('aria-busy', 'true');
    await expect(google).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel sign-in', exact: true })).toBeVisible();
    expect(await tauri.callsTo('plugin:http|fetch')).toHaveLength(0);
    await expectNoSession(page);

    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await tauri.callsTo('abs_oauth_cancel')).some((call) => call.args.port === second)).toBe(true);
    await releaseLoopback(page, second);
    await app.sidebarButton('Account').click();
    await expectIdle(dialog);
    expect(await tauri.callsTo('plugin:http|fetch')).toHaveLength(0);
    await expectNoSession(page);
  });

  test('Google closes a listener that finishes starting after cancellation', async ({ app, page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'desktop Google sign-in uses the native OAuth listener');
    await app.dismissStartDialog();
    await mockDesktopSignIn(page, true);
    await app.sidebarButton('Account').click();
    const dialog = accountDialog(page);
    await dialog.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await tauri.waitForCall('abs_oauth_start');
    await dialog.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
    await expectIdle(dialog);

    const port = await page.evaluate(async () => {
      const state = (window as unknown as SignInWindow).__SIGNIN_E2E__;
      const value = state.ports[0];
      state.starts.get(value)?.({ port: value, redirect_uri: `http://127.0.0.1:${value}/callback` });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return value;
    });
    await expect.poll(async () => (await tauri.callsTo('abs_oauth_cancel')).some((call) => call.args.port === port)).toBe(true);
    expect(await tauri.callsTo('abs_oauth_await')).toHaveLength(0);
    expect((await tauri.openedUrls()).filter((url) => url.startsWith('https://accounts.google.com/'))).toHaveLength(0);
    expect(await tauri.callsTo('plugin:http|fetch')).toHaveLength(0);
    await expectNoSession(page);
  });

  test('GitHub aborts both device-code and token-poll requests and discards late responses', async ({ app, page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'desktop GitHub sign-in uses the device flow');
    await app.dismissStartDialog();
    await mockDesktopSignIn(page);
    await app.sidebarButton('Account').click();
    const dialog = accountDialog(page);
    const github = dialog.getByRole('button', { name: /^Continue with GitHub/ });
    const deviceUrl = 'https://github.com/login/device/code';
    const pollUrl = 'https://github.com/login/oauth/access_token';
    const deviceResponse = {
      device_code: 'test-device-code', user_code: 'TEST-CODE',
      verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5,
    };

    await github.click();
    const initial = await waitForHttp(page, deviceUrl);
    await expect(github.locator('..').getByRole('button', { name: 'Cancel sign-in', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
    await expect.poll(async () => (await tauri.callsTo('plugin:http|fetch_cancel')).some((call) => call.args.rid === initial)).toBe(true);
    await expectIdle(dialog);
    await releaseHttp(page, initial, deviceResponse);
    await expect(dialog.getByText('TEST-CODE', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as SignInWindow).__SIGNIN_E2E__.requests.map((request) => request.url))).toEqual([deviceUrl]);
    await expectNoSession(page);

    await github.click();
    const retry = await waitForHttp(page, deviceUrl, 1);
    await releaseHttp(page, retry, deviceResponse);
    await expect(dialog.getByText('TEST-CODE', { exact: true })).toBeVisible();
    const poll = await waitForHttp(page, pollUrl);
    await dialog.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
    await expect.poll(async () => (await tauri.callsTo('plugin:http|fetch_cancel')).some((call) => call.args.rid === poll)).toBe(true);
    await expectIdle(dialog);
    await expect(dialog.getByText('TEST-CODE', { exact: true })).toHaveCount(0);
    await releaseHttp(page, poll, { access_token: 'late-test-token' });
    expect(await page.evaluate(() => (window as unknown as SignInWindow).__SIGNIN_E2E__.requests.map((request) => request.url))).toEqual([deviceUrl, deviceUrl, pollUrl]);
    await expectNoSession(page);
  });

  test('web Google ignores a cancelled GIS callback while a retry is pending', async ({ app, page, isDesktop }) => {
    test.skip(isDesktop, 'web Google sign-in uses Google Identity Services');
    await app.dismissStartDialog();
    await page.evaluate(() => {
      const browser = window as unknown as Window & {
        google: unknown;
        __GIS_E2E__: { callbacks: ((response: unknown) => void)[]; requests: string[] };
      };
      const state = { callbacks: [] as ((response: unknown) => void)[], requests: [] as string[] };
      browser.__GIS_E2E__ = state;
      browser.google = { accounts: { oauth2: {
        initTokenClient: (config: { callback: (response: unknown) => void }) => {
          state.callbacks.push(config.callback);
          return { callback: config.callback, requestAccessToken: () => {} };
        },
        revoke: () => {},
      } } };
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.startsWith('https://openidconnect.googleapis.com/')) return original(input, init);
        state.requests.push(url);
        return new Response(JSON.stringify({ sub: 'late-account', name: 'Late account' }));
      };
    });
    await app.sidebarButton('Account').click();
    const dialog = accountDialog(page);
    const google = dialog.getByRole('button', { name: 'Continue with Google', exact: true });
    await google.click();
    await page.waitForFunction(() => (window as unknown as { __GIS_E2E__: { callbacks: unknown[] } }).__GIS_E2E__.callbacks.length === 1);
    await dialog.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
    await expectIdle(dialog);
    await google.click();
    await page.waitForFunction(() => (window as unknown as { __GIS_E2E__: { callbacks: unknown[] } }).__GIS_E2E__.callbacks.length === 2);
    await page.evaluate(async () => {
      (window as unknown as { __GIS_E2E__: { callbacks: ((response: unknown) => void)[] } }).__GIS_E2E__.callbacks[0]({ access_token: 'late-test-token', expires_in: 3600 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await expect(google).toHaveAttribute('aria-busy', 'true');
    await expect(google).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.evaluate(async () => {
      (window as unknown as { __GIS_E2E__: { callbacks: ((response: unknown) => void)[] } }).__GIS_E2E__.callbacks[1]({ access_token: 'late-test-token', expires_in: 3600 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await app.sidebarButton('Account').click();
    await expectIdle(dialog);
    expect(await page.evaluate(() => (window as unknown as { __GIS_E2E__: { requests: string[] } }).__GIS_E2E__.requests)).toEqual([]);
    await expectNoSession(page);
  });
});
