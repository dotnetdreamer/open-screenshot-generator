// A project's design on another device: the artboards laid out again for the
// device's size, with the frame each screenshot belongs in.
//
// What a person chose is kept on the artboards themselves, because a Project
// field does not survive the next save (rule 1 in .agents/AGENTS.md):
//
//   deviceSets        per artboard, per device: the layout picked and the
//                     screenshots added for that device only
//   deviceSetFormats  which devices the project makes, mirrored onto every
//                     artboard the way ProjectLocalization is
//
// The frame follows the screenshot. An iPad set shows an iPad only when the
// frame has a screenshot of that shape to show, the one added for the iPad
// set or a template's own art; an iPhone screenshot stays in an iPhone,
// because cropped into an iPad it would show a different screen.

import type {
  ArtboardState,
  BoardDeviceSet,
  DeviceFrameElementProps,
  DeviceSetScreen,
  DeviceSetShot,
  DeviceType,
  ElementLocaleOverride,
} from '@/types/artboard';
import {
  convertArtboardsToFormat,
  DEVICE_FORMAT_PRESETS,
  getDeviceDescriptor,
  swapTargetFor,
  type DeviceFormat,
} from '@/lib/deviceRegistry';
import { isScreenshotBoard } from '@/lib/creative/specs';
import { deviceSetTarget, type DeviceSetTarget } from './targets';
import { applyPlan, isSwappableDevice, planBoard, type BoardPlan, type DeviceLayout, type TextMeasure } from './layout';

export type { BoardDeviceSet, DeviceSetScreen } from '@/types/artboard';

/** A screenshot the user put in: an upload, a capture, a pasted picture. */
export function isUserScreenshot(src: string | undefined): boolean {
  return !!src && (src.startsWith('asset:') || src.startsWith('data:') || src.startsWith('blob:'));
}

/**
 * Artboards that are screenshots of a phone, tablet or computer. Header and
 * search art keeps Apple's size, and a Play feature graphic or an Apple Watch
 * artboard is a different picture with sizes of its own.
 */
export function takesPart(board: ArtboardState): boolean {
  if (!isScreenshotBoard(board)) return false;
  const aspect = board.size.width / board.size.height;
  if (aspect > 1.9 || aspect < 0.3) return false;
  const devices = board.elements.filter((el) => el.type === 'device' || el.type === 'video-device');
  if (devices.length > 0 && devices.every((el) => getDeviceDescriptor((el as DeviceFrameElementProps).deviceType).category === 'watch')) {
    return false;
  }
  return true;
}

/** The choices kept for one artboard on one device. */
export function boardSetOf(board: ArtboardState, format: DeviceFormat): BoardDeviceSet {
  return board.deviceSets?.[format] ?? {};
}

/** The screenshot shown in a frame on that device, in the main language. */
export function screenFor(board: ArtboardState, format: DeviceFormat, elementId: string): DeviceSetScreen | null {
  return boardSetOf(board, format).screens?.[elementId] ?? null;
}

/**
 * Width over height of what a frame shows on the device: the screenshot added
 * for the device, else the frame's own screenshot or a template's placeholder
 * art. A picture of unknown size is taken to fit the frame it is in, so a
 * frame changes shape only for a screenshot of the other shape.
 */
function shownAspect(board: ArtboardState, format: DeviceFormat, el: DeviceFrameElementProps): number {
  const own = screenFor(board, format, el.id);
  if (own?.naturalScreenshotWidth && own.naturalScreenshotHeight) {
    return own.naturalScreenshotWidth / own.naturalScreenshotHeight;
  }
  if (!own && el.naturalScreenshotWidth && el.naturalScreenshotHeight) {
    return el.naturalScreenshotWidth / el.naturalScreenshotHeight;
  }
  return getDeviceDescriptor(el.deviceType).nativeAspect;
}

/** Shapes a screenshot can have. A phone is tall, a tablet less so, a Mac is wide. */
export type ScreenShape = 'phone' | 'tablet' | 'desktop';

