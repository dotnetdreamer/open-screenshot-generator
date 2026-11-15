/**
 * Merges every public/features2/<folder>/rects.json the capture scripts wrote
 * into src/features/rects.generated.ts, so the film's cameras, rings and cursor
 * can name a control instead of carrying pixel numbers. Rects are CSS px of the
 * 1440 x 900 capture window.
 *
 *   node scripts/gather-rects.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "public", "features2");
const OUT = path.join(__dirname, "..", "src", "features", "rects.generated.ts");
const all = {};
// Every rects.json at any depth: design/rects.json names design/<file>, design/video/rects.json
// names design/video/<file>.
const rectFiles = [];
const findRects = (dir, rel) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) findRects(full, rel ? `${rel}/${name}` : name);
    else if (name === "rects.json" && rel) rectFiles.push({ file: full, folder: rel });
  }
};
if (fs.existsSync(ROOT)) findRects(ROOT, "");
for (const { file, folder } of rectFiles) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [png, rects] of Object.entries(data)) {
    const key = `${folder}/${png.replace(/^\.?\//, "")}`;
    all[key] = {};
    for (const [name, r] of Object.entries(rects || {})) {
      if (r && typeof r === "object" && ["x", "y", "w", "h"].every((k) => typeof r[k] === "number")) {
        all[key][name] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
      }
    }
  }
}
// Every footage file, so a beat can tell a capture that exists from one still to be made.
const files = [];
const walk = (dir, rel) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(full).isDirectory()) walk(full, r);
    else if (/\.(png|jpe?g|webp)$/i.test(name)) files.push(`features2/${r}`);
  }
};
if (fs.existsSync(ROOT)) walk(ROOT, "");
files.sort();

const body =
  "// Written by scripts/gather-rects.js from public/features2/*/rects.json. Do not edit by hand.\n" +
  "// Keys are \"<folder>/<file>.png\", values name a control's rect in CSS px of the 1440 x 900 capture.\n" +
  "export const RECTS: Record<string, Record<string, { x: number; y: number; w: number; h: number }>> = " +
  JSON.stringify(all, null, 2) +
  ";\n\n" +
  "export const FILES: ReadonlySet<string> = new Set(" +
  JSON.stringify(files, null, 2) +
  ");\n";
fs.writeFileSync(OUT, body);
console.log(`wrote ${Object.keys(all).length} rect sets and ${files.length} files to ${path.relative(process.cwd(), OUT)}`);
