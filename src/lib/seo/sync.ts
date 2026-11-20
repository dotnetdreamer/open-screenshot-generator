// Keeping the claude-seo knowledge up to date, the way Store compliance keeps
// its playbook (rule 72): the first time the view shows in a sitting, then
// when it shows six hours after the last check. Never at start-up, never on a
// timer. A check asks GitHub for the branch's commit with the stored ETag; a
// new commit brings its file list, and only the wanted files whose git hash
// changed are downloaded, by commit, each checked against that hash. Nothing
// is read from the branch itself, since the branch has no hash to check.

import { gitBlobSha } from '@/lib/website/github';
import {
  BRANCH_HEAD_URL,
  DEFAULT_MANIFEST,
  MANIFEST_PATH,
  cdnUrl,
  filePageUrl,
  isHash,
  rawUrl,
  readManifest,
  treeUrl,
  wantedPaths,
  type KnowledgeManifest,
  type SeoJob,
} from './source';
import { dexieKnowledgeStore, type KnowledgeStore, type StoredFile, type SyncCatalog, type SyncHead } from './store';

export interface SyncDeps {
  store: KnowledgeStore;
  fetch: typeof fetch;
  now: () => number;
}

export type SyncOutcome =
  | { kind: 'unchanged' }
  | { kind: 'updated'; files: number }
  | { kind: 'skipped' }
  | { kind: 'problem'; problem: NonNullable<SyncHead['problem']> };

const EMPTY_HEAD: SyncHead = { commit: null, etag: null, checkedAt: null, attemptedAt: 0, waitUntil: null, problem: null };
const PARALLEL = 4;

class HttpError extends Error {
  constructor(readonly status: number, readonly response: Response) {
    super(`HTTP ${status}`);
  }
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

function waitFrom(response: Response, now: number): number {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(reset * 1000, now + 60_000);
  const retry = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retry) && retry > 0) return now + retry * 1000;
  return now + 15 * 60_000;
}

/** One file, by commit, from raw.githubusercontent.com and then jsDelivr, kept only when its git hash matches. */
export async function downloadFile(deps: Pick<SyncDeps, 'fetch' | 'now'>, commit: string, path: string, expected: string, signal?: AbortSignal): Promise<StoredFile> {
  let last: unknown = null;
  for (const url of [rawUrl(commit, path), cdnUrl(commit, path)]) {
    try {
      const response = await deps.fetch(url, { cache: 'force-cache', signal });
      if (!response.ok) throw new HttpError(response.status, response);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if ((await gitBlobSha(bytes)) !== expected) throw new Error(`${path} did not match its git hash at ${url}`);
      return { path, sha: expected, size: bytes.byteLength, text: new TextDecoder().decode(bytes), fetchedAt: deps.now() };
    } catch (error) {
      if (isAbort(error)) throw error;
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error(`${path} could not be downloaded`);
}

async function eachLimited<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await work(items[index]);
      }
    }),
  );
  return out;
}

/** The manifest at a commit: the stored copy when its hash still matches, else downloaded. */
async function manifestAt(deps: SyncDeps, commit: string, entry: { sha: string } | undefined, stored: Map<string, StoredFile>, signal?: AbortSignal): Promise<{ manifest: KnowledgeManifest; file: StoredFile | null }> {
  if (!entry) return { manifest: DEFAULT_MANIFEST, file: null };
  const kept = stored.get(MANIFEST_PATH);
  const file = kept?.sha === entry.sha ? kept : await downloadFile(deps, commit, MANIFEST_PATH, entry.sha, signal).catch((error) => {
    if (isAbort(error)) throw error;
    return null;
  });
  return { manifest: (file && readManifest(file.text)) || DEFAULT_MANIFEST, file };
}

