import { test, expect } from '../fixtures/test';
import { GROWTH_BUTTON, TEST_ACCOUNT_RULES, TEST_KEY, backToEditor, gateOf, openGrowth, section, viewButton } from '../helpers/growth';
import { ASC_KEYS_URL, ISSUER_ID, NEW_KEY_ID, appStoreKeysPage, driverSource } from '../helpers/growthBrowser';

// Ask AI is where Growth opens. Its assistant sets Growth up in a browser
// beside the chat (growth_browser.rs): it opens App Store Connect, the user
// says yes before anything in the account changes, and the key file the page
// downloads is saved without ever reaching the AI. The desktop harness stands
// a frame in for the browser and runs the real driver in it
// (helpers/growthBrowser.ts); the AI's answers are scripted, one per prompt.

/** abs_claude_detect for a Claude Code signed in on a Max plan. */
const CLAUDE_READY = {
  found: true,
  path: '/Users/e2e/.local/bin/claude',
  version: '2.1.285 (Claude Code)',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
};

const answer = (value: unknown) => JSON.stringify(value);

// The page numbers its controls in document order: People, Integrations,
// Copy, Generate API Key; then the dialog's Name, Access, Cancel and Generate;
// then the new key's Download.
const SCRIPT = [
  answer({
    say: "Let's get your App Store key. I'll open App Store Connect.",
    actions: [
      { do: 'set_stores', stores: ['appstore'] },
      { do: 'open', url: ASC_KEYS_URL },
    ],
    next: 'continue',
  }),
  answer({ say: '', actions: [{ do: 'click', ref: 4 }], next: 'continue' }),
  answer({
    say: "I'll name the key Open Screenshot Generator and give it Admin access.",
    actions: [
      { do: 'type', ref: 5, text: 'Open Screenshot Generator' },
      { do: 'pick', ref: 6, option: 'Admin' },
      { do: 'click', ref: 8, changes: true },
    ],
    next: 'continue',
  }),
  answer({ say: '', actions: [{ do: 'click', ref: 9 }], next: 'continue' }),
  answer({ say: 'Your App Store Connect API key is saved. Next comes your vendor number.', next: 'user' }),
  answer({ say: '', next: 'user' }),
];

