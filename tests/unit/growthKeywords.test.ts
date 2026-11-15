// Keywords in Growth: reading Apple's search answer (the first four apps for
// "ludo" in the US as the search answered on 2026-11-15, trimmed to the fields
// Growth reads), the request the search sends, typing keywords, how a rank
// moves from day to day, whether a keyword is on the store page, the Store
// page checks that come from Keywords, and the ideas taken from app names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TERM_LENGTH,
  MOVE_WINDOWS,
  NOT_FOUND_CHECKS,
  addToKeywordField,
  bucketOf,
  coverageOf,
  dayFromSearch,
  fewestRatingsOnTop,
  isKeywordsIssue,
  keywordDayKey,
  keywordDigest,
  keywordReport,
  keywordsCsv,
  keywordListingIssues,
  listingLocaleFor,
  loneReadings,
  moveBetween,
  nameIdeas,
  namePhrases,
  normalizeTerm,
  parseKeywordInput,
  rankIn,
  rankWords,
  readSearch,
  rowBetween,
  rowsByCountryAndTerm,
  searchKeyword,
  searchUrl,
  searchesDue,
  standingOf,
  startingKeywordCountries,
  storePageTerms,
  type KeywordDay,
  type KeywordList,
  type KeywordStanding,
} from '@/lib/growth/keywords';
import { addDays } from '@/lib/growth/dates';
import type { ListingLocale, ListingSnapshot } from '@/lib/growth/types';

const SHOT = (name: string) => `https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/e2/${name}.jpg/392x696bb.jpg`;

const LUDO_US = {
  resultCount: 5,
  results: [
    {
      kind: 'software',
      wrapperType: 'software',
      trackId: 1198143062,
      trackName: 'Ludo STAR',
      artistName: 'Gameberry Labs',
      primaryGenreName: 'Games',
      averageUserRating: 4.50819,
      userRatingCount: 105175,
      price: 0.0,
      formattedPrice: 'Free',
      artworkUrl512: 'https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/af/d8/5c/afd85cda-9aca-5653-aa83-00bd1fb5d398/LudoAppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg',
      screenshotUrls: [SHOT('star-1'), SHOT('star-2'), SHOT('star-3'), SHOT('star-4')],
    },
    {
      kind: 'software',
      wrapperType: 'software',
      trackId: 1267900294,
      trackName: 'Ludo Club・Fun Dice Board Game',
      artistName: 'Moonfrog',
      primaryGenreName: 'Games',
      averageUserRating: 4.43516,
      userRatingCount: 53652,
      price: 0.0,
      formattedPrice: 'Free',
      artworkUrl512: SHOT('club-icon'),
      screenshotUrls: [SHOT('club-1'), SHOT('club-2')],
    },
    // A row the search can send for something that is not an app is left out.
    { kind: 'podcast', wrapperType: 'track', trackId: 1, trackName: 'Ludo talk' },
    {
      kind: 'software',
      wrapperType: 'software',
      trackId: 1419536376,
      trackName: 'Yalla Ludo - Ludo&Jackaroo',
      artistName: 'Yalla Technology FZ-LLC',
      primaryGenreName: 'Games',
      averageUserRating: 4.4135,
      userRatingCount: 28658,
      price: 0.0,
      formattedPrice: 'Free',
      artworkUrl512: SHOT('yalla-icon'),
      screenshotUrls: [],
    },
    {
      kind: 'software',
      wrapperType: 'software',
      trackId: 993090598,
      trackName: 'Ludo King',
      artistName: 'GAMETION GLOBAL TECHNOLOGIES PTE LIMITED',
      primaryGenreName: 'Games',
      averageUserRating: 3.7307,
      userRatingCount: 19090,
      price: 0.0,
      formattedPrice: 'Free',
      artworkUrl512: SHOT('king-icon'),
      screenshotUrls: [SHOT('king-1')],
    },
  ],
};

