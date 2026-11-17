// The screens a project's design can be laid out again for: every store size
// the app knows, grouped by store, with the frame a screenshot of that device
// goes in.
//
// The sizes are DEVICE_FORMAT_PRESETS, the same list the toolbar's Convert
// menu, the Export dialog and the store upload use, so a set made here and an
// image exported or uploaded at that size are one and the same.

import type { DeviceType } from '@/types/artboard';
import { DEVICE_FORMAT_PRESETS, type DeviceFormat, type DeviceFormatPreset } from '@/lib/deviceRegistry';

export type DeviceSetStore = 'app-store' | 'google-play' | 'mac-app-store';
export type DeviceSetKind = 'phone' | 'tablet' | 'desktop';

export interface DeviceSetTarget {
  id: DeviceFormat;
  preset: DeviceFormatPreset;
  store: DeviceSetStore;
  kind: DeviceSetKind;
  /** The platform whose phone frames this store shows. */
  platform: 'ios' | 'android';
  /**
   * The frame a screenshot of this kind of device goes in. Phones have none:
   * a phone keeps its own model, or takes the platform's counterpart.
   */
  frame?: DeviceType;
  /** What the device is called in the Every device view. */
  name: string;
  /** Short line beside the size: what the store does with it, in plain words. */
  note: string;
}

const preset = (id: DeviceFormat): DeviceFormatPreset => {
  const found = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`No device format preset for ${id}`);
  return found;
};

export const DEVICE_SET_TARGETS: readonly DeviceSetTarget[] = [
  {
    id: 'ios',
    preset: preset('ios'),
    store: 'app-store',
    kind: 'phone',
    platform: 'ios',
    name: 'iPhone',
    note: 'The App Store asks for this size for every iPhone app',
  },
  {
    id: 'ios-large',
    preset: preset('ios-large'),
    store: 'app-store',
    kind: 'phone',
    platform: 'ios',
    name: 'Large iPhone',
    note: 'Optional on the App Store',
  },
  {
    id: 'ipad-pro-13',
    preset: preset('ipad-pro-13'),
    store: 'app-store',
    kind: 'tablet',
    platform: 'ios',
    frame: 'ipad-pro-13',
    name: 'iPad 13-inch',
    note: 'The App Store asks for this size if your app works on iPad',
  },
  {
    id: 'ipad-11',
    preset: preset('ipad-11'),
    store: 'app-store',
    kind: 'tablet',
    platform: 'ios',
    frame: 'ipad-11',
    name: 'iPad 11-inch',
    note: 'Optional on the App Store',
  },
  {
    id: 'android',
    preset: preset('android'),
    store: 'google-play',
    kind: 'phone',
    platform: 'android',
    name: 'Android phone',
    note: 'For phones on Google Play',
  },
  {
    id: 'tablet-7',
    preset: preset('tablet-7'),
    store: 'google-play',
    kind: 'tablet',
    platform: 'android',
    frame: 'tablet-7',
    name: '7-inch tablet',
    note: 'For small tablets on Google Play',
  },
  {
    id: 'tablet-10',
    preset: preset('tablet-10'),
    store: 'google-play',
    kind: 'tablet',
    platform: 'android',
    frame: 'tablet-10',
    name: '10-inch tablet',
    note: 'For big tablets on Google Play',
  },
  {
    id: 'mac',
    preset: preset('mac'),
    store: 'mac-app-store',
    kind: 'desktop',
    platform: 'ios',
    frame: 'macbook',
    name: 'Mac',
    note: 'For the Mac App Store',
  },
];

export const DEVICE_SET_STORES: ReadonlyArray<{ id: DeviceSetStore; label: string }> = [
  { id: 'app-store', label: 'App Store' },
  { id: 'google-play', label: 'Google Play' },
  { id: 'mac-app-store', label: 'Mac App Store' },
];

export function deviceSetTarget(id: DeviceFormat): DeviceSetTarget | undefined {
  return DEVICE_SET_TARGETS.find((target) => target.id === id);
}
