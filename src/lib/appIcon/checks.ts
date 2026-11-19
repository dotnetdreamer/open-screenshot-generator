/**
 * What to look at before an icon goes out, in plain words, each with the one
 * thing that fixes it where there is one.
 *
 * Two kinds of evidence. The design itself says how big a word or a line will
 * be on a Home Screen. The pixels (measureIcon, from the layer captures the
 * dialog takes) say what no model of the design can: whether anything is
 * see-through, whether the front reaches past Android's safe circle, and how
 * much of the front reads against iOS's dark background.
 */

import type { ArtboardElement, ArtboardState, ShapeElementProps, TextElementProps } from '@/types/artboard';
import { hexToRgb } from '@/lib/graphics/color';
import {
  ANDROID_SAFE_SHARE,
  ICON_SIZE,
  IOS_HOME_POINTS,
  IOS_SMALLEST_POINTS,
  iconSettings,
  layerElements,
  withLayersInOrder,
} from './specs';

/** Text renders at fontSize / 0.3 (TextElement). */
const DISPLAY_SCALE_FACTOR = 0.3;

// --- pixels --------------------------------------------------------------------

/** What the captures show, measured once per change. */
export interface IconPixelStats {
  /** Share of the icon's pixels that are not fully opaque, with nothing behind them. */
  seeThrough: number;
  /** Share of the board the front layer covers, alpha weighted. */
  frontCoverage: number;
  /** Share of the front layer's ink outside Android's safe circle. */
  frontOutsideSafe: number;
  /** Mean relative luminance of the front layer's ink, 0 to 1, or null with no ink. */
  frontLuminance: number | null;
  /**
   * Share of the front layer's ink, alpha weighted, light enough to read on
   * iOS's dark background, or null with no ink. A white letter on a dark tile
   * reads even though the tile, and the average, are dark.
   */
  frontReadShare: number | null;
}

/** sRGB channel to linear light, for a luminance WCAG would agree with. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Measure two captures of the same size: the whole icon with nothing painted
 * behind it, and the front layer alone on transparent. `step` skips pixels
 * for speed; every `step`th row and column is read.
 */
export function measureIcon(
  full: { data: ArrayLike<number>; width: number; height: number },
  front: { data: ArrayLike<number>; width: number; height: number },
  step = 1
): IconPixelStats {
  let total = 0;
  let clear = 0;
  for (let y = 0; y < full.height; y += step) {
    for (let x = 0; x < full.width; x += step) {
      total += 1;
      if (full.data[(y * full.width + x) * 4 + 3] < 250) clear += 1;
    }
  }

  const cx = front.width / 2;
  const cy = front.height / 2;
  const radius = (Math.min(front.width, front.height) * ANDROID_SAFE_SHARE) / 2;
  let ink = 0;
  let outside = 0;
  let light = 0;
  let readable = 0;
  let frontTotal = 0;
  for (let y = 0; y < front.height; y += step) {
    for (let x = 0; x < front.width; x += step) {
      frontTotal += 1;
      const at = (y * front.width + x) * 4;
      const alpha = front.data[at + 3] / 255;
      if (alpha <= 0.02) continue;
      ink += alpha;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > radius * radius) outside += alpha;
      const luminance = 0.2126 * linear(front.data[at]) + 0.7152 * linear(front.data[at + 1]) + 0.0722 * linear(front.data[at + 2]);
      light += alpha * luminance;
      if (contrastOf(luminance, IOS_DARK_BACKDROP_LUMINANCE) >= DARK_READ_CONTRAST) readable += alpha;
    }
  }
  return {
    seeThrough: total > 0 ? clear / total : 0,
    frontCoverage: frontTotal > 0 ? ink / frontTotal : 0,
    frontOutsideSafe: ink > 0 ? outside / ink : 0,
    frontLuminance: ink > 0 ? light / ink : null,
    frontReadShare: ink > 0 ? readable / ink : null,
  };
}

