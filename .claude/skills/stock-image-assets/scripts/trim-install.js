// Trim transparent borders from background-removed stock cutouts, cap the
// longest side at 1000px, and install into a public asset group folder.
//
// Usage (from the repo root):
//   node .claude/skills/stock-image-assets/scripts/trim-install.js <cutoutDir> <publicGroupDir> [prefix]
//
// Input files must be named <StockID>.png; output is <prefix>-as<StockID>.png
// (prefix defaults to the group folder name). Existing files in the output
// dir are left alone — only same-named outputs are overwritten.
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(process.cwd(), 'node_modules', 'sharp'));

const [inDir, outDir, prefixArg] = process.argv.slice(2);
if (!inDir || !outDir) {
  console.error('Usage: node trim-install.js <cutoutDir> <publicGroupDir> [prefix]');
  process.exit(1);
}
const prefix = prefixArg || path.basename(outDir);
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  for (const f of fs.readdirSync(inDir).filter(f => f.endsWith('.png')).sort()) {
    const id = f.replace('.png', '');
    const { data, info } = await sharp(path.join(inDir, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    let x0 = width, x1 = -1, y0 = height, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * channels + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { console.log(`${f}: fully transparent, skipped`); continue; }
    const pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    let img = sharp(path.join(inDir, f)).extract({ left: x0, top: y0, width: w, height: h });
    if (Math.max(w, h) > 1000) img = img.resize(w > h ? { width: 1000 } : { height: 1000 });
    const out = path.join(outDir, `${prefix}-as${id}.png`);
    await img.png().toFile(out);
    const m = await sharp(out).metadata();
    // defaultSize for imageLibrary.ts: longest side ~430 canvas units
    const scale = 430 / Math.max(m.width, m.height);
    console.log(`${path.basename(out)} ${m.width}x${m.height}  defaultSize: { width: ${Math.round(m.width * scale)}, height: ${Math.round(m.height * scale)} }`);
  }
})();
