// The Website view's site (src/lib/website): the privacy policy written from
// the answers, the checks on what the AI sends, the translations, the pages
// the renderer writes, the publish to GitHub against a fake GitHub, the
// colours, and the ZIP.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChanges, captionOf, defaultContent, newDraft, cleanText } from '@/lib/website/content';
import { buildPolicy, cleanPrivacy, defaultPrivacy, policyStrings, serviceNames } from '@/lib/website/privacy';
import { keepsAddresses, missingFor, prunedTranslations, sameLanguage, siteFingerprint, siteTexts, translator } from '@/lib/website/strings';
import { pageDir, pageFile, relativeHref, renderPage, renderSiteFiles, renderStylesheet, shotPath } from '@/lib/website/render';
import { gitBlobSha, publishSite, repoNameProblem, siteAddress, suggestedRepoName, GithubPublishError } from '@/lib/website/github';
import { contrast, parseColor, paletteOf, suggestColours, boardColours } from '@/lib/website/theme';
import { crc32, zipFiles } from '@/lib/website/zip';
import { hash32 } from '@/lib/i18n/hash';
import type { SiteDraft, SiteFacts, SiteFile, SiteShot } from '@/lib/website/types';
import type { ArtboardState, TextElementProps } from '@/types/artboard';

function facts(extra: Partial<SiteFacts> = {}): SiteFacts {
  return {
    appName: 'Pebble',
    tagline: 'Habits that stick',
    developer: 'Pebble Labs',
    supportEmail: 'help@pebble.app',
    appStoreUrl: 'https://apps.apple.com/app/id1234567890',
    playStoreUrl: '',
    location: 'Berlin, Germany',
    icon: '',
    ...extra,
  };
}

function text(id: string, content: string, fontSize: number): TextElementProps {
  return {
    id,
    type: 'text',
    content,
    fontSize,
    color: '#ffffff',
    fontFamily: 'Poppins',
    fontWeight: '700',
    position: { x: 0, y: 0 },
    size: { width: 900, height: 200 },
    rotation: 0,
    scale: 1,
  } as TextElementProps;
}

function board(id: string, extra: Partial<ArtboardState> = {}): ArtboardState {
  return { id, name: id, position: { x: 0, y: 0 }, size: { width: 1290, height: 2796 }, elements: [], backgroundColor: '#ffffff', zoom: 1, ...extra };
}

function draft(extra: Partial<SiteDraft> = {}): SiteDraft {
  const base = newDraft({
    projectId: 'p1',
    facts: facts(),
    theme: { source: 'custom', brand: '#4f46e5', brand2: '#7c3aed', accent: '#4f46e5', headingFont: '', headingWeight: 700 },
    captions: [
      { title: 'Build streaks', body: 'One tap a day keeps it going' },
      { title: 'See your week', body: '' },
    ],
    baseLocale: 'en-US',
    languages: ['de-DE', 'ar-SA'],
    privacy: { ...defaultPrivacy(new Date(2026, 10, 15)), answered: true, uses: ['analytics', 'purchases'], services: { analytics: 'TelemetryDeck' } },
    now: 1,
  });
  return { ...base, ...extra };
}

function shot(boardId: string, hash: string, caption = ''): SiteShot {
  return { boardId, caption, width: 720, height: 1560, bytes: new Uint8Array([1, 2, 3, hash.length]), url: `blob:${hash}`, hash };
}

// --- the privacy policy ------------------------------------------------------------------

