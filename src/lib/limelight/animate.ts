/**
 * What a Limelight scene shows at a moment: the camera, every actor's place
 * and every screen's picture, worked out from the scene and the time alone.
 *
 * Keys are sampled channel by channel. The camera is ten numbers and a pose
 * eight, and each number follows the same rule between two keys:
 *
 *   - smooth, snappy and bounce start from rest and arrive at rest, on their
 *     own timing curve, along a straight line between the two values;
 *   - steady runs that line at one speed;
 *   - cut holds the first value until the second key's time;
 *   - glide is a cubic Hermite curve whose slope at each key is shared with
 *     the segment next to it, so a run of glides is one move that never stops.
 *     Where a glide meets another kind of segment it takes that segment's
 *     speed at the key (zero after a stop, the line's speed beside steady), so
 *     the camera never jerks at the join.
 *
 * The slopes inside a run of glides are Fritsch and Carlson's monotone ones:
 * a value never swings past the keys on either side of it, so a camera
 * gliding in to 20 cm never dips to 18 on the way.
 *
 * Angles are plain numbers here, never wrapped, so a shot at azimuth 0 and the
 * next at 360 is a full turn round the stage.
 */

import type {
  ActorFrame,
  ActorPose,
  CameraShot,
  CameraState,
  LimelightActor,
  LimelightEase,
  LimelightScene,
  SceneFrame,
  ScreenChange,
  ScreenFrame,
  TextReveal,
  TextRevealStyle,
} from './types';

// ---------------------------------------------------------------------------
// Timing curves
// ---------------------------------------------------------------------------

/** A CSS cubic-bezier(x1, y1, x2, y2), solved for y at x by Newton's method with a bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-7) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const value = sampleX(t);
      if (Math.abs(value - x) < 1e-7) break;
      if (value < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** CSS ease-in-out. */
const smoothCurve = cubicBezier(0.42, 0, 0.58, 1);
/** Material's emphasized decelerate: still at the start for a moment, most of the way in the first third, a long settle. */
const snappyCurve = cubicBezier(0.2, 0, 0, 1);

/**
 * A spring let go from rest: about 11% past the target at a third of the way,
 * then settled. e^-7 is under a thousandth, and the last step is hidden by
 * landing exactly on 1 at the end.
 */
function bounceCurve(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const a = 7;
  const b = 10;
  return 1 - Math.exp(-a * u) * (Math.cos(b * u) + (a / b) * Math.sin(b * u));
}

/** Where a segment of this kind is, 0 to 1 along its straight line, at `u` of its time. */
export function easeProgress(ease: LimelightEase, u: number): number {
  const x = Math.min(1, Math.max(0, u));
  switch (ease) {
    case 'steady':
      return x;
    case 'snappy':
      return snappyCurve(x);
    case 'bounce':
      return bounceCurve(x);
    case 'cut':
      return x >= 1 ? 1 : 0;
    case 'smooth':
    case 'glide':
    default:
      return smoothCurve(x);
  }
}

// ---------------------------------------------------------------------------
// Tracks of numbers
// ---------------------------------------------------------------------------

/** Keys of one track: times in order, the ease each key leaves by, and the values as rows of numbers. */
export interface Track {
  times: number[];
  eases: LimelightEase[];
  values: number[][];
}

/** The speed a segment has at one of its ends, per second, for a glide beside it. */
function segmentSpeedAt(track: Track, segment: number, channel: number): number {
  const { times, eases, values } = track;
  if (eases[segment] !== 'steady') return 0;
  const dt = times[segment + 1] - times[segment];
  return dt > 0 ? (values[segment + 1][channel] - values[segment][channel]) / dt : 0;
}

/**
 * The slope at key `k` for the glides on either side of it. Inside a run of
 * glides it is the monotone slope; where a glide meets anything else it is
 * that segment's own speed at the key; at the first or last key it is the
 * one-sided slope, so a run of two glides is a straight drift.
 */
function glideSlope(track: Track, k: number, channel: number): number {
  const { times, eases, values } = track;
  const last = times.length - 1;
  const glideBefore = k > 0 && eases[k - 1] === 'glide';
  const glideAfter = k < last && eases[k] === 'glide';
  if (glideBefore && !glideAfter) return k < last ? segmentSpeedAt(track, k, channel) : secant(track, k - 1, channel);
  if (glideAfter && !glideBefore) return k > 0 ? segmentSpeedAt(track, k - 1, channel) : secant(track, k, channel);
  if (!glideBefore && !glideAfter) return 0;
  // Inside a run: Fritsch and Carlson.
  const before = secant(track, k - 1, channel);
  const after = secant(track, k, channel);
  if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) return 0;
  const h0 = times[k] - times[k - 1];
  const h1 = times[k + 1] - times[k];
  const w1 = 2 * h1 + h0;
  const w2 = h1 + 2 * h0;
  const slope = (w1 + w2) / (w1 / before + w2 / after);
  // Keeps the curve inside the two neighbouring values.
  const limit = 3 * Math.min(Math.abs(before), Math.abs(after));
  return Math.sign(slope) * Math.min(Math.abs(slope), limit);
}

