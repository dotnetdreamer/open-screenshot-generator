// SEO (src/lib/seo): the copied claude-seo checks, how a run joins page
// results into the site's findings and score, which addresses the check may
// fetch, a whole check against a made-up site, keeping claude-seo's notes in
// step with GitHub, what is kept of the AI's answers, Google's answers, and
// Ask AI's Google setup job for SEO.
//
// The full proof that the checks match claude-seo's Python lives in the fork
// (osg/tests/parity.test.ts). The few page checks here only make sure the
// copy in this app is whole and wired.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

const storage = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
  addEventListener() {},
  removeEventListener() {},
  fetch: async () => {
    throw new TypeError('no network in unit tests');
  },
};

import { PAGE_CHECK_IDS, runPageChecks, auditRobotsText, lighthouseLlmsTxt, analyseText } from '@/lib/seo/checks';
import vendored from '@/lib/seo/checks/VENDORED.json';
import { SITE_CHECKS, plainFinding, severityOf, SEVERITY_WORDS, AREA_WORDS } from '@/lib/seo/plain';
import { llmsUnread, overallScore, pageLinks, readPage, scoreFindings, siteFindings, type SiteExtras } from '@/lib/seo/report';
import { fetchUrl, isPrivateHost, mayFetch, normaliseStart, type Fetched, type Transport } from '@/lib/seo/fetch';
import { checkLiveSite, readSitemapAnswer } from '@/lib/seo/run';
import { DEFAULT_MANIFEST, MANIFEST_PATH, BRANCH_HEAD_URL, isKnowledgePath, readManifest, treeUrl, wantedPaths } from '@/lib/seo/source';
import { runKnowledgeSync, knowledgeFor, googleUpdates, type KnowledgeState } from '@/lib/seo/sync';
import { memoryKnowledgeStore } from '@/lib/seo/store';
import { readPlan, googleDigest, runDigest } from '@/lib/seo/ai';
import { closeToPageOne, propertyFor, rate, readPageSpeed, reportWindow, type PageSpeedResult } from '@/lib/seo/google';
import { CRUX_SHARED_HOST, draftArtboards, getSeoState, loadCrux, pageOfSite, resetSeoState, runSpeed, scoreWithSpeed, seedSeoState, siteIsWholeHost, siteOrigin, speedOf } from '@/lib/seo/state';
import { setSeoGoogle } from '@/lib/seo/googleSettings';
import type { ArtboardState } from '@/types/artboard';
import { isGoogleApiKey, readKeyFile } from '@/lib/seo/googleSettings';
import { gitBlobSha } from '@/lib/website/github';
import { readAction } from '@/lib/growth/setup/prompt';
import { judgeClick, mayOpen, valid } from '@/lib/growth/setup/policy';
import { addKeyFile, configureAssistant, configureSeoSetup, noteDownloadStarted, seoStatusText, startSeoSetup, assistantGoal, setAssistantBrowser, type AssistantEnv } from '@/lib/growth/setup/assistant';
import type { SiteRun, PageReport } from '@/lib/seo/types';

// --- the copied checks --------------------------------------------------------

test('checks: the copy names the fork commit it came from, and every check has plain words', () => {
  assert.match(vendored.commit, /^[0-9a-f]{40}$/);
  assert.equal(vendored.repository, 'https://github.com/dotnetdreamer/claude-seo');
  assert.equal(PAGE_CHECK_IDS.length, 47);
  for (const id of PAGE_CHECK_IDS) {
    const plain = plainFinding(id);
    assert.ok(plain.title && plain.why && plain.fix, id);
  }
});

test('checks: a bare page trips the basic checks, a full one passes them', () => {
  const bare = runPageChecks('<p>Hello</p>', 'https://bare.example/');
  const ids: string[] = bare.findings.map((finding) => finding.id);
  for (const id of ['missing-title', 'missing-meta-description', 'missing-h1', 'missing-doctype', 'missing-lang', 'missing-viewport', 'missing-canonical']) assert.ok(ids.includes(id), id);
  const good = runPageChecks(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pebble Notes: quick notes that sync</title><meta name="description" content="Quick notes"><link rel="canonical" href="https://pebble.example/"><meta property="og:title" content="P"><meta property="og:image" content="https://pebble.example/og.png"></head><body><h1>Pebble</h1></body></html>',
    'https://pebble.example/',
  );
  assert.deepEqual(good.findings.map((finding) => finding.id).filter((id) => id.startsWith('missing')), []);
});

test('checks: robots.txt groups, llms.txt and the copy check answer as the scripts do', () => {
  const robots = auditRobotsText('User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n');
  assert.equal(robots.agents.find((agent) => agent.token === 'OAI-SearchBot')?.rootAllowed, false);
  assert.equal(robots.agents.find((agent) => agent.token === 'GPTBot')?.group, 'star');
  assert.equal(robots.aiGroups.status, 'warn');
  assert.equal(lighthouseLlmsTxt(404, null).lighthouse, 'not-applicable');
  assert.equal(lighthouseLlmsTxt(200, '# App\n\n> Notes\n\n- [Home](https://a.example/): the start of it all, more words').lighthouse, 'pass');
  const copy = analyseText("In today's fast-paced world, let's dive into the ever-evolving landscape. Moreover, unlock the full potential.");
  assert.ok(copy.flags.includes('filler') && copy.flags.includes('ai-patterns'));
});

// --- plain words ----------------------------------------------------------------

test('plain words: no dashes and no trailing period in a title, every site check has a real level', () => {
  const all = [...PAGE_CHECK_IDS.map(plainFinding), ...Object.values(SITE_CHECKS)];
  for (const words of all) {
    for (const text of [words.title, words.why, words.fix]) assert.doesNotMatch(text, /[–—]/, text);
    assert.doesNotMatch(words.title, /\.$/, words.title);
  }
  for (const [id, check] of Object.entries(SITE_CHECKS)) assert.ok(['Critical', 'High', 'Medium', 'Low'].includes(check.severity), id);
  assert.equal(SEVERITY_WORDS.Critical, 'Fix now');
  assert.ok(AREA_WORDS.ai.title);
  assert.equal(plainFinding('something-new').title, 'Something on the page needs a look');
  assert.equal(severityOf('noindex'), 'Critical');
});

// --- joining pages into the site's findings ---------------------------------------------

function page(url: string, html: string, label = url, extra: Partial<PageReport> = {}): PageReport {
  return { ...readPage({ url, finalUrl: url, redirects: [], status: 200, label, foundBy: 'link', html, headers: {} }, null), ...extra };
}

const OPEN_EXTRAS: SiteExtras = {
  robotsStatus: 200,
  robotsText: 'User-agent: *\nAllow: /\n',
  robotsInFolder: false,
  llmsStatus: 404,
  llmsText: null,
  sitemap: { url: 'https://a.example/sitemap.xml', pages: 2 },
  homeHtml: '<p>Home</p>',
  https: true,
};

test('findings: a page check found on several pages is one finding with every page', () => {
  const pages = [page('https://a.example/', '<p>One</p>', 'Home page'), page('https://a.example/b', '<p>Two</p>', '/b')];
  const robots = auditRobotsText(OPEN_EXTRAS.robotsText ?? '');
  const findings = siteFindings(pages, OPEN_EXTRAS, robots, lighthouseLlmsTxt(404, null), null);
  const missing = findings.find((finding) => finding.id === 'missing-title');
  assert.equal(missing?.pages.length, 2);
  assert.deepEqual(missing?.pages.map((entry) => entry.label), ['Home page', '/b']);
  assert.ok(findings.some((finding) => finding.id === 'no-llms-txt'));
});

test('findings: the same title twice counts per language, and robots.txt in a folder is its own finding', () => {
  const head = (lang: string) => `<!doctype html><html lang="${lang}"><head><title>Pebble Notes: quick notes that sync</title></head><body></body></html>`;
  const pages = [page('https://a.example/', head('en')), page('https://a.example/x', head('en')), page('https://a.example/de/', head('de'))];
  const robots = auditRobotsText('');
  const findings = siteFindings(pages, { ...OPEN_EXTRAS, robotsStatus: 404, robotsText: null, robotsInFolder: true }, { ...robots, reachable: 'missing', status: 404 }, lighthouseLlmsTxt(404, null), null);
  assert.equal(findings.find((finding) => finding.id === 'duplicate-title')?.pages.length, 2);
  assert.ok(findings.some((finding) => finding.id === 'robots-in-folder'));
  assert.ok(!findings.some((finding) => finding.id === 'no-robots-txt'));
});

