#!/usr/bin/env node
// Builds the Mac App Store edition from a clean checkout of one commit, signs it,
// packages it and has Apple validate it. With --upload it also sends it to App
// Store Connect.
//
// This repository is public, so the script holds no keys, IDs or certificate
// hashes. It reads them at run time from places git ignores: the login keychain,
// ~/.appstoreconnect/private_keys, the private/ folder and src-tauri/ of the main
// checkout. Everything it writes goes to --out, which has to be outside the repo.
//
//   node .claude/skills/mac-app-store-build/build.mjs --check
//   node .claude/skills/mac-app-store-build/build.mjs --out <dir> [--ref main] [--build N] [--upload] [--keep-source]

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: node .claude/skills/mac-app-store-build/build.mjs [options]

  --check          Check certificates, profile, API key and the next build number, then stop
  --out <dir>      Where the clean checkout and the .pkg go (outside the repo). Default: a new temp folder
  --ref <ref>      Commit, branch or tag to build. Default: main
  --build <n>      Build number. Default: one above the highest build App Store Connect has
  --upload         Upload after validation passes. Without it the build is only validated
  --keep-source    Keep the clean checkout after a successful run (it is removed by default)`;

const opt = { ref: 'main', out: null, build: null, upload: false, keepSource: false, check: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const value = () => argv[++i] ?? fail(`${a} needs a value`);
  if (a === '--ref') opt.ref = value();
  else if (a === '--out') opt.out = value();
  else if (a === '--build') opt.build = Number(value());
  else if (a === '--upload') opt.upload = true;
  else if (a === '--keep-source') opt.keepSource = true;
  else if (a === '--check') opt.check = true;
  else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  else fail(`Unknown option ${a}\n\n${USAGE}`);
}
if (opt.build !== null && !(Number.isInteger(opt.build) && opt.build > 0)) fail('--build must be a whole number above 0');

let worktree = null;

function fail(message) {
  console.error(`\nFAILED: ${message}`);
  if (worktree) console.error(`The clean checkout is still at ${worktree}. Remove it with: git worktree remove --force "${worktree}"`);
  process.exit(1);
}
const ok = (message) => console.log(`ok    ${message}`);
const warn = (message) => console.log(`WARN  ${message}`);
const title = (message) => console.log(`\n== ${message}`);

function run(cmd, args, options = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options });
  } catch (error) {
    fail(`${cmd} ${args.slice(0, 2).join(' ')} failed:\n${(error.stderr || error.stdout || error.message).toString().trim()}`);
  }
}

function step(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) fail(`${cmd} ${args.slice(0, 2).join(' ')} exited with ${result.status ?? result.signal}`);
}

const plistJson = (text) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: text }));

function readProfile(file) {
  const xml = execFileSync('security', ['cms', '-D', '-i', file], { stdio: ['ignore', 'pipe', 'ignore'] });
  const py = [
    'import sys, json, plistlib, hashlib',
    'p = plistlib.loads(sys.stdin.buffer.read())',
    'print(json.dumps({',
    '  "appId": p.get("Entitlements", {}).get("com.apple.application-identifier"),',
    '  "expires": p["ExpirationDate"].isoformat() + "Z",',
    '  "certs": [hashlib.sha1(c).hexdigest().upper() for c in p.get("DeveloperCertificates", [])],',
    '  "forStore": "ProvisionedDevices" not in p and not p.get("ProvisionsAllDevices", False),',
    '}))',
  ].join('\n');
  return JSON.parse(run('python3', ['-I', '-c', py], { input: xml }));
}

function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// The tail of an ID is enough to tell keys apart in a log without printing the ID.
const masked = (id) => `...${id.slice(-4)}`;

// ---------------------------------------------------------------- preflight

if (process.platform !== 'darwin') fail('Mac App Store builds need macOS.');

const here = path.dirname(fileURLToPath(import.meta.url));
const mainRoot = path.dirname(run('git', ['-C', here, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
const git = (...args) => run('git', ['-C', mainRoot, ...args]).trim();

if (opt.out) {
  const outFromRepo = path.relative(mainRoot, path.resolve(opt.out));
  if (!outFromRepo.startsWith('..') && !path.isAbsolute(outFromRepo)) {
    fail(`--out is inside the repository (${mainRoot}). Pick a folder outside it so nothing built here can be committed.`);
  }
}

title('Source');
const commit = git('rev-parse', '--verify', `${opt.ref}^{commit}`);
ok(`${opt.ref} is ${git('log', '-1', '--format=%h %s', commit)}`);
const upstream = spawnSync('git', ['-C', mainRoot, 'rev-parse', '--verify', '--quiet', `${opt.ref}@{upstream}`], { encoding: 'utf8' });
if (upstream.status === 0) {
  const [ahead, behind] = git('rev-list', '--left-right', '--count', `${commit}...${upstream.stdout.trim()}`).split(/\s+/).map(Number);
  if (behind) warn(`${opt.ref} is ${behind} commit(s) behind its upstream as of the last fetch. Pull first if those should ship.`);
  if (ahead) warn(`${opt.ref} has ${ahead} commit(s) that are not pushed. The build will contain them.`);
}

const tauriConf = JSON.parse(git('show', `${commit}:src-tauri/tauri.conf.json`));
const version = tauriConf.version;
const bundleId = tauriConf.identifier;
const productName = tauriConf.productName;
const entitlements = plistJson(git('show', `${commit}:src-tauri/Entitlements.plist`));
const teamId = entitlements['com.apple.developer.team-identifier'];
if (!teamId) fail('src-tauri/Entitlements.plist has no team identifier.');
if (entitlements['com.apple.security.app-sandbox'] !== true) fail('src-tauri/Entitlements.plist does not turn on the App Sandbox.');
ok(`${productName} ${version} (${bundleId})`);

title('Tools');
run('xcrun', ['--find', 'altool']);
run('xcrun', ['--find', 'productbuild']);
const targets = run('rustup', ['target', 'list', '--installed']);
for (const t of ['aarch64-apple-darwin', 'x86_64-apple-darwin']) {
  if (!targets.includes(t)) fail(`Rust target ${t} is missing. Run: rustup target add ${t}`);
}
ok('Xcode command line tools and both Rust targets are installed');

title('Signing');
const profilePath = path.join(mainRoot, 'src-tauri', 'embedded.provisionprofile');
if (!fs.existsSync(profilePath)) {
  fail('src-tauri/embedded.provisionprofile is missing. Download the Mac App Store profile from developer.apple.com (Certificates, Identifiers & Profiles) and save it there. Git ignores it.');
}
const profile = readProfile(profilePath);
if (profile.appId !== `${teamId}.${bundleId}`) fail(`The provisioning profile is for ${profile.appId}, not ${teamId}.${bundleId}.`);
if (!profile.forStore) fail('The provisioning profile is a development profile. The App Store needs a Mac App Store distribution profile.');
const daysLeft = Math.floor((Date.parse(profile.expires) - Date.now()) / 86_400_000);
if (daysLeft < 1) fail(`The provisioning profile expired on ${profile.expires.slice(0, 10)}. Make a new one on developer.apple.com.`);
if (daysLeft < 30) warn(`The provisioning profile expires in ${daysLeft} days (${profile.expires.slice(0, 10)}).`);
ok(`Provisioning profile matches the app and is valid until ${profile.expires.slice(0, 10)}`);

// Sign by SHA-1 hash: the same certificate can show up once per keychain, and
// codesign refuses a name that matches more than one identity.
const signingIds = run('security', ['find-identity', '-v', '-p', 'codesigning']);
const signHash = profile.certs.find((hash) => signingIds.includes(hash));
if (!signHash) fail('None of the certificates in the provisioning profile is in your keychain with its private key. Install the "Apple Distribution" certificate the profile was made with.');
const signLine = signingIds.split('\n').find((line) => line.includes(signHash));
if (!/"Apple Distribution: |"3rd Party Mac Developer Application: /.test(signLine)) fail(`The profile's certificate is not an App Store distribution certificate: ${signLine.trim()}`);
ok('Apple Distribution certificate from the profile is in the keychain');

