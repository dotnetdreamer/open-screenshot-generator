const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const sampleRate = 44100;
const duration = 32;
const count = sampleRate * duration;
const left = new Float64Array(count);
const right = new Float64Array(count);
const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const beat = 0.5;
let seed = 13102026;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function add(start, length, voice) {
  const from = Math.floor(start * sampleRate);
  const until = Math.min(count, Math.floor((start + length) * sampleRate));
  for (let i = from; i < until; i++) {
    const t = i / sampleRate - start;
    const values = voice(t);
    left[i] += values[0];
    right[i] += values[1];
  }
}

const chords = [[50, 57, 60, 64], [46, 53, 57, 62], [48, 55, 59, 62], [45, 52, 57, 60]];
for (let bar = 0; bar < 16; bar++) {
  const start = bar * 2;
  const chord = chords[Math.floor(bar / 2) % chords.length];
  for (const [index, midi] of chord.entries()) {
    const f = frequency(midi);
    add(start, 2.8, t => {
      const attack = Math.min(1, t / 0.35);
      const release = Math.min(1, Math.max(0, (2.8 - t) / 0.9));
      const envelope = attack * release * 0.042;
      const voice = (detune) => Math.sin(2 * Math.PI * f * detune * t + index) + 0.18 * Math.sin(2 * Math.PI * f * 2 * t);
      return [envelope * voice(0.999), envelope * voice(1.001)];
    });
  }
}

for (let n = 6; n < 57; n++) {
  const start = n * beat;
  const gain = start < 7 ? 0.07 : start < 23 ? 0.11 : 0.08;
  const f = frequency(chords[Math.floor(start / 4) % chords.length][0] - 12);
  add(start, 0.65, t => {
    const envelope = Math.min(1, t / 0.018) * Math.exp(-t * 6) * gain;
    const value = Math.sin(2 * Math.PI * (f * t + 8 * (1 - Math.exp(-t * 22)) / 22)) * envelope;
    return [value, value];
  });
  if (start >= 7 && n % 2 === 1) {
    add(start + 0.25, 0.06, t => {
      const value = (random() * 2 - 1) * Math.exp(-t * 75) * 0.013;
      return [value * 0.75, value];
    });
  }
}

const notes = [74, 77, 81, 76, 72, 77, 79, 74];
for (let n = 0; n < 24; n++) {
  const start = 3 + n;
  const f = frequency(notes[n % notes.length]);
  add(start, 1.25, t => {
    const envelope = Math.min(1, t / 0.008) * Math.exp(-t * 5) * 0.045;
    const value = (Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(2 * Math.PI * f * 3 * t)) * envelope;
    return [value * (n % 2 ? 0.72 : 1), value * (n % 2 ? 1 : 0.72)];
  });
}

for (const start of [3, 7, 13, 18, 23, 26, 29]) {
  add(start - 0.18, 0.45, t => {
    const envelope = Math.sin(Math.PI * t / 0.45) ** 2 * 0.013;
    const value = (random() * 2 - 1) * envelope;
    return [value, value * 0.9];
  });
}

const buffer = Buffer.alloc(44 + count * 4);
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + count * 4, 4);
buffer.write("WAVEfmt ", 8);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(2, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 4, 28);
buffer.writeUInt16LE(4, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(count * 4, 40);
for (let i = 0; i < count; i++) {
  const t = i / sampleRate;
  const fade = Math.min(1, t / 0.6, Math.max(0, (duration - t) / 1.6));
  buffer.writeInt16LE(Math.round(Math.tanh(left[i] * 1.7) * fade * 25000), 44 + i * 4);
  buffer.writeInt16LE(Math.round(Math.tanh(right[i] * 1.7) * fade * 25000), 46 + i * 4);
}
const intermediate = path.resolve(__dirname, "../../tests/e2e/.artifacts/launch-score.wav");
const output = path.resolve(__dirname, "../public/launch/score.m4a");
fs.mkdirSync(path.dirname(intermediate), { recursive: true });
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(intermediate, buffer);
let ffmpeg = process.env.LAUNCH_FFMPEG || "ffmpeg";
let binaryDirectory;
if (!process.env.LAUNCH_FFMPEG) {
  try {
    binaryDirectory = require(`@remotion/compositor-${process.platform}-${process.arch}`).dir;
    ffmpeg = path.join(binaryDirectory, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  } catch {}
}
execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", intermediate, "-c:a", "aac", "-b:a", "160k", "-f", "mp4", output], {
  env: { ...process.env, ...(binaryDirectory ? { DYLD_LIBRARY_PATH: binaryDirectory } : {}) },
  stdio: "inherit",
});
console.log(output);
