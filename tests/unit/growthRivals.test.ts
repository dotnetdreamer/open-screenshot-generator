// Competitors in Growth: reading Apple's lookup answer (a row as it came back
// for Ludo King in the US on 2026-11-13, trimmed to three screenshots), what
// counts as the same screenshot, what a check records as a change, and the
// requests the lookup and the search send.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  artworkAt,
  assetKey,
  describeSetChange,
  diffStorefront,
  findRivals,
  groupChanges,
  isScreenshotChange,
  isStaleAnswer,
  lookupStorefronts,
  ownAppId,
  readStorefront,
  sameSet,
  startingCountries,
  type RivalStorefront,
} from '@/lib/growth/rivals';
import { RATING_PACE_MS, lookupTurn } from '@/lib/growth/itunes';

const SHOT = (path: string, host = 'is1-ssl', size = '392x696bb.jpg') => `https://${host}.mzstatic.com/image/thumb/PurpleSource221/v4/${path}/${size}`;

const LUDO_KING_US = {
  kind: 'software',
  wrapperType: 'software',
  trackId: 993090598,
  trackName: 'Ludo King',
  artistName: 'GAMETION GLOBAL TECHNOLOGIES PTE LIMITED',
  sellerName: 'GAMETION GLOBAL TECHNOLOGIES PTE LIMITED',
  primaryGenreName: 'Games',
  version: '10.7.424',
  currentVersionReleaseDate: '2026-11-04T04:31:17Z',
  releaseNotes: '- New Game Mode Added\n- Bug Fixes',
  averageUserRating: 3.73099,
  userRatingCount: 19081,
  price: 0.0,
  formattedPrice: 'Free',
  currency: 'USD',
  artworkUrl512:
    'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/a6/03/6c/a6036c04-dc4e-2758-d835-32e7e2523a1e/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg',
  screenshotUrls: [
    'https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/74/93/23/749323f5-e431-ef2c-4112-6aed64196017/91b3084c-b634-4371-9340-f878a6c812c0_5.jpg/392x696bb.jpg',
    'https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/7b/c4/0a/7bc40a3e-79b4-3f60-3d77-163406e5eb96/Adda-1242x2208.jpg/392x696bb.jpg',
    'https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/31/6c/26/316c26d3-3700-0361-592a-f6df2b5c1430/899e048a-77a8-43c1-95c1-59dd854efa78_2.jpg/392x696bb.jpg',
  ],
  ipadScreenshotUrls: [
    'https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/0f/9e/82/0f9e82d2-0dab-d8fa-6ddc-7bae8e396a6f/Adda-2048x2732.jpg/576x768bb.jpg',
    'https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/d4/21/aa/d421aaa1-71da-95c7-9dd6-5db0dbcbcd2e/da89c4f6-b472-4b49-bf27-45c178a554b5_5.jpg/576x768bb.jpg',
  ],
  trackViewUrl: 'https://apps.apple.com/us/app/ludo-king/id993090598?uo=4',
};

function storefront(overrides: Partial<RivalStorefront> = {}): RivalStorefront {
  return { ...readStorefront(LUDO_KING_US, 'US', 1_000)!, ...overrides };
}

test('a lookup row becomes what Competitors keeps for that country', () => {
  const kept = readStorefront(LUDO_KING_US, 'US', 1_000);
  assert.ok(kept);
  assert.equal(kept.name, 'Ludo King');
  assert.equal(kept.developer, 'GAMETION GLOBAL TECHNOLOGIES PTE LIMITED');
  assert.equal(kept.version, '10.7.424');
  assert.equal(kept.releasedAt, '2026-11-04T04:31:17Z');
  assert.equal(kept.rating, 3.73099);
  assert.equal(kept.ratingCount, 19081);
  assert.equal(kept.price, 0);
  assert.equal(kept.priceLabel, 'Free');
  assert.equal(kept.currency, 'USD');
  assert.equal(kept.screenshots.length, 3);
  assert.equal(kept.ipadScreenshots.length, 2);
  assert.equal(kept.territory, 'US');
  assert.equal(kept.seenAt, 1_000);
  // A row that is not an app (an artist, say) is not one.
  assert.equal(readStorefront({ wrapperType: 'artist', kind: 'artist', trackId: 1, trackName: 'X' }, 'US', 1), null);
  // A paid app's label comes from the store, in that country's words.
  assert.equal(readStorefront({ ...LUDO_KING_US, price: 2.99, formattedPrice: '2,99 €' }, 'DE', 1)?.priceLabel, '2,99 €');
});

