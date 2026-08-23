/**
 * Pouring a set of uploaded screenshots into a finished template.
 *
 * This is the whole trick behind the fast path: the catalog's designs already
 * have screenshot-shaped holes in them (device frames), so placing a user's
 * images is a deterministic, instant, offline transform. No model, no network,
 * no waiting. The AI agent stays available for the harder ask ("write me new
 * copy"), but nobody should have to run it just to see their app in a layout.
 *
 * Everything here is a pure function over a deep copy, so a preview can be
 * built, thrown away and rebuilt on every keystroke without touching state.
 */

import type {
  ArtboardElement,
  ArtboardState,
  DeviceFrameElementProps,
  DeviceType,
  Project,
  TextElementProps,
} from '@/types/artboard';
import {
  convertArtboardsToFormat,
  DEVICE_FORMAT_PRESETS,
  DEVICE_REGISTRY,
  getDeviceDescriptor,
  swapDeviceInElements,
  type DeviceFormat,
  type DeviceFormatPreset,
} from '@/lib/deviceRegistry';
import { normalizeGradient } from '@/lib/artboardBackground';
import { fitTextBox } from '@/lib/textFit';

/** The minimum an image has to carry to be placed. */
export interface PlaceableShot {
  id: string;
  /** Full quality data URL. Externalized into Dexie when the project is saved. */
  dataUrl: string;
  width: number;
  height: number;
  /** Detected device, used only when `matchDeviceType` is on. */
  device?: DeviceType;
}

export type UnusedBoardPolicy = 'trim' | 'keep' | 'repeat';

export interface FillOptions {
  /**
   * What to do with boards the upload cannot fill.
   * 'trim'   drop them, so five boards with three screenshots becomes three
   * 'keep'   leave the template's own demo screens in place
   * 'repeat' cycle the upload until every frame is full
   */
  unusedBoards?: UnusedBoardPolicy;
  /** Re-skin every frame to the device the screenshots actually came from. */
  matchDeviceType?: boolean;
  /** Recolour solid and gradient board backgrounds around this hex. */
  accentColor?: string | null;
  /** Replace the largest line of copy on the first board. */
  headline?: string | null;
  /** Name for the project that comes out. Defaults to the template's own. */
  nameOverride?: string;
}

export interface FillResult {
  project: Project;
  placed: number;
  /** Frames left holding the template's demo screen. */
  unfilled: number;
  /** Boards dropped because nothing landed on them. */
  trimmed: number;
  /** Frames re-skinned to the uploaded device. */
  swapped: number;
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Device frames on a board, in the order they are drawn. */
function deviceElements(board: ArtboardState): DeviceFrameElementProps[] {
  return (board.elements ?? []).filter(
    (el): el is DeviceFrameElementProps => el.type === 'device'
  );
}

/**
 * Mirrors DeviceFrameElement's own upload handler, and the AI build path's
 * applyScreenshot. `screenshotRect` is left alone on purpose: templates use it
 * to frame the visible slice of the screen, and overwriting it would throw away
 * the author's crop.
 *
 * `shot.dataUrl` is usually an `asset:<id>` reference by the time it gets here
 * (see intakeAssets.ts), not base64. That is both what lets a dozen preview
 * cards share one decoded image and what leaves externalizeInlineMedia nothing
 * to sweep on the way into Dexie. An inline data URL still works: the fallback
 * when a blob could not be stored.
 */
function applyShot(device: DeviceFrameElementProps, shot: PlaceableShot): void {
  device.screenshotSrc = shot.dataUrl;
  device.screenshotObjectFit = device.screenshotObjectFit ?? 'cover';
  device.naturalScreenshotWidth = shot.width;
  device.naturalScreenshotHeight = shot.height;
}

function hexToRgb(value: string): [number, number, number] | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value.trim());
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
    ];
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(value.trim());
  return long
    ? [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)]
    : null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Pull one colour toward another without flattening it.
 *
 * A template's five boards are usually five shades of one idea, and replacing
 * them all with the same accent would throw away the design. Blending keeps
 * each board's own light-to-dark relationship while moving the whole set into
 * the user's hue, which is what "themed" should mean.
 */