test('a search answer keeps every app in Apple\'s order, the first ones in full, and only apps', () => {
  const search = readSearch(LUDO_US, 'ludo', 'US', 42);
  assert.deepEqual(search.ids, ['1198143062', '1267900294', '1419536376', '993090598']);
  assert.equal(search.top.length, 4);
  assert.deepEqual(search.top[0], {
    id: '1198143062',
    name: 'Ludo STAR',
    developer: 'Gameberry Labs',
    iconUrl: LUDO_US.results[0].artworkUrl512,
    rating: 4.50819,
    ratingCount: 105175,
    priceLabel: 'Free',
    genre: 'Games',
    screenshots: [SHOT('star-1'), SHOT('star-2'), SHOT('star-3')],
  });
  assert.equal(search.at, 42);
  assert.equal(rankIn(search, '993090598'), 4);
  assert.equal(rankIn(search, '6797975644'), null, 'an app the search did not list has no rank');

  // An app listed twice counts once, at its first place.
  const twice = readSearch({ results: [LUDO_US.results[0], LUDO_US.results[1], LUDO_US.results[0]] }, 'ludo', 'US', 1);
  assert.deepEqual(twice.ids, ['1198143062', '1267900294']);
  assert.deepEqual(readSearch({}, 'ludo', 'US', 1).ids, [], 'an answer without results lists nothing');
});

test('only the first ten apps keep their details', () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({ ...LUDO_US.results[0], trackId: 1000 + index }));
  const search = readSearch({ results: rows }, 'ludo', 'US', 1);
  assert.equal(search.ids.length, 14);
  assert.equal(search.top.length, 10);
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

test('the search asks Apple for iPhone apps, as many as it lists, with nothing from the browser\'s own copy', async () => {
  const apple = fakeApple(() => ({ body: LUDO_US }));
  try {
    const search = await searchKeyword('dice game', 'PK', { now: 7 });
    assert.equal(apple.calls.length, 1);
    const [{ url, init }] = apple.calls;
    assert.equal(`${url.origin}${url.pathname}`, 'https://itunes.apple.com/search');
    assert.equal(url.searchParams.get('term'), 'dice game');
    assert.equal(url.searchParams.get('country'), 'pk');
    assert.equal(url.searchParams.get('entity'), 'software');
    assert.equal(url.searchParams.get('limit'), '200');
    assert.equal(init?.cache, 'no-store');
    assert.equal(search.country, 'PK');
    assert.equal(search.term, 'dice game');
    assert.equal(search.at, 7);
    assert.equal(search.ids.length, 4);
    assert.equal(searchUrl('a b', 'US'), 'https://itunes.apple.com/search?term=a+b&country=us&entity=software&limit=200');
  } finally {
    apple.restore();
  }
});

test('a refused search is an error, for the check to count', async () => {
  const apple = fakeApple(() => ({ status: 403, body: {} }));
  try {
    await assert.rejects(() => searchKeyword('ludo', 'US'), /HTTP 403/);
  } finally {
    apple.restore();
  }
});

test('a day\'s row holds the app\'s rank and the ranks of the apps it follows, never its own twice', () => {
  const search = readSearch(LUDO_US, 'ludo', 'US', 42);
  const row = dayFromSearch(search, '993090598', ['1198143062', '993090598', '555'], '2026-11-15');
  assert.equal(row.key, keywordDayKey('993090598', 'US', 'ludo', '2026-11-15'));
  assert.equal(row.key, '993090598|US|ludo|2026-11-15');
  assert.equal(row.rank, 4);
  assert.equal(row.total, 4);
  assert.deepEqual(row.rivals, { '1198143062': 1, '555': null });
  assert.equal(row.at, 42);
});

test('a typed keyword is kept lowercase, with single spaces and no quotes or stops around it', () => {
  assert.equal(normalizeTerm('  "Ludo  KING" '), 'ludo king');
  assert.equal(normalizeTerm('dice game.'), 'dice game');
  assert.equal(normalizeTerm('“photo editor”'), 'photo editor');
  assert.equal(normalizeTerm('3D Ludo!'), '3d ludo');
  assert.equal(Array.from(normalizeTerm('x'.repeat(200))).length, MAX_TERM_LENGTH);
  assert.deepEqual(parseKeywordInput('Ludo, dice game\nludo; board,,  ,"!"、写真'), ['ludo', 'dice game', 'board', '写真']);
});

const day = (date: string, rank: number | null, rivals: Record<string, number | null> = {}): KeywordDay => ({
  key: `1|US|ludo|${date}`,
  appId: '1',
  term: 'ludo',
  country: 'US',
  date,
  rank,
  total: 190,
  rivals,
  at: 0,
});

