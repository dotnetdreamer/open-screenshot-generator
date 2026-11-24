// Reading a screen recording for what happens in it, from small grey frames
// (about 160 pixels on the long side, ten a second). Pure: the frames come
// from sample.ts in the browser, or from a test.
//
// Two frames side by side give one FrameChange: how much of the screen
// changed, whether the content slid (a scroll, a swipe) and by how much, and
// where the rest of the change is. A run of changes becomes a Moment: a tap
// where a small area changed, typing where letters and a keyboard change
// together, a scroll, a new screen, or a still stretch.
//
// The status bar and the home indicator are left out of every measure: the
// clock and the battery change on their own.

import type { ActivityTrack, Moment, MomentKind, Point01, Rect01 } from './types';

/** One small grey frame, 0 to 255 per pixel, row by row. */
export interface LumaFrame {
  t: number;
  width: number;
  height: number;
  data: Uint8Array;
}

export type ChangeLabel = 'still' | 'local' | 'scroll' | 'swipe' | 'screen';

export interface FrameChange {
  /** The later frame's time. */
  t: number;
  /** The share of the screen that changed, 0 to 1. */
  amount: number;
  /** Rows the content moved up (a finger swiping up gives a positive number). */
  shiftY: number;
  /** Columns the content moved left. */
  shiftX: number;
  /** How much of the change the slide explains, 0 to 1. */
  shiftFit: number;
  /** Where the change the slide doesn't explain is, or null when there is none. */
  region: Rect01 | null;
  /** The share of the screen in that leftover change. */
  regionAmount: number;
  centroid: Point01 | null;
  /**
   * The leftover change split into bands with empty rows between them, the
   * biggest first: a key lighting up and a letter appearing above it are two
   * parts of one change.
   */
  parts: Rect01[];
  label: ChangeLabel;
}

/** The analysis rules' version. A film read under an older one is read again. */
export const ANALYSIS_VERSION = 1;

/** Left out at the top for the status bar, as a share of the height. */
const TOP_BAR = 0.06;
/** Left out at the bottom for the home indicator. */
const BOTTOM_BAR = 0.03;
/** A pixel changed when its grey moves this much. Compression noise stays under it. */
const PIXEL_STEP = 16;
/** Under this share of the screen changing, a frame counts as still. */
const STILL_BELOW = 0.0008;
/** Over this share with no slide to explain it, it's a new screen. */
const SCREEN_ABOVE = 0.3;

function rows(frame: LumaFrame): { y0: number; y1: number } {
  return {
    y0: Math.floor(frame.height * TOP_BAR),
    y1: Math.ceil(frame.height * (1 - BOTTOM_BAR)),
  };
}

/** Half size by averaging 2x2 blocks, for the coarse search. */
function half(frame: LumaFrame): LumaFrame {
  const width = Math.floor(frame.width / 2);
  const height = Math.floor(frame.height / 2);
  const data = new Uint8Array(width * height);
  const src = frame.data;
  const w = frame.width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 2 * y * w + 2 * x;
      data[y * width + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1] + 2) >> 2;
    }
  }
  return { t: frame.t, width, height, data };
}

/**
 * The cost of matching `cur` against `prev` moved up by `dy` rows: the mean
 * difference of the best 60% of rows. Using only the best rows lets a fixed
 * header or tab bar (which doesn't scroll with the content) stay out of it.
 */
function shiftCostY(prev: LumaFrame, cur: LumaFrame, dy: number, y0: number, y1: number): number {
  const w = cur.width;
  const costs: number[] = [];
  for (let y = y0; y < y1; y++) {
    const py = y + dy;
    if (py < y0 || py >= y1) continue;
    let sum = 0;
    const a = y * w;
    const b = py * w;
    for (let x = 0; x < w; x++) sum += Math.abs(cur.data[a + x] - prev.data[b + x]);
    costs.push(sum / w);
  }
  // A shift that leaves too few rows to compare proves nothing.
  if (costs.length < (y1 - y0) * 0.35) return Infinity;
  return trimmedMean(costs, 0.6);
}

