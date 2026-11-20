/**
 * Limelight's built-in scenes: ready camera moves the user's screenshots go
 * into.
 *
 * A template is a builder, not a stored scene: it places its devices, fills
 * their screens with the pictures it is given, and frames every shot for the
 * video's size with `cameraToFitAll`, so the same template works for a tall
 * App Store preview, a square post and a 4K video. The result is a plain
 * scene the user edits like any other; `template` on it says where it came
 * from. Everything here is pure, so a template can be previewed and tested
 * without a stage.
 *
 * The small ones are built here. A bigger one (the App intro) keeps its
 * builder in a file of its own that `load` brings in the first time it is
 * needed, so the editor carries only the list below, and the builder comes
 * with the Limelight view's gallery or an agent's request.
 */

import type { DeviceType } from '@/types/artboard';
import type { FoundCard } from './cards';
import { cameraToFitAll, freeName } from './edit';
import { defaultFormat, defaultLook, deviceHeight, deviceWidth, newDeviceActor, newId, newScene, newShot, newTextActor, normalizeScene, DEFAULT_LIFT } from './scene';
import type {
  CameraState,
  DeviceActor,
  LimelightActor,
  LimelightEase,
  LimelightEnvironment,
  LimelightFormat,
  LimelightScene,
  ScreenChange,
  ScreenTransition,
  Turn,
} from './types';

export interface TemplateInput {
  format?: LimelightFormat;
  /** Media ids for the screens, in the order they should show. */
  pictures: string[];
  /** The app's name, for templates with a title. */
  title?: string;
  /** The phone to use; unset is the default phone. */
  device?: DeviceType;
  name?: string;
  /**
   * The headline of each picture, in the same order, where its artboard has
   * one (`artboardHeadline` in projectShots.ts), for templates with captions.
   */
  captions?: Array<string | undefined>;
  /** The project's own colour, #rrggbb, for templates that take one. */
  accent?: string;
  /** The project's own font family, for templates that take one. */
  font?: string;
  /** A media id for the app's icon, square, for templates that close on it. */
  icon?: string;
  /**
   * A card worth lifting off each picture (findCard in cards.ts), in the same
   * order as `pictures`, for templates that lift one.
   */
  cards?: Array<FoundCard | null | undefined>;
}

/** A template's builder; one that measures words loads their faces first, so it may answer later. */
export type TemplateBuilder = (input: TemplateInput) => LimelightScene | Promise<LimelightScene>;

interface TemplateInfo {
  id: string;
  /** The name on the card. */
  name: string;
  /** One line on the card: what the camera does. */
  hint: string;
  /** How many screenshots it shows at once, at most. */
  devices: number;
  /** How many of the pictures it is given it shows, when that is fewer than all of them. */
  pictures?: number;
  environment: LimelightEnvironment;
  /** The share of the length the gallery's preview is drawn at. Unset is 0.32. */
  poster?: number;
  /** It closes on the app's icon, so it is given one when the project has it. */
  icon?: boolean;
  /** It lifts a card off each screen, so it is given the cards found in them. */
  cards?: boolean;
}

/** Built here, or brought in from its own file the first time it is needed. */
export type LimelightTemplate = TemplateInfo & ({ build: TemplateBuilder; load?: undefined } | { load: () => Promise<TemplateBuilder>; build?: undefined });

interface ShotSpec {
  /** Share of the video's length, 0 to 1. */
  at: number;
  azimuth: number;
  elevation: number;
  /** Distance as a multiple of the distance that fits everything. Below 1 is closer. */
  pull?: number;
  roll?: number;
  lens?: number;
  ease?: LimelightEase;
  /** Moves the target up or down, in centimetres, from the middle of everything. */
  lift?: number;
  /** Seconds: frames the actors as they are then, for a shot taken before they arrive. */
  fitAt?: number;
}

