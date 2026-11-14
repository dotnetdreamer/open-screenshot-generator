// Growth's ratings and reviews: the ratings history and the new ratings it
// works out, the star counts and reviews on a Google Play page, Apple's
// public reviews feed, the review inbox (states, filters, tags, templates,
// carried rating changes, reply numbers, CSV), the review summary's checks
// on the AI's answer, and the new review alerts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readPlayPage, readPlayReviews } from '@/lib/growth/playPage';
import { mergePublicReviews, readReviewFeed, type PublicReview } from '@/lib/growth/publicReviews';
import {
  countryRows,
  mergePoint,
  ratingBuckets,
  reviewBuckets,
  stepsOf,
  versionRatings,
  withReadings,
} from '@/lib/growth/ratingHistory';
import { isSlackWebhook, newReviews, slackMessage, wanted } from '@/lib/growth/reviewAlerts';
import {
  DEFAULT_FILTER,
  carryReviewHistory,
  changeAfterReply,
  fillTemplate,
  filterReviews,
  markedDone,
  replyStats,
  reviewerName,
  reviewsCsv,
  statusCounts,
  statusOf,
  toggledTag,
  withTag,
} from '@/lib/growth/reviewInbox';
import { MAX_SUMMARY_REVIEWS, readSummaryAnswer, summaryLines, themeStars, type SummaryReview } from '@/lib/growth/reviewSummary';
import type { RatingDay, RatingPoint, ReviewMark, StoreReview, TerritoryRating } from '@/lib/growth/types';

const APP = '6797975644';

function day(appId: string, date: string, territories: Record<string, Partial<RatingPoint> & { average: number; count: number | null }>): RatingDay {
  const full: Record<string, RatingPoint> = {};
  for (const [code, point] of Object.entries(territories)) full[code] = { at: Date.parse(`${date}T12:00:00Z`), ...point };
  return { key: `${appId}|${date}`, appId, date, territories: full };
}

function review(id: string, overrides: Partial<StoreReview> = {}): StoreReview {
  return {
    id,
    appId: APP,
    rating: 5,
    title: `Title ${id}`,
    body: `Body of ${id}`,
    nickname: 'Mia',
    createdDate: '2026-11-10T10:00:00Z',
    territory: 'US',
    ...overrides,
  };
}

// --- the ratings history ---------------------------------------------------------------

test('new ratings per star are the difference of two readings of the store page, and exact', () => {
  const steps = stepsOf(
    [
      { date: '2026-11-13', point: { average: 4.6, count: 2300, stars: [100, 60, 140, 400, 1600], at: 1 } },
      { date: '2026-11-14', point: { average: 4.6, count: 2310, stars: [101, 60, 141, 402, 1606], at: 2 } },
    ],
    'US'
  );
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].newStars, [1, 0, 1, 2, 6]);
  assert.equal(steps[0].newCount, 10);
  assert.equal(steps[0].newSum, 1 + 3 + 8 + 30);
  assert.equal(steps[0].since, '2026-11-13');
});

test('without stars, a small app gets the average of its new ratings from the two averages', () => {
  const [step] = stepsOf(
    [
      { date: '2026-11-13', point: { average: 4.5, count: 20, at: 1 } },
      { date: '2026-11-14', point: { average: 4.40909, count: 22, at: 2 } },
    ],
    'PK'
  );
  assert.equal(step.newCount, 2);
  // 4.40909 * 22 - 4.5 * 20 = 7.0: two ratings of 3.5 on average, within Apple's rounding.
  assert.ok(Math.abs(step.newSum! / step.newCount - 3.5) < 0.01);
});

test('with millions of ratings, Apple’s rounded average is too rough for the new ratings, so they get no average', () => {
  const [step] = stepsOf(
    [
      { date: '2026-11-13', point: { average: 4.69054, count: 29_712_923, at: 1 } },
      { date: '2026-11-14', point: { average: 4.69055, count: 29_713_923, at: 2 } },
    ],
    'US'
  );
  assert.equal(step.newCount, 1000);
  assert.equal(step.newSum, null);
});

