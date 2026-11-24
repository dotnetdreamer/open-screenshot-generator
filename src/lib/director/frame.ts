// What the stage draws at a moment of a film: the plan's pose (or a take's
// turn), the tap rings that are showing, and room for the words.

import { scaleTurn, takeAt } from './motion';
import { endHold, poseAt } from './plan';
import type { ActiveTap, StageFrame } from './stage';
import type { CaptionCue, Film, FilmFormat, FilmPlan } from './types';

/** The film's length: the trimmed recording, then the end hold. */
export function filmDuration(film: Pick<Film, 'trim' | 'text'>): number {
  return Math.max(0.5, film.trim.end - film.trim.start) + endHold(film.text);
}

/** The recording's own time for film time `t`; the last frame holds through the end. */
export function recordingTime(film: Pick<Film, 'trim'>, t: number): number {
  return Math.min(film.trim.end, film.trim.start + Math.max(0, t));
}

/** How long a tap ring shows. */
const TAP_SECONDS = 0.95;
/** Seconds the phone takes to make room for words, and to give it back. */
const MAKE_ROOM = 0.5;

function smoothstep(x: number): number {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
}

/** 0 to 1: how much room the words need at `t`, eased in before a cue and out after it. */
export function wordsPresence(cues: CaptionCue[], t: number): number {
  let presence = 0;
  for (const cue of cues) {
    const into = smoothstep((t - (cue.start - MAKE_ROOM * 0.6)) / MAKE_ROOM);
    const out = 1 - smoothstep((t - cue.end + MAKE_ROOM * 0.2) / MAKE_ROOM);
    presence = Math.max(presence, Math.min(into, out));
  }
  return presence;
}

/** Where the words go in a picture of this shape. */
export function wordsSide(format: FilmFormat): 'top' | 'left' {
  return format === 'landscape' ? 'left' : 'top';
}

export function activeTaps(plan: FilmPlan, t: number): ActiveTap[] {
  const out: ActiveTap[] = [];
  for (const tap of plan.taps) {
    const age = t - tap.t;
    if (age >= 0 && age <= TAP_SECONDS) out.push({ x: tap.point.x, y: tap.point.y, age });
    if (out.length === 3) break;
  }
  return out;
}

export function stageFrameAt(film: Film, plan: FilmPlan, t: number): StageFrame {
  const pose = poseAt(plan, t, film.style);
  let turn: StageFrame['turn'] = null;
  if (film.motion === 'hand' && film.take && film.take.samples.length > 1) {
    const held = takeAt(film.take.samples, t);
    if (held) {
      turn = scaleTurn(held.q, film.takeStrength);
      pose.zoom *= Math.min(3, Math.max(0.6, held.zoom));
    }
  }
  // Make room for the words in wide shots; in a close-up they go over the picture.
  const room = wordsPresence(plan.cues, t) * smoothstep((1.55 - pose.zoom) / 0.5);
  const shift = wordsSide(film.format) === 'left' ? { x: 0.17 * room, y: 0 } : { x: 0, y: -0.1 * room };
  return { pose, turn, t, shift, taps: activeTaps(plan, t) };
}
