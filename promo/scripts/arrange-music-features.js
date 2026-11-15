/**
 * The music bed for the feature reel (PromoFeatures), arranged from
 * public/intro.mp3, a supplied track. Nothing is synthesized here: the track is
 * cut into three passes and joined on downbeats, so the film can run 118
 * seconds on a piece that is 60 long.
 *
 * What the track is, measured (bar = 2.0 s at 120 BPM, transients at
 * 0.043 + 2.0002 * n seconds):
 *
 *   bars 0-3    quiet build, no drums
 *   bars 4-6    the lift: a crash on its first beat, chords, little drumming
 *   bar 7       the break, back to the opening texture
 *   bars 8-15   the groove, first phrase, ending on a fill
 *   bars 16-23  the groove, second phrase, ending on a fill
 *   bar 24      the final hit, then its own fade, silent by about 55 s
 *
 * The film has three chapters, and each one opens on the lift's crash:
 *
 *   pass A  source  0.036 s to bar 24   film bars  0-23  hook, reveal, chapter 1
 *   pass B  source bar 4 to bar 16      film bars 24-35  chapter 2
 *   pass C  source bar 4 to the end     film bars 36-58  chapter 3 and the end
 *
 * Every join leaves on a fill and lands on the crash, which is a join the track
 * already makes once (bar 3 into bar 4), so it sounds written rather than cut.
 * The first 36 ms are trimmed so the transients land a fraction of a frame
 * after each 60 frame bar in src/features/style.ts. Edit the two together.
 *
 * Each join is an equal power crossfade over the 30 ms before the downbeat:
 * the outgoing pass is gone before its own bar 24 hit, and the incoming crash
 * starts at full strength. Loudness is set to -14 LUFS with the true peak kept
 * under -1 dBTP; the master is already hot (it peaks at 0 dBFS), so the gain
 * comes out negative.
 *
 * Run from promo/: node scripts/arrange-music-features.js
 * Writes public/music-features-intro.m4a. Needs ffmpeg on PATH.
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

/** The film is 3540 frames at 30 fps. */
const FILM_END = 118.0;
const TRIM = 0.036;
const XFADE = 0.03; // seconds, ending just before the downbeat
const GUARD = 0.002; // the outgoing pass is silent this long before the downbeat

function decode(file) {
  const run = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", file, "-ac", String(CH), "-ar", String(SR), "-f", "f32le", "-"],
    { maxBuffer: 1 << 30 }
  );
  if (run.status !== 0) throw new Error(`ffmpeg could not read ${file}: ${run.stderr}`);
  const buf = run.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

const src = decode(SRC);
const srcFrames = src.length / CH;

/**
 * The passes, in film time. `from`/`to` are source seconds, `at` is the film
 * second `from` lands on. `fadeIn`/`fadeOut` are film seconds where the
 * crossfades start and finish.
 */
const J1 = beatAt(24) - TRIM; // film time of film bar 24's downbeat
const passA = { from: TRIM, to: beatAt(24) - GUARD, at: 0 };
const passB = { from: beatAt(4) - XFADE - GUARD, to: beatAt(16) - GUARD, at: J1 - XFADE - GUARD };
const J2 = passB.at + (beatAt(16) - passB.from);
const passC = { from: beatAt(4) - XFADE - GUARD, to: srcFrames / SR, at: J2 - XFADE - GUARD };

const outFrames = Math.round(FILM_END * SR);
const out = new Float32Array(outFrames * CH);

/** Quarter sine, so two uncorrelated passes keep their summed power through the join. */
const fadeInGain = (p) => Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, p)));
const fadeOutGain = (p) => Math.cos((Math.PI / 2) * Math.min(1, Math.max(0, p)));

function place(pass, { inLen = 0, outLen = 0 } = {}) {
  const start = Math.round(pass.at * SR);
  const srcStart = Math.round(pass.from * SR);
  const len = Math.min(Math.round((pass.to - pass.from) * SR), outFrames - start, srcFrames - srcStart);
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

// A 5 ms fade in at the very top, in case the trim landed on a non-zero sample.
place(passA, { inLen: 0.005, outLen: XFADE });
place(passB, { inLen: XFADE, outLen: XFADE });
place(passC, { inLen: XFADE });

// The track fades itself out after its final hit; this only makes sure the last
// frame of the film is silence rather than the -47 dB the source is at by then.
const tailN = Math.round(1.5 * SR);
for (let i = 0; i < tailN; i += 1) {
  const g = Math.cos((Math.PI / 2) * (i / tailN));
  const o = (outFrames - tailN + i) * CH;
  out[o] *= g;
  out[o + 1] *= g;
}

// Write a float WAV, then measure it and encode with the gain that lands it.
const tmp = path.join(os.tmpdir(), `music-features-intro-${process.pid}.wav`);
writeWavF32(tmp, out, SR, CH);

const probe = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-nostats", "-i", tmp, "-af", "ebur128=peak=true", "-f", "null", "-"],
  { encoding: "utf8", maxBuffer: 1 << 26 }
);
const report = probe.stderr.slice(probe.stderr.lastIndexOf("Summary:"));
const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(report)?.[1]);
const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(report)?.[1]);
if (!Number.isFinite(lufs) || !Number.isFinite(peak)) throw new Error(`Could not read loudness:\n${report}`);
const gain = Math.min(-14 - lufs, -1 - peak);
console.log(`measured ${lufs.toFixed(1)} LUFS, true peak ${peak.toFixed(1)} dBTP, applying ${gain.toFixed(2)} dB`);

const enc = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "aac", "-b:a", "256k", "-f", "mp4", OUT],
  { encoding: "utf8" }
);
fs.unlinkSync(tmp);
if (enc.status !== 0) throw new Error(`ffmpeg could not write ${OUT}: ${enc.stderr}`);
console.log(`wrote ${OUT}`);
console.log(`joins at film ${J1.toFixed(3)} s (bar 24) and ${J2.toFixed(3)} s (bar 36)`);

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
