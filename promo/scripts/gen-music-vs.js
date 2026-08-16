/**
 * Generates the music bed for the "old way vs new way" promo (PromoVs). No
 * samples, no downloads: every voice is synthesized here, so the track is
 * original and the licence question never arises.
 *
 * Two acts, because the video has two:
 *   0.0 - 22.2s   the old way. A cold D pedal, a mechanical tick that speeds
 *                 up, a detuned minor-second rub that tightens, and a machine
 *                 clunk on each scene cut. No groove, no resolution.
 *   19.6 - 22.2s  riser into the turn, cresting exactly on the cut.
 *   22.2 - 52.6s  the new way. 126.3158 BPM (bar = 1.90s), so every one of the
 *                 eight 3.8s beats lands on a bar downbeat. Dm9 / Bbmaj7 /
 *                 Gm11 / F6 pad, driven bass, four on the floor, claps, hats,
 *                 a detuned-saw pluck motif with a quarter-note echo.
 *   52.6 - 58.0s  outro. Drums stop, the pad resolves to Dm, bells ring out.
 *
 * The beat times mirror T in src/vs/style.ts. Edit them together.
 * Run from promo/: node scripts/gen-music-vs.js
 */
const fs = require("fs");
const path = require("path");

const SR = 44100;
const DUR = 59.5; // 58s of video + 1.5s tail for the fade
const N = Math.round(SR * DUR);

const TURN = 22.2; // the cut from old to new
const GROOVE_END = 52.6; // drums stop, outro begins
const BPM = (4 * 60) / 1.9; // 126.3158, so BAR is exactly 1.90s
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = Math.round((GROOVE_END - TURN) / BAR); // 16

/** Old-act scene cuts (seconds), where the machine clunks land. */
const OLD_CUTS = [4.2, 8.8, 13.6, 17.6];

const mL = new Float64Array(N); // pad, bass, bells, drone
const mR = new Float64Array(N);
const dL = new Float64Array(N); // drums, ticks, risers, impacts
const dR = new Float64Array(N);
const pL = new Float64Array(N); // pluck lead (own echo pass)
const pR = new Float64Array(N);
const duck = new Float64Array(N).fill(1);

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Seeded LCG so every render is bit-identical.
let seed = 20260816;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const idx = (t) => Math.max(0, Math.floor(t * SR));

// ===========================================================================
// ACT ONE: the old way
// ===========================================================================

// ---------- Cold D pedal with a minor-second rub that tightens ----------
{
  const f0 = mtof(38); // D2
  for (let i = 0; i < idx(TURN + 0.4) && i < N; i++) {
    const t = i / SR;
    const att = Math.min(1, t / 1.6);
    const rel = t > TURN ? Math.max(0, 1 - (t - TURN) / 0.4) : 1;
    // The rub partial creeps in over the act, so the tension is felt building.
    const rub = 0.06 + 0.22 * Math.min(1, t / TURN);
    const drift = 0.5 * Math.sin(2 * Math.PI * 0.07 * t);
    const env = 0.06 * att * rel;
    const v =
      Math.sin(2 * Math.PI * f0 * t + drift) +
      0.5 * Math.sin(2 * Math.PI * 2 * f0 * t) +
      rub * Math.sin(2 * Math.PI * mtof(39) * t) + // Eb against D
      0.18 * Math.sin(2 * Math.PI * 3 * f0 * t);
    mL[i] += env * v;
    mR[i] += env * v * 0.94;
  }
}

// ---------- Mechanical tick, accelerating across the act ----------
{
  let t = 1.2;
  while (t < TURN - 0.2) {
    // Interval shrinks from 0.6s to 0.14s: the grind speeding up.
    const prog = Math.min(1, t / TURN);
    const gap = 0.6 - 0.46 * Math.pow(prog, 1.5);
    const accent = Math.abs((t / gap) % 4) < 1 ? 1 : 0.62;
    const panR = rand() < 0.5 ? 0.42 : 0.58;
    let prev = 0;
    for (let i = idx(t); i < idx(t + 0.07) && i < N; i++) {
      const lt = i / SR - t;
      const n = rand() * 2 - 1;
      const hp = n - prev;
      prev = n;
      // A click plus a short pitched body, like a shutter or a print head.
      const v =
        0.075 * accent * Math.exp(-lt * 120) * hp +
        0.05 * accent * Math.exp(-lt * 90) * Math.sin(2 * Math.PI * 1750 * lt);
      dL[i] += v * (1 - panR);
      dR[i] += v * panR;
    }
    t += gap;
  }
}

