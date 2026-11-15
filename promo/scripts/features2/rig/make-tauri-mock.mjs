// Bundles the e2e Tauri IPC mock (tests/e2e/fixtures/tauri-runtime.ts) and writes one injectable
// init script per OS, so a plain browser renders the desktop UI: the MCP pill, the Claude Code and
// Codex agent, the Agent dock. Responses for detection and MCP status are filled in per capture.
//   node make-tauri-mock.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const require = createRequire(REPO + '/package.json');
const esbuild = require('esbuild');
const here = path.dirname(url.fileURLToPath(import.meta.url));
const out = path.join(here, '.tauri-runtime.mjs');
await esbuild.build({ entryPoints: [REPO + '/tests/e2e/fixtures/tauri-runtime.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const mod = await import(url.pathToFileURL(out).href);
for (const os of ['macos', 'windows']) {
  const cfg = { ...mod.DEFAULT_TAURI_CONFIG, os };
  fs.writeFileSync(path.join(here, `tauri-init-${os}.json`), JSON.stringify({ config: cfg }));
}
// The script builder itself, exported as a CommonJS helper the capture scripts call with their own config.
fs.writeFileSync(path.join(here, 'tauri-init.cjs'), `module.exports = ${mod.tauriInitScript.toString()};\nmodule.exports.DEFAULT = ${JSON.stringify(mod.DEFAULT_TAURI_CONFIG)};\n`);
console.log('ok', fs.readFileSync(path.join(here, 'tauri-init.cjs'), 'utf8').length, 'bytes');
