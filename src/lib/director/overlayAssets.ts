// The pictures the overlay draws (overlay.ts): the app's icon and the store
// badges. Each is decoded once and kept, so the preview draws them on every
// frame for nothing, and the export waits for them before its first frame.

import { withBasePath } from '@/lib/basePath';
import type { OverlayAssets } from './overlay';
import type { FilmText } from './types';

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** A picture, decoded; null when it can't be read. */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  let pending = images.get(src);
  if (!pending) {
    pending = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.error('Director could not read a picture for the words', src.slice(0, 60));
        resolve(null);
      };
      img.src = src;
    });
    // A failed read is tried again next time.
    pending.then((img) => {
      if (!img) images.delete(src);
    });
    images.set(src, pending);
  }
  return pending;
}

export const BADGE_FILES = {
  appStore: '/director/badges/app-store.svg',
  googlePlay: '/director/badges/google-play.png',
};

/** What a film's words need decoded: a key that changes when that does. */
export function overlayAssetsKey(text: FilmText): string {
  const card = text.card?.on ? text.card : null;
  const icon = text.icon && (text.logo || card) ? text.icon : '';
  return `${icon.length}:${icon.slice(-32)}|${card?.appStore ? 'a' : ''}${card?.googlePlay ? 'g' : ''}`;
}

/** The pictures a film's words show, decoded. */
export async function loadOverlayAssets(text: FilmText): Promise<OverlayAssets> {
  const card = text.card?.on ? text.card : null;
  const [icon, appStore, googlePlay] = await Promise.all([
    text.icon && (text.logo || card) ? loadImage(text.icon) : Promise.resolve(null),
    card?.appStore ? loadImage(withBasePath(BADGE_FILES.appStore)) : Promise.resolve(null),
    card?.googlePlay ? loadImage(withBasePath(BADGE_FILES.googlePlay)) : Promise.resolve(null),
  ]);
  return { icon, appStore, googlePlay };
}

/** The longest side an icon is kept at: more than the end card ever draws. */
const ICON_SIZE = 384;

/** A picture the user chose, as the film's icon: square, at most 384 pixels, as a PNG data URL. */
export async function iconFromFile(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(ICON_SIZE, side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Try another image for your app icon or open Director in another browser");
    ctx.imageSmoothingQuality = 'high';
    // The middle square of a picture that isn't square.
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}
