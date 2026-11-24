// Every PNG picture has a WebP made from it, the one the app shows, and
// nothing names a picture that is not there.
//
// A PNG without its WebP means someone added or changed art without running
// `npm run pictures:webp`; a template naming a file that does not exist draws
// an empty frame without a word, on the web and in the desktop app alike.
//
// A picture that shipped as PNG is still named that way in our data, the
// names a design stores (pictureRenames.ts): an installed CLI from before
// knows no other name, and skips an artboard whose picture it can't find.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_CATEGORIES, libraryThumbSrc } from '@/lib/imageLibrary';
import { currentPicturePath } from '@/lib/pictureRenames';
import { picturePaths } from '@/lib/pictureDownloads';
import { withBasePath } from '@/lib/basePath';
import { PREVIEW_SCENES } from '@/lib/previewScenes';
import renamed from '@/lib/pictureRenames.json';
import { isDownloaded, isLocalPicture, webpStems } from '../../scripts/desktop-assets.mjs';
import { resolveAssetPath, type AssetManifest } from '../../cli/src/editor/assets';

const publicDir = path.join(process.cwd(), 'public');
const onDisk = (requestPath: string) => fs.existsSync(path.join(publicDir, decodeURI(requestPath)));
const RENAMED = new Set(
  Object.entries(renamed as Record<string, string[]>).flatMap(([dir, names]) => names.map((name) => `${dir}${name}`))
);
/** A renamed picture named by its WebP file, which no copy from before can find. */
const byNewName = (picture: string) => picture.endsWith('.webp') && RENAMED.has(picture.slice(0, -5));
const FIELDS = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/lib/pictureFields.json'), 'utf8')) as string[]);
/** The picture names `value` stores, as stored (picturePaths gives the files they point at). */
function rawPicturePaths(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => rawPicturePaths(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        if (FIELDS.has(key) && /^\/[^/].*\.(webp|png|jpe?g)$/i.test(item)) found.push(item);
      } else {
        rawPicturePaths(item, found);
      }
    }
  }
  return found;
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

const templates = fs
  .readdirSync(path.join(publicDir, 'data/projects'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, data: JSON.parse(fs.readFileSync(path.join(publicDir, 'data/projects', name), 'utf8')) }));

test('every PNG in the picture folders has the WebP made from its current bytes', () => {
  const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const sources = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/pictures/webp-sources.json'), 'utf8')) as Record<string, { png: string; webp: string }>;
  const pngs = ['data/projects', 'elements/images', 'elements/device-3d']
    .flatMap((dir) => walk(path.join(publicDir, dir)))
    .map((file) => path.relative(publicDir, file).split(path.sep).join('/'))
    .filter((file) => file.endsWith('.png') && !file.startsWith('elements/images/badges/'));
  assert.ok(pngs.length > 1000, `found ${pngs.length}`);
  const wrong = pngs.filter((file) => {
    const stem = `/${file.slice(0, -4)}`.normalize('NFC');
    const webp = path.join(publicDir, `${stem}.webp`);
    const record = sources[stem];
    return !record || record.png !== sha256(path.join(publicDir, file)) || !fs.existsSync(webp) || record.webp !== sha256(webp);
  });
  assert.deepEqual(wrong, [], 'run `npm run pictures:webp`');
  // The app's list is that same set of pictures.
  assert.deepEqual([...RENAMED].sort(), Object.keys(sources).sort());
  // The tiles are WebP too.
  assert.deepEqual(walk(path.join(publicDir, 'thumbs')).filter((file) => !file.endsWith('.webp')), []);
});

test('every picture a template names is in public/', () => {
  const missing: string[] = [];
  for (const { name, data } of templates) {
    for (const picture of picturePaths(data)) if (!onDisk(picture)) missing.push(`${name}: ${picture}`);
  }
  assert.deepEqual(missing, []);
  // The walk did find them: every template has a preview at least.
  assert.ok(templates.every(({ data }) => picturePaths(data).some((p) => p.includes('/previews/'))));
});