const installerLine = run('security', ['find-identity', '-v'])
  .split('\n')
  .find((line) => /"(3rd Party Mac Developer Installer|Mac Installer Distribution): .*\(/.test(line) && line.includes(`(${teamId})"`));
if (!installerLine) fail(`No "Mac Installer Distribution" certificate for team ${teamId} is in the keychain. Create one on developer.apple.com and install it.`);
const installerHash = installerLine.trim().split(/\s+/)[1];
ok('Mac Installer Distribution certificate is in the keychain');

title('App Store Connect');
const keyDirs = [path.join(os.homedir(), '.appstoreconnect', 'private_keys'), path.join(mainRoot, 'private')];
let keyId = process.env.ASC_KEY_ID;
let keyPath;
if (keyId) {
  keyPath = keyDirs.map((dir) => path.join(dir, `AuthKey_${keyId}.p8`)).find((file) => fs.existsSync(file));
  if (!keyPath) fail(`ASC_KEY_ID is set, but AuthKey_<id>.p8 is not in ${keyDirs.join(' or ')}.`);
} else {
  for (const dir of keyDirs) {
    const name = fs.existsSync(dir) && fs.readdirSync(dir).find((n) => /^AuthKey_[A-Z0-9]+\.p8$/.test(n));
    if (name) { keyPath = path.join(dir, name); keyId = name.slice('AuthKey_'.length, -'.p8'.length); break; }
  }
  if (!keyPath) fail(`No App Store Connect API key (AuthKey_<id>.p8) in ${keyDirs.join(' or ')}.`);
}

let issuer = process.env.ASC_ISSUER_ID;
if (!issuer) {
  const notes = path.join(mainRoot, 'private', 'app-store-connect-values.txt');
  issuer = fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8').match(/^Issuer ID:\s*(\S+)/m)?.[1] : undefined;
  if (!issuer) fail('No issuer ID. Set ASC_ISSUER_ID, or keep it in private/app-store-connect-values.txt on a line starting "Issuer ID:".');
}
ok(`API key ${masked(keyId)} from ${keyPath.startsWith(os.homedir() + '/.appstoreconnect') ? '~/.appstoreconnect/private_keys' : 'private/'}`);

function apiToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuer, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: fs.readFileSync(keyPath), dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${signature.toString('base64url')}`;
}
const token = apiToken();
async function api(route) {
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1/${route}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) fail(`App Store Connect answered ${response.status} for ${route.split('?')[0]}: ${body.errors?.[0]?.detail ?? 'no detail'}`);
  return body;
}

