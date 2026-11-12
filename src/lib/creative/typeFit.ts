/**
 * How many lines a piece of generated copy sets in, and the largest size at
 * which it fits its box.
 *
 * The designs set type at the largest size that fits, so the line count has to
 * be the canvas's own, and wrapping depends on the face. "MOMMY MORNINGS" in
 * bold is 9.7 ems wide in Arial, 13 in Unbounded and 5.7 in Bebas Neue. The
 * designs used to size it by an average letter, which made it 8.7, so in Arial
 * the name came out a line longer than its box and the box cut it off.
 *
 * So the lines are measured when there is a page to measure in, with the probe
 * from textFit.ts. The store check reads the same probe, which means a design
 * that fits here passes that check. Without a page (a unit test, a script) the
 * lines are estimated from widths by kind of character.
 */

import type { TextElementProps } from '@/types/artboard';
import { faceOnItsWay, faceSpec, onFontsSettled } from '@/lib/fontsSettled';
import { measureTextHeight } from '@/lib/textFit';
import { cssFontFamily } from '@/services/fontService';

/** Matches TextElement: text renders at fontSize / 0.3 px. */
const DISPLAY_SCALE_FACTOR = 0.3;
/** The text box's own padding, 2px each side, as in textFit.ts. */
const BOX_PADDING = 4;

/** What decides how wide a line of copy sets. */
export interface Face {
  fontFamily: string;
  fontWeight: string;
  fontStyle?: string;
  lineHeight: number;
  /** Tracking in ems, 0 for none. */
  tracking: number;
}

/** A glyph size in artboard px as the `fontSize` a text element stores, to one decimal. */
export function storedFontSize(glyph: number): number {
  return Math.round(glyph * DISPLAY_SCALE_FACTOR * 10) / 10;
}

/** Tracking in ems as the `letterSpacing` a text element stores. */
export function storedTracking(fontSize: number, tracking: number): number {
  return Math.round(fontSize * tracking * 100) / 100;
}

// --- estimated -----------------------------------------------------------------

/** CJK, kana, Hangul, fullwidth forms and emoji: a full em each, and a line may break after any of them. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0x1f000 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3ffff)
  );
}

/** Thai, Lao, Khmer and Burmese are written without spaces, and a line breaks between their words. */
function isUnspaced(code: number): boolean {
  return (code >= 0x0e00 && code <= 0x0eff) || (code >= 0x1000 && code <= 0x109f) || (code >= 0x1780 && code <= 0x17ff);
}

/**
 * Rough advance of one character in ems, set bold. The numbers are Arial
 * Bold's by kind of character, rounded up a little, so that an estimate errs
 * toward smaller type and not toward a line too many.
 */
function advance(char: string): number {
  if (char === ' ' || char === '\u00a0') return 0.28;
  const code = char.codePointAt(0) ?? 0;
  if (isWide(code)) return 1;
  if (".,:;!'|/\\ijl".includes(char)) return 0.3;
  if ('ftrI()[]{}-*`'.includes(char)) return 0.38;
  if ('mw'.includes(char)) return 0.88;
  if ('MW@%'.includes(char)) return 0.94;
  if (code >= 0x30 && code <= 0x39) return 0.58;
  // Capitals in any script that has them.
  if (char.toLowerCase() !== char) return 0.72;
  return 0.6;
}

/** A regular weight sets about this much narrower than a bold one. */
const REGULAR_SHARE = 0.93;

function isBold(weight: string | undefined): boolean {
  if (weight === 'bold' || weight === 'bolder') return true;
  const value = Number(weight);
  return Number.isFinite(value) && value >= 600;
}

/** The rough width of one line of `text` in ems, tracking included. */
export function roughWidth(text: string, face: Pick<Face, 'fontWeight' | 'tracking'>): number {
  const share = isBold(face.fontWeight) ? 1 : REGULAR_SHARE;
  let ems = 0;
  for (const char of text) ems += advance(char) * share + face.tracking;
  return ems;
}

