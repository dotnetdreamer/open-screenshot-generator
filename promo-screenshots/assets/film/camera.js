// One unbroken camera move, as a pure function of time: camAt(t) returns the
// position, yaw, pitch, roll and field of view. Built on the bar grid in
// timing.js and the reference's measured moves (SPEC.md).
import { BAR0, PAN, SCREENS, SHOT, bar } from "./timing.js";
import { CAM, R, a, polar, SLATE } from "./world.js";
import { clamp, mix, inOutSine, inOutCubic, outCubic } from "./kit.js";

const inOutQuart = (t) => {
  const x = clamp(t);
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
};

// Small per-screen differences so the truck reads as operated, not on rails.
const LIFT = [0, 0.08, -0.06, 0.1, 0.02, -0.08, 0.06, -0.02, 0.1, -0.05, 0.04, 0.09, -0.07, 0.03, -0.04, 0.05];
/** Pans that run a little long and settle back, like the reference's operator (in DELTA). */
const OVERSHOOT = { 3: 0.05, 7: 0.045, 8: 0.04, 11: 0.05, 14: 0.035 };

/** The framing of screen i: yaw faces the screen, pitch looks a touch up at it. */
function hold(i) {
  const ang = a(i);
  const r = R - CAM.dist;
  const y = CAM.y + LIFT[i];
  const pitch = Math.atan2(CAM.lookY + LIFT[i] * 0.5 - y, CAM.dist);
  return { ang, r, y, pitch };
}

/** Yaw that looks outward along polar angle ang (three.js cameras look down -Z). */
const outward = (ang) => ang + Math.PI;

function handheld(t, k = 1) {
  const yaw = 0.0026 * Math.sin(2 * Math.PI * 0.31 * t) + 0.0012 * Math.sin(2 * Math.PI * 0.73 * t + 1.3);
  const pitch = 0.0018 * Math.sin(2 * Math.PI * 0.27 * t + 2.1) + 0.0009 * Math.sin(2 * Math.PI * 0.61 * t + 0.4);
  const roll = 0.0012 * Math.sin(2 * Math.PI * 0.23 * t + 0.7);
  return { yaw: yaw * k, pitch: pitch * k, roll: roll * k };
}

// The wide shot looks across the ring from behind the slate, towards the screens
// opposite the last one; the end card faces the slate square on.
const WIDE_ANG = a(SCREENS - 1); // the camera's polar angle in the wide shot (its back to screen 16)
// The wide is an establishing shot like the reference's: high up by the truss, the
// slate about a fifth of the frame wide, four screens across the far side.
const WIDE = { r: 7.9, y: 5.9, pitch: -0.36, fov: 56 };
// The push holds the wide a while (the reference's slate only fills the frame in
// the last half second before the clap); the end card frames the slate the way
// the reference does: clapper near the top, about 80% of the width, the pill under it.
const PUSHED = { r: 6.1, y: 4.9, pitch: -0.33, fov: 54, orbit: 0.06 };
const END = { r: 2.6, y: SLATE.y - 0.04, pitch: 0.0, fov: 50 };

function truck(t) {
  // Crane up from the easel to the first screen on the pickup.
  if (t < BAR0) {
    const h = hold(0);
    const u = inOutCubic(t / BAR0);
    // frame 0 is the thumbnail: the easel close, the first screen lit above it
    return {
      ang: 0,
      r: mix(R - 4.7, h.r, u),
      y: mix(1.25, h.y, u),
      pitch: mix(0.2, h.pitch, u),
    };
  }
  let i = 0;
  while (i + 1 < SCREENS && t >= bar(i + 1)) i++;
  const h = hold(i);
  if (i === 0) return h;
  const prev = hold(i - 1);
  const u = clamp((t - bar(i)) / PAN);
  const o = (OVERSHOOT[i] || 0) * (a(1) - a(0));
  let ang;
  if (u < 1) ang = mix(prev.ang, h.ang + o, inOutSine(u));
  else ang = h.ang + o * (1 - inOutSine(clamp((t - bar(i) - PAN) / 0.5)));
  const e = inOutSine(u);
  return { ang, r: h.r, y: mix(prev.y, h.y, e), pitch: mix(prev.pitch, h.pitch, e) };
}

export function camAt(t) {
  let pos, yaw, pitch, roll = 0, fov = CAM.fov, hk = 1;
  if (t < SHOT.WHIP) {
    const s = truck(t);
    pos = polar(s.r, s.ang, s.y);
    yaw = outward(s.ang);
    pitch = s.pitch;
  } else if (t < SHOT.WIDE) {
    // Whip: a fast 180 degree turn to the left while craning up and back.
    const s = hold(SCREENS - 1);
    const u = clamp((t - SHOT.WHIP) / (SHOT.WIDE - SHOT.WHIP));
    const e = inOutQuart(u);
    const r = mix(s.r, WIDE.r, e);
    pos = polar(r, WIDE_ANG, mix(s.y, WIDE.y, inOutCubic(u)));
    yaw = outward(s.ang) + Math.PI * e; // turning left
    pitch = mix(s.pitch, WIDE.pitch, inOutCubic(u));
    fov = mix(CAM.fov, WIDE.fov, e);
    hk = 1 - Math.sin(Math.PI * u);
  } else if (t < SHOT.APPROACH) {
    const u = clamp((t - SHOT.WIDE) / (SHOT.APPROACH - SHOT.WIDE));
    const e = inOutSine(u);
    const ang = WIDE_ANG + PUSHED.orbit * e;
    pos = polar(mix(WIDE.r, PUSHED.r, e), ang, mix(WIDE.y, PUSHED.y, e));
    yaw = outward(ang) + Math.PI;
    pitch = mix(WIDE.pitch, PUSHED.pitch, e);
    fov = mix(WIDE.fov, PUSHED.fov, e);
  } else {
    const u = clamp((t - SHOT.APPROACH) / (SHOT.CLAP - SHOT.APPROACH));
    const e = inOutCubic(u);
    const ang = WIDE_ANG + PUSHED.orbit * (1 - outCubic(u));
    pos = polar(mix(PUSHED.r, END.r, e), ang, mix(PUSHED.y, END.y, e));
    yaw = outward(ang) + Math.PI;
    pitch = mix(PUSHED.pitch, END.pitch, e);
    fov = mix(PUSHED.fov, END.fov, e);
    hk = 1 - e;
    // The clap: a two frame knock, then dead still.
    const c = t - SHOT.CLAP;
    if (c > 0 && c < 0.12) {
      const k = Math.sin((c / 0.12) * Math.PI * 3) * (1 - c / 0.12);
      pos = [pos[0], pos[1] - 0.006 * k, pos[2]];
      roll = 0.0025 * k;
    }
  }
  const hh = handheld(t, hk);
  return { pos, yaw: yaw + hh.yaw, pitch: pitch + hh.pitch, roll: roll + hh.roll, fov };
}

/** How fast the picture moves at t (radians of view a second, roughly), for the motion blur budget. */
export function camSpeed(t) {
  const d = 1 / 240;
  const c0 = camAt(t - d);
  const c1 = camAt(t + d);
  const dp = Math.hypot(c1.pos[0] - c0.pos[0], c1.pos[1] - c0.pos[1], c1.pos[2] - c0.pos[2]);
  return (Math.abs(c1.yaw - c0.yaw) + Math.abs(c1.pitch - c0.pitch) + dp * 0.25) / (2 * d);
}