test('findings: few words without JavaScript counts only on a page that loads scripts', () => {
  const rendered = { status: 'warn' as const, words: 40, shell: false };
  const robots = auditRobotsText('');
  const plainPage = siteFindings([], { ...OPEN_EXTRAS, homeHtml: '<p>Few words</p>' }, robots, lighthouseLlmsTxt(404, null), rendered);
  assert.ok(!plainPage.some((finding) => finding.id === 'thin-without-javascript'));
  const scripted = siteFindings([], { ...OPEN_EXTRAS, homeHtml: '<p>Few</p><script src="/app.js"></script>' }, robots, lighthouseLlmsTxt(404, null), rendered);
  assert.ok(scripted.some((finding) => finding.id === 'thin-without-javascript'));
});

test('findings: app details without a price or a category, as the Website view writes them today', () => {
  const html = '<!doctype html><html lang="en"><head><title>T</title><script type="application/ld+json">{"@type":"MobileApplication","name":"Pebble","operatingSystem":"iOS"}</script></head><body><h1>Pebble</h1></body></html>';
  const home = { ...page('https://a.example/', html, 'Home page'), foundBy: 'start' as const };
  const findings = siteFindings([home], { ...OPEN_EXTRAS, homeHtml: html }, auditRobotsText(''), lighthouseLlmsTxt(404, null), null);
  const incomplete = findings.find((finding) => finding.id === 'app-details-incomplete');
  assert.match(incomplete?.pages[0].evidence ?? '', /offers \(price\) and applicationCategory/);
});

test('score: a finding on every page costs its full points, on one page of many half, and speed counts once measured', () => {
  const one = scoreFindings([{ id: 'thin-content', severity: 'Medium', area: 'content', pages: [{ url: 'a', label: '', evidence: '' }] }], 4);
  const all = scoreFindings([{ id: 'thin-content', severity: 'Medium', area: 'content', pages: ['a', 'b', 'c', 'd'].map((url) => ({ url, label: '', evidence: '' })) }], 4);
  assert.ok((one.areas.content ?? 0) > (all.areas.content ?? 0));
  assert.equal(all.areas.content, 92);
  assert.equal(one.areas.speed, null);
  assert.equal(overallScore({ technical: 100, content: 100, onpage: 100, schema: 100, speed: null, ai: 100, images: 100 }), 100);
  assert.equal(overallScore({ technical: 100, content: 100, onpage: 100, schema: 100, speed: 0, ai: 100, images: 100 }), 90);
});

test("sitemaps as claude-seo reads them: a prefix, CDATA kept as it is, an index, gzip, a page in a sitemap's place, and files that can't be read", () => {
  const answer = (body: string | Uint8Array, type = 'application/xml', status = 200, keep = true): Fetched => {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    return { url: 'https://a.example/sitemap.xml', finalUrl: 'https://a.example/sitemap.xml', redirects: [], status, headers: { 'content-type': type }, text: new TextDecoder().decode(bytes), bytes: bytes.length, ...(keep ? { body: bytes } : {}) };
  };
  const SM = 'http://www.sitemaps.org/schemas/sitemap/0.9';
  // GPT's case: a declared prefix is a sitemap like any other.
  assert.deepEqual(readSitemapAnswer(answer(`<sm:urlset xmlns:sm="${SM}"><sm:url><sm:loc>https://a.example/</sm:loc></sm:url></sm:urlset>`)), { state: 'read', index: false, urls: ['https://a.example/'], incomplete: false });
  // CDATA keeps what's in it, &amp; and all, as XML says; a reference outside it is read. The old reader turned both into &.
  assert.deepEqual(readSitemapAnswer(answer('<urlset><url><loc> <![CDATA[https://a.example/b?x=1&amp;y=2]]> </loc></url><url><loc>https://a.example/c?x=1&amp;y=2</loc></url></urlset>')), { state: 'read', index: false, urls: ['https://a.example/b?x=1&amp;y=2', 'https://a.example/c?x=1&y=2'], incomplete: false });
  assert.deepEqual(readSitemapAnswer(answer(`<sitemapindex xmlns="${SM}"><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>`)), { state: 'read', index: true, urls: ['https://a.example/s1.xml'], incomplete: false });
  assert.deepEqual(readSitemapAnswer(answer(new Uint8Array(zlib.gzipSync(`<urlset xmlns="${SM}"><url><loc>https://a.example/z</loc></url></urlset>`)), 'application/gzip')), { state: 'read', index: false, urls: ['https://a.example/z'], incomplete: false });
  assert.deepEqual(readSitemapAnswer(answer('https://a.example/t\n', 'text/plain')), { state: 'read', index: false, urls: ['https://a.example/t'], incomplete: false });
  // A page in a sitemap's place, and files claude-seo can't read as one.
  assert.deepEqual(readSitemapAnswer(answer('<!doctype html><html><body>Not found</body></html>', 'text/html')), { state: 'page' });
  assert.deepEqual(readSitemapAnswer(answer('<urlset><url><loc>https://a.example/</loc></url>')), { state: 'unreadable', reason: "it isn't valid XML" });
  assert.deepEqual(readSitemapAnswer(answer('<sm:urlset><sm:url><sm:loc>https://a.example/</sm:loc></sm:url></sm:urlset>')), { state: 'unreadable', reason: "it isn't valid XML" });
  assert.deepEqual(readSitemapAnswer(answer('{"urls": []}', 'application/json')), { state: 'unreadable', reason: "it isn't a sitemap" });
  // Nothing known: no answer to read, an encoding the port leaves to iconv, a server error.
  assert.deepEqual(readSitemapAnswer(answer('<urlset/>', 'application/xml', 200, false)), { state: 'unknown' });
  assert.deepEqual(readSitemapAnswer(answer('<?xml version="1.0" encoding="koi8-r"?><urlset/>')), { state: 'unknown' });
  assert.deepEqual(readSitemapAnswer(answer(`<?xml version="1.0" encoding="windows-1252"?><urlset xmlns="${SM}"><url><loc>https://a.example/</loc></url></urlset>`)), { state: 'unknown' });
  // An Atom link under an xml:base is one the port can't place: the others count, and the reading says it's partial.
  const ATOM = 'http://www.w3.org/2005/Atom';
  assert.deepEqual(readSitemapAnswer(answer(`<feed xmlns="${ATOM}"><entry><link href="https://a.example/p"/></entry><entry xml:base="https://a.example/blog/"><link href="q"/></entry></feed>`)), { state: 'read', index: false, urls: ['https://a.example/p'], incomplete: true });
  assert.deepEqual(readSitemapAnswer(answer(`<feed xmlns="${ATOM}"><entry><link href="p"/></entry></feed>`)), { state: 'read', index: false, urls: ['https://a.example/p'], incomplete: false });
  assert.deepEqual(readSitemapAnswer(answer('oops', 'text/html', 503)), { state: 'unknown' });
  assert.deepEqual(readSitemapAnswer(answer('gone', 'text/html', 404)), { state: 'gone' });
  assert.deepEqual(pageLinks(['https://a.example/b#top', 'https://other.example/', 'https://a.example/shot.png', 'https://a.example/c'], 'https://a.example/'), ['https://a.example/b', 'https://a.example/c']);
});

// --- what the check may fetch ----------------------------------------------------------------

test('fetch: this computer, private networks and made-up names are never asked', () => {
  for (const host of ['localhost', 'app.localhost', 'nas.local', '10.0.0.5', '127.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.10.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'router', 'printer.lan']) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ['example.com', '172.32.0.1', '8.8.8.8', 'name.github.io', '2606:4700::1111']) assert.equal(isPrivateHost(host), false, host);
  assert.equal(mayFetch('https://192.168.0.1/admin', true), 'private');
  assert.equal(mayFetch('http://example.com/', true), 'insecure');
  assert.equal(mayFetch('http://example.com/', false), null);
  assert.equal(mayFetch('ftp://example.com/', false), 'blocked');
});

test('fetch: a typed address is made whole, or refused', () => {
  assert.equal(normaliseStart('myapp.com'), 'https://myapp.com/');
  assert.equal(normaliseStart(' https://Name.github.io/app '), 'https://name.github.io/app/');
  assert.equal(normaliseStart('https://a.example/page.html#x'), 'https://a.example/page.html');
  assert.equal(normaliseStart('not an address'), null);
  assert.equal(normaliseStart('mailto:me@a.example'), null);
  assert.equal(normaliseStart('https://user:secret@a.example/'), null);
  assert.equal(normaliseStart('a.example:8080'), 'https://a.example:8080/');
});

type Route = { status: number; body?: string; headers?: Record<string, string> };

function fakeTransport(routes: Record<string, Route>, manualRedirects = true): Transport & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    manualRedirects,
    async send(url) {
      asked.push(url);
      const route = routes[url];
      if (!route) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
      return new Response(route.body ?? '', { status: route.status, headers: { 'content-type': 'text/html; charset=utf-8', ...route.headers } });
    },
  };
}

