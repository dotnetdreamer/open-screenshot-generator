// The director: from the moments in a recording to a camera that follows
// them. Pure and fast, so the plan is made again on every edit.
//
// The shape of a film:
//  - The phone rises and turns in over the first second or so.
//  - Between moments the camera holds a wide shot, turned to one side, and
//    changes side each time it comes back out, so the film never repeats a
//    picture.
//  - The moments that matter most (taps, typing) get close-ups. The camera
//    gets there a little before the moment starts, so the viewer sees it
//    happen, and stays a little after it ends.
//  - Two close-ups close together are joined by a pan, without going back out.
//  - At the end the phone turns to face the viewer for the end card.

import type { CameraKey, CaptionCue, DirectorStyle, Ease, FilmFormat, FilmPlan, FilmText, Moment, Pose, TapMark } from './types';

export interface StyleRules {
  /** Seconds the camera arrives before a moment starts. */
  lead: number;
  /** Seconds it stays after a moment ends. */
  hold: number;
  /** Seconds a camera move takes. */
  move: number;
  /** The closest and farthest a close-up goes. */
  closeZoom: [number, number];
  heroYaw: number;
  heroPitch: number;
  heroRoll: number;
  wideYaw: number;
  closeYaw: number;
  /** Degrees of slow sway, so a held shot is never frozen. */
  drift: number;
  ease: Ease;
  /** Two close-ups nearer than this are joined by a pan. */
  joinWithin: number;
  /** The share of the film that can be close-ups. */
  closeShare: number;
  /** How far the phone is turned when it comes in. */
  introTurn: number;
  introSeconds: number;
}

export const STYLES: Record<DirectorStyle, StyleRules> = {
  calm: {
    lead: 0.45,
    hold: 0.75,
    move: 1.05,
    closeZoom: [1.4, 1.9],
    heroYaw: 16,
    heroPitch: 7,
    heroRoll: 2,
    wideYaw: 8,
    closeYaw: 6,
    drift: 1.4,
    ease: 'glide',
    joinWithin: 1.7,
    closeShare: 0.45,
    introTurn: 32,
    introSeconds: 1.7,
  },
  lively: {
    lead: 0.35,
    hold: 0.55,
    move: 0.75,
    closeZoom: [1.5, 2.2],
    heroYaw: 21,
    heroPitch: 9,
    heroRoll: 3,
    wideYaw: 11,
    closeYaw: 9,
    drift: 2,
    ease: 'smooth',
    joinWithin: 1.2,
    closeShare: 0.6,
    introTurn: 42,
    introSeconds: 1.35,
  },
  bold: {
    lead: 0.25,
    hold: 0.4,
    move: 0.5,
    closeZoom: [1.7, 2.6],
    heroYaw: 27,
    heroPitch: 11,
    heroRoll: 4,
    wideYaw: 15,
    closeYaw: 12,
    drift: 2.4,
    ease: 'snappy',
    joinWithin: 0.8,
    closeShare: 0.7,
    introTurn: 58,
    introSeconds: 1.05,
  },
};

/** The phone's proportions, in phone heights: the body's width and the screen's size. */
export interface PhoneShape {
  width: number;
  screenW: number;
  screenH: number;
}

/** Width over height of each picture shape. */
export const FORMAT_ASPECT: Record<FilmFormat, number> = {
  vertical: 9 / 16,
  portrait: 4 / 5,
  square: 1,
  landscape: 16 / 9,
};

/** The picture's height at zoom 1, in phone heights: the whole phone with room around it. */
export const WIDE_VIEW = 1.24;

export interface PlanInput {
  /** The film's length, the end card included. */
  duration: number;
  /** Where the recording's last frame is, in film seconds. */
  recordingEnd: number;
  moments: Moment[];
  style: DirectorStyle;
  format: FilmFormat;
  phone: PhoneShape;
  text: FilmText;
}

export const REST_POSE: Pose = { yaw: 0, pitch: 0, roll: 0, fx: 0.5, fy: 0.5, zoom: 1, lift: 0 };

