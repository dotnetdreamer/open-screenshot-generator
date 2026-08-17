/**
 * Ready-made App Preview scenes: whole ARTBOARDS, not elements.
 *
 * The other three palette tabs drop one layer onto the board you already have.
 * This one drops a finished preview video: background, phone mockup, a timed
 * script of copy and gesture hints, all animated. The user replaces the words
 * and drops their screen recording into the phone.
 *
 * Everything here is authored against the store spec so the result uploads:
 *
 *  - **Drawn at 886 x 1920**, the size App Store Connect accepts for every
 *    modern iPhone, then fitted to whatever the project's boards already are
 *    (`previewSceneSizeFor`). A screenshot project at 1290 x 2796 is the same
 *    shape to four decimal places, so the scene scales into it without
 *    distortion and the canvas keeps one board size. The MP4 is still
 *    886 x 1920: the export dialog's default size mode renders to Apple's spec
 *    whatever the board measures.
 *  - **18 seconds** (`previewDurationSeconds`). Apple takes 15 to 30, and 18
 *    leaves room to trim either way without falling under the floor.
 *  - **Copy lives on TEXT layers with their own drop shadow.** The store-legal
 *    export (guideline 2.3.4, see AppPreviewExportDialog) throws away
 *    backgrounds, frames and decoration and composites only text and gesture
 *    layers over the full-bleed recording. A headline that relied on a scrim
 *    behind it would become unreadable in exactly the file you upload, so every
 *    text layer carries the contrast it needs on its own.
 *
 * ## The one rule that shapes every layout here
 *
 * On the canvas, and in a PNG still, animations do not play: every layer is
 * drawn at rest, all at once. So **no two layers may share a position and take
 * turns in time.** Three headlines swapping in the same spot look perfect in
 * the video and like a smeared mess everywhere else, which is the first thing
 * anyone sees when they drop a scene. Time is used to bring layers IN, never to
 * swap two of them over the same pixels. Every scene therefore reads as a
 * finished poster at t=0 and as a build in motion.
 */

import type {
  ArtboardElement,
  ArtboardState,
  ElementAnimation,
  ElementAnimationPreset,
  ElementShadow,
  GestureElementProps,
  GestureType,
  ShapeElementProps,
  Size,
  TextElementProps,
  VideoDeviceElementProps,
} from '@/types/artboard';

/** Apple's iPhone app preview size, and the size every scene is drawn at. */
export const PREVIEW_SCENE_SIZE: Size = { width: 886, height: 1920 };

/** Length every scene ships with. Apple accepts 15 to 30 seconds. */
export const PREVIEW_SCENE_DURATION = 18;

/**
 * dataTransfer key a Previews tile carries. Deliberately not one of the
 * `application/artboard-element-*` keys: this drop makes a whole ARTBOARD, and
 * both drop handlers have to be able to tell the two apart before they read
 * anything else off the drag.
 */
export const PREVIEW_SCENE_DRAG_TYPE = 'application/artboard-preview-scene';

const W = PREVIEW_SCENE_SIZE.width;
const H = PREVIEW_SCENE_SIZE.height;
/** Side margin all copy is set to. */
const M = 56;
/** Usable copy width. */
const CW = W - M * 2;

const PHONE_W = 600;
const PHONE_H = 1200;
const PHONE_X = (W - PHONE_W) / 2;

/** Natural size of the placeholder screens under public/data/projects. */
const POSTER_W = 1692;
const POSTER_H = 3420;

const PILL_W = 430;
const PILL_X = (W - PILL_W) / 2;
const PILL_H = 112;

/** Text renders at fontSize / 0.3 px (TextElement's displayScaleFactor). */
const TEXT_SCALE = 0.3;

/**
 * Height a text box needs to hold `lines` without clipping. The box is a
 * vertically centred flex with overflow hidden, so an undersized box eats the
 * ascenders and an oversized one shoves the glyphs into the block below. Same
 * arithmetic textFit.ts measures its way to, done up front because nothing
 * re-fits authored data.
 */
function boxH(fontSize: number, lines = 1, lineHeight = 1.1): number {
  const px = fontSize / TEXT_SCALE;
  return Math.round(lines * px * lineHeight + 0.32 * px);
}

/** Light copy over dark art, and over whatever the recording turns out to be. */
const SHADOW_ON_LIGHT_TEXT: ElementShadow = { x: 0, y: 4, blur: 30, color: 'rgba(4,6,14,0.55)' };
/** Dark copy: a soft light halo, invisible on a pale board, vital over footage. */
const SHADOW_ON_DARK_TEXT: ElementShadow = { x: 0, y: 3, blur: 26, color: 'rgba(255,255,255,0.85)' };

// Type scale, in fontSize units (multiply by 1/0.3 for rendered pixels).
const SIZE_EYEBROW = 8.4;   //  28px
const SIZE_SUB = 10.5;      //  35px
const SIZE_CHIP = 10;       //  33px
const SIZE_CTA = 11.5;      //  38px
const SIZE_HEAD = 22;       //  73px
const SIZE_GIANT = 40;      // 133px
const SIZE_STAT = 34;       // 113px

// ---------------------------------------------------------------------------
// Element authoring helpers
// ---------------------------------------------------------------------------

/** Enter animation, with the fields the timeline bar reads back. */
const enters = (
  enter: ElementAnimationPreset,
  enterDelay: number,
  enterDuration = 0.7
): ElementAnimation => ({ enter, enterDelay, enterDuration });

/**
 * Average glyph advance as a fraction of the em, for the geometric sans faces
 * used here. Only ever used to work out how many lines a string will take, and
 * deliberately a touch generous: guessing one line too many leaves a box
 * slightly tall (the content is vertically centred, so nothing moves), while
 * guessing one too few CLIPS the last line, which is the single most common
 * defect in authored artboard JSON.
 */
const ADVANCE_SANS = 0.54;
/** Anton and the other condensed display faces are much narrower. */
const ADVANCE_CONDENSED = 0.46;

/**
 * Lines `content` will occupy in a box `width` wide. Counts explicit newlines
 * and the soft wraps a long line will take on its own.
 */
function estimateLines(content: string, fontSize: number, width: number, advance = ADVANCE_SANS): number {
  const perChar = (fontSize / TEXT_SCALE) * advance;
  let total = 0;
  for (const line of content.split('\n')) {
    total += Math.max(1, Math.ceil((line.length * perChar) / Math.max(1, width)));
  }
  return total;
}

interface TextSpec {
  id: string;
  name: string;
  content: string;
  x?: number;
  y: number;
  width?: number;
  fontSize: number;
  /** Measured from the content (newlines plus soft wraps) unless stated. */
  lines?: number;
  lineHeight?: number;
  color: string;
  fontFamily: string;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
  letterSpacing?: number;
  /** Glyph advance for the line estimate; condensed faces need less. */
  advance?: number;
  /** True (the default) means light type: it gets the dark shadow. */
  onDark?: boolean;
  animation?: ElementAnimation;
}

function text(spec: TextSpec): TextElementProps {
  const lineHeight = spec.lineHeight ?? 1.1;
  const width = spec.width ?? CW;
  const lines = spec.lines ?? estimateLines(spec.content, spec.fontSize, width, spec.advance);
  return {
    id: spec.id,
    type: 'text',
    name: spec.name,
    position: { x: spec.x ?? M, y: spec.y },
    size: { width, height: boxH(spec.fontSize, lines, lineHeight) },
    rotation: 0,
    scale: 1,
    content: spec.content,
    fontSize: spec.fontSize,
    color: spec.color,
    fontFamily: spec.fontFamily,
    fontWeight: spec.fontWeight ?? '700',
    textAlign: spec.textAlign ?? 'left',
    lineHeight,
    letterSpacing: spec.letterSpacing,
    shadow: spec.onDark === false ? SHADOW_ON_DARK_TEXT : SHADOW_ON_LIGHT_TEXT,
    animation: spec.animation,
  };
}

/** Height `text()` will give this spec, for stacking blocks without clipping. */
const textH = (content: string, fontSize: number, lineHeight = 1.1, width = CW, advance = ADVANCE_SANS) =>
  boxH(fontSize, estimateLines(content, fontSize, width, advance), lineHeight);

interface RectSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  radius?: number;
  fillOpacity?: number;
  rotation?: number;
  shadow?: ElementShadow;
  animation?: ElementAnimation;
}

function rect(spec: RectSpec): ShapeElementProps {
  return {
    id: spec.id,
    type: 'shape',
    name: spec.name,
    position: { x: spec.x, y: spec.y },
    size: { width: spec.width, height: spec.height },
    rotation: spec.rotation ?? 0,
    scale: 1,
    shapeType: 'rectangle',
    fillColor: spec.fill,
    strokeColor: 'transparent',
    strokeWidth: 0,
    borderRadius: spec.radius ?? 0,
    fillOpacity: spec.fillOpacity,
    shadow: spec.shadow,
    animation: spec.animation,
  };
}

interface CircleSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  fill: string;
  fillOpacity?: number;
  /** Percent of the outer radius; turns the disc into a ring. */
  innerRadius?: number;
  /** Non-zero turns this into an out-of-focus colour wash. */
  blur?: number;
  animation?: ElementAnimation;
}

function circle(spec: CircleSpec): ShapeElementProps {
  return {
    id: spec.id,
    type: 'shape',
    name: spec.name,
    position: { x: spec.x, y: spec.y },
    size: { width: spec.size, height: spec.size },
    rotation: 0,
    scale: 1,
    shapeType: 'circle',
    fillColor: spec.fill,
    strokeColor: 'transparent',
    strokeWidth: 0,
    fillOpacity: spec.fillOpacity,
    innerRadius: spec.innerRadius,
    blur: spec.blur,
    animation: spec.animation,
  };
}

/** Soft out-of-focus colour wash. Decoration: the store cut drops it. */
const wash = (
  id: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  opacity = 0.45,
  at = 0,
  blur = 140
) => circle({ id, name: `Wash ${id.replace(/^wash-/, '')}`, x, y, size, fill, fillOpacity: opacity, blur, animation: enters('fade', at, 1.3) });

interface SvgSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  height?: number;
  path: string;
  fill: string;
  rotation?: number;
  fillOpacity?: number;
  animation?: ElementAnimation;
}

