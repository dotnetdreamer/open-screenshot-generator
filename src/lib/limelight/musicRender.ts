/**
 * A music plan (music.ts) played into sound, offline: every note is a few
 * Web Audio nodes in an OfflineAudioContext, which renders the whole track
 * far faster than it plays. Nothing is downloaded and nothing is sampled:
 * drums are shaped noise and sine sweeps, the pad and bass are detuned saw
 * waves through filters, the bell is two sines.
 *
 * The same plan gives the same sound every time: the noise comes from a
 * seeded generator, not Math.random, so the preview, the export and a test
 * all hear the same track.
 *
 * Browser only, and loaded only when a scene has music.
 */

import { MUSIC_BEAT, frequency, musicPlan, cutTimes, type MusicNote, type MusicPlan } from './music';
import type { LimelightScene } from './types';

export const MUSIC_SAMPLE_RATE = 48000;
const CHANNELS = 2;

/** A small, fast generator with a seed: the same noise every render. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

interface Bus {
  ctx: OfflineAudioContext;
  /** Straight to the mix. */
  dry: AudioNode;
  /** Into the reverb. */
  room: AudioNode;
  /** Into the echo, then the reverb. */
  echo: AudioNode;
  /** The pad's own bus, which ducks under each kick. */
  pad: GainNode;
  noise: AudioBuffer;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.round(seconds * ctx.sampleRate)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seeded(seed);
  for (let i = 0; i < data.length; i++) data[i] = random();
  return buffer;
}

/** A room's echo: two channels of noise dying away over `seconds`, a little different left and right. */
function roomResponse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.round(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    const random = seeded(97 + c * 31);
    const pre = Math.round(0.018 * ctx.sampleRate);
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / ctx.sampleRate;
      data[i] = random() * Math.exp(-t * (6.9 / seconds)) * 0.55;
    }
  }
  return buffer;
}

function noiseAt(bus: Bus, time: number, length: number): AudioBufferSourceNode {
  const source = bus.ctx.createBufferSource();
  source.buffer = bus.noise;
  // A different stretch of the same noise for each hit, chosen from the time, so two hits never sound glued.
  const offset = (time * 7.31) % Math.max(0.01, bus.noise.duration - length - 0.05);
  source.start(time, Math.max(0, offset), length + 0.02);
  return source;
}

/** An envelope that rises to `peak` in `attack` and falls to nothing over `decay`. */
function hit(gain: AudioParam, time: number, peak: number, attack: number, decay: number) {
  gain.setValueAtTime(0.0001, time);
  gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
}

function panned(bus: Bus, node: AudioNode, pan: number | undefined, to: AudioNode) {
  if (!pan) {
    node.connect(to);
    return;
  }
  const panner = bus.ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(panner).connect(to);
}