function blendToward(color: string, accent: string, amount: number): string {
  const from = hexToRgb(color);
  const to = hexToRgb(accent);
  if (!from || !to) return color;
  // Preserve the source's brightness, take the target's colour. Without this a
  // dark board and a light board would converge on the same mid-tone.
  const fromLum = (0.2126 * from[0] + 0.7152 * from[1] + 0.0722 * from[2]) / 255;
  const toLum = (0.2126 * to[0] + 0.7152 * to[1] + 0.0722 * to[2]) / 255;
  const correction = toLum > 0.02 ? Math.min(1.6, Math.max(0.35, fromLum / toLum)) : 1;
  const target: [number, number, number] = [
    to[0] * correction,
    to[1] * correction,
    to[2] * correction,
  ];
  return rgbToHex(
    from[0] + (target[0] - from[0]) * amount,
    from[1] + (target[1] - from[1]) * amount,
    from[2] + (target[2] - from[2]) * amount
  );
}

// Deliberately partial. A template's boards are usually one idea told in five
// shades, and pushing them all the way to a single accent throws that away.
// Half way keeps each board's own relationship to the others while moving the
// whole set into the user's hue.
const ACCENT_STRENGTH = 0.45;

function recolorBoard(board: ArtboardState, accent: string): void {
  // A stray gradient object on a board whose backgroundType is unset must not
  // promote it to a gradient: more than a third of the catalog's boards leave
  // backgroundType off entirely and are solid.
  if (board.backgroundType === 'gradient' && board.backgroundGradient) {
    const gradient = normalizeGradient(board.backgroundGradient);
    board.backgroundGradient = {
      color1: blendToward(gradient.color1, accent, ACCENT_STRENGTH),
      color2: blendToward(gradient.color2, accent, ACCENT_STRENGTH),
      angle: gradient.angle,
    };
    board.backgroundColor = board.backgroundGradient.color1;
    return;
  }
  board.backgroundColor = blendToward(board.backgroundColor || '#FFFFFF', accent, ACCENT_STRENGTH);
}

/** The biggest real line of copy on a board. */
function headlineElement(board: ArtboardState): TextElementProps | null {
  let best: TextElementProps | null = null;
  for (const element of board.elements ?? []) {
    if (element.type !== 'text') continue;
    const text = element as TextElementProps;
    if ((text.content ?? '').trim().length <= 2) continue;
    if (!best || (text.fontSize ?? 0) > (best.fontSize ?? 0)) best = text;
  }
  return best;
}

/**
 * Build a ready-to-open project from a template and an upload set.
 *
 * The result keeps the template's element ids, exactly like picking that
 * template out of the gallery does, so it flows through the normal
 * createProjectFromTemplateData path with no special casing: the data URLs it
 * carries are externalized into the Dexie media table there.
 */
