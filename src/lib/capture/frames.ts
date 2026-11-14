/**
 * The frames a project can take a screenshot or a recording into, and what
 * each one holds in each language.
 *
 * A target is one device frame on one screenshot artboard. App Store header
 * and search art is skipped (`isCreativeBoard`): its phones are drawn from the
 * project's own screenshots. Pure, so the grid can be worked out again on
 * every change of the project.
 */

import type {
  ArtboardState,
  CaptureScreen,
  DeviceFrameElementProps,
  DeviceType,
  VideoDeviceElementProps,
} from '@/types/artboard';
import { isCreativeBoard } from '@/lib/creative/specs';
import { getDeviceDescriptor, getDeviceScreenRect, type DevicePlatform } from '@/lib/deviceRegistry';
import { projectArtboards } from '@/lib/i18n/project';

export interface CaptureTarget {
  /** `<boardId>:<elementId>`. */
  key: string;
  boardId: string;
  boardName: string;
  /** Position among the screenshot artboards, from 0. */
  boardIndex: number;
  elementId: string;
  /** A screenshot frame takes a picture, a video frame a recording. */
  kind: 'screenshot' | 'recording';
  deviceType: DeviceType;
  platform: DevicePlatform;
  /** "iPhone 17 Pro Max". */
  deviceLabel: string;
  /** Width over height of the frame's screen, when the frame has a known screen. */
  screenAspect: number | null;
  /** Which frame of its artboard this is, from 1, and how many the artboard has. */
  frameNumber: number;
  frameCount: number;
  /** How Capture reaches the frame's screen in the app; unset is by hand. */
  screen?: CaptureScreen;
}

export interface CaptureCell {
  target: CaptureTarget;
  /** The project language, never null: the base language is named too. */
  locale: string;
  /** What the frame shows in this language: a screenshot source or a recording id. */
  src?: string;
  mediaId?: string;
  /** The user's own picture or recording, as opposed to the template's placeholder. */
  own: boolean;
  /** The frame is hidden in this language. */
  hidden: boolean;
}

/** An `asset:`, `data:` or `blob:` source is the user's; a public path is the template's art. */
export function isOwnPicture(src: string | undefined): boolean {
  if (!src) return false;
  const value = src.trim();
  return value.startsWith('asset:') || value.startsWith('data:') || value.startsWith('blob:');
}

function screenAspectOf(element: DeviceFrameElementProps | VideoDeviceElementProps): number | null {
  if (element.type === 'device') {
    const rect = getDeviceScreenRect(element);
    if (rect && rect.width > 0 && rect.height > 0) return rect.width / rect.height;
  }
  if (element.deviceType === 'custom') return null;
  const descriptor = getDeviceDescriptor(element.deviceType);
  return descriptor.nativeAspect > 0 ? descriptor.nativeAspect : null;
}

export function captureTargets(base: ArtboardState[]): CaptureTarget[] {
  const targets: CaptureTarget[] = [];
  let boardIndex = 0;
  for (const board of base) {
    if (isCreativeBoard(board)) continue;
    const frames = board.elements.filter(
      (element): element is DeviceFrameElementProps | VideoDeviceElementProps =>
        element.type === 'device' || element.type === 'video-device'
    );
    frames.forEach((element, index) => {
      const descriptor = getDeviceDescriptor(element.deviceType);
      targets.push({
        key: `${board.id}:${element.id}`,
        boardId: board.id,
        boardName: board.name || `Artboard ${boardIndex + 1}`,
        boardIndex,
        elementId: element.id,
        kind: element.type === 'video-device' ? 'recording' : 'screenshot',
        deviceType: element.deviceType,
        platform: descriptor.platform,
        deviceLabel: element.deviceType === 'custom' ? 'Your own frame' : descriptor.label,
        screenAspect: screenAspectOf(element),
        frameNumber: index + 1,
        frameCount: frames.length,
        screen: element.type === 'device' ? element.captureScreen : undefined,
      });
    });
    boardIndex += 1;
  }
  return targets;
}

export function cellKey(targetKey: string, locale: string): string {
  return `${targetKey}|${locale}`;
}

/**
 * What every target shows in every language. `locales` lists the project's
 * languages with the base language first; the base language reads the base
 * document, the others its projection.
 */
export function captureCells(
  base: ArtboardState[],
  targets: CaptureTarget[],
  locales: string[],
  baseLocale: string
): Map<string, CaptureCell> {
  const cells = new Map<string, CaptureCell>();
  for (const locale of locales) {
    const view = locale === baseLocale ? base : projectArtboards(base, locale);
    const boards = new Map(view.map((board) => [board.id, board]));
    for (const target of targets) {
      const element = boards.get(target.boardId)?.elements.find((candidate) => candidate.id === target.elementId);
      const key = cellKey(target.key, locale);
      if (!element || (element.type !== 'device' && element.type !== 'video-device')) {
        cells.set(key, { target, locale, own: false, hidden: true });
        continue;
      }
      if (element.type === 'device') {
        cells.set(key, { target, locale, src: element.screenshotSrc, own: isOwnPicture(element.screenshotSrc), hidden: false });
      } else {
        cells.set(key, {
          target,
          locale,
          mediaId: element.mediaId,
          src: element.posterSrc,
          own: !!element.mediaId,
          hidden: false,
        });
      }
    }
  }
  return cells;
}
