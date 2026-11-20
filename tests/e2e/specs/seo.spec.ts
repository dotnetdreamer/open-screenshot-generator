import { test, expect } from '../fixtures/test';
import { CLAUDE_READY, COMMIT, SEO_VIEW, SITE, checkSite, openSeo, section, serveFork, serveSite, sitePages } from '../helpers/seo';
import { Editor } from '../helpers/editor';

// SEO (src/lib/seo): checking a website for Google and AI search. The site
// is made up and answered here: in the browser through page.route, with the
// header that lets another site read it (as GitHub Pages sends); in the
// desktop app through the Tauri HTTP plugin's stand-in. claude-seo's notes
// come from a fake of the user's fork on GitHub, so a spec sees which files
// are fetched and by which commit. Claude Code is answered with canned text.
// The helpers live in tests/e2e/helpers/seo.ts; seo-data.spec.ts covers
// Google's numbers, Speed and pages drawn before publishing.

test.describe('SEO', () => {
  test('checks a site, puts what to fix first and explains each problem', async ({ page, app, isDesktop }) => {
    await serveFork(page);
    await serveSite(page, isDesktop, sitePages());
    const view = await openSeo(page, app);
    await checkSite(view);

    await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });
    await expect(view.getByTestId('seo-score')).toContainText('2 pages');
    const top = view.getByTestId('seo-top-findings');
    await expect(top).toContainText("Some AI search tools can't read your site");
    await expect(top).toContainText('This page has no description for Google');

    await top.getByRole('button', { name: /This page has no description for Google/ }).click();
    const finding = view.locator('[data-finding="missing-meta-description"]');
    await expect(finding).toContainText('Why it matters');
    await expect(finding).toContainText('Write one or two sentences, 120 to 160 characters');
    await expect(finding).toContainText('Home page');
    await expect(finding).toContainText('/support');
    await finding.getByRole('button', { name: 'Details' }).click();
    await expect(finding).toContainText('The page has no meta description. Search engines write their own snippet when none is given.');

    await view.getByRole('button', { name: 'By page' }).click();
    await expect(view.getByTestId('seo-pages')).toContainText('Pebble Notes support and answers');
  });

  test('shows which AI tools robots.txt keeps out', async ({ page, app, isDesktop }) => {
    await serveFork(page);
    await serveSite(page, isDesktop, sitePages());
    const view = await openSeo(page, app);
    await checkSite(view);
    await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });
    await section(view, 'AI search').click();
    const table = view.getByTestId('seo-ai-agents');
    await expect(table.getByRole('row', { name: /ChatGPT search/ })).toContainText('Kept out');
    await expect(table.getByRole('row', { name: /Claude search/ })).toContainText('Can read it');
    await expect(view.getByTestId('seo-llms')).toContainText("Your site doesn't have an llms.txt yet");
  });

  test('reads the notes from the fork by commit, never by branch', async ({ page, app, isDesktop }) => {
    const requests = await serveFork(page);
    await serveSite(page, isDesktop, sitePages());
    const view = await openSeo(page, app);
    await section(view, 'Setup').click();
    await expect(view).toContainText('2 files kept on this computer', { timeout: 30_000 });
    const downloads = requests.filter((url) => !url.includes('api.github.com'));
    expect(downloads.length).toBeGreaterThan(0);
    for (const url of downloads) expect(url).toContain(COMMIT);
  });

  test('never follows a redirect to this computer', async ({ page, app, isDesktop }) => {
    test.skip(!isDesktop, 'The desktop app follows redirects one hop at a time; a browser follows them itself');
    await serveFork(page);
    await serveSite(page, isDesktop, sitePages({ '/': { status: 302, type: 'text/html', body: '', location: 'http://127.0.0.1:9/admin' } }));
    const view = await openSeo(page, app);
    await checkSite(view);
    await expect(view.getByTestId('seo-check-problem')).toContainText('on this computer or a private network', { timeout: 30_000 });
    const asked = await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpRequests: Array<{ url: string }> } }).__E2E_TAURI__.httpRequests.map((request) => request.url));
    expect(asked.some((url) => url.includes('127.0.0.1'))).toBe(false);
  });

  test('Google numbers wait for a key, and say why on the web', async ({ page, app, isDesktop }) => {
    await serveFork(page);
    await serveSite(page, isDesktop, sitePages());
    const view = await openSeo(page, app);
    await checkSite(view);
    await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });
    await section(view, 'Search').click();
    await expect(view).toContainText('See how people find you on Google');
    if (isDesktop) await expect(view).toContainText('Add a Google key under Setup first');
    else await expect(view).toContainText('Search Console and Analytics need the desktop app');
    await view.getByRole('button', { name: 'Set it up myself' }).click();
    await expect(view.getByTestId('seo-google-key')).toBeVisible();
  });

  test("the editor starts without the SEO code, and the SEO view says it couldn't open when a web view can't parse that code", async ({ page }) => {
    // WebKit before Safari 16.4 can't parse a lookbehind, and a script it can't parse fails whole. Here every script
    // with claude-seo's checks in it is one nothing can parse, whichever browser runs the test.
    const broken: string[] = [];
    await page.route(/\/_next\/static\/.+\.js(\?.*)?$/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (!body.includes('consectetur adipiscing')) return route.fulfill({ response, body });
      broken.push(new URL(route.request().url()).pathname);
      await route.fulfill({ response, body: 'this is not javascript (((' });
    });
    const editor = new Editor(page);
    await editor.goto();
    await editor.dismissStartDialog();
    expect(broken, 'the editor loaded the SEO code').toEqual([]);

    const views = page.getByRole('navigation', { name: 'Views' });
    await views.getByRole('button', { name: SEO_VIEW, exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: "The SEO view couldn't open" })).toBeVisible({ timeout: 60_000 });
    expect(broken.length).toBeGreaterThan(0);
    // The rest of the app is as it was.
    await views.getByRole('button', { name: 'Editor', exact: true }).click();
    await expect(editor.exportButton).toBeVisible();
  });

  test.describe('with Claude Code', () => {
    test.use({ tauriConfig: { responses: { abs_claude_detect: CLAUDE_READY } } });

    test('makes a fix plan that names only what the check found', async ({ page, app, isDesktop, tauri }) => {
      test.skip(!isDesktop, 'Claude Code runs in the desktop app');
      await serveFork(page);
      await serveSite(page, isDesktop, sitePages());
      await tauri.setResponse(
        'abs_claude_prompt',
        JSON.stringify({
          summary: 'Two quick fixes and your site is in good shape.',
          steps: [
            { title: 'Let ChatGPT search read your site', why: 'It is kept out now.', how: 'Remove the OAI-SearchBot block from robots.txt.', findings: ['ai-search-blocked', 'made-up-finding'], effort: 'quick' },
            { title: 'Write a description for each page', why: 'Google shows it under the title.', how: 'Add one to the home page and the support page.', findings: ['missing-meta-description'], effort: 'quick' },
          ],
        })
      );
      const view = await openSeo(page, app);
      await checkSite(view);
      await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });
      const plan = view.getByTestId('seo-plan');
      await plan.getByRole('button', { name: 'Make my fix plan' }).click();
      await expect(plan).toContainText('Two quick fixes and your site is in good shape.');
      await expect(plan).toContainText('Let ChatGPT search read your site');
      await expect(plan.getByRole('button', { name: "Some AI search tools can't read your site" })).toBeVisible();
      await expect(plan).not.toContainText('made-up-finding');

      const [call] = await tauri.callsTo('abs_claude_prompt');
      const args = call.args as { system: string; prompt: string };
      expect(args.system).toContain('Write a short fix plan');
      expect(args.prompt).toContain('ai-search-blocked');
      expect(args.prompt).toContain('skills/seo/references/quality-gates.md');
    });

    test("Set up with Ask AI opens Growth's assistant on the Google job for SEO", async ({ page, app, isDesktop, tauri }) => {
      test.skip(!isDesktop, 'The assistant and its browser are in the desktop app');
      await serveFork(page);
      await serveSite(page, isDesktop, sitePages());
      await tauri.setResponse('abs_claude_prompt', JSON.stringify({ say: 'Let us start with your Google key.', choices: [], actions: [], next: 'user' }));
      const view = await openSeo(page, app);
      await checkSite(view);
      await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });
      await view.getByRole('button', { name: 'Set up with Ask AI' }).first().click();
      await expect(page.getByTestId('growth-view')).toBeVisible();
      await expect(page.getByTestId('growth-view')).toContainText('Help me connect Google for my website');
      await expect(page.getByTestId('growth-view')).toContainText('Let us start with your Google key.');
      const [call] = await tauri.callsTo('abs_claude_prompt');
      const args = call.args as { prompt: string };
      expect(args.prompt).toContain('The job now: set up Google for the SEO view');
      expect(args.prompt).toContain(`The website: ${SITE}/`);
    });
  });
});
