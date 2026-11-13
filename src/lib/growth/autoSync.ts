// When Growth syncs an app without being asked.
//
// An app is due once its newest sync is older than the user's setting
// (refreshHours). Each automatic attempt is noted, so a sync that keeps
// failing (an expired key, no network) is tried again an hour later rather
// than on every render, and so the Growth view and the background monitor
// (monitor.ts) never both start the same app. An attempt that was stopped
// before it finished is forgotten, so showing Growth again tries again.
//
// The note lives for the editor session only. An attempt from an earlier
// session is no reason to wait: the stored last sync time decides then.

const HOUR_MS = 3_600_000;

const attempts = new Map<string, number>();

export function dueForAutoSync(
  appId: string,
  lastSync: number | null | undefined,
  refreshHours: number,
  now: number = Date.now()
): boolean {
  if (!(refreshHours > 0)) return false;
  const interval = refreshHours * HOUR_MS;
  if (lastSync && now - lastSync < interval) return false;
  const tried = attempts.get(appId);
  if (tried !== undefined && now - tried < Math.min(interval, HOUR_MS)) return false;
  return true;
}

export function noteAutoSync(appId: string, now: number = Date.now()): void {
  attempts.set(appId, now);
}

export function forgetAutoSync(appId: string): void {
  attempts.delete(appId);
}

/** For tests. */
export function resetAutoSync(): void {
  attempts.clear();
}
