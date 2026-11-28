// Uptime as this window knows it: the view Rust last sent, kept up to date
// by its events. One store per window. The activity bar's badge and the
// Uptime view both read it, so the badge is right before the view has opened.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { isTauri } from '@/lib/desktop';
import { listenUptime, uptimeCommands } from './engine';
import type { BeatPayload, Settings, Summary, UptimeAlert, UptimeView } from './types';

export interface UptimeStore {
  view: UptimeView | null;
  error: string | null;
}

let store: UptimeStore = { view: null, error: null };
const listeners = new Set<() => void>();
const alertListeners = new Set<(alert: UptimeAlert) => void>();
let started: Promise<void> | null = null;

function set(next: Partial<UptimeStore>) {
  store = { ...store, ...next };
  for (const listener of listeners) listener();
}

/**
 * Merges a whole view into the one held. Rust stamps every change from one
 * counter, and four things are told apart by it, since a check's time can't
 * tell (a clear leaves no check at all):
 *
 * - The list (monitors, settings, deliveries) only comes with views, so the
 *   view with the higher `stamp` has it. A check of another monitor says
 *   nothing about the list, so it never makes a view look older.
 * - Each summary is the one with the higher stamp, from either side or from
 *   `early`, for the monitors on that list only: a deleted monitor's summary
 *   goes with it.
 * - A check of a monitor the list doesn't have yet waits in `early`: the
 *   view that adds a monitor can come after its first check. It goes once a
 *   list made after it leaves the monitor out, which means it was deleted.
 * - Being offline is about this computer: the status from whatever was made
 *   last, a view or a check, by `offlineStamp`.
 */
export function mergeView(current: UptimeView | null, incoming: UptimeView): UptimeView {
  if (!current) return incoming;
  const listNewer = (incoming.stamp ?? 0) >= (current.stamp ?? 0);
  const base = { ...(listNewer ? incoming : current) };
  delete base.early;
  const other = new Map((listNewer ? current : incoming).summaries.map((summary) => [summary.id, summary]));
  const early = new Map((current.early ?? []).map((summary) => [summary.id, summary]));
  // The incoming view's summary first, so that it wins a tie: it is the later word.
  const newest = (...options: Array<Summary | undefined>) => options.reduce<Summary | undefined>((best, one) => (one && (!best || one.stamp > best.stamp) ? one : best), undefined);
  const summaries = base.summaries.map((summary) => {
    const theirs = other.get(summary.id);
    return newest(listNewer ? summary : theirs, listNewer ? theirs : summary, early.get(summary.id)) ?? summary;
  });
  const listed = new Set(base.monitors.map((monitor) => monitor.id));
  const waiting = [...early.values()].filter((summary) => !listed.has(summary.id) && summary.stamp > (base.stamp ?? 0));
  const offlineStamp = current.offlineStamp ?? current.stamp ?? 0;
  const offlineNewer = (incoming.stamp ?? 0) >= offlineStamp;
  return {
    ...base,
    summaries,
    offlineSince: offlineNewer ? incoming.offlineSince : current.offlineSince,
    offlineStamp: offlineNewer ? (incoming.stamp ?? 0) : offlineStamp,
    ...(waiting.length > 0 ? { early: waiting } : {}),
  };
}

export function applyBeat(current: UptimeView | null, payload: BeatPayload): UptimeView | null {
  if (!current) return current;
  // Being offline is about this computer, not one monitor: only a check
  // made after whatever last set it says how it is now. The list's own
  // stamp stays, since a check doesn't change the list.
  const offlineStamp = current.offlineStamp ?? current.stamp ?? 0;
  const newest = payload.summary.stamp > offlineStamp;
  const offline = newest ? { offlineSince: payload.offlineSince, offlineStamp: payload.summary.stamp } : null;
  if (!current.summaries.some((summary) => summary.id === payload.id)) {
    // Not on the list yet: kept in `early` until a view adds the monitor,
    // unless the list was made after this check, when it was deleted.
    const held = (current.early ?? []).find((one) => one.id === payload.id);
    const keep = payload.summary.stamp > (current.stamp ?? 0) && (!held || payload.summary.stamp > held.stamp);
    if (!keep) return offline ? { ...current, ...offline } : current;
    return { ...current, ...offline, early: [...(current.early ?? []).filter((one) => one.id !== payload.id), payload.summary] };
  }
  const summaries: Summary[] = current.summaries.map((summary) => (summary.id === payload.id && payload.summary.stamp >= summary.stamp ? payload.summary : summary));
  return { ...current, summaries, ...offline };
}

// Checks that came before the window's first view, which `applyBeat`
// couldn't place on anything yet.
let heldBeats: BeatPayload[] = [];

