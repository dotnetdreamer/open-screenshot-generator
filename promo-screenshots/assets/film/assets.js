// Loads the faces and the product's own pictures before the first frame.
import { SHOTS } from "./shots.js";

const FACES = [
  '700 80px "Space Grotesk"',
  '500 80px "Space Grotesk"',
  '400 40px "Inter"',
  '500 40px "Inter"',
  '600 40px "Inter"',
  '700 40px "Inter"',
  '500 30px "JetBrains Mono"',
  '700 30px "JetBrains Mono"',
  '400 80px "Instrument Serif"',
  'italic 400 80px "Instrument Serif"',
];

export async function loadFonts() {
  await Promise.all(FACES.map((f) => document.fonts.load(f)));
  await document.fonts.ready;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "sync";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("image failed: " + src));
    im.src = src;
  });
}

/** Every picture in shots.js, by key, as decoded images. */
export async function loadShots() {
  const entries = Object.entries(SHOTS);
  const out = {};
  await Promise.all(
    entries.map(async ([k, v]) => {
      if (Array.isArray(v)) out[k] = await Promise.all(v.map((s) => loadImage("assets/shots/" + s)));
      else out[k] = await loadImage("assets/shots/" + v);
    }),
  );
  return out;
}