function svgShape(spec: SvgSpec): ShapeElementProps {
  return {
    id: spec.id,
    type: 'shape',
    name: spec.name,
    position: { x: spec.x, y: spec.y },
    size: { width: spec.size, height: spec.height ?? spec.size },
    rotation: spec.rotation ?? 0,
    scale: 1,
    shapeType: 'custom-svg',
    fillColor: spec.fill,
    strokeColor: 'transparent',
    strokeWidth: 0,
    fillOpacity: spec.fillOpacity,
    customPath: spec.path,
    specialProps: { viewBox: '0 0 100 100' },
    animation: spec.animation,
  };
}

interface PhoneSpec {
  y: number;
  poster: string;
  frameColor: string;
  deviceType?: VideoDeviceElementProps['deviceType'];
  x?: number;
  width?: number;
  height?: number;
  rotation?: number;
  at?: number;
  enter?: ElementAnimationPreset;
}

/**
 * The recording mockup. Named for the drop target it is: this is the one layer
 * every user has to touch, and the Layers panel and the timeline both show the
 * name.
 */
function phone(spec: PhoneSpec): VideoDeviceElementProps {
  const width = spec.width ?? PHONE_W;
  return {
    id: 'phone',
    type: 'video-device',
    name: 'Phone (drop your recording here)',
    position: { x: spec.x ?? Math.round((W - width) / 2), y: spec.y },
    size: { width, height: spec.height ?? Math.round((width / PHONE_W) * PHONE_H) },
    rotation: spec.rotation ?? 0,
    scale: 1,
    deviceType: spec.deviceType ?? 'iphone-15-pro',
    posterSrc: spec.poster,
    naturalVideoWidth: POSTER_W,
    naturalVideoHeight: POSTER_H,
    objectFit: 'cover',
    frameColor: spec.frameColor,
    animation: enters(spec.enter ?? 'slide-up', spec.at ?? 0.1, 1),
  };
}

interface GestureSpec {
  id: string;
  gestureType: GestureType;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  triggerTime: number;
  gestureDuration?: number;
}

function gesture(spec: GestureSpec): GestureElementProps {
  return {
    id: spec.id,
    type: 'gesture',
    name: `${spec.gestureType.replace('-', ' ')} hint`,
    position: { x: spec.x, y: spec.y },
    size: { width: spec.width, height: spec.height },
    rotation: 0,
    scale: 1,
    gestureType: spec.gestureType,
    color: spec.color,
    triggerTime: spec.triggerTime,
    gestureDuration: spec.gestureDuration ?? 1.4,
  };
}

/**
 * Tap ripple over the phone's screen. `dx` nudges it off the centre line:
 * gesture hints are drawn as rings when nothing is playing, so a column of
 * three of them down the middle of the phone reads as target practice rather
 * than as design. Two per scene, offset, is the house limit.
 */
const tap = (id: string, y: number, color: string, at: number, dx = 0, kind: 'tap' | 'double-tap' = 'tap') =>
  gesture({ id, gestureType: kind, x: (W - 150) / 2 + dx, y, width: 150, height: 150, color, triggerTime: at });

/** Swipe trail over the phone's screen. */
const swipe = (
  id: string,
  gestureType: GestureType,
  y: number,
  color: string,
  at: number,
  dx = 0
) => {
  const vertical = gestureType === 'swipe-up' || gestureType === 'swipe-down';
  const width = vertical ? 200 : 360;
  const height = vertical ? 340 : 190;
  return gesture({
    id,
    gestureType,
    x: (W - width) / 2 + dx,
    y,
    width,
    height,
    color,
    triggerTime: at,
    gestureDuration: 1.7,
  });
};

// ---------------------------------------------------------------------------
// Vector art, all in a 0..100 viewBox
// ---------------------------------------------------------------------------

const STAR_PATH =
  'M50 2 L63.54 31.36 L95.65 35.17 L71.91 57.12 L78.21 88.83 L50 73.04 L21.79 88.83 L28.09 57.12 L4.35 35.17 L36.46 31.36 Z';
const SPARKLE_PATH =
  'M50 2 Q55.43 44.57 98 50 Q55.43 55.43 50 98 Q44.57 55.43 2 50 Q44.57 44.57 50 2 Z';
/** Filled disc with a tick knocked out of it. */
const CHECK_PATH =
  'M50 4 A46 46 0 1 1 49.99 4 Z M28 51 L42 65 L73 34 L66 27 L42 51 L35 44 Z';
const HEART_PATH =
  'M50 88 C20 65 8 45 8 30 C8 16 19 8 30 8 C40 8 47 14 50 20 C53 14 60 8 70 8 C81 8 92 16 92 30 C92 45 80 65 50 88 Z';
const BOLT_PATH = 'M60 4 L24 56 L46 56 L40 96 L78 42 L54 42 Z';
const PLAY_PATH = 'M24 10 L86 50 L24 90 Z';

// ---------------------------------------------------------------------------
// Composition blocks
// ---------------------------------------------------------------------------

/** Palette every block reads from, so one scene stays internally consistent. */
interface Palette {
  /** Headline colour. */
  ink: string;
  /** Eyebrows, numerals, accents. */
  accent: string;
  /** Sublines and captions. */
  muted: string;
  /** Type family for headlines. */
  head: string;
  /** Type family for everything else. */
  body: string;
  /** False when the board is pale and the type is dark. */
  onDark: boolean;
}

const GAP_AFTER_EYEBROW = 20;
const GAP_AFTER_HEAD = 26;

interface CopySpec {
  y: number;
  eyebrow?: string;
  headline: string;
  sub?: string;
  headSize?: number;
  headWeight?: string;
  align?: 'left' | 'center';
  at?: number;
  enter?: ElementAnimationPreset;
}

/**
 * Eyebrow, headline and subline as one stack. Each block's box is measured from
 * its own content, so the next one starts exactly below it: no clipping, no
 * two blocks fighting for the same pixels. Returns the elements plus the y the
 * stack ends at, for whatever sits under it.
 */
function copyStack(p: Palette, spec: CopySpec): { elements: ArtboardElement[]; bottom: number } {
  const elements: ArtboardElement[] = [];
  const at = spec.at ?? 0.3;
  const headSize = spec.headSize ?? SIZE_HEAD;
  const align = spec.align ?? 'left';
  let y = spec.y;

  if (spec.eyebrow) {
    elements.push(
      text({
        id: 'eyebrow',
        name: 'Eyebrow',
        content: spec.eyebrow,
        y,
        fontSize: SIZE_EYEBROW,
        lineHeight: 1.2,
        letterSpacing: 1.6,
        color: p.accent,
        fontFamily: p.body,
        fontWeight: '600',
        textAlign: align,
        onDark: p.onDark,
        animation: enters('fade', at, 0.6),
      })
    );
    y += textH(spec.eyebrow, SIZE_EYEBROW, 1.2) + GAP_AFTER_EYEBROW;
  }

  elements.push(
    text({
      id: 'headline',
      name: 'Headline',
      content: spec.headline,
      y,
      fontSize: headSize,
      color: p.ink,
      fontFamily: p.head,
      fontWeight: spec.headWeight,
      textAlign: align,
      onDark: p.onDark,
      animation: enters(spec.enter ?? 'slide-up', at + 0.15, 0.8),
    })
  );
  y += textH(spec.headline, headSize) + GAP_AFTER_HEAD;

  if (spec.sub) {
    elements.push(
      text({
        id: 'subline',
        name: 'Subline',
        content: spec.sub,
        y,
        fontSize: SIZE_SUB,
        lineHeight: 1.25,
        color: p.muted,
        fontFamily: p.body,
        fontWeight: '400',
        textAlign: align,
        onDark: p.onDark,
        animation: enters('fade', at + 0.55, 0.7),
      })
    );
    y += textH(spec.sub, SIZE_SUB, 1.25);
  }

  return { elements, bottom: y };
}

interface CtaSpec {
  y: number;
  label: string;
  fill: string;
  labelColor: string;
  font: string;
  at: number;
  /** Halo under the pill. Defaults to a soft version of the fill. */
  glow?: string;
  onDarkLabel?: boolean;
}

/** Pill plus its label, animated together. */
function cta(spec: CtaSpec): ArtboardElement[] {
  const labelH = boxH(SIZE_CTA, 1, 1.15);
  return [
    rect({
      id: 'cta-pill',
      name: 'CTA pill',
      x: PILL_X,
      y: spec.y,
      width: PILL_W,
      height: PILL_H,
      fill: spec.fill,
      radius: PILL_H / 2,
      shadow: { x: 0, y: 16, blur: 44, color: spec.glow ?? 'rgba(0,0,0,0.3)' },
      animation: enters('pop', spec.at, 0.6),
    }),
    text({
      id: 'cta-label',
      name: 'CTA label',
      content: spec.label,
      x: PILL_X,
      y: spec.y + Math.round((PILL_H - labelH) / 2),
      width: PILL_W,
      fontSize: SIZE_CTA,
      lineHeight: 1.15,
      color: spec.labelColor,
      fontFamily: spec.font,
      textAlign: 'center',
      onDark: spec.onDarkLabel ?? true,
      animation: enters('pop', spec.at, 0.6),
    }),
  ];
}

const CHIP_W = 486;
const CHIP_PAD = 30;
const CHIP_ICON = 64;

interface ChipSpec {
  key: string;
  label: string;
  x: number;
  y: number;
  at: number;
  from?: ElementAnimationPreset;
  icon?: string;
  iconColor: string;
  fill?: string;
  labelColor: string;
  font: string;
  onDarkLabel?: boolean;
}

/**
 * A floating pill card: icon plus one or two lines. The card is measured from
 * its label, so a longer benefit grows the card instead of being clipped by it.
 */
