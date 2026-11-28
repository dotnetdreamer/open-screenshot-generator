// Uptime's page side (src/lib/uptime/): how numbers and times read, what a
// pasted address becomes, the day bars and outages drawn from the history,
// the overview's headline, and how the store merges what Rust sends. The
// checks themselves are Rust's, tested by `cargo test --lib uptime`.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, monitorFromInput, nameFromUrl } from '@/lib/uptime/detect';
import { copyName, formatDuration, formatInterval, formatMs, formatPercent, storeName, targetText } from '@/lib/uptime/format';
import { addLocalDays, beatSeries, coverMs, dayBars, dayTone, headline, hourSeries, lastBeats, localDay, outagesOf, partlyUnseen, timeIn, timeTicks, uptimeOf } from '@/lib/uptime/stats';
import { applyBeat, downCount, mergeView, SETTINGS_CHANGED } from '@/lib/uptime/store';
import { targetKey } from '@/lib/uptime/suggest';
import { DEFAULT_SETTINGS, newMonitor, type Beat, type Bucket, type Monitor, type Summary, type UptimeEvent, type UptimeView } from '@/lib/uptime/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function bucket(t: number, up: number, down: number, extra: Partial<Bucket> = {}): Bucket {
  return { t, up, down, n: 1, fails: down > 0 ? 1 : 0, sum: 0, cnt: 0, min: 0, max: 0, ...extra };
}

function summary(id: string, extra: Partial<Summary> = {}): Summary {
  return {
    id,
    state: 'up',
    since: 0,
    last: null,
    recent: [],
    next: null,
    running: false,
    fails: 0,
    uptime24: null,
    uptime7: null,
    uptime30: null,
    avg24: null,
    detail: { at: 0 },
    downSince: null,
    downMsg: '',
    version: null,
    revision: 0,
    stamp: 0,
    ...extra,
  };
}

function monitor(id: string, name: string, extra: Partial<Monitor> = {}): Monitor {
  return { ...newMonitor('http'), id, name, url: `https://${id}.example`, ...extra };
}

function view(monitors: Monitor[], summaries: Summary[], extra: Partial<UptimeView> = {}): UptimeView {
  return { loaded: true, monitors, summaries, settings: DEFAULT_SETTINGS, offlineSince: null, deliveries: [], notifications: 'native', now: 0, ...extra };
}

test('a share never reads 100% when there was time down', () => {
  assert.equal(formatPercent(100), '100%');
  assert.equal(formatPercent(99.9999), '99.99%');
  assert.equal(formatPercent(99.5), '99.5%');
  assert.equal(formatPercent(97), '97%');
  assert.equal(formatPercent(null), 'No data');
});

test('times and durations read in words people use', () => {
  assert.equal(formatMs(0.4), 'under 1 ms');
  assert.equal(formatMs(182.4), '182 ms');
  assert.equal(formatMs(1234), '1.2 s');
  assert.equal(formatMs(12_500), '13 s');
  assert.equal(formatDuration(12_000), '12 s');
  assert.equal(formatDuration(4 * 60_000 + 5_000), '4 min');
  assert.equal(formatDuration(HOUR + 5 * 60_000), '1 h 5 min');
  assert.equal(formatDuration(3 * DAY + 4 * HOUR), '3 days 4 h');
  assert.equal(formatDuration(DAY), '1 day');
  assert.equal(formatInterval(60), 'Every minute');
  assert.equal(formatInterval(300), 'Every 5 min');
  assert.equal(formatInterval(20), 'Every 20 s');
});

test('a pasted address becomes the right kind of monitor', () => {
  assert.deepEqual(detect('https://shop.example.com/health'), { kind: 'http', fields: { url: 'https://shop.example.com/health' }, name: 'shop.example.com/health' });
  assert.equal(detect('example.com')?.kind, 'http');
  assert.equal(detect('example.com')?.fields.url, 'https://example.com');
  assert.equal(detect('example.com/status')?.fields.url, 'https://example.com/status');
  assert.deepEqual(detect('db.example.com:5432')?.fields, { host: 'db.example.com', port: 5432 });
  assert.equal(detect('db.example.com:5432')?.kind, 'port');
  // A web port is a website.
  assert.equal(detect('example.com:8080')?.fields.url, 'http://example.com:8080');
  assert.equal(detect('[2001:db8::1]:25565')?.kind, 'port');
  assert.equal(detect('192.168.1.1')?.kind, 'ping');
  assert.equal(detect('2001:db8::1')?.kind, 'ping');
  assert.equal(detect('hello there'), null);
  assert.equal(detect(''), null);
});

