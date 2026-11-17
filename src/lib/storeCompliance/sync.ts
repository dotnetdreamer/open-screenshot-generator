// Keeping the playbook on this computer the same as the one on GitHub.
//
// Nothing is fetched until the view is opened. The first time it shows in a
// sitting, and again when it shows six hours after the last check, the app
// asks GitHub which commit the branch is on (source.ts). The same commit as
// the files here is a 304 and nothing else happens. A new one brings the
// commit's file list, and only the files whose git hash changed are
// downloaded, each checked against that hash, so a CDN that sends something
// else is caught. The update is written in one transaction, and only once the
// two data files of the new commit could be read: a commit with a broken data
// file keeps the last copy that worked, and that commit is not tried again.
// Every other file is optional: one that fails to download or cannot be used
// never stops an update. It keeps its last good copy, and a download that
// failed is tried again at the next check (fillGaps), by commit and hash.
//
// Every file kept here matched the git hash GitHub's own file list gives for
// it; nothing is ever read from the branch unchecked. When that list cannot
// be had (GitHub's API does not answer: offline, or its 60 an hour used up),
// or no host sends a file that matches it, nothing new is taken: the copy
// here is shown as it is, and with no copy the view says why and offers to
// try again.
//
// One check runs at a time across the app's windows (a Web Lock). A window
// that waited for the lock while another window checked takes that check
// rather than asking again, and every window hears about an update over a
// BroadcastChannel.

import { useSyncExternalStore } from 'react';
import { gitBlobSha } from '@/lib/website/github';
import { buildLibrary, BrokenFileError, DEADLINES_FILE, RULES_FILE, usableFile, validateRequired } from './parse';
import { BRANCH_HEAD_URL, REQUIRED_FILES, cdnUrl, isCorePath, isGuidePath, isHash, rawUrl, treeUrl } from './source';
import { dexieRulesStore, type RulesStore } from './store';
import type { RulesLibrary, StoredFile, SyncCatalog, SyncHead, SyncNews, SyncProblem } from './types';

export interface SyncProgress {
  done: number;
  total: number;
}

export type SyncOutcome =
  | { kind: 'unchanged' }
  | { kind: 'updated'; files: number; news: SyncNews | null }
  | { kind: 'skipped' }
  | { kind: 'problem'; problem: SyncProblem };

export interface SyncDeps {
  store: RulesStore;
  fetch: typeof fetch;
  now: () => number;
}

const EMPTY_HEAD: SyncHead = { commit: null, etag: null, checkedAt: null, changedAt: null, waitUntil: null, problem: null };

/** How many files download at once. */
const PARALLEL = 4;

/** The two data files: an update without both, readable, is not taken. Every other file is optional. */
function isRequired(path: string): boolean {
  return (REQUIRED_FILES as readonly string[]).includes(path);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`${url} answered ${status}`);
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** A request that never reached GitHub: no connection, a blocked host, a CORS refusal. */
function isNetwork(error: unknown): boolean {
  return error instanceof TypeError;
}

interface TreeEntry {
  path: string;
  sha: string;
  size: number;
}

function readTree(data: unknown): TreeEntry[] {
  const tree = (data as { tree?: unknown })?.tree;
  if (!Array.isArray(tree)) throw new Error('GitHub sent no file list');
  return tree
    .filter((entry): entry is { path: string; sha: string; size?: number; type: string } => {
      const value = entry as Record<string, unknown>;
      return value?.type === 'blob' && typeof value.path === 'string' && isHash(value.sha);
    })
    .map((entry) => ({ path: entry.path, sha: entry.sha, size: typeof entry.size === 'number' ? entry.size : 0 }));
}

/** Run `work` on every entry, a few at a time, in order of the results. */
async function eachLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * One file as a commit has it, from raw.githubusercontent.com, else from
 * jsDelivr. Each copy is checked against the git hash the commit's file list
 * gave: one that does not match is refused and the next host is asked, and
 * when no host sends a matching copy the file is not taken.
 */