const apps = await api(`apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId,name`);
const app = apps.data.find((a) => a.attributes.bundleId === bundleId);
if (!app) fail(`App Store Connect has no app with bundle ID ${bundleId}.`);
const appId = app.id;

// Once Apple approves a version, uploads with that version number or a lower one are rejected.
const approvedStates = new Set([
  'ACCEPTED', 'PENDING_APPLE_RELEASE', 'PENDING_DEVELOPER_RELEASE', 'PROCESSING_FOR_APP_STORE', 'PROCESSING_FOR_DISTRIBUTION',
  'READY_FOR_SALE', 'READY_FOR_DISTRIBUTION', 'REPLACED_WITH_NEW_VERSION', 'REMOVED_FROM_SALE', 'DEVELOPER_REMOVED_FROM_SALE',
]);
const versions = await api(`apps/${appId}/appStoreVersions?filter[platform]=MAC_OS&fields[appStoreVersions]=versionString,appStoreState,appVersionState&limit=200`);
const approved = versions.data
  .filter((v) => approvedStates.has(v.attributes.appVersionState ?? v.attributes.appStoreState))
  .map((v) => v.attributes.versionString)
  .sort(compareVersions)
  .at(-1);
if (approved && compareVersions(version, approved) <= 0) {
  fail(`Version ${version} is not higher than ${approved}, which Apple already approved. Raise the version in the repo first (scripts/set-version.mjs) and commit it.`);
}
const draft = versions.data.find((v) => v.attributes.versionString === version);
ok(`Latest approved Mac version is ${approved ?? 'none'}; ${version} ${draft ? `already exists in App Store Connect (${draft.attributes.appVersionState ?? draft.attributes.appStoreState})` : 'is new'}`);