test('one picture is one picture on any of Apple\'s image hosts and at any size', () => {
  const path = '74/93/23/749323f5-e431-ef2c-4112-6aed64196017/shot_5.jpg';
  assert.equal(assetKey(SHOT(path)), assetKey(SHOT(path, 'is5-ssl')));
  assert.equal(assetKey(SHOT(path)), assetKey(SHOT(path, 'is1-ssl', '600x600bb.webp')));
  assert.notEqual(assetKey(SHOT(path)), assetKey(SHOT('74/93/23/other/shot_5.jpg')));
  // Another server's address keeps its host, so two sites' pictures never match.
  assert.notEqual(assetKey('https://a.example.com/x/shot.png'), assetKey('https://b.example.com/x/shot.png'));

  const set = [SHOT('a/1.png'), SHOT('b/2.png')];
  assert.ok(sameSet(set, [SHOT('a/1.png', 'is3-ssl'), SHOT('b/2.png', 'is4-ssl', '230x0w.webp')]));
  assert.ok(!sameSet(set, [SHOT('b/2.png'), SHOT('a/1.png')]));
  assert.deepEqual(describeSetChange(set, [SHOT('b/2.png'), SHOT('a/1.png')]), { added: 0, removed: 0, reordered: true });
  assert.deepEqual(describeSetChange(set, [SHOT('a/1.png'), SHOT('c/3.png'), SHOT('d/4.png')]), { added: 2, removed: 1, reordered: false });
});

test('screenshots are shown from a small WebP copy, which only Apple\'s image server makes', () => {
  assert.equal(
    artworkAt('https://is2-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/x/shot.jpg/392x696bb.jpg', 600),
    'https://is2-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/x/shot.jpg/600x600bb.webp'
  );
  assert.equal(artworkAt('https://lh3.googleusercontent.com/abc=w526-h296', 600), 'https://lh3.googleusercontent.com/abc=w526-h296');
});

test('the first answer for a country sets what later checks compare with, and records nothing', () => {
  const result = diffStorefront(undefined, storefront());
  assert.deepEqual(result.changes, []);
  assert.equal(result.kept.name, 'Ludo King');
});

test('the same screenshots from another image host are no change', () => {
  const previous = storefront();
  const next = storefront({ screenshots: previous.screenshots.map((url) => url.replace('is1-ssl', 'is4-ssl')), seenAt: 2_000 });
  const result = diffStorefront(previous, next);
  assert.deepEqual(result.changes, []);
  assert.equal(result.kept.seenAt, 2_000);
});

test('new screenshots with a new version are two changes, with the release notes', () => {
  const previous = storefront();
  const next = storefront({
    version: '10.8.0',
    releasedAt: '2026-11-12T08:00:00Z',
    releaseNotes: 'Winter board',
    screenshots: [SHOT('new/1.png'), ...previous.screenshots.slice(1)],
  });
  const { changes } = diffStorefront(previous, next);
  assert.deepEqual(
    changes.map((change) => change.kind),
    ['screenshots', 'version']
  );
  assert.deepEqual(changes[0].before, previous.screenshots);
  assert.deepEqual(changes[0].after, next.screenshots);
  assert.deepEqual(changes[1], { territory: 'US', kind: 'version', before: ['10.7.424'], after: ['10.8.0'], notes: 'Winter board' });
  assert.ok(isScreenshotChange(changes[0]));
  assert.ok(!isScreenshotChange(changes[1]));
});

test('a stale copy from Apple\'s CDN, about an older version, is skipped', () => {
  const previous = storefront({ version: '10.8.0', releasedAt: '2026-11-12T08:00:00Z', screenshots: [SHOT('new/1.png')] });
  // What the CDN still held from before the release.
  const stale = storefront();
  assert.ok(isStaleAnswer(previous, stale));
  const result = diffStorefront(previous, stale);
  assert.equal(result.stale, true);
  assert.deepEqual(result.changes, []);
  assert.equal(result.kept, previous);
});

