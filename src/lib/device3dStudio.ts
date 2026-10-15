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
import { hullPoints } from './device3dGeometry';
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

export type { PhoneFinish, PhoneModel };

/** The measured phones, newest first. */
export const STUDIO_MODELS: PhoneModel[] = PHONE_MODELS;

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

const HULL_CACHE = new WeakMap<PhoneModel, StudioHull>();

function hullOf(model: PhoneModel): StudioHull {
  const cached = HULL_CACHE.get(model);
  if (cached) return cached;
  const k = 1 / model.width;
  const points = hullPoints(model).map(([x, y, z]): Vec3 => [x * k, y * k, z * k]);
  const radius = points.reduce((max, [x, y, z]) => Math.max(max, Math.hypot(x, y, z)), 0);
  const hull = { points, radius };
  HULL_CACHE.set(model, hull);
  return hull;
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

/**
 * How far the camera sits from the device centre. Proportional to the device,
 * so the depth reads the same at any size, and set by the lens alone, so
 * turning the device never moves the camera.
 */
export function studioCameraDistance(model: PhoneModel, lens: number): number {
  return hullOf(model).radius / Math.tan((clampLens(lens) * DEG) / 2);
}

/**
 * The projection used everywhere, in "centre plane" units: a point on the
 * plane through the device centre, square to the camera, lands at its own x
 * and y in device widths. Nearer points land farther out, which is the
 * perspective.
 */
function projector(model: PhoneModel, lens: number) {
  const d = studioCameraDistance(model, lens);
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
export function studioBounds(model: PhoneModel, o: Device3DOrientation, lens: number): StudioBounds {
  const m = orientationMatrix(o);
  const project = projector(model, lens);
  const bounds: StudioBounds = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (const point of hullOf(model).points) {
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
export function studioSphereRadius(model: PhoneModel, lens: number): number {
  const r = hullOf(model).radius;
  const d = studioCameraDistance(model, lens) * Math.sqrt(1 + STUDIO_CAMERA_LIFT * STUDIO_CAMERA_LIFT);
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
  boxHeight: number
): StudioFrame {
  const b = studioBounds(model, o, lens);
  const width = Math.max(b.maxU - b.minU, 1e-6) * STUDIO_FIT_MARGIN;
  const height = Math.max(b.maxV - b.minV, 1e-6) * STUDIO_FIT_MARGIN;
  return {
    scale: Math.max(1e-6, Math.min(boxWidth / width, boxHeight / height)),
    centerU: (b.minU + b.maxU) / 2,
    centerV: (b.minV + b.maxV) / 2,
  };
}

/** The box that hugs a device at a given scale, in pixels. */
export function studioHugSize(model: PhoneModel, o: Device3DOrientation, lens: number, scale: number): Size {
  const b = studioBounds(model, o, lens);
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
  const before = studioFrame(from.model, from.orientation, from.lens, boxW, boxH);
  const after = studioBounds(to.model, to.orientation, to.lens);
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

/**
 * The position and size that keep a studio device the same size on screen
 * after `changes` land. Returns the changes plus that box, ready to commit as
 * one edit, or the changes alone when the element is not a studio device.
 */
export function withStudioRehug(
  el: DeviceFrameElementProps,
  changes: Partial<Pick<DeviceFrameElementProps, 'rotation3d' | 'lens3d' | 'deviceType'>>
): Partial<DeviceFrameElementProps> {
  const fromModel = studioModelFor(el.deviceType);
  const toModel = studioModelFor(changes.deviceType ?? el.deviceType);
  if (!isStudioStyle(el.styleType) || !fromModel || !toModel) return { ...changes };
  const box = rehugStudioBox(
    { position: el.position, size: el.size, scale: el.scale, rotation: el.rotation },
    { model: fromModel, orientation: studioOrientationOf(el), lens: studioLensOf(el) },
    {
      model: toModel,
      orientation: changes.rotation3d ? studioOrientationOf({ rotation3d: changes.rotation3d }) : studioOrientationOf(el),
      lens: changes.lens3d !== undefined ? clampLens(changes.lens3d) : studioLensOf(el),
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

/** The box a freshly added studio device gets: hugging it at the default scale. */
export function studioDefaultSize(model: PhoneModel, o: Device3DOrientation, lens = STUDIO_LENS_DEFAULT): Size {
  const size = studioHugSize(model, o, lens, STUDIO_DEFAULT_SCALE);
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
  const look = studioLookById(STUDIO_TILE_LOOK) ?? STUDIO_LOOKS[0];
  const props = {
    styleType: '3d-studio',
    rotation3d: { ...look.orientation },
    finish3d: model.defaultFinish,
    light3d: lightForOrientation(STUDIO_LIGHT_DEFAULT, look.orientation),
    defaultSize: studioDefaultSize(model, look.orientation),
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
  const box = rehugStudioBox(
    { position: el.position, size: el.size, scale: el.scale, rotation: el.rotation },
    { model, orientation, lens },
    { model, orientation, lens }
  );
  return { ...patch, ...box };
}
