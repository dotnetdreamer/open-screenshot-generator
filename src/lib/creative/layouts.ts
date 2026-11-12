/**
 * Header and search art composed from the project the user already has.
 *
 * A project of store screenshots already says what the brand looks like: its
 * ground, its typeface, its headline and its screens. So the creative boards
 * are built from those rather than from a stock look. The copy keeps every
 * language the project has, because the source text elements' overrides are
 * carried onto the new ones, and the screens keep their per-language
 * screenshots the same way.
 *
 * The copy sits inside Apple's art safe area (specs.ts), the part every device
 * shows, at the largest size that fits. The two lines a design can do without,
 * the tagline under a name and the line under a headline, are left out when
 * they have no room at a size that reads on a phone. The app name and the
 * headline are always set, and set whole: with no room at that size they take
 * more lines, and after that they go under it. The store check reports type
 * that comes out under 10pt on an iPhone.
 * The screens are sized for what an iPhone shows, which is far more than the
 * safe area, so they run past it: a design drawn to fit the safe area alone
 * sits small in the middle of a phone with empty space around it.
 *
 * Nothing here adds a filter: no blur, no glow, no drop shadow. These boards
 * are up to 5244px wide and WebKit (the desktop app is a WKWebView) filters a
 * layer at its full size: a soft drop shadow under each phone was enough to
 * freeze the add dialog in WebKit for longer than a test would wait, with all
 * of its cards on screen. AGENTS rule 4c is the same lesson for backgrounds.
 * The phones still carry the small drop shadow every flat device frame gets
 * from `.device-container` in globals.css (0 2px 5px). WebKit got through
 * that one in the e2e runs, but it is a filter, so the art is not filter free.
 *
 * The add dialog rebuilds every card on each render, so nothing here waits or
 * reads the project's files. One thing does read the page: the type is fitted
 * by measuring it (typeFit.ts), because a line count guessed from an average
 * letter is what cut "MOMMY MORNINGS" off in its box. A few cached
 * measurements per design, and an estimate where there is no page.
 */

import type {
  ArtboardElement,
  ArtboardState,
  CreativeAssetKind,
  DeviceFrameElementProps,
  DeviceType,
  ElementLocaleOverride,
  Size,
  TextElementProps,
} from '@/types/artboard';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';
import { hash32 } from '@/lib/i18n/hash';
import { getLocalization } from '@/lib/i18n/localization';
import { isDark, mix, mutedOn, readableOn } from '@/lib/graphics/color';
import { breaksStoreRules, isShortPhrase } from './check';
import {
  creativeSpec,
  iphoneAreaFor,
  isCreativeAssetKind,
  minReadableGlyph,
  safeAreaFor,
  screenshotBoards,
  type PixelRect,
} from './specs';
import {
  facesOnTheirWay,
  facesPending,
  fitGlyph,
  linesHeight,
  roughWidth,
  storedFontSize,
  storedTracking,
  type Face,
  type GlyphFit,
} from './typeFit';

// --- looks ------------------------------------------------------------------

export interface CreativeLook {
  id: string;
  label: string;
  blurb: string;
}

/** The choices the add dialog offers for each kind, default first. */
export const CREATIVE_LOOKS: Record<CreativeAssetKind, CreativeLook[]> = {
  header: [
    { id: 'wordmark', label: 'Wordmark', blurb: 'Your app name on your own colours' },
    { id: 'name-phone', label: 'Name and screen', blurb: 'Name and tagline next to your first screen' },
    { id: 'showcase', label: 'Showcase', blurb: 'A row of your screens under the name' },
  ],
  search: [
    { id: 'headline-phone', label: 'Headline and screen', blurb: 'What the app does, next to a real screen' },
    { id: 'two-phones', label: 'Two screens', blurb: 'Headline with a pair of screens' },
    { id: 'wordmark', label: 'Wordmark', blurb: 'Matches a wordmark header' },
  ],
  universal: [
    { id: 'wordmark', label: 'Wordmark', blurb: 'Your app name, for both placements' },
    { id: 'name-phone', label: 'Name and screen', blurb: 'Your app name over your first screen' },
  ],
};

export function defaultLook(kind: CreativeAssetKind): string {
  return CREATIVE_LOOKS[kind][0].id;
}

// --- what the project looks like ---------------------------------------------

/** A source element and its per-language overrides, already trimmed to what carries over. */
export interface Sourced<T> {
  element: T;
  overrides: Record<string, ElementLocaleOverride>;
}

export interface ProjectLook {
  appName: string;
  ground: Pick<
    ArtboardState,
    | 'backgroundColor'
    | 'backgroundType'
    | 'backgroundGradient'
    | 'backgroundImage'
    | 'backgroundImageFit'
    | 'backgroundImageTintColor'
    | 'backgroundImageTintOpacity'
  >;
  /** Light type reads on this ground. */
  darkGround: boolean;
  /** The ground is a picture, whose colour only the type over it can tell. */
  pictureGround: boolean;
  fontFamily: string;
  textColor: string;
  mutedColor: string;
  /**
   * How the screenshots set the app name, when they do. A wordmark keeps its
   * own face, colour and weight on the art, whatever face the headline uses.
   */
  nameStyle: Pick<TextElementProps, 'fontFamily' | 'color' | 'fontWeight' | 'fontStyle'> | null;
  headline: Sourced<TextElementProps> | null;
  subhead: Sourced<TextElementProps> | null;
  devices: Sourced<DeviceFrameElementProps>[];
  /** Languages the project exports besides the base one. */
  locales: string[];
}

/**
 * The project's house face for a project with no text yet. It is in
 * GOOGLE_FONTS, so it loads; a family that is not falls back to a serif.
 */
const FALLBACK_FONT = 'Bricolage Grotesque';
const FALLBACK_DEVICE: DeviceType = 'iphone-16-pro';
const FALLBACK_GROUND: ProjectLook['ground'] = {
  backgroundColor: '#1E1B4B',
  backgroundType: 'gradient',
  backgroundGradient: { color1: '#312E81', color2: '#0F0D2E', angle: 160 },
};
/** Screen art that ships with the feature graphic templates. */
const PLACEHOLDER_SCREENS = {
  light: '/data/projects/fg-screens/fg-cards-light.png',
  dark: '/data/projects/fg-screens/fg-cards-dark.png',
} as const;

/** Detachable keys that describe the type rather than where it sits. */
const CARRIED_DETACHED = new Set([
  'fontFamily',
  'fontWeight',
  'color',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'outlineColor',
  'outlineWidth',
]);

/**
 * One element's overrides in every language, minus geometry. Position, size and
 * font size were tuned for a phone screenshot and mean nothing on a 21:9 board;
 * the words, the pictures and any type choices still apply.
 */
