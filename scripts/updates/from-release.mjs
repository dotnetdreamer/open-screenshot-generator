// Describes the signed update payloads of a GitHub release, ready to publish.
//
//   node scripts/updates/from-release.mjs --dir <folder> --version X.Y.Z
//
// <folder> holds the release's files as `gh release download` saved them,
// each update payload with its .sig beside it. This writes
// fragment-release.json into the same folder: the platform keys each payload
// serves, its size, sha256 and signature. `release.mjs manifest --in <folder>`
// turns that into the manifest, and `release.mjs publish --dir <folder>` sends
// the files to the update server under the names they have on the release.
// The Desktop updates workflow runs all three for its publish action.

import fs from 'node:fs';
import path from 'node:path';
import {
  FILE_NAME,
  VERSION,
  belongsToVersion,
  decodeMinisign,
  describeReleaseAsset,
  parseArgs,
  platformKeys,
  sha256File,
} from './lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const version = typeof flags.version === 'string' ? flags.version.replace(/^v/, '') : '';
if (typeof flags.dir !== 'string' || !VERSION.test(version)) {
  console.error('Usage: node scripts/updates/from-release.mjs --dir <folder> --version X.Y.Z');
  process.exit(1);
}

const dir = path.resolve(flags.dir);
const entries = [];
const problems = [];
for (const name of fs.readdirSync(dir).sort()) {
  const kind = describeReleaseAsset(name);
  if (!kind) continue;
  if (!belongsToVersion(name, version, kind.os)) {
    problems.push(`${name} is not version ${version}`);
    continue;
  }
  if (!FILE_NAME.test(name)) {
    problems.push(`${name} is not a name the update server takes`);
    continue;
  }
  const sigPath = path.join(dir, `${name}.sig`);
  if (!fs.existsSync(sigPath)) {
    problems.push(`${name} has no ${name}.sig beside it`);
    continue;
  }
  const signature = fs.readFileSync(sigPath, 'utf8').trim();
  if (!decodeMinisign(signature)) {
    problems.push(`${name}.sig is not a Tauri updater signature`);
    continue;
  }
  const file = path.join(dir, name);
  const keys = platformKeys(kind);
  entries.push({ file: name, keys, size: fs.statSync(file).size, sha256: sha256File(file), signature });
  console.log(`found ${name} for ${keys.join(', ')}`);
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
if (!entries.length) {
  console.error(`No signed update payload in ${dir}. Was v${version} built with in-app updates set up?`);
  process.exit(1);
}

fs.writeFileSync(path.join(dir, 'fragment-release.json'), `${JSON.stringify({ version, entries }, null, 2)}\n`);
console.log(`wrote fragment-release.json with ${entries.length} file(s)`);
