// Competitors on Google Play: reading the app's details from its public page
// (the blocks of the real US pages of Ludo King and Minecraft, as Google sent
// them on 2026-11-14), the language each country is read in, what counts as
// the same Google Play picture, and what a check records as a change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PlayPageUnreadable, fetchPlayStorefront, playLanguage, playPageUrl, readPlayPage } from '@/lib/growth/playPage';
import { artworkAt, assetKey, diffStorefront, isRivalAppId, isWideShot, ownAppId, type RivalStorefront } from '@/lib/growth/rivals';

const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), 'tests', 'unit', 'fixtures', 'googlePlay', `${name}.html`), 'utf8');
const LUDO_KING = fixture('ludo-king-us');
const MINECRAFT = fixture('minecraft-us');

const FIRST_SHOT = 'https://play-lh.googleusercontent.com/ODYAnRdNqJduH8ZAckodyUM6nFnainP-XIrEpj00WtxC4GRLVUrcxEIHSBauPXmsVxNIsvzHk9jRMvzzoSuffw';

function king(overrides: Partial<RivalStorefront> = {}): RivalStorefront {
  return { ...readPlayPage(LUDO_KING, 'com.ludo.king', 'US', 1_000), ...overrides };
}

/** The page with the app's array changed, as a change to Google's pages would. */
function withApp(html: string, packageName: string, change: (app: unknown[]) => void): string {
  const block = /AF_initDataCallback\(\{key: 'ds:\d+'[\s\S]*?data:([\s\S]*?), sideChannel: \{\}\}\);/g;
  for (const match of html.matchAll(block)) {
    let data: unknown[];
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const app = (data?.[1] as unknown[] | undefined)?.[2] as unknown[] | undefined;
    if (!Array.isArray(app) || (app[77] as unknown[] | undefined)?.[0] !== packageName) continue;
    change(app);
    return html.replace(match[1], JSON.stringify(data));
  }
  throw new Error(`No block for ${packageName}`);
}

test('a Google Play page becomes what Competitors keeps for that country', () => {
  const kept = readPlayPage(LUDO_KING, 'com.ludo.king', 'US', 42);
  assert.equal(kept.territory, 'US');
  assert.equal(kept.name, 'Ludo King®');
  assert.equal(kept.developer, 'Gametion');
  assert.equal(kept.genre, 'Board');
  assert.equal(kept.rating, 4.132999);
  assert.equal(kept.ratingCount, 10338964);
  assert.equal(kept.price, 0);
  assert.equal(kept.priceLabel, 'Free', 'Google prints no price for a free app');
  assert.equal(kept.currency, 'USD');
  assert.equal(kept.version, '', 'Ludo King\'s page shows no version number');
  assert.equal(kept.releasedAt, '2026-11-06T06:32:44.000Z');
  assert.equal(kept.releaseNotes, '- New Mode Added\n- Bug Fixes');
  assert.match(kept.iconUrl ?? '', /^https:\/\/play-lh\.googleusercontent\.com\/qSN0Eb6m/);
  assert.equal(kept.seenAt, 42);
  assert.deepEqual(kept.ipadScreenshots, []);
  assert.equal(kept.storeUrl, 'https://play.google.com/store/apps/details?id=com.ludo.king&hl=en-US&gl=US');
});

test('the screenshots of every device come as one list, and a set uploaded for several devices is kept once', () => {
  const { screenshots } = king();
  // The page lists 32 screenshots: the same eight for the phone and both tablet sizes, then six more.
  assert.equal(screenshots.length, 14);
  assert.equal(new Set(screenshots.map(assetKey)).size, 14);
  assert.equal(screenshots[0], `${FIRST_SHOT}=w1920-h1080`, 'the picture size rides in the address');
  assert.equal(isWideShot(screenshots[0]), true);
  assert.equal(isWideShot(screenshots[13]), false);
});

test('a paid app has its price as Google prints it, and "What\'s new" comes as plain text', () => {
  const kept = readPlayPage(MINECRAFT, 'com.mojang.minecraftpe', 'US', 1);
  assert.equal(kept.name, 'Minecraft: Dream it, Build it!');
  assert.equal(kept.price, 6.99);
  assert.equal(kept.priceLabel, '$6.99');
  assert.equal(kept.currency, 'USD');
  assert.equal(kept.screenshots.length, 8);
  assert.ok(kept.screenshots.every((url) => url.endsWith('=w1242-h2208')));
  assert.equal(kept.releaseNotes, "What's new in 26.62: Various bug fixes!");
  assert.equal(kept.version, '1.26.62.1', 'some Google Play pages show the version');
});

