// The update server's state: the files under DATA_DIR, and the copy of them
// held in memory.
//
//   releases/<version>/<file>          an uploaded artifact
//   releases/<version>/manifest.json   written last. A release that has one is
//                                      published, and never changes again
//   channels/stable.json, beta.json    the two channel pointers
//   channels/history.jsonl             one line per pointer change, appended
//   tmp/                               uploads and JSON on their way in
//
// Everything is read once, at startup. This process is the only writer, so
// from then on memory is what is true, and each admin write goes to disk
// first and to memory once it is there. A file is written whole in tmp/ and
// renamed into place, which is atomic within one filesystem: a crash leaves
// the old file or the new one, and at worst a stray file in tmp/, which the
// next start removes.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CHANNELS } from './resolve.js';
import { compareVersions, isVersion } from './semver.js';
import { MANIFEST_FILE, normalizeManifest, readPointer, sameManifest } from './validate.js';

/** How this server names its own files in tmp/, so a start clears those and nothing else. */
const TEMP_NAME_RE = /^[0-9a-f]{24}\.(?:part|json)$/;

/** Removes a file that may or may not be there. */
export async function discard(file) {
  await fsp.rm(file, { force: true }).catch(() => {});
}

/** Makes a rename durable where the platform can. Windows cannot open a folder to sync it. */
async function syncDir(dir) {
  let handle;
  try {
    handle = await fsp.open(dir, 'r');
    await handle.sync();
  } catch {
    // Nothing more to do on this platform.
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * @param {string} dataDir
 * @param {(line: string) => void} log
 */
export function openStore(dataDir, log) {
  const releasesDir = path.join(dataDir, 'releases');
  const channelsDir = path.join(dataDir, 'channels');
  const tmpDir = path.join(dataDir, 'tmp');

  /**
   * version -> { version, published, manifest }. `manifest` is null for a
   * release that is not published yet, and for a published one whose
   * manifest.json could not be read, which is then never offered.
   */
  const releases = new Map();
  /** channel -> { version, rollout, paused, updatedAt } or null. */
  const pointers = Object.fromEntries(CHANNELS.map((channel) => [channel, null]));

  let queue = Promise.resolve();

  /**
   * Runs `task` once every write queued before it has finished. Admin writes
   * go through here, so two never interleave: a manifest is never checked
   * against a file an upload is replacing at the same moment.
   */
  function exclusive(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  function tempFile(extension) {
    return path.join(tmpDir, `${crypto.randomBytes(12).toString('hex')}.${extension}`);
  }

  /** Where an artifact lives. Both parts must already be validated. */
  function filePath(version, file) {
    return path.join(releasesDir, version, file);
  }

  async function writeJson(target, value) {
    const temp = tempFile('json');
    try {
      const handle = await fsp.open(temp, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsp.rename(temp, target);
    } catch (error) {
      await discard(temp);
      throw error;
    }
    await syncDir(path.dirname(target));
  }

  async function readJson(file) {
    try {
      return { text: await fsp.readFile(file, 'utf8') };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function loadRelease(version) {
    const read = await readJson(path.join(releasesDir, version, MANIFEST_FILE));
    if (!read) return { version, published: false, manifest: null };
    let result;
    try {
      result = normalizeManifest(JSON.parse(read.text), version);
    } catch (error) {
      result = { error: error.message };
    }
    if (result.error) {
      // Still published. A release never changes once it has a manifest, so
      // this one is held back rather than opened to uploads again.
      log(`[updates] releases/${version}/${MANIFEST_FILE} cannot be used (${result.error}), so ${version} is never offered`);
      return { version, published: true, manifest: null };
    }
    return { version, published: true, manifest: result.manifest };
  }

  async function loadPointer(channel) {
    const read = await readJson(path.join(channelsDir, `${channel}.json`));
    if (!read) return null;
    let pointer = null;
    try {
      pointer = readPointer(JSON.parse(read.text));
    } catch {
      pointer = null;
    }
    if (!pointer) log(`[updates] channels/${channel}.json cannot be used, so ${channel} offers nothing until it is set again`);
    return pointer;
  }

  /** Reads DATA_DIR into memory, creating its folders the first time. */
  async function load() {
    await fsp.mkdir(releasesDir, { recursive: true });
    await fsp.mkdir(channelsDir, { recursive: true });
    await fsp.mkdir(tmpDir, { recursive: true });
    for (const name of await fsp.readdir(tmpDir)) {
      if (TEMP_NAME_RE.test(name)) await discard(path.join(tmpDir, name));
    }

    for (const entry of await fsp.readdir(releasesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!isVersion(entry.name)) {
        log(`[updates] skipping releases/${entry.name}, which is not named after a version`);
        continue;
      }
      releases.set(entry.name, await loadRelease(entry.name));
    }

    for (const channel of CHANNELS) {
      const pointer = await loadPointer(channel);
      if (pointer && !isPublished(pointer.version)) {
        log(`[updates] ${channel} points at ${pointer.version}, which is not published here, so that pointer offers nothing`);
      }
      pointers[channel] = pointer;
    }
  }

  /** The published manifest of `version`, or null. */
  function manifestOf(version) {
    return releases.get(version)?.manifest ?? null;
  }

  function isPublished(version) {
    return manifestOf(version) !== null;
  }

  /** Every release folder, newest first, the way GET /v1/admin/releases lists them. */
  function listReleases() {
    return [...releases.values()]
      .sort((a, b) => compareVersions(b.version, a.version))
      .map(({ version, published, manifest }) => ({
        version,
        published,
        pubDate: manifest?.pubDate ?? null,
        critical: manifest?.critical ?? null,
        artifacts: manifest ? Object.keys(manifest.artifacts) : [],
      }));
  }

  /**
   * Streams `source` into a new file in tmp/, hashing it on the way, and
   * answers { file, size, sha256 }. More than `limit` bytes is an error. The
   * caller discards the file when it does not keep it; on an error it is
   * already gone.
   */
  async function receive(source, limit) {
    const file = tempFile('part');
    const hash = crypto.createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > limit) {
          callback(new Error(`the body is longer than the ${limit} bytes it declared`));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(source, meter, fs.createWriteStream(file, { flags: 'wx', flush: true }));
    } catch (error) {
      await discard(file);
      throw error;
    }
    return { file, size, sha256: hash.digest('hex') };
  }

  /**
   * The size and sha256 of a stored file, or null when it is not there. The
   * file is only read when its size is `expectedSize`, since a file of any
   * other size cannot be the one expected; `sha256` is null then.
   */
  async function digest(file, expectedSize) {
    let stat;
    try {
      stat = await fsp.stat(file);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile()) return null;
    if (stat.size !== expectedSize) return { size: stat.size, sha256: null };
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return { size: stat.size, sha256: hash.digest('hex') };
  }

  /**
   * Puts an upload that `receive` took into its release folder, and answers
   * the status for it: 201 stored, 200 when those bytes were already there,
   * 409 when the release is published and does not hold them. The file in
   * tmp/ is discarded whenever it is not moved into place. Call it through
   * `exclusive`.
   */
  async function commitFile(version, name, received) {
    const target = filePath(version, name);
    const release = releases.get(version);
    const stored = await digest(target, received.size);
    const same = stored !== null && stored.sha256 === received.sha256;

    if (release?.published || same) {
      await discard(received.file);
      if (!release) releases.set(version, { version, published: false, manifest: null });
      if (same) return 200;
      return 409;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(received.file, target);
    if (!release) releases.set(version, { version, published: false, manifest: null });
    return 201;
  }

  /**
   * Publishes a normalized manifest: checks every file it names against the
   * disk, size and a sha256 computed now, then writes manifest.json. Answers
   * { status, manifest } or { status, error }. Call it through `exclusive`.
   */
  async function publish(manifest) {
    const { version } = manifest;
    const release = releases.get(version);
    if (release?.published) {
      if (release.manifest && sameManifest(release.manifest, manifest)) return { status: 200, manifest: release.manifest };
      return {
        status: 409,
        error: `${version} is already published with a different manifest, and a published release never changes. Publish a new version instead`,
      };
    }

    // One file can serve two keys, such as a universal macOS build.
    const checked = new Map();
    for (const [key, artifact] of Object.entries(manifest.artifacts)) {
      if (!checked.has(artifact.file)) checked.set(artifact.file, await digest(filePath(version, artifact.file), artifact.size));
      const stored = checked.get(artifact.file);
      if (!stored) return { status: 400, error: `${artifact.file}, for ${key}, has not been uploaded to ${version}` };
      if (stored.size !== artifact.size) {
        return { status: 400, error: `${artifact.file} is ${stored.size} bytes here, and the manifest says ${artifact.size}` };
      }
      if (stored.sha256 !== artifact.sha256) {
        return { status: 400, error: `the sha256 of ${artifact.file} here is ${stored.sha256}, and the manifest says ${artifact.sha256}` };
      }
    }

    await writeJson(path.join(releasesDir, version, MANIFEST_FILE), manifest);
    releases.set(version, { version, published: true, manifest });
    return { status: 201, manifest };
  }

  /**
   * Moves a channel pointer, then appends the change to history.jsonl. Call
   * it through `exclusive`.
   */
  async function setPointer(channel, pointer) {
    const from = pointers[channel];
    await writeJson(path.join(channelsDir, `${channel}.json`), pointer);
    pointers[channel] = pointer;
    const line = JSON.stringify({ at: pointer.updatedAt, channel, from, to: pointer });
    try {
      await fsp.appendFile(path.join(channelsDir, 'history.jsonl'), `${line}\n`);
    } catch (error) {
      // The pointer has moved either way. The line is in the log instead.
      log(`[updates] could not append to channels/history.jsonl: ${error.message}. The change was ${line}`);
    }
  }

  return {
    releases,
    pointers,
    load,
    exclusive,
    filePath,
    manifestOf,
    isPublished,
    listReleases,
    receive,
    commitFile,
    publish,
    setPointer,
  };
}
