// Decides whether a release build updates itself, and if it does, writes the
// config overlay that turns the updater on.
//
//   node scripts/updates/configure-build.mjs --check
//       says whether updates are set up, without writing anything
//   node scripts/updates/configure-build.mjs
//       also writes src-tauri/tauri.updater.conf.json
//
// Reads three things from the environment, all set in the GitHub repository:
//
//   UPDATES_URL        variable, the update server, e.g. https://updates.openscrgen.app
//   UPDATER_PUBKEY     variable, the content of the updater key's .key.pub file
//   HAS_SIGNING_KEY    "true" when the TAURI_SIGNING_PRIVATE_KEY secret exists
//                      (the secret itself never reaches this script)
//
// None of them set: the release ships without in-app updates, as every
// release did before this existed, and the run says so. Some but not all set:
// that is a half-finished setup, and the run stops rather than ship a build
// that cannot be updated later. docs/UPDATES.md walks through the setup.
//
// Outputs go to $GITHUB_OUTPUT when it is set, and to stdout otherwise:
//   enabled=true|false
//   args=--config src-tauri/tauri.updater.conf.json   (only when enabled)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OVERLAY_PATH, checkPublicKey, checkUpdatesUrl, parseArgs, updaterOverlay } from './lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { flags } = parseArgs(process.argv.slice(2));

function output(name, value) {
  const line = `${name}=${value}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}

function stop(message) {
  console.log(`::error title=In-app updates::${message}`);
  process.exit(1);
}

const updatesUrl = (process.env.UPDATES_URL ?? '').trim();
const publicKey = (process.env.UPDATER_PUBKEY ?? '').trim();
const hasSigningKey = process.env.HAS_SIGNING_KEY === 'true';

const present = {
  'the UPDATES_URL variable': Boolean(updatesUrl),
  'the UPDATER_PUBKEY variable': Boolean(publicKey),
  'the TAURI_SIGNING_PRIVATE_KEY secret': hasSigningKey,
};
const missing = Object.keys(present).filter((name) => !present[name]);

if (missing.length === Object.keys(present).length) {
  if (flags.check) {
    console.log(
      '::notice title=In-app updates::Not set up, so this release cannot update itself. See docs/UPDATES.md to turn it on.'
    );
  }
  output('enabled', 'false');
  process.exit(0);
}

if (missing.length) {
  stop(`Half set up: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. Set ${missing.length > 1 ? 'them' : 'it'}, or remove the others. See docs/UPDATES.md.`);
}

let overlay;
try {
  overlay = updaterOverlay({ updatesUrl: checkUpdatesUrl(updatesUrl), publicKey: checkPublicKey(publicKey) });
} catch (error) {
  stop(error.message);
}

if (!flags.check) {
  fs.writeFileSync(path.join(root, OVERLAY_PATH), `${JSON.stringify(overlay, null, 2)}\n`);
  console.log(`Wrote ${OVERLAY_PATH}: updates from ${overlay.plugins.updater.endpoints[0]}`);
  output('args', `--config ${OVERLAY_PATH}`);
}
output('enabled', 'true');