function carriedOverrides(board: ArtboardState, elementId: string): Record<string, ElementLocaleOverride> {
  const out: Record<string, ElementLocaleOverride> = {};
  for (const [locale, map] of Object.entries(board.localized ?? {})) {
    const ov = map?.[elementId];
    if (!ov) continue;
    const next: ElementLocaleOverride = {};
    if (ov.content !== undefined) next.content = ov.content;
    if (ov.screenshotSrc !== undefined) next.screenshotSrc = ov.screenshotSrc;
    if (ov.imageSrc !== undefined) next.imageSrc = ov.imageSrc;
    if (ov.mediaId !== undefined) next.mediaId = ov.mediaId;
    if (ov.hidden !== undefined) next.hidden = ov.hidden;
    if (ov.origin) next.origin = ov.origin;
    if (ov.sourceHash) next.sourceHash = ov.sourceHash;
    const record = ov as unknown as Record<string, unknown>;
    const detached = (ov.detached ?? []).filter((key) => CARRIED_DETACHED.has(key) && record[key] !== undefined);
    if (detached.length > 0) {
      next.detached = detached;
      for (const key of detached) (next as unknown as Record<string, unknown>)[key] = record[key];
    }
    if (Object.keys(next).length > 0) out[locale] = next;
  }
  return out;
}

/** Copy worth putting in a headline: real words, not a rating or an emoji. */
function isWords(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length >= 3 && trimmed.length <= 90 && (trimmed.match(/\p{L}/gu)?.length ?? 0) >= 3;
}

/**
 * The headline, put back together when the screenshot set it as several
 * layers: a second line in its own layer, or one accent word in another colour
 * ("Wake Up" / "Actually" / "Rested"). Close in size and close by on the board
 * means one headline. Rows follow the layers' tops and each row reads left to
 * right. A layer that is just the app name is left out, because the art sets
 * the name on its own.
 *
 * A language gets the joined headline only when every part has its own words
 * there. Half translated, it would read in two languages at once, so instead
 * it shows as not translated, which the check reports.
 */
function joinedHeadline(
  board: ArtboardState,
  texts: TextElementProps[],
  appName: string
): { headline: Sourced<TextElementProps>; partIds: Set<string> } | null {
  const name = nameKey(appName);
  // A screenshot that sets the app name biggest is a wordmark, not a headline,
  // and the art sets the name on its own.
  const words = texts.filter((el) => nameKey(el.content) !== name);
  const largest = words[0] ?? texts[0];
  if (!largest) return null;
  const glyph = largest.fontSize / 0.3;
  const parts = (words.length > 0 ? words : texts).filter(
    (el) => el.fontSize >= largest.fontSize * 0.85 && Math.abs(el.position.y - largest.position.y) < glyph * 3
  );
  const partIds = new Set(parts.map((part) => part.id));
  if (parts.length < 2) {
    return { headline: { element: largest, overrides: carriedOverrides(board, largest.id) }, partIds };
  }

  const rows: TextElementProps[][] = [];
  for (const part of [...parts].sort((a, b) => a.position.y - b.position.y)) {
    const row = rows.find((candidate) => Math.abs(candidate[0].position.y - part.position.y) < glyph * 0.6);
    if (row) row.push(part);
    else rows.push([part]);
  }
  for (const row of rows) row.sort((a, b) => a.position.x - b.position.x);
  const join = (text: (part: TextElementProps) => string) =>
    rows.map((row) => row.map((part) => text(part).trim()).join(' ')).join('\n');

  const content = join((part) => part.content);
  const perPart = parts.map((part) => ({ part, overrides: carriedOverrides(board, part.id) }));
  const locales = new Set(perPart.flatMap((entry) => Object.keys(entry.overrides)));
  const overrides: Record<string, ElementLocaleOverride> = {};
  for (const locale of locales) {
    const own = new Map(perPart.map((entry) => [entry.part, entry.overrides[locale]]));
    if ([...own.values()].some((ov) => !ov?.content?.trim())) continue;
    const stamps = [...own.entries()].map(([part, ov]) => ({ part, stamp: ov!.sourceHash }));
    const stale = stamps.find(({ part, stamp }) => stamp && stamp !== hash32(part.content));
    const allStamped = stamps.every(({ stamp }) => !!stamp);
    overrides[locale] = {
      ...own.get(largest),
      content: join((part) => own.get(part)!.content!),
      origin: [...own.values()].some((ov) => ov!.origin !== 'auto') ? 'manual' : 'auto',
      // Stale if any part was; current if every part was stamped current; no
      // stamp at all when some part never had one, like the parts themselves.
      sourceHash: stale ? stale.stamp : allStamped ? hash32(content) : undefined,
    };
    if (!overrides[locale].sourceHash) delete overrides[locale].sourceHash;
  }
  return { headline: { element: { ...largest, content }, overrides }, partIds };
}

/** Words of two letters or more, so letter-spaced "R E V I E W S" is not a phrase. */
function wordsIn(content: string): number {
  return content.trim().split(/\s+/).filter((word) => (word.match(/\p{L}/gu)?.length ?? 0) >= 2).length;
}

/**
 * The app name the add dialog starts with: the project's name without the
 * " Copy" a template adds to it. Some templates are named after a look rather
 * than an app, and "Editors Choice" set as the app name fails the store check
 * on every design, so a name the check turns away starts the field empty.
 */
export function suggestedAppName(projectName: string): string {
  const name = projectName.replace(/\s+copy(?:\s+\d+)?$/i, '').trim();
  return breaksStoreRules(name) ? '' : name;
}

/** Copy as one lowercase line, to tell whether a layer is the app name. */
function nameKey(content: string): string {
  return content.replace(/\s+/g, ' ').trim().toLowerCase();
}

function groundTone(board: ArtboardState | undefined): string | null {
  if (!board) return null;
  if (board.backgroundType === 'gradient' && board.backgroundGradient) {
    return mix(board.backgroundGradient.color1, board.backgroundGradient.color2, 0.5);
  }
  return board.backgroundColor || null;
}

/**
 * Read the look off the first screenshot artboard: ground, type, headline and
 * subheadline, plus the first phone of each of the first five artboards for
 * the screens.
 */
