// The words over a film: the title, the captions, the app's icon at the top
// and the end card, drawn on a 2D canvas over the 3D picture. The preview and
// the export call the same function, so the file shows what the screen showed.
//
// Three looks for the words:
//  - Soft: at the top, rising in one word after another; the last word (or
//    the words between *stars*) in the backdrop's colour.
//  - Headline: big and set to the left, line by line, in one warm colour on
//    a dark backdrop; words between *stars* take the highlight.
//  - Bold captions: capitals at the bottom with a dark outline, popping in
//    one word after another; the last word (or the starred ones) in yellow.
//
// The end card shows the app's icon, its name, the end words and the store
// badges. The badges are Apple's and Google's own files, drawn as they come
// and never animated: they appear at once, in full, App Store first, with a
// quarter of their height clear around them.

import { cubicBezier, CARD_SECONDS, hasCard } from './plan';
import { wordsSide } from './frame';
import { luminance, mixRgb, parseColor, toHex, type Backdrop, type Rgb } from './looks';
import type { CaptionCue, FilmFormat, FilmText, WordsStyle } from './types';

export const OVERLAY_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const rise = cubicBezier(0.2, 0, 0, 1);
const WORD_STAGGER = 0.07;
const WORD_IN = 0.5;
const OUT = 0.32;

/** Pictures the overlay draws: decoded before the export starts, and as they come in the preview. */
export interface OverlayAssets {
  icon: CanvasImageSource | null;
  appStore: CanvasImageSource | null;
  googlePlay: CanvasImageSource | null;
}

/** Google's badge file has clear space round it: the badge itself is this box of the 646 x 250 picture. */
const GOOGLE_BOX = { x: 41, y: 41, w: 564, h: 168, fileW: 646, fileH: 250 };
/** Apple's badge, 119.66 x 40 in its own units. */
const APPLE_ASPECT = 119.66407 / 40;

export interface MarkedWord {
  word: string;
  /** Between *stars*: drawn in the highlight. */
  mark: boolean;
}

/**
 * The words of a line of text, with the ones between *stars* marked. A star
 * opens or closes the highlight wherever it is in a word; the stars are
 * never drawn. "Track *every* habit" marks "every"; "*Two words*" marks both.
 */
export function markedWords(text: string): MarkedWord[] {
  const out: MarkedWord[] = [];
  let inside = false;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const stars = (raw.match(/\*/g) ?? []).length;
    const word = raw.replace(/\*/g, '');
    const mark = inside || stars > 0;
    if (stars % 2 === 1) inside = !inside;
    if (word) out.push({ word, mark });
  }
  return out;
}

/** The words as drawn: starred ones highlighted, or with no stars the last word, where the style does that. */
export function highlighted(text: string, style: WordsStyle): MarkedWord[] {
  const words = markedWords(text);
  if (words.some((w) => w.mark) || style === 'headline' || words.length < 2) return words;
  return words.map((w, i) => ({ ...w, mark: i === words.length - 1 }));
}

/** The text without its stars, as a person reads it: for the timeline and labels. */
export function plainWords(text: string): string {
  return markedWords(text)
    .map((w) => w.word)
    .join(' ');
}

interface Line {
  words: { word: string; mark: boolean; width: number }[];
  width: number;
}

function wrap(ctx: CanvasRenderingContext2D, words: MarkedWord[], maxWidth: number): Line[] {
  const space = ctx.measureText(' ').width;
  const lines: Line[] = [];
  let current: Line = { words: [], width: 0 };
  for (const { word, mark } of words) {
    const w = ctx.measureText(word).width;
    if (current.words.length && current.width + space + w > maxWidth) {
      lines.push(current);
      current = { words: [], width: 0 };
    }
    current.width = current.words.length ? current.width + space + w : w;
    current.words.push({ word, mark, width: w });
  }
  if (current.words.length) lines.push(current);
  return lines;
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = value;
}

