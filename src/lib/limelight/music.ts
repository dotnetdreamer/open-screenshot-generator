/**
 * The soundtracks Limelight makes for a scene: what plays when, as plain
 * data. musicRender.ts turns a plan into sound in the browser; this file has
 * no audio in it, so a plan can be read and tested anywhere.
 *
 * Every track is 128 beats a minute, the App intro's tempo, so a bar is 1.875
 * seconds and the template's cuts land on beats whichever track plays. A
 * track is fitted to the scene's length: one bar to open on, the groove,
 * and the last two bars to close on, with a hit where the close starts. A
 * camera cut gets a cymbal on it, so the picture and the music change
 * together in any scene, not only the template's.
 */

import type { LimelightScene, MusicTrack } from './types';

export const MUSIC_BPM = 128;
export const MUSIC_BEAT = 60 / MUSIC_BPM;
export const MUSIC_BAR = 4 * MUSIC_BEAT;

export type MusicVoice =
  | 'kick'
  | 'clap'
  | 'snare'
  | 'hat'
  | 'openhat'
  | 'shaker'
  | 'bass'
  | 'pad'
  | 'pluck'
  | 'bell'
  | 'impact'
  | 'crash'
  | 'riser';

export interface MusicNote {
  voice: MusicVoice;
  /** Seconds from the start. */
  time: number;
  /** Seconds it is held, or rises for a riser. */
  length: number;
  /** A MIDI note number, for the voices with a pitch. */
  pitch?: number;
  /** 0 to 1. */
  velocity: number;
  /** -1 left to 1 right. */
  pan?: number;
}

export interface MusicPlan {
  track: MusicTrack;
  duration: number;
  /** When the groove starts and when the close starts, in seconds. */
  groove: number;
  close: number;
  notes: MusicNote[];
}

/** A chord: the notes of the pad in MIDI numbers, and the bass's root. */
interface Chord {
  pad: number[];
  root: number;
}

interface TrackStyle {
  /** One chord a bar, round and round. */
  chords: Chord[];
  /** The chord the close holds. */
  last: Chord;
  /** Kick on every beat, or on the first and third (half time). */
  half: boolean;
  /** A plucked arpeggio in sixteenths through the groove. */
  pluck: boolean;
  /** Notes of the bell melody over the close, as steps into the last chord's scale. */
  bell: number[];
}

const STYLES: Record<MusicTrack, TrackStyle> = {
  // A minor's i VI III VII: Am F C G, the four chords of a thousand launch films.
  pulse: {
    chords: [
      { pad: [57, 60, 64], root: 45 },
      { pad: [57, 60, 65], root: 41 },
      { pad: [55, 60, 64], root: 48 },
      { pad: [55, 59, 62], root: 43 },
    ],
    last: { pad: [57, 60, 64, 69], root: 45 },
    half: false,
    pluck: true,
    bell: [76, 72, 69, 72, 76, 79],
  },
  // C major's IV V vi iii with sevenths: Fmaj7 G Am7 Em7, slow and warm.
  calm: {
    chords: [
      { pad: [53, 57, 60, 64], root: 41 },
      { pad: [55, 59, 62, 67], root: 43 },
      { pad: [57, 60, 64, 67], root: 45 },
      { pad: [52, 55, 59, 62], root: 40 },
    ],
    last: { pad: [53, 57, 60, 64, 69], root: 41 },
    half: true,
    pluck: false,
    bell: [72, 76, 79, 81, 79, 76, 72, 69],
  },
};

/**
 * When the camera cuts: a shot whose way to the next one is a cut jumps at
 * the next shot's time. Times on the beat grid only, to the nearest beat, so a
 * cymbal never lands between beats.
 */