test('store links are read with their country', () => {
  const apple = detect('https://apps.apple.com/de/app/ludo-wala/id1234567890?l=en');
  assert.equal(apple?.kind, 'store');
  assert.deepEqual(apple?.fields, { store: 'apple', appId: '1234567890', country: 'de' });
  assert.equal(apple?.name, 'Ludo Wala');
  const plain = detect('https://apps.apple.com/app/id987654321');
  assert.deepEqual(plain?.fields, { store: 'apple', appId: '987654321', country: 'us' });
  const play = detect('https://play.google.com/store/apps/details?id=com.example.app&gl=PK');
  assert.deepEqual(play?.fields, { store: 'google', appId: 'com.example.app', country: 'pk' });
  const filled = monitorFromInput('https://play.google.com/store/apps/details?id=com.example.app');
  assert.equal(filled?.kind, 'store');
  assert.equal(filled?.country, 'us');
});

test('names come from the address without www', () => {
  assert.equal(nameFromUrl('https://www.example.com/'), 'example.com');
  assert.equal(nameFromUrl('https://api.example.com/v1/health/'), 'api.example.com/v1/health');
});

test('the same address counts once whatever its case or slash', () => {
  const a = { ...newMonitor('http'), url: 'https://Example.com/' };
  const b = { ...newMonitor('http'), url: 'https://example.com' };
  assert.equal(targetKey(a), targetKey(b));
  assert.notEqual(targetKey({ ...newMonitor('port'), host: 'db', port: 1 }), targetKey({ ...newMonitor('port'), host: 'db', port: 2 }));
  assert.equal(targetText({ ...newMonitor('port'), host: '::1', port: 22 }), '[::1]:22');
});

test('uptime is time up over time watched, hours with no checks count for nothing', () => {
  const buckets = [bucket(0, 3_000_000, 600_000), bucket(HOUR, 3_600_000, 0), bucket(2 * HOUR, 0, 0)];
  const share = uptimeOf(buckets);
  assert.ok(share !== null && Math.abs(share - (6_600_000 / 7_200_000) * 100) < 1e-9);
  assert.equal(uptimeOf([bucket(0, 0, 0)]), null);
  // Only hours that touch the range.
  assert.equal(uptimeOf(buckets, HOUR, 2 * HOUR), 100);
});

test('day bars run over local days, today last, with empty days kept', () => {
  const now = new Date(2026, 10, 26, 15, 0).getTime();
  const today = localDay(now);
  const yesterday = addLocalDays(today, -1);
  const bars = dayBars([bucket(today + HOUR, HOUR, 0), bucket(yesterday + 2 * HOUR, HOUR / 2, HOUR / 2)], 7, now);
  assert.equal(bars.length, 7);
  assert.equal(bars[6].day, today);
  assert.equal(bars[6].uptime, 100);
  assert.equal(bars[5].uptime, 50);
  assert.equal(bars[0].uptime, null);
  assert.equal(dayTone(100), 'good');
  assert.equal(dayTone(99.5), 'warning');
  assert.equal(dayTone(97), 'serious');
  assert.equal(dayTone(80), 'critical');
  assert.equal(dayTone(null), 'empty');
});

