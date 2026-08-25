/**
 * Marketing graphics, composed rather than authored.
 *
 * The competitor's flow shows the same five looks under six format tabs, which
 * is the tell: those are not thirty hand-drawn files, they are five recipes
 * evaluated at six canvas sizes. This does the same, for the same reason.
 * Authoring thirty JSON templates would mean thirty more files fetched at
 * startup (projectService.ts loads every template up front) and thirty files to
 * re-touch the day a seventh format lands.
 *
 * The primitive is already in the repo: `PORTRAIT_RECIPES` / `LANDSCAPE_RECIPES`
 * in `lib/ai/buildProjectFromPlan.ts` lay the AI agent's generated boards out
 * from normalized boxes. This is that idea taken further, because a graphics
 * flow has a harder version of the problem: a 1584x396 LinkedIn cover and a
 * 1080x1920 story are not two orientations, they are four genuinely different
 * compositions, so a style resolves through a BAND (see socialFormats.ts) and
 * the geometry is computed from the canvas rather than read from a table.
 *
 * Everything here is pure and needs no DOM, matching the rest of the intake
 * path (AGENTS rule 33), so a whole deck can be rebuilt on every keystroke.
 * The one consequence is that text height is ESTIMATED rather than measured;
 * boxes are sized generously and `TextElement` centres its content vertically,
 * so an over-estimate costs nothing and an under-estimate is picked up by the
 * usual `fitTextBox` grow pass once a board is on the canvas.
 */

import type {
  ArtboardElement,
  ArtboardState,
  DeviceFrameElementProps,
  DeviceType,
  ImageElementProps,
  Project,
  ShapeElementProps,
  Size,
  TextElementProps,
} from '@/types/artboard';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';
import {
  bandOf,
  formatSize,
  type FormatBand,
  type SocialFormat,
} from './socialFormats';
import { copyFor, fitHeadline, type CopyContext } from './socialCopy';
import { darken, gradientPartner, isDark, lighten, mix, usableAccent } from './color';

// --- the styles -----------------------------------------------------------

export type StoreBadge = 'app-store' | 'google-play' | 'none';

export interface SocialStyle {
  id: string;
  /** Card label in the style picker. */
  label: string;
  /** One line saying what this look is for. */
  blurb: string;
  /**
   * The composition family.
   * `split`  copy on one side, mockups on the other
   * `bleed`  one oversized mockup running off an edge, copy in what is left
   * `stage`  copy centred, mockups arranged around or below it
   */
  kind: 'split' | 'bleed' | 'stage';
  /** Which side the mockups sit on. `stage` ignores it. */
  side: 'left' | 'right';
  ground: 'light' | 'dark' | 'gradient' | 'tint';
  /** Mockups the style wants. A shallow band may use fewer, see `deviceCount`. */
  devices: number;
  /** True 3D frames. Each one costs a WebGL context wherever it renders. */
  angled: boolean;
  tone: 'calm' | 'bold';
  /** A soft accent orb behind the mockups. */
  glow: boolean;
}

/**
 * The look book.
 *
 * Kept to eight because the picker shows them all at once for the active
 * format and a grid you have to scroll is a grid nobody reads past row two.
 * At most two styles are `angled`: the deck's WebGL budget is six live
 * contexts and a card past it renders its frames flat (deckLayout.ts).
 */
export const SOCIAL_STYLES: SocialStyle[] = [
  {
    id: 'hero-light',
    label: 'Hero',
    blurb: 'Light ground, copy left, one mockup right',
    kind: 'split',
    side: 'right',
    ground: 'light',
    devices: 1,
    angled: false,
    tone: 'calm',
    glow: false,
  },
  {
    id: 'duo-gradient',
    label: 'Duo',
    blurb: 'Brand gradient with a pair of mockups',
    kind: 'split',
    side: 'right',
    ground: 'gradient',
    devices: 2,
    angled: false,
    tone: 'bold',
    glow: true,
  },
  {
    id: 'bleed-dark',
    label: 'Bleed',
    blurb: 'Dark, with the mockup running off the edge',
    kind: 'bleed',
    side: 'left',
    ground: 'dark',
    devices: 1,
    angled: false,
    tone: 'bold',
    glow: true,
  },
  {
    id: 'trio-dark',
    label: 'Trio',
    blurb: 'Three screens, copy alongside',
    kind: 'split',
    side: 'left',
    ground: 'dark',
    devices: 3,
    angled: false,
    tone: 'bold',
    glow: false,
  },
  {
    id: 'tilt-brand',
    label: 'Tilt',
    blurb: 'Two mockups in 3D on a brand ground',
    kind: 'split',
    side: 'right',
    ground: 'gradient',
    devices: 2,
    angled: true,
    tone: 'bold',
    glow: true,
  },
  {
    id: 'stage-tint',
    label: 'Stage',
    blurb: 'Centred copy over the screen, on a soft brand tint',
    kind: 'stage',
    side: 'right',
    ground: 'tint',
    devices: 1,
    angled: false,
    tone: 'calm',
    glow: false,
  },
  {
    id: 'headline-light',
    label: 'Headline',
    blurb: 'Type first, with a small mockup for context',
    kind: 'split',
    side: 'right',
    ground: 'light',
    devices: 1,
    angled: true,
    tone: 'calm',
    glow: false,
  },
  {
    id: 'showcase-dark',
    label: 'Showcase',
    blurb: 'Dark stage, copy above, screens below',
    kind: 'stage',
    side: 'left',
    ground: 'dark',
    devices: 3,
    angled: false,
    tone: 'bold',
    glow: true,
  },
];

