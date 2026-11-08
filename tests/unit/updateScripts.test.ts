// The release side of desktop updates (scripts/updates/lib.mjs): which build
// file serves which platform, the name it is published under, the manifest
// the build legs' fragments merge into, and the build overlay's checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  belongsToVersion,
  buildManifest,
  checkPublicKey,
  checkUpdatesUrl,
  compareVersions,
  decodeMinisign,
  describeBundle,
  endpointTemplate,
  parseArgs,
  platformKeys,
  publishedName,
  updaterOverlay,
} from '../../scripts/updates/lib.mjs';

const PUBLIC_KEY = Buffer.from(
  'untrusted comment: minisign public key: 3A8E7F1C2B4D6E90\nRWSQbk0rHH+OOsmTkUf1QmBiBd5TaBbVa1Zz6cPp6lB1Z1vYk0sWl9sQ\n'
).toString('base64');
const SIGNATURE = Buffer.from(
  'untrusted comment: signature from tauri secret key\nRUSQbk0r\ntrusted comment: timestamp:1\tfile:x\nabc\n'
).toString('base64');

test('each bundle the release builds serves the platforms it was built for', () => {
  assert.deepEqual(describeBundle('universal-apple-darwin/release/bundle/macos/Open Screenshot Generator.app.tar.gz'), {
    os: 'darwin',
    bundle: 'app',
    arches: ['aarch64', 'x86_64'],
  });
  assert.deepEqual(describeBundle('release/bundle/macos/Open Screenshot Generator.app.tar.gz', 'arm64')?.arches, ['aarch64']);
  assert.deepEqual(describeBundle('release/bundle/nsis/Open Screenshot Generator_1.0.7_x64-setup.exe'), {
    os: 'windows',
    bundle: 'nsis',
    arches: ['x86_64'],
  });
  assert.deepEqual(describeBundle('release/bundle/msi/Open Screenshot Generator_1.0.7_x64_en-US.msi')?.bundle, 'msi');
  assert.deepEqual(describeBundle('release/bundle/appimage/Open Screenshot Generator_1.0.7_amd64.AppImage')?.arches, ['x86_64']);
  assert.deepEqual(describeBundle('release/bundle/deb/Open Screenshot Generator_1.0.7_arm64.deb')?.arches, ['aarch64']);
  assert.deepEqual(describeBundle('release/bundle/rpm/Open Screenshot Generator-1.0.7-1.x86_64.rpm')?.bundle, 'rpm');
});

test('anything that is not an update payload is left alone', () => {
  assert.equal(describeBundle('release/bundle/dmg/Open Screenshot Generator_1.0.7_universal.dmg'), null);
  assert.equal(describeBundle('release/bundle/nsis/Open Screenshot Generator_1.0.7_x64-setup.exe.sig'), null);
  assert.equal(describeBundle('release/Open Screenshot Generator.exe'), null);
  assert.equal(describeBundle('release/bundle/macos/Open Screenshot Generator.app/Contents/Info.plist'), null);
});

test('platform keys are what the app asks for: os, arch, installer', () => {
  assert.deepEqual(platformKeys({ os: 'darwin', bundle: 'app', arches: ['aarch64', 'x86_64'] }), [
    'darwin-aarch64-app',
    'darwin-x86_64-app',
  ]);
});

test('published names have no spaces, and the macOS tarball gains its version', () => {
  assert.equal(
    publishedName('Open Screenshot Generator_1.0.7_x64-setup.exe', { version: '1.0.7', os: 'windows', arches: ['x86_64'] }),
    'Open.Screenshot.Generator_1.0.7_x64-setup.exe'
  );
  assert.equal(
    publishedName('Open Screenshot Generator.app.tar.gz', { version: '1.0.7', os: 'darwin', arches: ['aarch64', 'x86_64'] }),
    'Open.Screenshot.Generator_1.0.7_universal.app.tar.gz'
  );
});

test('a bundle left from the last release in a cached target folder is not taken', () => {
  assert.equal(belongsToVersion('Open Screenshot Generator_1.0.7_x64-setup.exe', '1.0.7', 'windows'), true);
  assert.equal(belongsToVersion('Open Screenshot Generator_1.0.6_x64-setup.exe', '1.0.7', 'windows'), false);
  assert.equal(belongsToVersion('Open Screenshot Generator-1.0.7-1.x86_64.rpm', '1.0.7', 'linux'), true);
  assert.equal(belongsToVersion('Open Screenshot Generator.app.tar.gz', '1.0.7', 'darwin'), true);
});

test('versions compare by semver, with a prerelease before its release', () => {
  assert.ok(compareVersions('1.0.10', '1.0.9') > 0);
  assert.ok(compareVersions('1.1.0', '1.0.99') > 0);
  assert.ok(compareVersions('1.0.0-beta.2', '1.0.0') < 0);
  assert.ok(compareVersions('1.0.0-beta.10', '1.0.0-beta.2') > 0);
  assert.ok(compareVersions('1.0.0-rc-1', '1.0.0-rc-1') === 0);
  assert.equal(compareVersions('v2.0.0', '2.0.0'), 0);
});

