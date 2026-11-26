// Growth's Today screen (studio.ts, manualTodos.ts): every app's numbers on
// one page. Each rule here is one the screen's honesty rests on: an app's
// figure is the one its Overview shows, a change is only stated over apps that
// can be compared, currencies are never added together, old numbers stay out
// of the totals, an app keeps its colour, and the lists never key two items
// the same.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '@/lib/growth/dates';
import { EMPTY_GROWTH_DATA, type GrowthData } from '@/lib/growth/loadData';
import { compareWindows, defaultWindow, indexRecords, metricValue } from '@/lib/growth/metrics';
import {
  GOALS,
  LEFT_OUT_DAYS,
  colorSlots,
  goalsAround,
  mapShades,
  studioActivity,
  studioApps,
  studioBrief,
  studioCountries,
  studioFigure,
  studioMilestones,
  studioRating,
  studioSeries,
  studioSummaryText,
  studioTodos,
  type StudioInput,
} from '@/lib/growth/studio';
import { dueWords, localDay, manualCounts, newManualTodo, sortManualTodos, type ManualTodo } from '@/lib/growth/manualTodos';
import type { Counts, DayRecord, FeedId, Insight, StoreReview, TerritoryRating, TimelineEvent } from '@/lib/growth/types';

const TODAY = '2026-11-25';
const NOW = Date.parse(`${TODAY}T15:00:00Z`);

/** One day of an App Store app: Sales and Trends, and App Analytics with page visits. */
function appStoreDay(appId: string, date: string, downloads: number, extra: { proceeds?: Record<string, number>; territory?: string; views?: number } = {}): DayRecord {
  const territory = extra.territory ?? 'US';
  const views = extra.views ?? downloads * 10;
  const counts: Counts = {
    units: downloads,
    firstDownloads: downloads,
    pageViews: views,
    uniquePageViews: views,
    pageDownloads: Math.round(downloads / 2),
    impressions: views * 4,
    uniqueImpressions: views * 4,
    ...(extra.proceeds ? { proceeds: extra.proceeds } : {}),
  };
  const feeds: Partial<Record<FeedId, number>> = { sales: NOW, downloads: NOW, engagement: NOW };
  return { key: `${appId}|${date}`, appId, date, territories: { [territory]: counts }, sources: {}, feeds };
}

/** One day of a Google Play app: installs and store page visits. */
function playDay(appId: string, date: string, installs: number): DayRecord {
  return {
    key: `${appId}|${date}`,
    appId,
    date,
    territories: { BR: { firstDownloads: installs, pageViews: installs * 5, uniquePageViews: installs * 5, pageDownloads: installs } },
    sources: {},
    feeds: { installs: NOW, visits: NOW },
  };
}

/** `count` days ending at `last`, with `downloads(i)` on the i-th day back. */
function days(make: (date: string, back: number) => DayRecord, last: string, count: number): DayRecord[] {
  return Array.from({ length: count }, (_, back) => make(addDays(last, -back), back)).reverse();
}

function input(id: string, name: string, data: Partial<GrowthData>, extra: Partial<StudioInput> = {}): StudioInput {
  return {
    app: { id, name, bundleId: `com.example.${id}` },
    data: { ...EMPTY_GROWTH_DATA, loaded: true, lastSync: NOW - 3_600_000, ...data },
    ...extra,
  };
}

const YESTERDAY = addDays(TODAY, -1);

test("an app's figure on Today is the one its Overview shows, each over its own last days", () => {
  // An App Store app's numbers end yesterday, a Google Play app's four days earlier.
  const apple = days((date, back) => appStoreDay('apple', date, 10 + (back % 3)), YESTERDAY, 120);
  const play = days((date) => playDay('play:com.example.pebble', date, 5), addDays(YESTERDAY, -4), 120);
  const apps = studioApps([input('apple', 'Apple app', { records: apple }), input('play:com.example.pebble', 'Pebble Notes', { records: play })], 28, TODAY);

  for (const [entry, records] of [[apps[0], apple], [apps[1], play]] as const) {
    const window = defaultWindow(records, 28, YESTERDAY);
    assert.deepEqual(entry.window, window, `${entry.app.name} uses the window its Overview uses`);
    const overview = metricValue(compareWindows(indexRecords(records), window).current, 'downloads');
    assert.equal(metricValue(entry.current!, 'downloads'), overview);
  }
  assert.equal(apps[1].window!.to, addDays(YESTERDAY, -4));

  const downloads = studioFigure(apps, 'downloads');
  const sum = apps.reduce((total, entry) => total + (metricValue(entry.current!, 'downloads') ?? 0), 0);
  assert.equal(downloads.value, sum, 'the total adds up the apps');
  assert.deepEqual(downloads.compared.sort(), ['apple', 'play:com.example.pebble']);
});