const builds = await api(`builds?filter[app]=${appId}&fields[builds]=version&limit=200`);
const highest = Math.max(0, ...builds.data.map((b) => Number(b.attributes.version)).filter(Number.isFinite));
const build = opt.build ?? highest + 1;
if (build <= highest) fail(`Build ${build} is not above ${highest}, the highest build App Store Connect has. macOS needs a higher build number every upload.`);
ok(`Highest uploaded build is ${highest}; this one will be ${version} (${build})`);

const envSource = path.join(mainRoot, '.env.local');
if (fs.existsSync(envSource)) {
  const local = fs.readFileSync(envSource, 'utf8')
    .split('\n')
    .filter((line) => /^NEXT_PUBLIC_\w+=.*(localhost|127\.0\.0\.1)/.test(line))
    .map((line) => line.split('=')[0]);
  if (local.length) warn(`.env.local points ${local.join(', ')} at this computer. The shipped app would try to reach localhost.`);
  else ok('.env.local found (its values are copied into the clean checkout, never printed)');
} else {
  warn('No .env.local in the main checkout. The app builds without sign-in, Discover, translation and the other services it configures.');
}

if (opt.check) {
  console.log(`\nCheck finished. Nothing was built. The next run would build ${commit.slice(0, 7)} as ${version} (${build}).`);
  process.exit(0);
}

// ---------------------------------------------------------------- build

title('Clean checkout');
const out = path.resolve(opt.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'osg-app-store-')));
const source = path.join(out, 'src');
if (fs.existsSync(source)) fail(`${source} already exists. Use another --out, or remove it with: git worktree remove --force "${source}"`);
fs.mkdirSync(out, { recursive: true });
step('git', ['-C', mainRoot, 'worktree', 'add', '--detach', source, commit]);
worktree = source;
if (fs.existsSync(envSource)) fs.copyFileSync(envSource, path.join(source, '.env.local'));
const profileCopy = path.join(source, 'src-tauri', 'embedded.provisionprofile');
fs.copyFileSync(profilePath, profileCopy);
// Apple rejects a bundle with files only the owner can read.
fs.chmodSync(profileCopy, 0o644);
const overlayPath = path.join(source, 'src-tauri', 'tauri.appstore.conf.json');
const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
overlay.bundle.macOS.bundleVersion = String(build);
fs.writeFileSync(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);
ok(`Checked out ${commit.slice(0, 7)} at ${source} with build number ${build}`);

title('npm ci');
step('npm', ['ci', '--no-audit', '--no-fund'], { cwd: source });

title('tauri build (universal, App Store settings)');
const buildEnv = { ...process.env, APPLE_SIGNING_IDENTITY: signHash };
// These would make Tauri notarize, which is for apps sold outside the store.
for (const name of ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD']) {
  delete buildEnv[name];
}
step('npm', ['run', 'tauri:build', '--', '--target', 'universal-apple-darwin', '--config', 'src-tauri/tauri.appstore.conf.json', '--bundles', 'app'], { cwd: source, env: buildEnv });