test('outages pair a down with the next up, and one still going ends now', () => {
  const events: UptimeEvent[] = [
    { id: 'm1', t: 1000, kind: 'down', msg: 'No answer within 10 seconds', why: 'timeout' },
    { id: 'm1', t: 61_000, kind: 'up', dur: 60_000, seen: 60_000 },
    { id: 'm1', t: 70_000, kind: 'paused' },
    { id: 'm1', t: 100_000, kind: 'down', msg: 'The page answered 503 Service Unavailable', why: 'status' },
  ];
  const outages = outagesOf(events, 160_000);
  assert.equal(outages.length, 2);
  assert.equal(outages[0].start, 100_000);
  assert.equal(outages[0].end, null);
  assert.equal(outages[0].length, 60_000);
  assert.equal(outages[1].length, 60_000);
  assert.equal(outages[1].msg, 'No answer within 10 seconds');
  // An up with no down in the history (it was trimmed) still makes one.
  const lonely = outagesOf([{ id: 'm1', t: 50_000, kind: 'up', dur: 20_000 }], 60_000);
  assert.equal(lonely[0].start, 30_000);
});

test('an outage seen only in part says so', () => {
  const watched = monitor('a', 'A', { interval: 60, retryInterval: 20, timeout: 10 });
  const base = { start: 0, end: 10 * HOUR, length: 10 * HOUR, why: '', msg: '' };
  assert.equal(partlyUnseen({ ...base, seen: 10 * HOUR - 30_000 }, watched), false);
  assert.equal(partlyUnseen({ ...base, seen: HOUR }, watched), true);
  // The live case: 138 seconds closed in an outage of a monitor checked every minute.
  assert.equal(partlyUnseen({ start: 0, end: 519_000, length: 519_000, seen: 381_000, why: '', msg: '' }, watched), true);
  assert.equal(partlyUnseen({ ...base, seen: null }, watched), false);
});

test('hour points keep the gaps', () => {
  const points = hourSeries([bucket(HOUR, HOUR, 0, { sum: 300, cnt: 3, min: 50, max: 200 })], 0, 3 * HOUR);
  assert.equal(points.length, 3);
  assert.equal(points[0].ms, null);
  assert.equal(points[1].ms, 100);
  assert.equal(points[1].min, 50);
  assert.equal(points[2].ms, null);
});

test('the bars pad the front when there are fewer checks', () => {
  const beats: Beat[] = [{ t: 1, s: 'up' }, { t: 2, s: 'down' }];
  const padded = lastBeats(beats, 4);
  assert.deepEqual(padded.map((beat) => beat?.s ?? null), [null, null, 'up', 'down']);
  assert.equal(lastBeats([...beats, { t: 3, s: 'up' }], 2)[0]?.t, 2);
});

test('the headline puts down first, then checking again, then certificates', () => {
  const now = 1_000 * DAY;
  const monitors = [monitor('a', 'Shop'), monitor('b', 'API')];
  assert.equal(headline([], [], now, null).tone, 'quiet');
  assert.equal(headline(monitors, [summary('a'), summary('b')], now, null).title, 'All 2 monitors are up');
  const one = headline(monitors, [summary('a', { state: 'down', downMsg: 'The server refused the connection' }), summary('b')], now, null);
  assert.equal(one.tone, 'critical');
  assert.equal(one.title, 'Shop is down');
  assert.equal(one.detail, 'The server refused the connection');
  assert.equal(headline(monitors, [summary('a', { state: 'down' }), summary('b', { state: 'down' })], now, null).title, '2 monitors are down');
  assert.equal(headline(monitors, [summary('a', { state: 'pending' }), summary('b')], now, null).tone, 'warning');
  const cert = headline(monitors, [summary('a', { detail: { at: 0, cert: { expires: now + 5 * DAY + 1000, issued: 0, issuer: 'R11', subject: 'shop' } } }), summary('b')], now, null);
  assert.equal(cert.title, 'The certificate for Shop runs out in 5 days');
  assert.equal(headline(monitors, [summary('a', { state: 'down' }), summary('b')], now, now - 1000).title, 'This computer is offline');
  assert.equal(headline([monitor('a', 'Shop', { paused: true })], [summary('a', { state: 'paused' })], now, null).title, 'Every monitor is paused');
  assert.equal(headline(monitors, [summary('a', { state: 'unknown' }), summary('b', { state: 'unknown' })], now, null).title, 'Starting the first checks');
});