test('a count that falls below half is a reset, and a small fall is not new ratings', () => {
  const [reset] = stepsOf(
    [
      { date: '2026-11-01', point: { average: 4.1, count: 900, at: 1 } },
      { date: '2026-11-02', point: { average: 4.8, count: 12, at: 2 } },
    ],
    'US'
  );
  assert.equal(reset.reset, true);
  assert.equal(reset.newCount, 12);
  const [fall] = stepsOf(
    [
      { date: '2026-11-01', point: { average: 4.1, count: 900, at: 1 } },
      { date: '2026-11-02', point: { average: 4.1, count: 895, at: 2 } },
    ],
    'US'
  );
  assert.equal(fall.reset, false);
  assert.equal(fall.newCount, 0);
  assert.equal(fall.newSum, null);
});

test('when stars went down and up, the count still gives the new ratings, without per-star counts', () => {
  const [step] = stepsOf(
    [
      { date: '2026-11-01', point: { average: 4, count: 10, stars: [1, 1, 1, 3, 4], at: 1 } },
      { date: '2026-11-02', point: { average: 4.2, count: 11, stars: [0, 1, 1, 3, 6], at: 2 } },
    ],
    'US'
  );
  assert.equal(step.newCount, 1);
  assert.equal(step.newStars, null);
});

test('a reading merges into the day: the lookup and the page each bring their fields, and stale stars go', () => {
  const lookup: RatingPoint = { average: 4.6, count: 2310, version: '2.4', at: 1 };
  const page: RatingPoint = { average: 4.6, count: 2310, stars: [101, 60, 141, 402, 1606], at: 2 };
  const merged = mergePoint(lookup, page);
  assert.equal(merged.version, '2.4');
  assert.deepEqual(merged.stars, [101, 60, 141, 402, 1606]);
  // A later lookup with another count drops the stars read for the old count.
  const later = mergePoint(merged, { average: 4.6, count: 2312, at: 3 });
  assert.equal(later.stars, undefined);
  // Google Play's files bring no count; the page's count stays.
  const play = mergePoint({ average: 4.1, count: 900, at: 1 }, { average: 4.13, count: null, dayAverage: 3.9, at: 2 });
  assert.equal(play.count, 900);
  assert.equal(play.dayAverage, 3.9);
  const row = withReadings(undefined, APP, '2026-11-14', { US: lookup });
  assert.equal(row.key, `${APP}|2026-11-14`);
});

test('buckets add up every country, carry a country’s last reading forward, and split known and unknown stars', () => {
  const rows = [
    day(APP, '2026-11-12', { US: { average: 4.6, count: 2300, stars: [100, 60, 140, 400, 1600] }, GB: { average: 4.5, count: 640 } }),
    // Only the US was read on the 13th: Great Britain stays at its last reading.
    day(APP, '2026-11-13', { US: { average: 4.6, count: 2310, stars: [101, 60, 141, 402, 1606] } }),
    day(APP, '2026-11-14', { GB: { average: 4.5, count: 642 } }),
  ];
  const buckets = ratingBuckets(rows, { territory: 'all', granularity: 'day', window: { from: '2026-11-12', to: '2026-11-14' } });
  assert.deepEqual(
    buckets.map((bucket) => bucket.count),
    [2940, 2950, 2952]
  );
  assert.deepEqual(buckets[1].newStars, [1, 0, 1, 2, 6]);
  assert.equal(buckets[1].newUnknown, 0);
  assert.equal(buckets[2].newCount, 2);
  assert.equal(buckets[2].newStars, null);
  assert.equal(buckets[2].newUnknown, 2);
  // Great Britain's step began on the 12th, before the 14th's bucket starts.
  assert.equal(buckets[2].spansGap, true);
  const weeks = ratingBuckets(rows, { territory: 'US', granularity: 'week', window: { from: '2026-11-09', to: '2026-11-15' } });
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].newCount, 10);
});

test('on Google Play, all countries is the whole app’s row from the files, with the day’s average', () => {
  const play = 'play:com.example.notes';
  const rows = [
    day(play, '2026-11-01', { ZZ: { average: 4.2, count: null, dayAverage: 4.0 }, DE: { average: 4.0, count: null, dayAverage: 3.0 } }),
    day(play, '2026-11-02', { ZZ: { average: 4.21, count: null, dayAverage: 4.5 }, DE: { average: 4.0, count: null } }),
  ];
  const [bucket] = ratingBuckets(rows, { territory: 'all', granularity: 'month', window: { from: '2026-11-01', to: '2026-11-30' } });
  assert.equal(bucket.count, null);
  assert.equal(bucket.average, 4.21);
  assert.equal(bucket.dayAverage, 4.25);
  assert.equal(bucket.newCount, 0);
});

