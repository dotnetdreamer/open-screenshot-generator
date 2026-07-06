// Local white-background removal for crisp objects on plain white (food shots).
// Distance-from-white alpha with feather; not suitable for hair/fuzzy edges.
// Usage: node white-key.js <inDir> <outDir> <id1,id2,...>
const fs = require('fs');
const path = require('path');
const sharp = require('c:/Users/ik/Documents/GitHub/artboard-studio/node_modules/sharp');

const [inDir, outDir, idsArg] = process.argv.slice(2);
const ids = idsArg.split(',');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  for (const id of ids) {
    const src = path.join(inDir, `${id}.jpg`);
    const { data, info } = await sharp(src).resize({ width: 2400, withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    // sample background from the 4 corners
    const corners = [[4, 4], [width - 5, 4], [4, height - 5], [width - 5, height - 5]];
    let bgR = 0, bgG = 0, bgB = 0;
    for (const [x, y] of corners) {
      const o = (y * width + x) * channels;
      bgR += data[o]; bgG += data[o + 1]; bgB += data[o + 2];
    }
    bgR /= 4; bgG /= 4; bgB /= 4;
    const out = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const r = data[i * channels], g = data[i * channels + 1], b = data[i * channels + 2];
      const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
      const t0 = 14, t1 = 46;
      const a = dist <= t0 ? 0 : dist >= t1 ? 255 : Math.round(((dist - t0) / (t1 - t0)) * 255);
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
    }
    await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(path.join(outDir, `${id}.png`));
    console.log(id, 'keyed', `bg rgb(${Math.round(bgR)},${Math.round(bgG)},${Math.round(bgB)})`);
  }
})();
