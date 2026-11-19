/**
 * Starting points for an app icon, built from the project's own look: its
 * colours, its type and the app's name (readProjectLook in
 * src/lib/creative/layouts.ts), or from a logo the user brings.
 *
 * Every starter is a real icon artboard, so what the picker shows is exactly
 * what lands on the canvas. Each keeps its mark inside Android's safe circle
 * (specs.ts) and splits its layers the way an icon needs them: the ground and
 * any soft shape behind the mark are the back layer, the mark is the front.
 */

import type {
  ArtboardState,
  ImageElementProps,
  ShapeElementProps,
  TextElementProps,
} from '@/types/artboard';
import type { ProjectLook } from '@/lib/creative/layouts';
import { gradientPartner, hexToRgb, isDark, lighten, mix, readableOn, usableAccent } from '@/lib/graphics/color';
import { ICON_BOARD_NAME, ICON_SIZE } from './specs';

/** Text renders at fontSize / 0.3 (TextElement). */
const DISPLAY_SCALE_FACTOR = 0.3;
/** TextElement pads its box by this much on every side. */
const BOX_PADDING = 2;

export type IconStarterId = 'letter' | 'initials' | 'ring' | 'badge' | 'light';

export interface IconStarter {
  id: IconStarterId;
  label: string;
  blurb: string;
}

export const ICON_STARTERS: readonly IconStarter[] = [
  { id: 'letter', label: 'Letter', blurb: 'The first letter of your app name, on your colours' },
  { id: 'ring', label: 'Ring', blurb: 'Your letter with a soft ring behind it' },
  { id: 'badge', label: 'Badge', blurb: 'Your letter on a rounded square' },
  { id: 'light', label: 'Light', blurb: 'Your colour on a white background' },
  { id: 'initials', label: 'Initials', blurb: 'Two letters, or the whole name if the name is short' },
];

/** What a starter needs to know besides the project's look. */
export interface StarterOptions {
  /** The app's name, as people see it under the icon. */
  appName: string;
  /** Makes the ids unique, so two icons made in one session never share one. */
  seed: string;
  /**
   * How far to move a letter down so its ink, not its line box, sits in the
   * middle, as a share of the glyph height. The dialog measures it in the
   * browser (inkNudge); tests and anywhere without a canvas leave it at 0.
   */
  nudge?: (text: string, face: { fontFamily: string; fontWeight: string }) => number;
}

/**
 * The two colours of the project's ground, for type and shapes to sit on. A
 * gradient keeps its own two stops, exactly: an icon is the brand at its
 * smallest. A solid colour gets a partner for a gentle gradient, and a grey
 * or unreadable one the house indigo.
 */
export function brandColors(look: Pick<ProjectLook, 'ground'>): { primary: string; secondary: string } {
  const ground = look.ground;
  const readable = (value: string | undefined) => (value && hexToRgb(value) ? value : null);
  if (ground.backgroundType === 'gradient' && ground.backgroundGradient) {
    const first = readable(ground.backgroundGradient.color1);
    const second = readable(ground.backgroundGradient.color2);
    if (first && second && first.toLowerCase() !== second.toLowerCase()) return { primary: first, secondary: second };
  }
  const solid = usableAccent(readable(ground.backgroundColor) ?? '#4F46E5', '#4F46E5');
  return { primary: solid, secondary: gradientPartner(solid) };
}

/** The letters a name gives: its first, or the first of its first two words. */
export function nameLetters(appName: string): { first: string; initials: string; short: string | null } {
  const words = appName
    .normalize('NFC')
    .split(/[\s\-_.]+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  // The first visible character, not the first UTF-16 unit, so a name in a
  // script outside the BMP keeps its whole letter.
  const firstOf = (word: string) => Array.from(word)[0] ?? '';
  const first = (firstOf(words[0] ?? '') || 'A').toLocaleUpperCase();
  const initials = words.length > 1 ? (firstOf(words[0]) + firstOf(words[1])).toLocaleUpperCase() : first;
  const single = words.length === 1 ? words[0] : '';
  // A short one-word name can stand as a wordmark.
  const short = single && Array.from(single).length <= 6 ? single : null;
  return { first, initials, short };
}

function board(id: string, name: string, ground: Partial<ArtboardState>): ArtboardState {
  return {
    id,
    name,
    position: { x: 0, y: 0 },
    size: { width: ICON_SIZE, height: ICON_SIZE },
    elements: [],
    appIcon: {},
    backgroundColor: '#FFFFFF',
    zoom: 1,
    ...ground,
  };
}

function gradientGround(primary: string, secondary: string, angle = 155): Partial<ArtboardState> {
  return { backgroundType: 'gradient', backgroundColor: primary, backgroundGradient: { color1: primary, color2: secondary, angle } };
}

/** A centred line of type whose glyphs are `glyph` px tall. */
function mark(
  id: string,
  content: string,
  glyph: number,
  face: { fontFamily: string; fontWeight: string; fontStyle?: string },
  color: string,
  nudge: number,
  center = { x: ICON_SIZE / 2, y: ICON_SIZE / 2 }
): TextElementProps {
  const width = Math.round(ICON_SIZE * 0.9);
  const height = Math.round(glyph * 1.3 + BOX_PADDING * 2);
  return {
    id,
    type: 'text',
    name: content.length === 1 ? 'Letter' : 'Name',
    content,
    fontSize: Math.round(glyph * DISPLAY_SCALE_FACTOR * 10) / 10,
    color,
    fontFamily: face.fontFamily,
    fontWeight: face.fontWeight,
    fontStyle: face.fontStyle ?? 'normal',
    textAlign: 'center',
    lineHeight: 1,
    letterSpacing: content.length > 1 ? Math.round(-glyph * 0.02 * DISPLAY_SCALE_FACTOR * 10) / 10 : 0,
    position: { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2 + nudge * glyph) },
    size: { width, height },
    rotation: 0,
    scale: 1,
  };
}