test("fetch: a page's bytes are read in the charset it names, as claude-seo reads them (GPT's Windows-1252 page)", async () => {
  // Curly quotes, an en dash and an accented e, as Windows-1252 writes them: one byte each.
  const page = '<html><head><title>\x93Pebble\x94 \x96 caf\xe9</title></head></html>';
  const bytes = (text: string) => Uint8Array.from(Array.from(text, (ch) => ch.charCodeAt(0)));
  const transport = (body: Uint8Array, contentType: string): Transport => ({
    manualRedirects: true,
    send: async () => new Response(body, { status: 200, headers: { 'content-type': contentType } }),
  });
  const read = async (body: string, contentType: string) => (await fetchUrl('https://a.example/', { transport: transport(bytes(body), contentType) })).text ?? '';
  assert.ok((await read(page, 'text/html; charset=windows-1252')).includes('<title>\u{201C}Pebble\u{201D} \u{2013} caf\u{E9}</title>'), 'by the header');
  assert.ok((await read(`<meta charset="windows-1252">${page}`, 'text/html')).includes('\u{201C}Pebble\u{201D} \u{2013} caf\u{E9}'), 'by the meta tag');
  // Python's ISO-8859-1 is Latin-1, where a browser's is Windows-1252.
  assert.ok((await read(page, 'text/html; charset=iso-8859-1')).includes('\u{93}Pebble\u{94} \u{96} caf\u{E9}'), 'iso-8859-1');
  // No charset anywhere: UTF-8, each byte that isn't UTF-8 becoming U+FFFD.
  assert.ok((await read(page, 'text/html')).includes('\u{FFFD}Pebble\u{FFFD} \u{FFFD} caf\u{FFFD}'), 'none named');
});

test('fetch: redirects are followed one hop at a time, and a hop to a private address is refused', async () => {
  const transport = fakeTransport({
    'https://a.example/old': { status: 301, headers: { location: '/new' } },
    'https://a.example/new': { status: 302, headers: { location: 'https://b.example/final' } },
    'https://b.example/final': { status: 200, body: '<p>here</p>' },
    'https://a.example/sneaky': { status: 302, headers: { location: 'http://127.0.0.1:8080/secret' } },
  });
  const followed = await fetchUrl('https://a.example/old', { transport });
  assert.equal(followed.finalUrl, 'https://b.example/final');
  assert.deepEqual(followed.redirects, ['https://a.example/old', 'https://a.example/new', 'https://b.example/final']);
  assert.equal(followed.text, '<p>here</p>');
  const sneaky = await fetchUrl('https://a.example/sneaky', { transport });
  assert.equal(sneaky.problem, 'private');
  assert.ok(!transport.asked.some((url) => url.includes('127.0.0.1')));
});

// --- a whole check -----------------------------------------------------------------------

const HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pebble Notes: quick notes that sync everywhere</title><link rel="canonical" href="https://name.github.io/pebble/"></head><body><h1>Pebble</h1><a href="/pebble/support/">Support</a><a href="/pebble/gone/">Old page</a></body></html>`;

test("GPT's third round: a sitemap with a namespace prefix is found, and one that can't be read is never 'no sitemap'", async () => {
  const SM = 'http://www.sitemaps.org/schemas/sitemap/0.9';
  const site = { id: 'url:sm', url: 'https://pebble.example/', name: 'Pebble', source: 'address' as const, addedAt: 0 };
  const xml = { 'content-type': 'application/xml' };
  const base = {
    'https://pebble.example/': { status: 200, body: HOME.replace(/\/pebble\//g, '/') },
    'https://pebble.example/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\nSitemap: https://pebble.example/sitemap.xml\n', headers: { 'content-type': 'text/plain' } },
    'https://pebble.example/support/': { status: 200, body: HOME },
  };
  const prefixed = await checkLiveSite(site, {
    transport: fakeTransport({ ...base, 'https://pebble.example/sitemap.xml': { status: 200, body: `<sm:urlset xmlns:sm="${SM}"><sm:url><sm:loc>https://pebble.example/support/</sm:loc></sm:url></sm:urlset>`, headers: xml } }),
    pauseMs: 0,
  });
  assert.equal(prefixed.sitemap.url, 'https://pebble.example/sitemap.xml');
  assert.equal(prefixed.sitemap.pages, 1);
  assert.ok(!prefixed.findings.some((finding) => finding.id === 'no-sitemap' || finding.id === 'sitemap-unreadable'));
  assert.ok(prefixed.pages.some((page) => page.foundBy === 'sitemap'), 'the page the sitemap lists is read');

  // The same address with a file that isn't valid XML: a sitemap that can't be read, said so.
  const broken = await checkLiveSite(site, {
    transport: fakeTransport({ ...base, 'https://pebble.example/sitemap.xml': { status: 200, body: '<urlset><url><loc>https://pebble.example/support/</loc></url>', headers: xml } }),
    pauseMs: 0,
  });
  assert.deepEqual(broken.findings.filter((finding) => /sitemap/.test(finding.id)).map((finding) => [finding.id, finding.pages[0].evidence]), [['sitemap-unreadable', "https://pebble.example/sitemap.xml: it isn't valid XML"]]);
  assert.deepEqual(broken.sitemap.unreadable, { url: 'https://pebble.example/sitemap.xml', reason: "it isn't valid XML" });
  assert.match(runDigest(broken, 'Pebble'), /Sitemap: there is one, but it can't be read: https:\/\/pebble\.example\/sitemap\.xml, it isn't valid XML/);

  // robots.txt points at a web page: that's the site's sitemap, broken. A page at sitemap.xml with nothing named is no sitemap.
  const page = { status: 200, body: '<!doctype html><html><body>Not here</body></html>' };
  const named = await checkLiveSite(site, { transport: fakeTransport({ ...base, 'https://pebble.example/sitemap.xml': page }), pauseMs: 0 });
  assert.deepEqual(named.findings.filter((finding) => /sitemap/.test(finding.id)).map((finding) => finding.id), ['sitemap-unreadable']);
  const guessed = await checkLiveSite(site, {
    transport: fakeTransport({ ...base, 'https://pebble.example/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\n', headers: { 'content-type': 'text/plain' } }, 'https://pebble.example/sitemap.xml': page }),
    pauseMs: 0,
  });
  assert.deepEqual(guessed.findings.filter((finding) => /sitemap/.test(finding.id)).map((finding) => finding.id), ['no-sitemap']);

  // What the port doesn't read (docs/SEO.md): when it's all there is, the check can't tell, and says nothing is wrong.
  const sitemapFindings = (run: { findings: { id: string }[] }) => run.findings.filter((finding) => /sitemap/.test(finding.id)).map((finding) => finding.id);
  const legacy = await checkLiveSite(site, {
    transport: fakeTransport({ ...base, 'https://pebble.example/sitemap.xml': { status: 200, body: `<?xml version="1.0" encoding="windows-1252"?><urlset xmlns="${SM}"><url><loc>https://pebble.example/support/</loc></url></urlset>`, headers: xml } }),
    pauseMs: 0,
  });
  assert.deepEqual([legacy.sitemap.url, legacy.sitemap.unknown, sitemapFindings(legacy)], [null, true, []]);
  const ATOM = 'http://www.w3.org/2005/Atom';
  const based = await checkLiveSite(site, {
    transport: fakeTransport({ ...base, 'https://pebble.example/sitemap.xml': { status: 200, body: `<feed xmlns="${ATOM}"><entry xml:base="https://pebble.example/"><link href="support/"/></entry></feed>`, headers: xml } }),
    pauseMs: 0,
  });
  assert.deepEqual([based.sitemap.url, based.sitemap.unknown, sitemapFindings(based)], [null, true, []]);
  // With one link of the site's it can place, the feed is the sitemap, with that page.
  const mixed = await checkLiveSite(site, {
    transport: fakeTransport({
      ...base,
      'https://pebble.example/sitemap.xml': { status: 200, body: `<feed xmlns="${ATOM}"><entry><link href="https://pebble.example/support/"/></entry><entry xml:base="https://pebble.example/"><link href="other/"/></entry></feed>`, headers: xml },
    }),
    pauseMs: 0,
  });
  assert.deepEqual([mixed.sitemap.url, mixed.sitemap.pages, sitemapFindings(mixed)], ['https://pebble.example/sitemap.xml', 1, []]);
});