test('the country table takes the newest reading and says how the average moved over the window', () => {
  const rows = [
    day(APP, '2026-10-01', { US: { average: 4.4, count: 2000 } }),
    day(APP, '2026-11-14', { US: { average: 4.6, count: 2310 } }),
  ];
  const current: TerritoryRating[] = [{ key: `${APP}|US`, appId: APP, territory: 'US', average: 4.6, count: 2310, checkedAt: Date.parse('2026-11-14T12:00:00Z') }];
  const [row, ...others] = countryRows(
    [...rows, day(APP, '2026-11-14', { US: { average: 4.6, count: 2310 }, PK: { average: 0, count: 0 } })],
    current,
    { from: '2026-10-16', to: '2026-11-14' }
  );
  // A country with no ratings yet is kept in the history, not shown in the table.
  assert.deepEqual(others, []);
  assert.equal(row.territory, 'US');
  assert.equal(row.newCount, 310);
  assert.ok(Math.abs(row.change! - 0.2) < 1e-9);
});

test('new ratings are put to the version on sale when they were read', () => {
  const rows = [
    day(APP, '2026-11-01', { US: { average: 4, count: 100, stars: [10, 5, 10, 25, 50], version: '2.3' } }),
    day(APP, '2026-11-05', { US: { average: 4, count: 110, stars: [10, 5, 10, 25, 60], version: '2.3' } }),
    day(APP, '2026-11-09', { US: { average: 4, count: 114, stars: [14, 5, 10, 25, 60], version: '2.4' } }),
  ];
  const versions = versionRatings(rows);
  assert.deepEqual(
    versions.map((entry) => [entry.version, entry.newCount, entry.newAverage]),
    [
      ['2.4', 4, 1],
      ['2.3', 10, 5],
    ]
  );
});

test('written reviews in buckets count each star', () => {
  const reviews = [review('a', { rating: 5, createdDate: '2026-11-03T08:00:00Z' }), review('b', { rating: 1, createdDate: '2026-11-03T09:00:00Z' }), review('c', { rating: 4, createdDate: '2026-11-10T09:00:00Z', territory: 'DE' })];
  const weeks = reviewBuckets(reviews, { territory: 'all', granularity: 'week', window: { from: '2026-11-02', to: '2026-11-15' } });
  assert.deepEqual(weeks.map((bucket) => bucket.stars), [[1, 0, 0, 0, 1], [0, 0, 0, 1, 0]]);
  assert.equal(weeks[0].average, 3);
  const germany = reviewBuckets(reviews, { territory: 'DE', granularity: 'week', window: { from: '2026-11-02', to: '2026-11-15' } });
  assert.equal(germany[1].count, 1);
  assert.equal(germany[0].count, 0);
});

// --- the store pages ---------------------------------------------------------------------

test('a Google Play page gives the stars per country, one star first, and they add up to its average', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'tests', 'unit', 'fixtures', 'googlePlay', 'ludo-king-us.html'), 'utf8');
  const storefront = readPlayPage(html, 'com.ludo.king', 'US', 1);
  assert.deepEqual(storefront.stars, [1629244, 298231, 417628, 715860, 7277480]);
  const stars = storefront.stars!;
  const total = stars.reduce((sum, value) => sum + value, 0);
  const average = stars.reduce((sum, value, index) => sum + value * (index + 1), 0) / total;
  assert.ok(Math.abs(average - storefront.rating!) < 0.01);
});

/** A Google Play page's review block, in the shape measured on 2026-11-14. */
function playReviewPage(rows: unknown[]): string {
  return `<script>AF_initDataCallback({key: 'ds:10', hash: '7', data:${JSON.stringify([rows, [null, 'token']])}, sideChannel: {}});</script>`;
}