export function readProjectLook(artboards: ArtboardState[], appName: string): ProjectLook {
  const shots = screenshotBoards(artboards);
  const first = shots[0];

  // Copy the store check would turn away (an "App of the day" badge, a price)
  // is never carried onto the art, however big it is on the screenshot.
  const texts = (first?.elements ?? [])
    .filter((el): el is TextElementProps => el.type === 'text' && isWords(el.content) && !breaksStoreRules(el.content))
    .sort((a, b) => b.fontSize - a.fontSize);
  // Nor is a headline the check would only warn about ("The #1 app", "3M+
  // Reviews", a sale, a sentence too long for Apple's short phrase): the next
  // biggest copy on the screenshot is tried instead, so a new design starts
  // with nothing to fix.
  let pool = texts;
  let joined = first ? joinedHeadline(first, pool, appName) : null;
  const flagged = (content: string) => breaksStoreRules(content, true) || !isShortPhrase(content);
  while (first && joined) {
    if (!flagged(joined.headline.element.content)) break;
    // Drop the layers that are the trouble ("The #1 app" over a real line), or
    // every part when only the joined phrase is ("APP OF" / "THE DAY"). Each
    // pass drops at least one layer, so this ends.
    const parts = pool.filter((el) => joined!.partIds.has(el.id));
    const bad = parts.filter((el) => flagged(el.content));
    const drop = new Set((bad.length > 0 ? bad : parts).map((el) => el.id));
    pool = pool.filter((el) => !drop.has(el.id));
    joined = pool.length > 0 ? joinedHeadline(first, pool, appName) : null;
  }
  // Nothing but the app name to go on: the layouts set the name as the
  // headline themselves, rather than twice.
  const headline =
    joined && nameKey(joined.headline.element.content) !== nameKey(appName) ? joined.headline : null;
  const headlineEl = headline?.element;
  // The line that explains it: a real phrase a size down, not a badge or a
  // ticker symbol, and the biggest such line on the screenshot.
  const subheadEl = headlineEl
    ? texts.find(
        (el) =>
          !joined!.partIds.has(el.id) &&
          el.fontSize <= headlineEl.fontSize * 0.8 &&
          wordsIn(el.content) >= 3 &&
          isShortPhrase(el.content) &&
          !breaksStoreRules(el.content, true)
      )
    : undefined;

  const devices: Sourced<DeviceFrameElementProps>[] = [];
  for (const board of shots.slice(0, 5)) {
    const device = board.elements.find((el): el is DeviceFrameElementProps => el.type === 'device');
    if (device) devices.push({ element: device, overrides: carriedOverrides(board, device.id) });
  }

  const ground: ProjectLook['ground'] = first
    ? {
        backgroundColor: first.backgroundColor,
        backgroundType: first.backgroundType,
        backgroundGradient: first.backgroundGradient,
        backgroundImage: first.backgroundImage,
        backgroundImageFit: first.backgroundImageFit,
        backgroundImageTintColor: first.backgroundImageTintColor,
        backgroundImageTintOpacity: first.backgroundImageTintOpacity,
      }
    : FALLBACK_GROUND;
  const pictureGround = !!first?.backgroundImage;
  const tone = groundTone(first) ?? mix(FALLBACK_GROUND.backgroundGradient!.color1, FALLBACK_GROUND.backgroundGradient!.color2, 0.5);

  // The app name as the screenshot sets it. It is never the headline, but on a
  // screenshot with no other copy it is the only type there is to go by.
  const name = nameKey(appName);
  const wordmarkEl = name
    ? (first?.elements ?? [])
        .filter((el): el is TextElementProps => el.type === 'text' && nameKey(el.content) === name)
        .sort((a, b) => b.fontSize - a.fontSize)[0]
    : undefined;
  const typeEl = headlineEl ?? wordmarkEl;

  // A picture can be any colour, so trust the type the user set over it.
  const darkGround = pictureGround && typeEl ? !isDark(typeEl.color) : isDark(tone);
  const textColor = typeEl?.color ?? readableOn(tone);
  const mutedColor = subheadEl?.color ?? mutedOn(tone);

  return {
    appName: appName.trim() || 'Your App',
    ground,
    darkGround,
    pictureGround,
    fontFamily: typeEl?.fontFamily || FALLBACK_FONT,
    textColor,
    mutedColor,
    nameStyle: wordmarkEl
      ? {
          fontFamily: wordmarkEl.fontFamily || typeEl?.fontFamily || FALLBACK_FONT,
          color: wordmarkEl.color,
          ...(wordmarkEl.fontWeight ? { fontWeight: wordmarkEl.fontWeight } : {}),
          ...(wordmarkEl.fontStyle ? { fontStyle: wordmarkEl.fontStyle } : {}),
        }
      : null,
    headline,
    subhead: subheadEl && first ? { element: subheadEl, overrides: carriedOverrides(first, subheadEl.id) } : null,
    devices,
    locales: (getLocalization(artboards)?.locales ?? []).map((entry) => entry.code),
  };
}

// --- type -------------------------------------------------------------------

/**
 * Copy with the line breaks taken out. A screenshot's headline is broken for
 * a phone-width column; set small beside a wordmark it reads better reflowed.
 */
