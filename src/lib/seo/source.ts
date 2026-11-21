// Where the SEO view's knowledge comes from: the user's fork of claude-seo,
// read when the view opens, never bundled. osg/manifest.json in the fork says
// which skill and reference files each AI job gets; the app ships the same
// list as DEFAULT_MANIFEST for a fork whose manifest is missing or broken.
//
// Hosts, as in Store compliance (source.ts there): api.github.com for the
// branch's commit and the file list (60 requests an hour signed out, a 304
// included), raw.githubusercontent.com by commit for the files, jsDelivr by
// commit when raw fails. Every file is checked against its git blob hash.

export const SEO_REPO = { owner: 'dotnetdreamer', repo: 'claude-seo', branch: 'main' } as const;

const { owner, repo, branch } = SEO_REPO;

export const SEO_REPO_URL = `https://github.com/${owner}/${repo}`;
export const BRANCH_HEAD_URL = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;

export function treeUrl(commit: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function rawUrl(commit: string, path: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${encodePath(path)}`;
}

export function cdnUrl(commit: string, path: string): string {
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${commit}/${encodePath(path)}`;
}

/** The file's page on GitHub, for "Where this comes from" links. */
export function filePageUrl(path: string): string {
  return `${SEO_REPO_URL}/blob/${branch}/${encodePath(path)}`;
}

export const MANIFEST_PATH = 'osg/manifest.json';

export type SeoJob = 'fix-plan' | 'ai-search' | 'copy' | 'google' | 'ask';
export const SEO_JOBS: SeoJob[] = ['fix-plan', 'ai-search', 'copy', 'google', 'ask'];

export interface KnowledgeManifest {
  updates: string | null;
  jobs: Record<SeoJob, { files: string[]; maxCharacters: number }>;
}

export const DEFAULT_MANIFEST: KnowledgeManifest = {
  updates: 'data/google-updates.json',
  jobs: {
    'fix-plan': {
      maxCharacters: 60000,
      files: [
        'skills/seo/references/quality-gates.md',
        'skills/seo-technical/SKILL.md',
        'skills/seo-page/SKILL.md',
        'skills/seo/references/schema-types.md',
        'skills/seo-hreflang/SKILL.md',
        'skills/seo/references/thinking-framework.md',
      ],
    },
    'ai-search': { maxCharacters: 45000, files: ['skills/seo-geo/SKILL.md', 'skills/seo-agentic/SKILL.md'] },
    copy: { maxCharacters: 40000, files: ['skills/seo-content/SKILL.md', 'skills/seo/references/eeat-framework.md', 'skills/seo/references/quality-gates.md'] },
    google: {
      maxCharacters: 45000,
      files: [
        'skills/seo/references/cwv-thresholds.md',
        'skills/seo-google/references/search-console-api.md',
        'skills/seo-google/references/ga4-data-api.md',
        'skills/seo-google/references/pagespeed-crux-api.md',
      ],
    },
    ask: {
      maxCharacters: 60000,
      files: ['skills/seo/references/quality-gates.md', 'skills/seo-technical/SKILL.md', 'skills/seo-geo/SKILL.md', 'skills/seo/references/cwv-thresholds.md'],
    },
  },
};

const MIN_CHARACTERS = 5_000;
const MAX_CHARACTERS = 150_000;

/** A path the app may download: a Markdown or JSON file inside the repository, nothing that climbs out. */
export function isKnowledgePath(path: unknown): path is string {
  return typeof path === 'string' && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.(md|json)$/.test(path) && !path.split('/').some((part) => part === '..' || part === '.');
}

/**
 * The fork's manifest, read leniently: a job it leaves out or gets wrong
 * keeps the app's own list, a bad path is skipped. Null when the text is not
 * a manifest at all.
 */
export function readManifest(text: string): KnowledgeManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('jobs' in parsed)) return null;
  const source = parsed as { updates?: unknown; jobs?: Record<string, { files?: unknown; maxCharacters?: unknown }> };
  const jobs = { ...DEFAULT_MANIFEST.jobs };
  for (const job of SEO_JOBS) {
    const entry = source.jobs?.[job];
    if (!entry || !Array.isArray(entry.files)) continue;
    const files = [...new Set(entry.files.filter(isKnowledgePath))].slice(0, 20);
    if (!files.length) continue;
    const max = typeof entry.maxCharacters === 'number' && Number.isFinite(entry.maxCharacters) ? entry.maxCharacters : DEFAULT_MANIFEST.jobs[job].maxCharacters;
    jobs[job] = { files, maxCharacters: Math.min(MAX_CHARACTERS, Math.max(MIN_CHARACTERS, Math.round(max))) };
  }
  const updates = source.updates === null ? null : isKnowledgePath(source.updates) ? source.updates : DEFAULT_MANIFEST.updates;
  return { updates, jobs };
}

/** Every file a manifest asks for, the manifest itself first. */
export function wantedPaths(manifest: KnowledgeManifest): string[] {
  const paths = new Set<string>([MANIFEST_PATH]);
  if (manifest.updates) paths.add(manifest.updates);
  for (const job of SEO_JOBS) for (const path of manifest.jobs[job].files) paths.add(path);
  return [...paths];
}

export function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}
