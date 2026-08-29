import { test, expect } from '../fixtures/test';
import type { Page } from '@playwright/test';
import { mouseWheelZoom } from '../helpers/canvas';
import { readAll, waitForProject } from '../fixtures/db';
import { Editor } from '../helpers/editor';

/**
 * Theme, and the one invariant the whole export pipeline rests on.
 *
 * The editor chrome has a dark palette. An artboard does not, and must never
 * get one: it is the user's artwork, and it has to look on screen exactly like
 * the PNG it exports whichever theme the app is wearing. globals.css buys that
 * by re-declaring the LIGHT tokens on `.artboard` and `[data-artboard-surface]`
 * under `.dark`, and by putting `color-scheme: light` back on them so the
 * browser's own native bits stay light too.
 *
 * That is a rule nothing enforces at build time. A new render site that forgets
 * the marker inherits the dark palette and nobody notices until an exported
 * screenshot comes out with grey text on it, so the assertions below read the
 * COMPUTED style of a chrome node and a board node together, in one comparison,
 * at both of the two render sites (the live canvas, and StaticArtboard behind
 * the preview dialog).
 */

const THEME_KEY = 'open-screenshot-generator.theme';
const TIPS_KEY = 'open-screenshot-generator.show-startup-tips';
const WHEEL_ZOOM_KEY = 'open-screenshot-generator.wheel-zoom';
const ACCOUNT_SYNC_KEY = 'open-screenshot-generator.account-auto-sync';
const ACCOUNT_SESSION_KEY = 'open-screenshot-generator.account';

// Straight out of globals.css. Asserting the token rather than the rendered
// rgb() keeps the expectation readable and still fails loudly if the palette
// stops reaching, or starts reaching, whatever is being probed.
const LIGHT_FOREGROUND = '0 0% 15%';
const DARK_FOREGROUND = '210 16% 93%';
const LIGHT_BACKGROUND = '0 0% 87.8%';
const DARK_BACKGROUND = '220 13% 9%';

/** Six lines of wheel, the same gesture canvas.spec.ts measures zoom with. */
const WHEEL_LINES = -6;

/** One attribute change on <html>, recorded from document_start. */
interface ThemeMutation {
  attribute: string | null;
  dark: boolean;
  bodyParsed: boolean;
}

interface Probe {
  background: string;
  color: string;
  colorScheme: string;
  foregroundToken: string;
  backgroundToken: string;
}

interface ThemeSnapshot {
  htmlDark: boolean;
  htmlColorScheme: string;
  /** Editor chrome: <body>, which wears `bg-background text-foreground`. */
  chrome: Probe;
  /** The live canvas board, `.artboard`. */
  board: Probe | null;
  /** The board's text element, the thing that actually ends up in the PNG. */
  text: Probe | null;
  /** The other render site, StaticArtboard's `[data-artboard-surface]`. */
  surface: Probe | null;
}

/**
 * Read the computed palette at every place it matters, in one round trip.
 *
 * Computed style rather than the class list on purpose: `.dark` being on <html>
 * says nothing about whether the cascade actually stopped at the board edge,
 * and that stopping is the whole point.
 */
function themeSnapshot(page: Page): Promise<ThemeSnapshot> {
  return page.evaluate(() => {
    const probe = (el: Element | null) => {
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        background: style.backgroundColor,
        color: style.color,
        colorScheme: style.colorScheme,
        foregroundToken: style.getPropertyValue('--foreground').trim(),
        backgroundToken: style.getPropertyValue('--background').trim(),
      };
    };
    const board = document.querySelector('[data-artboard-dom-id]');
    return {
      htmlDark: document.documentElement.classList.contains('dark'),
      htmlColorScheme: document.documentElement.style.colorScheme,
      chrome: probe(document.body)!,
      board: probe(board),
      text: probe(board?.querySelector('[data-text-body="true"]') ?? null),
      surface: probe(document.querySelector('[data-artboard-surface]')),
    };
  });
}

/**
 * Pick a theme in the settings dialog and leave the dialog open.
 *
 * Opening is conditional because the sidebar button that opens it is outside
 * the modal, and Radix makes everything out there inert: a second `openSettings`
 * on an already open dialog waits for a click that can never land.
 */
async function chooseTheme(app: Editor, name: 'System' | 'Light' | 'Dark'): Promise<void> {
  if (!(await app.settingsDialog.isVisible().catch(() => false))) {
    await app.openSettings();
  }
  const option = app.settingsDialog.getByRole('radio', { name, exact: true });
  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
}

