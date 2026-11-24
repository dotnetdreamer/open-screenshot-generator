// Makes a WebP next to every PNG picture the app ships, which the app shows
// instead, and changes nothing else.
//
//   npm run pictures:webp                  make each WebP that is missing, or older than its PNG
//   npm run pictures:webp -- --check       exit 1 if one is, or a template or the image library
//                                          names a picture that is not there
//   npm run pictures:webp -- --report f    encode everything, write the numbers to f, change nothing
//
// Run it after adding or changing template art, library pictures, previews or
// 3D device thumbnails: the scripts that make them write PNG, and the unit
// tests fail while a PNG has no WebP made from it (tests/unit/pictures.test.ts).
//
// The PNG stays where it is, and so does every name for it: templates, the
// image library, saved projects, pages and scripts all keep naming the PNG.
// The editor, the desktop app and the CLI load the WebP for each name listed
// in src/lib/pictureRenames.json (pictureRenames.ts), the desktop app and the
// CLI carry or download only the WebP (scripts/desktop-assets.mjs,
// cli/scripts/pack-editor.mjs), and the site serves both. Nothing is deleted,
// renamed or rewritten, so no name can stop working, however it is written.
//
// Each picture is encoded twice, lossless and lossy (quality 90, the alpha
// channel kept exact), and the lossless file is kept unless it is more than a
// quarter bigger. Flat app screens come out smaller lossless and stay pixel
// for pixel the same; photos come out lossy at a tenth of their PNG size or
// less. A lossy file is checked against the PNG it came from (PSNR over the
// colour, weighted by alpha), and one that drifts below MIN_PSNR is encoded
// again at a higher quality, then kept lossless if that is still not close.
//
// The store badges in elements/images/badges are left alone: each store asks
// for its badge as it publishes it.
//
// Each WebP is listed in scripts/pictures/webp-sources.json with the sha256 of
// the PNG it was made from and its own. A WebP is made again only when its PNG
// changed, and never over a WebP this script didn't make or one changed since;
// one that isn't listed is taken on only when it is exactly what this script
// makes from the PNG. A picture the desktop app downloads never changes once
// published, since an installed copy accepts only the bytes its own version
// lists (src-tauri/src/web_assets.rs): its WebP must be the one HEAD has, the
// index may not hold another, and the last desktop build's list must agree.
// Nothing is written while a problem is left.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDownloaded, webpStems } from '../desktop-assets.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFromRepo = createRequire(path.join(repo, 'package.json'));