/** The same for columns: `cur` against `prev` moved left by `dx`. */
function shiftCostX(prev: LumaFrame, cur: LumaFrame, dx: number, y0: number, y1: number): number {
  const w = cur.width;
  const costs: number[] = [];
  for (let x = 0; x < w; x++) {
    const px = x + dx;
    if (px < 0 || px >= w) continue;
    let sum = 0;
    for (let y = y0; y < y1; y++) sum += Math.abs(cur.data[y * w + x] - prev.data[y * w + px]);
    costs.push(sum / (y1 - y0));
  }
  if (costs.length < w * 0.35) return Infinity;
  return trimmedMean(costs, 0.6);
}

function trimmedMean(values: number[], keep: number): number {
  values.sort((a, b) => a - b);
  const n = Math.max(1, Math.round(values.length * keep));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  return sum / n;
}

interface ShiftFound {
  shift: number;
  cost: number;
  still: number;
}

/** The slide that best explains the change, found on half-size frames and then refined. */
function findShift(prev: LumaFrame, cur: LumaFrame, axis: 'y' | 'x'): ShiftFound {
  const costOf = axis === 'y' ? shiftCostY : shiftCostX;
  const { y0, y1 } = rows(cur);
  const still = costOf(prev, cur, 0, y0, y1);
  const p2 = half(prev);
  const c2 = half(cur);
  const r2 = rows(c2);
  const span = axis === 'y' ? Math.floor((r2.y1 - r2.y0) * 0.45) : Math.floor(c2.width * 0.6);
  let best = 0;
  let bestCost = costOf(p2, c2, 0, r2.y0, r2.y1);
  for (let s = -span; s <= span; s++) {
    if (s === 0) continue;
    const cost = costOf(p2, c2, s, r2.y0, r2.y1);
    if (cost < bestCost) {
      bestCost = cost;
      best = s;
    }
  }
  let shift = 0;
  let cost = still;
  for (let s = best * 2 - 2; s <= best * 2 + 2; s++) {
    const c = s === 0 ? still : costOf(prev, cur, s, y0, y1);
    if (c < cost) {
      cost = c;
      shift = s;
    }
  }
  return { shift, cost, still };
}

/** Bands of changed rows with at least `gap` empty rows between them, each with its own width; the biggest three. */
function changedParts(mask: Uint8Array, w: number, h: number, gap = 4): Rect01[] {
  const rowCount = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) n += mask[y * w + x];
    rowCount[y] = n;
  }
  const bands: { y0: number; y1: number; count: number }[] = [];
  let open: { y0: number; y1: number; count: number } | null = null;
  let empty = 0;
  for (let y = 0; y < h; y++) {
    if (rowCount[y] > 0) {
      if (!open) {
        open = { y0: y, y1: y + 1, count: 0 };
        bands.push(open);
      }
      open.y1 = y + 1;
      open.count += rowCount[y];
      empty = 0;
    } else if (open && ++empty >= gap) {
      open = null;
    }
  }
  return bands
    .filter((band) => band.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((band) => {
      let x0 = w;
      let x1 = 0;
      for (let y = band.y0; y < band.y1; y++) {
        for (let x = 0; x < w; x++) {
          if (!mask[y * w + x]) continue;
          if (x < x0) x0 = x;
          if (x + 1 > x1) x1 = x + 1;
        }
      }
      return { x: x0 / w, y: band.y0 / h, w: Math.max(0, x1 - x0) / w, h: (band.y1 - band.y0) / h };
    });
}

