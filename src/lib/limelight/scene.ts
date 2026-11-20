/**
 * Making Limelight scenes and reading them back safely.
 *
 * `newScene` gives a stage that is already moving: one phone, lit, with the
 * camera drifting round it, so the first thing a person sees is a shot rather
 * than an empty room. `normalizeScene` takes anything (a row from the
 * database, a template, what an agent sent, a file from Google Drive) and
 * returns a scene every part of the app can draw: unknown kinds and devices
 * are dropped or swapped, numbers are clamped into range, keys are sorted and
 * every id is unique. It never throws on a bad field, so one broken value
 * cannot lose a scene.
 */

import type { DeviceType } from '@/types/artboard';
import { stageModelFor } from './models';
import { finishOf } from '@/lib/device3dModels';
import { APERTURE_MAX, APERTURE_MIN, DISTANCE_MAX, DISTANCE_MIN, ELEVATION_LIMIT, LENS_MAX, LENS_MIN, clamp, distanceToFrame } from './camera';
import { DEFAULT_FORMAT_PRESET, environmentPreset, formatPresetById } from './presets';
import {
  LIMELIGHT_EASES,
  LIMELIGHT_ENVIRONMENTS,
  LIMELIGHT_SCENE_VERSION,
  SCREEN_TRANSITIONS,
  type ActorMotion,
  type ActorPose,
  type CameraShot,
  type CameraState,
  type DeviceActor,
  type LimelightActor,
  type LimelightBackdrop,
  type LimelightEase,
  type LimelightEnvironment,
  type LimelightFormat,
  type LimelightLook,
  type LimelightScene,
  type ScreenChange,
  type ScreenOrigin,
  type ScreenTransition,
  type TextActor,
  type Turn,
  type XYZ,
} from './types';

export const DEFAULT_DEVICE: DeviceType = 'iphone-17-pro';
export const MAX_DEVICES = 8;
export const MAX_ACTORS = 16;
export const MAX_KEYS = 64;
export const MAX_SCREENS = 24;
export const DURATION_MIN = 1;
export const DURATION_MAX = 120;
export const SIZE_MIN = 240;
export const SIZE_MAX = 4096;
/** How high a device floats over the floor when it is added: it reads as held up, not lying there. */
export const DEFAULT_LIFT = 2;

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** A short random id with a prefix that says what it names: scene_, shot_, actor_, pose_, screen_, media_. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const random = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 9);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/** True for the phones and tablets the stage can build in 3D. */
export function isStageDevice(device: unknown): device is DeviceType {
  if (typeof device !== 'string') return false;
  try {
    return stageModelFor(device as DeviceType) !== null;
  } catch {
    return false;
  }
}

/** A device's real height in centimetres, its scale left out. */
export function deviceHeight(device: DeviceType): number {
  const model = stageModelFor(device);
  return model ? model.height / 10 : 15;
}

