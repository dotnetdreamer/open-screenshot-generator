"use client";

// The AI's keyword ideas, kept outside the Keywords screen: the Growth view
// mounts a fresh screen for every section, and an AI answer takes a while, so
// the job and its answer live here, per list and country. The newest answer
// is also kept in the growth database (`keywords:ideas:<owner>:<country>`),
// since each one is a request to the AI the user pays for. Stop aborts the
// job's signal, which ends the CLI (ai.ts).

import { useEffect, useSyncExternalStore } from 'react';
import { suggestKeywordIdeas, type KeywordIdeasRequest } from './ai';
import { readMeta, writeMeta } from './db';

export interface KeywordIdeasState {
  terms: string[];
  /** When the AI answered, in ms. */
  at: number | null;
  running: boolean;
  error: string | null;
}

const EMPTY: KeywordIdeasState = { terms: [], at: null, running: false, error: null };
const states = new Map<string, KeywordIdeasState>();
const jobs = new Map<string, AbortController>();
const loaded = new Set<string>();
const listeners = new Set<() => void>();

const keyOf = (owner: string, country: string) => `${owner}|${country}`;
export const keywordIdeasKey = (owner: string, country: string) => `keywords:ideas:${owner}:${country}`;

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(key: string, patch: Partial<KeywordIdeasState>): void {
  states.set(key, { ...(states.get(key) ?? EMPTY), ...patch });
  emit();
}

async function loadStored(owner: string, country: string): Promise<void> {
  const key = keyOf(owner, country);
  if (loaded.has(key)) return;
  loaded.add(key);
  const stored = await readMeta<{ terms: string[]; at: number }>(keywordIdeasKey(owner, country));
  if (!stored || !Array.isArray(stored.terms) || (states.get(key)?.at ?? 0) >= stored.at) return;
  set(key, { terms: stored.terms, at: stored.at });
}

export function useKeywordIdeas(owner: string, country: string): KeywordIdeasState {
  const key = keyOf(owner, country);
  const value = useSyncExternalStore(subscribe, () => states.get(key) ?? EMPTY, () => EMPTY);
  useEffect(() => {
    void loadStored(owner, country).catch((error) => console.error('Reading the keyword ideas failed', error));
  }, [owner, country]);
  return value;
}

/** Ask the AI for ideas, unless it is already being asked for this list and country. */
export function startKeywordIdeas(owner: string, country: string, request: Omit<KeywordIdeasRequest, 'signal'>): void {
  const key = keyOf(owner, country);
  if (jobs.has(key)) return;
  const stop = new AbortController();
  jobs.set(key, stop);
  set(key, { running: true, error: null });
  void suggestKeywordIdeas({ ...request, signal: stop.signal })
    .then(async (terms) => {
      const at = Date.now();
      set(key, { terms, at, running: false });
      await writeMeta(keywordIdeasKey(owner, country), { terms, at });
    })
    .catch((error) => {
      if (stop.signal.aborted) {
        set(key, { running: false });
        return;
      }
      console.error('The AI keyword ideas failed', error);
      set(key, { running: false, error: error instanceof Error ? error.message : 'The AI did not answer. Try again' });
    })
    .finally(() => {
      if (jobs.get(key) === stop) jobs.delete(key);
    });
}

export function stopKeywordIdeas(owner: string, country: string): void {
  jobs.get(keyOf(owner, country))?.abort();
}

/** Take an idea off the AI's list once it is tracked. */
export function dropKeywordIdea(owner: string, country: string, term: string): void {
  const key = keyOf(owner, country);
  const current = states.get(key);
  if (!current || !current.terms.includes(term)) return;
  const terms = current.terms.filter((entry) => entry !== term);
  set(key, { terms });
  if (current.at) void writeMeta(keywordIdeasKey(owner, country), { terms, at: current.at });
}