/** WCAG contrast between two colours, 1 to 21. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The words' colour and the highlight's. The highlight is the first of the
 * backdrop's glows, lightened or darkened step by step, that reads at 4.5 to
 * 1 against the top of the backdrop, where the words sit; failing that, the
 * words' own colour.
 */
export function inks(backdrop: Backdrop): { ink: string; highlight: string; shade: string } {
  const ground = parseColor(backdrop.top) ?? (backdrop.dark ? [0, 0, 0] : [1, 1, 1]);
  const toward: Rgb = backdrop.dark ? [1, 1, 1] : [0, 0, 0];
  // The fainter glow first: it is usually the backdrop's accent, the brighter one its main colour.
  const glows = [...backdrop.glows].sort((a, b) => a.strength - b.strength);
  for (const glow of glows) {
    const rgb = parseColor(glow.color);
    if (!rgb) continue;
    for (let mix = 0; mix <= 0.6; mix += 0.1) {
      const candidate = mixRgb(rgb, toward, mix);
      if (contrast(candidate, ground) >= 4.5) {
        return { ink: backdrop.dark ? '#ffffff' : '#121216', highlight: toHex(candidate), shade: backdrop.dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.6)' };
      }
    }
  }
  const ink = backdrop.dark ? '#ffffff' : '#121216';
  return { ink, highlight: ink, shade: backdrop.dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.6)' };
}

/** The warm cream of a launch film's headline on a dark backdrop. */
const HEADLINE_CREAM = '#eed9ac';
/** The yellow of bold captions' highlight. */
const CAPTION_YELLOW = '#ffd319';

/** The colours a style draws in, before the user's own. */
export function wordColors(style: WordsStyle, backdrop: Backdrop, text: Pick<FilmText, 'ink' | 'accent'>): { ink: string; highlight: string } {
  const base = inks(backdrop);
  const own = { ink: parseColor(text.ink) ? text.ink! : null, highlight: parseColor(text.accent) ? text.accent! : null };
  if (style === 'headline') {
    return { ink: own.ink ?? (backdrop.dark ? HEADLINE_CREAM : '#16130f'), highlight: own.highlight ?? (backdrop.dark ? '#ffffff' : base.highlight) };
  }
  if (style === 'punchy') return { ink: own.ink ?? '#ffffff', highlight: own.highlight ?? CAPTION_YELLOW };
  return { ink: own.ink ?? base.ink, highlight: own.highlight ?? base.highlight };
}

/** A spring past 1 and back: a pop. */
function backOut(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
}