test('a whole view keeps a newer check that landed while it was on its way', () => {
  const monitors = [monitor('a', 'Shop'), monitor('b', 'API')];
  // Rust stamps every change, so the stamps give the order things happened in.
  const held = view(monitors, [summary('a', { last: { t: 200, s: 'down' }, state: 'down', stamp: 5 }), summary('b', { last: { t: 100, s: 'up' }, stamp: 2 })]);
  const incoming = view(monitors, [summary('a', { last: { t: 150, s: 'up' }, state: 'up', stamp: 4 }), summary('b', { last: { t: 300, s: 'up' }, stamp: 6 })], { now: 400 });
  const merged = mergeView(held, incoming);
  assert.equal(merged.summaries[0].state, 'down');
  assert.equal(merged.summaries[1].last?.t, 300);
  assert.equal(merged.now, 400);
  // A pause after that check wins over it.
  const paused = mergeView(held, view(monitors, [summary('a', { last: { t: 150, s: 'up' }, state: 'paused', stamp: 7 }), summary('b')]));
  assert.equal(paused.summaries[0].state, 'paused');
});

test('a check updates only its own monitor', () => {
  const monitors = [monitor('a', 'Shop'), monitor('b', 'API')];
  const current = view(monitors, [summary('a'), summary('b')]);
  const next = applyBeat(current, { id: 'b', beat: { t: 5, s: 'down' }, summary: summary('b', { state: 'down' }), offlineSince: null });
  assert.equal(next?.summaries[0], current.summaries[0]);
  assert.equal(next?.summaries[1].state, 'down');
  assert.equal(applyBeat(current, { id: 'gone', beat: { t: 5, s: 'down' }, summary: summary('gone'), offlineSince: null }), current);
  assert.equal(applyBeat(null, { id: 'a', beat: { t: 5, s: 'down' }, summary: summary('a'), offlineSince: null }), null);
});

test('time ticks are round local times and never stall on a summer time change', () => {
  const from = new Date(2026, 10, 26, 19, 5).getTime();
  const day = timeTicks(from, from + DAY);
  assert.ok(day.length >= 7 && day.length <= 9, `${day.length} ticks`);
  for (const tick of day) assert.equal(new Date(tick).getMinutes(), 0);
  assert.ok(day.every((tick) => tick >= from && tick <= from + DAY));
  const hour = timeTicks(from, from + HOUR);
  assert.deepEqual(hour.map((tick) => new Date(tick).getMinutes()), [10, 20, 30, 40, 50, 0]);
  // A month across the end of summer time in Europe and the US: one tick per fifth midnight, all at midnight.
  const autumn = new Date(2026, 9, 1).getTime();
  const month = timeTicks(autumn, new Date(2026, 9, 31).getTime());
  assert.equal(month.length, 7);
  for (const tick of month) assert.equal(new Date(tick).getHours(), 0);
  const week = timeTicks(new Date(2026, 9, 22, 12).getTime(), new Date(2026, 9, 29, 12).getTime());
  assert.equal(week.length, 7);
  assert.deepEqual(timeTicks(5, 5), []);
});

test('the answer time line stops where nobody was checking', () => {
  const beats: Beat[] = [
    { t: 0, s: 'up', ms: 10 },
    { t: 60_000, s: 'down', why: 'timeout' },
    { t: 120_000, s: 'offline', why: 'timeout' },
    // The app was closed for ten minutes.
    { t: 720_000, s: 'up', ms: 12 },
  ];
  const points = beatSeries(beats, 150_000);
  assert.deepEqual(points.map((point) => [point.t, point.ms, point.down]), [
    [0, 10, 0],
    [60_000, null, 1],
    [60_001, null, 0],
    [720_000, 12, 0],
  ]);
  assert.equal(beatSeries(beats).length, 3);
});

