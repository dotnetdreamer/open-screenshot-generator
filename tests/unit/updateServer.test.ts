// The desktop update server in infra/vps/update-server: the admin API CI
// publishes through, what the Tauri updater's check answers each kind of
// install, and the route the installers download from. One server for the
// whole file, on a free port with its data in a scratch folder, so the tests
// run in order, each from where the last left it.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createUpdateServer } from '../../infra/vps/update-server/src/server.js';

type UpdateServer = ReturnType<typeof createUpdateServer>;
type Stats = {
  since: string;
  checks: { channel: string; platform: string; current: string; count: number }[];
  offered: Record<string, number>;
};

const TOKEN = crypto.randomBytes(20).toString('hex');
const PUBLIC_URL = 'https://updates.example.test';

/** Stand-ins for installers. The server only cares about their bytes. */
const NSIS = 'pretend NSIS installer, 1.0.7 for x86_64';
const MSI = 'pretend MSI installer, 1.0.7 for x86_64, a few bytes longer';
const RC_NSIS = 'pretend NSIS installer, 1.0.7-rc.1 for x86_64';
const BETA_NSIS = 'pretend NSIS installer, 1.1.0-beta.1 for x86_64';

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
/** What a Tauri .sig file holds, in base64 the way a manifest carries it. */
const signature = (file: string) =>
  Buffer.from(`untrusted comment: signature from tauri secret key\nRUQ${file}\ntrusted comment: timestamp:1\n`).toString(
    'base64'
  );
const artifact = (file: string, bytes: string) => ({
  file,
  signature: signature(file),
  size: Buffer.byteLength(bytes),
  sha256: sha256(bytes),
});

const MANIFEST = {
  version: '1.0.7',
  pubDate: '2026-11-07T12:00:00Z',
  notes: 'Faster exports',
  downloadPage: 'https://example.com/download',
  artifacts: {
    'windows-x86_64-nsis': artifact('app-setup.exe', NSIS),
    'windows-x86_64-msi': artifact('app.msi', MSI),
  },
};

let dataDir = '';
let base = '';
let updates: UpdateServer;

async function start(options: { dataDir: string; adminToken?: string; maxUploadBytes?: number }) {
  const instance = createUpdateServer({ publicUrl: PUBLIC_URL, log: () => {}, ...options });
  await instance.ready;
  await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const { port } = instance.server.address() as AddressInfo;
  return { instance, url: `http://127.0.0.1:${port}` };
}

async function stop(instance: UpdateServer) {
  const closed = new Promise((resolve) => instance.server.close(resolve));
  instance.server.closeAllConnections();
  await closed;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-updates-'));
  const started = await start({ dataDir, adminToken: TOKEN, maxUploadBytes: 64 * 1024 });
  updates = started.instance;
  base = started.url;
});

