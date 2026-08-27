import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '../fixtures/test';
import type { TauriHarness } from '../fixtures/tauri';
import { Editor } from '../helpers/editor';

/**
 * What the desktop shell adds, and what the web build does instead.
 *
 * The two builds are the same bundle, so every behaviour here is a fork on
 * `isTauri()` and the interesting bug is always the same one: the fork stops
 * being taken. A desktop-only assertion that is simply skipped on the web
 * cannot catch that, so wherever the web has an answer of its own this file
 * asserts BOTH halves in one test.
 *
 * Three things are only observable through the mocked IPC, and that is the
 * point of asserting on it: which URL the app handed the OS, which command it
 * sent when a dialog failed, and whether it sent a command the harness has
 * never heard of.
 */

const REPO_URL = 'https://github.com/dotnetdreamer/open-screenshot-generator';
const DESKTOP_DOWNLOAD_URL = 'https://openscrgen.app';
const APP_STORE_KEY_URL = 'https://appstoreconnect.apple.com/access/integrations/api';

/** The toolbar's source link. It is an anchor, not a button, on both platforms. */
const GITHUB_LINK_TITLE = 'Open Screenshot Generator on GitHub, star it or report an issue';

/**
 * Does this build have a web MCP relay?
 *
 * The desktop always has an MCP surface, because Rust hosts the socket. The
 * web only has one when NEXT_PUBLIC_MCP_RELAY_URL is set, and without it
 * McpServerStatus renders null on purpose (relayConfigured() in
 * lib/mcp/relayBridge.ts): there is no way for a tab to serve MCP at all.
 *
 * `.env.local` is gitignored, so "no relay" is exactly what a fresh clone and
 * a bare CI checkout look like. Reading the same file the dev server read is
 * what lets the web half of these tests tell "correctly absent" apart from
 * "regressed away", instead of asserting one of two legitimate builds.
 */
const WEB_RELAY_CONFIGURED = ((): boolean => {
  if ((process.env.NEXT_PUBLIC_MCP_RELAY_URL ?? '').trim()) return true;
  const root = resolve(__dirname, '../../..');
  for (const name of ['.env.local', '.env']) {
    const file = resolve(root, name);
    if (!existsSync(file)) continue;
    const match = readFileSync(file, 'utf8').match(/^\s*NEXT_PUBLIC_MCP_RELAY_URL\s*=\s*(.*)$/m);
    if (match && match[1].trim().replace(/^["']|["']$/g, '')) return true;
  }
  return false;
})();

/**
 * Record `window.open` instead of letting a popup happen.
 *
 * openExternal()'s web half is a `window.open` call (src/lib/desktop.ts). A
 * real popup would navigate to a host the hermetic guard aborts, so the tab it
 * leaves behind reports whatever the engine felt like putting in its address
 * bar. The arguments are the actual contract, and they are exact.
 *
 * Installed after boot on purpose: the app only reaches for window.open on a
 * click, never at module scope.
 */
async function recordWindowOpen(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const opened: string[] = [];
    (window as unknown as { __E2E_OPENED__: string[] }).__E2E_OPENED__ = opened;
    window.open = ((url?: string | URL) => {
      opened.push(String(url ?? ''));
      return null;
    }) as typeof window.open;
  });
  return () =>
    page.evaluate(() => (window as unknown as { __E2E_OPENED__?: string[] }).__E2E_OPENED__ ?? []);
}

/**
 * Block until the app has subscribed to a Rust-side event.
 *
 * `emitFromBackend` delivers to whoever is listening at that instant, so
 * pushing a status update before McpServerStatus's effect has run would be
 * delivered to nobody and the test would fail for a reason that has nothing to
 * do with the app. The subscription is itself an IPC call, so it is visible.
 */
async function waitForEventListener(tauri: TauriHarness, event: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await tauri.callsTo('plugin:event|listen')).some((call) => call.args.event === event),
      { timeout: 30_000, message: `the app never subscribed to ${event}` }
    )
    .toBe(true);
}

