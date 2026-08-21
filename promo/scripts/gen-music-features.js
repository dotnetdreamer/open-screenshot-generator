/**
 * The music bed for the feature reel (PromoFeatures). Synthesized here from
 * nothing, like the other cuts, so the track is original and there is no
 * licence question to answer.
 *
 * 100 BPM in 4/4, which makes a bar exactly 2.4s. Every scene in
 * src/features/style.ts is a whole number of those bars, so every cut in the
 * film lands on a downbeat and the accents below can be written in bar numbers
 * rather than in a table of odd seconds.
 *
 *   0.0 - 4.8s    hook. Filtered pad, a soft pulse, four blips under the four
 *                 counters, and a short lift into the first beat.
 *   4.8 - 28.8s   act one. Half time kick, round bass, hats. Each 4.8s beat
 *                 adds a layer, so the act grows without a new idea.
 *   28.8 - 31.2s  the turn. Drums drop out, riser, impact on 31.2s.
 *   31.2 - 69.6s  the releases. Four on the floor, claps from bar 17, a pluck
 *                 motif with a quarter note echo, bells on the late downbeats.
 *   69.6 - 74.4s  the scoreboard. Ticks land with the rows.
 *   74.4 - 79.2s  outro. Drums stop, the pad resolves to Am, bells ring out.
 *
 * Run from promo/: node scripts/gen-music-features.js
 * Then: ffmpeg -i public/music-features.wav -c:a aac -b:a 192k public/music-features.m4a
 */
const fs = require("fs");
const path = require("path");

const SR = 44100;
const DUR = 80.7; // 79.2s of video plus a tail for the fade
const N = Math.round(SR * DUR);

const BPM = 100;
const BEAT = 60 / BPM; // 0.6s
const BAR = BEAT * 4; // 2.4s

const HOOK_END = 4.8; // act one starts
const TURN = 28.8; // the rail card, drums out
const ACT2 = 31.2; // the releases start
const SCORE = 69.6;
const OUTRO = 74.4;

/** Every scene cut, in seconds. Mirrors T in src/features/style.ts. */
const CUTS = [
  0, 4.8, 9.6, 14.4, 19.2, 24.0, 28.8, 31.2, 36.0, 40.8, 45.6, 50.4, 55.2, 60.0, 64.8, 69.6, 74.4,
];

const mL = new Float64Array(N); // pad, bass, bells
const mR = new Float64Array(N);
const dL = new Float64Array(N); // drums, risers, impacts, ticks
const dR = new Float64Array(N);
const pL = new Float64Array(N); // pluck, with its own echo pass
const pR = new Float64Array(N);
const duck = new Float64Array(N).fill(1);

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const idx = (t) => Math.max(0, Math.floor(t * SR));

// Seeded, so two renders of the same track are bit identical.
let seed = 20260821;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

// Am9 / Fmaj7 / Cmaj7 / G6. Brighter than the hero cut's D minor on purpose:
// this film is a list of good news.
const CHORDS = [
  [57, 60, 64, 71], // Am9
  [53, 60, 65, 69], // Fmaj7
  [55, 60, 64, 67], // Cmaj7
  [55, 59, 62, 69], // G6
];
const BASS_ROOTS = [33, 29, 36, 31]; // A1, F1, C2, G1

const barAt = (t) => Math.floor(t / BAR);
const barStart = (bar) => bar * BAR;
const BARS = Math.ceil(DUR / BAR);

// ===========================================================================
// Pad: runs the whole piece, thinner in the hook, widest in the releases
// ===========================================================================
for (let bar = 0; bar < BARS; bar++) {
  const s = barStart(bar);
  if (s >= DUR) break;
  const e = Math.min(s + BAR, DUR);
  // The outro holds the tonic rather than walking the progression on.
  const ci = s >= OUTRO ? 0 : bar % 4;
  const gain = s < HOOK_END ? 0.62 : s < TURN ? 0.9 : s < ACT2 ? 0.8 : s < OUTRO ? 1.05 : 0.95;
  CHORDS[ci].forEach((midi, ni) => {
    const f = mtof(midi);
    const det = ni === 0 ? 0 : 0.0021;
    const phase = ni * 1.9;
    const relEnd = Math.min(e + 0.9, DUR);
    for (let i = idx(s); i < relEnd * SR && i < N; i++) {
      const t = i / SR;
      const local = t - s;
      const att = Math.min(1, local / 0.5);
      const rel = t > e ? Math.max(0, 1 - (t - e) / 0.9) : 1;
      const trem = 1 + 0.06 * Math.sin(2 * Math.PI * 0.31 * t + phase);
      const env = 0.038 * gain * att * rel * trem;
      const wob = 0.09 * Math.sin(2 * Math.PI * 0.17 * t + phase);
      const voice = (fx) =>
        Math.sin(2 * Math.PI * fx * t + wob) +
        0.36 * Math.sin(2 * Math.PI * 2 * fx * t) +
        0.15 * Math.sin(2 * Math.PI * 3 * fx * t) +
        0.05 * Math.sin(2 * Math.PI * 4 * fx * t);
      mL[i] += env * voice(f * (1 - det));
      mR[i] += env * voice(f * (1 + det));
    }
  });
}

