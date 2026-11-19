// Builds the background remover's worker into public/cutout/, beside the
// onnxruntime-web WebAssembly file it loads. Run by `npm run dev` and
// `npm run build`; `--watch` rebuilds the worker on every change.
//
// The worker is bundled here rather than by Next so the dev server
// (Turbopack), the static export (webpack), the desktop shell and the CLI all
// load one file from one place. Nothing it writes is committed (.gitignore).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const esbuild = require('esbuild');

const outDir = path.join(repo, 'public', 'cutout');
const ortDir = path.join(outDir, 'ort');
fs.mkdirSync(ortDir, { recursive: true });

// The WebGPU build of the runtime, which also runs on the CPU at the plain
// build's speed (measured 5.7 s against 5.9 s), so one file serves both.
const ortDist = path.dirname(require.resolve('onnxruntime-web/webgpu'));
for (const name of ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs']) {
  const from = path.join(ortDist, name);
  const to = path.join(ortDir, name);
  const same = fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size && fs.statSync(to).mtimeMs >= fs.statSync(from).mtimeMs;
  if (!same) fs.copyFileSync(from, to);
}

const options = {
  entryPoints: [path.join(repo, 'src', 'lib', 'cutout', 'worker', 'cutoutWorker.ts')],
  bundle: true,
  format: 'esm',
  // WKWebView on the oldest macOS the app supports, WebView2 and WebKitGTK.
  target: ['safari15', 'chrome110'],
  platform: 'browser',
  outfile: path.join(outDir, 'cutout-worker.js'),
  alias: { '@': path.join(repo, 'src') },
  minify: !process.argv.includes('--watch'),
  sourcemap: process.argv.includes('--watch') ? 'inline' : false,
  logLevel: 'warning',
  legalComments: 'none',
};

if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('cutout worker: watching');
} else {
  await esbuild.build(options);
}
