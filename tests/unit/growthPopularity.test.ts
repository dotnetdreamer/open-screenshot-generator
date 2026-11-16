// Keyword popularity from Apple Ads: the weeks asked for, the request, reading
// Apple's rows (the answer examples are the ones in Apple's documentation of
// the Search Term Popularity Query, copied 2026-11-15), trends, a keyword's
// chance against the first ten apps of its search, the order ideas come in,
// and the Apple Ads client: the client secret, the token trade, the ad
// account header, the shorter ranges after a refusal, and the errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { AppleAdsError, appleAdsMessage, hasAllIds, parseAppleAdsIds, testAppleAdsKey, type AppleAdsKey } from '@/lib/growth/appleAds';
import { readSearch } from '@/lib/growth/keywords';
import {
  byBestChance,
  chanceOf,
  competitionOf,
  everyCountShown,
  fetchPopularity,
  latestPoint,
  monthlyRange,
  periodWords,
  popularityOf,
  popularityRange,
  popularityRequest,
  popularityTrend,
  readPopularityRows,
  sinceWords,
  tierOf,
  tierWords,
  type PopularityPoint,
} from '@/lib/growth/popularity';

/**
 * "Weekly, US Productivity", the first answer in Apple's documentation of the
 * endpoint, to a request for Sunday Jan 5 to Saturday Jan 11, 2025: Apple names
 * that week by the Sunday after it, Jan 12.
 */
const WEEKLY_US = {
  result: {
    rows: [
      { week: '2025-01-12', countryOrRegion: 'US', genre: 'PRODUCTIVITY_UTILITIES', searchTerm: 'task manager', rankInGenre: 1, searchPopularityInGenre: 95, searchPopularity1to100: 88, searchPopularity1to5: 5 },
      { week: '2025-01-12', countryOrRegion: 'US', genre: 'PRODUCTIVITY_UTILITIES', searchTerm: 'to do list app', rankInGenre: 2, searchPopularityInGenre: 89, searchPopularity1to100: 84, searchPopularity1to5: 5 },
      { week: '2025-01-12', countryOrRegion: 'US', genre: 'PRODUCTIVITY_UTILITIES', searchTerm: 'calendar planner', rankInGenre: 3, searchPopularityInGenre: 76, searchPopularity1to100: 72, searchPopularity1to5: 4 },
    ],
  },
  pagination: { offset: 0, pageSize: 20 },
};

/** "Monthly, Multi-Country", the second answer there. */
const MONTHLY = {
  result: {
    rows: [
      { month: '2024-10', countryOrRegion: 'US', genre: 'TRAVEL', searchTerm: 'flight tracker', rankInGenre: 1, searchPopularityInGenre: 98, searchPopularity1to100: 91, searchPopularity1to5: 5 },
      { month: '2024-10', countryOrRegion: 'GB', genre: 'TRAVEL', searchTerm: 'flight tracker', rankInGenre: 2, searchPopularityInGenre: 92, searchPopularity1to100: 87, searchPopularity1to5: 5 },
    ],
  },
  pagination: { offset: 0, pageSize: 50 },
};

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

test('the weeks asked for are whole weeks, Sunday to Saturday, before the week of today', () => {
  // 2026-11-15 is a Sunday: the week before it ended the day before.
  assert.deepEqual(popularityRange('2026-11-15'), { start: '2026-08-23', end: '2026-11-14', granularity: 'WEEKLY_SUN_SAT' });
  // A Saturday's own week has not ended yet.
  assert.equal(popularityRange('2026-11-21').end, '2026-11-14');
  assert.equal(popularityRange('2026-11-16').end, '2026-11-14');
  assert.equal(popularityRange('2026-11-15', 4).start, '2026-10-18');
  for (const day of ['2026-11-15', '2026-11-18', '2026-11-21', '2027-01-01']) {
    const range = popularityRange(day);
    assert.equal(weekday(range.start), 0, `${day}: starts on a Sunday`);
    assert.equal(weekday(range.end), 6, `${day}: ends on a Saturday`);
    assert.ok(range.end < day);
  }
});

