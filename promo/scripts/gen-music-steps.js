/**
 * Generates the mobile "3 quick steps" promo music bed (no samples, no deps):
 * an upbeat 104 BPM tech-promo track in D minor. Dm9 / Bbmaj7 / Gm7 / A7sus4
 * pad swells, a rounded square-wave bass pumping eighths through light drive,
 * four-on-the-floor kick with clap on 2 & 4, offbeat hats plus a 16th shaker,
 * a detuned-saw pluck motif with a quarter-note feedback echo, bell accents in
 * the final section, and white-noise risers cresting at 2.5s / 11s / 20.5s
 * with a soft boom right after each crest (the video's step transitions land
 * at frames 75 / 330 / 615 @ 30fps). 31.5s total: 30s of video + 1.5s tail
 * for the fade. Writes public/music-steps.wav (convert to m4a with ffmpeg).
 *
 * Run from promo/: node scripts/gen-music-steps.js
 */
const fs = require("fs");
const path = require("path");

const SR = 44100;
const BPM = 104;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const DUR = 31.5;
const N = Math.round(SR * DUR);
const T0 = 2.5; // rhythm section enters at the first step transition
const CUT = 28.5; // drums/bass stop here so the outro breathes
const BARS = 12; // main groove bars, T0 + 12 * BAR = 30.19s

// Melodic layers, drums, and pluck kept separate so the sidechain duck only
// pumps the musical bed, not the drums/FX themselves.
const mL = new Float64Array(N); // pad + bass + bells
const mR = new Float64Array(N);
const dL = new Float64Array(N); // kick, clap, hats, shaker, risers, impacts
const dR = new Float64Array(N);
const pL = new Float64Array(N); // pluck lead (gets its own echo pass)
const pR = new Float64Array(N);
const duck = new Float64Array(N).fill(1);

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Seeded LCG so every render is bit-identical.
let seed = 1337;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

// Dm9 / Bbmaj7 / Gm7 / A7sus4 — one bar each, cycling.
const CHORDS = [
  [50, 57, 60, 64], // Dm9 (D A C E)
  [53, 58, 62, 69], // Bbmaj7 (F Bb D A)
  [50, 55, 58, 65], // Gm7 (D G Bb F)
  [52, 57, 62, 67], // A7sus4 (E A D G)
];
const BASS_ROOTS = [38, 34, 31, 33]; // D2, Bb1, G1, A1
const sectionOf = (bar) => (bar < 4 ? "A" : bar < 8 ? "B" : "C");

// ---------- Pad (wide, airy, swells once per bar) ----------
const padSegs = [{ s: 0, e: T0, ci: 0, g: 0.72 }];
for (let bar = 0; bar < BARS; bar++) {
  const g = sectionOf(bar) === "A" ? 0.8 : sectionOf(bar) === "B" ? 0.95 : 1.05;
  padSegs.push({ s: T0 + bar * BAR, e: T0 + (bar + 1) * BAR, ci: bar % 4, g });
}
padSegs.push({ s: T0 + BARS * BAR, e: DUR, ci: 0, g: 0.9 }); // Dm resolve
for (const seg of padSegs) {
  const relEnd = Math.min(seg.e + 0.9, DUR);
  CHORDS[seg.ci].forEach((midi, ni) => {
    const f = mtof(midi);
    const det = ni === 0 ? 0 : 0.002;
    const phase = ni * 2.1;
    for (let i = Math.floor(seg.s * SR); i < relEnd * SR && i < N; i++) {
      const t = i / SR;
      const local = t - seg.s;
      const att = Math.min(1, local / 0.45);
      const rel = t > seg.e ? Math.max(0, 1 - (t - seg.e) / 0.9) : 1;
      const trem = 1 + 0.07 * Math.sin(2 * Math.PI * 0.35 * t + phase);
      const env = 0.042 * seg.g * att * rel * trem;
      const wob = 0.1 * Math.sin(2 * Math.PI * 0.21 * t + phase);
      const fL = f * (1 - det);
      const fR = f * (1 + det);
      mL[i] +=
        env *
        (Math.sin(2 * Math.PI * fL * t + wob) +
          0.38 * Math.sin(2 * Math.PI * 2 * fL * t) +
          0.16 * Math.sin(2 * Math.PI * 3 * fL * t) +
          0.06 * Math.sin(2 * Math.PI * 4 * fL * t));
      mR[i] +=
        env *
        (Math.sin(2 * Math.PI * fR * t + wob) +
          0.38 * Math.sin(2 * Math.PI * 2 * fR * t) +
          0.16 * Math.sin(2 * Math.PI * 3 * fR * t) +
          0.06 * Math.sin(2 * Math.PI * 4 * fR * t));
    }
  });
  // Airy breath layer: lowpassed noise swelling with the chord.
  let lp = 0;
  for (let i = Math.floor(seg.s * SR); i < relEnd * SR && i < N; i++) {
    const t = i / SR;
    const local = t - seg.s;
    const att = Math.min(1, local / 0.6);
    const rel = t > seg.e ? Math.max(0, 1 - (t - seg.e) / 0.9) : 1;
    lp += 0.16 * (rand() * 2 - 1 - lp);
    const v = 0.01 * seg.g * att * rel * lp;
    mL[i] += v;
    mR[i] += v * 0.85;
  }
}

