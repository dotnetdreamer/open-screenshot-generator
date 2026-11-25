// Test like a reviewer: the checks no scan of the code can prove, which a
// reviewer tries on the version they get. A demo account that signs in, a
// live server, review notes that say where everything is, screenshots of this
// version, account deletion on a real phone, privacy answers that match the
// app, and purchases the reviewer can reach. Since 2.5.0 the playbook's guard
// reads them from `.app-review-readiness.json` in the app's folder and stops
// an upload when one is recorded as failed, so the screen can save that file.
//
// Which checks there are comes from the playbook's template
// (templates/app-review-readiness.json), with the seven the guard knows when
// the copy here has none. Their words are the app's own: the guard keeps its
// titles in its code, not in a file this view downloads.
//
// The answers are kept per project, like the checklist's ticks, in the Store
// compliance database, each with the time it was given, because a pass on
// last month's version says nothing about this one: the file's `checked_on`
// is the day of the oldest answer, and an answer older than 30 days asks to
// be tried again, as the guard does.

import { useCallback, useEffect, useRef, useState } from 'react';
import { daysUntil } from './search';
import { readMetaValue, updateMetaValue } from './store';

export type ReadinessValue = 'pass' | 'fail' | 'na';

export interface ReadinessMark {
  value: ReadinessValue;
  /** When the answer was given. */
  at: number;
  /** Why the check doesn't apply, or what went wrong. */
  note?: string;
}

export interface ReadinessRecord {
  /** The version the checks were tried on, as the user writes it: "1.2 (14)". */
  build: string;
  /** The file asks the guard to stop an upload until every check passes. */
  enforce: boolean;
  /** Answers by check. A check with none is still to do. */
  marks: Record<string, ReadinessMark>;
}

export interface ReadinessCheck {
  key: string;
  title: string;
  /** What to try, in a sentence or two. Null for a check the playbook added that this app has no words for. */
  how: string | null;
  /** The guard takes "doesn't apply" for it, with a reason. Never for the privacy answers: every app has them. */
  naAllowed: boolean;
  /** An example reason, for the box that asks why. */
  naExample?: string;
}

/** The guard's checks, its keys in its order (CHECKS in app-store-compliance-guard.sh). */
export const KNOWN_CHECKS: ReadinessCheck[] = [
  {
    key: 'demo_account',
    title: 'The reviewer can sign in with your demo account',
    how: "Put a demo account in the review notes. Then sign in with it on the version you're sending. It has to work with your live server.",
    naAllowed: true,
    naExample: 'No sign in, so no demo account',
  },
  {
    key: 'live_backend',
    title: 'Your live server is up and has test data in it',
    how: "The version you send has to use your live server, not a test one. Add the data a reviewer needs and keep it running until review is done.",
    naAllowed: true,
    naExample: "The app doesn't use a server",
  },
  {
    key: 'review_notes',
    title: 'Your review notes say where to find every feature',
    how: "Write the taps that reach each feature and each purchase. Say what's behind a sign in or only works in some countries.",
    naAllowed: true,
  },
  {
    key: 'screenshots_match_build',
    title: 'Your screenshots show this version, in use',
    how: "Take them from the version you're sending, on every device you support. That's iPad too if your app runs on iPad.",
    naAllowed: true,
  },
  {
    key: 'account_deletion_device_test',
    title: 'Deleting an account works on a real phone',
    how: "Delete an account on a real phone and wait as long as you tell people it takes. Then check the account and its data are gone, and signing in again doesn't bring it back.",
    naAllowed: true,
    naExample: 'No accounts in the app',
  },
  {
    key: 'privacy_labels_match_runtime',
    title: 'Your privacy answers match what the app collects',
    how: 'Compare your App Privacy and Data safety answers with what the app and its add-on code (SDKs) really send.',
    naAllowed: false,
  },
  {
    key: 'iap_reachable_by_reviewer',
    title: 'The reviewer can find and buy everything you sell',
    how: 'Every purchase has to be easy to reach in the version you send. Send the purchases for review with it, and say where they are in the review notes.',
    naAllowed: true,
    naExample: 'Nothing to buy in the app',
  },
];

