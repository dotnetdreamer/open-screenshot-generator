import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityTrack, compareAll, compareFrames, findMoments, type LumaFrame } from '@/lib/director/analyze';
import { closePose, ease, FORMAT_ASPECT, planFilm, plannedPose, poseAt, STYLES, type PlanInput } from '@/lib/director/plan';
import {
  angleOf,
  compactSamples,
  fromDeviceOrientation,
  fromYawPitchRoll,
  IDENTITY,
  relativeTurn,
  scaleTurn,
  slerp,
  steadySamples,
  takeAt,
  toYawPitchRoll,
  TurnFilter,
  type Quat,
} from '@/lib/director/motion';
import { addMoment, editMoment, mergeMoments, newFilm, phoneForRecording, phoneShape, planFor, removeMoment } from '@/lib/director/film';
import { filmDuration, recordingTime, stageFrameAt, wordsPresence } from '@/lib/director/frame';
import { backdropFor, brandBackdrop, luminance, parseColor } from '@/lib/director/looks';
import { projectAppName, projectColors, projectRecordings } from '@/lib/director/project';
import { isMadeUpProjectName, randomProjectName } from '@/lib/projectNames';
import type { Film, Moment } from '@/lib/director/types';
import type { ArtboardState } from '@/types/artboard';

// ---------------------------------------------------------------------------
// Synthetic recordings: a textured "app screen" that scrolls, taps and types.
// ---------------------------------------------------------------------------

const W = 74;
const H = 160;
const STEP = 0.1;

/** A fixed pseudo-random texture, so a scroll has something to match. */
function texture(seed: number): Uint8Array {
  const data = new Uint8Array(W * H * 4);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = 60 + ((s >> 8) % 140);
  }
  // Smooth it a little, like real content.
  for (let y = 0; y < H * 4 - 1; y++) for (let x = 0; x < W - 1; x++) data[y * W + x] = (data[y * W + x] + data[y * W + x + 1] + data[(y + 1) * W + x]) / 3;
  return data;
}

const PAGE = texture(7);
const OTHER = texture(99);

/** A screen showing `page` scrolled down by `offset` rows, with a fixed header and status bar. */
function screen(t: number, page: Uint8Array, offset = 0, paint?: (x: number, y: number) => number | null): LumaFrame {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v: number;
      if (y < 9) v = 240; // status bar
      else if (y < 22) v = 250; // a header that stays put
      else v = page[((y + offset) % (H * 4)) * W + x];
      const painted = paint?.(x, y);
      data[y * W + x] = painted ?? v;
    }
  }
  return { t, width: W, height: H, data };
}

function frames(count: number, make: (i: number, t: number) => LumaFrame): LumaFrame[] {
  return Array.from({ length: count }, (_, i) => make(i, i * STEP));
}

test('a still screen is still, and the clock in the status bar is ignored', () => {
  const f = frames(30, (i, t) => screen(t, PAGE, 0, (x, y) => (y < 8 && x > 30 && x < 40 ? (i % 2 ? 0 : 255) : null)));
  const changes = compareAll(f);
  assert.ok(changes.every((c) => c.label === 'still'), JSON.stringify(changes.map((c) => c.label)));
  const moments = findMoments(changes, { step: STEP, duration: 3 });
  assert.equal(moments.length, 1);
  assert.equal(moments[0].kind, 'still');
});

test('a scroll is found with its direction and size', () => {
  const a = screen(0, PAGE, 0);
  const b = screen(STEP, PAGE, 6);
  const change = compareFrames(a, b);
  assert.equal(change.label, 'scroll');
  assert.equal(change.shiftY, 6, 'content moved up six rows');
  const back = compareFrames(b, a);
  assert.equal(back.label, 'scroll');
  assert.equal(back.shiftY, -6);
});

test('a scroll run becomes one scroll moment', () => {
  const f = frames(40, (i, t) => screen(t, PAGE, i >= 10 && i < 22 ? (i - 10) * 5 : i >= 22 ? 60 : 0));
  const moments = findMoments(compareAll(f), { step: STEP, duration: 4 });
  const scrolls = moments.filter((m) => m.kind === 'scroll');
  assert.equal(scrolls.length, 1, JSON.stringify(moments));
  assert.ok(Math.abs(scrolls[0].start - 1.0) <= 0.15, `starts near 1 s, got ${scrolls[0].start}`);
  assert.ok(Math.abs(scrolls[0].end - 2.1) <= 0.2, `ends near 2.1 s, got ${scrolls[0].end}`);
});