test('every library picture and its palette thumbnail are in public/', () => {
  for (const item of IMAGE_CATEGORIES.flatMap((category) => category.items)) {
    assert.ok(onDisk(currentPicturePath(item.src)), `${item.id}: ${item.src}`);
    const thumb = libraryThumbSrc(item.src);
    assert.ok(onDisk(thumb), `${item.id}: ${thumb}`);
    if (item.src.startsWith('/elements/images/badges/')) assert.equal(thumb, item.src);
    else assert.match(thumb, /^\/thumbs\/.+\.webp$/);
  }
});

test('the app screens the preview scenes use are in public/', () => {
  const screens = picturePaths(PREVIEW_SCENES);
  assert.ok(screens.length > 10, `found ${screens.length}`);
  assert.deepEqual(screens.filter((screen) => !onDisk(screen)), []);
});

test('templates, the library and the preview scenes name each shipped picture as it shipped', () => {
  const stored = [
    ...templates.flatMap(({ name, data }) => rawPicturePaths(data).map((picture) => `${name}: ${picture}`)),
    ...IMAGE_CATEGORIES.flatMap((category) => category.items.map((item) => `imageLibrary.ts: ${item.src}`)),
    ...rawPicturePaths(PREVIEW_SCENES).map((picture) => `previewScenes.ts: ${picture}`),
  ];
  assert.ok(stored.length > 1000, `found ${stored.length}`);
  assert.deepEqual(stored.filter((entry) => byNewName(entry.slice(entry.indexOf(': ') + 2))), []);
  // And so does any other name written out in the app's code.
  const inCode = walk(path.join(process.cwd(), 'src'))
    .filter((file) => /\.tsx?$/.test(file))
    .flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/['"](\/(?:data\/projects|elements\/images)\/[^'"$]+\.webp)['"]/g)].map(
        (match) => `${path.relative(process.cwd(), file)}: ${match[1]}`
      )
    );
  assert.deepEqual(inCode.filter((entry) => byNewName(entry.slice(entry.indexOf(': ') + 2))), []);
});

test('a PNG name a saved project still holds reads as the WebP, and only those', () => {
  const [dir, names] = Object.entries(renamed as Record<string, string[]>)[0];
  const old = `${dir}${names[0]}.png`;
  const now = `${dir}${names[0]}.webp`;
  assert.ok(onDisk(now), now);
  assert.equal(currentPicturePath(old), now);
  assert.equal(withBasePath(old), now);
  // Never renamed: a PNG that is still a PNG, and the user's own paths.
  for (const kept of ['/elements/images/badges/google-play.png', '/data/projects/never-shipped.png', 'asset:abc', 'data:image/png;base64,AAAA', 'https://example.com/a.png']) {
    assert.equal(currentPicturePath(kept), kept);
  }
  // Every name that shipped ends in ".png"; the desktop app and the CLI look for no other case.
  assert.equal(currentPicturePath(old.replace(/\.png$/, '.PNG')), old.replace(/\.png$/, '.PNG'));
  // The desktop app downloads the WebP for it.
  assert.deepEqual(picturePaths({ imageSrc: old }), [now]);
});

test("the CLI's server answers an old PNG name with the WebP, and only names that were renamed", () => {
  const manifest: AssetManifest = {
    version: 'test',
    tiers: {},
    entries: {
      '/data/projects/a.webp': { path: '/data/projects/a.webp', bytes: 1, sha256: 'a'.repeat(64) },
      '/data/projects/b.png': { path: '/data/projects/b.png', bytes: 1, sha256: 'b'.repeat(64) },
    },
    renamed: { '/data/projects/': ['a', 'gone'] },
  };
  assert.equal(resolveAssetPath(manifest, '/data/projects/a.webp'), '/data/projects/a.webp');
  assert.equal(resolveAssetPath(manifest, '/data/projects/a.png'), '/data/projects/a.webp');
  assert.equal(resolveAssetPath(manifest, '/data/projects/b.png'), '/data/projects/b.png', 'a PNG the manifest has is served as it is');
  assert.equal(resolveAssetPath(manifest, '/data/projects/gone.png'), null, 'renamed, but no WebP in the manifest');
  assert.equal(resolveAssetPath(manifest, '/data/projects/c.png'), null, 'never renamed');
  assert.equal(resolveAssetPath({ ...manifest, renamed: undefined }, '/data/projects/a.png'), null, 'a manifest from before has no renames');
});