test.describe('the Ask AI assistant', () => {
  test('Growth opens on Ask AI, which waits for the desktop app on the web and for an AI on the desktop', async ({ app, page, isDesktop }) => {
    await app.startBlankProject();
    const view = await openGrowth(page);
    await expect(section(view, 'Ask AI')).toHaveAttribute('aria-current', 'page');
    await expect(view.getByText("Let's connect your stores")).toBeVisible();

    const appStore = view.getByRole('button', { name: 'App Store', exact: true });
    await expect(appStore).toBeDisabled();
    await expect(gateOf(appStore)).toHaveAttribute(
      'data-gated-reason',
      isDesktop ? /sign in to Claude Code or Codex, or add a provider in the AI panel|Looking for Claude Code and Codex/ : 'Growth works in the desktop app only'
    );
    if (!isDesktop) await expect(view.getByRole('button', { name: 'Get the desktop app' })).toBeVisible();
    // The way to do it by hand is one click away.
    if (isDesktop) {
      await view.getByRole('button', { name: "I'd rather set it up myself" }).click();
      await expect(section(view, 'Setup')).toHaveAttribute('aria-current', 'page');
    }
  });

  test.describe('with Claude Code signed in and no Codex', () => {
    test.skip(({ isDesktop }) => !isDesktop, 'Claude Code and Codex run in the desktop app');
    test.use({ tauriConfig: { responses: { abs_claude_detect: CLAUDE_READY } } });

    test('Ask AI lets the user pick Claude Code, Codex or the AI panel, and says why one cannot answer', async ({ app, page }) => {
      await app.startBlankProject();
      const view = await openGrowth(page);
      const choices = view.getByRole('radiogroup', { name: 'AI to use' });
      const status = view.getByTestId('growth-ask-ai-status');
      // Automatic lands on Claude Code, the first that can answer.
      await expect(choices.getByRole('radio', { name: 'Claude Code' })).toHaveAttribute('aria-checked', 'true');
      await expect(status).toHaveText('Using Claude Code (Max plan)');
      await expect(view.getByRole('button', { name: 'App Store', exact: true })).toBeEnabled();

      // Codex is not installed: picking it says so on screen, and nothing can be sent.
      await choices.getByRole('radio', { name: 'Codex' }).click();
      await expect(choices.getByRole('radio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true');
      await expect(status).toHaveText('Codex is not installed on your computer');
      const appStore = view.getByRole('button', { name: 'App Store', exact: true });
      await expect(appStore).toBeDisabled();
      await expect(gateOf(appStore)).toHaveAttribute('data-gated-reason', 'Codex is not installed on your computer');
      // It is Growth's one AI setting, so Setup shows the same choice.
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('open-screenshot-generator.growth') ?? '{}'));
      expect(stored.aiWriter).toBe('codex');
      await section(view, 'Setup').click();
      await expect(view.getByTestId('growth-ai-writer-status')).toHaveText('Codex is not installed on your computer');

      await section(view, 'Ask AI').click();
      await choices.getByRole('radio', { name: 'Claude Code' }).click();
      await expect(status).toHaveText('Using Claude Code (Max plan)');
      await expect(view.getByRole('button', { name: 'App Store', exact: true })).toBeEnabled();
    });
  });

  test.describe('with Claude Code signed in', () => {
    test.skip(({ isDesktop }) => !isDesktop, 'The Growth browser is part of the desktop app');
    test.use({
      tauriConfig: {
        http: TEST_ACCOUNT_RULES,
        responses: { abs_claude_detect: CLAUDE_READY, abs_claude_prompt: { __sequence: [...SCRIPT] } },
        growthPages: { [ASC_KEYS_URL]: appStoreKeysPage(TEST_KEY) },
        growthDriver: driverSource(),
      },
    });

    test('the assistant makes an App Store key in the browser, asks before Generate, and saves the key it downloads', async ({ app, page, tauri }) => {
      await app.startBlankProject();
      const view = await openGrowth(page);
      await view.getByRole('button', { name: 'App Store', exact: true }).click();

      // The user's choice is the first message, and the browser opens beside the chat.
      await expect(view.getByText('My app is on the App Store. Help me connect it.')).toBeVisible();
      await expect(view.getByTestId('growth-browser-address')).toContainText('appstoreconnect.apple.com');
      await expect(view.getByText("Let's get your App Store key. I'll open App Store Connect.")).toBeVisible();

      // Generate changes the account, so it waits for a yes. Until then the
      // dialog is still open and no key exists.
      const ask = view.getByText('Can I press "Generate"?');
      await expect(ask).toBeVisible();
      const frame = page.frameLocator('#__e2e_growth_browser');
      await expect(frame.locator('#new-key')).toHaveCount(0);
      await expect(frame.locator('#name')).toHaveValue('Open Screenshot Generator');
      await expect(frame.locator('#access')).toHaveValue('Admin');
      // While the question waits the browser says where the answer goes.
      await expect(view.getByTestId('growth-browser')).toContainText('The assistant is waiting for your answer in the chat');
      await view.getByRole('button', { name: 'Yes, press it' }).click();

      await expect(view.getByText('App Store Connect API key saved')).toBeVisible();
      await expect(view.getByText(`Key ID ${NEW_KEY_ID}`).first()).toBeVisible();
      await expect(view.getByText('Your App Store Connect API key is saved. Next comes your vendor number.')).toBeVisible();
      await expect(view.getByText('You said yes to "Generate"')).toBeVisible();
      await expect(view.getByText('Clicked "Generate API Key"')).toBeVisible();

      // Saved where the upload dialog keeps it, with the Issuer ID the page showed.
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('open-screenshot-generator.store-credentials') ?? '{}'));
      expect(saved.appstore).toEqual({ issuerId: ISSUER_ID, keyId: NEW_KEY_ID, privateKey: TEST_KEY });
      // The setup card counts it, and Apple's list of apps loads with it.
      await expect(view.getByTestId('growth-setup-progress')).toContainText('1 of 2 done');

      // Every prompt fenced the page, and none carried the key.
      const prompts = (await tauri.callsTo('abs_claude_prompt')).map((call) => call.args as { system: string; prompt: string });
      expect(prompts.length).toBeGreaterThanOrEqual(5);
      for (const { system, prompt } of prompts) {
        expect(system).not.toContain('PRIVATE KEY');
        expect(prompt).not.toContain('PRIVATE KEY');
        expect(prompt).not.toContain(TEST_KEY.split('\n')[1]);
      }
      expect(prompts[1].prompt).toContain('<<<PAGE');
      expect(prompts[1].prompt).toContain(`Issuer ID ${ISSUER_ID}`);
      expect(prompts[1].system).toContain('# Setting up the App Store');
      expect(await tauri.unhandled()).toEqual([]);
    });

    test('the browser steps aside for a menu over it, another section and the editor, and comes back', async ({ app, page }) => {
      await app.startBlankProject();
      const view = await openGrowth(page);
      await view.getByRole('button', { name: 'App Store', exact: true }).click();
      await expect(view.getByText('Can I press "Generate"?')).toBeVisible();

      const browser = () =>
        page.evaluate(() => {
          const state = (window as unknown as { __E2E_TAURI__: { growthBrowser: { visible: boolean; bounds: { x: number; width: number; height: number } } } }).__E2E_TAURI__;
          return state.growthBrowser;
        });
      await expect.poll(async () => (await browser()).visible).toBe(true);
      // Placed over the pane: the right of the window, below its toolbar.
      const box = await view.getByTestId('growth-browser-page').boundingBox();
      const placed = (await browser()).bounds;
      expect(Math.abs(placed.x - Math.round(box!.x))).toBeLessThanOrEqual(1);
      expect(Math.abs(placed.width - Math.round(box!.width))).toBeLessThanOrEqual(1);

      // A list that opens over the browser would sit under it.
      await view.getByRole('combobox', { name: 'Date range' }).click();
      await expect(page.getByRole('option', { name: 'Last 90 days' })).toBeVisible();
      await expect.poll(async () => (await browser()).visible).toBe(false);
      await page.keyboard.press('Escape');
      await expect.poll(async () => (await browser()).visible).toBe(true);

      // Another section, then the editor: the browser goes, and comes back with Ask AI.
      await section(view, 'Overview').click();
      await expect.poll(async () => (await browser()).visible).toBe(false);
      // The Ask AI button says the assistant is waiting for the user.
      await expect(section(view, 'Ask AI')).toContainText('1');
      await section(view, 'Ask AI').click();
      await expect.poll(async () => (await browser()).visible).toBe(true);
      // The question is still there, the conversation lives on outside the screen.
      await expect(view.getByText('Can I press "Generate"?')).toBeVisible();
      await backToEditor(page);
      await expect.poll(async () => (await browser()).visible).toBe(false);
      await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: GROWTH_BUTTON, exact: true }).click();
      await expect(viewButton(page, GROWTH_BUTTON)).toHaveAttribute('aria-current', 'page');
      await expect.poll(async () => (await browser()).visible).toBe(true);

      // Closing the browser from its toolbar closes it in Rust too.
      await view.getByRole('button', { name: 'Close the browser' }).click();
      await expect(view.getByTestId('growth-browser')).toHaveCount(0);
    });
  });

  // Below 1024 pixels the chat and the browser take turns, picked by two tabs.
  test.describe('on a narrow window', () => {
    test.skip(({ isDesktop }) => !isDesktop, 'The Growth browser is part of the desktop app');
    test.use({
      viewport: { width: 900, height: 900 },
      tauriConfig: {
        http: TEST_ACCOUNT_RULES,
        responses: {
          abs_claude_detect: CLAUDE_READY,
          abs_claude_prompt: {
            __sequence: [
              answer({ say: "I'll open App Store Connect.", actions: [{ do: 'open', url: ASC_KEYS_URL }], next: 'continue' }),
              answer({ say: 'Add the key file you already have.', actions: [{ do: 'ask_for_key_file', kind: 'apple' }], next: 'continue' }),
              answer({ say: 'Your key is in.', next: 'user' }),
            ],
          },
        },
        growthPages: { [ASC_KEYS_URL]: appStoreKeysPage(TEST_KEY) },
        growthDriver: driverSource(),
      },
    });

    test('a key file request shows the chat, and the browser side offers the file picker too', async ({ app, page }) => {
      await app.startBlankProject();
      const view = await openGrowth(page);
      await view.getByRole('button', { name: 'App Store', exact: true }).click();
      const sides = view.getByRole('tablist', { name: 'Ask AI sides' });
      // The file is added in the chat, so the chat side comes up with its button.
      await expect(view.getByText('Add your .p8 key file')).toBeVisible();
      await expect(sides.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(view.getByRole('button', { name: 'Choose file', exact: true })).toBeVisible();

      // On the browser side, the strip says what to do and opens the same picker.
      await sides.getByRole('tab', { name: 'Browser', exact: true }).click();
      const pane = view.getByTestId('growth-browser');
      await expect(pane).toContainText('Your turn: add your .p8 key file');
      const chooser = page.waitForEvent('filechooser');
      await pane.getByRole('button', { name: 'Choose file', exact: true }).click();
      await (await chooser).setFiles({ name: `AuthKey_${NEW_KEY_ID}.p8`, mimeType: 'text/plain', buffer: Buffer.from(TEST_KEY) });

      await sides.getByRole('tab', { name: 'Chat', exact: true }).click();
      await expect(view.getByText('App Store Connect API key saved')).toBeVisible();
      await expect(view.getByText('Your key is in.')).toBeVisible();
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('open-screenshot-generator.store-credentials') ?? '{}'));
      expect(saved.appstore).toEqual({ issuerId: ISSUER_ID, keyId: NEW_KEY_ID, privateKey: TEST_KEY });
    });

    test('what the user is typing stays when they switch sides, or leave Ask AI and come back', async ({ app, page }) => {
      await app.startBlankProject();
      const view = await openGrowth(page);
      await view.getByRole('button', { name: 'App Store', exact: true }).click();
      await expect(view.getByText('Add your .p8 key file')).toBeVisible();
      const sides = view.getByRole('tablist', { name: 'Ask AI sides' });
      const box = view.getByRole('textbox', { name: 'Your message' });
      await box.fill('Which key should I use?');

      await sides.getByRole('tab', { name: 'Browser', exact: true }).click();
      await expect(box).toBeHidden();
      await sides.getByRole('tab', { name: 'Chat', exact: true }).click();
      await expect(box).toHaveValue('Which key should I use?');

      await section(view, 'Overview').click();
      await section(view, 'Ask AI').click();
      await expect(view.getByRole('textbox', { name: 'Your message' })).toHaveValue('Which key should I use?');
    });
  });
});