test('a window that starts inside an hour takes only its own part of it', () => {
  // The audit's replay: 30 minutes down at the start of an hour, then up.
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % HOUR);
  const first = bucket(t0, 1_800_000, 1_800_000, { spans: [[0, 1_800_000, 1], [1_800_000, HOUR, 0]], until: HOUR });
  const rest = Array.from({ length: 24 }, (_, index) => bucket(t0 + (index + 1) * HOUR, HOUR, 0, { spans: [[0, HOUR, 0]], until: HOUR }));
  const end = t0 + 30 * 60_000 + DAY;
  assert.equal(uptimeOf([first, ...rest], end - DAY, end), 100);
  assert.deepEqual(timeIn(first, t0 + 900_000, t0 + 2_700_000), { up: 900_000, down: 900_000 });
  // A whole hour inside the window answers from its totals.
  assert.deepEqual(timeIn(first, t0 - 1, t0 + HOUR), { up: 1_800_000, down: 1_800_000 });
});

test('the line breaks after the time one check stands for', () => {
  assert.equal(coverMs({ interval: 60, timeout: 10 }), 85_000);
});

test('an hour that crosses local midnight is shared between the two days', () => {
  const zone = process.env.TZ;
  // India is five and a half hours ahead: its midnight falls at half past an hour.
  process.env.TZ = 'Asia/Kolkata';
  try {
    const now = new Date(2026, 10, 26, 12, 0).getTime();
    const midnight = localDay(now);
    const hour = midnight - 30 * 60_000;
    assert.equal(hour % HOUR, 0, 'the hour starts on the hour in UTC');
    const bars = dayBars([bucket(hour, 0, HOUR, { spans: [[0, HOUR, 1]], until: HOUR })], 2, now);
    assert.equal(bars[0].down, 30 * 60_000);
    assert.equal(bars[1].down, 30 * 60_000);
  } finally {
    process.env.TZ = zone;
  }
});

test('a cleared monitor replaces the newer-looking summary the page held', () => {
  // The re-audit: an active monitor cleared while its check was slow. Rust's
  // view has no checks; the page still held the last one, which looked newer.
  const monitors = [monitor('a', 'Shop')];
  const held = view(monitors, [summary('a', { last: { t: 200, s: 'down' }, state: 'down', revision: 3, stamp: 7, downSince: 150 })]);
  const cleared = view(monitors, [summary('a', { last: null, recent: [], state: 'unknown', revision: 4, stamp: 8, downSince: null })], { now: 300 });
  const merged = mergeView(held, cleared);
  assert.equal(merged.summaries[0].state, 'unknown');
  assert.equal(merged.summaries[0].last, null);
});

test('a check sent before a clear does not bring the old summary back', () => {
  // Events and command answers travel apart, so the check can land after the clear.
  const monitors = [monitor('a', 'Shop')];
  const cleared = view(monitors, [summary('a', { last: null, recent: [], state: 'unknown', stamp: 8 })]);
  const late = applyBeat(cleared, { id: 'a', beat: { t: 200, s: 'down' }, summary: summary('a', { last: { t: 200, s: 'down' }, state: 'down', stamp: 7 }), offlineSince: null });
  assert.equal(late?.summaries[0].state, 'unknown');
  const next = applyBeat(cleared, { id: 'a', beat: { t: 400, s: 'up' }, summary: summary('a', { last: { t: 400, s: 'up' }, state: 'up', stamp: 9 }), offlineSince: null });
  assert.equal(next?.summaries[0].state, 'up');
});

test('an outage still open when the monitor was pointed elsewhere ends there', () => {
  const pointed: UptimeEvent[] = [
    { id: 'm1', t: 100_000, kind: 'down', why: 'store_missing', msg: "The app isn't on the App Store in US" },
    { id: 'm1', t: 160_000, kind: 'changed', why: 'check' },
  ];
  const [outage] = outagesOf(pointed, 300_000);
  assert.deepEqual([outage.end, outage.length, outage.changed], [160_000, 60_000, true]);
  // A new name only: the outage goes on.
  const renamed = outagesOf([pointed[0], { id: 'm1', t: 160_000, kind: 'changed' }], 300_000);
  assert.deepEqual([renamed[0].end, renamed[0].length], [null, 200_000]);
});