/** Seconds the film runs on after the recording's last frame, holding it, for the end move and card. */
export function endHold(text: FilmText): number {
  return text.end.trim() ? 1.8 : 0.7;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function hero(rules: StyleRules, side: number): Pose {
  return { yaw: side * rules.heroYaw, pitch: rules.heroPitch, roll: -side * rules.heroRoll, fx: 0.5, fy: 0.5, zoom: 1, lift: 0 };
}

function wide(rules: StyleRules, side: number): Pose {
  return { yaw: side * rules.wideYaw, pitch: 3, roll: -side * 0.6, fx: 0.5, fy: 0.5, zoom: 1.04, lift: 0 };
}

/** Close-ups showing more than this share of the screen's width widen to all of it, and a little more for the turn. */
const FULL_WIDTH_FROM = 0.78;
const FULL_WIDTH = 1.06;

/**
 * The close-up on a moment: zoomed so its area fills most of the picture,
 * and centred on it, but never so far that the picture runs off the phone.
 */
export function closePose(moment: Moment, rules: StyleRules, side: number, phone: PhoneShape, aspect: number): Pose {
  const focus = moment.focus ?? { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
  const fw = Math.max(0.12, focus.w) * phone.screenW;
  const fh = Math.max(0.08, focus.h) * phone.screenH;
  // The picture height that fits the area: 62% of the height, 84% of the width.
  const needed = Math.max(fh / 0.62, fw / (0.84 * aspect));
  let zoom = clamp(WIDE_VIEW / needed, rules.closeZoom[0], rules.closeZoom[1]);
  // A picture that would show nearly the screen's whole width shows all of
  // it, edge to edge: a sliver cut off one side reads as a mistake ("mount"
  // for "Amount"), not as a close-up.
  const widthShown = ((WIDE_VIEW / zoom) * aspect) / phone.screenW;
  if (widthShown > FULL_WIDTH_FROM && widthShown < FULL_WIDTH) zoom = (WIDE_VIEW * aspect) / (phone.screenW * FULL_WIDTH);
  const viewH = WIDE_VIEW / zoom;
  const viewW = viewH * aspect;
  // Half the picture in screen fractions; the centre stays where the picture covers the screen.
  const halfY = viewH / 2 / phone.screenH;
  const halfX = viewW / 2 / phone.screenW;
  const centre = moment.point && moment.kind === 'tap' ? { x: (focus.x + focus.w / 2 + moment.point.x) / 2, y: (focus.y + focus.h / 2 + moment.point.y) / 2 } : { x: focus.x + focus.w / 2, y: focus.y + focus.h / 2 };
  const fy = halfY >= 0.5 ? 0.5 : clamp(centre.y, halfY * 0.92, 1 - halfY * 0.92);
  const fx = halfX >= 0.5 ? 0.5 : clamp(centre.x, halfX * 0.92, 1 - halfX * 0.92);
  return { yaw: side * rules.closeYaw, pitch: 4, roll: -side * 1.2, fx, fy, zoom, lift: 0 };
}

interface Close {
  moment: Moment;
  arrive: number;
  leave: number;
}

/** Two close-ups this near are joined by a pan rather than going back out between them. */
function joins(rules: StyleRules, a: Close, b: Close): boolean {
  return b.arrive - a.leave <= rules.joinWithin;
}

/** Seconds of close-ups: each close-up's own time, and the pans between joined ones. */
function closeTime(rules: StyleRules, closes: Close[]): number {
  const sorted = [...closes].sort((a, b) => a.arrive - b.arrive);
  let total = 0;
  sorted.forEach((c, i) => {
    total += c.leave - c.arrive;
    const next = sorted[i + 1];
    if (next && joins(rules, c, next)) total += Math.max(0, next.arrive - c.leave);
  });
  return total;
}

/**
 * The moments that get close-ups: the user's picks, then the heaviest that
 * fit. Two close-ups may follow each other closely (a pan joins them), but
 * never so closely that the second starts before the first one's action ends.
 */
function pickCloseUps(input: PlanInput, rules: StyleRules, introEnd: number): Close[] {
  const limit = input.duration * rules.closeShare;
  const window = (m: Moment): Close => ({ moment: m, arrive: m.start - rules.lead, leave: m.end + rules.hold });
  const forced = input.moments.filter((m) => m.shot === 'close');
  // A close-up on most of the screen shows nothing the wide shot doesn't. And
  // a press that opens a new screen stays wide, so the new screen is seen
  // whole; Bold punches in on it anyway, for the energy.
  // A sheet closing reads as a slide: one that starts right after the tap counts too.
  const opensScreen = (m: Moment) =>
    m.kind === 'tap' &&
    input.moments.some(
      (s) => s.start >= m.start - 0.05 && ((s.kind === 'screen' && s.start <= m.end + rules.hold + 0.1) || (s.kind === 'scroll' && s.start <= m.end + 0.3))
    );
  const optional = input.moments
    .filter((m) => m.shot === 'auto' && (m.kind === 'tap' || m.kind === 'type' || m.kind === 'change') && m.focus && m.focus.w * m.focus.h <= 0.35)
    .filter((m) => input.style === 'bold' || !opensScreen(m))
    .sort((a, b) => b.weight - a.weight || a.start - b.start);
  const chosen: Close[] = forced.map((m) => {
    const c = window(m);
    // A close-up the user asked for always happens, even if it means a shorter move.
    return { ...c, arrive: Math.max(c.arrive, 0.2), leave: Math.min(c.leave, input.recordingEnd + 0.4) };
  });
  const clear = (a: Close, b: Close) => {
    const [first, second] = a.arrive <= b.arrive ? [a, b] : [b, a];
    // Joined by a pan: the first action has to be over before the camera leaves for the second.
    if (joins(rules, first, second)) return second.moment.start - first.moment.end >= rules.move * 0.6 + 0.1;
    // Apart: time to go back out and come in again.
    return second.arrive - first.leave >= rules.move * 0.5;
  };
  for (const m of optional) {
    const c = window(m);
    if (c.arrive - rules.move < introEnd - 0.05 || c.leave > input.recordingEnd + 0.4) continue;
    if (!chosen.every((o) => clear(o, c))) continue;
    if (closeTime(rules, [...chosen, c]) > limit) continue;
    chosen.push(c);
  }
  return chosen.sort((a, b) => a.arrive - b.arrive);
}

export function planFilm(input: PlanInput): FilmPlan {
  const rules = STYLES[input.style];
  const aspect = FORMAT_ASPECT[input.format];
  const keys: CameraKey[] = [];
  let side = -1;
  let now = 0;
  let pose: Pose;

  const add = (t: number, next: Pose, ease: Ease, why?: string) => {
    if (t <= now + 1e-6) return;
    keys.push({ t, pose: next, ease, why });
    now = t;
    pose = next;
  };
  const hold = (until: number, why?: string) => add(until, pose, 'linear', why);

  // ---- the opening: the phone rises and turns in
  const introEnd = Math.min(rules.introSeconds, Math.max(0.6, input.recordingEnd * 0.3));
  pose = { yaw: -side * rules.introTurn, pitch: rules.heroPitch + 14, roll: side * 7, fx: 0.5, fy: 0.5, zoom: 0.8, lift: -0.42 };
  keys.push({ t: 0, pose, ease: 'linear', why: 'intro' });
  add(introEnd, hero(rules, side), input.style === 'calm' ? 'smooth' : 'snappy', 'hero');

  const closes = pickCloseUps(input, rules, introEnd);

  /**
   * The wide shot until `until`, moving with what happens on the screen: a
   * new screen swings the phone to the other side as it settles, a scroll
   * leans in a little, and a long pause pushes in slowly. Every move is
   * caused by something in the recording, so none of them feels random.
   */
  // When the last move the recording caused ended: the next one waits a
  // little, so a busy stretch doesn't swing the phone back and forth.
  let lastMove = -Infinity;
  const holdWide = (until: number) => {
    if (until <= now) return;
    const ahead = input.moments.filter((m) => m.start >= now - 0.05 && m.start < until - 0.3).sort((a, b) => a.start - b.start);
    for (const m of ahead) {
      if ((m.kind === 'screen' || m.kind === 'scroll') && m.start - lastMove < rules.move * 1.5) continue;
      if (m.kind === 'screen') {
        const start = Math.max(now, m.start);
        const end = Math.min(until, Math.max(start + rules.move * 0.8, m.end + 0.25));
        if (end - start < 0.35) continue;
        hold(start);
        side = -side;
        add(end, wide(rules, side), rules.ease, `with ${m.id}`);
        lastMove = end;
      } else if (m.kind === 'scroll') {
        const start = Math.max(now, m.start);
        const end = Math.min(until, Math.max(start + 0.6, m.end));
        if (end - start < 0.4) continue;
        hold(start);
        add(end, { ...pose, zoom: Math.min(1.2, pose.zoom + 0.07), pitch: pose.pitch - 2 }, 'glide', `with ${m.id}`);
        lastMove = end;
      } else if (m.kind === 'still' && m.end - Math.max(m.start, now) > 1 && pose.zoom < 1.2) {
        const from = Math.max(now, m.start);
        const to = Math.min(until, m.end);
        hold(from);
        add(to, { ...pose, zoom: pose.zoom + Math.min(0.12, 0.04 * (to - from)) }, 'linear', 'push in');
      }
    }
    hold(until);
  };

  /** How long the pan to a joined close-up takes: never past its arrival, never so short it jerks. */
  const panTime = (from: Close, to: Close) => Math.min(rules.move, Math.max(rules.move * 0.6, to.arrive - from.moment.end - 0.1));

  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    const previous = closes[i - 1];
    const joined = !!previous && joins(rules, previous, close);
    if (joined) side = -side;
    const target = closePose(close.moment, rules, side, input.phone, aspect);
    const move = joined ? panTime(previous, close) : rules.move;
    const start = Math.max(now, close.arrive - move);
    if (!joined) holdWide(start);
    else hold(start);
    add(Math.max(close.arrive, start + move * 0.6), target, rules.ease, `${joined ? 'pan to' : 'close on'} ${close.moment.id}`);
    const next = closes[i + 1];
    if (next && joins(rules, close, next)) {
      // Stay until the pan to the next one has to start.
      hold(Math.min(close.leave, next.arrive - panTime(close, next)), `hold ${close.moment.id}`);
    } else {
      hold(close.leave, `hold ${close.moment.id}`);
      side = -side;
      add(close.leave + rules.move, wide(rules, side), rules.ease, 'back out');
    }
  }

  // ---- the end: the phone turns to face the viewer
  const endStart = Math.max(now, input.recordingEnd - 0.3, input.duration - (input.text.end.trim() ? 1.9 : 1.2));
  holdWide(endStart);
  const endPose: Pose = { yaw: side * 6, pitch: 4, roll: 0, fx: 0.5, fy: 0.5, zoom: input.text.end.trim() ? 0.86 : 0.98, lift: input.text.end.trim() ? -0.08 : 0 };
  add(Math.min(input.duration, endStart + Math.max(0.7, rules.move * 1.1)), endPose, rules.ease, 'end');
  hold(input.duration);

  return { duration: input.duration, keys, taps: tapMarks(input), cues: captionCues(input, rules, introEnd) };
}

function tapMarks(input: PlanInput): TapMark[] {
  if (!input.text.taps) return [];
  return input.moments
    .filter((m) => m.kind === 'tap' && m.point && m.shot !== 'skip')
    .map((m) => ({ t: Math.max(0, m.start - 0.06), point: m.point! }));
}

function captionCues(input: PlanInput, rules: StyleRules, introEnd: number): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const title = input.text.title.trim();
  if (title) cues.push({ start: 0.15, end: Math.max(introEnd + 0.9, 2.2), text: title, role: 'title' });
  if (input.text.captions) {
    for (const m of input.moments) {
      const text = m.caption?.trim();
      if (!text || m.shot === 'skip') continue;
      cues.push({ start: Math.max(0, m.start - rules.lead), end: Math.min(input.duration, m.end + rules.hold + 0.3), text, role: 'caption' });
    }
  }
  const end = input.text.end.trim();
  if (end) cues.push({ start: Math.max(0, input.duration - 1.7), end: input.duration, text: end, role: 'end' });
  // Captions never overlap: a later one cuts the one before it short.
  cues.sort((a, b) => a.start - b.start);
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start < cues[i - 1].end) cues[i - 1].end = Math.max(cues[i - 1].start + 0.4, cues[i].start);
  }
  return cues;
}