test('a Google Play page gives the twenty reviews it shows, with the reply and the version', () => {
  const html = playReviewPage([
    ['9dae6d07', ['A Google user', [null, 2]], 4, null, 'pretty fun game, a couple of things to fix', [1554781885, 477000000], 2494, ['Gametion', 'Thanks for your feedback!', [1554800000, 0]], null, null, '4.5.0.101'],
    ['895c7742', ['Roger', [null, 2]], 3, null, 'The dice feel scripted.', [1600305335, 829000000], 9799, null, null, null, '5.2.0.163'],
    ['empty', ['Someone', [null, 2]], 5, null, '', [1600305335, 0], 0],
  ]);
  const reviews = readPlayReviews(html, 'com.ludo.king', 'US');
  assert.equal(reviews.length, 2);
  assert.deepEqual(
    { ...reviews[0] },
    {
      id: '9dae6d07',
      appId: 'play:com.ludo.king',
      territory: 'US',
      rating: 4,
      title: '',
      body: 'pretty fun game, a couple of things to fix',
      author: 'A Google user',
      version: '4.5.0.101',
      date: new Date(1554781885 * 1000).toISOString(),
      helpful: 2494,
      reply: { body: 'Thanks for your feedback!', date: new Date(1554800000 * 1000).toISOString() },
    }
  );
  assert.equal(readPlayReviews('<html></html>', 'com.ludo.king', 'US').length, 0);
});

// --- Apple's public reviews feed ------------------------------------------------------------

function feedEntry(id: string, rating: string, updated: string, extra: Record<string, unknown> = {}) {
  return {
    author: { uri: { label: 'https://itunes.apple.com/us/reviews/id1' }, name: { label: 'edesland' }, label: '' },
    updated: { label: updated },
    'im:rating': { label: rating },
    'im:version': { label: '455.0.0' },
    id: { label: id },
    title: { label: 'complain' },
    content: { label: 'I can’t change the password.', attributes: { type: 'text' } },
    'im:voteSum': { label: '3' },
    'im:voteCount': { label: '4' },
    ...extra,
  };
}

test('the reviews feed reads each entry, skips one without stars, and takes a single entry too', () => {
  const body = { feed: { entry: [feedEntry('14785061938', '1', '2026-11-13T03:57:47-07:00'), { id: { label: 'app' }, title: { label: 'Instagram' } }] } };
  const [first, ...rest] = readReviewFeed(body, '389801252', 'us');
  assert.equal(rest.length, 0);
  assert.deepEqual(first, {
    id: '14785061938',
    appId: '389801252',
    territory: 'US',
    rating: 1,
    title: 'complain',
    body: 'I can’t change the password.',
    author: 'edesland',
    version: '455.0.0',
    date: '2026-11-13T10:57:47.000Z',
    helpful: 3,
  });
  assert.equal(readReviewFeed({ feed: { entry: feedEntry('1', '5', '2026-11-01T00:00:00Z') } }, '1', 'GB').length, 1);
  // An app with no reviews in a country answers with no entry at all.
  assert.deepEqual(readReviewFeed({ feed: { author: {}, id: { label: 'x' } } }, '1', 'GB'), []);
  assert.throws(() => readReviewFeed({ error: 'x' }, '1', 'GB'));
});

test('reviews read again replace their old copy, newest first', () => {
  const old: PublicReview = { id: '1', appId: '9', territory: 'US', rating: 2, title: '', body: 'old text', author: 'a', date: '2026-11-01T00:00:00.000Z' };
  const fresh: PublicReview = { ...old, rating: 4, body: 'new text' };
  const newer: PublicReview = { ...old, id: '2', date: '2026-11-05T00:00:00.000Z' };
  assert.deepEqual(mergePublicReviews([old], [fresh, newer]).map((entry) => [entry.id, entry.rating]), [['2', 2], ['1', 4]]);
});

// --- the review inbox ------------------------------------------------------------------------

test('a review is to do, replied, or needs no reply', () => {
  const plain = review('a');
  const replied = review('b', { response: { id: 'r', body: 'Thanks', lastModified: '2026-11-11T10:00:00Z', state: 'PENDING_PUBLISH' } });
  const done: ReviewMark = { id: 'c', appId: APP, tags: [], doneAt: 1, updatedAt: 1 };
  assert.equal(statusOf(plain, undefined), 'todo');
  assert.equal(statusOf(replied, undefined), 'replied');
  assert.equal(statusOf(review('c'), done), 'done');
  // A reply wins over the mark: the review was answered after all.
  assert.equal(statusOf({ ...replied, id: 'c' }, done), 'replied');
  assert.deepEqual(statusCounts([plain, replied, review('c')], new Map([['c', done]])), { todo: 1, replied: 1, done: 1, all: 3 });
});