test('a change is stated over the apps whose history reaches the period before, and names how many', () => {
  const old = days((date) => appStoreDay('old', date, 10), YESTERDAY, 90);
  // Five weeks of numbers: the 28 days before its window are partly before its history.
  const fresh = days((date) => appStoreDay('fresh', date, 30), YESTERDAY, 35);
  const apps = studioApps([input('old', 'Old app', { records: old }), input('fresh', 'New app', { records: fresh })], 28, TODAY);
  const downloads = studioFigure(apps, 'downloads');
  assert.deepEqual(downloads.compared, ['old']);
  assert.deepEqual(downloads.reporting.sort(), ['fresh', 'old']);
  assert.equal(downloads.change, 0, 'the old app alone, flat, is no change');
  assert.equal(downloads.value, 28 * 10 + 28 * 30);
  // With an app left out of the comparison, the sentence at the top states no change.
  const brief = studioBrief(apps, { days: 28, milestones: [], impacts: [], today: TODAY });
  assert.match(brief[0].text, /^Your apps got 1,120 new downloads in the last 28 days\.$/);
});

test('earnings are never added across currencies: the main one is stated and the rest are listed', () => {
  const dollars = days((date) => appStoreDay('a', date, 1, { proceeds: { USD: 10 } }), YESTERDAY, 60);
  const euros = days((date) => appStoreDay('b', date, 1, { proceeds: { EUR: 2 } }), YESTERDAY, 60);
  const apps = studioApps([input('a', 'A', { records: dollars }), input('b', 'B', { records: euros })], 28, TODAY);
  const earnings = studioFigure(apps, 'proceeds');
  assert.equal(earnings.currency, 'USD');
  assert.equal(earnings.value, 280, 'only the dollars, never dollars plus euros');
  assert.deepEqual(earnings.others, { EUR: 56 });
  assert.deepEqual(earnings.parts.map((part) => [part.appId, part.value]), [['a', 280], ['b', 0]]);
});

test('numbers that stop more than three weeks ago stay out of the totals, and an app never refreshed is asked about', () => {
  const current = days((date) => appStoreDay('now', date, 10), YESTERDAY, 60);
  const stale = days((date) => appStoreDay('stale', date, 99), addDays(TODAY, -(LEFT_OUT_DAYS + 2)), 60);
  const apps = studioApps(
    [input('now', 'Current', { records: current }), input('stale', 'Stale', { records: stale }), input('never', 'Never', { lastSync: null })],
    28,
    TODAY
  );
  assert.equal(apps[1].leftOut, 'old-numbers');
  assert.equal(apps[2].leftOut, 'no-numbers');
  assert.equal(studioFigure(apps, 'downloads').value, 280, 'the stale app adds nothing');
  const todos = studioTodos(apps, TODAY);
  assert.ok(todos.some((todo) => todo.id === 'stale:stale' && todo.action.kind === 'refresh'));
  assert.ok(todos.some((todo) => todo.id === 'refresh:never' && todo.action.kind === 'refresh'));
});

test('an app keeps its colour, by the account order, whatever its rank', () => {
  const slots = colorSlots([
    { id: 'a', downloads: 1 },
    { id: 'b', downloads: 500 },
    { id: 'c', downloads: 20 },
  ]);
  assert.deepEqual(Array.from(slots.entries()), [['a', 1], ['b', 2], ['c', 3]]);
  // Past eight apps, the seven with the most downloads keep a colour, still in the account's order.
  const many = colorSlots(Array.from({ length: 10 }, (_, index) => ({ id: `app${index}`, downloads: index === 0 ? 0 : 100 - index })));
  assert.equal(many.get('app0'), 0, 'the smallest folds into Other apps');
  assert.equal(many.get('app9'), 0);
  assert.equal(many.get('app8'), 0);
  assert.equal(many.get('app1'), 1);
  assert.equal(many.get('app7'), 7);
  assert.equal(new Set(Array.from(many.values()).filter(Boolean)).size, 7, 'no two coloured apps share a colour');
});