function circle(id: string, diameter: number, color: string, opacity: number, back: boolean): ShapeElementProps {
  const at = Math.round((ICON_SIZE - diameter) / 2);
  return {
    id,
    type: 'shape',
    name: 'Ring',
    shapeType: 'circle',
    fillColor: color,
    fillOpacity: opacity,
    strokeColor: 'transparent',
    strokeWidth: 0,
    position: { x: at, y: at },
    size: { width: diameter, height: diameter },
    rotation: 0,
    scale: 1,
    ...(back ? { iconLayer: 'back' as const } : {}),
  };
}

/**
 * The Badge starter's tile. It sits in the background: the dark, tinted and
 * themed icons then show the letter alone, as Apple's and Google's own do,
 * and Android moves the letter over it.
 */
function tile(id: string, side: number, color: string): ShapeElementProps {
  const at = Math.round((ICON_SIZE - side) / 2);
  return {
    id,
    type: 'shape',
    name: 'Badge',
    shapeType: 'rectangle',
    fillColor: color,
    strokeColor: 'transparent',
    strokeWidth: 0,
    borderRadius: Math.round(side * 0.24),
    position: { x: at, y: at },
    size: { width: side, height: side },
    rotation: 0,
    scale: 1,
    iconLayer: 'back',
  };
}

/** The face the app's name is set in on the screenshots, or the project's. */
function nameFace(look: ProjectLook): { fontFamily: string; fontWeight: string; fontStyle?: string } {
  return {
    fontFamily: look.nameStyle?.fontFamily || look.fontFamily,
    fontWeight: look.nameStyle?.fontWeight && look.nameStyle.fontWeight !== 'normal' ? look.nameStyle.fontWeight : '700',
    fontStyle: look.nameStyle?.fontStyle,
  };
}

/**
 * A starter is a finished icon, checks and all. A dark letter disappears on
 * iOS's dark background, so a starter whose front is dark type turns it
 * white in the dark and tinted icons from the start.
 */
function readyForDark(result: ArtboardState): ArtboardState {
  const front = result.elements.filter((element) => element.iconLayer !== 'back');
  const darkType = front.length > 0 && front.every((element) => element.type === 'text' && isDark((element as TextElementProps).color));
  return darkType ? { ...result, appIcon: { ...result.appIcon, dark: 'light' } } : result;
}

/** Builds one starter as a finished icon artboard. */
export function buildStarterIcon(id: IconStarterId, look: ProjectLook, options: StarterOptions): ArtboardState {
  return readyForDark(starterIcon(id, look, options));
}