function chip(spec: ChipSpec): ArtboardElement[] {
  const labelW = CHIP_W - CHIP_PAD * 2 - CHIP_ICON - 20;
  const labelH = textH(spec.label, SIZE_CHIP, 1.2);
  const height = Math.max(116, labelH + 52);
  const fill = spec.fill ?? '#FFFFFF';
  const from = spec.from ?? 'slide-right';
  return [
    rect({
      id: `${spec.key}-card`,
      name: `${spec.label} card`,
      x: spec.x,
      y: spec.y,
      width: CHIP_W,
      height,
      fill,
      radius: height / 2,
      shadow: { x: 0, y: 16, blur: 40, color: 'rgba(10,14,32,0.22)' },
      animation: enters(from, spec.at, 0.65),
    }),
    svgShape({
      id: `${spec.key}-icon`,
      name: `${spec.label} icon`,
      x: spec.x + CHIP_PAD,
      y: spec.y + Math.round((height - CHIP_ICON) / 2),
      size: CHIP_ICON,
      path: spec.icon ?? CHECK_PATH,
      fill: spec.iconColor,
      animation: enters(from, spec.at + 0.08, 0.65),
    }),
    text({
      id: `${spec.key}-label`,
      name: `${spec.label} label`,
      content: spec.label,
      x: spec.x + CHIP_PAD + CHIP_ICON + 20,
      y: spec.y + Math.round((height - labelH) / 2),
      width: labelW,
      fontSize: SIZE_CHIP,
      lineHeight: 1.2,
      color: spec.labelColor,
      fontFamily: spec.font,
      fontWeight: '600',
      onDark: spec.onDarkLabel ?? false,
      animation: enters(from, spec.at + 0.08, 0.65),
    }),
  ];
}

interface StepSpec {
  key: string;
  numeral: string;
  title: string;
  y: number;
  at: number;
  accent: string;
  ink: string;
  font: string;
  onDark: boolean;
}

/** Numbered disc plus a one-line step title, as a list row. */
function step(spec: StepSpec): ArtboardElement[] {
  const disc = 68;
  const numeralH = boxH(SIZE_SUB, 1, 1.15);
  const titleH = textH(spec.title, 12, 1.15);
  const height = Math.max(disc, titleH);
  return [
    circle({
      id: `${spec.key}-disc`,
      name: `Step ${spec.numeral} disc`,
      x: M,
      y: spec.y + Math.round((height - disc) / 2),
      size: disc,
      fill: spec.accent,
      animation: enters('pop', spec.at, 0.5),
    }),
    text({
      id: `${spec.key}-numeral`,
      name: `Step ${spec.numeral} number`,
      content: spec.numeral,
      x: M,
      y: spec.y + Math.round((height - numeralH) / 2),
      width: disc,
      fontSize: SIZE_SUB,
      lineHeight: 1.15,
      color: '#FFFFFF',
      fontFamily: spec.font,
      textAlign: 'center',
      animation: enters('pop', spec.at, 0.5),
    }),
    text({
      id: `${spec.key}-title`,
      name: `Step ${spec.numeral} title`,
      content: spec.title,
      x: M + disc + 26,
      y: spec.y + Math.round((height - titleH) / 2),
      width: CW - disc - 26,
      fontSize: 12,
      lineHeight: 1.15,
      color: spec.ink,
      fontFamily: spec.font,
      fontWeight: '600',
      onDark: spec.onDark,
      animation: enters('slide-right', spec.at + 0.1, 0.6),
    }),
  ];
}

interface QuoteSpec {
  key: string;
  quote: string;
  author: string;
  x: number;
  y: number;
  width?: number;
  at: number;
  from?: ElementAnimationPreset;
  fill?: string;
  ink: string;
  authorColor: string;
  font: string;
}

/** Review card: quote plus attribution, measured from the quote. */
function quoteCard(spec: QuoteSpec): ArtboardElement[] {
  const width = spec.width ?? 540;
  const pad = 40;
  const quoteH = textH(spec.quote, SIZE_CHIP, 1.3);
  const authorH = boxH(SIZE_EYEBROW, 1, 1.2);
  const height = pad * 2 + quoteH + 18 + authorH;
  const from = spec.from ?? 'slide-right';
  return [
    rect({
      id: `${spec.key}-card`,
      name: `Review card ${spec.key}`,
      x: spec.x,
      y: spec.y,
      width,
      height,
      fill: spec.fill ?? '#FFFFFF',
      radius: 40,
      shadow: { x: 0, y: 18, blur: 46, color: 'rgba(20,16,10,0.24)' },
      animation: enters(from, spec.at, 0.7),
    }),
    text({
      id: `${spec.key}-quote`,
      name: `Review quote ${spec.key}`,
      content: spec.quote,
      x: spec.x + pad,
      y: spec.y + pad,
      width: width - pad * 2,
      fontSize: SIZE_CHIP,
      lineHeight: 1.3,
      color: spec.ink,
      fontFamily: spec.font,
      fontWeight: '600',
      onDark: false,
      animation: enters(from, spec.at + 0.1, 0.7),
    }),
    text({
      id: `${spec.key}-author`,
      name: `Review author ${spec.key}`,
      content: spec.author,
      x: spec.x + pad,
      y: spec.y + pad + quoteH + 18,
      width: width - pad * 2,
      fontSize: SIZE_EYEBROW,
      lineHeight: 1.2,
      color: spec.authorColor,
      fontFamily: spec.font,
      fontWeight: '500',
      onDark: false,
      animation: enters(from, spec.at + 0.1, 0.7),
    }),
  ];
}

/** Five stars, popping in one after another. */
function starRow(y: number, fill: string, at: number, size = 76, gap = 20): ArtboardElement[] {
  const total = size * 5 + gap * 4;
  const startX = Math.round((W - total) / 2);
  return [0, 1, 2, 3, 4].map((i) =>
    svgShape({
      id: `star-${i + 1}`,
      name: `Star ${i + 1}`,
      x: startX + i * (size + gap),
      y,
      size,
      path: STAR_PATH,
      fill,
      animation: enters('pop', at + i * 0.13, 0.5),
    })
  );
}

/** Big number over a small all-caps label. */
function statBlock(o: {
  key: string;
  value: string;
  label: string;
  y: number;
  x?: number;
  width?: number;
  at: number;
  valueColor: string;
  labelColor: string;
  headFont: string;
  bodyFont: string;
  align?: 'left' | 'center';
  onDark: boolean;
  valueSize?: number;
}): ArtboardElement[] {
  const valueSize = o.valueSize ?? SIZE_STAT;
  const valueH = textH(o.value, valueSize, 1.02);
  return [
    text({
      id: `${o.key}-value`,
      name: `${o.label} value`,
      content: o.value,
      x: o.x,
      y: o.y,
      width: o.width,
      fontSize: valueSize,
      lineHeight: 1.02,
      letterSpacing: -0.6,
      color: o.valueColor,
      fontFamily: o.headFont,
      textAlign: o.align ?? 'center',
      onDark: o.onDark,
      animation: enters('pop', o.at, 0.7),
    }),
    text({
      id: `${o.key}-label`,
      name: `${o.label} label`,
      content: o.label,
      x: o.x,
      y: o.y + valueH + 8,
      width: o.width,
      fontSize: SIZE_EYEBROW,
      lineHeight: 1.2,
      letterSpacing: 1.8,
      color: o.labelColor,
      fontFamily: o.bodyFont,
      fontWeight: '600',
      textAlign: o.align ?? 'center',
      onDark: o.onDark,
      animation: enters('fade', o.at + 0.25, 0.6),
    }),
  ];
}

// ---------------------------------------------------------------------------
// The scenes
// ---------------------------------------------------------------------------

export interface PreviewSceneDef {
  /** Stable id; also the library id suffix (`scene:<id>`). */
  id: string;
  /** Name shown on the palette tile. */
  label: string;
  /** One line under the name: what this scene is for. */
  blurb: string;
  /**
   * Extra words search should match. The palette shows names, but an MCP client
   * looks a scene up by category ("finance", "fitness", "social"), and those
   * words are deliberately absent from the blurbs, which are written to read
   * well rather than to be searched.
   */
  keywords?: string;
  /** Tints the (otherwise identical) palette thumbnail. */
  accent: string;
  /** Name the new artboard gets. */
  boardName: string;
  backgroundColor: string;
  backgroundGradient?: { color1: string; color2: string; angle: number };
  /** Authored in z-order, bottom first. Ids are re-minted on every drop. */
  elements: ArtboardElement[];
}

const SCREEN = (name: string) => `/data/projects/app-screens/${name}.png`;

/** Font pairings, so a scene picks a voice rather than two family names. */
const VOICE = {
  tech: { head: 'Space Grotesk', body: 'Space Grotesk' },
  modern: { head: 'Outfit', body: 'Outfit' },
  friendly: { head: 'Poppins', body: 'Poppins' },
  editorial: { head: 'Bricolage Grotesque', body: 'Bricolage Grotesque' },
  poster: { head: 'Anton', body: 'Outfit' },
  ticket: { head: 'Bebas Neue', body: 'Outfit' },
} as const;

// Where things go in the classic grid. Stated once so the floating cards and
// the gesture hints cannot end up on the same pixels: cards take the 980 and
// 1500 lanes, gestures take 610 and 1120, and the two never meet.
const CLASSIC_PHONE_Y = 520;
const CLASSIC_CARD_LANE_A = 980;
const CLASSIC_CARD_LANE_B = 1440;
const CLASSIC_CTA_Y = 1755;
const CARD_X_LEFT = 20;
const CARD_X_RIGHT = W - CHIP_W - 20;

/**
 * Grid A, "classic": copy at the top, phone in the middle, call to action at
 * the bottom. The workhorse. Copy block 140 to ~470, phone 520 to 1720, pill
 * 1755 to 1867.
 */
