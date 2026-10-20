/**
 * The 3D Studio device: a phone the user turns to any angle on the canvas.
 *
 * Plain maths with no three.js, so the palette, the Properties panel, the
 * canvas handle, MCP and the unit tests can all use it without loading WebGL.
 * The phones themselves are measured models (device3dModels.ts) and their
 * shapes come from device3dGeometry.ts; the renderer
 * (elements/DeviceStudioRenderer.tsx) builds from the same model and frames
 * its camera with the projection here, which is what lets the element box hug
 * the device exactly.
 *
 * Two things hold, and tests/unit/device3dStudio.test.ts checks both:
 *
 *  1. Turning the device never changes its size on screen. The camera sits at
 *     a fixed distance, and after a turn the box is fitted round the new
 *     silhouette at the scale it already had (rehugStudioBox), with the device
 *     centre left where it was.
 *  2. A look named after a pose preset is that pose. The angles come from the
 *     table the posed devices use (device3dPoseAngles.ts) and compose in the
 *     same order, roll after pitch after yaw.
 *
 * Units here are device widths: the phone is one unit wide, its centre at the
 * origin, x to its right, y up, and the screen facing +z, toward the camera.
 */

import type {
  Device3DFrameColor,
  Device3DLight,
  Device3DOrientation,
  Device3DPose,
  DeviceFrameElementProps,
  DeviceType,
  Point,
  Size,
} from '@/types/artboard';
import { DEVICE_3D_POSE_ANGLES } from './device3dPoseAngles';
import { faceDepths, foldCenter, foldFrame, foldLeftPoint, foldPivot, foldTurn, hullPoints, type FoldPosture } from './device3dGeometry';
import {
  PHONE_MODELS,
  finishOf,
  genericPhoneModel,
  measuredModelFor,
  type PhoneCutout,
  type PhoneFinish,
  type PhoneModel,
} from './device3dModels';
import { getDeviceDescriptor } from './deviceRegistry';

// ---------------------------------------------------------------------------
// Defaults and limits
// ---------------------------------------------------------------------------

export const STUDIO_LENS_DEFAULT = 20;
export const STUDIO_LENS_MIN = 6;
export const STUDIO_LENS_MAX = 50;

export const STUDIO_LIGHT_DEFAULT: Device3DLight = { azimuth: 37, elevation: 27, intensity: 1 };
export const STUDIO_LIGHT_INTENSITY_MIN = 0.2;
export const STUDIO_LIGHT_INTENSITY_MAX = 2;
export const STUDIO_LIGHT_ELEVATION_MIN = -30;
export const STUDIO_LIGHT_ELEVATION_MAX = 85;

/**
 * The camera sits this fraction of its distance above the device and looks
 * down at its centre, a product shot looking marginally down. The posed
 * devices place their camera the same way.
 */
export const STUDIO_CAMERA_LIFT = 0.02;

/** Room left round the silhouette inside the box, as a multiple of its size. */
export const STUDIO_FIT_MARGIN = 1.06;

/**
 * How many artboard pixels one device width covers when a device is first
 * added: about the size of a posed phone tile from the palette.
 */
export const STUDIO_DEFAULT_SCALE = 560;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export type { FoldPosture, PhoneFinish, PhoneModel };

/** The measured phones, newest first. */
export const STUDIO_MODELS: PhoneModel[] = PHONE_MODELS;

/** True for a phone that folds (the iPhone Duo): it takes fold3d and hinge3d. */
export function isFoldable(model: PhoneModel | null | undefined): boolean {
  return !!model?.fold;
}

const CUTOUTS: Partial<Record<DeviceType, PhoneCutout>> = {
  'iphone-15': { kind: 'island', width: 19.6, height: 5.9, center: 8.2 },
  'iphone-15-pro': { kind: 'island', width: 19.6, height: 5.9, center: 8.2 },
  'iphone-14': { kind: 'notch', width: 26.8, depth: 5.5, radius: 3.7, shoulder: 0.8 },
  'iphone-13': { kind: 'notch', width: 26.8, depth: 5.5, radius: 3.7, shoulder: 0.8 },
  'iphone-x': { kind: 'notch', width: 34, depth: 5.5, radius: 3.7, shoulder: 0.8 },
  'android-notch': { kind: 'notch', width: 18, depth: 4, radius: 3, shoulder: 0.8 },
  'android-punch-hole': { kind: 'punch', d: 3.4, center: 5.5 },
};

const MODEL_CACHE = new Map<DeviceType, PhoneModel | null>();

/**
 * The model a device type is drawn with: the measured one when there is a
 * drawing for it, a plain phone or tablet for the other phones and tablets,
 * and null for watches, Macs and custom frames, which fall back to the posed
 * renderer.
 */
export function studioModelFor(deviceType: DeviceType): PhoneModel | null {
  const measured = measuredModelFor(deviceType);
  if (measured) return measured;
  if (!MODEL_CACHE.has(deviceType)) {
    const d = getDeviceDescriptor(deviceType);
    const model =
      d.category === 'phone' || d.category === 'tablet'
        ? genericPhoneModel(deviceType, d.label, d.category, d.platform, d.nativeAspect, CUTOUTS[deviceType] ?? { kind: 'none' })
        : null;
    MODEL_CACHE.set(deviceType, model);
  }
  return MODEL_CACHE.get(deviceType) ?? null;
}

/** True when the device type has a model measured from Apple's drawings. */
export function isMeasuredModel(deviceType: DeviceType): boolean {
  return !!measuredModelFor(deviceType);
}

// ---------------------------------------------------------------------------
// Hull
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number];