export function getSocialStyle(id: string): SocialStyle | undefined {
  return SOCIAL_STYLES.find((style) => style.id === id);
}

// --- brand input ----------------------------------------------------------

export interface SocialBrand {
  /** What the user typed. May be empty. */
  appName: string;
  /** The colour pulled from their screenshots, or one they picked. */
  accent: string;
  fontFamily: string;
  badge: StoreBadge;
  /** The device the uploaded screenshots came from. */
  deviceType: DeviceType;
  /** Bumped by the deck's "New copy" control. */
  rotation: number;
}

export const DEFAULT_BRAND: SocialBrand = {
  appName: '',
  accent: '#4F46E5',
  // The house face. Every shipped feature graphic is set in it, and it is in
  // GOOGLE_FONTS so it actually loads; a family that is not in that list falls
  // back to the browser's default serif, which is how this first rendered.
  fontFamily: 'Bricolage Grotesque',
  badge: 'app-store',
  deviceType: 'iphone-15',
  rotation: 0,
};

// --- geometry -------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Per-band chrome.
 *
 * `margin` is a fraction of the SHORT side and is then converted per axis, so a
 * 1500x500 banner and a 1080x1080 post get the same physical breathing room
 * rather than the same fraction of two very different widths.
 *
 * Type size is NOT in here. It is solved per board from the copy column's width
 * and `charsPerLine`, then shrunk or grown until the whole block fits `fill` of
 * its region, because a fixed fraction of the canvas cannot know how long the
 * headline turned out to be.
 */
interface Chrome {
  margin: number;
  /**
   * Characters a headline line should hold.
   *
   * Type size is derived from THIS and the copy column's width, not from a
   * fraction of the canvas, because the column is what a line has to fit into.
   * Checked against the shipped feature graphics: `fg-habit-tracker` sets
   * fontSize 18 in a 460px box at 12 characters a line, and this formula
   * reproduces 18.2 for those inputs.
   */
  charsPerLine: number;
  /** Multiples of the headline size. */
  subhead: number;
  eyebrow: number;
  /** Badge width as a fraction of the canvas width. */
  badge: number;
  /** Share of the width the copy column takes in a split. */
  copyShare: number;
  /** Longest headline that still reads at this shape. */
  headlineChars: number;
  /**
   * How much of the copy region the finished block should occupy.
   *
   * Fitting alone is not enough: a two word headline on a 1920px story fits at
   * any size, and left at the size the column implies it reads as a caption
   * floating in an empty page. The solver grows into this.
   */
  fill: number;
  gradientAngle: number;
}

/**
 * Average glyph advance, in ems, for the faces the picker offers.
 *
 * Solved from the shipped templates rather than guessed: a 460px box holding
 * 12 characters at a 60px glyph height is 0.639. Regular weights run narrower.
 */
const BOLD_ADVANCE = 0.62;
const REGULAR_ADVANCE = 0.53;

const CHROME: Record<FormatBand, Chrome> = {
  // 1500x500 and 1584x396. Almost no vertical room: one line of type, a small
  // badge, and mockups that have to be cropped by the canvas to fit at all.
  ultrawide: {
    margin: 0.085,
    charsPerLine: 17,
    subhead: 0.4,
    eyebrow: 0.34,
    badge: 0.105,
    copyShare: 0.6,
    headlineChars: 26,
    fill: 0.92,
    gradientAngle: 95,
  },
  // 1200x630 and 1024x500. The classic left-copy, right-mockup marketing card.
  wide: {
    margin: 0.095,
    charsPerLine: 13,
    subhead: 0.42,
    eyebrow: 0.34,
    badge: 0.15,
    copyShare: 0.55,
    headlineChars: 34,
    fill: 0.86,
    gradientAngle: 110,
  },
  // 1080x1080. Enough height to stack, enough width to sit side by side; the
  // stack reads better in a feed, where the post is seen small.
  square: {
    margin: 0.08,
    charsPerLine: 14,
    subhead: 0.44,
    eyebrow: 0.34,
    badge: 0.22,
    copyShare: 1,
    headlineChars: 30,
    fill: 0.82,
    gradientAngle: 145,
  },
  // 1080x1920. Copy on top, mockups below and generously large.
  tall: {
    margin: 0.08,
    charsPerLine: 14,
    subhead: 0.44,
    eyebrow: 0.34,
    badge: 0.26,
    copyShare: 1,
    headlineChars: 28,
    fill: 0.8,
    gradientAngle: 170,
  },
};