function secant(track: Track, segment: number, channel: number): number {
  const dt = track.times[segment + 1] - track.times[segment];
  return dt > 0 ? (track.values[segment + 1][channel] - track.values[segment][channel]) / dt : 0;
}

/** The index of the segment holding time t: the last key at or before it. */
export function segmentAt(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (t >= times[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Every channel of a track at time t. */
export function sampleTrack(track: Track, t: number): number[] {
  const { times, eases, values } = track;
  const count = times.length;
  if (count === 0) return [];
  if (count === 1 || t <= times[0]) return values[0].slice();
  if (t >= times[count - 1]) return values[count - 1].slice();
  const k = segmentAt(times, t);
  const a = values[k];
  const b = values[k + 1];
  const dt = times[k + 1] - times[k];
  if (dt <= 0) return b.slice();
  const u = (t - times[k]) / dt;
  const ease = eases[k];
  if (ease !== 'glide') {
    const s = easeProgress(ease, u);
    return a.map((value, c) => value + (b[c] - value) * s);
  }
  // Cubic Hermite on time, with the slopes in units per second.
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return a.map((value, c) => h00 * value + h10 * dt * glideSlope(track, k, c) + h01 * b[c] + h11 * dt * glideSlope(track, k + 1, c));
}

// ---------------------------------------------------------------------------
// The camera
// ---------------------------------------------------------------------------

export function cameraToNumbers(c: CameraState): number[] {
  return [c.target.x, c.target.y, c.target.z, c.azimuth, c.elevation, c.distance, c.roll, c.lens, c.aperture, c.focus];
}

export function cameraFromNumbers(n: number[]): CameraState {
  return {
    target: { x: n[0], y: n[1], z: n[2] },
    azimuth: n[3],
    elevation: n[4],
    distance: n[5],
    roll: n[6],
    lens: n[7],
    aperture: n[8],
    focus: n[9],
  };
}

const trackCache = new WeakMap<object, Track>();

/** One track per list of keys, kept while the list is the same object (a scene edit makes a new one). */
function trackOf<K extends { time: number; ease: LimelightEase }>(keys: K[], toNumbers: (key: K) => number[]): Track {
  const cached = trackCache.get(keys);
  if (cached) return cached;
  const track: Track = { times: keys.map((key) => key.time), eases: keys.map((key) => key.ease), values: keys.map(toNumbers) };
  trackCache.set(keys, track);
  return track;
}

/**
 * A handheld wobble from a few slow sines whose periods never line up, so it
 * never visibly repeats. The same time always gives the same wobble, which is
 * what lets a frame be drawn again exactly.
 */
export function wobble(t: number, seed: number): number {
  const s = seed * 1.618;
  return (
    0.5 * Math.sin(2 * Math.PI * 0.31 * t + s) +
    0.3 * Math.sin(2 * Math.PI * 0.73 * t + 2.1 * s) +
    0.2 * Math.sin(2 * Math.PI * 1.37 * t + 3.7 * s)
  );
}

/** The camera at time t, with the shake on top. */
export function cameraAt(shots: CameraShot[], shake: number, t: number): CameraState {
  const camera = cameraFromNumbers(sampleTrack(trackOf(shots, (shot) => cameraToNumbers(shot.camera)), t));
  if (shake > 0) {
    camera.azimuth += shake * 1.2 * wobble(t, 1);
    camera.elevation += shake * 0.8 * wobble(t, 2);
    camera.roll += shake * 0.7 * wobble(t, 3);
    const reach = shake * 0.004 * camera.distance;
    camera.target = {
      x: camera.target.x + reach * wobble(t, 4),
      y: camera.target.y + reach * wobble(t, 5),
      z: camera.target.z,
    };
  }
  return camera;
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

function poseToNumbers(p: ActorPose): number[] {
  return [p.position.x, p.position.y, p.position.z, p.turn.yaw, p.turn.pitch, p.turn.roll, p.scale, p.opacity];
}

/** A number from 0 to 1 that stays the same for one id, so two floating phones never bob in step. */
export function phaseOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/** Seconds for one bob of a floating actor. */
export const FLOAT_PERIOD = 5;

export function actorAt(actor: LimelightActor, t: number): ActorFrame {
  const n = sampleTrack(trackOf(actor.poses, poseToNumbers), t);
  const frame: ActorFrame = {
    position: { x: n[0], y: n[1], z: n[2] },
    turn: { yaw: n[3], pitch: n[4], roll: n[5] },
    scale: Math.max(0, n[6]),
    opacity: Math.min(1, Math.max(0, n[7])),
  };
  const { float, spin } = actor.motion;
  if (float > 0) {
    const phase = phaseOf(actor.id) * 2 * Math.PI;
    frame.position.y += float * Math.sin((2 * Math.PI * t) / FLOAT_PERIOD + phase);
    // A slight sway with the bob, slower so the two never line up.
    frame.turn.roll += float * 0.5 * Math.sin((2 * Math.PI * t) / (FLOAT_PERIOD * 1.45) + phase * 1.7);
    frame.turn.pitch += float * 0.35 * Math.sin((2 * Math.PI * t) / (FLOAT_PERIOD * 1.9) + phase * 2.3);
  }
  if (spin !== 0) frame.turn.yaw += spin * t;
  return frame;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/**
 * The picture on a device's display at time t. Before the first change the
 * display already shows that change's picture, so a scene never opens on a
 * screen that is off by accident.
 */
export function screenAt(screens: ScreenChange[], t: number): ScreenFrame {
  if (screens.length === 0) return { media: null, transition: 'cut', progress: 1 };
  let k = 0;
  for (let i = 0; i < screens.length; i++) {
    if (screens[i].time <= t) k = i;
    else break;
  }
  const current = screens[k];
  if (k === 0 || current.transition === 'cut' || current.duration <= 0) {
    return { media: current.media, transition: current.transition, progress: 1 };
  }
  const progress = (t - current.time) / current.duration;
  if (progress >= 1 || progress < 0) return { media: current.media, transition: current.transition, progress: 1 };
  return { media: current.media, previous: screens[k - 1].media, transition: current.transition, progress };
}

// ---------------------------------------------------------------------------
// Words that come in one after another
// ---------------------------------------------------------------------------

/**
 * Seconds each word of a reveal takes to come in. The words overlap: the next
 * one starts before the last is in place, the way a type designer staggers
 * them, and the last one lands at `time + duration`.
 */
export function revealEach(reveal: TextReveal, count: number): number {
  if (count <= 1) return reveal.duration;
  return Math.min(reveal.duration, Math.max(0.25, reveal.duration * 0.45));
}

/**
 * How far each of `count` words (or letters) of a title has come in at time
 * t: 0 before it starts, 1 once it is in place. Written into `out`, so a stage
 * drawing every frame makes no garbage.
 */
export function revealProgress(reveal: TextReveal | undefined, count: number, t: number, out: number[] = []): number[] {
  out.length = count;
  if (!reveal) {
    out.fill(1);
    return out;
  }
  const each = revealEach(reveal, count);
  const gap = count > 1 ? (reveal.duration - each) / (count - 1) : 0;
  for (let i = 0; i < count; i++) {
    const u = (t - reveal.time - gap * i) / each;
    // The last word lands exactly at the end, not a rounding error short of it.
    out[i] = u <= 0 ? 0 : u >= 1 - 1e-9 ? 1 : u;
  }
  return out;
}

/** How one word looks at `progress` (0 to 1) of coming in. */
export interface RevealLook {
  /** 0 to 1. */
  opacity: number;
  /** Line heights below its place it still is. 0 is in place. */
  drop: number;
  /** True when the part below its line is cut away, so it seems to come up from behind the line. */
  masked: boolean;
  /** 1 is its own size. */
  scale: number;
}

export function revealLook(style: TextRevealStyle, progress: number): RevealLook {
  const u = Math.min(1, Math.max(0, progress));
  switch (style) {
    case 'rise':
      // A quick start and a long settle, coming up from behind the line.
      return { opacity: Math.min(1, u * 3), drop: 1 - snappyCurve(u), masked: true, scale: 1 };
    case 'fade':
      return { opacity: smoothCurve(u), drop: 0.3 * (1 - snappyCurve(u)), masked: false, scale: 1 };
    case 'pop':
      // From half size, about 5% past its size at a third of the way, then settled.
      return { opacity: Math.min(1, u * 3), drop: 0, masked: false, scale: 0.5 + 0.5 * bounceCurve(u) };
  }
}

// ---------------------------------------------------------------------------
// The whole scene
// ---------------------------------------------------------------------------

export function sceneAt(scene: LimelightScene, t: number): SceneFrame {
  const actors: SceneFrame['actors'] = {};
  const screens: SceneFrame['screens'] = {};
  const pictures: SceneFrame['pictures'] = {};
  for (const actor of scene.actors) {
    if (actor.hidden) continue;
    actors[actor.id] = actorAt(actor, t);
    if (actor.kind === 'device') screens[actor.id] = screenAt(actor.screens, t);
    else if (actor.kind === 'picture') pictures[actor.id] = actor.media;
  }
  return { time: t, camera: cameraAt(scene.camera.shots, scene.camera.shake, t), actors, screens, pictures };
}

/**
 * The pictures a frame shows: each screen's own, the one going out while a
 * transition runs, and each picture card's that is showing.
 */
export function frameMediaIds(frame: SceneFrame): Set<string> {
  const ids = new Set<string>();
  for (const screen of Object.values(frame.screens)) {
    if (screen.media) ids.add(screen.media);
    if (screen.previous && screen.progress < 1) ids.add(screen.previous);
  }
  for (const [actorId, media] of Object.entries(frame.pictures)) {
    if (media && (frame.actors[actorId]?.opacity ?? 0) > 0) ids.add(media);
  }
  return ids;
}