test('a live check: the folder sitemap, every page, a broken link and robots.txt in the folder', async () => {
  const transport = fakeTransport({
    'https://name.github.io/pebble/': { status: 200, body: HOME },
    'https://name.github.io/pebble/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\n', headers: { 'content-type': 'text/plain' } },
    'https://name.github.io/pebble/sitemap.xml': { status: 200, body: '<urlset><url><loc>https://name.github.io/pebble/</loc></url><url><loc>https://name.github.io/pebble/privacy/</loc></url></urlset>', headers: { 'content-type': 'application/xml' } },
    'https://name.github.io/pebble/support/': { status: 200, body: HOME.replace('Pebble Notes', 'Pebble Support') },
    'https://name.github.io/pebble/privacy/': { status: 301, headers: { location: 'https://name.github.io/pebble/privacy/index.html' } },
    'https://name.github.io/pebble/privacy/index.html': { status: 200, body: HOME.replace('Pebble Notes', 'Pebble Privacy') },
  });
  const run = await checkLiveSite({ id: 'url:x', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport, pauseMs: 0 });
  assert.equal(run.mode, 'live');
  assert.equal(run.root, 'https://name.github.io/pebble/');
  assert.equal(run.sitemap.url, 'https://name.github.io/pebble/sitemap.xml');
  assert.deepEqual(run.pages.map((entry) => entry.label).sort(), ['/gone', '/privacy', '/support', 'Home page']);
  const ids = run.findings.map((finding) => finding.id);
  assert.ok(ids.includes('page-broken'), 'the link to /gone answers 404');
  assert.ok(ids.includes('robots-in-folder'));
  assert.ok(ids.includes('no-llms-txt'));
  assert.ok(run.score.overall > 0 && run.score.overall <= 100);
  // Robots.txt is read at the host root first, as Google does.
  assert.ok(transport.asked.indexOf('https://name.github.io/robots.txt') < transport.asked.indexOf('https://name.github.io/pebble/robots.txt'));
});

/** A browser's fetch: an address the site doesn't let other sites read fails the way a browser fails it. */
function browserTransport(routes: Record<string, Route>): Transport & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    manualRedirects: false,
    async send(url) {
      asked.push(url);
      const route = routes[url];
      if (!route) throw new TypeError('Failed to fetch');
      return new Response(route.body ?? '', { status: route.status, headers: { 'content-type': 'text/html; charset=utf-8', ...route.headers } });
    },
  };
}