function classicScene(o: {
  id: string;
  label: string;
  blurb: string;
  accent: string;
  boardName: string;
  backgroundColor: string;
  backgroundGradient?: { color1: string; color2: string; angle: number };
  palette: Palette;
  eyebrow?: string;
  headline: string;
  sub: string;
  align?: 'left' | 'center';
  poster: string;
  frameColor: string;
  ctaLabel: string;
  ctaFill: string;
  ctaLabelColor: string;
  ctaGlow?: string;
  ctaOnDarkLabel?: boolean;
  decor?: ArtboardElement[];
  overlay?: ArtboardElement[];
  gestures?: ArtboardElement[];
  phoneEnter?: ElementAnimationPreset;
}): PreviewSceneDef {
  const copy = copyStack(o.palette, {
    y: 140,
    eyebrow: o.eyebrow,
    headline: o.headline,
    sub: o.sub,
    align: o.align,
    at: 0.3,
  });
  return {
    id: o.id,
    label: o.label,
    blurb: o.blurb,
    accent: o.accent,
    boardName: o.boardName,
    backgroundColor: o.backgroundColor,
    backgroundGradient: o.backgroundGradient,
    elements: [
      ...(o.decor ?? []),
      phone({ y: CLASSIC_PHONE_Y, poster: o.poster, frameColor: o.frameColor, enter: o.phoneEnter }),
      ...copy.elements,
      ...(o.overlay ?? []),
      ...(o.gestures ?? [
        tap('tap-1', 610, o.accent, 2.4, -130),
        swipe('swipe-1', 'swipe-up', 1120, o.accent, 6.4, 120),
      ]),
      ...cta({
        y: CLASSIC_CTA_Y,
        label: o.ctaLabel,
        fill: o.ctaFill,
        labelColor: o.ctaLabelColor,
        font: o.palette.body,
        glow: o.ctaGlow,
        onDarkLabel: o.ctaOnDarkLabel,
        at: 13.2,
      }),
    ],
  };
}

/**
 * Grid C, "poster": one enormous statement up top, the phone pushed low and
 * cropped by the frame edge. Reads at thumbnail size, which is how most people
 * first meet a preview.
 */
function posterScene(o: {
  id: string;
  label: string;
  blurb: string;
  accent: string;
  boardName: string;
  backgroundColor: string;
  backgroundGradient?: { color1: string; color2: string; angle: number };
  palette: Palette;
  brand: string;
  giant: string;
  giantSize?: number;
  sub: string;
  poster: string;
  frameColor: string;
  ctaLabel: string;
  ctaFill: string;
  ctaLabelColor: string;
  ctaGlow?: string;
  ctaOnDarkLabel?: boolean;
  decor?: ArtboardElement[];
  gestures?: ArtboardElement[];
}): PreviewSceneDef {
  const giantSize = o.giantSize ?? SIZE_GIANT;
  const brandH = boxH(SIZE_EYEBROW, 1, 1.2);
  const brandY = 150;
  const giantY = brandY + brandH + 26;
  const giantH = textH(o.giant, giantSize, 1.02, CW, ADVANCE_CONDENSED);
  const subY = giantY + giantH + 30;
  const subH = textH(o.sub, SIZE_SUB, 1.25);
  const ctaY = subY + subH + 42;
  // The phone starts BELOW the pill, wherever the statement pushed it to. A
  // fixed y put the pill behind the phone as soon as a headline ran long.
  const phoneY = ctaY + PILL_H + 46;
  return {
    id: o.id,
    label: o.label,
    blurb: o.blurb,
    accent: o.accent,
    boardName: o.boardName,
    backgroundColor: o.backgroundColor,
    backgroundGradient: o.backgroundGradient,
    elements: [
      ...(o.decor ?? []),
      text({
        id: 'brand',
        name: 'Brand line',
        content: o.brand,
        y: brandY,
        fontSize: SIZE_EYEBROW,
        lineHeight: 1.2,
        letterSpacing: 2.2,
        color: o.palette.accent,
        fontFamily: o.palette.body,
        fontWeight: '600',
        textAlign: 'center',
        onDark: o.palette.onDark,
        animation: enters('fade', 0.25, 0.6),
      }),
      text({
        id: 'giant',
        name: 'Statement',
        content: o.giant,
        y: giantY,
        fontSize: giantSize,
        lineHeight: 1.02,
        letterSpacing: -1,
        color: o.palette.ink,
        fontFamily: o.palette.head,
        fontWeight: '400',
        textAlign: 'center',
        advance: ADVANCE_CONDENSED,
        onDark: o.palette.onDark,
        animation: enters('scale-up', 0.45, 0.75),
      }),
      text({
        id: 'subline',
        name: 'Subline',
        content: o.sub,
        y: subY,
        fontSize: SIZE_SUB,
        lineHeight: 1.25,
        color: o.palette.muted,
        fontFamily: o.palette.body,
        fontWeight: '400',
        textAlign: 'center',
        onDark: o.palette.onDark,
        animation: enters('fade', 0.95, 0.7),
      }),
      ...cta({
        y: ctaY,
        label: o.ctaLabel,
        fill: o.ctaFill,
        labelColor: o.ctaLabelColor,
        font: o.palette.body,
        glow: o.ctaGlow,
        onDarkLabel: o.ctaOnDarkLabel,
        at: 12.8,
      }),
      phone({ y: phoneY, poster: o.poster, frameColor: o.frameColor, at: 0.15 }),
      ...(o.gestures ?? [
        tap('tap-1', phoneY + 230, o.accent, 2.6, -130),
        swipe('swipe-1', 'swipe-up', phoneY + 520, o.accent, 6.8, 130),
      ]),
    ],
  };
}

// Proof grid. The pill sits BELOW the phone rather than on it: a call to action
// lying across a phone's home bar reads as a mistake. The phone is not given a
// fixed box, because the hero block above it varies from a row of stars to a
// mark plus a number plus a label; it takes whatever is left between the copy
// and the pill, and its width follows from that so it never distorts.
const PROOF_CTA_Y = 1706;
const PROOF_FOOTNOTE_Y = 1846;
/** Gap under the copy stack, and above the pill. */
const PROOF_PHONE_GAP = 40;
const PROOF_PHONE_BOTTOM = PROOF_CTA_Y - 34;

/**
 * Grid D, "proof": a number or a rating leads, the phone sits under it, and a
 * card or two float over the phone's lower half. Social proof moves installs
 * more than feature lists do.
 */
function proofScene(o: {
  id: string;
  label: string;
  blurb: string;
  accent: string;
  boardName: string;
  backgroundColor: string;
  backgroundGradient?: { color1: string; color2: string; angle: number };
  palette: Palette;
  hero: ArtboardElement[];
  /** The y the hero block ends at, so the copy under it never collides. */
  heroBottom: number;
  headline: string;
  caption?: string;
  poster: string;
  frameColor: string;
  /**
   * Cards floating over the phone. Called with the phone's actual box, since
   * that is only known once the hero block above it has been measured.
   */
  overlay?: (phone: { top: number; bottom: number; width: number }) => ArtboardElement[];
  ctaLabel: string;
  ctaFill: string;
  ctaLabelColor: string;
  ctaGlow?: string;
  ctaOnDarkLabel?: boolean;
  footnote?: string;
  decor?: ArtboardElement[];
  gestures?: ArtboardElement[];
}): PreviewSceneDef {
  const headlineY = o.heroBottom + 34;
  const headH = textH(o.headline, SIZE_HEAD);
  const captionY = headlineY + headH + 22;
  const copyBottom = o.caption ? captionY + textH(o.caption, SIZE_SUB, 1.25) : headlineY + headH;
  // Whatever is left between the copy and the pill, keeping the 1:2 phone box.
  const phoneTop = copyBottom + PROOF_PHONE_GAP;
  const phoneH = PROOF_PHONE_BOTTOM - phoneTop;
  const phoneW = Math.round((phoneH / PHONE_H) * PHONE_W);
  const phoneBox = { top: phoneTop, bottom: PROOF_PHONE_BOTTOM, width: phoneW };
  return {
    id: o.id,
    label: o.label,
    blurb: o.blurb,
    accent: o.accent,
    boardName: o.boardName,
    backgroundColor: o.backgroundColor,
    backgroundGradient: o.backgroundGradient,
    elements: [
      ...(o.decor ?? []),
      ...o.hero,
      text({
        id: 'headline',
        name: 'Headline',
        content: o.headline,
        y: headlineY,
        fontSize: SIZE_HEAD,
        color: o.palette.ink,
        fontFamily: o.palette.head,
        textAlign: 'center',
        onDark: o.palette.onDark,
        animation: enters('slide-up', 1.2, 0.8),
      }),
      ...(o.caption
        ? [
            text({
              id: 'caption',
              name: 'Caption',
              content: o.caption,
              y: captionY,
              fontSize: SIZE_SUB,
              lineHeight: 1.25,
              color: o.palette.muted,
              fontFamily: o.palette.body,
              fontWeight: '400',
              textAlign: 'center',
              onDark: o.palette.onDark,
              animation: enters('fade', 1.6, 0.7),
            }),
          ]
        : []),
      phone({
        y: phoneTop,
        width: phoneW,
        height: phoneH,
        poster: o.poster,
        frameColor: o.frameColor,
        at: 0.15,
      }),
      ...(o.overlay ? o.overlay(phoneBox) : []),
      ...(o.gestures ?? [
        tap('tap-1', phoneTop + 120, o.accent, 2.2, -125),
        tap('tap-2', phoneTop + 420, o.accent, 9.4, 135, 'double-tap'),
      ]),
      ...cta({
        y: PROOF_CTA_Y,
        label: o.ctaLabel,
        fill: o.ctaFill,
        labelColor: o.ctaLabelColor,
        font: o.palette.body,
        glow: o.ctaGlow,
        onDarkLabel: o.ctaOnDarkLabel,
        at: 13,
      }),
      ...(o.footnote
        ? [
            text({
              id: 'footnote',
              name: 'Footnote',
              content: o.footnote,
              y: PROOF_FOOTNOTE_Y,
              fontSize: SIZE_SUB,
              lineHeight: 1.2,
              color: o.palette.muted,
              fontFamily: o.palette.body,
              fontWeight: '600',
              textAlign: 'center',
              onDark: o.palette.onDark,
              animation: enters('fade', 14, 0.7),
            }),
          ]
        : []),
    ],
  };
}

// --- the twenty ------------------------------------------------------------