test('a tap on a button gives a tap moment with its place', () => {
  // A button the size of a real one (x 28..46, y 100..108) lights up for three frames from 1.5 s.
  const f = frames(40, (i, t) => screen(t, PAGE, 0, (x, y) => (i >= 15 && i < 18 && x >= 28 && x < 46 && y >= 100 && y < 108 ? 20 : null)));
  const moments = findMoments(compareAll(f), { step: STEP, duration: 4 });
  const taps = moments.filter((m) => m.kind === 'tap');
  assert.equal(taps.length, 1, JSON.stringify(moments));
  const tap = taps[0];
  assert.ok(tap.focus);
  assert.ok(Math.abs(tap.focus!.x - 28 / W) < 0.05 && Math.abs(tap.focus!.x + tap.focus!.w - 46 / W) < 0.05, JSON.stringify(tap.focus));
  assert.ok(Math.abs(tap.focus!.y - 100 / H) < 0.04 && Math.abs(tap.focus!.y + tap.focus!.h - 108 / H) < 0.04, JSON.stringify(tap.focus));
  assert.ok(tap.point && Math.abs(tap.point.x - 37 / W) < 0.05 && Math.abs(tap.point.y - 104 / H) < 0.04, JSON.stringify(tap.point));
  assert.ok(Math.abs(tap.start - 1.4) <= 0.15, `starts at the change, got ${tap.start}`);
});

test('a wide card pressed is a tap with no ring, since the finger could be anywhere on it', () => {
  const f = frames(40, (i, t) => screen(t, PAGE, 0, (x, y) => (i >= 15 && i < 18 && x >= 4 && x < 70 && y >= 80 && y < 96 ? 20 : null)));
  const tap = findMoments(compareAll(f), { step: STEP, duration: 4 }).find((m) => m.kind === 'tap');
  assert.ok(tap, 'still a tap');
  assert.equal(tap!.point, undefined);
});

test('a new screen is a screen moment, and the press that opened it weighs more than one that opens nothing', () => {
  const press = (i: number) => (x: number, y: number) => (i >= 17 && x >= 28 && x < 46 && y >= 60 && y < 68 ? 30 : null);
  const opening = frames(40, (i, t) => (i < 20 ? screen(t, PAGE, 0, press(i)) : screen(t, OTHER, 0)));
  const moments = findMoments(compareAll(opening), { step: STEP, duration: 4 });
  const kinds = moments.map((m) => m.kind);
  assert.ok(kinds.includes('screen'), kinds.join());
  const tap = moments.find((m) => m.kind === 'tap');
  assert.ok(tap, kinds.join());
  const alone = findMoments(compareAll(frames(40, (i, t) => screen(t, PAGE, 0, i < 20 ? press(i) : () => null))), { step: STEP, duration: 4 }).find((m) => m.kind === 'tap');
  assert.ok(alone, 'the same press with nothing after it');
  assert.ok(tap!.weight > alone!.weight, `${tap!.weight} vs ${alone!.weight}`);
});

test('a big change in place is a new screen, never a tap', () => {
  const f = frames(30, (i, t) => screen(t, i < 15 ? PAGE : OTHER, 0));
  const moments = findMoments(compareAll(f), { step: STEP, duration: 3 });
  assert.ok(moments.some((m) => m.kind === 'screen'));
  assert.ok(!moments.some((m) => m.kind === 'tap' || m.kind === 'change'), JSON.stringify(moments.map((m) => m.kind)));
});

test('the planner stays wide for a press that opens a screen, except in Bold', () => {
  const moments: Moment[] = [moment('m1', 'tap', 4, 4.2, { x: 0.4, y: 0.6, w: 0.2, h: 0.05 }, { point: { x: 0.5, y: 0.62 } }), moment('m2', 'screen', 4.2, 4.6, null)];
  assert.ok(!planFilm(input(moments)).keys.some((k) => k.why === 'close on m1'));
  assert.ok(planFilm(input(moments, { style: 'bold' })).keys.some((k) => k.why === 'close on m1'));
  // Its ring is drawn either way.
  assert.equal(planFilm(input(moments)).taps.length, 1);
});

