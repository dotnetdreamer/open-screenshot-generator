// scripts/pictures/to-webp.mjs, run in a throwaway git repo. It makes a WebP
// next to each PNG and changes nothing else: no PNG is deleted and no file
// that names one is touched. It refuses to overwrite a WebP it didn't make or
// one changed since, and a published picture the desktop app downloads keeps
// its bytes.
//
// The tests run in order and share one repo, each starting from what the last
// one left. Picture names start with "fixture-" so a search of the real repo
// never mistakes this file for one that names a real picture.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const sharp = createRequire(path.join(repo, 'package.json'))('sharp');
let dir = '';

const file = (name: string) => path.join(dir, name);
const read = (name: string) => fs.readFileSync(file(name), 'utf8');
const bytes = (name: string) => fs.readFileSync(file(name));
const exists = (name: string) => fs.existsSync(file(name));
function write(name: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(file(name)), { recursive: true });
  fs.writeFileSync(file(name), content);
}
async function png(name: string, r: number, g: number, b: number) {
  write(name, await sharp({ create: { width: 40, height: 30, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer());
}
const webp = async (colour: string) => sharp({ create: { width: 40, height: 30, channels: 3, background: colour } }).webp({ lossless: true }).toBuffer();
function git(...args: string[]) {
  const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function convert(...args: string[]) {
  const result = spawnSync(process.execPath, ['scripts/pictures/to-webp.mjs', ...args], { cwd: dir, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sources = () => JSON.parse(read('scripts/pictures/webp-sources.json')) as Record<string, { png: string; webp: string }>;

// Files that name the new picture in every way the earlier audits tried: a
// template's picture field and caption, the library, someone's own project
// with a JSON escape, a page the site serves, and a script reading it from disk.
const NAMERS: Record<string, string> = {
  'public/data/projects/fixture.json': json({ artboards: [{ elements: [{ type: 'device', screenshotSrc: '/data/projects/fixture-new.png' }, { type: 'text', content: '/data/projects/fixture-new.png' }] }] }),
  'src/lib/imageLibrary.ts': "export const IMAGE_CATEGORIES = [{ id: 'things', items: [{ id: 'fixture-thing', src: \"/elements/images/things/fixture-thing.png\" }] }];\n",
  'customer-design.json': '{ "artboards": [ { "elements": [ { "imageSrc": "/data/projects/fixture-ne\\u0077.png" } ] } ] }\n',
  'public/splash.html': '<img src="/data/projects/fixture-new.png"><img src="/data/projects/fixture-new%2Epng">\n',
  'scripts/read-it.mjs': "import fs from 'node:fs';\nfs.readFileSync('public/data/projects/fixture-new.png');\n",
};

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-to-webp-'));
  for (const name of ['scripts/pictures/to-webp.mjs', 'scripts/desktop-assets.mjs', 'src/lib/pictureFields.json']) {
    write(name, fs.readFileSync(path.join(repo, name)));
  }
  fs.symlinkSync(path.join(repo, 'node_modules'), file('node_modules'), 'dir');
  write('.gitignore', 'node_modules\nout-desktop\n');
  write('package.json', '{ "private": true }\n');
  for (const [name, text] of Object.entries(NAMERS)) write(name, text);
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'start');
  await png('public/data/projects/fixture-new.png', 200, 40, 40);
  await png('public/elements/images/things/fixture-thing.png', 40, 200, 40);
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('a new PNG gets a WebP next to it, and nothing else changes', () => {
  const pngBefore = bytes('public/data/projects/fixture-new.png');
  const result = convert();
  assert.equal(result.status, 0, result.out);
  assert.ok(exists('public/data/projects/fixture-new.webp') && exists('public/elements/images/things/fixture-thing.webp'));
  assert.ok(bytes('public/data/projects/fixture-new.png').equals(pngBefore), 'the PNG stays as it was');
  for (const [name, text] of Object.entries(NAMERS)) assert.equal(read(name), text, `${name} is untouched`);
  const listed = sources();
  assert.deepEqual(Object.keys(listed).sort(), ['/data/projects/fixture-new', '/elements/images/things/fixture-thing']);
  assert.deepEqual(JSON.parse(read('src/lib/pictureRenames.json')), { '/data/projects/': ['fixture-new'], '/elements/images/things/': ['fixture-thing'] });
  assert.ok(exists('public/thumbs/elements/images/things/fixture-thing.webp'), 'the library tile is made');
  const checked = convert('--check');
  assert.equal(checked.status, 0, checked.out);
});

test('a second run changes nothing', () => {
  const before = bytes('public/data/projects/fixture-new.webp');
  const result = convert();
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /WebP made: 0/);
  assert.ok(bytes('public/data/projects/fixture-new.webp').equals(before));
});

test('a changed PNG gets its WebP made again', async () => {
  // A template preview generated again.
  await png('public/data/projects/previews/fixture-card.png', 10, 10, 10);
  assert.equal(convert().status, 0);
  const first = bytes('public/data/projects/previews/fixture-card.webp');
  await png('public/data/projects/previews/fixture-card.png', 240, 240, 240);
  const result = convert();
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /made again from a changed PNG: public\/data\/projects\/previews\/fixture-card\.webp/);
  assert.ok(!bytes('public/data/projects/previews/fixture-card.webp').equals(first));
  assert.equal(convert('--check').status, 0);
});

test('a WebP this script did not make is never overwritten, and nothing is written', async () => {
  const theirs = await webp('#cc2222');
  write('public/elements/images/things/fixture-dup.webp', theirs);
  await png('public/elements/images/things/fixture-dup.png', 20, 180, 60);
  await png('public/data/projects/fixture-other.png', 1, 2, 3);
  const result = convert();
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /public\/elements\/images\/things\/fixture-dup\.webp is not the WebP this script makes from public\/elements\/images\/things\/fixture-dup\.png/);
  assert.ok(bytes('public/elements/images/things/fixture-dup.webp').equals(theirs));
  assert.ok(!exists('public/data/projects/fixture-other.webp'), 'not even the picture with no problem');
  fs.rmSync(file('public/elements/images/things/fixture-dup.png'));
  fs.rmSync(file('public/data/projects/fixture-other.png'));
});

test('a WebP changed since this script made it is never overwritten', async () => {
  const edited = await webp('#884422');
  write('public/data/projects/fixture-new.webp', edited);
  const result = convert();
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /public\/data\/projects\/fixture-new\.webp changed since this script made it/);
  assert.ok(bytes('public/data/projects/fixture-new.webp').equals(edited));
  const checked = convert('--check');
  assert.equal(checked.status, 1);
  assert.match(checked.out, /public\/data\/projects\/fixture-new\.webp changed since it was made/);
  // Put back for the tests after this one.
  fs.rmSync(file('public/data/projects/fixture-new.webp'));
  assert.equal(convert().status, 0);
});

test('a published picture the desktop app downloads keeps its bytes', async () => {
  git('add', '-A');
  git('commit', '-qm', 'published');
  const published = bytes('public/data/projects/fixture-new.webp');
  const original = bytes('public/data/projects/fixture-new.png');

  // A different PNG under its name.
  await png('public/data/projects/fixture-new.png', 0, 0, 255);
  let result = convert();
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /public\/data\/projects\/fixture-new\.webp is published \(HEAD has it\) with other bytes/);
  assert.ok(bytes('public/data/projects/fixture-new.webp').equals(published));

  // The same, with the WebP's file gone.
  fs.rmSync(file('public/data/projects/fixture-new.webp'));
  result = convert();
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /fixture-new\.webp is published \(HEAD has it\) with other bytes/);
  assert.ok(!exists('public/data/projects/fixture-new.webp'), 'not made again with other bytes');

  // The original PNG again, but other bytes staged for the WebP.
  write('public/data/projects/fixture-new.png', original);
  write('public/data/projects/fixture-new.webp', await webp('#00ff00'));
  git('add', 'public/data/projects/fixture-new.webp');
  fs.rmSync(file('public/data/projects/fixture-new.webp'));
  result = convert();
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /fixture-new\.webp: the index holds other bytes than HEAD/);
  git('reset', '-q', 'HEAD', '--', 'public/data/projects/fixture-new.webp');
  git('checkout', '--', 'public/data/projects/fixture-new.webp');
  assert.equal(convert('--check').status, 0, 'back as published');

  // One only the last desktop build knows, by its sha256.
  write('out-desktop/embed/osg-downloads.json', JSON.stringify({ files: { '/data/projects/fixture-built.webp': { sha256: 'ab'.repeat(32), bytes: 10 } } }));
  await png('public/data/projects/fixture-built.png', 6, 6, 6);
  result = convert();
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /public\/data\/projects\/fixture-built\.webp: the last desktop build lists other bytes for it/);
  assert.ok(!exists('public/data/projects/fixture-built.webp'));
  fs.rmSync(file('public/data/projects/fixture-built.png'));
  fs.rmSync(file('out-desktop'), { recursive: true });
});