const PREVIEW_SCENE_LIST: PreviewSceneDef[] = [
  // 1
  classicScene({
    id: 'spotlight-launch',
    label: 'Spotlight Launch',
    blurb: 'Cinematic dark reveal. The one that looks like a product film',
    accent: '#8B7CFF',
    boardName: 'Spotlight Launch',
    backgroundColor: '#05070F',
    backgroundGradient: { color1: '#05070F', color2: '#181B31', angle: 165 },
    palette: { ink: '#FFFFFF', accent: '#9C8DFF', muted: '#9AA6C8', ...VOICE.tech, onDark: true },
    eyebrow: 'VERSION 3 IS HERE',
    headline: 'Rebuilt from\nthe first tap',
    sub: 'Twice as fast, half the taps, same shortcuts',
    poster: SCREEN('app-dashboard-dark'),
    frameColor: '#0A0C12',
    ctaLabel: 'Download free',
    ctaFill: '#6D5BFF',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(109,91,255,0.5)',
    decor: [
      wash('wash-violet', 96, 220, 680, '#6D5BFF', 0.5, 0),
      wash('wash-cyan', 440, 1180, 540, '#22D3EE', 0.3, 0.4, 160),
    ],
  }),

  // 2
  {
    id: 'feature-rush',
    label: 'Feature Rush',
    blurb: 'Three benefits stack up beside the phone as it plays',
    accent: '#4F46E5',
    boardName: 'Feature Rush',
    backgroundColor: '#F2F4FF',
    backgroundGradient: { color1: '#FFFFFF', color2: '#DDE3FF', angle: 160 },
    elements: (() => {
      const p: Palette = { ink: '#101534', accent: '#4F46E5', muted: '#5B6390', ...VOICE.modern, onDark: false };
      const copy = copyStack(p, {
        y: 140,
        headline: 'Three reasons\npeople stay',
        sub: 'The parts nobody expects to be this quick',
        align: 'center',
        at: 0.25,
      });
      return [
        wash('wash-indigo', 480, -120, 560, '#8B93FF', 0.4, 0),
        wash('wash-amber', -150, 1400, 520, '#FDBA74', 0.45, 0.3),
        phone({ y: 520, poster: SCREEN('app-list-light'), frameColor: '#F2F2F4', enter: 'scale-up' }),
        ...copy.elements,
        ...chip({ key: 'chip-a', label: 'Ready in a minute', x: CARD_X_LEFT, y: 760, at: 1.9, from: 'slide-right', iconColor: '#4F46E5', labelColor: '#101534', font: 'Outfit' }),
        ...chip({ key: 'chip-b', label: 'Works offline', x: CARD_X_RIGHT, y: 1080, at: 4.4, from: 'slide-left', iconColor: '#0EA5E9', labelColor: '#101534', font: 'Outfit' }),
        ...chip({ key: 'chip-c', label: 'All in one place', x: CARD_X_LEFT, y: 1400, at: 6.9, from: 'slide-right', iconColor: '#F97316', labelColor: '#101534', font: 'Outfit' }),
        tap('tap-1', 600, '#4F46E5', 1.3, -150),
        swipe('swipe-1', 'swipe-up', 1210, '#0EA5E9', 5.2, 175),
        ...cta({ y: 1755, label: 'Try it free', fill: '#4F46E5', labelColor: '#FFFFFF', font: 'Outfit', glow: 'rgba(79,70,229,0.4)', at: 12.4 }),
      ];
    })(),
  },

  // 3
  posterScene({
    id: 'headline-punch',
    label: 'Headline Punch',
    blurb: 'One giant promise. Still readable at thumbnail size',
    accent: '#F5D0FE',
    boardName: 'Headline Punch',
    backgroundColor: '#6D28D9',
    backgroundGradient: { color1: '#5B21B6', color2: '#DB2777', angle: 155 },
    palette: { ink: '#FFFFFF', accent: '#F5D0FE', muted: '#FBD7EE', ...VOICE.poster, onDark: true },
    brand: 'YOUR APP',
    giant: 'ZERO\nLOADING',
    giantSize: 43,
    sub: 'The whole thing already lives on your phone',
    poster: SCREEN('app-player-royal'),
    frameColor: '#1B0B2E',
    ctaLabel: 'Get it free',
    ctaFill: '#FFFFFF',
    ctaLabelColor: '#6D28D9',
    ctaGlow: 'rgba(40,4,60,0.35)',
    ctaOnDarkLabel: false,
    decor: [
      svgShape({ id: 'sparkle-a', name: 'Sparkle left', x: 78, y: 300, size: 84, path: SPARKLE_PATH, fill: '#FDE68A', animation: enters('pop', 0.9, 0.5) }),
      svgShape({ id: 'sparkle-b', name: 'Sparkle right', x: 736, y: 470, size: 58, path: SPARKLE_PATH, fill: '#FBCFE8', animation: enters('pop', 1.15, 0.5) }),
    ],
  }),

  // 4
  proofScene({
    id: 'five-star-proof',
    label: 'Five Star Proof',
    blurb: 'Rating, a real review and the download count',
    accent: '#F59E0B',
    boardName: 'Five Star Proof',
    backgroundColor: '#FFF8F1',
    backgroundGradient: { color1: '#FFFDFB', color2: '#FFE3C4', angle: 160 },
    palette: { ink: '#1C1917', accent: '#B45309', muted: '#8A6A4C', ...VOICE.editorial, onDark: false },
    hero: starRow(176, '#F59E0B', 0.5),
    heroBottom: 252,
    headline: '4.9 from\n180,000 reviews',
    caption: 'on the App Store, in 34 countries',
    poster: SCREEN('app-feed-coral'),
    frameColor: '#F5F1EC',
    overlay: (box) =>
      quoteCard({
        key: 'review',
        quote: 'Replaced four apps in one\nafternoon and I have not\nopened them since',
        author: 'Priya, studio owner',
        x: 118,
        y: box.bottom - 400,
        at: 3.4,
        ink: '#1C1917',
        authorColor: '#A16207',
        font: 'Bricolage Grotesque',
      }),
    ctaLabel: 'Join them free',
    ctaFill: '#1C1917',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(28,25,23,0.35)',
    footnote: '2 million downloads and counting',
    decor: [
      wash('wash-coral', 530, 60, 520, '#FDA4AF', 0.42, 0),
      wash('wash-amber', -140, 1360, 540, '#FCD34D', 0.45, 0.3),
    ],

  }),

  // 5
  {
    id: 'three-taps',
    label: 'Three Taps',
    blurb: 'Teach the flow in three numbered steps, one gesture each',
    accent: '#0D9488',
    boardName: 'Three Taps',
    backgroundColor: '#F6FAFA',
    backgroundGradient: { color1: '#FFFFFF', color2: '#D7F2EE', angle: 168 },
    elements: (() => {
      const p: Palette = { ink: '#0F172A', accent: '#0D9488', muted: '#5A6478', ...VOICE.friendly, onDark: false };
      const copy = copyStack(p, {
        y: 128,
        eyebrow: 'HOW IT WORKS',
        headline: 'Set up in the\ntime it takes to\nfind your keys',
        at: 0.25,
      });
      return [
        wash('wash-teal', 500, 1200, 580, '#5EEAD4', 0.5, 0),
        ...copy.elements,
        ...step({ key: 'step-1', numeral: '1', title: 'Open it, no account yet', y: 500, at: 1.4, accent: '#0D9488', ink: '#0F172A', font: 'Poppins', onDark: false }),
        ...step({ key: 'step-2', numeral: '2', title: 'Pick what you care about', y: 600, at: 2.6, accent: '#0D9488', ink: '#0F172A', font: 'Poppins', onDark: false }),
        ...step({ key: 'step-3', numeral: '3', title: 'That is the whole setup', y: 700, at: 3.8, accent: '#0D9488', ink: '#0F172A', font: 'Poppins', onDark: false }),
        phone({ y: 810, poster: SCREEN('app-list-eco'), frameColor: '#101418', width: 560, at: 0.1 }),
        tap('tap-1', 960, '#0D9488', 5.4, -140),
        swipe('swipe-1', 'swipe-up', 1200, '#0EA5E9', 8.2, 140),
        ...cta({ y: 1690, label: 'Get started free', fill: '#0D9488', labelColor: '#FFFFFF', font: 'Poppins', glow: 'rgba(13,148,136,0.42)', at: 13.6 }),
      ];
    })(),
  },

  // 6
  classicScene({
    id: 'money-mode',
    label: 'Money Mode',
    blurb: 'Banking and budgeting. Dark green, gold numbers, real figures',
    accent: '#F0C36B',
    boardName: 'Money Mode',
    backgroundColor: '#062B23',
    backgroundGradient: { color1: '#041F19', color2: '#0C4437', angle: 158 },
    palette: { ink: '#F7FDF9', accent: '#F0C36B', muted: '#8FC4B0', ...VOICE.tech, onDark: true },
    eyebrow: 'THIS MONTH SO FAR',
    headline: 'See where it\nactually went',
    sub: 'Every account in one balance, updated live',
    poster: SCREEN('app-dashboard-eco'),
    frameColor: '#08221C',
    ctaLabel: 'Connect a bank',
    ctaFill: '#F0C36B',
    ctaLabelColor: '#062B23',
    ctaGlow: 'rgba(240,195,107,0.35)',
    ctaOnDarkLabel: false,
    decor: [wash('wash-gold', 470, 240, 520, '#F0C36B', 0.3, 0), wash('wash-green', -110, 1240, 560, '#34D399', 0.34, 0.35)],
    overlay: [
      ...chip({ key: 'chip-a', label: 'Rent 42 percent', x: CARD_X_LEFT, y: CLASSIC_CARD_LANE_A, at: 2.2, from: 'slide-right', iconColor: '#065F46', fill: '#F7FDF9', labelColor: '#062B23', font: 'Space Grotesk' }),
      ...chip({ key: 'chip-b', label: 'Saved 312 so far', x: CARD_X_RIGHT, y: CLASSIC_CARD_LANE_B, at: 5.4, from: 'slide-left', iconColor: '#B45309', fill: '#F7FDF9', labelColor: '#062B23', font: 'Space Grotesk' }),
    ],
  }),

  // 7
  posterScene({
    id: 'sweat-session',
    label: 'Sweat Session',
    blurb: 'Fitness. Hard orange on black, no equipment promise',
    accent: '#FDBA74',
    boardName: 'Sweat Session',
    backgroundColor: '#0B0B0C',
    backgroundGradient: { color1: '#0B0B0C', color2: '#3A1206', angle: 150 },
    palette: { ink: '#FFFFFF', accent: '#FB923C', muted: '#F3C9AE', ...VOICE.poster, onDark: true },
    brand: 'TRAIN ANYWHERE',
    giant: 'NO GYM\nNEEDED',
    giantSize: 42,
    sub: 'Twenty minutes, a mat, and that is it',
    poster: SCREEN('app-player-dark'),
    frameColor: '#0C0C0E',
    ctaLabel: 'Start week one',
    ctaFill: '#F97316',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(249,115,22,0.45)',
    decor: [
      wash('wash-orange', 430, 320, 620, '#F97316', 0.42, 0),
      svgShape({ id: 'bolt', name: 'Bolt left', x: 68, y: 396, size: 96, path: BOLT_PATH, fill: '#FB923C', animation: enters('pop', 1, 0.5) }),
      svgShape({ id: 'bolt-b', name: 'Bolt right', x: 742, y: 300, size: 62, path: BOLT_PATH, fill: '#FDBA74', rotation: 18, animation: enters('pop', 1.25, 0.5) }),
    ],
  }),

  // 8
  classicScene({
    id: 'calm-hour',
    label: 'Calm Hour',
    blurb: 'Meditation and sleep. Soft sage, slow fades, quiet type',
    accent: '#4B7F6B',
    boardName: 'Calm Hour',
    backgroundColor: '#EFF6F1',
    backgroundGradient: { color1: '#F7FBF7', color2: '#CFE4D8', angle: 168 },
    palette: { ink: '#16302A', accent: '#4B7F6B', muted: '#5E7C71', ...VOICE.editorial, onDark: false },
    eyebrow: 'BEFORE THE DAY STARTS',
    headline: 'Ten quiet minutes\nthat actually stick',
    sub: 'Short sessions, no streak guilt, no talking',
    poster: SCREEN('app-player-eco'),
    frameColor: '#E8EFE9',
    ctaLabel: 'Start tonight',
    ctaFill: '#2F5E4E',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(47,94,78,0.35)',
    phoneEnter: 'fade',
    decor: [wash('wash-sage', 460, 1140, 620, '#8FCBAE', 0.5, 0, 170), wash('wash-mist', -120, 260, 480, '#BFD9E8', 0.45, 0.3, 170)],
    gestures: [tap('tap-1', 640, '#4B7F6B', 3, -130), swipe('swipe-1', 'swipe-up', 1140, '#4B7F6B', 7.4, 120)],
  }),

  // 9
  classicScene({
    id: 'night-feed',
    label: 'Night Feed',
    blurb: 'Social and chat. Deep purple with reactions popping over the phone',
    accent: '#F472B6',
    boardName: 'Night Feed',
    backgroundColor: '#140B2B',
    backgroundGradient: { color1: '#140B2B', color2: '#3B1D63', angle: 162 },
    palette: { ink: '#FFFFFF', accent: '#F472B6', muted: '#C3B3E8', ...VOICE.modern, onDark: true },
    eyebrow: 'STILL GOING AT 1AM',
    headline: 'The group chat\nthat never dies',
    sub: 'Photos, replies and running jokes in one thread',
    poster: SCREEN('app-chat-royal'),
    frameColor: '#170D2E',
    ctaLabel: 'Find your people',
    ctaFill: '#EC4899',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(236,72,153,0.45)',
    decor: [wash('wash-pink', 470, 200, 560, '#EC4899', 0.36, 0), wash('wash-indigo', -120, 1220, 560, '#6366F1', 0.4, 0.35)],
    overlay: [
      svgShape({ id: 'react-a', name: 'Reaction heart', x: 90, y: 880, size: 102, path: HEART_PATH, fill: '#F472B6', rotation: -12, animation: enters('pop', 3.2, 0.55) }),
      svgShape({ id: 'react-b', name: 'Reaction star', x: 700, y: 1180, size: 92, path: STAR_PATH, fill: '#FDE68A', rotation: 14, animation: enters('pop', 5.6, 0.55) }),
      svgShape({ id: 'react-c', name: 'Reaction sparkle', x: 704, y: 760, size: 72, path: SPARKLE_PATH, fill: '#A5B4FC', animation: enters('pop', 8.2, 0.55) }),
      svgShape({ id: 'react-d', name: 'Reaction heart small', x: 104, y: 1420, size: 66, path: HEART_PATH, fill: '#C4B5FD', rotation: 10, animation: enters('pop', 10.4, 0.55) }),
    ],
  }),

  // 10
  classicScene({
    id: 'order-up',
    label: 'Order Up',
    blurb: 'Food delivery. Warm cream and red with a live delivery time',
    accent: '#D6412F',
    boardName: 'Order Up',
    backgroundColor: '#FFF4EC',
    backgroundGradient: { color1: '#FFFAF5', color2: '#FFD9C4', angle: 162 },
    palette: { ink: '#2A1108', accent: '#D6412F', muted: '#8A5A47', ...VOICE.friendly, onDark: false },
    eyebrow: 'DELIVERING NOW',
    headline: 'Dinner lands in\n22 minutes',
    sub: 'Follow it from the kitchen to your door',
    poster: SCREEN('app-list-coral'),
    frameColor: '#2A1108',
    ctaLabel: 'Order in 2 taps',
    ctaFill: '#D6412F',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(214,65,47,0.4)',
    decor: [wash('wash-red', 500, 180, 500, '#FCA5A5', 0.5, 0), wash('wash-yellow', -120, 1320, 520, '#FCD34D', 0.5, 0.35)],
    overlay: chip({ key: 'chip-eta', label: 'Arriving 7:42pm', x: 200, y: CLASSIC_CARD_LANE_B, at: 4.2, from: 'slide-up', iconColor: '#D6412F', labelColor: '#2A1108', font: 'Poppins' }),
  }),

  // 11
  classicScene({
    id: 'trip-ready',
    label: 'Trip Ready',
    blurb: 'Travel. Sky gradient, every booking on one screen',
    accent: '#0E7490',
    boardName: 'Trip Ready',
    backgroundColor: '#EAF6FD',
    backgroundGradient: { color1: '#F6FCFF', color2: '#BEE3F8', angle: 165 },
    palette: { ink: '#0B2942', accent: '#0E7490', muted: '#4A6F8A', ...VOICE.modern, onDark: false },
    eyebrow: 'LISBON IN 3 DAYS',
    headline: 'Every booking\non one screen',
    sub: 'Flights, hotels and trains, offline as well',
    poster: SCREEN('app-list-sky'),
    frameColor: '#F2F2F4',
    ctaLabel: 'Plan a trip',
    ctaFill: '#0E7490',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(14,116,144,0.38)',
    decor: [wash('wash-sky', 460, 140, 560, '#7DD3FC', 0.5, 0), wash('wash-sand', -130, 1360, 520, '#FDE68A', 0.5, 0.35)],
    overlay: chip({ key: 'chip-gate', label: 'Gate B12 at 6:05', x: 200, y: CLASSIC_CARD_LANE_B, at: 4.6, from: 'slide-up', iconColor: '#0E7490', labelColor: '#0B2942', font: 'Outfit' }),
  }),

  // 12
  posterScene({
    id: 'beat-drop',
    label: 'Beat Drop',
    blurb: 'Music and podcasts. Near black with neon lime, big statement',
    accent: '#BEF264',
    boardName: 'Beat Drop',
    backgroundColor: '#08090B',
    backgroundGradient: { color1: '#08090B', color2: '#132015', angle: 150 },
    palette: { ink: '#FFFFFF', accent: '#BEF264', muted: '#B8C4A8', ...VOICE.poster, onDark: true },
    brand: 'NEW EVERY FRIDAY',
    giant: 'ON\nREPEAT',
    giantSize: 44,
    sub: 'The queue learns what you skip',
    poster: SCREEN('app-player-light'),
    frameColor: '#0B0C0E',
    ctaLabel: 'Listen free',
    ctaFill: '#BEF264',
    ctaLabelColor: '#111507',
    ctaGlow: 'rgba(190,242,100,0.35)',
    ctaOnDarkLabel: false,
    decor: [
      wash('wash-lime', 430, 300, 600, '#84CC16', 0.34, 0),
      svgShape({ id: 'play-mark', name: 'Play mark', x: 72, y: 414, size: 88, path: PLAY_PATH, fill: '#BEF264', animation: enters('pop', 1, 0.5) }),
      svgShape({ id: 'play-mark-b', name: 'Play mark small', x: 748, y: 306, size: 54, path: PLAY_PATH, fill: '#84CC16', animation: enters('pop', 1.25, 0.5) }),
    ],
  }),

  // 13
  proofScene({
    id: 'learn-streak',
    label: 'Learn Streak',
    blurb: 'Learning apps. A streak number that lands like a trophy',
    accent: '#84CC16',
    boardName: 'Learn Streak',
    backgroundColor: '#121233',
    backgroundGradient: { color1: '#0D0D28', color2: '#26265E', angle: 160 },
    palette: { ink: '#FFFFFF', accent: '#BEF264', muted: '#A9AEDD', ...VOICE.modern, onDark: true },
    hero: statBlock({
      key: 'streak',
      value: '127',
      label: 'DAY STREAK',
      y: 150,
      at: 0.5,
      valueColor: '#BEF264',
      labelColor: '#A9AEDD',
      headFont: 'Outfit',
      bodyFont: 'Outfit',
      onDark: true,
    }),
    heroBottom: 353,
    headline: 'Fifteen minutes\na day, that is it',
    caption: 'Short lessons that fit before the bus comes',
    poster: SCREEN('app-grid-dark'),
    frameColor: '#0F0F2A',
    overlay: (box) =>
      chip({ key: 'chip-badge', label: 'Level 12 unlocked', x: 200, y: box.bottom - 400, at: 5.2, from: 'slide-up', iconColor: '#4D7C0F', labelColor: '#121233', font: 'Outfit' }),
    ctaLabel: 'Start day one',
    ctaFill: '#84CC16',
    ctaLabelColor: '#121233',
    ctaGlow: 'rgba(132,204,22,0.4)',
    ctaOnDarkLabel: false,
    decor: [wash('wash-lime', 470, 1080, 560, '#84CC16', 0.32, 0), wash('wash-violet', -120, 200, 520, '#6366F1', 0.42, 0.3)],
  }),

  // 14
  {
    id: 'shop-drop',
    label: 'Shop Drop',
    blurb: 'Retail drops. Editorial black and white, phone on top, copy below',
    accent: '#111111',
    boardName: 'Shop Drop',
    backgroundColor: '#F4F4F2',
    backgroundGradient: { color1: '#FBFBFA', color2: '#E4E3DE', angle: 170 },
    elements: (() => {
      const p: Palette = { ink: '#111111', accent: '#8A8A82', muted: '#5C5C55', ...VOICE.editorial, onDark: false };
      const headline = 'Sold out in nine\nminutes last time';
      const sub = 'Get the drop alert an hour before it goes live';
      const headY = 1330;
      const subY = headY + textH(headline, SIZE_HEAD) + 24;
      return [
        wash('wash-stone', 470, 60, 520, '#C7C4BA', 0.5, 0),
        phone({ y: 96, poster: SCREEN('app-grid-light'), frameColor: '#141414', width: 560, at: 0.1 }),
        text({
          id: 'headline', name: 'Headline', content: headline, y: headY,
          fontSize: SIZE_HEAD, color: p.ink, fontFamily: p.head, textAlign: 'center',
          onDark: false, animation: enters('slide-up', 0.5, 0.8),
        }),
        text({
          id: 'subline', name: 'Subline', content: sub, y: subY,
          fontSize: SIZE_SUB, lineHeight: 1.25, color: p.muted, fontFamily: p.body,
          fontWeight: '400', textAlign: 'center', onDark: false,
          animation: enters('fade', 1, 0.7),
        }),
        tap('tap-1', 300, '#111111', 2.4, -140),
        swipe('swipe-1', 'swipe-up', 720, '#111111', 6.2, 140),
        ...cta({ y: 1700, label: 'Get early access', fill: '#111111', labelColor: '#FFFFFF', font: 'Bricolage Grotesque', glow: 'rgba(17,17,17,0.32)', at: 12.8 }),
      ];
    })(),
  },

  // 15
  classicScene({
    id: 'focus-block',
    label: 'Focus Block',
    blurb: 'Timers and deep work. Deep blue, one task at a time',
    accent: '#60A5FA',
    boardName: 'Focus Block',
    backgroundColor: '#0A1330',
    backgroundGradient: { color1: '#070E24', color2: '#152449', angle: 160 },
    palette: { ink: '#FFFFFF', accent: '#7DB4FF', muted: '#93A6CC', ...VOICE.tech, onDark: true },
    eyebrow: 'ONE TASK AT A TIME',
    headline: 'Twenty five minutes\nwith nothing else',
    sub: 'Notifications wait until the timer stops',
    poster: SCREEN('app-dashboard-royal'),
    frameColor: '#0B1430',
    ctaLabel: 'Start a block',
    ctaFill: '#2563EB',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(37,99,235,0.5)',
    decor: [wash('wash-blue', 440, 300, 600, '#3B82F6', 0.4, 0), wash('wash-teal', -120, 1220, 520, '#14B8A6', 0.3, 0.35)],
    overlay: chip({ key: 'chip-quiet', label: 'Notifications off', x: 200, y: CLASSIC_CARD_LANE_B, at: 4.2, from: 'slide-up', iconColor: '#2563EB', labelColor: '#0A1330', font: 'Space Grotesk' }),
  }),

  // 16
  classicScene({
    id: 'snap-fix',
    label: 'Snap Fix',
    blurb: 'Photo and video editors. Neutral dark, one slider does the work',
    accent: '#F5B841',
    boardName: 'Snap Fix',
    backgroundColor: '#111114',
    backgroundGradient: { color1: '#0C0C0F', color2: '#232329', angle: 158 },
    palette: { ink: '#FFFFFF', accent: '#F5B841', muted: '#A5A5B0', ...VOICE.tech, onDark: true },
    eyebrow: 'ONE SLIDER',
    headline: 'Fix the light,\nkeep the moment',
    sub: 'What used to take five sliders takes one',
    poster: SCREEN('app-grid-royal'),
    frameColor: '#0E0E11',
    ctaLabel: 'Edit a photo',
    ctaFill: '#F5B841',
    ctaLabelColor: '#1A1A1F',
    ctaGlow: 'rgba(245,184,65,0.35)',
    ctaOnDarkLabel: false,
    decor: [wash('wash-amber', 460, 1180, 560, '#F5B841', 0.3, 0), wash('wash-cool', -110, 260, 500, '#60A5FA', 0.28, 0.3)],
    overlay: [
      ...chip({ key: 'chip-a', label: 'Skin stays real', x: CARD_X_LEFT, y: CLASSIC_CARD_LANE_A, at: 2.4, from: 'slide-right', iconColor: '#B45309', fill: '#FFFFFF', labelColor: '#111114', font: 'Space Grotesk' }),
      ...chip({ key: 'chip-b', label: 'Exports instantly', x: CARD_X_RIGHT, y: CLASSIC_CARD_LANE_B, at: 6, from: 'slide-left', iconColor: '#2563EB', fill: '#FFFFFF', labelColor: '#111114', font: 'Space Grotesk' }),
    ],
  }),

  // 17
  classicScene({
    id: 'team-sync',
    label: 'Team Sync',
    blurb: 'Team tools. Calm blue, nobody has to ask what changed',
    accent: '#2563EB',
    boardName: 'Team Sync',
    backgroundColor: '#F1F5FE',
    backgroundGradient: { color1: '#FFFFFF', color2: '#D9E5FC', angle: 164 },
    palette: { ink: '#0E1B36', accent: '#2563EB', muted: '#55648A', ...VOICE.modern, onDark: false },
    eyebrow: 'FOR SMALL TEAMS',
    headline: 'Nobody has to ask\nwhat changed',
    sub: 'Every edit, who made it, and when',
    poster: SCREEN('app-chat-light'),
    frameColor: '#F2F2F4',
    ctaLabel: 'Invite your team',
    ctaFill: '#2563EB',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(37,99,235,0.36)',
    decor: [wash('wash-blue', 480, 160, 520, '#93C5FD', 0.5, 0), wash('wash-mint', -130, 1330, 520, '#6EE7B7', 0.42, 0.35)],
    overlay: [
      rect({ id: 'crew-card', name: 'Who is here card', x: 200, y: CLASSIC_CARD_LANE_A, width: 486, height: 120, fill: '#FFFFFF', radius: 60, shadow: { x: 0, y: 16, blur: 40, color: 'rgba(14,27,54,0.2)' }, animation: enters('slide-up', 3.2, 0.6) }),
      circle({ id: 'avatar-a', name: 'Teammate 1', x: 240, y: CLASSIC_CARD_LANE_A + 26, size: 68, fill: '#2563EB', animation: enters('pop', 3.4, 0.5) }),
      circle({ id: 'avatar-b', name: 'Teammate 2', x: 296, y: CLASSIC_CARD_LANE_A + 26, size: 68, fill: '#7C3AED', animation: enters('pop', 3.55, 0.5) }),
      circle({ id: 'avatar-c', name: 'Teammate 3', x: 352, y: CLASSIC_CARD_LANE_A + 26, size: 68, fill: '#0D9488', animation: enters('pop', 3.7, 0.5) }),
      circle({ id: 'avatar-d', name: 'Teammate 4', x: 408, y: CLASSIC_CARD_LANE_A + 26, size: 68, fill: '#EA580C', animation: enters('pop', 3.85, 0.5) }),
      text({ id: 'crew-label', name: 'Who is here label', content: '4 here now', x: 486, y: CLASSIC_CARD_LANE_A + 34, width: 176, fontSize: SIZE_CHIP, lineHeight: 1.15, color: '#0E1B36', fontFamily: 'Outfit', fontWeight: '600', onDark: false, animation: enters('fade', 3.9, 0.5) }),
      ...chip({ key: 'chip-edit', label: 'Ana edited 4m ago', x: 200, y: CLASSIC_CARD_LANE_B, at: 4.6, from: 'slide-up', iconColor: '#2563EB', labelColor: '#0E1B36', font: 'Outfit' }),
    ],
  }),

  // 18
  proofScene({
    id: 'health-check',
    label: 'Health Check',
    blurb: 'Health and vitals. Clinical white with one number that matters',
    accent: '#E11D48',
    boardName: 'Health Check',
    backgroundColor: '#FBFBFC',
    backgroundGradient: { color1: '#FFFFFF', color2: '#F0F2F6', angle: 170 },
    palette: { ink: '#0F1626', accent: '#E11D48', muted: '#5C6579', ...VOICE.tech, onDark: false },
    hero: [
      svgShape({ id: 'pulse', name: 'Pulse mark', x: 403, y: 128, size: 80, path: HEART_PATH, fill: '#E11D48', animation: enters('pop', 0.4, 0.5) }),
      ...statBlock({
        key: 'bpm',
        value: '72',
        label: 'RESTING BPM, DOWN 6',
        y: 226,
        at: 0.7,
        valueColor: '#0F1626',
        labelColor: '#5C6579',
        headFont: 'Space Grotesk',
        bodyFont: 'Space Grotesk',
        onDark: false,
      }),
    ],
    heroBottom: 424,
    headline: 'Your numbers,\nwithout the panic',
    poster: SCREEN('app-dashboard-light'),
    frameColor: '#F2F2F4',
    overlay: (box) =>
      chip({ key: 'chip-sleep', label: 'Slept 7h 20m', x: 200, y: box.bottom - 400, at: 5, from: 'slide-up', iconColor: '#E11D48', labelColor: '#0F1626', font: 'Space Grotesk' }),
    ctaLabel: 'See your week',
    ctaFill: '#0F1626',
    ctaLabelColor: '#FFFFFF',
    ctaGlow: 'rgba(15,22,38,0.32)',
    decor: [wash('wash-rose', 520, 940, 480, '#FDA4AF', 0.4, 0), wash('wash-slate', -120, 200, 460, '#C7D2FE', 0.42, 0.3)],
  }),

  // 19
  posterScene({
    id: 'play-now',
    label: 'Play Now',
    blurb: 'Games. Arcade purple and cyan, the one more round hook',
    accent: '#22D3EE',
    boardName: 'Play Now',
    backgroundColor: '#1A0B3B',
    backgroundGradient: { color1: '#1A0B3B', color2: '#0B4C6B', angle: 152 },
    palette: { ink: '#FFFFFF', accent: '#67E8F9', muted: '#B9D9F0', ...VOICE.poster, onDark: true },
    brand: 'FREE TO PLAY',
    giant: 'ONE\nMORE',
    giantSize: 46,
    sub: 'Rounds last two minutes, then another',
    poster: SCREEN('app-grid-sky'),
    frameColor: '#150932',
    ctaLabel: 'Play a round',
    ctaFill: '#22D3EE',
    ctaLabelColor: '#08252F',
    ctaGlow: 'rgba(34,211,238,0.45)',
    ctaOnDarkLabel: false,
    decor: [
      wash('wash-cyan', 440, 360, 620, '#22D3EE', 0.35, 0),
      svgShape({ id: 'sparkle-a', name: 'Sparkle left', x: 66, y: 372, size: 92, path: SPARKLE_PATH, fill: '#A855F7', animation: enters('pop', 0.9, 0.55) }),
      svgShape({ id: 'star-a', name: 'Star right', x: 736, y: 498, size: 78, path: STAR_PATH, fill: '#FDE68A', animation: enters('pop', 1.2, 0.5) }),
      svgShape({ id: 'sparkle-b', name: 'Sparkle top right', x: 748, y: 232, size: 52, path: SPARKLE_PATH, fill: '#67E8F9', animation: enters('pop', 1.45, 0.5) }),
    ],
  }),

  // 20
  classicScene({
    id: 'home-control',
    label: 'Home Control',
    blurb: 'Smart home. Dusk gradient, everything off in one tap',
    accent: '#FBBF24',
    boardName: 'Home Control',
    backgroundColor: '#111A2E',
    backgroundGradient: { color1: '#0B1220', color2: '#3B2C4F', angle: 158 },
    palette: { ink: '#FFFFFF', accent: '#FBBF24', muted: '#A7B3CC', ...VOICE.friendly, onDark: true },
    eyebrow: 'GOOD NIGHT SCENE',
    headline: 'Everything off,\none tap',
    sub: 'Lights, locks and heating on a single screen',
    poster: SCREEN('app-grid-forest'),
    frameColor: '#0E1626',
    ctaLabel: 'Set it up',
    ctaFill: '#FBBF24',
    ctaLabelColor: '#111A2E',
    ctaGlow: 'rgba(251,191,36,0.35)',
    ctaOnDarkLabel: false,
    decor: [wash('wash-amber', 480, 1120, 560, '#FBBF24', 0.3, 0), wash('wash-indigo', -120, 220, 540, '#818CF8', 0.4, 0.3)],
    overlay: chip({ key: 'chip-night', label: '14 devices off', x: 200, y: CLASSIC_CARD_LANE_B, at: 4.8, from: 'slide-up', iconColor: '#B45309', labelColor: '#111A2E', font: 'Poppins' }),
  }),
];