function placeScreens(pictures: string[], from: number, to: number, transition: ScreenTransition): ScreenChange[] {
  if (pictures.length === 0) return [];
  const step = pictures.length > 1 ? (to - from) / pictures.length : 0;
  return pictures.map((media, i) => ({
    id: newId('screen'),
    time: Math.round((from + step * i) * 100) / 100,
    media,
    transition: i === 0 ? 'cut' : transition,
    duration: 0.55,
  }));
}

function device(type: DeviceType, x: number, z: number, turn: Turn, screens: ScreenChange[], lift = DEFAULT_LIFT): DeviceActor {
  const actor = newDeviceActor(type, { position: { x, y: deviceHeight(type) / 2 + lift, z }, turn });
  actor.screens = screens;
  return actor;
}

/** A scene of these actors in this look, with shots framed for the size. */
function assemble(id: string, input: TemplateInput, environment: LimelightEnvironment, actors: LimelightActor[], shots: ShotSpec[], extra: { shake?: number; duration?: number } = {}): LimelightScene {
  const base = newScene({ format: input.format ?? defaultFormat(), name: input.name });
  const format = { ...base.format, duration: extra.duration ?? base.format.duration };
  let scene: LimelightScene = { ...base, format, look: defaultLook(environment), actors: [], template: id };
  for (const actor of actors) scene = { ...scene, actors: [...scene.actors, { ...actor, name: freeName(scene, actor.name) }] };
  const lens = 70;
  const cameraShots = shots.map((spec) => {
    const time = Math.round(spec.at * format.duration * 100) / 100;
    const angle: CameraState = { ...base.camera.shots[0].camera, azimuth: spec.azimuth, elevation: spec.elevation, roll: spec.roll ?? 0, lens: spec.lens ?? lens };
    const fit = cameraToFitAll(scene, spec.fitAt ?? time, angle);
    return newShot(time, { ...fit, target: { ...fit.target, y: fit.target.y + (spec.lift ?? 0) }, distance: fit.distance * (spec.pull ?? 1) }, spec.ease ?? 'smooth');
  });
  return normalizeScene({ ...scene, camera: { shots: cameraShots, shake: extra.shake ?? 0.12 } });
}

const phoneOf = (input: TemplateInput): DeviceType => input.device ?? 'iphone-17-pro';

/** The pictures for one of several devices: device k of n takes every nth picture, from the kth. */
function share(pictures: string[], k: number, n: number): string[] {
  const own = pictures.filter((_, i) => i % n === k);
  return own.length > 0 ? own : pictures.length > 0 ? [pictures[k % pictures.length]] : [];
}

