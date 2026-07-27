/**
 * Device presets shared by the Devices palette and the MCP asset library.
 *
 * The palette renders one tile per (pose, side, colour) combination; the MCP
 * library lists the same combinations so an external agent can ask for
 * "iPhone 3D, tilted, left, black" by id and get exactly what a click in the
 * palette would produce. Keeping both readers on one table is the point: a pose
 * added here shows up in the app and over MCP at the same time.
 *
 * Thumbnails are pre-rendered to /elements/device-3d/<device>-<pose>-<side>-<colour>.png.
 */

import type { Device3DPose, DeviceType } from '@/types/artboard';

export type Side3D = 'left' | 'right';
export type Color3D = 'black' | 'white';

export const SIDES_3D = ['left', 'right'] as const;
export const COLORS_3D = ['black', 'white'] as const;

export const POSE_ORDER: Device3DPose[] = ['upright', 'side', 'tilted', 'reclined', 'laying', 'floating', 'drifting', 'leaning', 'soaring', 'isometric'];
// The watch leads with the straight-on look (classic watch product shot);
// phones don't offer it — a zero-yaw phone reads as a flat 2D mockup.
export const WATCH_POSE_ORDER: Device3DPose[] = ['front', ...POSE_ORDER];
// Macs offer a curated pose subset: the tossed-phone poses (floating,
// drifting, leaning, soaring) and the phone-flat isometric projection read
// wrong for a laptop or an all-in-one.
export const MACBOOK_POSE_ORDER: Device3DPose[] = ['front', 'upright', 'side', 'tilted', 'reclined'];
export const IMAC_POSE_ORDER: Device3DPose[] = ['front', 'upright', 'side'];

// Element sizes that roughly match each pose's projected aspect so the device
// fills the element instead of letterboxing.
export const IPHONE_3D_SIZES: Record<Device3DPose, { width: number; height: number }> = {
  classic: { width: 600, height: 1300 },
  front: { width: 600, height: 1300 },
  upright: { width: 600, height: 1300 },
  side: { width: 600, height: 1300 },
  tilted: { width: 640, height: 1120 },
  reclined: { width: 720, height: 900 },
  laying: { width: 800, height: 680 },
  floating: { width: 760, height: 830 },
  drifting: { width: 900, height: 700 },
  leaning: { width: 780, height: 910 },
  soaring: { width: 760, height: 950 },
  isometric: { width: 900, height: 480 },
};
export const ANDROID_3D_SIZES: Record<Device3DPose, { width: number; height: number }> = {
  classic: { width: 600, height: 1333 },
  front: { width: 600, height: 1333 },
  upright: { width: 600, height: 1333 },
  side: { width: 600, height: 1333 },
  tilted: { width: 640, height: 1150 },
  reclined: { width: 720, height: 920 },
  laying: { width: 800, height: 700 },
  floating: { width: 760, height: 830 },
  drifting: { width: 900, height: 700 },
  leaning: { width: 780, height: 910 },
  soaring: { width: 760, height: 950 },
  isometric: { width: 900, height: 480 },
};

// Like the watch, Mac bodies keep native proportions inside the box, so these
// track each pose's projected silhouette.
export const MACBOOK_3D_SIZES: Partial<Record<Device3DPose, { width: number; height: number }>> = {
  front: { width: 1100, height: 800 },
  upright: { width: 1150, height: 800 },
  side: { width: 1150, height: 830 },
  tilted: { width: 1200, height: 880 },
  reclined: { width: 1200, height: 960 },
};
export const IMAC_3D_SIZES: Partial<Record<Device3DPose, { width: number; height: number }>> = {
  front: { width: 1000, height: 780 },
  upright: { width: 1050, height: 800 },
  side: { width: 1100, height: 820 },
};

// The watch body keeps native proportions inside the box (the band dominates
// the height), so these track each pose's projected case+band extent.
export const WATCH_3D_SIZES: Record<Device3DPose, { width: number; height: number }> = {
  classic: { width: 560, height: 1240 },
  front: { width: 580, height: 1200 },
  upright: { width: 560, height: 1240 },
  side: { width: 560, height: 1240 },
  tilted: { width: 660, height: 1100 },
  reclined: { width: 720, height: 900 },
  laying: { width: 800, height: 700 },
  floating: { width: 740, height: 840 },
  drifting: { width: 880, height: 700 },
  leaning: { width: 760, height: 900 },
  soaring: { width: 740, height: 950 },
  isometric: { width: 900, height: 520 },
};

/** The 3D groups exactly as the palette drills into them. */
export interface Device3DGroupDef {
  id: string;
  label: string;
  /** Thumbnail filename prefix under /elements/device-3d. */
  thumbPrefix: string;
  device: DeviceType;
  poses: Device3DPose[];
  sizes: Partial<Record<Device3DPose, { width: number; height: number }>>;
}

export const DEVICE_3D_GROUPS: Device3DGroupDef[] = [
  { id: '3d-iphone', label: '3D iPhone 17 Pro Max', thumbPrefix: 'iphone', device: 'iphone-17-pro-max', poses: POSE_ORDER, sizes: IPHONE_3D_SIZES },
  { id: '3d-android', label: '3D Android', thumbPrefix: 'android', device: 'android-punch-hole', poses: POSE_ORDER, sizes: ANDROID_3D_SIZES },
  { id: '3d-watch', label: '3D Apple Watch', thumbPrefix: 'watch', device: 'apple-watch', poses: WATCH_POSE_ORDER, sizes: WATCH_3D_SIZES },
  { id: '3d-macbook', label: '3D MacBook', thumbPrefix: 'macbook', device: 'macbook', poses: MACBOOK_POSE_ORDER, sizes: MACBOOK_3D_SIZES },
  { id: '3d-imac', label: '3D iMac', thumbPrefix: 'imac', device: 'imac', poses: IMAC_POSE_ORDER, sizes: IMAC_3D_SIZES },
];

