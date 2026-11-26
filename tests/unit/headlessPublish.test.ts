// window.__osg.publish, the page half of `osg upload` (src/lib/headless/publish.ts).
// It routes the CLI's calls to the store clients the upload dialog uses, here
// against a fake Google and a fake Apple answering window.fetch, which is the
// fetch the CLI swaps for node's socket. A dry run plans with nothing sent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { installHeadlessBridge, type HeadlessBridge, type HeadlessHost } from '@/lib/headless/bridge';
import type { HeadlessPublishResponse, HeadlessStagedImage } from '@/lib/headless/publish';
import { localeForAppleLocale, localeForPlayLanguage } from '@/lib/publish/storeTargets';

const PACKAGE = 'com.example.pebble';
const RSA = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const EC = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PLAY_KEY = {
  packageName: PACKAGE,
  serviceAccountJson: JSON.stringify({
    type: 'service_account',
    client_email: 'cli@example.iam.gserviceaccount.com',
    private_key: RSA,
    token_uri: 'https://oauth2.googleapis.com/token',
  }),
};
const APPLE_KEY = { issuerId: '6a5d4c3b-2a19-4f08-9e7d-6c5b4a392817', keyId: 'ABC1234567', privateKey: EC };
const PLAY_API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const PLAY_UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

interface Call {
  method: string;
  url: string;
  auth: string | null;
  bytes: number;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

const host = (): HeadlessHost => ({
  getMcpApi: () => null,
  exportImages: async () => [],
  exportVideo: async () => [],
  capture: async () => [],
  loadProject: async () => true,
  getStatus: () => ({ projectId: 'p1', projectName: 'Publish', artboards: [], locales: [], baseLocale: null, activeArtboardId: null }),
});

/** The bridge in a page whose window.fetch is `route`, after Google's token step. */
function page(route: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const root = globalThis as { window?: unknown };
  const fetch = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const body = init.body;
    const bytes = typeof body === 'string' ? body.length : body instanceof Uint8Array ? body.length : 0;
    if (url === 'https://oauth2.googleapis.com/token') {
      return json({ access_token: 'google-token', expires_in: 3600 });
    }
    const call = { method: init.method ?? 'GET', url, auth: headers.get('authorization'), bytes };
    calls.push(call);
    return route(call);
  };
  root.window = { __OSG_HEADLESS: true, fetch };
  const remove = installHeadlessBridge(host());
  const bridge = (root.window as { __osg?: HeadlessBridge }).__osg;
  assert.ok(bridge, 'the bridge installs');
  return {
    publish: (request: Parameters<HeadlessBridge['publish']>[0]) => bridge.publish(request),
    calls,
    done: () => {
      remove();
      delete root.window;
    },
  };
}

let next = 0;
function image(width: number, height: number, locale: string | null = null, name = `shot-${++next}`): HeadlessStagedImage {
  return { artboardId: name, fileName: `${name}.png`, base64: Buffer.from(`png ${name}`).toString('base64'), width, height, locale };
}

const nothing = () => json({ error: { message: 'no call was expected' } }, 500);

test('the bridge has publish, staged images wait for the upload, and a store call needs a key', async () => {
  const run = page(nothing);
  try {
    assert.deepEqual(await run.publish({ store: 'play', action: 'stage', credentials: null, images: [image(1080, 1920)] }), { ok: true, data: null });
    const plan = (await run.publish({ store: 'play', action: 'upload', credentials: PLAY_KEY, entries: [{ locale: null, language: 'en-US' }], dryRun: true })) as HeadlessPublishResponse & { data: { plan: Array<{ count: number }> } };
    assert.equal(plan.ok, true, plan.error);
    assert.equal(plan.data.plan[0].count, 1);

    assert.deepEqual(await run.publish({ store: 'play', action: 'clear', credentials: null }), { ok: true, data: null });
    const empty = await run.publish({ store: 'play', action: 'upload', credentials: PLAY_KEY, entries: [{ locale: null, language: 'en-US' }], dryRun: true });
    assert.equal(empty.ok, false);
    assert.equal(empty.kind, 'rejected', 'nothing staged is nothing Play takes');

    const keyless = await run.publish({ store: 'play', action: 'languages', credentials: null });
    assert.equal(keyless.ok, false);
    assert.match(keyless.error ?? '', /needs the store key/);
    assert.equal(run.calls.length, 0, 'nothing reached a store');
  } finally {
    run.done();
  }
});