test('typing with a keyboard up looks at the text, not the keys', () => {
  // A keyboard fills y 100..160; keys flash in turn while letters appear in a field at y 50..62.
  const f = frames(40, (i, t) =>
    screen(t, PAGE, 0, (x, y) => {
      if (y >= 100) {
        const key = i >= 10 && i < 30 ? (i * 7) % 10 : -1;
        const kx = (key % 5) * 14;
        const ky = 104 + Math.floor(key / 5) * 26;
        return key >= 0 && x >= kx && x < kx + 12 && y >= ky && y < ky + 20 ? 30 : 200;
      }
      if (y >= 50 && y < 62 && x >= 8 && x < 8 + Math.max(0, Math.min(i - 10, 20)) * 3) return 10;
      if (y >= 50 && y < 62 && x >= 8 && x < 68) return 245;
      return null;
    })
  );
  const moments = findMoments(compareAll(f), { step: STEP, duration: 4 });
  const typing = moments.find((m) => m.kind === 'type');
  assert.ok(typing, JSON.stringify(moments.map((m) => [m.kind, m.start, m.end, m.focus])));
  assert.ok(typing!.focus!.y + typing!.focus!.h <= 70 / H, `the focus stays above the keyboard: ${JSON.stringify(typing!.focus)}`);
});

test('a blinking caret alone is not a moment', () => {
  const f = frames(50, (i, t) => screen(t, PAGE, 0, (x, y) => (x >= 30 && x < 31 && y >= 60 && y < 66 && i % 5 < 2 ? 0 : null)));
  const moments = findMoments(compareAll(f), { step: STEP, duration: 5 });
  assert.ok(!moments.some((m) => m.kind === 'tap' || m.kind === 'type'), JSON.stringify(moments));
});

test('moments never overlap and their ids are unique', () => {
  const f = frames(60, (i, t) => {
    if (i < 15) return screen(t, PAGE, 0, (x, y) => (i >= 5 && i < 8 && x >= 20 && x < 50 && y >= 90 && y < 110 ? 20 : null));
    if (i < 30) return screen(t, PAGE, (i - 15) * 4);
    return screen(t, OTHER, 0, (x, y) => (i >= 40 && i < 43 && x >= 5 && x < 30 && y >= 30 && y < 45 ? 20 : null));
  });
  const moments = findMoments(compareAll(f), { step: STEP, duration: 6 });
  for (let i = 1; i < moments.length; i++) assert.ok(moments[i].start >= moments[i - 1].end - 1e-6, `${moments[i - 1].id} and ${moments[i].id} overlap`);
  assert.equal(new Set(moments.map((m) => m.id)).size, moments.length);
});

test('the activity track has one value per step and stays in 0..1', () => {
  const f = frames(30, (i, t) => screen(t, i < 15 ? PAGE : OTHER, 0));
  const track = activityTrack(compareAll(f), STEP, 3);
  assert.equal(track.values.length, 30);
  assert.ok(track.values.every((v) => v >= 0 && v <= 1));
  assert.ok(Math.max(...track.values) > 0.6, 'the new screen stands out');
});

// ---------------------------------------------------------------------------
// The director's plan
// ---------------------------------------------------------------------------

const SHAPE = phoneShape('iphone-17-pro');

function moment(id: string, kind: Moment['kind'], start: number, end: number, focus: Moment['focus'] = { x: 0.3, y: 0.5, w: 0.3, h: 0.08 }, extra: Partial<Moment> = {}): Moment {
  return { id, kind, start, end, focus, weight: kind === 'type' ? 0.85 : 0.7, shot: 'auto', ...extra };
}

function input(moments: Moment[], extra: Partial<PlanInput> = {}): PlanInput {
  return {
    duration: 12.7,
    recordingEnd: 12,
    moments,
    style: 'lively',
    format: 'vertical',
    phone: SHAPE,
    text: { title: '', end: '', captions: true, taps: true },
    ...extra,
  };
}

test('easing curves start at 0, end at 1 and never go back', () => {
  for (const kind of ['linear', 'glide', 'smooth', 'snappy'] as const) {
    assert.ok(Math.abs(ease(kind, 0)) < 1e-6, kind);
    assert.ok(Math.abs(ease(kind, 1) - 1) < 1e-6, kind);
    let last = 0;
    for (let u = 0.01; u <= 1; u += 0.01) {
      const v = ease(kind, u);
      assert.ok(v >= last - 1e-9, `${kind} goes back at ${u}`);
      last = v;
    }
  }
});

