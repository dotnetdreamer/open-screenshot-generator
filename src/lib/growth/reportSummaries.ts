// Report summaries, kept outside the Reports screen.
//
// The Growth view mounts a fresh screen for every section it moves to. A
// summary asked for just before the user looked at the Reviews would land in
// a screen that is gone, and the one they come back to would offer to write
// it again. So the summaries live here, by the key they are stored under in
// the growth database (`report:summary:...`), with the ones being written and
// why the last try failed. A second request for a period whose summary is
// on its way joins that one. "Remove this app's data" clears the rows, and
// discardReportSummaries the copies here.

import { useEffect, useSyncExternalStore } from 'react';
import { writeReportSummary } from './ai';
import { readMeta, writeMeta } from './db';

interface KeptSummary {
  text?: string;
  /** Set while the summary is being written. */
  writing?: Promise<string>;
  /** Why the last try failed, until the next one. */
  failure?: string;
}

const NONE: KeptSummary = {};
const kept = new Map<string, KeptSummary>();
const read = new Set<string>();
const listeners = new Set<() => void>();

function get(key: string): KeptSummary {
  return kept.get(key) ?? NONE;
}

function update(key: string, change: KeptSummary): void {
  kept.set(key, { ...get(key), ...change });
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function readStored(key: string): Promise<void> {
  if (read.has(key)) return;
  read.add(key);
  const stored = await readMeta<string>(key);
  if (stored && !get(key).text) update(key, { text: stored });
}

/** One period's summary, whether it is being written, and why the last try failed. */
export function useReportSummary(key: string): { text: string | null; writing: boolean; failure: string | null } {
  const summary = useSyncExternalStore(subscribe, () => get(key), () => NONE);
  useEffect(() => {
    if (key) void readStored(key).catch((error) => console.error('Reading the report summary failed', error));
  }, [key]);
  return { text: summary.text ?? null, writing: summary.writing !== undefined, failure: summary.failure ?? null };
}

/**
 * Write the summary of one period and keep it under `key`. While one is on
 * its way for that key, a second call joins it rather than asking again.
 */
export function writeKeptReportSummary(key: string, facts: string, appName: string): Promise<string> {
  const running = get(key).writing;
  if (running) return running;
  // Still this key's request, and not discarded with the app's data meanwhile.
  const current = () => get(key).writing === writing;
  const writing: Promise<string> = (async () => {
    const text = await writeReportSummary(facts, appName);
    // Shown even if it cannot be kept: it was written for this period.
    if (current()) await writeMeta(key, text).catch((error) => console.error('Keeping the report summary failed', error));
    return text;
  })();
  update(key, { writing, failure: undefined });
  writing.then(
    (text) => {
      if (current()) update(key, { text, writing: undefined });
    },
    (failure) => {
      if (current()) update(key, { writing: undefined, failure: failure instanceof Error ? failure.message : 'The summary could not be written' });
    }
  );
  return writing;
}

/** Forget an app's summaries in memory, after its stored data was removed. */
export function discardReportSummaries(appId: string): void {
  const prefix = `report:summary:${appId}:`;
  for (const key of [...kept.keys()]) if (key.startsWith(prefix)) kept.delete(key);
  for (const key of [...read]) if (key.startsWith(prefix)) read.delete(key);
  listeners.forEach((listener) => listener());
}