test('months, for when Apple refuses the weeks, are the three whole months before this one', () => {
  assert.deepEqual(monthlyRange('2026-11-15'), { start: '2026-08-01', end: '2026-10-31', granularity: 'MONTHLY' });
  assert.deepEqual(monthlyRange('2026-01-10'), { start: '2025-10-01', end: '2025-12-31', granularity: 'MONTHLY' });
});

test('the request asks for the score from 1 to 100 and the tier, for the terms of one country, a page at a time', () => {
  const range = popularityRange('2026-11-15');
  assert.deepEqual(popularityRequest('us', ['ludo', 'ludo king'], range), {
    fields: ['searchPopularity1to100', 'searchPopularity1to5'],
    filters: [
      { field: 'countryOrRegion', operator: 'EQUALS', value: 'US' },
      { field: 'searchTerm', operator: 'IN', value: ['ludo', 'ludo king'] },
    ],
    timeRange: { start: '2026-08-23', end: '2026-11-14', granularity: 'WEEKLY_SUN_SAT' },
    sorting: [
      { field: 'searchTerm', order: 'ASC' },
      { field: 'week', order: 'ASC' },
    ],
    pagination: { offset: 0, pageSize: 2000 },
  });
  assert.deepEqual(popularityRequest('US', ['a'], monthlyRange('2026-11-15'), 2).pagination, { offset: 4000, pageSize: 2000 });
  assert.equal(popularityRequest('US', ['a'], monthlyRange('2026-11-15')).sorting[1].field, 'month');
});

test("Apple's documented answers are read as they come, and a term Apple sends nothing for has no score", () => {
  const rows = readPopularityRows(WEEKLY_US);
  // The week Apple names Jan 12 is kept as the Sunday it starts on.
  assert.deepEqual(rows[0], { term: 'task manager', week: '2025-01-05', score: 88, tier: 5 });
  const found = popularityOf(rows, ['task manager', 'calendar planner', 'focus timer'], 'US', 5);
  assert.deepEqual(found.get('task manager'), { term: 'task manager', country: 'US', at: 5, points: [{ week: '2025-01-05', score: 88, tier: 5 }], granularity: 'week' });
  assert.deepEqual(found.get('calendar planner')?.points, [{ week: '2025-01-05', score: 72, tier: 4 }]);
  assert.equal(periodWords(found.get('task manager')!.points[0].week, 'week', { withYear: true }), 'Week of Jan 5, 2025');
  // Asked about, answered with nothing: a record with no points.
  assert.deepEqual(found.get('focus timer'), { term: 'focus timer', country: 'US', at: 5, points: [], granularity: 'week' });
  // A term not asked about stays out.
  assert.equal(found.has('to do list app'), false);
  // A month is kept as its first day.
  assert.deepEqual(readPopularityRows(MONTHLY)[0], { term: 'flight tracker', week: '2024-10-01', score: 91, tier: 5 });
});

test('the rows of a term in several genres make one point a week, the highest kept, oldest week first', () => {
  const rows = readPopularityRows({
    result: {
      rows: [
        { week: '2026-11-15', genre: 'GAMES', searchTerm: 'ludo', searchPopularity1to100: 40, searchPopularity1to5: 2 },
        { week: '2026-11-15', genre: 'ENTERTAINMENT', searchTerm: 'ludo', searchPopularity1to100: 42, searchPopularity1to5: 3 },
        { week: '2026-11-08', genre: 'GAMES', searchTerm: 'ludo', searchPopularity1to100: 30, searchPopularity1to5: 2 },
      ],
    },
  });
  assert.deepEqual(popularityOf(rows, ['ludo'], 'PK', 1).get('ludo')?.points, [
    { week: '2026-11-01', score: 30, tier: 2 },
    { week: '2026-11-08', score: 42, tier: 3 },
  ]);
});

