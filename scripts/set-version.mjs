// Sets the app version across every file that carries it, so a release can
// never ship with the four of them disagreeing (the desktop workflow's release
// name comes from tauri.conf.json, while the binary metadata comes from Cargo).
//
//   node scripts/set-version.mjs 1.2.3     set an exact version
//   node scripts/set-version.mjs patch     bump the last component
//   node scripts/set-version.mjs minor
//   node scripts/set-version.mjs major
//
// Prints the resulting version to stdout, so callers can capture it:
//   next=$(node scripts/set-version.mjs patch)
//
// Pass --dry-run to compute the next version without touching any file.

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+$/;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const arg = args.find(a => !a.startsWith('--'));

if (!arg) {
  console.error('Usage: node scripts/set-version.mjs <major|minor|patch|X.Y.Z> [--dry-run]');
  process.exit(1);
}

const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json');
const current = JSON.parse(readFileSync(tauriConfPath, 'utf8')).version;
if (!SEMVER.test(current)) {
  console.error(`tauri.conf.json version "${current}" is not X.Y.Z; refusing to guess the next one.`);
  process.exit(1);
}

let next;
if (['major', 'minor', 'patch'].includes(arg)) {
  const [major, minor, patch] = current.split('.').map(Number);
  next =
    arg === 'major' ? `${major + 1}.0.0`
    : arg === 'minor' ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
} else {
  next = arg.replace(/^v/, '');
  if (!SEMVER.test(next)) {
    console.error(`"${arg}" is not a X.Y.Z version.`);
    process.exit(1);
  }
  // Cargo and the Windows installer both refuse to downgrade in place, and a
  // republished tag would be worse. Catch the typo here instead.
  const cmp = (a, b) => a.split('.').map(Number).reduce((r, n, i) => r || n - Number(b.split('.')[i]), 0);
  if (cmp(next, current) <= 0) {
    console.error(`Version ${next} is not newer than the current ${current}.`);
    process.exit(1);
  }
}

// Every edit is a surgical replace of the one version line, never a
// parse-and-reserialize: round-tripping the JSON through JSON.stringify
// reflows the compact arrays in tauri.conf.json, turning a version bump into
// a whole-file reformat. Each pattern is anchored and replaced once.
const edits = [
  // Top-level "version" in the JSON files. It is the first such key in both,
  // and neither has a nested one above it.
  ['package.json', /^(\s*"version":\s*")[^"]+(")/m],
  ['src-tauri/tauri.conf.json', /^(\s*"version":\s*")[^"]+(")/m],
  // Cargo.toml: the [package] version is the first line-initial `version = `.
  // Dependency versions are indented or inline, so they cannot match.
  ['src-tauri/Cargo.toml', /^(version = ")[^"]+(")/m],
  // Cargo.lock: cargo would fix this itself on the next build, but leaving it
  // stale means the build dirties the tree and `--locked` builds fail.
  ['src-tauri/Cargo.lock', /(name = "artboard-studio"\r?\nversion = ")[^"]+(")/],
];

if (!dryRun) {
  for (const [relative, pattern] of edits) {
    const path = join(root, relative);
    const source = readFileSync(path, 'utf8');
    if (!pattern.test(source)) {
      console.error(`Could not find the version to replace in ${relative}.`);
      process.exit(1);
    }
    writeFileSync(path, source.replace(pattern, `$1${next}$2`));
  }
}

console.log(next);