test('the fragments from every build leg merge into one manifest', () => {
  const manifest = buildManifest({
    version: '1.0.7',
    pubDate: '2026-11-07T10:00:00Z',
    notes: '  Faster export  ',
    downloadPage: 'https://github.com/dotnetdreamer/open-screenshot-generator/releases/tag/v1.0.7',
    fragments: [
      {
        version: '1.0.7',
        entries: [
          { file: 'a.app.tar.gz', keys: ['darwin-aarch64-app', 'darwin-x86_64-app'], size: 10, sha256: 'a'.repeat(64), signature: SIGNATURE },
        ],
      },
      {
        version: '1.0.7',
        entries: [
          { file: 'b-setup.exe', keys: ['windows-x86_64-nsis'], size: 20, sha256: 'b'.repeat(64), signature: SIGNATURE },
          { file: 'b.msi', keys: ['windows-x86_64-msi'], size: 30, sha256: 'c'.repeat(64), signature: SIGNATURE },
        ],
      },
    ],
  });
  assert.equal(manifest.pubDate, '2026-11-07T10:00:00.000Z');
  assert.equal(manifest.notes, 'Faster export');
  assert.equal(manifest.critical, false);
  assert.deepEqual(Object.keys(manifest.artifacts), [
    'darwin-aarch64-app',
    'darwin-x86_64-app',
    'windows-x86_64-msi',
    'windows-x86_64-nsis',
  ]);
  assert.equal(manifest.artifacts['darwin-x86_64-app'].file, 'a.app.tar.gz');
});

test('a manifest refuses a leg built at another version, a key claimed twice, and an empty release', () => {
  const entry = { file: 'x.msi', keys: ['windows-x86_64-msi'], size: 1, sha256: 'a'.repeat(64), signature: SIGNATURE };
  assert.throws(
    () => buildManifest({ version: '1.0.7', pubDate: Date.now(), fragments: [{ version: '1.0.6', entries: [entry] }] }),
    /version 1.0.6/
  );
  assert.throws(
    () =>
      buildManifest({
        version: '1.0.7',
        pubDate: Date.now(),
        fragments: [{ version: '1.0.7', entries: [entry, { ...entry, file: 'y.msi', sha256: 'b'.repeat(64) }] }],
      }),
    /claim windows-x86_64-msi/
  );
  assert.throws(() => buildManifest({ version: '1.0.7', pubDate: Date.now(), fragments: [] }), /No update files/);
});

test('the build overlay turns on updater artifacts and points at the server', () => {
  const overlay = updaterOverlay({ updatesUrl: 'https://updates.example.com', publicKey: PUBLIC_KEY });
  assert.equal(overlay.bundle.createUpdaterArtifacts, true);
  assert.deepEqual(overlay.plugins.updater.endpoints, [
    'https://updates.example.com/v1/desktop/{{target}}/{{arch}}/{{bundle_type}}/{{current_version}}',
  ]);
  assert.equal(overlay.plugins.updater.pubkey, PUBLIC_KEY);
  assert.equal(endpointTemplate('https://u.example'), 'https://u.example/v1/desktop/{{target}}/{{arch}}/{{bundle_type}}/{{current_version}}');
});

test('the server address and the public key are checked before a build uses them', () => {
  assert.equal(checkUpdatesUrl('https://updates.example.com/'), 'https://updates.example.com');
  assert.throws(() => checkUpdatesUrl('http://updates.example.com'), /https/);
  assert.throws(() => checkUpdatesUrl('http://localhost:8730'), /https/);
  assert.equal(checkUpdatesUrl('http://localhost:8730', { allowLocal: true }), 'http://localhost:8730');
  assert.throws(() => checkUpdatesUrl('http://updates.example.com', { allowLocal: true }), /https/);
  assert.throws(() => checkUpdatesUrl('https://updates.example.com/v1'), /address alone/);
  assert.throws(() => checkUpdatesUrl('updates.example.com'), /not a URL/);
  assert.equal(checkPublicKey(`  ${PUBLIC_KEY}\n`), PUBLIC_KEY);
  assert.throws(() => checkPublicKey(SIGNATURE), /public key/);
  assert.throws(() => checkPublicKey('not base64!'), /public key/);
  assert.ok(decodeMinisign(SIGNATURE)?.startsWith('untrusted comment:'));
});

test('arguments read as flags with values, bare flags, and words', () => {
  assert.deepEqual(parseArgs(['publish', '--dir', 'out', '--dry-run', '--rollout=25']), {
    positional: ['publish'],
    flags: { dir: 'out', 'dry-run': true, rollout: '25' },
  });
});