// ---------- Machine clunk on every old-act scene cut ----------
for (const s of OLD_CUTS) {
  let phi = 0;
  let lp = 0;
  for (let i = idx(s); i < idx(s + 0.8) && i < N; i++) {
    const t = i / SR - s;
    const f = 120 * Math.exp(-t * 22) + 52;
    phi += (2 * Math.PI * f) / SR;
    lp += 0.2 * (rand() * 2 - 1 - lp);
    const v =
      0.3 * Math.min(1, t / 0.003) * Math.exp(-t * 6) * Math.sin(phi) +
      0.16 * Math.exp(-t * 26) * lp;
    dL[i] += v;
    dR[i] += v * 0.95;
  }
}

// ---------- Two risers: a short tease, then the one that breaks the act ----
for (const [rs, re, amp] of [
  [12.0, 13.6, 0.07],
  [19.6, TURN, 0.19],
]) {
  let phi = 0;
  let hpPrevL = 0;
  let hpPrevR = 0;
  for (let i = idx(rs); i < idx(re + 0.2) && i < N; i++) {
    const t = i / SR;
    const nL = rand() * 2 - 1;
    const nR = rand() * 2 - 1;
    const hpL = nL - hpPrevL;
    const hpR = nR - hpPrevR;
    hpPrevL = nL;
    hpPrevR = nR;
    let prog;
    let g;
    if (t <= re) {
      prog = Math.max(0, (t - rs) / (re - rs));
      g = 1;
    } else {
      prog = 1;
      g = Math.exp(-(t - re) * 34);
    }
    const ampN = amp * Math.pow(prog, 2.4) * g;
    const ampS = amp * 0.34 * Math.pow(prog, 2) * g;
    const f = 150 * Math.pow(6.5, prog);
    phi += (2 * Math.PI * f) / SR;
    const sw = ampS * Math.sin(phi);
    dL[i] += ampN * hpL + sw;
    dR[i] += ampN * hpR + sw;
  }
}

// ===========================================================================
// THE TURN: impact, then the groove
// ===========================================================================

{
  let phi = 0;
  let lp = 0;
  for (let i = idx(TURN); i < idx(TURN + 1.6) && i < N; i++) {
    const t = i / SR - TURN;
    const f = 88 * Math.exp(-t * 14) + 36;
    phi += (2 * Math.PI * f) / SR;
    lp += 0.17 * (rand() * 2 - 1 - lp);
    const v =
      0.52 * Math.min(1, t / 0.004) * Math.exp(-t * 2.6) * Math.sin(phi) +
      0.24 * Math.exp(-t * 9) * lp;
    dL[i] += v;
    dR[i] += v;
  }
  for (let i = idx(TURN); i < idx(TURN + 0.6) && i < N; i++) {
    const t = i / SR - TURN;
    duck[i] = Math.min(duck[i], 1 - 0.55 * Math.exp(-t * 5));
  }
}

// ===========================================================================
// ACT TWO: the new way
// ===========================================================================

// Dm9 / Bbmaj7 / Gm11 / F6, one bar each. Warmer than the act-one pedal, and
// the F6 resolution is what the whole first act withholds.
const CHORDS = [
  [50, 57, 60, 64], // Dm9
  [53, 58, 62, 69], // Bbmaj7
  [50, 55, 58, 65], // Gm11
  [48, 57, 60, 64], // F6
];
const BASS_ROOTS = [38, 34, 31, 41]; // D2, Bb1, G1, F2
const sectionOf = (bar) => (bar < 4 ? "A" : bar < 10 ? "B" : "C");

// ---------- Pad ----------
const padSegs = [];
for (let bar = 0; bar < BARS; bar++) {
  const sect = sectionOf(bar);
  padSegs.push({
    s: TURN + bar * BAR,
    e: TURN + (bar + 1) * BAR,
    ci: bar % 4,
    g: sect === "A" ? 0.85 : sect === "B" ? 1 : 1.1,
  });
}
// Outro: hold Dm and let it breathe out.
padSegs.push({ s: GROOVE_END, e: DUR - 0.6, ci: 0, g: 0.95 });