// ---------- Bass (rounded square, light drive, pumping eighths) ----------
const BASS_VEL = [1, 0.62, 0.82, 0.66, 0.92, 0.62, 0.85, 0.7];
for (let bar = 0; bar < BARS; bar++) {
  const root = mtof(BASS_ROOTS[bar % 4]);
  for (let k = 0; k < 8; k++) {
    const s = T0 + bar * BAR + k * (BEAT / 2);
    if (s >= CUT) continue;
    const vel = BASS_VEL[k];
    const len = 0.26;
    for (let i = Math.floor(s * SR); i < (s + len) * SR && i < N; i++) {
      const t = i / SR - s;
      const gate = Math.min(1, Math.max(0, (len - t) / 0.03));
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 6) * gate;
      const raw =
        Math.sin(2 * Math.PI * root * t) +
        0.3 * Math.sin(2 * Math.PI * 3 * root * t) +
        0.14 * Math.sin(2 * Math.PI * 5 * root * t);
      const v = 0.16 * vel * env * Math.tanh(1.7 * raw);
      mL[i] += v;
      mR[i] += v;
    }
  }
}

// ---------- Kick (four on the floor) + sidechain ----------
for (let bar = 0; bar < BARS; bar++) {
  for (let b = 0; b < 4; b++) {
    const s = T0 + bar * BAR + b * BEAT;
    if (s >= CUT) continue;
    let phi = 0;
    for (let i = Math.floor(s * SR); i < (s + 0.4) * SR && i < N; i++) {
      const t = i / SR - s;
      const f = 160 * Math.exp(-t * 28) + 46;
      phi += (2 * Math.PI * f) / SR;
      const v =
        0.5 * Math.min(1, t / 0.002) * Math.exp(-t * 10) * Math.sin(phi) +
        0.22 * Math.exp(-t * 350) * (rand() * 2 - 1);
      dL[i] += v;
      dR[i] += v;
    }
    for (let i = Math.floor(s * SR); i < (s + 0.5) * SR && i < N; i++) {
      const t = i / SR - s;
      duck[i] = Math.min(duck[i], 1 - 0.42 * Math.exp(-t * 8));
    }
  }
}

// ---------- Clap on 2 & 4 (from section B) ----------
for (let bar = 4; bar < BARS; bar++) {
  for (const b of [1, 3]) {
    const s = T0 + bar * BAR + b * BEAT;
    if (s >= CUT) continue;
    for (const [off, dec, amp] of [
      [0, 180, 0.5],
      [0.011, 180, 0.42],
      [0.023, 180, 0.36],
      [0.03, 14, 0.3], // body tail
    ]) {
      let prevL = 0;
      let prevR = 0;
      const ss = s + off;
      for (let i = Math.floor(ss * SR); i < (ss + 0.28) * SR && i < N; i++) {
        const t = i / SR - ss;
        const nL = rand() * 2 - 1;
        const nR = rand() * 2 - 1;
        const hpL = nL - prevL;
        const hpR = nR - prevR;
        prevL = nL;
        prevR = nR;
        const e = 0.16 * amp * Math.exp(-t * dec);
        dL[i] += e * hpL;
        dR[i] += e * hpR;
      }
    }
  }
}

