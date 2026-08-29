import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration for Open Screenshot Generator.
 *
 * The app ships to two places and they are the SAME bundle: a static export
 * served over HTTP, and that same export inside a Tauri v2 desktop shell. So
 * the suite runs the same specs twice, under two projects:
 *
 *   web      Chromium, no Tauri. What a browser user gets.
 *   desktop  WebKit, with the Tauri IPC runtime injected before first script.
 *            WebKit because the macOS shell is WKWebView, and because the
 *            app's own notes call out WKWebView-only behaviour (it ignores
 *            `<a download>`, which is the whole reason src/lib/desktop.ts
 *            exists). Windows ships WebView2, which is Chromium, and is
 *            covered by the `desktop-chromium` project.
 *
 * There is no tauri-driver project: the official WebDriver bridge supports
 * Linux and Windows only, so it cannot run on macOS, and it cannot see which
 * IPC commands the app sent. See tests/e2e/README.md.
 *
 * Targets:
 *   default            the dev server on :9002 (npm run dev)
 *   E2E_TARGET=static  a static file server on :9003 over `out/`, which is the
 *                      bundle a desktop release actually loads
 */

const STATIC = process.env.E2E_TARGET === 'static';
const PORT = STATIC ? 9003 : 9002;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e/specs',
  outputDir: './tests/e2e/.artifacts',
  snapshotDir: './tests/e2e/snapshots',

  // The editor is heavy: it boots Dexie, loads a template catalogue and
  // renders device frames. A stingy timeout here reads as flake.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Every worker is another editor booting three.js and a template catalogue,
  // so more workers is not faster past a point.
  workers: process.env.CI ? 2 : 4,

  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'tests/e2e/.report', open: 'never' }], ['list']]
    : [['html', { outputFolder: 'tests/e2e/.report', open: 'never' }], ['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    // The canvas runs its own pinch zoom and the app is pointer-event driven,
    // so tests must behave like a real pointer, not a synthetic mouse.
    actionTimeout: 20_000,
  },

  projects: [
    {
      name: 'web',
      metadata: { platform: 'web' },
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        // Exports build large canvases; give the tab a real display.
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'desktop',
      metadata: { platform: 'desktop' },
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      // Windows desktop parity: WebView2 is Chromium. Opt in with --project.
      name: 'desktop-chromium',
      metadata: { platform: 'desktop' },
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      // Web on WebKit, i.e. Safari users. Opt in with --project.
      name: 'web-webkit',
      metadata: { platform: 'web' },
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1600, height: 1000 },
      },
    },
    {
      // Phones and iPads are supported (the app has a whole coarse-pointer
      // path). Opt in with --project.
      name: 'web-mobile',
      metadata: { platform: 'web' },
      use: { ...devices['iPad (gen 7) landscape'] },
    },
  ],

  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: STATIC
          ? 'npm run build && node tests/e2e/tools/static-server.mjs --port 9003'
          : 'npm run dev',
        url: BASE_URL,
        // Reuse the dev server a human already has open, which is the normal
        // local case. CI always starts its own.
        reuseExistingServer: !process.env.CI,
        timeout: STATIC ? 600_000 : 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
