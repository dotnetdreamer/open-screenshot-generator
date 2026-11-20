/**
 * The Limelight camera as numbers: where a camera state puts the lens, how
 * wide it sees, and how a drag in the viewport moves it. Plain maths with no
 * three.js, so the stage, the timeline, the agent's tools and the unit tests
 * share it.
 *
 * The camera orbits its target. Azimuth 0 and elevation 0 stand it on +z
 * looking back at the target, which is how a device with no turn shows its
 * screen.
 */

import type { CameraState, XYZ } from './types';

export const LENS_MIN = 12;
export const LENS_MAX = 300;
export const APERTURE_MIN = 1;
export const APERTURE_MAX = 22;
export const DISTANCE_MIN = 4;
export const DISTANCE_MAX = 3000;
/** Short of straight up or down, where "up" stops meaning anything for the camera. */
export const ELEVATION_LIMIT = 88;

/** The film's short side, in millimetres: a full frame camera's 24. */
const SENSOR_SHORT_SIDE = 24;

const DEG = Math.PI / 180;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The vertical field of view in degrees for a lens on a picture of this
 * shape. The lens is measured across the picture's short side, so 50 mm looks
 * the same across the short side of a tall video as of a wide one.
 */
export function verticalFov(lens: number, aspect: number): number {
  const focal = clamp(lens, LENS_MIN, LENS_MAX);
  const height = aspect >= 1 ? SENSOR_SHORT_SIDE : SENSOR_SHORT_SIDE / aspect;
  return (2 * Math.atan(height / 2 / focal)) / DEG;
}

/** The lens that gives this vertical field of view on a picture of this shape. */
export function lensForFov(fovDegrees: number, aspect: number): number {
  const height = aspect >= 1 ? SENSOR_SHORT_SIDE : SENSOR_SHORT_SIDE / aspect;
  return height / 2 / Math.tan((fovDegrees * DEG) / 2);
}

function add(a: XYZ, b: XYZ): XYZ {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: XYZ, k: number): XYZ {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

function cross(a: XYZ, b: XYZ): XYZ {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(a: XYZ): XYZ {
  const length = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / length, y: a.y / length, z: a.z / length };
}

/** The unit vector from the target toward the camera. */
export function orbitDirection(azimuth: number, elevation: number): XYZ {
  const az = azimuth * DEG;
  const el = clamp(elevation, -ELEVATION_LIMIT, ELEVATION_LIMIT) * DEG;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: Math.cos(az) * Math.cos(el) };
}

export interface CameraPose {
  position: XYZ;
  target: XYZ;
  /** The camera's up, after the roll. */
  up: XYZ;
  /** The camera's right, after the roll. */
  right: XYZ;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Centimetres from the lens to the sharpest plane. */
  focusDistance: number;
}

/** Where the camera stands and which way is up, for a picture of this shape. */
export function cameraPose(state: CameraState, aspect: number): CameraPose {
  const direction = orbitDirection(state.azimuth, state.elevation);
  const distance = clamp(state.distance, DISTANCE_MIN, DISTANCE_MAX);
  const position = add(state.target, scale(direction, distance));
  const forward = scale(direction, -1);
  // The world's up projected off the view direction, then turned by the roll.
  const flatRight = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const flatUp = cross(flatRight, forward);
  const roll = state.roll * DEG;
  // Turning the camera's up toward its left turns the picture clockwise.
  const up = add(scale(flatUp, Math.cos(roll)), scale(flatRight, -Math.sin(roll)));
  const right = add(scale(flatRight, Math.cos(roll)), scale(flatUp, Math.sin(roll)));
  return {
    position,
    target: state.target,
    up: normalize(up),
    right: normalize(right),
    fov: verticalFov(state.lens, aspect),
    focusDistance: Math.max(1, distance + state.focus),
  };
}

/** The angle equal to `angle` that is nearest `reference`, so a new shot turns the short way round. */
export function nearestAngle(angle: number, reference: number): number {
  return angle + 360 * Math.round((reference - angle) / 360);
}

// ---------------------------------------------------------------------------
// Gestures in the viewport
// ---------------------------------------------------------------------------

/** Degrees the camera swings for a drag across the whole viewport's height. */
const ORBIT_DEGREES_PER_HEIGHT = 220;

/**
 * Swings the camera round its target as if the stage were in the hand: drag
 * right and the stage turns to the right, drag down to see it from higher.
 */
export function orbitBy(state: CameraState, dx: number, dy: number, viewportHeight: number): CameraState {
  const k = ORBIT_DEGREES_PER_HEIGHT / Math.max(1, viewportHeight);
  return {
    ...state,
    azimuth: state.azimuth - dx * k,
    elevation: clamp(state.elevation + dy * k, -ELEVATION_LIMIT, ELEVATION_LIMIT),
  };
}

/**
 * Slides the camera and its target sideways together, so the point under the
 * pointer stays under it: the picture moves with the drag.
 */
export function panBy(state: CameraState, dx: number, dy: number, viewportHeight: number, aspect: number): CameraState {
  const pose = cameraPose(state, aspect);
  const visibleHeight = 2 * Math.max(DISTANCE_MIN, state.distance) * Math.tan((pose.fov * DEG) / 2);
  const perPixel = visibleHeight / Math.max(1, viewportHeight);
  const move = add(scale(pose.right, -dx * perPixel), scale(pose.up, dy * perPixel));
  return { ...state, target: add(state.target, move) };
}

/** Moves the camera toward its target (negative steps) or away. One wheel notch is about 100. */
export function dollyBy(state: CameraState, step: number): CameraState {
  return { ...state, distance: clamp(state.distance * Math.exp(step * 0.0015), DISTANCE_MIN, DISTANCE_MAX) };
}

/** Changes the lens and moves the camera so the target keeps its size: the dolly zoom. */
export function dollyZoomTo(state: CameraState, lens: number, aspect: number): CameraState {
  const next = clamp(lens, LENS_MIN, LENS_MAX);
  const before = Math.tan((verticalFov(state.lens, aspect) * DEG) / 2);
  const after = Math.tan((verticalFov(next, aspect) * DEG) / 2);
  return { ...state, lens: next, distance: clamp((state.distance * before) / after, DISTANCE_MIN, DISTANCE_MAX) };
}

/**
 * The distance at which a thing `height` centimetres tall fills `share` of
 * the picture's height, for framing a device when a scene starts.
 */
export function distanceToFrame(height: number, share: number, lens: number, aspect: number): number {
  const half = Math.tan((verticalFov(lens, aspect) * DEG) / 2);
  return clamp(height / share / 2 / half, DISTANCE_MIN, DISTANCE_MAX);
}