/** The region holding most of the changed pixels: 3rd to 97th percentile on each axis. */
function changedRegion(mask: Uint8Array, w: number, h: number): { region: Rect01 | null; centroid: Point01 | null; count: number } {
  const colHist = new Float64Array(w);
  const rowHist = new Float64Array(h);
  let count = 0;
  let cx = 0;
  let cy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      colHist[x] += 1;
      rowHist[y] += 1;
      cx += x;
      cy += y;
      count += 1;
    }
  }
  if (count === 0) return { region: null, centroid: null, count };
  const cut = (hist: Float64Array, q: number) => {
    let acc = 0;
    const target = count * q;
    for (let i = 0; i < hist.length; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return hist.length - 1;
  };
  const x0 = cut(colHist, 0.03);
  const x1 = cut(colHist, 0.97) + 1;
  const y0 = cut(rowHist, 0.03);
  const y1 = cut(rowHist, 0.97) + 1;
  return {
    region: { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h },
    centroid: { x: (cx / count + 0.5) / w, y: (cy / count + 0.5) / h },
    count,
  };
}

/** What changed between two frames of the same size. */
export function compareFrames(prev: LumaFrame, cur: LumaFrame): FrameChange {
  const w = cur.width;
  const h = cur.height;
  const { y0, y1 } = rows(cur);
  const area = w * (y1 - y0);
  let changed = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Math.abs(cur.data[i] - prev.data[i]) > PIXEL_STEP) changed += 1;
    }
  }
  const amount = changed / area;
  const base: FrameChange = { t: cur.t, amount, shiftY: 0, shiftX: 0, shiftFit: 0, region: null, regionAmount: 0, centroid: null, parts: [], label: 'still' };
  if (amount < STILL_BELOW) return base;

  // Only look for a slide when enough moved for one to matter.
  let shiftY = 0;
  let shiftX = 0;
  let fit = 0;
  if (amount > 0.015) {
    const vy = findShift(prev, cur, 'y');
    const vx = findShift(prev, cur, 'x');
    const fitY = vy.shift !== 0 && vy.still > 1 ? 1 - vy.cost / vy.still : 0;
    const fitX = vx.shift !== 0 && vx.still > 1 ? 1 - vx.cost / vx.still : 0;
    if (fitY >= fitX && fitY > 0.4) {
      shiftY = vy.shift;
      fit = fitY;
    } else if (fitX > 0.4) {
      shiftX = vx.shift;
      fit = fitX;
    }
  }

  // What's left once the slide is taken out.
  const mask = new Uint8Array(w * h);
  let left = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) {
      const py = y + shiftY;
      const px = x + shiftX;
      if (py < y0 || py >= y1 || px < 0 || px >= w) continue;
      const i = y * w + x;
      if (Math.abs(cur.data[i] - prev.data[py * w + px]) > PIXEL_STEP) {
        mask[i] = 1;
        left += 1;
      }
    }
  }
  const { region, centroid } = changedRegion(mask, w, h);
  const parts = changedParts(mask, w, h);
  const regionAmount = left / area;

  let label: ChangeLabel;
  if (shiftY !== 0) label = 'scroll';
  else if (shiftX !== 0) label = Math.abs(shiftX) >= 2 && amount > 0.05 ? 'swipe' : 'local';
  else label = amount > SCREEN_ABOVE ? 'screen' : 'local';
  return { ...base, shiftY, shiftX, shiftFit: fit, region, regionAmount, centroid, parts, label };
}

/** Every change from one frame to the next. */
export function compareAll(frames: LumaFrame[]): FrameChange[] {
  const out: FrameChange[] = [];
  for (let i = 1; i < frames.length; i++) out.push(compareFrames(frames[i - 1], frames[i]));
  return out;
}

// ---------------------------------------------------------------------------
// From changes to moments
// ---------------------------------------------------------------------------

