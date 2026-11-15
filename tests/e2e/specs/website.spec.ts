import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';

// The Website view (src/lib/website): a home page, a support page and a
// privacy policy made from the open project, in its languages, published to
// the user's GitHub Pages. The preview is the renderer's real output in a
// frame, so what the specs read there is what the site would say. On the
// desktop, Claude Code is answered with canned prompts, and GitHub (its API,
// its device sign-in and the github.io site) by the harness's HTTP rules.

const WEBSITE = "Website: your app's home, support and privacy pages";

/** abs_claude_detect for a Claude Code signed in on a Max plan. */
const CLAUDE_READY = {
  found: true,
  path: '/Users/e2e/.local/bin/claude',
  version: '2.1.285 (Claude Code)',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
};

function views(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Views' });
}

async function openWebsite(page: Page): Promise<Locator> {
  await views(page).getByRole('button', { name: WEBSITE, exact: true }).click();
  const view = page.getByTestId('website-view');
  await expect(view).toBeVisible();
  return view;
}

/** The page inside the preview frame. */
function site(view: Locator) {
  return view.getByTestId('website-preview').frameLocator('iframe');
}

/** A blank project with one text layer, so it has a screenshot with a caption. */
async function projectWithText(app: { startBlankProject(): Promise<void>; addElementFrom(category: string, label: string, id: string): Promise<void> }) {
  await app.startBlankProject();
  await app.addElementFrom('Basic', 'Text', 'basic:text');
}