function play(bus: Bus, note: MusicNote, plan: MusicPlan) {
  const { ctx } = bus;
  const t = note.time;
  const v = note.velocity;
  switch (note.voice) {
    case 'kick': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(165, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.07);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.35);
      const gain = ctx.createGain();
      hit(gain.gain, t, 0.62 * v, 0.003, 0.34);
      osc.connect(gain).connect(bus.dry);
      osc.start(t);
      osc.stop(t + 0.45);
      // The beater's click, so the kick reads on a phone's speaker.
      const click = noiseAt(bus, t, 0.02);
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 1800;
      const clickGain = ctx.createGain();
      hit(clickGain.gain, t, 0.3 * v, 0.001, 0.014);
      // Its knock, an octave and more over the boom, which a phone's speaker can play.
      const knock = ctx.createOscillator();
      knock.type = 'triangle';
      knock.frequency.setValueAtTime(260, t);
      knock.frequency.exponentialRampToValueAtTime(120, t + 0.04);
      const knockGain = ctx.createGain();
      hit(knockGain.gain, t, 0.22 * v, 0.002, 0.06);
      knock.connect(knockGain).connect(bus.dry);
      knock.start(t);
      knock.stop(t + 0.1);
      click.connect(high).connect(clickGain).connect(bus.dry);
      // The pad steps aside for it.
      bus.pad.gain.setValueAtTime(1, t);
      bus.pad.gain.linearRampToValueAtTime(0.38, t + 0.012);
      bus.pad.gain.linearRampToValueAtTime(1, t + MUSIC_BEAT * 0.85);
      break;
    }
    case 'clap':
    case 'snare': {
      const source = noiseAt(bus, t, note.voice === 'clap' ? 0.3 : 0.2);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = note.voice === 'clap' ? 1350 : 1900;
      band.Q.value = note.voice === 'clap' ? 0.8 : 0.6;
      const gain = ctx.createGain();
      const g = gain.gain;
      g.setValueAtTime(0.0001, t);
      if (note.voice === 'clap') {
        // Three hands a hair apart, then the room.
        for (const [k, at] of [0, 0.011, 0.022].entries()) {
          g.setValueAtTime(0.0001, t + at);
          g.exponentialRampToValueAtTime(v * (0.75 + 0.1 * k), t + at + 0.002);
          g.exponentialRampToValueAtTime(v * 0.12, t + at + 0.009);
        }
        g.exponentialRampToValueAtTime(v * 0.55, t + 0.033);
        g.exponentialRampToValueAtTime(0.0001, t + 0.25);
      } else {
        hit(g, t, v * 0.8, 0.002, 0.16);
      }
      const level = ctx.createGain();
      level.gain.value = 1.5;
      gain.connect(level);
      source.connect(band).connect(gain);
      level.connect(bus.dry);
      const send = ctx.createGain();
      send.gain.value = 0.45;
      level.connect(send).connect(bus.room);
      if (note.voice === 'snare') {
        // The drum's body under the rattle.
        const body = ctx.createOscillator();
        body.type = 'triangle';
        body.frequency.setValueAtTime(220, t);
        body.frequency.exponentialRampToValueAtTime(160, t + 0.08);
        const bodyGain = ctx.createGain();
        hit(bodyGain.gain, t, v * 0.35, 0.002, 0.09);
        body.connect(bodyGain).connect(bus.dry);
        body.start(t);
        body.stop(t + 0.15);
      }
      break;
    }
    case 'hat':
    case 'openhat':
    case 'shaker': {
      const open = note.voice === 'openhat';
      const shaker = note.voice === 'shaker';
      const source = noiseAt(bus, t, open ? 0.35 : 0.1);
      const high = ctx.createBiquadFilter();
      high.type = shaker ? 'bandpass' : 'highpass';
      high.frequency.value = shaker ? 6500 : open ? 6800 : 8200;
      if (shaker) high.Q.value = 1.2;
      const gain = ctx.createGain();
      hit(gain.gain, t, v * (open ? 0.24 : shaker ? 0.2 : 0.3), shaker ? 0.012 : 0.001, open ? 0.26 : shaker ? 0.06 : 0.035);
      source.connect(high);
      panned(bus, high.connect(gain), note.pan ?? (shaker ? 0.2 : -0.12), bus.dry);
      break;
    }
    case 'bass': {
      const f = frequency(note.pitch ?? 45);
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = f;
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = f / 2;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 3;
      filter.frequency.setValueAtTime(1900, t);
      filter.frequency.exponentialRampToValueAtTime(480, t + Math.min(0.18, note.length));
      const sawGain = ctx.createGain();
      sawGain.gain.value = 0.42;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.28;
      const amp = ctx.createGain();
      const end = t + note.length;
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(0.4 * v, t + 0.006);
      amp.gain.setValueAtTime(0.4 * v, Math.max(t + 0.007, end - 0.04));
      amp.gain.exponentialRampToValueAtTime(0.0001, end);
      saw.connect(filter).connect(sawGain).connect(amp);
      sub.connect(subGain).connect(amp);
      amp.connect(bus.dry);
      for (const osc of [saw, sub]) {
        osc.start(t);
        osc.stop(end + 0.02);
      }
      break;
    }
    case 'pad': {
      const f = frequency(note.pitch ?? 57);
      const end = t + note.length;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.7;
      // The opening's chords open up as they swell; the rest sit warm.
      if (t < plan.groove - 0.01) {
        filter.frequency.setValueAtTime(400, t);
        filter.frequency.exponentialRampToValueAtTime(2600, Math.max(t + 0.1, plan.groove));
      } else {
        filter.frequency.value = plan.track === 'calm' ? 1500 : 2200;
      }
      const amp = ctx.createGain();
      const attack = Math.min(0.4, note.length / 3);
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(0.15 * v, t + attack);
      amp.gain.setValueAtTime(0.15 * v, Math.max(t + attack + 0.001, end - 0.25));
      amp.gain.exponentialRampToValueAtTime(0.0001, end + 0.35);
      // Three saws a few cents apart: a wide, moving chord rather than a buzz.
      for (const [k, cents] of [-9, 0, 9].entries()) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = cents;
        const voice = ctx.createGain();
        voice.gain.value = 0.34;
        panned(bus, osc.connect(voice), (k - 1) * 0.45, filter);
        osc.start(t);
        osc.stop(end + 0.4);
      }
      filter.connect(amp).connect(bus.pad);
      break;
    }
    case 'pluck': {
      const f = frequency(note.pitch ?? 72);
      const square = ctx.createOscillator();
      square.type = 'square';
      square.frequency.value = f;
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      tri.frequency.value = f * 2;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2;
      filter.frequency.setValueAtTime(4200, t);
      filter.frequency.exponentialRampToValueAtTime(700, t + 0.16);
      const amp = ctx.createGain();
      hit(amp.gain, t, 0.2 * v, 0.002, 0.22);
      const triGain = ctx.createGain();
      triGain.gain.value = 0.35;
      square.connect(filter);
      tri.connect(triGain).connect(filter);
      filter.connect(amp);
      panned(bus, amp, note.pan, bus.dry);
      const send = ctx.createGain();
      send.gain.value = 0.55;
      amp.connect(send).connect(bus.echo);
      for (const osc of [square, tri]) {
        osc.start(t);
        osc.stop(t + 0.3);
      }
      break;
    }
    case 'bell': {
      const f = frequency(note.pitch ?? 76);
      const amp = ctx.createGain();
      hit(amp.gain, t, 0.26 * v, 0.004, Math.max(0.3, note.length));
      for (const [ratio, level] of [
        [1, 1],
        [2, 0.18],
        [3.01, 0.08],
      ]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f * ratio;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(g).connect(amp);
        osc.start(t);
        osc.stop(t + note.length + 0.4);
      }
      panned(bus, amp, note.pan, bus.dry);
      const send = ctx.createGain();
      send.gain.value = 0.9;
      amp.connect(send).connect(bus.room);
      const echo = ctx.createGain();
      echo.gain.value = 0.35;
      amp.connect(echo).connect(bus.echo);
      break;
    }
    case 'impact': {
      // A deep boom and a wash of noise closing down.
      const boom = ctx.createOscillator();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(90, t);
      boom.frequency.exponentialRampToValueAtTime(30, t + note.length * 0.8);
      const boomGain = ctx.createGain();
      hit(boomGain.gain, t, 0.55 * v, 0.004, note.length);
      boom.connect(boomGain).connect(bus.dry);
      boom.start(t);
      boom.stop(t + note.length + 0.05);
      const wash = noiseAt(bus, t, note.length);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(9000, t);
      filter.frequency.exponentialRampToValueAtTime(300, t + note.length);
      const washGain = ctx.createGain();
      hit(washGain.gain, t, 0.45 * v, 0.003, note.length * 0.9);
      wash.connect(filter).connect(washGain);
      washGain.connect(bus.dry);
      const send = ctx.createGain();
      send.gain.value = 0.8;
      washGain.connect(send).connect(bus.room);
      break;
    }
    case 'crash': {
      const source = noiseAt(bus, t, note.length);
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 4500;
      const gain = ctx.createGain();
      hit(gain.gain, t, 0.45 * v, 0.002, note.length);
      source.connect(high).connect(gain);
      gain.connect(bus.dry);
      const send = ctx.createGain();
      send.gain.value = 0.5;
      gain.connect(send).connect(bus.room);
      break;
    }
    case 'riser': {
      const source = noiseAt(bus, t, note.length);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 2.5;
      band.frequency.setValueAtTime(350, t);
      band.frequency.exponentialRampToValueAtTime(7500, t + note.length);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4 * v, t + note.length * 0.97);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + note.length + 0.02);
      source.connect(band).connect(gain);
      gain.connect(bus.dry);
      const send = ctx.createGain();
      send.gain.value = 0.6;
      gain.connect(send).connect(bus.room);
      break;
    }
  }
}

