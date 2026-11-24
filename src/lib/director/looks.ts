// The backdrops a film can have. Each is a gradient with two soft glows
// behind the phone, and the colours the phone's metal and glass reflect, so
// the phone looks lit by the scene it stands in rather than by a grey studio.

import type { FilmLook } from './types';

export interface Glow {
  color: string;
  /** The glow's centre, in picture heights from the middle (x to the right, y up). */
  x: number;
  y: number;
  /** Radius in picture heights. */
  r: number;
  /** 0 to 1. */
  strength: number;
}

export interface Backdrop {
  id: string;
  name: string;
  top: string;
  bottom: string;
  glows: [Glow, Glow];
  /** Light words on a dark backdrop, dark words on a light one. */
  dark: boolean;
  /** The reflections: the room's ceiling and floor, and the softbox colour. */
  room: { top: string; floor: string; light: string };
  /** How dark the phone's shadow is, 0 to 1. */
  shadow: number;
}

export const BACKDROPS: Backdrop[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    top: '#141a3d',
    bottom: '#05060f',
    glows: [
      { color: '#5b5bff', x: -0.42, y: 0.3, r: 0.62, strength: 0.75 },
      { color: '#ff4fb8', x: 0.46, y: -0.32, r: 0.52, strength: 0.55 },
    ],
    dark: true,
    room: { top: '#3a3f7a', floor: '#07070f', light: '#e9e6ff' },
    shadow: 0.55,
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    top: '#ffe6cc',
    bottom: '#ff9f8f',
    glows: [
      { color: '#ffd36e', x: -0.4, y: 0.34, r: 0.6, strength: 0.7 },
      { color: '#ff6fb0', x: 0.5, y: -0.36, r: 0.55, strength: 0.45 },
    ],
    dark: false,
    room: { top: '#ffd9c2', floor: '#6b3434', light: '#fff4e8' },
    shadow: 0.32,
  },
  {
    id: 'studio',
    name: 'Studio',
    top: '#f6f7f9',
    bottom: '#d6dae1',
    glows: [
      { color: '#ffffff', x: 0, y: 0.42, r: 0.7, strength: 0.65 },
      { color: '#c8d6ff', x: 0.5, y: -0.4, r: 0.5, strength: 0.3 },
    ],
    dark: false,
    room: { top: '#9aa0aa', floor: '#25272b', light: '#ffffff' },
    shadow: 0.28,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    top: '#15171b',
    bottom: '#000000',
    glows: [
      { color: '#3a7bff', x: 0.02, y: 0.04, r: 0.48, strength: 0.42 },
      { color: '#9b6bff', x: -0.5, y: -0.45, r: 0.45, strength: 0.25 },
    ],
    dark: true,
    room: { top: '#4a5160', floor: '#050506', light: '#eef3ff' },
    shadow: 0.6,
  },
  {
    id: 'mint',
    name: 'Mint',
    top: '#eafff7',
    bottom: '#a9efd8',
    glows: [
      { color: '#5fe3c0', x: -0.45, y: -0.3, r: 0.6, strength: 0.6 },
      { color: '#7cc7ff', x: 0.48, y: 0.38, r: 0.5, strength: 0.5 },
    ],
    dark: false,
    room: { top: '#bff2e2', floor: '#13352c', light: '#f4fffb' },
    shadow: 0.3,
  },
  {
    id: 'ember',
    name: 'Ember',
    top: '#2a0f0b',
    bottom: '#080303',
    glows: [
      { color: '#ff6a3d', x: 0.44, y: 0.3, r: 0.58, strength: 0.62 },
      { color: '#ffb547', x: -0.48, y: -0.36, r: 0.5, strength: 0.4 },
    ],
    dark: true,
    room: { top: '#7a3a26', floor: '#0a0403', light: '#fff0e2' },
    shadow: 0.55,
  },
];

export const DEFAULT_BACKDROP = 'aurora';

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

export type Rgb = [number, number, number];

/** #rgb, #rrggbb or rgb(r, g, b) to 0..1 channels; null for anything else. */
export function parseColor(value: string | undefined | null): Rgb | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16) / 255) as Rgb;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16) / 255) as Rgb;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)) / 255) as Rgb;
  return null;
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function mixRgb(a: Rgb, b: Rgb, u: number): Rgb {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/** Relative luminance (WCAG), 0 to 1. */
export function luminance(rgb: Rgb): number {
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function hsl(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

/**
 * A backdrop made from a project's colours: a deep version of the main
 * colour behind, the main colour and a second one as the glows. A pale
 * main colour gives a light backdrop instead.
 */
export function brandBackdrop(colors: [string, string, string]): Backdrop {
  const main = parseColor(colors[0]) ?? [0.36, 0.36, 1];
  const second = parseColor(colors[1]) ?? main;
  const [h, s] = hsl(main);
  const light = luminance(main) > 0.6;
  const sat = Math.max(0.35, Math.min(0.85, s));
  const top = light ? fromHsl(h, sat * 0.5, 0.94) : fromHsl(h, sat * 0.75, 0.14);
  const bottom = light ? fromHsl(h, sat * 0.6, 0.82) : fromHsl(h, sat * 0.8, 0.04);
  const glowA = light ? fromHsl(h, sat, 0.72) : fromHsl(h, Math.min(1, sat * 1.1), 0.55);
  const [h2, s2] = hsl(second);
  const glowB = Math.abs(h2 - h) < 0.04 ? fromHsl((h + 0.12) % 1, sat, light ? 0.75 : 0.58) : fromHsl(h2, Math.max(0.4, s2), light ? 0.74 : 0.56);
  return {
    id: 'brand',
    name: 'Your colours',
    top: toHex(top),
    bottom: toHex(bottom),
    glows: [
      { color: toHex(glowA), x: -0.42, y: 0.3, r: 0.62, strength: light ? 0.55 : 0.75 },
      { color: toHex(glowB), x: 0.46, y: -0.34, r: 0.52, strength: light ? 0.4 : 0.5 },
    ],
    dark: !light,
    room: light
      ? { top: toHex(mixRgb(top, [0.6, 0.6, 0.62], 0.5)), floor: toHex(fromHsl(h, sat * 0.4, 0.15)), light: '#ffffff' }
      : { top: toHex(fromHsl(h, sat * 0.6, 0.3)), floor: toHex(fromHsl(h, sat * 0.5, 0.03)), light: toHex(mixRgb(glowA, [1, 1, 1], 0.75)) },
    shadow: light ? 0.3 : 0.55,
  };
}

export function backdropFor(look: FilmLook): Backdrop {
  if (look.backdrop === 'brand' && look.colors) return brandBackdrop(look.colors);
  return BACKDROPS.find((b) => b.id === look.backdrop) ?? BACKDROPS[0];
}