interface StudioHull {
  /** Points on the outside, in device widths. */
  points: Vec3[];
  /** Distance from the centre to the farthest point. */
  radius: number;
}

const HULL_CACHE = new WeakMap<PhoneModel, Map<string, StudioHull>>();

/**
 * A foldable's hull changes with its posture, so it is kept per posture. A
 * fold being dragged passes through every angle, so the cache starts over
 * rather than keep them all.
 */
function hullOf(model: PhoneModel, posture?: FoldPosture): StudioHull {
  const pose = model.fold ? posture ?? defaultFoldPosture(model) : undefined;
  const key = pose ? `${Math.round(pose.opening * 100) / 100}|${pose.across ? 1 : 0}` : '';
  let byPosture = HULL_CACHE.get(model);
  if (!byPosture) {
    byPosture = new Map();
    HULL_CACHE.set(model, byPosture);
  }
  const cached = byPosture.get(key);
  if (cached) return cached;
  const k = 1 / model.width;
  const points = hullPoints(model, pose).map(([x, y, z]): Vec3 => [x * k, y * k, z * k]);
  const radius = points.reduce((max, [x, y, z]) => Math.max(max, Math.hypot(x, y, z)), 0);
  const hull = { points, radius };
  if (byPosture.size >= 48) byPosture.clear();
  byPosture.set(key, hull);
  return hull;
}

/** A foldable as it starts: open as its model says, hinge upright. */
export function defaultFoldPosture(model: PhoneModel): FoldPosture {
  return { opening: model.fold?.opening ?? 180, across: false };
}

// ---------------------------------------------------------------------------
// Orientation maths
// ---------------------------------------------------------------------------

/** Row-major 3x3 rotation. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;

/** Into (-180, 180], rounded to a hundredth so stored values stay tidy. */
export function wrapDegrees(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  let a = angle % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return Math.round(a * 100) / 100 || 0;
}

/** roll(Z) * pitch(X) * yaw(Y), the order the pose presets compose in. */
export function orientationMatrix(o: Device3DOrientation): Mat3 {
  const cy = Math.cos(o.yaw * DEG);
  const sy = Math.sin(o.yaw * DEG);
  const cp = Math.cos(o.pitch * DEG);
  const sp = Math.sin(o.pitch * DEG);
  const cr = Math.cos(o.roll * DEG);
  const sr = Math.sin(o.roll * DEG);
  return [
    cr * cy - sr * sp * sy, -sr * cp, cr * sy + sr * sp * cy,
    sr * cy + cr * sp * sy, cr * cp, sr * sy - cr * sp * cy,
    -cp * sy, sp, cp * cy,
  ];
}

/**
 * The angles that rebuild a rotation, with pitch in [-90, 90]. Looking
 * straight down the long axis (pitch at the limit) yaw and roll describe the
 * same turn, so yaw takes 0 there.
 */
export function orientationFromMatrix(m: Mat3): Device3DOrientation {
  const sp = Math.max(-1, Math.min(1, m[7]));
  const pitch = Math.asin(sp) / DEG;
  if (Math.abs(sp) < 0.999999) {
    return {
      yaw: wrapDegrees(Math.atan2(-m[6], m[8]) / DEG),
      pitch: wrapDegrees(pitch),
      roll: wrapDegrees(Math.atan2(-m[1], m[4]) / DEG),
    };
  }
  return { yaw: 0, pitch: wrapDegrees(pitch), roll: wrapDegrees(Math.atan2(m[3], m[0]) / DEG) };
}