test('the camera arrives before a tap and holds through it', () => {
  const plan = planFilm(input([moment('m1', 'tap', 5, 5.4)]));
  const rules = STYLES.lively;
  const close = plan.keys.find((k) => k.why === 'close on m1');
  assert.ok(close, JSON.stringify(plan.keys.map((k) => k.why)));
  assert.ok(close!.t <= 5 - rules.lead + 1e-6, `arrives by ${5 - rules.lead}, got ${close!.t}`);
  // Held still from arrival to the end of the hold.
  const during = plannedPose(plan, 5.2);
  assert.ok(during.zoom >= rules.closeZoom[0] - 1e-6, `close during the tap, zoom ${during.zoom}`);
  assert.deepEqual(plannedPose(plan, close!.t), plannedPose(plan, 5 + 0.4 + rules.hold));
  // Back out afterwards.
  assert.ok(plannedPose(plan, 8).zoom < 1.2);
});

test('two taps close together are joined by a pan, far apart they are not', () => {
  const near = planFilm(input([moment('m1', 'tap', 4, 4.3), moment('m2', 'tap', 5.2, 5.5, { x: 0.6, y: 0.2, w: 0.25, h: 0.06 })]));
  assert.ok(near.keys.some((k) => k.why === 'pan to m2'), JSON.stringify(near.keys.map((k) => k.why)));
  const far = planFilm(input([moment('m1', 'tap', 3, 3.3), moment('m2', 'tap', 8, 8.3)]));
  assert.ok(far.keys.some((k) => k.why === 'close on m2'));
  assert.ok(!far.keys.some((k) => k.why === 'pan to m2'));
});

test('close-ups never overlap and keep to the style\'s share of the film', () => {
  const many = Array.from({ length: 14 }, (_, i) => moment(`m${i + 1}`, 'tap', 1.6 + i * 0.75, 1.9 + i * 0.75));
  for (const style of ['calm', 'lively', 'bold'] as const) {
    const plan = planFilm(input(many, { style }));
    const closes = plan.keys.filter((k) => /^(close on|pan to)/.test(k.why ?? '')).length;
    assert.ok(closes >= 1, style);
    let closeTime = 0;
    for (let t = 0; t < plan.duration; t += 0.05) if (plannedPose(plan, t).zoom >= STYLES[style].closeZoom[0] - 0.01) closeTime += 0.05;
    assert.ok(closeTime <= plan.duration * STYLES[style].closeShare + 1.5, `${style}: ${closeTime.toFixed(1)}s close`);
  }
});

test('a moment the user left out gets no close-up, one they asked for always does', () => {
  const skipped = planFilm(input([moment('m1', 'tap', 5, 5.4, undefined, { shot: 'skip' })]));
  assert.ok(!skipped.keys.some((k) => k.why === 'close on m1'));
  const scroll = planFilm(input([moment('m1', 'scroll', 5, 6, { x: 0, y: 0.1, w: 1, h: 0.8 }, { shot: 'close' })]));
  assert.ok(scroll.keys.some((k) => k.why === 'close on m1'), 'a forced close-up on a scroll');
});

test('every pose stays in range and the plan ends on the film\'s length', () => {
  const plan = planFilm(input([moment('m1', 'tap', 2, 2.3, { x: 0, y: 0, w: 0.1, h: 0.05 }), moment('m2', 'type', 6, 8, { x: 0.8, y: 0.9, w: 0.2, h: 0.1 })], { style: 'bold' }));
  assert.ok(Math.abs(plan.keys[plan.keys.length - 1].t - plan.duration) < 1e-6);
  for (let t = 0; t <= plan.duration; t += 0.04) {
    const p = poseAt(plan, t, 'bold');
    assert.ok(p.fx >= 0 && p.fx <= 1 && p.fy >= 0 && p.fy <= 1, `focus off the screen at ${t}`);
    assert.ok(p.zoom >= 0.7 && p.zoom <= STYLES.bold.closeZoom[1] + 1e-6, `zoom ${p.zoom} at ${t}`);
    assert.ok(Math.abs(p.yaw) < 75 && Math.abs(p.pitch) < 40, `angles at ${t}`);
  }
});