/**
 * Search terms per scene, kept in one table rather than threaded through the
 * three grid helpers and twenty call sites. A missing entry is a scene nobody
 * can find by category, so the map is asserted complete below.
 */
const SCENE_KEYWORDS: Record<string, string> = {
  'spotlight-launch': 'launch release update hero dark cinematic premium saas productivity generic any app',
  'feature-rush': 'features benefits list bright light productivity utility tools generic any app',
  'headline-punch': 'bold statement gradient vivid loud attention generic any app brand',
  'five-star-proof': 'reviews rating stars testimonial social proof trust downloads popular',
  'three-taps': 'onboarding how it works steps tutorial setup simple guide',
  'money-mode': 'finance banking budget money spending wallet expenses bank fintech invest crypto savings',
  'sweat-session': 'fitness workout gym exercise health training sport run yoga strength',
  'calm-hour': 'meditation sleep calm wellness mindfulness relax breathe quiet mental health',
  'night-feed': 'social chat messaging community friends group feed dating forum',
  'order-up': 'food delivery restaurant takeaway grocery ordering meal kitchen courier',
  'trip-ready': 'travel flights hotels trip booking holiday vacation itinerary transport',
  'beat-drop': 'music audio podcast streaming radio playlist songs listening',
  'learn-streak': 'learning education language course study school streak lessons kids quiz',
  'shop-drop': 'shopping ecommerce retail store fashion drops sneakers marketplace commerce',
  'focus-block': 'focus timer pomodoro deep work productivity tasks concentration notes',
  'snap-fix': 'photo video editor camera filters editing images creative design art',
  'team-sync': 'team collaboration work business project management workspace office sync',
  'health-check': 'health medical vitals heart sleep tracking symptoms doctor wellbeing',
  'play-now': 'games gaming arcade puzzle casual play levels entertainment fun',
  'home-control': 'smart home iot devices lights security automation thermostat control',
};

