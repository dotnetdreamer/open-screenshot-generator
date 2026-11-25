// A film's life: made from a recording, its moments edited, planned. Pure,
// so the view and the tests share every rule.

import { studioModelFor } from '@/lib/device3dStudio';
import { displayInsetsOf } from '@/lib/device3dModels';
import type { DeviceType } from '@/types/artboard';
import { backdropFor, DEFAULT_BACKDROP, luminance, parseColor } from './looks';
import { planFilm, type PhoneShape } from './plan';
import { filmDuration } from './frame';
import type { FilmTemplate } from './templates';
import { bodyLength, cutTimes, filmMoments } from './timeline';
import type { Film, FilmLook, FilmPlan, Moment, MomentKind, MotionTake } from './types';

export { MAX_FILM_SECONDS } from './timeline';

/** The phones a film can use, newest first, iPhones then Android. */
export const FILM_PHONES: { deviceType: DeviceType; label: string; platform: 'ios' | 'android' }[] = [
  { deviceType: 'iphone-18-pro', label: 'iPhone 18 Pro', platform: 'ios' },
  { deviceType: 'iphone-18-pro-max', label: 'iPhone 18 Pro Max', platform: 'ios' },
  { deviceType: 'iphone-17-pro', label: 'iPhone 17 Pro', platform: 'ios' },
  { deviceType: 'iphone-17-pro-max', label: 'iPhone 17 Pro Max', platform: 'ios' },
  { deviceType: 'iphone-air', label: 'iPhone Air', platform: 'ios' },
  { deviceType: 'iphone-17', label: 'iPhone 17', platform: 'ios' },
  { deviceType: 'iphone-16', label: 'iPhone 16', platform: 'ios' },
  { deviceType: 'iphone-16e', label: 'iPhone 16e', platform: 'ios' },
  { deviceType: 'pixel-10-pro', label: 'Pixel 10 Pro', platform: 'android' },
  { deviceType: 'pixel-10a', label: 'Pixel 10a', platform: 'android' },
  { deviceType: 'pixel-4', label: 'Pixel 4', platform: 'android' },
  { deviceType: 'android-punch-hole', label: 'Android phone', platform: 'android' },
];

/**
 * The phone that suits a recording, from its shape: a recent iPhone records
 * at 19.5 by 9, most Android phones at 20 by 9 or 19 by 9, older phones at
 * 18 by 9 or 16 by 9.
 */
export function phoneForRecording(width: number, height: number): DeviceType {
  const aspect = Math.min(width, height) / Math.max(width, height);
  if (aspect < 0.455) return 'pixel-10-pro';
  if (aspect < 0.47) return 'iphone-17-pro';
  if (aspect < 0.49) return 'pixel-4';
  return 'android-punch-hole';
}

/**
 * The phone's finish: the one the user picked, or else the one that stands
 * out most from the backdrop, so a dark phone never melts into a dark
 * backdrop (silver on Midnight, black on Studio).
 */
export function finishFor(deviceType: DeviceType, picked: string | undefined, look: FilmLook): string | undefined {
  const model = studioModelFor(deviceType);
  if (!model || model.finishes.length === 0) return picked;
  if (picked && model.finishes.some((f) => f.id === picked)) return picked;
  const backdrop = backdropFor(look);
  const top = parseColor(backdrop.top);
  const bottom = parseColor(backdrop.bottom);
  const ground = top && bottom ? (luminance(top) + luminance(bottom)) / 2 : 0.1;
  let best = model.finishes[0];
  let bestGap = -1;
  for (const finish of model.finishes) {
    const rgb = parseColor(finish.frame);
    if (!rgb) continue;
    const gap = Math.abs(luminance(rgb) - ground);
    if (gap > bestGap + 0.02) {
      best = finish;
      bestGap = gap;
    }
  }
  return best.id;
}

/** The phone's proportions for the planner, from the 3D Studio's measurements. */
export function phoneShape(deviceType: DeviceType): PhoneShape {
  const model = studioModelFor(deviceType);
  if (!model) return { width: 0.48, screenW: 0.44, screenH: 0.94 };
  const insets = displayInsetsOf(model);
  const screenH = model.height - insets.top - insets.bottom;
  return { width: model.width / model.height, screenW: model.display.width / model.height, screenH: screenH / model.height };
}