for (const seg of padSegs) {
  const relEnd = Math.min(seg.e + 0.9, DUR);
  CHORDS[seg.ci].forEach((midi, ni) => {
    const f = mtof(midi);
    const det = ni === 0 ? 0 : 0.0022;
    const phase = ni * 2.1;
    for (let i = idx(seg.s); i < relEnd * SR && i < N; i++) {
      const t = i / SR;
      const local = t - seg.s;
      const att = Math.min(1, local / 0.45);
      const rel = t > seg.e ? Math.max(0, 1 - (t - seg.e) / 0.9) : 1;
      const trem = 1 + 0.07 * Math.sin(2 * Math.PI * 0.33 * t + phase);
      const env = 0.04 * seg.g * att * rel * trem;
      const wob = 0.1 * Math.sin(2 * Math.PI * 0.19 * t + phase);
      const fA = f * (1 - det);
      const fB = f * (1 + det);
      const voice = (fx) =>
        Math.sin(2 * Math.PI * fx * t + wob) +
        0.38 * Math.sin(2 * Math.PI * 2 * fx * t) +
        0.16 * Math.sin(2 * Math.PI * 3 * fx * t) +
        0.06 * Math.sin(2 * Math.PI * 4 * fx * t);
      mL[i] += env * voice(fA);
      mR[i] += env * voice(fB);
    }
  });
}

// ---------- Bass: rounded square through light drive, pumping eighths ------
const BASS_VEL = [1, 0.6, 0.84, 0.66, 0.94, 0.6, 0.86, 0.72];
for (let bar = 0; bar < BARS; bar++) {
  const root = mtof(BASS_ROOTS[bar % 4]);
  for (let k = 0; k < 8; k++) {
    const s = TURN + bar * BAR + k * (BEAT / 2);
    if (s >= GROOVE_END) continue;
    const vel = BASS_VEL[k];
    const len = 0.24;
    for (let i = idx(s); i < (s + len) * SR && i < N; i++) {
      const t = i / SR - s;
      const gate = Math.min(1, Math.max(0, (len - t) / 0.03));
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 6) * gate;
      const raw =
        Math.sin(2 * Math.PI * root * t) +
        0.3 * Math.sin(2 * Math.PI * 3 * root * t) +
        0.14 * Math.sin(2 * Math.PI * 5 * root * t);
      const v = 0.165 * vel * env * Math.tanh(1.8 * raw);
      mL[i] += v;
      mR[i] += v;
    }
  }
}

// ---------- Kick, four on the floor, plus the sidechain ----------
for (let bar = 0; bar < BARS; bar++) {
  for (let b = 0; b < 4; b++) {
    const s = TURN + bar * BAR + b * BEAT;
    if (s >= GROOVE_END) continue;
    let phi = 0;
    for (let i = idx(s); i < (s + 0.4) * SR && i < N; i++) {
      const t = i / SR - s;
      const f = 165 * Math.exp(-t * 28) + 46;
      phi += (2 * Math.PI * f) / SR;
      const v =
        0.5 * Math.min(1, t / 0.002) * Math.exp(-t * 10) * Math.sin(phi) +
        0.22 * Math.exp(-t * 350) * (rand() * 2 - 1);
      dL[i] += v;
      dR[i] += v;
    }
    for (let i = idx(s); i < (s + 0.5) * SR && i < N; i++) {
      const t = i / SR - s;
      duck[i] = Math.min(duck[i], 1 - 0.42 * Math.exp(-t * 8));
    }
  }
}