test('a close-up near the screen\'s edge stays on the phone', () => {
  const pose = closePose(moment('m1', 'tap', 1, 2, { x: 0, y: 0.95, w: 0.1, h: 0.05 }), STYLES.bold, 1, SHAPE, FORMAT_ASPECT.vertical);
  const viewH = 1.24 / pose.zoom;
  const halfY = viewH / 2 / SHAPE.screenH;
  assert.ok(pose.fy <= 1 - halfY * 0.92 + 1e-9, `fy ${pose.fy}`);
});

test('a close-up shows the screen\'s whole width or a clear part of it, never all but a sliver', () => {
  // A sliver cut off one side reads as a mistake: "mount" for "Amount".
  for (const style of ['calm', 'lively', 'bold'] as const) {
    for (const format of ['vertical', 'portrait', 'square', 'landscape'] as const) {
      for (const w of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
        for (const h of [0.05, 0.2, 0.4]) {
          const pose = closePose(moment('m1', 'type', 1, 3, { x: (1 - w) / 2, y: 0.3, w, h }), STYLES[style], 1, SHAPE, FORMAT_ASPECT[format]);
          const shown = ((1.24 / pose.zoom) * FORMAT_ASPECT[format]) / SHAPE.screenW;
          assert.ok(shown <= 0.78 + 1e-9 || shown >= 1.06 - 1e-9, `${style} ${format} ${w}x${h}: ${shown.toFixed(3)} of the width`);
          if (shown >= 1) assert.equal(pose.fx, 0.5);
        }
      }
    }
  }
});

test('captions never overlap', () => {
  const plan = planFilm(
    input([moment('m1', 'tap', 2, 2.5, undefined, { caption: 'One' }), moment('m2', 'tap', 2.8, 3.2, undefined, { caption: 'Two' })], {
      text: { title: 'My app', end: 'Get it free', captions: true, taps: true },
    })
  );
  for (let i = 1; i < plan.cues.length; i++) assert.ok(plan.cues[i].start >= plan.cues[i - 1].end - 1e-9, JSON.stringify(plan.cues));
  assert.deepEqual(plan.cues.map((c) => c.role), ['title', 'caption', 'caption', 'end']);
});

// ---------------------------------------------------------------------------
// A phone in the hand
// ---------------------------------------------------------------------------

