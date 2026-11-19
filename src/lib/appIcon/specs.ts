/**
 * The app icon artboard: what it is, its two layers, and the shapes and sizes
 * each store shows it at.
 *
 * The board is the icon as iOS shows it: 1024 x 1024, opaque, cut to Apple's
 * rounded square by the system. Every other size and store is made from it
 * on export (exportPlan.ts), so there is one design to keep up to date.
 *
 * It has two layers, because Android and Apple's newer icons both need them
 * apart. The back layer is the board's own colour, gradient and picture plus
 * any element marked `iconLayer: 'back'`. Everything else is the front.
 *
 * Sources:
 *   - iOS: one 1024 x 1024 image; Xcode makes every other size from it. The
 *     dark version has a transparent background "so the system-provided
 *     background can show through", and the tinted one is "a grayscale image"
 *     (Apple, "Configuring your app icon using an asset catalog", read
 *     2026-11-18). Tinted is fully opaque grayscale (Create with Swift, June
 *     2024). The JSON is Xcode 26.6's own AppIcon template, read off this Mac.
 *   - macOS: an image for each size from 16 to 512 at 1x and 2x (same Apple
 *     page); the file names are the ones `iconutil` and Xcode use, checked
 *     against a real Mac project. The body of a Mac icon is the rounded
 *     square at 824 of 1024 pixels, from Apple's Big Sur icon template.
 *   - Android adaptive icons: two 108 dp layers, of which the middle 72 dp
 *     show through the launcher's mask, and the middle 66 dp circle is never
 *     cut by any mask. The board is that 72 dp window, so on a circle mask
 *     Android shows the circle inside the board.
 *   - Google Play: a 512 x 512 PNG, drawn full square; Google Play rounds the
 *     corners itself.
 */

import type { AppIconSettings, ArtboardElement, ArtboardState } from '@/types/artboard';

/** The board's size, and the size of Apple's App Store icon. */
export const ICON_SIZE = 1024;

/** What a new icon artboard is called on the canvas. */
export const ICON_BOARD_NAME = 'App icon';

export function isIconBoard(board: Pick<ArtboardState, 'appIcon'>): boolean {
  return !!board.appIcon && typeof board.appIcon === 'object';
}

export function iconBoards<T extends Pick<ArtboardState, 'appIcon'>>(boards: readonly T[]): T[] {
  return boards.filter(isIconBoard);
}

/** The project's icon: the first icon artboard in canvas order. */
export function projectIconBoard<T extends Pick<ArtboardState, 'appIcon'>>(boards: readonly T[]): T | undefined {
  return boards.find(isIconBoard);
}

export function iconSettings(board: Pick<ArtboardState, 'appIcon'>): AppIconSettings {
  return board.appIcon && typeof board.appIcon === 'object' ? board.appIcon : {};
}

// --- the two layers -----------------------------------------------------------

export type IconLayer = 'front' | 'back';

export function iconLayerOf(element: Pick<ArtboardElement, 'iconLayer'>): IconLayer {
  return element.iconLayer === 'back' ? 'back' : 'front';
}

/** Elements drawn into a layer, in canvas order. Sound layers draw nothing. */
export function layerElements(board: Pick<ArtboardState, 'elements'>, layer: IconLayer): ArtboardElement[] {
  return board.elements.filter((element) => element.type !== 'audio' && iconLayerOf(element) === layer);
}

/**
 * The board with one layer only, for anything that draws a layer on its own:
 * the dark and tinted previews, the Android layers, the checks.
 *
 * The front layer has no ground at all, so what is under it shows through.
 * The back layer keeps the board's colour, gradient and picture.
 */
export function layerBoard(board: ArtboardState, layer: IconLayer): ArtboardState {
  const elements = layerElements(board, layer);
  if (layer === 'back') return { ...board, elements };
  return {
    ...board,
    elements,
    backgroundType: 'solid',
    backgroundColor: 'transparent',
    backgroundGradient: undefined,
    backgroundImage: undefined,
    backgroundImageTintColor: undefined,
    backgroundImageTintOpacity: undefined,
  };
}

/**
 * Back-layer elements sit under every front-layer one, so the canvas draws
 * the icon the way its two layers come out. Order within a layer is kept.
 */
export function withLayersInOrder(elements: ArtboardElement[]): ArtboardElement[] {
  const back = elements.filter((element) => iconLayerOf(element) === 'back');
  if (back.length === 0 || back.length === elements.length) return elements;
  const front = elements.filter((element) => iconLayerOf(element) === 'front');
  const sorted = [...back, ...front];
  return sorted.every((element, index) => element === elements[index]) ? elements : sorted;
}

// --- Android ------------------------------------------------------------------

