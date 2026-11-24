// Splits the static export in out/ into what each desktop build carries.
//
//   node scripts/desktop-assets.mjs
//
// tauri.conf.json runs it after `npm run build`, before Tauri embeds the files.
//
//   out-desktop/embed    the program. Built into the macOS binary.
//   out-desktop/local    the pictures the app shows from the start: template
//                        previews, palette tiles, the app screens that built-in
//                        designs use, and the background remover's engine. The
//                        macOS app keeps them in Contents/Resources/web
//                        (tauri.macos.conf.json), so a universal build holds one
//                        copy instead of one per architecture.
//   out-desktop/bundled  embed and local together, built into the Windows and
//                        Linux binaries, which have one architecture each.
//
// Template art and the image library's pictures are in none of them.
// osg-downloads.json (in embed and bundled) lists each one with its size and
// sha256, and the app downloads it the first time it is shown, from the
// editor's own site (src-tauri/src/web_assets.rs). deploy.yml publishes that
// site from this same out/ folder, so a listed picture is there under the same
// path once its commit is on main.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repo, 'out');
const target = path.join(repo, 'out-desktop');
const BASE_URL = 'https://editor.openscrgen.app';

/** Downloaded on first use: template art and the library's pictures. */
export function isDownloaded(requestPath) {
  // The pictures at the top of data/projects. Its folders (previews, app screens) ship.
  if (/^\/data\/projects\/[^/]+\.(webp|png|jpe?g)$/i.test(requestPath)) return true;
  // The library, apart from the store badges, which are a few kilobytes.
  return requestPath.startsWith('/elements/images/') && !requestPath.startsWith('/elements/images/badges/');
}

/**
 * Folder and name without the extension of each picture that has a WebP made
 * from its PNG (src/lib/pictureRenames.json). The app asks for the WebP by the
 * PNG's name (web_assets.rs), so a build carries the WebP alone.
 */
export function webpStems(renamed) {
  return new Set(Object.entries(renamed).flatMap(([dir, names]) => names.map((name) => `${dir}${name}`)));
}

/** Shipped beside the program on macOS, inside it elsewhere. */
export function isLocalPicture(requestPath) {
  return (
    (requestPath.startsWith('/data/projects/') && !requestPath.endsWith('.json')) ||
    requestPath.startsWith('/elements/') ||
    requestPath.startsWith('/thumbs/') ||
    requestPath.startsWith('/cutout/ort/')
  );
}

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.isFile() && entry.name !== '.DS_Store') found.push(full);
  }
  return found;
}

/** A hard link where the disk allows one, so the three folders cost one copy. */
function place(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.linkSync(source, destination);
  } catch {
    fs.copyFileSync(source, destination);
  }
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

function main() {
  if (!fs.existsSync(path.join(outDir, 'index.html'))) {
    console.error('desktop-assets: out/index.html is missing. Run `npm run build` first.');
    process.exit(1);
  }
  const version = JSON.parse(fs.readFileSync(path.join(repo, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;
  let renamed = {};
  try {
    renamed = JSON.parse(fs.readFileSync(path.join(repo, 'src', 'lib', 'pictureRenames.json'), 'utf8'));
  } catch {
    // No renames yet.
  }

  for (const folder of ['embed', 'local', 'bundled']) {
    fs.rmSync(path.join(target, folder), { recursive: true, force: true });
    fs.mkdirSync(path.join(target, folder), { recursive: true });
  }

  const files = {};
  const sizes = { embed: 0, local: 0, download: 0, png: 0 };
  const biggest = [];
  const stems = webpStems(renamed);
  for (const file of walk(outDir).sort()) {
    const relative = path.relative(outDir, file).split(path.sep).join('/');
    const requestPath = `/${relative}`;
    const bytes = fs.statSync(file).size;
    // The site keeps the PNG for whoever names it; the app shows the WebP.
    if (requestPath.endsWith('.png') && stems.has(requestPath.slice(0, -4))) {
      sizes.png += bytes;
      continue;
    }
    if (isDownloaded(requestPath)) {
      files[requestPath] = { sha256: sha256(file), bytes };
      sizes.download += bytes;
      continue;
    }
    if (isLocalPicture(requestPath)) {
      place(file, path.join(target, 'local', relative));
      sizes.local += bytes;
    } else {
      place(file, path.join(target, 'embed', relative));
      sizes.embed += bytes;
      biggest.push({ requestPath, bytes });
    }
    place(file, path.join(target, 'bundled', relative));
  }

  const manifest = `${JSON.stringify({ version, baseUrl: BASE_URL, files, renamed }, null, 1)}\n`;
  for (const folder of ['embed', 'bundled']) fs.writeFileSync(path.join(target, folder, 'osg-downloads.json'), manifest);

  console.log(`desktop-assets: program ${mb(sizes.embed)}, shipped pictures ${mb(sizes.local)}, downloaded on first use ${mb(sizes.download)} (${Object.keys(files).length} files), PNG left out ${mb(sizes.png)}`);
  const top = biggest.sort((a, b) => b.bytes - a.bytes).slice(0, 5);
  console.log(`  biggest program files: ${top.map((item) => `${item.requestPath} ${mb(item.bytes)}`).join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
