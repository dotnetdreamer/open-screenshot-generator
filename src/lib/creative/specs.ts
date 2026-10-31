/**
 * App Store creative art (iOS 27): what each placement is, how big it is, and
 * which part of it is guaranteed to show.
 *
 * This is the ONLY registration site. The add dialog, the canvas overlay, the
 * store preview, the rules check, the export filenames and the MCP presets all
 * read this list, so an In-App Event card would be one more entry here.
 *
 * Sources, checked on 31 October 2026:
 *   - Sizes, formats and video limits: "Creative assets specifications" in the
 *     App Store Connect help.
 *   - `safe`: the "Art Safe Area" rectangle in Apple's own templates. The
 *     Sketch file and all three Photoshop files agree to the pixel.
 *   - `iphone`: measured off the device renders on Apple's "App Store asset
 *     best practices" page by matching them against the template art. Apple
 *     publishes no crop numbers, so these are approximate, and they are only
 *     used to draw the store preview. Anything that decides whether a design
 *     is safe uses `safe`.
 */

import type { ArtboardState, CreativeAssetKind, Size } from '@/types/artboard';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the art is shown. A universal asset fills both. */
export type CreativePlacement = 'header' | 'search';

export interface CreativeAssetSpec {
  kind: CreativeAssetKind;
  /** Apple's name for it, as App Store Connect shows it. */
  label: string;
  /** What a new artboard of this kind is called on the canvas. */
  boardName: string;
  /** Size and shape, written the way the add dialog shows it. */
  sizeLabel: string;
  width: number;
  height: number;
  /** Apple's art safe area at width x height. */
  safe: PixelRect;
  /**
   * What an iPhone in portrait shows of the art in each placement it fills,
   * at width x height. Approximate, see the note at the top.
   */
  iphone: Partial<Record<CreativePlacement, PixelRect>>;
  placements: CreativePlacement[];
  /** Image formats App Store Connect takes for this kind. */
  imageFormats: ('PNG' | 'JPEG')[];
  /** Video limits, or null when this kind takes no video. */
  video: { width: number; height: number; minSeconds: number; maxSeconds: number; fps: number[] } | null;
  /** Start of the exported file's name. */
  fileTag: string;
  /** Size preset id, so the MCP create_artboard tool can make one. */
  presetId: string;
}

export const CREATIVE_ASSETS: readonly CreativeAssetSpec[] = [
  {
    kind: 'header',
    label: 'Product page header',
    boardName: 'Product page header',
    sizeLabel: '3840 x 1646, 21:9',
    width: 3840,
    height: 1646,
    safe: { x: 1097, y: 493, width: 1646, height: 661 },
    // Full width of the safe area, at the 393 x 254pt the header takes on an
    // iPhone 16 Pro. It sits a little above the middle in Apple's renders.
    iphone: { header: { x: 1097, y: 238, width: 1646, height: 1064 } },
    placements: ['header'],
    imageFormats: ['PNG', 'JPEG'],
    video: { width: 3840, height: 1646, minSeconds: 5, maxSeconds: 30, fps: [30, 60] },
    fileTag: 'AppStore_Header',
    presetId: 'appstore-header',
  },
  {
    kind: 'search',
    label: 'Search results',
    boardName: 'Search result',
    sizeLabel: '3840 x 2560, 3:2',
    width: 3840,
    height: 2560,
    safe: { x: 836, y: 765, width: 2168, height: 1030 },
    // The search card is 3:2 like the art, but Apple's renders show it zoomed
    // in to about the width of the safe area.
    iphone: { search: { x: 836, y: 558, width: 2168, height: 1445 } },
    placements: ['search'],
    imageFormats: ['PNG', 'JPEG'],
    video: { width: 3840, height: 2560, minSeconds: 5, maxSeconds: 30, fps: [30, 60] },
    fileTag: 'AppStore_SearchResult',
    presetId: 'appstore-search',
  },
  {
    kind: 'universal',
    label: 'Universal',
    boardName: 'Universal header and search',
    sizeLabel: '5244 x 2950, 16:9',
    width: 5244,
    height: 2950,
    // Apple's universal safe area sits above the middle of the canvas.
    safe: { x: 1921, y: 660, width: 1402, height: 962 },
    iphone: {
      header: { x: 1878, y: 660, width: 1488, height: 962 },
      search: { x: 1900, y: 660, width: 1443, height: 962 },
    },
    placements: ['header', 'search'],
    // The 16:9 size is PNG only, and there is no universal video size.
    imageFormats: ['PNG'],
    video: null,
    fileTag: 'AppStore_Universal',
    presetId: 'appstore-universal',
  },
];

const BY_KIND = new Map<CreativeAssetKind, CreativeAssetSpec>(
  CREATIVE_ASSETS.map((spec) => [spec.kind, spec])
);

