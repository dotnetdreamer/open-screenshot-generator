import { test, expect } from '../fixtures/test';
import {
  GROWTH_BUTTON,
  TEST_ACCOUNT_RULES,
  TEST_APP,
  backToEditor,
  connectTestAccount,
  gateOf,
  growthMetaKeys,
  openGrowth,
  releaseHeldCommands,
  section,
  viewButton,
  views,
} from '../helpers/growth';

// Growth is one of the views on the activity bar. With no app (the web build,
// which cannot reach App Store Connect, or the desktop app before a key is
// connected) every section is there and empty, and each action says why it
// cannot run. On the desktop the rest runs on a connected test account whose
// numbers are written straight into the growth database from
// tests/fixtures/growthSample.ts; growth-sync.spec.ts covers the sync itself.

const EMPTY_SECTIONS: Array<[string, string]> = [
  ['Overview', 'No numbers for your app yet'],
  ['Insights', 'No insights to show'],
  ['Reviews', 'No written reviews yet'],
  ['Store page', 'Store page not loaded yet'],
  ['Countries', 'No numbers by country yet'],
  ['Timeline', 'Nothing on the timeline yet'],
  ['Reports', 'No report yet'],
  ['Ask AI', 'Ask about your app'],
];

/** abs_claude_detect for a Claude Code signed in on a Max plan (ClaudeDetection). */
const CLAUDE_READY = {
  found: true,
  path: '/Users/e2e/.local/bin/claude',
  version: '2.1.285 (Claude Code)',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
};

const SUGGESTED_REPLY = 'Thank you for telling us. Version 2.5 fixes the crash on launch, and it is with Apple for review now.';

/** What Claude Code answers in the tests that hold an answer in flight. */
const HELD_ANSWER = 'Downloads fell by about half while the conversion rate held, so fewer people saw the app.';

/** A German subtitle, which the stub hands back for every language Translate asks about. */
const TRANSLATED_SUBTITLE = 'Kleine Schritte, lange Serien';