function newId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export interface NewFilmOptions {
  projectId: string | null;
  /** The app's name, for the title. */
  title?: string;
  /** The project's colours, for the brand backdrop. */
  colors?: [string, string, string] | null;
  /** The starting point the user picked. */
  template?: FilmTemplate | null;
}

/** Seconds a film without a recording runs at first, for moves recorded before the recording. */
export const PLACEHOLDER_SECONDS = 15;

/** A new film with no recording yet: a template's look, or the defaults. */
export function newFilm(options: NewFilmOptions): Film {
  const now = Date.now();
  const template = options.template ?? null;
  const brand = template ? template.backdrop === 'brand' && !!options.colors : !!options.colors;
  const title = options.title?.trim() ?? '';
  return {
    id: newId('film'),
    version: 2,
    name: title ? `${title} video` : template ? `${template.name} video` : 'New video',
    createdAt: now,
    updatedAt: now,
    projectId: options.projectId,
    template: template?.id,
    clips: [],
    placeholderLength: PLACEHOLDER_SECONDS,
    format: template?.format ?? 'vertical',
    fps: 30,
    style: template?.style ?? 'lively',
    look:
      brand && options.colors
        ? { backdrop: 'brand', colors: options.colors }
        : { backdrop: template && template.backdrop !== 'brand' ? template.backdrop : DEFAULT_BACKDROP },
    phone: { deviceType: 'iphone-17-pro' },
    text: {
      title: template && !template.title ? '' : title,
      end: template?.end ?? '',
      captions: template?.captions ?? true,
      taps: template?.taps ?? true,
      ...(template?.words ? { style: template.words } : {}),
      ...(template?.logo ? { logo: true } : {}),
      ...(template?.card ? { card: { on: true, name: '', appStore: true, googlePlay: true, light: template.card.light } } : {}),
    },
    sound: { recording: true },
    motion: 'auto',
    take: null,
    takeStrength: 0.85,
  };
}

/**
 * A take kept on the film, and used. Made before there's a recording and
 * stopped early, it sets how long the film runs; one that ran to the end (the
 * end words included) leaves the length as it was.
 */
export function withTake(film: Film, take: MotionTake): Film {
  const end = take.samples[take.samples.length - 1]?.t ?? 0;
  const early = !film.clips.length && end >= 3 && end < film.placeholderLength - 0.25;
  return { ...film, take, motion: 'hand', placeholderLength: early ? Math.round(end * 2) / 2 : film.placeholderLength };
}

/** The phone that suits the film's first recording, unless the user picked one. */
export function fitPhone(film: Film): Film {
  const first = film.clips[0];
  if (!first || film.phone.picked) return film;
  const deviceType = phoneForRecording(first.width, first.height);
  return deviceType === film.phone.deviceType ? film : { ...film, phone: { ...film.phone, deviceType, finish: undefined } };
}

/** Where the recording changes, as a new screen for the planner: the camera swings, and nothing closes up across it. */
function cutMoment(t: number, index: number): Moment {
  return { id: `cut${index + 1}`, kind: 'screen', start: t, end: t + 0.4, focus: null, weight: 0.8, shot: 'auto' };
}

/** The director's plan for a film as it is now. */
export function planFor(film: Film): FilmPlan {
  const cuts = cutTimes(film);
  return planFilm({
    duration: filmDuration(film),
    recordingEnd: bodyLength(film),
    moments: [...filmMoments(film), ...cuts.map(cutMoment)].sort((a, b) => a.start - b.start),
    cuts,
    style: film.style,
    format: film.format,
    phone: phoneShape(film.phone.deviceType),
    text: film.text,
  });
}

/** Plain words for a moment's kind, for the timeline. */
export const MOMENT_WORDS: Record<MomentKind, string> = {
  tap: 'Tap',
  type: 'Typing',
  scroll: 'Scroll',
  screen: 'New screen',
  change: 'Animation',
  still: 'Pause',
};
