/**
 * Colour arithmetic for generated graphics.
 *
 * Small on purpose. The intake flow already pulls a palette out of the user's
 * screenshots (`mergePalettes` in screenshotAnalysis.ts); everything here is
 * about turning one of those colours into a whole readable board: a ground, a
 * second gradient stop, and type that survives on top of it.
 *
 * Every function is pure and total. An unparseable colour degrades to the
 * fallback rather than throwing, because these run on a colour the user picked
 * out of a swatch grid on every keystroke.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const hex = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

/** Relative luminance, 0 (black) to 1 (white). The plain sRGB weighting. */
export function luminance(value: string): number {
  const rgb = hexToRgb(value);
  if (!rgb) return 0.5;
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

export function isDark(value: string): boolean {
  return luminance(value) < 0.5;
}

/** `amount` 0 keeps `a`, 1 gives `b`. */
export function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return a;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
  });
}

export function darken(value: string, amount: number): string {
  return mix(value, '#000000', amount);
}

export function lighten(value: string, amount: number): string {
  return mix(value, '#FFFFFF', amount);
}

/**
 * Type that reads on a given ground.
 *
 * Deliberately not a pure black/white flip: near-white type on a mid-tone brand
 * colour reads better with a trace of that colour in it, and pure black on a
 * pale tint looks like a bug report rather than a design.
 */
export function readableOn(ground: string): string {
  return isDark(ground) ? lighten(ground, 0.94) : darken(ground, 0.86);
}

/** The same, softened, for a subheading under a headline. */
export function mutedOn(ground: string): string {
  return isDark(ground) ? lighten(ground, 0.66) : darken(ground, 0.55);
}

/**
 * A brand colour pushed to somewhere it can carry a whole board.
 *
 * Screenshot palettes routinely come back near-white or near-black (a light app
 * on a light ground), and a board painted in those has no identity at all. This
 * pulls anything too pale or too dark back toward a usable mid tone while
 * keeping its hue.
 */
export function usableAccent(value: string, fallback = '#4F46E5'): string {
  const rgb = hexToRgb(value);
  if (!rgb) return fallback;
  const lum = luminance(value);
  // Grey has no hue to keep, so it cannot stand in as a brand colour.
  const spread = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
  if (spread < 18) return fallback;
  if (lum > 0.82) return darken(value, 0.42);
  if (lum < 0.1) return lighten(value, 0.34);
  return value;
}

/** The second stop of a gradient built from one brand colour. */
export function gradientPartner(value: string): string {
  const rgb = hexToRgb(value);
  if (!rgb) return darken(value, 0.35);
  // Rotating toward the neighbouring channel keeps the sweep from reading as a
  // brightness ramp of one flat colour, which is what a plain darken() gives.
  const rotated = rgbToHex({ r: rgb.b * 0.6 + rgb.r * 0.4, g: rgb.r * 0.45 + rgb.g * 0.55, b: rgb.g * 0.5 + rgb.b * 0.5 });
  return darken(mix(value, rotated, 0.5), 0.3);
}
