/**
 * The 3D model a Limelight device is built from, at its real size.
 *
 * Phones measured from their makers' drawings are their own size already.
 * The others share the editor's plain stand-in shape, which there only has
 * to have the right proportions: an artboard scales a device to fit. On a
 * Limelight stage every device stands on one floor beside the others, so an
 * iPad Pro 13-inch has to be bigger than a 7-inch tablet. Each one gets its
 * real body size: from Apple's tech specs where it is a real product, and
 * from the screen size in its name where it is a generic one. The generic
 * phones (iPhone Classic and the Android stand-ins) keep the stand-in's
 * 72 mm, a phone's usual width.
 */

import type { DeviceType } from '@/types/artboard';
import type { GenericModelSize } from '@/lib/device3dModels';
import { genericModelFor, isMeasuredModel, studioModelFor, type PhoneModel } from '@/lib/device3dStudio';

/** A generic tablet's body from its screen: the diagonal in inches, width over height, and an even bezel in mm. */
function fromScreen(inches: number, aspect: number, bezel: number, thickness: number): GenericModelSize {
  const height = (inches * 25.4) / Math.hypot(aspect, 1);
  return { width: height * aspect + 2 * bezel, height: height + 2 * bezel, thickness };
}

/** Body sizes in millimetres for the devices without a measured model. */
export const REAL_SIZES: Partial<Record<DeviceType, GenericModelSize>> = {
  // Apple's tech specs pages (support.apple.com, Size and Weight).
  'ipad-pro-13': { width: 215.5, height: 281.6, thickness: 5.1 }, // iPad Pro 13-inch, M4 and M5
  'ipad-11': { width: 177.5, height: 249.7, thickness: 5.3 }, // iPad Pro 11-inch, M4 and M5: the 1668 x 2420 screen
  'iphone-x': { width: 70.9, height: 143.6, thickness: 7.7 },
  'iphone-13': { width: 71.5, height: 146.7, thickness: 7.65 },
  'iphone-14': { width: 71.5, height: 146.7, thickness: 7.8 },
  'iphone-15': { width: 71.6, height: 147.6, thickness: 7.8 },
  'iphone-15-pro': { width: 70.6, height: 146.6, thickness: 8.25 },
  // Generic tablets, from the screen size each is named for.
  'tablet-7': fromScreen(7, 800 / 1280, 10, 8.5),
  'tablet-10': fromScreen(10, 1600 / 2560, 9, 7.5),
  tablet: fromScreen(10.2, 768 / 1024, 9.5, 7.5),
};

const CACHE = new Map<DeviceType, PhoneModel | null>();

/** The model a device is built from on the stage: its measured one, or a plain one at its real size. */
export function stageModelFor(device: DeviceType): PhoneModel | null {
  const size = REAL_SIZES[device];
  if (!size || isMeasuredModel(device)) return studioModelFor(device);
  if (!CACHE.has(device)) CACHE.set(device, genericModelFor(device, size));
  return CACHE.get(device) ?? null;
}