export function creativeSpec(kind: CreativeAssetKind): CreativeAssetSpec {
  const spec = BY_KIND.get(kind);
  if (!spec) throw new Error(`Unknown creative asset: ${kind}`);
  return spec;
}

export function creativeSpecForPreset(presetId: string | undefined): CreativeAssetSpec | undefined {
  return presetId ? CREATIVE_ASSETS.find((spec) => spec.presetId === presetId) : undefined;
}

/** The kinds a tag can hold, for reading a value that came from outside. */
export function isCreativeAssetKind(value: unknown): value is CreativeAssetKind {
  return typeof value === 'string' && BY_KIND.has(value as CreativeAssetKind);
}

export function isCreativeBoard(board: Pick<ArtboardState, 'creativeAsset'>): boolean {
  return isCreativeAssetKind(board.creativeAsset);
}

/** The artboards that are screenshots, in canvas order. */
export function screenshotBoards<T extends Pick<ArtboardState, 'creativeAsset'>>(boards: T[]): T[] {
  return boards.some(isCreativeBoard) ? boards.filter((board) => !isCreativeBoard(board)) : boards;
}

export function creativeBoards<T extends Pick<ArtboardState, 'creativeAsset'>>(boards: T[]): T[] {
  return boards.filter(isCreativeBoard);
}

/**
 * The artboard App Store Connect would show in a placement: the first one made
 * for it, otherwise the first universal one.
 */
export function boardForPlacement<T extends Pick<ArtboardState, 'creativeAsset'>>(
  boards: T[],
  placement: CreativePlacement
): T | undefined {
  return (
    boards.find((board) => board.creativeAsset === placement) ??
    boards.find((board) => board.creativeAsset === 'universal')
  );
}

/**
 * Search results art may be any 3:2 size from 1920 x 1280 to 3840 x 2560. The
 * header and the universal size are exact.
 */
export function acceptsSize(kind: CreativeAssetKind, size: Size): boolean {
  const spec = creativeSpec(kind);
  if (kind !== 'search') return size.width === spec.width && size.height === spec.height;
  return (
    size.width >= 1920 &&
    size.width <= 3840 &&
    size.width * 2 === size.height * 3
  );
}

/**
 * What creative art an image of this size could be, judged by size alone,
 * which is all an exported file has to go on. The CLI's `osg verify` uses it
 * so a header PNG is not failed as a screenshot of an unknown size.
 */
export function creativeSpecForSize(width: number, height: number): CreativeAssetSpec | undefined {
  return CREATIVE_ASSETS.find((spec) => acceptsSize(spec.kind, { width, height }));
}