title('Checks on the .app');
const appPath = path.join(source, 'src-tauri', 'target', 'universal-apple-darwin', 'release', 'bundle', 'macos', `${productName}.app`);
if (!fs.existsSync(appPath)) fail(`The build finished but ${appPath} is missing.`);
run('codesign', ['--verify', '--deep', '--strict', appPath]);
ok('Signature is valid (codesign --verify --deep --strict)');
const signed = plistJson(run('codesign', ['-d', '--entitlements', '-', '--xml', appPath]));
if (signed['com.apple.security.app-sandbox'] !== true) fail('The signed app is not sandboxed.');
if (signed['com.apple.application-identifier'] !== `${teamId}.${bundleId}`) fail('The signed application identifier does not match the profile.');
ok('Sandbox is on and the application identifier matches the profile');
const info = plistJson(fs.readFileSync(path.join(appPath, 'Contents', 'Info.plist')));
if (info.CFBundleShortVersionString !== version || info.CFBundleVersion !== String(build) || info.CFBundleIdentifier !== bundleId) {
  fail(`Info.plist says ${info.CFBundleIdentifier} ${info.CFBundleShortVersionString} (${info.CFBundleVersion}).`);
}
ok(`Info.plist says ${version} (${build})`);
const binary = path.join(appPath, 'Contents', 'MacOS', tauriConf.mainBinaryName ?? 'open-screenshot-generator');
const archs = run('lipo', ['-archs', binary]).trim();
if (!archs.includes('arm64') || !archs.includes('x86_64')) fail(`The binary only has ${archs}.`);
ok(`Binary runs on ${archs}`);
const unreadable = run('find', [appPath, '!', '-perm', '-o=r']).trim();
if (unreadable) fail(`These files are not readable by every user, which Apple rejects:\n${unreadable}`);
const envFiles = run('find', [appPath, '-name', '.env*']).trim();
if (envFiles) fail(`The bundle contains env files:\n${envFiles}`);
ok('Every file is world readable and no .env file is inside');
const privateNames = ['drawsBackground', 'fullScreenEnabled'].filter((name) => fs.readFileSync(binary).includes(name));
if (privateNames.length) warn(`The binary contains private WebKit names (${privateNames.join(', ')}) from wry 0.56+. If review cites non-public API (guideline 2.5.1), this is why.`);

title('Installer package');
const pkg = path.join(out, `${productName}_${version}_${build}.pkg`);
step('xcrun', ['productbuild', '--sign', installerHash, '--component', appPath, '/Applications', pkg]);
const pkgCheck = run('pkgutil', ['--check-signature', pkg]);
if (!/Installer/.test(pkgCheck)) fail(`The package is not signed with the installer certificate:\n${pkgCheck}`);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(pkg)).digest('hex');
ok(`${path.basename(pkg)} is signed`);

title('Apple validation');
const auth = ['--api-key', keyId, '--api-issuer', issuer, '--p8-file-path', keyPath];
step('xcrun', ['altool', '--validate-app', '-f', pkg, '-t', 'macos', ...auth]);
ok('Apple validated the package');

if (opt.upload) {
  title('Upload');
  step('xcrun', [
    'altool', '--upload-package', pkg, '-t', 'macos',
    '--apple-id', appId, '--bundle-id', bundleId, '--bundle-version', String(build), '--bundle-short-version-string', version,
    ...auth, '--wait',
  ]);
  ok(`Uploaded ${version} (${build})`);
}

if (!opt.keepSource) {
  step('git', ['-C', mainRoot, 'worktree', 'remove', '--force', source]);
  worktree = null;
}

console.log(`
Done.
  Commit:   ${commit.slice(0, 7)} (${opt.ref})
  Version:  ${version} (${build})
  Package:  ${pkg}
  SHA-256:  ${sha256}
  Uploaded: ${opt.upload ? 'yes' : 'no, validated only. Run again with --upload, or drag the .pkg into Transporter.'}${worktree ? `\n  Source:   ${worktree} (remove with: git worktree remove --force "${worktree}")` : ''}`);
