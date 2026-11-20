/**
 * The sizes a Limelight video comes in and the looks a stage starts from.
 *
 * Store sizes are Apple's app preview resolutions (App Store Connect's
 * "App preview specifications": 886 x 1920 for every iPhone from 6.1 inches
 * up, 1200 x 1600 for the 13 inch iPad, 1920 x 1080 for the Mac, at most 30
 * frames a second, 15 to 30 seconds long). Google Play takes a YouTube link,
 * so its size is YouTube's.
 */

import type { LimelightBackdrop, LimelightEnvironment, LimelightLight } from './types';

export interface StoreRules {
  minSeconds: number;
  maxSeconds: number;
  maxFps: number;
}

export interface FormatPreset {
  id: string;
  /** The name in the size menu. */
  label: string;
  width: number;
  height: number;
  fps: number;
  /** What the store accepts, when a store is what the size is for. */
  rules?: StoreRules;
}

const APP_STORE: StoreRules = { minSeconds: 15, maxSeconds: 30, maxFps: 30 };

export const FORMAT_PRESETS: FormatPreset[] = [
  { id: 'app-store-iphone', label: 'App Store, iPhone', width: 886, height: 1920, fps: 30, rules: APP_STORE },
  { id: 'app-store-ipad', label: 'App Store, iPad', width: 1200, height: 1600, fps: 30, rules: APP_STORE },
  { id: 'app-store-mac', label: 'App Store, Mac', width: 1920, height: 1080, fps: 30, rules: APP_STORE },
  { id: 'google-play', label: 'Google Play and YouTube', width: 1920, height: 1080, fps: 30 },
  { id: 'story', label: 'Stories, Reels and TikTok', width: 1080, height: 1920, fps: 30 },
  { id: 'square', label: 'Square post', width: 1080, height: 1080, fps: 30 },
  { id: 'portrait', label: 'Portrait post', width: 1080, height: 1350, fps: 30 },
  { id: 'wide-4k', label: 'Wide, 4K', width: 3840, height: 2160, fps: 30 },
];

export const DEFAULT_FORMAT_PRESET = 'app-store-iphone';

export function formatPresetById(id: string | undefined): FormatPreset | undefined {
  return FORMAT_PRESETS.find((preset) => preset.id === id);
}

/** What the scene's size and length break of its store's rules, in words for the size menu. */
export function storeRuleProblem(
  format: { width: number; height: number; fps: number; duration: number; preset?: string }
): string | null {
  const preset = formatPresetById(format.preset);
  const rules = preset?.rules;
  if (!preset || !rules) return null;
  if (format.width !== preset.width || format.height !== preset.height) return null;
  if (format.duration < rules.minSeconds || format.duration > rules.maxSeconds) {
    return `The App Store takes previews of ${rules.minSeconds} to ${rules.maxSeconds} seconds`;
  }
  if (format.fps > rules.maxFps) return `The App Store takes previews of up to ${rules.maxFps} frames a second`;
  return null;
}

export interface EnvironmentPreset {
  id: LimelightEnvironment;
  /** The name on the look's card. */
  label: string;
  /** One short line on the card: when to pick it. */
  hint: string;
  backdrop: LimelightBackdrop;
  light: LimelightLight;
  exposure: number;
  shadow: number;
}

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    id: 'studio',
    label: 'Studio',
    hint: 'Soft grey, like a product photo',
    backdrop: { style: 'radial', top: '#f3f4f6', bottom: '#c9ced6' },
    light: { azimuth: 35, elevation: 38, intensity: 1 },
    exposure: 1,
    shadow: 0.55,
  },
  {
    id: 'daylight',
    label: 'Daylight',
    hint: 'Bright and clean',
    backdrop: { style: 'linear', top: '#ffffff', bottom: '#e9e7e2' },
    light: { azimuth: 25, elevation: 55, intensity: 1.15 },
    exposure: 1.05,
    shadow: 0.4,
  },
  {
    id: 'sunset',
    label: 'Sunset',
    hint: 'Warm light from low down',
    backdrop: { style: 'linear', top: '#ffb47e', bottom: '#5d3768' },
    light: { azimuth: 62, elevation: 14, intensity: 1.1 },
    exposure: 1,
    shadow: 0.5,
  },
  {
    id: 'night',
    label: 'Night',
    hint: 'Dark blue with coloured edges',
    backdrop: { style: 'radial', top: '#26305a', bottom: '#070912' },
    light: { azimuth: -40, elevation: 30, intensity: 0.9 },
    exposure: 1,
    shadow: 0.7,
  },
  {
    id: 'noir',
    label: 'Noir',
    hint: 'Black, with one strong light',
    backdrop: { style: 'radial', top: '#1c1c1f', bottom: '#000000' },
    light: { azimuth: 20, elevation: 70, intensity: 1.2 },
    exposure: 0.95,
    shadow: 0.8,
  },
];

export function environmentPreset(id: LimelightEnvironment): EnvironmentPreset {
  return ENVIRONMENT_PRESETS.find((preset) => preset.id === id) ?? ENVIRONMENT_PRESETS[0];
}
