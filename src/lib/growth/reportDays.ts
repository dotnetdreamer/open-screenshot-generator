// Which days an App Analytics file answers for. Kept apart from sync.ts so
// the readers of every App Analytics report (sync.ts for the numbers,
// healthSync.ts for app health) share one rule.

import { addDays, dayRange, normalizeDay } from './dates';
import type { DayString } from './types';

/**
 * How far back a daily file's own days reach. Apple re-sends the last days in
 * full until they are complete: two for App Downloads and three for Discovery
 * and Engagement in Ludo Wala's files of November 2026. An older date in a
 * daily file is a correction.
 */
export const RECENT_DAYS = 4;

/**
 * The days one analytics file answers for, rows or not. A day in there with
 * no rows is a zero of that report. A day no file answers for stays unknown,
 * and the overview takes its downloads from Sales and Trends (`dayValues`).
 *
 * A snapshot holds the history up to its processing date, quiet days and all.
 * Ludo Wala's, in November 2026, had no rows for Oct 31 and Nov 1: Sales and
 * Trends had no report for Oct 31, and its one download on Nov 1 is the
 * second one App Analytics counts on Nov 2. A daily file holds the day before
 * its processing date and the few before that still filling in, so its days
 * run from its oldest recent row. An older date in it is a correction and
 * stands alone. A day between two files is no file's: Apple deletes a file
 * after 35 days, and developers report daily files that skip a day (forums,
 * thread 825231), so a zero there would be made up.
 */
export function instanceDays(processingDate: string, snapshot: boolean, rowDates: Iterable<DayString>): DayString[] {
  const dates = [...new Set(rowDates)].sort();
  const processed = normalizeDay(processingDate);
  if (!processed) return dates;
  if (snapshot) {
    if (dates.length === 0) return [];
    const last = dates[dates.length - 1];
    return dayRange(dates[0], last > processed ? last : processed);
  }
  const newest = addDays(processed, -1);
  const recentFrom = addDays(processed, -RECENT_DAYS);
  const from = dates.find((date) => date >= recentFrom && date <= newest) ?? newest;
  return [...new Set([...dates, ...dayRange(from, newest)])].sort();
}
