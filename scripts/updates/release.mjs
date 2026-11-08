// Publishes desktop releases to our update server and steers their rollout.
//
//   node scripts/updates/release.mjs manifest --in <folder> --out <file>
//        [--version X.Y.Z] [--notes "..." | --notes-file <file>] [--critical] [--download-page <https url>]
//   node scripts/updates/release.mjs publish --dir <folder> --manifest <file>
//        [--channel stable|beta] [--rollout 0-100] [--dry-run] [--force]
//   node scripts/updates/release.mjs status
//   node scripts/updates/release.mjs rollout --channel stable --percent 25
//   node scripts/updates/release.mjs pause --channel stable
//   node scripts/updates/release.mjs resume --channel stable
//   node scripts/updates/release.mjs promote --version X.Y.Z --channel stable [--percent 100]
//
// `npm run updates -- <command> ...` runs the same thing.
//
// Everything but `manifest` and a dry run talks to the server, and reads
// UPDATES_URL and UPDATES_ADMIN_TOKEN from the environment. The desktop
// workflow runs `manifest` and `publish` after every release; the "Desktop
// updates" workflow runs the rest from the Actions tab. docs/UPDATES.md has
// the whole story.
//
// A published release cannot be changed on the server. A channel never moves
// back to an older version unless --force says so, because an app only ever
// updates forward: pointing a channel back strands everyone already ahead of
// it. To take a bad release back, pause the channel, then publish a fix.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHANNELS,
  VERSION,
  buildManifest,
  checkUpdatesUrl,
  compareVersions,
  parseArgs,
  sha256File,
} from './lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional[0];

class UsageError extends Error {}

function fail(message) {
  throw new UsageError(message);
}

/** A line in the job summary on GitHub, and on the console everywhere. */
function report(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function channelFlag() {
  const channel = flags.channel ?? 'stable';
  if (!CHANNELS.includes(channel)) fail(`--channel must be ${CHANNELS.join(' or ')}, got ${channel}`);
  return channel;
}

function percentFlag(name, fallback) {
  const raw = flags[name] ?? fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100) fail(`--${name} must be a whole number from 0 to 100, got ${raw}`);
  return value;
}

// ---- the server ---------------------------------------------------------

function server() {
  const base = checkUpdatesUrl(process.env.UPDATES_URL, { allowLocal: true });
  const token = (process.env.UPDATES_ADMIN_TOKEN ?? '').trim();
  if (token.length < 32) fail('UPDATES_ADMIN_TOKEN is not set, or shorter than the 32 characters the server requires');
  return { base, token };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One admin request, tried up to three times when the network or the server
 * hiccups. A 4xx answer is final: it means the request itself is wrong.
 */
async function call({ base, token }, method, route, { json, body, headers = {}, accept = [200, 201] } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : body,
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (accept.includes(response.status)) return { status: response.status, data };
      const reason = (data && typeof data === 'object' && data.error) || text || response.statusText;
      if (response.status < 500) {
        throw Object.assign(new Error(`${method} ${route} answered ${response.status}: ${reason}`), { final: true });
      }
      lastError = new Error(`${method} ${route} answered ${response.status}: ${reason}`);
    } catch (error) {
      if (error.final) throw error;
      lastError = error;
    }
    if (attempt < 3) await sleep(attempt * 2000);
  }
  throw lastError;
}

async function channels(target) {
  return (await call(target, 'GET', '/v1/admin/channels')).data;
}

function describePointer(name, pointer) {
  if (!pointer) return `${name}: nothing published`;
  const state = pointer.paused ? 'paused' : `${pointer.rollout}% of installs`;
  return `${name}: ${pointer.version}, ${state} (since ${pointer.updatedAt})`;
}

async function setChannel(target, channel, change) {
  const { data } = await call(target, 'PUT', `/v1/admin/channels/${channel}`, { json: change });
  report(describePointer(channel, data));
  return data;
}

// ---- commands -----------------------------------------------------------

/** Merges the build legs' fragments into the manifest the server stores. */
function manifestCommand() {
  if (typeof flags.in !== 'string' || typeof flags.out !== 'string') fail('manifest needs --in <folder> and --out <file>');
  const version =
    typeof flags.version === 'string'
      ? flags.version.replace(/^v/, '')
      : JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
  const fragments = fs
    .readdirSync(flags.in)
    .filter((name) => /^fragment-.*\.json$/.test(name))
    .map((name) => JSON.parse(fs.readFileSync(path.join(flags.in, name), 'utf8')));
  if (!fragments.length) fail(`No fragment-*.json in ${flags.in}. Did the build legs run collect.mjs?`);
  const notes = typeof flags['notes-file'] === 'string' ? fs.readFileSync(flags['notes-file'], 'utf8') : flags.notes;
  const manifest = buildManifest({
    version,
    pubDate: new Date(),
    notes: typeof notes === 'string' ? notes : '',
    critical: flags.critical === true || flags.critical === 'true',
    downloadPage: typeof flags['download-page'] === 'string' && flags['download-page'] ? flags['download-page'] : null,
    fragments,
  });
  fs.writeFileSync(flags.out, `${JSON.stringify(manifest, null, 2)}\n`);
  report(`Manifest for ${version}: ${Object.keys(manifest.artifacts).join(', ')}`);
}