/** The MCP dialog, which the pill opens. */
function mcpDialog(page: Page) {
  return page.getByRole('dialog').filter({ hasText: 'MCP server' });
}

/** The store upload dialog, reached from the toolbar's Save menu. */
function publishDialog(page: Page) {
  return page.getByRole('dialog').filter({ hasText: 'Upload to the store' });
}

test.describe('the desktop handshake', () => {
  test('the splash signal fires exactly once, and the web never opens the IPC at all', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    // Churn after mount. signalAppReady lives in a mount-once effect, so a
    // second abs_app_ready would mean the tree remounted under the user and
    // Rust got told the splash may close twice.
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');

    if (!isDesktop) {
      expect(await page.evaluate(() => '__TAURI_INTERNALS__' in window)).toBe(false);
      expect(await tauri.calls()).toEqual([]);
      return;
    }

    await tauri.waitForCall('abs_app_ready', 30_000);
    expect(await tauri.callsTo('abs_app_ready')).toHaveLength(1);
    // The main window stays hidden until this lands, so it has to arrive after
    // the editor is real, not from some module-scope side effect.
    await expect(app.artboards).toHaveCount(1);
  });

  test.describe('after the OS killed the webview', () => {
    // macOS terminates WKWebView at its memory ceiling and the shell reloads
    // the page (issue #19). The one-shot command has to be answered before the
    // layout's mount effect asks, so it is configured, not set at runtime.
    test.use({
      tauriConfig: { responses: { abs_webview_crash_info: '2026-08-27T09:12:00Z' } },
    });

    test('the desktop build owns up to the reload, and the web build never asks', async ({
      page,
      tauri,
      isDesktop,
    }) => {
      // Takes `page`, not `app`, so nothing has awaited the boot yet.
      //
      // The notice is a toast, and this app clears a toast five seconds after
      // it is raised (TOAST_REMOVE_DELAY, src/hooks/use-toast.ts). It is
      // raised by a mount effect that resolves as soon as the IPC answers,
      // which is long before waitForBoot() has finished waiting on the
      // template catalogue. Booting first and looking afterwards is therefore
      // racing a five second timer against a wait with no upper bound, and it
      // loses whenever the machine is busy: the toast has already cleared and
      // no amount of extra timeout brings it back.
      //
      // So arm the read BEFORE the first paint, and take both strings out of
      // the one appearance rather than asserting twice against a toast that
      // may already be on its way out. Radix renders each toast as an <li> in
      // the viewport's <ol>.
      const editor = new Editor(page);
      const toast = page.locator('li').filter({ hasText: 'The editor was reloaded' });
      const captured = isDesktop
        ? toast.first().textContent({ timeout: 60_000 })
        : Promise.resolve(null);
      // Nothing is awaited between arming and navigating.
      const booted = editor.goto();

      if (!isDesktop) {
        await booted;
        // Nothing on the web can terminate the tab and put it back, so the
        // command must not be sent at all: a stray invoke here would throw
        // inside a browser.
        await expect(editor.startDialog).toBeVisible();
        expect(await tauri.calls()).toEqual([]);
        await expect(page.getByText('The editor was reloaded', { exact: true })).toHaveCount(0);
        return;
      }

      const text = await captured;
      await booted;
      await tauri.waitForCall('abs_webview_crash_info', 30_000);
      expect(text).toContain('The editor was reloaded');
      expect(text).toContain(
        'It ran out of memory and the app recovered it. Your last saved work is intact.'
      );
    });
  });
});