let sharp;
try {
  sharp = requireFromRepo('sharp');
} catch {
  console.error('pictures:webp needs sharp, which comes with Next. Run `npm ci` first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const reportIndex = args.indexOf('--report');
const REPORT = reportIndex >= 0 ? path.resolve(args[reportIndex + 1] ?? '') : null;

const LOSSY_QUALITY = 90;
const RETRY_QUALITY = 95;
const MIN_PSNR = 36;
// Lossless wins unless it is this much bigger than the lossy file.
const LOSSLESS_SLACK = 1.25;

/**
 * The folders this script owns, most specific first. `maxWidth` and `maxSide`
 * shrink pictures that are only ever shown small: a template card is at most
 * 700 px wide (twice that on a Retina screen), a palette tile far less.
 */
const FOLDERS = [
  { dir: 'public/data/projects/previews', maxWidth: 1400 },
  { dir: 'public/elements/device-3d', maxSide: 480 },
  { dir: 'public/data/projects' },
  { dir: 'public/elements/images', skip: ['public/elements/images/badges'] },
];

/**
 * Palette tiles for the image library: /thumbs/<the picture's own path>.webp
 * for every picture imageLibrary.ts lists, wherever it lives (a few are
 * template art in data/projects). The palette shows these, so it never needs
 * the full pictures, which the desktop app downloads only when one is used.
 */
const LIBRARY_FILE = 'src/lib/imageLibrary.ts';
const THUMB_DIR = 'public/thumbs';
const THUMB_SIDE = 360;
const THUMB_QUALITY = 82;

const RENAMES_FILE = 'src/lib/pictureRenames.json';
const SOURCES_FILE = 'scripts/pictures/webp-sources.json';
const TEMPLATE = /^public\/data\/projects\/[^/]+\.json$/;

const rel = (file) => path.relative(repo, file).split(path.sep).join('/');
const abs = (relative) => path.join(repo, relative);
/** "/data/projects/x.png" for "public/data/projects/x.png". */
const publicPath = (relative) => relative.replace(/^public/, '');
/** "/data/projects/x" for "/data/projects/x.png" in any case, or null for a name that is not a PNG's. */
const pngStem = (name) => (/\.png$/i.test(name) ? name.slice(0, -4) : null);
/** A root path to a picture, the only kind --check looks at. */
const isPictureName = (value) => /^\/[^/].*\.(png|webp|jpe?g|gif|svg|avif)$/i.test(value);
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
/** Git's blob id for `bytes`: what `git hash-object` gives a picture, since no filter applies to them here. */
const blobId = (bytes) => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const readJson = (file, fallback) => (fs.existsSync(abs(file)) ? JSON.parse(fs.readFileSync(abs(file), 'utf8')) : fallback);

/** The fields a project keeps a picture in, the same list the app reads (src/lib/pictureDownloads.ts). */
const PICTURE_KEYS = new Set(readJson('src/lib/pictureFields.json', []));

function walk(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function folderFor(relative) {
  return FOLDERS.find((folder) => relative.startsWith(`${folder.dir}/`)) ?? null;
}

function isOwned(relative) {
  const folder = folderFor(relative);
  return !!folder && !(folder.skip ?? []).some((skip) => relative.startsWith(`${skip}/`));
}

/** Every PNG in the folders above, as repo-relative paths. */
function pngs() {
  const seen = new Set();
  for (const folder of FOLDERS) {
    for (const file of walk(abs(folder.dir))) {
      const relative = rel(file);
      if (/\.png$/i.test(relative) && isOwned(relative)) seen.add(relative);
    }
  }
  return [...seen].sort();
}

/** The same picture as RGBA, at the size it is encoded at. */
async function rgba(input, resize) {
  let pipeline = sharp(input);
  if (resize) pipeline = pipeline.resize(resize);
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** PSNR over the colour channels, each pixel weighted by its alpha, and the largest alpha error. */
function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { psnr: 0, alphaError: 255 };
  let squared = 0;
  let weight = 0;
  let alphaError = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    alphaError = Math.max(alphaError, Math.abs(a.data[i + 3] - b.data[i + 3]));
    const w = a.data[i + 3] / 255;
    if (w === 0) continue;
    for (let c = 0; c < 3; c += 1) {
      const d = a.data[i + c] - b.data[i + c];
      squared += d * d * w;
    }
    weight += 3 * w;
  }
  const mse = weight ? squared / weight : 0;
  return { psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), alphaError };
}

function resizeFor(folder, width, height) {
  if (folder.maxWidth && width > folder.maxWidth) return { width: folder.maxWidth, withoutEnlargement: true };
  if (folder.maxSide && Math.max(width, height) > folder.maxSide) {
    return width >= height
      ? { width: folder.maxSide, withoutEnlargement: true }
      : { height: folder.maxSide, withoutEnlargement: true };
  }
  return null;
}

async function encode(source, folder) {
  const meta = await sharp(source).metadata();
  const stats = await sharp(source).stats();
  const resize = resizeFor(folder, meta.width, meta.height);
  const opaque = stats.isOpaque;
  const base = () => {
    let pipeline = sharp(source);
    if (resize) pipeline = pipeline.resize(resize);
    // An opaque picture needs no alpha plane in the WebP.
    if (opaque) pipeline = pipeline.removeAlpha();
    return pipeline;
  };
  const reference = await rgba(source, resize);

  const lossless = await base().webp({ lossless: true, effort: 6 }).toBuffer();
  const lossyAt = (quality) =>
    base().webp({ quality, alphaQuality: 100, smartSubsample: true, effort: 6 }).toBuffer();

  let quality = LOSSY_QUALITY;
  let lossy = await lossyAt(quality);
  let check = compare(reference, await rgba(lossy));
  if (check.psnr < MIN_PSNR || check.alphaError > 0) {
    quality = RETRY_QUALITY;
    lossy = await lossyAt(quality);
    check = compare(reference, await rgba(lossy));
  }

  const lossyOk = check.psnr >= MIN_PSNR && check.alphaError === 0;
  const useLossless = !lossyOk || lossless.length <= lossy.length * LOSSLESS_SLACK;
  const chosen = useLossless ? lossless : lossy;
  const final = useLossless ? compare(reference, await rgba(lossless)) : check;
  return {
    mismatch: final.alphaError > 0 || (useLossless && final.psnr !== Infinity),
    alphaError: final.alphaError,
    buffer: chosen,
    kind: useLossless ? 'lossless' : `q${quality}`,
    psnr: final.psnr,
    width: reference.width,
    height: reference.height,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    opaque,
    icc: !!meta.icc,
  };
}

async function thumbnail(source) {
  return sharp(source)
    .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY, alphaQuality: 90, smartSubsample: true, effort: 6 })
    .toBuffer();
}

