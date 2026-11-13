// Calendar days for the growth feature.
//
// Every report Apple publishes is per day in a fixed zone (Pacific time for
// Sales and Trends, UTC for the analytics reports), and none of them carries a
// time. So a day here is a plain `YYYY-MM-DD` string handled as a UTC date,
// never a local Date: a viewer in Tokyo and one in Los Angeles must put a
// report's row on the same day, and string keys sort and compare as dates do.

import type { DayString } from './types';

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dayOf(date: Date): DayString {
  return date.toISOString().slice(0, 10);
}

export function today(): DayString {
  return dayOf(new Date());
}

export function parseDay(day: DayString): Date {
  const match = DAY_PATTERN.exec(day);
  if (!match) return new Date(NaN);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function isDay(value: unknown): value is DayString {
  return typeof value === 'string' && DAY_PATTERN.test(value) && !Number.isNaN(parseDay(value).getTime());
}

export function addDays(day: DayString, days: number): DayString {
  return dayOf(new Date(parseDay(day).getTime() + days * DAY_MS));
}

/** Whole days from `from` to `to`, negative when `to` comes first. */
export function daysBetween(from: DayString, to: DayString): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);
}

/** Every day from `from` to `to`, both included. Empty when `to` is earlier. */
export function dayRange(from: DayString, to: DayString): DayString[] {
  const out: DayString[] = [];
  const span = daysBetween(from, to);
  for (let offset = 0; offset <= span; offset += 1) out.push(addDays(from, offset));
  return out;
}

/**
 * Any of the date shapes the reports use, as a day: `2026-03-04`,
 * `2026-03-04T10:22:00-07:00`, and Sales and Trends' `03/04/2026`.
 * A timestamp keeps the date it was written with, not the date in UTC: a review
 * written at 23:30 in California belongs to that day.
 */
export function normalizeDay(value: string | null | undefined): DayString | null {
  if (!value) return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    const day = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isDay(day) ? day : null;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) {
    const day = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    return isDay(day) ? day : null;
  }
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) {
    const day = `${compact[1]}-${compact[2]}-${compact[3]}`;
    return isDay(day) ? day : null;
  }
  return null;
}

/** A span of days, both ends included. */
export interface DayWindow {
  from: DayString;
  to: DayString;
}

export function windowEndingAt(to: DayString, days: number): DayWindow {
  return { from: addDays(to, -(Math.max(1, days) - 1)), to };
}

/** The same number of days immediately before `window`. */
export function previousWindow(window: DayWindow): DayWindow {
  const length = daysBetween(window.from, window.to) + 1;
  return { from: addDays(window.from, -length), to: addDays(window.from, -1) };
}

export function windowLength(window: DayWindow): number {
  return daysBetween(window.from, window.to) + 1;
}

export function inWindow(day: DayString, window: DayWindow): boolean {
  return day >= window.from && day <= window.to;
}

/** The Monday of the week `day` falls in. */
export function weekStart(day: DayString): DayString {
  const weekday = parseDay(day).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function monthStart(day: DayString): DayString {
  return `${day.slice(0, 7)}-01`;
}

/** The last day of the month `day` falls in. */
export function monthEnd(day: DayString): DayString {
  const date = parseDay(monthStart(day));
  return dayOf(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

export function yearStart(day: DayString): DayString {
  return `${day.slice(0, 4)}-01-01`;
}

export function yearEnd(day: DayString): DayString {
  return `${day.slice(0, 4)}-12-31`;
}

/** The same calendar day a number of years away; 29 February becomes the 28th in a year without one. */
export function shiftYears(day: DayString, years: number): DayString {
  const year = Number(day.slice(0, 4)) + years;
  const shifted = `${String(year).padStart(4, '0')}${day.slice(4)}`;
  return dayOf(parseDay(shifted)) === shifted ? shifted : `${String(year).padStart(4, '0')}-02-28`;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Mar 4`, or `Mar 4, 2025` when the year is not the current one. */
export function formatDay(day: DayString, options: { withYear?: boolean } = {}): string {
  const date = parseDay(day);
  if (Number.isNaN(date.getTime())) return day;
  const label = `${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  const year = date.getUTCFullYear();
  const showYear = options.withYear ?? year !== new Date().getUTCFullYear();
  return showYear ? `${label}, ${year}` : label;
}

/** `Mar 4 to 17`, `Feb 25 to Mar 10`, with the year only when it differs from now. */
export function formatWindow(window: DayWindow): string {
  const from = parseDay(window.from);
  const to = parseDay(window.to);
  if (from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()) {
    return `${formatDay(window.from, { withYear: false })} to ${to.getUTCDate()}${
      to.getUTCFullYear() !== new Date().getUTCFullYear() ? `, ${to.getUTCFullYear()}` : ''
    }`;
  }
  return `${formatDay(window.from)} to ${formatDay(window.to)}`;
}

export function formatMonth(day: DayString): string {
  const date = parseDay(day);
  return `${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
