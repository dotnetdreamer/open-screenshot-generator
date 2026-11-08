// Gathers the signed update payloads one build produced, ready to publish.
//
//   node scripts/updates/collect.mjs --out <folder>
//
// Run after `tauri build` with the updater overlay (configure-build.mjs) on
// the machine that built. Every payload under src-tauri/target/**/bundle that
// has its .sig beside it is copied into <folder> under the name it will be
// published as, and fragment-<os>-<arch>.json describes them: the platform
// keys each one serves, its size, sha256 and signature. The release job
// merges the fragments from every build leg into one manifest (release.mjs).
//
// Only bundles of the version in tauri.conf.json are taken, because a cached
// target folder can still hold the last release's installers and signatures.
// The macOS tarball has no version in its name; each build writes it afresh.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  belongsToVersion,
  decodeMinisign,
  describeBundle,
  parseArgs,
  platformKeys,
  publishedName,
  sha256File,
} from './lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { flags } = parseArgs(process.argv.slice(2));
if (typeof flags.out !== 'string') {
  console.error('Usage: node scripts/updates/collect.mjs --out <folder>');
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(root, 'src-tauri', 'target');
const outDir = path.resolve(flags.out);
fs.mkdirSync(outDir, { recursive: true });

/** Every file under a `bundle` folder of target, as paths relative to target. */
function bundleFiles(dir, relative = '') {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // Bundles only ever sit at <triple?>/release/bundle/<kind>/; skip the
      // build trees, which hold tens of thousands of files.
      if (['deps', 'build', 'incremental', '.fingerprint', 'examples'].includes(entry.name)) continue;
      found.push(...bundleFiles(path.join(dir, entry.name), rel));
    } else if (rel.includes('/bundle/')) {
      found.push(rel);
    }
  }
  return found;
}

const entries = [];
for (const rel of bundleFiles(targetDir)) {
  const kind = describeBundle(rel);
  if (!kind) continue;
  const source = path.join(targetDir, rel);
  const name = path.basename(rel);
  if (!belongsToVersion(name, version, kind.os)) {
    console.log(`skipped ${rel}: not version ${version}`);
    continue;
  }
  const sigPath = `${source}.sig`;
  if (!fs.existsSync(sigPath)) {
    console.log(`skipped ${rel}: no signature beside it`);
    continue;
  }
  const signature = fs.readFileSync(sigPath, 'utf8').trim();
  if (!decodeMinisign(signature)) {
    console.error(`${rel}.sig is not a Tauri updater signature`);
    process.exit(1);
  }
  const file = publishedName(name, { version, ...kind });
  fs.copyFileSync(source, path.join(outDir, file));
  const entry = {
    file,
    keys: platformKeys(kind),
    size: fs.statSync(source).size,
    sha256: sha256File(source),
    signature,
  };
  entries.push(entry);
  console.log(`collected ${file} for ${entry.keys.join(', ')}`);
}

if (!entries.length) {
  console.error(
    `No signed update payload of version ${version} under ${targetDir}. ` +
      'Was the build run with the updater overlay and the signing key?'
  );
  process.exit(1);
}

const fragmentName = `fragment-${process.platform}-${process.arch}.json`;
fs.writeFileSync(path.join(outDir, fragmentName), `${JSON.stringify({ version, entries }, null, 2)}\n`);
console.log(`wrote ${fragmentName} with ${entries.length} file(s)`);
