// Publishing the site to the developer's own GitHub Pages: a public
// repository on their account holds the files, and GitHub serves them at
// https://<login>.github.io/<repository>/. It costs nothing and needs no
// server of ours.
//
// The GitHub sign-in is the one the app already has (src/lib/account), asked
// for one more scope: `public_repo`, which creating the repository and writing
// its files need. A sign-in that is the account's own updates the account's
// token, which keeps `gist`, so saving projects goes on working; any other is
// kept here for the Website view alone, so signing in for a website never
// signs anybody out of Google Drive.
//
// Every publish is one commit made with the Git Data API: the files that
// changed go up as blobs, and a tree of exactly the site's files replaces the
// last one, so a page the site no longer has is gone from it too. A
// repository the app did not make is never written to: a site the app made
// has osg-site.json at its root, and a repository without one is somebody
// else's, whatever it is called. The one exception is a repository whose
// first publish stopped between making it and putting the site in: the app's
// description is on it and it holds nothing but GitHub's first README, so
// the next publish finishes it instead of asking for another name.
//
// GitHub documents the Pages endpoint as needing the `repo` scope, which is
// full access to private repositories too. The app asks for `public_repo`
// only, and that was enough when measured (2026-11-15, a new public
// repository, a token whose X-OAuth-Scopes said "gist, public_repo": Pages
// came on with no step left to the developer). When GitHub turns it down all
// the same, the view asks the developer to switch Pages on once in the
// repository's settings (a branch to pick and Save), and watches the site
// until it answers.

import { getSession, setSession } from '@/lib/account/store';
import { githubProvider } from '@/lib/account/providers/github';
import { bridgeFetch } from '@/lib/account/transport';
import { AccountCancelledError } from '@/lib/account/types';
import { SITE_MARKER } from './render';
import type { SiteFile } from './types';

const API = 'https://api.github.com';
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

export type GithubProblem = 'auth' | 'scope' | 'rate' | 'taken' | 'name' | 'moved' | 'other';

export class GithubPublishError extends Error {
  constructor(
    message: string,
    readonly problem: GithubProblem,
    readonly status = 0
  ) {
    super(message);
    this.name = 'GithubPublishError';
  }
}

// --- who is signed in -----------------------------------------------------------------

/** A GitHub sign-in the Website view can use, and what it may do. */
export interface GithubIdentity {
  token: string;
  login: string;
  name: string;
  avatarUrl?: string;
  /** What X-OAuth-Scopes lists, or null when GitHub does not say (a fine-grained token). */
  scopes: string[] | null;
  /** The account's sign-in (src/lib/account), or one kept for the Website view alone. */
  source: 'account' | 'website';
}

interface StoredGithub {
  token: string;
  login: string;
  name: string;
  avatarUrl?: string;
}

const STORE_KEY = 'open-screenshot-generator.website.github';
const listeners = new Set<() => void>();

export function readWebsiteGithub(): StoredGithub | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredGithub>) : null;
    return parsed?.token && parsed.login ? (parsed as StoredGithub) : null;
  } catch {
    return null;
  }
}

function writeWebsiteGithub(value: StoredGithub | null): void {
  try {
    if (value) window.localStorage.setItem(STORE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORE_KEY);
  } catch {
    // Private mode or a full quota: the sign-in lasts until the page reloads.
  }
  listeners.forEach((listener) => listener());
}

export function onWebsiteGithubChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sign the Website view's own GitHub sign-in out. The account's is left alone. */
export function signOutWebsiteGithub(): void {
  writeWebsiteGithub(null);
}

/** The token may make a public repository and write to it. Unknown scopes are given the benefit of the doubt. */
export function mayPublish(scopes: string[] | null): boolean {
  return scopes === null || scopes.includes('public_repo') || scopes.includes('repo');
}

async function doFetch(fetchImpl?: typeof fetch): Promise<typeof fetch> {
  return fetchImpl ?? (await bridgeFetch());
}

