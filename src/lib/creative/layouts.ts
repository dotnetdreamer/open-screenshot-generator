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
 * Everything sits inside Apple's art safe area (specs.ts). Only the ground and
 * the lower part of a phone run past it, which is the "outer space is mood
 * only" rule from Apple's templates.
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
 * Pure and DOM free like socialLayouts.ts, so the add dialog can rebuild every
 * card on each render. Text height is estimated, with generous boxes, for the
 * same reason that file gives.
 */

import type {
  ArtboardElement,
  ArtboardState,
  CreativeAssetKind,
  DeviceFrameElementProps,
  DeviceType,
  ElementLocaleOverride,
  TextElementProps,
} from '@/types/artboard';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';
import { hash32 } from '@/lib/i18n/hash';
import { getLocalization } from '@/lib/i18n/localization';
import { isDark, mix, mutedOn, readableOn } from '@/lib/graphics/color';
import { breaksStoreRules, isShortPhrase } from './check';
import {
  creativeSpec,
  headerButtonClearance,
  minReadableGlyph,
  safeAreaFor,
  screenshotBoards,
  type PixelRect,
} from './specs';

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
    { id: 'name-phone', label: 'Name and screen', blurb: 'Name and tagline next to your first screen' },
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

/** Average advance of a glyph in ems. Bold display faces run wide; leave room. */
const BOLD_ADVANCE = 0.62;
const REGULAR_ADVANCE = 0.54;

function lineCount(content: string, glyph: number, width: number, advance: number): number {
  const perLine = Math.max(1, Math.floor(width / (glyph * advance)));
  return content
    .split('\n')
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.trim().length / perLine)), 0);
}

/**
 * The largest glyph, in artboard px, at which `content` fits the box in at most
 * `maxLines` lines. Never below `minGlyph`: a block that cannot fit is better
 * clipped at a readable size than shrunk to a smear.
 */
function fitGlyph(
  content: string,
  box: { width: number; height: number },
  opts: { max: number; min: number; lineHeight: number; advance: number; maxLines: number }
): { glyph: number; lines: number } {
  // A line break the writer typed is a line whatever the size, so the limit
  // can never be below the number of them.
  const maxLines = Math.max(opts.maxLines, content.split('\n').length);
  let glyph = opts.max;
  for (let step = 0; step < 60; step++) {
    const lines = lineCount(content, glyph, box.width, opts.advance);
    if (lines <= maxLines && lines * glyph * opts.lineHeight <= box.height) return { glyph, lines };
    const next = glyph * 0.95;
    if (next < opts.min) break;
    glyph = next;
  }
  glyph = Math.max(opts.min, glyph);
  return { glyph, lines: lineCount(content, glyph, box.width, opts.advance) };
}

/**
 * Copy with the line breaks taken out. A screenshot's headline is broken for
 * a phone-width column; set small beside a wordmark it reads better reflowed.
 */
function reflow(content: string): string {
  return content.replace(/\s*\n\s*/g, ' ').trim();
}

/** A name long enough to want two lines is split at the space nearest its middle. */
function wordmarkLines(name: string): string {
  if (name.length <= 14 || !name.includes(' ')) return name;
  const middle = name.length / 2;
  let best = -1;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === ' ' && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i;
  }
  return best < 0 ? name : `${name.slice(0, best)}\n${name.slice(best + 1)}`;
}

// --- element builders --------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = Math.round;

