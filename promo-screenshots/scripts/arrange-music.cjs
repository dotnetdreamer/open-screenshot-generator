/**
 * The film's music: promo/public/intro.mp3 (a supplied track, the same one the
 * PromoFeatures reel uses; check its licence before publishing), arranged to the
 * film. Nothing is synthesised or stretched: two cuts, then the track plays on to
 * its final hit, which lands on the clap.
 *
 * The track, as promo/scripts/arrange-music-features.js measured it (bar = 2.0 s
 * at 120 BPM, transients at 0.0432 + 2.0002 n s):
 *   bars 0-3 quiet build, no drums | 4-6 the lift, a crash on bar 4, 5 sounds like 4,
 *   6 rises | 7 the break | 8-15 the groove, ending on a fill | 16-23 the groove,
 *   brighter, ending on a fill | 24 the final hit, then its own fade
 *
 * The film (assets/film/timing.js): a bar is 2.0 s and film bar k starts at
 * 0.5 + 2 k. Screen k's pan starts on film bar k.
 *
 *   film 0.0-0.5  track bar 3's last beat   the pickup, as the camera cranes up
 *   film bar 0    track bar 4               the crash as it lands on screen 1
 *   film bar 1    track bar 6               the rise under screen 2 (5 is like 4: skipped)
 *   film bar 2-   track bar 8 to the end    the drop as it pans to screen 3, both groove
 *                                           phrases, the whip on bar 16 (track 22), the
 *                                           fill under the push in, and the final hit
 *                                           (track 24) on film bar 18, the clap
 *
 * Every downbeat lands 10 ms after its film bar (sound just after picture). Each
 * cut is an equal power crossfade over the 30 ms before its downbeat. Loudness
 * -14 LUFS, true peak under -1 dBTP, as the PromoFeatures bed.
 *
 * Run from promo-screenshots/: node scripts/arrange-music.cjs
 * Writes assets/audio/music.m4a. Needs ffmpeg on PATH.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "..", "promo", "public", "intro.mp3");
const OUT = path.join(__dirname, "..", "assets", "audio", "music.m4a");
const SR = 48000;
const CH = 2;

const BAR_S = 240 / 119.988;
const beatAt = (n) => 0.0432 + BAR_S * n;

const FILM_BAR0 = 0.5;
const FILM_BAR = 2.0;
const FILM_END = 40.0;
const LATE = 0.01;
const XFADE = 0.03;
const GUARD = 0.002;

/** Film bar, the track's bar on it, and for how many bars (null: to the end of the track). */
const SEGMENTS = [
  { film: 0, track: 4, bars: 1 },
  { film: 1, track: 6, bars: 1 },
  { film: 2, track: 8, bars: null },
];

function decode(file) {
  const tmp = path.join(os.tmpdir(), `arrange-${process.pid}.wav`);
  const run = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-ac", String(CH), "-ar", String(SR), "-c:a", "pcm_s24le", tmp], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffmpeg could not read ${file}: ${run.stderr}`);
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") {
      const end = Math.min(buf.length, at + 8 + size);
      const count = Math.floor((end - at - 8) / 3);
      const out = new Float32Array(count);
      for (let i = 0, o = at + 8; i < count; i += 1, o += 3) out[i] = buf.readIntLE(o, 3) / 8388608;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`No audio in the WAV ffmpeg made from ${file}`);
}

const src = decode(SRC);
const srcFrames = src.length / CH;
const outFrames = Math.round(FILM_END * SR);
const out = new Float32Array(outFrames * CH);

const fadeInGain = (p) => Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, p)));
const fadeOutGain = (p) => Math.cos((Math.PI / 2) * Math.min(1, Math.max(0, p)));

function place({ from, to, at }, { inLen = 0, outLen = 0 } = {}) {
  const start = Math.round(at * SR);
  const srcStart = Math.round(from * SR);
  const len = Math.min(Math.round((to - from) * SR), outFrames - start, srcFrames - srcStart);
  const inN = Math.round(inLen * SR);
  const outN = Math.round(outLen * SR);
  for (let i = 0; i < len; i += 1) {
    let g = 1;
    if (inN && i < inN) g *= fadeInGain(i / inN);
    if (outN && i >= len - outN) g *= fadeOutGain((i - (len - outN)) / outN);
    const o = (start + i) * CH;
    const s = (srcStart + i) * CH;
    out[o] += src[s] * g;
    out[o + 1] += src[s + 1] * g;
  }
}

SEGMENTS.forEach((segment, index) => {
  const first = index === 0;
  const last = index === SEGMENTS.length - 1;
  const downbeat = FILM_BAR0 + segment.film * FILM_BAR + LATE;
  // the first segment starts at film 0 with the pickup that leads into its downbeat
  const lead = first ? downbeat : XFADE + GUARD;
  const from = beatAt(segment.track) - lead;
  const to = last ? srcFrames / SR : beatAt(segment.track + segment.bars) - GUARD;
  place({ from, to, at: downbeat - lead }, { inLen: first ? 0.005 : XFADE, outLen: last ? 0 : XFADE });
  console.log(`film ${downbeat.toFixed(3)} s <- track bar ${segment.track} (${beatAt(segment.track).toFixed(3)} s)`);
});

// the end card holds 3.5 s on the final hit's ring; fade the last 1.5 s to silence
const tailN = Math.round(1.5 * SR);
for (let i = 0; i < tailN; i += 1) {
  const g = Math.cos((Math.PI / 2) * (i / tailN));
  const o = (outFrames - tailN + i) * CH;
  out[o] *= g;
  out[o + 1] *= g;
}

const tmp = path.join(os.tmpdir(), `one-take-music-${process.pid}.wav`);
writeWavF32(tmp, out, SR, CH);
const { lufs, peak } = measure(tmp);
// half a dB of room under -1 dBTP, because the AAC encode adds a little to the peaks
const gain = Math.min(-14 - lufs, -1.5 - peak);
console.log(`measured ${lufs.toFixed(1)} LUFS, true peak ${peak.toFixed(1)} dBTP, applying ${gain.toFixed(2)} dB`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const enc = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "aac", "-b:a", "256k", "-f", "mp4", OUT], { encoding: "utf8" });
fs.unlinkSync(tmp);
if (enc.status !== 0) throw new Error(`ffmpeg could not write ${OUT}: ${enc.stderr}`);
console.log(`wrote ${OUT}, ${FILM_END.toFixed(1)} s`);

function measure(file) {
  const ebur = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const summary = ebur.status === 0 ? ebur.stderr.slice(ebur.stderr.lastIndexOf("Summary:")) : "";
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(lufs) || !Number.isFinite(peak)) throw new Error(`Could not read loudness:\n${summary}`);
  return { lufs, peak };
}

function writeWavF32(file, data, sampleRate, channels) {
  const bytes = data.length * 4;
  const header = Buffer.alloc(58);
  header.write("RIFF", 0);
  header.writeUInt32LE(50 + bytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(18, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 4, 28);
  header.writeUInt16LE(channels * 4, 32);
  header.writeUInt16LE(32, 34);
  header.writeUInt16LE(0, 36);
  header.write("fact", 38);
  header.writeUInt32LE(4, 42);
  header.writeUInt32LE(data.length / channels, 46);
  header.write("data", 50);
  header.writeUInt32LE(bytes, 54);
  fs.writeFileSync(file, Buffer.concat([header, Buffer.from(data.buffer, data.byteOffset, bytes)]));
}
