import { test, expect } from '../fixtures/test';
import type { TauriHarness } from '../fixtures/tauri';

/**
 * In-app updates on the desktop (src/lib/updates, src-tauri/src/updater.rs).
 *
 * Nothing is downloaded or installed. On the desktop project the IPC is the
 * mock in fixtures/tauri-runtime.ts: a spec answers abs_update_state and
 * abs_update_check, plays Rust's state changes back through the event
 * updater.rs emits, and reads what the page asked Rust to do. The web build
 * has no updater, so every test here is desktop only.
 */

/** Must match the event names in src-tauri/src/updater.rs. */
const STATE_EVENT = 'abs-update-state';
const FLUSH_EVENT = 'abs-update-flush';
const CHECK_REQUEST_EVENT = 'abs-update-check-requested';

const UPDATE = {
  version: '1.0.8',
  currentVersion: '1.0.7',
  notes: 'Faster export\nThe iPhone Duo frame',
  date: '2026-11-07T10:00:00.000Z',
  critical: false,
  downloadPage: 'https://github.com/dotnetdreamer/open-screenshot-generator/releases/tag/v1.0.8',
  size: 1000,
};

function state(phase: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { mode: 'install', reason: null, currentVersion: '1.0.7', phase, checkedAt: null, ...overrides };
}

async function waitForListener(tauri: TauriHarness, event: string) {
  await expect
    .poll(async () => (await tauri.callsTo('plugin:event|listen')).some((call) => call.args.event === event), {
      timeout: 30_000,
      message: `the app never subscribed to ${event}`,
    })
    .toBe(true);
}

test.beforeEach(({ isDesktop }) => {
  test.skip(!isDesktop, 'the web build has no updater');
});