// ===========================================================================
// Hook: a soft pulse and four counter blips under the four numbers
// ===========================================================================
for (let k = 0; k < 8; k++) {
  const s = k * (BEAT / 2);
  if (s >= HOOK_END) break;
  for (let i = idx(s); i < (s + 0.5) * SR && i < N; i++) {
    const t = i / SR - s;
    const v = 0.16 * Math.exp(-t * 7) * Math.sin(2 * Math.PI * mtof(45) * t);
    mL[i] += v;
    mR[i] += v * 0.96;
  }
}
// The blips sit under Stat delays 46/55/64/73 frames, which is 1.53s to 2.43s.
for (const [i2, s] of [1.53, 1.83, 2.13, 2.43].entries()) {
  const f = mtof(76 + i2 * 3);
  for (let i = idx(s); i < (s + 0.5) * SR && i < N; i++) {
    const t = i / SR - s;
    const v =
      0.075 * Math.exp(-t * 9) * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * 2 * f * t));
    pL[i] += v * (i2 % 2 ? 0.7 : 1);
    pR[i] += v * (i2 % 2 ? 1 : 0.7);
  }
}

// ===========================================================================
// Drums
// ===========================================================================

/** Kick with a short pitch drop, plus the sidechain it opens. */
const addKick = (s, amp = 0.5) => {
  let phi = 0;
  for (let i = idx(s); i < (s + 0.4) * SR && i < N; i++) {
    const t = i / SR - s;
    const f = 160 * Math.exp(-t * 26) + 45;
    phi += (2 * Math.PI * f) / SR;
    const v =
      amp * Math.min(1, t / 0.002) * Math.exp(-t * 10) * Math.sin(phi) +
      0.2 * amp * Math.exp(-t * 340) * (rand() * 2 - 1);
    dL[i] += v;
    dR[i] += v;
  }
  for (let i = idx(s); i < (s + 0.5) * SR && i < N; i++) {
    const t = i / SR - s;
    duck[i] = Math.min(duck[i], 1 - 0.4 * Math.exp(-t * 8));
  }
};

const addHat = (s, vel = 1, panR = 0.5, decay = 55) => {
  let prev = 0;
  for (let i = idx(s); i < (s + 0.09) * SR && i < N; i++) {
    const t = i / SR - s;
    const n = rand() * 2 - 1;
    const hp = n - prev;
    prev = n;
    const v = 0.05 * vel * Math.exp(-t * decay) * hp;
    dL[i] += v * (1 - panR) * 2;
    dR[i] += v * panR * 2;
  }
};

const addClap = (s) => {
  for (const [off, dec, amp] of [
    [0, 175, 0.5],
    [0.011, 175, 0.42],
    [0.023, 175, 0.35],
    [0.031, 13, 0.3],
  ]) {
    let prevL = 0;
    let prevR = 0;
    const ss = s + off;
    for (let i = idx(ss); i < (ss + 0.3) * SR && i < N; i++) {
      const t = i / SR - ss;
      const nL = rand() * 2 - 1;
      const nR = rand() * 2 - 1;
      const hpL = nL - prevL;
      const hpR = nR - prevR;
      prevL = nL;
      prevR = nR;
      const e = 0.15 * amp * Math.exp(-t * dec);
      dL[i] += e * hpL;
      dR[i] += e * hpR;
    }
  }
};

// ---- act one: half time, one layer per 4.8s beat --------------------------
{
  const from = barAt(HOOK_END);
  const to = barAt(TURN);
  for (let bar = from; bar < to; bar++) {
    const s = barStart(bar);
    const age = (s - HOOK_END) / (TURN - HOOK_END); // 0 to 1 across the act
    addKick(s, 0.46);
    addKick(s + 2 * BEAT, 0.42);
    if (age > 0.18) addKick(s + 2.5 * BEAT, 0.24);
    for (let b = 0; b < 4; b++) {
      if (age > 0.36) addHat(s + (b + 0.5) * BEAT, 0.7 + 0.4 * rand(), b % 2 ? 0.62 : 0.38);
    }
    if (age > 0.55) addClap(s + 2 * BEAT);
  }
}

