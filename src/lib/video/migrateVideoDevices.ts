// One-way migration for projects saved by the first cut of the App Preview
// feature, where a screen recording was a field on the SCREENSHOT device
// element (`screenVideoMediaId`) instead of its own element type. Those
// projects live in the user's IndexedDB, so loading must keep working.
//
// Runs on every project load (cheap: a type check per element, and it returns
// the original array untouched when there is nothing to convert).

import type { ArtboardState, ArtboardElement, VideoDeviceElementProps } from '@/types/artboard';

// The legacy shape: a 'device' element carrying recording fields.
interface LegacyScreenVideoDevice {
  type: 'device';
  screenVideoMediaId?: string;
  screenVideoTrimStart?: number;
  screenVideoTrimEnd?: number;
  screenshotObjectFit?: 'contain' | 'cover' | 'fill';
  screenshotSrc?: string;
}

function isLegacy(el: ArtboardElement): boolean {
  return el.type === 'device' && !!(el as unknown as LegacyScreenVideoDevice).screenVideoMediaId;
}

function convert(el: ArtboardElement): ArtboardElement {
  const legacy = el as unknown as LegacyScreenVideoDevice;
  const device = el as Extract<ArtboardElement, { type: 'device' }>;
  const migrated: VideoDeviceElementProps = {
    id: device.id,
    type: 'video-device',
    name: device.name,
    position: device.position,
    size: device.size,
    rotation: device.rotation,
    scale: device.scale,
    animation: device.animation,
    deviceType: device.deviceType,
    mediaId: legacy.screenVideoMediaId,
    trimStart: legacy.screenVideoTrimStart,
    trimEnd: legacy.screenVideoTrimEnd,
    objectFit: legacy.screenshotObjectFit ?? 'cover',
    // The old element's screenshot becomes the placeholder poster.
    posterSrc: legacy.screenshotSrc,
    frameColor: device.frameColor,
    frameOpacity: device.frameOpacity,
    frameStyle: device.frameStyle,
    notchColor: device.notchColor,
  };
  return migrated;
}

/** Convert legacy recording-on-device elements; returns the input if none. */
export function migrateVideoDevices(artboards: ArtboardState[]): ArtboardState[] {
  let changed = false;
  const next = artboards.map((ab) => {
    if (!ab.elements.some(isLegacy)) return ab;
    changed = true;
    return { ...ab, elements: ab.elements.map((el) => (isLegacy(el) ? convert(el) : el)) };
  });
  return changed ? next : artboards;
}