/** WCAG contrast between two relative luminances. */
export function contrastOf(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The dark background iOS draws behind a dark icon, as relative luminance.
 * Apple says only that the system provides it; this stands in for it with a
 * near-black grey, about #1C1C1E, which is how the previews draw it too.
 */
export const IOS_DARK_BACKDROP_LUMINANCE = 0.012;

/** The contrast with that background a part of the front needs to read. */
export const DARK_READ_CONTRAST = 2.4;

/**
 * Under this share of the front reading on the dark background, the dark icon
 * is too dark. A letter or a thin mark is a small share of a whole tile, so
 * the bar is low on purpose.
 */
export const MIN_DARK_READ_SHARE = 0.05;

/** A front element this big a share of the board is a backdrop, not a mark. */
const BACKDROP_SHARE = 0.25;

// --- the checks ----------------------------------------------------------------

export type CheckLevel = 'ok' | 'warn' | 'error';

export type CheckAction =
  | { kind: 'select'; elementId: string; label: string }
  | { kind: 'move-to-back'; elementId: string; label: string }
  /** The shape to the background and what's left of the front white, as one change. */
  | { kind: 'move-to-back-and-white'; elementId: string; label: string }
  | { kind: 'light-in-dark'; label: string }
  | { kind: 'fill-ground'; color: string; label: string }
  | { kind: 'show-android'; label: string };

export interface IconCheck {
  id: string;
  level: CheckLevel;
  title: string;
  detail?: string;
  /** The fixes to offer, the likeliest first. The window shows each one's result before it is clicked. */
  actions?: CheckAction[];
}

/**
 * The icon as it would be after `action`, for the preview beside its button.
 * Null for an action that doesn't change the icon (select, show-android).
 */
export function withCheckAction(board: ArtboardState, action: CheckAction): ArtboardState | null {
  switch (action.kind) {
    case 'light-in-dark':
      return { ...board, appIcon: { ...iconSettings(board), dark: 'light' } };
    case 'move-to-back':
    case 'move-to-back-and-white': {
      const moved = {
        ...board,
        elements: withLayersInOrder(board.elements.map((element) => (element.id === action.elementId ? ({ ...element, iconLayer: 'back' } as ArtboardElement) : element))),
      };
      return action.kind === 'move-to-back' ? moved : { ...moved, appIcon: { ...iconSettings(board), dark: 'light' } };
    }
    case 'fill-ground':
      return { ...board, backgroundType: 'solid', backgroundColor: action.color, backgroundGradient: undefined };
    default:
      return null;
  }
}

function points(px: number, at: number): number {
  return (px * at) / ICON_SIZE;
}

function quoted(content: string): string {
  const line = content.replace(/\s+/g, ' ').trim();
  return line.length > 24 ? `"${line.slice(0, 22)}…"` : `"${line}"`;
}

/** The em size a text element's type has on the canvas, in board pixels. */
function glyphPx(text: TextElementProps): number {
  return text.fontSize / DISPLAY_SCALE_FACTOR;
}

/** Below this em size in points, a word on a Home Screen icon reads as a smudge. */
export const MIN_HOME_TEXT_POINTS = 11;
/** Below this width in points, a line disappears at the Settings size. */
export const MIN_SETTINGS_LINE_POINTS = 0.5;

function areaOf(element: ArtboardElement): number {
  return element.size.width * element.scale * element.size.height * element.scale;
}

function boxOf(element: ArtboardElement) {
  return {
    left: element.position.x,
    top: element.position.y,
    right: element.position.x + element.size.width * element.scale,
    bottom: element.position.y + element.size.height * element.scale,
  };
}

function overlaps(a: ArtboardElement, b: ArtboardElement): boolean {
  const one = boxOf(a);
  const two = boxOf(b);
  return one.left < two.right && two.left < one.right && one.top < two.bottom && two.top < one.bottom;
}

/** The shapes a backdrop can be: a plain plate. A star, a heart or a custom path is a mark. */
const PLATE_SHAPES: ReadonlySet<string> = new Set(['rectangle', 'circle']);

/** Of what sits on a backdrop, the mark is at least this share of it. */
const MARK_SHARE = 0.15;

/**
 * The layer on `plate` that makes it a backdrop: above it, big enough to be
 * the mark (a small dot or sparkle is a detail, not the mark), and centred
 * on it. Null when nothing on the plate is a mark, so the plate is the mark.
 */
function markOn(board: ArtboardState, plate: ArtboardElement): ArtboardElement | null {
  const front = layerElements(board, 'front');
  const plateBox = boxOf(plate);
  const above = front.slice(front.indexOf(plate) + 1);
  return (
    above.find((element) => {
      const box = boxOf(element);
      const cx = (box.left + box.right) / 2;
      const cy = (box.top + box.bottom) / 2;
      const centred = cx > plateBox.left && cx < plateBox.right && cy > plateBox.top && cy < plateBox.bottom;
      return overlaps(plate, element) && centred && areaOf(element) >= MARK_SHARE * areaOf(plate);
    }) ?? null
  );
}

/**
 * The backdrop under the mark, the tile or circle a letter sits on, or null:
 * a plain plate, a quarter of the icon or more, with a mark on it. Text and
 * pictures never are, and nor is a shape with only a small detail on top.
 */
function backdropUnderMark(board: ArtboardState): ArtboardElement | null {
  const share = (element: ArtboardElement) => areaOf(element) / (board.size.width * board.size.height);
  const candidates = layerElements(board, 'front').filter(
    (element) =>
      element.type === 'shape' &&
      PLATE_SHAPES.has((element as ShapeElementProps).shapeType) &&
      share(element) >= BACKDROP_SHARE &&
      markOn(board, element) !== null
  );
  return candidates.reduce<ArtboardElement | null>((best, element) => (!best || areaOf(element) > areaOf(best) ? element : best), null);
}

/** A layer this big a share of the icon fills it, for "The front covers the whole icon". */
const FILLING_SHARE = 0.6;

/**
 * The layer that fills the icon, for "The front covers the whole icon": a
 * shape or picture over most of the icon, under another front layer, or the
 * front's only layer. Never text.
 */
function fillingLayer(board: ArtboardState): ArtboardElement | null {
  const front = layerElements(board, 'front');
  const share = (element: ArtboardElement) => areaOf(element) / (board.size.width * board.size.height);
  const pool = front.filter(
    (element, at) =>
      (element.type === 'shape' || element.type === 'image') &&
      share(element) >= FILLING_SHARE &&
      (front.length === 1 || front.slice(at + 1).some((above) => overlaps(element, above)))
  );
  return pool.reduce<ArtboardElement | null>((best, element) => (!best || areaOf(element) > areaOf(best) ? element : best), null);
}

const moveToBack = (element: ArtboardElement): CheckAction => ({
  kind: 'move-to-back',
  elementId: element.id,
  label: `Move ${element.name || 'the picture'} to the back`,
});

const WHITE_IN_DARK: CheckAction = { kind: 'light-in-dark', label: 'Make the icon white in dark mode' };

/** A colour's relative luminance, or null for one this can't read (a gradient, a named colour). */
function colorLuminance(color: string | undefined): number | null {
  const rgb = color ? hexToRgb(color) : null;
  return rgb ? 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b) : null;
}