test('a rank moves up, down, into search and out of it, compared with the reading before and a week back', () => {
  assert.deepEqual(moveBetween(4, 9), { kind: 'up', places: 5 });
  assert.deepEqual(moveBetween(9, 4), { kind: 'down', places: 5 });
  assert.deepEqual(moveBetween(4, 4), { kind: 'same', places: 0 });
  assert.deepEqual(moveBetween(12, null), { kind: 'found', places: 0 });
  assert.deepEqual(moveBetween(null, 12), { kind: 'lost', places: 0 });
  assert.deepEqual(moveBetween(null, null), { kind: 'same', places: 0 });
  assert.deepEqual(moveBetween(4, undefined), { kind: 'unknown', places: 0 });

  // Days with no check (the app was closed) are simply missing.
  const rows = [day('2026-11-01', 30), day('2026-11-05', 20), day('2026-11-08', 14), day('2026-11-12', 9), day('2026-11-15', 11)];
  const standing = standingOf(rows, '2026-11-15');
  assert.equal(standing.latest?.rank, 11);
  assert.equal(standing.previous?.date, '2026-11-12', 'the day before is the newest reading one to three days back');
  assert.deepEqual(standing.dayMove, { kind: 'down', places: 2 });
  assert.equal(standing.weekAgo?.date, '2026-11-08', 'a week back is the newest reading seven to ten days back');
  assert.deepEqual(standing.weekMove, { kind: 'up', places: 3 });
  assert.equal(standing.monthAgo, undefined, 'nothing from 30 to 37 days back');
  assert.deepEqual(standing.monthMove, { kind: 'unknown', places: 0 });
  assert.equal(standing.notFoundChecks, 0);
  assert.equal(standing.stale, false);
  assert.deepEqual(MOVE_WINDOWS, { day: [1, 3], week: [7, 10], month: [30, 37] });
  assert.equal(rowBetween(rows, '2026-11-02', '2026-11-06')?.date, '2026-11-05');
  assert.equal(rowBetween(rows, '2026-11-09', '2026-11-11'), undefined);
  assert.equal(rowBetween(rows, '2026-10-01', '2026-10-20'), undefined);
});

test('a reading from months ago is never the day, the week or the month before', () => {
  // As the audit put it: rank 40 on September 1, rank 10 on November 15.
  const standing = standingOf([day('2026-09-01', 40), day('2026-11-15', 10)], '2026-11-15');
  assert.deepEqual(standing.dayMove, { kind: 'unknown', places: 0 });
  assert.deepEqual(standing.weekMove, { kind: 'unknown', places: 0 });
  assert.deepEqual(standing.monthMove, { kind: 'unknown', places: 0 });
  assert.equal(standing.previous, undefined);
  // Four days back is too old for "the day before", and too new for a week.
  const gap = standingOf([day('2026-11-11', 20), day('2026-11-15', 10)], '2026-11-15');
  assert.equal(gap.dayMove.kind, 'unknown');
  assert.equal(gap.weekMove.kind, 'unknown');
  // A month back is 30 to 37 days.
  const month = standingOf([day('2026-10-12', 25), day('2026-11-15', 10)], '2026-11-15');
  assert.deepEqual(month.monthMove, { kind: 'up', places: 15 });
  assert.equal(month.monthAgo?.date, '2026-10-12');
});

test('not found is counted in checks, never in days without one, and an old reading is stale', () => {
  // As the audit put it: two checks, a week apart, are two checks, not eight days.
  const sparse = standingOf([day('2026-11-01', null), day('2026-11-08', null)], '2026-11-15');
  assert.equal(sparse.notFoundChecks, 2);
  assert.equal(sparse.stale, true, 'a week old reading is not today\'s news');
  const rows = [day('2026-11-01', 40), day('2026-11-03', null), day('2026-11-06', null), day('2026-11-09', null)];
  const standing = standingOf(rows, '2026-11-09');
  assert.equal(standing.notFoundChecks, 3);
  assert.deepEqual(standing.dayMove, { kind: 'same', places: 0 }, 'November 6 is three days back');
  assert.equal(standingOf(rows, addDays('2026-11-09', 2)).stale, false);
  assert.equal(standingOf(rows, addDays('2026-11-09', 3)).stale, true);
  assert.equal(standingOf([], '2026-11-09').latest, undefined);
  assert.deepEqual(standingOf([], '2026-11-09').dayMove, { kind: 'unknown', places: 0 });
});