test("a live check in a browser: what the browser can't read is unread, never missing or broken", async () => {
  // GitHub Pages lets other sites read a 200 and not a 404, and a page that
  // redirects to another host may not let them read anything: the browser
  // says "Failed to fetch" for both, so nothing is known about either.
  const transport = browserTransport({ 'https://name.github.io/pebble/': { status: 200, body: HOME } });
  const run = await checkLiveSite({ id: 'url:y', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport, pauseMs: 0 });
  const ids = run.findings.map((finding) => finding.id);
  for (const id of ['page-broken', 'no-robots-txt', 'robots-in-folder', 'no-llms-txt', 'no-sitemap']) assert.ok(!ids.includes(id), `${id} from a request the browser couldn't read`);
  assert.equal(run.robots.reachable, 'failed');
  assert.equal(run.aiAccess, null, 'nothing is known about the AI crawlers without robots.txt');
  const gone = run.pages.find((entry) => entry.label === '/gone');
  assert.equal(gone?.status, null);
  assert.match(gone?.problem ?? '', /couldn't read this page/);
  assert.ok(run.unread?.includes('https://name.github.io/robots.txt'));
  assert.ok(run.unread?.includes('https://name.github.io/pebble/gone/'));
  assert.ok(run.unread?.includes('https://name.github.io/llms.txt'));
  assert.equal(run.sitemap.unknown, true);

  // As GitHub Pages answers (measured 2026-11-19): the host root's 404 can't
  // be read, the project folder's can. An llms.txt at the host root would
  // count, and that one wasn't read, so the folder's 404 says nothing alone.
  const pages = browserTransport({
    'https://name.github.io/pebble/': { status: 200, body: HOME },
    'https://name.github.io/pebble/llms.txt': { status: 404, body: 'Not found' },
  });
  const project = await checkLiveSite({ id: 'url:z', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport: pages, pauseMs: 0 });
  assert.ok(!project.findings.some((finding) => finding.id === 'no-llms-txt'));
  assert.ok(project.unread?.includes('https://name.github.io/llms.txt'));
});

test("GPT's cases: an unread sitemap isn't missing, and a page that redirects out of the site isn't read", async () => {
  // The project's sitemap can't be read in the browser; the host root's can,
  // and lists only a sibling project. Nothing says the project has none.
  const transport = browserTransport({
    'https://name.github.io/pebble/': { status: 200, body: HOME },
    'https://name.github.io/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\n', headers: { 'content-type': 'text/plain' } },
    'https://name.github.io/sitemap.xml': { status: 200, body: '<urlset><url><loc>https://name.github.io/other/</loc></url></urlset>', headers: { 'content-type': 'application/xml' } },
    'https://name.github.io/pebble/support/': { status: 200, body: HOME.replace('Pebble Notes', 'Pebble Support') },
  });
  const run = await checkLiveSite({ id: 'url:g', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport, pauseMs: 0 });
  assert.ok(run.unread?.includes('https://name.github.io/pebble/sitemap.xml'));
  assert.equal(run.sitemap.unknown, true);
  assert.ok(!run.findings.some((finding) => finding.id === 'no-sitemap'), 'no "The site has no sitemap"');

  // /pebble/support/ redirects to another site, whose page is broken and titled the same as another page here.
  const desktop = fakeTransport({
    'https://name.github.io/pebble/': { status: 200, body: HOME },
    'https://name.github.io/pebble/support/': { status: 301, headers: { location: 'https://elsewhere.example/support/' } },
    'https://elsewhere.example/support/': { status: 404, body: HOME },
  });
  const left = await checkLiveSite({ id: 'url:h', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport: desktop, pauseMs: 0 });
  const support = left.pages.find((page) => page.url === 'https://name.github.io/pebble/support/');
  assert.equal(support?.checks, undefined, "the other site's page isn't read");
  assert.match(support?.problem ?? '', /^Redirects out of this site, to https:\/\/elsewhere\.example\/support\//);
  for (const finding of left.findings) {
    for (const page of finding.pages) assert.ok(!page.url.startsWith('https://elsewhere.example/'), `${finding.id} on the other site's page`);
  }
});

test("what the browser couldn't read reaches the AI as unknown, and llms.txt is marked as not read", async () => {
  // A GitHub Pages project site in a browser: the host root's files can't be read.
  const transport = browserTransport({
    'https://name.github.io/pebble/': { status: 200, body: HOME },
    'https://name.github.io/pebble/llms.txt': { status: 404, body: 'Not found' },
    'https://name.github.io/pebble/support/': { status: 200, body: HOME.replace('Pebble Notes', 'Pebble Support') },
  });
  const run = await checkLiveSite({ id: 'url:d', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport, pauseMs: 0 });
  assert.equal(llmsUnread(run.llms), true);
  const digest = runDigest(run, 'Pebble');
  assert.match(digest, /robots\.txt: not read, so unknown\. AI search crawlers blocked: unknown\. llms\.txt: not read, so unknown\./);
  assert.match(digest, /Sitemap: not found, and a place one could be was not read, so unknown/);
  assert.match(digest, /Not read by the browser, so unknown \(not missing\): https:\/\/name\.github\.io\/robots\.txt/);
  assert.doesNotMatch(digest, /llms\.txt: fail/);

  // Read in full (the desktop app), a missing file is said to be missing.
  const desktop = fakeTransport({ 'https://name.github.io/pebble/': { status: 200, body: HOME } });
  const read = await checkLiveSite({ id: 'url:e', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport: desktop, pauseMs: 0 });
  assert.equal(llmsUnread(read.llms), false);
  assert.match(runDigest(read, 'Pebble'), /llms\.txt: not-applicable\.\nSitemap: none found/);
});

test('a live check in a browser: www that the browser can\'t follow is read without it, and the run says so', async () => {
  const site = { id: 'url:w', url: 'https://www.pebble.example/', name: 'Pebble', source: 'address' as const, addedAt: 0 };
  const page = HOME.replaceAll('https://name.github.io/pebble/', 'https://pebble.example/').replaceAll('/pebble/', '/');
  const transport = browserTransport({ 'https://pebble.example/': { status: 200, body: page }, 'https://pebble.example/support/': { status: 200, body: page } });
  const run = await checkLiveSite(site, { transport, pauseMs: 0 });
  assert.equal(run.root, 'https://pebble.example/');
  assert.match(run.note ?? '', /couldn't read www\.pebble\.example, so this check read pebble\.example instead/);
  assert.ok(run.pages.some((entry) => entry.label === '/support' && entry.checks), 'the pages under the bare name are read');
  // The desktop app follows the redirect itself and never needs the other name.
  const desktop = fakeTransport({ 'https://www.pebble.example/': { status: 301, headers: { location: 'https://pebble.example/' } }, 'https://pebble.example/': { status: 200, body: page } });
  const followed = await checkLiveSite(site, { transport: desktop, pauseMs: 0 });
  assert.equal(followed.note, undefined);
  assert.deepEqual(followed.pages[0].redirects, ['https://www.pebble.example/', 'https://pebble.example/']);
});

test("a live check on a shared host: the root's sitemap is another site's, so only the site's own pages count", async () => {
  const rootSitemap = `<urlset>${Array.from({ length: 40 }, (_, i) => `<url><loc>https://name.github.io/blog/post-${i}/</loc></url>`).join('')}</urlset>`;
  const transport = fakeTransport({
    // The project's home links to the owner's blog, another site on the same host.
    'https://name.github.io/pebble/': { status: 200, body: HOME.replace('</body>', '<a href="/blog/">My blog</a></body>') },
    'https://name.github.io/blog/': { status: 200, body: HOME },
    'https://name.github.io/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /\nSitemap: https://name.github.io/sitemap.xml\n', headers: { 'content-type': 'text/plain' } },
    'https://name.github.io/sitemap.xml': { status: 200, body: rootSitemap, headers: { 'content-type': 'application/xml' } },
    'https://name.github.io/pebble/sitemap.xml': { status: 200, body: '<urlset><url><loc>https://name.github.io/pebble/</loc></url><url><loc>https://name.github.io/pebble/privacy/</loc></url></urlset>', headers: { 'content-type': 'application/xml' } },
    'https://name.github.io/pebble/support/': { status: 200, body: HOME },
    'https://name.github.io/pebble/privacy/': { status: 200, body: HOME },
  });
  const run = await checkLiveSite({ id: 'url:s', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport, pauseMs: 0 });
  assert.equal(run.sitemap.url, 'https://name.github.io/pebble/sitemap.xml');
  assert.equal(run.sitemap.pages, 2);
  assert.ok(run.pages.every((entry) => entry.finalUrl.startsWith('https://name.github.io/pebble/')), run.pages.map((entry) => entry.finalUrl).join(', '));
  assert.ok(!transport.asked.some((url) => url.includes('/blog/')), 'no page of the other site is read');
  // A sitemap that lists only the other site's pages is no sitemap for this one.
  const onlyOthers = fakeTransport({
    'https://name.github.io/pebble/': { status: 200, body: HOME },
    'https://name.github.io/sitemap.xml': { status: 200, body: rootSitemap, headers: { 'content-type': 'application/xml' } },
  });
  const bare = await checkLiveSite({ id: 'url:t', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport: onlyOthers, pauseMs: 0 });
  const noSitemap = bare.findings.find((finding) => finding.id === 'no-sitemap');
  assert.match(noSitemap?.pages[0].evidence ?? '', /list no pages of this site/);
});

test('AI crawlers: robots.txt is read for the site\'s own folder and every page, not for "/" alone', async () => {
  const robots = 'User-agent: GPTBot\nDisallow: /pebble/support/\n\nUser-agent: OAI-SearchBot\nDisallow: /pebble/\n\nUser-agent: *\nAllow: /\n';
  const transport = fakeTransport({
    'https://name.github.io/pebble/': { status: 200, body: HOME },
    'https://name.github.io/robots.txt': { status: 200, body: robots, headers: { 'content-type': 'text/plain' } },
    'https://name.github.io/pebble/support/': { status: 200, body: HOME },
  });
  const run = await checkLiveSite({ id: 'url:a', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address', addedAt: 0 }, { transport, pauseMs: 0 });
  const of = (token: string) => run.aiAccess?.find((entry) => entry.token === token);
  // "/" alone says both may read the site; the site is in /pebble/.
  assert.equal(run.robots.agents.find((agent) => agent.token === 'OAI-SearchBot')?.rootAllowed, true);
  assert.deepEqual(of('OAI-SearchBot'), { token: 'OAI-SearchBot', homeAllowed: false, blocked: ['Home page', '/support'] });
  assert.deepEqual(of('GPTBot'), { token: 'GPTBot', homeAllowed: true, blocked: ['/support'] });
  assert.deepEqual(of('ClaudeBot'), { token: 'ClaudeBot', homeAllowed: true, blocked: [] });
  const finding = run.findings.find((entry) => entry.id === 'ai-search-blocked');
  assert.match(finding?.pages[0].evidence ?? '', /OAI-SearchBot/);
});

test("draft check: a site's pages are drawn from its own project, never the one open", async () => {
  const board = (title: string) => ({ id: title, name: title, size: { width: 1290, height: 2796 }, elements: [] }) as unknown as ArtboardState;
  const site = { id: 'web:A', url: '', name: 'A', source: 'website' as const, projectId: 'A', addedAt: 0 };
  const saved: Record<string, unknown> = { A: [board('saved A')] };
  const read = async (id: string) => saved[id] ?? null;
  const open = { id: 'B', artboards: [board('open B')] };
  assert.deepEqual((await draftArtboards(site, open, read)).map((entry) => entry.id), ['saved A']);
  assert.deepEqual((await draftArtboards(site, { id: 'A', artboards: [board('open A')] }, read)).map((entry) => entry.id), ['open A']);
  await assert.rejects(draftArtboards({ ...site, projectId: 'gone' }, open, read), /isn't on this device anymore/);
});

test('speed: a result belongs to the site whose page it tested, and another site\'s is never shown or scored', () => {
  const site = { id: 'url:a', url: 'https://a.example/', name: 'A', source: 'address' as const, addedAt: 0 };
  const result = (url: string): PageSpeedResult => ({ url, testedUrls: [url], strategy: 'mobile', scores: { performance: 12, accessibility: 90, bestPractices: 90, seo: 90 }, lab: {}, field: null, opportunities: [], fetchedAt: 0 });
  const run = { mode: 'live', site: site.url, root: 'https://a.example/' } as SiteRun;
  assert.equal(pageOfSite(site, 'https://a.example/pricing/', run), true);
  assert.equal(pageOfSite(site, 'https://b.example/', run), false);
  // www.a.example redirecting to a.example: the check's pages are the site's too.
  const www = { ...site, url: 'https://www.a.example/' };
  assert.equal(pageOfSite(www, 'https://a.example/', { ...run, site: www.url }), true);
  // But only a check of the address the site has now says so: one of another address, or from before runs kept theirs, doesn't.
  assert.equal(pageOfSite(www, 'https://a.example/', run), false);
  assert.equal(pageOfSite(www, 'https://a.example/', { mode: 'live', root: 'https://a.example/' } as SiteRun), false);
  const withData = (speed: PageSpeedResult) => ({ ...getSeoState(), data: { [site.id]: { runs: [run], plan: null, search: null, analytics: null, speed: { mobile: speed }, crux: null, inspections: {} } } });
  assert.equal(speedOf(site, 'mobile', withData(result('https://a.example/')))?.url, 'https://a.example/');
  assert.equal(speedOf(site, 'mobile', withData(result('https://b.example/'))), undefined, "site B's result kept under A");
  // A result kept from before PageSpeed's tested page was read names none: where it ended can't be known, so it isn't used.
  const { testedUrls: _dropped, ...old } = result('https://a.example/');
  assert.equal(speedOf(site, 'mobile', withData(old)), undefined, 'a result with no tested page shown');
  assert.equal(speedOf(site, 'mobile', withData({ ...old, testedUrls: [] })), undefined, 'a result with an empty list shown');
});

test("speed: a page that redirects to another site isn't scored as this one, and PageSpeed's own address names the result", async () => {
  // PageSpeed says which page it tested; a redirect to another site makes it someone else's numbers.
  const body = (tested: string, performance: number) => ({
    id: tested,
    lighthouseResult: { requestedUrl: 'https://a.example/go/', finalUrl: tested, mainDocumentUrl: tested, finalDisplayedUrl: tested, categories: { performance: { score: performance / 100 } }, audits: {} },
  });
  const read = readPageSpeed('https://a.example/go/', 'mobile', body('https://a.example/pricing/', 80));
  assert.equal(read.url, 'https://a.example/go/');
  assert.equal(read.testedUrl, 'https://a.example/pricing/');
  assert.deepEqual(read.testedUrls, ['https://a.example/pricing/']);
  const bare = readPageSpeed('https://a.example/', 'mobile', { lighthouseResult: { categories: {}, audits: {} } });
  assert.equal(bare.testedUrl, 'https://a.example/', 'an answer without the fields is shown under the page asked for');
  assert.deepEqual(bare.testedUrls, [], "but it isn't said to have tested it");

  const site = { id: 'url:speed', url: 'https://a.example/', name: 'A', source: 'address' as const, addedAt: 0 };
  const run = {
    id: 'r', siteId: site.id, startedAt: 0, finishedAt: 0, mode: 'live', root: 'https://a.example/', pages: [], leftOut: 0, findings: [],
    score: { overall: 89, areas: { technical: 89, content: 89, onpage: 89, schema: 89, speed: null, ai: 89, images: 89 } },
  } as unknown as SiteRun;
  const kept: PageSpeedResult = { url: 'https://a.example/', testedUrl: 'https://a.example/', testedUrls: ['https://a.example/'], strategy: 'mobile', scores: { performance: 90, accessibility: 90, bestPractices: 90, seo: 90 }, lab: {}, field: null, opportunities: [], fetchedAt: 1 };
  resetSeoState();
  seedSeoState({ loaded: true, sites: [site], activeId: site.id, data: { [site.id]: { runs: [run], plan: null, search: null, analytics: null, speed: { mobile: kept }, crux: null, inspections: {} } } });
  setSeoGoogle({ apiKey: `AIza${'s'.repeat(35)}` });
  const before = scoreWithSpeed(run, speedOf(site, 'mobile')).overall;
  const win = (globalThis as unknown as { window: { fetch: unknown } }).window;
  const realFetch = win.fetch;
  const asked: string[] = [];
  win.fetch = async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify(body('https://b.example/landing/', 20)), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    assert.equal(await runSpeed(site.id, 'https://a.example/go/', 'mobile'), null);
  } finally {
    win.fetch = realFetch;
  }
  assert.equal(asked.length, 1);
  assert.match(getSeoState().errors.speed?.message ?? '', /^PageSpeed ended up at https:\/\/b\.example\/landing\/, which isn't on this site/);
  assert.equal(speedOf(site, 'mobile'), kept, 'the result before stays');
  assert.equal(scoreWithSpeed(run, speedOf(site, 'mobile')).overall, before, "another site's speed never moves the score");
  // An answer that names no page it tested isn't kept either.
  win.fetch = async () => new Response(JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.2 } }, audits: {} } }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    assert.equal(await runSpeed(site.id, 'https://a.example/go/', 'mobile'), null);
  } finally {
    win.fetch = realFetch;
  }
  assert.match(getSeoState().errors.speed?.message ?? '', /^PageSpeed didn't say which page it tested, so the result isn't kept/);
  assert.equal(speedOf(site, 'mobile'), kept, 'the result before stays');
  // A result kept from before that turns out to be another site's is never shown.
  const away = { ...kept, testedUrls: ['https://a.example/', 'https://b.example/'] };
  seedSeoState({ data: { [site.id]: { ...getSeoState().data[site.id], speed: { mobile: away } } } });
  assert.equal(speedOf(site, 'mobile'), undefined);
  resetSeoState();
});