// ---------- Offbeat hats (all sections) ----------
let hatCount = 0;
for (let bar = 0; bar < BARS; bar++) {
  for (let b = 0; b < 4; b++) {
    const s = T0 + bar * BAR + (b + 0.5) * BEAT;
    if (s >= CUT) continue;
    const panR = hatCount++ % 2 === 0 ? 0.62 : 0.38;
    const vel = 0.8 + 0.4 * rand();
    let prev = 0;
    for (let i = Math.floor(s * SR); i < (s + 0.08) * SR && i < N; i++) {
      const t = i / SR - s;
      const n = rand() * 2 - 1;
      const hp = n - prev;
      prev = n;
      const v = 0.05 * vel * Math.exp(-t * 55) * hp;
      dL[i] += v * (1 - panR);
      dR[i] += v * panR;
    }
  }
}

// ---------- 16th shaker with velocity pattern (sections B and C) ----------
const SHK_VEL = [0.5, 0.75, 1, 0.75];
for (let bar = 4; bar < BARS; bar++) {
  const base = sectionOf(bar) === "C" ? 0.038 : 0.03;
  for (let k = 0; k < 16; k++) {
    const s = T0 + bar * BAR + k * (BEAT / 4);
    if (s >= CUT) continue;
    const vel = SHK_VEL[k % 4] * (0.85 + 0.3 * rand());
    let prev = 0;
    for (let i = Math.floor(s * SR); i < (s + 0.045) * SR && i < N; i++) {
      const t = i / SR - s;
      const n = rand() * 2 - 1;
      const hp = n - prev;
      prev = n;
      const v = base * vel * Math.exp(-t * 95) * hp;
      dL[i] += v * 0.45;
      dR[i] += v * 0.55;
    }
  }
}

// ---------- Pluck lead (two detuned saws) ----------
const addPluck = (s, midi, vel, decay = 5.5, len = 0.55) => {
  const f0 = mtof(midi);
  for (const side of [-1, 1]) {
    const f = f0 * (1 + 0.004 * side);
    const panR = side < 0 ? 0.38 : 0.62;
    for (let i = Math.floor(s * SR); i < (s + len) * SR && i < N; i++) {
      const t = i / SR - s;
      const env = Math.min(1, t / 0.003) * Math.exp(-t * decay);
      let saw = 0;
      for (let n = 1; n <= 7; n++) saw += Math.sin(2 * Math.PI * n * f * t) / n;
      const v = 0.055 * vel * env * saw;
      pL[i] += v * (1 - panR);
      pR[i] += v * panR;
    }
  }
};
// Two-bar motif in D minor pentatonic (+9th), eighth-note slots 0..15.
const MOTIF = [
  [0, 69, 1],
  [3, 72, 0.8],
  [4, 74, 0.9],
  [7, 72, 0.7],
  [8, 69, 0.85],
  [11, 67, 0.7],
  [12, 65, 0.8],
  [14, 67, 0.65],
];
const MOTIF_EXTRA = [
  [2, 77, 0.5],
  [6, 76, 0.55],
  [10, 74, 0.6],
  [15, 72, 0.5],
];
for (let pair = 0; pair < BARS / 2; pair++) {
  const barStart = pair * 2;
  const sect = sectionOf(barStart);
  const notes = sect === "A" ? MOTIF : MOTIF.concat(MOTIF_EXTRA);
  for (const [slot, midi, vel] of notes) {
    const s = T0 + barStart * BAR + slot * (BEAT / 2);
    if (s >= 28.2) continue;
    addPluck(s, midi, vel);
    if (sect === "C" && slot % 4 === 0) addPluck(s, midi + 12, vel * 0.45);
  }
}
// Intro teaser and soft outro plucks (last 3s: pad + pluck only).
addPluck(1.12, 69, 0.4, 3.2, 1.2);
addPluck(1.82, 74, 0.5, 3.2, 1.2);
addPluck(28.85, 69, 0.45, 3, 1.5);
addPluck(29.7, 65, 0.4, 3, 1.5);
addPluck(30.55, 62, 0.5, 2.6, 1.5);
// Quarter-note feedback echo with a light cross-bleed for width.
const D = Math.floor(BEAT * SR);
for (let i = D; i < N; i++) {
  pL[i] += pL[i - D] * 0.28 + pR[i - D] * 0.08;
  pR[i] += pR[i - D] * 0.28 + pL[i - D] * 0.08;
}