test('the buckets the screen colours by', () => {
  assert.equal(bucketOf(1), 'top3');
  assert.equal(bucketOf(3), 'top3');
  assert.equal(bucketOf(4), 'top10');
  assert.equal(bucketOf(10), 'top10');
  assert.equal(bucketOf(11), 'top50');
  assert.equal(bucketOf(50), 'top50');
  assert.equal(bucketOf(51), 'lower');
  assert.equal(bucketOf(null), 'none');
  assert.equal(bucketOf(undefined), 'none');
});

test('a check owes the searches without a row for today, country by country', () => {
  const due = searchesDue(['ludo', 'dice'], ['US', 'PK'], new Set(['US|ludo']));
  assert.deepEqual(due, [
    { term: 'dice', country: 'US' },
    { term: 'ludo', country: 'PK' },
    { term: 'dice', country: 'PK' },
  ]);
  assert.deepEqual(searchesDue(['ludo'], ['US'], new Set(['US|ludo'])), []);
});

const LOCALE: ListingLocale = {
  locale: 'en-US',
  name: 'Ludo Wala: 3D & Action',
  subtitle: 'Dice board game with friends',
  keywords: 'ludo king,offline,multiplayer,photos',
  promotionalText: '',
  description: '',
  whatsNew: '',
};

test('a keyword is on the store page when every word is in the name, subtitle or keywords, in any mix', () => {
  assert.deepEqual(coverageOf('ludo', LOCALE), { fields: ['name', 'keywords'], missing: [] });
  assert.deepEqual(coverageOf('ludo online', LOCALE), { fields: ['name', 'keywords'], missing: ['online'] });
  assert.deepEqual(coverageOf('dice game offline', LOCALE), { fields: ['subtitle', 'keywords'], missing: [] });
  assert.deepEqual(coverageOf('photo', LOCALE).missing, [], '"photo" and "photos" are one word to the store');
  assert.deepEqual(coverageOf('the king', LOCALE), { fields: ['keywords'], missing: [] }, 'small words are not searched on their own');
  // A language written without spaces is matched as a whole phrase.
  const japanese = { ...LOCALE, locale: 'ja', name: 'ルドーゲーム', subtitle: '', keywords: '友達,サイコロ' };
  assert.deepEqual(coverageOf('ルドー', japanese), { fields: ['name'], missing: [] });
  assert.deepEqual(coverageOf('ボード', japanese), { fields: [], missing: ['ボード'] });
});

test('words are added at the end of the keywords, as many as fit in 100 characters', () => {
  assert.deepEqual(addToKeywordField('ludo,dice,', ['board', 'dice', 'online']), { after: 'ludo,dice,board,online', added: ['board', 'online'], left: [] });
  assert.deepEqual(addToKeywordField('', ['board']), { after: 'board', added: ['board'], left: [] });
  const ninetyFive = 'a'.repeat(95);
  assert.deepEqual(addToKeywordField(ninetyFive, ['dice', 'board']), { after: `${ninetyFive},dice`, added: ['dice'], left: ['board'] });
  assert.deepEqual(addToKeywordField('a'.repeat(100), ['dice']), { after: 'a'.repeat(100), added: [], left: ['dice'] });
});

function listing(locales: Array<Partial<ListingLocale> & Pick<ListingLocale, 'locale'>>, primaryLocale = 'en-US'): ListingSnapshot {
  return {
    appId: '6797975644',
    versionId: 'v1',
    versionString: '1.5',
    state: 'PREPARE_FOR_SUBMISSION',
    platform: 'IOS',
    editable: true,
    appInfoEditable: true,
    primaryLocale,
    fetchedAt: 0,
    locales: locales.map((entry) => ({ ...LOCALE, ...entry })),
  };
}

const standing = (rank: number | null, notFoundChecks = 0, stale = false): KeywordStanding => ({
  latest: day('2026-11-15', rank),
  dayMove: { kind: 'unknown', places: 0 },
  weekMove: { kind: 'unknown', places: 0 },
  monthMove: { kind: 'unknown', places: 0 },
  notFoundChecks,
  stale,
});

test('a country reads the store page in its own language when the page has it, and in the main language otherwise', () => {
  const page = listing([{ locale: 'en-US' }, { locale: 'de-DE' }]);
  assert.equal(listingLocaleFor('DE', page), 'de-DE');
  assert.equal(listingLocaleFor('AT', page), 'de-DE', 'Austria reads German');
  assert.equal(listingLocaleFor('PK', page), 'en-US');
  assert.equal(listingLocaleFor('JP', page), 'en-US', 'no Japanese page: the main language');
  assert.equal(listingLocaleFor('GB', page), 'en-US', 'British English falls back to the other English');
});

