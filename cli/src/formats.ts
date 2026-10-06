import type { DeviceFormat } from '@/lib/deviceRegistry';
import { usageError } from './errors.js';

export type { DeviceFormat } from '@/lib/deviceRegistry';

/**
 * Config and flags speak the size-preset ids people see in the editor
 * (src/lib/sizePresets.ts, e.g. 'ios-6-3'); the bridge speaks DeviceFormat.
 * Only the presets whose canvas is byte-identical to a DeviceFormat preset are
 * here, because anything else would silently render at a size nobody asked for.
 */
const FORMAT_ALIASES: Readonly<Record<string, DeviceFormat>> = {
  ios: 'ios',
  'ios-large': 'ios-large',
  android: 'android',
  'ipad-pro-13': 'ipad-pro-13',
  'ipad-11': 'ipad-11',
  'tablet-7': 'tablet-7',
  'tablet-10': 'tablet-10',
  'ios-6-3': 'ios',
  'ios-6-9': 'ios-large',
  iphone: 'ios',
  'ipad-13': 'ipad-pro-13',
  ipad: 'ipad-pro-13',
  'play-phone': 'android',
  play: 'android',
  'play-10-hd': 'tablet-10',
};

/** Ways of saying "export the boards at the size they already are". */
const CANVAS_IDS = new Set(['as-is', 'asis', 'canvas', 'current', 'none']);

export function isCanvasFormat(id: string): boolean {
  return CANVAS_IDS.has(id.trim().toLowerCase());
}

/** The bridge's conversion id for a preset, or null to keep the current canvas. */
export function resolveDeviceFormat(id: string): DeviceFormat | null {
  if (isCanvasFormat(id)) return null;
  const normalized = id.trim().toLowerCase();
  const mapped = Object.hasOwn(FORMAT_ALIASES, normalized)
    ? FORMAT_ALIASES[normalized]
    : undefined;
  if (!mapped) {
    throw usageError(
      `Unknown format "${id}".`,
      `Convertible formats: ${Object.keys(FORMAT_ALIASES).sort().join(', ')}. ` +
        'Use --formats as-is to export the boards at the size they already are.'
    );
  }
  return mapped;
}