// ---------- Bell accents (section C, bar downbeats) ----------
for (let bar = 8; bar < BARS; bar++) {
  const s = T0 + bar * BAR;
  if (s >= CUT) continue;
  const f = mtof(BASS_ROOTS[bar % 4] + 36);
  const panR = bar % 2 === 0 ? 0.6 : 0.4;
  for (let i = Math.floor(s * SR); i < (s + 1.4) * SR && i < N; i++) {
    const t = i / SR - s;
    const att = Math.min(1, t / 0.002);
    const v =
      0.05 *
      att *
      (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 3) +
        0.45 * Math.sin(2 * Math.PI * 2.005 * f * t) * Math.exp(-t * 5) +
        0.3 * Math.sin(2 * Math.PI * 2.757 * f * t) * Math.exp(-t * 8));
    mL[i] += v * (1 - panR);
    mR[i] += v * panR;
  }
}

// ---------- Risers cresting at the step transitions ----------
for (const [rs, re] of [
  [0.7, 2.5],
  [9.0, 11.0],
  [18.4, 20.5],
]) {
  let phi = 0;
  let hpPrevL = 0;
  let hpPrevR = 0;
  for (let i = Math.floor(rs * SR); i < (re + 0.18) * SR && i < N; i++) {
    const t = i / SR;
    const nL = rand() * 2 - 1;
    const nR = rand() * 2 - 1;
    const hpL = nL - hpPrevL;
    const hpR = nR - hpPrevR;
    hpPrevL = nL;
    hpPrevR = nR;
    let ampN;
    let ampS;
    let prog;
    if (t <= re) {
      prog = Math.max(0, (t - rs) / (re - rs));
      ampN = 0.15 * Math.pow(prog, 2.6);
      ampS = 0.05 * Math.pow(prog, 2);
    } else {
      prog = 1;
      const g = Math.exp(-(t - re) * 30);
      ampN = 0.15 * g;
      ampS = 0.05 * g;
    }
    const f = 160 * Math.pow(5.5, prog);
    phi += (2 * Math.PI * f) / SR;
    const sw = ampS * Math.sin(phi);
    dL[i] += ampN * hpL + sw;
    dR[i] += ampN * hpR + sw;
  }
}

// ---------- Soft impacts right after each crest ----------
for (const s of [2.52, 11.02, 20.52]) {
  let phi = 0;
  let lp = 0;
  for (let i = Math.floor(s * SR); i < (s + 1.1) * SR && i < N; i++) {
    const t = i / SR - s;
    const f = 95 * Math.exp(-t * 16) + 38;
    phi += (2 * Math.PI * f) / SR;
    lp += 0.18 * (rand() * 2 - 1 - lp);
    const v =
      0.42 * Math.min(1, t / 0.004) * Math.exp(-t * 3.2) * Math.sin(phi) +
      0.2 * Math.exp(-t * 11) * lp;
    dL[i] += v;
    dR[i] += v;
  }
  for (let i = Math.floor(s * SR); i < (s + 0.45) * SR && i < N; i++) {
    const t = i / SR - s;
    duck[i] = Math.min(duck[i], 1 - 0.5 * Math.exp(-t * 6));
  }
}

// ---------- Mix, master, write ----------
let peak = 0;
const L = new Float64Array(N);
const R = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fadeIn = Math.min(1, t / 0.05);
  const fadeOut = Math.min(1, Math.max(0, (DUR - t) / 1.5));
  L[i] = Math.tanh((dL[i] + (mL[i] + pL[i]) * duck[i]) * 1.12) * fadeIn * fadeOut;
  R[i] = Math.tanh((dR[i] + (mR[i] + pR[i]) * duck[i]) * 1.12) * fadeIn * fadeOut;
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
const out = path.join(__dirname, "..", "public", "music-steps.wav");
fs.writeFileSync(out, buf);
console.log(`wrote ${out} (${DUR.toFixed(1)}s, peak-normalized to 0.92)`);