export function screenShape(aspect: number): ScreenShape {
  const portrait = aspect <= 1 ? aspect : 1 / aspect;
  if (aspect >= 1.2) return 'desktop';
  return portrait < 0.62 ? 'phone' : 'tablet';
}

/**
 * The frame a device shows on `target`, or null to keep the one it has.
 *
 * A screenshot added for the device (`added`) is that device's screenshot,
 * so its frame becomes the device's own whatever the picture's shape: a
 * 7-inch tablet's screenshot is as tall as a phone's, and an iPad's can be
 * taken sideways. Otherwise the frame follows the screenshot it shows: a
 * phone goes to the store's platform, and a tablet or Mac frame needs a
 * screenshot of that shape.
 */
export function frameFor(
  target: DeviceSetTarget,
  el: DeviceFrameElementProps,
  aspect: number | null,
  added = false
): DeviceType | null {
  const desc = getDeviceDescriptor(el.deviceType);
  if (desc.category === 'custom' || desc.category === 'watch' || desc.platform === 'neutral') return null;
  const phoneOnPlatform = (): DeviceType | null =>
    desc.category === 'phone' ? swapTargetFor(el.deviceType, target.platform) : desc.counterpart?.[target.platform] ?? null;
  if (target.kind === 'phone') {
    if (desc.category === 'desktop') return null;
    return phoneOnPlatform();
  }
  if (added) {
    if (target.kind === 'desktop' && desc.category === 'desktop') return null;
    return el.deviceType === target.frame ? null : target.frame ?? null;
  }
  const shape = aspect === null ? null : screenShape(aspect);
  if (target.kind === 'tablet') {
    if (shape === 'phone') return phoneOnPlatform();
    if (shape === 'desktop') return null;
    return el.deviceType === target.frame ? null : target.frame ?? null;
  }
  // The Mac.
  if (shape === null || shape === 'desktop') {
    return desc.category === 'desktop' ? null : target.frame ?? null;
  }
  return desc.category === 'phone' ? swapTargetFor(el.deviceType, 'ios') : null;
}

/** Every frame on the artboard that changes on `target`. */
export function framesOn(board: ArtboardState, target: DeviceSetTarget): Map<string, DeviceType> {
  const frames = new Map<string, DeviceType>();
  for (const el of board.elements) {
    if (!isSwappableDevice(el)) continue;
    const added = !!screenFor(board, target.id, el.id);
    const next = frameFor(target, el, shownAspect(board, target.id, el), added);
    if (next && next !== el.deviceType) frames.set(el.id, next);
  }
  return frames;
}

/**
 * The device the project is designed at: the store size its screenshot
 * artboards all have, exactly. Read from the size, not the frames, because a
 * set made for the iPad can keep phone frames. Android phones and 7-inch
 * tablets share 1080×1920, so there the frames decide. Null for a size no
 * store size matches.
 */
export function ownFormatOf(boards: ArtboardState[]): DeviceFormat | null {
  const shots = boards.filter(takesPart);
  if (shots.length === 0) return null;
  const { width, height } = shots[0].size;
  if (shots.some((board) => board.size.width !== width || board.size.height !== height)) return null;
  const matches = DEVICE_FORMAT_PRESETS.filter((entry) => entry.artboard.width === width && entry.artboard.height === height);
  if (matches.length <= 1) return matches[0]?.id ?? null;
  const tablets = shots
    .flatMap((board) => board.elements)
    .some((el) => el.type === 'device' && getDeviceDescriptor((el as DeviceFrameElementProps).deviceType).category === 'tablet');
  return (matches.find((entry) => (tablets ? entry.id.startsWith('tablet') : !entry.id.startsWith('tablet'))) ?? matches[0]).id;
}

/** The layout an artboard has on that device: the one picked, else the automatic one. */
export function chosenLayout(board: ArtboardState, format: DeviceFormat): DeviceLayout | 'auto' {
  return boardSetOf(board, format).layout ?? 'auto';
}