/** A device's real width in centimetres. */
export function deviceWidth(device: DeviceType): number {
  const model = stageModelFor(device);
  return model ? model.width / 10 : 7;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultMotion(): ActorMotion {
  return { float: 0, spin: 0 };
}

export function newPose(time: number, position: XYZ, turn: Turn = { yaw: 0, pitch: 0, roll: 0 }, scale = 1): ActorPose {
  return { id: newId('pose'), time, ease: 'smooth', position: { ...position }, turn: { ...turn }, scale, opacity: 1 };
}

export interface NewDeviceOptions {
  name?: string;
  position?: XYZ;
  turn?: Turn;
  media?: string | null;
  from?: ScreenOrigin;
}

export function newDeviceActor(device: DeviceType = DEFAULT_DEVICE, options: NewDeviceOptions = {}): DeviceActor {
  const model = stageModelFor(device);
  const height = deviceHeight(device);
  const position = options.position ?? { x: 0, y: height / 2 + DEFAULT_LIFT, z: 0 };
  const screens: ScreenChange[] = options.media
    ? [{ id: newId('screen'), time: 0, media: options.media, transition: 'cut', duration: 0.5, ...(options.from ? { from: options.from } : {}) }]
    : [];
  return {
    id: newId('actor'),
    kind: 'device',
    name: options.name ?? model?.label ?? 'Phone',
    device,
    finish: model?.defaultFinish,
    fit: 'cover',
    glare: 0.25,
    screens,
    poses: [newPose(0, position, options.turn)],
    motion: defaultMotion(),
  };
}

export function newTextActor(text: string, position: XYZ): TextActor {
  return {
    id: newId('actor'),
    kind: 'text',
    name: text.slice(0, 40) || 'Title',
    text,
    font: 'Inter',
    weight: 700,
    size: 1.2,
    color: '#111111',
    align: 'center',
    facing: 'pose',
    poses: [newPose(0, position)],
    motion: defaultMotion(),
  };
}

export function defaultLook(environment: LimelightEnvironment = 'studio'): LimelightLook {
  const preset = environmentPreset(environment);
  return {
    environment,
    backdrop: { ...preset.backdrop },
    light: { ...preset.light },
    exposure: preset.exposure,
    shadow: preset.shadow,
    depthOfField: true,
    vignette: 0.15,
    grain: 0,
  };
}

export function defaultCamera(target: XYZ, distance: number): CameraState {
  // f/8 keeps a turned phone's screen sharp end to end; a wider aperture is a choice the shot makes.
  return { target: { ...target }, azimuth: 0, elevation: 4, distance, roll: 0, lens: 70, aperture: 8, focus: 0 };
}

export function newShot(time: number, camera: CameraState, ease: LimelightEase = 'smooth'): CameraShot {
  return { id: newId('shot'), time, ease, camera: { ...camera, target: { ...camera.target } } };
}

export function defaultFormat(presetId = DEFAULT_FORMAT_PRESET): LimelightFormat {
  const preset = formatPresetById(presetId) ?? formatPresetById(DEFAULT_FORMAT_PRESET)!;
  const duration = preset.rules ? preset.rules.minSeconds : 10;
  return { width: preset.width, height: preset.height, fps: preset.fps, duration, preset: preset.id };
}

export interface NewSceneOptions {
  name?: string;
  format?: LimelightFormat;
  device?: DeviceType;
  media?: string | null;
  from?: ScreenOrigin;
}

/**
 * A scene with one phone turned a little toward the light, and a camera that
 * swings slowly round it from one side to the other over the whole length.
 */
export function newScene(options: NewSceneOptions = {}): LimelightScene {
  const now = Date.now();
  const format = options.format ?? defaultFormat();
  const device = options.device && isStageDevice(options.device) ? options.device : DEFAULT_DEVICE;
  // Turned a little to the light, so the camera opens on a three quarter
  // view that shows the frame's edge and swings round to face the screen.
  const actor = newDeviceActor(device, { media: options.media, from: options.from, turn: { yaw: 14, pitch: -4, roll: 0 } });
  const height = deviceHeight(device);
  const target = { ...actor.poses[0].position };
  const aspect = format.width / format.height;
  const distance = distanceToFrame(height, 0.62, 70, aspect);
  const start: CameraState = { ...defaultCamera(target, distance), azimuth: -22, elevation: 8 };
  const end: CameraState = { ...defaultCamera(target, distance * 0.86), azimuth: 10, elevation: 3 };
  return {
    version: LIMELIGHT_SCENE_VERSION,
    id: newId('scene'),
    name: options.name ?? 'Untitled scene',
    createdAt: now,
    updatedAt: now,
    format,
    look: defaultLook('studio'),
    camera: { shots: [newShot(0, start), newShot(format.duration, end)], shake: 0.15 },
    actors: [actor],
  };
}

// ---------------------------------------------------------------------------
// Reading a scene back
// ---------------------------------------------------------------------------

type Loose = Record<string, unknown>;
/** A loose key whose time has been read. */
type Timed = Loose & { time: number };

function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  // Adding 0 turns -0 into 0, which JSON writes anyway: a scene and its saved copy stay equal.
  return Number.isFinite(n) ? clamp(n, min, max) + 0 : fallback;
}