function smooth(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

/** The size the overlay measures from: the height of a wide picture, the width of a tall one. */
function baseOf(width: number, height: number, format: FilmFormat): number {
  return wordsSide(format) === 'left' ? height : Math.min(width, height * 0.5625);
}

/** The icon at the top while the film plays: in the top left corner, clear of the phone in a wide shot, so the words can make room under it. */
function logoBox(width: number, height: number, format: FilmFormat): { x: number; y: number; size: number } {
  const base = baseOf(width, height, format);
  const size = Math.round(base * (format === 'landscape' ? 0.085 : 0.1));
  const margin = Math.round(base * 0.06);
  return { x: margin, y: Math.round(format === 'vertical' ? height * 0.045 : margin), size };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The app's icon in its rounded square, with a soft shadow under it. */
function drawIcon(ctx: CanvasRenderingContext2D, icon: CanvasImageSource, x: number, y: number, size: number, shadow: string | null) {
  const r = size * 0.225;
  ctx.save();
  if (shadow) {
    ctx.shadowColor = shadow;
    ctx.shadowBlur = size * 0.22;
    ctx.shadowOffsetY = size * 0.06;
    roundedRect(ctx, x, y, size, size, r);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  roundedRect(ctx, x, y, size, size, r);
  ctx.clip();
  ctx.drawImage(icon, x, y, size, size);
  ctx.restore();
}

function drawSoft(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, cue: CaptionCue, format: FilmFormat, colors: { ink: string; highlight: string }, shade: string, top0: number) {
  const side = wordsSide(format);
  const base = baseOf(width, height, format);
  const size = Math.round(base * (cue.role === 'caption' ? 0.074 : cue.role === 'title' ? 0.1 : 0.088));
  const weight = cue.role === 'caption' ? 700 : 800;
  ctx.font = `${weight} ${size}px ${OVERLAY_FONT}`;
  setLetterSpacing(ctx, `${Math.round(-size * 0.02)}px`);
  ctx.textBaseline = 'alphabetic';
  const maxWidth = side === 'left' ? width * 0.36 : width * 0.84;
  const words = highlighted(cue.text, 'soft');
  let lines = wrap(ctx, words, maxWidth);
  let lineSize = size;
  // Too many lines: smaller words, never cut off.
  while (lines.length > 3 && lineSize > size * 0.6) {
    lineSize = Math.round(lineSize * 0.9);
    ctx.font = `${weight} ${lineSize}px ${OVERLAY_FONT}`;
    lines = wrap(ctx, words, maxWidth);
  }
  const leading = lineSize * 1.12;
  const blockH = leading * (lines.length - 1) + lineSize;
  const top = side === 'left' ? height / 2 - blockH / 2 + lineSize * 0.85 : Math.max(top0, height * (cue.role === 'caption' ? 0.085 : 0.095)) + lineSize * 0.85;
  const out = Math.min(1, Math.max(0, (cue.end - t) / OUT));
  const space = ctx.measureText(' ').width;
  ctx.shadowColor = shade;
  ctx.shadowBlur = lineSize * 0.35;
  ctx.shadowOffsetY = lineSize * 0.04;
  let index = 0;
  lines.forEach((line, row) => {
    let x = side === 'left' ? width * 0.07 : width / 2 - line.width / 2;
    const y = top + row * leading;
    for (const word of line.words) {
      const appear = rise(Math.min(1, Math.max(0, (t - cue.start - index * WORD_STAGGER) / WORD_IN)));
      const alpha = appear * out;
      if (alpha > 0.002) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = word.mark ? colors.highlight : colors.ink;
        ctx.fillText(word.word, x, y + (1 - appear) * lineSize * 0.42 - (1 - out) * lineSize * 0.15);
      }
      x += word.width + space;
      index += 1;
    }
  });
}

function drawHeadline(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, cue: CaptionCue, format: FilmFormat, colors: { ink: string; highlight: string }, dark: boolean, top0: number) {
  const side = wordsSide(format);
  const base = baseOf(width, height, format);
  const size = Math.round(base * (cue.role === 'title' ? 0.112 : cue.role === 'end' ? 0.098 : 0.09));
  ctx.font = `800 ${size}px ${OVERLAY_FONT}`;
  setLetterSpacing(ctx, `${Math.round(-size * 0.035)}px`);
  ctx.textBaseline = 'alphabetic';
  const maxWidth = side === 'left' ? width * 0.38 : width * 0.85;
  const words = highlighted(cue.text, 'headline');
  let lines = wrap(ctx, words, maxWidth);
  let lineSize = size;
  while (lines.length > 3 && lineSize > size * 0.6) {
    lineSize = Math.round(lineSize * 0.9);
    ctx.font = `800 ${lineSize}px ${OVERLAY_FONT}`;
    lines = wrap(ctx, words, maxWidth);
  }
  const leading = lineSize * 1.02;
  const blockH = leading * (lines.length - 1) + lineSize;
  const left = width * (side === 'left' ? 0.07 : 0.075);
  const top = side === 'left' ? height / 2 - blockH / 2 + lineSize * 0.82 : Math.max(top0, height * 0.075) + lineSize * 0.82;
  const out = Math.min(1, Math.max(0, (cue.end - t) / OUT));
  const space = ctx.measureText(' ').width;
  if (dark && side !== 'left') {
    // A soft dark shade from the top down past the words: nothing on black,
    // and the words still read when a close-up puts the bright screen behind them.
    const present = rise(Math.min(1, Math.max(0, (t - cue.start) / 0.5))) * out;
    const bottom = top + leading * (lines.length - 1) + lineSize * 0.9;
    const shade = ctx.createLinearGradient(0, 0, 0, bottom);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
    shade.addColorStop(0.72, 'rgba(0, 0, 0, 0.42)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = present;
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, bottom);
  }
  if (!dark) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
    ctx.shadowBlur = lineSize * 0.3;
  }
  lines.forEach((line, row) => {
    // Line by line, each rising a little as it fades in.
    const appear = rise(Math.min(1, Math.max(0, (t - cue.start - row * 0.12) / 0.55)));
    const alpha = appear * out;
    if (alpha <= 0.002) return;
    ctx.globalAlpha = alpha;
    let x = left;
    const y = top + row * leading + (1 - appear) * lineSize * 0.3;
    for (const word of line.words) {
      ctx.fillStyle = word.mark ? colors.highlight : colors.ink;
      ctx.fillText(word.word, x, y);
      x += word.width + space;
    }
  });
}

function drawPunchy(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, cue: CaptionCue, format: FilmFormat, colors: { ink: string; highlight: string }) {
  const side = wordsSide(format, { style: 'punchy' });
  const base = baseOf(width, height, format);
  const size = Math.round(base * (cue.role === 'title' ? 0.088 : cue.role === 'end' ? 0.082 : 0.076));
  ctx.font = `900 ${size}px ${OVERLAY_FONT}`;
  setLetterSpacing(ctx, `${Math.round(size * 0.01)}px`);
  ctx.textBaseline = 'alphabetic';
  const maxWidth = side === 'left' ? width * 0.38 : width * 0.86;
  const words = highlighted(cue.text, 'punchy').map((w) => ({ ...w, word: w.word.toLocaleUpperCase() }));
  let lines = wrap(ctx, words, maxWidth);
  let lineSize = size;
  while (lines.length > 2 && lineSize > size * 0.6) {
    lineSize = Math.round(lineSize * 0.9);
    ctx.font = `900 ${lineSize}px ${OVERLAY_FONT}`;
    lines = wrap(ctx, words, maxWidth);
  }
  const leading = lineSize * 1.1;
  const blockH = leading * (lines.length - 1) + lineSize;
  // At the bottom, above where Reels, TikTok and Shorts put their own buttons and words.
  const bottom = side === 'left' ? height / 2 + blockH / 2 : height * (format === 'vertical' ? 0.79 : 0.88);
  const top = bottom - blockH + lineSize * 0.82;
  const out = Math.min(1, Math.max(0, (cue.end - t) / OUT));
  const space = ctx.measureText(' ').width;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  let index = 0;
  lines.forEach((line, row) => {
    let x = side === 'left' ? width * 0.07 : width / 2 - line.width / 2;
    const y = top + row * leading;
    for (const word of line.words) {
      // Each word pops in: a little past full size, then back.
      const k = (t - cue.start - index * 0.055) / 0.26;
      const alpha = Math.min(1, Math.max(0, k * 3)) * out;
      if (alpha > 0.002) {
        const scale = 0.55 + 0.45 * backOut(k);
        const cx = x + word.width / 2;
        const cy = y - lineSize * 0.35;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = lineSize * 0.14;
        ctx.shadowOffsetY = lineSize * 0.06;
        ctx.lineWidth = lineSize * 0.15;
        ctx.strokeStyle = 'rgba(14, 10, 24, 0.92)';
        ctx.strokeText(word.word, -word.width / 2, lineSize * 0.35);
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = word.mark ? colors.highlight : colors.ink;
        ctx.fillText(word.word, -word.width / 2, lineSize * 0.35);
        ctx.restore();
      }
      x += word.width + space;
      index += 1;
    }
  });
}

/** The icon at the top while the film plays, popping in, with rings going out from it in a wide shot. */
function drawLogo(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, duration: number, format: FilmFormat, icon: CanvasImageSource, ring: string, cardAt: number | null, zoom: number) {
  const box = logoBox(width, height, format);
  const until = cardAt ?? duration;
  const show = backOut((t - 0.25) / 0.45);
  const leave = cardAt === null ? 1 : 1 - smooth((t - (until - 0.3)) / 0.3);
  if (show <= 0 || leave <= 0) return;
  const cx = box.x + box.size / 2;
  const cy = box.y + box.size / 2;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, (t - 0.25) / 0.15)) * leave;
  // Two rings, each going out and fading over 1.8 seconds, half a beat apart;
  // gone in a close-up, where they'd run over the screen.
  const wideShot = 1 - smooth((zoom - 1.15) / 0.35);
  ctx.strokeStyle = ring;
  for (let i = 0; i < 2; i++) {
    const phase = (((t - 0.5) / 1.8 + i * 0.5) % 1 + 1) % 1;
    if (t < 0.5 + i * 0.9 || wideShot <= 0) continue;
    ctx.lineWidth = box.size * 0.045 * (1 - phase * 0.6);
    ctx.globalAlpha = 0.5 * (1 - phase) * leave * wideShot;
    ctx.beginPath();
    ctx.arc(cx, cy, (box.size / 2) * (1.05 + 0.75 * phase), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = Math.min(1, Math.max(0, (t - 0.25) / 0.15)) * leave;
  const size = box.size * show;
  drawIcon(ctx, icon, cx - size / 2, cy - size / 2, size, 'rgba(0, 0, 0, 0.28)');
  ctx.restore();
}

/** The end card: the icon, the app's name, the end words and the badges, on white or over the film. */
function drawCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number,
  duration: number,
  format: FilmFormat,
  text: FilmText,
  backdrop: Backdrop,
  assets: OverlayAssets | null | undefined
) {
  const card = text.card!;
  const from = duration - CARD_SECONDS;
  const u = t - from;
  if (u < 0) return;
  const base = baseOf(width, height, format);
  const light = card.light;
  if (light) {
    ctx.save();
    ctx.globalAlpha = smooth(u / 0.4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
  // Dark on the white card; over the film, the backdrop's own ink, whatever the words' style.
  const own = parseColor(text.ink) ? text.ink! : null;
  const ink = light ? '#111214' : own ?? inks(backdrop).ink;
  const soft = light ? '#5b5f67' : ink;
  const name = (card.name.trim() || plainWords(text.title)).trim();
  const tagline = plainWords(text.end);
  const icon = assets?.icon ?? null;
  const iconSize = Math.round(base * (icon ? 0.3 : 0));
  const nameSize = Math.round(base * (icon ? 0.088 : 0.11));
  const tagSize = Math.round(base * 0.05);
  const badgeH = Math.round(base * 0.092);
  const badges: { image: CanvasImageSource; google: boolean }[] = [];
  if (card.appStore && assets?.appStore) badges.push({ image: assets.appStore, google: false });
  if (card.googlePlay && assets?.googlePlay) badges.push({ image: assets.googlePlay, google: true });
  const gap = base * 0.035;
  const blockH = (iconSize ? iconSize + gap * 1.2 : 0) + (name ? nameSize * 1.15 : 0) + (tagline ? tagSize * 1.6 : 0) + (badges.length ? gap * 1.3 + badgeH : 0);
  // On white the card sits in the middle; over the film, in the top half, above the phone.
  const landscape = format === 'landscape';
  let y = light ? height / 2 - blockH / 2 - height * 0.02 : landscape ? height / 2 - blockH / 2 : height * 0.07;
  const cx = landscape && !light ? width * 0.27 : width / 2;

  if (icon && iconSize) {
    const pop = backOut((u - 0.2) / 0.42);
    if (pop > 0) {
      const size = iconSize * pop;
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, (u - 0.2) / 0.12));
      drawIcon(ctx, icon, cx - size / 2, y + iconSize / 2 - size / 2, size, light ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.32)');
      ctx.restore();
    }
    y += iconSize + gap * 1.2;
  }
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (name) {
    const k = rise(Math.min(1, Math.max(0, (u - 0.4) / 0.45)));
    ctx.globalAlpha = k;
    ctx.font = `800 ${nameSize}px ${OVERLAY_FONT}`;
    setLetterSpacing(ctx, `${Math.round(-nameSize * 0.02)}px`);
    ctx.fillStyle = ink;
    ctx.fillText(name, cx, y + nameSize * 0.85 + (1 - k) * nameSize * 0.3, width * 0.9);
    y += nameSize * 1.15;
  }
  if (tagline) {
    const k = rise(Math.min(1, Math.max(0, (u - 0.55) / 0.45)));
    ctx.globalAlpha = k * (light ? 1 : 0.78);
    ctx.font = `600 ${tagSize}px ${OVERLAY_FONT}`;
    setLetterSpacing(ctx, '0px');
    ctx.fillStyle = soft;
    ctx.fillText(tagline, cx, y + tagSize * 1.2 + (1 - k) * tagSize * 0.3, width * 0.9);
    y += tagSize * 1.6;
  }
  ctx.restore();
  // The badges appear at once, whole, as their makers ask.
  if (badges.length && u >= 0.75) {
    y += gap * 1.3;
    const widths = badges.map((b) => (b.google ? badgeH * (GOOGLE_BOX.w / GOOGLE_BOX.h) : badgeH * APPLE_ASPECT));
    const between = badgeH * 0.3;
    const total = widths.reduce((a, b) => a + b, 0) + between * (badges.length - 1);
    let x = cx - total / 2;
    badges.forEach((badge, i) => {
      if (badge.google) {
        // The file's own clear space falls outside the badge's box.
        const scale = badgeH / GOOGLE_BOX.h;
        ctx.drawImage(badge.image, x - GOOGLE_BOX.x * scale, y - GOOGLE_BOX.y * scale, GOOGLE_BOX.fileW * scale, GOOGLE_BOX.fileH * scale);
      } else {
        ctx.drawImage(badge.image, x, y, widths[i], badgeH);
      }
      x += widths[i] + between;
    });
  }
}