test.describe('leaving the app for a URL', () => {
  test('the GitHub link goes to the OS browser on desktop and stays an anchor on the web', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    await app.dismissStartDialog();
    const link = page.getByTitle(GITHUB_LINK_TITLE);
    await expect(link).toBeVisible();
    // The anchor keeps its own affordances on both platforms (middle click,
    // copy link address). Desktop only cancels the default at click time.
    await expect(link).toHaveAttribute('href', REPO_URL);
    await expect(link).toHaveAttribute('target', '_blank');

    const pagesBefore = page.context().pages().length;

    if (isDesktop) {
      await link.click();
      // A WebView swallows target="_blank", so the click has to be cancelled
      // and the URL handed to the opener plugin instead. If this regresses the
      // link silently does nothing at all for every desktop user.
      await expect.poll(() => tauri.openedUrls(), { timeout: 15_000 }).toEqual([REPO_URL]);
      expect(page.context().pages()).toHaveLength(pagesBefore);
      expect(new URL(page.url()).pathname).not.toContain('github');
      return;
    }

    const popup = page.waitForEvent('popup', { timeout: 20_000 });
    await link.click();
    // The browser opens the tab itself, so the app must NOT preventDefault.
    expect(await popup).toBeTruthy();
    expect(await tauri.openedUrls()).toEqual([]);
  });

  test('store uploads are a desktop capability, and each build links out its own way', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    await app.startBlankProject();
    await app.chooseFromMenu(app.saveButton, /To App Store Connect or Google Play/i);

    const dialog = publishDialog(page);
    await expect(dialog).toBeVisible();
    const openedUrls = await recordWindowOpen(page);

    if (isDesktop) {
      // Apple's API sends no CORS headers, so only the Tauri build can reach
      // it, and only the Tauri build asks for credentials.
      await expect(dialog.getByText('Store uploads need the desktop app')).toHaveCount(0);
      await expect(page.locator('#asc-issuer')).toBeVisible();

      await dialog.getByRole('button', { name: /Open the keys page/ }).click();
      await expect.poll(() => tauri.openedUrls(), { timeout: 15_000 }).toEqual([APP_STORE_KEY_URL]);
      // Same click, the other branch: a WebView would have shown an empty tab.
      expect(await openedUrls()).toEqual([]);
      return;
    }

    await expect(dialog.getByText('Store uploads need the desktop app')).toBeVisible();
    await expect(page.locator('#asc-issuer')).toHaveCount(0);

    await dialog.getByRole('button', { name: /Get the desktop app/ }).click();
    await expect.poll(openedUrls, { timeout: 15_000 }).toEqual([DESKTOP_DOWNLOAD_URL]);
  });
});

test.describe('the MCP status pill', () => {
  test.describe('with the Rust server already up', () => {
    // The pill reads the status once on mount, so the answer has to be in
    // place before the page loads.
    test.use({
      tauriConfig: {
        responses: {
          abs_mcp_status: { running: true, port: 8722, url: 'http://127.0.0.1:8722/mcp' },
        },
      },
    });

    test('desktop shows the live port, the web build shows a link it has to connect', async ({
      app,
      page,
      isDesktop,
    }) => {
      test.skip(
        !isDesktop && !WEB_RELAY_CONFIGURED,
        'this build has no NEXT_PUBLIC_MCP_RELAY_URL, so the web has no MCP surface to assert on'
      );
      await app.dismissStartDialog();
      const pill = app.mcpStatusPill;
      await expect(pill).toBeVisible();

      if (isDesktop) {
        // The port is the whole point of the pill: it is what the user pastes
        // into their AI client.
        await expect(pill).toContainText(':8722');
        await pill.click();
        await expect(mcpDialog(page).getByText('Running', { exact: true })).toBeVisible();
        // Exact: the same URL is baked into every client setup snippet below
        // it, and only the top field is the one the user copies.
        await expect(
          mcpDialog(page).getByText('http://127.0.0.1:8722/mcp', { exact: true })
        ).toBeVisible();
        return;
      }

      // A browser tab cannot listen on a port, so the same canned status must
      // not reach the web branch at all: it connects out to the relay instead,
      // and starts off.
      await expect(pill).toContainText('off');
      await expect(pill).not.toContainText('8722');
      await pill.click();
      await expect(mcpDialog(page).getByText('Off', { exact: true })).toBeVisible();
      await expect(mcpDialog(page).getByRole('button', { name: 'Connect' })).toBeVisible();
    });
  });

  test('a status push from Rust moves the pill without a reload', async ({
    app,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'the abs-mcp-status event only exists inside the desktop shell');
    await app.dismissStartDialog();
    await expect(app.mcpStatusPill).toContainText('off');

    await waitForEventListener(tauri, 'abs-mcp-status');
    await tauri.emitFromBackend('abs-mcp-status', {
      running: true,
      port: 9911,
      url: 'http://127.0.0.1:9911/mcp',
    });
    await expect(app.mcpStatusPill).toContainText(':9911');

    // And back down again, because the user can switch the server off from the
    // native menu while the editor sits there.
    await tauri.emitFromBackend('abs-mcp-status', { running: false, port: null, url: null });
    await expect(app.mcpStatusPill).toContainText('off');
    await expect(app.mcpStatusPill).not.toContainText('9911');
  });

  test('the dialog offers each platform the switch it actually has', async ({
    app,
    page,
    isDesktop,
  }) => {
    test.skip(
      !isDesktop && !WEB_RELAY_CONFIGURED,
      'this build has no NEXT_PUBLIC_MCP_RELAY_URL, so the web has no MCP surface to assert on'
    );
    await app.dismissStartDialog();
    await app.mcpStatusPill.click();
    const dialog = mcpDialog(page);
    await expect(dialog).toBeVisible();

    if (isDesktop) {
      // Rust owns the socket, so the only switch is in the native menu bar and
      // the dialog has to say so rather than offering a button it cannot honour.
      await expect(dialog.getByText(/Turn it on from the menu bar/)).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Connect' })).toHaveCount(0);
      // Off, but still handing out the default local URL to paste.
      await expect(dialog.getByText('http://127.0.0.1:8722/mcp', { exact: true })).toBeVisible();
      return;
    }

    await expect(dialog.getByRole('button', { name: 'Connect' })).toBeVisible();
    await expect(dialog.getByText(/Turn it on from the menu bar/)).toHaveCount(0);
  });
});