/** Runs `work` over `items`, a few at a time. */
async function pool(items, size, work) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function git(gitArgs) {
  return execFileSync('git', gitArgs, { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
}

/** Every file git has or would add (untracked, not ignored) that is on disk. A new template is usually not staged yet. */
function repoFiles() {
  const names = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  return [...new Set(names)].filter((name) => fs.statSync(abs(name), { throwIfNoEntry: false })?.isFile());
}

/** What git holds for each of `paths`: Map(path -> { staged, head }), blob ids from the index and from HEAD. */
function gitBlobs(paths) {
  const found = new Map(paths.map((file) => [file, {}]));
  if (!paths.length) return found;
  const read = (gitArgs, field, slot) => {
    let out = '';
    try {
      out = git(['--literal-pathspecs', ...gitArgs, '--', ...paths]);
    } catch {
      return; // No commit yet.
    }
    for (const line of out.split('\0').filter(Boolean)) {
      const tab = line.indexOf('\t');
      const entry = found.get(line.slice(tab + 1).normalize('NFC'));
      if (entry) entry[slot] = line.slice(0, tab).split(' ')[field];
    }
  };
  read(['ls-files', '-s', '-z'], 1, 'staged');
  read(['ls-tree', '-z', 'HEAD'], 2, 'head');
  return found;
}

/** The sha256 the last desktop build listed for each picture it downloads (scripts/desktop-assets.mjs), if one is here. */
function builtDownloads() {
  try {
    return JSON.parse(fs.readFileSync(abs('out-desktop/embed/osg-downloads.json'), 'utf8')).files ?? {};
  } catch {
    return {};
  }
}

/** { "/data/projects/x": { png, webp } }, sorted, so a rerun writes the same bytes. */
function writeSources(sources) {
  const sorted = Object.fromEntries(Object.keys(sources).sort().map((stem) => [stem, sources[stem]]));
  fs.writeFileSync(abs(SOURCES_FILE), `${JSON.stringify(sorted, null, 1)}\n`);
}

/** pictureRenames.json, the app's list of the same pictures: { "/data/projects/": ["x", ...] }, sorted. */
function writeRenames(sources) {
  const byDir = {};
  for (const stem of Object.keys(sources)) {
    const cut = stem.lastIndexOf('/') + 1;
    (byDir[stem.slice(0, cut)] ??= []).push(stem.slice(cut));
  }
  const sorted = {};
  for (const dir of Object.keys(byDir).sort()) sorted[dir] = [...new Set(byDir[dir])].sort();
  fs.writeFileSync(abs(RENAMES_FILE), `${JSON.stringify(sorted, null, 1)}\n`);
}

/** The file a picture name points at: the WebP for a listed PNG name, any other path as it is. */
const fileFor = (name, stems) => (name.endsWith('.png') && stems.has(name.slice(0, -4)) ? `${name.slice(0, -4)}.webp` : name);

// The image library's entries, in either kind of quotes.
const LIBRARY_SRC = /\bsrc:\s*(['"])((?:(?!\1)[^\\\n])+)\1/g;
const librarySources = (text) => [...text.matchAll(LIBRARY_SRC)].map((match) => match[2]);

/** Every string in a picture field of `value` (parsed JSON), at any depth. Text is never read. */
function fieldValues(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) fieldValues(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        if (PICTURE_KEYS.has(key)) found.push(item);
      } else {
        fieldValues(item, found);
      }
    }
  }
  return found;
}

/** Every picture our templates and the library name: [{ file, name }], name null for a template that isn't JSON. */
function ownNames(files) {
  const found = [];
  for (const file of files.filter((name) => TEMPLATE.test(name) || name === LIBRARY_FILE)) {
    const text = fs.readFileSync(abs(file), 'utf8');
    let values;
    if (file === LIBRARY_FILE) {
      values = librarySources(text);
    } else {
      try {
        values = fieldValues(JSON.parse(text));
      } catch {
        found.push({ file, name: null });
        continue;
      }
    }
    for (const name of values) if (isPictureName(name)) found.push({ file, name });
  }
  return found;
}

/** The pictures the image library lists, apart from the store badges, which tiles show as they are. */
function libraryPictures() {
  const sources = librarySources(fs.readFileSync(abs(LIBRARY_FILE), 'utf8'));
  return [...new Set(sources)].filter((src) => !src.startsWith('/elements/images/badges/'));
}

const thumbFor = (src) => `${THUMB_DIR}${src.replace(/\.[a-z]+$/i, '')}.webp`;

async function makeThumbnails(stems) {
  const wanted = new Map(libraryPictures().map((src) => [thumbFor(src), src]));
  let made = 0;
  await pool([...wanted.entries()], 4, async ([target, src]) => {
    const source = abs(`public${fileFor(src, stems)}`);
    if (!fs.existsSync(source)) throw new Error(`${LIBRARY_FILE} lists ${src}, which is not in public/`);
    const file = abs(target);
    // Made again when the picture is newer than its tile.
    if (fs.existsSync(file) && fs.statSync(file).mtimeMs >= fs.statSync(source).mtimeMs) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await thumbnail(source));
    made += 1;
  });
  // A tile whose picture left the library goes too.
  let removed = 0;
  for (const file of walk(abs(THUMB_DIR))) {
    if (!wanted.has(rel(file))) {
      fs.rmSync(file);
      removed += 1;
    }
  }
  return { made, removed };
}