// ---------- Clap on 2 and 4, from section B ----------
for (let bar = 4; bar < BARS; bar++) {
  for (const b of [1, 3]) {
    const s = TURN + bar * BAR + b * BEAT;
    if (s >= GROOVE_END) continue;
    for (const [off, dec, amp] of [
      [0, 180, 0.5],
      [0.011, 180, 0.42],
      [0.023, 180, 0.36],
      [0.03, 14, 0.3],
    ]) {
      let prevL = 0;
      let prevR = 0;
      const ss = s + off;
      for (let i = idx(ss); i < (ss + 0.28) * SR && i < N; i++) {
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

// ---------- Offbeat hats ----------
let hatCount = 0;
for (let bar = 0; bar < BARS; bar++) {
  for (let b = 0; b < 4; b++) {
    const s = TURN + bar * BAR + (b + 0.5) * BEAT;
    if (s >= GROOVE_END) continue;
    const panR = hatCount++ % 2 === 0 ? 0.62 : 0.38;
    const vel = 0.8 + 0.4 * rand();
    let prev = 0;
    for (let i = idx(s); i < (s + 0.08) * SR && i < N; i++) {
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

// ---------- 16th shaker, sections B and C ----------
const SHK_VEL = [0.5, 0.75, 1, 0.75];
for (let bar = 4; bar < BARS; bar++) {
  const base = sectionOf(bar) === "C" ? 0.038 : 0.03;
  for (let k = 0; k < 16; k++) {
    const s = TURN + bar * BAR + k * (BEAT / 4);
    if (s >= GROOVE_END) continue;
    const vel = SHK_VEL[k % 4] * (0.85 + 0.3 * rand());
    let prev = 0;
    for (let i = idx(s); i < (s + 0.045) * SR && i < N; i++) {
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

// ---------- Pluck lead ----------
const addPluck = (s, midi, vel, decay = 5.5, len = 0.55) => {
  const f0 = mtof(midi);
  for (const side of [-1, 1]) {
    const f = f0 * (1 + 0.004 * side);
    const panR = side < 0 ? 0.38 : 0.62;
    for (let i = idx(s); i < (s + len) * SR && i < N; i++) {
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

// Two-bar motif in D minor pentatonic with a 9th, eighth-note slots 0..15.
const MOTIF = [
  [0, 69, 1], [3, 72, 0.8], [4, 74, 0.9], [7, 72, 0.7],
  [8, 69, 0.85], [11, 67, 0.7], [12, 65, 0.8], [14, 67, 0.65],
];
const MOTIF_EXTRA = [[2, 77, 0.5], [6, 76, 0.55], [10, 74, 0.6], [15, 72, 0.5]];
for (let pair = 0; pair < BARS / 2; pair++) {
  const barStart = pair * 2;
  const sect = sectionOf(barStart);
  const notes = sect === "A" ? MOTIF : MOTIF.concat(MOTIF_EXTRA);
  for (const [slot, midi, vel] of notes) {
    const s = TURN + barStart * BAR + slot * (BEAT / 2);
    if (s >= GROOVE_END - 0.4) continue;
    addPluck(s, midi, vel);
    if (sect === "C" && slot % 4 === 0) addPluck(s, midi + 12, vel * 0.45);
  }
}
// Outro plucks, falling to the tonic.
addPluck(GROOVE_END + 0.35, 69, 0.45, 3, 1.5);
addPluck(GROOVE_END + 1.3, 65, 0.4, 3, 1.5);
addPluck(GROOVE_END + 2.3, 62, 0.5, 2.4, 1.7);

// Quarter-note feedback echo with a light cross-bleed for width.
const D = Math.floor(BEAT * SR);
for (let i = D; i < N; i++) {
  pL[i] += pL[i - D] * 0.28 + pR[i - D] * 0.08;
  pR[i] += pR[i - D] * 0.28 + pL[i - D] * 0.08;
}

// ---------- Bells: section C downbeats and the outro ----------
const addBell = (s, midi, amp = 0.05, panR = 0.5) => {
  const f = mtof(midi);
  for (let i = idx(s); i < (s + 1.8) * SR && i < N; i++) {
    const t = i / SR - s;
    const att = Math.min(1, t / 0.002);
    const v =
      amp * att *
      (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.6) +
        0.45 * Math.sin(2 * Math.PI * 2.005 * f * t) * Math.exp(-t * 4.5) +
        0.3 * Math.sin(2 * Math.PI * 2.757 * f * t) * Math.exp(-t * 7.5));
    mL[i] += v * (1 - panR);
    mR[i] += v * panR;
  }
};
for (let bar = 10; bar < BARS; bar++) {
  const s = TURN + bar * BAR;
  if (s >= GROOVE_END) continue;
  addBell(s, BASS_ROOTS[bar % 4] + 36, 0.05, bar % 2 === 0 ? 0.6 : 0.4);
}
addBell(GROOVE_END, 74, 0.07, 0.45);
addBell(GROOVE_END + 1.9, 69, 0.055, 0.58);

// ---------- Beat accents: a soft swell on every new-way scene start --------
for (const s of [26.0, 29.8, 33.6, 37.4, 41.2, 45.0, 48.8]) {
  let prev = 0;
  for (let i = idx(s - 0.26); i < idx(s + 0.14) && i < N; i++) {
    const t = i / SR - (s - 0.26);
    const n = rand() * 2 - 1;
    const hp = n - prev;
    prev = n;
    // Reverse-swell into the cut, cut off right on it.
    const env = 0.055 * Math.pow(Math.min(1, t / 0.26), 3);
    dL[i] += env * hp;
    dR[i] += env * hp * 0.9;
  }
}

// ===========================================================================
// Mix, master, write
// ===========================================================================

let peak = 0;
const L = new Float64Array(N);
const R = new Float64Array(N);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fadeIn = Math.min(1, t / 0.06);
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
const out = path.join(__dirname, "..", "public", "music-vs.wav");
fs.writeFileSync(out, buf);
console.log(
  `wrote ${out} (${DUR.toFixed(1)}s, ${BARS} bars at ${BPM.toFixed(2)} BPM, peak-normalized to 0.92)`
);
