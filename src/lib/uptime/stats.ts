// Numbers drawn from Uptime's history: uptime over a stretch of hours, the
// day bars, the outages, the response time series, and the one line the
// overview leads with. Pure, so tests/unit/uptime.test.ts covers them.
//
// Rust keeps hours in UTC. Days here are the user's own: an hour belongs to
// the local day it starts in, which in a time zone with a half-hour offset
// moves half an hour of a day into its neighbour. The day bars say "about".

import type { Beat, Bucket, Monitor, Summary, UptimeEvent } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Ms seen up and down between `from` and `to` in one hour, at `now`
 * (Bucket::time_in in model.rs): a range that holds all the time the hour
 * has seen answers from its totals; one that cuts it takes its part of the
 * stretches, exactly. The time they don't hold came after the last one
 * (past MAX_SPANS in model.rs), so it is spread from there to where the
 * hour's time ends, never more of it than fits. Rust leaves out the hours
 * earlier test builds wrote, so they never reach the page.
 */
export function timeIn(bucket: Bucket, from: number, to: number, now = Infinity): { up: number; down: number } {
  const until = bucket.until ?? 0;
  // Where the hour's time can end: where its latest time ended, never later than now.
  const dataEnd = Math.min(until > 0 ? bucket.t + until : bucket.t + HOUR, Math.max(now, bucket.t));
  if (from <= bucket.t && to >= dataEnd) return { up: bucket.up, down: bucket.down };
  const overlap = (start: number, stop: number) => Math.max(0, Math.min(stop, to) - Math.max(start, from));
  const spans = bucket.spans ?? [];
  let up = 0;
  let down = 0;
  let spanUp = 0;
  let spanDown = 0;
  for (const [start, end, isDown] of spans) {
    if (isDown === 1) {
      down += overlap(bucket.t + start, bucket.t + end);
      spanDown += end - start;
    } else {
      up += overlap(bucket.t + start, bucket.t + end);
      spanUp += end - start;
    }
  }
  const restUp = Math.max(0, bucket.up - spanUp);
  const restDown = Math.max(0, bucket.down - spanDown);
  const rest = restUp + restDown;
  const after = spans.length > 0 ? bucket.t + spans[spans.length - 1][1] : bucket.t;
  const room = dataEnd - after;
  if (rest > 0 && room > 0) {
    const placed = (Math.min(rest, room) * overlap(after, dataEnd)) / room;
    up += Math.round((placed * restUp) / rest);
    down += Math.round((placed * restDown) / rest);
  }
  return { up, down };
}

/** The share up between `from` and `to`, a window that ends now unless `now` says otherwise. */
export function uptimeOf(buckets: Bucket[], from = -Infinity, to = Infinity, now = to): number | null {
  let up = 0;
  let down = 0;
  for (const bucket of buckets) {
    if (bucket.t + HOUR <= from || bucket.t >= to) continue;
    const seen = timeIn(bucket, from, to, now);
    up += seen.up;
    down += seen.down;
  }
  return up + down > 0 ? (up * 100) / (up + down) : null;
}

export function averageOf(buckets: Bucket[], from = -Infinity, to = Infinity): number | null {
  let sum = 0;
  let count = 0;
  for (const bucket of buckets) {
    if (bucket.t + HOUR <= from || bucket.t >= to) continue;
    sum += bucket.sum;
    count += bucket.cnt;
  }
  return count > 0 ? sum / count : null;
}

