/**
 * The faces Limelight's titles are set in: their names as a canvas needs
 * them, loading them before anything is measured or drawn with them, and
 * how wide a line of words is.
 *
 * A title is framed by how much room its words take (`titleBox` in edit.ts)
 * and drawn on a canvas (`TextView` in stage/actors.ts). Both need the face
 * itself: a face that hasn't loaded measures and draws in the fallback, and
 * Bungee is half as wide again as the fallback, so a title framed or drawn
 * before its face arrived was cut off or came out in the wrong letters. So a
 * template loads its faces before it frames anything, a still or a video
 * frame loads its titles' faces before it draws, and a line is measured on a
 * canvas in its own face. Where there is no canvas (the unit tests, run in
 * Node) or the face still hasn't come (offline), the widths below stand in.
 *
 * Nothing here touches the DOM when the module loads, so it is safe in Node.
 */

import { cssFontFamily, whenBuiltInFacesDeclared } from '@/services/fontService';

/**
 * A family as the canvas needs it, with a fallback: a family the page never
 * loaded (the old default, Inter, isn't one the app ships) would otherwise
 * draw in the browser's default face, a serif one on a Mac.
 */
export function canvasFamily(family: string): string {
  const css = cssFontFamily(family);
  if (!css) return 'sans-serif';
  return css.includes(',') ? css : `${css}, sans-serif`;
}

/** The CSS font a title's words are set in, at a pixel size. */
export function titleFont(weight: number, family: string, pixels: number): string {
  return `${weight} ${pixels}px ${canvasFamily(family)}`;
}

/** A capital letter's height as a share of the font size, close enough for the faces the app ships. */
export const CAP_SHARE = 0.7;

export interface TitleFace {
  weight: number;
  font: string;
  /**
   * The words it will draw. A face split by unicode-range (Noto Sans JP is
   * some 120 pieces) loads only the pieces for the letters asked for, and
   * asked without any it loads the piece for a space: with the Latin piece
   * in, Japanese words drew in the fallback.
   */
  text?: string;
}

/** The letters of these texts, each once, to load or check a face for; a space when there are none, as the browser would use. */
function lettersOf(texts: Array<string | undefined>): string {
  const letters = new Set<string>();
  for (const text of texts) for (const char of text ?? '') if (!/\s/.test(char)) letters.add(char);
  return letters.size > 0 ? [...letters].sort().join('') : ' ';
}

/** Faces asked for on this page, for the letters asked, settled or not. */
const loads = new Map<string, Promise<void>>();
/** Faces that came, or failed for good: nothing to wait for. */
const settled = new Set<string>();
/** Faces waited for once already and still not here: a video's every frame doesn't wait for them again. */
const givenUp = new Set<string>();

/**
 * Loads these faces for the letters they will draw, waiting at most
 * `timeoutMs`: first for the app's built-in families to be declared on the
 * page, then for each face (`document.fonts.load` is the one signal both
 * engines keep, rule 3a). A face that hasn't come by then (offline, a slow
 * network) is waited for only that once on this page, so its words draw in
 * the fallback rather than every frame of a video waiting for it.
 */
export async function loadTitleFaces(faces: TitleFace[], timeoutMs = 4000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts || faces.length === 0) return;
  const textsBySpec = new Map<string, Array<string | undefined>>();
  for (const face of faces) {
    const spec = titleFont(face.weight, face.font, 10);
    textsBySpec.set(spec, [...(textsBySpec.get(spec) ?? []), face.text]);
  }
  const waiting: Promise<void>[] = [];
  const waitedFor: string[] = [];
  for (const [spec, texts] of textsBySpec) {
    const letters = lettersOf(texts);
    const key = `${spec}|${letters}`;
    if (settled.has(key)) continue;
    let load = loads.get(key);
    if (!load) {
      load = (async () => {
        await whenBuiltInFacesDeclared();
        await document.fonts.load(spec, letters).catch(() => []);
        settled.add(key);
      })();
      loads.set(key, load);
    }
    if (givenUp.has(key)) continue;
    waiting.push(load);
    waitedFor.push(key);
  }
  if (waiting.length === 0) return;
  let timer = 0;
  await Promise.race([Promise.all(waiting), new Promise<void>((resolve) => (timer = window.setTimeout(resolve, timeoutMs)))]);
  window.clearTimeout(timer);
  for (const key of waitedFor) if (!settled.has(key)) givenUp.add(key);
}

/**
 * True when the face can draw its letters now: loaded for them, or not one
 * the page has declared (so there is nothing to wait for and the fallback is
 * what it gets).
 */
export function faceReady(face: TitleFace): boolean {
  if (typeof document === 'undefined' || !document.fonts) return true;
  try {
    return document.fonts.check(titleFont(face.weight, face.font, 10), lettersOf([face.text]));
  } catch {
    return true;
  }
}

/**
 * Each printable ASCII character's width as a share of a capital's height,
 * from space to tilde: the widest of Plus Jakarta Sans, Outfit and Poppins
 * at 800, Bricolage Grotesque, Space Grotesk and Merriweather Sans at 700,
 * Fredoka at 800 and the system sans at 700, measured in Chrome (advance or
 * ink, whichever is wider). "W" is 1.54 and "i" 0.45: an average for every
 * letter framed "WWW" at not much more than half its width.
 */
const ASCII_WIDTHS = [
  0.4, 0.6, 0.88, 1.37, 0.97, 1.53, 1.16, 0.52, 0.67, 0.67, 0.93, 0.98, 0.55, 0.91, 0.58, 0.76, 1, 0.79, 0.88, 0.87, 0.99, 0.94, 0.99, 0.9,
  0.95, 1, 0.58, 0.61, 0.97, 0.99, 0.97, 0.87, 1.58, 1.08, 1.03, 1.1, 1.09, 0.95, 0.88, 1.15, 1.1, 0.5, 0.87, 1.04, 0.87, 1.37, 1.11, 1.25,
  0.95, 1.25, 1.03, 0.95, 0.93, 1.06, 1.07, 1.54, 1.06, 1, 0.89, 0.75, 1.2, 0.74, 1.05, 1.24, 0.64, 0.97, 0.97, 0.87, 0.97, 0.88, 0.7, 0.97,
  0.98, 0.45, 0.53, 0.92, 0.44, 1.52, 0.98, 0.93, 0.97, 0.97, 0.65, 0.81, 0.65, 0.98, 0.93, 1.3, 0.9, 0.95, 0.78, 0.7, 0.61, 0.7, 1.01,
];

/** A line's width in capitals' heights from the table: a CJK character is a whole em, any other one as wide as a wide letter. */
export function tableLineWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code < 127) width += ASCII_WIDTHS[code - 32];
    else if (code >= 0x2e80) width += 1 / CAP_SHARE;
    else width += 1.1;
  }
  return width;
}

let measurer: CanvasRenderingContext2D | null | undefined;

/**
 * A line's width in capitals' heights, measured on a canvas in its own face
 * (the advance, or the ink where a letter reaches past it), or null where
 * there is no canvas. Measured afresh each time, a few microseconds: kept,
 * a width measured before the app's families were declared would outlive
 * the face arriving.
 */
export function measureLineWidth(line: string, face: TitleFace): number | null {
  if (typeof document === 'undefined') return null;
  if (measurer === undefined) measurer = document.createElement('canvas').getContext('2d');
  if (!measurer) return null;
  measurer.font = titleFont(face.weight, face.font, 100);
  const metrics = measurer.measureText(line);
  const ink = (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0);
  return Math.max(metrics.width, ink) / (100 * CAP_SHARE);
}
