// Media for the App Preview shot, made here so nothing is borrowed:
//   media/Morning.wav             12 s of a soft major-seventh pad with a slow arpeggio on top
//   media/juniper-recording.mp4   Juniper's screens as a screen recording (pushes between screens)
//   node make-media.cjs
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, 'media');
const SCREENS = require('path').resolve(__dirname, '..', '..', '..', '..') + '/promo/public/juniper/en';
fs.mkdirSync(DIR, { recursive: true });

// ---- Morning.wav ----------------------------------------------------------------------------
function wav(seconds, rate = 44100) {
  const frames = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + frames * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + frames * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(frames * 4, 40);
  const pad = [261.63, 329.63, 392.0, 493.88]; // Cmaj7
  const arp = [523.25, 659.25, 783.99, 987.77, 783.99, 659.25];
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const swell = Math.min(1, t / 2.5) * Math.min(1, (seconds - t) / 2.5);
    let l = 0;
    let r = 0;
    pad.forEach((f, k) => {
      const v = Math.sin(2 * Math.PI * f * t + k) * 0.11 + Math.sin(2 * Math.PI * f * 2.001 * t) * 0.02;
      l += v * (k % 2 ? 0.8 : 1);
      r += v * (k % 2 ? 1 : 0.8);
    });
    const step = Math.floor(t / 0.5);
    const local = t - step * 0.5;
    const note = arp[step % arp.length];
    const pluck = Math.exp(-local * 6) * Math.sin(2 * Math.PI * note * t) * 0.16;
    l += pluck * (step % 2 ? 0.6 : 1);
    r += pluck * (step % 2 ? 1 : 0.6);
    const clip = (v) => Math.max(-1, Math.min(1, v * swell));
    buf.writeInt16LE(Math.round(clip(l) * 24000), 44 + i * 4);
    buf.writeInt16LE(Math.round(clip(r) * 24000), 46 + i * 4);
  }
  return buf;
}
fs.writeFileSync(path.join(DIR, 'Morning.wav'), wav(12));
console.log('Morning.wav', fs.statSync(path.join(DIR, 'Morning.wav')).size, 'bytes');

// ---- juniper-recording.mp4 ------------------------------------------------------------------
// Four screens, 4 s each, pushed left like a navigation, at half the phone's resolution.
const screens = ['today', 'detail', 'add', 'stats'];
const hold = 4;
const fade = 0.45;
const args = ['-y'];
for (const s of screens) args.push('-loop', '1', '-t', String(hold), '-i', path.join(SCREENS, `${s}.png`));
let chain = '';
let last = '[0:v]';
for (let i = 1; i < screens.length; i++) {
  const out = i === screens.length - 1 ? '[x]' : `[v${i}]`;
  chain += `${last}[${i}:v]xfade=transition=slideleft:duration=${fade}:offset=${(i * (hold - fade)).toFixed(2)}${out};`;
  last = out;
}
chain += '[x]scale=604:1312:flags=lanczos,format=yuv420p,fps=30[out]';
args.push('-filter_complex', chain, '-map', '[out]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-movflags', '+faststart', path.join(DIR, 'juniper-recording.mp4'));
execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', path.join(DIR, 'juniper-recording.mp4')]).toString();
console.log('juniper-recording.mp4', fs.statSync(path.join(DIR, 'juniper-recording.mp4')).size, 'bytes', probe.replace(/\s+/g, ' '));