// ---- bass: eighths, act one softer than act two ---------------------------
const BASS_VEL = [1, 0.58, 0.82, 0.64, 0.92, 0.58, 0.84, 0.7];
for (let bar = barAt(HOOK_END); bar < barAt(OUTRO); bar++) {
  const s0 = barStart(bar);
  if (s0 >= TURN && s0 < ACT2) continue; // the turn is bass free
  const root = mtof(BASS_ROOTS[bar % 4]);
  const gain = s0 < TURN ? 0.13 : 0.175;
  for (let k = 0; k < 8; k++) {
    const s = s0 + k * (BEAT / 2);
    if (s >= OUTRO) break;
    const len = 0.25;
    for (let i = idx(s); i < (s + len) * SR && i < N; i++) {
      const t = i / SR - s;
      const gate = Math.min(1, Math.max(0, (len - t) / 0.03));
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 5.6) * gate;
      const raw =
        Math.sin(2 * Math.PI * root * t) +
        0.28 * Math.sin(2 * Math.PI * 3 * root * t) +
        0.12 * Math.sin(2 * Math.PI * 5 * root * t);
      const v = gain * BASS_VEL[k] * env * Math.tanh(1.8 * raw);
      mL[i] += v;
      mR[i] += v;
    }
  }
}

// ===========================================================================
// The turn: riser out of act one, impact on the release act
// ===========================================================================
{
  const start = TURN - 2.4;
  let phi = 0;
  let hpPrev = 0;
  for (let i = idx(start); i < idx(ACT2) && i < N; i++) {
    // Clamped, because idx() floors and the first sample can land a hair
    // before `start`: a negative base under a fractional power is NaN, and one
    // NaN sample takes the peak, the gain and the whole track with it.
    const t = Math.max(0, i / SR - start);
    const prog = t / (ACT2 - start);
    const n = rand() * 2 - 1;
    const hp = n - hpPrev;
    hpPrev = n;
    const f = 180 * Math.pow(7, prog);
    phi += (2 * Math.PI * f) / SR;
    const amp = 0.3 * Math.pow(prog, 2.2);
    dL[i] += amp * (0.5 * hp + 0.6 * Math.sin(phi));
    dR[i] += amp * (0.5 * hp + 0.6 * Math.sin(phi + 0.4));
  }
}
const addImpact = (s, amp = 0.55) => {
  let phi = 0;
  let lp = 0;
  for (let i = idx(s); i < (s + 1.8) * SR && i < N; i++) {
    const t = i / SR - s;
    const f = 90 * Math.exp(-t * 13) + 38;
    phi += (2 * Math.PI * f) / SR;
    lp += 0.16 * (rand() * 2 - 1 - lp);
    const v =
      amp * Math.min(1, t / 0.004) * Math.exp(-t * 2.4) * Math.sin(phi) +
      0.22 * amp * Math.exp(-t * 8) * lp;
    dL[i] += v;
    dR[i] += v;
  }
  for (let i = idx(s); i < (s + 0.6) * SR && i < N; i++) {
    const t = i / SR - s;
    duck[i] = Math.min(duck[i], 1 - 0.5 * Math.exp(-t * 5));
  }
};
addImpact(ACT2, 0.55);
addImpact(SCORE, 0.4);

// ===========================================================================
// The release act: four on the floor, claps, hats, pluck motif
// ===========================================================================
for (let bar = barAt(ACT2); bar < barAt(OUTRO); bar++) {
  const s0 = barStart(bar);
  for (let b = 0; b < 4; b++) addKick(s0 + b * BEAT, 0.5);
  for (const b of [1, 3]) addClap(s0 + b * BEAT);
  for (let k = 0; k < 8; k++) {
    if (k % 2 === 1) addHat(s0 + k * (BEAT / 2), 0.85 + 0.35 * rand(), k % 4 === 1 ? 0.62 : 0.38);
    else if (bar % 2 === 1) addHat(s0 + k * (BEAT / 2), 0.34, 0.5, 90);
  }
}

