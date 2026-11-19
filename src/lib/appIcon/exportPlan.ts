/**
 * Every file an icon export writes, where it goes, and how each is drawn from
 * the icon's two layers. Pure, so the file list, the JSON and the XML can be
 * read in a test without a browser; raster.ts does the drawing.
 */

import { ANDROID_DENSITIES, ANDROID_LAYER_DP, ANDROID_LEGACY_DP, ICON_SIZE } from './specs';

export type IconTarget = 'ios' | 'android' | 'play' | 'mac' | 'layers';

export interface IconTargetSpec {
  id: IconTarget;
  label: string;
  /** What it is for, in a line. */
  blurb: string;
  /** Ticked the first time the export opens. */
  defaultOn: boolean;
}

export const ICON_TARGETS: readonly IconTargetSpec[] = [
  { id: 'ios', label: 'iPhone and iPad', blurb: 'Files for your iPhone and iPad app', defaultOn: true },
  { id: 'android', label: 'Android', blurb: 'Files for your Android app, in every size', defaultOn: true },
  { id: 'play', label: 'Google Play', blurb: 'The picture for your Google Play store page', defaultOn: true },
  { id: 'mac', label: 'Mac', blurb: 'Files for your Mac app', defaultOn: false },
  { id: 'layers', label: 'Front and back as two pictures', blurb: "For Apple's Icon Composer app, to make the new glass look", defaultOn: false },
];

/** How one picture is drawn from the captures. */
export type IconRecipe =
  /** The whole icon, square, with no alpha channel (App Store Connect turns one away). */
  | { kind: 'full'; size: number; noAlpha: boolean }
  /** iOS dark: the front alone on transparent, white when the icon asks for it. */
  | { kind: 'dark'; size: number }
  /** iOS tinted: the front in grey on black, opaque, no alpha channel. */
  | { kind: 'tinted'; size: number }
  /** An Android layer: 108 dp, the board in its middle 72 dp. */
  | { kind: 'android-layer'; layer: 'front' | 'back' | 'mono'; size: number }
  /** A launcher icon for Android before 8.0, which has no layers. */
  | { kind: 'android-legacy'; shape: 'rounded' | 'circle'; size: number }
  /** A Mac icon: the rounded body inside the canvas, with its shadow. */
  | { kind: 'mac'; size: number }
  /** One layer alone at 1024, for Icon Composer. */
  | { kind: 'layer'; layer: 'front' | 'back'; size: number };

export interface PlannedFile {
  /** Inside the export's own folder, with forward slashes. */
  path: string;
  target: IconTarget;
  /** A picture to draw, or text to write as it is, or the .icns built from the Mac pictures. */
  recipe?: IconRecipe;
  text?: string;
  icns?: true;
}

/** The export's folder, from the app's name: "Pebble icon". */
export function exportFolderName(appName: string): string {
  const name = appName.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return name ? `${name} icon` : 'App icon';
}

// --- iOS --------------------------------------------------------------------------

export const IOS_SET = 'ios/AppIcon.appiconset';

/** Xcode's own format, as its AppIcon template writes it (Xcode 26.6). */
export function iosContentsJson(files: { light: string; dark: string; tinted: string }): string {
  const entry = (filename: string, value?: 'dark' | 'tinted') => ({
    ...(value ? { appearances: [{ appearance: 'luminosity', value }] } : {}),
    filename,
    idiom: 'universal',
    platform: 'ios',
    size: '1024x1024',
  });
  return `${JSON.stringify(
    { images: [entry(files.light), entry(files.dark, 'dark'), entry(files.tinted, 'tinted')], info: { author: 'xcode', version: 1 } },
    null,
    2
  )}\n`;
}

// --- macOS ------------------------------------------------------------------------

export const MAC_SET = 'macos/AppIcon.appiconset';

/** The Mac's sizes in points, each at 1x and 2x. */
export const MAC_POINTS = [16, 32, 128, 256, 512] as const;

export function macFileName(points: number, scale: 1 | 2): string {
  return scale === 1 ? `icon_${points}x${points}.png` : `icon_${points}x${points}@2x.png`;
}

export function macContentsJson(): string {
  const images = MAC_POINTS.flatMap((points) =>
    ([1, 2] as const).map((scale) => ({
      filename: macFileName(points, scale),
      idiom: 'mac',
      scale: `${scale}x`,
      size: `${points}x${points}`,
    }))
  );
  return `${JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2)}\n`;
}

// --- Android ----------------------------------------------------------------------

export const ANDROID_RES = 'android/res';

export function adaptiveIconXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <background android:drawable="@mipmap/ic_launcher_background" />',
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />',
    '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />',
    '</adaptive-icon>',
    '',
  ].join('\n');
}

// --- the plan -------------------------------------------------------------------------