test.describe('desktop failure paths', () => {
  test('a native save dialog that throws surfaces a toast instead of failing silently', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'the web build has no native dialog to fail');
    await app.startBlankProject();
    // A real save sheet fails for ordinary reasons: a read-only volume, a
    // revoked scope, a missing permission line in capabilities/default.json.
    await tauri.setError('plugin:dialog|save', 'boom');

    await app.chooseFromMenu(app.exportButton, /Project file \.json/i);

    // `exact` because the toast viewport also renders a screen-reader
    // announcement that concatenates every toast's title and description.
    await expect(page.getByText('Export Failed', { exact: true })).toBeVisible();
    // Nothing was written, and the editor is still usable afterwards.
    expect(await tauri.files()).toEqual([]);
    await expect(app.artboards).toHaveCount(1);
    await expect(app.exportButton).toBeEnabled();
  });
});

test.describe('the desktop surface is fully modelled', () => {
  test('a whole editor session sends no command the harness cannot answer', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'there is no IPC to audit on the web');

    // Walk the parts of the app most likely to grow a new Rust call: the
    // canvas, the palette, every dialog with a platform fork in it, and the
    // MCP pill.
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await app.addElement('Rectangle', 'basic:rectangle');
    await app.undoButton.click();
    await expect(app.elementsOn(0)).toHaveCount(1);
    await app.redoButton.click();
    await expect(app.elementsOn(0)).toHaveCount(2);

    await app.canvasSizeButton.click();
    await expect(app.canvasSizeDialog).toBeVisible();
    await app.closeDialog();
    await expect(app.canvasSizeDialog).toBeHidden();

    await app.openExportDialog();
    await app.exportDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.exportDialog).toBeHidden();

    await app.openPreview();
    await app.closeDialog();
    await expect(app.previewDialog).toBeHidden();

    await app.mcpStatusPill.click();
    await expect(mcpDialog(page)).toBeVisible();
    await app.closeDialog();
    await expect(mcpDialog(page)).toBeHidden();

    // The session really did talk to the shell, so an empty `unhandled` means
    // "every command was modelled", not "nothing was sent".
    expect((await tauri.calls()).length).toBeGreaterThan(0);
    expect(await tauri.unhandled()).toEqual([]);
  });
});