test('a copy is told apart, however long the name', () => {
  const long = 'The checkout page of the shop, where each order of the day is paid and confirmed';
  assert.equal(copyName('Shop', []), 'Shop copy');
  assert.equal(copyName('Shop', ['Shop copy']), 'Shop copy 2');
  const copy = copyName(long, [long]);
  assert.ok(copy.length <= 80 && copy.endsWith(' copy') && copy !== long, copy);
  assert.notEqual(copyName(long, [long, copy]), copy);
});

test('a store name with an emoji at the cut is still a whole name', () => {
  const name = storeName(`${'A'.repeat(79)}\u{1F49A} Tracker`, 'apple');
  assert.equal(Array.from(name).length, 80);
  assert.ok(name.endsWith('\u{1F49A}'), name);
  assert.equal(storeName('Pages', 'google'), 'Pages on Google Play');
});

test('a copy of a name with an emoji at the cut is still a whole name', () => {
  // The seventh audit: 74 As and "💚tail" were cut through the emoji, and the copy failed to save.
  const name = 'A'.repeat(74) + '💚tail';
  const copy = copyName(name, [name]);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(copy), false, copy);
  assert.ok(Array.from(copy).length <= 80 && copy.endsWith(' copy'), copy);
});

test('a delete reaches the page even after a newer check of another monitor', () => {
  // The seventh audit: the delete's view, held back past another monitor's check, was dropped as old.
  const monitors = [monitor('a', 'Shop'), monitor('b', 'API')];
  const before = view(monitors, [summary('a', { state: 'down', stamp: 5 }), summary('b', { state: 'up', stamp: 4 })], { stamp: 5 });
  const checked = applyBeat(before, { id: 'b', beat: { t: 300, s: 'up' }, summary: summary('b', { state: 'up', stamp: 7 }), offlineSince: null });
  const deleted = view([monitor('b', 'API')], [summary('b', { state: 'up', stamp: 4 })], { stamp: 6 });
  const merged = mergeView(checked, deleted);
  assert.deepEqual(merged.monitors.map((m) => m.id), ['b']);
  assert.equal(merged.summaries.some((s) => s.id === 'a'), false);
  assert.equal(merged.summaries.find((s) => s.id === 'b')?.stamp, 7);
});

test('a refused save is told by the same words in Rust, the page and the test runtime', () => {
  // store.ts knows Rust refused a save made from older settings by its words.
  assert.ok(readFileSync('src-tauri/src/uptime/model.rs', 'utf8').includes(`pub const SETTINGS_CHANGED: &str = "${SETTINGS_CHANGED}";`));
  assert.ok(readFileSync('tests/e2e/fixtures/tauri-runtime.ts', 'utf8').includes(`throw new Error('${SETTINGS_CHANGED}');`));
});

test('a first check that arrives before the view that adds its monitor is kept', () => {
  // The eighth audit: a new monitor's first check, a 503 (stamp 13), came
  // before the view that added it (stamp 12); the page showed Unknown and no badge.
  const monitors = [monitor('a', 'Shop')];
  const start = view(monitors, [summary('a', { stamp: 10 })], { stamp: 11 });
  const early = applyBeat(start, { id: 'n', beat: { t: 500, s: 'down' }, summary: summary('n', { state: 'down', stamp: 13 }), offlineSince: null })!;
  const added = mergeView(early, view([...monitors, monitor('n', 'New')], [summary('a', { stamp: 10 }), summary('n', { state: 'unknown', stamp: 12 })], { stamp: 12 }));
  assert.equal(added.summaries.find((s) => s.id === 'n')?.state, 'down');
  assert.equal(downCount(added), 1);
  // A check for a monitor that a newer list leaves out is dropped: it was deleted.
  const stray = applyBeat(start, { id: 'x', beat: { t: 500, s: 'down' }, summary: summary('x', { state: 'down', stamp: 13 }), offlineSince: null })!;
  const moved = mergeView(stray, view(monitors, [summary('a', { stamp: 10 })], { stamp: 14 }));
  const back = mergeView(moved, view([...monitors, monitor('x', 'Again')], [summary('a', { stamp: 10 }), summary('x', { state: 'unknown', stamp: 9 })], { stamp: 15 }));
  assert.equal(back.summaries.find((s) => s.id === 'x')?.state, 'unknown');
});