export async function downloadFile(
  deps: Pick<SyncDeps, 'fetch' | 'now'>,
  commit: string,
  path: string,
  expected: string,
  signal?: AbortSignal
): Promise<StoredFile> {
  let lastError: unknown = null;
  for (const url of [rawUrl(commit, path), cdnUrl(commit, path)]) {
    try {
      // A commit's file never changes, so the browser may keep it.
      const response = await deps.fetch(url, { cache: 'force-cache', signal });
      if (!response.ok) throw new HttpError(response.status, url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const sha = await gitBlobSha(bytes);
      if (sha !== expected) throw new Error(`${url} sent a file that does not match the commit`);
      return { path, sha, size: bytes.length, text: new TextDecoder().decode(bytes), fetchedAt: deps.now() };
    } catch (error) {
      if (isAbort(error)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error(`${path} could not be downloaded`);
}

/** The reset time GitHub sends with a 403 or 429, in ms. */
function waitFrom(response: Response, now: number): number {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(reset * 1000, now + 60_000);
  const retry = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retry) && retry > 0) return now + retry * 1000;
  return now + 15 * 60_000;
}

/** New rules and deadlines in `next` that `before` did not have. */
function whatsNew(before: RulesLibrary | null, next: RulesLibrary | null): { rules: string[]; deadlines: string[] } {
  if (!before || !next) return { rules: [], deadlines: [] };
  const oldRules = new Set(before.rules.map((rule) => rule.id));
  const oldDeadlines = new Set(before.deadlines.map((deadline) => deadline.id));
  return {
    rules: next.rules.filter((rule) => !oldRules.has(rule.id)).map((rule) => rule.id),
    deadlines: next.deadlines.filter((deadline) => !oldDeadlines.has(deadline.id)).map((deadline) => deadline.id),
  };
}

/**
 * One check, start to end. Pure apart from `deps`, so the unit tests run it
 * against a fake GitHub and a store in memory.
 */
export async function runSync(
  deps: SyncDeps,
  options: { force?: boolean; signal?: AbortSignal; onProgress?: (progress: SyncProgress) => void } = {}
): Promise<SyncOutcome> {
  const { store, fetch: get, now } = deps;
  const { force = false, signal, onProgress } = options;
  const head = (await store.readHead()) ?? EMPTY_HEAD;
  const stored = await store.readFiles();
  const byPath = new Map(stored.map((file) => [file.path, file]));
  const haveCopy = REQUIRED_FILES.every((path) => byPath.has(path));
  const started = now();

  if (!force && haveCopy && head.waitUntil && started < head.waitUntil) return { kind: 'skipped' };

  const keepCopy = async (kind: SyncProblem['kind'], waitUntil: number | null = head.waitUntil): Promise<SyncOutcome> => {
    const problem: SyncProblem = { kind, message: problemMessage(kind, true), at: started };
    await store.writeHead({ ...head, waitUntil, problem });
    return { kind: 'problem', problem };
  };

  // Nothing new can be taken: GitHub's API did not answer, so there are no
  // hashes, or no host sent a file that matches them. The copy here stays;
  // with none, the view says why. Nothing is read from the branch unchecked.
  const nothingNew = async (kind: SyncProblem['kind'], waitUntil: number | null): Promise<SyncOutcome> => {
    if (haveCopy) return keepCopy(kind, waitUntil);
    const problem: SyncProblem = { kind, message: problemMessage(kind, false), at: started };
    await store.writeHead({ ...head, waitUntil, problem });
    return { kind: 'problem', problem };
  };

  // The commit here is the branch's: fill in what an earlier check could not
  // download, by commit and hash, which asks nothing of GitHub's API.
  const fillGaps = async (checked: SyncHead): Promise<SyncOutcome> => {
    const catalog = await store.readCatalog();
    if (!catalog?.commit || catalog.commit !== checked.commit) return { kind: 'unchanged' };
    const gaps = Object.entries(catalog.files).filter(([path, entry]) => isCorePath(path) && !isRequired(path) && byPath.get(path)?.sha !== entry.sha);
    if (gaps.length === 0) return { kind: 'unchanged' };
    const files = await eachLimited(gaps, PARALLEL, ([path, entry]) =>
      downloadFile(deps, catalog.commit!, path, entry.sha, signal).catch((error) => {
        if (isAbort(error)) throw error;
        return null;
      })
    );
    const got = files.filter((file): file is StoredFile => !!file && usableFile(file));
    if (got.length === 0) return { kind: 'unchanged' };
    await store.commit({ put: got, remove: [], head: { ...checked, changedAt: started } });
    return { kind: 'updated', files: got.length, news: null };
  };

  // 1. The commit the branch is on.
  let commit: string;
  let etag: string | null;
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.sha' };
    if (haveCopy && head.commit && head.etag) headers['If-None-Match'] = head.etag;
    const response = await get(BRANCH_HEAD_URL, { headers, cache: 'no-store', signal });
    if (response.status === 304) {
      const checked: SyncHead = { ...head, checkedAt: started, waitUntil: null, problem: null };
      await store.writeHead(checked);
      return fillGaps(checked);
    }
    if (response.status === 403 || response.status === 429) return nothingNew('limited', waitFrom(response, started));
    if (!response.ok) throw new HttpError(response.status, BRANCH_HEAD_URL);
    commit = (await response.text()).trim();
    if (!isHash(commit)) throw new Error('GitHub sent no commit');
    etag = response.headers.get('etag');
  } catch (error) {
    if (isAbort(error)) throw error;
    console.error('Checking GitHub for a new playbook failed', error);
    return nothingNew(isNetwork(error) ? 'offline' : 'failed', head.waitUntil);
  }

  if (haveCopy && commit === head.commit) {
    const checked: SyncHead = { ...head, etag: etag ?? head.etag, checkedAt: started, waitUntil: null, problem: null };
    await store.writeHead(checked);
    return fillGaps(checked);
  }
  // A commit already found broken is not downloaded again until it changes.
  if (!force && haveCopy && head.problem?.kind === 'broken' && head.problem.commit === commit) {
    await store.writeHead({ ...head, checkedAt: started });
    return { kind: 'problem', problem: head.problem };
  }

  // 2. The commit's files, and which of them changed.
  let tree: TreeEntry[];
  try {
    const response = await get(treeUrl(commit), { signal });
    if (response.status === 403 || response.status === 429) return nothingNew('limited', waitFrom(response, started));
    if (!response.ok) throw new HttpError(response.status, treeUrl(commit));
    tree = readTree(await response.json());
  } catch (error) {
    if (isAbort(error)) throw error;
    console.error("Reading the playbook's file list failed", error);
    return nothingNew(isNetwork(error) ? 'offline' : 'failed', head.waitUntil);
  }

  const broken = async (path: string): Promise<SyncOutcome> => {
    const problem: SyncProblem = { kind: 'broken', message: problemMessage('broken', haveCopy, path), at: started, commit };
    await store.writeHead({ ...head, checkedAt: started, waitUntil: null, problem });
    return { kind: 'problem', problem };
  };

  const core = tree.filter((entry) => isCorePath(entry.path));
  const missing = REQUIRED_FILES.find((path) => !core.some((entry) => entry.path === path));
  if (missing) return broken(missing);
  const wanted = core.filter((entry) => byPath.get(entry.path)?.sha !== entry.sha);

  // 3. Download them. An optional file that fails keeps its copy here, and
  // the next check tries it again (fillGaps); only the data files must come.
  let done = 0;
  onProgress?.({ done, total: wanted.length });
  let got: StoredFile[];
  try {
    const files = await eachLimited(wanted, PARALLEL, async (entry) => {
      try {
        return await downloadFile(deps, commit, entry.path, entry.sha, signal);
      } catch (error) {
        if (isAbort(error) || isRequired(entry.path)) throw error;
        console.warn(`Downloading ${entry.path} failed; the copy here stays until the next check`, error);
        return null;
      } finally {
        onProgress?.({ done: ++done, total: wanted.length });
      }
    });
    got = files.filter((file): file is StoredFile => !!file);
  } catch (error) {
    if (isAbort(error)) throw error;
    console.error('Downloading the playbook failed', error);
    return nothingNew(isNetwork(error) ? 'offline' : 'failed', null);
  }

  // 4. Keep it only if the new version can be read. An optional file that
  // cannot be read (detection recipes, the plain words) keeps the copy that
  // worked, and is not asked for again until a commit changes it.
  const unreadable = new Set(got.filter((file) => !isRequired(file.path) && !usableFile(file)).map((file) => file.path));
  for (const path of unreadable) console.warn(`${path} of commit ${commit} cannot be read; the copy that worked stays`);
  const taken = got.filter((file) => !unreadable.has(file.path));
  const inTree = new Set(tree.map((entry) => entry.path));
  const remove = stored
    .filter((file) => (isCorePath(file.path) || isGuidePath(file.path)) && !inTree.has(file.path))
    .map((file) => file.path);
  const next = new Map(byPath);
  for (const path of remove) next.delete(path);
  for (const file of taken) next.set(file.path, file);
  try {
    validateRequired(next);
  } catch (error) {
    if (error instanceof BrokenFileError) return broken(error.path);
    throw error;
  }

  // 5. What is new since the copy that was here.
  let news: SyncNews | null | undefined;
  if (haveCopy && taken.some((file) => file.path === RULES_FILE || file.path === DEADLINES_FILE)) {
    const fresh = whatsNew(buildLibrary(byPath, head.commit), buildLibrary(next, commit));
    if (fresh.rules.length > 0 || fresh.deadlines.length > 0) {
      const earlier = await store.readNews();
      const unseen = earlier && !earlier.seen ? earlier : null;
      news = {
        at: started,
        rules: [...new Set([...(unseen?.rules ?? []), ...fresh.rules])],
        deadlines: [...new Set([...(unseen?.deadlines ?? []), ...fresh.deadlines])],
        seen: false,
      };
    }
  }

  // A file that cannot be read is listed as the copy kept (or not at all), so
  // fillGaps does not fetch it again for this commit.
  const listed: SyncCatalog['files'] = {};
  for (const entry of tree) {
    if (!isGuidePath(entry.path) && !isCorePath(entry.path)) continue;
    const kept = unreadable.has(entry.path) ? byPath.get(entry.path) : null;
    if (unreadable.has(entry.path) && !kept) continue;
    listed[entry.path] = kept ? { sha: kept.sha, size: kept.size } : { sha: entry.sha, size: entry.size };
  }
  const catalog: SyncCatalog = { commit, files: listed };
  const changed = taken.length > 0 || remove.length > 0;
  await store.commit({
    put: taken,
    remove,
    head: {
      commit,
      etag: etag ?? `"${commit}"`,
      checkedAt: started,
      changedAt: changed ? started : head.changedAt ?? started,
      waitUntil: null,
      problem: null,
    },
    catalog,
    news,
  });
  return { kind: 'updated', files: taken.length, news: news ?? null };
}

/** What a problem means for the user, said once here so every screen says the same. */
export function problemMessage(kind: SyncProblem['kind'], haveCopy: boolean, path?: string): string {
  const shown = haveCopy ? ' Showing the rules saved on this computer.' : '';
  switch (kind) {
    case 'offline':
      return haveCopy ? `Can't reach GitHub right now.${shown}` : "Can't reach GitHub to get the rules. Check your internet connection, then try again.";
    case 'limited':
      return haveCopy ? `GitHub asked for a short wait before the next check.${shown}` : 'GitHub asked for a short wait. Try again in a few minutes.';
    case 'broken':
      return `The newest rules on GitHub have a file that can't be read${path ? ` (${path})` : ''}.${shown}`;
    default:
      return haveCopy ? `GitHub didn't send the new rules.${shown}` : "GitHub didn't send the rules. Try again in a minute.";
  }
}

// --- the view's state, shared by its screens -----------------------------------

export interface RulesState {
  /** The database has been read. */
  loaded: boolean;
  library: RulesLibrary | null;
  head: SyncHead | null;
  catalog: SyncCatalog | null;
  news: SyncNews | null;
  checking: boolean;
  progress: SyncProgress | null;
  /** A check has ended in this sitting, so a missing library is a failure, not a wait. */
  checkedOnce: boolean;
}

const INITIAL: RulesState = { loaded: false, library: null, head: null, catalog: null, news: null, checking: false, progress: null, checkedOnce: false };

let state: RulesState = INITIAL;
const listeners = new Set<() => void>();
let deps: SyncDeps | null = null;

function appDeps(): SyncDeps {
  if (!deps) deps = { store: dexieRulesStore, fetch: (input, init) => window.fetch(input, init), now: () => Date.now() };
  return deps;
}

/** For the e2e harness and the unit tests: another store or fetch. */
export function setRulesSyncDeps(next: SyncDeps | null): void {
  deps = next;
  state = INITIAL;
  sessionChecked = false;
  attemptedAt = 0;
  loading = null;
  emit();
}

function setState(patch: Partial<RulesState>): void {
  state = { ...state, ...patch };
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  listenAcrossWindows();
  return () => listeners.delete(listener);
}

export function useStoreCompliance(): RulesState {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}

export function getRulesState(): RulesState {
  return state;
}

let channel: BroadcastChannel | null = null;

function listenAcrossWindows(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel('osg-store-compliance');
  channel.onmessage = () => void reloadRules();
}

function tellOtherWindows(): void {
  try {
    channel?.postMessage({ kind: 'changed' });
  } catch {
    // A closed channel: the other windows read the database when they open the view.
  }
}

// The parsed library is rebuilt only when the files change.
let builtFrom = '';

async function readState(): Promise<Partial<RulesState>> {
  const { store } = appDeps();
  const [files, head, catalog, news] = await Promise.all([store.readFiles(), store.readHead(), store.readCatalog(), store.readNews()]);
  const core = files.filter((file) => isCorePath(file.path));
  const key = `${head?.commit ?? ''}|${core.map((file) => `${file.path}:${file.sha}`).sort().join(',')}`;
  const library = key === builtFrom && state.library ? state.library : buildLibrary(new Map(core.map((file) => [file.path, file])), head?.commit ?? null);
  builtFrom = key;
  return { loaded: true, library, head, catalog, news };
}

let loading: Promise<void> | null = null;

/** Read what this computer has. Once, then again whenever an update lands. */
export function loadRules(): Promise<void> {
  if (!loading) {
    loading = readState()
      .then(setState)
      .catch((error) => {
        console.error('Reading the saved playbook failed', error);
        setState({ loaded: true });
      });
  }
  return loading;
}

async function reloadRules(): Promise<void> {
  loading = null;
  await loadRules();
}

/** A check is made the first time the view shows in a sitting, then once this long has passed. */
const RECHECK_MS = 6 * 60 * 60 * 1000;

/** Whether showing the view should ask GitHub now. Exported for the tests. */
export function checkDue(input: { now: number; checkedAt: number | null; attemptedAt: number; checkedThisSitting: boolean }): boolean {
  if (!input.checkedThisSitting) return true;
  return input.now - Math.max(input.checkedAt ?? 0, input.attemptedAt) >= RECHECK_MS;
}

let sessionChecked = false;
/** The last check started in this window. A failed check moves no stored time, and must not be retried on every visit. */
let attemptedAt = 0;
let running: Promise<SyncOutcome> | null = null;

/** Called whenever the view shows. Asks GitHub only when a check is due. */
export async function openStoreCompliance(): Promise<void> {
  await loadRules();
  const due = checkDue({
    now: Date.now(),
    checkedAt: state.head?.checkedAt ?? null,
    attemptedAt,
    checkedThisSitting: sessionChecked,
  });
  if (running || !due) return;
  sessionChecked = true;
  await checkStoreCompliance();
}

/** Check now. `force` is the user's own click: it skips the waits a check otherwise keeps. */
export function checkStoreCompliance(options: { force?: boolean } = {}): Promise<SyncOutcome> {
  if (running) return running;
  attemptedAt = Date.now();
  // What the last check was before waiting for the lock: if it changed by the
  // time this window holds the lock, another window checked meanwhile.
  const before = appDeps()
    .store.readHead()
    .then((head) => head?.checkedAt ?? null)
    .catch(() => null);
  const work = async (): Promise<SyncOutcome> => {
    setState({ checking: true, progress: null });
    try {
      const current = appDeps();
      const head = await current.store.readHead();
      if (!options.force && (head?.checkedAt ?? null) !== (await before)) {
        await reloadRules();
        return { kind: 'skipped' };
      }
      const outcome = await runSync(current, { force: options.force, onProgress: (progress) => setState({ progress }) });
      await reloadRules();
      if (outcome.kind === 'updated') tellOtherWindows();
      return outcome;
    } catch (error) {
      console.error('The playbook check stopped', error);
      await reloadRules();
      return { kind: 'problem', problem: { kind: 'failed', message: problemMessage('failed', !!state.library), at: Date.now() } };
    } finally {
      setState({ checking: false, progress: null, checkedOnce: true });
    }
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  running = (locks ? locks.request('osg-store-compliance-sync', work) : work()).finally(() => {
    running = null;
  });
  return running;
}

/** Close the "New since your last visit" note. */
export async function markNewsSeen(): Promise<void> {
  const { store } = appDeps();
  const news = await store.readNews();
  if (news && !news.seen) await store.writeNews({ ...news, seen: true });
  await reloadRules();
}

// --- guides, read when opened ---------------------------------------------------

const guideReads = new Map<string, Promise<GuideRead>>();

export interface GuideRead {
  file: StoredFile;
  /** An older copy, shown because the new one could not be downloaded. */
  stale: boolean;
}

/**
 * A guide: the copy here when it is the commit's, else downloaded and kept.
 * A guide that cannot be downloaded falls back to an older copy if there is one.
 */
export function readGuide(path: string): Promise<GuideRead> {
  const known = guideReads.get(path);
  if (known) return known;
  const work = (async (): Promise<GuideRead> => {
    const current = appDeps();
    const [stored, catalog] = await Promise.all([current.store.readFile(path), current.store.readCatalog()]);
    const expected = catalog?.commit ? catalog.files[path]?.sha ?? null : null;
    if (stored && (!expected || stored.sha === expected)) return { file: stored, stale: false };
    // Only a file the commit's list names is downloaded, and checked against its hash.
    if (!catalog?.commit || !expected) throw new Error("GitHub's list of the playbook's files does not have this guide");
    try {
      const file = await downloadFile(current, catalog.commit, path, expected);
      await current.store.putFile(file);
      return { file, stale: false };
    } catch (error) {
      if (stored) return { file: stored, stale: true };
      throw error;
    }
  })().finally(() => guideReads.delete(path));
  guideReads.set(path, work);
  return work;
}
