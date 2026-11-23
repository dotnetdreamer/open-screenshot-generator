/**
 * Music and sound for the rack cut (composition PromoRack).
 *
 *   node scripts/arrange-music-rack.cjs   ->  public/rack/score.m4a  (30.0 s)
 *
 * The music is public/intro.mp3, the supplied track the feature reel also uses
 * (check its licence before publishing). Bars of it are laid end to end under
 * the film's bars; see scripts/arrange-music-features.js for what each bar of
 * the track is and which joins cannot be heard. In short: bars 0-3 are a quiet
 * build that loops every two bars, bar 4 is the crash, 5 sounds like 4, 6
 * rises, bars 8-15 are the groove (a two bar loop) ending on a fill, and bar 24
 * is the final hit followed by the track's own fade.
 *
 *   film  0-3   track 0-3    column one on the quiet build
 *   film  4-6   track 4-6    the crash on the cut to column two, the lift, the rise
 *   film  7-10  track 8-11   the drop as column two's last module is patched,
 *                            column three in the groove
 *   film 11-12  track 14-15  the pull back (11 into 14 is odd into even, unheard),
 *                            the whole rack through the fill
 *   film 13-    track 24-    the final hit on the card, and its fade
 *
 * Over the music, a few quiet effects that make the rack feel physical, all
 * noise and thumps with no pitch, so nothing clashes with the track: a key
 * click per letter the terminal types, a short air sweep as a module slides
 * in, a clack as it lands (always on a beat), the plug going in, a tick per
 * module as the signal runs down the cable, the pull back and the card.
 * Their timing comes from src/rack/style.ts (LAND_BEATS, SHOT, STEP, TYPE,
 * BEAT, FPS) and the names from src/rack/copy.ts, read out of the source, so
 * the film and the sound cannot drift apart. RACK_SFX_DB sets their level
 * against the music (default -15 dB); RACK_SFX_DB=off leaves the music alone.
 *
 * Loudness: -14 LUFS with the true peak under -1 dBTP, as the feature reel.
 * Needs ffmpeg on PATH.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const SRC = path.join(root, "public", "intro.mp3");
const OUT = path.join(root, "public", "rack", "score.m4a");
const SR = 48000;
const CH = 2;
/** Level of the effects against the music, in dB of RMS. RACK_SFX_DB=off leaves the music alone. */
const SFX = process.env.RACK_SFX_DB === "off" ? null : Number(process.env.RACK_SFX_DB ?? -15);

// --- the film's timing, read from its source --------------------------------------