test('an app that collects nothing gets a policy that says so, with no sharing or keeping sections', () => {
  const sections = buildPolicy({ facts: facts(), privacy: { ...defaultPrivacy(), answered: true } });
  const ids = sections.map((section) => section.id);
  assert.ok(ids.includes('summary'));
  assert.ok(!ids.includes('sharing'));
  assert.ok(!ids.includes('keeping'));
  const all = policyStrings(sections).join('\n');
  assert.match(all, /Pebble doesn't collect any personal data/);
  assert.match(all, /Pebble is made by Pebble Labs/);
  assert.match(all, /help@pebble\.app/);
});

test('each use gets its own section and its services, and the services are listed once under sharing', () => {
  const privacy = cleanPrivacy({
    ...defaultPrivacy(),
    answered: true,
    uses: ['ads', 'analytics', 'crashes'],
    services: { analytics: 'Firebase Analytics, TelemetryDeck', crashes: 'Firebase Analytics; Sentry', ads: 'Google AdMob' },
    personalizedAds: true,
  });
  // Put back in the questions' order.
  assert.deepEqual(privacy.uses, ['analytics', 'crashes', 'ads']);
  assert.deepEqual(serviceNames(privacy), ['Firebase Analytics', 'TelemetryDeck', 'Sentry', 'Google AdMob']);
  const sections = buildPolicy({ facts: facts(), privacy });
  const ads = sections.find((section) => section.id === 'ads')!;
  assert.match(JSON.stringify(ads), /advertising identifier/);
  assert.match(JSON.stringify(ads), /The ads come from Google AdMob/);
  const sharing = sections.find((section) => section.id === 'sharing')!;
  assert.deepEqual(sharing.blocks.find((block) => block.kind === 'ul'), { kind: 'ul', items: ['Firebase Analytics', 'TelemetryDeck', 'Sentry', 'Google AdMob'] });
});

test('an app for children never has ads picked from what people do', () => {
  const privacy = cleanPrivacy({ ...defaultPrivacy(), answered: true, uses: ['ads'], personalizedAds: true, children: true });
  assert.equal(privacy.personalizedAds, false);
  const all = policyStrings(buildPolicy({ facts: facts(), privacy })).join('\n');
  assert.doesNotMatch(all, /advertising identifier/);
  assert.match(all, /made for children/);
});

test("the developer's own paragraphs go in More details", () => {
  const sections = buildPolicy({ facts: facts(), privacy: { ...defaultPrivacy(), answered: true }, extra: 'First thing.\n\nSecond   thing.' });
  const more = sections.find((section) => section.id === 'more')!;
  assert.deepEqual(more.blocks, [
    { kind: 'p', text: 'First thing.' },
    { kind: 'p', text: 'Second thing.' },
  ]);
});

// --- captions and the AI's changes ------------------------------------------------------------

function at(element: TextElementProps, x: number, y: number): TextElementProps {
  return { ...element, position: { x, y } };
}

test("a screenshot's caption is its headline, set over one layer or several, and the body a clearly smaller one", () => {
  const caption = captionOf(board('a', { elements: [at(text('b', 'One tap a day', 40), 0, 400), at(text('c', 'actually use', 86), 0, 200), at(text('t', "A finance\napp   you'll", 90), 0, 50)] }));
  assert.deepEqual(caption, { title: "A finance app you'll actually use", body: 'One tap a day' });
  // A badge with no letters is decoration.
  const badges = captionOf(board('b', { elements: [text('n', '100,000+', 120), text('s', '\u2605\u2605\u2605\u2605\u2605', 110), text('h', 'Breathe better', 80)] }));
  assert.deepEqual(badges, { title: 'Breathe better', body: '' });
  // A badge in capitals and the small print of a drawn app screen are not the line under it.
  const labelled = captionOf(
    board('c', {
      elements: [
        at(text('t', 'See Where Your Money Goes', 100), 0, 100),
        at(text('l', 'MONEY INSIGHTS', 60), 0, 20),
        at(text('b', 'Break down your expenses.', 50), 0, 300),
        at(text('u', 'Grocery store', 20), 0, 900),
        // The app's screen drawn further down, at a size a line under it could have.
        at(text('m', 'Dinner out with friends', 50), 0, 1500),
      ],
    })
  );
  assert.deepEqual(labelled, { title: 'See Where Your Money Goes', body: 'Break down your expenses.' });
  assert.deepEqual(captionOf(board('e')), { title: '', body: '' });
});

test('the content a site starts with comes from the captions and the privacy answers', () => {
  const content = defaultContent({
    facts: facts({ tagline: '' }),
    captions: [{ title: 'Build streaks', body: 'One tap a day' }],
    privacy: { ...defaultPrivacy(), answered: true, uses: ['purchases'] },
    baseLocale: 'de-DE',
  });
  assert.equal(content.headline, 'Build streaks');
  assert.equal(content.subhead, 'One tap a day');
  // The default sentences are English, so a German site translates them.
  assert.equal(content.lang, 'en-US');
  assert.deepEqual(content.features.map((feature) => [feature.title, feature.shot]), [['Build streaks', 0]]);
  assert.ok(content.faqs.some((faq) => /subscription/i.test(faq.question)));
  assert.match(content.ctaBody, /App Store/);
});

test("the AI's changes land field by field, and a made-up address or an overlong headline is turned down", () => {
  const start = draft();
  const report = applyChanges(
    start,
    {
      headline: 'x'.repeat(200),
      subhead: 'Write to **support@made-up.com** for help',
      ctaTitle: 'Get  Pebble — today',
      faqs: [
        { question: 'How do I reset?', answer: 'Email help@pebble.app and we sort it.' },
        { question: 'Bad?', answer: 'Visit https://evil.example.com now' },
      ],
      features: [{ title: 'Streaks', body: 'Keep going', shot: 2 }, { title: 'Nowhere', body: '', shot: 9 }],
      privacy: { uses: ['analytics', 'nonsense'] },
      colors: { brand: '#112233' },
    },
    2
  );
  assert.equal(report.draft.content.headline, start.content.headline);
  assert.equal(report.draft.content.subhead, start.content.subhead);
  assert.equal(report.draft.content.ctaTitle, 'Get Pebble, today');
  assert.deepEqual(report.draft.content.faqs.map((faq) => faq.question), ['How do I reset?']);
  // Screenshots are counted from 1 in the prompt.
  assert.deepEqual(report.draft.content.features.map((feature) => [feature.title, feature.shot]), [['Streaks', 1], ['Nowhere', -1]]);
  assert.equal(report.draft.theme.brand, '#112233');
  assert.equal(report.draft.theme.source, 'custom');
  assert.deepEqual(report.draft.privacy, start.privacy);
  assert.ok(report.refused.includes('headline'));
  assert.ok(report.refused.includes('line under the headline'));
  assert.ok(report.refused.includes('privacy answers'));
  assert.ok(report.changed.includes('questions and answers'));
});

test('a new support email is the one the rest of the changes are checked against', () => {
  const report = applyChanges(draft(), { supportEmail: 'hello@pebble.app', contactNote: 'Write to hello@pebble.app' }, 0);
  assert.equal(report.draft.facts.supportEmail, 'hello@pebble.app');
  assert.equal(report.draft.content.contactNote, 'Write to hello@pebble.app');
});

test('cleanText takes Markdown and spaced dashes out', () => {
  assert.equal(cleanText('## **Big** news – now `here`'), 'Big news, now here');
});

// --- translations --------------------------------------------------------------------------------

test('a translation is found by the text it translates, and an edited text falls back to its source', () => {
  const site = draft();
  const de = translator({ ...site, translations: { 'de-DE': { [hash32(site.content.headline)]: 'Streaks aufbauen' } } }, 'de-DE');
  assert.equal(de(site.content.headline), 'Streaks aufbauen');
  assert.equal(de('Something new'), 'Something new');
  // English template text needs nothing in an English variant.
  assert.ok(sameLanguage('en-US', 'en-GB'));
  assert.ok(!sameLanguage('pt-BR', 'pt-PT'));
  const missing = missingFor(site, 'de-DE');
  assert.ok(missing.content.includes(site.content.headline));
  assert.ok(missing.template.includes('Privacy policy'));
  assert.deepEqual(missingFor(site, 'en-US'), { content: [], template: [] });
});

test("the project's own translated captions count as translations", () => {
  const site = draft();
  const known = { 'de-DE': { [hash32('Build streaks')]: 'Serien aufbauen' } };
  assert.equal(translator(site, 'de-DE', known)('Build streaks'), 'Serien aufbauen');
  assert.ok(!missingFor(site, 'de-DE', known).content.includes('Build streaks'));
});

test('translations of text the site no longer has are dropped, and the order they came in does not change the fingerprint', () => {
  const site = draft();
  const a = { ...site, translations: { 'de-DE': { [hash32(site.content.headline)]: 'A', deadbeef: 'old' }, 'ar-SA': { [hash32('Support')]: 'B' } } };
  assert.deepEqual(prunedTranslations(a), { 'de-DE': { [hash32(site.content.headline)]: 'A' }, 'ar-SA': { [hash32('Support')]: 'B' } });
  const b = { ...site, translations: { 'ar-SA': { [hash32('Support')]: 'B' }, 'de-DE': { deadbeef: 'old', [hash32(site.content.headline)]: 'A' } } };
  assert.equal(siteFingerprint(a), siteFingerprint(b));
  assert.notEqual(siteFingerprint(a), siteFingerprint({ ...a, content: { ...a.content, headline: 'Other' } }));
});

test('a translation that drops an email or a web address is turned down', () => {
  assert.ok(keepsAddresses('Write to help@pebble.app', 'Schreib an help@pebble.app'));
  assert.ok(!keepsAddresses('Write to help@pebble.app', 'Schreib uns'));
  assert.ok(keepsAddresses('No address here', 'Keine Adresse'));
});

test('the texts of a site include the policy and the fixed words, and not the developer paragraphs as English', () => {
  const site = draft({ content: { ...draft().content, privacyExtra: 'Unser Text.' } });
  const texts = siteTexts(site);
  assert.ok(texts.content.includes('Unser Text.'));
  assert.ok(!texts.template.includes('Unser Text.'));
  assert.ok(texts.template.includes('Who else sees your data'));
});

// --- the pages ---------------------------------------------------------------------------------------

test('every page is in a folder of its own, and links between them are relative', () => {
  const site = draft();
  assert.equal(pageDir(site, 'en-US', 'home'), '');
  assert.equal(pageDir(site, 'en-US', 'support'), 'support/');
  assert.equal(pageFile(site, 'de-DE', 'privacy'), 'de-de/privacy/index.html');
  assert.equal(relativeHref('de-de/privacy/', 'assets/site.css'), '../../assets/site.css');
  assert.equal(relativeHref('', ''), './');
  const html = renderPage(site, 'privacy', 'de-DE', []);
  assert.match(html, /<html lang="de-DE" dir="ltr"/);
  assert.match(html, /href="\.\.\/\.\.\/assets\/site\.css"/);
  assert.match(html, /href="\.\.\/support\/"/);
  // The language menu goes to the same page in the other language.
  assert.match(html, /href="\.\.\/\.\.\/privacy\/" hreflang="en-US"/);
});

test('an Arabic page reads right to left, and the developer text is escaped', () => {
  const site = draft({ content: { ...draft().content, headline: '<script>alert(1)</script> & more' } });
  const html = renderPage(site, 'home', 'ar-SA', []);
  assert.match(html, /dir="rtl"/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more'));
});

test('a font name cannot end the stylesheet it goes into', () => {
  const site = draft({ theme: { ...draft().theme, headingFont: 'Evil</style><script>alert(1)</script>' } });
  const css = renderStylesheet(site);
  assert.ok(!css.includes('</style>'));
  assert.ok(!css.includes('<script>'));
  const html = renderPage(site, 'home', 'en-US', [], { inlineCss: css });
  assert.equal(html.match(/<\/style>/g)?.length, 1);
});

test('the home page shows the screenshots, the store links and the Smart App Banner', () => {
  const site = draft();
  const shots = [shot('a', 'aaa', 'Build streaks'), shot('b', 'bbb'), shot('c', 'ccc')].map((item) => ({ path: shotPath(item), width: item.width, height: item.height, caption: item.caption }));
  const html = renderPage(site, 'home', 'en-US', shots, { siteUrl: 'https://pebble.github.io/pebble/' });
  assert.match(html, /class="fan"/);
  assert.match(html, /assets\/shots\/aaa\.jpg/);
  assert.match(html, /alt="Build streaks"/);
  assert.match(html, /href="https:\/\/apps\.apple\.com\/app\/id1234567890"/);
  assert.match(html, /<meta name="apple-itunes-app" content="app-id=1234567890">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/pebble\.github\.io\/pebble\/">/);
  assert.match(html, /hreflang="de-DE" href="https:\/\/pebble\.github\.io\/pebble\/de-de\/"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/pebble\.github\.io\/pebble\/assets\/shots\/aaa\.jpg">/);
  assert.doesNotMatch(html, /Google Play/);
});

test('the support page mails the support address and lists the questions', () => {
  const html = renderPage(draft(), 'support', 'en-US', []);
  assert.match(html, /href="mailto:help@pebble\.app\?subject=Pebble%3A%20Support"/);
  assert.match(html, /<details><summary>/);
  assert.match(html, /Pebble support/);
});

test('the preview links carry the page and language the editor follows, and leave the script out', () => {
  const html = renderPage(draft(), 'home', 'en-US', [], { preview: true, inlineCss: 'body{}' });
  assert.match(html, /data-osg-page="support" data-osg-locale="en-US"/);
  assert.match(html, /<style>body\{\}<\/style>/);
  assert.doesNotMatch(html, /sessionStorage/);
});

test('the whole site has every page in every language, each screenshot once, and what GitHub Pages reads', () => {
  const site = draft();
  const files = renderSiteFiles(site, {
    shots: { 'en-US': [shot('a', 'aaa'), shot('b', 'bbb')], 'de-DE': [shot('a', 'aaa'), shot('b', 'ddd')] },
    siteUrl: 'https://pebble.github.io/pebble',
    build: 'build-1',
    now: Date.UTC(2026, 10, 15),
  });
  const paths = files.map((file) => file.path);
  for (const path of ['index.html', 'support/index.html', 'privacy/index.html', 'de-de/index.html', 'ar-sa/privacy/index.html', '404.html', '.nojekyll', 'robots.txt', 'sitemap.xml', 'osg-site.json', 'assets/site.css', 'README.md']) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
  // Arabic has no screenshots of its own and shows the base language's.
  assert.deepEqual(paths.filter((path) => path.startsWith('assets/shots/')).sort(), ['assets/shots/aaa.jpg', 'assets/shots/bbb.jpg', 'assets/shots/ddd.jpg']);
  assert.equal(new Set(paths).size, paths.length);
  const marker = JSON.parse(files.find((file) => file.path === 'osg-site.json')!.text!);
  assert.equal(marker.build, 'build-1');
  const sitemap = files.find((file) => file.path === 'sitemap.xml')!.text!;
  assert.match(sitemap, /<loc>https:\/\/pebble\.github\.io\/pebble\/ar-sa\/support\/<\/loc>/);
  const missing = files.find((file) => file.path === '404.html')!.text!;
  assert.match(missing, /href="https:\/\/pebble\.github\.io\/pebble\/assets\/site\.css"/);
});

// --- GitHub ---------------------------------------------------------------------------------------------

test('repository names come from the app name, and GitHub-breaking ones are caught', () => {
  assert.equal(suggestedRepoName('Ludo Wala: 3D & Action'), 'ludo-wala-3d-and-action');
  assert.equal(suggestedRepoName('Café Crème'), 'cafe-creme');
  assert.equal(suggestedRepoName('!!!'), 'app-website');
  assert.equal(repoNameProblem('good-name'), null);
  assert.ok(repoNameProblem('bad name'));
  assert.ok(repoNameProblem('x.git'));
  assert.equal(siteAddress('Octo', 'octo.github.io'), 'https://octo.github.io/');
  assert.equal(siteAddress('Octo', 'pebble'), 'https://octo.github.io/pebble/');
});

test('the blob SHA is the one git gives', async () => {
  assert.equal(await gitBlobSha(new TextEncoder().encode('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.equal(await gitBlobSha(new Uint8Array()), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A GitHub that answers the publish's calls, from `routes`, and keeps what was asked. */
function fakeGithub(routes: Array<[string, number, unknown]>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = `${url.pathname}${url.search}`;
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes.find(([pattern]) => new RegExp(`^${pattern}$`).test(`${method} ${path}`));
    if (!route) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify(route[2]), { status: route[1] });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const SITE_FILES: SiteFile[] = [
  { path: 'index.html', text: '<!doctype html>home' },
  { path: 'assets/shots/aaa.jpg', bytes: new Uint8Array([255, 216, 255]) },
  { path: 'osg-site.json', text: '{"build":"b1"}' },
];

test('a first publish makes the repository, sends the pictures as blobs and the text in the tree, and switches Pages on', async () => {
  const { fetchImpl, calls } = fakeGithub([
    ['GET /repos/octo/pebble', 404, { message: 'Not Found' }],
    ['POST /user/repos', 201, { default_branch: 'main', private: false }],
    ['GET /repos/octo/pebble/git/ref/heads/main', 200, { object: { sha: 'head1' } }],
    ['GET /repos/octo/pebble/git/commits/head1', 200, { tree: { sha: 'tree1' } }],
    ['GET /repos/octo/pebble/git/trees/tree1\\?recursive=1', 200, { tree: [{ path: 'README.md', type: 'blob', mode: '100644', sha: 'r1' }] }],
    ['POST /repos/octo/pebble/git/blobs', 201, { sha: 'blob-jpg' }],
    ['POST /repos/octo/pebble/git/trees', 201, { sha: 'tree2' }],
    ['POST /repos/octo/pebble/git/commits', 201, { sha: 'commit2' }],
    ['PATCH /repos/octo/pebble/git/refs/heads/main', 200, {}],
    ['GET /repos/octo/pebble/pages', 404, { message: 'Not Found' }],
    ['POST /repos/octo/pebble/pages', 201, {}],
  ]);
  const outcome = await publishSite({ token: 't', owner: 'octo', repo: 'pebble', files: SITE_FILES, appName: 'Pebble', siteUrl: 'https://octo.github.io/pebble/', fetchImpl });
  assert.deepEqual(outcome, { branch: 'main', commit: 'commit2', created: true, unchanged: false, pages: 'switched-on' });
  const create = calls.find((call) => call.method === 'POST' && call.path === '/user/repos')!;
  assert.equal((create.body as { private: boolean }).private, false);
  assert.equal((create.body as { auto_init: boolean }).auto_init, true);
  assert.equal(calls.filter((call) => call.path.endsWith('/git/blobs')).length, 1);
  const tree = calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/trees'))!.body as { tree: Array<{ path: string; sha?: string; content?: string }>; base_tree?: string };
  // The tree is the site's files only, so the README auto_init made is gone.
  assert.equal(tree.base_tree, undefined);
  assert.deepEqual(tree.tree.map((entry) => entry.path), ['index.html', 'assets/shots/aaa.jpg', 'osg-site.json']);
  assert.equal(tree.tree[0].content, '<!doctype html>home');
  assert.equal(tree.tree[1].sha, 'blob-jpg');
  const commit = calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/commits'))!.body as { parents: string[] };
  assert.deepEqual(commit.parents, ['head1']);
  const pages = calls.find((call) => call.method === 'POST' && call.path.endsWith('/pages'))!.body;
  assert.deepEqual(pages, { build_type: 'legacy', source: { branch: 'main', path: '/' } });
});

test("a publish again sends only what changed, and a Pages switch GitHub refuses is left to the developer", async () => {
  const jpgSha = await gitBlobSha(SITE_FILES[1].bytes!);
  const { fetchImpl, calls } = fakeGithub([
    ['GET /repos/octo/pebble', 200, { default_branch: 'main', private: false }],
    ['GET /repos/octo/pebble/contents/osg-site.json\\?ref=main', 200, {}],
    ['GET /repos/octo/pebble/git/ref/heads/main', 200, { object: { sha: 'head1' } }],
    ['GET /repos/octo/pebble/git/commits/head1', 200, { tree: { sha: 'tree1' } }],
    ['GET /repos/octo/pebble/git/trees/tree1\\?recursive=1', 200, { tree: [{ path: 'assets/shots/aaa.jpg', type: 'blob', mode: '100644', sha: jpgSha }] }],
    ['POST /repos/octo/pebble/git/trees', 201, { sha: 'tree2' }],
    ['POST /repos/octo/pebble/git/commits', 201, { sha: 'commit2' }],
    ['PATCH /repos/octo/pebble/git/refs/heads/main', 200, {}],
    ['GET /repos/octo/pebble/pages', 403, { message: 'Resource not accessible by integration' }],
    ['POST /repos/octo/pebble/pages', 403, { message: 'Resource not accessible by integration' }],
  ]);
  const outcome = await publishSite({ token: 't', owner: 'octo', repo: 'pebble', files: SITE_FILES, appName: 'Pebble', siteUrl: 'https://octo.github.io/pebble/', fetchImpl });
  assert.equal(outcome.created, false);
  assert.equal(outcome.pages, 'needs-you');
  assert.equal(calls.filter((call) => call.path.endsWith('/git/blobs')).length, 0);
  const tree = calls.find((call) => call.method === 'POST' && call.path.endsWith('/git/trees'))!.body as { tree: Array<{ path: string; sha?: string }> };
  assert.equal(tree.tree.find((entry) => entry.path === 'assets/shots/aaa.jpg')!.sha, jpgSha);
});

test('a repository the app did not make is never written to', async () => {
  const { fetchImpl, calls } = fakeGithub([
    ['GET /repos/octo/pebble', 200, { default_branch: 'main', private: false }],
    ['GET /repos/octo/pebble/contents/osg-site.json\\?ref=main', 404, { message: 'Not Found' }],
  ]);
  await assert.rejects(
    publishSite({ token: 't', owner: 'octo', repo: 'pebble', files: SITE_FILES, appName: 'Pebble', siteUrl: 'https://octo.github.io/pebble/', fetchImpl }),
    (error: unknown) => error instanceof GithubPublishError && error.problem === 'taken'
  );
  assert.ok(calls.every((call) => call.method === 'GET'));
});

test('a sign-in that ran out says so', async () => {
  const { fetchImpl } = fakeGithub([['GET /repos/octo/pebble', 401, { message: 'Bad credentials' }]]);
  await assert.rejects(
    publishSite({ token: 't', owner: 'octo', repo: 'pebble', files: SITE_FILES, appName: 'Pebble', siteUrl: 'https://octo.github.io/pebble/', fetchImpl }),
    (error: unknown) => error instanceof GithubPublishError && error.problem === 'auth'
  );
});

// --- colours ---------------------------------------------------------------------------------------------

test('colours parse from hex and rgb, and see-through ones are skipped', () => {
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204 });
  assert.deepEqual(parseColor('rgba(10, 20, 30, 0.9)'), { r: 10, g: 20, b: 30 });
  assert.equal(parseColor('#00000010'), null);
  assert.equal(parseColor('transparent'), null);
  assert.ok(Math.abs(contrast({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }) - 21) < 0.01);
});

test('the screenshots give the brand: their colourful background, not the white one', () => {
  const colours = boardColours([
    board('a', { backgroundType: 'gradient', backgroundGradient: { color1: '#ff5a1f', color2: '#c81e1e', angle: 180 } }),
    board('b', { backgroundType: 'gradient', backgroundGradient: { color1: '#ff5a1f', color2: '#c81e1e', angle: 180 } }),
    board('c'),
  ]);
  const suggested = suggestColours({ boards: colours });
  assert.equal(suggested.source, 'screenshots');
  assert.notEqual(suggested.brand, '#ffffff');
  assert.equal(suggestColours({}).source, 'default');
});

test('text on the brand and the links are readable on both pages', () => {
  for (const theme of [
    { brand: '#ffd400', brand2: '#ffb000', accent: '#ffd400' },
    { brand: '#0b1d51', brand2: '#1e3a8a', accent: '#60a5fa' },
    { brand: '#22c55e', brand2: '#16a34a', accent: '#22c55e' },
  ]) {
    const palette = paletteOf(theme);
    const on = parseColor(palette.onBrand)!;
    assert.ok(Math.min(contrast(on, parseColor(palette.brand)!), contrast(on, parseColor(palette.brand2)!)) >= 3, `${theme.brand} text`);
    assert.ok(contrast(parseColor(palette.linkLight)!, { r: 255, g: 255, b: 255 }) >= 4.5, `${theme.accent} on white`);
    assert.ok(contrast(parseColor(palette.linkDark)!, { r: 11, g: 13, b: 18 }) >= 4.5, `${theme.accent} on dark`);
  }
});

// --- the ZIP ---------------------------------------------------------------------------------------------

test('the ZIP has a local header per file and an end record that counts them', async () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const blob = zipFiles([{ path: 'index.html', text: 'hi' }, { path: 'assets/a.jpg', bytes: new Uint8Array([1, 2, 3]) }], { folder: 'pebble' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  assert.ok(new TextDecoder().decode(bytes).includes('pebble/assets/a.jpg'));
});
