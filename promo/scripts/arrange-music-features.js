/**
 * The music bed for the feature reel (PromoFeatures), arranged from
 * public/intro.mp3, a supplied track. Nothing is synthesized here: bars of the
 * track are laid end to end under the film's bars, so the film can run 92
 * seconds on a piece that is 60 long.
 *
 * What the track is, measured (bar = 2.0 s at 120 BPM, transients at
 * 0.043 + 2.0002 * n seconds), with how alike its bars sound (the spectrum
 * and the notes of each bar, compared on 17 November 2026):
 *
 *   bars 0-3    quiet build, no drums, a two bar loop (0 is like 2, 1 like 3)
 *   bars 4-6    the lift: a crash on its first beat; 5 sounds like 4, 6 rises
 *   bar 7       the break, back to the opening texture
 *   bars 8-15   the groove, first phrase, ending on a fill
 *   bars 16-23  the groove, second phrase, a little brighter, ending on a fill
 *   bar 24      the final hit, then its own fade, silent by about 55 s
 *
 * The groove is a two bar loop: every even bar of a phrase sounds like the
 * other even bars and every odd bar like the other odd ones (over 0.99 alike).
 * So going from the end of an odd bar to the start of a later even bar of the
 * same phrase is not heard, and that is the only kind of cut made inside the
 * groove. The other cuts land on the crash (bar 4), where the crash hides the
 * join as it does where the track itself goes from bar 3 into bar 4, skip bar
 * 5 (like bar 4) into the rise, or go from the rise straight into the drop.
 *
 *   film  0-1   track 0-1     the hook, on the quiet build (1 is like 3, so 1 into 4 is the track's own join)
 *   film  2     track 4       the reveal, on the crash
 *   film  3     track 6       the rise, under chapter one's card, straight into the drop
 *   film  4-9   track 8-13    chapter one, from the drop
 *   film 10-13  track 12-15   ... back two bars of the loop, ending on the fill
 *   film 14     track 4       chapter two's title, on the crash
 *   film 15-18  track 6-9     the rise, the break, the drop on film bar 17 (the upload lands)
 *   film 19-22  track 12-15   chapter two ends on the fill
 *   film 23-    track 4-      chapter three to the final hit (film 43) and its fade
 *
 * SEGMENTS says the same; src/features/style.ts T has the scenes on those
 * bars. Edit the two together. Every segment is placed so its first downbeat
 * lands 10 ms after its film bar, and the track's tempo (119.988 BPM) adds a
 * few ms more by the end of a long one.
 *
 * Each cut is an equal power crossfade over the 30 ms before the downbeat:
 * the outgoing bar is gone just before it, and the incoming downbeat starts at
 * full strength. Loudness is set to -14 LUFS with the true peak kept under
 * -1 dBTP; the master is already hot (it peaks at 0 dBFS), so the gain comes
 * out negative.
 *
 * Run from promo/: node scripts/arrange-music-features.js
 * Writes public/music-features-intro.m4a. Needs ffmpeg on PATH; Remotion's own
 * build works (it reads through WAV and measures loudness with loudnorm when
 * ebur128 is not there).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "public", "intro.mp3");
const OUT = path.join(__dirname, "..", "public", "music-features-intro.m4a");
const SR = 48000;
const CH = 2;

/** Source time of the transient on source bar n. */
const BAR_S = 240 / 119.988;
const beatAt = (n) => 0.0432 + BAR_S * n;

/** The film: 46 bars of 2.0 s, 2760 frames at 30 fps. */
const FILM_BAR = 2.0;
const FILM_END = 92.0;
/** How long after its film bar a segment's first downbeat lands. */
const LATE = 0.01;
const XFADE = 0.03; // seconds, ending just before the downbeat
const GUARD = 0.002; // the outgoing bar is silent this long before the downbeat

