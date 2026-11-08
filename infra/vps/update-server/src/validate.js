// What the admin API accepts, checked before anything touches the disk.
//
// Pure. A manifest read back from disk at startup goes through the same
// normalizeManifest as one a CI job sends, so the two cannot disagree about
// what a manifest is.

import { ARTIFACT_KEY_RE } from './resolve.js';
import { isVersion } from './semver.js';

/** Lowercase hex, the way sha256sum prints it. */
export const SHA256_RE = /^[0-9a-f]{64}$/;

/** No spaces and no path separators, so a file name is always one entry in one folder. */
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** The one name in a release folder that is not an uploaded file. */
export const MANIFEST_FILE = 'manifest.json';

const MAX_NOTES_LENGTH = 10_000;

const MANIFEST_FIELDS = ['version', 'pubDate', 'notes', 'critical', 'downloadPage', 'artifacts'];
const ARTIFACT_FIELDS = ['file', 'signature', 'size', 'sha256'];
const POINTER_FIELDS = ['version', 'rollout', 'paused'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The first key of `value` that is not in `allowed`. A misspelt field is
 * refused rather than dropped: `rolout: 10` ignored would leave a release
 * rolled out to everybody.
 */
function unknownField(value, allowed) {
  return Object.keys(value).find((key) => !allowed.includes(key));
}

/** A value quoted into an error message, cut short. */
function quote(value) {
  const text = JSON.stringify(String(value));
  return text.length > 80 ? `${text.slice(0, 76)}..."` : text;
}

/** Whether `value` can be stored as an artifact in a release folder. */
export function isFileName(value) {
  return (
    typeof value === 'string' &&
    FILE_NAME_RE.test(value) &&
    !value.includes('..') &&
    value.toLowerCase() !== MANIFEST_FILE
  );
}

/**
 * Whether `value` is a Tauri signature: the base64 of a minisign signature
 * file, which always opens with an "untrusted comment:" line.
 */
export function isSignature(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('utf8').startsWith('untrusted comment:');
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isRollout(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * Checks a release manifest and returns { manifest } in the form it is stored
 * and compared in: every field present, `pubDate` as ISO 8601 with
 * milliseconds, artifacts in key order. Returns { error } when it is not
 * acceptable. Absent and null mean the same for the optional fields.
 *
 * This looks at the manifest alone. Whether the files it names are on disk
 * with that size and hash is checked by the store when it publishes.
 */
export function normalizeManifest(input, version) {
  if (!isPlainObject(input)) return { error: 'the manifest must be a JSON object' };
  const extra = unknownField(input, MANIFEST_FIELDS);
  if (extra !== undefined) return { error: `unknown field ${quote(extra)}` };
  if (input.version !== version) return { error: `version must be ${quote(version)}, the version in the URL` };

  // toISOString writes a year outside 0000 to 9999 with six digits and a sign,
  // which is not RFC 3339, and Tauri refuses an update whose pub_date it
  // cannot parse.
  const date = typeof input.pubDate === 'string' ? new Date(input.pubDate) : null;
  const pubDate = date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
  if (!/^\d{4}-/.test(pubDate)) return { error: 'pubDate must be a date, such as 2026-11-07T12:00:00Z' };

  const notes = input.notes ?? '';
  if (typeof notes !== 'string' || notes.length > MAX_NOTES_LENGTH) {
    return { error: `notes must be text of at most ${MAX_NOTES_LENGTH} characters` };
  }
  const critical = input.critical ?? false;
  if (typeof critical !== 'boolean') return { error: 'critical must be true or false' };
  const downloadPage = input.downloadPage ?? null;
  if (downloadPage !== null && !isHttpsUrl(downloadPage)) return { error: 'downloadPage must be an https URL' };

  if (!isPlainObject(input.artifacts) || Object.keys(input.artifacts).length === 0) {
    return { error: 'artifacts must hold at least one artifact' };
  }
  const artifacts = {};
  for (const key of Object.keys(input.artifacts).sort()) {
    if (!ARTIFACT_KEY_RE.test(key)) return { error: `${quote(key)} is not an artifact key, such as windows-x86_64-nsis` };
    const entry = input.artifacts[key];
    if (!isPlainObject(entry)) return { error: `artifacts.${key} must be an object` };
    const extraField = unknownField(entry, ARTIFACT_FIELDS);
    if (extraField !== undefined) return { error: `artifacts.${key} has an unknown field ${quote(extraField)}` };
    if (!isFileName(entry.file)) return { error: `artifacts.${key}.file is not a file name this server stores` };
    if (!isSignature(entry.signature)) {
      return { error: `artifacts.${key}.signature must be the contents of the .sig file Tauri wrote, which is base64` };
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) return { error: `artifacts.${key}.size must be a number of bytes` };
    if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) {
      return { error: `artifacts.${key}.sha256 must be 64 lowercase hex characters` };
    }
    artifacts[key] = { file: entry.file, signature: entry.signature, size: entry.size, sha256: entry.sha256 };
  }

  return { manifest: { version, pubDate, notes, critical, downloadPage, artifacts } };
}

/** Whether two normalized manifests say the same thing. */
export function sameManifest(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A channel pointer read from disk, or null when `value` is not one. */
export function readPointer(value) {
  if (!isPlainObject(value)) return null;
  const { version, rollout, paused, updatedAt } = value;
  if (!isVersion(version) || !isRollout(rollout) || typeof paused !== 'boolean' || typeof updatedAt !== 'string') return null;
  return { version, rollout, paused, updatedAt };
}

/**
 * A channel PUT body merged onto the current pointer, which may be null.
 * `isPublished(version)` says whether a version may be pointed at. Returns
 * { pointer } stamped with `now`, or { error }.
 */
export function mergePointer(current, input, isPublished, now) {
  if (!isPlainObject(input)) return { error: 'the body must be a JSON object' };
  const extra = unknownField(input, POINTER_FIELDS);
  if (extra !== undefined) return { error: `unknown field ${quote(extra)}` };

  const version = input.version ?? current?.version;
  if (version === undefined) return { error: 'version is required, because this channel has no pointer yet' };
  if (!isVersion(version)) return { error: `${quote(version)} is not a version` };
  if (!isPublished(version)) return { error: `${version} is not published, and a channel can only point at a published release` };

  const rollout = input.rollout ?? current?.rollout ?? 100;
  if (!isRollout(rollout)) return { error: 'rollout must be a whole number from 0 to 100' };
  const paused = input.paused ?? current?.paused ?? false;
  if (typeof paused !== 'boolean') return { error: 'paused must be true or false' };

  return { pointer: { version, rollout, paused, updatedAt: now } };
}