export const PREVIEW_SCENES: PreviewSceneDef[] = PREVIEW_SCENE_LIST.map((scene) => ({
  ...scene,
  keywords: SCENE_KEYWORDS[scene.id] ?? '',
}));

export function findPreviewScene(sceneId: string): PreviewSceneDef | undefined {
  return PREVIEW_SCENES.find((scene) => scene.id === sceneId);
}

// ---------------------------------------------------------------------------
// Fitting a scene onto the project's own board size
// ---------------------------------------------------------------------------

const SCENE_ASPECT = PREVIEW_SCENE_SIZE.width / PREVIEW_SCENE_SIZE.height;

/**
 * How far a board's proportions may stray from the scene's and still host it.
 * 0.25 covers every portrait phone canvas in the app (1290x2796 is a 0.02%
 * drift, 1080x1920 a 22% one) and excludes the shapes a portrait phone layout
 * has no business being poured into: watch, Mac, feature graphic.
 */
const ASPECT_TOLERANCE = 0.25;

/**
 * The size a dropped scene should take.
 *
 * Matching the boards already on the canvas is the point: a project whose
 * boards are 1290x2796 should not suddenly grow one 886x1920 board next to
 * them. It is safe because the two are the same shape, and because the video
 * export renders to Apple's 886x1920 regardless of what the board measures
 * (`sizeMode: 'appstore-portrait'`, the dialog's default). A board of a
 * genuinely different shape (a watch face, a Mac window, a feature banner)
 * cannot host a portrait phone layout, so those fall back to the store size.
 */