function transform(m: Mat3, [x, y, z]: Vec3): Vec3 {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/** Degrees a drag across one trackball radius turns the device. */
export const STUDIO_DRAG_DEGREES_PER_RADIUS = 75;

/**
 * A turntable turn from a drag: across turns the device about its own long
 * side (yaw), up and down tips it toward or away from the camera (pitch),
 * which stops at straight up and straight down so the device never ends up
 * upside down and the drag never reverses. `dx` and `dy` are in the element's
 * own frame, y down, in the same units as `radius`.
 */
export function turntableTurn(
  start: Device3DOrientation,
  dx: number,
  dy: number,
  radius: number,
  snap = 0
): Device3DOrientation {
  if (radius <= 0) return start;
  const k = STUDIO_DRAG_DEGREES_PER_RADIUS / radius;
  let yaw = start.yaw + dx * k;
  let pitch = Math.max(-90, Math.min(90, start.pitch + dy * k));
  if (snap > 0) {
    yaw = Math.round(yaw / snap) * snap;
    pitch = Math.max(-90, Math.min(90, Math.round(pitch / snap) * snap));
  }
  return { yaw: wrapDegrees(yaw), pitch: wrapDegrees(pitch), roll: start.roll };
}

/** Snap an angle to the nearest multiple of `step` degrees. */
export function snapDegrees(angle: number, step: number): number {
  return wrapDegrees(Math.round(angle / step) * step);
}

/** The same turn seen in a mirror: the device faces the other way. */
export function mirrorOrientation(o: Device3DOrientation): Device3DOrientation {
  return { yaw: wrapDegrees(-o.yaw), pitch: o.pitch, roll: wrapDegrees(-o.roll) };
}

export function sameOrientation(a: Device3DOrientation, b: Device3DOrientation, tolerance = 0.05): boolean {
  const near = (x: number, y: number) => Math.abs(wrapDegrees(x - y)) <= tolerance;
  return near(a.yaw, b.yaw) && near(a.pitch, b.pitch) && near(a.roll, b.roll);
}

/** Which side the exposed rail faces in the picture: -1 left, 1 right. */
export function exposedSide(o: Device3DOrientation): -1 | 1 {
  return Math.sin(2 * o.yaw * DEG) > 1e-6 ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Camera and projection
// ---------------------------------------------------------------------------

export function clampLens(lens: number | undefined): number {
  const value = typeof lens === 'number' && Number.isFinite(lens) ? lens : STUDIO_LENS_DEFAULT;
  return Math.max(STUDIO_LENS_MIN, Math.min(STUDIO_LENS_MAX, value));
}

const WIDEST_FOLD = new WeakMap<PhoneModel, number>();

/**
 * The radius the camera is set back for. A foldable takes the widest it gets
 * at any opening, so folding it never moves the camera either, the way
 * folding a real phone in front of one does not.
 */
function cameraRadius(model: PhoneModel, posture?: FoldPosture): number {
  if (!model.fold) return hullOf(model, posture).radius;
  let widest = WIDEST_FOLD.get(model);
  if (widest === undefined) {
    widest = 0;
    for (let opening = 0; opening <= 180; opening += 15) widest = Math.max(widest, hullOf(model, { opening, across: false }).radius);
    WIDEST_FOLD.set(model, widest);
  }
  return widest;
}

/**
 * How far the camera sits from the device centre. Proportional to the device,
 * so the depth reads the same at any size, and set by the lens alone, so
 * turning or folding the device never moves the camera.
 */
export function studioCameraDistance(model: PhoneModel, lens: number, posture?: FoldPosture): number {
  return cameraRadius(model, posture) / Math.tan((clampLens(lens) * DEG) / 2);
}

/**
 * The projection used everywhere, in "centre plane" units: a point on the
 * plane through the device centre, square to the camera, lands at its own x
 * and y in device widths. Nearer points land farther out, which is the
 * perspective.
 */
function projector(model: PhoneModel, lens: number, posture?: FoldPosture) {
  const d = studioCameraDistance(model, lens, posture);
  const lift = STUDIO_CAMERA_LIFT;
  const n = Math.sqrt(1 + lift * lift);
  const centreDepth = d * n;
  return ([x, y, z]: Vec3): [number, number] => {
    const depth = (d * (1 + lift * lift) - lift * y - z) / n;
    const viewY = (y - lift * z) / n;
    const k = centreDepth / Math.max(depth, 1e-6);
    return [x * k, viewY * k];
  };
}

export interface StudioBounds {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

/** The silhouette's extent, in centre-plane units (v up). */
export function studioBounds(model: PhoneModel, o: Device3DOrientation, lens: number, posture?: FoldPosture): StudioBounds {
  const m = orientationMatrix(o);
  const project = projector(model, lens, posture);
  const bounds: StudioBounds = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (const point of hullOf(model, posture).points) {
    const [u, v] = project(transform(m, point));
    if (u < bounds.minU) bounds.minU = u;
    if (u > bounds.maxU) bounds.maxU = u;
    if (v < bounds.minV) bounds.minV = v;
    if (v > bounds.maxV) bounds.maxV = v;
  }
  return bounds;
}

/**
 * The farthest any part of the device can land from its centre in the
 * picture, at any angle: the outline of its bounding sphere. While a turn is
 * in flight the renderer draws into a square this big, so nothing is cut off
 * before the box catches up.
 */
export function studioSphereRadius(model: PhoneModel, lens: number, posture?: FoldPosture): number {
  const r = hullOf(model, posture).radius;
  const d = studioCameraDistance(model, lens, posture) * Math.sqrt(1 + STUDIO_CAMERA_LIFT * STUDIO_CAMERA_LIFT);
  return (r * d) / Math.sqrt(Math.max(d * d - r * r, 1e-6));
}

export interface StudioFrame {
  /** Box pixels per centre-plane unit. */
  scale: number;
  /** The centre-plane point at the middle of the box. */
  centerU: number;
  centerV: number;
}

/** How a device sits in a box: as large as fits, with its silhouette centred. */
export function studioFrame(
  model: PhoneModel,
  o: Device3DOrientation,
  lens: number,
  boxWidth: number,
  boxHeight: number,
  posture?: FoldPosture
): StudioFrame {
  const b = studioBounds(model, o, lens, posture);
  const width = Math.max(b.maxU - b.minU, 1e-6) * STUDIO_FIT_MARGIN;
  const height = Math.max(b.maxV - b.minV, 1e-6) * STUDIO_FIT_MARGIN;
  return {
    scale: Math.max(1e-6, Math.min(boxWidth / width, boxHeight / height)),
    centerU: (b.minU + b.maxU) / 2,
    centerV: (b.minV + b.maxV) / 2,
  };
}

/** The box that hugs a device at a given scale, in pixels. */
export function studioHugSize(model: PhoneModel, o: Device3DOrientation, lens: number, scale: number, posture?: FoldPosture): Size {
  const b = studioBounds(model, o, lens, posture);
  return {
    width: (b.maxU - b.minU) * STUDIO_FIT_MARGIN * scale,
    height: (b.maxV - b.minV) * STUDIO_FIT_MARGIN * scale,
  };
}

// ---------------------------------------------------------------------------
// Keeping the box round the device
// ---------------------------------------------------------------------------

export interface StudioBoxState {
  position: Point;
  size: Size;
  scale: number;
  /** The element's own 2D rotation, degrees. */
  rotation: number;
}

export interface StudioPose {
  model: PhoneModel;
  orientation: Device3DOrientation;
  lens: number;
  /** A foldable's opening and hinge; ignored by other phones. */
  posture?: FoldPosture;
}

const roundTo = (value: number, places = 2) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

/**
 * The box after a turn (or a lens or model change): fitted round the new
 * silhouette at the scale the device had, with the device centre where it was.
 * The element's own 2D rotation and its scale are kept, so the result is the
 * position and size to write and nothing else.
 */
export function rehugStudioBox(box: StudioBoxState, from: StudioPose, to: StudioPose): { position: Point; size: Size } {
  const scale = box.scale || 1;
  const boxW = box.size.width * scale;
  const boxH = box.size.height * scale;
  const before = studioFrame(from.model, from.orientation, from.lens, boxW, boxH, from.posture);
  const after = studioBounds(to.model, to.orientation, to.lens, to.posture);
  // Scale is per device width; a model change keeps the device's height on
  // screen instead, so swapping a Pro Max for a mini does not shrink it.
  const s = before.scale * (to.model === from.model ? 1 : (from.model.height / from.model.width) / (to.model.height / to.model.width));
  const nextW = Math.max(1, (after.maxU - after.minU) * STUDIO_FIT_MARGIN * s);
  const nextH = Math.max(1, (after.maxV - after.minV) * STUDIO_FIT_MARGIN * s);
  const centerU = (after.minU + after.maxU) / 2;
  const centerV = (after.minV + after.maxV) / 2;
  // Offset of the new box centre from the old one, in the element's frame
  // (x right, y down): the device centre stays put, so the box moves by how
  // far the silhouette's centre moved round it.
  const localX = centerU * s - before.centerU * before.scale;
  const localY = before.centerV * before.scale - centerV * s;
  const angle = (box.rotation || 0) * DEG;
  const dx = localX * Math.cos(angle) - localY * Math.sin(angle);
  const dy = localX * Math.sin(angle) + localY * Math.cos(angle);
  const oldCenterX = box.position.x + boxW / 2;
  const oldCenterY = box.position.y + boxH / 2;
  return {
    position: { x: roundTo(oldCenterX + dx - nextW / 2), y: roundTo(oldCenterY + dy - nextH / 2) },
    size: { width: roundTo(nextW / scale), height: roundTo(nextH / scale) },
  };
}

// ---------------------------------------------------------------------------
// Reading an element
// ---------------------------------------------------------------------------

export function isStudioStyle(styleType: DeviceFrameElementProps['styleType']): boolean {
  return styleType === '3d-studio';
}

const finiteOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function studioOrientationOf(el: Pick<DeviceFrameElementProps, 'rotation3d'>): Device3DOrientation {
  const o = el.rotation3d;
  return {
    yaw: finiteOr(o?.yaw, 0),
    pitch: finiteOr(o?.pitch, 0),
    roll: finiteOr(o?.roll, 0),
  };
}

export function studioLensOf(el: Pick<DeviceFrameElementProps, 'lens3d'>): number {
  return clampLens(el.lens3d);
}

export function studioLightOf(el: Pick<DeviceFrameElementProps, 'light3d'>): Device3DLight {
  const l = el.light3d;
  return {
    azimuth: wrapDegrees(finiteOr(l?.azimuth, STUDIO_LIGHT_DEFAULT.azimuth)),
    elevation: Math.max(
      STUDIO_LIGHT_ELEVATION_MIN,
      Math.min(STUDIO_LIGHT_ELEVATION_MAX, finiteOr(l?.elevation, STUDIO_LIGHT_DEFAULT.elevation))
    ),
    intensity: Math.max(
      STUDIO_LIGHT_INTENSITY_MIN,
      Math.min(STUDIO_LIGHT_INTENSITY_MAX, finiteOr(l?.intensity, STUDIO_LIGHT_DEFAULT.intensity))
    ),
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A custom colour, if one is set: any #rrggbb. */
export function studioCustomColorOf(el: Pick<DeviceFrameElementProps, 'bodyColor3d'>): string | null {
  const color = el.bodyColor3d;
  return typeof color === 'string' && HEX.test(color) ? color.toLowerCase() : null;
}

/** The back glass that goes with a custom frame colour: the same hue, a little lighter and softer. */
function backForCustom(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.08);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * The finish a device shows: its custom colour when it has one, else the
 * named finish of its model (finish3d), else the model's default.
 */
export function studioFinishOf(el: Pick<DeviceFrameElementProps, 'bodyColor3d' | 'finish3d'>, model: PhoneModel): PhoneFinish {
  const custom = studioCustomColorOf(el);
  if (custom) return { id: 'custom', label: 'Custom', frame: custom, back: backForCustom(custom) };
  return finishOf(model, el.finish3d);
}

export function studioGlareOf(el: Pick<DeviceFrameElementProps, 'glare3d'>): number {
  return Math.max(0, Math.min(1, finiteOr(el.glare3d, 0)));
}

/** How far open a foldable is, 0 to 180 degrees between its halves. */
export function clampOpening(opening: number | undefined, fallback = 180): number {
  return Math.max(0, Math.min(180, finiteOr(opening, fallback)));
}

/** A foldable's posture on an element: its opening (the model's own when unset) and which way its hinge runs. */
export function studioPostureOf(el: Pick<DeviceFrameElementProps, 'fold3d' | 'hinge3d'>, model: PhoneModel): FoldPosture {
  return { opening: clampOpening(el.fold3d, model.fold?.opening ?? 180), across: el.hinge3d === 'across' };
}

/**
 * Which of a foldable's displays faces out at an opening, when the camera
 * says nothing either way: the inner one from 90 degrees open, the outer one
 * below.
 */
export function foldScreenOf(opening: number): 'inner' | 'outer' {
  return opening >= 90 ? 'inner' : 'outer';
}

// ---------------------------------------------------------------------------
// A foldable as the camera sees it
// ---------------------------------------------------------------------------

type FoldSide = 'left' | 'right';

/**
 * A point of one of a foldable's halves (model millimetres, open flat) where
 * the renderer draws it: folded, moved so the body's middle is at the origin,
 * turned for the hinge, in device widths, then turned with the device. With
 * `direction` it turns a direction instead and leaves out the moves.
 */
function posedFold(model: PhoneModel, posture: FoldPosture, m: Mat3, center: Vec3, side: FoldSide, p: Vec3, direction = false): Vec3 {
  let q = p;
  if (side === 'left') {
    if (direction) {
      const a = foldTurn(posture.opening) * DEG;
      q = [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
    } else {
      q = foldLeftPoint(model, posture.opening, p);
    }
  }
  const f = foldFrame(direction ? [0, 0, 0] : center, posture.across, q);
  const k = direction ? 1 : 1 / model.width;
  return transform(m, [f[0] * k, f[1] * k, f[2] * k]);
}

/** The other way: a point where the renderer draws it, back on its half open flat. */
function unposedFold(model: PhoneModel, posture: FoldPosture, m: Mat3, center: Vec3, side: FoldSide, p: Vec3): Vec3 {
  // The transpose undoes the device's turn.
  const t: Vec3 = [m[0] * p[0] + m[3] * p[1] + m[6] * p[2], m[1] * p[0] + m[4] * p[1] + m[7] * p[2], m[2] * p[0] + m[5] * p[1] + m[8] * p[2]];
  const w: Vec3 = [t[0] * model.width, t[1] * model.width, t[2] * model.width];
  const g: Vec3 = posture.across ? [w[1], -w[0], w[2]] : w;
  const q: Vec3 = [g[0] + center[0], g[1] + center[1], g[2] + center[2]];
  if (side === 'right') return q;
  const a = foldTurn(posture.opening) * DEG;
  const pivot = foldPivot(model);
  const dz = q[2] - pivot;
  return [q[0] * Math.cos(a) - dz * Math.sin(a), q[1], q[0] * Math.sin(a) + dz * Math.cos(a) + pivot];
}

/** Whether the segment from a to b passes through the box from lo to hi. */
function segmentHitsBox(a: Vec3, b: Vec3, lo: Vec3, hi: Vec3): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-12) {
      if (a[k] < lo[k] || a[k] > hi[k]) return false;
      continue;
    }
    let ta = (lo[k] - a[k]) / d;
    let tb = (hi[k] - a[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Points sampled on a display to see how much of it the camera sees: more
 * across the fold, where the edge of what the other half covers moves.
 */
const VIEW_SAMPLES = { across: 16, along: 8 };

/**
 * How much of each of a foldable's displays the camera sees, in square
 * millimetres, counting a part more the squarer it faces the camera: the
 * inner display across both halves, and the outer one on the left half's
 * back. A part with the other half in front of it does not count.
 */
export function foldDisplaysInView(model: PhoneModel, posture: FoldPosture, o: Device3DOrientation, lens: number): { inner: number; outer: number } {
  const fold = model.fold;
  if (!fold) return { inner: 0, outer: 0 };
  const m = orientationMatrix(o);
  const center = foldCenter(model, posture.opening);
  const d = studioCameraDistance(model, lens, posture);
  const camera: Vec3 = [0, STUDIO_CAMERA_LIFT * d, d];
  const { front, back } = faceDepths(model);
  const halfW = model.width / 2;
  const halfH = model.height / 2;
  // A hair inside each half's body, so a display touching the other half at the hinge is not hidden by it.
  const e = 0.05;
  const hidden = (by: FoldSide, p: Vec3) => {
    const x0 = by === 'right' ? 0 : -halfW;
    return segmentHitsBox(
      unposedFold(model, posture, m, center, by, p),
      unposedFold(model, posture, m, center, by, camera),
      [x0 + e, -halfH + e, back + e],
      [x0 + halfW - e, halfH - e, front - e]
    );
  };
  const seen = (side: FoldSide, x0: number, x1: number, y0: number, y1: number, z: number, nz: 1 | -1) => {
    const { across: n, along } = VIEW_SAMPLES;
    const cell = ((x1 - x0) * (y1 - y0)) / (n * along);
    const normal = posedFold(model, posture, m, center, side, [0, 0, nz], true);
    const other: FoldSide = side === 'left' ? 'right' : 'left';
    let total = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < along; j++) {
        const p = posedFold(model, posture, m, center, side, [x0 + ((i + 0.5) / n) * (x1 - x0), y0 + ((j + 0.5) / along) * (y1 - y0), z]);
        const to: Vec3 = [camera[0] - p[0], camera[1] - p[1], camera[2] - p[2]];
        const facing = (normal[0] * to[0] + normal[1] * to[1] + normal[2] * to[2]) / Math.hypot(to[0], to[1], to[2]);
        if (facing > 0.02 && !hidden(other, p)) total += facing * cell;
      }
    }
    return total;
  };
  const dw = model.display.width / 2;
  const dh = model.display.height / 2;
  const outer = fold.outer;
  return {
    inner: seen('right', 0, dw, -dh, dh, front, 1) + seen('left', -dw, 0, -dh, dh, front, 1),
    outer: seen('left', -(outer.hinge + outer.width), -outer.hinge, -outer.height / 2, outer.height / 2, back, -1),
  };
}

/**
 * How much more a foldable's inner display counts than its outer one when
 * the screenshot picks between them. Open, the inner display is the phone's
 * screen, so the picture leaves it only once the outer display is clearly the
 * one in view: nearly closed, stood as a tent, or seen from behind.
 */
export const FOLD_INNER_PREFERENCE = 2.5;

/**
 * Which display a foldable's screenshot goes on: the one the camera sees
 * more of, the inner one counted FOLD_INNER_PREFERENCE times over, so a
 * half-open phone shows it inside when seen from the front and on the outer
 * display when seen from behind or stood as a tent. The display it is on
 * keeps it until the other is clearly ahead, so a fold or a turn through the
 * point where they match does not flicker, and when the camera sees neither
 * (edge on) the opening decides.
 */
export function foldScreenInView(
  model: PhoneModel,
  posture: FoldPosture,
  o: Device3DOrientation,
  lens: number,
  current?: 'inner' | 'outer'
): 'inner' | 'outer' {
  const seen = foldDisplaysInView(model, posture, o, lens);
  if (seen.inner + seen.outer < model.display.width * model.display.height * 0.01) return current ?? foldScreenOf(posture.opening);
  const inner = seen.inner * FOLD_INNER_PREFERENCE;
  if (current === 'inner') return seen.outer > inner * 1.15 ? 'outer' : 'inner';
  if (current === 'outer') return inner > seen.outer * 1.15 ? 'inner' : 'outer';
  return inner >= seen.outer ? 'inner' : 'outer';
}

/** How far out from the hinge toward its free edge a foldable's fold grip sits, as a share of the half. */
export const FOLD_GRIP_REACH = 0.7;

/** A point (device widths, turned with the device) in pixels in a box the device is drawn in at `frame`. */
function toBox(model: PhoneModel, lens: number, posture: FoldPosture, frame: StudioFrame, boxW: number, boxH: number, p: Vec3): Point {
  const [u, v] = projector(model, lens, posture)(p);
  return { x: boxW / 2 + (u - frame.centerU) * frame.scale, y: boxH / 2 - (v - frame.centerV) * frame.scale };
}

/**
 * Where a foldable's fold grip is in the box it is drawn in at `frame`: on
 * the middle line of the half that swings, `reach` of the way out to its
 * free edge.
 */
export function studioFoldGrip(
  model: PhoneModel,
  o: Device3DOrientation,
  lens: number,
  posture: FoldPosture,
  frame: StudioFrame,
  boxW: number,
  boxH: number,
  reach = FOLD_GRIP_REACH
): Point {
  const grip: Vec3 = [(-reach * model.width) / 2, 0, 0];
  const p = posedFold(model, posture, orientationMatrix(o), foldCenter(model, posture.opening), 'left', grip);
  return toBox(model, lens, posture, frame, boxW, boxH, p);
}

/**
 * The opening that brings a foldable's grip nearest a pointer in its box,
 * for a drag of the grip. It is searched outward from `from`, the opening the
 * last move left, so the half follows the pointer round its swing and never
 * jumps to another opening that happens to put the grip near it too.
 */
export function studioFoldTo(
  model: PhoneModel,
  o: Device3DOrientation,
  lens: number,
  across: boolean,
  frame: StudioFrame,
  boxW: number,
  boxH: number,
  pointer: Point,
  from: number,
  reach = FOLD_GRIP_REACH
): number {
  const miss = (opening: number) => {
    const g = studioFoldGrip(model, o, lens, { opening, across }, frame, boxW, boxH, reach);
    return Math.hypot(g.x - pointer.x, g.y - pointer.y);
  };
  const lo = Math.max(0, from - 45);
  const hi = Math.min(180, from + 45);
  let best = clampOpening(from);
  let bestMiss = miss(best);
  for (let a = lo; a <= hi + 1e-9; a += 1) {
    const m = miss(a);
    if (m < bestMiss) {
      bestMiss = m;
      best = a;
    }
  }
  // Then to a tenth of a degree either side of the best whole degree.
  let a0 = Math.max(0, best - 1);
  let a1 = Math.min(180, best + 1);
  for (let k = 0; k < 24; k++) {
    const m1 = a0 + (a1 - a0) / 3;
    const m2 = a1 - (a1 - a0) / 3;
    if (miss(m1) < miss(m2)) a1 = m2;
    else a0 = m1;
  }
  best = Math.round(((a0 + a1) / 2) * 10) / 10;
  bestMiss = miss(best);
  // Near either end the half swings toward the camera and grows in the
  // picture, so the grip turns back a few degrees short of flat or closed.
  // Pulled on past an end, straight out from the hinge, it reaches that end.
  const hinge = toBox(model, lens, { opening: best, across }, frame, boxW, boxH, posedFold(model, { opening: best, across }, orientationMatrix(o), foldCenter(model, best), 'right', [0, 0, foldPivot(model)]));
  for (const end of [0, 180]) {
    if (Math.abs(best - end) > 30) continue;
    const g = studioFoldGrip(model, o, lens, { opening: end, across }, frame, boxW, boxH, reach);
    const ox = g.x - hinge.x;
    const oy = g.y - hinge.y;
    const len = Math.hypot(ox, oy);
    if (len < 2) continue;
    const t = ((pointer.x - g.x) * ox + (pointer.y - g.y) * oy) / len;
    if (t <= 0) continue;
    const off = Math.hypot(pointer.x - (g.x + (ox / len) * t), pointer.y - (g.y + (oy / len) * t));
    if (off < bestMiss) return end;
  }
  return best;
}

/**
 * The position and size that keep a studio device the same size on screen
 * after `changes` land. Returns the changes plus that box, ready to commit as
 * one edit, or the changes alone when the element is not a studio device.
 */
export function withStudioRehug(
  el: DeviceFrameElementProps,
  changes: Partial<Pick<DeviceFrameElementProps, 'rotation3d' | 'lens3d' | 'deviceType' | 'fold3d' | 'hinge3d'>>
): Partial<DeviceFrameElementProps> {
  const fromModel = studioModelFor(el.deviceType);
  const toModel = studioModelFor(changes.deviceType ?? el.deviceType);
  if (!isStudioStyle(el.styleType) || !fromModel || !toModel) return { ...changes };
  const box = rehugStudioBox(
    { position: el.position, size: el.size, scale: el.scale, rotation: el.rotation },
    { model: fromModel, orientation: studioOrientationOf(el), lens: studioLensOf(el), posture: studioPostureOf(el, fromModel) },
    {
      model: toModel,
      orientation: changes.rotation3d ? studioOrientationOf({ rotation3d: changes.rotation3d }) : studioOrientationOf(el),
      lens: changes.lens3d !== undefined ? clampLens(changes.lens3d) : studioLensOf(el),
      posture: studioPostureOf({ fold3d: 'fold3d' in changes ? changes.fold3d : el.fold3d, hinge3d: 'hinge3d' in changes ? changes.hinge3d : el.hinge3d }, toModel),
    }
  );
  return { ...changes, ...box };
}

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------

/** A pose preset as studio angles. Side 'right' mirrors yaw and roll. */
export function orientationForPose(pose: Device3DPose, side: 'left' | 'right'): Device3DOrientation {
  const angles = DEVICE_3D_POSE_ANGLES[pose] ?? DEVICE_3D_POSE_ANGLES.classic;
  const mirror = side === 'left' ? 1 : -1;
  return {
    yaw: wrapDegrees(angles.yaw * mirror),
    pitch: wrapDegrees(angles.pitch),
    roll: wrapDegrees((angles.roll ?? 0) * mirror),
  };
}

export interface StudioLook {
  id: string;
  label: string;
  /** The look as it faces left; mirrorOrientation gives the right-facing one. */
  orientation: Device3DOrientation;
}

const poseLook = (pose: Device3DPose, label: string): StudioLook => ({
  id: pose,
  label,
  orientation: orientationForPose(pose, 'left'),
});

/**
 * Starting angles for a studio device. Most are the pose presets of the posed
 * 3D groups; the rest are angles only a turnable device can reach, the back
 * above all.
 */
export const STUDIO_LOOKS: StudioLook[] = [
  { id: 'front', label: 'Front', orientation: { yaw: 0, pitch: 0, roll: 0 } },
  { id: 'hero', label: 'Hero', orientation: { yaw: 24, pitch: -12, roll: -8 } },
  poseLook('upright', 'Upright'),
  poseLook('side', 'Side'),
  poseLook('tilted', 'Tilted'),
  poseLook('reclined', 'Reclined'),
  poseLook('laying', 'Laying'),
  poseLook('floating', 'Floating'),
  poseLook('drifting', 'Drifting'),
  poseLook('leaning', 'Leaning'),
  poseLook('soaring', 'Soaring'),
  poseLook('isometric', 'Isometric'),
  { id: 'flat-lay', label: 'Flat lay', orientation: { yaw: 0, pitch: -58, roll: 0 } },
  { id: 'profile', label: 'Profile', orientation: { yaw: 78, pitch: 0, roll: 0 } },
  { id: 'back-angled', label: 'Back angled', orientation: { yaw: 148, pitch: -10, roll: 0 } },
  { id: 'back', label: 'Back', orientation: { yaw: 180, pitch: 0, roll: 0 } },
];

export function studioLookById(id: string): StudioLook | undefined {
  return STUDIO_LOOKS.find((look) => look.id === id);
}

/**
 * Ready-made poses for a foldable, after the ones Apple shows it in: how far
 * open, which way the hinge runs, and the angle that shows it best. Picking
 * one sets all three; the Fold slider and the angle controls then adjust it.
 */
export interface StudioFoldPose {
  id: string;
  label: string;
  opening: number;
  across: boolean;
  /** Facing left; mirrorOrientation gives the right-facing one. */
  orientation: Device3DOrientation;
}

export const STUDIO_FOLD_POSES: StudioFoldPose[] = [
  { id: 'closed', label: 'Closed', opening: 0, across: false, orientation: { yaw: 24, pitch: -12, roll: -8 } },
  // Standing on its two edges with the hinge on top, turned 28 degrees on the
  // table and seen from 14 degrees above: the outer display faces you.
  { id: 'tent', label: 'Tent', opening: 70, across: true, orientation: { yaw: -38.98, pitch: -43.6, roll: 158.17 } },
  // The lower half flat like a keyboard, the upper half the screen, seen from
  // the front and above.
  { id: 'laptop', label: 'Laptop', opening: 105, across: true, orientation: { yaw: 25, pitch: 20, roll: 0 } },
  { id: 'book', label: 'Book', opening: 150, across: false, orientation: { yaw: 14, pitch: -10, roll: -4 } },
  { id: 'open', label: 'Open', opening: 180, across: true, orientation: { yaw: 24, pitch: -12, roll: -8 } },
];

export function studioFoldPoseById(id: string): StudioFoldPose | undefined {
  return STUDIO_FOLD_POSES.find((pose) => pose.id === id);
}

/**
 * How a foldable from the palette arrives, at the palette look: held tall
 * like a portrait screenshot of its inner display, and bent just enough to
 * show that it folds.
 */
export const STUDIO_TILE_FOLD: FoldPosture = { opening: 160, across: true };

/** The look this orientation is, either way round, if it is one. */
export function matchStudioLook(o: Device3DOrientation): { look: StudioLook; mirrored: boolean } | null {
  for (const look of STUDIO_LOOKS) {
    if (sameOrientation(look.orientation, o)) return { look, mirrored: false };
    if (sameOrientation(mirrorOrientation(look.orientation), o)) return { look, mirrored: true };
  }
  return null;
}

/**
 * The key light for a new angle: the same height and strength, swung to the
 * side whose rail now faces the camera, the way the posed devices light the
 * rail they show.
 */
export function lightForOrientation(light: Device3DLight, o: Device3DOrientation): Device3DLight {
  const side = exposedSide(o);
  const azimuth = Math.abs(light.azimuth);
  return { ...light, azimuth: wrapDegrees(side * (azimuth === 0 ? STUDIO_LIGHT_DEFAULT.azimuth : azimuth)) };
}

// ---------------------------------------------------------------------------
// Palette tiles and conversions
// ---------------------------------------------------------------------------

/**
 * Artboard pixels per device width for a freshly added device. A foldable's
 * model is its open width, so each half gets about what a phone gets.
 */
export function studioDefaultScale(model: PhoneModel): number {
  return model.fold ? STUDIO_DEFAULT_SCALE * 2 : STUDIO_DEFAULT_SCALE;
}

/** The box a freshly added studio device gets: hugging it at the default scale. */
export function studioDefaultSize(model: PhoneModel, o: Device3DOrientation, lens = STUDIO_LENS_DEFAULT, posture?: FoldPosture): Size {
  const size = studioHugSize(model, o, lens, studioDefaultScale(model), posture);
  return { width: Math.round(size.width), height: Math.round(size.height) };
}

/** The look a phone from the palette arrives at. */
export const STUDIO_TILE_LOOK = 'hero';

const TILE_PROPS_CACHE = new Map<string, Readonly<Record<string, unknown>>>();

/**
 * Element props a 3D Studio tile drops onto the canvas: the model at the
 * palette look in its default finish. Cached, because the palette asks on
 * every render of the group; callers copy rather than mutate.
 */
export function studioTileStyleProps(model: PhoneModel): Readonly<Record<string, unknown>> {
  const cached = TILE_PROPS_CACHE.get(model.id);
  if (cached) return cached;
  const orientation = (studioLookById(STUDIO_TILE_LOOK) ?? STUDIO_LOOKS[0]).orientation;
  const posture = model.fold ? STUDIO_TILE_FOLD : undefined;
  const props = {
    styleType: '3d-studio',
    rotation3d: { ...orientation },
    finish3d: model.defaultFinish,
    light3d: lightForOrientation(STUDIO_LIGHT_DEFAULT, orientation),
    ...(posture ? { fold3d: posture.opening, hinge3d: posture.across ? 'across' : 'upright' } : {}),
    defaultSize: studioDefaultSize(model, orientation, STUDIO_LENS_DEFAULT, posture),
  };
  TILE_PROPS_CACHE.set(model.id, props);
  return props;
}

/** The posed devices' three finishes, as colours to match a model's finishes against. */
const POSED_FINISH_COLORS: Record<Device3DFrameColor, string> = {
  titanium: '#8d8d93',
  black: '#2f2f33',
  white: '#f1f1f3',
};

/** The model's finish nearest in colour to a posed device's finish. */
function nearestFinish(model: PhoneModel, posed: Device3DFrameColor): string {
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const target = rgb(POSED_FINISH_COLORS[posed]);
  let best = model.finishes[0];
  let bestDistance = Infinity;
  for (const finish of model.finishes) {
    const c = rgb(finish.frame);
    const distance = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2 + (c[2] - target[2]) ** 2;
    if (distance < bestDistance) {
      best = finish;
      bestDistance = distance;
    }
  }
  return best.id;
}

/**
 * What switching a device to the 3D Studio style writes: the angle it already
 * had (a posed device keeps its pose, a flat one starts straight on), the
 * nearest finish, a matching key light, and a box fitted round it at the size
 * it showed.
 */
export function studioConversionPatch(el: DeviceFrameElementProps): Partial<DeviceFrameElementProps> {
  const model = studioModelFor(el.deviceType);
  const posed = el.styleType === '3d-left' || el.styleType === '3d-right';
  const orientation = el.rotation3d
    ? studioOrientationOf(el)
    : posed
      ? orientationForPose(el.pose3d ?? 'classic', el.styleType === '3d-left' ? 'left' : 'right')
      : { yaw: 0, pitch: 0, roll: 0 };
  const patch: Partial<DeviceFrameElementProps> = {
    styleType: '3d-studio',
    rotation3d: orientation,
  };
  if (model && !el.finish3d && !el.bodyColor3d && posed && el.frameColor3d) {
    patch.finish3d = nearestFinish(model, el.frameColor3d);
  }
  if (!el.light3d) patch.light3d = lightForOrientation(STUDIO_LIGHT_DEFAULT, orientation);
  if (!model) return patch;
  // The device fills the box it is in now, then the box closes round it.
  const lens = studioLensOf(el);
  const posture = studioPostureOf(el, model);
  const box = rehugStudioBox(
    { position: el.position, size: el.size, scale: el.scale, rotation: el.rotation },
    { model, orientation, lens, posture },
    { model, orientation, lens, posture }
  );
  return { ...patch, ...box };
}