/** Works out the artboard on the device. `base` is the artboard in the main language. */
export function planFor(
  base: ArtboardState,
  format: DeviceFormat,
  options: { layout?: DeviceLayout | 'auto'; measure?: TextMeasure | null } = {}
): BoardPlan | null {
  const target = deviceSetTarget(format);
  if (!target || !takesPart(base)) return null;
  return planBoard(base, target.preset.artboard, options.layout ?? chosenLayout(base, format), {
    measure: options.measure,
    frames: framesOn(base, target),
  });
}

/**
 * The artboard as it shows on the device. `shown` is the same artboard in the
 * language being drawn (the base one for the main language); the plan comes
 * from the base artboard, so every language gets the same layout.
 */
export function boardOnDevice(
  shown: ArtboardState,
  plan: BoardPlan,
  base: ArtboardState,
  format: DeviceFormat,
  locale: string | null,
  measure?: TextMeasure | null
): ArtboardState {
  const placed = applyPlan(shown, plan, measure);
  const screens = boardSetOf(base, format).screens;
  if (!screens) return placed;
  let changed = false;
  const elements = placed.elements.map((el) => {
    if (el.type !== 'device') return el;
    const screen = screens[el.id];
    if (!screen) return el;
    const own = (locale && screen.localized?.[locale]) || screen;
    changed = true;
    return {
      ...el,
      screenshotSrc: own.screenshotSrc,
      naturalScreenshotWidth: own.naturalScreenshotWidth,
      naturalScreenshotHeight: own.naturalScreenshotHeight,
      screenshotRect:
        el.deviceType === 'custom' ? { left: 5, top: 5, width: 90, height: 90 } : { left: 0, top: 0, width: 100, height: 100 },
    } as DeviceFrameElementProps;
  });
  return changed ? { ...placed, elements } : placed;
}

/** Plans kept between calls, so a set of languages lays each artboard out once. */
export type PlanCache = Map<string, BoardPlan | null>;

/**
 * Every artboard of the project on the device, in one language. Header and
 * search art comes back as it is. Artboards that are not a device's
 * screenshot (a Watch artboard, a Play feature graphic) are scaled to the
 * size by convertArtboardsToFormat, one factor and centred.
 *
 * `bases` is the project as stored, `shown` the same artboards in the
 * language being drawn, in the same order.
 */
export function boardsOnDevice(
  bases: ArtboardState[],
  shown: ArtboardState[],
  format: DeviceFormat,
  locale: string | null,
  options: { measure?: TextMeasure | null; cache?: PlanCache } = {}
): ArtboardState[] {
  const preset = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === format);
  if (!preset) return shown;
  const byId = new Map(bases.map((board) => [board.id, board]));
  return shown.map((board) => {
    if (!isScreenshotBoard(board)) return board;
    const base = byId.get(board.id) ?? board;
    if (!takesPart(base)) return convertArtboardsToFormat([board], preset).artboards[0];
    const key = `${format}:${base.id}`;
    let plan = options.cache?.get(key);
    if (plan === undefined) {
      plan = planFor(base, format, { measure: options.measure });
      options.cache?.set(key, plan);
    }
    if (!plan) return convertArtboardsToFormat([board], preset).artboards[0];
    return boardOnDevice(board, plan, base, format, locale, options.measure);
  });
}

// --- the choices, written back onto the project ---------------------------

/** Which devices the project makes, from the first artboard that says. */
export function projectSetFormats(boards: ArtboardState[]): DeviceFormat[] {
  const holder = boards.find((board) => Array.isArray(board.deviceSetFormats));
  return holder?.deviceSetFormats ? [...holder.deviceSetFormats] : [];
}

/** The project with `formats` as the devices it makes, on every artboard. */
export function withSetFormats(boards: ArtboardState[], formats: DeviceFormat[]): ArtboardState[] {
  const ordered = DEVICE_FORMAT_PRESETS.map((entry) => entry.id).filter((id) => formats.includes(id));
  return boards.map((board) => ({ ...board, deviceSetFormats: ordered }));
}