test('a page without the app where Growth reads it is unreadable, not an app with nothing', () => {
  // Another app's page, a page with no blocks (a consent page, a captcha), and a block whose fields moved.
  assert.throws(() => readPlayPage(LUDO_KING, 'com.mojang.minecraftpe', 'US', 1), PlayPageUnreadable);
  assert.throws(() => readPlayPage('<html><body>Before you continue to Google</body></html>', 'com.ludo.king', 'US', 1), PlayPageUnreadable);
  const moved = LUDO_KING.replace('[["Ludo King®"]', '[null');
  assert.throws(() => readPlayPage(moved, 'com.ludo.king', 'US', 1), PlayPageUnreadable);
  // The screenshots or the icon gone from their places: unreadable, not an app with none, which would keep the old set with no warning.
  for (const change of [
    (app: unknown[]) => (app[78] = [null]),
    (app: unknown[]) => (app[78] = [[]]),
    (app: unknown[]) => (app[78] = null),
    (app: unknown[]) => (app[78] = [[[null, 2, [1080, 1920], null]]]),
    (app: unknown[]) => (app[95] = null),
  ]) {
    assert.throws(() => readPlayPage(withApp(LUDO_KING, 'com.ludo.king', change), 'com.ludo.king', 'US', 1), PlayPageUnreadable);
  }
  // The helper changes only what it is told to.
  assert.equal(readPlayPage(withApp(LUDO_KING, 'com.ludo.king', () => undefined), 'com.ludo.king', 'US', 1).screenshots.length, 14);
});

test('one screenshot entry without its address or size makes the page unreadable, not a set with a screenshot taken out', () => {
  const was = readPlayPage(MINECRAFT, 'com.mojang.minecraftpe', 'US', 1);
  assert.equal(was.screenshots.length, 8);
  const entry = (change: (shot: unknown[]) => void) => (app: unknown[]) => change(((app[78] as unknown[][])[0] as unknown[][])[3]);
  for (const change of [
    entry((shot) => (shot[3] = null)),
    entry((shot) => ((shot[3] as unknown[])[2] = 'not an address')),
    entry((shot) => (shot[2] = null)),
    entry((shot) => ((shot[2] as unknown[])[1] = '2208')),
    (app: unknown[]) => ((app[78] as unknown[][])[0][3] = null),
  ]) {
    assert.throws(() => readPlayPage(withApp(MINECRAFT, 'com.mojang.minecraftpe', change), 'com.mojang.minecraftpe', 'US', 1), PlayPageUnreadable);
  }
});

test('each country is read in the language most of its shoppers use', () => {
  assert.equal(playLanguage('US'), 'en-US');
  assert.equal(playLanguage('de'), 'de-DE');
  assert.equal(playLanguage('BR'), 'pt-BR');
  assert.equal(playLanguage('JP'), 'ja-JP');
  assert.equal(playLanguage('TW'), 'zh-TW');
  assert.equal(playLanguage('IN'), 'en-IN', 'phones in India mostly run in English');
  assert.equal(playLanguage('PH'), 'en-PH');
  assert.equal(playPageUrl('com.ludo.king', 'de'), 'https://play.google.com/store/apps/details?id=com.ludo.king&hl=de-DE&gl=DE');
});

test('one Google Play picture is one picture at any size, and is shown from a small WebP copy', () => {
  assert.equal(assetKey(`${FIRST_SHOT}=w526-h296`), assetKey(`${FIRST_SHOT}=s600-rw`));
  assert.equal(assetKey(FIRST_SHOT), assetKey(`${FIRST_SHOT}=w1920-h1080`));
  assert.notEqual(assetKey(FIRST_SHOT), assetKey('https://play-lh.googleusercontent.com/another'));
  assert.equal(artworkAt(`${FIRST_SHOT}=w1920-h1080`, 600), `${FIRST_SHOT}=s600-rw`);
  assert.equal(artworkAt(FIRST_SHOT, 128), `${FIRST_SHOT}=s128-rw`);
  // Images from the Google Play key's own API are left as they came.
  assert.equal(artworkAt('https://lh3.googleusercontent.com/abc', 600), 'https://lh3.googleusercontent.com/abc');
});