export function previewSceneSizeFor(target?: Size | null): Size {
  if (!target || !(target.width > 0) || !(target.height > 0)) return { ...PREVIEW_SCENE_SIZE };
  const drift = Math.abs(target.width / target.height / SCENE_ASPECT - 1);
  return drift <= ASPECT_TOLERANCE ? { width: target.width, height: target.height } : { ...PREVIEW_SCENE_SIZE };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Scale one authored element into a board of a different size.
 *
 * Everything measured in artboard pixels moves; everything that is a ratio
 * stays. `lineHeight` is always a multiplier in this file (never a pixel
 * value), `scale` is a multiplier, `innerRadius` is a percentage and animation
 * timings are seconds, so all four are left alone on purpose.
 */
function scaleSceneElement(element: ArtboardElement, k: number, ox: number, oy: number): ArtboardElement {
  const next: any = { ...element };
  next.position = { x: round2(element.position.x * k + ox), y: round2(element.position.y * k + oy) };
  next.size = { width: round2(element.size.width * k), height: round2(element.size.height * k) };
  if (element.shadow) {
    next.shadow = {
      ...element.shadow,
      x: round2(element.shadow.x * k),
      y: round2(element.shadow.y * k),
      blur: round2(element.shadow.blur * k),
    };
  }
  if (typeof element.blur === 'number') next.blur = round2(element.blur * k);
  if (element.type === 'text') {
    next.fontSize = round2(element.fontSize * k);
    if (typeof element.letterSpacing === 'number') next.letterSpacing = round2(element.letterSpacing * k);
  }
  if (element.type === 'shape') {
    if (typeof element.borderRadius === 'number') next.borderRadius = round2(element.borderRadius * k);
    if (typeof element.strokeWidth === 'number') next.strokeWidth = round2(element.strokeWidth * k);
  }
  return next as ArtboardElement;
}

/**
 * Everything that makes a board this scene rather than a blank one, as a patch
 * over the default new artboard.
 *
 * Deliberately NOT a whole `ArtboardState`: `id` and `position` belong to the
 * layout's one artboard-creation path (the same one the toolbar's "+" uses), so
 * minting them here would be a second, divergent way to make a board. Nothing
 * in this module knows about the canvas.
 *
 * Element ids ARE minted here, the way Duplicate Artboard does it: two copies of
 * one scene on the same canvas must not share ids, or one edit would patch both
 * boards and a locale override would point at two elements.
 *
 * `targetSize` is the size of the board the drop landed next to. Pass it and
 * the scene arrives at the project's own size; leave it out and it arrives at
 * Apple's.
 */
export function buildPreviewScenePreset(
  sceneId: string,
  targetSize?: Size | null
): Partial<ArtboardState> | null {
  const scene = findPreviewScene(sceneId);
  if (!scene) return null;

  const size = previewSceneSizeFor(targetSize);
  // Uniform, so nothing is ever stretched; centred, so a board that is not
  // quite the same shape gets the scene in the middle rather than up a corner.
  const k = Math.min(size.width / PREVIEW_SCENE_SIZE.width, size.height / PREVIEW_SCENE_SIZE.height);
  const ox = (size.width - PREVIEW_SCENE_SIZE.width * k) / 2;
  const oy = (size.height - PREVIEW_SCENE_SIZE.height * k) / 2;
  const identity = k === 1 && ox === 0 && oy === 0;

  const stamp = Date.now();
  const salt = Math.random().toString(36).slice(2, 7);
  const elements = scene.elements.map((element, index) => {
    const copy = JSON.parse(JSON.stringify(element)) as ArtboardElement;
    const fitted = identity ? copy : scaleSceneElement(copy, k, ox, oy);
    return { ...fitted, id: `el_${stamp}_${index}_${salt}` } as ArtboardElement;
  });

  return {
    name: scene.boardName,
    size,
    elements,
    backgroundColor: scene.backgroundColor,
    backgroundType: scene.backgroundGradient ? 'gradient' : 'solid',
    backgroundGradient: scene.backgroundGradient ? { ...scene.backgroundGradient } : undefined,
    previewDurationSeconds: PREVIEW_SCENE_DURATION,
  };
}
