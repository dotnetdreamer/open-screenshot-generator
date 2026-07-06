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
  // Where this device lands when the user swaps the project to a platform.
  // Phones map to the other platform's phone matched by cutout style (bar <->
  // no-notch classic, notch <-> notch, punch hole <-> Dynamic Island); the
  // Play Store tablets map to BOTH platforms' phones so a tablet conversion
  // is never a dead end. Many-to-one, so round-trips are lossy by design —
  // undo restores exactly. Devices without an entry for the target platform
  // are left as-is (generic tablet, desktop, custom).
  counterpart?: Partial<Record<SwapPlatform, DeviceType>>;
}

export const DEVICE_REGISTRY: Record<DeviceType, DeviceDescriptor> = {
  'iphone': { id: 'iphone', label: 'iPhone (Classic)', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: { android: 'android-bar' }, screen: { paddingPercent: { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 }, radiusFactor: 0.08 } },
  'iphone-x': { id: 'iphone-x', label: 'iPhone X', platform: 'ios', category: 'phone', nativeAspect: 375 / 812, counterpart: { android: 'android-notch' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.09 } },
  'iphone-13': { id: 'iphone-13', label: 'iPhone 13', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: { android: 'android-notch' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.09 } },
  'iphone-14': { id: 'iphone-14', label: 'iPhone 14', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: { android: 'android-notch' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.1 } },
  'iphone-15': { id: 'iphone-15', label: 'iPhone 15', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: { android: 'android-punch-hole' }, screen: { paddingPercent: { top: 2.5, right: 3, bottom: 2.5, left: 3 }, radiusFactor: 0.11 } },
  'iphone-15-pro': { id: 'iphone-15-pro', label: 'iPhone 15 Pro', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, counterpart: { android: 'android-punch-hole' }, screen: { paddingPercent: { top: 2.5, right: 3, bottom: 2.5, left: 3 }, radiusFactor: 0.11 } },
  'iphone-17-pro-max': { id: 'iphone-17-pro-max', label: 'iPhone 17 Pro Max', platform: 'ios', category: 'phone', nativeAspect: 440 / 956, counterpart: { android: 'android-punch-hole' }, screen: { paddingPercent: { top: 2.4, right: 2.8, bottom: 2.4, left: 2.8 }, radiusFactor: 0.115 } },
  'android-bar': { id: 'android-bar', label: 'Android (Bar)', platform: 'android', category: 'phone', nativeAspect: 1080 / 2340, counterpart: { ios: 'iphone' }, screen: { paddingPercent: { top: 6, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  'android-notch': { id: 'android-notch', label: 'Android (Notch)', platform: 'android', category: 'phone', nativeAspect: 1080 / 2340, counterpart: { ios: 'iphone-14' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  'android-punch-hole': { id: 'android-punch-hole', label: 'Android (Punch Hole)', platform: 'android', category: 'phone', nativeAspect: 1080 / 2400, counterpart: { ios: 'iphone-15' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  'tablet': { id: 'tablet', label: 'Tablet', platform: 'neutral', category: 'tablet', nativeAspect: 768 / 1024, screen: { paddingPercent: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }, radiusFactor: 0.016 } },
  'tablet-7': { id: 'tablet-7', label: '7-inch Tablet', platform: 'android', category: 'tablet', nativeAspect: 800 / 1280, counterpart: { ios: 'iphone-15', android: 'android-punch-hole' }, screen: { paddingPercent: { top: 4.5, right: 4.5, bottom: 4.5, left: 4.5 }, radiusFactor: 0.03 } },
  'tablet-10': { id: 'tablet-10', label: '10-inch Tablet', platform: 'android', category: 'tablet', nativeAspect: 1600 / 2560, counterpart: { ios: 'iphone-15', android: 'android-punch-hole' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.025 } },
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

// The mutually exclusive "formats" the Devices toolbar menu switches between:
// the two phone platforms and the two Play Store tablet presets.
export type DeviceFormat = SwapPlatform | 'tablet-7' | 'tablet-10';

/**
 * The format the project's device mockups are currently on: a phone platform
 * or a Play Store tablet when every format-specific device agrees, 'mixed'
 * when they disagree, and null when there are none (only generic
 * tablet/desktop/custom, or no devices at all).
 */
export function detectArtboardsFormat(
  artboards: ArtboardState[]
): DeviceFormat | 'mixed' | null {
  let found: DeviceFormat | null = null;
  for (const ab of artboards) {
    for (const el of ab.elements) {
      if (el.type !== 'device') continue;
      let format: DeviceFormat | null = null;
      if (el.deviceType === 'tablet-7' || el.deviceType === 'tablet-10') {
        format = el.deviceType;
      } else {
        const platform = getDeviceDescriptor(el.deviceType).platform;
        if (platform !== 'neutral') format = platform;
      }
      if (!format) continue;
      if (found && found !== format) return 'mixed';
      found = format;
    }
  }
  return found;
}

export function swapTargetFor(id: DeviceType, platform: SwapPlatform): DeviceType | null {
  const desc = DEVICE_REGISTRY[id];
  if (!desc) return null;
  // Phones already on the platform stay put; anything else (other-platform
  // phones, Play Store tablets) converts via its counterpart entry.
  if (desc.category === 'phone' && desc.platform === platform) return null;
  return desc.counterpart?.[platform] ?? null;
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

export interface DeviceFormatPreset {
  id: DeviceFormat;
  label: string;
  // The store-correct canvas for this format:
  // - ios: App Store 6.9-inch portrait (1290×2796).
  // - android: Play Store phone screenshots must be exactly 16:9 or 9:16
  //   with sides 320-3840px — 1080×1920 portrait.
  // - tablets: Play Store 9:16; 7-inch allows sides 320-3840px, 10-inch
  //   requires 1080-7680px.
  artboard: { width: number; height: number };
}

export const DEVICE_FORMAT_PRESETS: DeviceFormatPreset[] = [
  { id: 'android', label: PLATFORM_LABELS.android, artboard: { width: 1080, height: 1920 } },
  { id: 'ios', label: PLATFORM_LABELS.ios, artboard: { width: 1290, height: 2796 } },
  { id: 'tablet-7', label: '7-inch tablet', artboard: { width: 1080, height: 1920 } },
  { id: 'tablet-10', label: '10-inch tablet', artboard: { width: 1440, height: 2560 } },
];

export interface FormatConversionResult {
  artboards: ArtboardState[];
  resized: number;
  swapped: number;
  // Devices left as-is because the format has no equivalent for them
  // (generic tablet/desktop/custom); devices already on the format don't
  // count as skipped.
  skipped: number;
}

/**
 * Convert the whole project to a device format: every artboard is resized to
 * the format's store-correct canvas with its content uniformly scaled (min of
 * the width/height ratios) and re-centered — layouts survive intact, with
 * margins where the aspect ratio differs — and every mockup is swapped to the
 * format's device (screen-aware, like any other swap). Phone formats swap
 * per-device via the counterpart table (notch stays notch, island stays punch
 * hole); tablet formats swap everything swappable to that tablet. Pure; a
 * single handleArtboardsUpdate call gives one history entry, so undo restores
 * the previous format exactly.
 */
export function convertArtboardsToFormat(
  artboards: ArtboardState[],
  preset: DeviceFormatPreset
): FormatConversionResult {
  let resized = 0;
  let swapped = 0;
  let skipped = 0;
  const isTablet = preset.id === 'tablet-7' || preset.id === 'tablet-10';
  const next = artboards.map((ab) => {
    const { width: newW, height: newH } = preset.artboard;
    const sameSize = ab.size.width === newW && ab.size.height === newH;
    const factor = Math.min(newW / ab.size.width, newH / ab.size.height);
    const offsetX = (newW - ab.size.width * factor) / 2;
    const offsetY = (newH - ab.size.height * factor) / 2;
    let elements = sameSize
      ? ab.elements
      : ab.elements.map((el) => {
          const position = {
            x: el.position.x * factor + offsetX,
            y: el.position.y * factor + offsetY,
          };
          // TextElement renders glyphs at fontSize/0.3 px and IGNORES
          // element.scale (TextElement.tsx display path), so scaling `scale`
          // would shrink the box but not the text — it re-wraps and clips.
          // Scale the box and fontSize directly instead; that mirrors the
          // renderer exactly.
          if (el.type === 'text') {
            return {
              ...el,
              position,
              size: { width: el.size.width * factor, height: el.size.height * factor },
              fontSize: el.fontSize * factor,
            };
          }
          return { ...el, position, scale: (el.scale || 1) * factor };
        });
    if (!sameSize) resized++;
    const deviceIds = elements.filter((el) => el.type === 'device').map((el) => el.id);
    for (const id of deviceIds) {
      const device = elements.find(
        (el): el is DeviceFrameElementProps => el.type === 'device' && el.id === id
      );
      if (!device) continue;
      const desc = getDeviceDescriptor(device.deviceType);
      const target = isTablet
        ? desc.category === 'custom'
          ? null
          : (preset.id as DeviceType)
        : swapTargetFor(device.deviceType, preset.id as SwapPlatform);
      if (!target) {
        const alreadyOnFormat = isTablet
          ? device.deviceType === preset.id
          : desc.category === 'phone' && desc.platform === preset.id;
        if (!alreadyOnFormat) skipped++;
        continue;
      }
      const result = swapDeviceInElements(elements, id, target);
      if (result) {
        elements = result;
        swapped++;
      }
    }
    if (sameSize && elements === ab.elements) return ab;
    return { ...ab, size: { width: newW, height: newH }, elements };
  });
  return { artboards: next, resized, swapped, skipped };
}