test('a Google Play app is named play: and its package, and can be the user\'s own', () => {
  assert.equal(isRivalAppId('play:com.ludo.king'), true);
  assert.equal(isRivalAppId('993090598'), true);
  assert.equal(isRivalAppId('play:'), false);
  assert.equal(isRivalAppId('play:nodot'), false);
  assert.equal(isRivalAppId('sample-app'), false);
  assert.equal(ownAppId({ owner: 'play:com.example.app' }), 'play:com.example.app');
  assert.equal(ownAppId({ owner: '', yourApp: { id: 'play:com.example.app', name: 'Example', developer: '', iconUrl: null, addedAt: 1 } }), 'play:com.example.app');
});

test('on Google Play the same pictures at another size are no change, and new ones are', () => {
  const was = king();
  const resized = king({ screenshots: was.screenshots.map((url) => url.replace(/=w\d+-h\d+$/, '=w526-h296')) });
  assert.deepEqual(diffStorefront(was, resized).changes, []);
  const swapped = king({ screenshots: [was.screenshots[1], 'https://play-lh.googleusercontent.com/new-one=w1080-h1920', ...was.screenshots.slice(2)] });
  const { changes } = diffStorefront(was, swapped);
  assert.deepEqual(
    changes.map((change) => change.kind),
    ['screenshots']
  );
});

test('a later update day is an update, with its "What\'s new"; the same day is nothing', () => {
  const was = king();
  assert.deepEqual(diffStorefront(was, king()).changes, []);
  const updated = king({ releasedAt: '2026-11-13T08:00:00.000Z', releaseNotes: 'Winter board' });
  const { changes } = diffStorefront(was, updated);
  assert.deepEqual(changes, [{ territory: 'US', kind: 'update', before: ['2026-11-06T06:32:44.000Z'], after: ['2026-11-13T08:00:00.000Z'], notes: 'Winter board' }]);
  // An older day is an old copy, and is skipped.
  assert.equal(diffStorefront(updated, was).stale, true);
});

test('a version on a Google Play page: a new one is a new version, and one that shows up or goes away is not', () => {
  const was = king({ version: '3.9.0' });
  const next = king({ version: '3.9.1', releasedAt: '2026-11-13T08:00:00.000Z', releaseNotes: 'Winter board' });
  assert.deepEqual(diffStorefront(was, next).changes, [{ territory: 'US', kind: 'version', before: ['3.9.0'], after: ['3.9.1'], notes: 'Winter board' }]);
  // Kept before Growth read versions, or a page that stops showing one: the same day is nothing, a later day is an update.
  assert.deepEqual(diffStorefront(king(), king({ version: '3.9.0' })).changes, []);
  assert.deepEqual(diffStorefront(was, king()).changes, []);
  assert.deepEqual(
    diffStorefront(king(), king({ version: '3.9.0', releasedAt: '2026-11-13T08:00:00.000Z' })).changes.map((change) => change.kind),
    ['update']
  );
  // A later update day with the same version is an update too.
  assert.deepEqual(
    diffStorefront(was, king({ version: '3.9.0', releasedAt: '2026-11-13T08:00:00.000Z' })).changes.map((change) => change.kind),
    ['update']
  );
});

test('a page is asked for in the country and its language, and a missing app is a 404', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const pages: Array<{ status: number; body: string }> = [
    { status: 200, body: LUDO_KING },
    { status: 404, body: 'Not found' },
    { status: 500, body: '' },
    { status: 200, body: '<html></html>' },
  ];
  const root = globalThis as unknown as { window?: unknown };
  root.window = {
    fetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const page = pages.shift()!;
      return new Response(page.body, { status: page.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  };
  try {
    const found = await fetchPlayStorefront('com.ludo.king', 'US', { now: 7 });
    assert.equal(found?.name, 'Ludo King®');
    assert.equal(found?.seenAt, 7);
    assert.equal(calls[0].url, 'https://play.google.com/store/apps/details?id=com.ludo.king&hl=en-US&gl=US');
    assert.equal(calls[0].init?.cache, 'no-store');
    assert.equal(await fetchPlayStorefront('com.example.gone', 'US'), null);
    await assert.rejects(() => fetchPlayStorefront('com.ludo.king', 'US'), /HTTP 500/);
    await assert.rejects(() => fetchPlayStorefront('com.ludo.king', 'US'), PlayPageUnreadable);
  } finally {
    delete root.window;
  }
});