/** The three steps of Make my website, with no AI writing. */
async function makeSite(page: Page, view: Locator, options: { ai?: boolean } = {}) {
  await view.getByRole('button', { name: 'Make my website' }).click();
  const dialog = page.getByTestId('website-setup');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('App name').fill('Pebble');
  await dialog.getByLabel('Support email').fill('help@pebble.app');
  await dialog.getByLabel("Your name or your company's").fill('Pebble Labs');
  await dialog.getByRole('button', { name: 'Next' }).click();
  // Nothing is ticked yet, so the step waits for an answer.
  await expect(dialog.getByRole('button', { name: 'Next' })).toBeDisabled();
  await dialog.getByText('Nothing', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  const write = dialog.getByRole('switch', { name: 'Write the words with AI' });
  if (options.ai) await expect(write).toBeChecked();
  else await expect(write).toBeDisabled();
  await dialog.getByRole('button', { name: 'Make my website' }).click();
  await expect(dialog).toBeHidden();
  await expect(view.getByRole('navigation', { name: 'Website sections' })).toBeVisible();
}

async function previewPage(view: Locator, name: 'Home' | 'Support' | 'Privacy policy') {
  await view.getByRole('group', { name: 'Page' }).getByRole('button', { name, exact: true }).click();
}

test.describe('website', () => {
  test('the Website button sits under Discover, and a first visit shows the site the project would make', async ({ app, page }) => {
    await projectWithText(app);
    const names = await views(page).getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
    const website = names.indexOf(WEBSITE);
    expect(website).toBeGreaterThan(names.indexOf('Growth: downloads, reviews and your store page'));
    if (names.includes('Discover')) expect(website).toBe(names.indexOf('Discover') + 1);

    const view = await openWebsite(page);
    await expect(view.getByTestId('website-welcome')).toBeVisible();
    // The preview is drawn before anything is asked: the caption is the headline.
    await expect(site(view).locator('h1')).toHaveText('New Text');
    await expect(site(view).locator('.fan img')).toHaveCount(1, { timeout: 30_000 });
    // The screenshot was taken from the editor hidden behind this view, and
    // still has the dark caption on its white ground: a capture of a hidden
    // board would be white all over.
    const dark = await site(view)
      .locator('.fan img')
      .evaluate(async (image: HTMLImageElement) => {
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        for (let at = 0; at < data.length; at += 4) if (data[at] + data[at + 1] + data[at + 2] < 200) count += 1;
        return count;
      });
    expect(dark).toBeGreaterThan(100);

    await makeSite(page, view);
    await expect(site(view).locator('h1')).toHaveText('New Text');
    await expect(site(view).locator('.eyebrow')).toContainText('Pebble');

    await previewPage(view, 'Support');
    await expect(site(view).locator('h1')).toHaveText('Pebble support');
    await expect(site(view).locator('a.button[href^="mailto:help@pebble.app"]')).toBeVisible();
    await previewPage(view, 'Privacy policy');
    await expect(site(view).locator('#summary')).toContainText("Pebble doesn't collect any personal data");
    await expect(site(view).locator('#about')).toContainText('Pebble is made by Pebble Labs');

    // An edit shows in the preview as it is typed.
    await view.getByRole('navigation', { name: 'Website sections' }).getByRole('button', { name: /^Home page/ }).click();
    await view.getByLabel('Headline', { exact: true }).fill('Habits that stick');
    await previewPage(view, 'Home');
    await expect(site(view).locator('h1')).toHaveText('Habits that stick');
    // A link inside the preview moves the preview.
    await site(view).locator('.links a', { hasText: 'Support' }).click();
    await expect(site(view).locator('h1')).toHaveText('Pebble support');

    // The site is kept with the project.
    await page.waitForTimeout(800);
    await page.reload();
    await app.waitForBoot();
    const again = await openWebsite(page);
    await expect(again.getByRole('navigation', { name: 'Website sections' })).toBeVisible();
    await previewPage(again, 'Home');
    await expect(site(again).locator('h1')).toHaveText('Habits that stick');
  });

  test.describe('with Claude Code signed in', () => {
    test.use({ tauriConfig: { responses: { abs_claude_detect: CLAUDE_READY } } });

    test('the AI writes the site, changes it from the chat, and the change can be undone', async ({ app, page, tauri, isDesktop }) => {
      test.skip(!isDesktop, 'Claude Code runs in the desktop app');
      await projectWithText(app);
      await tauri.setResponse(
        'abs_claude_prompt',
        JSON.stringify({
          headline: 'Small steps, every day',
          subhead: 'Pebble keeps your habits going with one tap.',
          features: [{ title: 'One tap a day', body: 'Mark a habit done in a second.', shot: 1 }],
          galleryTitle: 'A look inside',
          ctaTitle: 'Start with Pebble',
          ctaBody: 'On the App Store.',
          supportIntro: 'Questions about Pebble? We read every email.',
          contactNote: 'Tell us your device.',
          faqs: [{ question: 'Is Pebble free?', answer: 'Write to help@pebble.app and we will tell you.' }],
          description: 'Pebble keeps your habits going.',
        })
      );
      const view = await openWebsite(page);
      await makeSite(page, view, { ai: true });
      await expect(view.getByTestId('site-chat-answer').first()).toContainText('I wrote the home and support pages');
      await expect(site(view).locator('h1')).toHaveText('Small steps, every day');
      const [write] = await tauri.callsTo('abs_claude_prompt');
      expect((write.args as { system: string }).system).toContain('You write the website of a mobile app');
      expect((write.args as { prompt: string }).prompt).toContain('1. New Text');

      await tauri.setResponse(
        'abs_claude_prompt',
        JSON.stringify({
          reply: 'Added a question about refunds.',
          changes: {
            faqs: [
              { question: 'Is Pebble free?', answer: 'Write to help@pebble.app and we will tell you.' },
              { question: 'Can I get a refund?', answer: 'Apple and Google handle refunds for purchases.' },
            ],
            supportIntro: 'Write to fake@made-up.example for help.',
          },
        })
      );
      await view.getByLabel('Ask for a change').fill('Add a question about refunds');
      await view.getByLabel('Ask for a change').press('Enter');
      const answer = view.getByTestId('site-chat-answer').last();
      await expect(answer).toContainText('Added a question about refunds.');
      await expect(answer).toContainText('questions and answers');
      // The made-up address is turned down, and says so.
      await expect(answer).toContainText('Left as they were: support page opening');
      await previewPage(view, 'Support');
      await expect(site(view).locator('summary', { hasText: 'Can I get a refund?' })).toBeVisible();
      await expect(site(view).locator('.head')).not.toContainText('fake@made-up.example');

      await answer.getByRole('button', { name: 'Undo' }).click();
      await expect(site(view).locator('summary', { hasText: 'Can I get a refund?' })).toHaveCount(0);
      await expect(site(view).locator('summary', { hasText: 'Is Pebble free?' })).toBeVisible();
    });
  });

  test.describe('publishing', () => {
    const repo = 'https://api\\.github\\.com/repos/octo/pebble';
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Pick<TauriHttpRule, 'status' | 'body' | 'headers'> => ({
      status,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    });
    const GITHUB: TauriHttpRule[] = [
      { match: '^POST https://github\\.com/login/device/code$', ...json({ device_code: 'dev-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 }) },
      { match: '^POST https://github\\.com/login/oauth/access_token$', ...json({ access_token: 'gho_website', token_type: 'bearer', scope: 'gist,public_repo' }) },
      { match: '^GET https://api\\.github\\.com/user$', ...json({ id: 7, login: 'octo', name: 'Octo Cat' }, 200, { 'x-oauth-scopes': 'gist, public_repo' }) },
      { match: `^GET ${repo}$`, ...json({ message: 'Not Found' }, 404) },
      { match: '^POST https://api\\.github\\.com/user/repos$', ...json({ default_branch: 'main', private: false }, 201) },
      { match: `^GET ${repo}/git/ref/heads/main$`, ...json({ object: { sha: 'head1' } }) },
      { match: `^GET ${repo}/git/commits/head1$`, ...json({ tree: { sha: 'tree1' } }) },
      { match: `^GET ${repo}/git/trees/tree1\\?recursive=1$`, ...json({ tree: [{ path: 'README.md', type: 'blob', mode: '100644', sha: 'r1' }] }) },
      { match: `^POST ${repo}/git/blobs$`, ...json({ sha: 'blob1' }, 201) },
      { match: `^POST ${repo}/git/trees$`, ...json({ sha: 'tree2' }, 201) },
      { match: `^POST ${repo}/git/commits$`, ...json({ sha: 'commit2' }, 201) },
      { match: `^PATCH ${repo}/git/refs/heads/main$`, ...json({ object: { sha: 'commit2' } }) },
      { match: `^GET ${repo}/pages$`, ...json({ message: 'Not Found' }, 404) },
      { match: `^POST ${repo}/pages$`, ...json({ html_url: 'https://octo.github.io/pebble/' }, 201) },
    ];
    test.use({ tauriConfig: { http: GITHUB } });

    test('GitHub sign-in asks for public repositories, and the site goes up in one commit with Pages switched on', async ({ app, page, tauri, isDesktop }) => {
      test.skip(!isDesktop, "GitHub's device sign-in and the app's HTTP client are the desktop app's");
      test.setTimeout(150_000);
      await projectWithText(app);
      const view = await openWebsite(page);
      await makeSite(page, view);
      await view.getByRole('navigation', { name: 'Website sections' }).getByRole('button', { name: /^Publish/ }).click();
      await expect(view.getByTestId('site-publish')).toBeDisabled();
      await view.getByRole('button', { name: 'Sign in with GitHub' }).click();
      await expect(view.getByTestId('site-device-code')).toHaveText('ABCD-1234');
      await expect(view.getByText('github.com/octo', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(view.getByText('Your site: https://octo.github.io/pebble/')).toBeVisible();

      const requests = () => page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpRequests: Array<{ method: string; url: string; body: string | null }> } }).__E2E_TAURI__.httpRequests);
      const deviceCode = (await requests()).find((request) => request.url === 'https://github.com/login/device/code');
      expect(new URLSearchParams(deviceCode!.body ?? '').get('scope')).toBe('gist public_repo');

      await view.getByTestId('site-publish').click();
      await expect(view.getByTestId('site-publish-progress')).toBeVisible();
      // The build id the site's marker carries, which the app waits to see online.
      await expect.poll(async () => (await requests()).some((request) => request.method === 'POST' && request.url.endsWith('/git/trees')), { timeout: 60_000 }).toBe(true);
      const treeRequest = (await requests()).find((request) => request.method === 'POST' && request.url.endsWith('/git/trees'))!;
      const tree = JSON.parse(treeRequest.body!) as { tree: Array<{ path: string; content?: string; sha?: string }>; base_tree?: string };
      const paths = tree.tree.map((entry) => entry.path);
      for (const path of ['index.html', 'support/index.html', 'privacy/index.html', 'assets/site.css', '.nojekyll', 'osg-site.json', '404.html', 'sitemap.xml']) {
        expect(paths).toContain(path);
      }
      expect(paths.some((path) => /^assets\/shots\/[0-9a-f]+\.jpg$/.test(path))).toBe(true);
      expect(tree.base_tree).toBeUndefined();
      const { build } = JSON.parse(tree.tree.find((entry) => entry.path === 'osg-site.json')!.content!) as { build: string };
      await page.evaluate((body) => {
        (window as unknown as { __E2E_TAURI__: { config: { http: TauriHttpRule[] } } }).__E2E_TAURI__.config.http.unshift({
          match: '^GET https://octo\\.github\\.io/pebble/osg-site\\.json\\?look=\\d+$',
          status: 200,
          body,
          headers: { 'content-type': 'application/json' },
        });
      }, JSON.stringify({ build }));

      const links = view.getByTestId('site-links');
      await expect(links).toBeVisible({ timeout: 60_000 });
      await expect(view.getByText('Your website is online')).toBeVisible({ timeout: 30_000 });
      await expect(links).toContainText('https://octo.github.io/pebble/support/');
      await expect(links).toContainText('https://octo.github.io/pebble/privacy/');
      await expect(view.getByTestId('website-status')).toHaveText('Online');

      const all = await requests();
      const create = JSON.parse(all.find((request) => request.method === 'POST' && request.url === 'https://api.github.com/user/repos')!.body!);
      expect(create).toMatchObject({ name: 'pebble', private: false, auto_init: true, homepage: 'https://octo.github.io/pebble/' });
      const pages = JSON.parse(all.find((request) => request.method === 'POST' && request.url.endsWith('/pages'))!.body!);
      expect(pages).toEqual({ build_type: 'legacy', source: { branch: 'main', path: '/' } });
      // The Website view keeps its own sign-in: no account was signed in.
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('open-screenshot-generator.website.github') ?? 'null'))).toMatchObject({ login: 'octo', token: 'gho_website' });
      expect(await page.evaluate(() => localStorage.getItem('open-screenshot-generator.account'))).toBeNull();
      // The home page in the tree is the one the preview shows.
      const home = tree.tree.find((entry) => entry.path === 'index.html')!.content!;
      expect(home).toContain('<link rel="canonical" href="https://octo.github.io/pebble/">');
      expect(home).toContain('New Text');
      expect(tauri).toBeTruthy();
    });
  });

  test.describe('with an account sign-in that has gist access only', () => {
    test.use({
      tauriConfig: {
        http: [
          {
            match: '^GET https://api\\.github\\.com/user$',
            status: 200,
            body: JSON.stringify({ id: 7, login: 'octo', name: 'Octo Cat' }),
            headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'gist' },
          },
        ],
      },
    });

    test('the Publish section asks for one more permission and waits for it', async ({ app, page, isDesktop }) => {
      test.skip(!isDesktop, "the app's HTTP client is the desktop app's");
      // The account store reads its sign-in once, as the app starts.
      await page.evaluate(() =>
        localStorage.setItem('open-screenshot-generator.account', JSON.stringify({ provider: 'github', account: { id: '7', name: 'Octo Cat' }, accessToken: 'gho_gist_only' }))
      );
      await page.reload();
      await app.waitForBoot();
      await projectWithText(app);
      const view = await openWebsite(page);
      await makeSite(page, view);
      await view.getByRole('navigation', { name: 'Website sections' }).getByRole('button', { name: /^Publish/ }).click();
      await expect(view.getByText('GitHub needs one more permission')).toBeVisible();
      await expect(view.getByText('github.com/octo, your account sign-in')).toBeVisible();
      await expect(view.getByRole('button', { name: 'Allow access to public repositories' })).toBeVisible();
      await expect(view.getByTestId('site-publish').locator('xpath=..')).toHaveAttribute('data-gated-reason', 'Allow access to public repositories first');
    });
  });
});
