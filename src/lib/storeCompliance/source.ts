// Where Store compliance gets its rules: the App Store Compliance Playbook, read
// straight from its GitHub repository rather than shipped inside the app, so a
// change pushed to the repository reaches every copy of the app the next time
// someone opens the view (sync.ts).
//
// Three hosts, each for what it does best:
//   - api.github.com says which commit the branch is on (40 bytes, or a 304)
//     and lists the commit's files with their git hashes. Signed out it allows
//     60 requests an hour per IP address, and a 304 counts too (measured
//     2026-11-17), so a check is made once a session, never on a timer.
//   - raw.githubusercontent.com serves a file of a given commit, gzipped, with
//     no request limit. A commit's file never changes, so every copy is checked
//     against the git hash the file list gave, and one that does not match is
//     never kept.
//   - cdn.jsdelivr.net serves the same file of the same commit when raw is
//     unreachable (it is blocked in some countries).

export const RULES_REPO = {
  owner: 'dotnetdreamer',
  repo: 'app-store-compliance',
  branch: 'main',
} as const;

const { owner, repo, branch } = RULES_REPO;

/** The repository's page, for the credits and "View on GitHub". */
export const RULES_REPO_URL = `https://github.com/${owner}/${repo}`;

/** The commit the branch is on, as 40 hex characters (Accept: application/vnd.github.sha). */
export const BRANCH_HEAD_URL = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;

/** Every file of a commit, with its git blob hash and size. */
export function treeUrl(commit: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`;
}

/** A file as one commit has it. Only a commit is ever asked for: a branch has no hash to check the file against. */
export function rawUrl(commit: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${encodePath(path)}`;
}

/** The same file from jsDelivr, the fallback when raw.githubusercontent.com does not answer or sends something else. */
export function cdnUrl(commit: string, path: string): string {
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${commit}/${encodePath(path)}`;
}

/** A file's page on GitHub, for "Open on GitHub". */
export function filePageUrl(path: string): string {
  return `${RULES_REPO_URL}/blob/${branch}/${encodePath(path)}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * The files every screen reads, fetched on the first visit and kept current.
 * About 300 KB, 80 KB gzipped. The two data files are required: a commit
 * where either is missing or cannot be read is not taken (sync.ts). The
 * others are taken when the repository has them, among them the plain words
 * of plain.ts.
 */
export const CORE_FILES = [
  'data/rejection-patterns.json',
  'data/regulatory-deadlines.json',
  'data/detection-recipes.json',
  'data/plain-language.json',
  'docs/PRE-SUBMISSION-CHECKLIST.md',
  'docs/index.md',
  'templates/REVIEW-NOTES-TEMPLATE.md',
  'NOTICE',
  'VERSION',
] as const;

export const REQUIRED_FILES = ['data/rejection-patterns.json', 'data/regulatory-deadlines.json'] as const;

/** Folders whose Markdown files are core too: the short guide per kind of app. */
export const CORE_FOLDERS = ['references/guidelines/by-app-type/'] as const;

export function isCorePath(path: string): boolean {
  if ((CORE_FILES as readonly string[]).includes(path)) return true;
  return CORE_FOLDERS.some((folder) => path.startsWith(folder) && path.endsWith('.md') && !path.slice(folder.length).includes('/'));
}

/**
 * A guide: a Markdown file of docs/, read only when someone opens it. The list
 * of guides comes from the repository's own docs/index.md (parse.ts).
 */
export function isGuidePath(path: string): boolean {
  return /^docs\/[^/]+\.md$/i.test(path) && !isCorePath(path);
}

/** A git commit or blob hash. */
export function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}