test('a Website view site that moves keeps its results, and its old check never says where it is now', () => {
  // On GitHub Pages first, in a folder of a shared host, then on its own domain.
  const before = { id: 'web:p', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'website' as const, projectId: 'p', addedAt: 0 };
  const after = { ...before, url: 'https://pebble.example/' };
  const run = { mode: 'live', site: before.url, root: before.url, pages: [], findings: [] } as unknown as SiteRun;
  const speed: PageSpeedResult = { url: before.url, testedUrl: before.url, testedUrls: [before.url], strategy: 'mobile', scores: { performance: 40, accessibility: 90, bestPractices: 90, seo: 90 }, lab: {}, field: null, opportunities: [], fetchedAt: 0 };
  const data = (site: typeof before) => ({ ...getSeoState(), sites: [site], data: { [site.id]: { runs: [run], plan: null, search: null, analytics: null, speed: { mobile: speed }, crux: null, inspections: {} } } });
  assert.equal(speedOf(before, 'mobile', data(before)), speed);
  assert.equal(siteIsWholeHost(before, run), false);
  // Moved: the old address's pages and speed aren't the new site's, and Chrome's numbers are the new host's.
  assert.equal(speedOf(after, 'mobile', data(after)), undefined, 'the old address\'s speed scored for the new one');
  assert.equal(pageOfSite(after, 'https://name.github.io/pebble/support/', run), false);
  assert.equal(siteIsWholeHost(after, run), true);
  assert.equal(siteOrigin(after, run), 'https://pebble.example');

  // The other way: www.pebble.example sent everyone to pebble.example, then the site moved to a folder.
  const own = { ...before, url: 'https://www.pebble.example/' };
  const ownRun = { mode: 'live', site: own.url, root: 'https://pebble.example/', pages: [], findings: [] } as unknown as SiteRun;
  assert.equal(siteOrigin(own, ownRun), 'https://pebble.example');
  assert.equal(pageOfSite(own, 'https://pebble.example/pricing/', ownRun), true);
  const folder = { ...own, url: 'https://pebble.example/app/' };
  assert.equal(siteIsWholeHost(folder, ownRun), false, 'a whole host from the old check');
  assert.equal(pageOfSite(folder, 'https://pebble.example/pricing/', ownRun), false);
  assert.equal(siteOrigin(folder, ownRun), 'https://pebble.example');
});

test("speed: Chrome's site-wide numbers are a whole host's, so a site in a folder gets none", async () => {
  const project = { id: 'url:pebble', url: 'https://name.github.io/pebble/', name: 'Pebble', source: 'address' as const, addedAt: 0 };
  const own = { id: 'url:own', url: 'https://www.pebble.example/', name: 'Pebble', source: 'address' as const, addedAt: 0 };
  assert.equal(siteIsWholeHost(project, null), false);
  assert.equal(siteIsWholeHost(own, null), true);
  assert.equal(siteIsWholeHost({ ...own, url: 'https://pebble.example/app/' }, null), false);
  // www sending everyone to the bare domain: Chrome's numbers are the bare domain's.
  const liveRun = { mode: 'live', site: own.url, root: 'https://pebble.example/' } as SiteRun;
  assert.equal(siteOrigin(own, liveRun), 'https://pebble.example');
  assert.equal(siteIsWholeHost(own, liveRun), true);
  // The site moves to a project page on a shared host: the old check doesn't make it a whole host, or the old one's.
  const moved = { ...own, url: 'https://name.github.io/pebble/' };
  assert.equal(siteIsWholeHost(moved, liveRun), false);
  assert.equal(siteOrigin(moved, liveRun), 'https://name.github.io');
  assert.equal(siteOrigin({ ...own, url: 'https://pebble.app/' }, liveRun), 'https://pebble.app');

  resetSeoState();
  seedSeoState({ loaded: true, sites: [project], activeId: project.id, data: {} });
  setSeoGoogle({ apiKey: `AIza${'s'.repeat(35)}` });
  const win = (globalThis as unknown as { window: { fetch: unknown } }).window;
  const realFetch = win.fetch;
  let asked = 0;
  win.fetch = async () => {
    asked += 1;
    return new Response('{}', { status: 200 });
  };
  try {
    assert.equal(await loadCrux(project.id, 'https://name.github.io'), null);
  } finally {
    win.fetch = realFetch;
  }
  assert.equal(asked, 0, 'nothing asked of Chrome for a shared host');
  assert.equal(getSeoState().errors.crux?.message, CRUX_SHARED_HOST);
  resetSeoState();
});

