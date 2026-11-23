/**
 * Puts the rack cut's score into the rendered picture without re-encoding
 * either stream (see mux-features.js for why the picture renders muted).
 *
 *   node scripts/mux-rack.js [video.mp4] [out.mp4]
 * Defaults: out/open-screenshot-generator-promo-rack-video.mp4 ->
 *           out/open-screenshot-generator-promo-rack.mp4
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const video = path.resolve(process.argv[2] || path.join(root, "out", "open-screenshot-generator-promo-rack-video.mp4"));
const out = path.resolve(process.argv[3] || path.join(root, "out", "open-screenshot-generator-promo-rack.mp4"));
const bed = path.join(root, "public", "rack", "score.m4a");

for (const file of [video, bed]) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}
const tmp = out + ".part.mp4";
const run = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-i", bed, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", "-shortest", tmp],
  { encoding: "utf8" }
);
if (run.status !== 0) throw new Error(`ffmpeg could not mux: ${run.stderr}`);
fs.renameSync(tmp, out);
if (video !== out && path.basename(video).endsWith("-video.mp4")) fs.unlinkSync(video);
console.log(`wrote ${path.relative(process.cwd(), out)}`);