/**
 * Whether what's left of the front, without `backdrop`, is all dark by its
 * own colours: dark type and dark fills. A picture, or a colour this can't
 * read, is not assumed dark.
 */
function restIsDark(board: ArtboardState, backdrop: ArtboardElement): boolean {
  const rest = layerElements(board, 'front').filter((element) => element.id !== backdrop.id);
  const dark = (color: string | undefined) => {
    const luminance = colorLuminance(color);
    return luminance !== null && contrastOf(luminance, IOS_DARK_BACKDROP_LUMINANCE) < DARK_READ_CONTRAST;
  };
  return (
    rest.length > 0 &&
    rest.every((element) => {
      if (element.type === 'text') return dark((element as TextElementProps).color);
      if (element.type === 'shape') return dark((element as ShapeElementProps).fillColor);
      return false;
    })
  );
}

/**
 * Every check for one icon. `stats` is null until the first measurement is
 * in, and the pixel checks wait for it.
 */
export function checkIcon(board: ArtboardState, stats: IconPixelStats | null): IconCheck[] {
  const checks: IconCheck[] = [];
  const front = layerElements(board, 'front');
  const settings = iconSettings(board);

  if (Math.round(board.size.width) !== ICON_SIZE || Math.round(board.size.height) !== ICON_SIZE) {
    checks.push({
      id: 'size',
      level: 'error',
      title: `The icon artboard is ${Math.round(board.size.width)} x ${Math.round(board.size.height)}`,
      detail: `Every store needs a 1024 x 1024 design. Make a new icon from the + menu, or set the icon artboard back to 1024 x 1024.`,
    });
  }

  if (stats) {
    if (stats.seeThrough > 0.0005) {
      checks.push({
        id: 'opaque',
        level: 'error',
        title: 'Part of the icon is see-through',
        detail: "The App Store doesn't accept see-through icons, and the see-through parts would turn white. Give the icon a background colour.",
        actions: [{ kind: 'fill-ground', color: '#FFFFFF', label: 'Fill with white' }],
      });
    } else {
      checks.push({ id: 'opaque', level: 'ok', title: 'No see-through parts' });
    }
  }

  if (front.length === 0 || (stats && stats.frontCoverage < 0.002)) {
    checks.push({
      id: 'front',
      level: 'warn',
      title: 'Nothing is in front',
      detail: 'Everything is in the back, so the dark, tinted and Android themed icons would be empty. Put your letter or logo in front.',
    });
  } else if (stats && stats.frontCoverage > 0.85) {
    const filling = fillingLayer(board);
    checks.push({
      id: 'front',
      level: 'warn',
      title: 'The front fills the whole icon',
      detail: 'Then the dark and tinted icons would just be a square. Move the picture that fills the icon to the back.',
      actions: filling ? [moveToBack(filling)] : undefined,
    });
  }

  if (stats && front.length > 0 && stats.frontCoverage >= 0.002) {
    if (stats.frontOutsideSafe > 0.015) {
      checks.push({
        id: 'safe',
        level: 'warn',
        title: 'Android may cut off part of your icon',
        detail: `Some Android phones show icons as circles, and about ${Math.max(1, Math.round(stats.frontOutsideSafe * 100))}% of your icon's front is outside the circle. Make your logo a little smaller.`,
        actions: [{ kind: 'show-android', label: 'Show me' }],
      });
    } else {
      checks.push({ id: 'safe', level: 'ok', title: 'Nothing gets cut off on Android' });
    }

    if (stats.frontReadShare !== null) {
      const reads = settings.dark === 'light' || stats.frontReadShare >= MIN_DARK_READ_SHARE;
      if (!reads) {
        // A big shape under the mark is a backdrop: in the background it
        // stays in the light icon and the mark shows alone in the dark one.
        // White is always offered too, and the window shows what each does.
        const backdrop = backdropUnderMark(board);
        checks.push({
          id: 'dark',
          level: 'warn',
          title: 'Hard to see in dark mode',
          detail: backdrop
            ? 'In dark mode, iPhone shows only your letter or logo, on a dark background, and your letter or logo is dark too. Each button shows how the dark icon will look.'
            : 'In dark mode, iPhone puts your icon on a dark background, and your icon is dark too. The button shows how the icon looks in white.',
          // With the shape in the background a dark mark is still dark, so
          // the fix that works is both at once. The window previews each.
          actions: backdrop
            ? restIsDark(board, backdrop)
              ? [
                  { kind: 'move-to-back-and-white', elementId: backdrop.id, label: `Move ${backdrop.name || 'the shape'} to the back and make the rest white` },
                  WHITE_IN_DARK,
                ]
              : [moveToBack(backdrop), WHITE_IN_DARK]
            : [WHITE_IN_DARK],
        });
      } else {
        checks.push({ id: 'dark', level: 'ok', title: 'Easy to see in dark mode' });
      }
    }
  }

  for (const element of board.elements) {
    if (element.type === 'text') {
      const text = element as TextElementProps;
      if (!text.content.trim()) continue;
      const em = points(glyphPx(text), IOS_HOME_POINTS);
      if (em < MIN_HOME_TEXT_POINTS) {
        checks.push({
          id: `text:${text.id}`,
          level: 'warn',
          title: 'Small words are hard to read',
          detail: `${quoted(text.content)} will be tiny on a phone. Make the words bigger, or leave words off the icon.`,
          actions: [{ kind: 'select', elementId: text.id, label: 'Select the words' }],
        });
      }
    }
    if (element.type === 'shape') {
      const shape = element as ShapeElementProps;
      const stroke = (shape.strokeWidth || 0) * element.scale;
      const visible = stroke > 0 && shape.strokeColor && shape.strokeColor !== 'transparent';
      if (visible && points(stroke, IOS_SMALLEST_POINTS) < MIN_SETTINGS_LINE_POINTS) {
        checks.push({
          id: `line:${shape.id}`,
          level: 'warn',
          title: 'A thin line will vanish on small icons',
          detail: `The outline of ${shape.name ? `"${shape.name}"` : 'a shape'} is too thin to see on a phone. Make the outline thicker, or remove the outline.`,
          actions: [{ kind: 'select', elementId: shape.id, label: 'Select the shape' }],
        });
      }
    }
  }

  return checks;
}

/** One line for the chip and the live card: what needs a look, or that it is ready. */
export function checkSummary(checks: IconCheck[]): { level: CheckLevel; text: string } {
  const errors = checks.filter((check) => check.level === 'error').length;
  const warnings = checks.filter((check) => check.level === 'warn').length;
  if (errors > 0) return { level: 'error', text: errors === 1 ? '1 to fix' : `${errors} to fix` };
  if (warnings > 0) return { level: 'warn', text: warnings === 1 ? '1 to check' : `${warnings} to check` };
  return { level: 'ok', text: 'Ready' };
}
