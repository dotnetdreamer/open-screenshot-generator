/**
 * Small copies of the pictures in Capture's grid.
 *
 * The grid shows a cell per frame and language, and a screenshot from a
 * simulator is 1320 x 2868. Drawn at full size into 96px cells, WKWebView
 * painted the middle of each picture black on the Mac this was built on, and
 * every cell held a full decoded bitmap, about 15 MB at that size, in a
 * webview that has run out of memory before (issue #19). So each picture is
 * decoded once at the cell's width and kept as a small JPEG, by source.
 */

import { useEffect, useState } from 'react';
import { withBasePath } from '@/lib/basePath';
import { assetIdFromRef, getMediaAsset, isAssetRef } from '@/lib/mediaStore';

const MAX_ENTRIES = 240;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

async function sourceBlob(src: string): Promise<Blob | null> {
  if (isAssetRef(src)) return (await getMediaAsset(assetIdFromRef(src)))?.blob ?? null;
  const response = await fetch(withBasePath(src));
  return response.ok ? response.blob() : null;
}

async function makeThumbnail(src: string, width: number): Promise<string | null> {
  const blob = await sourceBlob(src);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeQuality: 'medium' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    const small = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return small ? URL.createObjectURL(small) : null;
  } finally {
    bitmap.close();
  }
}

/** A small copy of `src` at `width` pixels, made once and kept. */
export function thumbnailFor(src: string, width: number): Promise<string | null> {
  const key = `${width}|${src}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = pending.get(key);
  if (running) return running;
  const work = makeThumbnail(src, width)
    .catch(() => null)
    .then((url) => {
      pending.delete(key);
      if (url) {
        cache.set(key, url);
        // The oldest go first once the cache is full.
        while (cache.size > MAX_ENTRIES) {
          const [oldest, oldUrl] = cache.entries().next().value as [string, string];
          cache.delete(oldest);
          URL.revokeObjectURL(oldUrl);
        }
      }
      return url;
    });
  pending.set(key, work);
  return work;
}

/** The small copy for an <img>, undefined while it is being made or when it cannot be. */
export function useThumbnail(src: string | undefined, width: number): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (src ? cache.get(`${width}|${src}`) : undefined));
  useEffect(() => {
    if (!src) {
      setUrl(undefined);
      return;
    }
    let live = true;
    const hit = cache.get(`${width}|${src}`);
    if (hit) {
      setUrl(hit);
      return;
    }
    setUrl(undefined);
    void thumbnailFor(src, width).then((made) => {
      if (live) setUrl(made ?? undefined);
    });
    return () => {
      live = false;
    };
  }, [src, width]);
  return url;
}