const style = fs.readFileSync(path.join(root, "src/rack/style.ts"), "utf8");
const copy = fs.readFileSync(path.join(root, "src/rack/copy.ts"), "utf8");
const grab = (re, what) => {
  const m = style.match(re);
  if (!m) throw new Error(`Could not read ${what} from src/rack/style.ts`);
  return m;
};
const LAND_BEATS = grab(/LAND_BEATS = \[([\s\S]*?)\]/, "LAND_BEATS")[1].split(",").map((s) => s.trim()).filter(Boolean).map(Number);
const SHOT = {};
for (const m of grab(/export const SHOT = \{([\s\S]*?)\};/, "SHOT")[1].matchAll(/(\w+):\s*([\d.]+)/g)) SHOT[m[1]] = Number(m[2]);
const BEAT_F = Number(grab(/export const BEAT = (\d+);/, "BEAT")[1]);
const FPS = Number(grab(/export const FPS = (\d+);/, "FPS")[1]);
const STEP = {
  typeFrom: -BEAT_F,
  slideFrom: Number(grab(/slideFrom: (-?\d+),/, "STEP.slideFrom")[1]),
  patched: Math.round(BEAT_F * 0.75),
};
const TYPE = {
  maxPerChar: Number(grab(/maxPerChar: ([\d.]+)/, "TYPE.maxPerChar")[1]),
  within: Number(grab(/within: ([\d.]+)/, "TYPE.within")[1]),
};
const NAMES = [...copy.matchAll(/\{ name: "([^"]+)", sub:/g)].map((m) => m[1]);
const AFTER = (copy.match(/after: "([^"]+)"/) || [])[1] || "";
if (LAND_BEATS.length !== 18 || NAMES.length !== 18) throw new Error(`Expected 18 modules, got ${LAND_BEATS.length} beats and ${NAMES.length} names`);
if (BEAT_F / FPS !== 0.5) throw new Error(`The film's beat is ${BEAT_F / FPS} s; intro.mp3 needs 0.5 s (120 BPM)`);

// The same rounding as style.ts.
const beatF = (b) => Math.round(b * BEAT_F);
const sec = (frames) => frames / FPS;
const perChar = (text) => Math.min(TYPE.maxPerChar, TYPE.within / Math.max(1, text.length));
const FILM_END = sec(beatF(SHOT.END));

// --- the music ------------------------------------------------------------------------

/** Source time of the transient on bar n of intro.mp3 (measured: 119.988 BPM). */
const BAR_S = 240 / 119.988;
const barAt = (n) => 0.0432 + BAR_S * n;
const FILM_BAR = 2.0;
/** How long after its film bar a segment's first downbeat lands. */
const LATE = 0.01;
const XFADE = 0.03;
const GUARD = 0.002;

const SEGMENTS = [
  { film: 0, track: 0, bars: 4 },
  { film: 4, track: 4, bars: 3 },
  { film: 7, track: 8, bars: 4 },
  { film: 11, track: 14, bars: 2 },
  { film: 13, track: 24, bars: null },
];
SEGMENTS.forEach((segment, index) => {
  const next = SEGMENTS[index + 1];
  if (next && segment.film + segment.bars !== next.film) throw new Error(`Segment at film bar ${segment.film} does not reach the next one`);
});
// The film and the music must agree on where the big moments are.
const at = (b) => sec(beatF(b));
const expect = [
  [at(SHOT.COL2), 4 * FILM_BAR, "the cut to column two is not on the crash"],
  [at(SHOT.CARD), 13 * FILM_BAR, "the card is not on the final hit"],
  [at(SHOT.PULL), 11 * FILM_BAR, "the pull back does not cover the join into bar 14"],
];
for (const [a, b, why] of expect) if (Math.abs(a - b) > 1e-6) throw new Error(`${why} (${a} s against ${b} s)`);

function decode(file) {
  const tmp = path.join(os.tmpdir(), `arrange-rack-${process.pid}.wav`);
  const run = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-ac", String(CH), "-ar", String(SR), "-c:a", "pcm_s24le", tmp], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffmpeg could not read ${file}: ${run.stderr}`);
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "data") {
      const end = Math.min(buf.length, p + 8 + size);
      const count = Math.floor((end - p - 8) / 3);
      const out = new Float32Array(count);
      for (let i = 0, o = p + 8; i < count; i += 1, o += 3) out[i] = buf.readIntLE(o, 3) / 8388608;
      return out;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error(`No audio in the WAV ffmpeg made from ${file}`);
}

const src = decode(SRC);
const srcFrames = src.length / CH;
const outFrames = Math.round(FILM_END * SR);
const music = new Float32Array(outFrames * CH);

const fadeInGain = (q) => Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, q)));
const fadeOutGain = (q) => Math.cos((Math.PI / 2) * Math.min(1, Math.max(0, q)));

function place({ from, to, start: at0 }, { inLen = 0, outLen = 0 } = {}) {
  const start = Math.round(at0 * SR);
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
    music[o] += src[s] * g;
    music[o + 1] += src[s + 1] * g;
  }
}

SEGMENTS.forEach((segment, index) => {
  const first = index === 0;
  const last = index === SEGMENTS.length - 1;
  const downbeat = segment.film * FILM_BAR + LATE;
  const lead = first ? Math.min(downbeat, barAt(segment.track)) : XFADE + GUARD;
  const from = barAt(segment.track) - lead;
  const to = last ? srcFrames / SR : barAt(segment.track + segment.bars) - GUARD;
  place({ from, to, start: downbeat - lead }, { inLen: first ? 0.005 : XFADE, outLen: last ? 0 : XFADE });
});

// --- the effects ----------------------------------------------------------------------

const fx = new Float32Array(outFrames * CH);
let seed = 23112026;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rand() * 2 - 1;
const TAU = Math.PI * 2;

/** Adds voice(t) over [start, start + len) seconds at a pan of -1..1. */
function add(start, len, voice, { gain = 1, pan = 0 } = {}) {
  const from = Math.max(0, Math.floor(start * SR));
  const to = Math.min(outFrames, Math.floor((start + len) * SR));
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = from; i < to; i++) {
    const v = voice(i / SR - start);
    fx[i * CH] += v * gl;
    fx[i * CH + 1] += v * gr;
  }
}

/** A state variable filter for shaping noise. */
function svf() {
  let lp = 0;
  let bp = 0;
  return (x, f, q = 0.7) => {
    const g = 2 * Math.sin((Math.PI * Math.min(f, SR / 6)) / SR);
    lp += g * bp;
    const hp = x - lp - q * bp;
    bp += g * hp;
    return bp;
  };
}

const click = (t0, pan, gain) => {
  const bp = svf();
  const tone = 2600 + rand() * 2400;
  add(t0, 0.025, (t) => bp(noise(), tone, 0.3) * Math.exp(-t * 260), { gain, pan });
};

const panOf = (k) => [-0.35, 0, 0.35][Math.floor(k / 6)];

