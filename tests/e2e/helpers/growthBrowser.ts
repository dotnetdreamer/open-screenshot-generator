import { resolve } from 'node:path';
import { buildSync } from 'esbuild';

let bundled: string | null = null;

/**
 * The Growth browser's driver (src/lib/growth/setup/driver.ts), bundled from
 * source the way `npm run build:growth-browser` bundles it for the desktop
 * app, so a spec runs the code the console pages get.
 */
export function driverSource(): string {
  if (bundled) return bundled;
  const result = buildSync({
    entryPoints: [resolve(__dirname, '../../../src/lib/growth/setup/driver.ts')],
    bundle: true,
    format: 'iife',
    target: 'safari15',
    write: false,
    logLevel: 'error',
  });
  bundled = result.outputFiles[0].text;
  return bundled;
}

export const ASC_KEYS_URL = 'https://appstoreconnect.apple.com/access/integrations/api';
export const ISSUER_ID = '69a6de70-03db-47e3-e053-5b8c7c11a4d1';
export const NEW_KEY_ID = '2X9R4HXF34';

/**
 * A page shaped like App Store Connect's Team Keys: the Issuer ID, a button
 * that opens the Generate API Key dialog, and a new key's row whose Download
 * hands the .p8 over the way Rust does when the real page downloads it.
 */
export function appStoreKeysPage(key: string): string {
  return `<!doctype html>
<html><head><title>Users and Access - App Store Connect</title></head>
<body>
  <h1>Users and Access</h1>
  <nav><a href="#people">People</a> <a href="#integrations" aria-current="page">Integrations</a></nav>
  <h2>App Store Connect API</h2>
  <div><span>Issuer ID</span> <span id="issuer">${ISSUER_ID}</span> <button type="button">Copy</button></div>
  <section id="keys"><h3>Active</h3><button type="button" id="generate">Generate API Key</button></section>
  <div id="dialog" role="dialog" aria-modal="true" aria-label="Generate API Key" hidden>
    <label>Name <input id="name" autocomplete="off"></label>
    <label>Access <select id="access"><option>Developer</option><option>App Manager</option><option>Admin</option></select></label>
    <button type="button" id="cancel">Cancel</button>
    <button type="button" id="go">Generate</button>
  </div>
  <script>
    const key = ${JSON.stringify(key)};
    document.getElementById('generate').onclick = () => { document.getElementById('dialog').hidden = false; };
    document.getElementById('cancel').onclick = () => { document.getElementById('dialog').hidden = true; };
    document.getElementById('go').onclick = () => {
      document.getElementById('dialog').hidden = true;
      const row = document.createElement('div');
      row.id = 'new-key';
      row.innerHTML = '<span></span> <span>${NEW_KEY_ID}</span> <span></span> <button type="button" id="download">Download API Key</button>';
      row.children[0].textContent = document.getElementById('name').value;
      row.children[2].textContent = document.getElementById('access').value;
      document.getElementById('keys').appendChild(row);
      document.getElementById('download').onclick = () =>
        parent.__E2E_TAURI__.emitFromBackend('abs-growth-browser', { type: 'key-file', kind: 'apple-key', fileName: 'AuthKey_${NEW_KEY_ID}.p8', content: key });
    };
  </script>
</body></html>`;
}