/**
 * Puts the project's list of devices on every artboard that does not carry
 * it, the way an artboard added later joins the project's languages. Run on
 * every commit (calculateArtboardPositions), so a project whose first
 * artboards were deleted keeps its list. Returns the input by reference when
 * there is nothing to do.
 */
export function mirrorSetFormats(boards: ArtboardState[]): ArtboardState[] {
  const holder = boards.find((board) => Array.isArray(board.deviceSetFormats));
  if (!holder?.deviceSetFormats) return boards;
  const list = holder.deviceSetFormats;
  const same = (other: DeviceFormat[] | undefined) =>
    !!other && other.length === list.length && other.every((id, index) => id === list[index]);
  if (boards.every((board) => same(board.deviceSetFormats))) return boards;
  return boards.map((board) => (same(board.deviceSetFormats) ? board : { ...board, deviceSetFormats: [...list] }));
}

/** One artboard's choices on one device changed; an empty set of choices is removed. */
export function withBoardSet(
  boards: ArtboardState[],
  boardId: string,
  format: DeviceFormat,
  change: (current: BoardDeviceSet) => BoardDeviceSet
): ArtboardState[] {
  return boards.map((board) => {
    if (board.id !== boardId) return board;
    const next = change({ ...boardSetOf(board, format) });
    const empty = !next.layout && (!next.screens || Object.keys(next.screens).length === 0);
    const sets = { ...(board.deviceSets ?? {}) };
    if (empty) delete sets[format];
    else sets[format] = next;
    const { deviceSets: _old, ...rest } = board;
    return Object.keys(sets).length > 0 ? { ...rest, deviceSets: sets } : rest;
  });
}

/**
 * Sets the screenshot a frame shows on the device, in the main language
 * (`locale` null) or in one other language. A language gets its own only once
 * the main language has one, because the main language's screenshot decides
 * the frame, and the frame is the same in every language. Removing the main
 * language's removes the other languages' too.
 */
export function withScreen(
  set: BoardDeviceSet,
  elementId: string,
  locale: string | null,
  shot: DeviceSetShot | null
): BoardDeviceSet {
  const screens = { ...(set.screens ?? {}) };
  const current = screens[elementId];
  if (!locale) {
    if (shot) screens[elementId] = { ...shot, ...(current?.localized ? { localized: current.localized } : null) };
    else delete screens[elementId];
  } else {
    if (!current) return set;
    const localized = { ...(current.localized ?? {}) };
    if (shot) localized[locale] = shot;
    else delete localized[locale];
    const { localized: _previous, ...main } = current;
    screens[elementId] = Object.keys(localized).length > 0 ? { ...main, localized } : main;
  }
  return { ...set, screens };
}

/**
 * The frames on one artboard and what they show on the device: the target's
 * screenshot when one was added, the phone screenshot otherwise.
 */
export interface FrameOnDevice {
  elementId: string;
  /** The frame on the device. */
  deviceType: DeviceType;
  /** A screenshot was added for this device. */
  hasOwnScreen: boolean;
  /** The frame is still the phone's, because it shows a phone screenshot. */
  showsPhoneShot: boolean;
  /**
   * The frame's screen is a different shape from the screenshot, and cuts
   * off clearly more of it than the design does: an iPad screenshot in an
   * iPhone, or in a 10-inch Android tablet.
   */
  wrongShape: boolean;
}

/** How much filling a screen cuts off a picture of another shape: 1 when the shapes match. */
function cropOf(picture: number, screen: number): number {
  return picture > screen ? picture / screen : screen / picture;
}

/** How much more a frame may cut off than the design does before it asks for a screenshot of its own. */
const MORE_CUT_OFF = 1.15;