/** Uploads every file, then the manifest, then moves the channel to it. */
async function publishCommand() {
  if (typeof flags.dir !== 'string' || typeof flags.manifest !== 'string') fail('publish needs --dir <folder> and --manifest <file>');
  const manifest = JSON.parse(fs.readFileSync(flags.manifest, 'utf8'));
  if (!VERSION.test(manifest.version ?? '')) fail(`${flags.manifest} has no valid version`);
  const channel = channelFlag();
  const rollout = percentFlag('rollout', 100);

  // Check every file against the manifest before anything leaves the machine.
  const files = new Map();
  for (const [key, artifact] of Object.entries(manifest.artifacts)) {
    const filePath = path.join(flags.dir, artifact.file);
    if (!files.has(artifact.file)) {
      if (!fs.existsSync(filePath)) fail(`${artifact.file} (for ${key}) is not in ${flags.dir}`);
      const size = fs.statSync(filePath).size;
      const sha256 = sha256File(filePath);
      if (size !== artifact.size || sha256 !== artifact.sha256) fail(`${artifact.file} does not match the manifest`);
      files.set(artifact.file, { filePath, size, sha256 });
    }
  }

  if (flags['dry-run']) {
    report(`Dry run: would publish ${manifest.version} (${files.size} files) to ${channel} at ${rollout}%`);
    return;
  }

  const target = server();
  const before = await channels(target);
  const current = before[channel];
  if (current && compareVersions(manifest.version, current.version) < 0 && !flags.force) {
    fail(`${channel} is on ${current.version}, which is newer than ${manifest.version}. Pass --force to move it back anyway.`);
  }

  for (const [name, file] of files) {
    const { status } = await call(target, 'PUT', `/v1/admin/releases/${manifest.version}/files/${encodeURIComponent(name)}`, {
      body: fs.readFileSync(file.filePath),
      headers: { 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': file.sha256 },
    });
    console.log(`${status === 201 ? 'uploaded' : 'already there'} ${name} (${(file.size / 1048576).toFixed(1)} MB)`);
  }

  const { status } = await call(target, 'PUT', `/v1/admin/releases/${manifest.version}`, { json: manifest });
  report(`Release ${manifest.version} ${status === 201 ? 'published' : 'was already published, unchanged'}`);

  await setChannel(target, channel, { version: manifest.version, rollout, paused: false });
}

async function statusCommand() {
  const target = server();
  const pointers = await channels(target);
  for (const name of CHANNELS) report(describePointer(name, pointers[name]));
  const { data: releases } = await call(target, 'GET', '/v1/admin/releases');
  const recent = (releases ?? []).slice(0, 5);
  if (recent.length) {
    report('');
    report('Recent releases:');
    for (const release of recent) {
      report(`  ${release.version}${release.published ? '' : ' (not published)'}: ${(release.artifacts ?? []).join(', ')}`);
    }
  }
  const { data: stats } = await call(target, 'GET', '/v1/admin/stats');
  if (stats?.checks?.length) {
    const byVersion = {};
    for (const check of stats.checks) byVersion[check.current] = (byVersion[check.current] ?? 0) + check.count;
    report('');
    report(`Checks since ${stats.since}, by the version that asked:`);
    for (const [version, count] of Object.entries(byVersion).sort(([a], [b]) => compareVersions(b, a))) {
      report(`  ${version}: ${count}`);
    }
  }
}

async function rolloutCommand() {
  const percent = percentFlag('percent');
  await setChannel(server(), channelFlag(), { rollout: percent });
}

async function pauseCommand(paused) {
  await setChannel(server(), channelFlag(), { paused });
}

async function promoteCommand() {
  const version = typeof flags.version === 'string' ? flags.version.replace(/^v/, '') : '';
  if (!VERSION.test(version)) fail('promote needs --version X.Y.Z');
  const channel = channelFlag();
  const target = server();
  const current = (await channels(target))[channel];
  if (current && compareVersions(version, current.version) < 0 && !flags.force) {
    fail(`${channel} is on ${current.version}, which is newer than ${version}. Pass --force to move it back anyway.`);
  }
  await setChannel(target, channel, { version, rollout: percentFlag('percent', 100), paused: false });
}

const commands = {
  manifest: manifestCommand,
  publish: publishCommand,
  status: statusCommand,
  rollout: rolloutCommand,
  pause: () => pauseCommand(true),
  resume: () => pauseCommand(false),
  promote: promoteCommand,
};

try {
  const run = commands[command];
  if (!run) fail(`Unknown command ${command ?? '(none)'}. Use one of: ${Object.keys(commands).join(', ')}`);
  await run();
} catch (error) {
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Desktop updates::${error.message}`);
  else console.error(error.message);
  process.exit(1);
}