/** Who a token belongs to, and its scopes. */
export async function checkToken(token: string, options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<Omit<StoredGithub, 'token'> & { scopes: string[] | null }> {
  const run = await doFetch(options.fetchImpl);
  let response: Response;
  try {
    response = await run(`${API}/user`, { headers: { ...HEADERS, Authorization: `Bearer ${token}` }, cache: 'no-store', signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new GithubPublishError("GitHub didn't answer. Check your internet connection and try again", 'other');
  }
  if (response.status === 401) throw new GithubPublishError('GitHub turned down the sign-in. Sign in again', 'auth', 401);
  if (!response.ok) throw new GithubPublishError(`GitHub answered with an error (${response.status}). Try again in a minute`, 'other', response.status);
  const user = (await response.json()) as { login: string; name?: string | null; avatar_url?: string };
  const header = response.headers.get('x-oauth-scopes');
  return {
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url,
    scopes: header === null ? null : header.split(',').map((scope) => scope.trim()).filter(Boolean),
  };
}

/**
 * The GitHub sign-ins there are, each checked with GitHub: the account's,
 * when it is a GitHub one, then the Website view's own. The first one that
 * may publish is the one to use.
 */
export async function githubIdentities(options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<GithubIdentity[]> {
  const out: GithubIdentity[] = [];
  const account = getSession();
  const own = readWebsiteGithub();
  const candidates: Array<{ token: string; source: GithubIdentity['source'] }> = [];
  if (account?.provider === 'github') candidates.push({ token: account.accessToken, source: 'account' });
  if (own && own.token !== account?.accessToken) candidates.push({ token: own.token, source: 'website' });
  for (const candidate of candidates) {
    try {
      const who = await checkToken(candidate.token, options);
      out.push({ ...who, token: candidate.token, source: candidate.source });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A token GitHub turns down is no sign-in. The account's own stays for
      // the account dialog to deal with; the Website view's goes.
      if (error instanceof GithubPublishError && error.problem === 'auth' && candidate.source === 'website') writeWebsiteGithub(null);
      if (!(error instanceof GithubPublishError && error.problem === 'auth')) throw error;
    }
  }
  return out;
}

/**
 * Sign in to GitHub with the scope the site needs. On the desktop that is
 * GitHub's device flow (`onUserCode` shows the code); on the web, the sign-in
 * popup or a pasted token.
 */
export async function signInForWebsite(options: {
  token?: string;
  signal?: AbortSignal;
  onUserCode?: (info: { userCode: string; verificationUri: string }) => void;
  fetchImpl?: typeof fetch;
}): Promise<GithubIdentity> {
  const session = await githubProvider.signIn({ scopes: ['public_repo'], token: options.token, signal: options.signal, onUserCode: options.onUserCode });
  if (options.signal?.aborted) throw new AccountCancelledError();
  const who = await checkToken(session.accessToken, options);
  const account = getSession();
  const keepsGist = who.scopes === null || who.scopes.includes('gist');
  if (account?.provider === 'github' && account.account.id === session.account.id && keepsGist) {
    // The same person: the account takes the new token, which can do
    // everything the old one could.
    setSession({ ...account, accessToken: session.accessToken, account: session.account });
    writeWebsiteGithub(null);
    return { ...who, token: session.accessToken, source: 'account' };
  }
  writeWebsiteGithub({ token: session.accessToken, login: who.login, name: who.name, avatarUrl: who.avatarUrl });
  return { ...who, token: session.accessToken, source: 'website' };
}

// --- addresses -----------------------------------------------------------------------------

/** The address GitHub Pages serves a repository's site at, ending in a slash. */
export function siteAddress(owner: string, repo: string): string {
  const host = `${owner.toLowerCase()}.github.io`;
  return repo.toLowerCase() === host ? `https://${host}/` : `https://${host}/${repo}/`;
}

export function repoPage(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

export function pagesSettingsUrl(owner: string, repo: string): string {
  return `${repoPage(owner, repo)}/settings/pages`;
}

/** A repository name made from the app's name: "Ludo Wala: 3D & Action" is ludo-wala-3d-action. */
export function suggestedRepoName(appName: string): string {
  const slug = appName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'app-website';
}

/** Why GitHub would turn the name down, or null when it is fine. */
export function repoNameProblem(name: string): string | null {
  if (!name.trim()) return 'Give the repository a name';
  if (name.length > 100) return 'Use 100 letters or fewer';
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return 'Use only letters, numbers, dashes, dots and underscores';
  if (name === '.' || name === '..' || name.endsWith('.git')) return 'GitHub keeps that name for itself. Pick another one';
  return null;
}

// --- the API -----------------------------------------------------------------------------

interface Ctx {
  token: string;
  run: typeof fetch;
  signal?: AbortSignal;
}

interface Answer<T> {
  status: number;
  data: T;
  headers: Headers;
}

function stopped(): DOMException {
  return new DOMException('Stopped', 'AbortError');
}

async function api<T>(ctx: Ctx, method: string, path: string, body?: unknown, ok: number[] = []): Promise<Answer<T>> {
  if (ctx.signal?.aborted) throw stopped();
  let response: Response;
  try {
    response = await ctx.run(`${API}${path}`, {
      method,
      headers: { ...HEADERS, Authorization: `Bearer ${ctx.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (error) {
    if (ctx.signal?.aborted) throw stopped();
    console.error('GitHub request failed', method, path, error);
    throw new GithubPublishError("GitHub didn't answer. Check your internet connection and try again", 'other');
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (response.ok || ok.includes(response.status)) return { status: response.status, data: data as T, headers: response.headers };
  const message = typeof (data as { message?: unknown })?.message === 'string' ? (data as { message: string }).message : '';
  console.error('GitHub refused', method, path, response.status, message);
  if (response.status === 401) throw new GithubPublishError('Your GitHub sign-in has run out. Sign in again', 'auth', 401);
  if ((response.status === 403 || response.status === 429) && /rate limit|abuse|secondary/i.test(message)) {
    throw new GithubPublishError('GitHub asked the app to slow down. Wait a few minutes, then publish again', 'rate', response.status);
  }
  if (response.status === 403 || (response.status === 404 && /not found/i.test(message) && method !== 'GET')) {
    throw new GithubPublishError("GitHub didn't let the app do that. Sign in again and allow access to public repositories", 'scope', response.status);
  }
  throw new GithubPublishError(`GitHub answered with an error (${response.status}${message ? `: ${message}` : ''})`, 'other', response.status);
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(stopped());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(stopped());
      },
      { once: true }
    );
  });
}

function bytesOf(file: SiteFile): Uint8Array {
  return file.bytes ?? new TextEncoder().encode(file.text ?? '');
}

/** The SHA-1 git names a blob with, worked out here so unchanged files need not go up again. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const whole = new Uint8Array(header.length + bytes.length);
  whole.set(header, 0);
  whole.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', whole);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) {
    binary += String.fromCharCode(...bytes.subarray(at, at + step));
  }
  return btoa(binary);
}

// --- publishing ------------------------------------------------------------------------

export type PublishStepId = 'repo' | 'upload' | 'commit' | 'pages';

export interface PublishProgress {
  step: PublishStepId;
  done?: number;
  total?: number;
}

export interface PublishOutcome {
  branch: string;
  commit: string;
  /** The repository was made by this publish. */
  created: boolean;
  /** Nothing differed from what was up there already. */
  unchanged: boolean;
  /** GitHub Pages was on already, the app switched it on, or the developer has to switch it on once. */
  pages: 'on' | 'switched-on' | 'needs-you';
}

interface RepoAnswer {
  default_branch: string;
  private: boolean;
  description?: string | null;
  owner?: { login: string };
}

/** The end of the description every repository the app makes gets. */
const REPO_MARK = 'made with Open Screenshot Generator';

export function repoDescription(appName: string): string {
  return `The website of ${appName || 'my app'}, ${REPO_MARK}`.slice(0, 350);
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

/** Whether the repository holds a site the app made: osg-site.json at its root. */
async function holdsOurSite(ctx: Ctx, owner: string, repo: string, branch: string): Promise<boolean> {
  const answer = await api<unknown>(ctx, 'GET', `/repos/${owner}/${repo}/contents/${SITE_MARKER}?ref=${encodeURIComponent(branch)}`, undefined, [404, 409]);
  return answer.status === 200;
}

/**
 * Whether the repository is one the app made whose first publish stopped
 * before the site went in: the app's description, and no more than the one
 * commit GitHub makes with a README, or no commit yet. Nothing in it can be
 * lost by putting the site there.
 */
async function unfinishedByUs(ctx: Ctx, owner: string, repo: string, answer: RepoAnswer): Promise<boolean> {
  if (!answer.description?.trim().endsWith(REPO_MARK)) return false;
  const commits = await api<Array<{ commit?: { tree?: { sha?: string } } }>>(ctx, 'GET', `/repos/${owner}/${repo}/commits?per_page=2`, undefined, [404, 409]);
  // 409 is GitHub's answer for a repository with no commit at all.
  if (commits.status === 409) return true;
  if (commits.status !== 200 || !Array.isArray(commits.data) || commits.data.length > 1) return false;
  const treeSha = commits.data[0]?.commit?.tree?.sha;
  if (!treeSha) return commits.data.length === 0;
  const tree = await api<{ tree?: TreeEntry[] }>(ctx, 'GET', `/repos/${owner}/${repo}/git/trees/${treeSha}`);
  return (tree.data.tree ?? []).every((entry) => entry.path === 'README.md');
}

/** Where a branch stands, waiting a moment for a repository GitHub is still setting up. */
async function headOf(ctx: Ctx, owner: string, repo: string, branch: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const ref = await api<{ object?: { sha: string } }>(ctx, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, undefined, [404, 409]);
    if (ref.status === 200 && ref.data?.object?.sha) return ref.data.object.sha;
    await pause(1000, ctx.signal);
  }
  throw new GithubPublishError('GitHub is still setting up the repository. Publish again in a minute', 'other');
}

/**
 * Put `files` on GitHub Pages at owner/repo, making the repository when there
 * is none. A repository that exists and holds no site of the app's is left
 * alone and the publish stops with a `taken` error.
 */
export async function publishSite(input: {
  token: string;
  owner: string;
  repo: string;
  files: SiteFile[];
  appName: string;
  siteUrl: string;
  signal?: AbortSignal;
  onProgress?: (progress: PublishProgress) => void;
  fetchImpl?: typeof fetch;
}): Promise<PublishOutcome> {
  const ctx: Ctx = { token: input.token, run: await doFetch(input.fetchImpl), signal: input.signal };
  const { owner, repo } = input;
  const path = `/repos/${owner}/${repo}`;
  input.onProgress?.({ step: 'repo' });

  let branch: string;
  let created = false;
  const existing = await api<RepoAnswer>(ctx, 'GET', path, undefined, [404]);
  if (existing.status === 404) {
    const made = await api<RepoAnswer>(
      ctx,
      'POST',
      '/user/repos',
      {
        name: repo,
        description: repoDescription(input.appName),
        homepage: input.siteUrl,
        private: false,
        auto_init: true,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      },
      [422]
    );
    if (made.status === 422) {
      const message = JSON.stringify(made.data);
      if (/already exists/i.test(message)) {
        throw new GithubPublishError(`Your GitHub account already has a repository called ${repo}. Pick another name`, 'taken', 422);
      }
      throw new GithubPublishError(`GitHub turned down the name ${repo}. Use letters, numbers and dashes`, 'name', 422);
    }
    branch = made.data.default_branch || 'main';
    created = true;
  } else {
    branch = existing.data.default_branch || 'main';
    if (!(await holdsOurSite(ctx, owner, repo, branch)) && !(await unfinishedByUs(ctx, owner, repo, existing.data))) {
      throw new GithubPublishError(
        `Your GitHub account already has a repository called ${repo}, and it isn't a site the app made. Pick another name, so nothing in it is replaced`,
        'taken'
      );
    }
  }

  const head = await headOf(ctx, owner, repo, branch);
  const commit = await api<{ tree: { sha: string } }>(ctx, 'GET', `${path}/git/commits/${head}`);
  const treeSha = commit.data.tree.sha;
  const tree = await api<{ tree: TreeEntry[]; truncated?: boolean }>(ctx, 'GET', `${path}/git/trees/${treeSha}?recursive=1`);
  const upThere = new Map<string, string>();
  for (const entry of tree.data.tree ?? []) {
    if (entry.type === 'blob') upThere.set(entry.path, entry.sha);
  }

  // Unchanged files keep their blob; text goes in the tree itself; pictures
  // and fonts go up as blobs first.
  const entries: Array<{ path: string; mode: '100644'; type: 'blob'; sha?: string; content?: string }> = [];
  const uploads: Array<{ file: SiteFile; index: number }> = [];
  for (const file of input.files) {
    const sha = await gitBlobSha(bytesOf(file));
    if (upThere.get(file.path) === sha) entries.push({ path: file.path, mode: '100644', type: 'blob', sha });
    else if (file.bytes === undefined) entries.push({ path: file.path, mode: '100644', type: 'blob', content: file.text ?? '' });
    else {
      uploads.push({ file, index: entries.length });
      entries.push({ path: file.path, mode: '100644', type: 'blob' });
    }
  }
  let done = 0;
  input.onProgress?.({ step: 'upload', done, total: uploads.length });
  const lanes = Array.from({ length: Math.min(3, uploads.length) }, async () => {
    while (uploads.length > 0) {
      const next = uploads.shift()!;
      const blob = await api<{ sha: string }>(ctx, 'POST', `${path}/git/blobs`, { content: toBase64(next.file.bytes!), encoding: 'base64' });
      entries[next.index].sha = blob.data.sha;
      done += 1;
      input.onProgress?.({ step: 'upload', done, total: done + uploads.length });
    }
  });
  await Promise.all(lanes);

  input.onProgress?.({ step: 'commit' });
  const newTree = await api<{ sha: string }>(ctx, 'POST', `${path}/git/trees`, { tree: entries });
  let commitSha = head;
  const unchanged = newTree.data.sha === treeSha;
  if (!unchanged) {
    const made = await api<{ sha: string }>(ctx, 'POST', `${path}/git/commits`, {
      message: `Publish the website of ${input.appName || 'the app'}`,
      tree: newTree.data.sha,
      parents: [head],
    });
    commitSha = made.data.sha;
    const moved = await api<unknown>(ctx, 'PATCH', `${path}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commitSha, force: false }, [409, 422]);
    if (moved.status !== 200) {
      throw new GithubPublishError('Something else changed the repository while the site was going up. Publish again', 'moved', moved.status);
    }
  }

  input.onProgress?.({ step: 'pages' });
  let pages: PublishOutcome['pages'] = 'on';
  const site = await api<unknown>(ctx, 'GET', `${path}/pages`, undefined, [403, 404]);
  if (site.status !== 200) {
    const switched = await api<unknown>(ctx, 'POST', `${path}/pages`, { build_type: 'legacy', source: { branch, path: '/' } }, [403, 404, 409, 422]);
    pages = switched.status === 201 ? 'switched-on' : switched.status === 409 ? 'on' : 'needs-you';
  }
  return { branch, commit: commitSha, created, unchanged, pages };
}

/** Whether GitHub serves the version with `build` in its osg-site.json now: one look. */
export async function isServing(input: { siteUrl: string; build: string; signal?: AbortSignal; fetchImpl?: typeof fetch }): Promise<boolean> {
  const run = await doFetch(input.fetchImpl);
  try {
    const response = await run(`${input.siteUrl}${SITE_MARKER}?look=${Date.now()}`, { cache: 'no-store', signal: input.signal });
    if (!response.ok) return false;
    const body = (await response.json()) as { build?: string };
    return body.build === input.build;
  } catch (error) {
    if (input.signal?.aborted) throw stopped();
    console.warn('The site did not answer yet', error);
    return false;
  }
}

/**
 * Wait until GitHub serves the version with `build` in its osg-site.json.
 * GitHub's servers keep pages for ten minutes, so each look asks for a new
 * address. Resolves false when it takes longer than `timeoutMs`.
 */
export async function waitUntilLive(input: {
  siteUrl: string;
  build: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  everyMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const run = await doFetch(input.fetchImpl);
  const until = Date.now() + (input.timeoutMs ?? 240_000);
  while (Date.now() < until) {
    if (input.signal?.aborted) throw stopped();
    // Not up yet, or the network blinked: look again.
    if (await isServing({ siteUrl: input.siteUrl, build: input.build, signal: input.signal, fetchImpl: run })) return true;
    await pause(input.everyMs ?? 5000, input.signal);
  }
  return false;
}