test('picture paths come out of picture fields at any depth, once each, and text never does', () => {
  const found = picturePaths({
    previewImage: '/data/projects/previews/p.webp',
    artboards: [
      {
        backgroundImage: '/data/projects/x.webp',
        elements: [
          { imageSrc: '/data/projects/x.webp' },
          { screenshotSrc: '/elements/images/touch/t.webp', localeOverrides: { de: { screenshotSrc: '/data/projects/de.webp' } } },
          { posterSrc: '//cdn.example.com/a.webp' },
          { imageSrc: 'asset:1' },
          { customFrameSrc: 'data:image/webp;base64,AA' },
          // Words that look like a path: a caption, a note, a name.
          { text: '/data/projects/caption.webp', note: '/elements/images/touch/note.webp', name: '/data/projects/n.png' },
        ],
      },
    ],
  });
  assert.deepEqual(found.sort(), ['/data/projects/de.webp', '/data/projects/previews/p.webp', '/data/projects/x.webp', '/elements/images/touch/t.webp']);
});

test('the converter and the app read the same picture fields', () => {
  // to-webp.mjs reads pictureFields.json at run time; this is the list picturePaths uses.
  const fields = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/lib/pictureFields.json'), 'utf8')) as string[];
  for (const field of fields) assert.deepEqual(picturePaths({ [field]: '/data/projects/a.webp' }), ['/data/projects/a.webp'], field);
  // Every field a template keeps a picture path in is on the list.
  const keys = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' && /^\/[^/].*\.(webp|png|jpe?g)$/i.test(item)) keys.add(key);
        else visit(item);
      }
    }
  };
  for (const { data } of templates) visit(data);
  assert.deepEqual([...keys].filter((key) => !fields.includes(key)), []);
});

test('the desktop build downloads template art and library pictures, and ships the rest', () => {
  assert.equal(isDownloaded('/data/projects/amoura-dating-screen-1.webp'), true);
  assert.equal(isDownloaded('/elements/images/touch/touch-as451105828.webp'), true);
  for (const shipped of [
    '/data/projects/previews/amoura-dating.webp',
    '/data/projects/app-screens/app-chat-coral.webp',
    '/data/projects/amoura-dating.json',
    '/elements/images/badges/google-play.png',
    '/thumbs/elements/images/touch/touch-as451105828.webp',
    '/thumbs/data/projects/sunup-mascot-happy.webp',
    '/elements/device-3d/iphone-floating-left-white.webp',
    '/cutout/ort/ort-wasm-simd-threaded.asyncify.wasm',
  ]) {
    assert.equal(isDownloaded(shipped), false, shipped);
  }
  assert.equal(isLocalPicture('/data/projects/previews/amoura-dating.webp'), true);
  assert.equal(isLocalPicture('/elements/device-3d/studio/iphone-17.webp'), true);
  assert.equal(isLocalPicture('/thumbs/data/projects/sunup-mascot-happy.webp'), true);
  assert.equal(isLocalPicture('/data/projects/amoura-dating.json'), false, 'templates are part of the program');
  assert.equal(isLocalPicture('/_next/static/chunks/main.js'), false);
});

test('every downloaded picture has a path the desktop app will fetch', () => {
  // web_assets.rs refuses anything that could leave its folder; a plain path is all it gets.
  // A PNG with a WebP made from it is not in a desktop build at all: the app asks for the WebP.
  const stems = webpStems(renamed as Record<string, string[]>);
  const downloaded = walk(publicDir)
    .map((file) => `/${path.relative(publicDir, file).split(path.sep).join('/')}`)
    .filter((requestPath) => !(requestPath.endsWith('.png') && stems.has(requestPath.slice(0, -4))))
    .filter((requestPath) => isDownloaded(requestPath));
  assert.ok(downloaded.length > 400, `found ${downloaded.length}`);
  for (const requestPath of downloaded) assert.match(requestPath, /^\/[A-Za-z0-9._/-]+$/, requestPath);
});