/** A rect drawn for the spec's own size, moved onto a board of another size. */
function scaleRect(rect: PixelRect, spec: CreativeAssetSpec, size: Size): PixelRect {
  const sx = size.width / spec.width;
  const sy = size.height / spec.height;
  if (sx === 1 && sy === 1) return rect;
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

/** Apple's art safe area on this artboard, or null for a screenshot. */
export function safeAreaFor(board: Pick<ArtboardState, 'creativeAsset' | 'size'>): PixelRect | null {
  if (!isCreativeAssetKind(board.creativeAsset)) return null;
  const spec = creativeSpec(board.creativeAsset);
  return scaleRect(spec.safe, spec, board.size);
}

/** What an iPhone shows of this artboard in one placement, or null if it does not fill it. */
export function iphoneCropFor(
  board: Pick<ArtboardState, 'creativeAsset' | 'size'>,
  placement: CreativePlacement
): PixelRect | null {
  if (!isCreativeAssetKind(board.creativeAsset)) return null;
  const spec = creativeSpec(board.creativeAsset);
  const rect = spec.iphone[placement];
  return rect ? scaleRect(rect, spec, board.size) : null;
}

/**
 * What the MCP tools say about a creative artboard on top of its size: its kind
 * and its safe area, because an agent cannot see the canvas guide. Empty for a
 * screenshot, so a screenshot's summary is unchanged.
 */
export function creativeSummary(
  board: Pick<ArtboardState, 'creativeAsset' | 'size'>
): { creativeAsset?: CreativeAssetKind; safeArea?: PixelRect } {
  const safe = safeAreaFor(board);
  if (!safe || !isCreativeAssetKind(board.creativeAsset)) return {};
  return {
    creativeAsset: board.creativeAsset,
    safeArea: {
      x: Math.round(safe.x),
      y: Math.round(safe.y),
      width: Math.round(safe.width),
      height: Math.round(safe.height),
    },
  };
}

/**
 * How wide each placement is on the phone the store preview draws, an iPhone 16
 * Pro: the header runs edge to edge, the search card sits inside the page
 * margins.
 */
export const IPHONE_PLACEMENT_POINTS: Record<CreativePlacement, number> = { header: 393, search: 353 };

/**
 * The back and share buttons iOS 27 floats over the header, in points from the
 * header's top left on that phone, as Apple's renders place them. They cover
 * the top corners of the art safe area, which Apple's templates do not mark.
 */
export const IPHONE_HEADER_BUTTONS_POINTS: readonly PixelRect[] = [
  { x: 16, y: 60, width: 44, height: 44 },
  { x: 333, y: 60, width: 44, height: 44 },
];

/** Space kept between a header button and the art beside it, in points. */
const BUTTON_CLEARANCE_POINTS = 8;

/** The header buttons over this artboard, in artboard pixels. Empty when it is never a header. */
export function iphoneHeaderButtonsFor(board: Pick<ArtboardState, 'creativeAsset' | 'size'>): PixelRect[] {
  const crop = iphoneCropFor(board, 'header');
  if (!crop) return [];
  const scale = crop.width / IPHONE_PLACEMENT_POINTS.header;
  return IPHONE_HEADER_BUTTONS_POINTS.map((button) => ({
    x: crop.x + button.x * scale,
    y: crop.y + button.y * scale,
    width: button.width * scale,
    height: button.height * scale,
  }));
}

/**
 * How far in from each side of the safe area the copy has to start so it
 * clears the header buttons on an iPhone, in artboard pixels. Zero for art
 * that is never a header.
 */
export function headerButtonClearance(board: Pick<ArtboardState, 'creativeAsset' | 'size'>): number {
  const safe = safeAreaFor(board);
  const crop = iphoneCropFor(board, 'header');
  if (!safe || !crop) return 0;
  const scale = crop.width / IPHONE_PLACEMENT_POINTS.header;
  const [left] = IPHONE_HEADER_BUTTONS_POINTS;
  const innerEdge = crop.x + (left.x + left.width + BUTTON_CLEARANCE_POINTS) * scale;
  return Math.max(0, innerEdge - safe.x);
}

/** Type smaller than this on an iPhone is hard to read at a glance. */
export const MIN_READABLE_POINTS = 11;

/**
 * iPhone points per artboard pixel, in whichever placement shows this board
 * smallest. Null for a screenshot.
 */
export function iphonePointsPerPixel(board: Pick<ArtboardState, 'creativeAsset' | 'size'>): number | null {
  if (!isCreativeAssetKind(board.creativeAsset)) return null;
  let smallest = Infinity;
  for (const placement of creativeSpec(board.creativeAsset).placements) {
    const crop = iphoneCropFor(board, placement);
    if (crop && crop.width > 0) smallest = Math.min(smallest, IPHONE_PLACEMENT_POINTS[placement] / crop.width);
  }
  return Number.isFinite(smallest) ? smallest : null;
}

/** The smallest glyph, in artboard pixels, that still reads on an iPhone. */
export function minReadableGlyph(board: Pick<ArtboardState, 'creativeAsset' | 'size'>): number {
  const scale = iphonePointsPerPixel(board);
  return scale ? MIN_READABLE_POINTS / scale : 0;
}

/**
 * The file name an exported artboard gets, without the extension. The board's
 * own name is added only when it is not the default one. Two boards can still
 * come out the same, so an export names them through creativeFileStems.
 */
export function creativeFileStem(board: Pick<ArtboardState, 'creativeAsset' | 'size' | 'name'>): string | null {
  if (!isCreativeAssetKind(board.creativeAsset)) return null;
  const spec = creativeSpec(board.creativeAsset);
  const name = board.name.trim();
  const named = name && name !== spec.boardName ? `_${name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '')}` : '';
  return `${spec.fileTag}${named}_${Math.round(board.size.width)}x${Math.round(board.size.height)}`;
}

/**
 * A file name for every header and search artboard, by id, none of them the
 * same. Adding the art twice to compare two designs gives two boards with one
 * name, and a desktop export writes them into one folder, where the second
 * file would replace the first. The later board in canvas order gets _2, _3.
 *
 * Compared without case, because the Mac and Windows file systems ignore it
 * too. Pass the whole canvas, not just what is being exported, so a board
 * keeps its name when it is exported on its own.
 */
export function creativeFileStems(
  boards: readonly Pick<ArtboardState, 'id' | 'creativeAsset' | 'size' | 'name'>[]
): Record<string, string> {
  const stems: Record<string, string> = {};
  const taken = new Set<string>();
  for (const board of boards) {
    const stem = creativeFileStem(board);
    if (!stem) continue;
    let unique = stem;
    for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${stem}_${n}`;
    taken.add(unique.toLowerCase());
    stems[board.id] = unique;
  }
  return stems;
}