export function fillTemplate(
  template: Project,
  shots: PlaceableShot[],
  options: FillOptions = {}
): FillResult {
  const {
    unusedBoards = 'trim',
    matchDeviceType = false,
    accentColor = null,
    headline = null,
    nameOverride,
  } = options;

  let boards = deepCopy(template.projectData ?? []) as ArtboardState[];
  let placed = 0;
  let unfilled = 0;
  let swapped = 0;
  let cursor = 0;
  const filledBoards = new Set<number>();
  const assigned = new Set<string>();

  // The device every frame should become, when the caller asked for that. Only
  // the majority device is used: a mixed upload set has no single answer, and
  // re-skinning frame by frame would produce a project of mismatched phones.
  let targetDevice: DeviceType | null = null;
  if (matchDeviceType) {
    const votes = new Map<DeviceType, number>();
    for (const shot of shots) {
      if (!shot.device) continue;
      votes.set(shot.device, (votes.get(shot.device) ?? 0) + 1);
    }
    let bestCount = 0;
    for (const [device, count] of votes) {
      if (count > bestCount) {
        bestCount = count;
        targetDevice = device;
      }
    }
  }

  boards.forEach((board, boardIndex) => {
    for (const device of deviceElements(board)) {
      const shot =
        cursor < shots.length
          ? shots[cursor++]
          : unusedBoards === 'repeat' && shots.length > 0
            ? shots[cursor++ % shots.length]
            : null;
      if (!shot) {
        unfilled++;
        continue;
      }
      applyShot(device, shot);
      assigned.add(device.id);
      placed++;
      filledBoards.add(boardIndex);
    }

    // Re-skin after placing, so the swap's screen-aware overlay refit sees the
    // final frames. Cross-category swaps (a phone frame asked to become a Mac)
    // are refused: the template's whole composition was built around the box it
    // has, and area-preserving a phone into a 16:9 laptop wrecks it.
    if (targetDevice) {
      const wanted = getDeviceDescriptor(targetDevice);
      for (const device of deviceElements(board)) {
        if (device.deviceType === targetDevice) continue;
        if (getDeviceDescriptor(device.deviceType).category !== wanted.category) continue;
        const next = swapDeviceInElements(board.elements, device.id, targetDevice);
        if (next) {
          board.elements = next;
          swapped++;
        }
      }
    }

    if (accentColor) recolorBoard(board, accentColor);
  });

  // Boards that got nothing are boards the user has no content for. Dropping
  // them is what a designer would do; keeping them would ship a store listing
  // that is half somebody else's app.
  let trimmed = 0;
  if (unusedBoards === 'trim' && filledBoards.size > 0) {
    const kept = boards.filter((board, index) => {
      // A board with no device frame at all is decorative (a title card, a
      // feature graphic) and is kept as long as anything before it survived.
      if (deviceElements(board).length === 0) return index === 0 || filledBoards.has(index - 1);
      return filledBoards.has(index);
    });
    trimmed = boards.length - kept.length;
    boards = kept;

    // A board with several frames can be kept on the strength of one of them.
    // The rest still hold the template's bundled demo screens, and shipping a
    // store listing that is half somebody else's app is worse than shipping one
    // with a gap in it. Empty them, so the frame reads as a slot to fill.
    unfilled = 0;
    for (const board of boards) {
      for (const device of deviceElements(board)) {
        if (assigned.has(device.id)) continue;
        device.screenshotSrc = undefined;
        unfilled++;
      }
    }
  }

  if (headline && boards.length > 0) {
    const element = headlineElement(boards[0]);
    if (element) {
      element.content = headline;
      // Rule 3: every place a user edits copy folds the refit into the same
      // update, or a longer line silently clips.
      const fitted = fitTextBox(element, headline);
      if (fitted) {
        element.size = fitted.size;
        element.position = fitted.position;
      }
    }
  }

  return {
    project: {
      ...template,
      // The template's OWN id, deliberately. handleSelectTemplate reports
      // trackTemplateSelected({ templateId: template.id }) on the way through,
      // so minting a synthetic id here would file every fill under a template
      // that does not exist and lose the real one. Nothing downstream reads it
      // as a project id: createProjectFromTemplateData mints project_<stamp>.
      id: template.id,
      name: nameOverride?.trim() || template.name,
      projectData: boards,
    },
    placed,
    unfilled,
    trimmed,
    swapped,
  };
}

/**
 * Which uploaded shot ends up in which device frame.
 *
 * Derived by walking the SAME cursor `fillTemplate` walks, rather than guessing
 * from board order, so the highlight can never disagree with the placement it
 * is describing. Keyed by device element id, valued with the 0-based index of
 * the shot that lands there.
 */
export function slotOwners(
  template: Project,
  shotCount: number,
  unusedBoards: UnusedBoardPolicy = 'trim'
): Map<string, number> {
  const owners = new Map<string, number>();
  if (shotCount <= 0) return owners;
  let cursor = 0;
  for (const board of template.projectData ?? []) {
    for (const device of deviceElements(board)) {
      if (cursor < shotCount) {
        owners.set(device.id, cursor++);
      } else if (unusedBoards === 'repeat') {
        owners.set(device.id, cursor++ % shotCount);
      }
    }
  }
  return owners;
}

/**
 * A single board, filled, for a result card's live preview.
 *
 * Rendering one board rather than the whole template is what keeps the results
 * grid affordable: a template with 3D device frames costs a WebGL context per
 * frame, and Chrome evicts the oldest context once roughly sixteen are alive,
 * blanking whatever it evicted.
 */
export function fillBoardPreview(
  template: Project,
  boardIndex: number,
  shots: PlaceableShot[],
  options: Pick<FillOptions, 'accentColor' | 'matchDeviceType' | 'headline'> = {}
): ArtboardState | null {
  const source = template.projectData?.[boardIndex];
  if (!source) return null;
  // Fill the whole template so board N gets the screenshots board N would
  // actually receive, then hand back just that board.
  const result = fillTemplate(template, shots, { ...options, unusedBoards: 'keep' });
  return result.project.projectData?.[boardIndex] ?? null;
}

