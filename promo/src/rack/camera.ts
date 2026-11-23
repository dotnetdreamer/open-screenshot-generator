import {
  FLOOR_Y, G, RACK_W, ROW0, SHOT, beat, clamp, colX, inOutCubic, landFrame, mix, rowY, slotOf,
} from "./style";

/**
 * The camera. A key says where the camera looks (x, y on the rack face), how
 * big the rack is on screen there (s = perspective / distance) and how it is
 * turned: yaw > 0 looks from the left, pitch > 0 looks up from below, roll
 * tilts the frame. Inside a shot the camera glides through its keys on a
 * Catmull-Rom curve; shots change on hard cuts, and the pull back is its own
 * fast move.
 */

export const PERSPECTIVE = 1500;

export type Cam = { x: number; y: number; s: number; yaw: number; pitch: number; roll: number };
type Key = Cam & { f: number };

const keyFor = (k: number, cam: Omit<Cam, "y"> & { y: (row: number) => number }): Key => {
  const { row } = slotOf(k);
  return { ...cam, f: landFrame(k) + 6, y: cam.y(row) };
};

const CUT2 = beat(SHOT.COL2);
const CUT3 = beat(SHOT.COL3);
const PULL = beat(SHOT.PULL);
const WIDE = beat(SHOT.WIDE);
const END = beat(SHOT.END);

const WIDE_CAM: Cam = { x: RACK_W / 2, y: FLOOR_Y / 2 + 10, s: 0.33, yaw: 0, pitch: 2, roll: 0 };

/** Column one, top to bottom, seen from the left. */
const SHOT_A: Key[] = [
  // the terminal in the top half of the frame, the empty first slot under it
  { f: 0, x: G.WOOD + G.SIDE + 640, y: ROW0 + 110, s: 0.98, yaw: 14, pitch: 6, roll: -2.6 },
  ...[0, 1, 2, 3, 4, 5].map((k) =>
    keyFor(k, {
      x: colX(0) + G.MW / 2 + 30,
      y: (row) => rowY(row) + (row === 0 ? 0.24 : 0.08) * G.MH,
      s: 1.04,
      yaw: 11 - k * 0.6,
      pitch: 5 - k * 2.2,
      roll: -2.5,
    }),
  ),
  { f: CUT2, x: colX(0) + G.MW / 2 + 60, y: rowY(5) + 0.48 * G.MH, s: 0.98, yaw: 8, pitch: -7, roll: -2.2 },
];

/** Column two, bottom to top, nearly square on. */
const SHOT_B: Key[] = [
  { f: CUT2, x: colX(1) + G.MW / 2 - 10, y: rowY(5) + 0.6 * G.MH, s: 1.0, yaw: -3, pitch: -6, roll: -3 },
  ...[6, 7, 8, 9, 10, 11].map((k, i) =>
    keyFor(k, {
      x: colX(1) + G.MW / 2 - 20 + i * 4,
      y: (row) => rowY(row) + 0.9 * G.MH + G.RAIL / 2,
      s: 1.05,
      yaw: -3 + i * 0.5,
      pitch: -6 + i * 1.8,
      roll: -2.8 + i * 0.25,
    }),
  ),
  { f: CUT3, x: colX(1) + G.MW / 2, y: rowY(0) + 0.25 * G.MH, s: 1.02, yaw: 0, pitch: 4, roll: -1.5 },
];

/** Column three, top to bottom, seen from the right. */
const SHOT_C: Key[] = [
  // the counter and the coral knob at the top of the frame, the first slot under them
  { f: CUT3, x: colX(2) + G.MW / 2 + 60, y: ROW0 + 60, s: 1.0, yaw: -12, pitch: 6, roll: 2.2 },
  ...[12, 13, 14, 15, 16, 17].map((k, i) =>
    keyFor(k, {
      x: colX(2) + G.MW / 2 - 20,
      y: (row) => rowY(row) + (row === 0 ? 0.2 : 0.08) * G.MH,
      s: 1.05,
      yaw: -11 + i * 0.6,
      pitch: 4 - i * 1.9,
      roll: 2.2,
    }),
  ),
  { f: PULL, x: colX(2) + G.MW / 2 - 30, y: rowY(5) + 0.3 * G.MH, s: 1.1, yaw: -8, pitch: -6, roll: 1.8 },
];

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

const FIELDS: (keyof Cam)[] = ["x", "y", "s", "yaw", "pitch", "roll"];

const along = (keys: Key[], f: number): Cam => {
  if (f <= keys[0].f) return keys[0];
  const last = keys[keys.length - 1];
  if (f >= last.f) return last;
  let i = 0;
  while (keys[i + 1].f < f) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const t = (f - k1.f) / (k2.f - k1.f);
  const out = {} as Cam;
  for (const n of FIELDS) out[n] = catmull(k0[n], k1[n], k2[n], k3[n], t);
  return out;
};

const lerpCam = (a: Cam, b: Cam, t: number): Cam => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  // zoom moves evenly in log scale, so the pull reads as one steady move
  s: Math.exp(mix(Math.log(a.s), Math.log(b.s), t)),
  yaw: mix(a.yaw, b.yaw, t),
  pitch: mix(a.pitch, b.pitch, t),
  roll: mix(a.roll, b.roll, t),
});

/** The pull back: a fast, smooth move from the last module to the whole rack. */
const pullEase = (t: number) => inOutCubic(t);

const base = (f: number): Cam => {
  if (f < CUT2) return along(SHOT_A, f);
  if (f < CUT3) return along(SHOT_B, f);
  if (f < PULL) return along(SHOT_C, f);
  if (f < WIDE) return lerpCam(SHOT_C[SHOT_C.length - 1], WIDE_CAM, pullEase((f - PULL) / (WIDE - PULL)));
  // the whole rack, pushing in slowly until the end
  const t = clamp((f - WIDE) / (END - WIDE));
  return { ...WIDE_CAM, s: WIDE_CAM.s * (1 + 0.07 * inOutCubic(t)), yaw: 1.5 * t, pitch: 2 - 1.5 * t };
};

/** A small damped jolt each time a module lands. */
const jolt = (f: number) => {
  let y = 0;
  for (let k = 0; k < 18; k++) {
    const t = f - landFrame(k);
    if (t >= 0 && t < 24) y += Math.exp(-t / 5) * Math.sin(t * 0.95) * 3.2;
  }
  return y;
};

export const cameraAt = (f: number): Cam => {
  const c = base(f);
  const wide = f >= PULL;
  const hand = wide ? 0.4 : 1;
  return {
    ...c,
    x: c.x + hand * (5 * Math.sin(f / 57) + 2.5 * Math.sin(f / 23.3)) / c.s,
    y: c.y + (hand * (4 * Math.sin(f / 49 + 1) + 2 * Math.sin(f / 17.7)) + (wide ? 0 : jolt(f))) / c.s,
    roll: c.roll + hand * 0.25 * Math.sin(f / 83),
  };
};

export const cameraTransform = (c: Cam) =>
  `translateZ(${PERSPECTIVE - PERSPECTIVE / c.s}px) rotateZ(${c.roll}deg) rotateX(${c.pitch}deg) rotateY(${c.yaw}deg) translate3d(${-c.x}px, ${-c.y}px, 0px)`;