test.describe('growth', () => {
  test('the activity bar switches to Growth, which shows every section empty and says why each action waits', async ({ app, page, isDesktop, tauri }) => {
    await app.startBlankProject();
    const bar = views(page);
    await expect(viewButton(page, 'Editor')).toHaveAttribute('aria-current', 'page');
    // One Growth button in the window: the toolbar has none of its own.
    await expect(page.getByTitle(GROWTH_BUTTON)).toHaveCount(1);

    // The account and the app's settings are on the bar too, and work from there.
    for (const name of ['Account', 'Settings', 'About']) {
      await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
    }
    // Discover is there only when the build has a Discover server, and then on the bar alone.
    const discoverOnBar = await bar.getByRole('button', { name: 'Discover', exact: true }).count();
    await expect(page.getByRole('button', { name: 'Discover', exact: true })).toHaveCount(discoverOnBar);
    await bar.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(app.settingsDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(app.settingsDialog).toBeHidden();

    const exportBox = await app.exportButton.boundingBox();
    if (!exportBox) throw new Error('The Export button has no bounding box');
    const view = await openGrowth(page);
    await expect(viewButton(page, GROWTH_BUTTON)).toHaveAttribute('aria-current', 'page');
    await expect(viewButton(page, 'Editor')).not.toHaveAttribute('aria-current', 'page');
    // The editor stays mounted under Growth, out of sight: its toolbar does
    // not draw over the view, and a press where Export was lands in Growth.
    await expect(app.exportButton).toBeHidden();
    const pressLands = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="growth-view"]'),
      { x: exportBox.x + exportBox.width / 2, y: exportBox.y + exportBox.height / 2 }
    );
    expect(pressLands, 'the spot where Export was belongs to Growth').toBe(true);

    const reason = isDesktop
      ? 'Add your App Store Connect API key or Google Play service account key under Setup first'
      : 'Growth works in the desktop app only';
    await expect(view.getByTestId('growth-no-app')).toContainText(reason);
    const sync = view.getByRole('button', { name: 'Refresh', exact: true });
    await expect(sync).toBeDisabled();
    await expect(gateOf(sync)).toHaveAttribute('data-gated-reason', reason);

    for (const [name, empty] of EMPTY_SECTIONS) {
      await section(view, name).click();
      await expect(section(view, name)).toHaveAttribute('aria-current', 'page');
      await expect(view.getByText(empty, { exact: true })).toBeVisible();
    }
    const ask = view.getByRole('button', { name: 'Ask', exact: true });
    await expect(ask).toBeDisabled();
    await expect(gateOf(ask)).toHaveAttribute('data-gated-reason', reason);
    await expect(gateOf(view.getByRole('button', { name: 'Ask the agent' }))).toHaveAttribute('data-gated-reason', reason);

    await section(view, 'Timeline').click();
    const add = view.getByRole('button', { name: 'Add to the timeline' });
    await expect(add).toBeDisabled();
    await expect(gateOf(add)).toHaveAttribute('data-gated-reason', reason);

    await section(view, 'Setup').click();
    if (isDesktop) {
      // The desktop app takes the key here.
      await expect(view.locator('#asc-issuer')).toBeVisible();
    } else {
      await expect(view.getByText('Your own numbers need the desktop app')).toBeVisible();
      const addKey = view.getByRole('button', { name: 'Add your key' });
      await expect(addKey).toBeDisabled();
      await expect(gateOf(addKey)).toHaveAttribute('data-gated-reason', reason);
    }

    await backToEditor(page);
    await expect(viewButton(page, 'Editor')).toHaveAttribute('aria-current', 'page');
    await expect(app.exportButton).toBeVisible();
    await expect(app.board(0)).toBeVisible();
    // Every command Growth sent on the desktop has an answer in the harness.
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('the editor under Growth keeps its project and selection, and takes no keys while Growth is in front', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    const box = await app.elementsOn(0).first().boundingBox();
    if (!box) throw new Error('The rectangle has no bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(app.selectedElement).toHaveCount(1);

    const view = await openGrowth(page);
    await section(view, 'Reviews').click();
    // The keys go to a Growth button, not a text field. Delete and Backspace
    // would remove the selected rectangle and Cmd+Z would take back its add,
    // if they reached the hidden canvas. WebKit does not focus a clicked
    // button, so the focus is put there.
    await section(view, 'Reviews').focus();
    await expect(section(view, 'Reviews')).toBeFocused();
    // WebKit takes Backspace on a control as "go back a page", which would
    // take the editor with it.
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ControlOrMeta+z');
    expect(navigations, 'a key pressed in Growth sent the page somewhere else').toEqual([]);

    await backToEditor(page);
    await expect(app.elementsOn(0)).toHaveCount(1);
    await expect(app.selectedElement).toHaveCount(1);

    // Growth comes back on the section it was left on.
    await viewButton(page, GROWTH_BUTTON).click();
    await expect(view).toBeVisible();
    await expect(section(view, 'Reviews')).toHaveAttribute('aria-current', 'page');
  });

  test.describe('on a connected account', () => {
    test.skip(({ isDesktop }) => !isDesktop, 'App Store Connect is reached through the desktop shell only');
    test.use({ tauriConfig: { http: TEST_ACCOUNT_RULES } });

    test.beforeEach(async ({ app, page }) => {
      await connectTestAccount(page);
      await app.goto();
      await app.startBlankProject();
    });

    test('Growth opens on the app, and the overview measures the new screenshots', async ({ page }) => {
      const view = await openGrowth(page);
      await expect(view.getByRole('combobox', { name: 'App' })).toContainText(TEST_APP.name);
      await expect(view.getByTestId('growth-no-app')).toHaveCount(0);
      await expect(view.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();

      const impact = view.getByTestId('growth-impact');
      await expect(impact).toContainText('Did the new screenshots work?');
      await expect(impact).toContainText('Up');
      await expect(impact).toContainText('to version 2.4');
      await expect(impact).toContainText('14 of 14 days measured');
      // A before and after comparison names what else changed in its weeks.
      await expect(impact.getByTestId('growth-impact-others')).toBeVisible();

      for (const tile of ['Times seen', 'Page visits', 'Download rate', 'New downloads', 'Earnings']) {
        await expect(view.getByRole('button', { name: new RegExp(`^${tile}`) })).toBeVisible();
      }
      // The chart follows the tile that was clicked.
      await view.getByRole('button', { name: /^Download rate/ }).click();
      await expect(view.getByText('Download rate by day')).toBeVisible();
    });

    test('a storefront reading another language leads to the language manager, with that language ticked', async ({ page }) => {
      const view = await openGrowth(page);
      await section(view, 'Insights').click();

      const card = view.locator('[data-insight-kind="localize"]').filter({ hasText: 'Japanese' });
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: 'Translate the screenshots' }).click();

      // The screenshots are in the editor, so that is where it goes.
      await expect(view).toBeHidden();
      const languages = page.getByRole('dialog').filter({ hasText: 'Languages' });
      await expect(languages).toBeVisible();
      await expect(languages.locator('#locale-ja')).toHaveAttribute('data-state', 'checked');
      // The open dialog hides the bar from role queries, so it is found by its test id.
      await expect(page.getByTestId('activity-bar').getByTitle('Editor', { exact: true })).toHaveAttribute('aria-current', 'page');
    });

    test('the timeline takes an event, and the weekly report has the week in numbers', async ({ page }) => {
      const view = await openGrowth(page);
      await section(view, 'Timeline').click();

      await expect(view.getByText('New screenshots uploaded')).toBeVisible();
      await view.getByRole('textbox', { name: 'What happened' }).fill('Launched on a podcast');
      await view.getByRole('button', { name: 'Add to the timeline' }).click();
      await expect(view.locator('[data-event-id]').filter({ hasText: 'Launched on a podcast' })).toBeVisible();

      await section(view, 'Reports').click();
      const report = view.getByTestId('growth-report');
      await expect(report).toContainText('Week of');
      await expect(report.getByRole('cell', { name: 'New downloads' })).toBeVisible();
    });

    test('a yearly report says what it cannot compare, and saves as a PDF', async ({ page, tauri }) => {
      const view = await openGrowth(page);
      await section(view, 'Reports').click();
      await view.getByRole('button', { name: 'Yearly' }).click();

      const report = view.getByTestId('growth-report');
      await expect(report).toContainText(/\d{4} so far/);
      // The numbers go back half a year, so the year before has nothing to stand beside.
      await expect(report.getByTestId('growth-report-note')).toContainText('Nothing is compared with');

      await view.getByRole('button', { name: 'Save as PDF' }).click();
      await expect.poll(async () => (await tauri.files()).length, { timeout: 30_000 }).toBe(1);
      const [file] = await tauri.files();
      expect(file.via).toBe('plugin:fs|write_file');
      expect(file.path).toMatch(/Juniper Habit Tracker year \d{4}-01-01\.pdf$/);
      expect(file.bytes).toBeGreaterThan(10_000);
      const [saveDialog] = await tauri.callsTo('plugin:dialog|save');
      expect((saveDialog.args.options as { defaultPath?: string }).defaultPath).toMatch(/^Juniper Habit Tracker year \d{4}-01-01\.pdf$/);
      await expect(view.getByRole('button', { name: 'Save as PDF' })).toBeEnabled();
    });

    test('listing edits outlast a section change, a visit to the editor and a reload', async ({ app, page }) => {
      let view = await openGrowth(page);
      await section(view, 'Store page').click();
      await view.getByRole('button', { name: 'Clean up' }).click();
      const keywords = () => page.getByTestId('growth-view').locator('#growth-field-keywords');
      const cleaned = await keywords().inputValue();
      expect(cleaned).not.toMatch(/, /);

      // Each section is a fresh screen, so the edit lives outside it.
      await section(view, 'Reviews').click();
      await section(view, 'Store page').click();
      await expect(keywords()).toHaveValue(cleaned);
      await expect(view.getByRole('button', { name: 'Apply in App Store Connect' })).toBeEnabled();

      // To the editor and back: Growth is where it was left.
      await backToEditor(page);
      view = await openGrowth(page);
      await expect(section(view, 'Store page')).toHaveAttribute('aria-current', 'page');
      await expect(keywords()).toHaveValue(cleaned);

      // A reload starts Growth afresh, and the edit comes back from the growth database.
      await app.goto();
      await app.dismissStartDialog();
      view = await openGrowth(page);
      await section(view, 'Store page').click();
      await expect(keywords()).toHaveValue(cleaned);

      await view.getByRole('button', { name: 'Discard all' }).click();
      await expect(keywords()).toHaveValue(/, /);
    });

    test('with no Claude Code or Codex and no AI set up, the AI buttons say how to get one', async ({ page }) => {
      const view = await openGrowth(page);
      await section(view, 'Reviews').click();
      await view.getByRole('combobox', { name: 'Filter by reply' }).click();
      await page.getByRole('option', { name: 'Needs a reply' }).click();
      const review = view.locator('[data-review-id]').filter({ hasText: 'Crashes on launch' });
      await review.getByRole('button', { name: 'Reply' }).click();

      const suggest = review.getByRole('button', { name: 'Suggest a reply' });
      await expect(suggest).toBeDisabled();
      await expect(gateOf(suggest)).toHaveAttribute('data-gated-reason', /sign in to Claude Code or Codex, or add a provider in the AI panel/);
      // A reply written by hand needs no AI.
      await expect(review.getByRole('textbox', { name: 'Reply' })).toBeEditable();
    });

    test.describe('with Claude Code signed in', () => {
      test.use({
        tauriConfig: {
          http: TEST_ACCOUNT_RULES,
          responses: { abs_claude_detect: CLAUDE_READY, abs_claude_prompt: SUGGESTED_REPLY },
        },
      });

      test('a suggested reply comes from Claude Code on the plan, and nothing goes to Apple', async ({ page, tauri }) => {
        const view = await openGrowth(page);
        await section(view, 'Setup').click();
        await expect(view.getByTestId('growth-ai-writer-status')).toHaveText('Using Claude Code (Max plan)');

        await section(view, 'Reviews').click();
        await view.getByRole('combobox', { name: 'Filter by reply' }).click();
        await page.getByRole('option', { name: 'Needs a reply' }).click();
        const review = view.locator('[data-review-id]').filter({ hasText: 'Crashes on launch' });
        await review.getByRole('button', { name: 'Reply' }).click();
        await review.getByRole('button', { name: 'Suggest a reply' }).click();
        await expect(review.getByRole('textbox', { name: 'Reply' })).toHaveValue(SUGGESTED_REPLY);

        // One prompt, with the review fenced as data and the app named in the instructions.
        const prompts = await tauri.callsTo('abs_claude_prompt');
        expect(prompts).toHaveLength(1);
        const args = prompts[0].args as { system: string; prompt: string };
        expect(args.system).toContain(TEST_APP.name);
        expect(args.prompt).toContain('<<<REVIEW');
        expect(args.prompt).toContain('Crashes on launch');
        expect(await tauri.callsTo('abs_codex_prompt')).toHaveLength(0);

        // The suggestion waits in the box: only Send reply posts it.
        const posted = await page.evaluate(() =>
          ((window as any).__E2E_TAURI__.httpRequests as Array<{ method: string }>).filter((request) => request.method === 'POST')
        );
        expect(posted).toHaveLength(0);
        expect(await tauri.unhandled()).toEqual([]);
      });

      test('Translate writes each other language through Claude Code into the suggested changes, and nothing goes to Apple', async ({ page, tauri }) => {
        await tauri.setResponse('abs_claude_prompt', JSON.stringify({ subtitle: TRANSLATED_SUBTITLE }));
        const view = await openGrowth(page);
        await section(view, 'Store page').click();
        await view.getByRole('button', { name: 'Translate with AI' }).click();
        await expect(view.getByText('3 translations added to your changes')).toBeVisible();
        await expect(view.getByRole('button', { name: 'Apply in App Store Connect' })).toBeEnabled();

        // One prompt per language, the English fields fenced as data.
        const prompts = (await tauri.callsTo('abs_claude_prompt')).map((call) => call.args as { system: string; prompt: string });
        expect(prompts.map((args) => args.system.match(/ into (.+?), as store copy/)?.[1])).toEqual(['German', 'French', 'Latin American Spanish']);
        for (const args of prompts) expect(args.prompt).toContain('<<<SOURCE\nsubtitle: Build habits, keep streaks');

        const sent = await page.evaluate(() =>
          ((window as any).__E2E_TAURI__.httpRequests as Array<{ method: string }>).filter((request) => request.method !== 'GET')
        );
        expect(sent).toHaveLength(0);
        expect(await tauri.unhandled()).toEqual([]);
      });
    });

    test.describe('with Claude Code signed in and its answer in flight', () => {
      test.use({
        tauriConfig: {
          http: TEST_ACCOUNT_RULES,
          responses: { abs_claude_detect: CLAUDE_READY, abs_claude_prompt: HELD_ANSWER },
          held: ['abs_claude_prompt'],
        },
      });

      test('a report summary that comes back after the period changed stays with its own period', async ({ page, tauri }) => {
        const view = await openGrowth(page);
        await section(view, 'Reports').click();
        const periods = view.getByRole('group', { name: 'Report period' });
        const report = view.getByTestId('growth-report');
        await periods.getByRole('button', { name: 'Monthly' }).click();
        const title = report.locator('h3').first();
        const month = await title.innerText();
        await report.getByRole('button', { name: 'Write summary' }).click();
        await tauri.waitForCall('abs_claude_prompt');

        // On to the week while the month's summary is still being written.
        await periods.getByRole('button', { name: 'Weekly' }).click();
        await expect(report).toContainText('Week of');
        expect(await releaseHeldCommands(page)).toBe(1);
        await expect.poll(() => growthMetaKeys(page, 'report:summary:')).toHaveLength(1);

        // The week shows its own figures with no summary, free to write one.
        await expect(report.getByRole('button', { name: 'Write summary' })).toBeEnabled();
        await expect(report).not.toContainText(HELD_ANSWER);

        // The month has its summary.
        await periods.getByRole('button', { name: 'Monthly' }).click();
        await expect(title).toHaveText(month);
        await expect(report).toContainText(HELD_ANSWER);
      });

      test('a report summary asked for before a visit to another section is there on the way back, asked once', async ({ page, tauri }) => {
        const view = await openGrowth(page);
        await section(view, 'Reports').click();
        const report = view.getByTestId('growth-report');
        await report.getByRole('button', { name: 'Write summary' }).click();
        await tauri.waitForCall('abs_claude_prompt');

        // Away and back while it is being written: the same request, still on its way.
        await section(view, 'Reviews').click();
        await section(view, 'Reports').click();
        await expect(report.getByRole('button', { name: 'Write summary' })).toBeDisabled();
        expect(await releaseHeldCommands(page)).toBe(1);
        await expect(report).toContainText(HELD_ANSWER);
        expect(await tauri.callsTo('abs_claude_prompt')).toHaveLength(1);
      });

      test('a translation still running when the user looks at another section shows on the way back, and is not started twice', async ({ page, tauri }) => {
        await tauri.setResponse('abs_claude_prompt', JSON.stringify({ subtitle: TRANSLATED_SUBTITLE }));
        const view = await openGrowth(page);
        await section(view, 'Store page').click();
        await view.getByRole('button', { name: 'Translate with AI' }).click();
        await tauri.waitForCall('abs_claude_prompt');

        await section(view, 'Reviews').click();
        await section(view, 'Store page').click();
        await expect(view.getByRole('status').filter({ hasText: 'Translating into German, 1 of 3' })).toBeVisible();
        await expect(view.getByRole('button', { name: 'Translate with AI' })).toBeDisabled();

        // One language after another, as before the visit.
        for (let asked = 1; asked <= 3; asked++) {
          await expect.poll(async () => (await tauri.callsTo('abs_claude_prompt')).length).toBe(asked);
          expect(await releaseHeldCommands(page)).toBe(1);
        }
        await expect(view.getByText('3 translations added to your changes')).toBeVisible();
        await expect(view.getByRole('button', { name: 'Translate with AI' })).toBeEnabled();
        expect(await tauri.callsTo('abs_claude_prompt')).toHaveLength(3);
      });

      test('a reply still being suggested when the user leaves the Reviews stops its Claude Code run', async ({ page, tauri }) => {
        const view = await openGrowth(page);
        await section(view, 'Reviews').click();
        await view.getByRole('combobox', { name: 'Filter by reply' }).click();
        await page.getByRole('option', { name: 'Needs a reply' }).click();
        const review = view.locator('[data-review-id]').filter({ hasText: 'Crashes on launch' });
        await review.getByRole('button', { name: 'Reply' }).click();
        await review.getByRole('button', { name: 'Suggest a reply' }).click();
        const prompt = await tauri.waitForCall('abs_claude_prompt');

        // The reply box goes with the section, and so does what was being written into it.
        await section(view, 'Overview').click();
        const stop = await tauri.waitForCall('abs_claude_prompt_stop');
        expect(stop.args.id).toBe(prompt.args.id);
        expect(await releaseHeldCommands(page)).toBe(0);
      });

      test('Stop ends the Claude Code run it was pressed for, and the next question runs on its own', async ({ page, tauri }) => {
        const view = await openGrowth(page);
        await section(view, 'Ask AI').click();
        const question = view.getByRole('textbox', { name: 'Your question' });
        await question.fill('Why did downloads drop?');
        await view.getByRole('button', { name: 'Ask', exact: true }).click();
        const first = await tauri.waitForCall('abs_claude_prompt');
        await view.getByRole('button', { name: 'Stop', exact: true }).click();

        // Stop reaches Rust with the prompt's own id, and Rust kills that process.
        const stop = await tauri.waitForCall('abs_claude_prompt_stop');
        expect(stop.args.id).toBe(first.args.id);
        expect(await releaseHeldCommands(page)).toBe(0);

        await question.fill('And conversion?');
        await view.getByRole('button', { name: 'Ask', exact: true }).click();
        await expect.poll(async () => (await tauri.callsTo('abs_claude_prompt')).length).toBe(2);
        const second = (await tauri.callsTo('abs_claude_prompt'))[1];
        expect(second.args.id).not.toBe(first.args.id);
        expect(await releaseHeldCommands(page)).toBe(1);
        await expect(view.getByText(HELD_ANSWER)).toHaveCount(1);
        expect(await tauri.unhandled()).toEqual([]);
      });
    });
  });
});