test('the Store page gets one tip for tracked keywords it lacks, with a fix that adds the missing words', () => {
  const page = listing([{ locale: 'en-US' }, { locale: 'de-DE', name: 'Ludo Wala', subtitle: 'Brettspiel', keywords: 'ludo' }]);
  const facts = {
    terms: ['ludo', 'ludo online', 'board game', 'dice'],
    countries: ['US', 'DE'],
    standings: new Map([
      ['US', new Map([['ludo', standing(12)]])],
      ['DE', new Map()],
    ]),
  };
  const issues = keywordListingIssues(page, facts);
  const english = issues.find((issue) => issue.id === 'en-US:keywords:tracked-missing');
  assert.ok(english);
  assert.equal(english.severity, 'tip', 'research keywords must not fill the Store page with warnings');
  assert.equal(english.title, "1 keyword you track isn't on your store page");
  assert.equal(english.fix?.after, 'ludo king,offline,multiplayer,photos,online', '"board game" and "dice" are in the subtitle already');
  assert.equal(english.fix?.before, LOCALE.keywords);
  assert.match(english.fix?.reason ?? '', /"online"/);
  const german = issues.find((issue) => issue.id === 'de-DE:keywords:tracked-missing');
  assert.equal(german?.fix?.after, 'ludo,online,board,game,dice');
  // A language no tracked country reads is left alone.
  const onlyUs = keywordListingIssues(page, { ...facts, countries: ['US'] });
  assert.equal(onlyUs.some((issue) => issue.locale === 'de-DE'), false);
  assert.deepEqual(keywordListingIssues(page, { ...facts, terms: [] }), []);
});

test('with the keywords full the tip says so and offers no fix', () => {
  const page = listing([{ locale: 'en-US', keywords: 'k'.repeat(100) }]);
  const [issue] = keywordListingIssues(page, { terms: ['online'], countries: ['US'], standings: new Map() });
  assert.equal(issue.id, 'en-US:keywords:tracked-missing');
  assert.equal(issue.fix, undefined);
  assert.match(issue.detail, /Your keywords are full/);
});

test('keywords on the page that search has not found the app for in a week get a tip of their own', () => {
  const page = listing([{ locale: 'en-US' }]);
  const facts = {
    terms: ['offline', 'multiplayer', 'ludo king'],
    countries: ['US', 'PK'],
    standings: new Map([
      [
        'US',
        new Map([
          ['offline', standing(null, NOT_FOUND_CHECKS)],
          ['multiplayer', standing(null, NOT_FOUND_CHECKS - 1)],
          ['ludo king', standing(null, 30)],
        ]),
      ],
      [
        'PK',
        new Map([
          ['offline', standing(null, 9)],
          ['multiplayer', standing(null, 9)],
          ['ludo king', standing(40)],
        ]),
      ],
    ]),
  };
  const issue = keywordListingIssues(page, facts).find((entry) => entry.id === 'en-US:keywords:not-found');
  assert.ok(issue);
  // "multiplayer" has six checks in the US, and "ludo king" ranks in Pakistan.
  assert.equal(issue.title, "1 of your keywords isn't found in search");
  assert.match(issue.detail, /^Search in United States and Pakistan didn't find your app for "offline" in any of Growth's last 7 checks\./);
  assert.equal(isKeywordsIssue(issue.id), true);
  assert.equal(issue.fix, undefined);
});

