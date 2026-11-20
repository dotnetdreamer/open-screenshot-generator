// Copies the SEO checks (osg/checks/*.ts) from the claude-seo fork into
// src/lib/seo/checks/, pinned to one commit, each file checked against the
// git hash GitHub lists for it.
//
//   npm run sync:seo-checks                  the fork's main branch as it is now
//   npm run sync:seo-checks -- <commit>      one commit
//   npm run sync:seo-checks -- --from <dir>  a local clone, at its HEAD (before a push)
//
// The checks are code, so they are built into the app, never downloaded by
// it. Change them in the fork (its osg/README.md says how), then run this.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = { owner: 'dotnetdreamer', repo: 'claude-seo', branch: 'main' };
const FOLDER = 'osg/checks/';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(repoRoot, 'src', 'lib', 'seo', 'checks');

function blobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** `./html.ts` becomes `./html`: the app's TypeScript settings do not allow the extension, Node needs it. */
function forTheApp(text, file, commit) {
  const body = text.replace(/(from\s+['"]\.\/[A-Za-z0-9_-]+)\.ts(['"])/g, '$1$2');
  const header = `// Copied from github.com/${REPO.owner}/${REPO.repo} ${FOLDER}${file} at ${commit.slice(0, 12)}.\n// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.\n\n`;
  return header + body;
}

async function json(url) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

async function fromGitHub(wanted) {
  const commit = wanted ?? (await json(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/commits/${REPO.branch}`)).sha;
  const tree = await json(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/git/trees/${commit}?recursive=1`);
  const entries = tree.tree.filter((entry) => entry.type === 'blob' && entry.path.startsWith(FOLDER) && entry.path.endsWith('.ts'));
  const files = [];
  for (const entry of entries) {
    const response = await fetch(`https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/${commit}/${entry.path}`);
    if (!response.ok) throw new Error(`${entry.path} answered ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (blobSha(bytes) !== entry.sha) throw new Error(`${entry.path} did not match its git hash`);
    files.push({ path: entry.path, sha: entry.sha, bytes });
  }
  return { commit, files };
}

function fromClone(dir) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  const commit = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain', '--', FOLDER)) throw new Error(`${dir} has uncommitted changes in ${FOLDER}; commit them first`);
  const listed = git('ls-tree', '-r', commit, '--', FOLDER).split('\n').filter(Boolean);
  const files = [];
  for (const line of listed) {
    const [meta, file] = line.split('\t');
    const sha = meta.split(' ')[2];
    if (!file.endsWith('.ts')) continue;
    const bytes = execFileSync('git', ['-C', dir, 'cat-file', 'blob', sha]);
    if (blobSha(bytes) !== sha) throw new Error(`${file} did not match its git hash`);
    files.push({ path: file, sha, bytes });
  }
  return { commit, files };
}

const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const source = fromIndex >= 0 ? fromClone(path.resolve(args[fromIndex + 1])) : await fromGitHub(args.find((arg) => /^[0-9a-f]{40}$/.test(arg)));
if (!source.files.length) throw new Error(`no ${FOLDER}*.ts files at ${source.commit}`);

fs.mkdirSync(target, { recursive: true });
for (const name of fs.readdirSync(target)) if (name.endsWith('.ts')) fs.rmSync(path.join(target, name));
const record = { repository: `https://github.com/${REPO.owner}/${REPO.repo}`, commit: source.commit, files: {} };
for (const file of source.files) {
  const name = file.path.slice(FOLDER.length);
  fs.writeFileSync(path.join(target, name), forTheApp(file.bytes.toString('utf8'), name, source.commit));
  record.files[file.path] = file.sha;
}
fs.writeFileSync(path.join(target, 'VENDORED.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(`Copied ${source.files.length} files from ${source.commit.slice(0, 12)} into src/lib/seo/checks/`);