function str(value: unknown, fallback: string, maxLength = 200): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function color(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (HEX.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  return fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function xyz(value: unknown, fallback: XYZ, limit = 5000): XYZ {
  const v = isObject(value) ? value : {};
  return { x: num(v.x, fallback.x, -limit, limit), y: num(v.y, fallback.y, -limit, limit), z: num(v.z, fallback.z, -limit, limit) };
}

function turn(value: unknown, fallback: Turn): Turn {
  const v = isObject(value) ? value : {};
  return { yaw: num(v.yaw, fallback.yaw, -36000, 36000), pitch: num(v.pitch, fallback.pitch, -36000, 36000), roll: num(v.roll, fallback.roll, -36000, 36000) };
}

/** Keeps ids that are well formed and unused, and gives the rest new ones. */
class IdBook {
  private seen = new Set<string>();
  take(value: unknown, prefix: string): string {
    const id = typeof value === 'string' && ID_PATTERN.test(value) && !this.seen.has(value) ? value : newId(prefix);
    this.seen.add(id);
    return id;
  }
}

function byTime<T extends { time: number }>(items: T[]): T[] {
  return items.map((item, index) => ({ item, index })).sort((a, b) => a.item.time - b.item.time || a.index - b.index).map(({ item }) => item);
}

export function normalizeCamera(value: unknown, fallback: CameraState): CameraState {
  const v = isObject(value) ? value : {};
  return {
    target: xyz(v.target, fallback.target),
    azimuth: num(v.azimuth, fallback.azimuth, -36000, 36000),
    elevation: num(v.elevation, fallback.elevation, -ELEVATION_LIMIT, ELEVATION_LIMIT),
    distance: num(v.distance, fallback.distance, DISTANCE_MIN, DISTANCE_MAX),
    roll: num(v.roll, fallback.roll, -180, 180),
    lens: num(v.lens, fallback.lens, LENS_MIN, LENS_MAX),
    aperture: num(v.aperture, fallback.aperture, APERTURE_MIN, APERTURE_MAX),
    focus: num(v.focus, fallback.focus, -500, 500),
  };
}

function normalizeShots(value: unknown, ids: IdBook, fallback: CameraState): CameraShot[] {
  const list = Array.isArray(value) ? value.slice(0, MAX_KEYS) : [];
  let previous = fallback;
  const shots: CameraShot[] = [];
  for (const raw of byTime(list.filter(isObject).map((shot): Timed => ({ ...shot, time: num(shot.time, 0, 0, 600) })))) {
    const camera = normalizeCamera(raw.camera, previous);
    previous = camera;
    shots.push({ id: ids.take(raw.id, 'shot'), time: raw.time, ease: oneOf(raw.ease, LIMELIGHT_EASES, 'smooth'), camera });
  }
  if (shots.length === 0) shots.push({ id: ids.take(undefined, 'shot'), time: 0, ease: 'smooth', camera: fallback });
  return shots;
}

function normalizePoses(value: unknown, ids: IdBook, fallback: ActorPose): ActorPose[] {
  const list = Array.isArray(value) ? value.slice(0, MAX_KEYS) : [];
  let previous = fallback;
  const poses: ActorPose[] = [];
  for (const raw of byTime(list.filter(isObject).map((pose): Timed => ({ ...pose, time: num(pose.time, 0, 0, 600) })))) {
    const pose: ActorPose = {
      id: ids.take(raw.id, 'pose'),
      time: raw.time,
      ease: oneOf(raw.ease, LIMELIGHT_EASES, 'smooth'),
      position: xyz(raw.position, previous.position),
      turn: turn(raw.turn, previous.turn),
      scale: num(raw.scale, previous.scale, 0, 20),
      opacity: num(raw.opacity, previous.opacity, 0, 1),
    };
    previous = pose;
    poses.push(pose);
  }
  if (poses.length === 0) poses.push({ ...fallback, id: ids.take(undefined, 'pose') });
  return poses;
}

export function normalizeOrigin(value: unknown): ScreenOrigin | undefined {
  if (!isObject(value)) return undefined;
  const projectId = str(value.projectId, '', 120);
  const artboardId = str(value.artboardId, '', 120);
  if (!projectId || !artboardId) return undefined;
  const origin: ScreenOrigin = { projectId, artboardId };
  if (typeof value.elementId === 'string') origin.elementId = value.elementId.slice(0, 120);
  if (typeof value.locale === 'string') origin.locale = value.locale.slice(0, 20);
  return origin;
}

function normalizeScreens(value: unknown, ids: IdBook): ScreenChange[] {
  const list = Array.isArray(value) ? value.slice(0, MAX_SCREENS) : [];
  return byTime(list.filter(isObject).map((screen): Timed => ({ ...screen, time: num(screen.time, 0, 0, 600) }))).map((raw) => {
    const media = typeof raw.media === 'string' && ID_PATTERN.test(raw.media) ? raw.media : null;
    const change: ScreenChange = {
      id: ids.take(raw.id, 'screen'),
      time: raw.time,
      media,
      transition: oneOf<ScreenTransition>(raw.transition, SCREEN_TRANSITIONS, 'fade'),
      duration: num(raw.duration, 0.5, 0, 3),
    };
    const from = normalizeOrigin(raw.from);
    if (from) change.from = from;
    return change;
  });
}

function normalizeMotion(value: unknown): ActorMotion {
  const v = isObject(value) ? value : {};
  return { float: num(v.float, 0, 0, 20), spin: num(v.spin, 0, -720, 720) };
}

function normalizeActor(value: Loose, ids: IdBook, devices: { count: number }): LimelightActor | null {
  const kind = value.kind;
  if (kind !== 'device' && kind !== 'text') return null;
  const id = ids.take(value.id, 'actor');
  const motion = normalizeMotion(value.motion);
  const hidden = value.hidden === true ? true : undefined;
  if (kind === 'device') {
    if (devices.count >= MAX_DEVICES) return null;
    devices.count++;
    const device = isStageDevice(value.device) ? value.device : DEFAULT_DEVICE;
    const model = stageModelFor(device);
    const height = deviceHeight(device);
    const fallback = newPose(0, { x: 0, y: height / 2 + DEFAULT_LIFT, z: 0 });
    const finish = typeof value.finish === 'string' && model ? finishOf(model, value.finish).id : model?.defaultFinish;
    const actor: DeviceActor = {
      id,
      kind: 'device',
      name: str(value.name, model?.label ?? 'Phone', 80) || (model?.label ?? 'Phone'),
      device,
      finish,
      fit: oneOf(value.fit, ['cover', 'contain'] as const, 'cover'),
      glare: num(value.glare, 0.25, 0, 1),
      screens: normalizeScreens(value.screens, ids),
      poses: normalizePoses(value.poses, ids, fallback),
      motion,
    };
    const custom = color(value.color, '');
    if (custom) actor.color = custom;
    if (model?.fold && value.fold !== undefined) actor.fold = num(value.fold, model.fold.opening, 0, 180);
    if (hidden) actor.hidden = true;
    return actor;
  }
  const fallback = newPose(0, { x: 0, y: 10, z: 0 });
  const text = str(value.text, 'Title', 200);
  const actor: TextActor = {
    id,
    kind: 'text',
    name: str(value.name, text.slice(0, 40) || 'Title', 80) || 'Title',
    text,
    font: str(value.font, 'Inter', 80) || 'Inter',
    weight: Math.round(num(value.weight, 700, 100, 900) / 100) * 100,
    size: num(value.size, 2, 0.2, 100),
    color: color(value.color, '#111111'),
    align: oneOf(value.align, ['left', 'center', 'right'] as const, 'center'),
    facing: oneOf(value.facing, ['pose', 'camera'] as const, 'pose'),
    poses: normalizePoses(value.poses, ids, fallback),
    motion,
  };
  if (hidden) actor.hidden = true;
  return actor;
}

function normalizeBackdrop(value: unknown, fallback: LimelightBackdrop): LimelightBackdrop {
  const v = isObject(value) ? value : {};
  return {
    style: oneOf(v.style, ['solid', 'linear', 'radial'] as const, fallback.style),
    top: color(v.top, fallback.top),
    bottom: color(v.bottom, fallback.bottom),
  };
}

export function normalizeLook(value: unknown): LimelightLook {
  const v = isObject(value) ? value : {};
  const environment = oneOf(v.environment, LIMELIGHT_ENVIRONMENTS, 'studio');
  const base = defaultLook(environment);
  const light = isObject(v.light) ? v.light : {};
  return {
    environment,
    backdrop: normalizeBackdrop(v.backdrop, base.backdrop),
    light: {
      azimuth: num(light.azimuth, base.light.azimuth, -360, 360),
      elevation: num(light.elevation, base.light.elevation, -10, 90),
      intensity: num(light.intensity, base.light.intensity, 0, 3),
    },
    exposure: num(v.exposure, base.exposure, 0.25, 3),
    shadow: num(v.shadow, base.shadow, 0, 1),
    depthOfField: typeof v.depthOfField === 'boolean' ? v.depthOfField : base.depthOfField,
    vignette: num(v.vignette, base.vignette, 0, 1),
    grain: num(v.grain, base.grain, 0, 1),
  };
}

export function normalizeFormat(value: unknown): LimelightFormat {
  const v = isObject(value) ? value : {};
  const base = defaultFormat();
  const even = (n: number) => Math.round(n / 2) * 2;
  const format: LimelightFormat = {
    width: even(num(v.width, base.width, SIZE_MIN, SIZE_MAX)),
    height: even(num(v.height, base.height, SIZE_MIN, SIZE_MAX)),
    fps: Math.round(num(v.fps, base.fps, 12, 60)),
    duration: Math.round(num(v.duration, base.duration, DURATION_MIN, DURATION_MAX) * 100) / 100,
  };
  const preset = formatPresetById(typeof v.preset === 'string' ? v.preset : undefined);
  if (preset && preset.width === format.width && preset.height === format.height) format.preset = preset.id;
  return format;
}

/** Any input as a scene the stage can draw. */
export function normalizeScene(value: unknown): LimelightScene {
  const v = isObject(value) ? value : {};
  const ids = new IdBook();
  const now = Date.now();
  const format = normalizeFormat(v.format);
  const devices = { count: 0 };
  const actors: LimelightActor[] = [];
  for (const raw of Array.isArray(v.actors) ? v.actors : []) {
    if (actors.length >= MAX_ACTORS) break;
    if (!isObject(raw)) continue;
    const actor = normalizeActor(raw, ids, devices);
    if (actor) actors.push(actor);
  }
  const firstDevice = actors.find((actor): actor is DeviceActor => actor.kind === 'device');
  const target = firstDevice ? { ...firstDevice.poses[0].position } : { x: 0, y: 9.5, z: 0 };
  const fallbackCamera = defaultCamera(target, distanceToFrame(firstDevice ? deviceHeight(firstDevice.device) : 15, 0.62, 70, format.width / format.height));
  const camera = isObject(v.camera) ? v.camera : {};
  const scene: LimelightScene = {
    version: LIMELIGHT_SCENE_VERSION,
    id: ids.take(v.id, 'scene'),
    name: str(v.name, 'Untitled scene', 80).trim() || 'Untitled scene',
    createdAt: num(v.createdAt, now, 0),
    updatedAt: num(v.updatedAt, now, 0),
    format,
    look: normalizeLook(v.look),
    camera: { shots: normalizeShots(camera.shots, ids, fallbackCamera), shake: num(camera.shake, 0, 0, 1) },
    actors,
  };
  if (typeof v.template === 'string' && ID_PATTERN.test(v.template)) scene.template = v.template;
  return scene;
}

/** The media ids a scene's screens show. */
export function sceneMediaIds(scene: LimelightScene): Set<string> {
  const ids = new Set<string>();
  for (const actor of scene.actors) {
    if (actor.kind !== 'device') continue;
    for (const screen of actor.screens) if (screen.media) ids.add(screen.media);
  }
  return ids;
}
