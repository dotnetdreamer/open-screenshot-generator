// html-to-image re-fetches every <img> src while building the SVG clone.
// Uploaded screenshots live as blob: object URLs (issue #19 media work).
// Chrome can fetch those; WKWebView in the macOS desktop app often cannot,
// and the failure is swallowed into an empty placeholder. The live <img>
// still paints, so the canvas looks right and the PNG comes out with a
// hollow device frame. Inline the bytes as data URLs for the capture only.

import { blobForObjectUrl } from '@/lib/mediaStore';

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read a blob image for export.'));
    reader.readAsDataURL(blob);
  });
}

async function blobFromSrc(src: string): Promise<Blob | null> {
  const cached = blobForObjectUrl(src);
  if (cached) return cached;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Last resort when fetch(blob:) fails and we have no cached Blob: the live
 *  <img> is already decoded, so draw it. Same-origin blob: images are not tainted. */
function dataUrlFromDecodedImage(img: HTMLImageElement): string | null {
  if (!img.complete || img.naturalWidth < 1 || img.naturalHeight < 1) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Temporarily replace blob: image srcs under `root` with data URLs, run
 * `work` (the html-to-image capture), then put the object URLs back.
 */
export async function withBlobImagesInlined<T>(
  root: HTMLElement,
  work: () => Promise<T>
): Promise<T> {
  const images = Array.from(root.querySelectorAll('img'));
  const restore: Array<() => void> = [];

  await Promise.all(
    images.map(async (img) => {
      const src = img.currentSrc || img.src;
      if (!src.startsWith('blob:')) return;
      let dataUrl: string | null = null;
      const blob = await blobFromSrc(src);
      if (blob) {
        try {
          dataUrl = await readBlobAsDataUrl(blob);
        } catch {
          dataUrl = null;
        }
      }
      if (!dataUrl) dataUrl = dataUrlFromDecodedImage(img);
      if (!dataUrl) return;
      const previous = img.getAttribute('src') ?? img.src;
      img.src = dataUrl;
      restore.push(() => {
        img.src = previous;
      });
    })
  );

  try {
    return await work();
  } finally {
    for (const undo of restore) undo();
  }
}
