// The site's colours and heading face, taken from the screenshots so the site
// looks like the store page it sends people to.
//
// The colours come from the artboards' own backgrounds first, because those
// are the colours the designer picked. A board whose background is a picture
// has none to read, so the view samples the picture's pixels from the
// captured screenshot instead (`sampleColors`), and the app icon's pixels when
// there are no screenshots at all. Every colour that text sits on is checked
// for contrast (WCAG 2), and the text colour is chosen to pass: white or ink on
// the hero, and a link colour darkened or lightened until it reads on both the
// light and the dark page.

import { screenshotBoards } from '@/lib/creative/specs';
import type { ArtboardState, ShapeElementProps, TextElementProps } from '@/types/artboard';
import type { SiteTheme } from './types';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(). Null for anything else or a colour that is mostly see-through. */
export function parseColor(value: string | undefined | null): Rgb | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  let match = /^#([0-9a-f]{3,8})$/.exec(text);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((digit) => digit + digit).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    if (alpha < 0.5) return null;
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  }
  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text);
  if (match) {
    const alphaText = match[4];
    const alpha = alphaText === undefined ? 1 : alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
    if (alpha < 0.5) return null;
    const clamp = (part: string) => Math.max(0, Math.min(255, Math.round(parseFloat(part))));
    return { r: clamp(match[1]), g: clamp(match[2]), b: clamp(match[3]) };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: Rgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function toHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === red) h = (green - blue) / d + (green < blue ? 6 : 0);
  else if (max === green) h = (blue - red) / d + 2;
  else h = (red - green) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const part = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: part(hue + 1 / 3) * 255, g: part(hue) * 255, b: part(hue - 1 / 3) * 255 };
}

export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return { r: a.r + (b.r - a.r) * amount, g: a.g + (b.g - a.g) * amount, b: a.b + (b.b - a.b) * amount };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
/** The page's ink and paper, which render.ts uses too. */
export const INK: Rgb = { r: 13, g: 17, b: 23 };
export const DARK_PAPER: Rgb = { r: 11, g: 13, b: 18 };

/** Distance between two colours, roughly as an eye sees it (a weighted RGB distance). */
function distance(a: Rgb, b: Rgb): number {
  const mean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db);
}

/** A colour that is not white, black or grey, which a brand colour usually is. */
function isColourful(color: Rgb): boolean {
  const { s, l } = toHsl(color);
  return s > 0.18 && l > 0.08 && l < 0.94;
}

export interface Weighted {
  color: Rgb;
  weight: number;
}

/** Near enough colours added together, heaviest first. */
function cluster(samples: Weighted[], within = 40): Weighted[] {
  const groups: Weighted[] = [];
  for (const sample of samples) {
    const near = groups.find((group) => distance(group.color, sample.color) < within);
    if (near) {
      const total = near.weight + sample.weight;
      near.color = mix(near.color, sample.color, sample.weight / total);
      near.weight = total;
    } else {
      groups.push({ color: { ...sample.color }, weight: sample.weight });
    }
  }
  return groups.sort((a, b) => b.weight - a.weight);
}

/** What the screenshots' backgrounds and text say about the colours, before any pixels are read. */
export interface BoardColours {
  /** Background colours with how much of the screenshots they cover. */
  grounds: Weighted[];
  /** Colours of the text and shapes, for an accent. */
  inks: Weighted[];
  /** Boards whose background is a picture, so their pixels have to be read. */
  pictured: string[];
}