/** True when the end card covers time `t` of a film this long. */
export function cardShowing(text: FilmText, duration: number, t: number): boolean {
  return hasCard(text) && t >= duration - CARD_SECONDS;
}

/**
 * Draws what shows at `t` over the film, on a canvas `width` x `height`
 * device pixels: the words of the cues showing, the icon at the top and the
 * end card. Nothing is drawn when nothing shows.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number,
  cues: CaptionCue[],
  format: FilmFormat,
  backdrop: Backdrop,
  text?: FilmText,
  duration?: number,
  assets?: OverlayAssets | null,
  /** The camera's zoom at `t`: the icon's rings show only in a wide shot. */
  zoom = 1
): void {
  const style: WordsStyle = text?.style ?? 'soft';
  const card = !!text && hasCard(text) && duration !== undefined;
  const cardAt = card ? duration! - CARD_SECONDS : null;
  const colors = wordColors(style, backdrop, text ?? {});
  const { shade, highlight: backdropColor } = inks(backdrop);
  let top0 = 0;
  if (text?.logo && assets?.icon && duration !== undefined) {
    const box = logoBox(width, height, format);
    if (wordsSide(format, text) === 'top') top0 = box.y + box.size + baseOf(width, height, format) * 0.05;
    // The rings in the backdrop's own colour, so they read as part of the picture.
    drawLogo(ctx, width, height, t, duration, format, assets.icon, backdropColor, cardAt, zoom);
  }
  // With a card, the end words are drawn on it, under the app's name.
  const showing = cues.filter((cue) => t >= cue.start && t <= cue.end && !(card && cue.role === 'end'));
  for (const cue of showing) {
    ctx.save();
    if (style === 'headline') drawHeadline(ctx, width, height, t, cue, format, colors, backdrop.dark, top0);
    else if (style === 'punchy') drawPunchy(ctx, width, height, t, cue, format, colors);
    else drawSoft(ctx, width, height, t, cue, format, colors, shade, top0);
    ctx.restore();
  }
  if (card && text) drawCard(ctx, width, height, t, duration!, format, text, backdrop, assets);
}