/** Element props a 3D tile drops onto the canvas. */
export function device3dStyleProps(
  group: Device3DGroupDef,
  pose: Device3DPose,
  side: Side3D,
  color: Color3D
): Record<string, unknown> {
  return {
    styleType: side === 'left' ? '3d-left' : '3d-right',
    pose3d: pose,
    frameColor3d: color,
    defaultSize: group.sizes[pose],
  };
}

// ---- Colored flat device presets ----

export interface ColoredDeviceTileDef {
  /** Stable id; also the MCP library id suffix. */
  id: string;
  label: string;
  device: DeviceType;
  kind: 'island' | 'notch' | 'punch';
  props: Record<string, any>;
}

export const COLORED_IPHONE_TILES: ColoredDeviceTileDef[] = [
  { id: 'iphone-fixed-color', label: 'Fixed color', device: 'iphone-13', kind: 'notch', props: { frameColor: '#f5f5f7' } },
  { id: 'iphone-transparent', label: 'Transparent device', device: 'iphone-15-pro', kind: 'island', props: { frameColor: '#ffffff', frameOpacity: 0.15 } },
  { id: 'iphone-border-blue', label: 'Colored border', device: 'iphone-13', kind: 'notch', props: { frameColor: '#2f6bff' } },
  { id: 'iphone-border-notch-indigo', label: 'Colored border, notch', device: 'iphone-15-pro', kind: 'island', props: { frameColor: '#1d4ed8', notchColor: '#1d4ed8' } },
  { id: 'iphone-notch-orange', label: 'Colored notch', device: 'iphone-15-pro', kind: 'island', props: { frameColor: '#141416', notchColor: '#f97316' } },
  { id: 'iphone-border-notch-fuchsia', label: 'Colored border, notch', device: 'iphone-15-pro', kind: 'island', props: { frameColor: '#d946ef', notchColor: '#d946ef' } },
  { id: 'iphone-border-violet', label: 'Colored border', device: 'iphone-13', kind: 'notch', props: { frameColor: '#6366f1' } },
  { id: 'iphone-border-notch-white', label: 'Colored border, notch', device: 'iphone-15-pro', kind: 'island', props: { frameColor: '#f8fafc', notchColor: '#f8fafc' } },
  { id: 'iphone-border-violet-soft', label: 'Colored border opacity', device: 'iphone-13', kind: 'notch', props: { frameColor: '#8b5cf6', frameOpacity: 0.5 } },
  { id: 'iphone-border-notch-blue-soft', label: 'Colored border opacity, notch', device: 'iphone-15-pro', kind: 'island', props: { frameColor: '#2f6bff', frameOpacity: 0.45, notchColor: '#2f6bff' } },
  { id: 'iphone-outline-sky', label: 'Colored border outline', device: 'iphone-15-pro', kind: 'island', props: { frameStyle: 'outline', frameColor: '#38bdf8' } },
  { id: 'iphone-outline-slate', label: 'Colored border outline', device: 'iphone-13', kind: 'notch', props: { frameStyle: 'outline', frameColor: '#e2e8f0' } },
  { id: 'iphone-border-notch-green', label: 'Colored border, notch', device: 'iphone-15-pro', kind: 'island', props: { frameColor: '#22c55e', notchColor: '#22c55e' } },
  { id: 'iphone-border-notch-navy', label: 'Colored border, notch', device: 'iphone-15-pro', kind: 'island', props: { frameColor: '#1e40af', notchColor: '#1e40af' } },
];

export const COLORED_ANDROID_TILES: ColoredDeviceTileDef[] = [
  { id: 'android-fixed-color', label: 'Fixed color', device: 'android-punch-hole', kind: 'punch', props: { frameColor: '#f5f5f7' } },
  { id: 'android-transparent', label: 'Transparent device', device: 'android-punch-hole', kind: 'punch', props: { frameColor: '#ffffff', frameOpacity: 0.15 } },
  { id: 'android-border-blue', label: 'Colored border', device: 'android-punch-hole', kind: 'punch', props: { frameColor: '#2f6bff' } },
  { id: 'android-border-punch-green', label: 'Colored border, punch', device: 'android-punch-hole', kind: 'punch', props: { frameColor: '#22c55e', notchColor: '#22c55e' } },
  { id: 'android-border-violet-soft', label: 'Colored border opacity', device: 'android-punch-hole', kind: 'punch', props: { frameColor: '#8b5cf6', frameOpacity: 0.5 } },
  { id: 'android-outline-sky', label: 'Colored border outline', device: 'android-punch-hole', kind: 'punch', props: { frameStyle: 'outline', frameColor: '#38bdf8' } },
];

export const COLORED_DEVICE_SIZES: Partial<Record<DeviceType, { width: number; height: number }>> = {
  'iphone-13': { width: 600, height: 1300 },
  'iphone-15-pro': { width: 600, height: 1300 },
  'android-punch-hole': { width: 600, height: 1333 },
};

/** Element props a colored flat tile drops onto the canvas. */
export function coloredDeviceStyleProps(def: ColoredDeviceTileDef): Record<string, unknown> {
  return { ...def.props, defaultSize: COLORED_DEVICE_SIZES[def.device] };
}