/** Film bar, the track's bar under it, and for how many bars (null: to the end of the track). */
const SEGMENTS = [
  { film: 0, track: 0, bars: 2 },
  { film: 2, track: 4, bars: 1 },
  { film: 3, track: 6, bars: 1 },
  { film: 4, track: 8, bars: 6 },
  { film: 10, track: 12, bars: 4 },
  { film: 14, track: 4, bars: 1 },
  { film: 15, track: 6, bars: 4 },
  { film: 19, track: 12, bars: 4 },
  { film: 23, track: 4, bars: null },
];
SEGMENTS.forEach((segment, index) => {
  const next = SEGMENTS[index + 1];
  if (next && segment.film + segment.bars !== next.film) throw new Error(`Segment at film bar ${segment.film} does not reach the next one`);
});

// --- reading the track ---------------------------------------------------------

/** Decoded through a 24 bit WAV: every ffmpeg build can write one. */
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

// --- laying the bars out ---------------------------------------------------------

const outFrames = Math.round(FILM_END * SR);
const out = new Float32Array(outFrames * CH);

/** Quarter sine, so two uncorrelated pieces keep their summed power through the cut. */
const fadeInGain = (p) => Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, p)));
const fadeOutGain = (p) => Math.cos((Math.PI / 2) * Math.min(1, Math.max(0, p)));

/** Copy source seconds [from, to) to film second `at`, with fades at either end. */
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
  // Film time of this segment's first downbeat, and the source time that plays there.
  const downbeat = segment.film * FILM_BAR + LATE;
  // The first starts on film second 0; the others start the crossfade's length early.
  const lead = first ? Math.min(downbeat, beatAt(segment.track)) : XFADE + GUARD;
  const from = beatAt(segment.track) - lead;
  const to = last ? srcFrames / SR : beatAt(segment.track + segment.bars) - GUARD;
  // A 5 ms fade in at the very top, in case the start lands on a non-zero sample.
  place({ from, to, at: downbeat - lead }, { inLen: first ? 0.005 : XFADE, outLen: last ? 0 : XFADE });
});

// The track fades itself out after its final hit; this only makes sure the last
// frame of the film is silence rather than the -47 dB the source is at by then.
const tailN = Math.round(1.5 * SR);
for (let i = 0; i < tailN; i += 1) {
  const g = Math.cos((Math.PI / 2) * (i / tailN));
  const o = (outFrames - tailN + i) * CH;
  out[o] *= g;
  out[o + 1] *= g;
}

// --- loudness, and the file ---------------------------------------------------------

const tmp = path.join(os.tmpdir(), `music-features-intro-${process.pid}.wav`);
writeWavF32(tmp, out, SR, CH);

const { lufs, peak } = measure(tmp);
const gain = Math.min(-14 - lufs, -1 - peak);
console.log(`measured ${lufs.toFixed(1)} LUFS, true peak ${peak.toFixed(1)} dBTP, applying ${gain.toFixed(2)} dB`);

const enc = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "aac", "-b:a", "256k", "-f", "mp4", OUT],
  { encoding: "utf8" }
);
fs.unlinkSync(tmp);
if (enc.status !== 0) throw new Error(`ffmpeg could not write ${OUT}: ${enc.stderr}`);
console.log(`wrote ${OUT}, ${FILM_END.toFixed(1)} s`);
console.log(`cuts at film bars ${SEGMENTS.slice(1).map((segment) => segment.film).join(", ")}`);

/** Integrated loudness and true peak: ebur128 where the build has it, loudnorm's own measurement where not. */
function measure(file) {
  const ebur = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const summary = ebur.status === 0 ? ebur.stderr.slice(ebur.stderr.lastIndexOf("Summary:")) : "";
  let lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  let peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  if (Number.isFinite(lufs) && Number.isFinite(peak)) return { lufs, peak };
  const norm = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(norm.stderr)?.[0];
  if (json) {
    const report = JSON.parse(json);
    lufs = Number(report.input_i);
    peak = Number(report.input_tp);
  }
  if (!Number.isFinite(lufs) || !Number.isFinite(peak)) throw new Error(`Could not read loudness:\n${summary || norm.stderr.slice(-2000)}`);
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
  header.writeUInt16LE(3, 20); // IEEE float
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