function reflow(content: string): string {
  return content.replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * The name on one line, then broken over two lines and over three where it has
 * the words for it, each time at the spaces that leave its longest line
 * shortest.
 */
function nameBreaks(name: string, face: Face): string[] {
  const words = name.split(' ').filter(Boolean);
  const join = (from: number, to: number) => words.slice(from, to).join(' ');
  const longest = (lines: string[]) => Math.max(...lines.map((line) => roughWidth(line, face)));
  let two: string[] | null = null;
  let three: string[] | null = null;
  for (let i = 1; i < words.length; i++) {
    const pair = [join(0, i), join(i, words.length)];
    if (!two || longest(pair) < longest(two)) two = pair;
    for (let j = i + 1; j < words.length; j++) {
      const trio = [join(0, i), join(i, j), join(j, words.length)];
      if (!three || longest(trio) < longest(three)) three = trio;
    }
  }
  return [name, ...(two ? [two.join('\n')] : []), ...(three ? [three.join('\n')] : [])];
}

// --- element builders --------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = Math.round;

/**
 * A text layer in the face it was fitted in. The size, the tracking and the
 * box width are rounded here the way typeFit.ts rounds them to measure, so the
 * canvas wraps the copy where the fit said it would.
 */
function textElement(args: {
  id: string;
  name: string;
  box: Box;
  content: string;
  glyph: number;
  color: string;
  face: Face;
  align: 'left' | 'center';
}): TextElementProps {
  const { face } = args;
  const fontSize = storedFontSize(args.glyph);
  return {
    id: args.id,
    type: 'text',
    name: args.name,
    position: { x: round(args.box.x), y: round(args.box.y) },
    size: { width: round(args.box.w), height: Math.ceil(args.box.h) },
    rotation: 0,
    scale: 1,
    content: args.content,
    fontSize,
    color: args.color,
    fontFamily: face.fontFamily,
    fontWeight: face.fontWeight,
    ...(face.fontStyle && face.fontStyle !== 'normal' ? { fontStyle: face.fontStyle } : {}),
    textAlign: args.align,
    lineHeight: face.lineHeight,
    ...(face.tracking ? { letterSpacing: storedTracking(fontSize, face.tracking) } : {}),
  };
}

function deviceElement(
  id: string,
  box: Box,
  source: Sourced<DeviceFrameElementProps> | undefined,
  look: ProjectLook
): DeviceFrameElementProps {
  const from = source?.element;
  return {
    id,
    type: 'device',
    name: 'Phone',
    position: { x: round(box.x), y: round(box.y) },
    size: { width: round(box.w), height: round(box.h) },
    rotation: 0,
    scale: 1,
    deviceType: from?.deviceType ?? FALLBACK_DEVICE,
    // Flat, whatever the screenshots use: a 3D frame spends a WebGL context
    // everywhere it is drawn, and the add dialog draws a dozen of these.
    styleType: 'normal',
    ...(from?.frameColor ? { frameColor: from.frameColor } : {}),
    ...(from?.frameOpacity !== undefined ? { frameOpacity: from.frameOpacity } : {}),
    ...(from?.frameStyle ? { frameStyle: from.frameStyle } : {}),
    ...(from?.notchColor ? { notchColor: from.notchColor } : {}),
    screenshotSrc: from?.screenshotSrc ?? (look.darkGround ? PLACEHOLDER_SCREENS.dark : PLACEHOLDER_SCREENS.light),
    screenshotObjectFit: from?.screenshotObjectFit ?? 'cover',
    screenshotRect: from?.screenshotRect ?? { left: 0, top: 0, width: 100, height: 100 },
    ...(from?.naturalScreenshotWidth
      ? { naturalScreenshotWidth: from.naturalScreenshotWidth, naturalScreenshotHeight: from.naturalScreenshotHeight }
      : {}),
  };
}

function deviceAspect(look: ProjectLook): number {
  return getDeviceDescriptor(look.devices[0]?.element.deviceType ?? FALLBACK_DEVICE).nativeAspect;
}

// --- composition -------------------------------------------------------------

/** What a composition hands back: elements plus which source each copy came from. */
interface Composed {
  elements: ArtboardElement[];
  /** new element id -> the overrides it inherits */
  inherited: Record<string, Record<string, ElementLocaleOverride>>;
  /** ids of text elements that hold the app name, which reads the same in every language */
  nameIds: string[];
}

interface Ctx {
  kind: CreativeAssetKind;
  look: ProjectLook;
  /** Apple's art safe area, the part every device shows. */
  area: PixelRect;
  /**
   * Where the copy goes: the art safe area, pulled in a little so the type
   * keeps a margin on a screen that shows no more than the safe area.
   */
  safe: PixelRect;
  /** What an iPhone shows of the board. The screens are sized for this. */
  shown: PixelRect;
  size: { width: number; height: number };
  /** Smallest glyph that still reads where this board shows smallest. */
  minGlyph: number;
  /**
   * Art that is being laid out again already has its lines. The name or the
   * headline gives up size before a line under it is left out.
   */
  keepLines: boolean;
  id: (part: string) => string;
  out: Composed;
}

const NAME_LINE_HEIGHT = 1.08;
/** A text box is this much taller than its lines, so a face that runs tall is not cut. */
const BOX_SLACK = 1.12;
/** How much of its column's height the app name may take when it stands alone. */
const NAME_ALONE_SHARE = 0.62;
/**
 * How far under the size that reads a name or a headline may go, as a share of
 * it, when that is the only way to set it whole.
 */
const LAST_RESORT_SHARE = 0.5;

/**
 * The height of a text box for `lines` of type: a little taller than the lines
 * while `room` allows, and never shorter than them, because the box cuts off
 * whatever it does not hold.
 */
function boxHeight(lines: number, glyph: number, lineHeight: number, room: number): number {
  return Math.max(linesHeight(lines, glyph, lineHeight), Math.min(room, lines * glyph * lineHeight * BOX_SLACK));
}

/** The face the app name is set in: the screenshots' own wordmark when they have one. */
function nameFace(look: ProjectLook): Face {
  const brand = look.nameStyle;
  return {
    fontFamily: brand?.fontFamily ?? look.fontFamily,
    fontWeight: brand?.fontWeight ?? '700',
    fontStyle: brand?.fontStyle,
    lineHeight: NAME_LINE_HEIGHT,
    tracking: -0.02,
  };
}

interface NameFit {
  content: string;
  glyph: number;
  /** The height of its text box. */
  h: number;
  /** False when the column has no room for the name at a size that reads. */
  fits: boolean;
}

/**
 * The app name at the largest size its column takes, on one line, two or
 * three. More lines win only when they set the name clearly bigger, which a
 * name of two or three words needs in a safe area as small as the universal
 * one.
 *
 * The name is never left out and never cut. One with no room at a size that
 * reads wraps over as many lines as `room` holds, and after that it gives up
 * size, down to half of it. Under 10pt on an iPhone the store check says the
 * name is small, and the user can shorten it or move it. A name cut off by its
 * own box reads as a fault in the design.
 */
function fitName(ctx: Ctx, column: Box, maxGlyph: number, room = column.h): NameFit {
  const face = nameFace(ctx.look);
  const name = ctx.look.appName;
  let best: (GlyphFit & { content: string }) | null = null;
  for (const content of nameBreaks(name, face)) {
    const fit = fitGlyph(content, { width: column.w, height: column.h }, {
      max: maxGlyph,
      min: ctx.minGlyph,
      maxLines: content.split('\n').length,
      face,
    });
    if (fit.fits && (!best || fit.glyph > best.glyph * 1.15)) best = { ...fit, content };
  }
  if (best) {
    const h = best.lines * best.glyph * NAME_LINE_HEIGHT * BOX_SLACK;
    return { content: best.content, glyph: best.glyph, h, fits: true };
  }
  const last = fitGlyph(name, { width: column.w, height: room }, {
    max: ctx.minGlyph,
    min: ctx.minGlyph * LAST_RESORT_SHARE,
    maxLines: Infinity,
    face,
  });
  return { content: name, glyph: last.glyph, h: boxHeight(last.lines, last.glyph, NAME_LINE_HEIGHT, room), fits: false };
}

/**
 * The app name, set big, centred or left-aligned at the top of a column.
 * `room` is the height it may wrap into when the column itself is too small.
 */
function addName(
  ctx: Ctx,
  column: Box,
  opts: { align: 'left' | 'center'; maxGlyph: number; room?: number }
): Box & { glyph: number } {
  const fit = fitName(ctx, column, opts.maxGlyph, opts.room);
  const box = { x: column.x, y: column.y, w: column.w, h: fit.h };
  const id = ctx.id('name');
  ctx.out.elements.push(
    textElement({
      id,
      name: 'App name',
      box,
      content: fit.content,
      glyph: fit.glyph,
      color: ctx.look.nameStyle?.color ?? ctx.look.textColor,
      face: nameFace(ctx.look),
      align: opts.align,
    })
  );
  ctx.out.nameIds.push(id);
  return { ...box, glyph: fit.glyph };
}

interface CopyOpts {
  align: 'left' | 'center';
  maxGlyph: number;
  minGlyph: number;
  maxLines: number;
  weight: string;
  muted?: boolean;
  /** Take the source's line breaks out, in every language. */
  reflowed?: boolean;
  /**
   * Never left out. Copy with no room at `minGlyph` takes more lines, and
   * after that goes under it, the way the app name does.
   */
  required?: boolean;
}

/** The face the project's own copy is set in, bold for a headline and regular for the line under it. */
function copyFace(look: ProjectLook, weight: string): Face {
  const regular = weight === '400';
  return {
    fontFamily: look.fontFamily,
    fontWeight: weight,
    lineHeight: regular ? 1.3 : 1.1,
    tracking: regular ? 0 : -0.015,
  };
}

/** One line of the project's own copy, sized for a column, before it is added. */
function fitCopy(ctx: Ctx, source: Sourced<TextElementProps>, column: Box, opts: CopyOpts) {
  const face = copyFace(ctx.look, opts.weight);
  const original = source.element.content;
  const content = opts.reflowed ? reflow(original) : original;
  const overrides = opts.reflowed ? reflowOverrides(source.overrides, original, content) : source.overrides;
  // Every language shares the box. A translation that runs long is shrunk to
  // fit it when it is drawn (resolveLocaleFontSize), and the base language is
  // not, so the base copy has to fit as it stands. The longest language is
  // fitted with it, so that a German line does not have to shrink far.
  const longest = [content, ...Object.values(overrides).map((ov) => ov.content ?? '')].reduce(
    (a, b) => (b.length > a.length ? b : a),
    content
  );
  const fitted = longest === content ? content : [content, longest];
  const box = { width: column.w, height: column.h };
  let fit = fitGlyph(fitted, box, { max: opts.maxGlyph, min: opts.minGlyph, maxLines: opts.maxLines, face });
  if (!fit.fits && opts.required) {
    const last = fitGlyph(fitted, box, {
      max: opts.minGlyph,
      min: opts.minGlyph * LAST_RESORT_SHARE,
      maxLines: Infinity,
      face,
    });
    fit = { ...last, fits: false };
  }
  return { content, overrides, face, fit };
}

/**
 * The least height a line of copy needs under a name or a headline: its box at
 * the smallest size that reads. Null when it has no room at that size even
 * with the column to itself.
 */
function leastRoom(ctx: Ctx, source: Sourced<TextElementProps>, column: Box, opts: CopyOpts): number | null {
  const least = fitCopy(ctx, source, column, { ...opts, maxGlyph: opts.minGlyph });
  return least.fit.fits ? boxHeight(least.fit.lines, least.fit.glyph, least.face.lineHeight, column.h) : null;
}

/**
 * A copied line of the project's own copy (its headline or subheadline), with
 * that element's translations.
 */
function addCopy(
  ctx: Ctx,
  source: Sourced<TextElementProps>,
  part: string,
  column: Box,
  opts: CopyOpts
): Box & { glyph: number } {
  const { content, overrides, face, fit } = fitCopy(ctx, source, column, opts);
  const box = { x: column.x, y: column.y, w: column.w, h: boxHeight(fit.lines, fit.glyph, face.lineHeight, column.h) };
  const id = ctx.id(part);
  ctx.out.elements.push(
    textElement({
      id,
      name: opts.weight === '400' ? 'Subheadline' : 'Headline',
      box,
      content,
      glyph: fit.glyph,
      color: opts.muted ? ctx.look.mutedColor : ctx.look.textColor,
      face,
      align: opts.align,
    })
  );
  if (Object.keys(overrides).length > 0) ctx.out.inherited[id] = overrides;
  return { ...box, glyph: fit.glyph };
}

/**
 * The same translations, reflowed. A translation that was current for the old
 * base text is re-stamped against the new one, so reflowing alone never makes
 * it read "changed since this was translated"; one that was already behind
 * keeps its old stamp and stays flagged.
 */
function reflowOverrides(
  overrides: Record<string, ElementLocaleOverride>,
  original: string,
  reflowed: string
): Record<string, ElementLocaleOverride> {
  const was = hash32(original);
  const out: Record<string, ElementLocaleOverride> = {};
  for (const [locale, ov] of Object.entries(overrides)) {
    out[locale] = {
      ...ov,
      ...(ov.content !== undefined ? { content: reflow(ov.content) } : {}),
      ...(ov.sourceHash && ov.sourceHash === was ? { sourceHash: hash32(reflowed) } : {}),
    };
  }
  return out;
}

function addDevice(ctx: Ctx, part: string, box: Box, index: number): void {
  const devices = ctx.look.devices;
  const source = devices.length > 0 ? devices[index % devices.length] : undefined;
  const id = ctx.id(part);
  ctx.out.elements.push(deviceElement(id, box, source, ctx.look));
  if (source && Object.keys(source.overrides).length > 0) ctx.out.inherited[id] = source.overrides;
}

/** Shift every element added since `from` down by `dy`, to centre a stack built top down. */
function shiftSince(ctx: Ctx, from: number, dy: number): void {
  for (const el of ctx.out.elements.slice(from)) el.position = { x: el.position.x, y: round(el.position.y + dy) };
}

/**
 * App name plus, when the project has one and it fits, its headline under it,
 * as one block centred in `column`. On a safe area too small for a second line
 * at a size that reads, the name takes the column alone.
 */
function nameStack(ctx: Ctx, column: Box, opts: { align: 'left' | 'center'; nameShare: number; tagline: boolean }): void {
  const from = ctx.out.elements.length;
  const tagline = opts.tagline ? ctx.look.headline ?? ctx.look.subhead : null;
  if (tagline) {
    const lineBase: CopyOpts = {
      align: opts.align,
      maxGlyph: ctx.minGlyph,
      minGlyph: ctx.minGlyph,
      maxLines: 2,
      weight: '400',
      muted: true,
      reflowed: true,
    };
    /** The name in `share` of the column with the line under it. False, with nothing added, when they do not both fit. */
    const stack = (share: number): boolean => {
      const nameColumn = { ...column, h: column.h * share };
      const fitted = fitName(ctx, nameColumn, nameColumn.h * 0.92);
      const top = column.y + fitted.h + fitted.glyph * 0.22;
      const lineColumn = { x: column.x, y: top, w: column.w, h: column.y + column.h - top };
      const lineOpts: CopyOpts = { ...lineBase, maxGlyph: Math.max(fitted.glyph * 0.4, ctx.minGlyph) };
      // A name that needs more than its share of the column leaves the line no room.
      if (!fitted.fits || lineColumn.h <= 0 || !fitCopy(ctx, tagline, lineColumn, lineOpts).fit.fits) return false;
      addName(ctx, nameColumn, { align: opts.align, maxGlyph: nameColumn.h * 0.92 });
      const copy = addCopy(ctx, tagline, 'tagline', lineColumn, lineOpts);
      shiftSince(ctx, from, (column.h - (copy.y + copy.h - column.y)) / 2);
      return true;
    };
    if (stack(opts.nameShare)) return;
    if (ctx.keepLines) {
      // The art already has this line. A name's box and the gap under it run
      // to about 1.32 times the height the name is given, so this is the most
      // the name can have and still leave the line its least room.
      const room = leastRoom(ctx, tagline, column, lineBase);
      const share = room === null ? 0 : (column.h - room) / 1.32 / column.h;
      if (share > 0 && share < opts.nameShare && stack(share)) return;
    }
  }
  const alone = { ...column, h: column.h * NAME_ALONE_SHARE };
  const name = addName(ctx, alone, { align: opts.align, maxGlyph: alone.h * 0.92, room: column.h });
  shiftSince(ctx, from, (column.h - name.h) / 2);
}

/**
 * The headline, and the subheadline under it when it fits at a size that
 * reads, as a block centred in `column`. The app name is left off: a search
 * result prints the name right above this art, and the line it would take is
 * a fifth of the safe area.
 */
function headlineStack(
  ctx: Ctx,
  column: Box,
  opts: { align: 'left' | 'center'; maxGlyph: number; subhead: boolean }
): void {
  const from = ctx.out.elements.length;
  const headline = ctx.look.headline;
  if (!headline) {
    // No copy in the project yet: the app name is the headline.
    const name = addName(ctx, { ...column, h: column.h * NAME_ALONE_SHARE }, {
      align: opts.align,
      maxGlyph: opts.maxGlyph,
      room: column.h,
    });
    shiftSince(ctx, from, (column.h - name.h) / 2);
    return;
  }

  const headOpts: CopyOpts = {
    align: opts.align,
    maxGlyph: opts.maxGlyph,
    minGlyph: ctx.minGlyph,
    maxLines: 4,
    weight: '700',
    required: true,
  };
  const sub = opts.subhead ? ctx.look.subhead : null;
  const subBase: CopyOpts = {
    align: opts.align,
    maxGlyph: ctx.minGlyph,
    minGlyph: ctx.minGlyph,
    maxLines: 3,
    weight: '400',
    muted: true,
    reflowed: true,
  };
  /** Where the line under a headline set in `headColumn` would go, and the type it would be set in. */
  const under = (glyph: number, bottom: number) => {
    const top = bottom + glyph * 0.3;
    return {
      column: { x: column.x, y: top, w: column.w, h: column.y + column.h - top },
      opts: { ...subBase, maxGlyph: Math.max(glyph * 0.42, ctx.minGlyph) } as CopyOpts,
    };
  };
  let headColumn = column;
  if (sub && ctx.keepLines) {
    // The art already has this line. When the headline at its full size
    // leaves it no room, the headline is fitted into what is left once the
    // line has its least room and the gap over it, as long as it still fits
    // there at a size that reads.
    const head = fitCopy(ctx, headline, column, headOpts);
    const line = under(head.fit.glyph, column.y + boxHeight(head.fit.lines, head.fit.glyph, head.face.lineHeight, column.h));
    if (line.column.h <= 0 || !fitCopy(ctx, sub, line.column, line.opts).fit.fits) {
      const room = leastRoom(ctx, sub, column, subBase);
      const left = room === null ? 0 : column.h - room - opts.maxGlyph * 0.3;
      if (left > 0 && fitCopy(ctx, headline, { ...column, h: left }, headOpts).fit.fits) headColumn = { ...column, h: left };
    }
  }
  const box = addCopy(ctx, headline, 'headline', headColumn, headOpts);
  let cursor = box.y + box.h;
  if (sub) {
    const line = under(box.glyph, cursor);
    if (line.column.h > 0 && fitCopy(ctx, sub, line.column, line.opts).fit.fits) {
      const subBox = addCopy(ctx, sub, 'subhead', line.column, line.opts);
      cursor = subBox.y + subBox.h;
    }
  }
  shiftSince(ctx, from, (column.h - (cursor - column.y)) / 2);
}

/**
 * A device in the strip an iPhone shows beside the safe area, which leaves the
 * copy the whole safe area and still fills the phone's screen. A device that
 * shows only the safe area sees the copy on its own.
 *
 * With `rising` the device comes up from the bottom edge and runs off it,
 * starting no higher than the copy, which keeps a header's screen out from
 * under the back and share buttons. Without it the device floats in the
 * middle of what the iPhone shows.
 */
function sideDevice(ctx: Ctx, side: 'left' | 'right', opts: { maxHeight: number; rising: boolean }): Box {
  const shown = ctx.shown;
  const area = ctx.area;
  const strip =
    side === 'right'
      ? { x: area.x + area.width, w: shown.x + shown.width - (area.x + area.width) }
      : { x: shown.x, w: area.x - shown.x };
  const aspect = deviceAspect(ctx.look);
  const w = Math.min(strip.w * 0.84, opts.maxHeight * aspect);
  const h = w / aspect;
  const x = strip.x + (strip.w - w) / 2;
  // A MacBook or a watch comes out short for its width. Lined up with the
  // copy it reads as part of the design; anywhere else it looks dropped.
  if (h < ctx.safe.height) return { x, y: ctx.safe.y + (ctx.safe.height - h) / 2, w, h };
  if (!opts.rising) return { x, y: shown.y + (shown.height - h) / 2, w, h };
  const y = Math.max(shown.y + shown.height - h * 0.86, ctx.safe.y - ctx.safe.height * 0.1);
  return { x, y, w, h };
}

const COMPOSERS: Record<string, (ctx: Ctx) => void> = {
  // Apple's own examples are all this: a brand mark over a scene. On the
  // product page the name and subtitle sit right under the header, so the
  // header one stays a mark; search results show it cold, so it gets a line.
  wordmark(ctx) {
    const s = ctx.safe;
    nameStack(ctx, { x: s.x, y: s.y, w: s.width, h: s.height }, {
      align: 'center',
      nameShare: 0.5,
      tagline: ctx.kind !== 'header',
    });
  },

  'name-phone'(ctx) {
    const s = ctx.safe;
    if (ctx.kind === 'universal') {
      // The universal safe area holds a name at a size that reads and little
      // else, and it sits above the middle of the art. So the name takes all
      // of it, and the screen rises underneath, where the art is otherwise bare.
      const aspect = deviceAspect(ctx.look);
      const w = Math.min(ctx.shown.height * 0.72 * aspect, s.width * 0.9);
      addDevice(ctx, 'phone', { x: (ctx.size.width - w) / 2, y: s.y + s.height * 1.08, w, h: w / aspect }, 0);
      nameStack(ctx, { x: s.x, y: s.y, w: s.width, h: s.height }, { align: 'center', nameShare: 0.5, tagline: true });
      return;
    }
    addDevice(ctx, 'phone', sideDevice(ctx, 'right', { maxHeight: ctx.shown.height * 0.87, rising: true }), 0);
    nameStack(ctx, { x: s.x, y: s.y, w: s.width, h: s.height }, { align: 'left', nameShare: 0.55, tagline: true });
  },

  // Five screens across what an iPhone shows, running off the bottom of the
  // header. A screen that shows only the safe area sees the middle three.
  showcase(ctx) {
    const s = ctx.safe;
    const nameH = s.height * 0.34;
    addName(ctx, { x: s.x, y: s.y, w: s.width, h: nameH }, { align: 'center', maxGlyph: nameH * 0.9 });
    const top = s.y + nameH + s.height * 0.07;
    const aspect = deviceAspect(ctx.look);
    const gapShare = 0.14;
    // As tall as the room under the name plus a little that runs off, unless
    // five that tall are wider than the phone shows, which is what sizes a row
    // of laptops.
    const w = Math.min(
      (ctx.shown.y + ctx.shown.height - top) * 1.16 * aspect,
      (ctx.shown.width * 0.9) / (5 + 4 * gapShare)
    );
    const height = w / aspect;
    const gap = w * gapShare;
    const center = ctx.size.width / 2;
    // Centre first in the source order, then alternately right and left, so
    // the first screenshot is the one in the middle.
    const slots = [0, 1, -1, 2, -2];
    slots
      .map((slot, index) => ({ slot, index }))
      .sort((a, b) => Math.abs(b.slot) - Math.abs(a.slot))
      .forEach(({ slot, index }) => {
        addDevice(ctx, `phone-${index + 1}`, { x: center - w / 2 + slot * (w + gap), y: top, w, h: height }, index);
      });
  },

  // Apple's "Plan your hiking expedition" example: say what it does, show it.
  'headline-phone'(ctx) {
    const s = ctx.safe;
    addDevice(ctx, 'phone', sideDevice(ctx, 'right', { maxHeight: ctx.shown.height * 0.72, rising: false }), 0);
    headlineStack(ctx, { x: s.x, y: s.y, w: s.width, h: s.height }, {
      align: 'left',
      maxGlyph: s.height * 0.26,
      subhead: true,
    });
  },

  // The headline between a screen on each side.
  'two-phones'(ctx) {
    const s = ctx.safe;
    const fit = { maxHeight: ctx.shown.height * 0.72, rising: false };
    addDevice(ctx, 'phone-2', sideDevice(ctx, 'left', fit), 1);
    addDevice(ctx, 'phone-1', sideDevice(ctx, 'right', fit), 0);
    headlineStack(ctx, { x: s.x, y: s.y, w: s.width, h: s.height }, {
      align: 'center',
      maxGlyph: s.height * 0.26,
      subhead: false,
    });
  },
};

// --- boards -------------------------------------------------------------------

/**
 * Null when the page already has the faces a design from `look` is set in,
 * else a promise that settles once it does. buildCreativeBoard fits its type
 * by measuring it, so a board that is going into the project is built after
 * this. The cards in the add dialog do not wait: they are built again when a
 * face arrives.
 */
export function lookFacesPending(look: ProjectLook): Promise<void> | null {
  const faces = [nameFace(look)];
  // A headline is set bold on search art, and regular as the line under a name.
  if (look.headline) faces.push(copyFace(look, '700'));
  if (look.headline || look.subhead) faces.push(copyFace(look, '400'));
  const copy = [look.appName, look.headline?.element.content, look.subhead?.element.content].filter(Boolean).join(' ');
  return facesPending(faces, copy);
}

/**
 * One finished creative artboard.
 *
 * `seed` goes into every id. The add dialog builds its cards with a fixed seed
 * so a re-render keeps the same React keys; the boards that land in a project
 * get a fresh one, because element ids have to be unique across the project
 * for the language overrides to stay attached to the right layer.
 *
 * `size` is for art that is already another size Apple takes, such as search
 * art at 1920 x 1280. Everything is laid out from the safe area and the iPhone
 * area, and both scale with the board. `keepLines` is for art that is being
 * laid out again (see Ctx).
 */
export function buildCreativeBoard(
  kind: CreativeAssetKind,
  lookId: string,
  look: ProjectLook,
  seed: string,
  opts: { size?: Size; keepLines?: boolean } = {}
): ArtboardState {
  const spec = creativeSpec(kind);
  const size = opts.size ?? { width: spec.width, height: spec.height };
  const board = { creativeAsset: kind, size };
  const safe = safeAreaFor(board)!;
  const out: Composed = { elements: [], inherited: {}, nameIds: [] };
  const sideInset = safe.width * 0.06;
  const ctx: Ctx = {
    kind,
    look,
    area: safe,
    safe: {
      x: safe.x + sideInset,
      y: safe.y + safe.height * 0.03,
      width: safe.width - sideInset * 2,
      height: safe.height * 0.94,
    },
    shown: iphoneAreaFor(board)!,
    size,
    minGlyph: minReadableGlyph(board),
    keepLines: opts.keepLines ?? false,
    id: (part) => `cr-${seed}-${kind}-${part}`,
    out,
  };
  const compose = COMPOSERS[CREATIVE_LOOKS[kind].some((entry) => entry.id === lookId) ? lookId : defaultLook(kind)];
  compose(ctx);

  // Every language starts from what the source elements already had. The app
  // name is the same word in all of them, so it is filled in rather than left
  // counting as untranslated in every language the project has.
  const localized: Record<string, Record<string, ElementLocaleOverride>> = {};
  for (const [elementId, overrides] of Object.entries(out.inherited)) {
    for (const [locale, ov] of Object.entries(overrides)) {
      (localized[locale] ??= {})[elementId] = { ...ov };
    }
  }
  const nameHash = hash32(look.appName);
  for (const locale of look.locales) {
    for (const elementId of out.nameIds) {
      const content = (out.elements.find((el) => el.id === elementId) as TextElementProps | undefined)?.content;
      if (content === undefined) continue;
      (localized[locale] ??= {})[elementId] = {
        content,
        origin: 'manual',
        sourceHash: content === look.appName ? nameHash : hash32(content),
      };
    }
  }

  return {
    id: `artboard_${seed}_${kind}`,
    name: spec.boardName,
    // Derived and overwritten by calculateArtboardPositions (AGENTS rule 4).
    position: { x: 0, y: 0 },
    size,
    elements: out.elements,
    ...look.ground,
    zoom: 1,
    creativeAsset: kind,
    ...(Object.keys(localized).length > 0 ? { localized } : {}),
  };
}

// --- art that is already in the project ---------------------------------------
//
// A design made before the art was sized for an iPhone sits small in the
// middle of the phone (issue #46), and one fitted while its face was still
// loading is fitted in the fallback. Both are put right by laying the same
// design out again, from what is on the artboard now: its words as they were
// edited, its translations, its screens, its type and its ground.

/** The part of a design a layer is, as the layer's id names it. */
const PART = /^cr-(.+)-(?:header|search|universal)-(name|tagline|headline|subhead|phone)(?:-(\d+))?$/;

/** The layers of a creative artboard that a design put there. */
interface DesignLayers {
  name: TextElementProps | null;
  headline: TextElementProps | null;
  /** The line under the name or under the headline. */
  line: TextElementProps | null;
  /** In the order the design numbers its screens: the first screenshot first. */
  devices: DeviceFrameElementProps[];
  ids: Set<string>;
  /** The seed in the layers' ids, while they still carry one. */
  seed: string | null;
}

/**
 * Where a screen that has lost its number stood in the design, by its place
 * from the left. Two screens are numbered right then left, and a row of five
 * from the middle outwards.
 */
function screenOrder(count: number): number[] {
  if (count === 2) return [1, 0];
  if (count === 5) return [4, 2, 0, 1, 3];
  return Array.from({ length: count }, (_, index) => index);
}

function designLayers(board: ArtboardState): DesignLayers | null {
  const made: DesignLayers = { name: null, headline: null, line: null, devices: [], ids: new Set(), seed: null };
  const screens: { device: DeviceFrameElementProps; index: number | null }[] = [];
  for (const el of board.elements) {
    const match = PART.exec(el.id);
    let part = match?.[2] ?? null;
    // A duplicated artboard gets new ids. The names the designs give their
    // layers are still on it.
    if (!part && el.type === 'text') {
      part = el.name === 'App name' ? 'name' : el.name === 'Headline' ? 'headline' : el.name === 'Subheadline' ? 'subhead' : null;
    } else if (!part && el.type === 'device' && el.name === 'Phone') {
      part = 'phone';
    }
    if (!part) continue;
    if (part === 'phone') {
      if (el.type !== 'device') continue;
      screens.push({ device: el as DeviceFrameElementProps, index: match ? Number(match[3] ?? 1) - 1 : null });
    } else {
      if (el.type !== 'text') continue;
      const text = el as TextElementProps;
      if (part === 'name') made.name ??= text;
      else if (part === 'headline') made.headline ??= text;
      else made.line ??= text;
    }
    made.ids.add(el.id);
    if (match && !made.seed) made.seed = match[1];
  }
  if (made.ids.size === 0) return null;

  if (screens.every((screen) => screen.index !== null)) {
    screens.sort((a, b) => a.index! - b.index!);
  } else {
    screens.sort((a, b) => a.device.position.x - b.device.position.x);
    const order = screenOrder(screens.length);
    screens.forEach((screen, rank) => (screen.index = order[rank]));
    screens.sort((a, b) => a.index! - b.index!);
  }
  made.devices = screens.map((screen) => screen.device);
  return made;
}

/** The look a design was built with, told from the screens it has. */
function lookOf(kind: CreativeAssetKind, made: DesignLayers): string {
  const screens = made.devices.length;
  if (kind === 'header') return screens >= 3 ? 'showcase' : screens >= 1 ? 'name-phone' : 'wordmark';
  if (kind === 'universal') return screens >= 1 ? 'name-phone' : 'wordmark';
  if (screens >= 2) return 'two-phones';
  // A headline with no name over it is a headline design, with or without its screen.
  return screens === 1 || (made.headline && !made.name) ? 'headline-phone' : 'wordmark';
}

/** Copy as one line: a name that a design broke over two lines is still one name. */
function oneLine(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

/** True for an App Store header or search artboard that one of these designs made. */
export function canRebuildCreativeBoard(board: ArtboardState): boolean {
  return isCreativeAssetKind(board.creativeAsset) && designLayers(board) !== null;
}

/**
 * Null when the page has the faces a rebuild of this artboard sets its type
 * in, else a promise that settles once it does: the name in the name's own
 * face, a headline in bold and the line under it in regular.
 */
export function boardFacesPending(board: ArtboardState): Promise<void> | null {
  const made = designLayers(board);
  if (!made) return null;
  const faces: Pick<Face, 'fontFamily' | 'fontWeight' | 'fontStyle'>[] = [];
  if (made.name) {
    faces.push({ fontFamily: made.name.fontFamily, fontWeight: made.name.fontWeight ?? '700', fontStyle: made.name.fontStyle });
  }
  const copyFamily = (made.headline ?? made.line ?? made.name)?.fontFamily ?? '';
  if (made.headline) faces.push({ fontFamily: copyFamily, fontWeight: '700' });
  if (made.line) faces.push({ fontFamily: copyFamily, fontWeight: '400' });
  const copy = [made.name, made.headline, made.line].map((text) => text?.content ?? '').join(' ');
  return facesPending(faces, copy);
}

/**
 * True while a face this artboard's text was fitted in is still on its way.
 * Art built in that state is fitted in the fallback, and is worth fitting
 * again once this turns false.
 */
export function boardFacesMissing(board: ArtboardState): boolean {
  const texts = board.elements.filter((el): el is TextElementProps => el.type === 'text');
  return facesOnTheirWay(
    texts.map((text) => ({ fontFamily: text.fontFamily, fontWeight: text.fontWeight ?? '400', fontStyle: text.fontStyle }))
  );
}

/**
 * An App Store header or search artboard laid out again, as the design it was
 * made with. Null for art no design here made.
 *
 * It keeps what is on the artboard: the words as they were edited, their
 * translations, the screens, the type and its colours, the ground, and every
 * layer the user added. Only where things sit and how big they are is new. A
 * line under the name or the headline stays whenever it can be set at a size
 * that reads, with the name or the headline smaller to make the room. A design
 * that has lost its screens gets the project's back, and one that has lost its
 * name gets `appName`.
 *
 * The layers keep their ids while they still carry the design's seed, so a
 * selection and a translation stay on the layer they were on. `seed` is for
 * an artboard that was duplicated, whose ids are no longer the design's.
 */
export function rebuildCreativeBoard(
  board: ArtboardState,
  artboards: ArtboardState[],
  opts: { seed: string; appName: string }
): ArtboardState | null {
  const kind = board.creativeAsset;
  if (!isCreativeAssetKind(kind)) return null;
  const made = designLayers(board);
  if (!made) return null;

  const named = made.name ? oneLine(made.name.content) : '';
  const base = readProjectLook(artboards, named || opts.appName);
  const sourced = <T extends ArtboardElement>(element: T): Sourced<T> => ({
    element,
    overrides: carriedOverrides(board, element.id),
  });
  const tone = groundTone(board);
  const type = made.headline ?? made.line ?? made.name;
  const look: ProjectLook = {
    ...base,
    darkGround: board.backgroundImage && type ? !isDark(type.color) : tone ? isDark(tone) : base.darkGround,
    pictureGround: !!board.backgroundImage,
    fontFamily: (made.headline ?? made.line ?? made.name)?.fontFamily || base.fontFamily,
    textColor: made.headline?.color ?? made.name?.color ?? base.textColor,
    mutedColor: made.line?.color ?? base.mutedColor,
    nameStyle: made.name
      ? {
          fontFamily: made.name.fontFamily || base.fontFamily,
          color: made.name.color,
          ...(made.name.fontWeight ? { fontWeight: made.name.fontWeight } : {}),
          ...(made.name.fontStyle ? { fontStyle: made.name.fontStyle } : {}),
        }
      : base.nameStyle,
    headline: made.headline ? sourced(made.headline) : null,
    subhead: made.line ? sourced(made.line) : null,
    devices: made.devices.length > 0 ? made.devices.map(sourced) : base.devices,
  };
  const built = buildCreativeBoard(kind, lookOf(kind, made), look, made.seed ?? opts.seed, {
    size: board.size,
    keepLines: true,
  });

  // The user's own layers stay where they are, under or over the design's.
  const first = board.elements.findIndex((el) => made.ids.has(el.id));
  const under = board.elements.filter((el, index) => index < first && !made.ids.has(el.id));
  const over = board.elements.filter((el, index) => index > first && !made.ids.has(el.id));

  const localized: NonNullable<ArtboardState['localized']> = {};
  for (const [locale, layers] of Object.entries(board.localized ?? {})) {
    const kept = Object.fromEntries(Object.entries(layers ?? {}).filter(([id]) => !made.ids.has(id)));
    if (Object.keys(kept).length > 0) localized[locale] = kept;
  }
  for (const [locale, layers] of Object.entries(built.localized ?? {})) {
    localized[locale] = { ...localized[locale], ...layers };
  }

  const { localized: _before, ...rest } = board;
  return {
    ...rest,
    elements: [...under, ...built.elements, ...over],
    ...(Object.keys(localized).length > 0 ? { localized } : {}),
  };
}