function union(a: Rect01 | null, b: Rect01 | null): Rect01 | null {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Two areas overlap, or come within `margin` of each other. */
function near(a: Rect01, b: Rect01, margin = 0.06): boolean {
  return a.x - margin < b.x + b.w && b.x - margin < a.x + a.w && a.y - margin < b.y + b.h && b.y - margin < a.y + a.h;
}

function centre(r: Rect01): Point01 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Where a keyboard sits on a phone held upright: the lower part of the screen. */
const KEYBOARD_TOP = 0.55;

/**
 * Splits a run's changes into what happens on the keyboard and what happens
 * above it. Typing changes both in the same frames: a key lights up and a
 * letter appears in the field, two parts of one change.
 */
function aboveKeyboard(changes: FrameChange[]): { above: Rect01 | null; keyboardSamples: number; aboveSamples: number; keyboardWidth: number } {
  let above: Rect01 | null = null;
  let keys: Rect01 | null = null;
  let keyboardSamples = 0;
  let aboveSamples = 0;
  for (const change of changes) {
    let low = false;
    let high = false;
    for (const part of change.parts) {
      const middle = part.y + part.h / 2;
      if (middle >= KEYBOARD_TOP + 0.05 && part.y >= KEYBOARD_TOP - 0.05) {
        low = true;
        keys = union(keys, part);
      } else if (part.y + part.h <= KEYBOARD_TOP + 0.05) {
        high = true;
        above = union(above, part);
      }
    }
    if (low) keyboardSamples += 1;
    if (high) aboveSamples += 1;
  }
  return { above, keyboardSamples, aboveSamples, keyboardWidth: keys?.w ?? 0 };
}

interface Run {
  label: 'still' | 'local' | 'scroll' | 'screen';
  from: number;
  to: number;
  changes: FrameChange[];
}

/** A fifth of the screen or more changing at once: part of a new screen or a slide, never a tap. */
const SCREEN_AMOUNT = 0.12;

function groupRuns(changes: FrameChange[], step: number): Run[] {
  const runs: Run[] = [];
  for (const change of changes) {
    // A local change this big is the start or the end of a transition.
    const label = change.label === 'swipe' || (change.label === 'local' && change.amount > SCREEN_AMOUNT) ? 'screen' : change.label;
    const last = runs[runs.length - 1];
    // Local changes in other places are other moments. Typing keeps one part
    // in place (the text field) while the keys light up all over, so two
    // changes belong together when any of their parts are near each other.
    const previous = last?.label === 'local' ? [...last.changes].reverse().find((c) => c.parts.length > 0) : undefined;
    const apart = label === 'local' && !!previous && change.parts.length > 0 && !previous.parts.some((a) => change.parts.some((b) => near(a, b)));
    if (last && last.label === label && !apart && change.t - last.to <= step * 1.6) {
      last.to = change.t;
      last.changes.push(change);
    } else {
      runs.push({ label, from: change.t - step, to: change.t, changes: [change] });
    }
  }
  // A single still frame inside a run of the same kind is a pause in it, not a moment.
  for (let i = 1; i < runs.length - 1; i++) {
    const [a, b, c] = [runs[i - 1], runs[i], runs[i + 1]];
    if (b.label === 'still' && b.changes.length <= 2 && a.label === c.label && a.label !== 'still') {
      a.to = c.to;
      a.changes.push(...b.changes, ...c.changes);
      runs.splice(i, 2);
      i -= 1;
    }
  }
  return runs;
}

export interface FindMomentsOptions {
  /** Seconds between frames. */
  step: number;
  /** The recording's length after the trim. */
  duration: number;
}

function area(r: Rect01 | null): number {
  return r ? r.w * r.h : 0;
}

/**
 * A transition or a scroll ends with a few frames no clean slide explains:
 * the last of a push, a list slowing down under a title that shrinks. Few
 * pixels change, but all over the screen. Such a short, wide run right
 * against a scroll or a new screen belongs to it.
 */
function absorbTails(runs: Run[], step: number): Run[] {
  const out: Run[] = [];
  const touches = (a: Run, b: Run) => b.from - a.to <= step * 1.6;
  const moving = (r: Run | undefined) => !!r && (r.label === 'scroll' || r.label === 'screen');
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.label === 'local' && run.to - run.from <= 0.35) {
      const region = run.changes.reduce<Rect01 | null>((acc, c) => union(acc, c.region), null);
      const before = out[out.length - 1];
      const after = runs[i + 1];
      if (area(region) > 0.3) {
        if (moving(before) && touches(before!, run)) {
          before!.to = run.to;
          before!.changes.push(...run.changes);
          continue;
        }
        if (moving(after) && touches(run, after!)) {
          after!.from = run.from;
          after!.changes.unshift(...run.changes);
          continue;
        }
      }
    }
    out.push(run);
  }
  // A brief new-screen piece between two pieces of one scroll is that scroll:
  // a fling where the slide stops fitting for a frame (a bar changes colour).
  for (let i = 1; i < out.length - 1; i++) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if (a.label === 'scroll' && c.label === 'scroll' && b.label === 'screen' && b.to - b.from <= 0.45 && touches(a, b) && touches(b, c)) {
      a.to = c.to;
      a.changes.push(...b.changes, ...c.changes);
      out.splice(i, 2);
      i -= 1;
    }
  }
  // Runs that now meet, of one kind, are one.
  const joined: Run[] = [];
  for (const run of out) {
    const last = joined[joined.length - 1];
    if (last && last.label === run.label && run.label !== 'local' && run.from - last.to <= step * 1.6) {
      last.to = run.to;
      last.changes.push(...run.changes);
    } else joined.push(run);
  }
  return mergeEntry(joined);
}