export async function runKnowledgeSync(deps: SyncDeps, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<SyncOutcome> {
  const { store, now } = deps;
  const started = now();
  const head = (await store.readHead()) ?? EMPTY_HEAD;
  const catalog = await store.readCatalog();
  const files = await store.readFiles();
  const stored = new Map(files.map((file) => [file.path, file]));
  const haveCopy = Boolean(catalog) && files.length > 0;
  if (!options.force && haveCopy && head.waitUntil && started < head.waitUntil) return { kind: 'skipped' };

  const nothingNew = async (kind: NonNullable<SyncHead['problem']>['kind'], waitUntil: number | null): Promise<SyncOutcome> => {
    const problem = { kind, at: started };
    await store.writeHead({ ...head, attemptedAt: started, waitUntil, problem });
    return { kind: 'problem', problem };
  };

  const fillGaps = async (): Promise<number> => {
    if (!catalog || catalog.commit !== head.commit) return 0;
    const gaps = Object.entries(catalog.files).filter(([path, entry]) => stored.get(path)?.sha !== entry.sha);
    if (!gaps.length) return 0;
    const got = (await eachLimited(gaps, ([path, entry]) => downloadFile(deps, catalog.commit, path, entry.sha, options.signal).catch(() => null))).filter((file): file is StoredFile => file !== null);
    if (got.length) await store.commit({ put: got, remove: [], head: { ...head, checkedAt: started, attemptedAt: started, waitUntil: null, problem: null }, catalog });
    return got.length;
  };

  let commit: string;
  let etag: string | null;
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.sha' };
    if (haveCopy && head.commit && head.etag) headers['If-None-Match'] = head.etag;
    const response = await deps.fetch(BRANCH_HEAD_URL, { headers, cache: 'no-store', signal: options.signal });
    if (response.status === 304) {
      await store.writeHead({ ...head, checkedAt: started, attemptedAt: started, waitUntil: null, problem: null });
      await fillGaps();
      return { kind: 'unchanged' };
    }
    if (response.status === 403 || response.status === 429) return nothingNew('limited', waitFrom(response, started));
    if (!response.ok) throw new HttpError(response.status, response);
    commit = (await response.text()).trim();
    if (!isHash(commit)) throw new Error('GitHub did not answer with a commit');
    etag = response.headers.get('etag');
  } catch (error) {
    if (isAbort(error)) throw error;
    return nothingNew(error instanceof TypeError ? 'offline' : 'failed', null);
  }

  if (haveCopy && commit === head.commit) {
    await store.writeHead({ ...head, etag: etag ?? head.etag, checkedAt: started, attemptedAt: started, waitUntil: null, problem: null });
    await fillGaps();
    return { kind: 'unchanged' };
  }

  let tree: Array<{ path: string; sha: string; size: number }>;
  try {
    const response = await deps.fetch(treeUrl(commit), { signal: options.signal });
    if (response.status === 403 || response.status === 429) return nothingNew('limited', waitFrom(response, started));
    if (!response.ok) throw new HttpError(response.status, response);
    const body = (await response.json()) as { tree?: Array<{ path?: unknown; sha?: unknown; size?: unknown; type?: unknown }> };
    tree = (body.tree ?? [])
      .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string' && isHash(entry.sha))
      .map((entry) => ({ path: entry.path as string, sha: entry.sha as string, size: typeof entry.size === 'number' ? entry.size : 0 }));
  } catch (error) {
    if (isAbort(error)) throw error;
    return nothingNew(error instanceof TypeError ? 'offline' : 'failed', null);
  }
  const byPath = new Map(tree.map((entry) => [entry.path, entry]));

  let manifest: KnowledgeManifest;
  let manifestFile: StoredFile | null;
  try {
    ({ manifest, file: manifestFile } = await manifestAt(deps, commit, byPath.get(MANIFEST_PATH), stored, options.signal));
  } catch (error) {
    if (isAbort(error)) throw error;
    return nothingNew('failed', null);
  }

  const wanted = wantedPaths(manifest).filter((path) => byPath.has(path));
  const toFetch = wanted.filter((path) => path !== MANIFEST_PATH && stored.get(path)?.sha !== byPath.get(path)?.sha);
  let downloaded: Array<StoredFile | null>;
  try {
    downloaded = await eachLimited(toFetch, (path) =>
      downloadFile(deps, commit, path, (byPath.get(path) as { sha: string }).sha, options.signal).catch((error) => {
        if (isAbort(error)) throw error;
        console.warn('SEO knowledge: kept the old copy of', path, error);
        return null;
      }),
    );
  } catch (error) {
    if (isAbort(error)) throw error;
    return nothingNew('failed', null);
  }
  const put = downloaded.filter((file): file is StoredFile => file !== null);
  if (manifestFile && stored.get(MANIFEST_PATH)?.sha !== manifestFile.sha) put.push(manifestFile);
  const have = new Set([...stored.keys(), ...put.map((file) => file.path)]);
  if (!wanted.some((path) => path !== MANIFEST_PATH && have.has(path))) return nothingNew(put.length || toFetch.length ? 'failed' : 'broken', null);

  const keep = new Set(wanted);
  const remove = [...stored.keys()].filter((path) => !keep.has(path));
  // The catalog lists what the commit has. A file that failed to download keeps
  // its old copy, and the next look fetches it by commit and hash (fillGaps)
  // without asking GitHub's API again.
  const nextCatalog: SyncCatalog = { commit, files: {} };
  for (const path of wanted) {
    const entry = byPath.get(path) as { sha: string; size: number };
    nextCatalog.files[path] = { sha: entry.sha, size: entry.size };
  }
  await store.commit({
    put,
    remove,
    head: { commit, etag: etag ?? `"${commit}"`, checkedAt: started, attemptedAt: started, waitUntil: null, problem: null },
    catalog: nextCatalog,
  });
  return { kind: 'updated', files: put.length };
}

// --- The view's copy ---------------------------------------------------------

export interface KnowledgeState {
  loaded: boolean;
  checking: boolean;
  commit: string | null;
  checkedAt: number | null;
  problem: SyncHead['problem'];
  manifest: KnowledgeManifest;
  files: Map<string, StoredFile>;
}

