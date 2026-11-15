// One translation run over any number of languages at once, through the
// engines engines.ts lists, best first.
//
// Each engine takes chunks up to its own size, as many at a time as it allows:
// three for Claude Code, Codex or an API key, one for a local model and for
// our server. An engine that throws gets no more chunks, and whatever it left
// goes to the next engine in the list, so a Claude Code that hits its limit halfway
// still ends in a translated project when Codex or the AI panel is set up too.
// A model that skips some strings is asked once more for just those, and what
// it skips again also goes down the list. Cancelling keeps everything that
// came back before it.

import {
  engineCovers,
  engineLimits,
  translateChunk,
  type ChunkLanguage,
  type EngineLimits,
  type TranslateEngine,
} from './engines';

export interface TranslationJob {
  /** Names the job in its outcome, e.g. the language code. */
  key: string;
  /**
   * Distinct strings, ids unique within the job. `weight` is how many
   * elements wait on the string, which is what progress counts.
   */
  items: Array<{ id: string; text: string; weight?: number }>;
  target: ChunkLanguage;
  /** Unset when the source language is not known. */
  source?: ChunkLanguage;
}

export interface JobOutcome {
  key: string;
  /** id -> translation, for every string that came back. */
  translations: Map<string, string>;
  /** The engine that wrote most of them. Unset when none came back. */
  engine?: TranslateEngine;
  /** What the last engine to fail on this job said, when one did. */
  error?: string;
  /** Our server asked to slow down, so some strings were never sent. */
  rateLimited: boolean;
  /** No engine in the list could take this language at all. */
  uncovered: boolean;
}

export interface TranslationRunProgress {
  /** Weighted strings that came back, and all of them. */
  done: number;
  total: number;
  /** Jobs with nothing left to translate. */
  jobsDone: number;
  /** The engine at work. */
  engine: TranslateEngine;
}

export interface TranslationRunOptions {
  /** Best first. */
  engines: TranslateEngine[];
  /** The user's brief for a model. */
  guidance?: string;
  signal?: AbortSignal;
  onProgress?: (progress: TranslationRunProgress) => void;
}

type Item = TranslationJob['items'][number];

interface JobState {
  job: TranslationJob;
  outcome: JobOutcome;
  /** Strings written by each engine, to name the one that wrote most. */
  written: Map<TranslateEngine, number>;
  /** Some engine in the list could take this job. */
  covered: boolean;
}

interface Unit {
  state: JobState;
  items: Item[];
}

/** Groups of items that fit one request under both of the engine's limits. */
export function chunkItems<T extends { text: string }>(items: T[], limits: Pick<EngineLimits, 'chunkItems' | 'chunkChars'>): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const item of items) {
    if (current.length > 0 && (current.length >= limits.chunkItems || chars + item.text.length > limits.chunkChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Runs `work` over `units` with at most `atOnce` in flight. `work` must not throw. */
async function pool<T>(units: T[], atOnce: number, work: (unit: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < units.length) {
      const unit = units[next++];
      await work(unit);
    }
  };
  const lanes = Math.max(1, Math.min(atOnce, units.length));
  await Promise.all(Array.from({ length: lanes }, lane));
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'The translation did not come back';
}

/**
 * Translate every job and resolve with one outcome per job, in order. Never
 * throws: what failed is in each outcome's counts and `error`.
 */
export async function runTranslation(jobs: TranslationJob[], options: TranslationRunOptions): Promise<JobOutcome[]> {
  const states: JobState[] = jobs.map((job) => ({
    job,
    outcome: { key: job.key, translations: new Map(), rateLimited: false, uncovered: false },
    written: new Map(),
    covered: false,
  }));
  const weight = (item: Item) => item.weight ?? 1;
  const total = jobs.reduce((sum, job) => sum + job.items.reduce((inner, item) => inner + weight(item), 0), 0);
  const signal = options.signal;
  let done = 0;
  let lastError: string | undefined;
  let rateLimited = false;

  const open = (state: JobState) => state.job.items.filter((item) => !state.outcome.translations.has(item.id));
  const report = (engine: TranslateEngine) =>
    options.onProgress?.({
      done,
      total,
      jobsDone: states.filter((state) => open(state).length === 0).length,
      engine,
    });

  /** One pass of chunks through one engine. True when the engine threw. */
  const runPass = async (engine: TranslateEngine, units: Unit[], limits: EngineLimits): Promise<boolean> => {
    let threw = false;
    await pool(units, limits.atOnce, async ({ state, items }) => {
      if (threw || rateLimited || signal?.aborted) return;
      try {
        const result = await translateChunk(engine, {
          items,
          target: state.job.target,
          source: state.job.source,
          guidance: options.guidance,
          signal,
        });
        for (const item of items) {
          const text = result.translations[item.id];
          if (text === undefined || state.outcome.translations.has(item.id)) continue;
          state.outcome.translations.set(item.id, text);
          state.written.set(engine, (state.written.get(engine) ?? 0) + 1);
          done += weight(item);
        }
        if (result.rateLimited) {
          state.outcome.rateLimited = true;
          rateLimited = true;
        }
        report(engine);
      } catch (error) {
        if (signal?.aborted) return;
        threw = true;
        lastError = messageOf(error);
        state.outcome.error = lastError;
        console.error(`Translating with ${engine} failed`, error);
      }
    });
    return threw;
  };

  for (const engine of options.engines) {
    if (signal?.aborted || rateLimited) break;
    const limits = engineLimits(engine);

    const units: Unit[] = [];
    for (const state of states) {
      const left = open(state);
      if (left.length === 0 || !engineCovers(engine, state.job.target, state.job.source)) continue;
      state.covered = true;
      for (const items of chunkItems(left, limits)) units.push({ state, items });
    }
    if (units.length === 0) continue;

    report(engine);
    if (await runPass(engine, units, limits)) continue;
    if (signal?.aborted || rateLimited) break;

    // The strings a model was asked for and left out, asked for once more.
    // Our server answers every string it was sent or fails it on its own.
    if (engine === 'libre') continue;
    const retry: Unit[] = [];
    for (const state of states) {
      const asked = new Set(units.filter((unit) => unit.state === state).flatMap((unit) => unit.items.map((item) => item.id)));
      const skipped = open(state).filter((item) => asked.has(item.id));
      for (const items of chunkItems(skipped, limits)) retry.push({ state, items });
    }
    if (retry.length > 0) await runPass(engine, retry, limits);
  }

  return states.map((state) => {
    const left = open(state).length > 0;
    let engine: TranslateEngine | undefined;
    let most = 0;
    for (const [candidate, count] of state.written) {
      if (count > most) {
        engine = candidate;
        most = count;
      }
    }
    return {
      ...state.outcome,
      engine,
      // A job that the next engine finished needs no error, and one whose
      // strings were never sent because an engine stopped on another job's
      // chunk still needs the reason.
      error: left ? state.outcome.error ?? lastError : undefined,
      rateLimited: left && (state.outcome.rateLimited || rateLimited),
      uncovered: left && !state.covered,
    };
  });
}