// --- claude-seo's notes from GitHub --------------------------------------------------------------

const RAW = 'https://raw.githubusercontent.com/dotnetdreamer/claude-seo/';
const CDN = 'https://cdn.jsdelivr.net/gh/dotnetdreamer/claude-seo@';
const TREE = treeUrl('').split('?')[0];

function sha(seed: string): string {
  return seed.padEnd(40, '0').replace(/[^0-9a-f]/g, 'b').slice(0, 40);
}

function fakeRepo(files: Record<string, string>, commit = sha('c1')) {
  const state = { commit, files, history: new Map([[commit, files]]), calls: [] as string[], api: 'ok' as 'ok' | 'limited' | 'offline', rawCorrupt: new Set<string>() };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    state.calls.push(url);
    if (url === BRANCH_HEAD_URL) {
      if (state.api === 'offline') throw new TypeError('Failed to fetch');
      if (state.api === 'limited') return new Response('limited', { status: 429, headers: { 'retry-after': '120' } });
      if (new Headers(init?.headers).get('If-None-Match') === `"${state.commit}"`) return new Response(null, { status: 304 });
      return new Response(state.commit, { status: 200, headers: { etag: `"${state.commit}"` } });
    }
    if (url.startsWith(TREE)) {
      const ref = url.slice(TREE.length).split('?')[0];
      const at = state.history.get(ref) ?? {};
      const tree = await Promise.all(Object.entries(at).map(async ([path, text]) => ({ path, type: 'blob', sha: await gitBlobSha(new TextEncoder().encode(text)), size: text.length })));
      return new Response(JSON.stringify({ tree }), { status: 200 });
    }
    for (const base of [RAW, CDN]) {
      if (!url.startsWith(base)) continue;
      const rest = url.slice(base.length);
      const split = rest.indexOf('/');
      const ref = rest.slice(0, split);
      const path = decodeURIComponent(rest.slice(split + 1));
      const text = state.history.get(ref)?.[path];
      if (text === undefined) return new Response('404', { status: 404 });
      return new Response(base === RAW && state.rawCorrupt.has(path) ? `${text} tampered` : text, { status: 200 });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  let clock = Date.parse('2026-11-19T10:00:00Z');
  return {
    state,
    deps: (store = memoryKnowledgeStore()) => ({ store, fetch: fetchImpl as typeof fetch, now: () => (clock += 1000) }),
    push(next: Record<string, string>, nextCommit: string) {
      state.files = next;
      state.commit = nextCommit;
      state.history.set(nextCommit, next);
    },
  };
}

const NOTES: Record<string, string> = Object.fromEntries(
  wantedPaths(DEFAULT_MANIFEST)
    .filter((path) => path !== MANIFEST_PATH)
    .map((path) => [path, path.endsWith('.json') ? JSON.stringify({ updates: [{ date: '2026-03-05', name: 'March core update', kind: 'core', source: 'https://developers.google.com/x' }] }) : `# ${path}\nNotes for ${path}.\n`]),
);

test('notes: the first look downloads what the app uses, by commit, each checked against its hash', async () => {
  const repo = fakeRepo({ ...NOTES, 'skills/unused/SKILL.md': '# not wanted' });
  const store = memoryKnowledgeStore();
  const outcome = await runKnowledgeSync(repo.deps(store));
  assert.equal(outcome.kind, 'updated');
  assert.equal(store.files.size, Object.keys(NOTES).length);
  assert.ok(!store.files.has('skills/unused/SKILL.md'));
  const downloads = repo.state.calls.filter((url) => url.startsWith(RAW) || url.startsWith(CDN));
  assert.ok(downloads.every((url) => url.includes(repo.state.commit)), 'never the branch');
});

test('notes: a file raw.githubusercontent.com sends wrong comes from jsDelivr, and nothing changed is a 304', async () => {
  const repo = fakeRepo(NOTES);
  repo.state.rawCorrupt.add('skills/seo-geo/SKILL.md');
  const store = memoryKnowledgeStore();
  await runKnowledgeSync(repo.deps(store));
  assert.equal(store.files.get('skills/seo-geo/SKILL.md')?.text, NOTES['skills/seo-geo/SKILL.md']);
  assert.ok(repo.state.calls.some((url) => url.startsWith(CDN) && url.includes('seo-geo')));
  repo.state.calls.length = 0;
  assert.equal((await runKnowledgeSync(repo.deps(store))).kind, 'unchanged');
  assert.deepEqual(repo.state.calls, [BRANCH_HEAD_URL]);
});

test("notes: the fork's manifest picks the files, and a push brings only what changed", async () => {
  const manifest = JSON.stringify({ updates: 'data/google-updates.json', jobs: { ask: { files: ['skills/seo-geo/SKILL.md'], maxCharacters: 9000 } } });
  const repo = fakeRepo({ ...NOTES, [MANIFEST_PATH]: manifest });
  const store = memoryKnowledgeStore();
  await runKnowledgeSync(repo.deps(store));
  assert.ok(store.files.has(MANIFEST_PATH));
  repo.push({ ...NOTES, [MANIFEST_PATH]: manifest, 'skills/seo-geo/SKILL.md': '# changed' }, sha('c2'));
  repo.state.calls.length = 0;
  assert.equal((await runKnowledgeSync(repo.deps(store))).kind, 'updated');
  const downloads = repo.state.calls.filter((url) => url.startsWith(RAW));
  assert.deepEqual(downloads, [`${RAW}${sha('c2')}/skills/seo-geo/SKILL.md`]);
  assert.equal(store.files.get('skills/seo-geo/SKILL.md')?.text, '# changed');
});

test('notes: rate limited or offline keeps the copy and says why', async () => {
  const repo = fakeRepo(NOTES);
  const store = memoryKnowledgeStore();
  await runKnowledgeSync(repo.deps(store));
  repo.state.api = 'limited';
  const limited = await runKnowledgeSync(repo.deps(store), { force: true });
  assert.equal(limited.kind, 'problem');
  assert.ok((await store.readHead())?.waitUntil);
  repo.state.api = 'offline';
  const offline = await runKnowledgeSync(repo.deps(store), { force: true });
  assert.deepEqual(offline.kind === 'problem' && offline.problem.kind, 'offline');
  assert.equal(store.files.size, Object.keys(NOTES).length);
});

test('manifest: read leniently, paths that climb out are dropped, sizes are kept sane', () => {
  assert.equal(readManifest('not json'), null);
  assert.equal(readManifest('{"version":1}'), null);
  const manifest = readManifest(JSON.stringify({ updates: '../secret.json', jobs: { ask: { files: ['skills/a/SKILL.md', '../etc/passwd', '/abs.md', 'skills/b.exe', 'skills/a/SKILL.md'], maxCharacters: 99_000_000 }, unknown: { files: ['x.md'] } } }));
  assert.deepEqual(manifest?.jobs.ask, { files: ['skills/a/SKILL.md'], maxCharacters: 150_000 });
  assert.equal(manifest?.updates, DEFAULT_MANIFEST.updates);
  assert.deepEqual(manifest?.jobs['fix-plan'], DEFAULT_MANIFEST.jobs['fix-plan']);
  assert.equal(isKnowledgePath('skills/seo/references/quality-gates.md'), true);
  assert.equal(isKnowledgePath('skills/../x.md'), false);
});

test("notes for a job: in the manifest's order, the last ones left out when the job's size runs out, and Google's updates", () => {
  const files = new Map(Object.entries({ 'a.md': 'x'.repeat(6000), 'b.md': 'y'.repeat(6000), 'data/google-updates.json': JSON.stringify({ updates: [{ date: '2026-03-05', name: 'Core', kind: 'core', source: 'javascript:alert(1)' }, { date: 'bad', name: 'x' }] }) }).map(([path, text]) => [path, { path, sha: '', size: text.length, text, fetchedAt: 0 }]));
  const state: KnowledgeState = { loaded: true, checking: false, commit: null, checkedAt: null, problem: null, manifest: { updates: 'data/google-updates.json', jobs: { ...DEFAULT_MANIFEST.jobs, ask: { files: ['a.md', 'b.md'], maxCharacters: 8000 } } }, files };
  assert.deepEqual(knowledgeFor('ask', state).map((piece) => piece.path), ['a.md']);
  assert.deepEqual(googleUpdates(state), [{ date: '2026-03-05', name: 'Core', kind: 'core', source: '' }]);
});

// --- what is kept of the AI's answers -----------------------------------------------------

function runWith(ids: string[]): SiteRun {
  return { id: 'run-1', findings: ids.map((id) => ({ id, severity: 'Medium', area: 'onpage', pages: [] })) } as unknown as SiteRun;
}

test('plan: only findings the check made, at most seven steps, no dashes', () => {
  const raw = `Here you go:\n${JSON.stringify({
    summary: 'Your site is close — a few fixes left.',
    steps: [
      { title: 'Write real titles', why: 'People click them.', how: 'Change the title on the home page.', findings: ['title-too-short', 'made-up-id'], effort: 'quick' },
      { title: '', why: 'no title, dropped' },
      ...Array.from({ length: 9 }, (_, index) => ({ title: `Step ${index}`, findings: [], effort: 'huge' })),
    ],
  })}`;
  const plan = readPlan(raw, runWith(['title-too-short']));
  assert.equal(plan.steps.length, 7);
  assert.deepEqual(plan.steps[0].findings, ['title-too-short']);
  assert.equal(plan.steps[1].effort, 'some');
  assert.equal(plan.summary, 'Your site is close, a few fixes left.');
  assert.throws(() => readPlan('no json at all', runWith(['x'])), /couldn't be read/);
});

test('Google digest: the numbers the AI gets, in plain lines', () => {
  const digest = googleDigest({ speed: { url: 'https://a.example/', strategy: 'mobile', scores: { performance: 71, accessibility: 98, bestPractices: 100, seo: 92 }, lab: {}, field: null, opportunities: [{ id: 'x', title: 'Reduce unused JavaScript', saving: '' }], fetchedAt: 0 } });
  assert.match(digest, /performance 71/);
  assert.match(digest, /Reduce unused JavaScript/);
});

// --- Google's answers ---------------------------------------------------------------------

test("Search Console: the domain property first, else the longest prefix, never a lookalike domain", () => {
  const sites = [
    { siteUrl: 'https://name.github.io/', permissionLevel: 'siteFullUser' },
    { siteUrl: 'https://name.github.io/pebble/', permissionLevel: 'siteFullUser' },
    { siteUrl: 'sc-domain:pebble.example', permissionLevel: 'siteOwner' },
  ];
  assert.equal(propertyFor('https://name.github.io/pebble/support/', sites), 'https://name.github.io/pebble/');
  assert.equal(propertyFor('https://www.pebble.example/', sites), 'sc-domain:pebble.example');
  assert.equal(propertyFor('https://notpebble.example/', sites), null);
});

test('Search Console: searches on the edge of page one, and the report window', () => {
  const rows = [
    { keys: ['notes app'], clicks: 1, impressions: 300, ctr: 0, position: 11.2 },
    { keys: ['pebble'], clicks: 50, impressions: 80, ctr: 0.6, position: 1.1 },
    { keys: ['rare'], clicks: 0, impressions: 3, ctr: 0, position: 12 },
  ];
  assert.deepEqual(closeToPageOne(rows).map((row) => row.keys[0]), ['notes app']);
  assert.deepEqual(reportWindow(new Date('2026-11-19T08:00:00Z')), { start: '2026-10-22', end: '2026-11-18', previousStart: '2026-09-24', previousEnd: '2026-10-21' });
});

test("PageSpeed: scores out of 100, the page's own visitors before the site's, CLS from Google's x100", () => {
  const result = readPageSpeed('https://a.example/', 'mobile', {
    lighthouseResult: {
      categories: { performance: { score: 0.71 }, seo: { score: 0.92 }, accessibility: { score: null } },
      audits: {
        'largest-contentful-paint': { numericValue: 3100, displayValue: '3.1 s' },
        'unused-javascript': { title: 'Reduce unused JavaScript', score: 0.4, details: { type: 'opportunity', overallSavingsMs: 900 }, displayValue: 'Potential savings of 120 KiB' },
        'render-blocking-resources': { title: 'Eliminate render-blocking resources', score: 0.95, details: { type: 'opportunity', overallSavingsMs: 2000 } },
      },
    },
    loadingExperience: { origin_fallback: true, metrics: {} },
    originLoadingExperience: { metrics: { CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 }, LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 } } },
  });
  assert.deepEqual(result.scores, { performance: 71, accessibility: null, bestPractices: null, seo: 92 });
  assert.deepEqual(result.field, { scope: 'site', metrics: { cls: 0.05, lcp: 2100 } });
  assert.deepEqual(result.opportunities.map((entry) => entry.id), ['unused-javascript']);
  assert.equal(rate('lcp', 2500), 'good');
  assert.equal(rate('inp', 350), 'okay');
  assert.equal(rate('cls', 0.3), 'poor');
});