test('terms are read as Growth keeps them, and rows that make no sense are dropped', () => {
  const rows = readPopularityRows({
    result: {
      rows: [
        { week: '2026-11-15', searchTerm: '  Ludo   KING ', searchPopularity1to100: '77' },
        { week: '2026-11-15', searchTerm: 'too high', searchPopularity1to100: 140, searchPopularity1to5: 9 },
        { week: '2026-11-15', searchTerm: 'no score', searchPopularity1to100: null },
        { week: '2026-11-15', searchPopularity1to100: 50 },
        { week: 'last week', searchTerm: 'bad week', searchPopularity1to100: 50 },
        'not a row',
      ],
    },
  });
  assert.deepEqual(rows, [
    { term: 'ludo king', week: '2026-11-08', score: 77, tier: 4 },
    { term: 'too high', week: '2026-11-08', score: 100, tier: 5 },
  ]);
  assert.deepEqual(readPopularityRows({ error: { code: 'INVALID_ARGUMENT' } }), []);
  assert.deepEqual(readPopularityRows(null), []);
});

function weeks(scores: number[], last = '2026-11-08'): PopularityPoint[] {
  return scores.map((score, index) => {
    const back = (scores.length - 1 - index) * 7;
    const day = new Date(Date.parse(`${last}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
    return { week: day, score, tier: tierOf(score) };
  });
}

test('a trend compares the latest week with the newest one four to six weeks before it', () => {
  // Eight weeks: four weeks before the latest is 2026-10-11.
  assert.deepEqual(popularityTrend(weeks([10, 20, 30, 50, 55, 58, 59, 60])), { kind: 'up', change: 10, since: '2026-10-11' });
  assert.deepEqual(popularityTrend(weeks([70, 70, 70, 70, 61])), { kind: 'down', change: -9, since: '2026-10-11' });
  assert.deepEqual(popularityTrend(weeks([44, 44, 44, 44, 44])), { kind: 'same', change: 0, since: '2026-10-11' });
  // Three weeks of scores: nothing a month back to compare with.
  assert.deepEqual(popularityTrend(weeks([10, 20, 30])), { kind: 'unknown', change: 0 });
  assert.deepEqual(popularityTrend([]), { kind: 'unknown', change: 0 });
  // A gap: only a score seven weeks back, outside the window.
  const gap = [{ week: '2026-09-20', score: 10, tier: 1 }, { week: '2026-11-08', score: 60, tier: 3 }];
  assert.equal(popularityTrend(gap).kind, 'unknown');
  assert.deepEqual(latestPoint({ points: gap }), gap[1]);
  assert.equal(latestPoint({ points: [] }), undefined);
});

test('tiers, from a score and in words', () => {
  assert.deepEqual([1, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(tierOf), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.deepEqual([1, 2, 3, 4, 5].map(tierWords), ['Very low', 'Low', 'Medium', 'High', 'Very high']);
  assert.equal(tierWords(0), 'Very low');
  assert.equal(tierWords(9), 'Very high');
});

const YOU = '6797975644';

function search(apps: Array<[string, number | null]>) {
  return readSearch(
    { results: apps.map(([id, ratings]) => ({ kind: 'software', trackId: id, trackName: `App ${id}`, userRatingCount: ratings ?? undefined })) },
    'ludo',
    'US',
    1
  );
}

test("a search's competition is the weakest app in its first ten, the user's own app left out", () => {
  const ten = search([
    ['1', 19_090],
    [YOU, 3],
    ['2', 105_175],
    ['3', 2],
    ['4', null],
  ]);
  assert.deepEqual(competitionOf(ten, YOU, 3), { weakest: 2, beatable: 1, counted: 3, others: 4 });
  assert.deepEqual(competitionOf(ten, YOU, null), { weakest: 2, beatable: 0, counted: 3, others: 4 });
  assert.deepEqual(competitionOf(search([[YOU, 3]]), YOU, 3), { weakest: null, beatable: 0, counted: 0, others: 0 });
  // "4" shows no count, so 2 is the fewest shown, not the fewest there.
  assert.equal(everyCountShown(competitionOf(ten, YOU, 3)), false);
  assert.equal(everyCountShown(competitionOf(search([['1', 5], [YOU, 3], ['2', 0]]), YOU, 3)), true);
  assert.equal(everyCountShown(competitionOf(search([[YOU, 3]]), YOU, 3)), false);
});

test('a chance: in the top 10 already, within reach, crowded, or not known', () => {
  const competition = { weakest: 40, beatable: 1, counted: 10, others: 10 };
  assert.equal(chanceOf(4, competition, 1), 'ranked');
  assert.equal(chanceOf(14, competition, 40), 'reach');
  assert.equal(chanceOf(null, competition, 41), 'reach');
  assert.equal(chanceOf(null, competition, 39), 'crowded');
  assert.equal(chanceOf(null, competition, null), 'unknown');
  assert.equal(chanceOf(undefined, null, 10), 'unknown');
  assert.equal(chanceOf(null, { weakest: null, beatable: 0, counted: 0, others: 0 }, 10), 'unknown');
});

test('crowded only when ten other apps are there and every one shows more ratings', () => {
  const strong = (count: number, from = 1) => Array.from({ length: count }, (_, index): [string, number | null] => [String(from + index), 100 + index]);
  // The case the audit found: one app shows 100 ratings, nine show none, yours has 40.
  const unknownNine = search([['1', 100], ...Array.from({ length: 9 }, (_, index): [string, number | null] => [String(2 + index), null])]);
  assert.equal(chanceOf(null, competitionOf(unknownNine, YOU, 40), 40), 'unknown');
  // Ten apps, every count shown and above yours.
  const full = search(strong(10));
  assert.equal(chanceOf(null, competitionOf(full, YOU, 40), 40), 'crowded');
  // Found at 11, behind ten stronger apps: crowded too.
  const behind = search([...strong(10), [YOU, 40]]);
  assert.equal(chanceOf(11, competitionOf(behind, YOU, 40), 40), 'crowded');
  // Three apps, all stronger: the first ten have room.
  assert.equal(chanceOf(null, competitionOf(search(strong(3)), YOU, 40), 40), 'unknown');
  // A shown count no higher than yours is enough for Within reach, whatever the others show.
  const oneWeak = search([['1', 12], ...Array.from({ length: 9 }, (_, index): [string, number | null] => [String(2 + index), null])]);
  assert.equal(chanceOf(null, competitionOf(oneWeak, YOU, 40), 40), 'reach');
});

test('best chance first: words the app can rank for, then words not checked, then crowded ones, most searched first in each', () => {
  const ordered = byBestChance([
    { term: 'crowded popular', chance: 'crowded' as const, score: 90 },
    { term: 'unchecked', chance: 'unknown' as const, score: 50 },
    { term: 'reach low', chance: 'reach' as const, score: 20 },
    { term: 'ranked', chance: 'ranked' as const, score: 35 },
    { term: 'reach no score', chance: 'reach' as const, score: null },
    { term: 'unchecked high', chance: 'unknown' as const, score: 70 },
  ]);
  assert.deepEqual(
    ordered.map((item) => item.term),
    ['ranked', 'reach low', 'reach no score', 'unchecked high', 'unchecked', 'crowded popular']
  );
});

// --- the Apple Ads client ---------------------------------------------------------------

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** window.fetch answering as Apple's sign-in and Apple Ads would, with every request kept. */
function fakeAppleAds(answer: (request: Sent) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const sent: Sent[] = [];
  const root = globalThis as unknown as { window?: unknown };
  root.window = {
    fetch: async (url: string, init: RequestInit = {}) => {
      const headers = Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
      const request = { method: init.method ?? 'GET', url, headers, body: typeof init.body === 'string' ? init.body : '' };
      sent.push(request);
      const { status = 200, body = {}, headers: extra = {} } = answer(request);
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
    },
  };
  return { sent, restore: () => delete root.window };
}

const TOKEN = { access_token: 'access-1', token_type: 'Bearer', expires_in: 3600, scope: 'searchadsorg' };
let keys = 0;

/** A key Apple Ads would know, a new one each time so no token is shared between tests. */
function adsKey(): AppleAdsKey {
  keys += 1;
  const privateKeyPem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { clientId: `SEARCHADS.client-${keys}`, teamId: `SEARCHADS.team-${keys}`, keyId: `key-${keys}`, privateKeyPem };
}

const isToken = (request: Sent) => request.url === 'https://appleid.apple.com/auth/oauth2/token';
const isQuery = (request: Sent) => request.url === 'https://api.ads.apple.com/v1/insights/apps/search-term-popularity/query';

test('popularity is asked with a client secret traded for an access token, and scoped to the ad account', async () => {
  const key = adsKey();
  const apple = fakeAppleAds((request) => (isToken(request) ? { body: TOKEN } : { body: WEEKLY_US }));
  try {
    const found = await fetchPopularity(key, { id: '123456789' }, 'US', ['task manager', 'to do list app', 'focus timer'], { day: '2026-11-15', at: 9 });
    assert.equal(apple.sent.length, 2);
    const [token, query] = apple.sent;

    assert.equal(token.method, 'POST');
    assert.equal(token.headers['content-type'], 'application/x-www-form-urlencoded');
    const form = new URLSearchParams(token.body);
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('client_id'), key.clientId);
    assert.equal(form.get('scope'), 'searchadsorg');
    const [header, claims] = (form.get('client_secret') ?? '').split('.').slice(0, 2).map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()));
    assert.deepEqual(header, { alg: 'ES256', kid: key.keyId });
    assert.equal(claims.sub, key.clientId);
    assert.equal(claims.iss, key.teamId);
    assert.equal(claims.aud, 'https://appleid.apple.com');
    assert.ok(claims.exp > claims.iat && claims.exp - claims.iat <= 180 * 86_400);

    assert.equal(query.method, 'POST');
    assert.equal(query.headers.authorization, 'Bearer access-1');
    assert.equal(query.headers['x-ap-context'], 'adAccountId=123456789');
    assert.equal(query.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(query.body), popularityRequest('US', ['task manager', 'to do list app', 'focus timer'], popularityRange('2026-11-15')));

    assert.deepEqual(found.get('task manager')?.points, [{ week: '2025-01-05', score: 88, tier: 5 }]);
    assert.deepEqual(found.get('focus timer')?.points, []);

    // A second request within the hour uses the same access token.
    await fetchPopularity(key, { id: '123456789' }, 'GB', ['task manager'], { day: '2026-11-15' });
    assert.equal(apple.sent.filter(isToken).length, 1);
  } finally {
    apple.restore();
  }
});

test('a refused range is asked again for four weeks, then by month, and the first refusal is told when every one is refused', async () => {
  const key = adsKey();
  const ranges: string[] = [];
  let refuse = 1;
  const apple = fakeAppleAds((request) => {
    if (isToken(request)) return { body: TOKEN };
    ranges.push(JSON.parse(request.body).timeRange.start);
    if (ranges.length <= refuse) return { status: 400, body: { error: { code: 'INVALID_ARGUMENT', message: 'Bad range', details: [{ code: 'INVALID_TIME_RANGE', message: `The time range is too long (${ranges.length})` }] } } };
    return { body: JSON.parse(request.body).timeRange.granularity === 'MONTHLY' ? MONTHLY : WEEKLY_US };
  });
  try {
    const found = await fetchPopularity(key, { id: '1' }, 'US', ['task manager'], { day: '2026-11-15' });
    assert.deepEqual(ranges, ['2026-08-23', '2026-10-18']);
    assert.equal(found.get('task manager')?.points.length, 1);
    assert.equal(found.get('task manager')?.granularity, 'week');

    // Both weekly ranges refused: the months that answer are kept as months.
    ranges.length = 0;
    refuse = 2;
    const monthly = await fetchPopularity(key, { id: '1' }, 'US', ['flight tracker'], { day: '2026-11-15' });
    assert.deepEqual(ranges, ['2026-08-23', '2026-10-18', '2026-08-01']);
    assert.equal(monthly.get('flight tracker')?.granularity, 'month');

    ranges.length = 0;
    refuse = 3;
    await assert.rejects(
      () => fetchPopularity(key, { id: '1' }, 'US', ['task manager'], { day: '2026-11-15' }),
      (error: unknown) => error instanceof AppleAdsError && error.kind === 'request' && error.status === 400 && error.message === 'Apple Ads said: The time range is too long (1)'
    );
    assert.deepEqual(ranges, ['2026-08-23', '2026-10-18', '2026-08-01']);
  } finally {
    apple.restore();
  }
});

test('a key Apple does not know stops at the sign-in, with a sentence that says what to check', async () => {
  const apple = fakeAppleAds(() => ({ status: 400, body: { error: 'invalid_client' } }));
  try {
    await assert.rejects(
      () => fetchPopularity(adsKey(), { id: '1' }, 'US', ['ludo'], { day: '2026-11-15' }),
      (error: unknown) => error instanceof AppleAdsError && error.kind === 'key' && /didn't accept the key/.test(error.message)
    );
    assert.equal(apple.sent.length, 1, 'no other range is tried with a key Apple refused');
  } finally {
    apple.restore();
  }
});

test('a 401 gets a new token once, and a 403 names the role Apple Ads needs', async () => {
  const key = adsKey();
  let tokens = 0;
  let queries = 0;
  const apple = fakeAppleAds((request) => {
    if (isToken(request)) {
      tokens += 1;
      return { body: { ...TOKEN, access_token: `access-${tokens}` } };
    }
    queries += 1;
    return queries === 1 ? { status: 401, body: { error: { errors: [{ messageCode: 'UNAUTHORIZED', message: 'Expired' }] } } } : { body: WEEKLY_US };
  });
  try {
    await fetchPopularity(key, { id: '1' }, 'US', ['task manager'], { day: '2026-11-15' });
    assert.equal(tokens, 2);
    assert.equal(apple.sent.filter(isQuery).at(-1)?.headers.authorization, 'Bearer access-2');
  } finally {
    apple.restore();
  }

  const refused = fakeAppleAds((request) => (isToken(request) ? { body: TOKEN } : { status: 403, body: { error: { code: 'FORBIDDEN', message: 'No access' } } }));
  try {
    await assert.rejects(
      () => fetchPopularity(adsKey(), { id: '1' }, 'US', ['ludo'], { day: '2026-11-15' }),
      (error: unknown) => error instanceof AppleAdsError && error.kind === 'access' && /API Account Read Only/.test(error.message)
    );
  } finally {
    refused.restore();
  }
});

test('a 429 waits as long as Apple asks, then asks again', async () => {
  let queries = 0;
  const apple = fakeAppleAds((request) => {
    if (isToken(request)) return { body: TOKEN };
    queries += 1;
    return queries === 1 ? { status: 429, headers: { 'retry-after': '1', 'ratelimit-remaining': '0' }, body: {} } : { body: WEEKLY_US };
  });
  try {
    const started = Date.now();
    await fetchPopularity(adsKey(), { id: '1' }, 'US', ['task manager'], { day: '2026-11-15' });
    assert.equal(queries, 2);
    assert.ok(Date.now() - started >= 900, 'waited about the second Apple asked for');
  } finally {
    apple.restore();
  }
});

test('checking a key reads the ad accounts it can see, and an account list that is empty says what to do', async () => {
  const apple = fakeAppleAds((request) =>
    isToken(request)
      ? { body: TOKEN }
      : { body: { result: { acls: [{ adAccount: { id: 123456789, name: 'AwayFinder', orgId: 27154130 }, roles: ['Admin'] }, { adAccount: { id: 2 }, roles: [] }] } } }
  );
  try {
    assert.deepEqual(await testAppleAdsKey(adsKey()), [
      { id: '123456789', name: 'AwayFinder', roles: ['Admin'] },
      { id: '2', name: 'Ad account 2', roles: [] },
    ]);
    const acls = apple.sent.find((request) => request.url === 'https://api.ads.apple.com/v1/acls');
    assert.equal(acls?.method, 'GET');
    // The account list is read before an account is known: no X-AP-Context.
    assert.equal(acls?.headers['x-ap-context'], undefined);
  } finally {
    apple.restore();
  }

  const empty = fakeAppleAds((request) => (isToken(request) ? { body: TOKEN } : { body: { result: { acls: [] } } }));
  try {
    await assert.rejects(() => testAppleAdsKey(adsKey()), (error: unknown) => error instanceof AppleAdsError && error.kind === 'account');
  } finally {
    empty.restore();
  }
});

test('the three ids are read from the lines Apple Ads shows, from JSON, and from "name: value" lines', () => {
  // As Apple's guide prints them after the public key is saved.
  const block = 'clientId SEARCHADS.aeb3ef5f-0c5a-4f2a-99c8-fca83f25a9\nteamId SEARCHADS.hgw3ef3p-0w7a-8a2n-77c8-scv83f25a7\nkeyId a273d0d3-4d9e-458c-a173-0db8619ca7d7';
  const ids = parseAppleAdsIds(block);
  assert.deepEqual(ids, {
    clientId: 'SEARCHADS.aeb3ef5f-0c5a-4f2a-99c8-fca83f25a9',
    teamId: 'SEARCHADS.hgw3ef3p-0w7a-8a2n-77c8-scv83f25a7',
    keyId: 'a273d0d3-4d9e-458c-a173-0db8619ca7d7',
  });
  assert.ok(hasAllIds(ids));
  assert.deepEqual(parseAppleAdsIds('{"clientId": "SEARCHADS.1", "teamId": "SEARCHADS.2", "keyId": "3"}'), { clientId: 'SEARCHADS.1', teamId: 'SEARCHADS.2', keyId: '3' });
  assert.deepEqual(parseAppleAdsIds('Client ID: SEARCHADS.1\nTeam ID: SEARCHADS.2\nKey ID: 3'), { clientId: 'SEARCHADS.1', teamId: 'SEARCHADS.2', keyId: '3' });
  const half = parseAppleAdsIds('clientId SEARCHADS.1');
  assert.deepEqual(half, { clientId: 'SEARCHADS.1' });
  assert.equal(hasAllIds(half), false);
  assert.deepEqual(parseAppleAdsIds(''), {});
});

test("Apple's own words are read from either error shape its servers send", () => {
  assert.equal(appleAdsMessage(JSON.stringify({ error: { code: 'INVALID_ARGUMENT', message: 'Fields failed validation', details: [{ code: 'FIELD_REQUIRED', message: 'genre is required' }] } })), 'genre is required');
  assert.equal(appleAdsMessage(JSON.stringify({ error: { code: 'INVALID_ARGUMENT', message: 'Fields failed validation', details: [] } })), 'Fields failed validation');
  // The shape Apple sent for a request with no token on 2026-11-15.
  assert.equal(appleAdsMessage('{"data":null,"pagination":null,"error":{"errors":[{"messageCode":"UNAUTHORIZED","message":"No authentication header provided","field":""}]}}'), 'No authentication header provided');
  assert.equal(appleAdsMessage(JSON.stringify({ error: 'invalid_client' })), 'invalid_client');
  assert.equal(appleAdsMessage('<html>Bad gateway</html>'), null);
});

test('an answer in another shape is an error that says so, never "no score" for every keyword', async () => {
  let queries = 0;
  const apple = fakeAppleAds((request) => {
    if (isToken(request)) return { body: TOKEN };
    queries += 1;
    return { body: { data: { rows: [] } } };
  });
  try {
    await assert.rejects(
      () => fetchPopularity(adsKey(), { id: '1' }, 'US', ['ludo'], { day: '2026-11-15' }),
      (error: unknown) => error instanceof AppleAdsError && error.kind === 'request' && /couldn't read/.test(error.message)
    );
    assert.equal(queries, 1, 'no shorter range is tried for an answer Growth cannot read');
  } finally {
    apple.restore();
  }

  const accounts = fakeAppleAds((request) => (isToken(request) ? { body: TOKEN } : { body: { data: [{ orgId: 1, orgName: 'Old shape' }] } }));
  try {
    await assert.rejects(() => testAppleAdsKey(adsKey()), (error: unknown) => error instanceof AppleAdsError && error.kind === 'request' && /couldn't read/.test(error.message));
  } finally {
    accounts.restore();
  }
});

test('a period in words: a week by its first day, a month by its name', () => {
  assert.equal(periodWords('2026-11-08', 'week', { withYear: false }), 'Week of Nov 8');
  assert.equal(periodWords('2026-11-08', undefined, { withYear: true }), 'Week of Nov 8, 2026');
  assert.equal(periodWords('2026-10-01', 'month'), 'Oct 2026');
  assert.equal(sinceWords('2026-10-11', 'week'), 'since the week of Oct 11');
  assert.equal(sinceWords('2026-09-01', 'month'), 'since Sep 2026');
});
