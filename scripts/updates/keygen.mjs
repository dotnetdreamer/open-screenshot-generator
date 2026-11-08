// One-time setup for in-app updates: makes the signing key, its password and
// the update server's admin token, and prints what goes into GitHub and onto
// the server. Nothing is written to the repository.
//
//   npm run updates:keygen [-- --out <path to the new private key>]
//
// The private key signs every release, and the public half is built into
// every copy of the app, which then refuses an update it did not sign. Keep the
// key file and its password backed up outside this computer as well: without
// them no installed copy can ever be updated again, and the only way back is a
// new key and a manual reinstall for everyone.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPublicKey, parseArgs } from './lib.mjs';

const { flags } = parseArgs(process.argv.slice(2));
const keyPath = path.resolve(
  typeof flags.out === 'string' ? flags.out : path.join(os.homedir(), '.tauri', 'open-screenshot-generator-updater.key')
);

if (fs.existsSync(keyPath)) {
  console.error(`${keyPath} already exists. Pass --out to write the new key somewhere else; never replace a key that releases were signed with.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(keyPath), { recursive: true });

// Long and random, so the key file is only as easy to use as this is to guess.
const password = randomBytes(24).toString('base64url');
// npx is a batch file on Windows, so it runs through the shell there, which
// takes the arguments as one line: a path with a space needs its quotes.
const windows = process.platform === 'win32';
const generated = spawnSync(
  'npx',
  ['tauri', 'signer', 'generate', '--ci', '--password', password, '--write-keys', windows ? `"${keyPath}"` : keyPath],
  { stdio: ['ignore', 'ignore', 'inherit'], shell: windows }
);
if (generated.status !== 0 || !fs.existsSync(keyPath)) {
  console.error('\nThe key was not generated.');
  process.exit(generated.status || 1);
}

const privateKey = fs.readFileSync(keyPath, 'utf8').trim();
const publicKey = checkPublicKey(fs.readFileSync(`${keyPath}.pub`, 'utf8'));
const adminToken = randomBytes(32).toString('base64url');

console.log(`
The signing key is in ${keyPath}, its public half beside it.

In the GitHub repository, under Settings, then Secrets and variables, then
Actions.

On the Variables tab:

UPDATES_URL
https://updates.openscrgen.app

UPDATER_PUBKEY
${publicKey}

On the Secrets tab:

TAURI_SIGNING_PRIVATE_KEY
${privateKey}

TAURI_SIGNING_PRIVATE_KEY_PASSWORD
${password}

Then create an environment called "updates" (Settings, then Environments)
with one secret:

UPDATES_ADMIN_TOKEN
${adminToken}

On the server, put the same token in /opt/openscreengen/.env:

UPDATES_ADMIN_TOKEN=${adminToken}

GitHub never shows a secret again once it is saved. Copy these values into a
password manager now, and keep a copy of the key file somewhere other than
this computer.
`);
