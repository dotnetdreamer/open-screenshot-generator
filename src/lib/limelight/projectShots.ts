/**
 * The screenshots in the open project that a Limelight screen can show: the
 * picture in each device frame, artboard by artboard, in canvas order. Only
 * the pictures are read; the project is never changed.
 *
 * A picture taken from a project is copied into Limelight's own database when
 * it goes on a screen, with a note of where it came from (`ScreenOrigin`), so
 * a scene keeps working if the project changes or goes, and the note is what
 * a language's own screenshot will be found by later.
 */

import type { ArtboardState, DeviceFrameElementProps, ShapeElementProps, TextElementProps } from '@/types/artboard';
import { withBasePath } from '@/lib/basePath';
import { assetIdFromRef, getMediaAsset, isAssetRef } from '@/lib/mediaStore';
import { projectIconBoard } from '@/lib/appIcon/specs';
import { ALL_FONTS } from '@/services/fontService';
import type { ScreenOrigin } from './types';

export interface ProjectShot {
  /** Unique in the list: artboard and element. */
  key: string;
  artboardId: string;
  artboardName: string;
  elementId: string;
  /** As the element stores it: asset:, data:, blob:, a web address or a path in the app. */
  src: string;
  /** True for the sample picture a template ships with, false for the user's own. */
  sample: boolean;
  /** What its artboard's headline says, for a caption (`artboardHeadline`). */
  headline?: string;
}

function isUserContent(src: string): boolean {
  return src.startsWith('data:') || src.startsWith('blob:') || isAssetRef(src);
}

/**
 * Every device frame's picture, the user's own first, each with its
 * artboard's headline. `appName` keeps the app's own name, a logo on the
 * artboard, from being taken for one.
 */