test('a name written another way in Unicode gets the WebP its readers ask for', async () => {
  // The accent kept as a separate character after the e, as some Mac tools write it.
  await png('public/data/projects/fixture-cafe\u{301}.png', 150, 75, 0);
  const result = convert();
  assert.equal(result.status, 0, result.out);
  assert.ok(exists('public/data/projects/fixture-caf\xe9.webp'));
  assert.ok('/data/projects/fixture-caf\xe9' in sources(), 'listed under the composed name, as git keeps it');
});

test('--check finds a PNG with no WebP, a changed PNG, a name not there exactly, and a picture named by its WebP', async () => {
  await png('public/data/projects/fixture-loose.png', 9, 9, 9);
  await png('public/elements/images/things/fixture-thing.png', 1, 1, 1);
  write('public/data/projects/fixture-Mixed.webp', await webp('#000000'));
  write(
    'public/data/projects/fixture-late.json',
    json({ artboards: [{ elements: [{ imageSrc: '/data/projects/fixture-mixed.webp' }, { imageSrc: '/data/projects/fixture-new.webp' }, { imageSrc: '/data/projects/fixture-gone.png' }] }] })
  );
  const result = convert('--check');
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /public\/data\/projects\/fixture-loose\.png has no WebP made from it/);
  assert.match(result.out, /public\/elements\/images\/things\/fixture-thing\.png changed since its WebP was made/);
  // A Mac's disk would find this one; the site would not.
  assert.match(result.out, /names \/data\/projects\/fixture-mixed\.webp, which is not in public\/ \(\/data\/projects\/fixture-Mixed\.webp is\)/);
  assert.match(result.out, /names \/data\/projects\/fixture-new\.webp: name it \/data\/projects\/fixture-new\.png/);
  assert.match(result.out, /names \/data\/projects\/fixture-gone\.png, which is not in public\/$/m);
});