export function readmeText(appName: string, targets: readonly IconTarget[]): string {
  const name = appName.trim() || 'Your app';
  const lines = [`${name} icon, made with Open Screenshot Generator`, ''];
  if (targets.includes('ios')) {
    lines.push(
      'ios/AppIcon.appiconset',
      "  In Xcode, open Assets.xcassets and replace AppIcon with this folder. It has the light, dark and tinted icons for iPhone and iPad.",
      ''
    );
  }
  if (targets.includes('android')) {
    lines.push(
      'android/res',
      '  Copy the mipmap folders into your app\'s res folder, usually app/src/main/res. The themed icon needs compileSdk 33 or later.',
      ''
    );
  }
  if (targets.includes('play')) {
    lines.push('google-play/icon-512.png', '  In Play Console, upload it as the app icon on your main store listing.', '');
  }
  if (targets.includes('mac')) {
    lines.push(
      'macos',
      "  AppIcon.appiconset goes into a Mac app's Assets.xcassets. AppIcon.icns is for a Mac app built another way, such as with Tauri or Electron.",
      ''
    );
  }
  if (targets.includes('layers')) {
    lines.push(
      'icon-composer',
      "  Open Apple's Icon Composer and drop the two pictures in as two groups, 1-background first. It adds the Liquid Glass look.",
      ''
    );
  }
  return lines.join('\n');
}

/** Every file for the targets ticked, in the order they are written. */
export function planIconExport(appName: string, targets: readonly IconTarget[]): PlannedFile[] {
  const files: PlannedFile[] = [];
  const wanted = new Set(targets);

  if (wanted.has('ios')) {
    const light = 'AppIcon.png';
    const dark = 'AppIcon-Dark.png';
    const tinted = 'AppIcon-Tinted.png';
    files.push(
      { path: `${IOS_SET}/${light}`, target: 'ios', recipe: { kind: 'full', size: ICON_SIZE, noAlpha: true } },
      { path: `${IOS_SET}/${dark}`, target: 'ios', recipe: { kind: 'dark', size: ICON_SIZE } },
      { path: `${IOS_SET}/${tinted}`, target: 'ios', recipe: { kind: 'tinted', size: ICON_SIZE } },
      { path: `${IOS_SET}/Contents.json`, target: 'ios', text: iosContentsJson({ light, dark, tinted }) }
    );
  }

  if (wanted.has('android')) {
    files.push(
      { path: `${ANDROID_RES}/mipmap-anydpi-v26/ic_launcher.xml`, target: 'android', text: adaptiveIconXml() },
      { path: `${ANDROID_RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, target: 'android', text: adaptiveIconXml() }
    );
    for (const density of ANDROID_DENSITIES) {
      const folder = `${ANDROID_RES}/mipmap-${density.id}`;
      const layer = Math.round(ANDROID_LAYER_DP * density.scale);
      const legacy = Math.round(ANDROID_LEGACY_DP * density.scale);
      files.push(
        { path: `${folder}/ic_launcher_foreground.png`, target: 'android', recipe: { kind: 'android-layer', layer: 'front', size: layer } },
        { path: `${folder}/ic_launcher_background.png`, target: 'android', recipe: { kind: 'android-layer', layer: 'back', size: layer } },
        { path: `${folder}/ic_launcher_monochrome.png`, target: 'android', recipe: { kind: 'android-layer', layer: 'mono', size: layer } },
        { path: `${folder}/ic_launcher.png`, target: 'android', recipe: { kind: 'android-legacy', shape: 'rounded', size: legacy } },
        { path: `${folder}/ic_launcher_round.png`, target: 'android', recipe: { kind: 'android-legacy', shape: 'circle', size: legacy } }
      );
    }
  }

  if (wanted.has('play')) {
    files.push({ path: 'google-play/icon-512.png', target: 'play', recipe: { kind: 'full', size: 512, noAlpha: false } });
  }

  if (wanted.has('mac')) {
    for (const points of MAC_POINTS) {
      for (const scale of [1, 2] as const) {
        files.push({ path: `${MAC_SET}/${macFileName(points, scale)}`, target: 'mac', recipe: { kind: 'mac', size: points * scale } });
      }
    }
    files.push(
      { path: `${MAC_SET}/Contents.json`, target: 'mac', text: macContentsJson() },
      { path: 'macos/AppIcon.icns', target: 'mac', icns: true }
    );
  }

  if (wanted.has('layers')) {
    files.push(
      { path: 'icon-composer/1-background.png', target: 'layers', recipe: { kind: 'layer', layer: 'back', size: ICON_SIZE } },
      { path: 'icon-composer/2-front.png', target: 'layers', recipe: { kind: 'layer', layer: 'front', size: ICON_SIZE } }
    );
  }

  if (files.length > 0) files.unshift({ path: 'README.txt', target: targets[0], text: readmeText(appName, targets) });
  return files;
}

/**
 * The .icns entries a Mac icon carries, by type, with the pixel size of the
 * PNG inside. 16 and 32 point icons at 1x have older formats of their own and
 * are left to the 2x entries, which macOS has read since 10.7.
 */
export const ICNS_ENTRIES = [
  { type: 'ic11', pixels: 32 },
  { type: 'ic12', pixels: 64 },
  { type: 'ic07', pixels: 128 },
  { type: 'ic13', pixels: 256 },
  { type: 'ic08', pixels: 256 },
  { type: 'ic14', pixels: 512 },
  { type: 'ic09', pixels: 512 },
  { type: 'ic10', pixels: 1024 },
] as const;
