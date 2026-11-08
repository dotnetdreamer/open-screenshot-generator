// Shared by the update scripts in this folder. Pure functions only, so
// tests/unit/updateScripts.test.ts can run them without a build or a server.
//
// The words used here are the update server's (infra/vps/update-server): a
// release has artifacts, each published under one or more platform keys of the
// form `{os}-{arch}-{bundle}`, the same three values the app puts in its check
// URL (src-tauri/src/updater.rs).

import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const PLATFORM_KEY = /^(windows|darwin|linux)-(x86_64|aarch64|i686|armv7)-(nsis|msi|app|appimage|deb|rpm)$/;
export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
export const CHANNELS = ['stable', 'beta'];

/** Where the generated build overlay goes, relative to the repo root. */
export const OVERLAY_PATH = 'src-tauri/tauri.updater.conf.json';

/**
 * The check URL the app is built with. The four placeholders are the
 * updater plugin's; it fills them in on every check.
 */
export function endpointTemplate(updatesUrl) {
  return `${updatesUrl}/v1/desktop/{{target}}/{{arch}}/{{bundle_type}}/{{current_version}}`;
}

/**
 * The update server's base URL, checked: https, no path, no trailing slash.
 * `allowLocal` also lets through plain http on this machine, for publishing to
 * a server started locally to test an update; a build never gets that.
 */
export function checkUpdatesUrl(value, { allowLocal = false } = {}) {
  const text = String(value ?? '').trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`UPDATES_URL is not a URL: ${JSON.stringify(text)}`);
  }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLocal && local)) {
    throw new Error(`UPDATES_URL must use https, got ${url.protocol}`);
  }
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`UPDATES_URL must be the server's address alone, like https://updates.example.com, got ${text}`);
  }
  return url.origin;
}

/** Decodes a key or signature the way Tauri stores it: base64 of a minisign text file. */
export function decodeMinisign(value) {
  const text = String(value ?? '').trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const decoded = Buffer.from(text, 'base64').toString('utf8');
  return decoded.startsWith('untrusted comment:') ? decoded : null;
}

/** The updater public key, checked: the content of the `.key.pub` file `tauri signer generate` wrote. */
export function checkPublicKey(value) {
  const key = String(value ?? '').trim();
  const decoded = decodeMinisign(key);
  if (!decoded || !/public key/i.test(decoded.split('\n')[0])) {
    throw new Error('UPDATER_PUBKEY is not a Tauri updater public key. Paste the whole content of the .key.pub file.');
  }
  return key;
}

/** The overlay merged into tauri.conf.json for a release build that updates itself. */
export function updaterOverlay({ updatesUrl, publicKey }) {
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: [endpointTemplate(updatesUrl)],
      },
    },
  };
}

const WINDOWS_ARCH = { x64: 'x86_64', arm64: 'aarch64', x86: 'i686' };
const LINUX_ARCH = { amd64: 'x86_64', x86_64: 'x86_64', arm64: 'aarch64', aarch64: 'aarch64', i386: 'i686', i686: 'i686', armhf: 'armv7', armhfp: 'armv7' };
const HOST_ARCH = { x64: 'x86_64', arm64: 'aarch64', ia32: 'i686', arm: 'armv7' };

/**
 * What a bundled file is, from its path under `src-tauri/target`: the bundle
 * kind and the architectures it serves, or null for anything that is not an
 * update payload.
 *
 * A macOS universal build serves both Mac architectures from one tarball. A
 * native build's folder does not say which it is, so `hostArch` (node's
 * process.arch on the machine that built it) does.
 */
export function describeBundle(relativePath, hostArch = process.arch) {
  const parts = relativePath.split(/[\\/]/);
  const name = parts.at(-1);
  const folder = parts.at(-2);
  if (folder === 'macos' && name.endsWith('.app.tar.gz')) {
    const triple = parts.length > 4 ? parts.at(-5) : null;
    const arches =
      triple === 'universal-apple-darwin'
        ? ['aarch64', 'x86_64']
        : triple === 'aarch64-apple-darwin'
          ? ['aarch64']
          : triple === 'x86_64-apple-darwin'
            ? ['x86_64']
            : [HOST_ARCH[hostArch]].filter(Boolean);
    return arches.length ? { os: 'darwin', bundle: 'app', arches } : null;
  }
  if (folder === 'nsis' && name.endsWith('-setup.exe')) {
    const arch = WINDOWS_ARCH[name.match(/_(x64|arm64|x86)-setup\.exe$/)?.[1]];
    return arch ? { os: 'windows', bundle: 'nsis', arches: [arch] } : null;
  }
  if (folder === 'msi' && name.endsWith('.msi')) {
    const arch = WINDOWS_ARCH[name.match(/_(x64|arm64|x86)(?:_[A-Za-z-]+)?\.msi$/)?.[1]];
    return arch ? { os: 'windows', bundle: 'msi', arches: [arch] } : null;
  }
  if (folder === 'appimage' && name.endsWith('.AppImage')) {
    const arch = LINUX_ARCH[name.match(/_([A-Za-z0-9]+)\.AppImage$/)?.[1]];
    return arch ? { os: 'linux', bundle: 'appimage', arches: [arch] } : null;
  }
  if (folder === 'deb' && name.endsWith('.deb')) {
    const arch = LINUX_ARCH[name.match(/_([A-Za-z0-9]+)\.deb$/)?.[1]];
    return arch ? { os: 'linux', bundle: 'deb', arches: [arch] } : null;
  }
  if (folder === 'rpm' && name.endsWith('.rpm')) {
    const arch = LINUX_ARCH[name.match(/\.([A-Za-z0-9_]+)\.rpm$/)?.[1]];
    return arch ? { os: 'linux', bundle: 'rpm', arches: [arch] } : null;
  }
  return null;
}

