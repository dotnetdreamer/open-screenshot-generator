// A phone held in the hand, as a turn the 3D phone copies. Pure maths on
// quaternions [x, y, z, w], so it can be tested without a phone.
//
// The browser reports a phone's orientation as three angles (the
// deviceorientation event): alpha about z, then beta about x, then gamma about
// y, in the phone's own axes (x to the right of the screen, y up it, z out of
// it towards the face). The 3D phone uses the same axes, facing the camera, so
// the turn from where the phone was held at the start, taken in the phone's
// own axes, turns the 3D phone the same way: tip the top away from you and the
// 3D phone tips its top away from the viewer.

import type { MotionSample } from './types';

export type Quat = [number, number, number, number];

export const IDENTITY: Quat = [0, 0, 0, 1];
const DEG = Math.PI / 180;

export function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function conjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function normalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

function axisAngle(x: number, y: number, z: number, radians: number): Quat {
  const s = Math.sin(radians / 2);
  return [x * s, y * s, z * s, Math.cos(radians / 2)];
}

/**
 * A phone's orientation from the deviceorientation angles, in degrees. The
 * screen's own turn (a phone held sideways, `screenAngle` 90 or 270) is taken
 * out, so the axes stay the screen's.
 */
export function fromDeviceOrientation(alpha: number, beta: number, gamma: number, screenAngle = 0): Quat {
  const q = multiply(multiply(axisAngle(0, 0, 1, alpha * DEG), axisAngle(1, 0, 0, beta * DEG)), axisAngle(0, 1, 0, gamma * DEG));
  return normalize(multiply(q, axisAngle(0, 0, 1, -screenAngle * DEG)));
}

/** The turn from `reference` to `now`, in the reference's own axes. */
export function relativeTurn(reference: Quat, now: Quat): Quat {
  const q = normalize(multiply(conjugate(reference), now));
  // The same turn either way round; keep the short one.
  return q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
}

export function slerp(a: Quat, b: Quat, u: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cos > 0.9995) {
    return normalize([a[0] + (bx - a[0]) * u, a[1] + (by - a[1]) * u, a[2] + (bz - a[2]) * u, a[3] + (bw - a[3]) * u]);
  }
  const theta = Math.acos(Math.min(1, cos));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - u) * theta) / sin;
  const wb = Math.sin(u * theta) / sin;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** The angle of a turn, in degrees. */
export function angleOf(q: Quat): number {
  return (2 * Math.acos(Math.min(1, Math.abs(q[3])))) / DEG;
}

/**
 * The same turn made `strength` times as big about the same axis: 0.5 halves
 * every movement, 1.5 makes it half as big again. Never past `maxDegrees`:
 * further round, the picture shows the phone's side more than its screen.
 */
export function scaleTurn(q: Quat, strength: number, maxDegrees = 60): Quat {
  const n = normalize(q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q);
  const half = Math.acos(Math.min(1, n[3]));
  const s = Math.sin(half);
  if (s < 1e-6) return IDENTITY;
  const angle = Math.min(2 * half * strength, maxDegrees * DEG);
  return axisAngle(n[0] / s, n[1] / s, n[2] / s, angle);
}

/** Yaw, pitch and roll in degrees (the 3D Studio's order: roll, then pitch, then yaw) for a turn. */
export function toYawPitchRoll(q: Quat): { yaw: number; pitch: number; roll: number } {
  const [x, y, z, w] = q;
  // Matrix entries of the rotation, for the ZXY order.
  const m21 = 2 * (y * z + w * x);
  const m20 = 2 * (x * z - w * y);
  const m22 = 1 - 2 * (x * x + y * y);
  const m01 = 2 * (x * y - w * z);
  const m11 = 1 - 2 * (x * x + z * z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, m21)));
  let yaw: number;
  let roll: number;
  if (Math.abs(m21) < 0.9999) {
    yaw = Math.atan2(-m20, m22);
    roll = Math.atan2(-m01, m11);
  } else {
    yaw = 0;
    roll = Math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z));
  }
  return { yaw: yaw / DEG, pitch: pitch / DEG, roll: roll / DEG };
}

/** The quaternion for yaw, pitch and roll in degrees, in the same order. */
export function fromYawPitchRoll(yaw: number, pitch: number, roll: number): Quat {
  return normalize(multiply(multiply(axisAngle(0, 0, 1, roll * DEG), axisAngle(1, 0, 0, pitch * DEG)), axisAngle(0, 1, 0, yaw * DEG)));
}

// ---------------------------------------------------------------------------
// Smoothing: the "one euro" filter (Casiez, Roussel and Vogel, CHI 2012).
// Slow movements are smoothed hard, which takes out the shake of a hand;
// fast ones barely, so a deliberate turn isn't late.
// ---------------------------------------------------------------------------

export interface SmoothingOptions {
  /** Hz. Lower takes out more shake when the phone is nearly still. */
  minCutoff: number;
  /** How quickly the smoothing lets go as the phone turns faster. */
  speedUp: number;
}

export const STEADY: SmoothingOptions = { minCutoff: 0.6, speedUp: 0.012 };

function alphaFor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** A live filter: feed it readings as they come, it returns the steadied turn. */
export class TurnFilter {
  private last: Quat | null = null;
  private lastT = 0;
  private speed = 0;

  constructor(private readonly options: SmoothingOptions = STEADY) {}

  reset(): void {
    this.last = null;
    this.speed = 0;
  }

  /** `t` in seconds. */
  push(q: Quat, t: number): Quat {
    if (!this.last) {
      this.last = q;
      this.lastT = t;
      return q;
    }
    const dt = Math.max(1 / 240, t - this.lastT);
    this.lastT = t;
    const step = angleOf(relativeTurn(this.last, q)) / dt;
    this.speed += (step - this.speed) * alphaFor(1, dt);
    const cutoff = this.options.minCutoff + this.options.speedUp * Math.abs(this.speed);
    this.last = slerp(this.last, q, alphaFor(cutoff, dt));
    return this.last;
  }
}

/** A take's readings steadied the same way, all at once. */
export function steadySamples(samples: MotionSample[], options: SmoothingOptions = STEADY): MotionSample[] {
  const filter = new TurnFilter(options);
  return samples.map((s) => ({ ...s, q: filter.push(s.q, s.t) }));
}

/** The take's turn at film time `t`, between the readings either side. */
export function takeAt(samples: MotionSample[], t: number): { q: Quat; zoom: number } | null {
  if (samples.length === 0) return null;
  if (t <= samples[0].t) return { q: samples[0].q, zoom: samples[0].zoom ?? 1 };
  const last = samples[samples.length - 1];
  if (t >= last.t) return { q: last.q, zoom: last.zoom ?? 1 };
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const za = a.zoom ?? 1;
  const zb = b.zoom ?? 1;
  return { q: slerp(a.q, b.q, u), zoom: za + (zb - za) * u };
}

/**
 * Readings at most `rate` a second, rounded, for storing a take: four
 * decimals of a quaternion is under a hundredth of a degree.
 */
export function compactSamples(samples: MotionSample[], rate = 60): MotionSample[] {
  const out: MotionSample[] = [];
  let next = -Infinity;
  for (const s of samples) {
    if (s.t < next) continue;
    next = s.t + 1 / rate - 1e-6;
    const q = s.q.map((v) => Math.round(v * 1e4) / 1e4) as Quat;
    out.push(s.zoom !== undefined ? { t: Math.round(s.t * 1000) / 1000, q, zoom: Math.round(s.zoom * 1000) / 1000 } : { t: Math.round(s.t * 1000) / 1000, q });
  }
  return out;
}