let deps: SyncDeps | null = null;
function currentDeps(): SyncDeps {
  deps ??= { store: dexieKnowledgeStore, fetch: (input, init) => window.fetch(input, init), now: () => Date.now() };
  return deps;
}

/** Unit tests only: run the view's copy against a memory store and a fake GitHub. */
export function setKnowledgeSyncDeps(next: SyncDeps | null): void {
  deps = next;
  state = INITIAL;
  checkedThisSitting = false;
}

const INITIAL: KnowledgeState = { loaded: false, checking: false, commit: null, checkedAt: null, problem: null, manifest: DEFAULT_MANIFEST, files: new Map() };
let state: KnowledgeState = INITIAL;
let checkedThisSitting = false;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function emit(next: Partial<KnowledgeState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeKnowledge(listener: () => void): () => void {
  listeners.add(listener);
  if (!channel && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('osg-seo-knowledge');
    channel.onmessage = () => void loadKnowledge();
  }
  return () => listeners.delete(listener);
}

export function getKnowledgeState(): KnowledgeState {
  return state;
}

export async function loadKnowledge(): Promise<void> {
  const { store } = currentDeps();
  const [head, files] = await Promise.all([store.readHead(), store.readFiles()]);
  const map = new Map(files.map((file) => [file.path, file]));
  const manifestText = map.get(MANIFEST_PATH)?.text;
  emit({
    loaded: true,
    commit: head?.commit ?? null,
    checkedAt: head?.checkedAt ?? null,
    problem: head?.problem ?? null,
    manifest: (manifestText && readManifest(manifestText)) || DEFAULT_MANIFEST,
    files: map,
  });
}

const RECHECK_MS = 6 * 60 * 60 * 1000;

export function knowledgeCheckDue(input: { now: number; checkedAt: number | null; attemptedAt: number; checkedThisSitting: boolean }): boolean {
  if (!input.checkedThisSitting) return true;
  return input.now - Math.max(input.checkedAt ?? 0, input.attemptedAt) >= RECHECK_MS;
}

/** The view calls this whenever it shows. */
export async function openSeoKnowledge(): Promise<void> {
  if (!state.loaded) await loadKnowledge();
  const head = await currentDeps().store.readHead();
  const due = knowledgeCheckDue({ now: currentDeps().now(), checkedAt: head?.checkedAt ?? null, attemptedAt: head?.attemptedAt ?? 0, checkedThisSitting });
  checkedThisSitting = true;
  if (due) await checkSeoKnowledge();
}

/** Look for an update now. One look runs at a time across windows. */
export async function checkSeoKnowledge(options: { force?: boolean } = {}): Promise<SyncOutcome> {
  const before = (await currentDeps().store.readHead())?.checkedAt ?? null;
  const work = async (): Promise<SyncOutcome> => {
    const now = (await currentDeps().store.readHead())?.checkedAt ?? null;
    if (!options.force && now !== before) {
      await loadKnowledge();
      return { kind: 'skipped' };
    }
    emit({ checking: true });
    try {
      const outcome = await runKnowledgeSync(currentDeps(), options);
      if (outcome.kind === 'updated') channel?.postMessage({ kind: 'changed' });
      return outcome;
    } finally {
      await loadKnowledge();
      emit({ checking: false });
    }
  };
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('osg-seo-knowledge-sync', work);
  return work();
}

export interface KnowledgePiece {
  path: string;
  url: string;
  text: string;
}

/** The files a job sends to the AI, in the manifest's order, the last ones left out when the job's size runs out. */
export function knowledgeFor(job: SeoJob, from: KnowledgeState = state): KnowledgePiece[] {
  const spec = from.manifest.jobs[job];
  const out: KnowledgePiece[] = [];
  let used = 0;
  for (const path of spec.files) {
    const text = from.files.get(path)?.text;
    if (!text) continue;
    if (used + text.length > spec.maxCharacters) continue;
    used += text.length;
    out.push({ path, url: filePageUrl(path), text });
  }
  return out;
}

export interface GoogleUpdate {
  date: string;
  name: string;
  kind: string;
  source: string;
}

/** Google's confirmed ranking and policy updates, from the fork's data/google-updates.json. */
export function googleUpdates(from: KnowledgeState = state): GoogleUpdate[] {
  const path = from.manifest.updates;
  const text = path ? from.files.get(path)?.text : undefined;
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { updates?: Array<Record<string, unknown>> };
    return (parsed.updates ?? [])
      .filter((entry) => typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && typeof entry.name === 'string')
      .map((entry) => ({ date: entry.date as string, name: entry.name as string, kind: typeof entry.kind === 'string' ? entry.kind : '', source: typeof entry.source === 'string' && /^https:\/\//.test(entry.source) ? entry.source : '' }));
  } catch {
    return [];
  }
}