after(async () => {
  await stop(updates);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const bearer = { Authorization: `Bearer ${TOKEN}` };

/** An admin request with the right token, and the JSON it answered. */
async function admin(method: string, route: string, body?: unknown) {
  const response = await fetch(base + route, {
    method,
    headers: { ...bearer, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

function upload(version: string, file: string, bytes: string, hash = sha256(bytes)) {
  return fetch(`${base}/v1/admin/releases/${version}/files/${file}`, {
    method: 'PUT',
    headers: { ...bearer, 'X-Content-SHA256': hash },
    body: bytes,
  });
}

function check(route: string) {
  return fetch(`${base}/v1/desktop/${route}`);
}

/** The status a request got, with its body read so the connection is free again. */
async function statusOf(pending: Promise<Response>) {
  const response = await pending;
  await response.arrayBuffer();
  return response.status;
}

/** A PUT built by hand, for what fetch will not send: no Content-Length, or one with no body behind it. */
function rawPut(route: string, headers: Record<string, string>, body?: string) {
  return new Promise<number>((resolve, reject) => {
    const request = http.request(`${base}${route}`, { method: 'PUT', headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function history() {
  const text = fs.readFileSync(path.join(dataDir, 'channels', 'history.jsonl'), 'utf8');
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

test('without a token of at least 32 characters the admin API is not there at all', async () => {
  for (const adminToken of [undefined, 'x'.repeat(31)]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-updates-off-'));
    const { instance, url } = await start({ dataDir: dir, adminToken });
    try {
      assert.equal(instance.adminEnabled, false);
      const headers = { Authorization: `Bearer ${adminToken ?? TOKEN}` };
      assert.equal(await statusOf(fetch(`${url}/v1/admin/releases`, { headers })), 404);
      assert.equal(await statusOf(fetch(`${url}/v1/admin/stats`, { headers })), 404);
      const put = { method: 'PUT', headers, body: '{"version":"1.0.0"}' };
      assert.equal(await statusOf(fetch(`${url}/v1/admin/channels/stable`, put)), 404);
      const health = await fetch(`${url}/healthz`);
      assert.deepEqual(await health.json(), { ok: true, channels: { stable: null, beta: null } });
    } finally {
      await stop(instance);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  assert.equal(updates.adminEnabled, true);
});

test('a wrong or missing token is a 401', async () => {
  const route = `${base}/v1/admin/channels`;
  assert.equal(await statusOf(fetch(route)), 401);
  assert.equal(await statusOf(fetch(route, { headers: { Authorization: `Bearer ${'w'.repeat(40)}` } })), 401);
  assert.equal(await statusOf(fetch(route, { headers: { Authorization: `Bearer ${TOKEN.slice(0, -1)}` } })), 401);
  assert.equal(await statusOf(fetch(route, { headers: { Authorization: `Basic ${TOKEN}` } })), 401);
  const wrongUpload = fetch(`${base}/v1/admin/releases/1.0.7/files/app-setup.exe`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${'w'.repeat(40)}`, 'X-Content-SHA256': sha256(NSIS) },
    body: NSIS,
  });
  assert.equal(await statusOf(wrongUpload), 401);
  const right = await admin('GET', '/v1/admin/channels');
  assert.equal(right.status, 200);
  assert.deepEqual(right.body, { stable: null, beta: null });
});

test('an upload that does not match its sha256 is refused and leaves nothing behind', async () => {
  assert.equal(await statusOf(upload('1.0.7', 'app-setup.exe', NSIS, sha256('something else'))), 400);
  assert.equal(fs.existsSync(path.join(dataDir, 'releases', '1.0.7')), false);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'tmp')), []);

  // The hash header is required, in lowercase hex, and so is a length.
  assert.equal(await statusOf(upload('1.0.7', 'app-setup.exe', NSIS, sha256(NSIS).toUpperCase())), 400);
  const route = '/v1/admin/releases/1.0.7/files/app-setup.exe';
  assert.equal(await rawPut(route, { ...bearer, 'Content-Length': String(NSIS.length) }, NSIS), 400);
  assert.equal(await rawPut(route, { ...bearer, 'X-Content-SHA256': sha256(NSIS) }, NSIS), 411);
  const tooLarge = { ...bearer, 'X-Content-SHA256': sha256(NSIS), 'Content-Length': String(65 * 1024) };
  assert.equal(await rawPut(route, tooLarge), 413);

  // Names that would leave the release folder or stand in for its manifest.
  for (const name of ['manifest.json', '..%2Fescape.exe', 'a%2Fb.exe', '.hidden']) {
    assert.equal(await statusOf(upload('1.0.7', name, NSIS)), 400, name);
  }
  assert.equal(await statusOf(upload('not-a-version', 'app-setup.exe', NSIS)), 400);
  assert.equal(fs.existsSync(path.join(dataDir, 'releases', '1.0.7')), false);
});

test('CI uploads the files, publishes the manifest and points stable at it', async () => {
  const first = await upload('1.0.7', 'app-setup.exe', NSIS);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { file: 'app-setup.exe', size: NSIS.length, sha256: sha256(NSIS) });
  // A retry of the same upload is harmless.
  assert.equal(await statusOf(upload('1.0.7', 'app-setup.exe', NSIS)), 200);
  assert.equal(await statusOf(upload('1.0.7', 'app.msi', MSI)), 201);
  assert.equal(await statusOf(upload('1.0.7', 'extra.txt', 'on disk, in no manifest')), 201);

  // Not published yet, so no channel may point at it.
  assert.equal((await admin('PUT', '/v1/admin/channels/stable', { version: '1.0.7' })).status, 400);

  // The manifest is checked against what is on disk, and on its own.
  const route = '/v1/admin/releases/1.0.7';
  const wrongHash = { ...MANIFEST, artifacts: { ...MANIFEST.artifacts, 'windows-x86_64-msi': artifact('app.msi', 'other bytes') } };
  assert.equal((await admin('PUT', route, wrongHash)).status, 400);
  const neverUploaded = { ...MANIFEST, artifacts: { 'linux-x86_64-appimage': artifact('app.AppImage', 'not here') } };
  assert.equal((await admin('PUT', route, neverUploaded)).status, 400);
  const unsigned = {
    ...MANIFEST,
    artifacts: { 'windows-x86_64-nsis': { ...artifact('app-setup.exe', NSIS), signature: btoa('no comment line') } },
  };
  assert.equal((await admin('PUT', route, unsigned)).status, 400);
  assert.equal((await admin('PUT', route, { ...MANIFEST, version: '1.0.8' })).status, 400);
  assert.equal((await admin('PUT', route, { ...MANIFEST, pubDate: 'soon' })).status, 400);
  assert.equal((await admin('PUT', route, { ...MANIFEST, downloadPage: 'http://example.com' })).status, 400);
  assert.equal((await admin('PUT', route, { ...MANIFEST, note: 'misspelt' })).status, 400);
  assert.equal(fs.existsSync(path.join(dataDir, 'releases', '1.0.7', 'manifest.json')), false);

  const published = await admin('PUT', route, MANIFEST);
  assert.equal(published.status, 201);
  assert.equal(published.body.pubDate, '2026-11-07T12:00:00.000Z');
  assert.equal(published.body.critical, false);
  assert.deepEqual(Object.keys(published.body.artifacts), ['windows-x86_64-msi', 'windows-x86_64-nsis']);

  const pointed = await admin('PUT', '/v1/admin/channels/stable', { version: '1.0.7' });
  assert.equal(pointed.status, 200);
  const { updatedAt, ...pointer } = pointed.body;
  assert.deepEqual(pointer, { version: '1.0.7', rollout: 100, paused: false });
  assert.ok(!Number.isNaN(Date.parse(updatedAt)));
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true, channels: { stable: '1.0.7', beta: null } });
  assert.deepEqual((await admin('GET', '/v1/admin/channels')).body, { stable: pointed.body, beta: null });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'channels', 'stable.json'), 'utf8')), pointed.body);
  assert.deepEqual(history(), [{ at: updatedAt, channel: 'stable', from: null, to: pointed.body }]);
});

test('the check offers exactly the bundle the install came from, and nothing for one the release lacks', async () => {
  const msi = await check('windows/x86_64/msi/1.0.6');
  assert.equal(msi.status, 200);
  assert.equal(msi.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await msi.json(), {
    version: '1.0.7',
    pub_date: '2026-11-07T12:00:00.000Z',
    notes: 'Faster exports',
    url: `${PUBLIC_URL}/v1/files/1.0.7/app.msi`,
    signature: signature('app.msi'),
    size: Buffer.byteLength(MSI),
    sha256: sha256(MSI),
    critical: false,
    channel: 'stable',
    download_page: 'https://example.com/download',
  });

  const nsis = await (await check('windows/x86_64/nsis/1.0.6')).json();
  assert.equal(nsis.url, `${PUBLIC_URL}/v1/files/1.0.7/app-setup.exe`);
  assert.equal(nsis.signature, signature('app-setup.exe'));

  for (const route of ['linux/x86_64/appimage/1.0.6', 'windows/aarch64/nsis/1.0.6', 'darwin/aarch64/unknown/1.0.6']) {
    const lacking = await check(route);
    assert.equal(lacking.status, 204, route);
    assert.equal(lacking.headers.get('cache-control'), 'no-store');
    await lacking.arrayBuffer();
  }
});

test('an install that cannot name its bundle gets the NSIS installer on Windows', async () => {
  const response = await check('windows/x86_64/unknown/1.0.6');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, `${PUBLIC_URL}/v1/files/1.0.7/app-setup.exe`);
});

test('an install on the latest version or past it is offered nothing', async () => {
  for (const current of ['1.0.7', 'v1.0.7', '1.0.8', '1.0.10', '2.0.0-beta.1']) {
    assert.equal(await statusOf(check(`windows/x86_64/nsis/${current}`)), 204, current);
  }
  // Older ones are, prereleases of 1.0.7 included, however the version arrives.
  for (const current of ['v1.0.6', '1.0.7-rc.1', '1.0.7%2Drc.2', '%31.0.6']) {
    assert.equal(await statusOf(check(`windows/x86_64/nsis/${current}`)), 200, current);
  }
});

test('a check with a parameter it cannot use is a 400', async () => {
  for (const route of [
    'macos/x86_64/app/1.0.6',
    'windows/x64/nsis/1.0.6',
    'windows/x86_64/exe/1.0.6',
    'windows/x86_64/nsis/1.0',
    'windows/x86_64/nsis/1.0.6.1',
    'windows/x86_64/nsis/1.0.6?channel=nightly',
    'windows/x86_64/nsis/1.0.6?channel=',
    'windows/x86_64/nsis/1.0.6?bucket=100',
    'windows/x86_64/nsis/1.0.6?bucket=-1',
    'windows/x86_64/nsis/1.0.6?bucket=4.5',
  ]) {
    const response = await check(route);
    assert.equal(response.status, 400, route);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('a rollout reaches the buckets below it, and a paused pointer reaches nobody', async () => {
  const moved = await admin('PUT', '/v1/admin/channels/stable', { rollout: 10 });
  assert.equal(moved.status, 200);
  assert.deepEqual([moved.body.version, moved.body.rollout, moved.body.paused], ['1.0.7', 10, false]);
  assert.equal(await statusOf(check('windows/x86_64/nsis/1.0.6?bucket=0')), 200);
  assert.equal(await statusOf(check('windows/x86_64/nsis/1.0.6?bucket=9')), 200);
  assert.equal(await statusOf(check('windows/x86_64/nsis/1.0.6?bucket=10')), 204);
  // No bucket counts as 99, so that install waits for everybody.
  assert.equal(await statusOf(check('windows/x86_64/nsis/1.0.6')), 204);

  assert.equal((await admin('PUT', '/v1/admin/channels/stable', { rollout: 100, paused: true })).status, 200);
  assert.equal(await statusOf(check('windows/x86_64/nsis/1.0.6?bucket=0')), 204);
  assert.equal((await admin('PUT', '/v1/admin/channels/stable', { paused: false })).status, 200);
  assert.equal(await statusOf(check('windows/x86_64/nsis/1.0.6')), 200);

  // Refused rather than ignored, and none of them moves anything.
  assert.equal((await admin('PUT', '/v1/admin/channels/stable', { rolout: 5 })).status, 400);
  assert.equal((await admin('PUT', '/v1/admin/channels/stable', { rollout: 101 })).status, 400);
  assert.equal((await admin('PUT', '/v1/admin/channels/stable', { paused: 'yes' })).status, 400);
  assert.equal((await admin('PUT', '/v1/admin/channels/nightly', { version: '1.0.7' })).status, 400);
  // Setting what is already set changes nothing either.
  const unchanged = await admin('PUT', '/v1/admin/channels/stable', { version: '1.0.7', rollout: 100 });
  assert.equal(unchanged.status, 200);
  assert.deepEqual(
    history().map((line) => [line.to.rollout, line.to.paused]),
    [
      [100, false],
      [10, false],
      [100, true],
      [100, false],
    ]
  );
  assert.equal(history().at(-1).to.updatedAt, unchanged.body.updatedAt);
});

test('a beta install gets whichever of the beta and stable pointers is newer', async () => {
  assert.equal(await statusOf(upload('1.0.7-rc.1', 'app-setup.exe', RC_NSIS)), 201);
  const rc = {
    version: '1.0.7-rc.1',
    pubDate: '2026-11-01T10:00:00Z',
    artifacts: { 'windows-x86_64-nsis': artifact('app-setup.exe', RC_NSIS) },
  };
  assert.equal((await admin('PUT', '/v1/admin/releases/1.0.7-rc.1', rc)).status, 201);
  assert.equal((await admin('PUT', '/v1/admin/channels/beta', { version: '1.0.7-rc.1' })).status, 200);
  // Beta behind stable: a beta install still gets stable.
  const behind = await (await check('windows/x86_64/nsis/1.0.6?channel=beta')).json();
  assert.deepEqual([behind.version, behind.channel], ['1.0.7', 'stable']);

  assert.equal(await statusOf(upload('1.1.0-beta.1', 'app-setup.exe', BETA_NSIS)), 201);
  const beta = {
    version: '1.1.0-beta.1',
    pubDate: '2026-11-08T09:30:00+01:00',
    critical: true,
    artifacts: { 'windows-x86_64-nsis': artifact('app-setup.exe', BETA_NSIS) },
  };
  const published = await admin('PUT', '/v1/admin/releases/1.1.0-beta.1', beta);
  assert.equal(published.status, 201);
  assert.equal(published.body.pubDate, '2026-11-08T08:30:00.000Z');
  assert.equal(published.body.downloadPage, null);
  assert.equal((await admin('PUT', '/v1/admin/channels/beta', { version: '1.1.0-beta.1' })).status, 200);

  // Beta ahead of stable: a beta install gets beta, a stable install never sees it.
  const ahead = await (await check('windows/x86_64/nsis/1.0.6?channel=beta')).json();
  assert.equal(ahead.version, '1.1.0-beta.1');
  assert.equal(ahead.channel, 'beta');
  assert.equal(ahead.critical, true);
  assert.equal(ahead.url, `${PUBLIC_URL}/v1/files/1.1.0-beta.1/app-setup.exe`);
  assert.equal('notes' in ahead, false);
  assert.equal(ahead.download_page, null);
  assert.equal((await (await check('windows/x86_64/nsis/1.0.6')).json()).version, '1.0.7');

  // Paused, the beta pointer drops out, and stable is what is left.
  assert.equal((await admin('PUT', '/v1/admin/channels/beta', { paused: true })).status, 200);
  const paused = await (await check('windows/x86_64/nsis/1.0.6?channel=beta')).json();
  assert.deepEqual([paused.version, paused.channel], ['1.0.7', 'stable']);
  assert.equal((await admin('PUT', '/v1/admin/channels/beta', { paused: false })).status, 200);
});

test('a published release never changes', async () => {
  assert.equal(await statusOf(upload('1.0.7', 'app-setup.exe', 'a rebuilt installer')), 409);
  assert.equal(await statusOf(upload('1.0.7', 'late-file.exe', NSIS)), 409);
  // The same bytes again are fine, so CI can retry any step.
  assert.equal(await statusOf(upload('1.0.7', 'app-setup.exe', NSIS)), 200);
  assert.equal((await admin('PUT', '/v1/admin/releases/1.0.7', { ...MANIFEST, notes: 'Something else' })).status, 409);
  const again = await admin('PUT', '/v1/admin/releases/1.0.7', MANIFEST);
  assert.equal(again.status, 200);
  assert.equal(again.body.notes, 'Faster exports');

  assert.equal(fs.readFileSync(path.join(dataDir, 'releases', '1.0.7', 'app-setup.exe'), 'utf8'), NSIS);
  assert.equal(fs.existsSync(path.join(dataDir, 'releases', '1.0.7', 'late-file.exe')), false);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'tmp')), []);
});

test('a listed file downloads whole or by range, and nothing else downloads', async () => {
  const route = `${base}/v1/files/1.0.7/app.msi`;
  const whole = await fetch(route);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'application/octet-stream');
  assert.equal(whole.headers.get('content-length'), String(MSI.length));
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(whole.headers.get('etag'), `"${sha256(MSI)}"`);
  assert.equal(whole.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(whole.headers.get('content-disposition'), 'attachment; filename="app.msi"');
  assert.equal(whole.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await whole.text(), MSI);

  const last = MSI.length - 1;
  const ranges: [string, number, number][] = [
    ['bytes=4-12', 4, 12],
    [`bytes=${last - 2}-`, last - 2, last],
    ['bytes=-6', last - 5, last],
    [`bytes=10-${last + 50}`, 10, last],
  ];
  for (const [range, start, end] of ranges) {
    const part = await fetch(route, { headers: { Range: range } });
    assert.equal(part.status, 206, range);
    assert.equal(part.headers.get('content-range'), `bytes ${start}-${end}/${MSI.length}`);
    assert.equal(part.headers.get('content-length'), String(end - start + 1));
    assert.equal(await part.text(), MSI.slice(start, end + 1));
  }

  const past = await fetch(route, { headers: { Range: `bytes=${MSI.length}-` } });
  assert.equal(past.status, 416);
  assert.equal(past.headers.get('content-range'), `bytes */${MSI.length}`);
  await past.arrayBuffer();

  const head = await fetch(route, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(MSI.length));
  assert.equal(await head.text(), '');

  // On disk but in no manifest, not on disk, no such release, the manifest itself.
  for (const missing of ['1.0.7/extra.txt', '1.0.7/nothing.exe', '1.0.6/app.msi', '1.0.7/manifest.json']) {
    assert.equal(await statusOf(fetch(`${base}/v1/files/${missing}`)), 404, missing);
  }
});

test('the release list is newest first and shows folders not yet published', async () => {
  assert.equal(await statusOf(upload('1.2.0', 'app-setup.exe', NSIS)), 201);
  const listed = await admin('GET', '/v1/admin/releases');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, [
    { version: '1.2.0', published: false, pubDate: null, critical: null, artifacts: [] },
    {
      version: '1.1.0-beta.1',
      published: true,
      pubDate: '2026-11-08T08:30:00.000Z',
      critical: true,
      artifacts: ['windows-x86_64-nsis'],
    },
    {
      version: '1.0.7',
      published: true,
      pubDate: '2026-11-07T12:00:00.000Z',
      critical: false,
      artifacts: ['windows-x86_64-msi', 'windows-x86_64-nsis'],
    },
    {
      version: '1.0.7-rc.1',
      published: true,
      pubDate: '2026-11-01T10:00:00.000Z',
      critical: false,
      artifacts: ['windows-x86_64-nsis'],
    },
  ]);
});

test('stats count each check by channel, platform and version, and each offer by version', async () => {
  const earlier = (await admin('GET', '/v1/admin/stats')).body as Stats;
  for (let i = 0; i < 3; i += 1) assert.equal(await statusOf(check('linux/aarch64/deb/1.0.1')), 204);
  assert.equal(await statusOf(check('windows/x86_64/nsis/v1.0.5?channel=beta&bucket=3')), 200);

  const later = (await admin('GET', '/v1/admin/stats')).body as Stats;
  assert.equal(later.since, earlier.since);
  assert.ok(!Number.isNaN(Date.parse(later.since)));
  const linux = later.checks.find((row) => row.platform === 'linux-aarch64-deb');
  assert.deepEqual(linux, { channel: 'stable', platform: 'linux-aarch64-deb', current: '1.0.1', count: 3 });
  const beta = later.checks.find((row) => row.channel === 'beta' && row.current === '1.0.5');
  assert.deepEqual(beta, { channel: 'beta', platform: 'windows-x86_64-nsis', current: '1.0.5', count: 1 });
  assert.equal(later.offered['1.1.0-beta.1'], (earlier.offered['1.1.0-beta.1'] ?? 0) + 1);
  assert.ok(later.offered['1.0.7'] > 0);
  // The checks from the tests before this one were counted too, largest first.
  assert.ok(later.checks.some((row) => row.platform === 'windows-x86_64-msi' && row.current === '1.0.6'));
  const counts = later.checks.map((row) => row.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
});

test('an unknown route is a 404, and a wrong method a 405 that names the right ones', async () => {
  const unknown = await fetch(`${base}/v2/desktop`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'not found' });
  const wrong = await fetch(`${base}/v1/files/1.0.7/app.msi`, { method: 'DELETE' });
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'GET, HEAD');
  await wrong.arrayBuffer();
  const wrongAdmin = await admin('POST', '/v1/admin/channels/stable', {});
  assert.equal(wrongAdmin.status, 405);
  assert.equal(wrongAdmin.headers.get('allow'), 'PUT');
});

test('a restart reads the releases and pointers back from disk', async () => {
  const { instance, url } = await start({ dataDir, adminToken: TOKEN });
  try {
    for (const route of ['/v1/admin/channels', '/v1/admin/releases']) {
      const reread = await (await fetch(url + route, { headers: bearer })).json();
      assert.deepEqual(reread, (await admin('GET', route)).body, route);
    }
    const offer = await (await fetch(`${url}/v1/desktop/windows/x86_64/msi/1.0.6`)).json();
    assert.equal(offer.url, `${PUBLIC_URL}/v1/files/1.0.7/app.msi`);
  } finally {
    await stop(instance);
  }
});
