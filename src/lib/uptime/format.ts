// How Uptime writes numbers, times and states for people.

import type { BeatStatus, Monitor, MonitorKind, MonitorState } from './types';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The first `count` characters of `text`, as Rust counts them (code points):
 * a cut never lands inside an emoji, which would leave half of it, a string
 * Rust can't read.
 */
export function takeChars(text: string, count: number): string {
  return Array.from(text).slice(0, Math.max(0, count)).join('');
}

/** The name a store test gives a monitor, from the app's name in the store (store_name in model.rs). */
export function storeName(appName: string, store: Monitor['store']): string {
  return takeChars(`${appName} on ${store === 'google' ? 'Google Play' : 'the App Store'}`, 80);
}

/** A copy's name: "Shop copy", then "Shop copy 2" and on, cut to fit in 80 characters. */
export function copyName(name: string, taken: string[]): string {
  for (let count = 1; ; count += 1) {
    const suffix = count === 1 ? ' copy' : ` copy ${count}`;
    const candidate = `${takeChars(name, 80 - suffix.length).trimEnd()}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * An uptime share. Rounded down, so a day with any time down never shows
 * 100%, and trimmed: 100%, 99.5%, 99.98%.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'No data';
  if (value >= 100) return '100%';
  const floored = Math.floor(value * 100) / 100;
  return `${floored.toFixed(2).replace(/\.?0+$/, '')}%`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'No data';
  if (ms < 1) return 'under 1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

/** "45 s", "4 min", "2 h 5 min", "3 days 4 h". */
export function formatDuration(ms: number): string {
  const value = Math.max(0, ms);
  if (value < MINUTE) return `${Math.max(1, Math.round(value / SECOND))} s`;
  if (value < HOUR) return `${Math.floor(value / MINUTE)} min`;
  if (value < DAY) {
    const hours = Math.floor(value / HOUR);
    const minutes = Math.floor((value % HOUR) / MINUTE);
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  const days = Math.floor(value / DAY);
  const hours = Math.floor((value % DAY) / HOUR);
  const dayText = days === 1 ? '1 day' : `${days} days`;
  return hours ? `${dayText} ${hours} h` : dayText;
}

/** "just now", "12 s ago", "in 34 s". */
export function formatAgo(t: number, now: number): string {
  const delta = now - t;
  if (Math.abs(delta) < 5 * SECOND) return delta >= 0 ? 'just now' : 'now';
  return delta >= 0 ? `${formatDuration(delta)} ago` : `in ${formatDuration(-delta)}`;
}

/** "Every 30 s", "Every minute", "Every 5 min", "Every hour". */
export function formatInterval(seconds: number): string {
  if (seconds < 60) return `Every ${seconds} s`;
  if (seconds === 60) return 'Every minute';
  if (seconds < 3600) return `Every ${Math.round(seconds / 60)} min`;
  if (seconds === 3600) return 'Every hour';
  if (seconds < 86_400) return `Every ${Math.round(seconds / 3600)} h`;
  return 'Every day';
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayTimeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const longDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fullDateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function formatTime(t: number): string {
  return timeFormat.format(t);
}

/** Today's times read as times, other days' with the date: "14:02", "Nov 24, 14:02". */
export function formatWhen(t: number, now: number): string {
  const day = new Date(t);
  const today = new Date(now);
  return day.toDateString() === today.toDateString() ? timeFormat.format(t) : dayTimeFormat.format(t);
}

export function formatDay(t: number): string {
  return dayFormat.format(t);
}

export function formatLongDay(t: number): string {
  return longDayFormat.format(t);
}

export function formatDate(t: number): string {
  return fullDateFormat.format(t);
}

export const STATE_LABELS: Record<MonitorState, string> = {
  up: 'Up',
  down: 'Down',
  pending: 'Checking again',
  paused: 'Paused',
  unknown: 'First check soon',
};

export const BEAT_LABELS: Record<BeatStatus, string> = {
  up: 'Up',
  down: 'Down',
  pending: 'Failed, checking again',
  offline: 'This computer was offline',
  unclear: "Couldn't tell",
};

export const KIND_LABELS: Record<MonitorKind, string> = {
  http: 'Website',
  port: 'Server port',
  ping: 'Ping',
  dns: 'Domain record',
  store: 'Store listing',
};

/** Where a monitor points, short enough for a list row. */
export function targetText(monitor: Monitor): string {
  switch (monitor.kind) {
    case 'http': {
      try {
        const url = new URL(monitor.url);
        const path = url.pathname === '/' ? '' : url.pathname;
        return `${url.host}${path}${url.search}`;
      } catch {
        return monitor.url;
      }
    }
    case 'port':
      return `${monitor.host.includes(':') ? `[${monitor.host}]` : monitor.host}:${monitor.port}`;
    case 'ping':
      return monitor.host;
    case 'dns':
      return `${monitor.dnsType} record of ${monitor.host}`;
    case 'store':
      return `${monitor.store === 'google' ? 'Google Play' : 'App Store'}, ${monitor.country.toUpperCase()}`;
  }
}

/** The address to open for a monitor, when it has one. */
export function openableUrl(monitor: Monitor): string | null {
  if (monitor.kind === 'http') return monitor.url;
  if (monitor.kind === 'store') {
    return monitor.store === 'google'
      ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(monitor.appId)}&gl=${monitor.country.toUpperCase()}`
      : `https://apps.apple.com/${monitor.country}/app/id${monitor.appId}`;
  }
  return null;
}

export function daysLeft(expires: number, now: number): number {
  return Math.floor((expires - now) / DAY);
}
