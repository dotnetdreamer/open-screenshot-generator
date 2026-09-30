// Runs the node unit tests in tests/unit/*.test.ts.
//
// There is no test framework in the app. Each test file is bundled with esbuild
// (resolving the @/ alias the way Next does) into a scratch folder and run with
// node's own test runner, so the pure modules under src/lib are tested exactly
// as they ship. Anything that needs a browser or Tauri belongs in tests/e2e.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(path.join(repo, 'package.json'))('esbuild');

const testDir = path.join(repo, 'tests', 'unit');
const only = process.argv.slice(2);
const files = fs
  .readdirSync(testDir)
  .filter((name) => name.endsWith('.test.ts'))
  .filter((name) => !only.length || only.some((wanted) => name.includes(wanted)));

if (!files.length) {
  console.error('No unit tests matched.');
  process.exit(1);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-unit-'));
const outputs = [];
for (const name of files) {
  const outfile = path.join(outDir, name.replace(/\.ts$/, '.mjs'));
  await build({
    entryPoints: [path.join(testDir, name)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    alias: { '@': path.join(repo, 'src') },
    // node: built-ins stay imports; everything else is inlined.
    packages: 'bundle',
    // CommonJS packages inlined into an ES module still call require() for
    // node built-ins (react-dom/server asks for "stream"), and ESM has none.
    banner: { js: "import { createRequire as __osgCreateRequire } from 'node:module'; const require = __osgCreateRequire(import.meta.url);" },
    logLevel: 'error',
  });
  outputs.push(outfile);
}

const run = spawnSync(process.execPath, ['--test', ...outputs], { cwd: repo, stdio: 'inherit' });
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(run.status ?? 1);
