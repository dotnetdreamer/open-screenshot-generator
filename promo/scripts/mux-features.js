/**
 * Puts the arranged music bed into the rendered feature reel without
 * re-encoding either stream.
 *
 * Remotion re-encodes the audio it is given, and its AAC comes out about 58 ms
 * longer than the video with no edit list to account for the encoder's priming
 * samples, so every hit lands roughly 45 ms after its cut and the music goes
 * through a second lossy encode. Rendering the picture muted and copying
 * public/music-features-intro.m4a in beside it keeps the bed sample for sample
 * as scripts/arrange-music-features.js wrote it: downbeats 9 to 17 ms after
 * their frames.
 *
 *   node scripts/mux-features.js [video.mp4] [out.mp4]
 * Defaults: out/open-screenshot-generator-promo-features-video.mp4 ->
 *           out/open-screenshot-generator-promo-features.mp4
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const video = path.resolve(process.argv[2] || path.join(root, "out", "open-screenshot-generator-promo-features-video.mp4"));
const out = path.resolve(process.argv[3] || path.join(root, "out", "open-screenshot-generator-promo-features.mp4"));
const bed = path.join(root, "public", "music-features-intro.m4a");

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