// Pluck motif: a detuned saw pair on the chord tones, one figure per bar.
const FIGURE = [0, 1.5, 2.5, 3]; // in beats
for (let bar = barAt(ACT2); bar < barAt(OUTRO); bar++) {
  const s0 = barStart(bar);
  const chord = CHORDS[bar % 4];
  FIGURE.forEach((beat, i) => {
    const s = s0 + beat * BEAT;
    if (s >= OUTRO) return;
    const midi = chord[(i + bar) % chord.length] + 12;
    const f = mtof(midi);
    for (let j = idx(s); j < (s + 0.55) * SR && j < N; j++) {
      const t = j / SR - s;
      const env = Math.min(1, t / 0.004) * Math.exp(-t * 6.5);
      const saw = (fx, d) => {
        const ph = ((fx * (1 + d) * t) % 1) - 0.5;
        return ph - 0.28 * Math.sin(2 * Math.PI * fx * t);
      };
      const v = 0.055 * env;
      pL[j] += v * saw(f, -0.0018);
      pR[j] += v * saw(f, 0.0018);
    }
  });
}

// Quarter note echo on the pluck bus only, so the pad stays dry.
{
  const D = Math.round(BEAT * SR);
  for (let i = D; i < N; i++) {
    pL[i] += pL[i - D] * 0.27 + pR[i - D] * 0.08;
    pR[i] += pR[i - D] * 0.27 + pL[i - D] * 0.08;
  }
}

// ===========================================================================
// Accents: a reverse swell into every cut, and ticks under the scoreboard
// ===========================================================================
for (const cut of CUTS) {
  if (cut === 0) continue;
  let prev = 0;
  for (let i = idx(cut - 0.28); i < idx(cut + 0.1) && i < N; i++) {
    const t = i / SR - (cut - 0.28);
    const n = rand() * 2 - 1;
    const hp = n - prev;
    prev = n;
    const env = 0.05 * Math.pow(Math.min(1, t / 0.28), 3);
    dL[i] += env * hp;
    dR[i] += env * hp * 0.92;
  }
}

// Ten ticks, one per scoreboard row, on the delays used in Bookends.tsx.
{
  const rows = [20, 26, 32, 38, 44, 62, 70, 78, 86, 94].map((f) => SCORE + f / 30);
  rows.forEach((s, i) => {
    const f = mtof(84 + (i > 4 ? 4 : 0) + (i % 3));
    for (let j = idx(s); j < (s + 0.25) * SR && j < N; j++) {
      const t = j / SR - s;
      const v = 0.035 * Math.exp(-t * 26) * Math.sin(2 * Math.PI * f * t);
      pL[j] += v * (i % 2 ? 0.75 : 1);
      pR[j] += v * (i % 2 ? 1 : 0.75);
    }
  });
}

// ===========================================================================
// Bells: late release beats and the outro
// ===========================================================================
const addBell = (s, midi, amp = 0.05, panR = 0.5) => {
  const f = mtof(midi);
  for (let i = idx(s); i < (s + 2.0) * SR && i < N; i++) {
    const t = i / SR - s;
    const att = Math.min(1, t / 0.002);
    const v =
      amp *
      att *
      (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.4) +
        0.44 * Math.sin(2 * Math.PI * 2.005 * f * t) * Math.exp(-t * 4.2) +
        0.28 * Math.sin(2 * Math.PI * 2.757 * f * t) * Math.exp(-t * 7));
    mL[i] += v * (1 - panR);
    mR[i] += v * panR;
  }
};
for (let bar = barAt(55.2); bar < barAt(OUTRO); bar++) {
  addBell(barStart(bar), BASS_ROOTS[bar % 4] + 36, 0.045, bar % 2 ? 0.4 : 0.6);
}
addBell(OUTRO, 81, 0.07, 0.45);
addBell(OUTRO + 2.4, 76, 0.055, 0.58);
addBell(OUTRO + 3.6, 69, 0.04, 0.5);

// ===========================================================================
// Mix, master, write
// ===========================================================================
let peak = 0;
const L = new Float64Array(N);
const R = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fadeIn = Math.min(1, t / 0.06);
  const fadeOut = Math.min(1, Math.max(0, (DUR - t) / 1.6));
  L[i] = Math.tanh((dL[i] + (mL[i] + pL[i]) * duck[i]) * 1.14) * fadeIn * fadeOut;
  R[i] = Math.tanh((dR[i] + (mR[i] + pR[i]) * duck[i]) * 1.14) * fadeIn * fadeOut;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = 0.92 / peak;

const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(2, 22); // stereo
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4);
}
const out = path.join(__dirname, "..", "public", "music-features.wav");
fs.writeFileSync(out, buf);
console.log(`wrote ${out} (${DUR.toFixed(1)}s, ${BPM} BPM, bar ${BAR}s, peak-normalized to 0.92)`);