/** An answer this old, in days, asks to be tried again (the guard's 30). */
export const READINESS_MAX_AGE = 30;

/** The file the guard reads in the app's folder. */
export const READINESS_FILE_NAME = '.app-review-readiness.json';

/**
 * The checks to show: the template's, in its order, else the guard's seven.
 * A check only the template has gets a name made from its key and no help.
 */
export function readinessChecks(templateKeys: string[]): ReadinessCheck[] {
  if (templateKeys.length === 0) return KNOWN_CHECKS;
  const known = new Map(KNOWN_CHECKS.map((check) => [check.key, check]));
  return [...new Set(templateKeys)].map((key) => known.get(key) ?? { key, title: titleOfKey(key), how: null, naAllowed: true });
}

function titleOfKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function emptyRecord(): ReadinessRecord {
  return { build: '', enforce: false, marks: {} };
}

/** A record as it was saved, read leniently: what isn't an answer is left out. */
export function readRecord(value: unknown): ReadinessRecord {
  const record = emptyRecord();
  if (!value || typeof value !== 'object') return record;
  const raw = value as Record<string, unknown>;
  if (typeof raw.build === 'string') record.build = raw.build.slice(0, 80);
  record.enforce = raw.enforce === true;
  const marks = raw.marks && typeof raw.marks === 'object' ? (raw.marks as Record<string, unknown>) : {};
  for (const [key, mark] of Object.entries(marks)) {
    const entry = mark as Partial<ReadinessMark> | null;
    if (!entry || (entry.value !== 'pass' && entry.value !== 'fail' && entry.value !== 'na') || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) continue;
    const note = typeof entry.note === 'string' ? entry.note.trim().slice(0, 200) : '';
    if (entry.value === 'na' && !note) continue;
    record.marks[key] = { value: entry.value, at: entry.at, ...(note ? { note } : {}) };
  }
  return record;
}