test('ideas from app names are their words and two word phrases, never across a separator, counted once per app', () => {
  assert.deepEqual(namePhrases('Ludo Club・Fun Dice Board Game', 'en-US'), ['ludo', 'club', 'ludo club', 'fun', 'dice', 'fun dice', 'board', 'dice board', 'game', 'board game']);
  assert.deepEqual(namePhrases('Ludo King: 2 Player', 'en-US'), ['ludo', 'king', 'ludo king', 'player'], 'numbers alone are not ideas');
  const names = ['Ludo STAR', 'Ludo Club・Fun Dice Board Game', 'Yalla Ludo - Ludo&Jackaroo', 'Ludo King', 'Dice Board Game Ludo'];
  const ideas = nameIdeas(names, 'en-US', new Set(['ludo']), 2);
  assert.deepEqual(ideas.slice(0, 4), [
    { term: 'board game', apps: 2 },
    { term: 'dice board', apps: 2 },
    { term: 'board', apps: 2 },
    { term: 'dice', apps: 2 },
  ]);
  assert.equal(ideas.some((idea) => idea.term === 'ludo'), false, 'a tracked word is not an idea');
  assert.equal(ideas.some((idea) => idea.apps < 2), false);
  assert.equal(nameIdeas(['Ludo Ludo Ludo'], 'en-US', new Set(), 1).find((idea) => idea.term === 'ludo')?.apps, 1);
});

test('the store page\'s own words: each keyword, then the name and subtitle phrases', () => {
  assert.deepEqual(storePageTerms(LOCALE), ['ludo king', 'offline', 'multiplayer', 'photos', 'ludo wala', '3d', 'action', 'dice board game with friends']);
});

test('a new list starts in the busiest countries, then the United States, three at most', () => {
  const known = ['US', 'PK', 'GB', 'DE'];
  assert.deepEqual(startingKeywordCountries(['PK', 'XX', null, 'GB', 'DE'], known), ['PK', 'GB', 'DE']);
  assert.deepEqual(startingKeywordCountries([], known), ['US']);
  assert.deepEqual(startingKeywordCountries(['US', 'PK'], known), ['US', 'PK']);
});

test('the fewest ratings in the top ten, for "within reach"', () => {
  const search = readSearch(LUDO_US, 'ludo', 'US', 1);
  assert.equal(fewestRatingsOnTop(search), 19090);
  assert.equal(fewestRatingsOnTop({ top: [] }), null);
});

test('the CSV export has a row per keyword, country and day, newest first, and a formula is kept as text', () => {
  const rows = [day('2026-11-14', 12), day('2026-11-15', null), { ...day('2026-11-15', 3), country: 'PK', key: 'pk' }, { ...day('2026-11-15', 1), term: '=cmd', key: 'x' }];
  const csv = keywordsCsv(rowsByCountryAndTerm(rows), ['ludo', '=cmd'], ['US', 'PK']);
  assert.equal(
    csv,
    [
      'Keyword,Country,Day,Rank,Apps listed',
      'ludo,United States,2026-11-15,Not found,190',
      'ludo,United States,2026-11-14,12,190',
      'ludo,Pakistan,2026-11-15,3,190',
      "'=cmd,United States,2026-11-15,1,190",
      '',
    ].join('\r\n')
  );
});

test('a stale miss gives no advice, and the Store page tells its own checks on the keywords field from the ones Keywords adds', () => {
  const page = listing([{ locale: 'en-US' }]);
  const facts = {
    terms: ['offline'],
    countries: ['US'],
    standings: new Map([['US', new Map([['offline', standing(null, 30, true)]])]]),
  };
  assert.equal(
    keywordListingIssues(page, facts).some((issue) => issue.id.endsWith(':keywords:not-found')),
    false,
    'an old reading shows its date on Keywords, not as advice on Store page'
  );
  assert.equal(isKeywordsIssue('en-US:keywords:tracked-missing'), true);
  assert.equal(isKeywordsIssue('en-US:keywords:not-found'), true);
  // The page's own checks on the same field, whose fixes Add every fix must keep.
  for (const id of ['en-US:keywords:duplicates', 'en-US:keywords:indexed', 'en-US:keywords:spaces', 'de-DE:keywords:too-long']) assert.equal(isKeywordsIssue(id), false, id);
});

test('a found check between two misses is a dot on the chart, whatever the number of checks', () => {
  // As the audit put it: ranks 10, missing, 8, missing, 6 drew nothing.
  assert.deepEqual([...loneReadings([10, null, 8, null, 6])], [0, 2, 4]);
  assert.deepEqual([...loneReadings([10, 9, null, 8])], [3], 'two checks side by side make a line');
  assert.deepEqual([...loneReadings([undefined, 5, undefined])], [1], 'a day not checked breaks a line too');
  assert.deepEqual([...loneReadings([4])], [0]);
  assert.deepEqual([...loneReadings([null, null])], []);
});

