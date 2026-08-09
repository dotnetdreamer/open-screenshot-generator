/**
 * The palette's asset libraries, indexed for MCP.
 *
 * An external agent cannot see the Elements / Devices / Images palette, so this
 * flattens all three into one addressable index: every entry has a `libraryId`
 * that `add_element` resolves back into the exact props the matching palette
 * tile would drop on the canvas. That matters most for the vector elements,
 * whose artwork is a long SVG path string no model should have to echo back.
 *
 * Pure module (no React, no Tauri): safe to import anywhere, and the same code
 * powers the list_library tool and add_element's libraryId shortcut.
 */

import { ELEMENT_CATEGORIES } from '@/lib/elementLibrary';
import { IMAGE_CATEGORIES } from '@/lib/imageLibrary';
import { DEVICE_REGISTRY, DEVICE_PICKER_GROUPS } from '@/lib/deviceRegistry';
import {
  DEVICE_3D_GROUPS,
  COLORED_IPHONE_TILES,
  COLORED_ANDROID_TILES,
  COLORS_3D,
  SIDES_3D,
  coloredDeviceStyleProps,
  device3dStyleProps,
  type Color3D,
  type Side3D,
} from '@/lib/device3dPresets';
import type { Device3DPose, ElementType } from '@/types/artboard';
// One id scheme shared with the palette, so a libraryId the Properties panel
// shows is exactly one add_element accepts (see lib/libraryIds.ts).
import {
  ELEMENT_PREFIX,
  IMAGE_PREFIX,
  DEVICE_PREFIX,
  DEVICE_3D_PREFIX,
  DEVICE_COLOR_PREFIX,
  elementLibraryId,
  imageLibraryId,
  deviceLibraryId,
  device3dLibraryId,
  coloredDeviceLibraryId,
} from '@/lib/libraryIds';

export type LibraryKind = 'elements' | 'devices' | 'images';
export const LIBRARY_KINDS: LibraryKind[] = ['elements', 'devices', 'images'];

export interface LibraryGroup {
  kind: LibraryKind;
  id: string;
  label: string;
  itemCount: number;
  /** A few ids so a caller can see the shape without listing the group. */
  sampleIds: string[];
}

export interface LibraryItem {
  kind: LibraryKind;
  /** Pass to add_element as `libraryId`. */
  libraryId: string;
  group: string;
  label: string;
  /** What add_element will create for this entry. */
  type: ElementType;
  subType?: string;
  /** Size the palette gives this item; add_element uses it unless you pass width/height. */
  defaultSize?: { width: number; height: number };
}

/** What a libraryId expands into. */
export interface ResolvedLibraryItem {
  type: ElementType;
  subType?: string;
  props: Record<string, unknown>;
  label: string;
  defaultSize?: { width: number; height: number };
}

const COLORED_TILE_GROUPS = [
  { id: 'colored-iphone', label: 'Colored iPhone', tiles: COLORED_IPHONE_TILES },
  { id: 'colored-android', label: 'Colored Android', tiles: COLORED_ANDROID_TILES },
];