test('the offline status comes from whatever was made last, a view or a check', () => {
  // A check doesn't touch the list's stamp, so the offline status keeps its own.
  const monitors = [monitor('a', 'Shop')];
  const start = view(monitors, [summary('a', { stamp: 5 })], { offlineSince: null, stamp: 5 });
  const offline = applyBeat(start, { id: 'a', beat: { t: 100, s: 'offline' }, summary: summary('a', { stamp: 8 }), offlineSince: 70 })!;
  assert.equal(offline.offlineSince, 70);
  // A view made before that check has the newer list but older news of the network.
  const older = mergeView(offline, view([...monitors, monitor('b', 'API')], [summary('a', { stamp: 5 }), summary('b', { stamp: 6 })], { offlineSince: null, stamp: 6 }));
  assert.deepEqual(older.monitors.map((m) => m.id), ['a', 'b']);
  assert.equal(older.offlineSince, 70);
  // One made after it says how it is now.
  const newer = mergeView(older, view(monitors, [summary('a', { stamp: 9 })], { offlineSince: null, stamp: 9 }));
  assert.equal(newer.offlineSince, null);
  const late = applyBeat(newer, { id: 'a', beat: { t: 100, s: 'offline' }, summary: summary('a', { stamp: 8 }), offlineSince: 70 });
  assert.equal(late?.offlineSince, null);
});

test('a late check says nothing about being offline now', () => {
  // The sixth audit: an older offline check, replayed after recovery, brought the offline notice back.
  const monitors = [monitor('a', 'Shop')];
  const recovered = view(monitors, [summary('a', { state: 'up', stamp: 9 })], { offlineSince: null, stamp: 9 });
  const late = applyBeat(recovered, { id: 'a', beat: { t: 100, s: 'offline' }, summary: summary('a', { state: 'up', stamp: 7 }), offlineSince: 50 });
  assert.equal(late?.offlineSince, null);
  const newer = applyBeat(recovered, { id: 'a', beat: { t: 200, s: 'offline' }, summary: summary('a', { state: 'up', stamp: 10 }), offlineSince: 150 });
  assert.equal(newer?.offlineSince, 150);
});

test('a view written before a delete does not bring the monitor back', () => {
  // The sixth audit: an older full view, replayed after a delete, put the monitor and its Down back.
  const after = view([monitor('b', 'API')], [summary('b', { stamp: 12 })], { stamp: 12 });
  const before = view([monitor('a', 'Shop'), monitor('b', 'API')], [summary('a', { state: 'down', stamp: 10 }), summary('b', { stamp: 11 })], { stamp: 11 });
  const merged = mergeView(after, before);
  assert.deepEqual(merged.monitors.map((m) => m.id), ['b']);
  assert.equal(merged.summaries.some((s) => s.id === 'a'), false);
});

test('a view written before the last check keeps the newer check the page has', () => {
  const monitors = [monitor('a', 'Shop')];
  const held = view(monitors, [summary('a', { last: { t: 260, s: 'up' }, state: 'up', stamp: 9 })]);
  const older = view(monitors, [summary('a', { last: { t: 200, s: 'down' }, state: 'down', stamp: 8 })], { now: 300 });
  assert.equal(mergeView(held, older).summaries[0].state, 'up');
});

test('stretches kept in milliseconds count exactly', () => {
  // The fourth audit: 2.804 s up and a minute down showed 4.76% instead of 4.46%.
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % HOUR);
  const mixed: Bucket = { ...bucket(t0, 2_804, 60_000), spans: [[600_500, 603_304, 0]], until: 603_304 };
  const now = t0 + 603_400;
  assert.deepEqual(timeIn(mixed, now - DAY, now), { up: 2_804, down: 60_000 });
  assert.deepEqual(timeIn(mixed, t0 + 601_000, now), { up: 2_304, down: 0 });
});

