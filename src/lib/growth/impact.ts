// Did a change work? The days before an event against the days after it.
//
// The question people bring to this screen is "were my new screenshots better
// than the old ones", so the main measure is the conversion rate: of the
// people who saw the app, how many got it. Raw downloads would credit a
// design with a holiday or a feature placement; a rate mostly does not.
//
// A rate from a few hundred visitors moves by itself, so every comparison
// carries a two-proportion z-test. A verdict needs a whole week after the
// change (a few days would compare a weekend with a fortnight), and a window
// that is still filling is looked at again every day, which makes a fluke
// likelier to slip through somewhere along the way, so until the 14 days are
// in it needs 99% (EARLY_CONFIDENT). After that 90% (CONFIDENT) will do.
// Below the bar the honest answer is "too early to tell", with the number of
// days still to wait.
//
// This is a before and after comparison, not a controlled test: a feature, a
// price change or a season moves the same numbers. So the result carries
// every other timeline event in its two windows (`others`), for the screens
// to name, and none of them say the screenshots caused the change.
//
// Screenshots uploaded to a version waiting for review are not on the store
// until that version is released, so a screenshots event is measured from the
// release of the version it was uploaded to (liveDateFor), not from the upload.
//
// On Google Play the store page is not tied to a version of the app: new
// screenshots go live once Google has checked them, usually within days of
// the upload, so they are measured from the upload day. A Google Play app has
// no impressions either, so its rate is the store listing conversion rate
// (`pageConversion`): of the people who opened the page, how many installed.

import { addDays, daysBetween, formatDay, type DayWindow } from './dates';
import { dailySeries, relativeChange, totalsFor, type Totals } from './metrics';
import { storeOf } from './stores';
import type { DayRecord, DayString, TimelineEvent } from './types';

export type ImpactVerdict = 'better' | 'worse' | 'flat' | 'too-early' | 'not-live' | 'no-data';

export interface ImpactResult {
  eventId: string;
  /** The day the change reached the store. */
  liveDate: DayString | null;
  before: DayWindow;
  after: DayWindow;
  /**
   * Which rate was compared: the download rate from times seen (App Store),
   * the download rate from page visits (Google Play), or downloads per day.
   */
  measure: 'conversion' | 'pageConversion' | 'downloads';
  beforeRate: number | null;
  afterRate: number | null;
  /** Relative change of the measure, 0.18 for +18%. */
  change: number | null;
  /** Two-sided confidence that the rates differ, 0 to 1. */
  confidence: number | null;
  verdict: ImpactVerdict;
  beforeTotals: Totals;
  afterTotals: Totals;
  /** Whole days of data after the change. */
  daysAfter: number;
  /** Days still needed for a full comparison window. */
  daysToWait: number;
  /**
   * Other events of the app inside the two windows, oldest first: anything
   * that could have moved the numbers as well. The release that put this
   * change on the store is not one of them.
   */
  others: TimelineEvent[];
}

/**
 * A day of browse impressions at least three times the usual day, and 1,000
 * or more, is what an App Store feature looks like (browsing is the Today
 * tab, the Games and Apps tabs and the charts, where editors place apps).
 */
export function isFeatureSpike(value: number, usual: number): boolean {
  return value >= Math.max(1000, usual * 3);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Likely App Store features inside a span, against the span's own usual day:
 * one per run of spike days, dated at its peak. A median is not moved by the
 * spike days themselves, so the span can hold the feature it is judging.
 */
export function likelyFeatures(byDate: Map<DayString, DayRecord>, window: DayWindow): Array<{ date: DayString; value: number }> {
  const series = dailySeries(byDate, window, 'impressions', { source: 'browse' });
  const present = series.map((point) => point.value).filter((value): value is number => value !== null);
  if (present.length < 14) return [];
  const usual = median(present);
  const out: Array<{ date: DayString; value: number }> = [];
  let run: { date: DayString; value: number } | null = null;
  for (const point of series) {
    if (point.value !== null && isFeatureSpike(point.value, usual)) {
      if (!run || point.value > run.value) run = { date: point.date, value: point.value };
    } else if (run) {
      out.push(run);
      run = null;
    }
  }
  if (run) out.push(run);
  return out;
}

/** A change only reads as real above this confidence, once the after window is full. */
export const CONFIDENT = 0.9;
/** The bar while the after window is still filling, since it is checked again every day. */
export const EARLY_CONFIDENT = 0.99;
/** No verdict on fewer days after the change than this: one of each weekday. */
export const MIN_DAYS_AFTER = 7;

/** The standard normal CDF, by the Abramowitz and Stegun erf approximation (7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Two-proportion z-test. Returns the two-sided confidence that the rates
 * differ, or null when either side has no trials.
 */
export function proportionConfidence(
  successesA: number,
  trialsA: number,
  successesB: number,
  trialsB: number
): number | null {
  if (trialsA <= 0 || trialsB <= 0) return null;
  const pA = Math.min(1, successesA / trialsA);
  const pB = Math.min(1, successesB / trialsB);
  const pooled = Math.min(1, (successesA + successesB) / (trialsA + trialsB));
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trialsA + 1 / trialsB));
  if (se === 0) return pA === pB ? 0 : 1;
  const z = Math.abs(pB - pA) / se;
  return 2 * normalCdf(z) - 1;
}