test('marks keep only what they hold, and lose their row when they hold nothing', () => {
  const target = { id: 'a', appId: APP };
  const tagged = toggledTag(undefined, target, 'bug', true)!;
  assert.deepEqual(tagged.tags, ['bug']);
  assert.equal(toggledTag(tagged, target, 'bug', false), null);
  const done = markedDone(tagged, target, true)!;
  assert.ok(done.doneAt);
  assert.deepEqual(done.tags, ['bug']);
  assert.equal(markedDone(undefined, target, false), null);
});

test('the filter goes by state, stars, tag, text in the reply too, and keeps a review just answered in view', () => {
  const reviews = [
    review('a', { rating: 1, createdDate: '2026-11-12T10:00:00Z' }),
    review('b', { rating: 5, createdDate: '2026-11-11T10:00:00Z', response: { id: 'r', body: 'We fixed the sync', lastModified: '2026-11-12T10:00:00Z', state: 'PUBLISHED' } }),
    review('c', { rating: 3, createdDate: '2026-11-10T10:00:00Z' }),
  ];
  const marks = new Map<string, ReviewMark>([['c', { id: 'c', appId: APP, tags: ['bug'], updatedAt: 1 }]]);
  const ids = (filter: Partial<typeof DEFAULT_FILTER>, options = {}) => filterReviews(reviews, marks, { ...DEFAULT_FILTER, ...filter }, 'newest', { now: '2026-11-14', ...options }).map((entry) => entry.id);
  assert.deepEqual(ids({}), ['a', 'c']);
  assert.deepEqual(ids({}, { keep: new Set(['b']) }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ status: 'all', tag: 'bug' }), ['c']);
  assert.deepEqual(ids({ status: 'all', tag: 'none' }), ['a', 'b']);
  assert.deepEqual(ids({ status: 'all', query: 'fixed the sync' }), ['b']);
  assert.deepEqual(ids({ status: 'all', stars: 'low' }), ['a']);
  assert.deepEqual(ids({ status: 'all', ids: ['c', 'a'] }), ['a', 'c']);
  assert.deepEqual(filterReviews(reviews, marks, { ...DEFAULT_FILTER, status: 'all' }, 'lowest').map((entry) => entry.id), ['a', 'c', 'b']);
  assert.deepEqual(filterReviews(reviews, marks, { ...DEFAULT_FILTER, status: 'all' }, 'oldest').map((entry) => entry.id), ['c', 'b', 'a']);
});

test('a refresh carries the rating changes over, and records a new one with the store’s new date', () => {
  const stored = review('a', { rating: 2, createdDate: '2026-11-01T10:00:00Z', response: { id: 'r', body: 'Sorry, fixed in 2.5', lastModified: '2026-11-02T10:00:00Z', state: 'PUBLISHED' } });
  const fresh = { ...stored, rating: 5, createdDate: '2026-11-04T10:00:00Z' };
  const carried = carryReviewHistory(stored, fresh, 99);
  assert.deepEqual(carried.ratingChanges, [{ from: 2, to: 5, at: Date.parse('2026-11-04T10:00:00Z') }]);
  // A refresh with the same stars keeps the list as it is.
  assert.deepEqual(carryReviewHistory(carried, { ...fresh }).ratingChanges, carried.ratingChanges);
  // A store that keeps the date gets the time the refresh saw it.
  assert.equal(carryReviewHistory(stored, { ...stored, rating: 3 }, 1234).ratingChanges![0].at, 1234);
  assert.deepEqual(changeAfterReply(carried), { from: 2, to: 5, at: Date.parse('2026-11-04T10:00:00Z') });
  assert.equal(changeAfterReply({ ...carried, response: undefined }), null);
});

test('the reply numbers: share with a reply, the middle time, what waits, and stars after a reply', () => {
  const reply = (at: string) => ({ id: 'r', body: 'Thanks', lastModified: at, state: 'PUBLISHED' });
  const reviews = [
    review('a', { createdDate: '2026-11-10T10:00:00Z', response: reply('2026-11-10T12:00:00Z') }),
    review('b', { createdDate: '2026-11-10T10:00:00Z', response: reply('2026-11-11T10:00:00Z') }),
    review('c', { createdDate: '2026-11-10T10:00:00Z', response: reply('2026-11-13T10:00:00Z'), rating: 4, ratingChanges: [{ from: 1, to: 4, at: Date.parse('2026-11-14T10:00:00Z') }] }),
    review('d', { createdDate: '2026-11-08T10:00:00Z' }),
    review('e', { createdDate: '2026-09-01T10:00:00Z' }),
  ];
  const stats = replyStats(reviews, new Map(), { from: '2026-11-01', to: '2026-11-14' });
  assert.equal(stats.reviews, 4);
  assert.equal(stats.replied, 3);
  assert.equal(stats.medianHours, 24);
  assert.equal(stats.waiting, 2);
  assert.equal(stats.oldestWaiting, '2026-09-01');
  assert.equal(stats.raised, 1);
  assert.equal(stats.lowered, 0);
});

