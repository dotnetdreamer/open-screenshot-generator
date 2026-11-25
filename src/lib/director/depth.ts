// How far a phone has moved toward or away from the person holding it, from
// its accelerometer alone: no camera, no app. Bring the phone toward you and
// the phone in the film comes toward the camera; take it away and it goes back.
//
// Acceleration along the screen's axis (out of the screen, toward the face)
// is added up into a speed, and the speed into a distance. Adding up drifts,
// so the speed is set back to zero whenever the phone is still (a push always
// ends at rest), what the sensor reads at rest is learned and taken off, tiny
// readings are ignored as noise, and nothing is added while the phone turns
// fast, since a turn shakes the sensor too. A push and its stop then leave the
// distance where the hand left it, and holding still keeps it there.

/** Below this the reading is noise. m/s². */
const NOISE = 0.08;
/** Below this, with little turning, the phone counts as still. m/s². */
const STILL = 0.25;
/** Still this long and the speed goes to zero. Seconds. */
const STILL_FOR = 0.08;
/** Turning faster than this, a reading is the turn's, not a push. Degrees a second. */
const TURNING = 90;
/** The farthest the phone counts, either way. Metres. */
const REACH = 0.4;
/** How strongly distance becomes zoom: 20 cm closer is about 1.6 times. Per metre. */
const ZOOM_PER_METRE = 2.3;

export class DepthTracker {
  private speed = 0;
  private distance = 0;
  private bias = 0;
  private stillFor = 0;
  private last = -1;

  /**
   * One reading: `t` in seconds, `toward` the acceleration out of the screen
   * (toward the person) in m/s², `turning` how fast the phone turns in
   * degrees a second. Returns the distance moved toward the person, in metres.
   */
  push(t: number, toward: number, turning: number): number {
    const dt = this.last < 0 ? 0 : Math.min(0.05, Math.max(0, t - this.last));
    this.last = t;
    if (!Number.isFinite(toward)) return this.distance;
    const restful = Math.abs(toward - this.bias) < STILL && turning < 20;
    // At rest the sensor still reads a little: learn it, over about two seconds.
    if (restful) this.bias += (toward - this.bias) * Math.min(1, dt / 2);
    let a = toward - this.bias;
    if (Math.abs(a) < NOISE) a = 0;
    if (turning > TURNING) {
      a = 0;
      this.speed *= Math.exp(-dt / 0.15);
    }
    this.speed += a * dt;
    this.stillFor = Math.abs(a) < STILL ? this.stillFor + dt : 0;
    if (this.stillFor > STILL_FOR) this.speed *= Math.exp(-dt / 0.02);
    // A slow leak takes care of what's left.
    this.speed *= Math.exp(-dt / 4);
    this.distance = Math.min(REACH, Math.max(-REACH, this.distance + this.speed * dt));
    return this.distance;
  }

  get value(): number {
    return this.distance;
  }

  /** Where the phone is now becomes the start: as Center does for the turn. */
  reset(): void {
    this.speed = 0;
    this.distance = 0;
    this.stillFor = 0;
  }
}

/** The zoom a distance gives: 1 at the start, more when the phone came closer. */
export function depthZoom(distance: number): number {
  return Math.min(2.5, Math.max(0.6, Math.exp(distance * ZOOM_PER_METRE)));
}
