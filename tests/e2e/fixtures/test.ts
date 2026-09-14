import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import { DEFAULT_TAURI_CONFIG, tauriInitScript, type TauriMockConfig } from './tauri-runtime';
import { TauriHarness } from './tauri';
import { Editor } from '../helpers/editor';

/**
 * Which build this project is exercising.
 *
 * Both are the same bundle. `desktop` differs only in that the Tauri IPC
 * runtime is present before the first script runs, which is exactly what
 * `isTauri()` looks for.
 */
export type Platform = 'web' | 'desktop';

/** Everything the app reaches for that is not on the origin under test. */
const OFFLINE_ALLOWED = ['localhost', '127.0.0.1', '0.0.0.0'];

export interface Fixtures {
  /** 'web' or 'desktop', read from the Playwright project's metadata. */
  platform: Platform;
  /** True on the desktop projects. Sugar for `platform === 'desktop'`. */
  isDesktop: boolean;
  /** Inspect and steer the mocked Tauri IPC. Inert on the web projects. */
  tauri: TauriHarness;
  /** The editor, as a page object. Already booted and past the tips dialog. */
  app: Editor;
  /**
   * Set to false in a test that genuinely needs the outside world.
   * Default true: every request off the origin is aborted, so a spec cannot
   * pass or fail because someone's community feed was up or down.
   *
   * Not called `offline`: that is a built-in Playwright context option which
   * takes the whole context off the network, and declaring a fixture with
   * that name silently turns it on.
   */
  hermetic: boolean;
  /** Overrides merged into the injected Tauri runtime for one test. */
  tauriConfig: Partial<TauriMockConfig>;
}

export const test = base.extend<Fixtures>({
  platform: [
    async ({}, use, testInfo) => {
      const declared = testInfo.project.metadata?.platform;
      await use(declared === 'desktop' ? 'desktop' : 'web');
    },
    { scope: 'test' },
  ],

  isDesktop: async ({ platform }, use) => {
    await use(platform === 'desktop');
  },

  hermetic: [true, { option: true }],
  tauriConfig: [{}, { option: true }],

  // Wraps the built-in context so the desktop runtime and the offline guard are
  // in place for EVERY document the test opens, detached panel windows included.
  context: async ({ context, platform, hermetic, tauriConfig }, use) => {
    await installBootScripts(context, platform, tauriConfig);
    if (hermetic) await installOfflineGuard(context);
    await use(context);
  },

  tauri: async ({ page, platform }, use) => {
    await use(new TauriHarness(page, platform === 'desktop'));
  },

  app: async ({ page }, use) => {
    const editor = new Editor(page);
    await editor.goto();
    await use(editor);
  },
});

export { expect };
export type { Page, BrowserContext };

async function installBootScripts(
  context: BrowserContext,
  platform: Platform,
  overrides: Partial<TauriMockConfig>
): Promise<void> {
  // The tips carousel opens over the editor on a first run and swallows every
  // click behind it. Suppressing it is the app's own documented preference
  // (SettingsDialog writes the same key), not a test-only backdoor.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('open-screenshot-generator.show-startup-tips', '0');
      window.localStorage.setItem('open-screenshot-generator.local-font-notice-dismissed', '1');
    } catch {
      // A context with storage disabled still runs the rest of the suite.
    }
  });

  if (platform === 'desktop') {
    await context.addInitScript({
      content: tauriInitScript({ ...DEFAULT_TAURI_CONFIG, ...overrides }),
    });
  }
}

async function installOfflineGuard(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (OFFLINE_ALLOWED.includes(url.hostname)) return route.continue();
    // Aborting rather than fulfilling with a stub: the app has to survive its
    // community feed, analytics and font CDN being unreachable, which is the
    // real condition for anyone editing on a plane.
    return route.abort();
  });
}