test('a rank in words tells a check that did not find the app from no check at all', () => {
  assert.equal(rankWords(3), '3');
  assert.equal(rankWords(null), 'Not found');
  assert.equal(rankWords(undefined), 'Not checked', 'a competitor followed after that day\'s check');
});

test('the overview gets a few lines per country: counts, the best ranks and the biggest moves since the check before', () => {
  const list = { keywords: [{ term: 'ludo', addedAt: 1 }, { term: 'dice', addedAt: 2 }, { term: 'board', addedAt: 3 }], countries: ['US'] };
  const history = rowsByCountryAndTerm([
    { ...day('2026-11-14', 12), key: 'a' },
    { ...day('2026-11-15', 8), key: 'b' },
    { ...day('2026-11-15', null), term: 'dice', key: 'c' },
  ]);
  const digest = keywordDigest(list, history, '2026-11-15');
  assert.ok(digest);
  assert.equal(digest.tracked, 3);
  assert.match(digest.source, /not the same/);
  const [us] = digest.countries;
  assert.deepEqual(
    { code: us.code, country: us.country, checked: us.checked, top10: us.top10, top50: us.top50, found: us.found, notFound: us.notFound, notChecked: us.notChecked },
    { code: 'US', country: 'United States', checked: '2026-11-15', top10: 1, top50: 1, found: 1, notFound: 1, notChecked: 1 }
  );
  assert.deepEqual(us.best, [{ keyword: 'ludo', rank: 8 }]);
  assert.deepEqual(us.moved, [{ keyword: 'ludo', since: '2026-11-14', from: 12, to: 8 }]);
  assert.equal(keywordDigest({ keywords: [], countries: ['US'] }, new Map(), '2026-11-15'), null);
});

test('the agent report gives each change with the day it compares with, and no value for an app not checked', () => {
  const list: KeywordList = { owner: '1', keywords: [{ term: 'ludo', addedAt: 1 }], countries: ['US', 'PK'] };
  const history = rowsByCountryAndTerm([
    { ...day('2026-11-14', 12, { '993090598': 3 }), key: 'a' },
    { ...day('2026-11-15', 8, { '993090598': 2, '555': null }), key: 'b' },
  ]);
  const followed = [
    { id: '993090598', name: 'Ludo King' },
    { id: '555', name: 'Other' },
    { id: '777', name: 'Followed later' },
  ];
  const page = listing([{ locale: 'en-US', name: 'Ludo Wala', subtitle: '', keywords: '' }]);
  const report = keywordReport({ list, history, searches: new Map(), listing: page, followed, today: '2026-11-15' });
  assert.match(report.source, /null means the search did not list the app/);
  const us = report.keywords[0].countries.US;
  assert.equal(us.rank, 8);
  assert.equal(us.appsListed, 190);
  assert.deepEqual(us.changes.day, { since: '2026-11-14', from: 12, to: 8 });
  assert.equal(us.changes.week, undefined, 'no check seven to ten days back');
  assert.deepEqual(us.competitors, [
    { name: 'Ludo King', rank: 2 },
    { name: 'Other', rank: null },
  ], 'an app followed after the check has no entry, which is not a miss');
  assert.deepEqual(us.onStorePage, { language: 'English', fields: ['name'], missingWords: [] });
  assert.equal(us.firstApps, undefined, 'only a question about one keyword gets the first apps');
  const pk = report.keywords[0].countries.PK;
  assert.equal(pk.rank, undefined, 'never checked in Pakistan, which is not "not found"');
  assert.equal(pk.checked, null);

  // One keyword, one country: every check, and the first apps dated by their own search.
  const search = readSearch(LUDO_US, 'ludo', 'US', Date.parse('2026-11-15T09:00:00Z'));
  const one = keywordReport({ list, history, searches: new Map([['US|ludo', search]]), listing: null, followed: [], today: '2026-11-15', keyword: 'Ludo', country: 'US' });
  assert.deepEqual(Object.keys(one.keywords[0].countries), ['US']);
  const detail = one.keywords[0].countries.US;
  assert.deepEqual(detail.checks, [
    { date: '2026-11-14', rank: 12 },
    { date: '2026-11-15', rank: 8 },
  ]);
  assert.equal(detail.firstApps?.checked, '2026-11-15');
  assert.deepEqual(detail.firstApps?.apps[0], { rank: 1, name: 'Ludo STAR', ratings: 105175 });
  assert.equal(detail.onStorePage, undefined, 'no store page, no claim about it');
});