export function platformKeys({ os, bundle, arches }) {
  return arches.map((arch) => `${os}-${arch}-${bundle}`);
}

/**
 * The name a payload is published under: spaces become dots, the way GitHub
 * names release assets, and the macOS tarball, which the bundler names after
 * the app alone, gains the version and what it runs on.
 */
export function publishedName(fileName, { version, os, arches }) {
  let name = fileName;
  if (os === 'darwin' && !name.includes(version)) {
    const label = arches.length > 1 ? 'universal' : arches[0];
    name = name.replace(/\.app\.tar\.gz$/, `_${version}_${label}.app.tar.gz`);
  }
  name = name.replace(/\s+/g, '.').replace(/[^A-Za-z0-9._-]/g, '-');
  if (!FILE_NAME.test(name)) throw new Error(`Cannot publish ${fileName}: ${name} is not a usable file name`);
  return name;
}

/** Whether a bundle on disk belongs to `version`. The macOS tarball carries no version in its name. */
export function belongsToVersion(fileName, version, os) {
  return os === 'darwin' || fileName.includes(`_${version}_`) || fileName.includes(`-${version}-`);
}

export function sha256File(path) {
  const hash = createHash('sha256');
  const fd = fs.openSync(path, 'r');
  try {
    const chunk = Buffer.alloc(1 << 20);
    let read;
    while ((read = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** Semver precedence, prerelease included. Negative when a < b. */
export function compareVersions(a, b) {
  const split = (v) => {
    const text = String(v).replace(/^v/, '');
    const dash = text.indexOf('-');
    const core = dash < 0 ? text : text.slice(0, dash);
    const pre = dash < 0 ? '' : text.slice(dash + 1);
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * @typedef {{ file: string, keys: string[], size: number, sha256: string, signature: string }} FragmentEntry
 * @typedef {{ version: string, entries: FragmentEntry[] }} Fragment
 */

/**
 * The release manifest the update server stores, from the fragments the
 * build legs collected. Every key must come from exactly one file.
 *
 * @param {{
 *   version: string,
 *   pubDate: string | number | Date,
 *   notes?: string,
 *   critical?: boolean,
 *   downloadPage?: string | null,
 *   fragments: Fragment[],
 * }} release
 */
export function buildManifest({ version, pubDate, notes, critical = false, downloadPage = null, fragments }) {
  if (!VERSION.test(version)) throw new Error(`${version} is not a release version`);
  const artifacts = {};
  const files = new Map();
  for (const fragment of fragments) {
    if (fragment.version !== version) {
      throw new Error(`A build leg collected version ${fragment.version}, but this release is ${version}`);
    }
    for (const entry of fragment.entries) {
      const known = files.get(entry.file);
      if (known && (known.sha256 !== entry.sha256 || known.size !== entry.size)) {
        throw new Error(`Two different files are both called ${entry.file}`);
      }
      files.set(entry.file, entry);
      for (const key of entry.keys) {
        if (!PLATFORM_KEY.test(key)) throw new Error(`${key} is not a platform key`);
        if (artifacts[key] && artifacts[key].file !== entry.file) {
          throw new Error(`Both ${artifacts[key].file} and ${entry.file} claim ${key}`);
        }
        artifacts[key] = { file: entry.file, signature: entry.signature, size: entry.size, sha256: entry.sha256 };
      }
    }
  }
  if (!Object.keys(artifacts).length) throw new Error('No update files were collected for this release');
  const text = typeof notes === 'string' ? notes.trim() : '';
  if (text.length > 10_000) throw new Error('The release notes are longer than 10000 characters');
  if (downloadPage && !String(downloadPage).startsWith('https://')) throw new Error('The download page must be an https URL');
  return {
    version,
    pubDate: new Date(pubDate).toISOString(),
    ...(text ? { notes: text } : {}),
    critical: Boolean(critical),
    downloadPage: downloadPage || null,
    artifacts: Object.fromEntries(Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** `--name value` and `--flag` pairs, plus the words before them. */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[name] = inline;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
    else flags[name] = true;
  }
  return { positional, flags };
}
