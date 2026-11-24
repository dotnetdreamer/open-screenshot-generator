// A phone's own movement, read in the browser. Safari on iPhone asks the
// person first (DeviceOrientationEvent.requestPermission, which only works
// inside a tap); Chrome on Android gives it to any page served over HTTPS.
// Neither gives it to a page served over plain http, other than localhost.

import { fromDeviceOrientation, relativeTurn, type Quat } from './motion';

export type MotionAccess = 'granted' | 'denied' | 'unsupported' | 'insecure';

type PermissionAsking = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Asks for the phone's movement. Call it from a tap. */
export async function askForMotion(): Promise<MotionAccess> {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  const asking = DeviceOrientationEvent as unknown as PermissionAsking;
  if (typeof asking.requestPermission === 'function') {
    try {
      return (await asking.requestPermission()) === 'granted' ? 'granted' : 'denied';
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

/**
 * The phone's turn since it was centred. `center()` makes the way it's held
 * now the starting point: the phone in the film faces straight ahead when
 * this phone is held that way.
 */
export class PhoneMotion {
  private reference: Quat | null = null;
  private last: Quat | null = null;
  private recentre = true;
  private listener: ((event: DeviceOrientationEvent) => void) | null = null;
  private quietTimer = 0;

  /** Starts reading. `onReading` gets the turn and the time in seconds. `onNoSensor` runs when no reading comes. */
  start(onReading: (q: Quat, t: number) => void, onNoSensor?: () => void): void {
    this.stop();
    let heard = false;
    this.listener = (event) => {
      if (event.alpha === null || event.beta === null || event.gamma === null) return;
      heard = true;
      const now = fromDeviceOrientation(event.alpha, event.beta, event.gamma, screenAngle());
      this.last = now;
      if (this.recentre || !this.reference) {
        this.reference = now;
        this.recentre = false;
      }
      onReading(relativeTurn(this.reference, now), performance.now() / 1000);
    };
    window.addEventListener('deviceorientation', this.listener);
    // A computer with no motion sensor sends nothing, or one event with no values.
    this.quietTimer = window.setTimeout(() => {
      if (!heard) onNoSensor?.();
    }, 1500);
  }

  center(): void {
    if (this.last) this.reference = this.last;
    else this.recentre = true;
  }

  stop(): void {
    clearTimeout(this.quietTimer);
    if (this.listener) window.removeEventListener('deviceorientation', this.listener);
    this.listener = null;
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