/** Midnight of the local day `t` is in. */
export function localDay(t: number): number {
  const date = new Date(t);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** The local midnight `count` days after `day`, across summer time changes. */
export function addLocalDays(day: number, count: number): number {
  const date = new Date(day);
  date.setDate(date.getDate() + count);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export interface DayBar {
  /** Local midnight. */
  day: number;
  up: number;
  down: number;
  checks: number;
  fails: number;
  uptime: number | null;
}

/** One bar per local day, the oldest first, ending with today. */
export function dayBars(buckets: Bucket[], days: number, now: number): DayBar[] {
  const today = localDay(now);
  const first = addLocalDays(today, -(days - 1));
  const bars = new Map<number, DayBar>();
  for (let index = 0; index < days; index += 1) {
    const day = addLocalDays(first, index);
    bars.set(day, { day, up: 0, down: 0, checks: 0, fails: 0, uptime: null });
  }
  for (const bucket of buckets) {
    // An hour can start in one local day and end in the next where the
    // time zone is half an hour off: each day takes its own part.
    for (const day of new Set([localDay(bucket.t), localDay(bucket.t + HOUR - 1)])) {
      const bar = bars.get(day);
      if (!bar) continue;
      const seen = timeIn(bucket, day, addLocalDays(day, 1), now);
      bar.up += seen.up;
      bar.down += seen.down;
      if (localDay(bucket.t) === day) {
        bar.checks += bucket.n;
        bar.fails += bucket.fails;
      }
    }
  }
  for (const bar of bars.values()) {
    bar.uptime = bar.up + bar.down > 0 ? (bar.up * 100) / (bar.up + bar.down) : null;
  }
  return [...bars.values()];
}

/** How a day's bar is coloured: the four status steps, or none for a day with no checks. */
export type DayTone = 'good' | 'warning' | 'serious' | 'critical' | 'empty';

export function dayTone(uptime: number | null): DayTone {
  if (uptime === null) return 'empty';
  if (uptime >= 100) return 'good';
  if (uptime >= 99) return 'warning';
  if (uptime >= 95) return 'serious';
  return 'critical';
}

export interface Outage {
  start: number;
  /** When the check that passed ran; null while it is still down. */
  end: number | null;
  /** ms from the first failed check to the check that passed, or to now. */
  length: number;
  /** Of `length`, the ms the app was open and checking, when Rust knows it. */
  seen: number | null;
  /** The monitor was pointed at something else while it was down, which ended the outage. */
  changed?: boolean;
  why: string;
  msg: string;
  code?: number;
}

/**
 * Down and up events paired into outages, the newest first. An outage
 * still going on ends at `now`.
 */
export function outagesOf(events: UptimeEvent[], now: number): Outage[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const outages: Outage[] = [];
  let open: Outage | null = null;
  for (const event of sorted) {
    if (event.kind === 'down') {
      if (open) outages.push(open);
      open = { start: event.t, end: null, length: 0, seen: null, why: event.why ?? '', msg: event.msg ?? '', code: event.code };
    } else if (event.kind === 'changed' && event.why === 'check' && open) {
      // The settings changed: whatever the old ones found has ended.
      open.end = event.t;
      open.length = event.t - open.start;
      open.changed = true;
      outages.push(open);
      open = null;
    } else if (event.kind === 'up') {
      const start = open?.start ?? event.t - (event.dur ?? 0);
      const outage: Outage = open ?? { start, end: null, length: 0, seen: null, why: '', msg: '' };
      outage.end = event.t;
      outage.length = event.dur ?? event.t - outage.start;
      outage.seen = event.seen ?? null;
      outages.push(outage);
      open = null;
    }
  }
  if (open) {
    open.length = now - open.start;
    outages.push(open);
  }
  return outages.reverse();
}

/**
 * The most one check stands for (Monitor::cover_ms in model.rs): the wait
 * until the next check, the time that check may take, and 15 seconds.
 */
export function coverMs(monitor: Pick<Monitor, 'interval' | 'timeout'>): number {
  return (monitor.interval + monitor.timeout + 15) * 1000;
}

/**
 * Whether part of an outage happened while the app was closed. While it is
 * open every check's time is counted, so more than an interval missing from
 * what was seen was time it was closed (the same rule as record() in mod.rs).
 */
export function partlyUnseen(outage: Outage, monitor: Monitor): boolean {
  if (outage.seen === null || outage.end === null) return false;
  return outage.length - outage.seen > Math.max(monitor.interval, monitor.retryInterval) * 1000;
}

export interface ResponsePoint {
  t: number;
  /** The response time; null where the check failed or nothing was checked. */
  ms: number | null;
  /** Hourly points: the fastest and slowest check of the hour. */
  min?: number | null;
  max?: number | null;
  /** The share of the time the point stands for that was down, 0 to 1. */
  down: number;
}

/**
 * Each check as a point. Where two checks are more than `gap` apart (the app
 * was closed or the computer slept) an empty point goes between them, so the
 * line stops there instead of drawing across time nobody watched.
 */
export function beatSeries(beats: Beat[], gap = Infinity): ResponsePoint[] {
  const points: ResponsePoint[] = [];
  let previous: number | null = null;
  for (const beat of beats) {
    if (beat.s === 'offline' || beat.s === 'unclear') continue;
    if (previous !== null && beat.t - previous > gap) points.push({ t: previous + 1, ms: null, down: 0 });
    points.push({ t: beat.t, ms: beat.s === 'up' && beat.ms !== undefined ? beat.ms : null, down: beat.s === 'down' ? 1 : 0 });
    previous = beat.t;
  }
  return points;
}

/** Each hour as a point, with every hour in the range present so a gap reads as a gap. */
export function hourSeries(buckets: Bucket[], from: number, to: number): ResponsePoint[] {
  const byHour = new Map(buckets.map((bucket) => [bucket.t, bucket]));
  const points: ResponsePoint[] = [];
  for (let hour = Math.floor(from / HOUR) * HOUR; hour < to; hour += HOUR) {
    const bucket = byHour.get(hour);
    const seen = bucket ? bucket.up + bucket.down : 0;
    points.push({
      t: hour,
      ms: bucket && bucket.cnt > 0 ? bucket.sum / bucket.cnt : null,
      min: bucket && bucket.cnt > 0 ? bucket.min : null,
      max: bucket && bucket.cnt > 0 ? bucket.max : null,
      down: seen > 0 ? (bucket?.down ?? 0) / seen : 0,
    });
  }
  return points;
}

/** The checks a monitor's bar shows: the last `count`, with empty places in front when there are fewer. */
export function lastBeats(recent: Beat[], count: number): Array<Beat | null> {
  const tail = recent.slice(-count);
  return [...Array.from({ length: count - tail.length }, () => null), ...tail];
}

export interface Headline {
  tone: 'good' | 'warning' | 'critical' | 'quiet';
  title: string;
  detail: string;
}

/**
 * The line the overview leads with: what is down first, then what is being
 * checked again, then certificates about to run out, then all clear.
 */
export function headline(monitors: Monitor[], summaries: Summary[], now: number, offlineSince: number | null): Headline {
  const byId = new Map(summaries.map((summary) => [summary.id, summary]));
  const active = monitors.filter((monitor) => !monitor.paused);
  if (monitors.length === 0) {
    return { tone: 'quiet', title: 'Nothing is being watched yet', detail: 'Add your website, your app\'s server or your store listing, and Uptime checks it from this computer.' };
  }
  if (offlineSince !== null) {
    return { tone: 'warning', title: 'This computer is offline', detail: 'Checks made while it has no internet don\'t count against your monitors. They carry on when it\'s back.' };
  }
  const down = active.filter((monitor) => byId.get(monitor.id)?.state === 'down');
  if (down.length === 1) {
    const summary = byId.get(down[0].id);
    return { tone: 'critical', title: `${down[0].name} is down`, detail: summary?.downMsg || summary?.last?.msg || 'The last check failed.' };
  }
  if (down.length > 1) {
    const names = down.map((monitor) => monitor.name);
    const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return { tone: 'critical', title: `${down.length} monitors are down`, detail: `${shown}.` };
  }
  const unclear = active.filter((monitor) => byId.get(monitor.id)?.last?.s === 'unclear');
  const pending = active.filter((monitor) => byId.get(monitor.id)?.state === 'pending');
  if (pending.length > 0) {
    return { tone: 'warning', title: pending.length === 1 ? `${pending[0].name} failed a check` : `${pending.length} monitors failed a check`, detail: 'Uptime is checking again before it calls anything down.' };
  }
  if (unclear.length > 0) {
    const reason = byId.get(unclear[0].id)?.last?.msg;
    return {
      tone: 'warning',
      title: unclear.length === 1 ? `Uptime couldn't check ${unclear[0].name}` : `Uptime couldn't check ${unclear.length} monitors`,
      detail: `${reason ? `${reason}. ` : ''}Nothing is called down until a check can tell.`,
    };
  }
  const expiring = active.filter((monitor) => {
    const cert = byId.get(monitor.id)?.detail.cert;
    return monitor.kind === 'http' && monitor.certDays > 0 && cert && cert.expires - now <= monitor.certDays * DAY;
  });
  if (expiring.length > 0) {
    const cert = byId.get(expiring[0].id)?.detail.cert;
    const days = cert ? Math.max(0, Math.floor((cert.expires - now) / DAY)) : 0;
    return {
      tone: 'warning',
      title: expiring.length === 1 ? `The certificate for ${expiring[0].name} runs out ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}` : `${expiring.length} certificates run out soon`,
      detail: 'Renew before then, or visitors see a security warning instead of the site.',
    };
  }
  const waiting = active.filter((monitor) => (byId.get(monitor.id)?.state ?? 'unknown') === 'unknown');
  if (active.length === 0) {
    return { tone: 'quiet', title: 'Every monitor is paused', detail: 'Nothing is being checked until you resume one.' };
  }
  if (waiting.length === active.length) {
    return { tone: 'quiet', title: 'Starting the first checks', detail: 'The results show here in a few seconds.' };
  }
  const up = active.length - waiting.length;
  return {
    tone: 'good',
    title: up === 1 ? 'Everything is up' : `All ${up} monitors are up`,
    detail: monitors.length > active.length ? `${monitors.length - active.length} paused.` : 'Uptime keeps checking while this app is open.',
  };
}

/** The average of every monitor's last 24 hours, for those with checks in them. */
export function overallUptime(summaries: Summary[]): number | null {
  const values = summaries.map((summary) => summary.uptime24).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Round times across the range for the time axis, in the user's time zone:
 * every 10 minutes for an hour, every 3 hours for a day, every midnight for
 * a week, every fifth midnight for a month. Days are stepped on the
 * calendar, so a summer time change never repeats or skips a day.
 */
export function timeTicks(from: number, to: number): number[] {
  const span = to - from;
  const ticks: number[] = [];
  if (!(span > 0)) return ticks;
  if (span <= 2 * 86_400_000) {
    const step = span <= 2 * 3_600_000 ? 10 * 60_000 : 3 * 3_600_000;
    const midnight = new Date(from);
    midnight.setHours(0, 0, 0, 0);
    for (let at = midnight.getTime(); at <= to; at += step) {
      if (at >= from) ticks.push(at);
    }
    return ticks;
  }
  const days = span <= 10 * 86_400_000 ? 1 : 5;
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  if (day.getTime() < from) day.setDate(day.getDate() + 1);
  while (day.getTime() <= to) {
    ticks.push(day.getTime());
    day.setDate(day.getDate() + days);
  }
  return ticks;
}
