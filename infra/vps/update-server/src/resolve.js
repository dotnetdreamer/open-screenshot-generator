// Which release, if any, one install is offered.
//
// Pure: it reads the channel pointers and the manifests it is handed and
// decides. No disk, no HTTP, no clock.

import { compareVersions } from './semver.js';

export const TARGETS = ['windows', 'darwin', 'linux'];
export const ARCHES = ['x86_64', 'aarch64', 'i686', 'armv7'];
/** What an artifact can be. A check may also say `unknown`, see FALLBACK_BUNDLES. */
export const BUNDLES = ['nsis', 'msi', 'app', 'appimage', 'deb', 'rpm'];
export const CHANNELS = ['stable', 'beta'];

/** The key of one artifact in a manifest: target, arch and bundle. */
export const ARTIFACT_KEY_RE = /^(windows|darwin|linux)-(x86_64|aarch64|i686|armv7)-(nsis|msi|app|appimage|deb|rpm)$/;

/**
 * What an install that cannot name its bundle gets, best first. That is a
 * portable exe or a dev build. An install that names its bundle only ever
 * gets that bundle, so an MSI install is never handed the NSIS installer.
 */
const FALLBACK_BUNDLES = {
  windows: ['nsis', 'msi'],
  darwin: ['app'],
  linux: ['appimage', 'deb', 'rpm'],
};

/**
 * The pointer an install in `bucket` follows, as { channel, pointer }, or
 * null when none applies.
 *
 * A stable install follows the stable pointer. A beta install follows
 * whichever of the beta and stable pointers is newer, so it never sits behind
 * stable. A pointer applies only while it is not paused and the bucket is
 * below its rollout: at rollout 10, buckets 0 to 9. When both point at the
 * same version, stable is the one reported.
 */
export function pickPointer(pointers, channel, bucket) {
  const names = channel === 'beta' ? ['stable', 'beta'] : ['stable'];
  let best = null;
  for (const name of names) {
    const pointer = pointers[name];
    if (!pointer || pointer.paused || bucket >= pointer.rollout) continue;
    if (!best || compareVersions(pointer.version, best.pointer.version) > 0) best = { channel: name, pointer };
  }
  return best;
}

/** The artifact in `manifest` for this platform, as { key, artifact }, or null. */
export function pickArtifact(manifest, target, arch, bundle) {
  const bundles = bundle === 'unknown' ? FALLBACK_BUNDLES[target] ?? [] : [bundle];
  for (const candidate of bundles) {
    const key = `${target}-${arch}-${candidate}`;
    if (Object.hasOwn(manifest.artifacts, key)) return { key, artifact: manifest.artifacts[key] };
  }
  return null;
}

/**
 * The whole decision for one check. `manifestOf(version)` answers a published
 * manifest or null. Returns { channel, manifest, key, artifact } for an
 * update, or null for none, which the route sends as a 204.
 */
export function resolveUpdate({ pointers, manifestOf, channel, bucket, target, arch, bundle, current }) {
  const picked = pickPointer(pointers, channel, bucket);
  if (!picked || compareVersions(picked.pointer.version, current) <= 0) return null;
  const manifest = manifestOf(picked.pointer.version);
  if (!manifest) return null;
  const choice = pickArtifact(manifest, target, arch, bundle);
  if (!choice) return null;
  return { channel: picked.channel, manifest, key: choice.key, artifact: choice.artifact };
}