test('the columns show every day an app has numbers for, and the days past its newest numbers as not in yet', () => {
  const apple = days((date) => appStoreDay('apple', date, 10), YESTERDAY, 80);
  const play = days((date) => playDay('play:x', date, 5), addDays(YESTERDAY, -4), 80);
  const apps = studioApps([input('apple', 'Apple', { records: apple }), input('play:x', 'Play', { records: play })], 28, TODAY);
  const series = studioSeries(apps, 'downloads');
  assert.equal(series.days[0].date, apps[1].window!.from, 'from the earliest window');
  assert.equal(series.days.at(-1)!.date, YESTERDAY);
  // Before the App Store app's own window it still shows its downloads: no dip that never happened.
  assert.equal(series.days[0].values.apple, 10);
  assert.equal(series.completeThrough, addDays(YESTERDAY, -4));
  const last = series.days.at(-1)!;
  assert.equal(last.complete, false);
  assert.deepEqual(last.missing, ['play:x']);
  assert.equal(last.total, 10);
  assert.ok(series.days.filter((day) => day.complete).every((day) => day.total === 15));
});

test('round numbers: the day each was passed, and when the next comes at the recent pace', () => {
  assert.deepEqual(goalsAround(0), { passed: 0, goal: 10 });
  assert.deepEqual(goalsAround(73), { passed: 50, goal: 100 });
  assert.deepEqual(goalsAround(100), { passed: 100, goal: 250 });
  assert.equal(goalsAround(GOALS.at(-1)! * 1.5).goal, GOALS.at(-1)! * 2);

  // 5 a day for 30 days: 150 in all, 100 passed on day 20.
  const records = days((date) => appStoreDay('a', date, 5), YESTERDAY, 30);
  const other = days((date) => appStoreDay('b', date, 1), YESTERDAY, 30);
  const apps = studioApps([input('a', 'A', { records }), input('b', 'B', { records: other })], 28, TODAY);
  const milestones = studioMilestones(apps, TODAY);
  const a = milestones.find((milestone) => milestone.id === 'downloads:a')!;
  assert.equal(a.value, 150);
  assert.equal(a.passed, 100);
  assert.equal(a.passedOn, records[19].date);
  assert.equal(a.goal, 250);
  assert.equal(a.perDay, 5);
  assert.equal(a.daysLeft, 20);
  const all = milestones.find((milestone) => milestone.id === 'downloads:all')!;
  assert.equal(all.value, 180, 'every app together');
  assert.equal(all.perDay, 6);
  // A goal nothing moves towards comes after the ones on their way.
  const still = studioMilestones(studioApps([input('s', 'Still', { records: days((date, back) => appStoreDay('s', date, back > 40 ? 3 : 0), YESTERDAY, 120) })], 28, TODAY), TODAY);
  assert.equal(still[0].daysLeft, null);
  assert.equal(still[0].perDay, 0);
});

test('the map shades by rank, equal counts alike, and nothing for no downloads', () => {
  const shade = mapShades([1, 2, 3, 4, 5, 6, 7, 8, 9, 1000]);
  assert.equal(shade(0), 0);
  assert.equal(shade(1), 1);
  assert.equal(shade(1000), 5, 'one big country does not pale every other one');
  assert.equal(shade(5), 3);
  const ties = mapShades([4, 4, 4, 9]);
  assert.equal(ties(4), ties(4));
  assert.equal(ties(4), 4);
  assert.equal(mapShades([7])(7), 5);
});

test('countries add up across apps, with a change only where the period before is covered', () => {
  const a = days((date) => appStoreDay('a', date, 4, { territory: 'DE' }), YESTERDAY, 80);
  const b = days((date) => appStoreDay('b', date, 2, { territory: 'DE' }), YESTERDAY, 20);
  const apps = studioApps([input('a', 'A', { records: a }), input('b', 'B', { records: b })], 28, TODAY);
  const [germany] = studioCountries(apps);
  assert.equal(germany.territory, 'DE');
  assert.equal(germany.downloads, 4 * 28 + 2 * 20);
  assert.equal(germany.change, 0, 'only the app with a period before is compared');
  assert.equal(germany.share, 1);
});