/**
 * A typed line as the pieces a browser keeps whole: words, single spaces, and
 * single characters of the scripts that break anywhere. A word ends after a
 * hyphen, where a line may break too.
 */
function pieces(line: string): string[] {
  const out: string[] = [];
  let word = '';
  const flush = () => {
    if (word) out.push(word);
    word = '';
  };
  for (const char of line) {
    const code = char.codePointAt(0) ?? 0;
    if (char === ' ' || char === '\t') {
      flush();
      out.push(' ');
    } else if (isWide(code) || isUnspaced(code)) {
      flush();
      out.push(char);
    } else {
      word += char;
      if (char === '-') flush();
    }
  }
  flush();
  return out;
}

/** How copy sets in a box: the lines it takes, and whether a word had to be broken to fit. */
interface Setting {
  lines: number;
  broken: boolean;
}

/** Lines by first fit, the way a browser wraps, from rough widths. */
function estimatedSetting(content: string, glyph: number, width: number, face: Face): Setting {
  const room = width - BOX_PADDING;
  let lines = 0;
  let broken = false;
  for (const typed of content.split('\n')) {
    lines += 1;
    let used = 0;
    let gap = 0;
    for (const piece of pieces(typed)) {
      const wide = roughWidth(piece, face) * glyph;
      if (piece === ' ') {
        // A space at the end of a line hangs past it and takes no room.
        gap += wide;
        continue;
      }
      if (used > 0 && used + gap + wide > room) {
        lines += 1;
        used = 0;
      } else if (used > 0) {
        used += gap;
      }
      gap = 0;
      if (wide > room && room > 0) {
        // Too wide for a line of its own, so the canvas breaks inside it.
        broken = true;
        const more = Math.ceil(wide / room) - 1;
        lines += more;
        used = wide - more * room;
      } else {
        used += wide;
      }
    }
  }
  return { lines, broken };
}

/**
 * The height a text layer needs to show all of its lines, in board pixels,
 * estimated. For where there is no page to measure in: the store check uses it
 * there, so it and the designs count lines the same way with or without one.
 */
export function estimatedHeight(
  text: Pick<
    TextElementProps,
    'content' | 'size' | 'scale' | 'fontSize' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'lineHeight' | 'letterSpacing'
  >
): number {
  const glyph = text.fontSize / DISPLAY_SCALE_FACTOR;
  const width = text.size.width * (text.scale || 1);
  if (!(width > BOX_PADDING) || !(glyph > 0)) return 0;
  const lineHeight = text.lineHeight || 1.2;
  const face: Face = {
    fontFamily: text.fontFamily,
    fontWeight: text.fontWeight ?? '400',
    fontStyle: text.fontStyle,
    lineHeight,
    // Stored in the units of fontSize, so their ratio is the tracking in ems.
    tracking: (text.letterSpacing ?? 0) / text.fontSize,
  };
  return linesHeight(estimatedSetting(text.content, glyph, width, face).lines, glyph, lineHeight);
}

/** The word of `content` that sets widest, by rough width. Null when every piece is one character. */
function widestWord(content: string, face: Face): string | null {
  let best: string | null = null;
  let widest = 0;
  for (const typed of content.split('\n')) {
    for (const piece of pieces(typed)) {
      if (piece.length < 2) continue;
      const wide = roughWidth(piece, face);
      if (wide > widest) {
        widest = wide;
        best = piece;
      }
    }
  }
  return best;
}

// --- measured ------------------------------------------------------------------

const probed = new Map<string, number>();

// Measured against a fallback face, a line breaks somewhere else. Forget every
// measurement once a font arrives. This listener is added when the module
// loads, ahead of any component's, so a design rebuilt at the same moment
// measures again.
onFontsSettled(() => probed.clear());