// ---------------------------------------------------------------------------
// Reading the plan at a moment
// ---------------------------------------------------------------------------

/** A CSS-style cubic Bézier timing curve through (0,0), (x1,y1), (x2,y2), (1,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (u: number) => {
    const x = clamp(u, 0, 1);
    // Newton's method first, bisection if the slope is too flat to trust.
    let s = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(s) - x;
      const d = slopeX(s);
      if (Math.abs(err) < 1e-6) return sampleY(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 30; i++) {
      const value = sampleX(s);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

const CURVES: Record<Ease, (u: number) => number> = {
  linear: (u) => clamp(u, 0, 1),
  // Even in and out, like a camera on a slider.
  glide: cubicBezier(0.45, 0, 0.55, 1),
  smooth: cubicBezier(0.65, 0, 0.35, 1),
  // A quick start and a long, soft landing.
  snappy: cubicBezier(0.2, 0, 0, 1),
};

export function ease(kind: Ease, u: number): number {
  return (CURVES[kind] ?? CURVES.smooth)(u);
}

function mix(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

export function mixPose(a: Pose, b: Pose, u: number): Pose {
  return {
    yaw: mix(a.yaw, b.yaw, u),
    pitch: mix(a.pitch, b.pitch, u),
    roll: mix(a.roll, b.roll, u),
    fx: mix(a.fx, b.fx, u),
    fy: mix(a.fy, b.fy, u),
    zoom: Math.exp(mix(Math.log(a.zoom), Math.log(b.zoom), u)),
    lift: mix(a.lift, b.lift, u),
  };
}

/** The plan's pose at film time `t`, before any sway. */
export function plannedPose(plan: FilmPlan, t: number): Pose {
  const { keys } = plan;
  if (keys.length === 0) return REST_POSE;
  if (t <= keys[0].t) return keys[0].pose;
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i];
    if (t <= key.t) {
      const before = keys[i - 1];
      const u = (t - before.t) / Math.max(1e-6, key.t - before.t);
      return mixPose(before.pose, key.pose, ease(key.ease, u));
    }
  }
  return keys[keys.length - 1].pose;
}

/**
 * The slow sway added on top of the plan, so a held shot breathes. It calms
 * down in a close-up, where the words on the screen should stay readable.
 */
export function sway(t: number, style: DirectorStyle, zoom: number): Pick<Pose, 'yaw' | 'pitch' | 'roll' | 'lift'> {
  const amount = STYLES[style].drift * (1 - 0.65 * clamp((zoom - 1) / 1.4, 0, 1));
  return {
    yaw: amount * Math.sin((2 * Math.PI * t) / 7.3),
    pitch: amount * 0.55 * Math.sin((2 * Math.PI * t) / 9.1 + 1.3),
    roll: amount * 0.22 * Math.sin((2 * Math.PI * t) / 11.7 + 2.1),
    lift: amount * 0.0035 * Math.sin((2 * Math.PI * t) / 6.1 + 0.4),
  };
}

/** The pose at film time `t`, sway included. */
export function poseAt(plan: FilmPlan, t: number, style: DirectorStyle): Pose {
  const base = plannedPose(plan, t);
  const s = sway(t, style, base.zoom);
  return { ...base, yaw: base.yaw + s.yaw, pitch: base.pitch + s.pitch, roll: base.roll + s.roll, lift: base.lift + s.lift };
}
