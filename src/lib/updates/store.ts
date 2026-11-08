"use client";

// The page's half of desktop updates: one shared copy of Rust's state, and the
// schedule that decides when to ask the server.
//
// Only the main editor window runs the schedule (startUpdates, through
// useUpdateSchedule in the layout): Rust refuses a check or an install from any
// other window. Everything that shows update state (the sidebar prompt, the
// Settings section) reads the copy here, so a window that never started it
// reads null and shows nothing.
//
// When to check is decided here because the switches that govern it are
// editor preferences: on startup after a short delay, every CHECK_INTERVAL_MS
// after that, when the window comes back to the front with a check overdue,
// and when the user changes channel.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { isTauri, openExternal } from '@/lib/desktop';
import { readPreference, subscribePreferences } from '@/lib/editorPreferences';
import {
  fetchUpdateState,
  installUpdate,
  listenUpdateCheckRequest,
  listenUpdateState,
  requestUpdateCheck,
} from './client';
import {
  downloadPageFor,
  FIRST_CHECK_DELAY_MS,
  isCheckDue,
  nextCheckDelay,
  promptFor,
  type UpdateToast,
} from './describe';
import type { UpdateChannel, UpdateInfo, UpdateSnapshot } from './types';

/** How updater.rs starts the error when an editor window could not write its edits. */
const EDITS_NOT_SAVED = 'edits-not-saved';

let snapshot: UpdateSnapshot | null = null;
/** Bumped to ask the sidebar's update prompt to open. */
let promptRequests = 0;
/** Critical updates whose prompt was opened unasked this session, so it happens once each. */
const promptedCritical = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setSnapshot(next: UpdateSnapshot): void {
  snapshot = next;
  // A critical update opens its prompt the first time it is ready, without
  // waiting for a click: it fixes something people should not keep running.
  const prompt = promptFor(next);
  if (prompt?.kind === 'ready' && prompt.update.critical && !promptedCritical.has(prompt.update.version)) {
    promptedCritical.add(prompt.update.version);
    promptRequests += 1;
  }
  notify();
}

export function getUpdateSnapshot(): UpdateSnapshot | null {
  return snapshot;
}

/** Rust's update state, live. Null on the web and in any window but the main editor. */
export function useUpdateSnapshot(): UpdateSnapshot | null {
  return useSyncExternalStore(subscribe, () => snapshot, () => null);
}

/** A counter the sidebar prompt watches: every bump is a request to open. */
export function usePromptRequests(): number {
  return useSyncExternalStore(subscribe, () => promptRequests, () => 0);
}

export function updateChannel(): UpdateChannel {
  return readPreference('updatesBeta') ? 'beta' : 'stable';
}

/**
 * Asks the server now. `manual` means the user asked, so the prompt opens on
 * whatever is found. Resolves with the state after the answer, or null when
 * the check could not run at all.
 */
export async function checkForUpdates(manual: boolean): Promise<UpdateSnapshot | null> {
  if (!snapshot || snapshot.mode === 'off') return snapshot;
  try {
    const next = await requestUpdateCheck(updateChannel());
    setSnapshot(next);
    if (manual && promptFor(next)) {
      promptRequests += 1;
      notify();
    }
    return next;
  } catch (error) {
    console.error('The update check did not run.', error);
    return null;
  }
}

/**
 * Installs the ready update and restarts into it. In the desktop shell a
 * successful install restarts the app before this settles. Resolves with what
 * to tell the user when the install did not happen, and null otherwise.
 */
export async function restartIntoUpdate(): Promise<UpdateToast | null> {
  try {
    await installUpdate();
    return null;
  } catch (error) {
    console.error('The update was not installed.', error);
    // A Rust command rejects with its error string; anything else that throws is an Error.
    const reason = error instanceof Error ? error.message : String(error);
    if (reason.startsWith(EDITS_NOT_SAVED)) {
      return {
        title: 'The app did not restart',
        description: 'An editor window could not save your latest edits. Check your work, then try again.',
      };
    }
    return {
      title: 'The update was not installed',
      description: 'Nothing changed. Try again in a moment, or download the new version instead.',
    };
  }
}

/** Opens the release's download page in the browser. */
export async function openDownloadPage(update: UpdateInfo): Promise<void> {
  await openExternal(downloadPageFor(update));
}

/**
 * Starts listening to Rust and checking on schedule. The main editor window
 * calls this once; the return value stops it all.
 *
 * `onMenuCheck` gets the result of a check started from Help > Check for
 * updates, so the caller can say what it found.
 */
export function startUpdates(onMenuCheck: (result: UpdateSnapshot | null) => void): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stops: Array<() => void> = [];

  const autoCheckOn = () => readPreference('updatesAutoCheck');

  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => void runScheduled(), delay);
  };

  const runScheduled = async () => {
    if (disposed) return;
    if (snapshot && snapshot.mode !== 'off' && autoCheckOn() && isCheckDue(snapshot.checkedAt, Date.now())) {
      await checkForUpdates(false);
    }
    schedule(nextCheckDelay(snapshot, Date.now()));
  };

  // A laptop that slept through a timer catches up when it is used again.
  const onFront = () => {
    if (document.visibilityState !== 'visible' || !snapshot || snapshot.mode === 'off') return;
    if (autoCheckOn() && isCheckDue(snapshot.checkedAt, Date.now())) schedule(0);
  };
  window.addEventListener('focus', onFront);
  document.addEventListener('visibilitychange', onFront);
  stops.push(() => {
    window.removeEventListener('focus', onFront);
    document.removeEventListener('visibilitychange', onFront);
  });

  // A new channel is a new question: ask it straight away. Turning automatic
  // checks back on asks too, if one is overdue.
  let beta = readPreference('updatesBeta');
  let autoCheck = autoCheckOn();
  stops.push(
    subscribePreferences(() => {
      const nextBeta = readPreference('updatesBeta');
      const nextAutoCheck = autoCheckOn();
      const channelChanged = nextBeta !== beta;
      const turnedOn = nextAutoCheck && !autoCheck;
      beta = nextBeta;
      autoCheck = nextAutoCheck;
      if (!snapshot || snapshot.mode === 'off') return;
      if (channelChanged && nextAutoCheck) void checkForUpdates(false);
      else if (turnedOn && isCheckDue(snapshot.checkedAt, Date.now())) schedule(0);
    })
  );

  (async () => {
    const initial = await fetchUpdateState();
    if (disposed || !initial) return;
    setSnapshot(initial);
    if (initial.mode === 'off') return;

    const stopState = await listenUpdateState(setSnapshot);
    const stopMenu = await listenUpdateCheckRequest(() => {
      void checkForUpdates(true).then(onMenuCheck);
    });
    if (disposed) {
      stopState();
      stopMenu();
      return;
    }
    stops.push(stopState, stopMenu);
    schedule(FIRST_CHECK_DELAY_MS);
  })();

  return () => {
    disposed = true;
    clearTimeout(timer);
    stops.forEach((stop) => stop());
  };
}

/** Runs startUpdates for as long as the component is mounted and `enabled` holds. */
export function useUpdateSchedule(enabled: boolean, onMenuCheck: (result: UpdateSnapshot | null) => void): void {
  // Read when the menu fires, so a new callback on every render does not
  // restart the schedule.
  const onMenuCheckRef = useRef(onMenuCheck);
  onMenuCheckRef.current = onMenuCheck;
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    return startUpdates((result) => onMenuCheckRef.current(result));
  }, [enabled]);
}
