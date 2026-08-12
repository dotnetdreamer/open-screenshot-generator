/**
 * The soundtrack, generated rather than licensed: no samples, no external
 * audio, 60 seconds of chill electronic at 88 BPM. Am7 / Fmaj7 / Cmaj7 / G
 * under a detuned pad, sidechained kick, off-beat hats and an FM pluck arp
 * through a dotted-eighth ping-pong delay.
 *
 * What makes it this video's track rather than a loop: MARKS. Every act change
 * in src/style.ts (BEATS) has a noise riser leading into it and an impact
 * landing on it, and the two bars where a string is being typed drop the drums
 * out, so the quietest moment in the music is the moment the field is being
 * filled. Change BEATS and change MARKS with it.
 *
 * Run from promo-i18n/: node scripts/gen-music.js
 */
const fs = require("fs");
const path = require("path");

const SR = 44100;
const FPS = 30;
const BPM = 88;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 22; // 22 * 2.727s = 60.0s, the length of the cut
const TAIL = 1.6;
const DUR = BARS * BAR + TAIL;
const N = Math.ceil(SR * DUR);
/**
 * Where the video ends, which is not where the audio ends: the last bar rings
 * out past 1800 frames. The fade is measured from here so the track is already
 * silent on the frame the video stops, rather than being cut off mid ring.
 */
const VIDEO_END = 1800 / FPS;

/** src/style.ts BEATS, in seconds. */
const MARKS = [110, 560, 850, 1370, 1640].map((f) => f / FPS);
/** Bars the drums sit out, so the typing beat has room. */
const QUIET = (bar) => bar === 11 || bar === 12;

const L = new Float64Array(N);
const R = new Float64Array(N);
const duck = new Float64Array(N).fill(1);

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

let seed = 7;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const CHORDS = [
  [45, 55, 60, 64], // Am7
  [41, 52, 57, 60], // Fmaj7
  [48, 59, 64, 67], // Cmaj7
  [43, 50, 59, 62], // G add9
];
const chordAtBar = (bar) => CHORDS[Math.floor(bar / 2) % CHORDS.length];

// ---------- Pad ----------
for (let bar = 0; bar < BARS; bar += 2) {
  const seg = chordAtBar(bar);
  const s = bar * BAR;
  const e = Math.min((bar + 2) * BAR, BARS * BAR);
  const relEnd = Math.min(e + 1.8, DUR);
  seg.forEach((m, ni) => {
    const f = mtof(m);
    const detune = ni === 0 ? 0 : 0.0016;
    const phase = ni * 1.7;
    for (let i = Math.floor(s * SR); i < relEnd * SR && i < N; i++) {
      const t = i / SR;
      const local = t - s;
      const att = Math.min(1, local / 1.4);
      const rel = t > e ? Math.max(0, 1 - (t - e) / 1.8) : 1;
      const trem = 1 + 0.08 * Math.sin(2 * Math.PI * 0.25 * t + phase);
      const env = 0.05 * att * rel * trem;
      const wob = 0.12 * Math.sin(2 * Math.PI * 0.13 * t + phase);
      const fL = f * (1 - detune);
      const fR = f * (1 + detune);
      L[i] += env * (Math.sin(2 * Math.PI * fL * t + wob) + 0.35 * Math.sin(4 * Math.PI * fL * t));
      R[i] += env * (Math.sin(2 * Math.PI * fR * t + wob) + 0.35 * Math.sin(4 * Math.PI * fR * t));
    }
  });
}

// ---------- Bass ----------
for (let bar = 0; bar < BARS; bar++) {
  const root = mtof(chordAtBar(bar)[0] - 12);
  [0, 2].forEach((beat, k) => {
    const s = bar * BAR + beat * BEAT;
    const amp = (k === 0 ? 0.17 : 0.13) * (QUIET(bar) ? 0.55 : 1);
    for (let i = Math.floor(s * SR); i < (s + 1.4) * SR && i < N; i++) {
      const t = i / SR - s;
      const env = Math.min(1, t / 0.008) * Math.exp(-t * 2.2);
      const v =
        amp *
        env *
        (Math.sin(2 * Math.PI * root * t) +
          0.25 * Math.exp(-t * 6) * Math.sin(4 * Math.PI * root * t));
      L[i] += v;
      R[i] += v;
    }
  });
}