test('an answer with no screenshots on the same version keeps the screenshots it had', () => {
  const previous = storefront();
  const result = diffStorefront(previous, storefront({ screenshots: [] }));
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.kept.screenshots, previous.screenshots);
});

test('a new price counts once a second check shows it too', () => {
  const free = storefront();
  const paid = { price: 1.99, priceLabel: '$1.99' };
  const first = diffStorefront(free, storefront(paid));
  assert.deepEqual(first.changes, []);
  assert.equal(first.kept.priceLabel, 'Free', 'the old price stays on show');
  assert.deepEqual(first.kept.pendingPrice, { price: 1.99, priceLabel: '$1.99', currency: 'USD' });

  const second = diffStorefront(first.kept, storefront(paid));
  assert.deepEqual(second.changes, [{ territory: 'US', kind: 'price', before: ['Free'], after: ['$1.99'] }]);
  assert.equal(second.kept.priceLabel, '$1.99');
  assert.equal(second.kept.pendingPrice, undefined);

  // Back to free before a second check agreed: nothing changed after all.
  const back = diffStorefront(first.kept, storefront());
  assert.deepEqual(back.changes, []);
  assert.equal(back.kept.pendingPrice, undefined);
});

test('a new name and a new icon are changes of their own', () => {
  const previous = storefront();
  const { changes } = diffStorefront(
    previous,
    storefront({ name: 'Ludo King: Dice Game', iconUrl: previous.iconUrl!.replace('a6036c04', 'b7147d15') })
  );
  assert.deepEqual(
    changes.map((change) => [change.kind, change.after[0]]),
    [
      ['name', 'Ludo King: Dice Game'],
      ['icon', previous.iconUrl!.replace('a6036c04', 'b7147d15')],
    ]
  );
});

test('a change seen in several countries is one change that names them all', () => {
  const before = [SHOT('a/1.png')];
  const after = [SHOT('b/2.png')];
  const grouped = groupChanges(
    '993090598',
    [
      { territory: 'US', kind: 'screenshots', before, after },
      // The same pictures, served from another host in Germany.
      { territory: 'DE', kind: 'screenshots', before: [SHOT('a/1.png', 'is2-ssl')], after: [SHOT('b/2.png', 'is3-ssl')] },
      { territory: 'JP', kind: 'screenshots', before, after: [SHOT('c/3.png')] },
      { territory: 'US', kind: 'version', before: ['1.0'], after: ['1.1'] },
    ],
    5_000
  );
  assert.equal(grouped.length, 3);
  assert.deepEqual(grouped[0].territories, ['US', 'DE']);
  assert.deepEqual(grouped[1].territories, ['JP']);
  assert.equal(grouped[2].kind, 'version');
  assert.equal(new Set(grouped.map((change) => change.id)).size, 3, 'each change has its own id');
  // The same check found again gives the same ids, so a change marked as seen stays seen.
  assert.deepEqual(
    groupChanges('993090598', [{ territory: 'US', kind: 'screenshots', before, after }], 5_000).map((change) => change.id),
    [grouped[0].id]
  );
});

test('a new list starts with the app\'s busiest countries, then the usual ones', () => {
  assert.deepEqual(startingCountries(['IN', 'PK', 'IN', 'XX', null]), ['IN', 'PK', 'US', 'GB', 'DE', 'FR', 'JP', 'BR']);
  assert.deepEqual(startingCountries([]), ['US', 'GB', 'DE', 'FR', 'JP', 'BR', 'IN', 'CA']);
});

test('the user\'s own app: the Growth app, or the one named for a list without one', () => {
  assert.equal(ownAppId({ owner: '6797975644' }), '6797975644');
  assert.equal(ownAppId({ owner: 'play:com.example.app' }), 'play:com.example.app');
  assert.equal(ownAppId({ owner: 'sample-app' }), null, 'an id a check cannot read');
  assert.equal(ownAppId({ owner: '', yourApp: { id: '6797975644', name: 'Ludo Wala', developer: '', iconUrl: null, addedAt: 1 } }), '6797975644');
  assert.equal(ownAppId({ owner: '' }), null);
});

/** window.fetch answering like Apple, with every request kept. */
function fakeApple(answer: (url: URL) => { status?: number; body: unknown }) {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const root = globalThis as unknown as { window?: unknown };
  root.window = {
    fetch: async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      calls.push({ url: parsed, init });
      const { status = 200, body } = answer(parsed);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'text/javascript; charset=utf-8' } });
    },
  };
  return { calls, restore: () => delete root.window };
}

