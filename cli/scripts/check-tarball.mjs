// The last gate before npm. Whatever passes here is public for good: npm does
// not let a version be republished, and an unpublished tarball has usually
// been mirrored already.
//
// It checks the packed .tgz itself, not the cli/ folder, because the tarball
// is what ships. Four rules:
//
//   1. Only the paths package.json promises in `files`, plus what npm always
//      adds (package.json, README, LICENSE).
//   2. No file that looks like a credential: .env*, .npmrc, keys, keystores.
//   3. No artwork. public/elements is Adobe Stock and hydrates at run time
//      (see pack-editor.mjs and THIRD-PARTY-ASSETS.md), and data/projects may
//      only contribute its top-level template JSONs.
//   4. No token-shaped string in any text file. The editor bundle inlines
//      every NEXT_PUBLIC_* variable the build saw, so a secret set under that
//      prefix by mistake would land here in plain text.
//
// Usage: node scripts/check-tarball.mjs <path/to/package.tgz>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A packed CLI is a few megabytes. Tens of megabytes means artwork got in.
const MAX_UNPACKED_BYTES = 40 * 1024 * 1024;

const ALLOWED_TOP = new Set([
  'dist',
  'editor',
  'skills',
  'assets.manifest.json',
  'tools.json',
  'package.json',
  'README.md',
  'LICENSE',
  'THIRD-PARTY-ASSETS.md',
]);

const CREDENTIAL_FILE = /^(\.env(\..*)?|\.npmrc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|jks|keystore|crt))$/i;

const TOKEN_PATTERNS = [
  ['npm token', /npm_[A-Za-z0-9]{36}/],
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  // Needs key material after the header. The App Store Connect key field has
  // the bare header as its placeholder, which is fine to ship.
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\r?\\n|\r?\n)[A-Za-z0-9+/]{40}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google OAuth client secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /\bsk-(proj-|svcacct-)[A-Za-z0-9_-]{20,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe secret key', /\b[rs]k_live_[A-Za-z0-9]{20,}/],
];

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.txt', '.md', '.css', '.map', '.svg', '.xml', '.yml', '.yaml']);

const tarball = process.argv[2];
if (!tarball || !fs.existsSync(tarball)) {
  console.error('Usage: node scripts/check-tarball.mjs <path/to/package.tgz>');
  process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-tarball-'));
// Run inside the scratch folder with a bare file name so no drive letter
// reaches tar. GNU tar in Git Bash reads C:\x.tgz as a remote host.
fs.copyFileSync(tarball, path.join(scratch, 'package.tgz'));
execFileSync('tar', ['-xzf', 'package.tgz'], { cwd: scratch });
const root = path.join(scratch, 'package');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

const problems = [];
let unpacked = 0;
const files = walk(root);

for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const segments = relative.split('/');
  const name = segments[segments.length - 1];
  unpacked += fs.statSync(file).size;

  if (!ALLOWED_TOP.has(segments[0])) {
    problems.push(`${relative}: not in the "files" list of package.json`);
  }
  if (CREDENTIAL_FILE.test(name) || segments.includes('.git')) {
    problems.push(`${relative}: looks like a credential or repository file`);
  }
  if (relative.startsWith('editor/elements/')) {
    problems.push(`${relative}: artwork, which must hydrate at run time and never ship`);
  }
  if (relative.startsWith('editor/data/projects/') && segments.length > 4) {
    problems.push(`${relative}: only the top-level template JSONs of data/projects may ship`);
  }

  if (TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) || !path.extname(name)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [label, pattern] of TOKEN_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        // Print only the first few characters, so the log of a failing run
        // does not publish the secret this check just caught.
        problems.push(`${relative}: contains what looks like a ${label} (${match[0].slice(0, 8)}...)`);
      }
    }
  }
}

if (unpacked > MAX_UNPACKED_BYTES) {
  problems.push(`unpacked size ${(unpacked / 1048576).toFixed(1)} MB is over the ${MAX_UNPACKED_BYTES / 1048576} MB ceiling`);
}

fs.rmSync(scratch, { recursive: true, force: true });

const byTop = {};
for (const file of files) {
  const top = path.relative(root, file).split(path.sep)[0];
  byTop[top] = (byTop[top] ?? 0) + 1;
}
console.log(`check-tarball: ${files.length} files, ${(unpacked / 1048576).toFixed(2)} MB unpacked`);
for (const [top, count] of Object.entries(byTop).sort()) console.log(`  ${top}: ${count}`);

if (problems.length) {
  console.error(`check-tarball: ${problems.length} problem(s), refusing to publish:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('check-tarball: clean');