/** A plan as two channels of sound, peaking just under full scale, fading out over its last third of a second. */
export async function renderMusicPlan(plan: MusicPlan, sampleRate = MUSIC_SAMPLE_RATE): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round(plan.duration * sampleRate));
  const ctx = new OfflineAudioContext(CHANNELS, length, sampleRate);
  const master = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 10;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.14;
  // The rumble no speaker plays taken off, a little air added on top.
  const rumble = ctx.createBiquadFilter();
  rumble.type = 'highpass';
  rumble.frequency.value = 32;
  const bottom = ctx.createBiquadFilter();
  bottom.type = 'lowshelf';
  bottom.frequency.value = 90;
  bottom.gain.value = -4;
  const air = ctx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 5500;
  air.gain.value = 4;
  master.connect(rumble).connect(bottom).connect(air).connect(compressor).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = roomResponse(ctx, plan.track === 'calm' ? 3 : 2.2);
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = plan.track === 'calm' ? 0.4 : 0.28;
  reverb.connect(reverbGain).connect(master);

  // A dotted-eighth echo, darker on each repeat.
  const delay = ctx.createDelay(2);
  delay.delayTime.value = MUSIC_BEAT * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const darken = ctx.createBiquadFilter();
  darken.type = 'lowpass';
  darken.frequency.value = 3200;
  const echoIn = ctx.createGain();
  echoIn.connect(delay);
  delay.connect(darken).connect(feedback).connect(delay);
  const echoOut = ctx.createGain();
  echoOut.gain.value = 0.5;
  darken.connect(echoOut);
  echoOut.connect(master);
  echoOut.connect(reverb);

  const pad = ctx.createGain();
  pad.connect(master);
  const padRoom = ctx.createGain();
  padRoom.gain.value = 0.6;
  pad.connect(padRoom).connect(reverb);

  const bus: Bus = { ctx, dry: master, room: reverb, echo: echoIn, pad, noise: noiseBuffer(ctx, 6, 7) };
  for (const note of plan.notes) play(bus, note, plan);
  const rendered = await ctx.startRendering();

  // Just under full scale, then a short fade in and a fade out at the end.
  let peak = 0;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  const scale = peak > 0 ? 0.89 / peak : 1;
  const fadeIn = Math.round(0.004 * sampleRate);
  const fadeOut = Math.round(Math.min(0.35, plan.duration / 4) * sampleRate);
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      let k = scale;
      if (i < fadeIn) k *= i / fadeIn;
      const left = data.length - i;
      if (left < fadeOut) k *= Math.pow(left / fadeOut, 1.5);
      data[i] *= k;
    }
  }
  return rendered;
}

/** A scene's soundtrack, with cymbals on its cuts, or null when it has none. */
export async function renderSceneMusic(scene: LimelightScene, sampleRate = MUSIC_SAMPLE_RATE): Promise<AudioBuffer | null> {
  if (!scene.music || typeof OfflineAudioContext === 'undefined') return null;
  return renderMusicPlan(musicPlan(scene.music.track, scene.format.duration, cutTimes(scene)), sampleRate);
}

/** What a scene's soundtrack depends on: the same key, the same sound. */
export function musicKey(scene: LimelightScene): string | null {
  if (!scene.music) return null;
  return `${scene.music.track}|${scene.format.duration}|${cutTimes(scene).join(',')}`;
}