test('a template fills the name and the app, and reads well without a name', () => {
  assert.equal(fillTemplate('Hi {name}, thanks for trying {app}!', { name: 'Mia', app: 'Ludo Wala' }), 'Hi Mia, thanks for trying Ludo Wala!');
  assert.equal(fillTemplate('Hi {name}, thanks for trying {app}!', { name: '', app: 'Ludo Wala' }), 'Hi, thanks for trying Ludo Wala!');
  assert.equal(reviewerName({ nickname: 'A Google user' }), '');
  assert.equal(reviewerName({ nickname: ' Mia ' }), 'Mia');
});

test('a new tag takes the next free colour, and a name already there is that tag', () => {
  const first = withTag([], '  Feature   request ', 'tag-1');
  assert.deepEqual(first.tag, { id: 'tag-1', name: 'Feature request', color: '1' });
  const second = withTag(first.tags, 'Bug', 'tag-2');
  assert.equal(second.tag!.color, '2');
  const again = withTag(second.tags, 'feature request', 'tag-3');
  assert.equal(again.tag!.id, 'tag-1');
  assert.equal(again.tags, second.tags);
  assert.equal(withTag([], '   ').tag, null);
});

test('the CSV has a row per review, quotes what needs quotes, and never starts a cell with a formula', () => {
  const reviews = [
    review('a', { title: '=HYPERLINK("http://example.com")', body: 'Line one\nline "two", three', rating: 1, ratingChanges: [{ from: 1, to: 2, at: 1 }] }),
    review('b', { appId: 'play:com.example.notes', territory: 'ZZ', language: 'de', title: '', body: 'Gut', rating: 4 }),
  ];
  const marks = new Map<string, ReviewMark>([['a', { id: 'a', appId: APP, tags: ['t1'], updatedAt: 1 }]]);
  const csv = reviewsCsv(reviews, marks, [{ id: 't1', name: 'Bug', color: '1' }], (appId) => (appId === APP ? 'Ludo Wala' : 'Notes'));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Date,App,Store,Country or language,Stars,Stars before,Title,Review,Reviewer,Version,Tags,Topics,Status,Reply,Reply date');
  assert.ok(csv.includes(`"'=HYPERLINK(""http://example.com"")"`));
  assert.ok(csv.includes('"Line one\nline ""two"", three"'));
  assert.ok(csv.includes(',Bug,'));
  assert.ok(lines.some((line) => line.startsWith('2026-11-10,Notes,Google Play,German,4,')));
});

// --- the review summary ----------------------------------------------------------------------

function summaryReviews(count: number): SummaryReview[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `review-${index}`,
    rating: (index % 5) + 1,
    title: '',
    body: `Review number ${index}`,
    place: 'United States',
    date: new Date(Date.UTC(2026, 10, 1) + index * 3_600_000).toISOString(),
  }));
}

test('the summary reads the newest reviews, each with a short id', () => {
  const { lines, byShortId } = summaryLines(summaryReviews(MAX_SUMMARY_REVIEWS + 50));
  assert.equal(lines.length, MAX_SUMMARY_REVIEWS);
  assert.equal(byShortId.get('r1')!.id, `review-${MAX_SUMMARY_REVIEWS + 49}`);
  assert.ok(lines[0].startsWith('[r1], '));
});