test.describe('the theme preference', () => {
  test('picking Dark repaints the chrome live, with no reload', async ({ app, page }) => {
    await app.startBlankProject();

    const before = await themeSnapshot(page);
    expect(before.htmlDark).toBe(false);
    expect(before.chrome.backgroundToken).toBe(LIGHT_BACKGROUND);
    const lightChromeBackground = before.chrome.background;

    await chooseTheme(app, 'Dark');

    // Still the same document: no navigation, and the dialog the click landed
    // in is still on screen.
    await expect(app.settingsDialog).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark/);

    const after = await themeSnapshot(page);
    expect(after.chrome.backgroundToken).toBe(DARK_BACKGROUND);
    expect(after.chrome.foregroundToken).toBe(DARK_FOREGROUND);
    // The token moving is not proof the page repainted; the rendered colour is.
    expect(after.chrome.background).not.toBe(lightChromeBackground);
    expect(after.htmlColorScheme).toBe('dark');

    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe('dark');

    // And back, because a one-way switch would pass everything above.
    await chooseTheme(app, 'Light');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    const back = await themeSnapshot(page);
    expect(back.chrome.backgroundToken).toBe(LIGHT_BACKGROUND);
    expect(back.chrome.background).toBe(lightChromeBackground);
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe('light');
  });

  test('dark mode stops at the artboard edge', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await expect(app.board(0).locator('[data-text-body="true"]').first()).toBeVisible();

    const light = await themeSnapshot(page);
    expect(light.board).not.toBeNull();
    expect(light.text).not.toBeNull();

    await chooseTheme(app, 'Dark');
    await app.closeDialog();
    await expect(app.settingsDialog).toBeHidden();
    await expect(page.locator('html')).toHaveClass(/dark/);

    const dark = await themeSnapshot(page);

    // The load-bearing comparison: the chrome and the board are read in the
    // same breath, so a failure says which side moved rather than just "a
    // colour changed". If `.dark .artboard` ever stops re-declaring the light
    // palette, boardForeground here becomes the chrome's value.
    expect({
      chromeForeground: dark.chrome.foregroundToken,
      boardForeground: dark.board!.foregroundToken,
      chromeBackgroundToken: dark.chrome.backgroundToken,
      boardBackgroundToken: dark.board!.backgroundToken,
    }).toEqual({
      chromeForeground: DARK_FOREGROUND,
      boardForeground: LIGHT_FOREGROUND,
      chromeBackgroundToken: DARK_BACKGROUND,
      boardBackgroundToken: LIGHT_BACKGROUND,
    });

    // `color-scheme` is the second half of the rule and is easy to lose,
    // because losing it changes nothing a screenshot of the page would show:
    // it only moves the caret, the selection and native controls INSIDE a
    // board to the browser's dark defaults.
    expect({ html: dark.htmlColorScheme, board: dark.board!.colorScheme }).toEqual({
      html: 'dark',
      board: 'light',
    });

    // What the export actually captures has to be byte-identical in either
    // theme, so this is an equality against the light-mode reading, not a
    // "still looks lightish" range.
    expect({ background: dark.board!.background, color: dark.board!.color }).toEqual({
      background: light.board!.background,
      color: light.board!.color,
    });
    expect({ color: dark.text!.color, background: dark.text!.background }).toEqual({
      color: light.text!.color,
      background: light.text!.background,
    });
  });

  test('the second render site stays light too, behind the preview dialog', async ({ app, page }) => {
    // PreviewDialog paints boards through StaticArtboard, which marks itself
    // `data-artboard-surface` for exactly this reason. It is the render site a
    // future one would be copied from, so it gets its own assertion.
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    await chooseTheme(app, 'Dark');
    await app.closeDialog();
    await expect(app.settingsDialog).toBeHidden();

    await app.openPreview();
    await expect(page.locator('[data-artboard-surface]').first()).toBeVisible();

    const dark = await themeSnapshot(page);
    expect(dark.surface).not.toBeNull();
    expect({
      chromeForeground: dark.chrome.foregroundToken,
      surfaceForeground: dark.surface!.foregroundToken,
      surfaceColorScheme: dark.surface!.colorScheme,
    }).toEqual({
      chromeForeground: DARK_FOREGROUND,
      surfaceForeground: LIGHT_FOREGROUND,
      surfaceColorScheme: 'light',
    });
  });

  test('the choice survives a reload, and lands before the body is parsed', async ({ page }) => {
    const app = new Editor(page);
    await app.goto();
    await app.startBlankProject();
    await chooseTheme(app, 'Dark');
    await app.closeDialog();
    await expect(app.settingsDialog).toBeHidden();

    // Watch <html> from document_start, so the reload can say WHEN the theme
    // landed rather than only that it eventually did. The inline boot script in
    // layout.tsx runs in <head>; move it after hydration and this still reports
    // dark, but with the body already parsed, which is exactly the flash of
    // light palette a dark-mode user would see.
    //
    // The observer hangs off `document` rather than `document.documentElement`
    // because at document_start there is no root element yet, and a
    // MutationObserver callback is a microtask: it is delivered the moment the
    // inline script's stack empties, before the parser moves on to <body>.
    await page.addInitScript(() => {
      const seen: ThemeMutation[] = [];
      (window as unknown as { __themeMutations: ThemeMutation[] }).__themeMutations = seen;
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.target !== document.documentElement) continue;
          seen.push({
            attribute: record.attributeName,
            dark: document.documentElement.classList.contains('dark'),
            bodyParsed: document.body !== null,
          });
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    });

    await page.reload({ waitUntil: 'domcontentloaded' });

    // First assertion after the reload, before waiting on anything React does.
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);

    const first = await page.evaluate(
      () =>
        (window as unknown as { __themeMutations?: ThemeMutation[] }).__themeMutations?.[0] ?? null
    );
    // `class` first, and while the body is still unparsed: the theme beat the
    // first paint rather than arriving with hydration.
    expect(first).toEqual({ attribute: 'class', dark: true, bodyParsed: false });

    await app.waitForBoot();
    // Hydration does not undo it: ThemeProvider re-reads storage and re-applies.
    await expect(page.locator('html')).toHaveClass(/dark/);
    await app.openSettings();
    await expect(app.settingsDialog.getByRole('radio', { name: 'Dark', exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  test('System follows the OS, and keeps following it', async ({ app, page }) => {
    await app.startBlankProject();
    await app.openSettings();

    // Nothing stored means system, which is the default the boot script assumes.
    await expect(app.settingsDialog.getByRole('radio', { name: 'System', exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBeNull();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // The OS flipping mid-session has to flip the editor with it, which is the
    // matchMedia listener in ThemeContext rather than anything read at boot.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(app.settingsDialog).toContainText('Following your system, which is dark right now');
    expect((await themeSnapshot(page)).chrome.backgroundToken).toBe(DARK_BACKGROUND);

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(app.settingsDialog).toContainText('Following your system, which is light right now');

    // An explicit choice has to win over the OS from then on.
    await chooseTheme(app, 'Dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});

test.describe('settings persistence', () => {
  test('the wheel-zoom switch survives a reload and the reloaded canvas obeys it', async ({ app, page }) => {
    await app.startBlankProject();
    // The reload has to reopen this project rather than land back on the start
    // dialog, and the save behind it is debounced.
    await waitForProject(page, (project) => Boolean(project.id));

    await app.openSettings();
    const wheelZoom = page.locator('#settings-wheel-zoom');
    await expect(wheelZoom).toHaveAttribute('aria-checked', 'true');
    await wheelZoom.click();
    await expect(wheelZoom).toHaveAttribute('aria-checked', 'false');
    await app.closeDialog();
    await expect(app.settingsDialog).toBeHidden();
    expect(await page.evaluate((key) => localStorage.getItem(key), WHEEL_ZOOM_KEY)).toBe('0');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await expect(app.artboards.first()).toBeVisible();

    await app.openSettings();
    await expect(wheelZoom).toHaveAttribute('aria-checked', 'false');
    await app.closeDialog();
    await expect(app.settingsDialog).toBeHidden();

    // The switch showing "off" only proves the dialog read storage. This proves
    // the canvas did: a freshly mounted wheel handler leaves the zoom alone.
    await expect(app.zoomResetButton).toHaveText('100%');
    await mouseWheelZoom(page, app.board(0), WHEEL_LINES);
    await expect(app.zoomResetButton).toHaveText('100%');
  });

  test('syncing to your own storage is off until asked for, and the choice sticks', async ({ app, page }) => {
    await app.startBlankProject();
    await waitForProject(page, (project) => Boolean(project.id));

    // The half that matters. This switch writes to storage somebody else owns,
    // so an install that has never been asked about it must be OFF, and off
    // because nothing was ever written rather than because a default was read
    // back.
    expect(await page.evaluate((key) => localStorage.getItem(key), ACCOUNT_SYNC_KEY)).toBeNull();

    // And it must not have been left behind in Settings as well: two switches
    // for two destinations with opposite defaults is the misread that moving it
    // into the account dialog was meant to prevent.
    await app.openSettings();
    await expect(page.locator('#settings-account-auto-sync')).toHaveCount(0);
    await app.closeDialog();
    await expect(app.settingsDialog).toBeHidden();

    // The switch lives on the account dialog's storage tab, which only renders
    // its signed-in face. Signing in for real is off limits here (the suite
    // aborts every off-origin request, fixtures/test.ts), so a session goes
    // straight into the key store.ts reads and the page is reloaded onto it.
    // The project list behind the switch will fail to load, which is fine.
    await page.evaluate((key) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          provider: 'github',
          accessToken: 'e2e-not-a-real-token',
          account: { id: 'e2e-user', name: 'E2E User' },
        })
      );
    }, ACCOUNT_SESSION_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await expect(app.artboards.first()).toBeVisible();

    await page.getByRole('button', { name: /E2E User/ }).first().click();
    const autoSync = page.locator('#account-auto-sync');
    await expect(autoSync).toBeVisible();
    await expect(autoSync).toHaveAttribute('aria-checked', 'false');

    await autoSync.click();
    await expect(autoSync).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate((key) => localStorage.getItem(key), ACCOUNT_SYNC_KEY)).toBe('1');
    await app.closeDialog();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await expect(app.artboards.first()).toBeVisible();

    await page.getByRole('button', { name: /E2E User/ }).first().click();
    await expect(autoSync).toHaveAttribute('aria-checked', 'true');
    await app.closeDialog();

    // Turned on is not the same as pushing: nothing has been saved to any
    // account, so there is no link row and nothing for the syncer to update.
    expect(await readAll(page, 'accountLinks')).toEqual([]);
  });

  test('View tips hands the modal over to the wizard, which walks and closes', async ({ app, page }) => {
    await app.startBlankProject();
    await app.openSettings();

    await app.settingsDialog.getByRole('button', { name: 'View tips' }).click();
    // Handed over, not stacked: two focus traps at once is the bug this guards.
    await expect(app.settingsDialog).toBeHidden();

    const tips = page.getByRole('dialog').filter({ has: page.locator('#tips-show-on-startup') });
    await expect(tips).toBeVisible();
    await expect(tips).toContainText(/Tip 1 of \d+/);
    await expect(tips.getByRole('heading', { name: 'One project per store size' })).toBeVisible();

    const back = tips.getByRole('button', { name: 'Back' });
    const advance = tips.getByRole('button', { name: /^(Next|Got it)$/ });
    await expect(back).toBeDisabled();

    await advance.click();
    await expect(tips).toContainText(/Tip 2 of \d+/);
    await expect(tips.getByRole('heading', { name: 'Keep a copy so you never lose work' })).toBeVisible();
    await expect(back).toBeEnabled();

    await back.click();
    await expect(tips).toContainText(/Tip 1 of \d+/);
    await expect(tips.getByRole('heading', { name: 'One project per store size' })).toBeVisible();

    // The last step's button closes the wizard rather than walking past the end.
    await advance.click();
    await expect(advance).toHaveText('Got it');
    await advance.click();
    await expect(tips).toBeHidden();
    await expect(app.artboards.first()).toBeVisible();
  });

  test('turning tips back on brings the wizard back on the next load', async ({ page }) => {
    const app = new Editor(page);
    await app.goto();
    await app.startBlankProject();
    await app.openSettings();

    const tipsOnStartup = page.locator('#settings-tips-on-startup');
    // Off because the shared fixture suppressed them, which is the app's own
    // preference key rather than a test-only backdoor.
    await expect(tipsOnStartup).toHaveAttribute('aria-checked', 'false');
    await tipsOnStartup.click();
    await expect(tipsOnStartup).toHaveAttribute('aria-checked', 'true');

    const stored = await page.evaluate((key) => localStorage.getItem(key), TIPS_KEY);
    expect(stored).toBe('1');

    // That same fixture re-runs on every navigation, so a plain reload would
    // wipe the choice before the app could read it. Replay exactly what the app
    // just wrote, so the reload sees the user's real preference and nothing
    // invented here.
    await page.addInitScript(
      ({ key, value }) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // A context with storage disabled still runs the rest of the suite.
        }
      },
      { key: TIPS_KEY, value: stored! }
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();

    const tips = page.getByRole('dialog').filter({ has: page.locator('#tips-show-on-startup') });
    await expect(tips).toBeVisible();
    await expect(tips).toContainText(/Tip 1 of \d+/);

    // And the wizard's own checkbox is the same preference, so unticking it
    // there has to write the key back.
    await tips.getByRole('checkbox').click();
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), TIPS_KEY))
      .toBe('0');
  });
});