function starterIcon(id: IconStarterId, look: ProjectLook, options: StarterOptions): ArtboardState {
  const { primary, secondary } = brandColors(look);
  const letters = nameLetters(options.appName || look.appName);
  const face = nameFace(look);
  const nudge = (text: string) => options.nudge?.(text, face) ?? 0;
  const ids = (part: string) => `icon-${options.seed}-${id}-${part}`;
  const name = ICON_BOARD_NAME;
  const onGround = readableOn(primary);

  switch (id) {
    case 'letter': {
      const result = board(ids('board'), name, gradientGround(primary, secondary));
      result.elements = [mark(ids('mark'), letters.first, 560, face, onGround, nudge(letters.first))];
      return result;
    }
    case 'initials': {
      const text = letters.short ?? letters.initials;
      // A word is fitted to the width: about 0.62 of the glyph height per letter.
      const count = Array.from(text).length;
      const glyph = count === 1 ? 560 : Math.max(160, Math.min(420, Math.round(700 / (0.62 * count))));
      const result = board(ids('board'), name, gradientGround(primary, secondary, 135));
      result.elements = [mark(ids('mark'), text, glyph, face, onGround, nudge(text))];
      return result;
    }
    case 'ring': {
      const ringColor = isDark(primary) ? '#FFFFFF' : '#000000';
      const result = board(ids('board'), name, gradientGround(primary, secondary, 165));
      result.elements = [
        circle(ids('ring'), 760, ringColor, isDark(primary) ? 0.16 : 0.1, true),
        mark(ids('mark'), letters.first, 470, face, onGround, nudge(letters.first)),
      ];
      return result;
    }
    case 'badge': {
      const tileColor = isDark(primary) ? '#FFFFFF' : mix(primary, '#000000', 0.78);
      const result = board(ids('board'), name, gradientGround(primary, secondary, 145));
      result.elements = [
        tile(ids('tile'), 600, tileColor),
        mark(ids('mark'), letters.first, 380, face, isDark(primary) ? primary : '#FFFFFF', nudge(letters.first)),
      ];
      return result;
    }
    case 'light': {
      // The brand colour on near white. A colour too pale to read on white is
      // taken down until it does.
      let ink = primary;
      for (let step = 0; step < 6 && !isDark(ink); step++) ink = mix(ink, '#000000', 0.2);
      const result = board(ids('board'), name, gradientGround('#FFFFFF', lighten(mix(primary, '#FFFFFF', 0.9), 0.02), 180));
      result.elements = [mark(ids('mark'), letters.first, 560, face, ink, nudge(letters.first))];
      return result;
    }
  }
}

/** What the dialog measured of a logo before it becomes an icon. */
export interface LogoFacts {
  /** `asset:<id>` once stored, or any source an image element takes. */
  src: string;
  width: number;
  height: number;
  /** No see-through pixels: the logo is a whole icon already, so it fills the board. */
  opaque: boolean;
  /** Most of the logo is light, so it needs a dark ground to show. */
  light: boolean;
}

/**
 * An icon from the user's own logo. An opaque square picture is taken as a
 * finished icon and fills the board. Anything else sits in the middle, inside
 * Android's safe circle, on white, or on the project's colour when the logo
 * is light.
 */
export function buildLogoIcon(look: ProjectLook, logo: LogoFacts, options: Pick<StarterOptions, 'seed'>): ArtboardState {
  const { primary, secondary } = brandColors(look);
  const ids = (part: string) => `icon-${options.seed}-logo-${part}`;
  const aspect = logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 1;
  const squareish = aspect > 0.9 && aspect < 1.1;
  const fills = logo.opaque && squareish;
  const ground = fills
    ? { backgroundColor: '#FFFFFF' }
    : logo.light
      ? gradientGround(primary, secondary)
      : { backgroundColor: '#FFFFFF', backgroundType: 'solid' as const };
  const result = board(ids('board'), ICON_BOARD_NAME, ground);
  // 62% of the board keeps a square logo's corners inside the safe circle
  // (its half diagonal is 0.44 of the board, the circle's radius 0.458).
  const box = fills ? ICON_SIZE : Math.round(ICON_SIZE * 0.62);
  const width = aspect >= 1 ? box : Math.round(box * aspect);
  const height = aspect >= 1 ? Math.round(box / aspect) : box;
  const image: ImageElementProps = {
    id: ids('image'),
    type: 'image',
    name: 'Logo',
    imageSrc: logo.src,
    objectFit: fills ? 'cover' : 'contain',
    position: { x: Math.round((ICON_SIZE - width) / 2), y: Math.round((ICON_SIZE - height) / 2) },
    size: { width, height },
    rotation: 0,
    scale: 1,
    ...(fills ? { iconLayer: 'back' as const } : {}),
  };
  result.elements = [image];
  return result;
}

/**
 * How far to move a line of type down so its ink sits in the middle of its
 * box, as a share of the glyph height. TextElement centres the line box, and
 * a capital's ink sits above that box's middle by a different amount in every
 * face. Measured with the page's canvas, in the face as loaded now; 0 without
 * a canvas or a measurement.
 */
export function inkNudge(text: string, face: { fontFamily: string; fontWeight: string }): number {
  if (typeof document === 'undefined') return 0;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const size = 200;
    context.font = `${face.fontWeight} ${size}px "${face.fontFamily}"`;
    const metrics = context.measureText(text);
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    const inkUp = metrics.actualBoundingBoxAscent;
    const inkDown = metrics.actualBoundingBoxDescent;
    if (![ascent, descent, inkUp, inkDown].every((value) => Number.isFinite(value))) return 0;
    // With line-height 1 the box is one em; the line's ascent and descent
    // centre in it, and the ink centre sits (inkUp - inkDown) / 2 above the
    // baseline. The difference to the box's middle, as a share of the size.
    const shift = (descent - ascent + inkUp - inkDown) / 2;
    const share = shift / size;
    return Math.abs(share) < 0.25 ? share : 0;
  } catch {
    return 0;
  }
}