test('reviews waiting count the ones with no reply and not marked done, oldest first', () => {
  const review = (id: string, rating: number, daysAgo: number, replied = false): StoreReview => ({
    id,
    appId: 'a',
    rating,
    title: `Review ${id}`,
    body: 'Text',
    nickname: 'x',
    createdDate: `${addDays(TODAY, -daysAgo)}T10:00:00Z`,
    territory: 'US',
    ...(replied ? { response: { id: `${id}r`, body: 'Thanks', lastModified: TODAY, state: 'PUBLISHED' } } : {}),
  });
  const reviews = [review('1', 1, 9), review('2', 5, 2), review('3', 2, 1, true), review('4', 4, 30)];
  const marks = new Map([['4', { id: '4', appId: 'a', tags: [], doneAt: NOW, updatedAt: NOW }]]);
  const [app] = studioApps([input('a', 'A', { reviews }, { marks })], 28, TODAY);
  assert.equal(app.waiting, 2);
  assert.equal(app.waitingLow, 1);
  assert.equal(app.oldestWaiting?.slice(0, 10), addDays(TODAY, -9));
  const todo = studioTodos([app], TODAY).find((entry) => entry.id === 'reviews:a')!;
  assert.equal(todo.title, 'Answer 2 reviews');
  assert.equal(todo.detail, 'The oldest has waited 9 days. 1 with 1 or 2 stars.');
  // The insight that says the same thing is not listed twice.
  const insight = (id: string, kind: string): Insight => ({ id, appId: 'a', kind, category: 'reviews', tone: 'warning', title: kind, body: '', date: TODAY, weight: 80 });
  const [withCards] = studioApps([input('a', 'A', { reviews }, { marks, insights: [insight('u', 'unanswered'), insight('t', 'rating-drop')] })], 28, TODAY);
  const ids = studioTodos([withCards], TODAY).map((entry) => entry.id);
  assert.ok(!ids.includes('insight:a:u'));
  assert.ok(ids.includes('insight:a:t'));
});

test('what is new: recent reviews and uploads, with real times only where the app stored one that day, and no two items keyed alike', () => {
  const upload = (id: string, appId: string, date: string, createdAt: number): TimelineEvent => ({
    id,
    appId,
    date,
    kind: 'screenshots',
    title: 'New screenshots',
    origin: 'publish',
    createdAt,
    screenshotCount: 6,
  });
  const good = (appId: string): Insight => ({ id: 'proceeds:2026-11-23', appId, kind: 'proceeds', category: 'revenue', tone: 'good', title: 'Earnings up', body: '', date: '2026-11-23', weight: 60 });
  const events = [upload('e1', 'a', addDays(TODAY, -2), Date.parse(`${addDays(TODAY, -2)}T09:00:00Z`)), upload('e2', 'a', addDays(TODAY, -20), NOW)];
  const apps = studioApps(
    [
      input('a', 'A', { events, reviews: [{ id: 'r1', appId: 'a', rating: 5, title: 'Lovely', body: 'Yes', nickname: 'n', createdDate: `${addDays(TODAY, -20)}T10:00:00Z`, territory: 'US' }] }, { insights: [good('a')] }),
      input('b', 'B', {}, { insights: [good('b')] }),
    ],
    28,
    TODAY
  );
  const items = studioActivity(apps, [], TODAY);
  const ids = items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'every item has its own key, though both apps have an insight of the same id');
  assert.ok(!ids.includes('review:r1'), 'a review older than two weeks is not news');
  const fresh = items.find((item) => item.id === 'event:e1')!;
  assert.equal(fresh.exact, true);
  assert.equal(fresh.title, '6 new screenshots uploaded');
  // Stored weeks after its day: only the day is known, so it is not "just now".
  const late = items.find((item) => item.id === 'event:e2')!;
  assert.equal(late.exact, false);
  assert.equal(late.at, Date.parse(`${addDays(TODAY, -20)}T12:00:00Z`));
});

test('the sentences at the top: what moved since the screenshots went live, never that they moved it, and three at most', () => {
  const records = days((date) => appStoreDay('a', date, 10), YESTERDAY, 90);
  const ratings: TerritoryRating[] = [{ key: 'a|US', appId: 'a', territory: 'US', average: 4.5, count: 120, checkedAt: NOW }];
  const apps = studioApps([input('a', 'Juniper', { records, ratings, reviews: [] })], 28, TODAY);
  const impact = {
    appId: 'a',
    event: { id: 's', appId: 'a', date: '2026-11-01', kind: 'screenshots' as const, title: 't', origin: 'publish' as const, createdAt: NOW },
    impact: { measure: 'conversion', change: 0.19, verdict: 'better', liveDate: '2026-11-04' } as never,
  };
  const milestones = studioMilestones(apps, TODAY);
  const brief = studioBrief(apps, { days: 28, milestones, impacts: [impact], today: TODAY });
  assert.ok(brief.length <= 3);
  const shots = brief.find((line) => line.text.startsWith('In Juniper'))!;
  assert.equal(shots.text, 'In Juniper, the download rate is up 19% since the new screenshots went live on Nov 4.');
  assert.ok(!/lift|because|thanks to|caused/i.test(brief.map((line) => line.text).join(' ')));
  for (const line of brief) for (const word of line.strong) assert.ok(line.text.includes(word), `"${word}" is in "${line.text}"`);
  assert.equal(studioRating(apps).average, 4.5);
});