test('Play: the listing languages come back with the project code, read through an edit that is deleted', async () => {
  const run = page(({ method, url }) => {
    if (method === 'POST' && url === `${PLAY_API}/edits`) return json({ id: 'edit-1' });
    if (method === 'GET' && url === `${PLAY_API}/edits/edit-1/listings`) return json({ listings: [{ language: 'en-US', title: 'Pebble' }, { language: 'de-DE', title: 'Pebble' }] });
    if (method === 'DELETE' && url === `${PLAY_API}/edits/edit-1`) return json({});
    return nothing();
  });
  try {
    const answer = await run.publish({ store: 'play', action: 'languages', credentials: PLAY_KEY });
    assert.equal(answer.ok, true, answer.error);
    assert.deepEqual(answer.data, [
      { language: 'de-DE', title: 'Pebble', code: localeForPlayLanguage('de-DE') },
      { language: 'en-US', title: 'Pebble', code: localeForPlayLanguage('en-US') },
    ]);
    assert.equal(run.calls.at(-1)?.method, 'DELETE', 'the edit is deleted');
    assert.ok(run.calls.every((call) => call.auth === 'Bearer google-token'));
  } finally {
    run.done();
  }
});

test('Play dry run: each image in the slot the dialog starts it in, a foldable left out with the reason, nothing sent', async () => {
  const run = page(nothing);
  try {
    const images = [image(1080, 1920, null, 'portrait'), image(1920, 1080, null, 'landscape'), image(2560, 1600, null, 'tablet'), image(2106, 2106, null, 'fold')];
    await run.publish({ store: 'play', action: 'stage', credentials: null, images });
    const answer = await run.publish({ store: 'play', action: 'upload', credentials: PLAY_KEY, entries: [{ locale: null, language: 'en-US' }], dryRun: true });
    assert.equal(answer.ok, true, answer.error);
    assert.deepEqual(answer.data, {
      plan: [
        { label: 'en-US', target: 'Phone screenshots', count: 2, files: ['portrait.png', 'landscape.png'] },
        { label: 'en-US', target: '10-inch tablet screenshots', count: 1, files: ['tablet.png'] },
      ],
      warnings: ['fold.png skipped: Google Play takes foldable screenshots only in Play Console. Add them there, under Foldable screenshots'],
    });
    assert.equal(run.calls.length, 0);

    // A slot given more than it keeps is refused before anything is sent.
    await run.publish({ store: 'play', action: 'stage', credentials: null, images: Array.from({ length: 7 }, () => image(1080, 1920)) });
    const full = await run.publish({ store: 'play', action: 'upload', credentials: PLAY_KEY, entries: [{ locale: null, language: 'en-US' }], dryRun: true });
    assert.equal(full.kind, 'rejected');
    assert.equal(full.error, 'Play keeps at most 8 images in Phone screenshots. Select fewer.');
  } finally {
    run.done();
  }
});

test('Play upload: one edit for every language and slot, each slot cleared first with replace, then validated and committed', async () => {
  const run = page(({ method, url }) => {
    if (method === 'POST' && url === `${PLAY_API}/edits`) return json({ id: 'edit-9' });
    if (method === 'DELETE' && url.startsWith(`${PLAY_API}/edits/edit-9/listings/`)) return json({});
    if (method === 'POST' && url.startsWith(`${PLAY_UPLOAD}/edits/edit-9/listings/`)) return json({ image: { id: 'x' } });
    if (method === 'POST' && url === `${PLAY_API}/edits/edit-9:validate`) return json({ id: 'edit-9' });
    if (method === 'POST' && url === `${PLAY_API}/edits/edit-9:commit`) return json({ id: 'edit-9' });
    return nothing();
  });
  try {
    const images = [image(1080, 2400, 'en', 'en-1'), image(2400, 1080, 'en', 'en-2'), image(1080, 2400, 'de', 'de-1'), image(1080, 2400, 'de', 'de-2')];
    await run.publish({ store: 'play', action: 'stage', credentials: null, images });
    const answer = await run.publish({
      store: 'play',
      action: 'upload',
      credentials: PLAY_KEY,
      entries: [{ locale: 'en', language: 'en-US' }, { locale: 'de', language: 'de-DE' }],
      replaceExisting: true,
    });
    assert.equal(answer.ok, true, answer.error);
    assert.deepEqual(answer.data, { uploaded: 4, warnings: [], reviewUrl: 'https://play.google.com/console' });
    const path = (call: Call) => `${call.method} ${call.url.replace(PLAY_UPLOAD, 'upload:').replace(PLAY_API, '')}`;
    assert.deepEqual(run.calls.map(path), [
      'POST /edits',
      'DELETE /edits/edit-9/listings/en-US/phoneScreenshots',
      'POST upload:/edits/edit-9/listings/en-US/phoneScreenshots?uploadType=media',
      'POST upload:/edits/edit-9/listings/en-US/phoneScreenshots?uploadType=media',
      'DELETE /edits/edit-9/listings/de-DE/phoneScreenshots',
      'POST upload:/edits/edit-9/listings/de-DE/phoneScreenshots?uploadType=media',
      'POST upload:/edits/edit-9/listings/de-DE/phoneScreenshots?uploadType=media',
      'POST /edits/edit-9:validate',
      'POST /edits/edit-9:commit',
    ]);
    assert.ok(run.calls.filter((call) => call.url.includes('uploadType=media')).every((call) => call.bytes > 0), 'the image bytes are sent');
  } finally {
    run.done();
  }
});