test('windows add up and never overflow, the same as in Rust', () => {
  // Hours as Rust writes them, a few long stretches or more than 720 short
  // ones (the time past the 720th kept only in the totals), each read through
  // many windows. mulberry32: a plain multiply loses its low bits past 2^53.
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % HOUR);
  let seed = 7;
  const next = (limit: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) % limit;
  };
  let overflowed = 0;
  for (let index = 0; index < 64; index += 1) {
    const one: Bucket = { ...bucket(t0, 0, 0), spans: [] };
    const dense = index % 4 === 3;
    let at = next(300_000);
    for (let s = dense ? 900 : next(30); s > 0; s -= 1) {
      const length = dense ? 500 + next(2_500) : 500 + next(40_000);
      if (at + length >= HOUR) break;
      const isDown = next(2);
      // As add_span in model.rs: past 720 stretches only the totals go on.
      if (one.spans!.length < 720) one.spans!.push([at, at + length, isDown]);
      if (isDown) one.down += length;
      else one.up += length;
      one.until = at + length;
      at += length + (dense ? next(1_200) : next(5_000));
    }
    if (one.spans!.length === 720 && one.up + one.down > one.spans!.reduce((sum, [a, b]) => sum + b - a, 0)) overflowed += 1;
    const now = t0 + Math.min(at, HOUR - 1) + next(60_000);
    const end = Math.min(now, t0 + HOUR);
    let [sumUp, sumDown, from] = [0, 0, t0];
    while (from < end) {
      const to = Math.min(from + 1 + next(120_000), end);
      const seen = timeIn(one, from, to, now);
      assert.ok(seen.up >= 0 && seen.down >= 0 && seen.up + seen.down <= to - from + 1, `case ${index}: ${seen.up} + ${seen.down} in ${to - from} ms`);
      if (from > t0) {
        const later = timeIn(one, from + 1, to, now);
        assert.ok(seen.up + seen.down - (later.up + later.down) <= 2, `case ${index}: 1 ms moved ${seen.up + seen.down - (later.up + later.down)} ms`);
      }
      sumUp += seen.up;
      sumDown += seen.down;
      from = to;
    }
    assert.ok(Math.abs(sumUp - one.up) <= 64 && Math.abs(sumDown - one.down) <= 64, `case ${index}: (${sumUp}, ${sumDown}) for (${one.up}, ${one.down})`);
    const cut = timeIn(one, t0 + 1, end, now);
    assert.ok(one.up + one.down - (cut.up + cut.down) <= 2, `case ${index}: the first ms took ${one.up + one.down - (cut.up + cut.down)} ms`);
  }
  assert.ok(overflowed >= 8, `only ${overflowed} cases went past 720 stretches`);
});

test('totals that do not fit never fill more than the window', () => {
  // As totals_that_dont_fit_never_fill_more_than_the_window in model.rs.
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % HOUR);
  const { up, down } = timeIn({ ...bucket(t0, 100_000, 0), until: 10_000 }, t0 + 1, t0 + 10_000, t0 + 60_000);
  assert.ok(up + down <= 9_999, `${up} + ${down}`);
});

test('time past the last stretch spreads after it', () => {
  // As time_past_the_last_stretch_spreads_after_it in model.rs.
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % HOUR);
  const spans: Array<[number, number, number]> = Array.from({ length: 720 }, (_, index) => [index * 3_000, index * 3_000 + 2_000, index % 2]);
  const last = 719 * 3_000 + 2_000;
  const full: Bucket = { ...bucket(t0, 720_000 + 30_000, 720_000), spans, until: last + 40_000 };
  const now = t0 + last + 60_000;
  assert.deepEqual(timeIn(full, t0, t0 + last, now), { up: 720_000, down: 720_000 });
  assert.deepEqual(timeIn(full, t0 + last, now, now), { up: 30_000, down: 0 });
  assert.deepEqual(timeIn(full, t0 + last, t0 + last + 20_000, now), { up: 15_000, down: 0 });
});

test('time without stretches counts in proportion', () => {
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % HOUR);
  const old = bucket(t0, 3_000_000, 600_000);
  assert.deepEqual(timeIn(old, t0 + HOUR / 2, t0 + HOUR), { up: 1_500_000, down: 300_000 });
});
