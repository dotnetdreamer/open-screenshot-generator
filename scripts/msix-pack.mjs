// Packs the release exe into an MSIX for the Microsoft Store.
//
//   npm run tauri:msix                    build the exe, then pack it
//   node scripts/msix-pack.mjs            pack the exe that is already built
//   node scripts/msix-pack.mjs --local    pack with a stand-in identity, to try
//                                         the package before the Partner Center
//                                         values are in AppxManifest.xml
//   node scripts/msix-pack.mjs --exe <path>
//                                         pack that exe instead of the newest
//                                         one in target/release
//   node scripts/msix-pack.mjs --out <path>
//                                         write the .msix there instead of
//                                         target/release/bundle/msix/
//
// Windows only, and it needs the Windows SDK for makepri.exe and makeappx.exe.
// The .msix comes out unsigned, which is what Partner Center takes: the Store
// signs it after certification. Windows will not install an unsigned package
// by double click, so to try one locally register the staged folder instead
// (docs/DESKTOP.md has the command).
//
// The exe is the whole app: Tauri builds the frontend into it and the app
// ships no resources or sidecars, the same reason the portable zip in
// desktop.yml is just the exe.

import {spawnSync} from 'node:child_process';
import {copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const msixDir = join(root, 'src-tauri', 'msix');
const PLACEHOLDER = 'PASTE_FROM_PARTNER_CENTER';

const fail = (message) => {
  console.error(`\n${message}\n`);
  process.exit(1);
};

const args = process.argv.slice(2);
const local = args.includes('--local');
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const exeArg = option('--exe');
const outArg = option('--out');

if (process.platform !== 'win32') fail('MSIX packages can only be built on Windows.');

const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const productName = conf.productName;
const description = conf.bundle?.shortDescription ?? productName;

// The Store reads x.y.z.0 and rejects a first part of 0. A local test package
// has no such rule, so --local lets a 0.x build through.
const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(conf.version)?.slice(1).map(Number);
if (!parts || parts.some((n) => n > 65535)) {
  fail(`tauri.conf.json version "${conf.version}" is not X.Y.Z with each part at most 65535.`);
}
if (parts[0] === 0 && !local) {
  fail(
    `The Microsoft Store rejects a package version that starts with 0, and this build is ${conf.version}.\n` +
      'Release 1.0.0 or later first (Actions > "Release desktop app (Tauri)", version 1.0.0), then pack that build.'
  );
}
const version = `${parts.join('.')}.0`;

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let manifest = readFileSync(join(msixDir, 'AppxManifest.xml'), 'utf8')
  .replaceAll('{{VERSION}}', version)
  .replaceAll('{{EXECUTABLE}}', xml(`${productName}.exe`))
  .replaceAll('{{DISPLAY_NAME}}', xml(productName))
  .replaceAll('{{DESCRIPTION}}', xml(description))
  .replaceAll('{{IDENTIFIER}}', xml(conf.identifier));

// The stand-in replaces the real identity too, so a test install never holds
// the Store app's package family and cannot get in the way of installing the
// real one from the Store later.
if (local) {
  manifest = manifest
    .replace(/(<Identity\b[^>]*\sName=")[^"]*"/, '$1OpenScreenshotGenerator.LocalTest"')
    .replace(/(<Identity\b[^>]*\sPublisher=")[^"]*"/, '$1CN=LocalTest"')
    .replace(/<PublisherDisplayName>[^<]*</, '<PublisherDisplayName>Local test<');
}
// Read from the three fields only: the comment at the top of the manifest
// names the placeholder too, so a search of the whole file always matches.
const identity = [
  manifest.match(/<Identity\b[^>]*\sName="([^"]*)"/)?.[1],
  manifest.match(/<Identity\b[^>]*\sPublisher="([^"]*)"/)?.[1],
  manifest.match(/<PublisherDisplayName>([^<]*)</)?.[1],
];
if (identity.some((value) => !value || value.includes(PLACEHOLDER))) {
  fail(
    'src-tauri/msix/AppxManifest.xml still has the placeholder identity.\n' +
      'Copy Name, Publisher and PublisherDisplayName from Partner Center (your app, then\n' +
      'Product management, then Product identity), or pass --local for a test package.'
  );
}
if (/\{\{\w+\}\}/.test(manifest)) fail(`AppxManifest.xml has a field this script does not fill: ${manifest.match(/\{\{\w+\}\}/)[0]}`);

// The newest of the two names, because the Tauri CLI has named the release exe
// after the product and after the crate in different versions, and an old
// build under the other name can still be sitting next to the new one.
const targetDir = process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(root, 'src-tauri', 'target');
let exe = exeArg ? resolve(exeArg) : null;
if (!exe) {
  const candidates = [`${productName}.exe`, 'open-screenshot-generator.exe']
    .map((name) => join(targetDir, 'release', name))
    .filter((path) => existsSync(path))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  exe = candidates[0];
}
if (!exe || !existsSync(exe)) {
  fail(`No release exe found in ${join(targetDir, 'release')}. Run "npm run tauri:msix", or pass --exe <path>.`);
}

const sdkBin = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
const sdkVersions = existsSync(sdkBin)
  ? readdirSync(sdkBin)
      .filter((name) => /^10\.\d+\.\d+\.\d+$/.test(name) && existsSync(join(sdkBin, name, 'x64', 'makeappx.exe')))
      .sort((a, b) => b.localeCompare(a, undefined, {numeric: true}))
  : [];
if (!sdkVersions.length) fail(`makeappx.exe not found under ${sdkBin}. Install the Windows SDK (Visual Studio Installer, "Windows 11 SDK").`);
const tool = (name) => join(sdkBin, sdkVersions[0], 'x64', name);

const run = (exePath, toolArgs) => {
  const result = spawnSync(exePath, toolArgs, {stdio: 'inherit'});
  if (result.status !== 0) fail(`${exePath} exited with ${result.status ?? result.error}.`);
};

const work = join(targetDir, 'msix');
const layout = join(work, 'layout');
rmSync(layout, {recursive: true, force: true});
mkdirSync(layout, {recursive: true});
copyFileSync(exe, join(layout, `${productName}.exe`));
cpSync(join(msixDir, 'Assets'), join(layout, 'Assets'), {recursive: true});
writeFileSync(join(layout, 'AppxManifest.xml'), manifest);

// A file the manifest names but the package lacks only shows up once Windows
// tries to draw it, so check them all here.
const missing = [...new Set(manifest.match(/Assets\\[\w.-]+\.png/g))].filter((ref) => !existsSync(join(layout, ref)));
if (missing.length) fail(`AppxManifest.xml names files that are not in src-tauri/msix/Assets/: ${missing.join(', ')}. Run "npm run assets:msix".`);

// resources.pri is what lets Windows pick Foo.scale-200.png or
// Foo.targetsize-32_altform-unplated.png when the manifest says Foo.png. The
// config lives outside the layout so it is not packed. Its default <packaging>
// section splits every scale into its own resources.scale-*.pri, which only a
// bundle with resource packages can load; a single .msix needs every image in
// the one resources.pri, so that section is removed.
const priConfig = join(work, 'priconfig.xml');
run(tool('makepri.exe'), ['createconfig', '/cf', priConfig, '/dq', 'en-US', '/pv', '10.0.0', '/o']);
const config = readFileSync(priConfig, 'utf8');
if (!/<packaging>[\s\S]*?<\/packaging>/.test(config)) fail(`${priConfig} has no <packaging> section to remove. Check what makepri createconfig wrote.`);
writeFileSync(priConfig, config.replace(/\s*<packaging>[\s\S]*?<\/packaging>/, ''));
run(tool('makepri.exe'), [
  'new', '/pr', layout, '/cf', priConfig, '/mn', join(layout, 'AppxManifest.xml'), '/of', join(layout, 'resources.pri'), '/o',
]);

const out = outArg
  ? resolve(outArg)
  : join(targetDir, 'release', 'bundle', 'msix', `${productName}_${version}_x64${local ? '_local-test' : ''}.msix`);
mkdirSync(dirname(out), {recursive: true});
run(tool('makeappx.exe'), ['pack', '/d', layout, '/p', out, '/o']);

console.log(`\nPacked ${out} (${(statSync(out).size / 1048576).toFixed(1)} MB)`);
if (local) console.log('This package has a stand-in identity. Partner Center will reject it; it is for testing only.');