/** True when a part sits in the top half, where a typed number or word shows. */
function high(part: Rect01): boolean {
  return part.y + part.h <= 0.5;
}

/**
 * An app's own number pad: each key lights up in its own place, so each key
 * press is a run of its own, but every press also changes the same text near
 * the top (the amount). Quick runs that change the same place up there are
 * one run, which the typing rule then reads.
 */
function mergeEntry(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    const lastHigh = last?.label === 'local' ? last.changes.flatMap((c) => c.parts.filter(high)) : [];
    const sameText =
      run.label === 'local' &&
      lastHigh.length > 0 &&
      run.from - last!.to <= 0.3 &&
      run.changes.some((c) => c.parts.some((p) => high(p) && lastHigh.some((q) => near(p, q, 0.04))));
    if (sameText) {
      last!.to = run.to;
      last!.changes.push(...run.changes);
    } else out.push(run);
  }
  return out;
}

/**
 * Where a change happens: the parts of the run near where its first change
 * was, so something else that starts moving later stays out.
 */
function changeFocus(run: Run): Rect01 | null {
  const first = run.changes.find((c) => c.parts.length > 0);
  if (!first) return null;
  const anchor = first.parts[0];
  let focus: Rect01 | null = null;
  for (const change of run.changes) for (const part of change.parts) if (near(anchor, part, 0.08)) focus = union(focus, part);
  return focus;
}

/**
 * Where the finger most likely was: a pressed control lights up on its own
 * first, as one small part. When the first change is wide or in several
 * places, nobody can tell, and no ring is drawn.
 */
function pressPoint(run: Run): Point01 | undefined {
  const first = run.changes.find((c) => c.parts.length > 0);
  if (!first || first.parts.length > 2) return undefined;
  const part = first.parts[0];
  return area(part) <= 0.025 ? centre(part) : undefined;
}

/**
 * The moments in a recording, in order. Each change belongs to at most one
 * moment, and moments never overlap. Ids are m1, m2, ... in order.
 */