/** YYYY-MM-DD of a moment, in the user's time zone. */
export function dayOf(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** An answer the guard takes as given: yes, no, or "doesn't apply" with a reason where that's allowed. */
function counted(check: ReadinessCheck, mark: ReadinessMark | undefined): mark is ReadinessMark {
  return !!mark && (mark.value !== 'na' || (check.naAllowed && !!mark.note));
}

export interface ReadinessSummary {
  total: number;
  /** Yes, or "doesn't apply" with a reason. */
  done: number;
  failed: number;
  /** Not tried yet, or "doesn't apply" where that isn't allowed. */
  open: number;
  /** Answers older than READINESS_MAX_AGE days. */
  old: number;
  /** The day of the oldest answer, clamped to today: the file's checked_on. Null with no answer. */
  checkedOn: string | null;
}

export function summarize(record: ReadinessRecord, checks: ReadinessCheck[], today: string): ReadinessSummary {
  let done = 0;
  let failed = 0;
  let old = 0;
  let oldest: string | null = null;
  for (const check of checks) {
    const mark = record.marks[check.key];
    if (!counted(check, mark)) continue;
    if (mark.value === 'fail') failed++;
    else done++;
    const day = minDay(dayOf(mark.at), today);
    if (daysUntil(today, day) > READINESS_MAX_AGE) old++;
    if (!oldest || day < oldest) oldest = day;
  }
  return { total: checks.length, done, failed, open: checks.length - done - failed, old, checkedOn: oldest };
}

function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * The readiness file, shaped like the playbook's template: every check as
 * pass, fail, n/a or todo, the reason for each n/a under notes (the guard
 * takes n/a only with one), and checked_on the day of the oldest answer.
 */
export function readinessFileText(record: ReadinessRecord, checks: ReadinessCheck[], today: string): string {
  const values: Record<string, string> = {};
  const notes: Record<string, string> = {};
  for (const check of checks) {
    const mark = record.marks[check.key];
    if (!counted(check, mark)) {
      values[check.key] = 'todo';
      continue;
    }
    values[check.key] = mark.value === 'na' ? 'n/a' : mark.value;
    if (mark.note) notes[check.key] = mark.note;
  }
  const { checkedOn } = summarize(record, checks, today);
  const file: Record<string, unknown> = {};
  if (record.build.trim()) file.build = record.build.trim();
  file.checked_on = checkedOn ?? today;
  file.enforce = record.enforce;
  file.checks = values;
  file.notes = notes;
  return `${JSON.stringify(file, null, 2)}\n`;
}

// --- kept per project, told to the other windows --------------------------------

const keyOf = (list: string) => `readiness:${list}`;

const listeners = new Set<(list: string) => void>();
let channel: BroadcastChannel | null = null;

function announce(list: string): void {
  listeners.forEach((listener) => listener(list));
  try {
    channel?.postMessage({ list });
  } catch {
    // The other windows read the answers when they show the screen.
  }
}

function listen(listener: (list: string) => void): () => void {
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('osg-store-compliance-readiness');
    channel.onmessage = (event: MessageEvent<{ list?: unknown }>) => {
      if (typeof event.data?.list === 'string') listeners.forEach((each) => each(event.data.list as string));
    };
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function readReadiness(list: string): Promise<ReadinessRecord> {
  return readRecord(await readMetaValue<unknown>(keyOf(list)));
}

/** Change the saved answers, read and written in one transaction so a change from another window is kept. */
export async function changeReadiness(list: string, change: (record: ReadinessRecord) => ReadinessRecord): Promise<ReadinessRecord> {
  const next = await updateMetaValue<unknown>(keyOf(list), (value) => change(readRecord(value)));
  announce(list);
  return readRecord(next);
}

export function useReadiness(list: string): {
  record: ReadinessRecord;
  loaded: boolean;
  change: (change: (record: ReadinessRecord) => ReadinessRecord) => void;
} {
  const [record, setRecord] = useState<ReadinessRecord>(emptyRecord);
  const [loaded, setLoaded] = useState(false);
  // Saves of this list still on their way. A read that lands meanwhile may
  // miss the newest change on screen, so it waits for the last save's answer
  // instead. A save of the list before (another project) changes nothing here.
  const saving = useRef({ list, count: 0 });

  useEffect(() => {
    let live = true;
    saving.current = { list, count: 0 };
    const read = () =>
      void readReadiness(list)
        .then((next) => {
          if (live && saving.current.count === 0) {
            setRecord(next);
            setLoaded(true);
          }
        })
        .catch((error) => {
          console.error('Reading the reviewer checks failed', error);
          if (live) setLoaded(true);
        });
    setLoaded(false);
    read();
    const stop = listen((changed) => {
      if (changed === list) read();
    });
    return () => {
      live = false;
      stop();
    };
  }, [list]);

  const change = useCallback(
    (update: (record: ReadinessRecord) => ReadinessRecord) => {
      // On screen at once, then saved; what the last save wrote replaces it.
      setRecord((current) => update(current));
      const mine = saving.current;
      mine.count++;
      const settle = (saved: ReadinessRecord | null) => {
        mine.count--;
        if (saving.current !== mine || mine.count > 0) return;
        if (saved) {
          setRecord(saved);
          setLoaded(true);
        } else {
          void readReadiness(list).then((read) => {
            if (saving.current === mine && mine.count === 0) setRecord(read);
          }, () => undefined);
        }
      };
      void changeReadiness(list, update).then(settle, (error) => {
        console.error('Saving the reviewer checks failed', error);
        settle(null);
      });
    },
    [list]
  );

  return { record, loaded, change };
}