test('one lookup asks for every app in one country, and an app not sold there is simply missing', async () => {
  const apple = fakeApple(() => ({ body: { resultCount: 1, results: [LUDO_KING_US] } }));
  try {
    const found = await lookupStorefronts(['993090598', '1198143062'], 'DE', { now: 42 });
    assert.equal(apple.calls.length, 1);
    const [{ url, init }] = apple.calls;
    assert.equal(`${url.origin}${url.pathname}`, 'https://itunes.apple.com/lookup');
    assert.equal(url.searchParams.get('id'), '993090598,1198143062');
    assert.equal(url.searchParams.get('country'), 'de');
    assert.equal(url.searchParams.get('entity'), 'software');
    assert.equal(init?.cache, 'no-store', 'the browser must not answer from its own copy');
    assert.deepEqual(Array.from(found.keys()), ['993090598']);
    assert.equal(found.get('993090598')?.territory, 'DE');
    assert.equal(found.get('993090598')?.seenAt, 42);
  } finally {
    apple.restore();
  }
});

test('a refused lookup is an error, for the check to count', async () => {
  const apple = fakeApple(() => ({ status: 403, body: {} }));
  try {
    await assert.rejects(() => lookupStorefronts(['1'], 'US'), /HTTP 403/);
  } finally {
    apple.restore();
  }
});

test('the search finds apps by name, a link finds its app in the link\'s country, and a Google Play link says what to do', async () => {
  const apple = fakeApple((url) =>
    url.pathname === '/search' ? { body: { resultCount: 1, results: [LUDO_KING_US] } } : { body: { resultCount: 1, results: [LUDO_KING_US] } }
  );
  try {
    const byName = await findRivals('ludo', { territory: 'IN' });
    assert.equal(byName.candidates[0].id, '993090598');
    assert.equal(byName.candidates[0].storefront.territory, 'IN', 'the answer is kept as the searched country');
    let { url } = apple.calls[apple.calls.length - 1];
    assert.equal(url.pathname, '/search');
    assert.equal(url.searchParams.get('term'), 'ludo');
    assert.equal(url.searchParams.get('country'), 'in');

    const byLink = await findRivals('https://apps.apple.com/gb/app/ludo-king/id993090598', { territory: 'IN' });
    ({ url } = apple.calls[apple.calls.length - 1]);
    assert.equal(url.pathname, '/lookup');
    assert.equal(url.searchParams.get('country'), 'gb');
    assert.equal(byLink.candidates[0].storefront.territory, 'GB');

    const byId = await findRivals('id993090598', { territory: 'IN' });
    ({ url } = apple.calls[apple.calls.length - 1]);
    assert.equal(url.searchParams.get('country'), 'in', 'a bare id is looked up in the country on show');
    assert.equal(byId.candidates.length, 1);

    // Outside the desktop app a Google Play page cannot be read (no CORS header).
    const calls = apple.calls.length;
    const play = await findRivals('https://play.google.com/store/apps/details?id=com.ludo.king', { territory: 'IN' });
    assert.equal(play.candidates.length, 0);
    assert.match(play.notice ?? '', /desktop app/);
    assert.equal(apple.calls.length, calls, 'nothing is asked for a Google Play link');
  } finally {
    apple.restore();
  }
});

// Last in the file: the turns are kept for the whole window, and the clock
// here runs an hour ahead of the real one, past every turn the lookups above
// took, so the first lookup goes at once.
test('lookups from this window take turns, 20 a minute, whoever asks', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() + 3_600_000 });
  try {
    const order: string[] = [];
    const first = lookupTurn().then(() => order.push('first'));
    const second = lookupTurn().then(() => order.push('second'));
    await Promise.resolve();
    await first;
    assert.deepEqual(order, ['first'], 'the first goes at once');
    mock.timers.tick(RATING_PACE_MS - 1);
    await Promise.resolve();
    assert.deepEqual(order, ['first'], 'the second waits its turn');
    mock.timers.tick(1);
    await second;
    assert.deepEqual(order, ['first', 'second']);
  } finally {
    mock.timers.reset();
  }
});