export function findMoments(changes: FrameChange[], options: FindMomentsOptions): Moment[] {
  const { step, duration } = options;
  const runs = absorbTails(groupRuns(changes, step), step);
  const found: Omit<Moment, 'id'>[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const length = run.to - run.from;
    if (run.label === 'still') {
      if (length >= 1.2) found.push({ kind: 'still', start: run.from, end: run.to, focus: null, weight: 0.1, shot: 'auto' });
      continue;
    }
    if (run.label === 'screen') {
      found.push({ kind: 'screen', start: run.from, end: run.to, focus: null, weight: 0.5, shot: 'auto' });
      continue;
    }
    if (run.label === 'scroll') {
      const moving = run.changes.reduce<Rect01 | null>((acc, c) => union(acc, c.region), null);
      found.push({ kind: 'scroll', start: run.from, end: run.to, focus: moving, weight: 0.4, shot: 'auto' });
      continue;
    }
    // A small change: a tap, typing, or something moving on its own.
    const peak = Math.max(...run.changes.map((c) => c.amount));
    const mean = run.changes.reduce((sum, c) => sum + c.amount, 0) / run.changes.length;
    // A press that opens a new screen. A pause of a frame or two can come between the two.
    const next = runs.slice(i + 1).find((r) => r.label !== 'still');
    const opens = (next?.label === 'screen' || next?.label === 'scroll') && next.from - run.to <= 0.6;
    // A caret blinking, a spinner: small and steady, and nothing follows. A
    // button that only dims a little when pressed is kept when a screen follows.
    if ((peak < 0.004 && !opens) || (length > 2.5 && mean < 0.006)) continue;
    const split = aboveKeyboard(run.changes);
    // Keys light up in different places as letters arrive above them.
    const typing = split.keyboardSamples >= 3 && split.aboveSamples >= 3 && split.keyboardWidth >= 0.3 && length >= 0.6;
    const region = run.changes.reduce<Rect01 | null>((acc, c) => union(acc, c.region), null);
    const point = typing ? undefined : pressPoint(run);
    // A press: one small part that changes briefly (a button, a card, a row).
    // Something longer or in several places at once is an animation.
    const firstParts = run.changes.find((c) => c.parts.length > 0)?.parts ?? [];
    const brief = firstParts.length === 1 && area(firstParts[0]) <= 0.1 && length <= 0.5;
    const kind: MomentKind = typing ? 'type' : point || brief || peak < 0.004 ? 'tap' : 'change';
    const focus = typing ? split.above ?? region : changeFocus(run) ?? region;
    // Close-ups suit small, clear changes: a switch, a check, letters. A tiny
    // press right before a new screen matters less than the screen it opens.
    const compact = 1 - Math.min(1, area(focus) / 0.12);
    const weight = typing
      ? 0.9
      : peak < 0.004
        ? 0.45
        : Math.min(1, Math.max(0.3, 0.5 + 0.3 * compact + (opens ? 0.1 : 0) + (length >= 0.25 ? 0.05 : 0)));
    found.push({ kind, start: run.from, end: run.to, focus, point, weight, shot: 'auto' });
  }

  // Merge neighbours of the same kind in the same place.
  const merged: Omit<Moment, 'id'>[] = [];
  for (const moment of found) {
    const last = merged[merged.length - 1];
    const near =
      last &&
      last.kind === moment.kind &&
      moment.start - last.end <= 0.3 &&
      ((moment.kind !== 'tap' && moment.kind !== 'change') || !last.focus || !moment.focus || Math.hypot(centre(last.focus).x - centre(moment.focus).x, centre(last.focus).y - centre(moment.focus).y) < 0.2);
    if (near) {
      last.end = moment.end;
      last.focus = union(last.focus, moment.focus);
      last.weight = Math.max(last.weight, moment.weight);
    } else {
      merged.push({ ...moment });
    }
  }
  return merged.map((moment, index) => ({
    ...moment,
    start: clamp(moment.start, 0, duration),
    end: clamp(moment.end, 0, duration),
    focus: moment.focus ? clampRect(moment.focus) : null,
    id: `m${index + 1}`,
  }));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function clampRect(r: Rect01): Rect01 {
  const x = clamp(r.x, 0, 1);
  const y = clamp(r.y, 0, 1);
  return { x, y, w: clamp(r.w, 0, 1 - x), h: clamp(r.h, 0, 1 - y) };
}

/** How much changed over time, for the timeline: one value per `step` seconds, 0 to 1. */
export function activityTrack(changes: FrameChange[], step: number, duration: number): ActivityTrack {
  const count = Math.max(1, Math.round(duration / step));
  const values = new Array<number>(count).fill(0);
  for (const change of changes) {
    const i = Math.min(count - 1, Math.max(0, Math.floor(change.t / step - 0.5)));
    // A square root, so a small tap still shows next to a new screen.
    values[i] = Math.max(values[i], Math.min(1, Math.sqrt(change.amount)));
  }
  return { step, values: values.map((v) => Math.round(v * 1000) / 1000) };
}
