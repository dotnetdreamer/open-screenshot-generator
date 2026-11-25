import type { ArtboardElement, ArtboardState, DeviceFrameElementProps, DeviceType, ShapeElementProps } from '@/types/artboard';
import { isScreenshotBoard } from './creative/specs';
import { elementVisualBounds, type Bounds } from './elementGeometry';
import { isStudioStyle, studioModelFor, withStudioRehug } from './device3dStudio';
import { cornerRadiusOf, displayInsetsOf, displayRadiiOf, flatFaceOf, measuredModelFor } from './device3dModels';

export type DevicePlatform = 'ios' | 'android' | 'neutral';
export type DeviceCategory = 'phone' | 'tablet' | 'watch' | 'desktop' | 'custom';
export type SwapPlatform = 'ios' | 'android';

export interface DeviceScreenGeometry {
  // Bezel insets as % of the device's effective width — ALL four sides derive
  // from width (matching DeviceFrameElement's bezelPx), so bezels stay uniform
  // at any element aspect ratio.
  paddingPercent: { top: number; right: number; bottom: number; left: number };
  // Screen corner radius as a fraction of effective width.
  radiusFactor: number;
  /** Bottom screen corners, when they differ from the top corners. */
  radiusBottomFactor?: number;
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
  // The corner of the flat frame's body as a fraction of its width, where the
  // frame is one rounded slab. DeviceFrameElement draws the body with it, and
  // the swap code keeps a rim or a case drawn round the frame concentric with
  // the next frame's corner. A MacBook and an iMac are a lid on a base and a
  // slab on a stand and have none, like a watch and a custom frame.
  bodyRadiusFactor?: number;
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

/**
 * Where a measured Pixel lands on iOS: an iPhone with the same kind of
 * display, Dynamic Island for a camera hole, and in the same tier.
 */
const PIXEL_TO_IPHONE: Partial<Record<DeviceType, DeviceType>> = {
  'pixel-10-pro': 'iphone-17-pro',
  'pixel-10a': 'iphone-17',
  'pixel-3-xl': 'iphone-17e',
  'pixel-4': 'iphone',
};

/**
 * The registry entry of a phone measured from its maker's drawings or device
 * art (device3dModels.ts): its label, screen proportions, bezels and screen
 * corners come from the model, and it swaps to the other platform's measured
 * phone with the same kind of display (notch to notch, Dynamic Island to
 * camera hole).
 */
function measuredPhone(id: DeviceType): DeviceDescriptor {
  const measured = measuredModelFor(id);
  if (!measured) throw new Error(`No measured model for ${id}`);
  // A foldable's flat frame is its inner display held tall.
  const model = flatFaceOf(measured);
  const insets = displayInsetsOf(model);
  const corners = displayRadiiOf(model);
  const percent = (mm: number) => (mm / model.width) * 100;
  const android = model.maker === 'google';
  return {
    id,
    label: model.label,
    platform: android ? 'android' : 'ios',
    category: 'phone',
    nativeAspect: model.screenPoints[0] / model.screenPoints[1],
    bodyRadiusFactor: cornerRadiusOf(model) / model.width,
    counterpart: android
      ? { ios: PIXEL_TO_IPHONE[id] ?? 'iphone-17' }
      : { android: model.cutout.kind === 'notch' ? 'pixel-3-xl' : 'pixel-10-pro' },
    screen: {
      paddingPercent: {
        top: percent(insets.top),
        right: percent(insets.side),
        bottom: percent(insets.bottom),
        left: percent(insets.side),
      },
      radiusFactor: corners.top / model.width,
      ...(corners.bottom !== corners.top ? { radiusBottomFactor: corners.bottom / model.width } : {}),
    },
  };
}

export const DEVICE_REGISTRY: Record<DeviceType, DeviceDescriptor> = {
  'iphone': { id: 'iphone', label: 'iPhone (Classic)', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, bodyRadiusFactor: 0.1, counterpart: { android: 'android-bar' }, screen: { paddingPercent: { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 }, radiusFactor: 0.08 } },
  'iphone-x': { id: 'iphone-x', label: 'iPhone X', platform: 'ios', category: 'phone', nativeAspect: 375 / 812, bodyRadiusFactor: 0.12, counterpart: { android: 'android-notch' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.09 } },
  'iphone-13': { id: 'iphone-13', label: 'iPhone 13', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, bodyRadiusFactor: 0.12, counterpart: { android: 'android-notch' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.09 } },
  'iphone-14': { id: 'iphone-14', label: 'iPhone 14', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, bodyRadiusFactor: 0.13, counterpart: { android: 'android-notch' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.1 } },
  'iphone-15': { id: 'iphone-15', label: 'iPhone 15', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, bodyRadiusFactor: 0.14, counterpart: { android: 'android-punch-hole' }, screen: { paddingPercent: { top: 2.5, right: 3, bottom: 2.5, left: 3 }, radiusFactor: 0.11 } },
  'iphone-15-pro': { id: 'iphone-15-pro', label: 'iPhone 15 Pro', platform: 'ios', category: 'phone', nativeAspect: 390 / 844, bodyRadiusFactor: 0.14, counterpart: { android: 'android-punch-hole' }, screen: { paddingPercent: { top: 2.5, right: 3, bottom: 2.5, left: 3 }, radiusFactor: 0.11 } },
  'iphone-17-pro-max': { id: 'iphone-17-pro-max', label: 'iPhone 17 Pro Max', platform: 'ios', category: 'phone', nativeAspect: 440 / 956, bodyRadiusFactor: 0.15, counterpart: { android: 'pixel-10-pro' }, screen: { paddingPercent: { top: 2.4, right: 2.8, bottom: 2.4, left: 2.8 }, radiusFactor: 0.115 } },
  'iphone-duo': measuredPhone('iphone-duo'),
  'iphone-18-pro-max': measuredPhone('iphone-18-pro-max'),
  'iphone-18-pro': measuredPhone('iphone-18-pro'),
  'iphone-17-pro': measuredPhone('iphone-17-pro'),
  'iphone-air': measuredPhone('iphone-air'),
  'iphone-17': measuredPhone('iphone-17'),
  'iphone-17e': measuredPhone('iphone-17e'),
  'iphone-16-pro-max': measuredPhone('iphone-16-pro-max'),
  'iphone-16-pro': measuredPhone('iphone-16-pro'),
  'iphone-16-plus': measuredPhone('iphone-16-plus'),
  'iphone-16': measuredPhone('iphone-16'),
  'iphone-16e': measuredPhone('iphone-16e'),
  // App Store iPads. Like the Play Store tablets, they map to BOTH platforms'
  // phones so converting an iPad project to a phone format is never a dead end.
  'ipad-pro-13': { id: 'ipad-pro-13', label: 'iPad Pro 13-inch', platform: 'ios', category: 'tablet', nativeAspect: 2064 / 2752, bodyRadiusFactor: 0.05, counterpart: { ios: 'iphone-17-pro-max', android: 'android-punch-hole' }, screen: { paddingPercent: { top: 3.2, right: 3.2, bottom: 3.2, left: 3.2 }, radiusFactor: 0.032 } },
  'ipad-11': { id: 'ipad-11', label: 'iPad 11-inch', platform: 'ios', category: 'tablet', nativeAspect: 1668 / 2420, bodyRadiusFactor: 0.055, counterpart: { ios: 'iphone-17-pro-max', android: 'android-punch-hole' }, screen: { paddingPercent: { top: 3.6, right: 3.6, bottom: 3.6, left: 3.6 }, radiusFactor: 0.036 } },
  // Apple Watch (Series 10 46mm proportions). No counterpart: platform swaps
  // leave watch mockups as-is, like the generic tablet/desktop.
  'apple-watch': { id: 'apple-watch', label: 'Apple Watch', platform: 'ios', category: 'watch', nativeAspect: 39 / 46, screen: { paddingPercent: { top: 10, right: 10, bottom: 10, left: 10 }, radiusFactor: 0.28 } },
  'android-bar': { id: 'android-bar', label: 'Android (Bar)', platform: 'android', category: 'phone', nativeAspect: 1080 / 2340, bodyRadiusFactor: 0.025, counterpart: { ios: 'iphone' }, screen: { paddingPercent: { top: 6, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  'android-notch': { id: 'android-notch', label: 'Android (Notch)', platform: 'android', category: 'phone', nativeAspect: 1080 / 2340, bodyRadiusFactor: 0.025, counterpart: { ios: 'iphone-14' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  'android-punch-hole': { id: 'android-punch-hole', label: 'Android (Punch Hole)', platform: 'android', category: 'phone', nativeAspect: 1080 / 2400, bodyRadiusFactor: 0.025, counterpart: { ios: 'iphone-15' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.02 } },
  'pixel-10-pro': measuredPhone('pixel-10-pro'),
  'pixel-10a': measuredPhone('pixel-10a'),
  'pixel-4': measuredPhone('pixel-4'),
  'pixel-3-xl': measuredPhone('pixel-3-xl'),
  'tablet': { id: 'tablet', label: 'Tablet', platform: 'neutral', category: 'tablet', nativeAspect: 768 / 1024, bodyRadiusFactor: 0.02, screen: { paddingPercent: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }, radiusFactor: 0.016 } },
  'tablet-7': { id: 'tablet-7', label: '7-inch Tablet', platform: 'android', category: 'tablet', nativeAspect: 800 / 1280, bodyRadiusFactor: 0.045, counterpart: { ios: 'iphone-15', android: 'android-punch-hole' }, screen: { paddingPercent: { top: 4.5, right: 4.5, bottom: 4.5, left: 4.5 }, radiusFactor: 0.03 } },
  'tablet-10': { id: 'tablet-10', label: '10-inch Tablet', platform: 'android', category: 'tablet', nativeAspect: 1600 / 2560, bodyRadiusFactor: 0.032, counterpart: { ios: 'iphone-15', android: 'android-punch-hole' }, screen: { paddingPercent: { top: 3, right: 3, bottom: 3, left: 3 }, radiusFactor: 0.025 } },
  'desktop': { id: 'desktop', label: 'Desktop Monitor', platform: 'neutral', category: 'desktop', nativeAspect: 16 / 9, bodyRadiusFactor: 0.013, screen: { paddingPercent: { top: 1.5, right: 1.5, bottom: 3.5, left: 1.5 }, radiusFactor: 0.009 } },
  // Macs. The element box is the FULL silhouette (lid + base for the MacBook,
  // slab + stand for the iMac), so the screen paddings carry the chassis:
  // the MacBook's side padding is the base overhang beyond the lid bezel, and
  // the iMac's bottom padding spans chin + stand. No counterpart: like the
  // watch, platform swaps leave Mac mockups as-is.
  'macbook': { id: 'macbook', label: 'MacBook', platform: 'ios', category: 'desktop', nativeAspect: 100 / 57.9, screen: { paddingPercent: { top: 2, right: 10, bottom: 5.9, left: 10 }, radiusFactor: 0.008 } },
  'imac': { id: 'imac', label: 'iMac', platform: 'ios', category: 'desktop', nativeAspect: 100 / 74.2, screen: { paddingPercent: { top: 1.5, right: 1.5, bottom: 18.1, left: 1.5 }, radiusFactor: 0.012 } },
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
    { label: 'iPhone', platform: 'ios', category: 'phone' },
    { label: 'iPad', platform: 'ios', category: 'tablet' },
    { label: 'Apple Watch', platform: 'ios', category: 'watch' },
    { label: 'Mac', platform: 'ios', category: 'desktop' },
    { label: 'Android', platform: 'android', category: null },
    { label: 'Other', platform: 'neutral', category: null },
  ] as const
).map((g) => ({
  label: g.label,
  platform: g.platform,
  devices: Object.values(DEVICE_REGISTRY).filter(
    (d) =>
      d.platform === g.platform &&
      d.category !== 'custom' &&
      (g.category === null || d.category === g.category)
  ),
}));

// The Devices toolbar formats combine a phone platform and canvas size, or
// an App Store or Play Store tablet preset, or the Mac App Store's size.
export type DeviceFormat = SwapPlatform | 'ios-large' | 'ipad-pro-13' | 'ipad-11' | 'tablet-7' | 'tablet-10' | 'mac';

/**
 * The format the project's device mockups are currently on: a phone platform
 * or a Play Store tablet when every format-specific device agrees, 'mixed'
 * when they disagree, and null when there are none (only generic
 * tablet/desktop/custom, or no devices at all). App Store header and search
 * artboards are not screenshots and do not count.
 */
export function detectArtboardsFormat(
  artboards: ArtboardState[]
): DeviceFormat | 'mixed' | null {
  let found: DeviceFormat | null = null;
  for (const ab of artboards) {
    if (!isScreenshotBoard(ab)) continue;
    for (const el of ab.elements) {
      if (el.type !== 'device') continue;
      const desc = getDeviceDescriptor(el.deviceType);
      let format: DeviceFormat | null = null;
      // Format-specific tablets (App Store iPads, Play Store tablets) ARE
      // their own format; phones map to their platform; neutral devices
      // (generic tablet, desktop, custom) belong to no format.
      if (desc.category === 'tablet' && desc.platform !== 'neutral') {
        format = el.deviceType as DeviceFormat;
      } else if (desc.category === 'phone' && desc.platform !== 'neutral') {
        format = desc.platform;
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
  // A 3D Studio device keeps its angle and its height on screen, and its box
  // closes round the new model's silhouette.
  if (isStudioStyle(el.styleType) && studioModelFor(el.deviceType) && studioModelFor(target)) {
    return withStudioRehug(el, { deviceType: target });
  }
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

/** A frame that is one rounded slab, the shape a rim or a case is drawn round. */
function isSlab(descriptor: DeviceDescriptor | undefined): boolean {
  return !!descriptor && (descriptor.category === 'phone' || descriptor.category === 'tablet');
}

interface FrameSides {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const SIDES = ['left', 'right', 'top', 'bottom'] as const;

// How near a rectangle's side has to lie to the frame's own side to run along
// it, as a share of the frame's width. A rim sits at 1%, a case at 4%, a hard
// shadow pushed down and to one side at 7%.
const ALONG_THE_FRAME = 0.08;

/** An element's box before it is turned: its size on the artboard, and the centre it turns about. */
function unturnedBox(el: ArtboardElement) {
  const scale = el.scale || 1;
  const width = el.size.width * scale;
  const height = el.size.height * scale;
  return { width, height, cx: el.position.x + width / 2, cy: el.position.y + height / 2 };
}

/**
 * How far each side of a rectangle lies outside the frame's own side (inside
 * is negative), in the frame's own axes, when the rectangle is drawn round the
 * frame: a rim, an outline, a case, a body, a drop shadow. It is turned the
 * same way as the frame and at least three of its sides run along the frame's.
 * The fourth may not: a case that runs on past the bottom of the artboard with
 * its phone. Null for anything else.
 */
function sidesRoundFrame(el: ArtboardElement, device: DeviceFrameElementProps): FrameSides | null {
  if (el.type !== 'shape' || el.shapeType !== 'rectangle') return null;
  if (Math.abs((el.rotation || 0) - (device.rotation || 0)) > 0.01) return null;
  const frame = unturnedBox(device);
  const box = unturnedBox(el);
  const turn = (-(device.rotation || 0) * Math.PI) / 180;
  const dx = box.cx - frame.cx;
  const dy = box.cy - frame.cy;
  const across = dx * Math.cos(turn) - dy * Math.sin(turn);
  const down = dx * Math.sin(turn) + dy * Math.cos(turn);
  const sides: FrameSides = {
    left: (box.width - frame.width) / 2 - across,
    right: (box.width - frame.width) / 2 + across,
    top: (box.height - frame.height) / 2 - down,
    bottom: (box.height - frame.height) / 2 + down,
  };
  const near = SIDES.filter((side) => Math.abs(sides[side]) <= frame.width * ALONG_THE_FRAME);
  return near.length >= 3 ? sides : null;
}

const CORNERS = ['borderRadius', 'borderRadiusTopLeft', 'borderRadiusTopRight', 'borderRadiusBottomRight', 'borderRadiusBottomLeft'] as const;

/**
 * A rectangle that was drawn round the frame, drawn round the frame it has
 * become: every side as far from the frame's side as it was, and its corner
 * the next frame's corner the same distance out, so a rim stays one even band
 * round an iPad's tighter corner.
 */
function drawnRoundNextFrame(
  el: ShapeElementProps,
  sides: FrameSides,
  before: DeviceFrameElementProps,
  after: DeviceFrameElementProps
): ArtboardElement {
  const was = unturnedBox(before);
  const frame = unturnedBox(after);
  const width = frame.width + sides.left + sides.right;
  const height = frame.height + sides.top + sides.bottom;
  if (!(width > 0 && height > 0)) return el;
  const across = (sides.right - sides.left) / 2;
  const down = (sides.bottom - sides.top) / 2;
  const turn = ((after.rotation || 0) * Math.PI) / 180;
  const cx = frame.cx + across * Math.cos(turn) - down * Math.sin(turn);
  const cy = frame.cy + across * Math.sin(turn) + down * Math.cos(turn);
  const scale = el.scale || 1;
  const next: ShapeElementProps = {
    ...el,
    position: { x: cx - width / 2, y: cy - height / 2 },
    size: { width: width / scale, height: height / scale },
  };
  const near = SIDES.filter((side) => Math.abs(sides[side]) <= was.width * ALONG_THE_FRAME);
  const out = near.reduce((sum, side) => sum + sides[side], 0) / Math.max(1, near.length);
  const cornerWas = (DEVICE_REGISTRY[before.deviceType]?.bodyRadiusFactor ?? 0) * was.width + out;
  const cornerNow = (DEVICE_REGISTRY[after.deviceType]?.bodyRadiusFactor ?? 0) * frame.width + out;
  if (cornerWas > 1 && cornerNow >= 0) {
    for (const key of CORNERS) {
      const value = el[key];
      if (typeof value === 'number') next[key] = Math.round(((value * cornerNow) / cornerWas) * 100) / 100;
    }
  }
  return next;
}

/**
 * Swap one device within an artboard's element list, and with it what was
 * drawn to its measure:
 *
 * - overlay images / rectangle shapes authored exactly on the device's screen
 *   area (screen fills, pre-baked app screenshots) are re-fitted to the new
 *   device's screen rect and corner radius, so they keep clipping to the frame
 *   after the swap (e.g. Android's ~2%-radius screen vs an iPhone's 11%);
 * - rectangles drawn round the frame (a rim, an outline, a case, a drop
 *   shadow) are drawn round the new one, where the swap gives the frame
 *   another box: a phone that becomes a tablet. Left as it was, a phone's rim
 *   stands out above and below the iPad. Between two frames of one kind the
 *   box does not change and neither does the rim. A laptop or a monitor on a
 *   stand is not a slab to draw round, and a 3D Studio device's box is its
 *   silhouette's, so there the rectangles stay as they are (layersLeftBehind
 *   takes them out where the app makes the swap itself).
 *
 * Returns null when there is nothing to swap.
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
  const reshaped =
    !!updates.size &&
    !isStudioStyle(device.styleType) &&
    isSlab(DEVICE_REGISTRY[device.deviceType]) &&
    isSlab(DEVICE_REGISTRY[target]);
  return elements.map((el) => {
    if (el.id === deviceId) return swappedDevice;
    if (oldScreen && newScreen && isScreenConformingOverlay(el, oldScreen)) {
      const scale = el.scale || 1;
      return {
        ...el,
        position: { x: newScreen.x, y: newScreen.y },
        size: { width: newScreen.width / scale, height: newScreen.height / scale },
        borderRadius: Math.round(newScreen.radius / scale),
      };
    }
    if (reshaped && el.type === 'shape') {
      const sides = sidesRoundFrame(el, device);
      if (sides) return drawnRoundNextFrame(el, sides, device, swappedDevice);
    }
    return el;
  });
}

/** Share of `a`'s own area that lies inside `b`. */
function shareInside(a: Bounds, b: Bounds): number {
  const own = a.width * a.height;
  if (!(own > 0)) return 0;
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? (width * height) / own : 0;
}

/** How much of the device a picture has to lie across to be holding it. */
const HOLDS_THIS_MUCH_OF_THE_DEVICE = 0.25;

/**
 * The pictures that hold `device`: a hand photographed with a phone in it, or
 * one drawn round a phone in two layers (the palm behind, the fingers in
 * front). They are grouped with the device and lie across a good part of it,
 * which makes them pictures drawn for that device's shape. A badge or a
 * sticker on a corner is too small to hold anything, and a picture fitted to
 * the screen is fitted to the next screen by the swap.
 */
export function picturesHolding(elements: ArtboardElement[], device: DeviceFrameElementProps): ArtboardElement[] {
  if (!device.groupId) return [];
  const frame = elementVisualBounds(device);
  const screen = !device.rotation ? getDeviceScreenRect(device) : null;
  return elements.filter((el) => {
    if (el.id === device.id || el.groupId !== device.groupId) return false;
    if (el.type !== 'image' && el.type !== 'video') return false;
    if (screen && isScreenConformingOverlay(el, screen)) return false;
    return shareInside(frame, elementVisualBounds(el)) >= HOLDS_THIS_MUCH_OF_THE_DEVICE;
  });
}

/**
 * The layers to leave out when `device` becomes `target`, by id: what was made
 * for the frame it is, and cannot be made to fit the one it becomes.
 *
 * A hand that holds a phone holds no tablet and no Mac. The photograph has its
 * own phone in it, which a wider and shorter frame no longer covers, and drawn
 * fingers end up in the middle of the screen. So a frame that turns into
 * another kind of device stands on its own. One that stays the same kind keeps
 * its box, and with it the hand.
 *
 * A rim or a case drawn round a phone is drawn round a tablet by the swap
 * itself (swapDeviceInElements). Round a MacBook or an iMac there is nothing
 * to draw it along, so there it goes too.
 *
 * Read before the swap, from the frame's own box. Every swap the app makes on
 * its own goes through this (the device sets and the format conversion). A
 * person changing one frame in the editor is not second-guessed: nothing of
 * theirs is taken away.
 */
export function layersLeftBehind(
  elements: ArtboardElement[],
  device: DeviceFrameElementProps,
  target: DeviceType
): Set<string> {
  const from = DEVICE_REGISTRY[device.deviceType] as DeviceDescriptor | undefined;
  const to = DEVICE_REGISTRY[target] as DeviceDescriptor | undefined;
  if (!from || !to || from.category === to.category) return new Set();
  if (from.category === 'custom' || to.category === 'custom') return new Set();
  const gone = new Set(picturesHolding(elements, device).map((el) => el.id));
  if ((!isSlab(from) || !isSlab(to)) && !isStudioStyle(device.styleType)) {
    const screen = !device.rotation ? getDeviceScreenRect(device) : null;
    for (const el of elements) {
      if (el.id === device.id || (screen && isScreenConformingOverlay(el, screen))) continue;
      if (sidesRoundFrame(el, device)) gone.add(el.id);
    }
  }
  return gone;
}

export interface DeviceFormatPreset {
  id: DeviceFormat;
  label: string;
  // The store-correct canvas for this format:
  // - ios: App Store "iPhone with Dynamic Island (medium display)" portrait
  //   (1206×2622), the REQUIRED iPhone slot. 1179×2556 and the two landscape
  //   sizes go in the same slot.
  // - ios-large: the optional large display slot (1290×2796), the size the
  //   bundled templates use. 1260×2736 and 1320×2868 are also accepted.
  // - ipad-pro-13: App Store 13-inch portrait (2064×2752) — REQUIRED if the
  //   app runs on iPad; 2048×2732 is the other accepted size.
  // - ipad-11: App Store 11-inch portrait (1668×2420) — optional tier;
  //   App Store Connect scales 13-inch screenshots down when absent.
  // - android: Play Store phone screenshots must be exactly 16:9 or 9:16
  //   with sides 320-3840px — 1080×1920 portrait.
  // - tablets: Play Store 9:16; 7-inch allows sides 320-3840px, 10-inch
  //   requires 1080-7680px.
  // - mac: Mac App Store 16:10 at 2560×1600, the size the Mac templates and
  //   the Canvas Size dialog recommend. 2880×1800, 1440×900 and 1280×800 go
  //   in the same slot.
  artboard: { width: number; height: number };
}

export const DEVICE_FORMAT_PRESETS: DeviceFormatPreset[] = [
  { id: 'android', label: PLATFORM_LABELS.android, artboard: { width: 1080, height: 1920 } },
  { id: 'ios', label: PLATFORM_LABELS.ios, artboard: { width: 1206, height: 2622 } },
  { id: 'ios-large', label: 'iPhone (large display)', artboard: { width: 1290, height: 2796 } },
  { id: 'ipad-pro-13', label: 'iPad 13-inch', artboard: { width: 2064, height: 2752 } },
  { id: 'ipad-11', label: 'iPad 11-inch', artboard: { width: 1668, height: 2420 } },
  { id: 'tablet-7', label: '7-inch tablet', artboard: { width: 1080, height: 1920 } },
  { id: 'tablet-10', label: '10-inch tablet', artboard: { width: 1440, height: 2560 } },
  { id: 'mac', label: 'Mac', artboard: { width: 2560, height: 1600 } },
];

// The formats Apple App Store Connect accepts, in submission-priority order.
// Used by the export flow to offer generating whichever are missing.
export const APP_STORE_FORMAT_IDS: readonly DeviceFormat[] = ['ios', 'ios-large', 'ipad-pro-13', 'ipad-11'];

/**
 * Uniformly scale an artboard's elements to fit a new canvas size (min of the
 * width/height ratios) and re-center them — layouts survive intact, with
 * margins where the aspect ratio differs. Returns the input array unchanged
 * when the size is identical. Used by the format conversion AND the Canvas
 * Size dialog, so both resize paths behave the same.
 */
export function scaleElementsToCanvas(
  elements: ArtboardElement[],
  from: { width: number; height: number },
  to: { width: number; height: number }
): ArtboardElement[] {
  if (from.width === to.width && from.height === to.height) return elements;
  const factor = Math.min(to.width / from.width, to.height / from.height);
  const offsetX = (to.width - from.width * factor) / 2;
  const offsetY = (to.height - from.height * factor) / 2;
  return elements.map((el) => {
    const position = {
      x: el.position.x * factor + offsetX,
      y: el.position.y * factor + offsetY,
    };
    // TextElement renders glyphs at fontSize/0.3 px and IGNORES element.scale
    // (TextElement.tsx display path), so scaling `scale` would shrink the box
    // but not the text — it re-wraps and clips. Scale the box and fontSize
    // directly instead; that mirrors the renderer exactly.
    if (el.type === 'text') {
      return {
        ...el,
        position,
        size: { width: el.size.width * factor, height: el.size.height * factor },
        fontSize: el.fontSize * factor,
        // Same units as fontSize, so the outline keeps its weight on the type.
        ...(typeof el.outlineWidth === 'number' ? { outlineWidth: el.outlineWidth * factor } : null),
      };
    }
    return { ...el, position, scale: (el.scale || 1) * factor };
  });
}

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
 * hole); tablet formats swap everything swappable to that tablet, a rim drawn
 * round the phone is drawn round the tablet, and a hand that held the phone
 * is left out (layersLeftBehind). Pure; a single
 * handleArtboardsUpdate call gives one history entry, so undo restores the
 * previous format exactly.
 *
 * App Store header and search artboards come back untouched: their size is
 * Apple's, and it is the same for every device format.
 */
export function convertArtboardsToFormat(
  artboards: ArtboardState[],
  preset: DeviceFormatPreset
): FormatConversionResult {
  let resized = 0;
  let swapped = 0;
  let skipped = 0;
  // Tablet formats (App Store iPads, Play Store tablets) share a device id
  // with their format id, so the registry lookup identifies them; phone
  // format ids aren't device ids and fall through.
  const isTablet =
    (DEVICE_REGISTRY[preset.id as DeviceType] as DeviceDescriptor | undefined)?.category ===
    'tablet';
  // The Mac size swaps nothing: a phone has no Mac counterpart, and a Mac
  // mockup is already on the format. Resizing still happens.
  const isMac = preset.id === 'mac';
  const phonePlatform = preset.id === 'ios-large' ? 'ios' : preset.id as SwapPlatform;
  const next = artboards.map((ab) => {
    if (!isScreenshotBoard(ab)) return ab;
    const { width: newW, height: newH } = preset.artboard;
    const sameSize = ab.size.width === newW && ab.size.height === newH;
    let elements = scaleElementsToCanvas(ab.elements, ab.size, preset.artboard);
    if (!sameSize) resized++;
    const deviceIds = isMac ? [] : elements.filter((el) => el.type === 'device').map((el) => el.id);
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
        : swapTargetFor(device.deviceType, phonePlatform);
      if (!target) {
        const alreadyOnFormat = isTablet
          ? device.deviceType === preset.id
          : desc.category === 'phone' && desc.platform === phonePlatform;
        if (!alreadyOnFormat) skipped++;
        continue;
      }
      const result = swapDeviceInElements(elements, id, target);
      if (result) {
        const gone = layersLeftBehind(elements, device, target);
        elements = gone.size > 0 ? result.filter((el) => !gone.has(el.id)) : result;
        swapped++;
      }
    }
    if (sameSize && elements === ab.elements) return ab;
    return { ...ab, size: { width: newW, height: newH }, elements };
  });
  return { artboards: next, resized, swapped, skipped };
}