export function boardColours(artboards: ArtboardState[]): BoardColours {
  const grounds: Weighted[] = [];
  const inks: Weighted[] = [];
  const pictured: string[] = [];
  for (const board of screenshotBoards(artboards)) {
    const area = board.size.width * board.size.height;
    if (board.backgroundImage) pictured.push(board.id);
    if (board.backgroundType === 'gradient' && board.backgroundGradient) {
      const first = parseColor(board.backgroundGradient.color1);
      const second = parseColor(board.backgroundGradient.color2);
      if (first) grounds.push({ color: first, weight: area / 2 });
      if (second) grounds.push({ color: second, weight: area / 2 });
    } else {
      const solid = parseColor(board.backgroundColor);
      if (solid) grounds.push({ color: solid, weight: area });
    }
    for (const element of board.elements) {
      if (element.type === 'text') {
        const text = element as TextElementProps;
        const color = parseColor(text.color);
        if (color) inks.push({ color, weight: Math.max(1, text.fontSize) * Math.max(1, (text.content ?? '').length) });
      } else if (element.type === 'shape') {
        const shape = element as ShapeElementProps;
        if ((shape.fillOpacity ?? 1) < 0.5) continue;
        const color = parseColor(shape.fillGradient?.color1 ?? shape.fillColor);
        if (color) inks.push({ color, weight: (shape.size.width * shape.size.height) / 40 });
      }
    }
  }
  return { grounds, inks, pictured };
}

/**
 * The common colours of an image's pixels, heaviest first. `pixels` is RGBA
 * data, such as a small canvas's getImageData; see-through pixels are skipped.
 */
export function sampleColors(pixels: Uint8ClampedArray, step = 1): Weighted[] {
  const samples: Weighted[] = [];
  for (let at = 0; at + 3 < pixels.length; at += 4 * step) {
    if (pixels[at + 3] < 128) continue;
    samples.push({ color: { r: pixels[at], g: pixels[at + 1], b: pixels[at + 2] }, weight: 1 });
  }
  return cluster(samples, 48).slice(0, 8);
}

const DEFAULT_BRAND: Rgb = { r: 79, g: 70, b: 229 };

/** The gradient partner of a colour when the screenshots give only one. */
function partnerOf(color: Rgb): Rgb {
  const hsl = toHsl(color);
  if (hsl.s < 0.12) return fromHsl({ ...hsl, l: hsl.l > 0.5 ? hsl.l - 0.12 : hsl.l + 0.12 });
  return fromHsl({ h: hsl.h + 28, s: Math.min(1, hsl.s * 1.05), l: Math.min(0.62, Math.max(0.28, hsl.l + (hsl.l > 0.5 ? -0.08 : 0.06))) });
}

export interface ThemeSources {
  boards?: BoardColours;
  /** Colours read from the pictures of pictured boards, heaviest first. */
  sampled?: Weighted[];
  /** Colours read from the app icon. */
  icon?: Weighted[];
}

/** The colours the site would take from what it has: the screenshots, then the icon, then a default. */
export function suggestColours(sources: ThemeSources): Pick<SiteTheme, 'source' | 'brand' | 'brand2' | 'accent'> {
  const grounds = cluster([...(sources.boards?.grounds ?? []), ...(sources.sampled ?? [])]);
  const fromIcon = cluster(sources.icon ?? []);
  const source: SiteTheme['source'] = grounds.length > 0 ? 'screenshots' : fromIcon.length > 0 ? 'icon' : 'default';
  const pool = grounds.length > 0 ? grounds : fromIcon;
  if (pool.length === 0) {
    const brand = DEFAULT_BRAND;
    return { source, brand: toHex(brand), brand2: toHex(partnerOf(brand)), accent: toHex(brand) };
  }
  // A white or black ground under colourful art still makes a pale or dark
  // site; the brand is the heaviest colourful ground when one covers a fair
  // share, and the heaviest ground otherwise.
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  const colourful = pool.find((entry) => isColourful(entry.color) && entry.weight >= total * 0.15);
  const brand = (colourful ?? pool[0]).color;
  const second = pool.find((entry) => entry.color !== brand && distance(entry.color, brand) > 60 && entry.weight >= total * 0.08);
  const brand2 = second && (isColourful(second.color) || !isColourful(brand)) ? second.color : partnerOf(brand);
  const inks = cluster(sources.boards?.inks ?? []).filter((entry) => isColourful(entry.color));
  const accent = inks.find((entry) => distance(entry.color, brand) > 40)?.color ?? (isColourful(brand) ? brand : inks[0]?.color ?? DEFAULT_BRAND);
  return { source, brand: toHex(brand), brand2: toHex(brand2), accent: toHex(accent) };
}