test('keys: a service account file and an API key are told apart from anything else', () => {
  assert.ok('problem' in readKeyFile('{"type":"authorized_user"}'));
  assert.ok('problem' in readKeyFile('not json'));
  const read = readKeyFile(JSON.stringify({ type: 'service_account', client_email: 'osg-seo@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n' }));
  assert.equal('email' in read && read.email, 'osg-seo@p.iam.gserviceaccount.com');
  assert.equal(isGoogleApiKey(`AIza${'a'.repeat(35)}`), true);
  assert.equal(isGoogleApiKey(`AIza${'a'.repeat(34)}`), false);
  assert.equal(valid.googleApiKey(`AIza${'B'.repeat(35)}`), true);
});

// --- Ask AI's Google setup for SEO ------------------------------------------------------------

test('assistant: Search Console and Analytics open, an Add button asks first, the new actions read', () => {
  assert.equal(mayOpen('https://search.google.com/search-console/users'), true);
  assert.equal(mayOpen('https://analytics.google.com/analytics/web/'), true);
  assert.equal(mayOpen('https://search.google.com.evil.example/'), false);
  assert.equal(judgeClick('Add user', false, {}).kind, 'ask');
  assert.deepEqual(readAction({ do: 'use_growth_key_for_seo' }), { do: 'use_growth_key_for_seo' });
  assert.deepEqual(readAction({ do: 'save_seo_api_key', value: ' AIzaXYZ ' }), { do: 'save_seo_api_key', value: 'AIzaXYZ' });
  assert.equal(readAction({ do: 'save_seo_api_key' }), null);
});

test("assistant: in the SEO job a caught key file is SEO's own, and the Google Play key is never touched", () => {
  const saved: string[] = [];
  const play: unknown[] = [];
  const env = {
    reason: null,
    facts: () => ({ appleKey: null, appleApps: { names: [], error: null, loading: false }, vendorNumber: null, playKey: { email: 'play@p.iam.gserviceaccount.com', packageName: 'com.example.app' }, reportsUri: null, stores: null, lastRefresh: null, refreshing: false }),
    numbers: () => null,
    ask: async () => '{"say":"Hi","actions":[],"next":"user"}',
    saveAppleKey() {},
    saveVendorNumber() {},
    savePlayKey: (value: unknown) => void play.push(value),
    setPlayPackage() {},
    saveReportsUri() {},
    setStores() {},
    refresh: async () => ({ appName: '', lines: [] }),
  } as unknown as AssistantEnv;
  setAssistantBrowser({ state: () => ({ open: false }), driver: {}, open: async () => {}, go: async () => {}, close: async () => {}, settle: async () => {} } as never);
  configureAssistant(env);
  configureSeoSetup({ facts: () => ({ siteUrl: 'https://a.example/', key: null, growthKey: null, apiKey: false }), saveKey: (json) => void saved.push(json), useGrowthKey() {}, saveApiKey() {} });
  startSeoSetup();
  assert.equal(assistantGoal(), 'seo');
  const key = JSON.stringify({ type: 'service_account', client_email: 'osg-seo@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n' });
  // As growth_browser.rs hands a download over: its start, then the file with the same number.
  noteDownloadStarted(123);
  addKeyFile({ kind: 'play-key', fileName: 'p-123.json', content: key, downloadId: 123 });
  assert.deepEqual(saved, [key]);
  assert.deepEqual(play, []);
  assert.match(seoStatusText({ siteUrl: null, key: null, growthKey: { email: 'play@p.iam.gserviceaccount.com', projectId: 'p' }, apiKey: false }), /use_growth_key_for_seo uses it/);
});
