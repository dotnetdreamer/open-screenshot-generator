// How current the playbook's rules are, as the playbook's guard says it at
// the top of every report since 2.5.0 (`rule_pack_line` in
// agent-os/hooks/app-store-compliance-guard.sh). Each deadline carries the day
// it was last read on its source (`verified_on`). The newest of those days
// says when the playbook last checked anything, the oldest says how long a
// source can go unread, and counting the ones past the window keeps one fresh
// entry from hiding old ones. The rules are a dated copy, not a live read of
// Apple's and Google's pages, so the view says how old that copy is.

import { daysUntil } from './search';
import type { RulesLibrary } from './types';

/** The guard's window (APP_STORE_GUARD_STALE_DAYS, 60 by default). */
export const RULE_PACK_WINDOW = 60;

export interface RulePack {
  /** The playbook's VERSION. */
  version: string | null;
  /** Deadlines that say the day they were checked against their source. */
  total: number;
  oldest: string | null;
  newest: string | null;
  /** Days since the newest check. Null when it can't be told: no dates, or the newest is after today. */
  age: number | null;
  /** Sources last checked more than the window ago. */
  old: number;
  /** Even the newest check is older than the window. */
  stale: boolean;
  window: number;
}

export function rulePack(library: Pick<RulesLibrary, 'deadlines' | 'version'>, today: string, window = RULE_PACK_WINDOW): RulePack {
  const days = library.deadlines
    .map((deadline) => deadline.verifiedOn)
    .filter((day): day is string => !!day)
    .sort();
  const oldest = days[0] ?? null;
  const newest = days[days.length - 1] ?? null;
  // As the guard does: the age only when the newest day isn't ahead of today, and the
  // window's edge as a day, so a source checked on the edge itself is not old.
  const span = newest ? daysUntil(today, newest) : null;
  const age = span !== null && span >= 0 ? span : null;
  const edge = shiftDay(today, -window);
  const old = age === null ? 0 : days.filter((day) => day < edge).length;
  return { version: library.version, total: days.length, oldest, newest, age, old, stale: age !== null && age > window, window };
}

/** YYYY-MM-DD moved by a number of days. */
export function shiftDay(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}
