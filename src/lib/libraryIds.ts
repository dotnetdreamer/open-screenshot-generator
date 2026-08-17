/**
 * Stable ids for every tile in the Elements / Devices / Images palette.
 *
 * One id scheme, three readers:
 *  - the palette shows the id on hover, so a designer can name what they picked;
 *  - `addElement` stamps it onto the element as `libraryId`, and the Properties
 *    panel prints it at the top, so any layer traces back to its source tile;
 *  - MCP's asset index (lib/mcp/assetLibrary.ts) builds `list_library` ids from
 *    the same helpers, so what the panel shows is exactly what `add_element`
 *    accepts as `libraryId`.
 *
 * Prefixes namespace the ids, so they stay unique across the three libraries and
 * the source library is readable at a glance. `basic:` and `preview:` cover the
 * hand-written Elements-tab tiles (plain shapes, App Preview parts); the rest are
 * generated from the library tables.
 */

export const ELEMENT_PREFIX = 'element:';
export const IMAGE_PREFIX = 'image:';
export const DEVICE_PREFIX = 'device:';
export const DEVICE_3D_PREFIX = 'device3d:';
export const DEVICE_COLOR_PREFIX = 'devicecolor:';
export const BASIC_PREFIX = 'basic:';
export const PREVIEW_PREFIX = 'preview:';
export const SCENE_PREFIX = 'scene:';

/** A vector element from ELEMENT_CATEGORIES. */
export const elementLibraryId = (itemId: string): string => `${ELEMENT_PREFIX}${itemId}`;

/** A photo or badge from IMAGE_CATEGORIES. */
export const imageLibraryId = (itemId: string): string => `${IMAGE_PREFIX}${itemId}`;

/** A flat device mockup, keyed by DeviceType. */
export const deviceLibraryId = (deviceType: string): string => `${DEVICE_PREFIX}${deviceType}`;

/** A posed 3D device tile: thumbnail prefix + pose + side + finish. */
export const device3dLibraryId = (
  thumbPrefix: string,
  pose: string,
  side: string,
  color: string
): string => `${DEVICE_3D_PREFIX}${thumbPrefix}-${pose}-${side}-${color}`;

/** A colored flat device preset from COLORED_*_TILES. */
export const coloredDeviceLibraryId = (tileId: string): string => `${DEVICE_COLOR_PREFIX}${tileId}`;

/** A plain shape / text / image tile in the Elements tab's Basic group. */
export const basicLibraryId = (tileId: string): string => `${BASIC_PREFIX}${tileId}`;

/** A recording frame or gesture hint in the Elements tab's App Preview group. */
export const previewLibraryId = (tileId: string): string => `${PREVIEW_PREFIX}${tileId}`;

/**
 * A whole App Preview scene from the Previews tab (see lib/previewScenes.ts).
 * The odd one out: this id names an ARTBOARD, not an element, so nothing
 * stamps it onto a layer.
 */
export const previewSceneLibraryId = (sceneId: string): string => `${SCENE_PREFIX}${sceneId}`;