// ---------- Kick + sidechain ----------
for (let bar = 1; bar < BARS; bar++) {
  if (QUIET(bar)) continue;
  for (const beat of [0, 2]) {
    const s = bar * BAR + beat * BEAT;
    let phi = 0;
    for (let i = Math.floor(s * SR); i < (s + 0.5) * SR && i < N; i++) {
      const t = i / SR - s;
      const f = 130 * Math.exp(-t * 22) + 44;
      phi += (2 * Math.PI * f) / SR;
      const v = 0.5 * Math.exp(-t * 8) * Math.sin(phi) + 0.25 * Math.exp(-t * 400) * (rand() * 2 - 1);
      L[i] += v;
      R[i] += v;
    }
    for (let i = Math.floor(s * SR); i < (s + 0.6) * SR && i < N; i++) {
      const t = i / SR - s;
      duck[i] = Math.min(duck[i], 1 - 0.45 * Math.exp(-t * 7));
    }
  }
}

// ---------- Hats ----------
let hatCount = 0;
for (let bar = 3; bar < BARS; bar++) {
  if (QUIET(bar)) continue;
  for (let k = 0; k < 4; k++) {
    const s = bar * BAR + (k + 0.5) * BEAT;
    const panR = hatCount++ % 2 === 0 ? 0.65 : 0.35;
    let prev = 0;
    for (let i = Math.floor(s * SR); i < (s + 0.09) * SR && i < N; i++) {
      const t = i / SR - s;
      const n = rand() * 2 - 1;
      const hp = n - prev;
      prev = n;
      const v = 0.05 * Math.exp(-t * 60) * hp;
      L[i] += v * (1 - panR);
      R[i] += v * panR;
    }
  }
}

// ---------- Arp (FM pluck) into ping-pong delay ----------
const arpL = new Float64Array(N);
const arpR = new Float64Array(N);
for (let bar = 6; bar < BARS; bar++) {
  if (QUIET(bar)) continue;
  const seg = chordAtBar(bar);
  const tones = [seg[1] + 12, seg[2] + 12, seg[3] + 12, seg[0] + 24];
  const pattern = [0, 1, 2, 3, 2, 1, 0, 2];
  for (let k = 0; k < 8; k++) {
    const s = bar * BAR + k * (BEAT / 2);
    const f = mtof(tones[pattern[k] % tones.length]);
    for (let i = Math.floor(s * SR); i < (s + 0.6) * SR && i < N; i++) {
      const t = i / SR - s;
      const env = Math.min(1, t / 0.004) * Math.exp(-t * 7);
      const fm = 1.8 * Math.exp(-t * 9) * Math.sin(2 * Math.PI * 2.01 * f * t);
      const v = 0.085 * env * Math.sin(2 * Math.PI * f * t + fm);
      arpL[i] += v * 0.6;
      arpR[i] += v * 0.4;
    }
  }
}
const D = Math.floor(0.75 * BEAT * SR);
for (let i = 0; i < N; i++) {
  const echoL = i >= D ? arpR[i - D] * 0.38 : 0;
  const echoR = i >= D ? arpL[i - D] * 0.38 : 0;
  arpL[i] += echoL;
  arpR[i] += echoR;
}

// ---------- Risers and impacts, one pair per act change ----------
for (const mark of MARKS) {
  // Riser: band passed noise sweeping up over the 1.3s before the cut.
  const rs = Math.max(0, mark - 1.3);
  let lp = 0;
  for (let i = Math.floor(rs * SR); i < mark * SR && i < N; i++) {
    const t = i / SR - rs;
    const p = t / 1.3;
    const n = rand() * 2 - 1;
    lp += (n - lp) * (0.02 + 0.35 * p * p); // opens up as it rises
    const v = 0.16 * p * p * lp;
    L[i] += v;
    R[i] += v * 0.92;
  }
  // Impact: a short sub drop with a noise transient over it.
  let phi = 0;
  for (let i = Math.floor(mark * SR); i < (mark + 1.1) * SR && i < N; i++) {
    const t = i / SR - mark;
    const f = 96 * Math.exp(-t * 9) + 38;
    phi += (2 * Math.PI * f) / SR;
    const v =
      0.42 * Math.exp(-t * 3.4) * Math.sin(phi) +
      0.18 * Math.exp(-t * 24) * (rand() * 2 - 1);
    L[i] += v;
    R[i] += v;
    duck[i] = Math.min(duck[i], 1 - 0.35 * Math.exp(-t * 4));
  }
}

// ---------- Mix, master, write ----------
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fadeIn = Math.min(1, t / 0.4);
  const fadeOut = Math.min(1, Math.max(0, (VIDEO_END - t) / 2.6));
  L[i] = Math.tanh((L[i] * duck[i] + arpL[i] * duck[i]) * 1.1) * fadeIn * fadeOut;
  R[i] = Math.tanh((R[i] * duck[i] + arpR[i] * duck[i]) * 1.1) * fadeIn * fadeOut;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = 0.89 / peak;

const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
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
const out = path.join(__dirname, "..", "public", "music.wav");
fs.writeFileSync(out, buf);
console.log(`wrote ${out} (${DUR.toFixed(1)}s, peak normalized to 0.89)`);