export function framesOnDevice(base: ArtboardState, target: DeviceSetTarget): FrameOnDevice[] {
  const frames = framesOn(base, target);
  return base.elements.filter(isSwappableDevice).map((el) => {
    const deviceType = frames.get(el.id) ?? el.deviceType;
    const hasOwnScreen = !!screenFor(base, target.id, el.id);
    const aspect = shownAspect(base, target.id, el);
    const cutHere = cropOf(aspect, getDeviceDescriptor(deviceType).nativeAspect);
    const cutInDesign = cropOf(aspect, getDeviceDescriptor(el.deviceType).nativeAspect);
    return {
      elementId: el.id,
      deviceType,
      hasOwnScreen,
      showsPhoneShot: target.kind !== 'phone' && getDeviceDescriptor(deviceType).category === 'phone',
      wrongShape: !hasOwnScreen && cutHere > cutInDesign * MORE_CUT_OFF,
    };
  });
}

/** What a language can keep of its own size and place, measured for the design's own artboards. */
const KEPT_GEOMETRY = ['position', 'size', 'rotation', 'scale', 'fontSize', 'lineHeight', 'letterSpacing'] as const;

/**
 * The project for one device as a project of its own: every artboard laid out
 * for the device, each language's words and screenshots kept, and the
 * screenshots added for the device in their frames, in every language. A size
 * or place a language kept of its own is left out, because it was measured
 * for the design's artboards; the language follows the new layout and fits
 * its text the way any language does.
 */
export function projectForDevice(
  bases: ArtboardState[],
  format: DeviceFormat,
  measure?: TextMeasure | null,
  options: { keepChoices?: boolean } = {}
): ArtboardState[] {
  const laidOut = boardsOnDevice(bases, bases, format, null, { measure });
  return laidOut.map((board, index) => {
    const base = bases[index];
    const { deviceSets: sets, deviceSetFormats: formats, ...rest } = board;
    // Converting a project in place keeps what was chosen for the other
    // devices; what was chosen for this one is now the design itself.
    const kept: Partial<ArtboardState> = {};
    if (options.keepChoices) {
      const otherSets = { ...(sets ?? {}) };
      delete otherSets[format];
      if (Object.keys(otherSets).length > 0) kept.deviceSets = otherSets;
      if (formats) kept.deviceSetFormats = formats.filter((id) => id !== format);
    }
    // Header art keeps its size, and a Watch artboard or a feature graphic is
    // only scaled, so their languages' own places still hold.
    if (!takesPart(base)) return { ...rest, ...kept } as ArtboardState;
    const localized: Record<string, Record<string, ElementLocaleOverride>> = {};
    for (const [code, rows] of Object.entries(base.localized ?? {})) {
      for (const [elementId, override] of Object.entries(rows ?? {})) {
        if (!override) continue;
        const kept: ElementLocaleOverride = { ...override };
        for (const key of KEPT_GEOMETRY) delete kept[key];
        if (kept.detached) {
          const detached = kept.detached.filter((key) => !(KEPT_GEOMETRY as readonly string[]).includes(key));
          if (detached.length > 0) kept.detached = detached;
          else delete kept.detached;
        }
        (localized[code] ??= {})[elementId] = kept;
      }
    }
    // A frame with a screenshot for this device shows it in every language,
    // or the language's own one for this device where there is one.
    for (const [elementId, screen] of Object.entries(base.deviceSets?.[format]?.screens ?? {})) {
      if (!screen) continue;
      for (const rows of Object.values(localized)) {
        if (rows[elementId]) {
          delete rows[elementId].screenshotSrc;
          delete rows[elementId].mediaId;
        }
      }
      for (const [code, shot] of Object.entries(screen.localized ?? {})) {
        const rows = (localized[code] ??= {});
        rows[elementId] = { ...(rows[elementId] ?? {}), screenshotSrc: shot.screenshotSrc };
      }
    }
    for (const [code, rows] of Object.entries(localized)) {
      for (const [elementId, override] of Object.entries(rows)) {
        if (Object.keys(override).length === 0) delete rows[elementId];
      }
      if (Object.keys(rows).length === 0) delete localized[code];
    }
    const next: ArtboardState = { ...rest, ...kept };
    if (Object.keys(localized).length > 0) next.localized = localized;
    else delete next.localized;
    return next;
  });
}