export const TEMPLATES: LimelightTemplate[] = [
  {
    id: 'app-intro',
    name: 'App intro',
    hint: "Your app's name, your screens with their headlines, and your icon",
    devices: 3,
    pictures: 4,
    environment: 'night',
    poster: 0.2,
    icon: true,
    cards: true,
    load: () => import('./introTemplate').then((module) => module.buildAppIntro),
  },
  {
    id: 'hero-orbit',
    name: 'Hero orbit',
    hint: 'The camera glides round one phone from side to side',
    devices: 1,
    environment: 'studio',
    build: (input) => {
      const d = 15;
      const phone = device(phoneOf(input), 0, 0, { yaw: 10, pitch: -3, roll: 0 }, placeScreens(input.pictures, 0, d, 'slide'));
      phone.motion = { float: 0.6, spin: 0 };
      return assemble('hero-orbit', input, 'studio', [phone], [
        { at: 0, azimuth: -34, elevation: 10, pull: 1.12, ease: 'glide' },
        { at: 0.5, azimuth: -4, elevation: 4, pull: 0.98, ease: 'glide' },
        { at: 1, azimuth: 28, elevation: 7, pull: 1.04, ease: 'glide' },
      ], { duration: d });
    },
  },
  {
    id: 'push-in',
    name: 'Push in',
    hint: 'Starts wide and moves in close on the screen',
    devices: 1,
    environment: 'daylight',
    build: (input) => {
      const d = 15;
      const phone = device(phoneOf(input), 0, 0, { yaw: 0, pitch: 0, roll: 0 }, placeScreens(input.pictures, 0, d, 'scroll'));
      return assemble('push-in', input, 'daylight', [phone], [
        { at: 0, azimuth: -18, elevation: 14, pull: 1.6, ease: 'snappy' },
        { at: 0.35, azimuth: -6, elevation: 5, pull: 1, ease: 'smooth' },
        { at: 1, azimuth: 0, elevation: 2, pull: 0.62, ease: 'smooth' },
      ], { duration: d, shake: 0.08 });
    },
  },
  {
    id: 'side-by-side',
    name: 'Side by side',
    hint: 'Three phones in a row, the camera drifts across them',
    devices: 3,
    environment: 'studio',
    build: (input) => {
      const type = phoneOf(input);
      const gap = deviceWidth(type) + 2.6;
      const d = 15;
      // The middle phone, a little forward, takes the first picture; left the second, right the third.
      const order = [1, 0, 2];
      const phones = [-1, 0, 1].map((k) =>
        device(type, k * gap, k === 0 ? 3 : 0, { yaw: -k * 12, pitch: 0, roll: 0 }, placeScreens(share(input.pictures, order[k + 1], 3), 0, d, 'slide'))
      );
      phones.forEach((phone) => (phone.motion = { float: 0.4, spin: 0 }));
      return assemble('side-by-side', input, 'studio', phones, [
        { at: 0, azimuth: -16, elevation: 8, pull: 1.02, ease: 'glide' },
        { at: 1, azimuth: 16, elevation: 5, pull: 0.94, ease: 'glide' },
      ], { duration: d });
    },
  },
  {
    id: 'spin-reveal',
    name: 'Spin reveal',
    hint: 'The phone turns round from its back to face you',
    devices: 1,
    environment: 'night',
    build: (input) => {
      const d = 15;
      const phone = device(phoneOf(input), 0, 0, { yaw: 180, pitch: 0, roll: 0 }, placeScreens(input.pictures, 1.6, d, 'zoom'));
      phone.poses = [
        { ...phone.poses[0], time: 0, ease: 'snappy' },
        { ...phone.poses[0], id: newId('pose'), time: 2.2, turn: { yaw: 8, pitch: -2, roll: 0 }, ease: 'smooth' },
        { ...phone.poses[0], id: newId('pose'), time: d, turn: { yaw: -6, pitch: -2, roll: 0 }, ease: 'smooth' },
      ];
      return assemble('spin-reveal', input, 'night', [phone], [
        { at: 0, azimuth: 0, elevation: 2, pull: 1.25, ease: 'snappy' },
        { at: 0.2, azimuth: -10, elevation: 8, pull: 1, ease: 'glide' },
        { at: 1, azimuth: 12, elevation: 5, pull: 0.92, ease: 'glide' },
      ], { duration: d });
    },
  },
  {
    id: 'low-hero',
    name: 'Low hero',
    hint: 'Looks up at a tall phone, with your app name over it',
    devices: 1,
    environment: 'sunset',
    build: (input) => {
      const d = 15;
      const type = phoneOf(input);
      const phone = device(type, 0, 0, { yaw: -12, pitch: 4, roll: 0 }, placeScreens(input.pictures, 0, d, 'slide'));
      const title = newTextActor(input.title?.trim() || 'Your app', { x: 0, y: deviceHeight(type) + DEFAULT_LIFT + 3.2, z: -1 });
      title.color = '#ffffff';
      title.size = 1.3;
      return assemble('low-hero', input, 'sunset', [phone, title], [
        { at: 0, azimuth: -20, elevation: -14, pull: 1.15, ease: 'glide', lens: 50 },
        { at: 1, azimuth: 10, elevation: -9, pull: 0.98, ease: 'glide', lens: 50 },
      ], { duration: d });
    },
  },
  {
    id: 'floating-stack',
    name: 'Floating stack',
    hint: 'Three phones one behind another, drifting',
    devices: 3,
    environment: 'night',
    build: (input) => {
      const type = phoneOf(input);
      const d = 15;
      const phones = [0, 1, 2].map((k) => {
        const phone = device(type, (k - 1) * 4.5, -k * 7, { yaw: 18, pitch: -4, roll: 0 }, placeScreens(share(input.pictures, k, 3), 0, d, 'fade'), DEFAULT_LIFT + k * 1.5);
        phone.motion = { float: 0.8, spin: 0 };
        return phone;
      });
      return assemble('floating-stack', input, 'night', phones, [
        { at: 0, azimuth: -30, elevation: 10, pull: 1.05, ease: 'glide' },
        { at: 1, azimuth: 6, elevation: 4, pull: 0.95, ease: 'glide' },
      ], { duration: d, shake: 0.18 });
    },
  },
  {
    id: 'flyover',
    name: 'Flyover',
    hint: 'Phones lie on a table and the camera flies over them',
    devices: 3,
    environment: 'daylight',
    build: (input) => {
      const type = phoneOf(input);
      const gap = deviceWidth(type) + 3;
      const d = 15;
      const thick = 0.9;
      const phones = [-1, 0, 1].map((k) =>
        device(type, k * gap, k * 1.5, { yaw: 0, pitch: -90, roll: k * 4 }, placeScreens(share(input.pictures, k + 1, 3), 0, d, 'scroll'), thick / 2 - deviceHeight(type) / 2)
      );
      return assemble('flyover', input, 'daylight', phones, [
        { at: 0, azimuth: -40, elevation: 62, pull: 1.05, ease: 'glide' },
        { at: 1, azimuth: 30, elevation: 42, pull: 0.9, ease: 'glide' },
      ], { duration: d, shake: 0.06 });
    },
  },
  {
    id: 'phone-and-tablet',
    name: 'Phone and tablet',
    hint: 'An iPad and a phone together, the camera swings round',
    devices: 2,
    environment: 'studio',
    build: (input) => {
      const d = 15;
      const tablet = device('ipad-pro-13', -6, -4, { yaw: 14, pitch: -3, roll: 0 }, placeScreens(share(input.pictures, 0, 2), 0, d, 'fade'));
      const type = phoneOf(input);
      const phone = device(type, deviceWidth('ipad-pro-13') / 2 + 1, 5, { yaw: -16, pitch: -3, roll: 0 }, placeScreens(share(input.pictures, 1, 2), 0, d, 'slide'));
      return assemble('phone-and-tablet', input, 'studio', [tablet, phone], [
        { at: 0, azimuth: -22, elevation: 9, pull: 1.04, ease: 'glide' },
        { at: 1, azimuth: 18, elevation: 6, pull: 0.97, ease: 'glide' },
      ], { duration: d });
    },
  },
  {
    id: 'title-opener',
    name: 'Title opener',
    hint: 'Your app name first, then the phone rises into view',
    devices: 1,
    environment: 'noir',
    build: (input) => {
      const d = 15;
      const type = phoneOf(input);
      const title = newTextActor(input.title?.trim() || 'Your app', { x: 0, y: deviceHeight(type) / 2 + DEFAULT_LIFT, z: 6 });
      title.color = '#ffffff';
      title.size = 1.6;
      title.poses = [
        { ...title.poses[0], time: 0, opacity: 0, ease: 'smooth' },
        { ...title.poses[0], id: newId('pose'), time: 1, opacity: 1, ease: 'smooth' },
        { ...title.poses[0], id: newId('pose'), time: 3, opacity: 1, ease: 'smooth' },
        { ...title.poses[0], id: newId('pose'), time: 4, opacity: 0, position: { ...title.poses[0].position, y: title.poses[0].position.y + 6 }, ease: 'smooth' },
      ];
      const phone = device(type, 0, 0, { yaw: 10, pitch: -3, roll: 0 }, placeScreens(input.pictures, 3.5, d, 'slide'));
      const rest = phone.poses[0];
      phone.poses = [
        { ...rest, time: 0, position: { ...rest.position, y: rest.position.y - deviceHeight(type) * 1.6 }, ease: 'smooth' },
        { ...rest, id: newId('pose'), time: 3, position: { ...rest.position, y: rest.position.y - deviceHeight(type) * 1.6 }, ease: 'snappy' },
        { ...rest, id: newId('pose'), time: 5, ease: 'smooth' },
      ];
      return assemble('title-opener', input, 'noir', [phone, title], [
        // Framed for the phone after it has risen, so the shot waits for it.
        { at: 0, azimuth: 0, elevation: 3, pull: 1.05, ease: 'cut', fitAt: 5 },
        { at: 0.2, azimuth: 0, elevation: 3, pull: 1.05, ease: 'glide', fitAt: 5 },
        { at: 1, azimuth: 16, elevation: 6, pull: 0.94, ease: 'glide' },
      ], { duration: d });
    },
  },
  {
    id: 'turntable',
    name: 'Turntable',
    hint: 'The phone turns round and round, for a video that loops',
    devices: 1,
    environment: 'studio',
    build: (input) => {
      const d = 12;
      const phone = device(phoneOf(input), 0, 0, { yaw: 0, pitch: -4, roll: 0 }, placeScreens(input.pictures.slice(0, 1), 0, d, 'cut'));
      // One whole turn in the length of the video, so the end meets the start.
      phone.motion = { float: 0, spin: 360 / d };
      return assemble('turntable', input, 'studio', [phone], [{ at: 0, azimuth: 0, elevation: 9, pull: 1.02, ease: 'smooth' }], { duration: d, shake: 0 });
    },
  },
];