/** Native aspect of each store badge, from imageLibrary.ts. */
const BADGE_ART: Record<Exclude<StoreBadge, 'none'>, { src: string; aspect: number }> = {
  'app-store': { src: '/elements/images/badges/app-store.svg', aspect: 419 / 140 },
  'google-play': { src: '/elements/images/badges/google-play.png', aspect: 362 / 140 },
};

/**
 * Neutral screen art for a mockup nobody has dropped a screenshot into yet.
 *
 * These ship with the feature-graphic templates. Using one rather than leaving
 * the frame empty is what lets the style picker read as a set of finished
 * designs before the first upload, which is the whole job of that screen.
 */
const PLACEHOLDER_SCREENS = {
  light: '/data/projects/fg-screens/fg-cards-light.png',
  dark: '/data/projects/fg-screens/fg-cards-dark.png',
} as const;

function round(value: number): number {
  return Math.round(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Roughly how tall a string renders in a box of this width.
 *
 * No DOM, so this cannot measure. 0.52em average advance is a reasonable stand
 * in for a bold humanist sans across the faces the picker offers, and the
 * consumers of this only need to know whether the answer is one line or three.
 */
function estimateTextHeight(
  content: string,
  fontSize: number,
  boxWidth: number,
  lineHeight: number,
  advance: number = BOLD_ADVANCE
): number {
  const glyph = fontSize / 0.3;
  const perLine = Math.max(1, Math.floor(boxWidth / (glyph * advance)));
  const lines = content
    .split('\n')
    .reduce((total, segment) => total + Math.max(1, Math.ceil(segment.length / perLine)), 0);
  return glyph * lineHeight * lines;
}

/** Fit an aspect inside a rect, anchored as asked. */
function fitAspect(
  region: Rect,
  aspect: number,
  anchor: 'top' | 'center' | 'bottom' = 'center'
): Rect {
  let w = region.w;
  let h = w / aspect;
  if (h > region.h) {
    h = region.h;
    w = h * aspect;
  }
  const x = region.x + (region.w - w) / 2;
  const y =
    anchor === 'top'
      ? region.y
      : anchor === 'bottom'
        ? region.y + region.h - h
        : region.y + (region.h - h) / 2;
  return { x, y, w, h };
}

/**
 * A row of overlapping mockups, largest in the middle.
 *
 * The scale ramp is what stops three phones side by side reading as a product
 * grid: the centre one is full size and its neighbours sit behind it, which is
 * the arrangement every app marketing page has converged on.
 */
function deviceRow(region: Rect, count: number, aspect: number, overlap: number): Rect[] {
  const scales =
    count >= 3 ? [0.84, 1, 0.84] : count === 2 ? [1, 0.86] : [1];
  const used = scales.slice(0, count);
  const baseHeight = region.h;
  let widths = used.map((scale) => baseHeight * scale * aspect);
  let total = widths.reduce((sum, w, i) => sum + (i < widths.length - 1 ? w * (1 - overlap) : w), 0);
  // Shrink the whole row rather than the overlap: crowding the phones together
  // to make them fit is what makes a trio look like a stack of cards.
  let shrink = 1;
  if (total > region.w) {
    shrink = region.w / total;
    widths = widths.map((w) => w * shrink);
    total = region.w;
  }
  const heights = used.map((scale) => baseHeight * scale * shrink);
  const centerY = region.y + region.h / 2;
  const rects: Rect[] = [];
  let cursor = region.x + (region.w - total) / 2;
  for (let i = 0; i < used.length; i++) {
    rects.push({
      x: cursor,
      y: centerY - heights[i] / 2,
      w: widths[i],
      h: heights[i],
    });
    cursor += widths[i] * (1 - overlap);
  }
  // Draw the tallest last so it sits in front. Array order IS z-order.
  return rects
    .map((rect, i) => ({ rect, i }))
    .sort((a, b) => a.rect.h - b.rect.h)
    .map(({ rect }) => rect);
}

// --- ground ---------------------------------------------------------------

interface Ground {
  color1: string;
  color2: string | null;
  angle: number;
  text: string;
  muted: string;
  accent: string;
  screen: string;
  /** Whether a light or dark badge lockup reads on this. */
  dark: boolean;
}

function groundFor(style: SocialStyle, brand: SocialBrand, chrome: Chrome): Ground {
  const accent = usableAccent(brand.accent);
  const angle = chrome.gradientAngle;
  switch (style.ground) {
    case 'light': {
      // A trace of the brand colour keeps this from being the default white of
      // every other generator.
      const base = mix('#F4F5F7', accent, 0.06);
      return {
        color1: base,
        color2: mix('#FFFFFF', accent, 0.03),
        angle,
        text: '#111318',
        muted: '#5A6070',
        accent,
        screen: PLACEHOLDER_SCREENS.light,
        dark: false,
      };
    }
    case 'tint': {
      const base = mix('#FFFFFF', accent, 0.18);
      return {
        color1: base,
        color2: mix('#FFFFFF', accent, 0.05),
        angle,
        text: darken(accent, 0.7),
        muted: mix(darken(accent, 0.55), '#6B7280', 0.5),
        accent,
        screen: PLACEHOLDER_SCREENS.light,
        dark: false,
      };
    }
    case 'gradient': {
      const color1 = accent;
      const color2 = gradientPartner(accent);
      const dark = isDark(mix(color1, color2, 0.5));
      return {
        color1,
        color2,
        angle,
        text: dark ? '#FFFFFF' : darken(accent, 0.78),
        muted: dark ? lighten(color1, 0.72) : darken(accent, 0.5),
        accent: dark ? lighten(accent, 0.5) : darken(accent, 0.35),
        screen: dark ? PLACEHOLDER_SCREENS.dark : PLACEHOLDER_SCREENS.light,
        dark,
      };
    }
    case 'dark':
    default: {
      const color1 = mix('#14161C', accent, 0.14);
      return {
        color1,
        color2: mix('#0A0B0F', accent, 0.06),
        angle,
        text: '#FFFFFF',
        muted: lighten(color1, 0.62),
        accent: lighten(accent, 0.28),
        screen: PLACEHOLDER_SCREENS.dark,
        dark: true,
      };
    }
  }
}

// --- element builders -----------------------------------------------------

function textElement(args: {
  id: string;
  name: string;
  rect: Rect;
  content: string;
  fontSize: number;
  color: string;
  fontFamily: string;
  weight: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing?: number;
}): TextElementProps {
  return {
    id: args.id,
    type: 'text',
    name: args.name,
    position: { x: round(args.rect.x), y: round(args.rect.y) },
    size: { width: round(args.rect.w), height: round(args.rect.h) },
    rotation: 0,
    scale: 1,
    content: args.content,
    fontSize: round(args.fontSize),
    color: args.color,
    fontFamily: args.fontFamily,
    fontWeight: args.weight,
    textAlign: args.align,
    lineHeight: args.lineHeight,
    ...(args.letterSpacing ? { letterSpacing: args.letterSpacing } : {}),
  };
}

function deviceElement(args: {
  id: string;
  rect: Rect;
  deviceType: DeviceType;
  angled: boolean;
  angleSide: 'left' | 'right';
  screen: string;
  dark: boolean;
}): DeviceFrameElementProps {
  return {
    id: args.id,
    type: 'device',
    name: 'Phone Mockup',
    position: { x: round(args.rect.x), y: round(args.rect.y) },
    size: { width: round(args.rect.w), height: round(args.rect.h) },
    rotation: 0,
    scale: 1,
    deviceType: args.deviceType,
    styleType: args.angled ? (args.angleSide === 'left' ? '3d-left' : '3d-right') : 'normal',
    ...(args.angled ? { pose3d: 'tilted' as const, frameColor3d: 'titanium' as const } : {}),
    ...(args.angled ? {} : { frameColor: args.dark ? '#1B1B1D' : '#2A2C31' }),
    screenshotObjectFit: 'cover',
    screenshotRect: { left: 0, top: 0, width: 100, height: 100 },
    // Placeholder art, deliberately. `fillTemplate` overwrites it with the
    // user's own screenshot; before that it is what makes the picker look like
    // a set of finished designs rather than a set of empty frames.
    screenshotSrc: args.screen,
  };
}

function glowElement(id: string, rect: Rect, color: string): ShapeElementProps {
  return {
    id,
    type: 'shape',
    name: 'Glow',
    position: { x: round(rect.x), y: round(rect.y) },
    size: { width: round(rect.w), height: round(rect.h) },
    rotation: 0,
    scale: 1,
    shapeType: 'circle',
    fillColor: color,
    strokeColor: 'transparent',
    strokeWidth: 0,
    fillOpacity: 0.5,
    opacity: 0.55,
    blur: round(Math.min(rect.w, rect.h) * 0.22),
  };
}

function badgeElement(id: string, rect: Rect, badge: Exclude<StoreBadge, 'none'>): ImageElementProps {
  return {
    id,
    type: 'image',
    name: badge === 'app-store' ? 'App Store Badge' : 'Google Play Badge',
    position: { x: round(rect.x), y: round(rect.y) },
    size: { width: round(rect.w), height: round(rect.h) },
    rotation: 0,
    scale: 1,
    // Canonical path. ImageElement runs it through withBasePath at render time
    // (AGENTS rule 11), so it must NOT be prefixed here.
    imageSrc: BADGE_ART[badge].src,
    imageAlt: 'Download on the store',
    objectFit: 'contain',
  };
}

// --- the composition ------------------------------------------------------

interface Composed {
  copy: Rect;
  devices: Rect[];
  /** Where the mockups' glow sits, if the style has one. */
  glow: Rect | null;
  align: 'left' | 'center';
  /** Which way an angled frame should face, so it leans into the copy. */
  angleSide: 'left' | 'right';
}

/**
 * Split the canvas into a copy region and a mockup region.
 *
 * The band decides the axis, and that is the whole trick: `split` means side by
 * side on a wide canvas and stacked on a tall one, so one style declaration
 * gives a correct composition on all six surfaces instead of a landscape design
 * letterboxed into a portrait board.
 */
/**
 * Pull a copy region clear of the platform chrome that overlaps this surface.
 *
 * X hangs the profile avatar over the lower left of a header and LinkedIn crops
 * the same corner behind the profile photo. Both are declared on the format
 * (`avoid`). A stack that is vertically centred in the full height sits right
 * under the avatar, so where the copy actually reaches into that corner the
 * region loses its bottom and the stack re-centres above it.
 */
function clearOfChrome(copy: Rect, size: Size, format: SocialFormat): Rect {
  const avoid = format.avoid;
  if (!avoid?.bottom || !avoid.left) return copy;
  const overlapsCorner = copy.x < size.width * avoid.left;
  if (!overlapsCorner) return copy;
  // Clear the chrome by a visible margin rather than sitting flush against it.
  // The avoid boxes are approximations of someone else's UI, and the avatar
  // moves a few pixels between web and each mobile client.
  const floor = size.height * (1 - avoid.bottom - 0.04);
  const h = Math.max(copy.h * 0.45, floor - copy.y);
  return { ...copy, h: Math.min(copy.h, h) };
}

function compose(
  style: SocialStyle,
  size: Size,
  band: FormatBand,
  chrome: Chrome,
  deviceCount: number,
  aspect: number,
  format: SocialFormat
): Composed {
  const short = Math.min(size.width, size.height);
  const mx = short * chrome.margin;
  const my = short * chrome.margin;
  const inner: Rect = {
    x: mx,
    y: my,
    w: size.width - mx * 2,
    h: size.height - my * 2,
  };
  const stacked = band === 'tall' || band === 'square';

  if (style.kind === 'stage') {
    if (stacked) {
      // Copy on top, mockups below, which is what a story wants.
      const copyH = inner.h * (band === 'tall' ? 0.36 : 0.44);
      return {
        copy: clearOfChrome({ ...inner, h: copyH }, size, format),
        devices: deviceRow(
          { x: inner.x, y: inner.y + copyH, w: inner.w, h: inner.h - copyH },
          deviceCount,
          aspect,
          deviceCount >= 3 ? 0.3 : 0.2
        ),
        glow: { x: inner.x, y: inner.y + copyH * 0.8, w: inner.w, h: inner.h - copyH },
        align: 'center',
        angleSide: 'right',
      };
    }
    // Wide and ultrawide: copy holds the middle, mockups flank it.
    const sideW = inner.w * (band === 'ultrawide' ? 0.24 : 0.26);
    return {
      copy: clearOfChrome(
        { x: inner.x + sideW, y: inner.y, w: inner.w - sideW * 2, h: inner.h },
        size,
        format
      ),
      devices: [
        ...deviceRow({ x: inner.x, y: inner.y, w: sideW, h: inner.h }, 1, aspect, 0),
        ...deviceRow(
          { x: inner.x + inner.w - sideW, y: inner.y, w: sideW, h: inner.h },
          Math.max(1, deviceCount - 1),
          aspect,
          0.28
        ),
      ],
      glow: null,
      align: 'center',
      angleSide: 'right',
    };
  }

  if (stacked) {
    // A split reads as a stack on a tall or square board. `side` still decides
    // the order: mockups-left becomes mockups-on-top.
    //
    // Except for a bleed, which always goes second. Its whole idea is a mockup
    // running off the edge, and on a stack the only edge below it is the copy,
    // so putting it first crops it against the headline instead of the canvas.
    const devicesFirst = style.side === 'left' && style.kind !== 'bleed';
    const deviceShare = band === 'tall' ? 0.54 : 0.5;
    const deviceH = inner.h * deviceShare;
    const copyH = inner.h - deviceH;
    const deviceRegion: Rect = {
      x: inner.x,
      y: devicesFirst ? inner.y : inner.y + copyH,
      w: inner.w,
      h: deviceH,
    };
    const copyRegion: Rect = {
      x: inner.x,
      y: devicesFirst ? inner.y + deviceH : inner.y,
      w: inner.w,
      h: copyH,
    };
    if (style.kind === 'bleed') {
      // Off the bottom only. deviceRow centres vertically, so simply making the
      // region taller crops the phone at BOTH ends and loses the one edge that
      // says "phone": the top, with its corners and its island.
      const h = deviceRegion.h * 1.34;
      const w = h * aspect;
      return {
        copy: clearOfChrome(copyRegion, size, format),
        devices: [
          { x: deviceRegion.x + (deviceRegion.w - w) / 2, y: deviceRegion.y, w, h },
        ],
        glow: style.glow ? deviceRegion : null,
        align: 'center',
        angleSide: 'right',
      };
    }
    return {
      copy: clearOfChrome(copyRegion, size, format),
      devices: deviceRow(deviceRegion, deviceCount, aspect, deviceCount >= 3 ? 0.32 : 0.22),
      glow: style.glow ? deviceRegion : null,
      align: 'center',
      angleSide: 'right',
    };
  }

  // Wide and ultrawide: genuinely side by side.
  const devicesRight = style.side === 'right';
  const copyW = inner.w * chrome.copyShare;
  const gap = short * 0.05;
  const deviceW = inner.w - copyW - gap;
  const copy: Rect = {
    x: devicesRight ? inner.x : inner.x + deviceW + gap,
    y: inner.y,
    w: copyW,
    h: inner.h,
  };
  let deviceRegion: Rect = {
    x: devicesRight ? inner.x + copyW + gap : inner.x,
    y: inner.y,
    w: deviceW,
    h: inner.h,
  };

  if (style.kind === 'bleed') {
    // One oversized mockup leaving the canvas by the OUTER edge and the bottom,
    // with its top still in frame. Cropping the top too costs the rounded
    // corners and the island, and what is left reads as a flat panel rather
    // than a phone, which is the whole point of the style.
    const h = inner.h * (band === 'ultrawide' ? 1.28 : 1.4);
    const w = h * aspect;
    const x = devicesRight ? size.width - w * 0.7 : -w * 0.3;
    const rect: Rect = { x, y: inner.y, w, h };
    return {
      copy: clearOfChrome(copy, size, format),
      devices: [rect],
      glow: style.glow ? rect : null,
      align: 'left',
      angleSide: devicesRight ? 'left' : 'right',
    };
  }

  return {
    copy: clearOfChrome(copy, size, format),
    devices: deviceRow(deviceRegion, deviceCount, aspect, deviceCount >= 3 ? 0.3 : 0.2),
    glow: style.glow ? deviceRegion : null,
    align: 'left',
    angleSide: devicesRight ? 'left' : 'right',
  };
}

/**
 * How many mockups a style actually gets at this shape.
 *
 * A trio needs width. On a 1584x396 cover three phones tall enough to read
 * would consume the whole board, so shallow bands drop to two and the stage
 * compositions, which have the least room of all, drop to one.
 */
function deviceCountFor(style: SocialStyle, band: FormatBand): number {
  if (band === 'ultrawide') return Math.min(style.devices, style.kind === 'stage' ? 2 : 3);
  if (band === 'square') return Math.min(style.devices, 3);
  return style.devices;
}

// --- board ----------------------------------------------------------------

export interface BuildBoardOptions {
  style: SocialStyle;
  format: SocialFormat;
  brand: SocialBrand;
}

/**
 * One finished board: background, copy, mockups, badge.
 *
 * The background lives on the BOARD (`backgroundColor` / `backgroundGradient`),
 * never as a full-bleed shape element. That is deliberate: a board background
 * refills the canvas for free on any later resize, whereas the full-bleed shape
 * the shipped feature graphics use becomes a floating rectangle the moment the
 * canvas changes shape.
 */
export function buildSocialBoard({ style, format, brand }: BuildBoardOptions): ArtboardState {
  const size = formatSize(format);
  const band = bandOf(size);
  const chrome = CHROME[band];
  const ground = groundFor(style, brand, chrome);
  const short = Math.min(size.width, size.height);
  const count = deviceCountFor(style, band);
  const aspect = getDeviceDescriptor(brand.deviceType).nativeAspect;
  const layout = compose(style, size, band, chrome, count, aspect, format);

  const ctx: CopyContext = { appName: brand.appName, rotation: brand.rotation };
  const resolved = copyFor(style.id, ctx, style.tone);
  const headline = fitHeadline(resolved.headline, chrome.headlineChars);
  const subhead = resolved.subhead;

  const elements: ArtboardElement[] = [];
  const id = (suffix: string) => `sg-${style.id}-${suffix}`;

  // 1. Glow, behind everything.
  if (layout.glow) {
    const g = layout.glow;
    const d = Math.max(g.w, g.h) * 0.95;
    elements.push(
      glowElement(id('glow'), { x: g.x + (g.w - d) / 2, y: g.y + (g.h - d) / 2, w: d, h: d }, ground.accent)
    );
  }

  // 2. Mockups. Placed before the copy so copy always wins an overlap.
  const fitted = layout.devices.map((rect) => fitAspect(rect, aspect, 'center'));
  fitted.forEach((rect, i) => {
    elements.push(
      deviceElement({
        id: id(`device-${i + 1}`),
        rect,
        deviceType: brand.deviceType,
        angled: style.angled,
        angleSide: layout.angleSide,
        screen: ground.screen,
        dark: ground.dark,
      })
    );
  });

  // 3. The copy stack, sized to fit and then vertically centred in its region.
  const region = layout.copy;
  const showEyebrow = Boolean(brand.appName.trim()) && band !== 'ultrawide';
  const showBadge = brand.badge !== 'none';
  const badgeW = size.width * chrome.badge;
  const badgeH = showBadge ? badgeW / BADGE_ART[brand.badge as Exclude<StoreBadge, 'none'>].aspect : 0;

  /**
   * Measure the whole stack at a candidate headline size.
   *
   * Everything else is a multiple of the headline, so one number drives the
   * lot and the block keeps its proportions as it shrinks.
   */
  const measure = (headlineSize: number, withSubhead: boolean) => {
    const subheadSize = Math.max(9, headlineSize * chrome.subhead);
    const eyebrowSize = Math.max(9, headlineSize * chrome.eyebrow);
    const glyph = headlineSize / 0.3;
    const eyebrowH = showEyebrow ? (eyebrowSize / 0.3) * 1.25 : 0;
    const headlineH = estimateTextHeight(headline, headlineSize, region.w, 1.1, BOLD_ADVANCE);
    const subheadH = withSubhead
      ? estimateTextHeight(subhead, subheadSize, region.w, 1.35, REGULAR_ADVANCE)
      : 0;
    const gapAfterEyebrow = showEyebrow ? glyph * 0.3 : 0;
    const gapAfterHeadline = withSubhead ? glyph * 0.26 : 0;
    const gapBeforeBadge = showBadge ? glyph * 0.42 : 0;
    return {
      headlineSize,
      subheadSize,
      eyebrowSize,
      eyebrowH,
      headlineH,
      subheadH,
      gapAfterEyebrow,
      gapAfterHeadline,
      gapBeforeBadge,
      withSubhead,
      total:
        eyebrowH +
        gapAfterEyebrow +
        headlineH +
        gapAfterHeadline +
        subheadH +
        gapBeforeBadge +
        badgeH,
    };
  };

  /**
   * The size the copy actually gets.
   *
   * Start from what the column width says a headline should be, then shrink
   * until the whole block fits the region. If it still will not fit at 65% of
   * that, the surface is too shallow for three tiers of copy and the subhead is
   * dropped rather than every line being shrunk into illegibility, which is the
   * case on a 1584x396 cover.
   */
  const idealHeadline = clamp(
    (0.3 * region.w) / (chrome.charsPerLine * BOLD_ADVANCE),
    10,
    96
  );
  const solve = () => {
    for (const withSubhead of [true, false]) {
      let candidate = idealHeadline;
      for (let step = 0; step < 24; step++) {
        const attempt = measure(candidate, withSubhead);
        if (attempt.total <= region.h) return attempt;
        candidate *= 0.94;
        if (candidate < idealHeadline * 0.58 || candidate < 10) break;
      }
    }
    // Nothing fits: take the smallest sane block and let the board crop it
    // rather than emitting a degenerate element.
    return measure(Math.max(10, idealHeadline * 0.58), false);
  };

  /**
   * Grow a block that fits easily until it earns its region.
   *
   * Bounded at 1.9x what the column implies, so a one word app name does not
   * turn a story into a billboard, and every candidate is re-measured because
   * growing changes where the line breaks fall.
   */
  const grow = (start: ReturnType<typeof measure>) => {
    let best = start;
    let candidate = start.headlineSize;
    for (let step = 0; step < 20; step++) {
      const next = candidate * 1.06;
      if (next > idealHeadline * 1.9) break;
      const attempt = measure(next, start.withSubhead);
      if (attempt.total > region.h * chrome.fill) break;
      candidate = next;
      best = attempt;
    }
    return best;
  };

  const solved = solve();
  const type = solved.total < region.h * chrome.fill ? grow(solved) : solved;
  const { headlineSize, subheadSize, eyebrowSize } = type;
  const showSubhead = type.withSubhead;

  let cursor = region.y + Math.max(0, (region.h - type.total) / 2);

  if (showEyebrow) {
    elements.push(
      textElement({
        id: id('eyebrow'),
        name: 'App Name',
        rect: { x: region.x, y: cursor, w: region.w, h: type.eyebrowH },
        content: brand.appName.trim(),
        fontSize: eyebrowSize,
        color: ground.muted,
        fontFamily: brand.fontFamily,
        weight: '600',
        align: layout.align,
        lineHeight: 1.2,
        letterSpacing: eyebrowSize * 0.06,
      })
    );
    cursor += type.eyebrowH + type.gapAfterEyebrow;
  }

  elements.push(
    textElement({
      id: id('headline'),
      name: 'Headline',
      rect: { x: region.x, y: cursor, w: region.w, h: type.headlineH },
      content: headline,
      fontSize: headlineSize,
      color: ground.text,
      fontFamily: brand.fontFamily,
      weight: '700',
      align: layout.align,
      lineHeight: 1.1,
      letterSpacing: -headlineSize * 0.018,
    })
  );
  cursor += type.headlineH + type.gapAfterHeadline;

  if (showSubhead) {
    elements.push(
      textElement({
        id: id('subhead'),
        name: 'Subheadline',
        rect: { x: region.x, y: cursor, w: region.w, h: type.subheadH },
        content: subhead,
        fontSize: subheadSize,
        color: ground.muted,
        fontFamily: brand.fontFamily,
        weight: '400',
        align: layout.align,
        lineHeight: 1.35,
      })
    );
    cursor += type.subheadH + type.gapBeforeBadge;
  } else {
    cursor += type.gapBeforeBadge;
  }

  if (showBadge) {
    const badgeX =
      layout.align === 'center' ? region.x + (region.w - badgeW) / 2 : region.x;
    elements.push(
      badgeElement(
        id('badge'),
        { x: badgeX, y: cursor, w: badgeW, h: badgeH },
        brand.badge as Exclude<StoreBadge, 'none'>
      )
    );
  }

  const gradient = ground.color2 !== null && ground.color2 !== ground.color1;

  return {
    id: `sg-${style.id}-${format.id}`,
    name: `${style.label} ${format.short}`,
    // Derived and overwritten by calculateArtboardPositions on every update,
    // so this is only a placeholder (AGENTS rule 4).
    position: { x: 15, y: 15 },
    size,
    backgroundColor: ground.color1,
    backgroundType: gradient ? 'gradient' : 'solid',
    ...(gradient
      ? { backgroundGradient: { color1: ground.color1, color2: ground.color2!, angle: ground.angle } }
      : {}),
    zoom: 1,
    elements,
  };
}

// --- templates ------------------------------------------------------------

/**
 * A generated style, shaped exactly like a catalog template.
 *
 * Returning a `Project` rather than a bespoke type is the point: everything
 * downstream (buildTemplateIndex, fillTemplate, TemplateMatchCard,
 * handleSelectTemplate) already speaks it, so the graphics deck reuses the
 * screenshot deck's machinery instead of forking it.
 */
export function buildSocialTemplate(
  style: SocialStyle,
  format: SocialFormat,
  brand: SocialBrand
): Project {
  const board = buildSocialBoard({ style, format, brand });
  return {
    id: `social_${style.id}_${format.id}`,
    name: `${style.label} ${format.label}`,
    description: `${style.blurb}. ${format.blurb}`,
    // Generated, so there is no preview PNG on disk. Every card in the graphics
    // deck renders the real board through StaticArtboard anyway.
    previewImage: '',
    timestamp: new Date(),
    category: 'graphics',
    projectData: [board],
  };
}

/** Every style at one format, in look-book order. */
export function buildSocialTemplates(format: SocialFormat, brand: SocialBrand): Project[] {
  return SOCIAL_STYLES.map((style) => buildSocialTemplate(style, format, brand));
}

/** One style at every format: the "generate my whole kit" set. */
export function buildStyleAcrossFormats(
  style: SocialStyle,
  formats: SocialFormat[],
  brand: SocialBrand
): ArtboardState[] {
  return formats.map((format) => buildSocialBoard({ style, format, brand }));
}