/** The heading face of the screenshots: the family and weight of their biggest text. */
export function suggestHeading(artboards: ArtboardState[]): Pick<SiteTheme, 'headingFont' | 'headingWeight'> {
  const counts = new Map<string, { family: string; weight: number; score: number }>();
  for (const board of screenshotBoards(artboards)) {
    const texts = board.elements.filter((element): element is TextElementProps => element.type === 'text' && !!(element as TextElementProps).content?.trim());
    const biggest = texts.sort((a, b) => b.fontSize - a.fontSize)[0];
    if (!biggest?.fontFamily) continue;
    const weight = weightNumber(biggest.fontWeight);
    const key = `${biggest.fontFamily}|${weight}`;
    const entry = counts.get(key) ?? { family: biggest.fontFamily, weight, score: 0 };
    entry.score += 1;
    counts.set(key, entry);
  }
  const best = [...counts.values()].sort((a, b) => b.score - a.score)[0];
  return best ? { headingFont: best.family, headingWeight: best.weight } : { headingFont: '', headingWeight: 700 };
}

export function weightNumber(weight: string | number | undefined): number {
  if (typeof weight === 'number') return weight;
  if (!weight || weight === 'normal') return 400;
  if (weight === 'bold') return 700;
  const parsed = parseInt(weight, 10);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(900, Math.round(parsed / 100) * 100)) : 700;
}

/** Darken or lighten `color` until it reaches `ratio` against `ground`. */
function readableOn(color: Rgb, ground: Rgb, ratio: number): Rgb {
  if (contrast(color, ground) >= ratio) return color;
  const hsl = toHsl(color);
  const darker = luminance(ground) > 0.4;
  for (let step = 1; step <= 20; step += 1) {
    const l = darker ? hsl.l - step * 0.04 : hsl.l + step * 0.04;
    const next = fromHsl({ ...hsl, l: Math.max(0, Math.min(1, l)) });
    if (contrast(next, ground) >= ratio) return next;
  }
  return darker ? INK : WHITE;
}

/** Every colour the stylesheet uses, worked out from the theme. */
export interface Palette {
  brand: string;
  brand2: string;
  /** Text on the hero and the call to action, white or ink, whichever reads on both ends of the gradient. */
  onBrand: string;
  /** True when that text is white, so the store buttons go light on the dark ground. */
  brandIsDark: boolean;
  /** A soft wash of the brand on the light and dark page, behind screenshots. */
  tintLight: string;
  tintDark: string;
  /** Links and small highlights, 4.5:1 or better on the light and the dark page. */
  linkLight: string;
  linkDark: string;
  /** The browser's bar colour on phones. */
  themeColor: string;
}

export function paletteOf(theme: Pick<SiteTheme, 'brand' | 'brand2' | 'accent'>): Palette {
  const brand = parseColor(theme.brand) ?? DEFAULT_BRAND;
  const brand2 = parseColor(theme.brand2) ?? partnerOf(brand);
  const accent = parseColor(theme.accent) ?? brand;
  const whiteScore = Math.min(contrast(WHITE, brand), contrast(WHITE, brand2));
  const inkScore = Math.min(contrast(INK, brand), contrast(INK, brand2));
  const brandIsDark = whiteScore >= inkScore;
  return {
    brand: toHex(brand),
    brand2: toHex(brand2),
    onBrand: brandIsDark ? '#ffffff' : toHex(INK),
    brandIsDark,
    tintLight: toHex(mix(WHITE, brand, 0.1)),
    tintDark: toHex(mix(DARK_PAPER, brand, 0.22)),
    linkLight: toHex(readableOn(accent, WHITE, 4.5)),
    linkDark: toHex(readableOn(accent, DARK_PAPER, 4.5)),
    themeColor: toHex(brand),
  };
}

/** The lowest contrast the hero's text gets on its gradient, for the view to warn about. */
export function heroContrast(theme: Pick<SiteTheme, 'brand' | 'brand2' | 'accent'>): number {
  const palette = paletteOf(theme);
  const text = parseColor(palette.onBrand)!;
  return Math.min(contrast(text, parseColor(palette.brand)!), contrast(text, parseColor(palette.brand2)!));
}
