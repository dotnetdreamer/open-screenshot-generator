/**
 * The screenshots in the open project that a Limelight screen can show: the
 * picture in each device frame, artboard by artboard, in canvas order. Only
 * the pictures are read; the project is never changed.
 *
 * A picture taken from a project is copied into Limelight's own database when
 * it goes on a screen, with a note of where it came from (`ScreenOrigin`), so
 * a scene keeps working if the project changes or goes, and the note is what
 * a language's own screenshot will be found by later.
 */

import type { ArtboardState, DeviceFrameElementProps } from '@/types/artboard';
import { withBasePath } from '@/lib/basePath';
import { assetIdFromRef, getMediaAsset, isAssetRef } from '@/lib/mediaStore';
import type { ScreenOrigin } from './types';

export interface ProjectShot {
  /** Unique in the list: artboard and element. */
  key: string;
  artboardId: string;
  artboardName: string;
  elementId: string;
  /** As the element stores it: asset:, data:, blob:, a web address or a path in the app. */
  src: string;
  /** True for the sample picture a template ships with, false for the user's own. */
  sample: boolean;
}

function isUserContent(src: string): boolean {
  return src.startsWith('data:') || src.startsWith('blob:') || isAssetRef(src);
}

/** Every device frame's picture, the user's own first. */
export function projectShots(artboards: ArtboardState[]): ProjectShot[] {
  const shots: ProjectShot[] = [];
  const seen = new Set<string>();
  artboards.forEach((artboard, index) => {
    for (const element of artboard.elements ?? []) {
      if (element.type !== 'device') continue;
      const src = (element as DeviceFrameElementProps).screenshotSrc;
      if (!src) continue;
      const key = `${artboard.id}/${element.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      shots.push({
        key,
        artboardId: artboard.id,
        artboardName: artboard.name || `Artboard ${index + 1}`,
        elementId: element.id,
        src,
        sample: !isUserContent(src),
      });
    }
  });
  // The user's own pictures first; a template's samples only after them.
  return [...shots.filter((shot) => !shot.sample), ...shots.filter((shot) => shot.sample)];
}

/** The picture's file. */
export async function shotBlob(src: string): Promise<Blob | null> {
  if (isAssetRef(src)) {
    const asset = await getMediaAsset(assetIdFromRef(src));
    return asset?.blob ?? null;
  }
  try {
    const response = await fetch(withBasePath(src));
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.type.startsWith('image/') ? blob : null;
  } catch {
    return null;
  }
}

export function originOf(projectId: string | null | undefined, shot: ProjectShot, locale?: string | null): ScreenOrigin | undefined {
  if (!projectId) return undefined;
  const origin: ScreenOrigin = { projectId, artboardId: shot.artboardId, elementId: shot.elementId };
  if (locale) origin.locale = locale;
  return origin;
}