function near(a: Quat, b: Quat, eps = 1e-4) {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  assert.ok(1 - dot < eps, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}

test('a phone lying flat with no turn is no turn', () => {
  near(fromDeviceOrientation(0, 0, 0), IDENTITY);
});

test('the turn since centring is in the phone\'s own axes', () => {
  // Held upright facing you (beta 90), then turned 20 degrees about its long side.
  const reference = fromDeviceOrientation(30, 90, 0);
  const now = multiplyLocal(reference, fromYawPitchRoll(20, 0, 0));
  const turn = relativeTurn(reference, now);
  const angles = toYawPitchRoll(turn);
  assert.ok(Math.abs(angles.yaw - 20) < 1e-3 && Math.abs(angles.pitch) < 1e-3 && Math.abs(angles.roll) < 1e-3, JSON.stringify(angles));
});

function multiplyLocal(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

test('yaw, pitch and roll come back the way they went in', () => {
  for (const [y, p, r] of [[10, 0, 0], [0, 15, 0], [0, 0, -8], [22, 9, 3], [-30, -12, 5]]) {
    const back = toYawPitchRoll(fromYawPitchRoll(y, p, r));
    assert.ok(Math.abs(back.yaw - y) < 1e-6 && Math.abs(back.pitch - p) < 1e-6 && Math.abs(back.roll - r) < 1e-6, JSON.stringify([y, p, r, back]));
  }
});

test('a turn can be made smaller or bigger, never past the limit', () => {
  const q = fromYawPitchRoll(40, 0, 0);
  assert.ok(Math.abs(angleOf(scaleTurn(q, 0.5)) - 20) < 1e-6);
  assert.ok(Math.abs(angleOf(scaleTurn(q, 1.4)) - 56) < 1e-6);
  assert.ok(Math.abs(angleOf(scaleTurn(q, 3)) - 60) < 1e-6);
  near(scaleTurn(IDENTITY, 2), IDENTITY);
});

test('the steadying filter takes out shake but follows a real turn', () => {
  const filter = new TurnFilter();
  let out: Quat = IDENTITY;
  // Shake of one degree either way, at 60 readings a second.
  for (let i = 0; i < 120; i++) out = filter.push(fromYawPitchRoll(i % 2 ? 1 : -1, 0, 0), i / 60);
  assert.ok(angleOf(out) < 0.6, `shake left in: ${angleOf(out)}`);
  // A quick 40 degree turn: within a fifth of a second the filter is most of the way there.
  for (let i = 120; i < 132; i++) out = filter.push(fromYawPitchRoll(40, 0, 0), i / 60);
  assert.ok(angleOf(out) > 25, `late on a real turn: ${angleOf(out)}`);
});

test('a take is read between its readings, and stored small', () => {
  const samples = [0, 0.5, 1].map((t) => ({ t, q: fromYawPitchRoll(t * 20, 0, 0), zoom: 1 + t }));
  const mid = takeAt(samples, 0.25)!;
  assert.ok(Math.abs(toYawPitchRoll(mid.q).yaw - 5) < 1e-3);
  assert.ok(Math.abs(mid.zoom - 1.25) < 1e-9);
  assert.equal(takeAt([], 1), null);
  const dense = Array.from({ length: 600 }, (_, i) => ({ t: i / 240, q: slerp(IDENTITY, fromYawPitchRoll(30, 0, 0), i / 600) }));
  const small = compactSamples(steadySamples(dense), 60);
  assert.ok(small.length <= 152 && small.length >= 145, `${small.length} readings`);
});

// ---------------------------------------------------------------------------
// Films
// ---------------------------------------------------------------------------

function film(extra: Partial<Film> = {}): Film {
  return { ...newFilm({ mediaId: 'media_1', name: 'Habits.mov', width: 886, height: 1920, duration: 22 }, { projectId: 'p1', title: 'Habits' }), ...extra };
}

test('a recording gets a phone of its shape', () => {
  assert.equal(phoneForRecording(886, 1920), 'iphone-17-pro');
  assert.equal(phoneForRecording(1179, 2556), 'iphone-17-pro');
  assert.equal(phoneForRecording(1080, 2400), 'pixel-10-pro');
  assert.equal(phoneForRecording(1080, 2280), 'pixel-4');
  assert.equal(phoneForRecording(750, 1334), 'android-punch-hole');
});

test('a new film is named after its recording and plans without moments', () => {
  const f = film();
  assert.equal(f.name, 'Habits');
  assert.equal(f.text.title, 'Habits');
  const plan = planFor(f);
  assert.ok(plan.keys.length >= 2);
  assert.ok(Math.abs(plan.duration - filmDuration(f)) < 1e-9);
});

test('reading again keeps the moments the user changed', () => {
  const edited: Moment = { ...moment('m1', 'tap', 2, 2.5), edited: true, caption: 'Mine' };
  const found = [moment('m1', 'tap', 2.1, 2.4), moment('m2', 'scroll', 5, 6)];
  const merged = mergeMoments(found, [edited, moment('m9', 'tap', 8, 8.2)]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].caption, 'Mine');
  assert.equal(merged[1].kind, 'scroll');
  assert.equal(new Set(merged.map((m) => m.id)).size, 2);
});

test('editing a moment keeps it inside the recording and marks it', () => {
  let f = film({ moments: [moment('m1', 'tap', 2, 2.5)] });
  f = editMoment(f, 'm1', { start: 30, end: 31 });
  assert.ok(f.moments[0].end <= 22 && f.moments[0].start < f.moments[0].end);
  assert.equal(f.moments[0].edited, true);
  const added = addMoment(f, 4);
  assert.notEqual(added.id, 'm1');
  assert.equal(added.film.moments.find((m) => m.id === added.id)?.shot, 'close');
  assert.equal(removeMoment(added.film, added.id).moments.length, 1);
});

test('film time maps to the recording and holds its last frame', () => {
  const f = film({ trim: { start: 2, end: 10 } });
  assert.equal(recordingTime(f, 0), 2);
  assert.equal(recordingTime(f, 5), 7);
  assert.equal(recordingTime(f, 9.5), 10);
});

test('the phone makes room for words, and gives it back in a close-up', () => {
  const f = film({ text: { title: 'Habits', end: '', captions: true, taps: true } });
  const plan = planFor(f);
  assert.ok(wordsPresence(plan.cues, 1) > 0.9);
  assert.equal(wordsPresence(plan.cues, 10), 0);
  const frame = stageFrameAt(f, plan, 1);
  assert.ok(frame.shift.y < -0.05, 'the phone moves down under the title');
});

test('a take turns the phone only when the film uses it', () => {
  const take = { id: 't', recordedAt: 0, source: 'test' as const, samples: [{ t: 0, q: fromYawPitchRoll(20, 0, 0) }, { t: 20, q: fromYawPitchRoll(20, 0, 0) }] };
  const auto = film({ take, motion: 'auto' });
  assert.equal(stageFrameAt(auto, planFor(auto), 3).turn, null);
  const hand = film({ take, motion: 'hand', takeStrength: 0.5 });
  const frame = stageFrameAt(hand, planFor(hand), 3);
  assert.ok(frame.turn && Math.abs(angleOf(frame.turn) - 10) < 1e-6);
});

// ---------------------------------------------------------------------------
// Looks and the project
// ---------------------------------------------------------------------------

test('colors parse in the forms the app stores', () => {
  assert.deepEqual(parseColor('#fff'), [1, 1, 1]);
  assert.deepEqual(parseColor('#000000'), [0, 0, 0]);
  assert.ok(parseColor('rgb(255, 128, 0)'));
  assert.equal(parseColor('linear-gradient(red, blue)'), null);
});

test('a backdrop from the project\'s colors is dark for a strong color and light for a pale one', () => {
  assert.equal(brandBackdrop(['#5b3df5', '#ff5c8a', '#00c2a8']).dark, true);
  assert.equal(brandBackdrop(['#ffe8d6', '#ffd1e0', '#e0f4ff']).dark, false);
  const dark = brandBackdrop(['#5b3df5', '#ff5c8a', '#00c2a8']);
  assert.ok(luminance(parseColor(dark.bottom)!) < 0.05);
  assert.equal(backdropFor({ backdrop: 'nope' }).id, 'aurora');
});

function board(id: string, extra: Partial<ArtboardState>): ArtboardState {
  return { id, name: id, size: { width: 1290, height: 2796 }, position: { x: 0, y: 0 }, backgroundColor: '#ffffff', elements: [], ...extra } as ArtboardState;
}

test('the project\'s recordings are listed once each, with their artboard', () => {
  const rec = { id: 'e1', type: 'video-device', deviceType: 'iphone-17-pro', mediaId: 'media_9', position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, rotation: 0, scale: 1 };
  const list = projectRecordings([board('Home', { elements: [rec as never] }), board('', { elements: [{ ...rec, id: 'e2' } as never] })]);
  assert.equal(list.length, 1);
  assert.equal(list[0].where, 'Home');
  assert.equal(list[0].name, 'Screen recording');
});

test('the project\'s colors leave out greys and pick the most used', () => {
  assert.equal(projectColors([board('a', { backgroundColor: '#ffffff' }), board('b', { backgroundColor: '#111111' })]), null);
  const colors = projectColors([
    board('a', { backgroundColor: '#5b3df5' }),
    board('b', { backgroundColor: '#5b3df5' }),
    board('c', { backgroundType: 'gradient', backgroundGradient: { color1: '#ff5c8a', color2: '#ffffff' } as never }),
  ]);
  assert.ok(colors);
  assert.equal(colors![0], '#5b3df5');
});

test('the film\'s title is the app\'s name as the user gave it, never a name the editor made up', () => {
  // Names the editor makes: none of them is the app's name.
  for (let i = 0; i < 50; i++) assert.equal(isMadeUpProjectName(randomProjectName()), true);
  for (const made of ['Untitled Project', 'Blank Canvas Copy', 'Hoppi Copy', '  ', '']) assert.equal(projectAppName(made, []), '', made);
  // The user's own name, a duplicate's " copy" taken off.
  assert.equal(projectAppName('Daily Habits', []), 'Daily Habits');
  assert.equal(projectAppName('Daily Habits copy copy', []), 'Daily Habits');
  assert.equal(projectAppName('Hoppi Copy copy', []), '');
  assert.equal(projectAppName('Habit Tracker 2', []), 'Habit Tracker 2');
  // The name typed for the app icon wins, even over a made-up project name.
  assert.equal(projectAppName('Sleek Canvas 412', [board('a', {}), board('icon', { appIcon: { appName: ' Juniper ' } })]), 'Juniper');
});