/**
 * --check: every PNG has the WebP made from its current bytes, unchanged
 * since; the app's list matches; and every picture a template or the library
 * names is in public/ under that exact name (a Mac's disk ignores case, the
 * site does not), by its PNG name where it has one.
 */
function check() {
  const problems = [];
  const sources = readJson(SOURCES_FILE, {});
  for (const relative of pngs()) {
    const stem = pngStem(publicPath(relative)).normalize('NFC');
    const record = sources[stem];
    const webpFile = `public${stem}.webp`;
    if (!record) {
      problems.push(`${relative} has no WebP made from it: run \`npm run pictures:webp\``);
    } else if (record.png !== sha256(fs.readFileSync(abs(relative)))) {
      problems.push(`${relative} changed since its WebP was made: run \`npm run pictures:webp\``);
    } else if (!fs.existsSync(abs(webpFile))) {
      problems.push(`${webpFile} is missing: run \`npm run pictures:webp\``);
    } else if (record.webp !== sha256(fs.readFileSync(abs(webpFile)))) {
      problems.push(`${webpFile} changed since it was made from ${relative}`);
    }
  }
  const stems = webpStems(readJson(RENAMES_FILE, {}));
  const listed = Object.keys(sources);
  if (listed.length !== stems.size || listed.some((stem) => !stems.has(stem))) {
    problems.push(`${RENAMES_FILE} does not list the same pictures as ${SOURCES_FILE}: run \`npm run pictures:webp\``);
  }
  const inPublic = new Set(walk(abs('public')).map((file) => publicPath(rel(file)).normalize('NFC')));
  const byLowerCase = new Map([...inPublic].map((name) => [name.toLowerCase(), name]));
  for (const { file, name: written } of ownNames(repoFiles())) {
    if (written === null) {
      problems.push(`${file} is not valid JSON`);
      continue;
    }
    const name = written.normalize('NFC');
    const stem = name.endsWith('.webp') ? name.slice(0, -5) : null;
    if (stem && stems.has(stem)) {
      problems.push(`${file} names ${name}: name it ${stem}.png, the name older copies of the app and the CLI know`);
      continue;
    }
    const target = fileFor(name, stems);
    if (inPublic.has(target)) continue;
    const near = byLowerCase.get(target.toLowerCase());
    problems.push(`${file} names ${name}, which is not in public/${near ? ` (${near} is)` : ''}`);
  }
  if (problems.length) {
    console.error(`pictures:webp --check found ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log('pictures:webp: every PNG has the WebP made from it, and every picture a template or the library names is there.');
}

async function main() {
  if (CHECK) {
    check();
    return;
  }

  const started = Date.now();
  const sources = readJson(SOURCES_FILE, {});
  // What needs a WebP made: no WebP made from this PNG yet, a PNG changed
  // since, or a WebP missing or changed. A report encodes everything.
  const items = [];
  for (const relative of pngs()) {
    const stem = pngStem(publicPath(relative)).normalize('NFC');
    const webpFile = `public${stem}.webp`;
    const webp = fs.existsSync(abs(webpFile)) ? fs.readFileSync(abs(webpFile)) : null;
    const item = {
      relative,
      stem,
      webpFile,
      pngSha: sha256(fs.readFileSync(abs(relative))),
      webp,
      webpSha: webp ? sha256(webp) : null,
      record: sources[stem],
    };
    if (!REPORT && item.record && item.record.png === item.pngSha && item.webpSha === item.record.webp) continue;
    items.push(item);
  }

  const rows = await pool(items, Math.max(1, Math.min(4, os.cpus().length - 2)), async (item, index) => {
    const result = await encode(abs(item.relative), folderFor(item.relative));
    if (result.mismatch && !REPORT) {
      throw new Error(`${item.relative}: the WebP does not match the PNG (${result.kind}, alpha error ${result.alphaError})`);
    }
    if ((index + 1) % 50 === 0) console.log(`  ${index + 1} of ${items.length} encoded`);
    return { ...item, result };
  });

  const totalBefore = rows.reduce((sum, row) => sum + fs.statSync(abs(row.relative)).size, 0);
  const totalAfter = rows.reduce((sum, row) => sum + row.result.buffer.length, 0);
  const kinds = rows.reduce((count, row) => ({ ...count, [row.result.kind]: (count[row.result.kind] ?? 0) + 1 }), {});

  if (REPORT) {
    const report = rows.map(({ relative, result }) => ({
      file: relative,
      after: result.buffer.length,
      kind: result.kind,
      psnr: Number.isFinite(result.psnr) ? Number(result.psnr.toFixed(2)) : 'exact',
      size: `${result.sourceWidth}x${result.sourceHeight}${result.width !== result.sourceWidth ? ` -> ${result.width}x${result.height}` : ''}`,
      opaque: result.opaque,
      icc: result.icc,
      mismatch: result.mismatch,
    }));
    fs.writeFileSync(REPORT, `${JSON.stringify({ totalBefore, totalAfter, kinds, rows: report }, null, 1)}\n`);
    console.log(`pictures:webp report: ${rows.length} files, ${mb(totalBefore)} -> ${mb(totalAfter)}, ${JSON.stringify(kinds)}`);
    console.log(`  written to ${REPORT}, nothing changed`);
    return;
  }

  const problems = [];
  const blobs = gitBlobs(rows.map((row) => row.webpFile));
  const built = builtDownloads();
  for (const row of rows) {
    const next = `${row.stem}.webp`;
    const bytes = row.result.buffer;
    const newSha = sha256(bytes);
    // A WebP already there gives way only when this script made it and
    // nothing changed it since, or when it is these very bytes.
    if (row.webp && row.webpSha !== newSha) {
      if (!row.record) {
        problems.push(
          `${row.webpFile} is not the WebP this script makes from ${row.relative}: give the PNG another name, or delete the WebP if it is an old copy of the same picture`
        );
      } else if (row.record.webp !== row.webpSha) {
        problems.push(`${row.webpFile} changed since this script made it from ${row.relative}: commit or undo that change, or give the PNG another name`);
      }
    }
    // A picture the desktop app downloads keeps the bytes it was published with.
    if (isDownloaded(next)) {
      const { staged, head } = blobs.get(row.webpFile) ?? {};
      if (head && head !== blobId(bytes)) {
        problems.push(
          `${row.webpFile} is published (HEAD has it) with other bytes, and installed copies of the desktop app accept only those: give ${row.relative} a name of its own, or restore the WebP with git checkout HEAD -- "${row.webpFile}"`
        );
      } else if (head && staged && staged !== head) {
        problems.push(`${row.webpFile}: the index holds other bytes than HEAD, and HEAD's are the published ones: unstage that change`);
      }
      const listed = built[next]?.sha256;
      if (listed && listed !== newSha) {
        problems.push(
          `${row.webpFile}: the last desktop build lists other bytes for it (out-desktop/embed/osg-downloads.json), and copies of that build accept only those: give ${row.relative} a name of its own`
        );
      }
    }
  }
  if (problems.length) {
    console.error(`pictures:webp changed nothing. Fix ${problems.length === 1 ? 'this' : 'these'}, then run it again:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  const made = [];
  const remade = [];
  let takenOn = 0;
  for (const row of rows) {
    const bytes = row.result.buffer;
    if (row.webp && row.webp.equals(bytes)) {
      takenOn += 1;
    } else {
      const target = abs(row.webpFile);
      fs.writeFileSync(target, bytes);
      // Read back: a file that does not decode stops the run before it is listed.
      const back = await sharp(target).metadata();
      if (back.width !== row.result.width || back.height !== row.result.height) {
        throw new Error(`${row.webpFile} decoded at ${back.width}x${back.height}, expected ${row.result.width}x${row.result.height}`);
      }
      (row.webp ? remade : made).push(row.webpFile);
    }
    sources[row.stem] = { png: row.pngSha, webp: sha256(bytes) };
  }
  if (rows.length) {
    writeSources(sources);
    writeRenames(sources);
  }
  const thumbs = await makeThumbnails(webpStems(readJson(RENAMES_FILE, {})));

  console.log(`pictures:webp: ${rows.length} PNG checked, ${mb(totalBefore)} -> ${mb(totalAfter)} in ${Math.round((Date.now() - started) / 1000)} s`);
  if (rows.length) console.log(`  encodings: ${JSON.stringify(kinds)}`);
  console.log(`  WebP made: ${made.length}${made.length ? ` (${made.slice(0, 8).join(', ')}${made.length > 8 ? ', ...' : ''})` : ''}`);
  if (remade.length) console.log(`  made again from a changed PNG: ${remade.join(', ')}`);
  if (takenOn) console.log(`  already there with the same bytes, now listed: ${takenOn}`);
  console.log(`  library thumbnails: ${thumbs.made} made, ${thumbs.removed} removed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
