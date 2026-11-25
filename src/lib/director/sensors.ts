// A phone's own movement, read in the browser: its turn (deviceorientation)
// and how far it moved toward or away from the person (devicemotion, see
// depth.ts). Safari on iPhone asks the person first (requestPermission, which
// only works inside a tap); Chrome on Android gives it to any page served
// over HTTPS. Neither gives it to a page served over plain http, other than
// localhost.

import { DepthTracker } from './depth';
import { fromDeviceOrientation, relativeTurn, type Quat } from './motion';

export type MotionAccess = 'granted' | 'denied' | 'unsupported' | 'insecure';

type PermissionAsking = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Asks for the phone's movement. Call it from a tap. */
export async function askForMotion(): Promise<MotionAccess> {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  const asking = DeviceOrientationEvent as unknown as PermissionAsking;
  const motion = (typeof DeviceMotionEvent !== 'undefined' ? DeviceMotionEvent : undefined) as unknown as PermissionAsking | undefined;
  if (typeof asking.requestPermission === 'function') {
    try {
      // Both asked in the same tap; Safari shows one question for the two.
      const [turn] = await Promise.all([asking.requestPermission(), motion?.requestPermission?.().catch(() => 'denied' as const)]);
      return turn === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  return 'granted';
}

function screenAngle(): number {
  const angle = typeof screen !== 'undefined' ? screen.orientation?.angle : undefined;
  if (typeof angle === 'number') return angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

/** Gravity as the accelerometer feels it, 9.81 m/s². */
const GRAVITY = 9.81;
/** A distance that changed by more than this goes out without waiting for a turn. Metres. */
const MOVED = 0.001;
/** Readings go out at most this often. Milliseconds. */
const READING_GAP_MS = 15;

/**
 * Which way a phone's accelerometer counts: +1 as the standard says, -1 when
 * its signs are the other way round (Safari on iPhone reads -9.81 lying flat
 * face up, where the standard and Chrome on Android read +9.81). Worked out
 * from the readings themselves: at rest they point up, and the phone's own
 * orientation says where up is.
 */
export class AxisSense {
  private votes = 0;

  /** One reading at rest: gravity included (m/s²), and the orientation's beta and gamma in degrees. */
  vote(gravity: { x: number; y: number; z: number }, beta: number, gamma: number): void {
    const b = (beta * Math.PI) / 180;
    const g = (gamma * Math.PI) / 180;
    const up = { x: -Math.cos(b) * Math.sin(g), y: Math.sin(b), z: Math.cos(b) * Math.cos(g) };
    const size = Math.hypot(gravity.x, gravity.y, gravity.z);
    // Only readings where the phone isn't moving much say where up is.
    if (Math.abs(size - GRAVITY) > 1.5) return;
    const along = (gravity.x * up.x + gravity.y * up.y + gravity.z * up.z) / size;
    if (Math.abs(along) < 0.5) return;
    this.votes = Math.max(-20, Math.min(20, this.votes + Math.sign(along)));
  }

  /** +1, -1, or 0 while it isn't known yet. */
  get sign(): number {
    return Math.abs(this.votes) >= 5 ? Math.sign(this.votes) : 0;
  }
}

/**
 * The phone's turn since it was centred, and how far it moved toward the
 * person since then. `center()` makes the way it's held now the starting
 * point: the phone in the film faces straight ahead, at its planned
 * distance, when this phone is held that way.
 */
export class PhoneMotion {
  private reference: Quat | null = null;
  private last: Quat | null = null;
  private recentre = true;
  private listener: ((event: DeviceOrientationEvent) => void) | null = null;
  private motionListener: ((event: DeviceMotionEvent) => void) | null = null;
  private quietTimer = 0;
  private readonly depth = new DepthTracker();
  private readonly sense = new AxisSense();
  private beta = 90;
  private gamma = 0;
  /** Gravity, followed slowly, for phones that only give acceleration with gravity in it. */
  private gravity: { x: number; y: number; z: number } | null = null;
  private onReading: ((q: Quat, t: number, depth: number) => void) | null = null;
  /** When the last reading went out, on the events' clock (ms), and the distance it had. */
  private sentAt = -Infinity;
  private sentDepth = 0;

  /**
   * Starts reading. `onReading` gets the turn, the time in seconds, and the
   * distance moved toward the person in metres. `onNoSensor` runs when no reading comes.
   */
  start(onReading: (q: Quat, t: number, depth: number) => void, onNoSensor?: () => void): void {
    this.stop();
    this.onReading = onReading;
    let heard = false;
    this.listener = (event) => {
      if (event.alpha === null || event.beta === null || event.gamma === null) return;
      heard = true;
      this.beta = event.beta;
      this.gamma = event.gamma;
      const now = fromDeviceOrientation(event.alpha, event.beta, event.gamma, screenAngle());
      this.last = now;
      if (this.recentre || !this.reference) {
        this.reference = now;
        this.recentre = false;
      }
      this.send(event.timeStamp);
    };
    this.motionListener = (event) => this.onMotion(event);
    window.addEventListener('deviceorientation', this.listener);
    window.addEventListener('devicemotion', this.motionListener);
    // A computer with no motion sensor sends nothing, or one event with no values.
    this.quietTimer = window.setTimeout(() => {
      if (!heard) onNoSensor?.();
    }, 1500);
  }

  private onMotion(event: DeviceMotionEvent) {
    const withGravity = event.accelerationIncludingGravity;
    const t = event.timeStamp / 1000;
    if (withGravity && withGravity.x !== null && withGravity.y !== null && withGravity.z !== null) {
      const g = { x: withGravity.x, y: withGravity.y, z: withGravity.z };
      this.sense.vote(g, this.beta, this.gamma);
      // Gravity followed over about half a second, for phones without acceleration on its own.
      this.gravity = this.gravity
        ? { x: this.gravity.x + (g.x - this.gravity.x) * 0.06, y: this.gravity.y + (g.y - this.gravity.y) * 0.06, z: this.gravity.z + (g.z - this.gravity.z) * 0.06 }
        : g;
    }
    const sign = this.sense.sign;
    if (!sign) return;
    const own = event.acceleration;
    let toward: number | null = own && own.z !== null ? own.z : null;
    if (toward === null && withGravity && withGravity.z !== null && this.gravity) toward = withGravity.z - this.gravity.z;
    if (toward === null) return;
    const rate = event.rotationRate;
    const turning = rate ? Math.hypot(rate.alpha ?? 0, rate.beta ?? 0, rate.gamma ?? 0) : 0;
    this.depth.push(t, sign * toward, turning);
    // A browser sends the turn only when the angle changes, so a straight push
    // with the phone held steady would wait for the next tilt and then jump:
    // the distance goes out from here too, once it has moved.
    if (Math.abs(this.depth.value - this.sentDepth) > MOVED && event.timeStamp - this.sentAt >= READING_GAP_MS) this.send(event.timeStamp);
  }

  /** The turn and the distance as they are now, to the listener. */
  private send(at: number) {
    if (!this.onReading || !this.reference || !this.last) return;
    this.sentAt = at;
    this.sentDepth = this.depth.value;
    this.onReading(relativeTurn(this.reference, this.last), performance.now() / 1000, this.sentDepth);
  }

  /** The distance moved toward the person since Center, in metres. */
  get distance(): number {
    return this.depth.value;
  }

  center(): void {
    if (this.last) this.reference = this.last;
    else this.recentre = true;
    this.depth.reset();
  }

  /** Where the phone is now becomes the start for forward and back only, as when it's turned on. */
  restartDepth(): void {
    this.depth.reset();
  }

  stop(): void {
    clearTimeout(this.quietTimer);
    if (this.listener) window.removeEventListener('deviceorientation', this.listener);
    if (this.motionListener) window.removeEventListener('devicemotion', this.motionListener);
    this.listener = null;
    this.motionListener = null;
    this.onReading = null;
  }
}

type WakeLockSentinelLike = { release: () => Promise<void> };

/** Keeps the screen on while a phone is used to move the film. Returns the way to let it go. */
export async function keepScreenOn(): Promise<() => void> {
  const lock = (navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
  if (!lock) return () => undefined;
  try {
    const sentinel = await lock.request('screen');
    return () => void sentinel.release().catch(() => undefined);
  } catch {
    return () => undefined;
  }
}