NAMES.forEach((name, k) => {
  const pan = panOf(k);
  const land = sec(beatF(LAND_BEATS[k]));
  // key clicks, one per letter of "/add <name>" as the terminal types it
  const cmd = `/add ${name}`;
  const typeStart = sec(beatF(LAND_BEATS[k]) + STEP.typeFrom);
  for (let c = 0; c < cmd.length; c++) click(typeStart + sec(c * perChar(cmd)), pan + (rand() - 0.5) * 0.3, 0.05 + rand() * 0.02);
  // the slide in, an airy sweep that ends as the module lands
  const slide = sec(-STEP.slideFrom);
  const sw = svf();
  add(land - slide, slide + 0.03, (t) => {
    const u = Math.min(1, t / slide);
    return sw(noise(), 600 + 2800 * u, 0.4) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.8)), 2);
  }, { gain: 0.06, pan });
  // the landing, on the beat: a short clack over a soft knock
  const ck = svf();
  add(land, 0.08, (t) => ck(noise(), 1900, 0.25) * Math.exp(-t * 55), { gain: 0.22, pan });
  add(land, 0.16, (t) => Math.sin(TAU * (70 * t + (90 / 45) * (1 - Math.exp(-t * 45)))) * Math.exp(-t * 26), { gain: 0.18, pan: pan * 0.5 });
  // the plug going in: two quick clicks
  const plug = sec(beatF(LAND_BEATS[k]) + STEP.patched);
  add(plug - 0.03, 0.02, (t) => noise() * Math.exp(-t * 320), { gain: 0.06, pan });
  add(plug, 0.025, (t) => noise() * Math.exp(-t * 260), { gain: 0.075, pan });
  // the wide shot's signal arriving at this module, a sixteenth note apart
  const sig = sec(beatF(SHOT.SIGNAL + k / 4) + BEAT_F / 4);
  const tk = svf();
  add(sig, 0.04, (t) => tk(noise(), 5200, 0.3) * Math.exp(-t * 120), { gain: 0.05, pan: (k % 6) / 5 - 0.5 });
});

// the last command, after the eighteenth
{
  const t0 = sec(beatF(LAND_BEATS[17]) + STEP.patched + 12);
  for (let c = 0; c < AFTER.length; c++) click(t0 + sec(c * 2), 0.2, 0.05);
}

// the pull back: a wide sweep down
{
  const len = sec(beatF(SHOT.WIDE) - beatF(SHOT.PULL)) + 0.15;
  const s = svf();
  add(at(SHOT.PULL), len, (t) => {
    const u = t / len;
    return s(noise(), 3400 * (1 - u) + 300, 0.3) * Math.sin(Math.PI * u);
  }, { gain: 0.16 });
}

// the card falling onto the final hit
{
  const len = 20 / FPS;
  const s = svf();
  add(at(SHOT.CARD) - len, len + 0.03, (t) => s(noise(), 1200 + 4200 * (1 - t / len), 0.4) * Math.pow(t / len, 2), { gain: 0.12 });
}

// --- the mix ---------------------------------------------------------------------------

const rms = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
};
const musicRms = rms(music);
const fxRms = rms(fx);
const fxGain = SFX === null ? 0 : (musicRms * Math.pow(10, SFX / 20)) / Math.max(fxRms, 1e-9);
const out = new Float32Array(outFrames * CH);
for (let i = 0; i < out.length; i++) out[i] = music[i] + fx[i] * fxGain;

// The track fades itself after its final hit; this only makes the last frame silent.
const tailN = Math.round(1.5 * SR);
for (let i = 0; i < tailN; i += 1) {
  const g = Math.cos((Math.PI / 2) * (i / tailN));
  const o = (outFrames - tailN + i) * CH;
  out[o] *= g;
  out[o + 1] *= g;
}

const tmp = path.join(os.tmpdir(), `rack-score-${process.pid}.wav`);
writeWavF32(tmp, out, SR, CH);
const { lufs, peak } = measure(tmp);
const gain = Math.min(-14 - lufs, -1 - peak);
console.log(`effects ${SFX === null ? "off" : `${SFX} dB against the music`}; measured ${lufs.toFixed(1)} LUFS, true peak ${peak.toFixed(1)} dBTP, applying ${gain.toFixed(2)} dB`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const enc = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-af", `volume=${gain.toFixed(2)}dB`, "-c:a", "aac", "-b:a", "256k", "-f", "mp4", OUT],
  { encoding: "utf8" }
);
fs.unlinkSync(tmp);
if (enc.status !== 0) throw new Error(`ffmpeg could not write ${OUT}: ${enc.stderr}`);
console.log(`wrote ${path.relative(process.cwd(), OUT)}, ${FILM_END.toFixed(1)} s; cuts in the music at film bars ${SEGMENTS.slice(1).map((s) => s.film).join(", ")}`);

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
