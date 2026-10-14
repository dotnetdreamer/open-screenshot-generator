// Draws the Microsoft Store (MSIX) tiles and icons into src-tauri/msix/Assets/,
// and the 300x300 listing icon for Partner Center into src-tauri/msix/listing/.
//
//   npm run assets:msix
//
// The PNGs are committed and nothing in the build redraws them, so run this
// only when src/app/icon.svg changes. msix-pack.mjs copies Assets/ into the
// package as it is, and makepri indexes every file in it, so keep anything
// that is not an image out of that folder.
//
// Every PNG is rendered from the SVG at its final pixel size rather than
// resized from a bigger one. The icon is split into two layers: the gradient
// plate (its one rect filled with url(#asBg)) and the glyph drawn on top of it.
//
// Where Windows shows an image decides which of two looks it gets:
//  - The taskbar, the Windows 11 Start menu and the Store listing show the app
//    icon the installers ship: rounded corners on transparency. These are the
//    Square44x44Logo.targetsize-*_altform-unplated files and StoreLogo.
//  - Windows 10 draws everything else on a square plate or tile, so those get
//    the gradient full bleed with the glyph on it: the plated Square44x44Logo
//    sizes, the four tiles and the splash screen. Rounded corners would leave a
//    patch of the plate colour in each corner of the tile.
//
// The medium and wide tiles show the app name along their bottom edge
// (ShowNameOnTiles in AppxManifest.xml), so their glyph sits higher to clear it.

import {mkdir, readFile, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'src', 'app', 'icon.svg');
const assetsDir = join(root, 'src-tauri', 'msix', 'Assets');
const listingDir = join(root, 'src-tauri', 'msix', 'listing');

// Windows picks one of these by display scale. makepri reads the qualifier
// between the last two dots, and scale-100 has none because the manifest names
// the bare file.
const SCALES = [100, 125, 150, 200, 400];

// The taskbar and the Start list pick the app icon by its rendered size instead.
const TARGET_SIZES = [16, 24, 32, 48, 256];

const source = await readFile(sourcePath, 'utf8');

const viewBox = source.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
if (!viewBox || viewBox[1] !== viewBox[2]) {
  throw new Error(`${sourcePath} needs a square viewBox starting at 0 0.`);
}
const SIZE = Number(viewBox[1]);

const plates = source.match(/<rect\b[^>]*fill="url\(#asBg\)"[^>]*\/>/g) ?? [];
if (plates.length !== 1) {
  throw new Error(
    `${sourcePath} should have exactly one <rect fill="url(#asBg)"/> as its background, found ${plates.length}. ` +
      'Update the layer split in this script to match the new icon.'
  );
}
const plate = plates[0];
const radius = Number(plate.match(/\brx="([\d.]+)"/)?.[1] ?? 0);
const defs = source.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? '';
const glyph = source.slice(source.indexOf(plate) + plate.length, source.lastIndexOf('</svg>'));

const svg = (w, h, body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${body}</svg>`
  );
const png = (w, h, body) => sharp(svg(w, h, body)).png({compressionLevel: 9});

// The glyph's bounding box in icon units, measured from a 4x render, so the
// tiles can centre what is drawn rather than the icon's canvas.
const MEASURE = 4;
const measured = await sharp(svg(SIZE * MEASURE, SIZE * MEASURE, `<g transform="scale(${MEASURE})">${glyph}</g>`))
  .trim()
  .toBuffer({resolveWithObject: true});
const box = {
  x: -measured.info.trimOffsetLeft / MEASURE,
  y: -measured.info.trimOffsetTop / MEASURE,
  w: measured.info.width / MEASURE,
  h: measured.info.height / MEASURE,
};

// The whole icon at n x n, with the source's rounded corners or without them.
const icon = (n, {rounded}) =>
  png(
    n,
    n,
    `<g transform="scale(${n / SIZE})"><rect width="${SIZE}" height="${SIZE}" rx="${rounded ? radius : 0}" fill="url(#asBg)"/>${glyph}</g>`
  );

// The gradient across the whole w x h with the glyph `glyphHeight` of the tile
// height tall, centred, then raised by `lift` of the tile height.
const tile = (w, h, {glyphHeight, lift = 0}) => {
  const s = (h * glyphHeight) / box.h;
  const tx = w / 2 - (box.x + box.w / 2) * s;
  const ty = h / 2 - h * lift - (box.y + box.h / 2) * s;
  return png(
    w,
    h,
    `<rect width="${w}" height="${h}" fill="url(#asBg)"/><g transform="translate(${tx} ${ty}) scale(${s})">${glyph}</g>`
  );
};

// SmallTile and LargeTile are the file names the manifest uses for the 71x71 and
// 310x310 tiles (Square71x71Logo and Square310x310Logo).
const ASSETS = [
  {name: 'Square44x44Logo', w: 44, h: 44, draw: (w) => icon(w, {rounded: false})},
  {name: 'StoreLogo', w: 50, h: 50, draw: (w) => icon(w, {rounded: true})},
  {name: 'SmallTile', w: 71, h: 71, draw: (w, h) => tile(w, h, {glyphHeight: 0.64})},
  {name: 'Square150x150Logo', w: 150, h: 150, draw: (w, h) => tile(w, h, {glyphHeight: 0.54, lift: 0.08})},
  {name: 'Wide310x150Logo', w: 310, h: 150, draw: (w, h) => tile(w, h, {glyphHeight: 0.54, lift: 0.08})},
  {name: 'LargeTile', w: 310, h: 310, draw: (w, h) => tile(w, h, {glyphHeight: 0.44})},
  {name: 'SplashScreen', w: 620, h: 300, draw: (w, h) => tile(w, h, {glyphHeight: 0.46})},
];

// Emptied first: a renamed or dropped asset would otherwise stay behind and
// makepri would still index it.
await rm(assetsDir, {recursive: true, force: true});
await mkdir(assetsDir, {recursive: true});
await mkdir(listingDir, {recursive: true});

const written = [];
const write = async (dir, file, image) => {
  await image.toFile(join(dir, file));
  written.push(file);
};

for (const asset of ASSETS) {
  for (const scale of SCALES) {
    const w = Math.round((asset.w * scale) / 100);
    const h = Math.round((asset.h * scale) / 100);
    await write(assetsDir, `${asset.name}${scale === 100 ? '' : `.scale-${scale}`}.png`, asset.draw(w, h));
  }
}

for (const size of TARGET_SIZES) {
  await write(assetsDir, `Square44x44Logo.targetsize-${size}.png`, icon(size, {rounded: false}));
  await write(assetsDir, `Square44x44Logo.targetsize-${size}_altform-unplated.png`, icon(size, {rounded: true}));
}

// Uploaded by hand in Partner Center (Store listing, "1:1 App tile icon"). The
// Store shows it in place of the package's StoreLogo.
await write(listingDir, 'app-tile-icon-300x300.png', icon(300, {rounded: true}));

console.log(`Wrote ${written.length} images:`);
for (const file of written) console.log(`  ${file}`);