test('the copied summary has the sentences, the totals with their comparison, and each app, with no currencies added together', () => {
  const dollars = days((date) => appStoreDay('a', date, 10, { proceeds: { USD: 3 } }), YESTERDAY, 60);
  const euros = days((date) => appStoreDay('b', date, 5, { proceeds: { EUR: 1 } }), YESTERDAY, 20);
  const apps = studioApps([input('a', 'Alpha', { records: dollars }), input('b', 'Beta', { records: euros })], 28, TODAY);
  const figures = {
    downloads: studioFigure(apps, 'downloads'),
    pageViews: studioFigure(apps, 'pageViews'),
    rate: studioFigure(apps, 'rate'),
    proceeds: studioFigure(apps, 'proceeds'),
  };
  const brief = studioBrief(apps, { days: 28, milestones: [], impacts: [], today: TODAY });
  const text = studioSummaryText({ title: 'My apps', brief, apps, figures, rating: studioRating(apps), days: 28 });
  const lines = text.split('\n');
  assert.equal(lines[0], 'My apps');
  assert.ok(lines.includes(brief[0].text));
  assert.ok(lines.includes('New downloads, last 28 days: 380 (+0%, 1 of 2 apps compared)'), text);
  assert.ok(lines.includes('Earnings, last 28 days: $84.00 (+0%, 1 of 2 apps compared), plus 1 other currency'), text);
  assert.deepEqual(lines.slice(-2), ['Alpha: 280 new downloads', 'Beta: 100 new downloads']);
});

test("the rating is weighted by counts only when every app has one: a Google Play average without a count is never left out", () => {
  const counted: TerritoryRating[] = [{ key: 'a|US', appId: 'a', territory: 'US', average: 5, count: 3, checkedAt: NOW }];
  const other: TerritoryRating[] = [{ key: 'b|US', appId: 'b', territory: 'US', average: 4, count: 1, checkedAt: NOW }];
  // Google's report files: the whole app's average under ZZ, no count.
  const play: TerritoryRating[] = [{ key: 'play:p|ZZ', appId: 'play:p', territory: 'ZZ', average: 4.6, count: 0, checkedAt: NOW }];
  const both = studioApps([input('a', 'A', { ratings: counted }), input('b', 'B', { ratings: other })], 28, TODAY);
  assert.deepEqual(studioRating(both), { average: 4.75, count: 4, apps: 2, weighted: true });
  const mixed = studioApps([input('a', 'A', { ratings: counted }), input('play:p', 'P', { ratings: play })], 28, TODAY);
  const rating = studioRating(mixed);
  assert.equal(rating.weighted, false);
  assert.equal(rating.count, null);
  assert.ok(Math.abs(rating.average! - 4.8) < 1e-9, 'the plain average of 5.0 and 4.6, not the small app alone');
});

test('your own to-dos: open ones by due day, the ticked ones after, and the counts the card leads with', () => {
  const day = TODAY;
  const make = (title: string, due: string | null, doneAt?: number): ManualTodo => ({ ...newManualTodo({ title, appId: null, due }, NOW), doneAt });
  const list = [make('later', addDays(day, 9)), make('late', addDays(day, -2)), make('no day', null), make('today', day), make('done', day, NOW - 60_000)];
  assert.deepEqual(sortManualTodos(list, NOW).map((todo) => todo.title), ['late', 'today', 'later', 'no day', 'done']);
  assert.deepEqual(manualCounts(list, day), { open: 4, dueToday: 1, late: 1 });
  assert.deepEqual(dueWords(addDays(day, -2), day), { text: '2 days late', state: 'late' });
  assert.deepEqual(dueWords(addDays(day, -1), day), { text: '1 day late', state: 'late' });
  assert.deepEqual(dueWords(day, day), { text: 'Due today', state: 'today' });
  assert.deepEqual(dueWords(addDays(day, 1), day), { text: 'Due tomorrow', state: 'soon' });
  assert.equal(dueWords(addDays(day, 30), day).state, 'later');
  // A due day is the person's own calendar day: 11:30 pm local is still that day, whatever UTC says.
  assert.equal(localDay(new Date(2026, 10, 25, 23, 30)), '2026-11-25');
  assert.equal(localDay(new Date(2026, 0, 5, 0, 10)), '2026-01-05');
  // Ticked off more than a day ago, a to-do leaves the list.
  assert.equal(sortManualTodos([make('old', null, NOW - 2 * 86_400_000)], NOW).length, 0);
  assert.equal(newManualTodo({ title: `  ${'x'.repeat(200)}  `, appId: null, due: null }).title.length, 140);
});
