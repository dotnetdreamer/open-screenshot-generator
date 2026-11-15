// App Store Connect as the IPC mock's http rules answer it (tauri-plugin-http is how the desktop
// app reaches Apple): Juniper's app, its versions and listings, the screenshot sets, the
// reservations, the uploads to Apple's storage and the delivery state. Nothing reaches Apple.
// The signing key is a throwaway P-256 key made per run; the mock never checks the token.
const crypto = require('crypto');

const API = 'https://api\\.appstoreconnect\\.apple\\.com';
const APP_ID = '6740381925';
const VERSION = 'ver-130';
const STORAGE_HOST = 'https://store-032\\.blobstore\\.apple\\.com';
const ok = (body, status = 200) => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const APPLE = [
  {
    match: `^GET ${API}/v1/apps\\?`,
    ...ok({ data: [{ id: APP_ID, type: 'apps', attributes: { name: 'Juniper: Habit Tracker', bundleId: 'com.example.juniper' } }], links: {} }),
  },
  {
    match: `^GET ${API}/v1/apps/${APP_ID}/appStoreVersions`,
    ...ok({
      data: [
        { id: VERSION, type: 'appStoreVersions', attributes: { versionString: '1.3', appStoreState: 'PREPARE_FOR_SUBMISSION', platform: 'IOS' } },
        { id: 'ver-120', type: 'appStoreVersions', attributes: { versionString: '1.2', appStoreState: 'READY_FOR_SALE', platform: 'IOS' } },
      ],
      links: {},
    }),
  },
  {
    match: `^GET ${API}/v1/appStoreVersions/${VERSION}/appStoreVersionLocalizations`,
    ...ok({
      data: [
        { id: 'loc-en', type: 'appStoreVersionLocalizations', attributes: { locale: 'en-US' } },
        { id: 'loc-de', type: 'appStoreVersionLocalizations', attributes: { locale: 'de-DE' } },
        { id: 'loc-ja', type: 'appStoreVersionLocalizations', attributes: { locale: 'ja' } },
        { id: 'loc-ar', type: 'appStoreVersionLocalizations', attributes: { locale: 'ar-SA' } },
      ],
      links: {},
    }),
  },
  { match: `^GET ${API}/v1/appStoreVersionLocalizations/[^/]+/appScreenshotSets`, ...ok({ data: [], links: {} }) },
  { match: `^POST ${API}/v1/appScreenshotSets$`, ...ok({ data: { id: 'set-61', type: 'appScreenshotSets', attributes: { screenshotDisplayType: 'APP_IPHONE_61' } } }, 201) },
  { match: `^GET ${API}/v1/appScreenshotSets/[^/]+/appScreenshots`, ...ok({ data: [], links: {} }) },
  {
    match: `^POST ${API}/v1/appScreenshots$`,
    ...ok(
      {
        data: {
          id: 'shot-1',
          type: 'appScreenshots',
          attributes: {
            uploadOperations: [{ method: 'PUT', url: 'https://store-032.blobstore.apple.com/sq/upload/juniper', offset: 0, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] }],
          },
        },
      },
      201
    ),
  },
  { match: `^PUT ${STORAGE_HOST}/`, status: 200, body: '', headers: {}, hold: false },
  { match: `^PATCH ${API}/v1/appScreenshots/`, ...ok({ data: { id: 'shot-1', type: 'appScreenshots', attributes: {} } }) },
  { match: `^PATCH ${API}/v1/appScreenshotSets/[^/]+/relationships/appScreenshots`, status: 204, body: '', headers: {} },
  {
    match: `^GET ${API}/v1/appScreenshots/shot-1\\?`,
    ...ok({ data: { id: 'shot-1', type: 'appScreenshots', attributes: { fileName: '01_Habits.png', assetDeliveryState: { state: 'COMPLETE' } } } }),
  },
];

/** Saved App Store Connect credentials, as the upload dialog keeps them in localStorage. */
function credentials() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    appstore: {
      issuerId: '57a2d0c4-3b9e-4f61-a8d2-7c41e5b09f3a',
      keyId: 'J8W3TQ5K2N',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    },
  };
}

const CREDENTIALS_KEY = 'open-screenshot-generator.store-credentials';

const DIALOG = `[...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('Upload to the store'))`;

/** The key id and issuer look like private codes, so they are masked before every shutter. */
async function maskKey(page) {
  await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => (d.textContent || '').includes('Upload to the store'));
    if (!dialog) return;
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const value = node.nodeValue || '';
      if (/^Key [A-Z0-9]{10}$/.test(value.trim())) node.nodeValue = value.replace(/Key [A-Z0-9]{6}([A-Z0-9]{4})/, 'Key ••••••$1');
      if (/^Issuer [0-9a-f-]{36}$/.test(value.trim())) node.nodeValue = value.replace(/Issuer [0-9a-f-]{32}([0-9a-f]{4})/, 'Issuer ••••••••-••••-••••-••••-••••••••$1');
    }
  });
}

module.exports = { APPLE, credentials, CREDENTIALS_KEY, DIALOG, maskKey };