function textElement(args: {
  id: string;
  name: string;
  box: Box;
  content: string;
  glyph: number;
  color: string;
  fontFamily: string;
  weight: string;
  fontStyle?: string;
  align: 'left' | 'center';
  lineHeight: number;
  tracking?: number;
}): TextElementProps {
  const fontSize = args.glyph * 0.3;
  return {
    id: args.id,
    type: 'text',
    name: args.name,
    position: { x: round(args.box.x), y: round(args.box.y) },
    size: { width: round(args.box.w), height: round(args.box.h) },
    rotation: 0,
    scale: 1,
    content: args.content,
    fontSize: Math.round(fontSize * 10) / 10,
    color: args.color,
    fontFamily: args.fontFamily,
    fontWeight: args.weight,
    ...(args.fontStyle && args.fontStyle !== 'normal' ? { fontStyle: args.fontStyle } : {}),
    textAlign: args.align,
    lineHeight: args.lineHeight,
    ...(args.tracking ? { letterSpacing: Math.round(fontSize * args.tracking * 100) / 100 } : {}),
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
  /**
   * Where the copy and the phones go: the art safe area, pulled in at the
   * sides. On header art the sides clear the back and share buttons iOS draws
   * over the safe area's top corners; on search art it is breathing room from
   * the edge of the card, which shows little more than the safe area.
   */
  safe: PixelRect;
  size: { width: number; height: number };
  /** Smallest glyph that still reads where this board shows smallest. */
  minGlyph: number;
  id: (part: string) => string;
  out: Composed;
}

/** The app name, set big, centred or left-aligned in a column. */
function addName(ctx: Ctx, column: Box, opts: { align: 'left' | 'center'; maxGlyph: number; minGlyph: number }): Box {
  const content = wordmarkLines(ctx.look.appName);
  const lines = content.split('\n').length;
  const fit = fitGlyph(content, { width: column.w, height: column.h }, {
    max: opts.maxGlyph,
    min: opts.minGlyph,
    lineHeight: 1.08,
    advance: BOLD_ADVANCE,
    maxLines: lines,
  });
  const h = fit.lines * fit.glyph * 1.08 * 1.12;
  const box = { x: column.x, y: column.y, w: column.w, h };
  const id = ctx.id('name');
  const brand = ctx.look.nameStyle;
  ctx.out.elements.push(
    textElement({
      id,
      name: 'App name',
      box,
      content,
      glyph: fit.glyph,
      color: brand?.color ?? ctx.look.textColor,
      fontFamily: brand?.fontFamily ?? ctx.look.fontFamily,
      weight: brand?.fontWeight ?? '700',
      fontStyle: brand?.fontStyle,
      align: opts.align,
      lineHeight: 1.08,
      tracking: -0.02,
    })
  );
  ctx.out.nameIds.push(id);
  return box;
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
  opts: {
    align: 'left' | 'center';
    maxGlyph: number;
    minGlyph: number;
    maxLines: number;
    weight: string;
    muted?: boolean;
    /** Take the source's line breaks out, in every language. */
    reflowed?: boolean;
  }
): Box {
  const lineHeight = opts.weight === '400' ? 1.3 : 1.1;
  const advance = opts.weight === '400' ? REGULAR_ADVANCE : BOLD_ADVANCE;
  const original = source.element.content;
  const content = opts.reflowed ? reflow(original) : original;
  const overrides = opts.reflowed ? reflowOverrides(source.overrides, original, content) : source.overrides;
  // Fitted against the longest language, so a German line is not the one that
  // overflows: the box is shared by every language.
  const longest = [content, ...Object.values(overrides).map((ov) => ov.content ?? '')].reduce(
    (a, b) => (b.length > a.length ? b : a),
    content
  );
  const fit = fitGlyph(longest, { width: column.w, height: column.h }, {
    max: opts.maxGlyph,
    min: opts.minGlyph,
    lineHeight,
    advance,
    maxLines: opts.maxLines,
  });
  const h = Math.min(column.h, fit.lines * fit.glyph * lineHeight * 1.12);
  const box = { x: column.x, y: column.y, w: column.w, h };
  const id = ctx.id(part);
  ctx.out.elements.push(
    textElement({
      id,
      name: opts.weight === '400' ? 'Subheadline' : 'Headline',
      box,
      content,
      glyph: fit.glyph,
      color: opts.muted ? ctx.look.mutedColor : ctx.look.textColor,
      fontFamily: ctx.look.fontFamily,
      weight: opts.weight,
      align: opts.align,
      lineHeight,
      tracking: opts.weight === '400' ? undefined : -0.015,
    })
  );
  if (Object.keys(overrides).length > 0) ctx.out.inherited[id] = overrides;
  return box;
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
 * App name plus, when the project has one, its headline under it, as one block
 * centred in `column`.
 */
function nameStack(ctx: Ctx, column: Box, opts: { align: 'left' | 'center'; nameShare: number; tagline: boolean }): void {
  const from = ctx.out.elements.length;
  const name = addName(ctx, { ...column, h: column.h * opts.nameShare }, {
    align: opts.align,
    maxGlyph: column.h * opts.nameShare * 0.92,
    minGlyph: column.h * 0.12,
  });
  let bottom = name.y + name.h;
  const tagline = opts.tagline ? ctx.look.headline ?? ctx.look.subhead : null;
  if (tagline) {
    const nameGlyph = (ctx.out.elements[from] as TextElementProps).fontSize / 0.3;
    const gap = nameGlyph * 0.22;
    const room = column.y + column.h - (bottom + gap);
    const copy = addCopy(ctx, tagline, 'tagline', { x: column.x, y: bottom + gap, w: column.w, h: room }, {
      align: opts.align,
      maxGlyph: Math.max(nameGlyph * 0.36, ctx.minGlyph * 1.3),
      minGlyph: ctx.minGlyph,
      maxLines: 2,
      weight: '400',
      muted: true,
      reflowed: true,
    });
    bottom = copy.y + copy.h;
  }
  shiftSince(ctx, from, (column.h - (bottom - column.y)) / 2);
}

/** Headline (with the app name over it) as a block centred in `column`. */
function headlineStack(ctx: Ctx, column: Box, opts: { maxGlyph: number; subhead: boolean }): void {
  const from = ctx.out.elements.length;
  const headline = ctx.look.headline;
  if (!headline) {
    // No copy in the project yet: the app name is the headline, and it is set
    // once, not again small over itself.
    const name = addName(ctx, column, { align: 'left', maxGlyph: opts.maxGlyph, minGlyph: opts.maxGlyph * 0.5 });
    shiftSince(ctx, from, (column.h - name.h) / 2);
    return;
  }

  const eyebrowFit = fitGlyph(ctx.look.appName, { width: column.w, height: column.h * 0.2 }, {
    max: Math.max(ctx.minGlyph * 1.05, opts.maxGlyph * 0.42),
    min: ctx.minGlyph,
    lineHeight: 1.2,
    advance: BOLD_ADVANCE,
    maxLines: 1,
  });
  const eyebrowGlyph = eyebrowFit.glyph;
  const eyebrowId = ctx.id('name');
  const eyebrowBox = { x: column.x, y: column.y, w: column.w, h: eyebrowGlyph * 1.3 };
  const brand = ctx.look.nameStyle;
  ctx.out.elements.push(
    textElement({
      id: eyebrowId,
      name: 'App name',
      box: eyebrowBox,
      content: ctx.look.appName,
      glyph: eyebrowGlyph,
      color: brand?.color ?? ctx.look.mutedColor,
      fontFamily: brand?.fontFamily ?? ctx.look.fontFamily,
      weight: brand?.fontWeight ?? '600',
      fontStyle: brand?.fontStyle,
      align: 'left',
      lineHeight: 1.2,
      tracking: 0.02,
    })
  );
  ctx.out.nameIds.push(eyebrowId);
  let cursor = eyebrowBox.y + eyebrowBox.h + eyebrowGlyph * 0.35;

  const box = addCopy(ctx, headline, 'headline', { x: column.x, y: cursor, w: column.w, h: column.y + column.h - cursor }, {
    align: 'left',
    maxGlyph: opts.maxGlyph,
    minGlyph: opts.maxGlyph * 0.55,
    maxLines: 4,
    weight: '700',
  });
  cursor = box.y + box.h;
  const sub = opts.subhead ? ctx.look.subhead : null;
  if (sub) {
    const glyph = (ctx.out.elements[ctx.out.elements.length - 1] as TextElementProps).fontSize / 0.3;
    const top = cursor + glyph * 0.3;
    const room = column.y + column.h - top;
    if (room > Math.max(glyph * 0.9, ctx.minGlyph * 1.4)) {
      const subBox = addCopy(ctx, sub, 'subhead', { x: column.x, y: top, w: column.w, h: room }, {
        align: 'left',
        maxGlyph: Math.max(glyph * 0.42, ctx.minGlyph * 1.05),
        minGlyph: ctx.minGlyph,
        maxLines: 3,
        weight: '400',
        muted: true,
        reflowed: true,
      });
      cursor = subBox.y + subBox.h;
    }
  }
  shiftSince(ctx, from, (column.h - (cursor - column.y)) / 2);
}

/** A phone of the given height, its right edge at `right`, its top at `top`. */
/**
 * A device of the given height, its right edge at `right`, its top at `top`,
 * and never wider than `maxWidth`: a MacBook or a watch is wide for its
 * height, and sized by height alone it would leave the copy no column at all.
 */
function phoneBox(ctx: Ctx, height: number, right: number, top: number, maxWidth = Infinity): Box {
  const aspect = deviceAspect(ctx.look);
  const w = Math.min(height * aspect, maxWidth);
  const h = w / aspect;
  // A phone runs off the bottom on purpose. A device that came out shorter
  // than the area would only look dropped at its top, so it is centred.
  const y = h < ctx.safe.height ? Math.max(top, ctx.safe.y + (ctx.safe.height - h) / 2) : top;
  return { x: right - w, y, w, h };
}

const COMPOSERS: Record<string, (ctx: Ctx) => void> = {
  // Apple's own examples are all this: a brand mark over a scene. On the
  // product page the name and subtitle sit right under the header, so the
  // header one stays a mark; search results show it cold, so it gets a line.
  wordmark(ctx) {
    const s = ctx.safe;
    const tagline = ctx.kind !== 'header' && !!(ctx.look.headline ?? ctx.look.subhead);
    // A header's area is already pulled in to clear the buttons, which leaves
    // about the width Apple's own wordmarks take. A search card's is not, so
    // the mark stays off its edges.
    const share = ctx.kind === 'search' ? 0.7 : 1;
    const column = { x: s.x + (s.width * (1 - share)) / 2, y: s.y, w: s.width * share, h: s.height };
    nameStack(ctx, column, { align: 'center', nameShare: tagline ? 0.5 : 0.42, tagline });
  },

  'name-phone'(ctx) {
    const s = ctx.safe;
    // The universal safe area is small, so its phone is too, or the name gets
    // no room beside it.
    const height = s.height * (ctx.kind === 'universal' ? 1.2 : 1.55);
    const phone = phoneBox(ctx, height, s.x + s.width, s.y + s.height * 0.04, s.width * 0.45);
    addDevice(ctx, 'phone', phone, 0);
    const column = { x: s.x, y: s.y, w: phone.x - s.x - s.width * 0.06, h: s.height };
    nameStack(ctx, column, { align: 'left', nameShare: ctx.look.headline ? 0.55 : 0.7, tagline: true });
  },

  // Five screens across the full width. An iPhone sees the middle three, a
  // wider screen sees the whole row.
  showcase(ctx) {
    const s = ctx.safe;
    const nameH = s.height * 0.3;
    addName(ctx, { x: s.x, y: s.y, w: s.width, h: nameH }, { align: 'center', maxGlyph: nameH * 0.9, minGlyph: nameH * 0.4 });
    const top = s.y + nameH + s.height * 0.08;
    const aspect = deviceAspect(ctx.look);
    // Five across has to fit the canvas, which is what sizes a row of laptops.
    const w = Math.min(s.height * 1.32 * aspect, (ctx.size.width * 0.96) / (5 + 4 * 0.14));
    const height = w / aspect;
    const gap = w * 0.14;
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
    const phone = phoneBox(ctx, s.height * 1.42, s.x + s.width, s.y + s.height * 0.05, s.width * 0.45);
    addDevice(ctx, 'phone', phone, 0);
    const column = { x: s.x, y: s.y, w: phone.x - s.x - s.width * 0.06, h: s.height };
    headlineStack(ctx, column, { maxGlyph: s.height * 0.16, subhead: true });
  },

  'two-phones'(ctx) {
    const s = ctx.safe;
    const back = phoneBox(ctx, s.height * 1.22, s.x + s.width, s.y + s.height * 0.16, s.width * 0.3);
    const front = phoneBox(ctx, s.height * 1.42, back.x + back.w * 0.42, s.y + s.height * 0.04, s.width * 0.35);
    addDevice(ctx, 'phone-2', back, 1);
    addDevice(ctx, 'phone-1', front, 0);
    const column = { x: s.x, y: s.y, w: front.x - s.x - s.width * 0.05, h: s.height };
    headlineStack(ctx, column, { maxGlyph: s.height * 0.14, subhead: false });
  },
};

// --- boards -------------------------------------------------------------------

/**
 * One finished creative artboard.
 *
 * `seed` goes into every id. The add dialog builds its cards with a fixed seed
 * so a re-render keeps the same React keys; the boards that land in a project
 * get a fresh one, because element ids have to be unique across the project
 * for the language overrides to stay attached to the right layer.
 */
export function buildCreativeBoard(
  kind: CreativeAssetKind,
  lookId: string,
  look: ProjectLook,
  seed: string
): ArtboardState {
  const spec = creativeSpec(kind);
  const size = { width: spec.width, height: spec.height };
  const safe = safeAreaFor({ creativeAsset: kind, size })!;
  const out: Composed = { elements: [], inherited: {}, nameIds: [] };
  const board = { creativeAsset: kind, size };
  const sideInset = Math.max(headerButtonClearance(board), safe.width * 0.06);
  const ctx: Ctx = {
    kind,
    look,
    safe: {
      x: safe.x + sideInset,
      y: safe.y + safe.height * 0.03,
      width: safe.width - sideInset * 2,
      height: safe.height * 0.94,
    },
    size,
    minGlyph: minReadableGlyph(board),
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
