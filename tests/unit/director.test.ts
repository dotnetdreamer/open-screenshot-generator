import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityTrack, compareAll, compareFrames, findMoments, type LumaFrame } from '@/lib/director/analyze';
import { CARD_SECONDS, closePose, ease, FORMAT_ASPECT, hasCard, jumpsBetween, mixPose, planFilm, plannedPose, poseAt, STYLES, type PlanInput } from '@/lib/director/plan';
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
import { fitPhone, newFilm, phoneForRecording, phoneShape, planFor, withTake } from '@/lib/director/film';
import { DepthTracker, depthZoom } from '@/lib/director/depth';
import { AxisSense, PhoneMotion } from '@/lib/director/sensors';
import { playedTrue, readByPlaying, readBySeeking, seeksAreQuick, whenSeen, type FrameCallbackVideo } from '@/lib/director/sample';
import { blurTimes, filmDuration, handZoom, pictureTravel, stageFrameAt, wordsPresence, wordsSide } from '@/lib/director/frame';
import { drawOverlay, highlighted, markedWords, plainWords, wordColors } from '@/lib/director/overlay';
import { endHold } from '@/lib/director/plan';
import { FILM_TEMPLATES, templateById } from '@/lib/director/templates';
import {
  addClip,
  addMoment,
  bodyLength,
  changeRecordingFrom,
  clipNeedsRead,
  clipSpans,
  cutTimes,
  editMoment,
  filmMoments,
  MAX_FILM_SECONDS,
  mergeMoments,
  moveClip,
  removeClip,
  removeMoment,
  retimeMoment,
  filmTimeOf,
  replaceClip,
  sourceTime,
  spanAt,
  splitAt,
  trimClip,
  upgradeFilm,
  withClipReading,
} from '@/lib/director/timeline';
import { backdropFor, brandBackdrop, luminance, parseColor } from '@/lib/director/looks';
import { projectAppName, projectColors, projectRecordings } from '@/lib/director/project';
import { isMadeUpProjectName, randomProjectName } from '@/lib/projectNames';
import type { Film, FilmSource, Moment } from '@/lib/director/types';
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

test('a moment left out moves nothing: no swing for its new screen, no lean for its scroll, no push in for its pause', () => {
  for (const style of ['calm', 'lively', 'bold', 'cinematic'] as const) {
    const plan = (shot: Moment['shot']) =>
      planFilm(
        input(
          [
            moment('m1', 'screen', 3, 3.4, null, { shot }),
            moment('m2', 'scroll', 6, 7.2, { x: 0, y: 0.1, w: 1, h: 0.8 }, { shot }),
            moment('m3', 'still', 8.6, 10.8, null, { shot }),
          ],
          { style, text: { title: '', end: '', captions: false, taps: true } }
        )
      ).keys.map((k) => k.why ?? '');
    // The same moments left to Director each move the camera, so the test can tell.
    const auto = plan('auto');
    for (const why of ['with m1', 'with m2', 'push in']) assert.ok(auto.includes(why), `${style}, Director's choice: ${why} in ${auto.join(', ')}`);
    const left = plan('skip');
    for (const why of ['with m1', 'with m2', 'push in']) assert.ok(!left.includes(why), `${style}, left out: ${why} in ${left.join(', ')}`);
  }
});

test('Cinematic opens close on the first moment the user kept, never one they left out', () => {
  const opening = (shot: Moment['shot']) => planFilm(input([moment('m1', 'tap', 0.8, 1.1, { x: 0.05, y: 0.86, w: 0.12, h: 0.05 }, { shot })], { style: 'cinematic' })).keys[0].pose;
  const kept = opening('auto');
  const left = opening('skip');
  // Kept, the opening frames the tap low on the screen; left out, the top of the screen, where most apps put what matters.
  assert.ok(kept.fy > left.fy + 0.2, `kept ${kept.fy.toFixed(2)}, left out ${left.fy.toFixed(2)}`);
});