function matches(query: string | undefined, ...haystack: string[]): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((h) => h.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Items, per kind
// ---------------------------------------------------------------------------

function elementItems(): LibraryItem[] {
  return ELEMENT_CATEGORIES.flatMap((cat) =>
    cat.items.map((item) => ({
      kind: 'elements' as const,
      libraryId: elementLibraryId(item.id),
      group: cat.id,
      label: item.label,
      type: 'shape' as ElementType,
      subType: 'custom-svg',
      defaultSize: item.styleProps.defaultSize,
    }))
  );
}

function imageItems(): LibraryItem[] {
  return IMAGE_CATEGORIES.flatMap((cat) =>
    cat.items.map((item) => ({
      kind: 'images' as const,
      libraryId: imageLibraryId(item.id),
      group: cat.id,
      label: item.label,
      type: 'image' as ElementType,
      defaultSize: item.defaultSize,
    }))
  );
}

/** Plain (flat, front-facing) device frames — the palette's "Device Mockups" group. */
function deviceMockupItems(): LibraryItem[] {
  return DEVICE_PICKER_GROUPS.flatMap((group) =>
    group.devices.map((device) => ({
      kind: 'devices' as const,
      libraryId: deviceLibraryId(device.id),
      group: 'mockups',
      label: device.label,
      type: 'device' as ElementType,
      subType: device.id,
    }))
  );
}

function device3dItems(groupId?: string): LibraryItem[] {
  const items: LibraryItem[] = [];
  for (const group of DEVICE_3D_GROUPS) {
    if (groupId && group.id !== groupId) continue;
    for (const color of COLORS_3D) {
      for (const pose of group.poses) {
        for (const side of SIDES_3D) {
          items.push({
            kind: 'devices',
            libraryId: device3dLibraryId(group.thumbPrefix, pose, side, color),
            group: group.id,
            label: `${group.label} — ${pose} ${side} (${color})`,
            type: 'device',
            subType: group.device,
            defaultSize: group.sizes[pose],
          });
        }
      }
    }
  }
  return items;
}

function coloredDeviceItems(): LibraryItem[] {
  return COLORED_TILE_GROUPS.flatMap((group) =>
    group.tiles.map((tile) => ({
      kind: 'devices' as const,
      libraryId: coloredDeviceLibraryId(tile.id),
      group: group.id,
      label: `${tile.label} (${DEVICE_REGISTRY[tile.device]?.label ?? tile.device})`,
      type: 'device' as ElementType,
      subType: tile.device,
      defaultSize: coloredDeviceStyleProps(tile).defaultSize as { width: number; height: number } | undefined,
    }))
  );
}

function deviceItems(): LibraryItem[] {
  return [...deviceMockupItems(), ...device3dItems(), ...coloredDeviceItems()];
}

function itemsForKind(kind: LibraryKind): LibraryItem[] {
  if (kind === 'elements') return elementItems();
  if (kind === 'images') return imageItems();
  return deviceItems();
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<string, string> = {
  ...Object.fromEntries(ELEMENT_CATEGORIES.map((c) => [c.id, c.label])),
  ...Object.fromEntries(IMAGE_CATEGORIES.map((c) => [c.id, c.label])),
  ...Object.fromEntries(DEVICE_3D_GROUPS.map((g) => [g.id, g.label])),
  ...Object.fromEntries(COLORED_TILE_GROUPS.map((g) => [g.id, g.label])),
  mockups: 'Device Mockups (flat frames)',
};

/** Groups within one library kind (or all three when kind is omitted). */
export function listLibraryGroups(kind?: LibraryKind): LibraryGroup[] {
  const kinds = kind ? [kind] : LIBRARY_KINDS;
  const groups: LibraryGroup[] = [];
  for (const k of kinds) {
    const byGroup = new Map<string, LibraryItem[]>();
    for (const item of itemsForKind(k)) {
      const list = byGroup.get(item.group);
      if (list) list.push(item);
      else byGroup.set(item.group, [item]);
    }
    for (const [id, items] of byGroup) {
      groups.push({
        kind: k,
        id,
        label: GROUP_LABELS[id] ?? id,
        itemCount: items.length,
        sampleIds: items.slice(0, 4).map((i) => i.libraryId),
      });
    }
  }
  return groups;
}

export interface ListItemsOptions {
  group?: string;
  query?: string;
  limit?: number;
}

export interface ListItemsResult {
  items: LibraryItem[];
  /** Total matches before `limit` was applied, so a caller knows it was cut. */
  total: number;
}

export function listLibraryItems(kind: LibraryKind, options: ListItemsOptions = {}): ListItemsResult {
  const { group, query, limit = 200 } = options;
  const all = itemsForKind(kind).filter(
    (item) => (!group || item.group === group) && matches(query, item.label, item.libraryId, item.group)
  );
  return { items: all.slice(0, Math.max(1, limit)), total: all.length };
}

/** Pose/finish options an agent can pass to add_element for a 3D device. */
export function device3dOptions() {
  return DEVICE_3D_GROUPS.map((g) => ({
    group: g.id,
    deviceType: g.device,
    poses: g.poses,
    sides: [...SIDES_3D],
    colors: [...COLORS_3D],
  }));
}

// ---------------------------------------------------------------------------
// Resolution: libraryId -> element props
// ---------------------------------------------------------------------------

export function resolveLibraryItem(libraryId: string): ResolvedLibraryItem | null {
  const id = libraryId.trim();

  if (id.startsWith(ELEMENT_PREFIX)) {
    const key = id.slice(ELEMENT_PREFIX.length);
    for (const cat of ELEMENT_CATEGORIES) {
      const item = cat.items.find((i) => i.id === key);
      if (!item) continue;
      // styleProps carries name + customPath (+ specialProps / defaultSize),
      // exactly what the palette hands the canvas for a custom-svg shape.
      const { defaultSize, ...props } = item.styleProps;
      return { type: 'shape', subType: 'custom-svg', props, label: item.label, defaultSize };
    }
    return null;
  }

  if (id.startsWith(IMAGE_PREFIX)) {
    const key = id.slice(IMAGE_PREFIX.length);
    for (const cat of IMAGE_CATEGORIES) {
      const item = cat.items.find((i) => i.id === key);
      if (!item) continue;
      return {
        type: 'image',
        props: { imageSrc: item.src, imageAlt: item.label, name: item.label, objectFit: 'contain' },
        label: item.label,
        defaultSize: item.defaultSize,
      };
    }
    return null;
  }

  if (id.startsWith(DEVICE_3D_PREFIX)) {
    const key = id.slice(DEVICE_3D_PREFIX.length);
    for (const group of DEVICE_3D_GROUPS) {
      if (!key.startsWith(`${group.thumbPrefix}-`)) continue;
      const rest = key.slice(group.thumbPrefix.length + 1).split('-');
      // pose may itself be a single token; side and colour are the last two.
      const color = rest.pop() as Color3D | undefined;
      const side = rest.pop() as Side3D | undefined;
      const pose = rest.join('-') as Device3DPose;
      if (!color || !side || !group.poses.includes(pose)) continue;
      if (!COLORS_3D.includes(color) || !SIDES_3D.includes(side)) continue;
      const { defaultSize, ...props } = device3dStyleProps(group, pose, side, color);
      return {
        type: 'device',
        subType: group.device,
        props,
        label: `${group.label} — ${pose} ${side} (${color})`,
        defaultSize: defaultSize as { width: number; height: number } | undefined,
      };
    }
    return null;
  }

  if (id.startsWith(DEVICE_COLOR_PREFIX)) {
    const key = id.slice(DEVICE_COLOR_PREFIX.length);
    for (const group of COLORED_TILE_GROUPS) {
      const tile = group.tiles.find((t) => t.id === key);
      if (!tile) continue;
      const { defaultSize, ...props } = coloredDeviceStyleProps(tile);
      return {
        type: 'device',
        subType: tile.device,
        props,
        label: tile.label,
        defaultSize: defaultSize as { width: number; height: number } | undefined,
      };
    }
    return null;
  }

  if (id.startsWith(DEVICE_PREFIX)) {
    const key = id.slice(DEVICE_PREFIX.length);
    const device = DEVICE_REGISTRY[key as keyof typeof DEVICE_REGISTRY];
    if (!device) return null;
    return { type: 'device', subType: device.id, props: {}, label: device.label };
  }

  return null;
}
