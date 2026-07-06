import type { ArtboardElement, ArtboardState, DeviceFrameElementProps, DeviceType } from '@/types/artboard';

export type DevicePlatform = 'ios' | 'android' | 'neutral';
export type DeviceCategory = 'phone' | 'tablet' | 'desktop' | 'custom';
export type SwapPlatform = 'ios' | 'android';

export interface DeviceScreenGeometry {
  // Bezel insets as % of the device's effective width — ALL four sides derive
  // from width (matching DeviceFrameElement's bezelPx), so bezels stay uniform
  // at any element aspect ratio.
  paddingPercent: { top: number; right: number; bottom: number; left: number };
  // Screen corner radius as a fraction of effective width.
  radiusFactor: number;
}

export interface DeviceDescriptor {
  id: DeviceType;
  label: string;
  platform: DevicePlatform;
  category: DeviceCategory;
  // width / height of the real device. The frame itself stretches to the
  // element box, so this is only used to derive sensible bounds when swapping
  // across categories (phone <-> tablet/desktop).
  nativeAspect: number;
  // Screen area geometry; undefined for 'custom' (user-uploaded frame).
  // DeviceFrameElement renders the screen from this, and the swap engine uses
  // it to re-fit overlay elements authored on the screen area.
  screen?: DeviceScreenGeometry;
  // Preferred stand-in on the other platform. Chosen by matching cutout style:
  // bar <-> no-notch classic, notch <-> notch, punch hole <-> Dynamic Island.
  // The mapping is many-to-one (three iPhone models share one Android look),
  // so a platform round-trip is lossy by design — undo restores exactly.
  counterpart?: DeviceType;
}