/**
 * Counts compared by a Poisson approximation, for when only downloads are
 * known: is the after-window's count different from the before-window's.
 */
export function countConfidence(before: number, after: number): number | null {
  if (before + after <= 0) return null;
  const z = Math.abs(after - before) / Math.sqrt(before + after);
  return 2 * normalCdf(z) - 1;
}

/**
 * When an event's change reached the store. A screenshots or listing event
 * tied to a version is live from that version's release; anything else is
 * live the day it happened. Null while the version is still waiting.
 */
export function liveDateFor(event: TimelineEvent, events: TimelineEvent[]): DayString | null {
  // The day the user said a Google Play change went live, or not live yet
  // while Play holds it for them to send for review.
  if (event.liveDate) return event.liveDate;
  if (event.waitsForReview) return null;
  const version = versionOf(event);
  // Only screenshots and listing text wait for their version; a release, a
  // campaign or a promotional text change is live the day it happens.
  if ((event.kind !== 'screenshots' && event.kind !== 'listing') || !version) return event.date;
  const releases = events
    .filter((other) => other.kind === 'release' && other.appId === event.appId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const release = releases.find((other) => versionOf(other) === version);
  if (release) return release.date >= event.date ? release.date : event.date;
  // Releases are seen through the public lookup, so 2.0 and then 2.0.1 coming
  // out between two syncs leaves only 2.0.1 on the timeline. A later version
  // cannot reach the store before this one, so its release is the latest this
  // one can have gone live, and measuring from there keeps every "after" day
  // after the change.
  const later = releases.find((other) => {
    const otherVersion = versionOf(other);
    return !!otherVersion && compareVersions(otherVersion, version) > 0 && other.date >= event.date;
  });
  return later ? later.date : null;
}

/** Numeric, part by part: 2.10 is after 2.9, and 2.0 equals 2.0.0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The version an event is about: its own field, else a "version 2.4.1" or
 * "v2.4.1" in a title someone typed. The word boundary keeps "Nov 3" from
 * reading as version 3.
 */
export function versionOf(event: TimelineEvent): string | null {
  if (event.version) return event.version;
  const match = /\b(?:version|v)\s?(\d+(?:\.\d+){0,3})\b/i.exec(`${event.title} ${event.detail ?? ''}`);
  return match ? match[1] : null;
}

export interface ImpactOptions {
  /** Days on each side. 14 by default: two full weeks, so weekdays balance out. */
  days?: number;
  /** The newest day with data. */
  latest: DayString;
  events: TimelineEvent[];
}

export function eventImpact(
  byDate: Map<DayString, DayRecord>,
  event: TimelineEvent,
  options: ImpactOptions
): ImpactResult {
  const days = options.days ?? 14;
  const liveDate = liveDateFor(event, options.events);
  const anchor = liveDate ?? event.date;
  // The live day itself is mixed, half old and half new, so it is left out.
  const before: DayWindow = { from: addDays(anchor, -days), to: addDays(anchor, -1) };
  const afterStart = addDays(anchor, 1);
  const afterEnd = addDays(anchor, days);
  const after: DayWindow = {
    from: afterStart,
    to: options.latest < afterEnd ? options.latest : afterEnd,
  };
  const daysAfter = Math.max(0, daysBetween(afterStart, after.to) + 1);
  const beforeTotals = totalsFor(byDate, before);
  const afterTotals = daysAfter > 0 ? totalsFor(byDate, after) : totalsFor(byDate, { from: afterStart, to: afterStart });
  const version = versionOf(event);
  const waitsForVersion = (event.kind === 'screenshots' || event.kind === 'listing') && !!version;
  // The release that took this change live is the change itself, not another one.
  const carriedIt = (other: TimelineEvent): boolean => {
    if (!waitsForVersion || other.kind !== 'release' || other.date !== liveDate) return false;
    const released = versionOf(other);
    return !!released && compareVersions(released, version!) >= 0;
  };
  const logged = options.events.filter(
    (other) =>
      other.id !== event.id &&
      other.appId === event.appId &&
      other.date >= before.from &&
      other.date <= after.to &&
      !carriedIt(other)
  );
  // A feature nobody wrote on the timeline still moves the numbers, and the
  // browse impressions show it, so the windows are searched for one too.
  const features: TimelineEvent[] = likelyFeatures(byDate, { from: before.from, to: after.to })
    .filter((spike) => !logged.some((other) => other.kind === 'featured' && Math.abs(daysBetween(other.date, spike.date)) <= 3))
    .map((spike) => ({
      id: `likely-feature:${event.appId}:${spike.date}`,
      appId: event.appId,
      date: spike.date,
      kind: 'featured',
      title: 'Apple probably featured your app',
      origin: 'auto',
      createdAt: 0,
    }));
  const others = [...logged, ...features].sort((a, b) => a.date.localeCompare(b.date));
  const base: Omit<ImpactResult, 'measure' | 'beforeRate' | 'afterRate' | 'change' | 'confidence' | 'verdict'> = {
    eventId: event.id,
    liveDate,
    before,
    after,
    beforeTotals,
    afterTotals,
    daysAfter,
    daysToWait: Math.max(0, days - daysAfter),
    others,
  };

  const rateMeasure = storeOf(event.appId) === 'playstore' ? 'pageConversion' : 'conversion';
  if (liveDate === null) {
    return { ...base, measure: rateMeasure, beforeRate: null, afterRate: null, change: null, confidence: null, verdict: 'not-live' };
  }

  const useRate =
    beforeTotals.conversionBase.uniqueImpressions > 0 && afterTotals.conversionBase.uniqueImpressions > 0;
  if (useRate) {
    const beforeRate = beforeTotals.conversion;
    const afterRate = daysAfter > 0 ? afterTotals.conversion : null;
    const change = relativeChange(afterRate, beforeRate);
    const confidence =
      daysAfter > 0
        ? proportionConfidence(
            beforeTotals.conversionBase.downloads,
            beforeTotals.conversionBase.uniqueImpressions,
            afterTotals.conversionBase.downloads,
            afterTotals.conversionBase.uniqueImpressions
          )
        : null;
    return { ...base, measure: 'conversion', beforeRate, afterRate, change, confidence, verdict: verdictFor(change, confidence, daysAfter, days) };
  }

  // Google Play: no times seen, so the rate is from page visits.
  const usePageRate =
    beforeTotals.pageConversionBase.uniquePageViews > 0 && afterTotals.pageConversionBase.uniquePageViews > 0;
  if (usePageRate) {
    const beforeRate = beforeTotals.pageConversion;
    const afterRate = daysAfter > 0 ? afterTotals.pageConversion : null;
    const change = relativeChange(afterRate, beforeRate);
    const confidence =
      daysAfter > 0
        ? proportionConfidence(
            beforeTotals.pageConversionBase.downloads,
            beforeTotals.pageConversionBase.uniquePageViews,
            afterTotals.pageConversionBase.downloads,
            afterTotals.pageConversionBase.uniquePageViews
          )
        : null;
    return { ...base, measure: 'pageConversion', beforeRate, afterRate, change, confidence, verdict: verdictFor(change, confidence, daysAfter, days) };
  }

  if (beforeTotals.days === 0 || (daysAfter > 0 && afterTotals.days === 0)) {
    return { ...base, measure: 'downloads', beforeRate: null, afterRate: null, change: null, confidence: null, verdict: daysAfter === 0 ? 'too-early' : 'no-data' };
  }

  // Downloads per day, so a window still filling compares fairly.
  const beforeRate = beforeTotals.days > 0 ? beforeTotals.downloads / beforeTotals.days : null;
  const afterRate = daysAfter > 0 && afterTotals.days > 0 ? afterTotals.downloads / afterTotals.days : null;
  const change = relativeChange(afterRate, beforeRate);
  const scaledBefore = beforeRate !== null ? beforeRate * Math.max(1, afterTotals.days) : 0;
  const confidence = afterRate !== null ? countConfidence(scaledBefore, afterTotals.downloads) : null;
  return { ...base, measure: 'downloads', beforeRate, afterRate, change, confidence, verdict: verdictFor(change, confidence, daysAfter, days) };
}

/**
 * The confidence a verdict needs with this many days measured: none can be
 * given before a week, 99% until the window is full, 90% after.
 */
export function confidenceBar(daysAfter: number, days = 14): number | null {
  if (daysAfter >= days) return CONFIDENT;
  if (daysAfter >= Math.min(MIN_DAYS_AFTER, days)) return EARLY_CONFIDENT;
  return null;
}

export function verdictFor(change: number | null, confidence: number | null, daysAfter: number, days: number): ImpactVerdict {
  if (daysAfter === 0 || change === null || confidence === null) return 'too-early';
  const bar = confidenceBar(daysAfter, days);
  if (bar !== null && confidence >= bar && Math.abs(change) >= 0.02) return change > 0 ? 'better' : 'worse';
  // A full window that still cannot tell the two apart is a real answer.
  if (daysAfter >= days) return 'flat';
  return 'too-early';
}

/** "Version 2.4.1 released (Nov 3), Spring sale (Nov 10) and 2 more", for naming what else changed. */
export function describeEvents(events: TimelineEvent[], limit = 3): string {
  const named = events.slice(0, limit).map((event) => `${event.title} (${formatDay(event.date)})`);
  const rest = events.length - named.length;
  if (rest > 0) return `${named.join(', ')} and ${rest} more`;
  if (named.length <= 1) return named.join('');
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

/** "+18%", "-4.2%", "0%". */
export function formatChange(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return 'n/a';
  const percent = change * 100;
  const digits = Math.abs(percent) < 10 ? 1 : 0;
  const text = percent.toFixed(digits).replace(/\.0$/, '');
  return `${percent > 0 ? '+' : ''}${text}%`;
}