test('a new screen left out no longer keeps the tap before it wide (the audit\'s case: Lively, a tap at 5.0 s, a screen at 5.4 s)', () => {
  const plan = (shot: Moment['shot']) => planFilm(input([moment('m1', 'tap', 5, 5.2), moment('m2', 'screen', 5.4, 5.8, null, { shot })])).keys.map((k) => k.why ?? '');
  // Director's choice: the tap opens a new screen, so the camera stays wide to show that screen whole.
  assert.ok(!plan('auto').includes('close on m1'), plan('auto').join(', '));
  // Left out, the new screen is as if it weren't there, and the tap gets its close-up.
  assert.ok(plan('skip').includes('close on m1'), plan('skip').join(', '));
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
// Films and their timeline
// ---------------------------------------------------------------------------

const HABITS: FilmSource = { mediaId: 'media_a', name: 'Habits.mov', width: 886, height: 1920, duration: 22 };
const EXPENSES: FilmSource = { mediaId: 'media_b', name: 'Expenses.mp4', width: 1080, height: 2400, duration: 15 };

/** A film of one recording, the way the view makes it. */
function film(extra: Partial<Film> = {}): Film {
  const added = addClip(newFilm({ projectId: 'p1', title: 'Habits' }), HABITS)!;
  return { ...fitPhone(added.film), ...extra };
}

/** A clip's moments set by hand, in its recording's seconds. */
function withMoments(f: Film, index: number, moments: Moment[]): Film {
  return { ...f, clips: f.clips.map((clip, i) => (i === index ? { ...clip, moments: moments.map((m) => ({ ...m, id: `${clip.id}-${m.id}` })) } : clip)) };
}

test('a recording gets a phone of its shape', () => {
  assert.equal(phoneForRecording(886, 1920), 'iphone-17-pro');
  assert.equal(phoneForRecording(1179, 2556), 'iphone-17-pro');
  assert.equal(phoneForRecording(1080, 2400), 'pixel-10-pro');
  assert.equal(phoneForRecording(1080, 2280), 'pixel-4');
  assert.equal(phoneForRecording(750, 1334), 'android-punch-hole');
});

test('a template sets the shape, the camera, the backdrop and the words of a film with no recording yet', () => {
  const ad = templateById('social-ad')!;
  const f = newFilm({ projectId: null, title: 'Habits', template: ad });
  assert.equal(f.version, 2);
  assert.deepEqual([f.format, f.style, f.look.backdrop, f.text.end, f.template], ['square', 'bold', 'sunrise', 'Get it today', 'social-ad']);
  assert.equal(f.clips.length, 0);
  assert.ok(Math.abs(filmDuration(f) - (f.placeholderLength + endHold(f.text))) < 1e-9);
  assert.ok(planFor(f).keys.length >= 2, 'a film with no recording still has a camera');
  // A template with no title leaves the app's name out; "Your colors" needs colors.
  assert.equal(newFilm({ projectId: null, title: 'Habits', template: templateById('just-the-phone') }).text.title, '');
  assert.equal(newFilm({ projectId: null, template: templateById('your-colors') }).look.backdrop, 'aurora');
  assert.equal(newFilm({ projectId: null, template: templateById('your-colors'), colors: ['#5b3df5', '#ff5c8a', '#00c2a8'] }).look.backdrop, 'brand');
  assert.equal(new Set(FILM_TEMPLATES.map((t) => t.id)).size, FILM_TEMPLATES.length);
});

test('the first recording picks the phone, unless the user picked one', () => {
  const blank = newFilm({ projectId: null });
  const android = fitPhone(addClip(blank, EXPENSES)!.film);
  assert.equal(android.phone.deviceType, 'pixel-10-pro');
  const picked = fitPhone(addClip({ ...blank, phone: { deviceType: 'iphone-air', picked: true } }, EXPENSES)!.film);
  assert.equal(picked.phone.deviceType, 'iphone-air');
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

test('a clip keeps its moments in recording seconds; the film works out where they show', () => {
  let f = withMoments(film(), 0, [moment('m1', 'tap', 3, 3.5), moment('m2', 'scroll', 1, 1.5)]);
  f = trimClip(f, f.clips[0].id, { in: 2 });
  const moments = filmMoments(f);
  assert.equal(moments.length, 1, 'the scroll before the clip starts is not in the film');
  assert.ok(Math.abs(moments[0].start - 1) < 1e-9 && Math.abs(moments[0].end - 1.5) < 1e-9);
  // Trimming back brings it back: nothing was rewritten.
  assert.equal(filmMoments(trimClip(f, f.clips[0].id, { in: 0 })).length, 2);
});

test('film time maps into each clip, and the last frame holds through the end', () => {
  const f = addClip(trimClip(film(), 'c1', { in: 2, out: 10 }), EXPENSES)!.film;
  assert.equal(bodyLength(f), 8 + 15);
  const first = spanAt(f, 5)!;
  assert.equal(first.clip.mediaId, 'media_a');
  assert.equal(sourceTime(first, 5), 7);
  const second = spanAt(f, 8.5)!;
  assert.equal(second.clip.mediaId, 'media_b');
  assert.equal(sourceTime(second, 8.5), 0.5);
  const end = spanAt(f, 40)!;
  assert.equal(end.clip.mediaId, 'media_b');
  assert.equal(sourceTime(end, 40), 15);
  assert.deepEqual(cutTimes(f), [8]);
});

test('a split leaves two clips that show the same recording, each its own part, each moment once', () => {
  const f = withMoments(film(), 0, [moment('m1', 'tap', 3, 3.5), moment('m2', 'type', 9, 11)]);
  assert.equal(splitAt(f, 0.1), null, 'too near the start');
  const result = splitAt(f, 6)!;
  const [left, right] = result.film.clips;
  assert.deepEqual([left.in, left.out, right.in, right.out], [0, 6, 6, 22]);
  assert.equal(right.mediaId, left.mediaId);
  const ids = filmMoments(result.film).map((m) => m.id);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  assert.equal(bodyLength(result.film), bodyLength(f));
  assert.equal(clipNeedsRead(right), clipNeedsRead(f.clips[0]), 'a half needs no reading its whole did not');
});

test('the recording changes from a point: a split there, then the new recording; later clips keep their place', () => {
  const two = addClip(film(), HABITS)!.film; // 22 + 22
  const result = changeRecordingFrom(two, 10, EXPENSES)!;
  const spans = clipSpans(result.film);
  assert.deepEqual(
    spans.map((s) => [s.clip.mediaId, s.start, s.end]),
    [
      ['media_a', 0, 10],
      ['media_b', 10, 22],
      ['media_a', 22, 44],
    ]
  );
  assert.equal(result.clipId, spans[1].clip.id);
  // At a clip's very start the whole clip changes; at the end the recording is added.
  assert.equal(changeRecordingFrom(two, 22.1, EXPENSES)!.film.clips[1].mediaId, 'media_b');
  assert.equal(changeRecordingFrom(two, 44, EXPENSES)!.film.clips.length, 3);
  // The last clip shows the whole new recording; a middle one keeps its length.
  const last = replaceClip(film(), 'c1', EXPENSES);
  assert.equal(bodyLength(last), 15);
  const middle = replaceClip(two, 'c1', EXPENSES);
  assert.equal(middle.clips[0].out, 15, 'shorter than the clip: the whole recording');
  // In a film with no recording yet, it's the first.
  assert.equal(changeRecordingFrom(newFilm({ projectId: null }), 3, EXPENSES)!.film.clips.length, 1);
});

test('trimming keeps a clip inside its recording and the film inside its limit', () => {
  const f = film();
  const t = trimClip(f, 'c1', { in: -3, out: 400 });
  assert.deepEqual([t.clips[0].in, t.clips[0].out], [0, 22]);
  const tight = trimClip(f, 'c1', { in: 10, out: 10.1 });
  assert.ok(tight.clips[0].out - tight.clips[0].in >= 0.5 - 1e-9);
  // Four long recordings fill the film; the next one gets only the room left.
  const long: FilmSource = { mediaId: 'media_long', name: 'Long.mp4', width: 886, height: 1920, duration: 40 };
  let full = addClip(film(), long)!.film; // 22 + 40
  full = addClip(full, long)!.film; // + 28 of 40
  assert.equal(bodyLength(full), MAX_FILM_SECONDS);
  assert.equal(addClip(full, long), null, 'no room left');
  assert.equal(bodyLength(trimClip(full, full.clips[2].id, { out: 40 })), MAX_FILM_SECONDS, 'a trim never goes past the limit');
});

test('clips move and come out, and a film with none goes back to its placeholder', () => {
  const two = addClip(film(), EXPENSES)!.film;
  const moved = moveClip(two, 'c2', 0);
  assert.deepEqual(moved.clips.map((c) => c.mediaId), ['media_b', 'media_a']);
  assert.equal(moveClip(two, 'c2', 9).clips[1].id, 'c2');
  const none = removeClip(removeClip(two, 'c1'), 'c2');
  assert.equal(none.clips.length, 0);
  assert.equal(bodyLength(none), none.placeholderLength);
});

test('a moment dragged into another clip moves to that clip', () => {
  let f = addClip(withMoments(film(), 0, [moment('m1', 'tap', 3, 3.5)]), EXPENSES)!.film;
  const id = filmMoments(f)[0].id;
  f = editMoment(f, id, { start: 25, end: 25.5 });
  const moments = filmMoments(f);
  assert.equal(moments.length, 1);
  assert.ok(Math.abs(moments[0].start - 25) < 1e-9);
  assert.deepEqual(
    f.clips[0].moments.map((m) => !!m.removed),
    [true],
    'its own clip keeps a deleted copy that stands for it when that clip is read again'
  );
  assert.equal(f.clips[1].moments.length, 1);
  assert.equal(f.clips[1].moments[0].movedIn, true);
  assert.equal(f.clips[1].moments[0].start, 3, 'stored in the second recording\'s seconds');
  assert.equal(f.clips[1].moments[0].edited, true);
  // A change that isn't a move leaves its times alone.
  const captioned = editMoment(f, moments[0].id, { caption: 'Pay in one tap' });
  assert.equal(captioned.clips[1].moments[0].start, 3);
  assert.equal(filmMoments(captioned)[0].caption, 'Pay in one tap');
});

test('a moment deleted stays deleted when the recording is read again; one added by hand just goes', () => {
  const reading = (moments: Moment[]) => ({ moments, activity: { step: 0.1, values: [0.2], start: 0 }, thumbs: [], range: { start: 0, end: 22 } });
  const found = [moment('m1', 'scroll', 3, 4.2, { x: 0, y: 0.1, w: 1, h: 0.8 }), moment('m2', 'tap', 3.5, 3.7), moment('m3', 'screen', 8, 8.4, null)];
  const read = withClipReading(film(), 'c1', reading(found));
  const deleted = removeMoment(read, 'c1-m1');
  assert.deepEqual(filmMoments(deleted).map((m) => m.id), ['c1-m2', 'c1-m3']);
  // Read again, finding the same three: the scroll stays gone, and the tap inside its stretch stays.
  const again = withClipReading(deleted, 'c1', reading(found));
  assert.deepEqual(filmMoments(again).map((m) => m.kind), ['tap', 'screen']);
  // The deleted one can't be changed or deleted again.
  assert.equal(editMoment(again, 'c1-m1', { shot: 'close' }), again);
  assert.equal(removeMoment(again, 'c1-m1'), again);
  // A close-up the user added, then deleted, leaves nothing behind.
  const added = addMoment(again, 10)!;
  const gone = removeMoment(added.film, added.id);
  assert.equal(gone.clips[0].moments.some((m) => m.id === added.id), false);
});

/** A reading of the habits recording that found these moments. */
function readingOf(moments: Moment[]) {
  return { moments, activity: { step: 0.1, values: [0.2], start: 0 }, thumbs: [], range: { start: 0, end: 22 } };
}
const at = (f: Film, kind: Moment['kind'], t: number) => filmMoments(f).some((m) => m.kind === kind && Math.abs(m.start - t) < 0.05);

test('a moment moved, then deleted, stays deleted where it was found; the moment it was moved onto stays (the audit\'s case)', () => {
  const found = [moment('m1', 'scroll', 3, 4.2, { x: 0, y: 0.1, w: 1, h: 0.8 }), moment('m2', 'scroll', 6.9, 7.8, { x: 0, y: 0.1, w: 1, h: 0.8 })];
  let f = withClipReading(film(), 'c1', readingOf(found));
  f = editMoment(f, 'c1-m1', { start: 6.9, end: 8.1 });
  f = removeMoment(f, 'c1-m1');
  assert.ok(!at(f, 'scroll', 3) && at(f, 'scroll', 6.9));
  const again = withClipReading(f, 'c1', readingOf(found));
  assert.ok(!at(again, 'scroll', 3), 'the deleted scroll came back');
  assert.ok(at(again, 'scroll', 6.9), 'the untouched scroll went');
});

test('a moment moved stays where the user put it, and the same moment found again never shows twice', () => {
  const found = [moment('m1', 'tap', 3, 3.3), moment('m2', 'tap', 8, 8.2)];
  let f = withClipReading(film(), 'c1', readingOf(found));
  f = editMoment(f, 'c1-m1', { start: 5, end: 5.3 });
  const again = withClipReading(f, 'c1', readingOf(found));
  assert.deepEqual(
    filmMoments(again).map((m) => Math.round(m.start * 10) / 10),
    [5, 8]
  );
});

test('a close-up the user added hides nothing Director finds, left out or not (the audit\'s case)', () => {
  const found = [moment('m1', 'tap', 5.3, 5.5), moment('m2', 'screen', 5.5, 5.9, null)];
  let f = withClipReading(film(), 'c1', readingOf(found));
  const added = addMoment(f, 5.2)!;
  f = editMoment(added.film, added.id, { shot: 'skip' });
  assert.ok(at(f, 'tap', 5.3) && at(f, 'screen', 5.5));
  const again = withClipReading(f, 'c1', readingOf(found));
  assert.ok(at(again, 'tap', 5.3) && at(again, 'screen', 5.5), filmMoments(again).map((m) => `${m.kind} ${m.start}`).join(', '));
  assert.ok(filmMoments(again).some((m) => m.id === added.id || m.shot === 'skip'), 'the user\'s close-up stays');
});

/** A moment Director found (not one the user added) of this kind at film time `t`. */
const foundAt = (f: Film, kind: Moment['kind'], t: number) => filmMoments(f).some((m) => m.kind === kind && Math.abs(m.start - t) < 0.05 && !/-u\d/.test(m.id));

test('a close-up the user added, moved across a cut onto a tap, then deleted, leaves the tap alone (the audit\'s case)', () => {
  const found = [moment('m1', 'tap', 10.2, 10.4)];
  let f = withClipReading(film(), 'c1', readingOf(found));
  const added = addMoment(f, 4)!;
  const split = splitAt(added.film, 7)!;
  const right = split.right;
  // Splitting copies every moment into the new clip, so the moved close-up gets a new id ("u1_2").
  const before = new Set(split.film.clips.find((c) => c.id === right)!.moments.map((m) => m.id));
  f = editMoment(split.film, added.id, { start: 10.2, end: 10.8 });
  const moved = f.clips.find((c) => c.id === right)!.moments.find((m) => !before.has(m.id))!;
  assert.match(moved.id, /-u1_\d+$/);
  assert.ok(filmMoments(f).some((m) => m.id === moved.id && Math.abs(m.start - 10.2) < 0.05), 'the close-up shows at 10.2 s');
  f = removeMoment(f, moved.id);
  assert.ok(!filmMoments(f).some((m) => m.id === moved.id), 'the close-up went');
  assert.ok(foundAt(f, 'tap', 10.2), 'the tap survived the delete');
  const again = withClipReading(f, right, readingOf(found));
  assert.ok(foundAt(again, 'tap', 10.2), 'the tap went on reading again');
});

test('a found moment moved into the next clip isn\'t found again where it was, when that clip is read again', () => {
  const found = [moment('m1', 'tap', 3, 3.3), moment('m2', 'tap', 9.5, 9.7)];
  let f = withClipReading(film(), 'c1', readingOf(found));
  const split = splitAt(f, 7)!;
  f = editMoment(split.film, 'c1-m1', { start: 9, end: 9.3 });
  assert.ok(!foundAt(f, 'tap', 3) && foundAt(f, 'tap', 9), 'moved into the second clip');
  // The first clip read again: its tap at 3 s is the one the user moved, so it doesn't come back there.
  const first = split.film.clips[0].id;
  const again = withClipReading(f, first, { ...readingOf(found), range: { start: 0, end: 7 } });
  assert.ok(!foundAt(again, 'tap', 3), filmMoments(again).map((m) => `${m.id} ${m.start}`).join(', '));
  assert.ok(foundAt(again, 'tap', 9));
});

test('two taps a tenth of a second apart are two moments: deleting one leaves the other, through reading again (the audit\'s case)', () => {
  const found = [moment('m1', 'tap', 1.0, 1.08, { x: 0.1, y: 0.2, w: 0.1, h: 0.05 }), moment('m2', 'tap', 1.1, 1.18, { x: 0.7, y: 0.8, w: 0.1, h: 0.05 })];
  let f = withClipReading(film(), 'c1', readingOf(found));
  f = removeMoment(f, 'c1-m1');
  assert.ok(!foundAt(f, 'tap', 1.0) && foundAt(f, 'tap', 1.1));
  const again = withClipReading(f, 'c1', readingOf(found));
  assert.ok(!foundAt(again, 'tap', 1.0), 'the deleted tap came back');
  assert.ok(foundAt(again, 'tap', 1.1), 'the other tap went with it');
});

test('two clips showing the same part of a recording keep their own moments: a delete in one never reaches the other (the audit\'s case)', () => {
  const found = [moment('m1', 'scroll', 3, 4.2, { x: 0, y: 0.1, w: 1, h: 0.8 })];
  let f = withClipReading(film(), 'c1', readingOf(found));
  const split = splitAt(f, 7)!;
  // The second clip stretched back to the recording's start: the same scroll shows in both clips.
  f = trimClip(split.film, split.right, { in: 0 });
  const second = clipSpans(f).find((span) => span.clip.id === split.right)!;
  const inSecond = filmTimeOf(second, 3);
  assert.ok(foundAt(f, 'scroll', 3) && foundAt(f, 'scroll', inSecond), filmMoments(f).map((m) => `${m.kind} ${m.start}`).join(', '));
  f = removeMoment(f, 'c1-m1');
  assert.ok(!foundAt(f, 'scroll', 3) && foundAt(f, 'scroll', inSecond));
  const again = withClipReading(f, split.right, readingOf(found));
  assert.ok(foundAt(again, 'scroll', inSecond), 'the second clip\'s own scroll went');
  assert.ok(!foundAt(again, 'scroll', 3));
});

test('a film read before origins were kept: a tap moved onto another, then deleted, stays deleted where it was, and the other stays (the audit\'s case)', () => {
  // As films read before today store them: found moments with no record of where they were found.
  const old = withMoments(film(), 0, [moment('m1', 'tap', 3, 3.3), moment('m2', 'tap', 6, 6.3)]);
  assert.ok(old.clips[0].moments.every((m) => !m.found));
  let f = editMoment(old, 'c1-m1', { start: 6, end: 6.3 });
  f = removeMoment(f, 'c1-m1');
  const again = withClipReading(f, 'c1', readingOf([moment('m1', 'tap', 3, 3.3), moment('m2', 'tap', 6, 6.3)]));
  assert.ok(!foundAt(again, 'tap', 3), 'the moved and deleted tap came back');
  assert.ok(foundAt(again, 'tap', 6), 'the tap it was moved onto went');
});

test('a found moment moved into another clip, then that clip taken out: reading its own clip again doesn\'t bring it back (the audit\'s case)', () => {
  let f = withClipReading(film(), 'c1', readingOf([moment('m1', 'tap', 3, 3.3)]));
  f = addClip(f, EXPENSES)!.film;
  const later = clipSpans(f)[1];
  f = editMoment(f, 'c1-m1', { start: later.start + 2, end: later.start + 2.3 });
  assert.ok(!foundAt(f, 'tap', 3));
  f = removeClip(f, later.clip.id);
  const again = withClipReading(f, 'c1', readingOf([moment('m1', 'tap', 3, 3.3)]));
  assert.ok(!foundAt(again, 'tap', 3), 'it came back');
});

test('a moment moved into another clip stands for nothing there: that clip\'s own moment at the same place stays through reading again', () => {
  const found = [moment('m1', 'tap', 3, 3.3), moment('m2', 'tap', 9.5, 9.7)];
  let f = withClipReading(film(), 'c1', readingOf(found));
  const split = splitAt(f, 7)!;
  const moved = retimeMoment(split.film, 'c1-m1', { start: 9.5, end: 9.8 });
  // Whatever had the moment picked follows it to its new id in the other clip.
  assert.notEqual(moved.id, 'c1-m1');
  assert.ok(moved.film.clips.find((c) => c.id === split.right)!.moments.some((m) => m.id === moved.id && m.movedIn));
  const again = withClipReading(moved.film, split.right, { ...readingOf(found), range: { start: 7, end: 22 } });
  const taps = filmMoments(again).filter((m) => m.kind === 'tap' && Math.abs(m.start - 9.5) < 0.05);
  assert.equal(taps.length, 2, 'the moved tap and the one Director found there');
  assert.equal(removeMoment(again, moved.id).clips.find((c) => c.id === split.right)!.moments.some((m) => m.id === moved.id), false, 'deleting it by its new id works');
});

test('a close-up is added where the playhead is, and taken out again', () => {
  const f = film();
  const added = addMoment(f, 4)!;
  const moment0 = filmMoments(added.film).find((m) => m.id === added.id)!;
  assert.equal(moment0.shot, 'close');
  assert.ok(Math.abs(moment0.start - 4) < 1e-9);
  assert.equal(filmMoments(removeMoment(added.film, added.id)).length, 0);
  assert.equal(addMoment(newFilm({ projectId: null }), 2), null, 'no close-up without a recording');
});

test('what a reading found lands on its clip in recording seconds, with the clip\'s ids', () => {
  const f = film();
  const read = withClipReading(f, 'c1', {
    moments: [moment('m1', 'tap', 3, 3.4)],
    activity: { step: 0.1, values: [0.2], start: 0 },
    thumbs: [{ t: 1, url: 'data:,' }],
    range: { start: 0, end: 22 },
  });
  assert.equal(read.clips[0].moments[0].id, 'c1-m1');
  assert.equal(clipNeedsRead(read.clips[0]), false);
  assert.equal(clipNeedsRead(trimClip(read, 'c1', { in: 2, out: 9 }).clips[0]), false, 'a smaller part was read already');
});

test('a film saved before clips opens as a film of one clip', () => {
  const stored = {
    id: 'film_old',
    name: 'Old',
    createdAt: 1,
    updatedAt: 2,
    projectId: null,
    source: HABITS,
    trim: { start: 2, end: 12 },
    format: 'vertical',
    fps: 30,
    style: 'lively',
    look: { backdrop: 'aurora' },
    phone: { deviceType: 'iphone-17-pro' },
    text: { title: '', end: '', captions: true, taps: true },
    sound: { recording: true },
    moments: [moment('m1', 'tap', 1, 1.5)],
    activity: { step: 0.1, values: [0.1] },
    analysisVersion: 1,
    motion: 'auto',
    take: null,
    takeStrength: 0.85,
    strip: [{ t: 0.5, url: 'data:,' }],
  };
  const f = upgradeFilm(stored as never);
  assert.equal(f.version, 2);
  assert.equal(f.clips.length, 1);
  const clip = f.clips[0];
  assert.deepEqual([clip.mediaId, clip.in, clip.out], ['media_a', 2, 12]);
  assert.equal(clip.moments[0].start, 3, 'moments move to the recording\'s seconds');
  assert.equal(filmMoments(f)[0].start, 1, 'and show where they showed');
  assert.equal(clip.strip?.[0].t, 2.5);
  assert.equal(upgradeFilm(f), f, 'a film in today\'s shape is left as it is');
});

test('the camera never closes up across a cut, nor pans from one recording to the next', () => {
  // A heavy tap in each recording, a breath either side of the cut.
  let f = addClip(trimClip(film(), 'c1', { out: 6 }), EXPENSES)!.film;
  f = withMoments(f, 0, [moment('m1', 'type', 4.8, 5.8)]);
  f = withMoments(f, 1, [moment('m1', 'type', 0.3, 1.3)]);
  for (const style of ['calm', 'lively', 'bold'] as const) {
    const plan = planFor({ ...f, style });
    const cut = cutTimes(f)[0];
    // Between a close-up's arrival and the next wide shot, the cut never falls.
    for (let i = 0; i < plan.keys.length; i++) {
      const why = plan.keys[i].why ?? '';
      if (!/^(close on|pan to)/.test(why)) continue;
      const arrive = plan.keys[i].t;
      const leave = plan.keys.slice(i + 1).find((k) => !/^(hold|pan to)/.test(k.why ?? ''))?.t ?? plan.duration;
      assert.ok(!(cut > arrive - 0.05 && cut < leave), `${style}: close-up from ${arrive.toFixed(2)} to ${leave.toFixed(2)} crosses the cut at ${cut}`);
    }
  }
});

test('the phone makes room for words, and gives it back in a close-up', () => {
  const f = film({ text: { title: 'Habits', end: '', captions: true, taps: true } });
  const plan = planFor(f);
  assert.ok(wordsPresence(plan.cues, 1) > 0.9);
  assert.equal(wordsPresence(plan.cues, 10), 0);
  const frame = stageFrameAt(f, plan, 1);
  assert.ok(frame.shift.y < -0.05, 'the phone moves down under the title');
});

test('a take made before the recording sets the length only when it was stopped early', () => {
  const blank = newFilm({ projectId: null, template: templateById('launch') });
  const take = (end: number) => ({ id: 't', recordedAt: 0, source: 'test' as const, samples: [{ t: 0, q: fromYawPitchRoll(0, 0, 0) }, { t: end, q: fromYawPitchRoll(10, 0, 0) }] });
  // Ran to the end of the film, the end words included: the length stays.
  const full = withTake(blank, take(filmDuration(blank)));
  assert.equal(full.placeholderLength, blank.placeholderLength);
  assert.equal(full.motion, 'hand');
  // Stopped at 9.3 s: the film is 9.5 s now.
  assert.equal(withTake(blank, take(9.3)).placeholderLength, 9.5);
  // With a recording, the recording sets the length.
  assert.equal(withTake(film(), take(4)).placeholderLength, film().placeholderLength);
});

test('a take turns the phone only when the film uses it', () => {
  const take = { id: 't', recordedAt: 0, source: 'test' as const, samples: [{ t: 0, q: fromYawPitchRoll(20, 0, 0) }, { t: 20, q: fromYawPitchRoll(20, 0, 0) }] };
  const auto = film({ take, motion: 'auto' });
  assert.equal(stageFrameAt(auto, planFor(auto), 3).turn, null);
  const hand = film({ take, motion: 'hand', takeStrength: 0.5 });
  const frame = stageFrameAt(hand, planFor(hand), 3);
  assert.ok(frame.turn && Math.abs(angleOf(frame.turn) - 10) < 1e-6);
});

test('forward and back in a take counts only while the film has it on', () => {
  const still = fromYawPitchRoll(0, 0, 0);
  // Held 20 cm closer the whole way, with no pinch.
  const take = { id: 't', recordedAt: 0, source: 'test' as const, samples: [{ t: 0, q: still, zoom: 1, depth: 0.2 }, { t: 20, q: still, zoom: 1, depth: 0.2 }] };
  const plain = film({ motion: 'auto' });
  const planned = stageFrameAt(plain, planFor(plain), 3).pose.zoom;
  const off = film({ take, motion: 'hand' });
  assert.ok(Math.abs(stageFrameAt(off, planFor(off), 3).pose.zoom - planned) < 1e-9, 'off: the planned framing');
  const on = film({ take, motion: 'hand', handDepth: true });
  assert.ok(Math.abs(stageFrameAt(on, planFor(on), 3).pose.zoom - planned * depthZoom(0.2)) < 1e-9, 'on: closer by the distance');
  // A pinch still counts with it off.
  const pinched = film({ take: { ...take, samples: take.samples.map((s) => ({ ...s, zoom: 1.5 })) }, motion: 'hand' });
  assert.ok(Math.abs(stageFrameAt(pinched, planFor(pinched), 3).pose.zoom - planned * 1.5) < 1e-9);
});

test('a phone moving the film live shows what a take of the same moves would', () => {
  const q = fromYawPitchRoll(16, 0, 0);
  const moves = { q, zoom: 1.2, depth: 0.15 };
  const take = { id: 't', recordedAt: 0, source: 'test' as const, samples: [{ t: 0, ...moves }, { t: 20, ...moves }] };
  for (const handDepth of [false, true]) {
    const recorded = film({ take, motion: 'hand', takeStrength: 0.7, handDepth });
    const fromTake = stageFrameAt(recorded, planFor(recorded), 3);
    // Live, an older take in use is replaced, not added to.
    const older = { ...take, samples: take.samples.map((s) => ({ ...s, q: fromYawPitchRoll(-30, 0, 0), zoom: 2 })) };
    const moving = film({ take: older, motion: 'hand', takeStrength: 0.7, handDepth });
    const fromLive = stageFrameAt(moving, planFor(moving), 3, moves);
    assert.ok(Math.abs(fromLive.pose.zoom - fromTake.pose.zoom) < 1e-9, `zoom, forward and back ${handDepth ? 'on' : 'off'}`);
    assert.ok(fromLive.turn && fromTake.turn && Math.abs(angleOf(fromLive.turn) - angleOf(fromTake.turn)) < 1e-6);
  }
  // Live moves show without a take too.
  const none = film({ motion: 'auto' });
  assert.ok(stageFrameAt(none, planFor(none), 3, moves).turn);
});

test('the zoom from a hand stays within the take limits', () => {
  assert.equal(handZoom({ handDepth: true }, 3, 0.4), 3);
  assert.equal(handZoom({ handDepth: true }, 0.6, -0.4), 0.6);
  assert.equal(handZoom({ handDepth: false }, 1, 0.4), 1);
  assert.equal(handZoom({}, 1.4), 1.4);
});

test('a take keeps the distance with each reading, and between readings', () => {
  const still = fromYawPitchRoll(0, 0, 0);
  const samples = [{ t: 0, q: still, zoom: 1, depth: 0 }, { t: 1, q: still, zoom: 1, depth: 0.2 }];
  assert.ok(Math.abs(takeAt(samples, 0.5)!.depth - 0.1) < 1e-9);
  assert.equal(takeAt(samples, 5)!.depth, 0.2);
  // Readings sent with forward and back off have none: no distance.
  assert.equal(takeAt([{ t: 0, q: still }, { t: 1, q: still }], 0.5)!.depth, 0);
  const kept = compactSamples([{ t: 0, q: still, zoom: 1, depth: 0.12345 }, { t: 0.5, q: still, zoom: 1 }]);
  assert.equal(kept[0].depth, 0.123);
  assert.equal('depth' in kept[1], false);
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

// ---------------------------------------------------------------------------
// Moving the phone closer
// ---------------------------------------------------------------------------

/** A push of `metres` (negative: away) over `seconds`, as an accelerometer reads it at 60 Hz: a smooth start and stop. */
function pushReadings(metres: number, seconds: number, from = 0): { t: number; a: number }[] {
  const out: { t: number; a: number }[] = [];
  const peak = (metres * 2 * Math.PI) / (seconds * seconds);
  for (let i = 0; i <= Math.round(seconds * 60); i++) {
    const t = i / 60;
    out.push({ t: from + t, a: peak * Math.sin((2 * Math.PI * t) / seconds) });
  }
  return out;
}

function still(seconds: number, from: number, offset = 0, noise = 0): { t: number; a: number }[] {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return Array.from({ length: Math.round(seconds * 60) }, (_, i) => ({ t: from + (i + 1) / 60, a: offset + noise * random() }));
}

test('a push toward you moves the phone in the film closer, and it stays there while you hold still', () => {
  const depth = new DepthTracker();
  for (const r of pushReadings(0.2, 0.6)) depth.push(r.t, r.a, 0);
  const afterPush = depth.value;
  assert.ok(afterPush > 0.13 && afterPush < 0.23, `pushed 20 cm, read ${afterPush.toFixed(3)} m`);
  for (const r of still(2, 0.6, 0, 0.03)) depth.push(r.t, r.a, 0);
  assert.ok(Math.abs(depth.value - afterPush) < 0.01, `held still, moved ${(depth.value - afterPush).toFixed(3)} m`);
  assert.ok(depthZoom(depth.value) > 1.3, 'closer is bigger');
});

test('a push away moves it back, and back and forth ends where it started', () => {
  const away = new DepthTracker();
  for (const r of pushReadings(-0.15, 0.5)) away.push(r.t, r.a, 0);
  assert.ok(away.value < -0.09, `pushed away, read ${away.value.toFixed(3)} m`);
  assert.ok(depthZoom(away.value) < 0.85);
  const shake = new DepthTracker();
  let t = 0;
  for (let i = 0; i < 4; i++) {
    for (const r of pushReadings(0.1, 0.4, t)) shake.push(r.t, r.a, 0);
    t += 0.4 + 1 / 60;
    for (const r of pushReadings(-0.1, 0.4, t)) shake.push(r.t, r.a, 0);
    t += 0.4 + 1 / 60;
  }
  assert.ok(Math.abs(shake.value) < 0.05, `four shakes, ended ${shake.value.toFixed(3)} m from the start`);
});

test('held still for a long time with a noisy, offset sensor, the phone doesn\'t drift', () => {
  const depth = new DepthTracker();
  for (const r of still(20, 0, 0.06, 0.05)) depth.push(r.t, r.a, 2);
  assert.ok(Math.abs(depth.value) < 0.02, `drifted ${depth.value.toFixed(3)} m in 20 s`);
});

test('a fast turn is not a push', () => {
  const depth = new DepthTracker();
  for (const r of pushReadings(0.2, 0.6)) depth.push(r.t, r.a, 150);
  assert.ok(Math.abs(depth.value) < 0.01, `turning, read ${depth.value.toFixed(3)} m`);
  depth.reset();
  assert.equal(depth.value, 0);
});

test('distance becomes zoom on a curve, within limits', () => {
  assert.equal(depthZoom(0), 1);
  assert.ok(Math.abs(depthZoom(0.2) - Math.exp(0.46)) < 1e-9);
  assert.ok(depthZoom(-0.2) < 1 && depthZoom(-0.2) > 0.6);
  assert.equal(depthZoom(5), 2.5);
  assert.equal(depthZoom(-5), 0.6);
});

test('the accelerometer\'s signs are read from the phone itself: standard, or the other way round as on iPhone', () => {
  const vote = (sense: AxisSense, g: { x: number; y: number; z: number }, beta: number, gamma: number, times = 6) => {
    for (let i = 0; i < times; i++) sense.vote(g, beta, gamma);
    return sense.sign;
  };
  // Flat, face up: the standard reads +9.81 on z, Safari on iPhone -9.81.
  assert.equal(vote(new AxisSense(), { x: 0, y: 0, z: 9.81 }, 0, 0), 1);
  assert.equal(vote(new AxisSense(), { x: 0, y: 0, z: -9.81 }, 0, 0), -1);
  // Held upright, as when moving the video.
  assert.equal(vote(new AxisSense(), { x: 0, y: 9.7, z: 1.5 }, 81, 0), 1);
  assert.equal(vote(new AxisSense(), { x: 0, y: -9.7, z: -1.5 }, 81, 0), -1);
  // Tipped to the side: gamma counts too.
  assert.equal(vote(new AxisSense(), { x: -6.9, y: 0, z: 6.9 }, 0, 45), 1);
  // A phone being shaken says nothing about up, and two readings aren't enough.
  assert.equal(vote(new AxisSense(), { x: 0, y: 0, z: 16 }, 0, 0), 0);
  assert.equal(vote(new AxisSense(), { x: 0, y: 0, z: 9.81 }, 0, 0, 2), 0);
});

test('the reader seeks where seeking is quick, judged by the seeks alone and by the middle one', () => {
  // Measured in the desktop app (2026-11-25): the seeks of the first six samples. The first picture
  // drawn took 1003 ms on top, which once sent the app to playing, where it drew one picture over and over.
  assert.equal(seeksAreQuick([0, 69, 12, 3, 6, 15]), true);
  assert.equal(seeksAreQuick([0, 28, 10, 3, 3, 3]), true);
  // One slow seek doesn't decide.
  assert.equal(seeksAreQuick([0, 3, 4, 1100, 5, 4]), true);
  // Chromium starts each seek again from a keyframe: playing reads it better.
  assert.equal(seeksAreQuick([0, 120, 110, 95, 130, 140]), false);
  assert.equal(seeksAreQuick([0, 30, 40, 35]), false);
  assert.equal(seeksAreQuick([]), true);
});

test('nothing is read while the page is hidden: the reader waits until it is seen, or until it is stopped', async () => {
  // Measured in the desktop app with its window hidden: no 'seeked' for 1.6 s, seek after seek, and a reading that found only new screens.
  const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' as DocumentVisibilityState });
  const global = globalThis as { document?: unknown };
  const saved = global.document;
  global.document = doc;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
  try {
    let seen = false;
    const waiting = whenSeen().then(() => (seen = true));
    await tick();
    assert.equal(seen, false, 'hidden: it waits');
    doc.dispatchEvent(new Event('visibilitychange'));
    await tick();
    assert.equal(seen, false, 'a change that leaves the page hidden: still waiting');
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await waiting;
    assert.equal(seen, true);
    // Seen already: no wait.
    await whenSeen();
    // Stopped while it waits (another reading, or the film closed): it ends as stopped.
    doc.visibilityState = 'hidden';
    const controller = new AbortController();
    const stopped = whenSeen(controller.signal);
    controller.abort();
    await assert.rejects(stopped, (error: { name?: string }) => error?.name === 'AbortError');
  } finally {
    global.document = saved;
  }
});

/** A video that plays itself: a frame callback every 16 ms, its time moving at its playback rate. */
class PlayingVideo extends EventTarget {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  ended = false;
  duration = 10;
  private timer: ReturnType<typeof setInterval> | null = null;
  private callbacks = new Map<number, (now: number, metadata: { mediaTime: number }) => void>();
  private nextHandle = 1;
  requestVideoFrameCallback(callback: (now: number, metadata: { mediaTime: number }) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }
  cancelVideoFrameCallback(handle: number): void {
    this.callbacks.delete(handle);
  }
  play(): Promise<void> {
    this.paused = false;
    this.timer ??= setInterval(() => {
      this.currentTime += (1 / 60) * this.playbackRate;
      const due = [...this.callbacks.values()];
      this.callbacks.clear();
      for (const callback of due) callback(performance.now(), { mediaTime: this.currentTime });
    }, 16);
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

test('reading by playing stops the moment the page hides, and never starts on a hidden page', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const global = globalThis as { document?: unknown };
  const saved = global.document;
  global.document = doc;
  const reader = { luma: (t: number) => ({ t, width: 1, height: 1, data: new Uint8Array(1) }), thumbUrl: () => 'data:,' };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const video = new PlayingVideo();
    const out = { frames: [] as ReturnType<typeof reader.luma>[], thumbs: [] as { t: number; url: string }[] };
    const reading = readByPlaying(video as unknown as FrameCallbackVideo, reader, { start: 0, end: 10, step: 0.1 }, out, 0);
    await wait(200);
    assert.ok(out.frames.length > 3, `${out.frames.length} frames read while seen`);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(await reading, false, 'hidden: playing stops, and the caller seeks on once the page is seen');
    assert.equal(video.paused, true);
    const atStop = out.frames.length;
    await wait(150);
    assert.equal(out.frames.length, atStop, 'nothing read after the page hid');

    // Hidden before it starts: it doesn't play at all.
    const still = new PlayingVideo();
    const none = { frames: [] as ReturnType<typeof reader.luma>[], thumbs: [] as { t: number; url: string }[] };
    assert.equal(await readByPlaying(still as unknown as FrameCallbackVideo, reader, { start: 0, end: 10, step: 0.1 }, none, 0), false);
    assert.equal(still.paused, true);
    assert.equal(none.frames.length, 0);

    // Hidden with the frame callback first, before the page's visibilitychange: that frame isn't kept either.
    doc.visibilityState = 'visible';
    const early = new PlayingVideo();
    const some = { frames: [] as ReturnType<typeof reader.luma>[], thumbs: [] as { t: number; url: string }[] };
    const going = readByPlaying(early as unknown as FrameCallbackVideo, reader, { start: 0, end: 10, step: 0.1 }, some, 0);
    await wait(200);
    const before = some.frames.length;
    doc.visibilityState = 'hidden';
    assert.equal(await going, false);
    assert.equal(some.frames.length, before, 'a frame kept after the page hid');
  } finally {
    global.document = saved;
  }
});

/** A video that answers each seek after 5 ms, and can hide the page as one seek is asked. */
class SeekingVideo extends EventTarget {
  duration = 1;
  readyState = 4;
  private time = 0;
  hideAsSeeking: { at: number; hide: () => void } | null = null;
  get currentTime(): number {
    return this.time;
  }
  set currentTime(t: number) {
    this.time = t;
    if (this.hideAsSeeking && Math.abs(t - this.hideAsSeeking.at) < 1e-6) {
      const { hide } = this.hideAsSeeking;
      this.hideAsSeeking = null;
      hide();
    }
    setTimeout(() => this.dispatchEvent(new Event('seeked')), 5);
  }
}

test('a seek that lands after the page hid is read again once the page is seen, never kept (WebKit handed one over 136 ms after hiding)', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const global = globalThis as { document?: unknown };
  const saved = global.document;
  global.document = doc;
  try {
    const drawn: string[] = [];
    const reader = {
      luma: (t: number) => {
        drawn.push(`${t.toFixed(1)} ${doc.visibilityState}`);
        return { t, width: 1, height: 1, data: new Uint8Array(1) };
      },
      thumbUrl: () => 'data:,',
    };
    const video = new SeekingVideo();
    // The page hides as the seek to 0.3 s is asked; the seek still lands while it's hidden; the page is seen 60 ms later.
    video.hideAsSeeking = {
      at: 0.3,
      hide: () => {
        doc.visibilityState = 'hidden';
        doc.dispatchEvent(new Event('visibilitychange'));
        setTimeout(() => {
          doc.visibilityState = 'visible';
          doc.dispatchEvent(new Event('visibilitychange'));
        }, 60);
      },
    };
    const out = { frames: [] as ReturnType<typeof reader.luma>[], thumbs: [] as { t: number; url: string }[] };
    const seekMs: number[] = [];
    await readBySeeking(video as unknown as FrameCallbackVideo, reader, { start: 0, end: 0.6, step: 0.1 }, out, 0, Infinity, seekMs);
    assert.deepEqual(out.frames.map((frame) => frame.t.toFixed(1)), ['0.0', '0.1', '0.2', '0.3', '0.4', '0.5', '0.6']);
    assert.ok(drawn.every((line) => line.endsWith('visible')), drawn.join(', '));
    assert.ok(seekMs.every((ms) => ms < 50), `the hidden wait timed as a seek: ${seekMs.map(Math.round).join(', ')}`);
  } finally {
    global.document = saved;
  }
});

test('frames that playing gave are checked against seeking when most are the same: old pictures are caught, a still recording passes', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const global = globalThis as { document?: unknown };
  const saved = global.document;
  global.document = doc;
  try {
    const frameOf = (t: number, value: number) => ({ t, width: 1, height: 1, data: new Uint8Array([value]) });
    // What seeking draws: the true picture at the video's time.
    const check = async (truth: (t: number) => number, played: (t: number) => number) => {
      const video = new SeekingVideo();
      video.duration = 10;
      const reader = { luma: (t: number) => frameOf(t, truth(video.currentTime)) };
      const out = { frames: Array.from({ length: 40 }, (_, i) => frameOf(0.6 + i * 0.1, played(0.6 + i * 0.1))), thumbs: [] as { t: number; url: string }[] };
      return playedTrue(video as unknown as FrameCallbackVideo, reader, { start: 0, end: 4.6, step: 0.1 }, out, 0);
    };
    // The desktop app with slow seeks: one old picture over and over, where the recording changes every few tenths.
    const changing = (t: number) => Math.floor(t * 3) * 20;
    assert.equal(await check(changing, () => 7), false, 'old pictures passed');
    // Playing that drew true pictures: they change, so nothing is checked.
    assert.equal(await check(changing, changing), true);
    // A recording that holds still most of the time, played true: checked, and it passes.
    const mostlyStill = (t: number) => (t < 2.5 ? 40 : 90);
    assert.equal(await check(mostlyStill, mostlyStill), true);
    // Played with old pictures where it did change: caught.
    assert.equal(await check((t) => (t < 1.5 ? 40 : t < 3 ? 90 : 160), () => 40), false);
  } finally {
    global.document = saved;
  }
});

test('a straight push with the phone held at one angle goes out as it happens, with no tilt to carry it', () => {
  // A stand-in window: PhoneMotion listens to its events and times them by their timeStamp.
  const target = Object.assign(new EventTarget(), { setTimeout });
  const global = globalThis as { window?: unknown };
  const saved = global.window;
  global.window = target;
  const motion = new PhoneMotion();
  try {
    const readings: { depth: number; turned: boolean }[] = [];
    motion.start((q, _t, depth) => readings.push({ depth, turned: Math.abs(q[3]) < 0.9999 }));
    let at = 1000;
    const fire = (type: string, fields: object) => {
      const event = Object.assign(new Event(type), fields);
      Object.defineProperty(event, 'timeStamp', { value: at });
      target.dispatchEvent(event);
    };
    // Held upright: gravity along the screen's height, with the standard's signs; z points at the person.
    const accelerate = (a: number) => fire('devicemotion', { acceleration: { x: 0, y: 0, z: a }, accelerationIncludingGravity: { x: 0, y: 9.81, z: a }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } });
    fire('deviceorientation', { alpha: 0, beta: 90, gamma: 0 });
    for (let i = 0; i < 20; i++) {
      accelerate(0);
      at += 1000 / 60;
    }
    assert.equal(readings.length, 1, 'held still, only the turn went out');

    // Twenty centimetres closer in 0.6 s, and not one orientation event the whole time.
    // Two motion events a frame, as a phone with a 120 Hz sensor sends them.
    const push = pushReadings(0.2, 0.6);
    for (const r of push) {
      accelerate(r.a);
      at += 8;
      accelerate(r.a);
      at += 1000 / 60 - 8;
    }
    for (let i = 0; i < 20; i++) {
      accelerate(0);
      at += 1000 / 60;
    }
    const pushed = readings.slice(1);
    assert.ok(pushed.length >= 20, `${pushed.length} readings went out during the push`);
    assert.ok(pushed.length <= push.length + 1, `${pushed.length} readings for ${push.length} frames: at most one a frame`);
    const last = readings[readings.length - 1].depth;
    assert.ok(last > 0.12, `the distance that went out: ${last.toFixed(3)} m`);
    assert.ok(depthZoom(last) > 1.3);
    // Holding still at the new distance sends nothing more.
    const count = readings.length;
    for (let i = 0; i < 30; i++) {
      accelerate(0);
      at += 1000 / 60;
    }
    assert.equal(readings.length, count, 'held still after the push');
    // A tilt still goes out at once, with the distance it's at.
    fire('deviceorientation', { alpha: 0, beta: 90, gamma: 20 });
    assert.equal(readings.length, count + 1);
    assert.ok(readings[count].turned && Math.abs(readings[count].depth - last) < 0.005);
  } finally {
    motion.stop();
    global.window = saved;
  }
});

// ---------------------------------------------------------------------------
// Cinematic and Pop promo: the words' looks, the end card and the camera
// ---------------------------------------------------------------------------

test('words between stars are highlighted, and the stars are never drawn', () => {
  assert.deepEqual(markedWords('Track *every* habit'), [
    { word: 'Track', mark: false },
    { word: 'every', mark: true },
    { word: 'habit', mark: false },
  ]);
  // Across words, with punctuation after the star, and an unclosed star running to the end.
  assert.deepEqual(markedWords('*Two words*, then plain').map((w) => [w.word, w.mark]), [['Two', true], ['words,', true], ['then', false], ['plain', false]]);
  assert.deepEqual(markedWords('Open *forever and ever').map((w) => w.mark), [false, true, true, true]);
  assert.deepEqual(markedWords(' ** '), []);
  assert.equal(plainWords('Add a habit in *seconds*.'), 'Add a habit in seconds.');
  // No stars: Soft and Bold captions highlight the last word, Headline nothing; stars win in every style.
  assert.deepEqual(highlighted('Build better habits', 'soft').map((w) => w.mark), [false, false, true]);
  assert.deepEqual(highlighted('Build better habits', 'punchy').map((w) => w.mark), [false, false, true]);
  assert.deepEqual(highlighted('Build better habits', 'headline').map((w) => w.mark), [false, false, false]);
  assert.deepEqual(highlighted('Build *better* habits', 'soft').map((w) => w.mark), [false, true, false]);
  assert.deepEqual(highlighted('Habits', 'soft').map((w) => w.mark), [false]);
});

test("each words style has its own colours, and the user's own win", () => {
  const noir = backdropFor({ backdrop: 'noir' });
  const bloom = backdropFor({ backdrop: 'bloom' });
  assert.equal(wordColors('headline', noir, {}).ink, '#eed9ac', 'warm cream on black');
  assert.equal(wordColors('punchy', bloom, {}).ink, '#ffffff');
  assert.equal(wordColors('punchy', bloom, {}).highlight, '#ffd319');
  assert.deepEqual(wordColors('soft', noir, { ink: '#123456', accent: '#abcdef' }), { ink: '#123456', highlight: '#abcdef' });
  // Something that isn't a colour is left out.
  assert.equal(wordColors('punchy', bloom, { ink: 'not a colour' }).ink, '#ffffff');
});

test('the Cinematic and Pop promo templates make films of their own look', () => {
  const cinematic = newFilm({ projectId: null, title: 'Habits', template: templateById('cinematic') });
  assert.deepEqual([cinematic.style, cinematic.look.backdrop, cinematic.text.style, cinematic.text.taps], ['cinematic', 'noir', 'headline', false]);
  assert.deepEqual(cinematic.text.card, { on: true, name: '', appStore: true, googlePlay: true, light: true });
  const pop = newFilm({ projectId: null, title: 'Habits', template: templateById('pop') });
  assert.deepEqual([pop.style, pop.look.backdrop, pop.text.style, pop.text.logo, pop.text.card?.light], ['bold', 'bloom', 'punchy', true, false]);
  // A film made before these had no style, no card and no icon: it plays as it did.
  const old = newFilm({ projectId: null, title: 'Habits', template: templateById('launch') });
  assert.equal(old.text.style, undefined);
  assert.equal(old.text.card, undefined);
  assert.equal(endHold(old.text), 1.8);
  assert.ok(FILM_TEMPLATES[0].id === 'cinematic' && FILM_TEMPLATES[1].id === 'pop', 'the new ones first');
});

/** A Cinematic film of one recording with a tap early on, captioned or not. */
function cinematicFilm(extra: Partial<Film> = {}, caption?: string): Film {
  const f = withMoments(film({ style: 'cinematic' }), 0, [
    moment('m1', 'tap', 0.9, 1.3, { x: 0.1, y: 0.3, w: 0.3, h: 0.08 }, { point: { x: 0.25, y: 0.34 } }),
    moment('m2', 'tap', 9, 9.4, { x: 0.55, y: 0.6, w: 0.3, h: 0.1 }, { point: { x: 0.7, y: 0.65 }, ...(caption ? { caption } : {}) }),
    moment('m3', 'type', 14, 15.5, { x: 0.1, y: 0.2, w: 0.7, h: 0.08 }),
  ]);
  return { ...f, ...extra };
}

test('Cinematic opens close on the screen at a steep angle, then pulls back fast to the whole phone', () => {
  const f = cinematicFilm();
  const plan = planFor(f);
  const first = plan.keys[0].pose;
  assert.ok(first.zoom >= 2.8 && Math.abs(first.yaw) >= 30 && (first.lens ?? 22) >= 38, `macro: ${JSON.stringify(first)}`);
  const back = plan.keys.find((k) => k.why === 'pull back')!;
  assert.ok(back, 'a pull-back');
  assert.equal(back.ease, 'whip');
  assert.ok(back.pose.zoom < 0.8, 'to the whole phone, small');
  // The title comes with the pull-back, not over the close-up.
  const title = plan.cues.find((c) => c.role === 'title')!;
  assert.ok(title.start >= back.t - 0.3, `title at ${title.start}, pull-back ends ${back.t}`);
  assert.equal(planFor(film({ style: 'lively' })).cues.find((c) => c.role === 'title')!.start, 0.15);
  // A caption on a moment in the opening waits for the title to finish, and gets time to be read.
  const early = withMoments(film({ style: 'cinematic' }), 0, [moment('m1', 'tap', 1.2, 1.5, undefined, { caption: 'Every habit, *one tap*' })]);
  const cues = planFor(early).cues;
  const t2 = cues.find((c) => c.role === 'title')!;
  const c1 = cues.find((c) => c.role === 'caption')!;
  assert.ok(c1.start >= t2.end - 1e-9 && t2.end - t2.start >= 2.2, JSON.stringify(cues));
  assert.ok(c1.end - c1.start >= 1.2);
});

test('Cinematic close-ups are steep and push in while they hold; wide shots go low only under words', () => {
  const f = cinematicFilm();
  const plan = planFor(f);
  const close = plan.keys.find((k) => k.why?.startsWith('close on'))!;
  assert.ok(close, 'a close-up');
  assert.deepEqual([close.pose.pitch, close.pose.lens], [15, 32]);
  const held = plan.keys.find((k) => k.why === `hold ${close.why!.slice('close on '.length)}`)!;
  assert.ok(held.pose.zoom > close.pose.zoom, 'pushes in while it holds');
  // Out of a close-up with no words to come: the whole phone, not low.
  const out = plan.keys.filter((k) => k.why === 'back out');
  assert.ok(out.length && out.every((k) => k.pose.lift >= 0), JSON.stringify(out.map((k) => k.pose.lift)));
  // A captioned tap gets no close-up: the phone goes big and low, under the words, as they come in.
  const wordedFilm = cinematicFilm({}, 'Streaks that keep you *going*');
  const worded = planFor(wordedFilm);
  assert.ok(!worded.keys.some((k) => k.why?.includes('-m2')), 'no close-up on the captioned tap');
  const caption = worded.cues.find((c) => c.role === 'caption')!;
  const under = worded.keys.find((k) => k.why === 'under words')!;
  assert.ok(under && under.pose.lift <= -0.25 && under.pose.zoom >= 1.2, JSON.stringify(under));
  assert.ok(under.t <= caption.start + 0.5, 'low by the time the words are in');
  // Asked for by the user, the close-up happens anyway.
  const forced = planFor(withMoments(wordedFilm, 0, wordedFilm.clips[0].moments.map((m) => ({ ...m, id: m.id.replace(/^.*-/, ''), shot: m.id.endsWith('m2') ? 'close' : m.shot }))));
  assert.ok(forced.keys.some((k) => k.why?.includes('-m2')));
  // Two early captions wait their turns after the title; a plain tap while the second shows stays wide too.
  const queued = withMoments(film({ style: 'cinematic' }), 0, [
    moment('a', 'tap', 0.9, 1.2, undefined, { caption: 'First words' }),
    moment('b', 'tap', 1.3, 1.6, undefined, { caption: 'Second words' }),
    moment('c', 'tap', 7, 7.3, { x: 0.5, y: 0.6, w: 0.3, h: 0.08 }, { point: { x: 0.6, y: 0.62 } }),
    moment('d', 'tap', 15, 15.3, { x: 0.5, y: 0.6, w: 0.3, h: 0.08 }, { point: { x: 0.6, y: 0.62 } }),
  ]);
  const qp = planFor(queued);
  const words = qp.cues.filter((c) => c.role !== 'end');
  assert.deepEqual(words.map((c) => c.role), ['title', 'caption', 'caption']);
  assert.ok(words[1].start >= words[0].end - 1e-9 && words[2].start >= words[1].end - 1e-9, JSON.stringify(words));
  assert.ok(!qp.keys.some((k) => k.why?.endsWith('-c')), 'no close-up under the words');
  assert.ok(qp.keys.some((k) => k.why?.endsWith('-d')), 'one where no words show');
});

test('Cinematic cuts to the phone side on at a new recording, and spins it in; nothing blurs across the cut', () => {
  const two = addClip(cinematicFilm(), EXPENSES)!.film;
  const plan = planFor(two);
  const cut = cutTimes(two)[0];
  const jump = plan.keys.findIndex((k) => k.why?.startsWith('cut '));
  assert.ok(jump > 0, 'a cut in the camera');
  assert.ok(Math.abs(plan.keys[jump].t - cut) < 0.01 && plan.keys[jump].t - plan.keys[jump - 1].t < 0.002, 'at the cut, at once');
  assert.ok(Math.abs(plan.keys[jump].pose.yaw) >= 75, 'side on');
  const spun = plan.keys[jump + 1];
  assert.equal(spun.why, 'spin in');
  assert.ok(Math.abs(spun.pose.yaw) <= 25 && spun.t - cut <= 0.81);
  assert.ok(jumpsBetween(plan, cut - 0.01, cut + 0.01));
  assert.deepEqual(blurTimes(two, plan, cut, 30), [cut], 'one picture at the cut');
  // A plain Lively film has no jumps.
  assert.equal(jumpsBetween(planFor(addClip(film(), EXPENSES)!.film), 0, 40), false);
});

test('a fast move blurs across half a frame; a held shot is one picture', () => {
  const f = cinematicFilm();
  const plan = planFor(f);
  const back = plan.keys.find((k) => k.why === 'pull back')!;
  const before = plan.keys[plan.keys.indexOf(back) - 1];
  const mid = (before.t + back.t) / 2;
  const times = blurTimes(f, plan, mid, 30);
  assert.ok(times.length >= 4 && times.length <= 8, `${times.length} pictures in the pull-back`);
  assert.ok(Math.abs(times[0] - (mid - 0.25 / 30)) < 1e-9 && Math.abs(times[times.length - 1] - (mid + 0.25 / 30)) < 1e-9, 'half a frame, around the frame');
  // The opening drift is slow: one picture.
  assert.equal(blurTimes(f, plan, 0.3, 30).length, 1);
  assert.equal(pictureTravel(stageFrameAt(f, plan, 5), stageFrameAt(f, plan, 5)), 0);
});

test('an end card makes room: the film holds longer, nothing runs into it, the phone goes under it', () => {
  const on = { on: true, name: '', appStore: true, googlePlay: false, light: false };
  const f = film({ text: { ...film().text, end: 'Download it free', captions: true, card: on } });
  assert.ok(Math.abs(endHold(f.text) - (CARD_SECONDS + 0.2)) < 1e-9);
  const withCaption = withMoments(f, 0, [moment('m1', 'tap', 20.5, 21, undefined, { caption: 'Late words' })]);
  const plan = planFor(withCaption);
  const cardAt = plan.duration - CARD_SECONDS;
  assert.ok(plan.cues.filter((c) => c.role !== 'end').every((c) => c.end <= cardAt + 1e-9), JSON.stringify(plan.cues));
  const end = plan.cues.find((c) => c.role === 'end')!;
  assert.ok(Math.abs(end.start - cardAt) < 1e-9, 'the end words come with the card');
  const last = plan.keys[plan.keys.length - 1].pose;
  assert.ok(last.lift <= -0.5 && last.zoom <= 0.65, 'down and smaller, under the card');
  // The backdrop's discs shrink away as the card comes in, and not before.
  assert.equal(stageFrameAt(f, plan, cardAt - 0.2).backdropOut, undefined);
  assert.equal(stageFrameAt(f, plan, plan.duration).backdropOut, 1);
  // A white card covers the film: the phone ends as it would, and the discs stay.
  const whiteFilm = film({ text: { ...f.text, card: { ...on, light: true } } });
  const white = planFor(whiteFilm);
  assert.ok(white.keys[white.keys.length - 1].pose.lift > -0.2);
  assert.equal(stageFrameAt(whiteFilm, white, white.duration).backdropOut, undefined);
  assert.equal(hasCard({ ...f.text, card: { ...on, on: false } }), false);
});

test('bold captions sit at the bottom and push the phone up to make room', () => {
  assert.equal(wordsSide('vertical', { style: 'punchy' }), 'bottom');
  assert.equal(wordsSide('vertical', { style: 'headline' }), 'top');
  assert.equal(wordsSide('landscape', { style: 'punchy' }), 'left');
  const f = film({ text: { ...film().text, title: 'Habits', style: 'punchy' } });
  const plan = planFor(f);
  const title = plan.cues.find((c) => c.role === 'title')!;
  const at = (title.start + title.end) / 2;
  assert.ok(stageFrameAt(f, plan, at).shift.y > 0, 'up');
  const soft = film({ text: { ...film().text, title: 'Habits' } });
  assert.ok(stageFrameAt(soft, planFor(soft), at).shift.y < 0, 'Soft words at the top push it down');
});

test('a pose mixes its lens too', () => {
  const a = { ...plannedPose({ duration: 1, keys: [], taps: [], cues: [] }, 0), lens: 40 };
  const b = { ...a, lens: undefined };
  assert.equal(mixPose(a, b, 0.5).lens, 31, 'halfway to the long lens');
});

/** A 2D context that keeps a record of what was drawn, enough for the overlay. */
class RecordingContext {
  calls: { op: string; args: unknown[]; alpha: number; font: string; fill: string; transform: number[] }[] = [];
  globalAlpha = 1;
  font = '10px sans-serif';
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  lineWidth = 1;
  lineJoin = 'miter';
  miterLimit = 10;
  textAlign = 'start';
  textBaseline = 'alphabetic';
  shadowColor = 'transparent';
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  imageSmoothingQuality = 'low';
  letterSpacing = '0px';
  private stack: { a: number; f: string; fs: unknown; m: number[]; ta: string }[] = [];
  private matrix = [1, 0, 0, 1, 0, 0];
  private note(op: string, args: unknown[]) {
    this.calls.push({ op, args, alpha: this.globalAlpha, font: this.font, fill: String(this.fillStyle), transform: [...this.matrix] });
  }
  save() {
    this.stack.push({ a: this.globalAlpha, f: this.font, fs: this.fillStyle, m: [...this.matrix], ta: this.textAlign });
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.globalAlpha = s.a;
    this.font = s.f;
    this.fillStyle = s.fs;
    this.matrix = s.m;
    this.textAlign = s.ta;
  }
  measureText(text: string) {
    const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * size * 0.55 };
  }
  translate(x: number, y: number) {
    this.matrix[4] += x;
    this.matrix[5] += y;
  }
  scale(x: number, y: number) {
    this.matrix[0] *= x;
    this.matrix[3] *= y;
  }
  createLinearGradient() {
    return { addColorStop() {} };
  }
  fillText(...args: unknown[]) {
    this.note('fillText', args);
  }
  strokeText(...args: unknown[]) {
    this.note('strokeText', args);
  }
  drawImage(...args: unknown[]) {
    this.note('drawImage', args);
  }
  fillRect(...args: unknown[]) {
    this.note('fillRect', args);
  }
  beginPath() {}
  moveTo() {}
  arcTo() {}
  arc() {}
  closePath() {}
  clip() {}
  fill() {
    this.note('fill', []);
  }
  stroke() {
    this.note('stroke', []);
  }
}

const APPLE = { name: 'apple' } as unknown as CanvasImageSource;
const GOOGLE = { name: 'google' } as unknown as CanvasImageSource;
const ICON = { name: 'icon' } as unknown as CanvasImageSource;

function cardFrame(t: number, extra: Partial<Film['text']> = {}) {
  const ctx = new RecordingContext();
  const text = { title: 'Daily *habits*', end: 'Download it free', captions: false, taps: false, card: { on: true, name: '', appStore: true, googlePlay: true, light: true }, ...extra };
  drawOverlay(ctx as unknown as CanvasRenderingContext2D, 1080, 1920, t, [], 'vertical', backdropFor({ backdrop: 'noir' }), text, 20, { icon: ICON, appStore: APPLE, googlePlay: GOOGLE });
  return ctx;
}

test('the end card shows the store badges as their makers ask: whole, at once, App Store first, the same height, with room round them', () => {
  const from = 20 - CARD_SECONDS;
  assert.equal(cardFrame(from - 0.1).calls.length, 0, 'nothing before the card');
  const early = cardFrame(from + 0.5);
  assert.equal(early.calls.filter((c) => c.op === 'drawImage' && c.args[0] !== ICON).length, 0, 'no badge while the card comes in');
  const badges = (t: number) => cardFrame(t).calls.filter((c) => c.op === 'drawImage' && (c.args[0] === APPLE || c.args[0] === GOOGLE));
  const a = badges(from + 0.8);
  const b = badges(from + 2.2);
  assert.equal(a.length, 2);
  // Never animated: the same place and size at every moment, full strength, no scaling.
  assert.deepEqual(a.map((c) => c.args), b.map((c) => c.args));
  assert.ok(a.every((c) => c.alpha === 1 && c.transform[0] === 1 && c.transform[3] === 1));
  const [apple, google] = a;
  assert.equal(apple.args[0], APPLE, 'App Store first');
  const appleBox = { x: apple.args[1] as number, w: apple.args[3] as number, h: apple.args[4] as number };
  // Google's file has its own clear space round the badge: the badge itself is 564 x 168 of 646 x 250.
  const scale = (google.args[4] as number) / 250;
  const googleBadge = { x: (google.args[1] as number) + 41 * scale, h: 168 * scale };
  assert.ok(Math.abs(googleBadge.h - appleBox.h) < 1e-6, 'the same height');
  assert.ok(googleBadge.x - (appleBox.x + appleBox.w) >= appleBox.h * 0.25, 'a quarter of the height clear between them');
  assert.ok(appleBox.h >= 40, 'at least 40 pixels high');
  // Only the badges asked for.
  assert.equal(cardFrame(from + 1, { card: { on: true, name: '', appStore: true, googlePlay: false, light: true } }).calls.filter((c) => c.args[0] === GOOGLE).length, 0);
});

test('the end card shows the icon, the name without its stars and the end words, on white or over the film', () => {
  const at = 20 - CARD_SECONDS + 1.5;
  const white = cardFrame(at);
  const cover = white.calls.find((c) => c.op === 'fillRect');
  assert.ok(cover && cover.alpha === 1 && cover.fill === '#ffffff', 'a white card, in full by then');
  const words = white.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
  assert.deepEqual(words, ['Daily habits', 'Download it free']);
  assert.ok(white.calls.some((c) => c.op === 'drawImage' && c.args[0] === ICON));
  assert.equal(white.calls.find((c) => c.op === 'fillText')!.fill, '#111214', 'dark on white');
  // Over a light film the name is dark, whatever the words' style; the name typed for the card wins.
  const ctx = new RecordingContext();
  const text = { title: 'Daily habits', end: '', captions: false, taps: false, style: 'punchy' as const, card: { on: true, name: 'Habit Pal', appStore: false, googlePlay: false, light: false } };
  drawOverlay(ctx as unknown as CanvasRenderingContext2D, 1080, 1920, at, [], 'vertical', backdropFor({ backdrop: 'bloom' }), text, 20, null);
  const name = ctx.calls.find((c) => c.op === 'fillText')!;
  assert.equal(name.args[0], 'Habit Pal');
  assert.equal(name.fill, '#121216');
  assert.equal(ctx.calls.filter((c) => c.op === 'fillRect').length, 0, 'no white card');
});

test('bold captions draw capitals, outlined, with the starred words in the highlight', () => {
  const ctx = new RecordingContext();
  const cue = { start: 0, end: 3, text: 'Keep your *streak* alive', role: 'caption' as const };
  drawOverlay(ctx as unknown as CanvasRenderingContext2D, 1080, 1920, 1.5, [cue], 'vertical', backdropFor({ backdrop: 'bloom' }), { title: '', end: '', captions: true, taps: false, style: 'punchy' }, 10, null);
  const filled = ctx.calls.filter((c) => c.op === 'fillText');
  assert.deepEqual(filled.map((c) => c.args[0]), ['KEEP', 'YOUR', 'STREAK', 'ALIVE']);
  assert.deepEqual(filled.map((c) => c.fill), ['#ffffff', '#ffffff', '#ffd319', '#ffffff']);
  assert.equal(ctx.calls.filter((c) => c.op === 'strokeText').length, 4, 'every word outlined');
  // Low in the picture: above the bottom fifth, where the apps put their own buttons.
  assert.ok(filled.every((c) => c.transform[5] > 1920 * 0.6 && c.transform[5] < 1920 * 0.8));
});