export function cutTimes(scene: Pick<LimelightScene, 'camera' | 'format'>): number[] {
  const shots = scene.camera.shots;
  const out: number[] = [];
  for (let i = 0; i + 1 < shots.length; i++) {
    if (shots[i].ease !== 'cut') continue;
    const t = shots[i + 1].time;
    const beat = Math.round(t / MUSIC_BEAT) * MUSIC_BEAT;
    if (Math.abs(beat - t) <= 0.06 && t > 0.05 && t < scene.format.duration - 0.05) out.push(beat);
  }
  return [...new Set(out.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
}

/** The plan for a track at this length, with cymbals on these cuts. */
export function musicPlan(track: MusicTrack, duration: number, cuts: number[] = []): MusicPlan {
  const style = STYLES[track];
  const notes: MusicNote[] = [];
  const add = (note: MusicNote) => {
    if (note.time >= 0 && note.time < duration) notes.push(note);
  };
  const bars = duration / MUSIC_BAR;
  const chordAt = (bar: number) => style.chords[((bar % style.chords.length) + style.chords.length) % style.chords.length];
  if (bars < 2) {
    // Too short for a groove: the hit and one chord ringing.
    add({ voice: 'impact', time: 0, length: Math.min(1.6, duration), velocity: 0.75 });
    for (const pitch of style.last.pad) add({ voice: 'pad', time: 0, length: duration, pitch, velocity: 0.7 });
    return { track, duration, groove: duration, close: duration, notes: notes.sort((a, b) => a.time - b.time) };
  }
  // One bar to open on; the close is the last two whole bars, after at least a bar of groove.
  const groove = MUSIC_BAR;
  const close = Math.max(2, Math.floor(bars + 1e-6) - 2) * MUSIC_BAR;

  // ---- the opening: a hit, chords swelling, and a roll into the groove ----
  add({ voice: 'impact', time: 0, length: 1.6, velocity: 0.75 });
  {
    for (const pitch of chordAt(0).pad) add({ voice: 'pad', time: 0, length: groove + 0.05, pitch, velocity: 0.7 });
    add({ voice: 'riser', time: groove - MUSIC_BEAT * 3, length: MUSIC_BEAT * 3, velocity: 0.5 });
    // The last two beats of the bar: sixteenths getting louder.
    for (let i = 0; i < 8; i++) add({ voice: 'snare', time: groove - MUSIC_BEAT * 2 + (i * MUSIC_BEAT) / 4, length: 0.1, velocity: 0.18 + 0.05 * i });
    if (style.pluck) {
      for (let s = 0; s < 16; s++) {
        const tones = chordAt(0).pad;
        add({ voice: 'pluck', time: (s * MUSIC_BEAT) / 4, length: 0.2, pitch: tones[s % tones.length] + 12, velocity: 0.25 + 0.35 * (s / 16), pan: s % 2 ? 0.3 : -0.3 });
      }
    }
  }

  // ---- the groove ----
  const grooveBars = Math.max(0, Math.round((close - groove) / MUSIC_BAR));
  for (let b = 0; b < grooveBars; b++) {
    const barStart = groove + b * MUSIC_BAR;
    const chord = chordAt(b + 1);
    const lastBar = b === grooveBars - 1;
    for (const pitch of chord.pad) add({ voice: 'pad', time: barStart, length: MUSIC_BAR + 0.05, pitch, velocity: 0.62 });
    for (let beat = 0; beat < 4; beat++) {
      const t = barStart + beat * MUSIC_BEAT;
      if (!style.half || beat % 2 === 0) add({ voice: 'kick', time: t, length: 0.4, velocity: style.half ? 0.8 : 0.95 });
      if (style.half ? beat === 2 : beat % 2 === 1) add({ voice: style.half ? 'snare' : 'clap', time: t, length: 0.2, velocity: style.half ? 0.5 : 0.62 });
      // Off-beat hats, and the bass on the off-beat too, which pumps against the kick.
      add({ voice: 'hat', time: t + MUSIC_BEAT / 2, length: 0.05, velocity: 0.55 });
      add({ voice: 'hat', time: t + MUSIC_BEAT / 4, length: 0.04, velocity: 0.2 });
      add({ voice: 'hat', time: t + (3 * MUSIC_BEAT) / 4, length: 0.04, velocity: 0.25 });
      if (style.half) {
        add({ voice: 'shaker', time: t, length: 0.08, velocity: 0.35 });
        add({ voice: 'shaker', time: t + MUSIC_BEAT / 2, length: 0.08, velocity: 0.5 });
        if (beat === 0) add({ voice: 'bass', time: t, length: MUSIC_BEAT * 2 - 0.05, pitch: chord.root, velocity: 0.75 });
        if (beat === 2) add({ voice: 'bass', time: t, length: MUSIC_BEAT * 2 - 0.05, pitch: chord.root, velocity: 0.6 });
      } else {
        add({ voice: 'bass', time: t + MUSIC_BEAT / 2, length: MUSIC_BEAT / 2 - 0.03, pitch: chord.root, velocity: 0.8 });
        if (b % 2 === 1) add({ voice: 'openhat', time: t + MUSIC_BEAT / 2, length: 0.25, velocity: 0.35 });
      }
    }
    if (style.pluck) {
      const tones = [...chord.pad, chord.pad[0] + 12];
      // Up and down through the chord, an octave over the pad.
      const order = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 1, 3];
      for (let s = 0; s < 16; s++) {
        add({ voice: 'pluck', time: barStart + (s * MUSIC_BEAT) / 4, length: 0.2, pitch: tones[order[s] % tones.length] + 12, velocity: s % 4 === 0 ? 0.7 : 0.5, pan: s % 2 ? 0.35 : -0.35 });
      }
    } else {
      // A bell on the chord's top note, twice a bar.
      add({ voice: 'bell', time: barStart, length: 1.4, pitch: chord.pad[chord.pad.length - 1] + 12, velocity: 0.35, pan: -0.2 });
      add({ voice: 'bell', time: barStart + MUSIC_BEAT * 2.5, length: 1.2, pitch: chord.pad[1] + 12, velocity: 0.28, pan: 0.2 });
    }
    if (lastBar) {
      add({ voice: 'riser', time: barStart, length: MUSIC_BAR, velocity: 0.55 });
      for (let i = 0; i < 8; i++) add({ voice: 'snare', time: barStart + MUSIC_BEAT * 2 + (i * MUSIC_BEAT) / 4, length: 0.1, velocity: 0.2 + 0.06 * i });
    }
  }

  // ---- the close: a hit, then the last chord ringing with a bell melody over it ----
  if (close < duration) {
    const rest = duration - close;
    add({ voice: 'impact', time: close, length: Math.min(2.4, rest), velocity: 0.9 });
    add({ voice: 'crash', time: close, length: 2.2, velocity: 0.45 });
    add({ voice: 'kick', time: close, length: 0.5, velocity: 0.95 });
    for (const pitch of style.last.pad) add({ voice: 'pad', time: close, length: rest, pitch, velocity: 0.7 });
    add({ voice: 'bass', time: close, length: Math.min(rest, MUSIC_BAR * 1.5), pitch: style.last.root, velocity: 0.7 });
    style.bell.forEach((pitch, i) => {
      const t = close + MUSIC_BEAT * (0.5 + i);
      if (t < duration - 0.4) add({ voice: 'bell', time: t, length: 1.6, pitch, velocity: 0.42 - i * 0.03, pan: i % 2 ? 0.25 : -0.25 });
    });
  }

  // ---- a cymbal on every cut from the drop on; the close has its own ----
  for (const t of cuts) {
    if (t > groove - 0.01 && t < close - 0.01) add({ voice: 'crash', time: t, length: 1.4, velocity: t < groove + 0.01 ? 0.4 : 0.2 });
  }

  return { track, duration, groove, close, notes: notes.sort((a, b) => a.time - b.time) };
}

/** A MIDI note's frequency in hertz. */
export function frequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}