/** Frames across a whole template, for the "holds N screenshots" badge. */
export function countSlots(template: Project): number {
  let total = 0;
  for (const board of template.projectData ?? []) {
    total += deviceElements(board).length;
  }
  return total;
}

/** Devices a template is built around, most used first. */
export function templateDevices(template: Project): DeviceType[] {
  const votes = new Map<DeviceType, number>();
  for (const board of template.projectData ?? []) {
    for (const device of deviceElements(board)) {
      votes.set(device.deviceType, (votes.get(device.deviceType) ?? 0) + 1);
    }
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Human label for a device id, for badges and hints. */
export function deviceLabel(id: DeviceType): string {
  return DEVICE_REGISTRY[id]?.label ?? id;
}

/**
 * The same thing in one word, for a 74px tile.
 *
 * The full registry label is right in a tooltip and useless in a caption:
 * "iPhone 17 Pro Max" truncates to "iPh...", which tells the user nothing at
 * all about whether the detection was correct.
 */
export function shortDeviceLabel(id: DeviceType): string {
  const descriptor = DEVICE_REGISTRY[id];
  if (!descriptor) return 'Device';
  if (id === 'macbook') return 'MacBook';
  if (id === 'imac') return 'iMac';
  switch (descriptor.category) {
    case 'watch':
      return 'Watch';
    case 'desktop':
      return 'Desktop';
    case 'tablet':
      return descriptor.platform === 'ios' ? 'iPad' : 'Tablet';
    case 'phone':
      return descriptor.platform === 'ios' ? 'iPhone' : 'Android';
    default:
      return 'Device';
  }
}

/** Unused, but exported so callers can narrow an element list the same way. */
export function isDeviceElement(el: ArtboardElement): el is DeviceFrameElementProps {
  return el.type === 'device';
}

/**
 * The store format an upload set wants, when the template does not already
 * speak it.
 *
 * This is the answer to the catalog's real gap. The bundled designs are almost
 * all iPhone: somebody who uploads iPad or Android captures would otherwise see
 * nothing that fits, and be told, correctly but uselessly, that their
 * screenshots do not match. Instead the layout they liked is converted, which
 * is a supported whole-project transform (convertArtboardsToFormat) that
 * resizes every board to the store-correct canvas and swaps every frame.
 *
 * Returns null when the template is already in the right format, which is the
 * common case and must cost nothing.
 */
export function suggestedFormat(
  template: Project,
  device: DeviceType
): DeviceFormatPreset | null {
  const wanted = getDeviceDescriptor(device);
  if (wanted.category === 'custom') return null;

  const existing = templateDevices(template);
  if (existing.length === 0) return null;
  // Already built around this exact device: nothing to offer.
  if (existing.includes(device)) return null;

  const current = getDeviceDescriptor(existing[0]);
  // Only phone and tablet formats are store formats. A Mac or a watch layout is
  // its own product, and converting one into the other is not a helpful guess.
  if (wanted.category !== 'phone' && wanted.category !== 'tablet') return null;
  if (current.category !== 'phone' && current.category !== 'tablet') return null;

  const targetId: DeviceFormat | null =
    wanted.category === 'tablet'
      ? (DEVICE_FORMAT_PRESETS.find((preset) => preset.id === device)?.id ?? null)
      : wanted.platform === 'android'
        ? 'android'
        : wanted.platform === 'ios'
          ? 'ios'
          : null;
  if (!targetId) return null;

  const preset = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === targetId) ?? null;
  if (!preset) return null;
  // Same platform and same canvas already: the swap would be a no-op.
  if (
    current.category === wanted.category &&
    current.platform === wanted.platform &&
    template.projectData?.[0]?.size.width === preset.artboard.width &&
    template.projectData?.[0]?.size.height === preset.artboard.height
  ) {
    return null;
  }
  return preset;
}

/** Apply a store format to a filled project. One pure transform, no state. */
export function applyFormat(project: Project, preset: DeviceFormatPreset): Project {
  const { artboards } = convertArtboardsToFormat(project.projectData ?? [], preset);
  return { ...project, projectData: artboards };
}
