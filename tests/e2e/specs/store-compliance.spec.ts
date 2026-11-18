import { createHash } from 'node:crypto';
import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';

// Store compliance (src/lib/storeCompliance): the App Store Compliance
// Playbook, read from its GitHub repository when the view is first opened and
// kept in a database here. GitHub is a fake repository answered for api.github.com,
// raw.githubusercontent.com and cdn.jsdelivr.net, so a spec can push a new
// commit, break a file or take GitHub away. Its rules are made up in the
// playbook's shapes. On the desktop, Claude Code is answered with canned
// prompts, as the Growth and Website specs do.

const RULES_VIEW = 'Store compliance: avoid App Store and Google Play rejections';
const OWNER_REPO = 'dotnetdreamer/app-store-compliance';

/** abs_claude_detect for a Claude Code signed in on a Max plan. */
const CLAUDE_READY = {
  found: true,
  path: '/Users/e2e/.local/bin/claude',
  version: '2.1.285 (Claude Code)',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
};

/** abs_codex_detect for a Codex signed in with ChatGPT. */
const CODEX_READY = {
  found: true,
  path: '/opt/homebrew/bin/codex',
  version: 'codex-cli 0.162.0',
  loggedIn: true,
  authMethod: 'chatgpt',
  planType: 'plus',
  models: [{ id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', efforts: ['low', 'medium'], defaultEffort: 'low', isDefault: true }],
};

const RULES = {
  version: '1.0.0',
  updated: '2026-11-01',
  patterns: [
    { id: 'APPLE-2.1-DEMO', platform: 'apple', guideline: '2.1', title: 'No demo account for the reviewer', severity: 'critical', detection: 'A login with no demo account in the notes.', fix: 'Put a working demo account in the review notes.' },
    { id: 'APPLE-2.1-PLACEHOLDER', platform: 'apple', guideline: '2.1', title: 'Placeholder text on a screenshot', severity: 'high', detection: 'Words like New Text or lorem ipsum.', fix: 'Write the real words before you send the app.' },
    { id: 'GOOGLE-LISTING-CLAIMS', platform: 'google', guideline: 'Store Listing and Promotion', title: 'Ranking claims in the listing', severity: 'high', detection: 'Words like #1 on screenshots.', fix: 'Take ranking claims out.' },
    { id: 'BOTH-OTHER-STORE', platform: 'both', guideline: '2.3.10', title: 'Mentions the other store', severity: 'medium', detection: 'Android named on the App Store.', fix: 'Remove the mention.' },
  ],
};

const DEADLINES = {
  deadlines: [
    { id: 'EU-AI-50', jurisdiction: 'European Union (EU)', law: 'EU AI Act Article 50', requirement: 'Tell people they are talking to an AI.', mandatory_date: '2026-08-02', priority: 'critical', source_url: 'https://example.com/eu' },
    { id: 'FAR-AHEAD', jurisdiction: 'Google Play (Global)', law: 'A rule far ahead', requirement: 'Something later.', mandatory_date: '2099-01-01', priority: 'high' },
  ],
};

const CHECKLIST = `# Pre Submission Checklist

Every box ends checked or marked not applicable. Two items can never be marked not applicable, because every app has them:

- The privacy form matches what the app collects.
- A privacy policy is published.

## Start here. Two checks, about five minutes

These two stop most rejections on both stores. Do them first.

- [ ] A working demo account is in the review notes.
- [ ] The privacy form matches what the app collects.

## Apple specific

The full map is in the [Apple rejection map](APPLE.md).

- [ ] Notes for Review explain every feature. See the [Apple rejection map](APPLE.md).

## Google Play specific

- [ ] The Data Safety form matches the app.
`;

const INDEX = `# Playbook

## Start here

| You are | Read this |
|---|---|
| About to submit | [Pre-submission checklist](PRE-SUBMISSION-CHECKLIST.md) |
| Rejected on the App Store | [Apple rejection map](APPLE.md) |
| Want to appeal | [Root causes and the appeal playbook](MISTAKE-PATTERNS.md) |
`;

function files(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'data/rejection-patterns.json': JSON.stringify(RULES),
    'data/regulatory-deadlines.json': JSON.stringify(DEADLINES),
    'docs/PRE-SUBMISSION-CHECKLIST.md': CHECKLIST,
    'docs/index.md': INDEX,
    'docs/APPLE.md': '# Apple rejection map\n\n## Section 1. Safety\n\nRead the [appeal playbook](MISTAKE-PATTERNS.md#appeals).\n',
    'docs/MISTAKE-PATTERNS.md': '# Root causes\n\n## Appeals\n\nReply politely and say what changed.\n',
    NOTICE: 'Made-up Playbook\nCopyright (c) 2026 Test Author\n\nLicensed under the Test Licence 1.0.\n',
    VERSION: '1.0.0\n',
    ...overrides,
  };
}

/**
 * plain.ts's fingerprint (FNV-1a, 32 bits), the one the playbook repository's scripts/plain-language.py
 * writes into data/plain-language.json. Copied rather than imported, so a
 * change to it on one side fails here.
 */
function fingerprint(parts: string[]): string {
  const input = parts.join('\n');
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The made-up playbook in plain words, one entry written from words the playbook has since changed. */
const PLAIN = JSON.stringify({
  version: 1,
  rules: {
    'APPLE-2.1-DEMO': {
      from: fingerprint(['apple', '2.1', 'No demo account for the reviewer', 'A login with no demo account in the notes.', 'Put a working demo account in the review notes.']),
      title: 'The reviewer has no way to sign in',
      problem: "Your app needs a login, and the review notes don't give the reviewer one.",
      fix: 'Add a demo account that works to the review notes.',
    },
    'GOOGLE-LISTING-CLAIMS': { from: '00000000', title: 'Old plain words', problem: 'Old.', fix: 'Old.' },
  },
  deadlines: {
    'FAR-AHEAD': {
      from: fingerprint(['Google Play (Global)', 'A rule far ahead', 'Something later.', '', '', '2099-01-01', '']),
      title: 'Something changes much later',
      summary: 'Apps on Google Play will have to do something, much later.',
    },
  },
  checklist: { [fingerprint(['a working demo account is in the review notes.'])]: { text: 'Your review notes have a demo account that works today.' } },
  // Plain words leave out a line that only points to a guide.
  sections: { [fingerprint(['Apple specific'])]: { from: fingerprint(['Apple specific', 'The full map is in the [Apple rejection map](APPLE.md).']), title: 'Apple App Store only', intro: '' } },
});

function blobSha(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag' };

/** The fake playbook repository. Every request to GitHub's hosts lands here. */
class FakeRepo {
  commits = new Map<string, Record<string, string>>();
  head = '';
  /** What reached GitHub, newest last, preflights left out. */
  requests: string[] = [];
  down = false;
  private held: Promise<void> | null = null;

  constructor(
    initial: Record<string, string>,
    /** Answer an unchanged branch with a 304. */
    private readonly notModified = true
  ) {
    this.push(initial);
  }

  push(next: Record<string, string>): string {
    const commit = createHash('sha1').update(`commit ${this.commits.size} ${JSON.stringify(next)}`).digest('hex');
    this.commits.set(commit, next);
    this.head = commit;
    return commit;
  }

  /** Hold the next check of the branch until the returned function is called. */
  holdCheck(): () => void {
    let release!: () => void;
    this.held = new Promise<void>((resolve) => (release = resolve));
    return () => {
      this.held = null;
      release();
    };
  }

  async install(page: Page): Promise<void> {
    await page.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com|cdn\.jsdelivr\.net)\//, (route) => this.answer(route));
  }

  private async answer(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': 'if-none-match, accept', 'access-control-allow-methods': 'GET' } });
    }
    const url = request.url();
    this.requests.push(url);
    if (this.down) return route.abort('internetdisconnected');
    if (url === `https://api.github.com/repos/${OWNER_REPO}/commits/main`) {
      if (this.held) await this.held;
      // Playwright's WebKit cannot fulfill with a 304 (it counts as a redirect),
      // so there the same commit comes back as a 200, which the app treats the
      // same way. Real WebKit does get GitHub's 304 through to the page.
      if (this.notModified && (await request.headerValue('if-none-match')) === `"${this.head}"`) return route.fulfill({ status: 304, headers: CORS });
      return route.fulfill({ status: 200, body: this.head, headers: { ...CORS, etag: `"${this.head}"`, 'content-type': 'text/plain' } });
    }
    const tree = new RegExp(`^https://api\\.github\\.com/repos/${OWNER_REPO}/git/trees/([0-9a-f]{40})`).exec(url);
    if (tree) {
      const at = this.commits.get(tree[1]);
      if (!at) return route.fulfill({ status: 404, body: '{}', headers: CORS });
      const entries = Object.entries(at).map(([path, text]) => ({ path, mode: '100644', type: 'blob', sha: blobSha(text), size: Buffer.byteLength(text) }));
      return route.fulfill({ status: 200, body: JSON.stringify({ sha: tree[1], tree: entries, truncated: false }), headers: { ...CORS, 'content-type': 'application/json' } });
    }
    const file =
      new RegExp(`^https://raw\\.githubusercontent\\.com/${OWNER_REPO}/([^/]+)/(.+)$`).exec(url) ??
      new RegExp(`^https://cdn\\.jsdelivr\\.net/gh/${OWNER_REPO}@([^/]+)/(.+)$`).exec(url);
    if (file) {
      const at = file[1] === 'main' ? this.commits.get(this.head) : this.commits.get(file[1]);
      const text = at?.[decodeURIComponent(file[2])];
      if (text === undefined) return route.fulfill({ status: 404, body: '404: Not Found', headers: CORS });
      return route.fulfill({ status: 200, body: text, headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' } });
    }
    return route.fulfill({ status: 404, body: 'not here', headers: CORS });
  }

  /** The files downloaded, by path, from raw or jsDelivr. */
  downloads(): string[] {
    return this.requests
      .filter((url) => url.startsWith('https://raw.githubusercontent.com/') || url.startsWith('https://cdn.jsdelivr.net/'))
      .map((url) => decodeURIComponent(url.replace(/^.*?\/(?:[0-9a-f]{40}|main)\//, '')));
  }
}

function views(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Views' });
}

async function openRules(page: Page): Promise<Locator> {
  await views(page).getByRole('button', { name: RULES_VIEW, exact: true }).click();
  const view = page.getByTestId('store-compliance-view');
  await expect(view).toBeVisible();
  return view;
}

function section(view: Locator, name: string | RegExp): Locator {
  return view.getByRole('navigation', { name: 'Store compliance sections' }).getByRole('button', { name });
}

test.describe('Store compliance', () => {
  test('sits above Discover, asks GitHub nothing until opened, then downloads the rules once a sitting', async ({ page, app, browserName }) => {
    // Three loads of the editor.
    test.setTimeout(180_000);
    const repo = new FakeRepo(files(), browserName !== 'webkit');
    await repo.install(page);
    await app.dismissStartDialog();

    const names = await views(page).getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
    expect(names.indexOf(RULES_VIEW)).toBeGreaterThan(names.indexOf('Growth: downloads, reviews and your store page'));
    expect(names.indexOf(RULES_VIEW)).toBeLessThan(names.indexOf('Discover'));

    // Loading the editor reaches nothing on GitHub.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await app.dismissStartDialog();
    await page.waitForTimeout(1500);
    expect(repo.requests).toEqual([]);

    const view = await openRules(page);
    await expect(view.getByTestId('store-compliance-overview')).toBeVisible({ timeout: 30_000 });
    await expect(view.getByTestId('store-compliance-status')).toHaveText('Up to date');
    expect(repo.requests.filter((url) => url.startsWith('https://api.github.com/'))).toEqual([
      `https://api.github.com/repos/${OWNER_REPO}/commits/main`,
      `https://api.github.com/repos/${OWNER_REPO}/git/trees/${repo.head}?recursive=1`,
    ]);
    // The core files, each once and by commit; the guides wait to be opened.
    // NOTICE among them: the licence asks every copy to keep it, though nothing shows it on screen.
    expect(repo.downloads().sort()).toEqual(['NOTICE', 'VERSION', 'data/regulatory-deadlines.json', 'data/rejection-patterns.json', 'docs/PRE-SUBMISSION-CHECKLIST.md', 'docs/index.md']);
    expect(repo.requests.some((url) => url.includes('/main/'))).toBe(false);
    await expect(view.getByText('Copyright (c) 2026 Test Author')).toHaveCount(0);

    // Back in the editor and out again: the same sitting asks nothing.
    const before = repo.requests.length;
    await views(page).getByRole('button', { name: 'Editor', exact: true }).click();
    await openRules(page);
    await section(view, 'Checklist').click();
    await section(view, 'Overview').click();
    expect(repo.requests.length).toBe(before);

    // A new sitting shows the saved rules at once, while one conditional check is on its way.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await app.dismissStartDialog();
    const release = repo.holdCheck();
    repo.requests.length = 0;
    const again = await openRules(page);
    await expect(again.getByTestId('store-compliance-overview')).toBeVisible();
    await expect(again.getByTestId('store-compliance-status')).toHaveText('Checking for updates');
    release();
    await expect(again.getByTestId('store-compliance-status')).toHaveText('Up to date');
    expect(repo.requests).toEqual([`https://api.github.com/repos/${OWNER_REPO}/commits/main`]);
  });

  test('a change pushed to the repository arrives with only its file, and its new rule is pointed out', async ({ page, app, browserName }) => {
    const repo = new FakeRepo(files(), browserName !== 'webkit');
    await repo.install(page);
    await app.dismissStartDialog();
    let view = await openRules(page);
    await expect(view.getByTestId('store-compliance-overview')).toBeVisible({ timeout: 30_000 });
    await expect(view.getByTestId('store-compliance-news')).toHaveCount(0);

    const added = { ...RULES, patterns: [...RULES.patterns, { id: 'APPLE-4.3-COPY', platform: 'apple', guideline: '4.3', title: 'A copy of another app', severity: 'high', detection: 'The same app under a new name.', fix: 'Make the app its own.' }] };
    repo.push(files({ 'data/rejection-patterns.json': JSON.stringify(added) }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await app.dismissStartDialog();
    repo.requests.length = 0;
    view = await openRules(page);
    const news = view.getByTestId('store-compliance-news');
    await expect(news).toContainText('New since your last visit: 1 rejection reason');
    expect(repo.downloads()).toEqual(['data/rejection-patterns.json']);
    await expect(section(view, /^Why apps get rejected/)).toContainText('1');

    await news.getByRole('button', { name: 'See the new rules' }).click();
    const library = view.getByTestId('store-compliance-library');
    await expect(library.locator('[data-rule]')).toHaveCount(1);
    await expect(library.locator('[data-rule="APPLE-4.3-COPY"]')).toContainText('New');
    await library.locator('[data-rule="APPLE-4.3-COPY"]').click();
    const sheet = page.getByTestId('store-rule-sheet');
    await expect(sheet).toContainText('Make the app its own.');
    await page.keyboard.press('Escape');

    await section(view, 'Overview').click();
    await view.getByRole('button', { name: 'Close the note about new rules' }).click();
    await expect(view.getByTestId('store-compliance-news')).toHaveCount(0);
  });

  test("plain words from the repository show in place of the playbook's, with its own a click away", async ({ page, app, browserName }) => {
    const repo = new FakeRepo(files({ 'data/plain-language.json': PLAIN }), browserName !== 'webkit');
    await repo.install(page);
    await app.dismissStartDialog();
    const view = await openRules(page);
    const overview = view.getByTestId('store-compliance-overview');
    await expect(overview).toBeVisible({ timeout: 30_000 });
    expect(repo.downloads()).toContain('data/plain-language.json');
    await expect(overview).toContainText('The reviewer has no way to sign in');
    await expect(overview).toContainText('Your review notes have a demo account that works today.');

    await section(view, /^Why apps get rejected/).click();
    const library = view.getByTestId('store-compliance-library');
    const demo = library.locator('[data-rule="APPLE-2.1-DEMO"]');
    await expect(demo).toContainText('The reviewer has no way to sign in');
    await expect(demo).toContainText('Add a demo account that works to the review notes.');
    // Written from words the playbook has since changed, so its own words show.
    await expect(library.locator('[data-rule="GOOGLE-LISTING-CLAIMS"]')).toContainText('Ranking claims in the listing');
    await expect(library).not.toContainText('Old plain words');
    await library.getByLabel('Search the rules').fill('sign in');
    await expect(library.locator('[data-rule]')).toHaveCount(1);
    await demo.click();
    const sheet = page.getByTestId('store-rule-sheet');
    await expect(sheet).toContainText("Your app needs a login, and the review notes don't give the reviewer one.");
    await expect(sheet.getByTestId('store-rule-original')).toContainText('No demo account for the reviewer');
    await expect(sheet.getByTestId('store-rule-original')).toContainText('Put a working demo account in the review notes.');
    await page.keyboard.press('Escape');

    await section(view, 'Deadlines').click();
    const deadline = view.locator('[data-deadline="FAR-AHEAD"]');
    await expect(deadline).toContainText('Something changes much later');
    await expect(deadline).toContainText('Apps on Google Play will have to do something, much later.');
    await expect(deadline.locator('[title="Google Play (Global)"]')).toHaveText('Google Play');
    await deadline.locator('button[aria-expanded]').click();
    await expect(deadline.getByTestId('store-deadline-original')).toContainText('A rule far ahead');
    await expect(deadline.getByTestId('store-deadline-original')).toContainText('Something later.');

    await section(view, 'Checklist').click();
    const box = view.locator('[data-checklist-item]', { hasText: 'Your review notes have a demo account that works today.' });
    await box.getByRole('button', { name: 'Show the original wording' }).click();
    await expect(box.getByTestId('store-check-original')).toContainText('A working demo account is in the review notes.');
    // The plain heading has no line about the guide, and the guide is still a click away.
    const apple = view.locator('[data-checklist-section="Apple specific"]');
    await expect(apple.getByRole('button', { name: /^Apple App Store only/ })).toBeVisible();
    await expect(apple).not.toContainText('The full map is in');
    await apple.getByTestId('store-checklist-guides').getByRole('button', { name: 'Apple rejection map' }).click();
    await expect(view.getByTestId('store-compliance-guide').getByRole('heading', { name: 'Apple rejection map' })).toBeVisible();
  });

  test('a broken file in the repository keeps the last rules that worked', async ({ page, app, browserName }) => {
    const repo = new FakeRepo(files(), browserName !== 'webkit');
    await repo.install(page);
    await app.dismissStartDialog();
    let view = await openRules(page);
    await expect(view.getByTestId('store-compliance-overview')).toBeVisible({ timeout: 30_000 });

    repo.push(files({ 'data/rejection-patterns.json': '{ "patterns": [' }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await app.dismissStartDialog();
    view = await openRules(page);
    const status = view.getByTestId('store-compliance-status');
    await expect(status).toHaveText("Couldn't use the update");
    await expect(status).toHaveAttribute('title', /data\/rejection-patterns\.json/);
    await section(view, /^Why apps get rejected/).click();
    // The four rules of the commit that worked, not the broken one's.
    await expect(view.getByTestId('store-compliance-library').locator('[data-rule]')).toHaveCount(4);
  });

  test('with GitHub out of reach and nothing saved, the view says so and tries again', async ({ page, app, browserName }) => {
    const repo = new FakeRepo(files(), browserName !== 'webkit');
    repo.down = true;
    await repo.install(page);
    await app.dismissStartDialog();
    const view = await openRules(page);
    await expect(view.getByTestId('store-compliance-problem')).toContainText("Can't reach GitHub to get the rules");
    repo.down = false;
    await view.getByRole('button', { name: 'Try again' }).click();
    await expect(view.getByTestId('store-compliance-overview')).toBeVisible({ timeout: 30_000 });
  });

  test('the checklist keeps its ticks and reasons with the project', async ({ page, app, browserName }) => {
    const repo = new FakeRepo(files(), browserName !== 'webkit');
    await repo.install(page);
    await app.startBlankProject();
    let view = await openRules(page);
    await section(view, 'Checklist').click();
    const checklist = view.getByTestId('store-compliance-checklist');
    await expect(checklist.getByTestId('store-compliance-checklist-count')).toHaveText('0 of 4');

    await checklist.locator('li', { hasText: 'A working demo account' }).getByRole('checkbox').click();
    const box = checklist.locator('li', { hasText: 'Notes for Review explain every feature' });
    await box.hover();
    await box.getByRole('button', { name: "Doesn't apply" }).click();
    await box.getByLabel("Why the box doesn't apply").fill('No login, so no notes needed');
    await box.getByRole('button', { name: 'Save' }).click();
    await expect(box).toContainText("Doesn't apply: No login, so no notes needed");
    await expect(checklist.getByTestId('store-compliance-checklist-count')).toHaveText('2 of 4');
    // A check every app has, as the checklist says: it can only be ticked.
    const privacy = checklist.locator('li', { hasText: 'The privacy form matches what the app collects' });
    await expect(privacy).toContainText('Every app');
    await privacy.hover();
    await expect(privacy.getByRole('button', { name: 'Ask AI about this box' })).toBeVisible();
    await expect(privacy.getByRole('button', { name: "Doesn't apply" })).toHaveCount(0);

    // Only the App Store: the Google Play box goes, and the count with it.
    await view.getByRole('group', { name: 'Stores your app is on' }).getByRole('button', { name: 'Google Play' }).click();
    await expect(checklist.getByTestId('store-compliance-checklist-count')).toHaveText('2 of 3');
    await expect(checklist).toContainText('1 box only for Google Play is hidden');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    view = await openRules(page);
    await expect(view.getByTestId('store-compliance-progress')).toContainText('2 of 3 checks done');
    await section(view, 'Checklist').click();
    // A section with every box done is folded away.
    const apple = view.getByRole('button', { name: /^Apple specific/ });
    await expect(apple).toHaveAttribute('aria-expanded', 'false');
    await apple.click();
    await expect(view.locator('li', { hasText: 'Notes for Review' })).toContainText("Doesn't apply: No login, so no notes needed");
  });

  test('Ask AI notices an AI set up while the view was open', async ({ page, app, isDesktop, browserName }) => {
    test.skip(isDesktop, 'The web app answers with the AI panel only');
    const repo = new FakeRepo(files(), browserName !== 'webkit');
    await repo.install(page);
    await app.dismissStartDialog();
    const view = await openRules(page);
    await expect(view.getByTestId('store-compliance-overview')).toBeVisible({ timeout: 30_000 });
    await section(view, 'Ask AI').click();
    const status = view.getByTestId('store-compliance-ai-status');
    await expect(status).toContainText('Set up an AI first');
    // Only Claude Code reads code, and only the desktop app can start it.
    await expect(view.getByRole('button', { name: "Add your app's code folder" })).toBeDisabled();
    await expect(view.locator('[data-gated-reason="Reading your code needs the desktop app"]')).toHaveCount(1);
    // A key added in the AI panel is saved without telling anyone.
    await page.evaluate(() =>
      localStorage.setItem(
        'open-screenshot-generator.ai-settings',
        JSON.stringify({ provider: 'openai', keys: { openai: 'sk-e2e' }, models: { openai: 'e2e-model' }, baseUrls: {}, compatibleKeys: {} })
      )
    );
    await views(page).getByRole('button', { name: 'Editor', exact: true }).click();
    await openRules(page);
    await expect(status).toContainText('Using');
    await expect(status).not.toContainText('Set up an AI first');
  });

  test('a guide is downloaded when opened, and its links open other guides here', async ({ page, app, browserName }) => {
    const repo = new FakeRepo(files(), browserName !== 'webkit');
    await repo.install(page);
    await app.dismissStartDialog();
    const view = await openRules(page);
    await expect(view.getByTestId('store-compliance-overview')).toBeVisible({ timeout: 30_000 });
    await section(view, 'Guides').click();
    expect(repo.downloads()).not.toContain('docs/APPLE.md');
    await view.locator('[data-guide="docs/APPLE.md"]').click();
    const guide = view.getByTestId('store-compliance-guide');
    await expect(guide.getByRole('heading', { name: 'Apple rejection map' })).toBeVisible();
    expect(repo.downloads()).toContain('docs/APPLE.md');
    await guide.getByRole('link', { name: 'appeal playbook' }).click();
    await expect(guide.getByRole('heading', { name: 'Root causes' })).toBeVisible();
    await expect(guide.locator('#guide-appeals')).toBeVisible();
    // The checklist's own guide card opens the checklist.
    await guide.getByRole('button', { name: 'All guides' }).click();
    await view.locator('[data-guide="docs/PRE-SUBMISSION-CHECKLIST.md"]').click();
    await expect(view.getByTestId('store-compliance-checklist')).toBeVisible();
  });

  test.describe('with Claude Code', () => {
    test.use({ tauriConfig: { responses: { abs_claude_detect: CLAUDE_READY } } });

    test('Ask AI checks the screenshots and keeps only findings that hold', async ({ page, app, isDesktop, tauri, browserName }) => {
      test.skip(!isDesktop, 'Claude Code runs in the desktop app');
      const repo = new FakeRepo(files(), browserName !== 'webkit');
      await repo.install(page);
      await app.startBlankProject();
      await app.addElementFrom('Basic', 'Text', 'basic:text');
      await tauri.setResponse(
        'abs_claude_prompt',
        JSON.stringify({
          summary: 'One thing to fix before you send it.',
          findings: [
            { rule: 'APPLE-2.1-PLACEHOLDER', place: 'A1', quote: 'New Text', why: 'The screenshot still says New Text.' },
            { rule: 'APPLE-9.9-INVENTED', place: 'about', quote: '', why: 'A rule that does not exist.' },
            { rule: 'BOTH-OTHER-STORE', place: 'A1', quote: 'Get it on Android', why: 'Words that are not on the screenshot.' },
          ],
        })
      );
      const view = await openRules(page);
      await section(view, 'Ask AI').click();
      await expect(view.getByTestId('store-compliance-ai-status')).toContainText('Using Claude Code');
      await view.getByRole('button', { name: /^Check my app/ }).first().click();
      const form = view.getByTestId('store-compliance-check-form');
      await expect(form).toContainText('The text on 1 artboard');
      await form.getByRole('button', { name: 'People sign in' }).click();
      await form.getByRole('button', { name: 'Run the check' }).click();

      const result = view.getByTestId('store-compliance-check-result');
      await expect(result).toContainText('1 thing to look at');
      await expect(result.locator('[data-finding]')).toHaveCount(1);
      await expect(result).toContainText('Placeholder text on a screenshot');
      await expect(result).toContainText('"New Text"');
      await expect(result).toContainText('Write the real words before you send the app.');
      await expect(result).not.toContainText('Get it on Android');

      const [call] = await tauri.callsTo('abs_claude_prompt');
      const args = call.args as { system: string; prompt: string };
      expect(args.system).toContain('You check an app against App Store and Google Play rules');
      expect(args.prompt).toContain('[A1] Artboard 1');
      expect(args.prompt).toContain('New Text');
      expect(args.prompt).toContain('People make an account and sign in.');

      // A question: a rule the playbook has becomes a chip, an invented one goes.
      await tauri.setResponse('abs_claude_prompt', 'Yes. Reviewers need to sign in [APPLE-2.1-DEMO]. See also [APPLE-0.0-MADE-UP].');
      await view.getByLabel('Ask a question').fill('Do I need a demo account?');
      await view.getByLabel('Ask a question').press('Enter');
      const answer = view.getByTestId('store-compliance-answer').last();
      await expect(answer.locator('[data-rule-chip="APPLE-2.1-DEMO"]')).toHaveText('No demo account for the reviewer');
      await expect(answer).not.toContainText('MADE-UP');
      await answer.locator('[data-rule-chip="APPLE-2.1-DEMO"]').click();
      await expect(page.getByTestId('store-rule-sheet')).toContainText('Put a working demo account in the review notes.');
    });

    test("Ask AI reads the app's code by its folder's path, and keeps only quotes that are in the code", async ({ page, app, isDesktop, tauri, browserName }) => {
      test.skip(!isDesktop, 'Claude Code runs in the desktop app');
      const repo = new FakeRepo(files(), browserName !== 'webkit');
      await repo.install(page);
      await app.startBlankProject();
      const view = await openRules(page);
      await section(view, 'Ask AI').click();
      await expect(view.getByTestId('store-compliance-ai-status')).toContainText('Using Claude Code');

      await view.getByRole('button', { name: "Add your app's code folder" }).click();
      await expect(view.getByText('Claude Code can read this folder')).toBeVisible();
      const [pick] = await tauri.callsTo('abs_claude_pick_folder');
      expect(pick.args).toMatchObject({ book: 'prompt' });

      await tauri.setResponse(
        'abs_claude_prompt',
        JSON.stringify({
          summary: 'One thing in the code.',
          findings: [
            { rule: 'APPLE-2.1-PLACEHOLDER', place: 'code', file: '/Users/e2e/code/marbly/ios/Runner/Main.storyboard', quote: 'text="Lorem ipsum"', why: 'A screen still says Lorem ipsum.' },
            { rule: 'BOTH-OTHER-STORE', place: 'code', file: 'ios/Runner/AppDelegate.swift', quote: 'Get it on Android', why: 'Words that are not in that file.' },
          ],
        })
      );
      await tauri.setResponse('abs_claude_find_quotes', [42, null]);
      await view.getByRole('button', { name: /^Check my app/ }).first().click();
      const form = view.getByTestId('store-compliance-check-form');
      await expect(form).toContainText("Your app's code in marbly");
      await form.getByRole('button', { name: 'Run the check' }).click();

      const result = view.getByTestId('store-compliance-check-result');
      await expect(result).toContainText('1 thing to look at');
      await expect(result).toContainText('and the code in marbly');
      await expect(result).toContainText('ios/Runner/Main.storyboard, line 42');
      await expect(result).toContainText('text="Lorem ipsum"');
      await expect(result).not.toContainText('Get it on Android');

      const [call] = await tauri.callsTo('abs_claude_prompt');
      const args = call.args as { system: string; prompt: string; folders: string[] | null };
      expect(args.folders).toEqual(['/Users/e2e/code/marbly']);
      expect(args.prompt).not.toContain('/Users/e2e/code/marbly');
      expect(args.system).toContain('"place" is "code"');
      const [find] = await tauri.callsTo('abs_claude_find_quotes');
      expect(find.args).toEqual({
        folder: '/Users/e2e/code/marbly',
        quotes: [
          { file: 'ios/Runner/Main.storyboard', quote: 'text="Lorem ipsum"' },
          { file: 'ios/Runner/AppDelegate.swift', quote: 'Get it on Android' },
        ],
      });

      // Taken off, the folder leaves Rust's list and the next question goes without it.
      await view.getByRole('button', { name: 'Stop reading the marbly folder' }).click();
      const forget = await tauri.waitForCall('abs_claude_forget_folder');
      expect(forget.args).toEqual({ path: '/Users/e2e/code/marbly', book: 'prompt' });
      await tauri.setResponse('abs_claude_prompt', 'Yes. Reviewers need to sign in [APPLE-2.1-DEMO].');
      await view.getByLabel('Ask a question').fill('Do I need a demo account?');
      await view.getByLabel('Ask a question').press('Enter');
      await expect(view.getByTestId('store-compliance-answer').last()).toContainText('Reviewers need to sign in');
      const calls = await tauri.callsTo('abs_claude_prompt');
      expect((calls[calls.length - 1].args as { folders: unknown }).folders).toBeNull();
    });
  });

  test.describe('with Claude Code and a folder macOS blocks', () => {
    test.use({ tauriConfig: { responses: { abs_claude_detect: CLAUDE_READY, abs_claude_folder_access: 'refused' } } });

    test('the folder says macOS blocks it, Ask AI goes on without the code, and a look after allowing it brings the code back', async ({ page, app, isDesktop, tauri, browserName }) => {
      test.skip(!isDesktop, 'Claude Code runs in the desktop app');
      const repo = new FakeRepo(files(), browserName !== 'webkit');
      await repo.install(page);
      await app.startBlankProject();
      let view = await openRules(page);
      await section(view, 'Ask AI').click();
      await expect(view.getByTestId('store-compliance-ai-status')).toContainText('Using Claude Code');
      const reason = view.getByTestId('store-compliance-code-folder-reason');
      const blocked = 'macOS blocks this folder. Allow it in System Settings > Privacy & Security > Files & Folders';
      const lastPrompt = async () => {
        const calls = await tauri.callsTo('abs_claude_prompt');
        return calls[calls.length - 1].args as { prompt: string; folders: string[] | null };
      };
      const ask = async (question: string, answer: string) => {
        await tauri.setResponse('abs_claude_prompt', answer);
        await view.getByLabel('Ask a question').fill(question);
        await view.getByLabel('Ask a question').press('Enter');
        await expect(view.getByTestId('store-compliance-answer').last()).toContainText(answer);
      };

      // macOS is looked at right after the pick, and its no shows on the folder.
      await view.getByRole('button', { name: "Add your app's code folder" }).click();
      await expect(reason).toHaveText(blocked);
      const [look] = await tauri.callsTo('abs_claude_folder_access');
      expect(look.args).toEqual({ folder: '/Users/e2e/code/marbly' });
      await expect(view.getByText('Claude Code can read this folder')).toHaveCount(0);
      // A question still gets an answer, without the code.
      await ask('Do I need a demo account?', 'Yes, reviewers sign in.');
      expect((await lastPrompt()).folders).toBeNull();
      // So does the check, with the code row saying why it is off.
      await view.getByRole('button', { name: /^Check my app/ }).first().click();
      const form = view.getByTestId('store-compliance-check-form');
      await expect(form).toContainText(blocked);
      await expect(form.getByRole('checkbox', { name: /Your app's code in marbly/ })).toBeDisabled();
      await tauri.setResponse('abs_claude_prompt', JSON.stringify({ summary: 'Nothing found.', findings: [] }));
      await form.getByRole('button', { name: 'Run the check' }).click();
      await expect(view.getByTestId('store-compliance-check-result')).toBeVisible();
      expect((await lastPrompt()).folders).toBeNull();

      // After a restart the folder still says so, and macOS is asked again.
      const looksBefore = (await tauri.callsTo('abs_claude_folder_access')).length;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await app.waitForBoot();
      view = await openRules(page);
      await section(view, 'Ask AI').click();
      await expect(view.getByTestId('store-compliance-code-folder-reason')).toHaveText(blocked);
      await expect.poll(async () => (await tauri.callsTo('abs_claude_folder_access')).length).toBeGreaterThan(0);
      expect(looksBefore).toBeGreaterThan(0);

      // Allowed in System Settings: back in the window, the folder is looked at again.
      await tauri.setResponse('abs_claude_folder_access', 'open');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(view.getByText('Claude Code can read this folder')).toBeVisible();
      await ask('What does my Info.plist say?', 'It names the app Marbly.');
      expect((await lastPrompt()).folders).toEqual(['/Users/e2e/code/marbly']);

      // macOS saying no to a prompt that reads the code shows on the folder too.
      await tauri.setError('abs_claude_prompt', "macOS won't let Open Screenshot Generator open the folder marbly. Turn it on in System Settings > Privacy & Security > Files & Folders, then try again");
      await view.getByLabel('Ask a question').fill('And the camera text?');
      await view.getByLabel('Ask a question').press('Enter');
      await expect(view.getByText("macOS won't let Open Screenshot Generator open the folder marbly", { exact: false })).toBeVisible();
      await expect(view.getByTestId('store-compliance-code-folder-reason')).toHaveText(blocked);
      await tauri.clearError('abs_claude_prompt');
      // Still asking: the folder says what to click, and Check again looks once more.
      await tauri.setResponse('abs_claude_folder_access', 'asking');
      await view.getByRole('button', { name: 'Check again' }).first().click();
      await expect(view.getByTestId('store-compliance-code-folder-reason')).toHaveText('macOS is asking about this folder. Click Allow in its message');
      await tauri.setResponse('abs_claude_folder_access', 'open');
      await view.getByRole('button', { name: 'Check again' }).first().click();
      await expect(view.getByText('Claude Code can read this folder')).toBeVisible();
      await expect(view.getByRole('button', { name: 'Check again' })).toHaveCount(0);
    });
  });

  test.describe('with Claude Code and Codex', () => {
    test.use({ tauriConfig: { responses: { abs_claude_detect: CLAUDE_READY, abs_codex_detect: CODEX_READY } } });

    test('what Claude Code read in the code never reaches Codex, even after the folder is off', async ({ page, app, isDesktop, tauri, browserName }) => {
      test.skip(!isDesktop, 'Claude Code and Codex run in the desktop app');
      const repo = new FakeRepo(files(), browserName !== 'webkit');
      await repo.install(page);
      await app.startBlankProject();
      const view = await openRules(page);
      await section(view, 'Ask AI').click();
      await expect(view.getByTestId('store-compliance-ai-status')).toContainText('Using Claude Code');
      const ask = async (question: string, answer: string, cli: 'abs_claude_prompt' | 'abs_codex_prompt') => {
        await tauri.setResponse(cli, answer);
        const before = (await tauri.callsTo(cli)).length;
        await view.getByLabel('Ask a question').fill(question);
        await view.getByLabel('Ask a question').press('Enter');
        await expect(view.getByTestId('store-compliance-answer').last()).toContainText(answer);
        const calls = await tauri.callsTo(cli);
        expect(calls).toHaveLength(before + 1);
        return calls[calls.length - 1].args as { prompt: string; folders?: string[] | null };
      };

      await ask('Do I need a demo account?', 'Yes, reviewers sign in.', 'abs_claude_prompt');
      await view.getByRole('button', { name: "Add your app's code folder" }).click();
      await expect(view.getByText('Claude Code can read this folder')).toBeVisible();
      const read = await ask('What is my app called in Info.plist?', 'It is OrchidPebble41893.', 'abs_claude_prompt');
      expect(read.folders).toEqual(['/Users/e2e/code/marbly']);
      // With the folder off, Claude Code still has the conversation, and its answer repeats the code.
      await view.getByRole('button', { name: 'Stop reading the marbly folder' }).click();
      await tauri.waitForCall('abs_claude_forget_folder');
      const again = await ask('Say the name again', 'OrchidPebble41893, as I said.', 'abs_claude_prompt');
      expect(again.folders).toBeNull();
      expect(again.prompt).toContain('It is OrchidPebble41893.');

      // Codex gets the conversation without any of it.
      const choices = view.getByRole('radiogroup', { name: 'AI to use' });
      await choices.getByRole('radio', { name: 'Codex' }).click();
      await expect(view.getByTestId('store-compliance-ai-status')).toContainText('Using Codex');
      const codex = await ask('What exact name did you read?', 'I have not read your code.', 'abs_codex_prompt');
      expect(codex.prompt).toContain('Do I need a demo account?');
      expect(codex.prompt).toContain('Yes, reviewers sign in.');
      expect(codex.prompt).not.toContain('OrchidPebble41893');
      expect(codex.prompt).not.toContain('Info.plist');
      expect(codex.prompt).not.toContain('Say the name again');

      // Back on Claude Code, the whole conversation goes again.
      await choices.getByRole('radio', { name: 'Claude Code' }).click();
      await expect(view.getByTestId('store-compliance-ai-status')).toContainText('Using Claude Code');
      const back = await ask('And now?', 'Still OrchidPebble41893.', 'abs_claude_prompt');
      expect(back.prompt).toContain('It is OrchidPebble41893.');
      expect(back.prompt).toContain('What exact name did you read?');
    });
  });
});

