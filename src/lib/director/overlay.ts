// The words over a film: the title, the captions and the end card, drawn on
// a 2D canvas over the 3D picture. The preview and the export call the same
// function, so the file shows what the screen showed.
//
// Words come in one after another, rising into place, and leave together.
// The last word is in the backdrop's colour, which ties the words to the
// picture.

import { cubicBezier } from './plan';
import { wordsSide } from './frame';
import { luminance, mixRgb, parseColor, toHex, type Backdrop, type Rgb } from './looks';
import type { CaptionCue, FilmFormat } from './types';

export const OVERLAY_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const rise = cubicBezier(0.2, 0, 0, 1);
const WORD_STAGGER = 0.07;
const WORD_IN = 0.5;
const OUT = 0.32;

interface Line {
  words: string[];
  width: number;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): Line[] {
  const words = text.split(/\s+/).filter(Boolean);
  const space = ctx.measureText(' ').width;
  const lines: Line[] = [];
  let current: string[] = [];
  let width = 0;
  for (const word of words) {
    const w = ctx.measureText(word).width;
    if (current.length && width + space + w > maxWidth) {
      lines.push({ words: current, width });
      current = [word];
      width = w;
    } else {
      width = current.length ? width + space + w : w;
      current.push(word);
    }
  }
  if (current.length) lines.push({ words: current, width });
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

/**
 * Draws the cues showing at `t` on a canvas `width` x `height` device pixels.
 * Nothing is drawn when no cue is showing.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number,
  cues: CaptionCue[],
  format: FilmFormat,
  backdrop: Backdrop
): void {
  const showing = cues.filter((cue) => t >= cue.start && t <= cue.end);
  if (showing.length === 0) return;
  const side = wordsSide(format);
  const base = side === 'left' ? height : Math.min(width, height * 0.5625);
  const { ink, highlight, shade } = inks(backdrop);
  for (const cue of showing) {
    const size = Math.round(base * (cue.role === 'caption' ? 0.074 : cue.role === 'title' ? 0.1 : 0.088));
    ctx.save();
    ctx.font = `${cue.role === 'caption' ? 700 : 800} ${size}px ${OVERLAY_FONT}`;
    setLetterSpacing(ctx, `${Math.round(-size * 0.02)}px`);
    ctx.textBaseline = 'alphabetic';
    const maxWidth = side === 'left' ? width * 0.36 : width * 0.84;
    let lines = wrap(ctx, cue.text, maxWidth);
    let lineSize = size;
    // Too many lines: smaller words, never cut off.
    while (lines.length > 3 && lineSize > size * 0.6) {
      lineSize = Math.round(lineSize * 0.9);
      ctx.font = `${cue.role === 'caption' ? 700 : 800} ${lineSize}px ${OVERLAY_FONT}`;
      lines = wrap(ctx, cue.text, maxWidth);
    }
    const leading = lineSize * 1.12;
    const blockH = leading * (lines.length - 1) + lineSize;
    const top = side === 'left' ? height / 2 - blockH / 2 + lineSize * 0.85 : height * (cue.role === 'caption' ? 0.085 : 0.095) + lineSize * 0.85;
    const out = Math.min(1, Math.max(0, (cue.end - t) / OUT));
    const space = ctx.measureText(' ').width;
    ctx.shadowColor = shade;
    ctx.shadowBlur = lineSize * 0.35;
    ctx.shadowOffsetY = lineSize * 0.04;
    let index = 0;
    const total = lines.reduce((n, line) => n + line.words.length, 0);
    lines.forEach((line, row) => {
      let x = side === 'left' ? width * 0.07 : width / 2 - line.width / 2;
      const y = top + row * leading;
      for (const word of line.words) {
        const appear = rise(Math.min(1, Math.max(0, (t - cue.start - index * WORD_STAGGER) / WORD_IN)));
        const alpha = appear * out;
        if (alpha > 0.002) {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = index === total - 1 && total > 1 ? highlight : ink;
          ctx.fillText(word, x, y + (1 - appear) * lineSize * 0.42 - (1 - out) * lineSize * 0.15);
        }
        x += ctx.measureText(word).width + space;
        index += 1;
      }
    });
    ctx.restore();
  }
}