test('Play: a service account Google turns away is an auth failure, which the CLI sends back to the key', async () => {
  const run = page(({ method, url }) => {
    if (method === 'POST' && url === `${PLAY_API}/edits`) return json({ error: { message: 'The caller does not have permission' } }, 403);
    return nothing();
  });
  try {
    const answer = await run.publish({ store: 'play', action: 'languages', credentials: PLAY_KEY });
    assert.equal(answer.ok, false);
    assert.equal(answer.kind, 'auth');
    assert.match(answer.error ?? '', /^The caller does not have permission \(HTTP 403\)/);
  } finally {
    run.done();
  }
});

const APPLE = 'https://api.appstoreconnect.apple.com';

test('App Store: the apps, versions and localizations come back as the CLI reads them, signed with the key', async () => {
  const run = page(({ method, url }) => {
    if (method !== 'GET') return nothing();
    if (url === `${APPLE}/v1/apps?limit=200&fields[apps]=name,bundleId`) {
      return json({ data: [{ id: '42', type: 'apps', attributes: { name: 'Pebble', bundleId: 'com.example.pebble' } }] });
    }
    if (url === `${APPLE}/v1/apps/42/appStoreVersions?limit=50`) {
      return json({ data: [{ id: 'v2', type: 'appStoreVersions', attributes: { versionString: '2.0', appStoreState: 'PREPARE_FOR_SUBMISSION', platform: 'IOS' } }] });
    }
    if (url.startsWith(`${APPLE}/v1/appStoreVersions/v2/appStoreVersionLocalizations?`)) {
      return json({ data: [{ id: 'loc-en', type: 'appStoreVersionLocalizations', attributes: { locale: 'en-US' } }, { id: 'loc-de', type: 'appStoreVersionLocalizations', attributes: { locale: 'de-DE' } }] });
    }
    return nothing();
  });
  try {
    const apps = await run.publish({ store: 'appstore', action: 'apps', credentials: APPLE_KEY });
    assert.deepEqual(apps.data, [{ id: '42', name: 'Pebble', bundleId: 'com.example.pebble' }]);
    const versions = (await run.publish({ store: 'appstore', action: 'versions', credentials: APPLE_KEY, appId: '42' })) as { data: Array<{ id: string; editable: boolean }> };
    assert.equal(versions.data[0].id, 'v2');
    assert.equal(versions.data[0].editable, true);
    const localizations = await run.publish({ store: 'appstore', action: 'localizations', credentials: APPLE_KEY, versionId: 'v2' });
    assert.deepEqual(localizations.data, [
      { id: 'loc-de', locale: 'de-DE', code: localeForAppleLocale('de-DE') },
      { id: 'loc-en', locale: 'en-US', code: localeForAppleLocale('en-US') },
    ]);
    // An ES256 token: three base64url parts.
    assert.ok(run.calls.every((call) => /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(call.auth ?? '')), 'every call is signed');
  } finally {
    run.done();
  }
});

test('App Store dry run: each language by display type, a size Apple takes no set for named, a set past 10 refused', async () => {
  const run = page(nothing);
  const sets = [
    { locale: 'en', localizationId: 'loc-en', label: 'en-US' },
    { locale: 'de', localizationId: 'loc-de', label: 'de-DE' },
  ];
  try {
    const images = [
      image(1320, 2868, 'en', 'en-max'),
      image(1290, 2796, 'en', 'en-pro'),
      image(2868, 1320, 'en', 'en-wide'),
      image(2064, 2752, 'en', 'en-ipad'),
      image(1000, 1000, 'en', 'en-odd'),
      image(1206, 2622, 'de', 'de-1'),
    ];
    await run.publish({ store: 'appstore', action: 'stage', credentials: null, images });
    const answer = (await run.publish({ store: 'appstore', action: 'upload', credentials: APPLE_KEY, appId: '42', sets, dryRun: true })) as HeadlessPublishResponse & {
      data: { plan: Array<{ label: string; target: string; count: number; files: string[] }>; warnings: string[] };
    };
    assert.equal(answer.ok, true, answer.error);
    assert.deepEqual(
      answer.data.plan.map((row) => `${row.label} ${row.count} ${row.files.join(',')}`),
      ['en-US 3 en-max.png,en-pro.png,en-wide.png', 'en-US 1 en-ipad.png', 'de-DE 1 de-1.png']
    );
    assert.equal(answer.data.warnings.length, 1);
    assert.match(answer.data.warnings[0], /^en-odd\.png is 1000x1000, which the App Store does not accept/);
    assert.equal(run.calls.length, 0);

    await run.publish({ store: 'appstore', action: 'clear', credentials: null });
    await run.publish({ store: 'appstore', action: 'stage', credentials: null, images: Array.from({ length: 11 }, () => image(1320, 2868, 'en')) });
    const full = await run.publish({ store: 'appstore', action: 'upload', credentials: APPLE_KEY, appId: '42', sets, dryRun: true });
    assert.equal(full.kind, 'rejected');
    assert.match(full.error ?? '', /^The App Store keeps at most 10 screenshots per size, and en-US has 11 for /);
  } finally {
    run.done();
  }
});
