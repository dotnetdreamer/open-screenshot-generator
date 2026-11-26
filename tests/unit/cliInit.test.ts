// `osg init` writes the config its flags ask for: --store sets the store and
// that store's phone size, --format picks ts, js (.mjs) or json, and --force
// replaces a config only in the flavour asked for. Each config it writes is
// read back the way the CLI loads it.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../../cli/src/args';
import { defaultFormatsFor, loadConfig, storeFromFlag, type OsgConfig } from '../../cli/src/config';
import type { CommandContext } from '../../cli/src/context';
import { configureOutput } from '../../cli/src/log';
import { run as init } from '../../cli/src/commands/init';

configureOutput({ quiet: true });

const made: string[] = [];
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

function repo(folders: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-init-'));
  made.push(dir);
  for (const folder of folders) fs.mkdirSync(path.join(dir, folder), { recursive: true });
  return dir;
}

/** The context the CLI builds for `osg init <flags>` run in `dir`, as far as init reads it. */
async function initIn(dir: string, argv: string[]): Promise<number> {
  const loaded = await loadConfig(undefined, dir);
  const ctx = {
    args: parseArgs(['init', ...argv]),
    loaded,
    config: loaded.config,
    root: loaded.root,
    json: false,
    offline: false,
    outDir: path.join(loaded.root, 'osg', 'out'),
    projectFile: path.join(loaded.root, 'osg', 'project.json'),
  } as unknown as CommandContext;
  return init(ctx);
}

async function configIn(dir: string): Promise<{ file: string | null; config: OsgConfig }> {
  const loaded = await loadConfig(undefined, dir);
  return { file: loaded.file && path.relative(dir, loaded.file), config: loaded.config };
}

test('--store play writes a Play config with the Play phone size, in the flavour --format names', async () => {
  const dir = repo();
  assert.equal(await initIn(dir, ['--store', 'play', '--format', 'json', '--name', 'Pebble']), 0);
  const { file, config } = await configIn(dir);
  assert.equal(file, path.join('osg', 'osg.config.json'));
  assert.equal(config.store, 'play');
  assert.deepEqual(config.formats, ['play-phone']);
  assert.equal(config.name, 'Pebble');
  assert.ok(!fs.existsSync(path.join(dir, 'osg', 'osg.config.ts')), 'one config, not two');
});

test('--format js writes an .mjs module the CLI imports, and the App Store keeps the iPhone size', async () => {
  const dir = repo();
  assert.equal(await initIn(dir, ['--format', 'js', '--store', 'appstore']), 0);
  const { file, config } = await configIn(dir);
  assert.equal(file, path.join('osg', 'osg.config.mjs'));
  assert.equal(config.store, 'appstore');
  assert.deepEqual(config.formats, ['ios-6-3']);
  assert.match(fs.readFileSync(path.join(dir, 'osg', 'osg.config.mjs'), 'utf8'), /@type \{import\('open-screenshot-generator'\)\.OsgConfig\}/);
});

test('with no flags: TypeScript, and the store read from the repo, which --store overrides', async () => {
  const android = repo(['android']);
  assert.equal(await initIn(android, []), 0);
  const written = fs.readFileSync(path.join(android, 'osg', 'osg.config.ts'), 'utf8');
  assert.match(written, /store: 'play',/);
  assert.match(written, /formats: \['play-phone'\],/);
  assert.match(written, /^import type \{ OsgConfig \} from 'open-screenshot-generator';$/m);

  const overridden = repo(['android']);
  assert.equal(await initIn(overridden, ['--store', 'ios']), 0);
  const text = fs.readFileSync(path.join(overridden, 'osg', 'osg.config.ts'), 'utf8');
  assert.match(text, /store: 'appstore',/);
  assert.match(text, /formats: \['ios-6-3'\],/);
});

test('a config is replaced only with --force, and only in the flavour it is written in', async () => {
  const dir = repo();
  await initIn(dir, ['--format', 'json', '--name', 'First']);
  const file = path.join(dir, 'osg', 'osg.config.json');

  // Without --force nothing changes.
  assert.equal(await initIn(dir, ['--format', 'json', '--name', 'Second']), 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).name, 'First');

  // --force in another flavour would leave two configs, so it is refused and writes nothing.
  await assert.rejects(initIn(dir, ['--force', '--format', 'ts']), /--force replaces osg\/osg\.config\.ts, but the config in use is osg\/osg\.config\.json/);
  assert.ok(!fs.existsSync(path.join(dir, 'osg', 'osg.config.ts')));

  // --force in the same flavour replaces it.
  assert.equal(await initIn(dir, ['--force', '--format', 'json', '--name', 'Second', '--store', 'play']), 0);
  const replaced = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(replaced.name, 'Second');
  assert.equal(replaced.store, 'play');
});

test('an unknown store or config format is refused before anything is written', async () => {
  const dir = repo();
  await assert.rejects(initIn(dir, ['--store', 'windows']), /Unknown store: windows/);
  await assert.rejects(initIn(dir, ['--format', 'yaml']), /Unknown config format: yaml/);
  assert.ok(!fs.existsSync(path.join(dir, 'osg')));
  assert.equal(storeFromFlag('Android'), 'play');
  assert.deepEqual(defaultFormatsFor('play'), ['play-phone']);
  assert.deepEqual(defaultFormatsFor(undefined), ['ios-6-3']);
});
