// What the stage draws at a moment of a film: the plan's pose (or a take's
// turn), the tap rings that are showing, and room for the words.

import { depthZoom } from './depth';
import { scaleTurn, takeAt, type Quat } from './motion';
import { CARD_SECONDS, endHold, hasCard, jumpsBetween, poseAt } from './plan';
import type { ActiveTap, StageFrame } from './stage';
import { bodyLength } from './timeline';
import type { CaptionCue, Film, FilmFormat, FilmPlan, FilmText } from './types';

/** The film's length: the recordings (or the placeholder), then the end hold. */
export function filmDuration(film: Pick<Film, 'clips' | 'placeholderLength' | 'text'>): number {
  return bodyLength(film) + endHold(film.text);
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

/** Where the words go in a picture of this shape: beside the phone in a wide picture, else at the top, or at the bottom for bold captions. */
export function wordsSide(format: FilmFormat, text?: Pick<FilmText, 'style'>): 'top' | 'left' | 'bottom' {
  if (format === 'landscape') return 'left';
  return text?.style === 'punchy' ? 'bottom' : 'top';
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

/** A hand's moves at one moment: the turn, the pinch, and the distance toward the person in metres. */
export interface HandMoves {
  q: Quat;
  zoom: number;
  depth?: number;
}

/** How much a hand's moves zoom in: the pinch, and forward and back while the film has it on. */
export function handZoom(film: Pick<Film, 'handDepth'>, zoom: number, depth = 0): number {
  // Turning forward and back off takes it out of a take recorded with it, too.
  return Math.min(3, Math.max(0.6, zoom * (film.handDepth ? depthZoom(depth) : 1)));
}

/** How far the picture moves between two frames, in picture heights, roughly: zoom, turn, framing and lift. */
export function pictureTravel(a: StageFrame, b: StageFrame): number {
  const zoom = (a.pose.zoom + b.pose.zoom) / 2;
  const scale = Math.abs(Math.log(b.pose.zoom / a.pose.zoom)) * 0.5;
  let turn: number;
  if (a.turn && b.turn) {
    const dot = Math.abs(a.turn[0] * b.turn[0] + a.turn[1] * b.turn[1] + a.turn[2] * b.turn[2] + a.turn[3] * b.turn[3]);
    turn = 2 * Math.acos(Math.min(1, dot));
  } else {
    const deg = Math.hypot(b.pose.yaw - a.pose.yaw, b.pose.pitch - a.pose.pitch, b.pose.roll - a.pose.roll);
    turn = (deg * Math.PI) / 180;
  }
  const frame = Math.hypot(b.pose.fx - a.pose.fx, b.pose.fy - a.pose.fy) * 0.8 + Math.abs(b.pose.lift - a.pose.lift) / 1.24 + Math.hypot(b.shift.x - a.shift.x, b.shift.y - a.shift.y);
  return scale + (turn * 0.5 + frame) * zoom;
}

/** Below this travel in half a frame, a frame is one picture: about 8 pixels of a 1920 high video. */
const BLUR_FROM = 0.004;
/** The most pictures one frame averages. */
const BLUR_MOST = 8;

/**
 * The film times a frame at `t` averages, as a camera's shutter open for
 * half a frame would: just `t` while the picture holds or moves slowly, up
 * to 8 across the half frame in a fast move. Never across a cut, which
 * would show two pictures at once.
 */
export function blurTimes(film: Film, plan: FilmPlan, t: number, fps: number): number[] {
  const shutter = 0.5 / fps;
  const from = Math.max(0, t - shutter / 2);
  const to = t + shutter / 2;
  if (jumpsBetween(plan, from - shutter, to + shutter)) return [t];
  const travel = pictureTravel(stageFrameAt(film, plan, from), stageFrameAt(film, plan, to));
  const count = Math.min(BLUR_MOST, Math.round(travel / BLUR_FROM));
  if (count < 2) return [t];
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

/**
 * The stage at film time `t`. `live` is a phone moving the film right now:
 * it stands in for the take, so the picture is what a take of those moves would show.
 */
export function stageFrameAt(film: Film, plan: FilmPlan, t: number, live?: HandMoves | null): StageFrame {
  const pose = poseAt(plan, t, film.style);
  let turn: StageFrame['turn'] = null;
  const held = live ?? (film.motion === 'hand' && film.take && film.take.samples.length > 1 ? takeAt(film.take.samples, t) : null);
  if (held) {
    turn = scaleTurn(held.q, film.takeStrength);
    pose.zoom *= handZoom(film, held.zoom, held.depth);
  }
  // Make room for the words in wide shots; in a close-up they go over the picture.
  const room = wordsPresence(plan.cues, t) * smoothstep((1.55 - pose.zoom) / 0.5);
  const side = wordsSide(film.format, film.text);
  const shift = side === 'left' ? { x: 0.17 * room, y: 0 } : { x: 0, y: (side === 'bottom' ? 0.09 : -0.1) * room };
  // A card over the film's own backdrop clears the backdrop's discs away as it comes in.
  const clear = hasCard(film.text) && !film.text.card?.light ? smoothstep((t - (plan.duration - CARD_SECONDS)) / 0.6) : 0;
  return { pose, turn, t, shift, taps: activeTaps(plan, t), ...(clear > 0 ? { backdropOut: clear } : {}) };
}