/** An adaptive icon layer, in dp. */
export const ANDROID_LAYER_DP = 108;
/** The middle part a launcher's mask shows, in dp. The board is this part. */
export const ANDROID_VIEWPORT_DP = 72;
/** The circle no mask ever cuts, in dp. */
export const ANDROID_SAFE_DP = 66;
/** A layer is this many times the board. */
export const ANDROID_LAYER_SCALE = ANDROID_LAYER_DP / ANDROID_VIEWPORT_DP;
/** The safe circle's diameter, as a share of the board's width. */
export const ANDROID_SAFE_SHARE = ANDROID_SAFE_DP / ANDROID_VIEWPORT_DP;

/** The safe circle on a board of this size: centre and radius in board pixels. */
export function androidSafeCircle(size: { width: number; height: number }): { cx: number; cy: number; r: number } {
  return { cx: size.width / 2, cy: size.height / 2, r: (Math.min(size.width, size.height) * ANDROID_SAFE_SHARE) / 2 };
}

/** The masks Android launchers cut an adaptive icon to. Pixel phones use the circle. */
export type AndroidMask = 'circle' | 'squircle' | 'rounded' | 'teardrop';

export const ANDROID_MASKS: { id: AndroidMask; label: string }[] = [
  { id: 'circle', label: 'Circle' },
  { id: 'squircle', label: 'Soft square' },
  { id: 'rounded', label: 'Rounded square' },
  { id: 'teardrop', label: 'Teardrop' },
];

/** Screen densities and their scale, with what a 48 dp launcher icon and a 108 dp layer come to. */
export const ANDROID_DENSITIES = [
  { id: 'mdpi', scale: 1 },
  { id: 'hdpi', scale: 1.5 },
  { id: 'xhdpi', scale: 2 },
  { id: 'xxhdpi', scale: 3 },
  { id: 'xxxhdpi', scale: 4 },
] as const;

export const ANDROID_LEGACY_DP = 48;

// --- Apple's rounded square --------------------------------------------------

/**
 * Apple's icon shape, as a superellipse. Apple draws its own curve with
 * continuous corners and publishes no formula; an exponent of 5 follows it
 * closely at icon sizes. The canvas guide, the previews and the Mac export
 * all use this one shape, so they agree with each other.
 */
export const APPLE_SHAPE_EXPONENT = 5;

/** Points around a superellipse filling `size`, clockwise from the right. */
export function superellipsePoints(size: number, exponent = APPLE_SHAPE_EXPONENT, steps = 192): { x: number; y: number }[] {
  const half = size / 2;
  const power = 2 / exponent;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    points.push({
      x: half + half * Math.sign(cos) * Math.abs(cos) ** power,
      y: half + half * Math.sign(sin) * Math.abs(sin) ** power,
    });
  }
  return points;
}

/** The shape as an SVG path in a `size` x `size` box. */
export function superellipsePath(size: number, exponent = APPLE_SHAPE_EXPONENT): string {
  const points = superellipsePoints(size, exponent);
  const round = (value: number) => Math.round(value * 100) / 100;
  return `M${points.map((point) => `${round(point.x)} ${round(point.y)}`).join('L')}Z`;
}

/** A data: URL of the shape, for a CSS mask on a preview of any size. */
export function shapeMaskUrl(exponent = APPLE_SHAPE_EXPONENT): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><path d="${superellipsePath(1000, exponent)}" fill="#000"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The body of a Mac icon, as a share of the canvas: 824 of 1024 in Apple's template. */
export const MAC_BODY_SHARE = 824 / 1024;

/** Google Play rounds an icon's corners by this share of its size. */
export const PLAY_CORNER_SHARE = 0.2;

// --- sizes people see ----------------------------------------------------------

export type IconPlatform = 'ios' | 'android' | 'mac';

/**
 * The sizes the "real size" strip shows, in points (dp on Android), the way
 * each system draws them on a standard screen.
 */
export const REAL_SIZES: Record<IconPlatform, { points: number; label: string }[]> = {
  ios: [
    { points: 60, label: 'Home Screen' },
    { points: 40, label: 'Search' },
    { points: 29, label: 'Settings' },
    { points: 20, label: 'Notifications' },
  ],
  android: [
    { points: 48, label: 'Home screen' },
    { points: 36, label: 'All apps' },
    { points: 24, label: 'Notifications' },
  ],
  mac: [
    { points: 128, label: 'Finder' },
    { points: 64, label: 'Dock' },
    { points: 32, label: 'Lists' },
    { points: 16, label: 'Menus' },
  ],
};

/** The smallest size iOS shows the icon at in everyday use: the Settings list. */
export const IOS_SMALLEST_POINTS = 29;
/** The Home Screen, where people see it most. */
export const IOS_HOME_POINTS = 60;