/** The lines the canvas sets `content` in, or 0 where there is no page to measure in. */
function probedLines(content: string, fontSize: number, width: number, face: Face): number {
  if (typeof document === 'undefined') return 0;
  const key = [
    content,
    face.fontFamily,
    face.fontWeight,
    face.fontStyle ?? '',
    fontSize,
    face.lineHeight,
    face.tracking,
    width,
  ].join('\u0000');
  const known = probed.get(key);
  if (known !== undefined) return known;
  const probe: Pick<
    TextElementProps,
    'size' | 'scale' | 'fontSize' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'lineHeight' | 'letterSpacing'
  > = {
    size: { width, height: 0 },
    scale: 1,
    fontSize,
    fontFamily: face.fontFamily,
    fontWeight: face.fontWeight,
    fontStyle: face.fontStyle,
    lineHeight: face.lineHeight,
    letterSpacing: storedTracking(fontSize, face.tracking),
  };
  const height = measureTextHeight(probe, content);
  const line = (fontSize / DISPLAY_SCALE_FACTOR) * face.lineHeight;
  const lines = height > 0 ? Math.max(1, Math.round((height - BOX_PADDING) / line)) : 0;
  // A design is rebuilt on every keystroke in the name field, and each is a new key.
  if (probed.size > 4000) probed.clear();
  probed.set(key, lines);
  return lines;
}

/**
 * How `content` sets at `glyph` px in a box `width` wide. Both are rounded the
 * way a text element stores them, so what is measured is what gets drawn.
 */
function settingAt(content: string, glyph: number, width: number, face: Face): Setting {
  const fontSize = storedFontSize(glyph);
  const boxWidth = Math.round(width);
  const lines = probedLines(content, fontSize, boxWidth, face);
  if (lines === 0) return estimatedSetting(content, fontSize / DISPLAY_SCALE_FACTOR, boxWidth, face);
  // The canvas breaks a word only when it is too wide for a line of its own,
  // and the copy then runs to more lines than were typed.
  let broken = false;
  if (lines > content.split('\n').length) {
    const word = widestWord(content, face);
    broken = word !== null && probedLines(word, fontSize, boxWidth, face) > 1;
  }
  return { lines, broken };
}

// --- faces on their way ----------------------------------------------------------

/** The CSS font shorthand that asks the page for a face. */
function fontSpec(face: Pick<Face, 'fontFamily' | 'fontWeight' | 'fontStyle'>): string {
  return faceSpec(face, cssFontFamily(face.fontFamily));
}

/** Faces that failed or timed out once. Offline they never arrive, and the fallback is what the canvas draws. */
const gaveUp = new Set<string>();

/** The shorthand of each of `faces` the page has not loaded for `text`. Empty where there is no page to ask. */
function missingSpecs(faces: Pick<Face, 'fontFamily' | 'fontWeight' | 'fontStyle'>[], text: string): string[] {
  if (typeof document === 'undefined' || !document.fonts?.check) return [];
  const fonts = document.fonts;
  return [...new Set(faces.map(fontSpec))].filter((spec) => {
    try {
      return !fonts.check(spec, text);
    } catch {
      // A weight or family the shorthand cannot say. Nothing to wait for.
      return false;
    }
  });
}

/**
 * True while one of `faces` has been measured in and has not arrived, so the
 * measurement was taken in its fallback. It goes by the faces the probe has
 * asked for (fontsSettled.ts) and not by `document.fonts.check`, which WebKit
 * answers wrongly three seconds into a load.
 */
export function facesOnTheirWay(faces: Pick<Face, 'fontFamily' | 'fontWeight' | 'fontStyle'>[]): boolean {
  return faces.some((face) => faceOnItsWay(fontSpec(face)));
}

/**
 * Null when the page already has `faces` for `text`, else a promise that
 * settles once it does.
 *
 * Type measured before its face arrives is measured in the fallback, and the
 * real face then wraps it somewhere else. So a design that is going into the
 * project is built after this. The wait ends after `timeoutMs` whatever
 * happened, because a design fitted in the fallback is better than none, and a
 * face that failed once is not waited for again.
 */
