// A film's life: made from a recording, its moments edited, planned. Pure,
// so the view and the tests share every rule.

import { studioModelFor } from '@/lib/device3dStudio';
import { displayInsetsOf } from '@/lib/device3dModels';
import type { DeviceType } from '@/types/artboard';
import { ANALYSIS_VERSION } from './analyze';
import { backdropFor, DEFAULT_BACKDROP, luminance, parseColor } from './looks';
import { planFilm, type PhoneShape } from './plan';
import { filmDuration } from './frame';
import type { ActivityTrack, Film, FilmLook, FilmPlan, FilmSource, Moment, MomentKind, Rect01 } from './types';

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
}

/** The longest recording a film takes, in seconds. A longer one is trimmed to it. */
export const MAX_FILM_SECONDS = 90;

export function newFilm(source: FilmSource, options: NewFilmOptions): Film {
  const now = Date.now();
  const end = Math.min(source.duration, MAX_FILM_SECONDS);
  return {
    id: newId('film'),
    name: source.name.replace(/\.[a-z0-9]{2,4}$/i, '') || 'Film',
    createdAt: now,
    updatedAt: now,
    projectId: options.projectId,
    source,
    trim: { start: 0, end },
    format: 'vertical',
    fps: 30,
    style: 'lively',
    look: options.colors ? { backdrop: 'brand', colors: options.colors } : { backdrop: DEFAULT_BACKDROP },
    phone: { deviceType: phoneForRecording(source.width, source.height) },
    text: { title: options.title?.trim() ?? '', end: '', captions: true, taps: true },
    sound: { recording: true },
    moments: [],
    activity: null,
    analysisVersion: 0,
    motion: 'auto',
    take: null,
    takeStrength: 0.85,
  };
}

/** The recording's length after the trim. */
export function trimLength(film: Pick<Film, 'trim'>): number {
  return Math.max(0.5, film.trim.end - film.trim.start);
}

/** The director's plan for a film as it is now. */
export function planFor(film: Film): FilmPlan {
  return planFilm({
    duration: filmDuration(film),
    recordingEnd: trimLength(film),
    moments: film.moments,
    style: film.style,
    format: film.format,
    phone: phoneShape(film.phone.deviceType),
    text: film.text,
  });
}

/**
 * A new analysis's moments, keeping the ones the user changed: an edited
 * moment stays as it is, and found moments that overlap it are left out.
 */
export function mergeMoments(found: Moment[], previous: Moment[]): Moment[] {
  const kept = previous.filter((m) => m.edited);
  const fresh = found.filter((m) => !kept.some((k) => m.start < k.end && m.end > k.start));
  const all = [...kept, ...fresh].sort((a, b) => a.start - b.start);
  // Fresh ids may repeat an edited one's: give every moment its own.
  const seen = new Set<string>();
  return all.map((m, index) => {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      return m;
    }
    let n = index + 1;
    while (seen.has(`m${n}`)) n += 1;
    seen.add(`m${n}`);
    return { ...m, id: `m${n}` };
  });
}

export function withAnalysis(film: Film, found: Moment[], activity: ActivityTrack): Film {
  return { ...film, moments: mergeMoments(found, film.moments), activity, analysisVersion: ANALYSIS_VERSION, updatedAt: Date.now() };
}

/** A change to one moment, marking it as the user's. */
export function editMoment(film: Film, id: string, patch: Partial<Omit<Moment, 'id'>>): Film {
  const length = trimLength(film);
  const moments = film.moments
    .map((m) => {
      if (m.id !== id) return m;
      const next = { ...m, ...patch, edited: true };
      const span = Math.max(0.2, next.end - next.start);
      next.start = Math.min(Math.max(0, next.start), Math.max(0, length - 0.2));
      next.end = Math.min(length, next.start + span);
      return next;
    })
    .sort((a, b) => a.start - b.start);
  return { ...film, moments, updatedAt: Date.now() };
}

/** A moment the user adds at `t`: a close-up on the middle of the screen, which they then move. */
export function addMoment(film: Film, t: number, kind: MomentKind = 'tap', focus: Rect01 = { x: 0.2, y: 0.35, w: 0.6, h: 0.22 }): { film: Film; id: string } {
  const length = trimLength(film);
  let n = film.moments.length + 1;
  while (film.moments.some((m) => m.id === `m${n}`)) n += 1;
  const id = `m${n}`;
  const start = Math.min(Math.max(0, t), Math.max(0, length - 0.6));
  const moment: Moment = { id, kind, start, end: Math.min(length, start + 1.2), focus, weight: 1, shot: 'close', edited: true };
  return { film: { ...film, moments: [...film.moments, moment].sort((a, b) => a.start - b.start), updatedAt: Date.now() }, id };
}

export function removeMoment(film: Film, id: string): Film {
  return { ...film, moments: film.moments.filter((m) => m.id !== id), updatedAt: Date.now() };
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