export const DEVICE_REGISTRY: Record<DeviceType, DeviceDescriptor> = {
  'iphone': { id: 'iphone', label: 'iPhone (Classic)', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: 'android-bar', screen: { paddingPercent: { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 }, radiusFactor: 0.08 } },
  'iphone-x': { id: 'iphone-x', label: 'iPhone X', platform: 'ios', category: 'phone', nativeAspect: 375 / 812, counterpart: 'android-notch', screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.09 } },
  'iphone-13': { id: 'iphone-13', label: 'iPhone 13', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: 'android-notch', screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.09 } },
  'iphone-14': { id: 'iphone-14', label: 'iPhone 14', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: 'android-notch', screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.1 } },
  'iphone-15': { id: 'iphone-15', label: 'iPhone 15', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: 'android-punch-hole', screen: { paddingPercent: { top: 2.5, right: 3, bottom: 2.5, left: 3 }, radiusFactor: 0.11 } },
  'iphone-15-pro': { id: 'iphone-15-pro', label: 'iPhone 15 Pro', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: 'android-punch-hole', screen: { paddingPercent: { top: 2.5, right: 3, bottom: 2.5, left: 3 }, radiusFactor: 0.11 } },
  'iphone-17-pro-max': { id: 'iphone-17-pro-max', label: 'iPhone 17 Pro Max', platform: 'ios', category: 'phone', nativeAspect: 440 / 956, counterpart: 'android-punch-hole', screen: { paddingPercent: { top: 2.4, right: 2.8, bottom: 2.4, left: 2.8 }, radiusFactor: 0.115 } },
  'android-bar': { id: 'android-bar', label: 'Android (Bar)', platform: 'android', category: 'phone', nativeAspect: 1080 / 2340, counterpart: 'iphone', screen: { paddingPercent: { top: 6, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  'android-notch': { id: 'android-notch', label: 'Android (Notch)', platform: 'android', category: 'phone', nativeAspect: 1080 / 2340, counterpart: 'iphone-14', screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  'android-punch-hole': { id: 'android-punch-hole', label: 'Android (Punch Hole)', platform: 'android', category: 'phone', nativeAspect: 1080 / 2400, counterpart: 'iphone-15', screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  'tablet': { id: 'tablet', label: 'Tablet', platform: 'neutral', category: 'tablet', nativeAspect: 768 / 1024, screen: { paddingPercent: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }, radiusFactor: 0.016 } },
  'desktop': { id: 'desktop', label: 'Desktop Monitor', platform: 'neutral', category: 'desktop', nativeAspect: 16 / 9, screen: { paddingPercent: { top: 1.5, right: 1.5, bottom: 3.5, left: 1.5 }, radiusFactor: 0.009 } },
  'custom': { id: 'custom', label: 'Custom Mockup', platform: 'neutral', category: 'custom', nativeAspect: 9 / 16 },
};

export function getDeviceDescriptor(id: DeviceType): DeviceDescriptor {
  return DEVICE_REGISTRY[id] ?? DEVICE_REGISTRY.custom;
}

// Display names for the swappable platforms — used by the toolbar menu,
// its button label, and swap toasts so they can never disagree.
export const PLATFORM_LABELS: Record<SwapPlatform, string> = {
  ios: 'iPhone',
  android: 'Android',
};

// Picker groups, computed once. 'custom' is excluded — it renders a
// user-uploaded frame image and has nothing to draw without one.
export const DEVICE_PICKER_GROUPS: ReadonlyArray<{
  label: string;
  platform: DevicePlatform;
  devices: DeviceDescriptor[];
}> = (
  [
    { label: 'iPhone', platform: 'ios' },
    { label: 'Android', platform: 'android' },
    { label: 'Other', platform: 'neutral' },
  ] as const
).map((g) => ({
  ...g,
  devices: Object.values(DEVICE_REGISTRY).filter(
    (d) => d.platform === g.platform && d.category !== 'custom'
  ),
}));

/**
 * The platform the project's device mockups are currently on: 'ios' or
 * 'android' when every platform-specific device agrees, 'mixed' when both are
 * present, and null when there are no platform-specific devices (only
 * tablet/desktop/custom, or none at all).
 */
export function detectArtboardsPlatform(
  artboards: ArtboardState[]
): SwapPlatform | 'mixed' | null {
  let found: SwapPlatform | null = null;
  for (const ab of artboards) {
    for (const el of ab.elements) {
      if (el.type !== 'device') continue;
      const platform = getDeviceDescriptor(el.deviceType).platform;
      if (platform === 'neutral') continue;
      if (found && found !== platform) return 'mixed';
      found = platform;
    }
  }
  return found;
}

export function swapTargetFor(id: DeviceType, platform: SwapPlatform): DeviceType | null {
  const desc = DEVICE_REGISTRY[id];
  if (!desc || desc.platform === platform) return null;
  return desc.counterpart ?? null;
}

/**
 * Pure transform: the element updates that turn `el` into `target`.
 *
 * Same-category swaps keep the element box untouched. The flat frame stretches
 * to the box (preserveAspectRatio="none") and the 3D body derives from the box
 * aspect, so a phone box tuned for one phone reads correctly for another —
 * templates already pair 0.50-aspect boxes with 0.462-aspect devices.
 *
 * Cross-category swaps (phone <-> tablet/desktop) preserve the element's AREA
 * and re-derive both sides from the target's native aspect, anchored on the
 * visual center (`position` is the top-left of the scaled box and rotation
 * pivots on the center). Area-preserving keeps the swapped mockup roughly the
 * same visual size in both directions — keep-width would balloon a wide
 * desktop into a phone ~4x its height and overflow the artboard.
 *
 * An element whose stored deviceType is not in the registry (hand-edited or
 * legacy JSON) is re-skinned without touching its bounds.
 *
 * Screenshot fields (screenshotSrc, screenshotObjectFit, screenshotRect) carry
 * over verbatim — the rect is percentages of the screen area and objectFit
 * re-crops to the new screen shape on its own.
 */
export function buildSwapUpdates(
  el: DeviceFrameElementProps,
  target: DeviceType
): Partial<DeviceFrameElementProps> {
  const from = DEVICE_REGISTRY[el.deviceType] as DeviceDescriptor | undefined;
  const to = DEVICE_REGISTRY[target] as DeviceDescriptor | undefined;
  if (!to || to.category === 'custom' || el.deviceType === target) return {};
  const updates: Partial<DeviceFrameElementProps> = { deviceType: target };
  if (from && from.category !== 'custom' && from.category !== to.category) {
    const area = el.size.width * el.size.height;
    const newWidth = Math.sqrt(area * to.nativeAspect);
    const newHeight = newWidth / to.nativeAspect;
    const scale = el.scale || 1;
    updates.size = { width: newWidth, height: newHeight };
    updates.position = {
      x: el.position.x + ((el.size.width - newWidth) * scale) / 2,
      y: el.position.y + ((el.size.height - newHeight) * scale) / 2,
    };
  }
  return updates;
}

export interface DeviceScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

/** Artboard-space rect + corner radius of a predefined device's screen area. */
export function getDeviceScreenRect(el: DeviceFrameElementProps): DeviceScreenRect | null {
  const screen = getDeviceDescriptor(el.deviceType).screen;
  if (!screen) return null;
  const scale = el.scale || 1;
  const w = el.size.width * scale;
  const h = el.size.height * scale;
  const px = (percent: number) => (w * percent) / 100;
  return {
    x: el.position.x + px(screen.paddingPercent.left),
    y: el.position.y + px(screen.paddingPercent.top),
    width: w - px(screen.paddingPercent.left) - px(screen.paddingPercent.right),
    height: h - px(screen.paddingPercent.top) - px(screen.paddingPercent.bottom),
    radius: w * screen.radiusFactor,
  };
}

// Template authors round positions to whole pixels, so screen-conforming
// overlays sit within a couple of px of the computed screen rect.
const SCREEN_MATCH_TOLERANCE = 3;

function isScreenConformingOverlay(el: ArtboardElement, screen: DeviceScreenRect): boolean {
  const adaptable =
    el.type === 'image' || (el.type === 'shape' && el.shapeType === 'rectangle');
  if (!adaptable || el.rotation) return false;
  const scale = el.scale || 1;
  return (
    Math.abs(el.position.x - screen.x) <= SCREEN_MATCH_TOLERANCE &&
    Math.abs(el.position.y - screen.y) <= SCREEN_MATCH_TOLERANCE &&
    Math.abs(el.size.width * scale - screen.width) <= SCREEN_MATCH_TOLERANCE * 2 &&
    Math.abs(el.size.height * scale - screen.height) <= SCREEN_MATCH_TOLERANCE * 2
  );
}

/**
 * Swap one device within an artboard's element list, screen-aware: overlay
 * images / rectangle shapes authored exactly on the device's screen area
 * (screen fills, pre-baked app screenshots) are re-fitted to the new device's
 * screen rect and corner radius, so they keep clipping to the frame after the
 * swap (e.g. Android's ~2%-radius screen vs an iPhone's 11%). Returns null
 * when there is nothing to swap.
 */
export function swapDeviceInElements(
  elements: ArtboardElement[],
  deviceId: string,
  target: DeviceType
): ArtboardElement[] | null {
  const device = elements.find(
    (el): el is DeviceFrameElementProps => el.type === 'device' && el.id === deviceId
  );
  if (!device) return null;
  const updates = buildSwapUpdates(device, target);
  if (!updates.deviceType) return null;
  const swappedDevice = { ...device, ...updates };
  // Overlay matching assumes an axis-aligned device; a rotated device rotates
  // its screen rect with it, so skip overlay adaptation there.
  const oldScreen = !device.rotation ? getDeviceScreenRect(device) : null;
  const newScreen = oldScreen ? getDeviceScreenRect(swappedDevice) : null;
  return elements.map((el) => {
    if (el.id === deviceId) return swappedDevice;
    if (!oldScreen || !newScreen || !isScreenConformingOverlay(el, oldScreen)) return el;
    const scale = el.scale || 1;
    return {
      ...el,
      position: { x: newScreen.x, y: newScreen.y },
      size: { width: newScreen.width / scale, height: newScreen.height / scale },
      borderRadius: Math.round(newScreen.radius / scale),
    };
  });
}

export interface PlatformSwapResult {
  artboards: ArtboardState[];
  swapped: number;
  // Devices left alone because they have no counterpart on the target
  // platform (tablet/desktop/custom); devices already on the platform
  // don't count as skipped.
  skipped: number;
}

/**
 * Swap every device element across all artboards to the given platform.
 * Pure — returns new artboard/element objects, sharing untouched ones, so a
 * single handleArtboardsUpdate call gives one history entry and one save.
 */
export function swapArtboardsToPlatform(
  artboards: ArtboardState[],
  platform: SwapPlatform
): PlatformSwapResult {
  let swapped = 0;
  let skipped = 0;
  const next = artboards.map((ab) => {
    let elements = ab.elements;
    for (const el of ab.elements) {
      if (el.type !== 'device') continue;
      const target = swapTargetFor(el.deviceType, platform);
      if (!target) {
        if (getDeviceDescriptor(el.deviceType).platform !== platform) skipped++;
        continue;
      }
      const result = swapDeviceInElements(elements, el.id, target);
      if (result) {
        elements = result;
        swapped++;
      }
    }
    return elements === ab.elements ? ab : { ...ab, elements };
  });
  return { artboards: next, swapped, skipped };
}