export function facesPending(
  faces: Pick<Face, 'fontFamily' | 'fontWeight' | 'fontStyle'>[],
  text: string,
  timeoutMs = 3000
): Promise<void> | null {
  if (typeof document === 'undefined' || !document.fonts?.load) return null;
  const fonts = document.fonts;
  const specs = missingSpecs(faces, text).filter((spec) => !gaveUp.has(spec));
  if (specs.length === 0) return null;
  const loads = Promise.all(
    specs.map((spec) =>
      fonts.load(spec, text).then(
        () => undefined,
        () => {
          gaveUp.add(spec);
        }
      )
    )
  );
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      for (const spec of missingSpecs(faces, text)) gaveUp.add(spec);
      resolve();
    }, timeoutMs);
  });
  // The promise can settle before the page reports the load, so the
  // measurements taken in the fallback are dropped here as well.
  return Promise.race([loads, timeout]).then(() => probed.clear());
}

// --- fitting -------------------------------------------------------------------

export interface GlyphFit {
  /** In artboard px, and a size a text element can store. */
  glyph: number;
  lines: number;
  fits: boolean;
}

/** The height `lines` of type take in a text box, its padding included. */
export function linesHeight(lines: number, glyph: number, lineHeight: number): number {
  return lines * glyph * lineHeight + BOX_PADDING;
}

/**
 * The largest glyph, in artboard px, at which `content` sets whole in the box:
 * in `maxLines` lines at most, inside its height, with no word broken. Never
 * below `min`. When not even `min` fits, `fits` is false and the size and the
 * lines are those at `min`, for the caller to drop the copy or try it another
 * way.
 *
 * `content` can be several strings that share one box, such as a headline in
 * two languages. The size is then the largest at which every one of them
 * fits, and `lines` the most any of them takes.
 */
export function fitGlyph(
  content: string | string[],
  box: { width: number; height: number },
  opts: { max: number; min: number; maxLines: number; face: Face }
): GlyphFit {
  const contents = Array.isArray(content) ? content : [content];
  // The sizes a text element can store, largest first, 5% apart, ending on
  // the smallest allowed. That one is rounded up so it never stores below it.
  // The small amount taken off first keeps a float that is a hair over a
  // whole tenth from being rounded up a whole step.
  const smallest = Math.ceil(opts.min * DISPLAY_SCALE_FACTOR * 10 - 1e-6) / 10 / DISPLAY_SCALE_FACTOR;
  const sizes: number[] = [];
  for (let glyph = Math.max(opts.max, smallest); glyph > smallest && sizes.length < 80; glyph *= 0.95) {
    const size = storedFontSize(glyph) / DISPLAY_SCALE_FACTOR;
    if (size > smallest && size !== sizes[sizes.length - 1]) sizes.push(size);
  }
  sizes.push(smallest);

  const at = (glyph: number) => {
    let lines = 0;
    let ok = true;
    for (const one of contents) {
      const set = settingAt(one, glyph, box.width, opts.face);
      // A line break the writer typed is a line whatever the size, so the
      // limit can never be below the number of them.
      const maxLines = Math.max(opts.maxLines, one.split('\n').length);
      if (set.broken || set.lines > maxLines || linesHeight(set.lines, glyph, opts.face.lineHeight) > box.height) {
        ok = false;
      }
      lines = Math.max(lines, set.lines);
    }
    return { lines, ok };
  };
  // Smaller type never takes more lines, so the largest size that fits is
  // found by halving, in a handful of measurements.
  let low = 0;
  let high = sizes.length - 1;
  const last = at(sizes[high]);
  if (!last.ok) return { glyph: sizes[high], lines: last.lines, fits: false };
  while (low < high) {
    const middle = (low + high) >> 1;
    if (at(sizes[middle]).ok) high = middle;
    else low = middle + 1;
  }
  return { glyph: sizes[low], lines: at(sizes[low]).lines, fits: true };
}