test('the AI’s themes keep only reviews it was given, once each, biggest theme first', () => {
  const { byShortId } = summaryLines(summaryReviews(10));
  const answer = `Here you go:\n\`\`\`json\n${JSON.stringify({
    headline: 'People like the board and miss online play',
    liked: [
      { theme: 'The 3D board', detail: 'People like how the board looks.', reviews: ['r1', 'r2', 'r2', 'r99'] },
      { theme: 'Made up', detail: 'Nothing.', reviews: ['r404'] },
      { theme: 'Quick games', detail: 'Games are short.', reviews: ['r3', 'r4', 'r5'] },
    ],
    disliked: [{ theme: 'Ads', detail: 'Too many ads.', reviews: ['r6'] }],
    requests: 'not a list',
    ideas: ['"A board that pops"!', 'x'.repeat(80)],
  })}\n\`\`\``;
  const result = readSummaryAnswer(answer, byShortId);
  assert.equal(result.headline, 'People like the board and miss online play');
  assert.deepEqual(result.groups.liked.map((theme) => [theme.theme, theme.reviewIds.length]), [['Quick games', 3], ['The 3D board', 2]]);
  assert.deepEqual(result.groups.liked[1].reviewIds, [byShortId.get('r1')!.id, byShortId.get('r2')!.id]);
  assert.deepEqual(result.groups.requests, []);
  assert.deepEqual(result.ideas, ['A board that pops']);
  const stars = themeStars(result.groups.disliked[0], new Map(Array.from(byShortId.values()).map((entry) => [entry.id, entry])));
  assert.equal(stars.average, byShortId.get('r6')!.rating);
  assert.throws(() => readSummaryAnswer('{"liked": [{"theme": "x", "reviews": ["r77"]}]}', byShortId), /did not sort the reviews/);
  assert.throws(() => readSummaryAnswer('no json here', byShortId));
});

// --- alerts ----------------------------------------------------------------------------------

test('the first look at an app tells about nothing, then only reviews no refresh told about, from the last two weeks', () => {
  const reviews = [review('a', { createdDate: '2026-11-13T10:00:00Z' }), review('b', { createdDate: '2026-11-12T10:00:00Z' }), review('old', { createdDate: '2026-09-01T10:00:00Z' })];
  assert.deepEqual(newReviews(reviews, null, '2026-11-14'), []);
  assert.deepEqual(newReviews(reviews, ['b'], '2026-11-14').map((entry) => entry.id), ['a']);
  assert.equal(wanted(review('x', { rating: 4 }), 'low'), false);
  assert.equal(wanted(review('x', { rating: 2 }), 'low'), true);
  assert.equal(wanted(review('x', { rating: 2 }), 'off'), false);
});

test('Slack gets a webhook of its own kind only, with what reviewers wrote escaped', () => {
  assert.equal(isSlackWebhook('https://hooks.slack.com/services/T000/B000/XXXX'), true);
  assert.equal(isSlackWebhook('https://example.com/services/T000'), false);
  assert.equal(isSlackWebhook('http://hooks.slack.com/services/T000'), false);
  const message = slackMessage('Ludo <Wala>', [review('a', { rating: 2, title: 'Bad & buggy', body: '<script>alert(1)</script>' })]);
  assert.ok(message.startsWith('*Ludo &lt;Wala&gt;* has a new review on App Store'));
  assert.ok(message.includes('★★☆☆☆ *Bad &amp; buggy* (United States)'));
  assert.ok(message.includes('&lt;script&gt;'));
  const many = slackMessage('Notes', Array.from({ length: 7 }, (_, index) => review(`r${index}`)));
  assert.ok(many.endsWith('And 2 more in Open Screenshot Generator'));
});

// --- summaries on a schedule -------------------------------------------------------------------

test('a scheduled summary is due a week (or a month) after the last one of its scope, give or take six hours', async () => {
  const { scheduledScope, summaryDue } = await import('@/lib/growth/reviewSchedule');
  const now = Date.parse('2026-11-14T12:00:00Z');
  const summary = (days: number, writtenAt: number) => ({ scope: { place: 'all', days, stars: 'all' as const }, writtenAt }) as Parameters<typeof summaryDue>[0][number];
  assert.deepEqual(scheduledScope('week'), { place: 'all', days: 7, stars: 'all' });
  assert.equal(summaryDue([], 'week', now), true);
  assert.equal(summaryDue([summary(7, now - 3 * 86_400_000)], 'week', now), false);
  assert.equal(summaryDue([summary(7, now - 7 * 86_400_000 + 3 * 3_600_000)], 'week', now), true);
  // A summary the user asked for with another scope does not count.
  assert.equal(summaryDue([summary(90, now - 3_600_000)], 'week', now), true);
  assert.equal(summaryDue([summary(30, now - 20 * 86_400_000)], 'month', now), false);
});