/** `merged`, with the checks that came before the first view made on it. */
function withHeldBeats(merged: UptimeView): UptimeView {
  if (heldBeats.length === 0) return merged;
  const beats = heldBeats;
  heldBeats = [];
  return beats.reduce<UptimeView>((view, beat) => applyBeat(view, beat) ?? view, merged);
}

export async function refreshUptime(): Promise<void> {
  try {
    const view = await uptimeCommands.state();
    set({ view: withHeldBeats(mergeView(store.view, view)), error: null });
  } catch (error) {
    console.error('Uptime could not be read', error);
    set({ error: error instanceof Error ? error.message : String(error) });
  }
}

/** Starts listening and reads the view once. Safe to call from every place that shows Uptime. */
export function startUptime(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  started ??= (async () => {
    await listenUptime({
      beat: (payload) => {
        // The window's first read of the state can be answered after a
        // check made later: kept until there is a view to put it on.
        if (!store.view) {
          heldBeats = [...heldBeats, payload];
          return;
        }
        set({ view: applyBeat(store.view, payload) });
      },
      state: (view) => set({ view: withHeldBeats(mergeView(store.view, view)), error: null }),
      alert: (alert) => {
        for (const listener of alertListeners) listener(alert);
      },
    });
    await refreshUptime();
  })().catch((error) => {
    console.error('Uptime could not start', error);
    started = null;
  });
  return started;
}

export function onUptimeAlert(listener: (alert: UptimeAlert) => void): () => void {
  alertListeners.add(listener);
  return () => alertListeners.delete(listener);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: UptimeStore = { view: null, error: null };

export function useUptime(): UptimeStore {
  return useSyncExternalStore(subscribe, () => store, () => EMPTY);
}

export function downCount(view: UptimeView | null): number {
  return view ? view.summaries.filter((summary) => summary.state === 'down').length : 0;
}

/** Puts a just-saved change in the store before Rust's own event arrives. */
export function setView(view: UptimeView): void {
  set({ view: withHeldBeats(mergeView(store.view, view)), error: null });
}

/** Settings::SETTINGS_CHANGED in model.rs: a save made from older settings was refused. */
export const SETTINGS_CHANGED = 'Alerts were changed in another window at the same moment. Try again';

// Changes to the alert settings, one at a time.
let settingsQueue: Promise<unknown> = Promise.resolve();
let settingsWaiting: Array<(settings: Settings) => Settings> = [];
let settingsSaved: Settings | null = null;

/** Of Rust's answer to this window's last save and the settings its views brought, the newer. */
function latestSettings(view: UptimeView | null): Settings | undefined {
  const known = view?.settings;
  if (!settingsSaved) return known;
  if (!known) return settingsSaved;
  return (settingsSaved.rev ?? 0) >= (known.rev ?? 0) ? settingsSaved : known;
}

/**
 * Changes the alert settings. Changes go one at a time, each made to the
 * newest settings this window knows, never to the copy it showed when it was
 * asked for: that copy can be older, since a removal waits for a request
 * under way before it answers, and saving it brought back a place just
 * removed. Another editor window can save in between: Rust refuses a change
 * made from older settings (`SETTINGS_CHANGED`), and the change is made
 * again to the settings read afresh. The page shows each change at once
 * (`shownSettings`).
 */
export function changeSettings(change: (settings: Settings) => Settings): Promise<Settings> {
  settingsWaiting = [...settingsWaiting, change];
  set({});
  const run = settingsQueue.then(async () => {
    try {
      for (let attempt = 1; ; attempt += 1) {
        const base = latestSettings(store.view);
        if (!base) throw new Error('Uptime is still opening. Try again in a moment');
        try {
          settingsSaved = await uptimeCommands.saveSettings(change(base));
          return settingsSaved;
        } catch (failure) {
          const refused = (failure instanceof Error ? failure.message : String(failure)).includes(SETTINGS_CHANGED);
          if (!refused || attempt === 3) throw failure;
          settingsSaved = null;
          await refreshUptime();
        }
      }
    } finally {
      // Shown from Rust's answer from here, not as a change on its way, so
      // a place being added never shows twice.
      settingsWaiting = settingsWaiting.slice(1);
      set({});
      // Rust's view after the change can come later than its answer: read
      // it before the page shows its own view again, so the older one never shows.
      await refreshUptime();
      if (settingsWaiting.length === 0) settingsSaved = null;
      set({});
    }
  });
  settingsQueue = run.catch(() => undefined);
  return run;
}

/** The alert settings as the page shows them: Rust's, with the changes still on their way made. */
export function shownSettings(view: UptimeView): Settings {
  return settingsWaiting.reduce((settings, change) => change(settings), latestSettings(view) ?? view.settings);
}

/** The time, ticking while `active`, for "12 s ago" and "next check in 34 s". */
export function useNow(active: boolean, every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(timer);
  }, [active, every]);
  return now;
}