export function templateById(id: string): LimelightTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

/** The template's builder, brought in from its own file for one that has one. */
export async function templateBuilder(template: LimelightTemplate): Promise<TemplateBuilder> {
  return template.build ?? (await template.load());
}

/** A scene from a built-in template, or null for an id that isn't one. */
export async function buildTemplate(id: string, input: TemplateInput): Promise<LimelightScene | null> {
  const template = templateById(id);
  if (!template) return null;
  const scene = await (await templateBuilder(template))(input);
  return { ...scene, name: input.name?.trim() || template.name };
}

/**
 * A new scene from one the user kept as a template. Its devices' screens take
 * the new pictures in the order they had theirs, device after device; with
 * no new pictures, the template's own stay.
 */
export function fromMyTemplate(saved: LimelightScene, pictures: string[], name?: string): LimelightScene {
  const now = Date.now();
  let next = 0;
  // A card cut from one of the template's own screenshots (the App intro lifts
  // them) would show that old screen's part over the new pictures, so it goes
  // when new pictures come; a card of anything else, such as an icon, stays.
  const screenPictures = new Set(saved.actors.flatMap((actor) => (actor.kind === 'device' ? actor.screens.map((screen) => screen.media) : [])));
  const kept = pictures.length > 0 ? saved.actors.filter((actor) => actor.kind !== 'picture' || !actor.media || !screenPictures.has(actor.media)) : saved.actors;
  const actors = kept.map((actor): LimelightActor => {
    const poses = actor.poses.map((pose) => ({ ...pose, id: newId('pose') }));
    if (actor.kind !== 'device') return { ...actor, id: newId('actor'), poses };
    return {
      ...actor,
      id: newId('actor'),
      poses,
      screens: actor.screens.map((screen) => {
        const media = pictures.length > 0 ? pictures[next++ % pictures.length] : screen.media;
        return { ...screen, id: newId('screen'), media, from: pictures.length > 0 ? undefined : screen.from };
      }),
    };
  });
  return normalizeScene({
    ...saved,
    id: newId('scene'),
    name: name?.trim() || saved.name,
    createdAt: now,
    updatedAt: now,
    camera: { ...saved.camera, shots: saved.camera.shots.map((shot) => ({ ...shot, id: newId('shot') })) },
    actors,
  });
}