test.describe('an installer build', () => {
  test.use({
    tauriConfig: {
      responses: {
        abs_update_state: state({ phase: 'idle' }),
        abs_update_check: state({ phase: 'upToDate' }, { checkedAt: Date.now() }),
      },
    },
  });

  test('a ready update appears in the sidebar, and Restart asks the shell after every window has saved', async ({
    app,
    page,
    tauri,
  }) => {
    await app.dismissStartDialog();
    await waitForListener(tauri, STATE_EVENT);
    const item = page.getByRole('button', { name: 'Restart to update' });
    await expect(item).toHaveCount(0);

    await tauri.emitFromBackend(STATE_EVENT, state({ phase: 'ready', update: UPDATE }));
    await expect(item).toBeVisible();
    await item.click();

    const prompt = page.getByRole('dialog').filter({ hasText: 'Version 1.0.8 is ready' });
    await expect(prompt).toContainText('You have 1.0.7');
    await expect(prompt).toContainText('The iPhone Duo frame');
    await prompt.getByRole('button', { name: 'Restart now' }).click();
    await tauri.waitForCall('abs_update_install');

    // Rust asks every editor window to write its edits before it installs;
    // this one writes them and says so.
    await waitForListener(tauri, FLUSH_EVENT);
    await tauri.emitFromBackend(FLUSH_EVENT, 7);
    const answer = await tauri.waitForCall('abs_update_flushed');
    expect(answer.args).toEqual({ nonce: 7, ok: true });
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('Later closes the prompt and leaves the update waiting in the sidebar', async ({ app, page, tauri }) => {
    await app.dismissStartDialog();
    await waitForListener(tauri, STATE_EVENT);
    await tauri.emitFromBackend(STATE_EVENT, state({ phase: 'ready', update: UPDATE }));
    await page.getByRole('button', { name: 'Restart to update' }).click();
    const prompt = page.getByRole('dialog').filter({ hasText: 'Version 1.0.8 is ready' });
    await prompt.getByRole('button', { name: 'Later' }).click();
    await expect(prompt).toBeHidden();
    await expect(page.getByRole('button', { name: 'Restart to update' })).toBeVisible();
    expect(await tauri.callsTo('abs_update_install')).toEqual([]);
  });

  test('Help > Check for updates asks the server and says when there is nothing new', async ({ app, page, tauri }) => {
    await app.dismissStartDialog();
    await waitForListener(tauri, CHECK_REQUEST_EVENT);
    await tauri.emitFromBackend(CHECK_REQUEST_EVENT, null);
    const check = await tauri.waitForCall('abs_update_check');
    expect(check.args).toEqual({ channel: 'stable' });
    await expect(page.getByText('You have the latest version').first()).toBeVisible();
  });

  test('About says where updates stand, checks in place, and restarts into a ready update', async ({
    app,
    page,
    tauri,
  }) => {
    await waitForListener(tauri, STATE_EVENT);
    await app.dismissStartDialog();
    await app.sidebarButton('About').click();
    const about = page.getByRole('dialog').filter({ has: page.getByRole('link', { name: 'View on GitHub' }) });
    await expect(about).toBeVisible();

    await about.getByRole('button', { name: 'Check for updates' }).click();
    await expect(about.getByText('You have the latest version')).toBeVisible();
    await expect(about.getByText(/^Last checked/)).toBeVisible();
    expect((await tauri.callsTo('abs_update_check')).length).toBeGreaterThan(0);

    await tauri.emitFromBackend(STATE_EVENT, state({ phase: 'ready', update: UPDATE }));
    await expect(about.getByText('Version 1.0.8 is ready. Restart to update')).toBeVisible();
    await about.getByRole('button', { name: 'Restart now' }).click();
    await tauri.waitForCall('abs_update_install');
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('Settings shows the version and the switches, and beta is a new question for the server', async ({
    app,
    tauri,
  }) => {
    await waitForListener(tauri, STATE_EVENT);
    await app.dismissStartDialog();
    await app.openSettings();
    const dialog = app.settingsDialog;
    await expect(dialog.getByText('Version 1.0.7')).toBeVisible();
    await expect(dialog.getByRole('switch', { name: 'Check for updates automatically' })).toBeChecked();

    const beta = dialog.getByRole('switch', { name: 'Get beta versions' });
    await expect(beta).not.toBeChecked();
    await beta.click();
    await expect
      .poll(async () => (await tauri.callsTo('abs_update_check')).some((call) => call.args.channel === 'beta'))
      .toBe(true);
    expect(await tauri.unhandled()).toEqual([]);
  });
});

test.describe('the portable build', () => {
  test.use({
    tauriConfig: {
      responses: {
        abs_update_state: state({ phase: 'available', update: UPDATE }, { mode: 'notify', reason: 'portable' }),
      },
    },
  });

  test('a new version is offered as a download, never as a restart', async ({ app, page, tauri }) => {
    await app.dismissStartDialog();
    await page.getByRole('button', { name: 'New version available' }).click();
    const prompt = page.getByRole('dialog').filter({ hasText: 'Version 1.0.8 is out' });
    await expect(prompt).toContainText('cannot update itself');
    await expect(prompt.getByRole('button', { name: 'Restart now' })).toHaveCount(0);
    await prompt.getByRole('button', { name: 'Download' }).click();
    await expect.poll(() => tauri.openedUrls()).toContain(UPDATE.downloadPage);
    expect(await tauri.callsTo('abs_update_install')).toEqual([]);
  });
});

test.describe('a Microsoft Store build', () => {
  test.use({
    tauriConfig: {
      responses: { abs_update_state: state({ phase: 'idle' }, { mode: 'off', reason: 'microsoftStore' }) },
    },
  });

  test('it never asks our server, and Settings and About say the Store keeps it current', async ({
    app,
    page,
    tauri,
  }) => {
    await tauri.waitForCall('abs_update_state');
    await app.dismissStartDialog();
    await app.openSettings();
    await expect(app.settingsDialog.getByText('The Microsoft Store keeps the app up to date')).toBeVisible();
    await expect(app.settingsDialog.getByRole('switch', { name: 'Check for updates automatically' })).toHaveCount(0);
    await app.closeDialog();

    await app.sidebarButton('About').click();
    const about = page.getByRole('dialog').filter({ has: page.getByRole('link', { name: 'View on GitHub' }) });
    await expect(about.getByText('The Microsoft Store keeps the app up to date')).toBeVisible();
    await expect(about.getByRole('button', { name: 'Check for updates' })).toHaveCount(0);
    expect(await tauri.callsTo('abs_update_check')).toEqual([]);
  });
});
