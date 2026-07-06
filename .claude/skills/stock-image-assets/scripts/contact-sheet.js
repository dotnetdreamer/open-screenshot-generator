// Build a labeled contact sheet from a folder of images (jpg/png) for visual
// curation of stock candidates or installed assets.
//
// Usage (from the repo root):
//   node .claude/skills/stock-image-assets/scripts/contact-sheet.js <imgDir> <out.png> [bgColor] [cols]
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(process.cwd(), 'node_modules', 'sharp'));

const [dir, out, bg = '#e8e8f0', colsArg] = process.argv.slice(2);
if (!dir || !out) {
  console.error('Usage: node contact-sheet.js <imgDir> <out.png> [bgColor] [cols]');
  process.exit(1);
}
const cols = Number(colsArg) || 7;

(async () => {
  const files = fs.readdirSync(dir).filter(f => /\.(png|jpe?g)$/i.test(f)).sort();
  const cell = 160, rows = Math.ceil(files.length / cols);
  const comps = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const buf = await sharp(path.join(dir, files[i])).resize(cell - 20, cell - 26, { fit: 'inside' }).png().toBuffer();
      const m = await sharp(buf).metadata();
      comps.push({
        input: buf,
        left: (i % cols) * cell + Math.round((cell - m.width) / 2),
        top: Math.floor(i / cols) * cell + 16 + Math.round((cell - 26 - m.height) / 2),
      });
      const svg = `<svg width="${cell}" height="16"><text x="4" y="12" font-size="10" fill="#0a0" font-family="monospace">${files[i].slice(0, 24)}</text></svg>`;
      comps.push({ input: Buffer.from(svg), left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
    } catch (e) { /* skip unreadable file */ }
  }
  await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: bg } })
    .composite(comps).png().toFile(out);
  console.log(out, `${files.length} images`);
})();