export function projectShots(artboards: ArtboardState[], appName?: string): ProjectShot[] {
  const shots: ProjectShot[] = [];
  const seen = new Set<string>();
  artboards.forEach((artboard, index) => {
    let headline: string | undefined | null = null;
    for (const element of artboard.elements ?? []) {
      if (element.type !== 'device') continue;
      const src = (element as DeviceFrameElementProps).screenshotSrc;
      if (!src) continue;
      const key = `${artboard.id}/${element.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (headline === null) headline = artboardHeadline(artboard, appName);
      const shot: ProjectShot = {
        key,
        artboardId: artboard.id,
        artboardName: artboard.name || `Artboard ${index + 1}`,
        elementId: element.id,
        src,
        sample: !isUserContent(src),
      };
      if (headline) shot.headline = headline;
      shots.push(shot);
    }
  });
  // The user's own pictures first; a template's samples only after them.
  return [...shots.filter((shot) => !shot.sample), ...shots.filter((shot) => shot.sample)];
}

// ---------------------------------------------------------------------------
// The project's own words, colour and font, for templates that use them
// ---------------------------------------------------------------------------

/** Letters and digits only, lower case, for telling the app's own name from a headline. */
function squash(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
}

/** A few words: what a caption can hold. */
function captionSized(text: string): boolean {
  return text.length > 0 && text.length <= 60 && text.split(' ').length <= 9;
}

/** True for a layer a person can see: one that isn't all but see-through. */
function seen(element: { opacity?: number }): boolean {
  return (element.opacity ?? 1) >= 0.05;
}

/**
 * The texts on an artboard that could be its headline: ones a person sees,
 * with letters (not stars or prices), not turned on their side, and not the
 * app's own name standing alone as a logo. The name is the whole name or one
 * whole word of it ("paylark" over "Paylark Benefits"), never a word that
 * only starts the same: "Plan" is a headline for "Planner".
 */
function headlineTexts(artboard: ArtboardState, appName?: string): TextElementProps[] {
  const name = appName ? squash(appName) : '';
  const nameWords = new Set((appName ?? '').split(/[^\p{L}\p{N}]+/u).map(squash).filter(Boolean));
  return (artboard.elements ?? []).filter((element): element is TextElementProps => {
    if (element.type !== 'text') return false;
    const text = element as TextElementProps;
    if (!seen(text) || Math.abs(text.rotation ?? 0) > 20) return false;
    if (typeof text.content !== 'string' || !/\p{L}/u.test(text.content)) return false;
    const own = squash(text.content);
    const alone = !/\s/.test(text.content.trim());
    return !(name && own && (own === name || (alone && nameWords.has(own))));
  });
}

/**
 * The text a headline is built round: the biggest, and of two the same size
 * the higher one, then the one further left. The caption and the font both
 * come from it: picked by size alone, an equal-size button lower down
 * ("Get started" in Poppins) chose the font while the headline above it
 * ("Plan your week" in Outfit) was the caption.
 */
function headlineTop(texts: TextElementProps[]): TextElementProps {
  return texts.reduce((best, text) => {
    if (text.fontSize !== best.fontSize) return text.fontSize > best.fontSize ? text : best;
    if (text.position.y !== best.position.y) return text.position.y < best.position.y ? text : best;
    return text.position.x < best.position.x ? text : best;
  });
}

/**
 * The words on an artboard that read as its headline: its biggest text, with
 * the text of about the same size stacked right above or below it (a
 * headline set as several text boxes, one line each), in reading order. Only
 * text that could be a headline counts (`headlineTexts`). Long copy, a review
 * or a paragraph, gives nothing: a caption is a few words.
 */
export function artboardHeadline(artboard: ArtboardState, appName?: string): string | undefined {
  const texts = headlineTexts(artboard, appName);
  if (texts.length === 0) return undefined;
  const top = headlineTop(texts);
  // A text's glyphs are drawn at fontSize / 0.3 artboard pixels.
  const em = top.fontSize / 0.3;
  const box = (text: TextElementProps) => {
    const k = text.scale ?? 1;
    return { top: text.position.y, bottom: text.position.y + text.size.height * k, left: text.position.x, right: text.position.x + text.size.width * k };
  };
  const group = [top];
  for (let grew = true; grew; ) {
    grew = false;
    for (const text of texts) {
      if (group.includes(text) || text.fontSize < top.fontSize * 0.75 || text.fontSize > top.fontSize * 1.34) continue;
      const b = box(text);
      const stacked = group.some((member) => {
        const a = box(member);
        const gap = Math.max(a.top - b.bottom, b.top - a.bottom);
        return gap <= em && Math.min(a.right, b.right) > Math.max(a.left, b.left);
      });
      if (stacked) {
        group.push(text);
        grew = true;
      }
    }
  }
  group.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
  const joined = tidy(group.map((text) => text.content).join(' '));
  if (captionSized(joined)) return joined;
  const alone = tidy(top.content);
  return captionSized(alone) ? alone : undefined;
}

/** #rrggbb and how solid it is, from #rgb, #rrggbb or rgb(a); null for anything else. */
function colourOf(value: unknown): { hex: string; alpha: number } | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return { hex: v, alpha: 1 };
  if (/^#[0-9a-f]{3}$/.test(v)) return { hex: `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`, alpha: 1 };
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (!rgb) return null;
  const alpha = rgb[4] === undefined ? 1 : Math.min(1, parseFloat(rgb[4]) / (rgb[4].endsWith('%') ? 100 : 1));
  return { hex: `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`, alpha };
}

/**
 * The colours a shape paints, and how much of each shows, the way
 * ShapeElement paints it: a two-stop gradient wins over `fillColor`, and
 * `fillOpacity` takes the place of a colour's own alpha when it is set and
 * isn't 1 (0 paints solid there, so it counts as solid here), all under the
 * layer's own opacity.
 */
function shapeFills(shape: ShapeElementProps): Array<{ hex: string; shows: number }> {
  const gradient = shape.fillGradient;
  const stops = gradient && typeof gradient.color1 === 'string' && typeof gradient.color2 === 'string' && typeof gradient.angle === 'number' ? [gradient.color1, gradient.color2] : [shape.fillColor];
  const fillOpacity = shape.fillOpacity && shape.fillOpacity !== 1 ? shape.fillOpacity : null;
  const fills: Array<{ hex: string; shows: number }> = [];
  for (const stop of stops) {
    const colour = colourOf(stop);
    if (colour) fills.push({ hex: colour.hex, shows: (shape.opacity ?? 1) * (fillOpacity ?? colour.alpha) });
  }
  return fills;
}

/** Saturation and lightness, 0 to 1, of #rrggbb, and its chroma: how far it is from a grey. */
function saturationAndLightness(hex: string): { s: number; l: number; chroma: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { s, l, chroma: max - min };
}

function isScreenshotBoard(artboard: ArtboardState): boolean {
  return !artboard.appIcon && !artboard.creativeAsset;
}

/**
 * The colour that reads as the project's own: the most colourful of its
 * screenshots' backgrounds (both colours of a gradient) and the big shapes a
 * person sees, a shape weighed by how much of the artboard it covers and how
 * much of its paint shows (`shapeFills`). Colourful is chroma, how far a
 * colour is from a grey, so royal blue beats the light blue it fades into; a
 * pastel still counts when there is nothing stronger, by its hue, which is
 * what a template takes from it. A background under a picture counts for
 * less, since the picture may cover it. Paint that shows less than 5% counts
 * for nothing, and greys, white and black don't count, so a plain white
 * project gives none, whatever invisible layer it keeps.
 */
export function projectAccent(artboards: ArtboardState[]): string | undefined {
  let best: { hex: string; score: number } | null = null;
  const consider = (value: unknown, weight: number) => {
    const colour = colourOf(value);
    if (!colour) return;
    const shows = weight * colour.alpha;
    if (shows <= 0) return;
    const { s, l, chroma } = saturationAndLightness(colour.hex);
    if (s < 0.3 || l < 0.12 || l > 0.95) return;
    const score = shows * chroma;
    if (!best || score > best.score) best = { hex: colour.hex, score };
  };
  for (const artboard of artboards.filter(isScreenshotBoard).slice(0, 10)) {
    const ground = artboard.backgroundImage ? 0.25 : 1;
    if (artboard.backgroundType === 'gradient' && artboard.backgroundGradient) {
      consider(artboard.backgroundGradient.color1, ground);
      consider(artboard.backgroundGradient.color2, ground);
    } else consider(artboard.backgroundColor, ground);
    const area = Math.max(1, artboard.size.width * artboard.size.height);
    for (const element of artboard.elements ?? []) {
      if (element.type !== 'shape') continue;
      const shape = element as ShapeElementProps;
      const k = shape.scale ?? 1;
      const share = (shape.size.width * k * shape.size.height * k) / area;
      if (share < 0.02) continue;
      for (const fill of shapeFills(shape)) {
        if (fill.shows < 0.05) continue;
        // A solid shape covering a fifth of the board counts as much as a background would.
        consider(fill.hex, Math.min(1, share * 5) * 0.9 * fill.shows);
      }
    }
  }
  return (best as { hex: string } | null)?.hex;
}

/** What the project says about itself; `templateNames` are the start dialog's templates, the names the layout copies. */
export interface ProjectNaming {
  name: string;
  artboards: ArtboardState[];
  templateNames?: readonly string[];
}

/**
 * The app's name as the user wrote it for the App icon studio, which keeps
 * one apart from the project's name ("Paylark" in a project called "Paylark
 * benefits"), or else the project's name. A project made from a template is
 * called "<template> Copy" by the layout, and loses the " Copy" only when the
 * rest is a template's name: "Carbon Copy" is somebody's app. Empty for a
 * project that still has the name a new one gets, so a template shows its
 * own stand-in rather than "Untitled Project".
 */
export function projectAppName(project: ProjectNaming): string {
  const own = projectIconBoard(project.artboards)?.appIcon?.appName?.trim();
  if (own) return own;
  const name = project.name.trim();
  const copied = /^(.+?)\s+Copy$/.exec(name);
  const appName = copied && project.templateNames?.includes(copied[1]) ? copied[1] : name;
  return /^Untitled Project(?:\s+\d+)?$/i.test(appName) ? '' : appName;
}

/** What a template takes from the project besides its screenshots. */
export interface ProjectCopy {
  appName: string;
  accent?: string;
  font?: string;
}

export function projectCopy(project: ProjectNaming): ProjectCopy {
  const appName = projectAppName(project);
  return { appName, accent: projectAccent(project.artboards), font: projectFont(project.artboards, appName) };
}

const KNOWN_FONTS = new Set(ALL_FONTS.map((font) => font.family));

/**
 * The family most of the project's headlines are set in, when it is one the
 * app ships (a family the page can't load would draw in a fallback). A
 * headline is what `artboardHeadline` would take: a see-through layer or the
 * app's own logo doesn't choose the font.
 */
export function projectFont(artboards: ArtboardState[], appName?: string): string | undefined {
  const counts = new Map<string, number>();
  for (const artboard of artboards.filter(isScreenshotBoard).slice(0, 10)) {
    const texts = headlineTexts(artboard, appName);
    if (texts.length === 0) continue;
    const top = headlineTop(texts);
    if (KNOWN_FONTS.has(top.fontFamily)) counts.set(top.fontFamily, (counts.get(top.fontFamily) ?? 0) + 1);
  }
  let family: string | undefined;
  let most = 0;
  for (const [name, count] of counts) {
    if (count > most) {
      family = name;
      most = count;
    }
  }
  return family;
}

/** The picture's file. */
export async function shotBlob(src: string): Promise<Blob | null> {
  if (isAssetRef(src)) {
    const asset = await getMediaAsset(assetIdFromRef(src));
    return asset?.blob ?? null;
  }
  try {
    const response = await fetch(withBasePath(src));
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.type.startsWith('image/') ? blob : null;
  } catch {
    return null;
  }
}

export function originOf(projectId: string | null | undefined, shot: ProjectShot, locale?: string | null): ScreenOrigin | undefined {
  if (!projectId) return undefined;
  const origin: ScreenOrigin = { projectId, artboardId: shot.artboardId, elementId: shot.elementId };
  if (locale) origin.locale = locale;
  return origin;
}
