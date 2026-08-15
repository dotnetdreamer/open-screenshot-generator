// Turning the open project into feed images.
//
// The share form captures the live artboards with the same html-to-image pass
// the PNG export uses, then does two things with them here: composes a wide
// strip cover (so a shared post looks like the rest of the feed instead of one
// very tall phone) and downscales each board for the carousel.
//
// Everything is re-encoded to JPEG at feed resolution. A raw capture is a
// 1290x2796 PNG, several megabytes each, and these are stored in IndexedDB and
// will one day be uploaded: nobody needs print resolution to decide whether
// they like a layout.

import type { Size } from '@/types/artboard';
import type { DiscoverSurface } from '@/types/discover';

/** Cover strip geometry, matching the 3:1 template previews. */
const STRIP_WIDTH = 1800;
const STRIP_HEIGHT = 600;
const STRIP_GAP = 24;
const STRIP_PADDING = 24;
/** Long edge for a single board in the carousel. */
const BOARD_MAX_EDGE = 1200;
const JPEG_QUALITY = 0.86;

export interface CapturedBoard {
  /** The artboard id, since two boards in a project may share a name. */
  id: string;
  /** PNG data URL straight from html-to-image. */
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

export interface ComposedImage {
  blob: Blob;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A captured screen could not be read back.'));
    image.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

/**
 * Lay the boards out side by side on a 3:1 canvas, scaled to the same height
 * and centred, which is exactly how the bundled template previews are framed.
 * `background` should be the first board's colour so the padding around the
 * boards reads as part of the design rather than a white margin.
 */
export async function composeStrip(
  boards: CapturedBoard[],
  background: string
): Promise<ComposedImage> {
  const canvas = document.createElement('canvas');
  canvas.width = STRIP_WIDTH;
  canvas.height = STRIP_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not prepare the preview image.');

  ctx.fillStyle = background || '#ffffff';
  ctx.fillRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT);

  const images = await Promise.all(boards.map((board) => loadImage(board.dataUrl)));
  const innerHeight = STRIP_HEIGHT - STRIP_PADDING * 2;
  const totalGap = STRIP_GAP * Math.max(0, images.length - 1);
  const widthAtFullHeight = images.reduce(
    (sum, image) => sum + (image.width / image.height) * innerHeight,
    0
  );
  // Shrink to fit when the boards are wider than the strip (five 16:10 Mac
  // boards, say); never enlarge past the strip height.
  const scale = Math.min(1, (STRIP_WIDTH - STRIP_PADDING * 2 - totalGap) / widthAtFullHeight);
  const drawHeight = innerHeight * scale;

  const drawnWidth =
    images.reduce((sum, image) => sum + (image.width / image.height) * drawHeight, 0) + totalGap;
  let x = (STRIP_WIDTH - drawnWidth) / 2;
  const y = (STRIP_HEIGHT - drawHeight) / 2;

  for (const image of images) {
    const width = (image.width / image.height) * drawHeight;
    ctx.drawImage(image, x, y, width, drawHeight);
    x += width + STRIP_GAP;
  }

  return { blob: await toBlob(canvas), width: STRIP_WIDTH, height: STRIP_HEIGHT };
}

/** One board, downscaled to feed resolution. */
export async function downscaleBoard(board: CapturedBoard): Promise<ComposedImage> {
  const image = await loadImage(board.dataUrl);
  const scale = Math.min(1, BOARD_MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not prepare the preview image.');
  ctx.drawImage(image, 0, 0, width, height);

  return { blob: await toBlob(canvas), width, height };
}

/**
 * Which surface a project is for, from the shape and size of its boards. The
 * share form seeds its picker with this and the user can override it, so a
 * wrong guess costs one click.
 */
export function guessSurface(size: Size | undefined): DiscoverSurface {
  if (!size?.width || !size?.height) return 'screenshots';
  const ratio = size.width / size.height;
  // An App Preview board (886x1920) and a screenshot board (1290x2796) have the
  // same aspect ratio to three decimal places, so only the exact size tells
  // them apart.
  if (size.width === 886 && size.height === 1920) return 'app-preview';
  // Landscape: a 1024x500 Play banner is much wider than a 16:10 Mac board.
  if (ratio > 1.7) return 'play-feature-graphic';
  if (ratio > 1) return 'mac';
  // Watch boards are small and nearly square (422x514 on the Ultra).
  if (ratio > 0.7 && size.width <= 600) return 'apple-watch';
  return 'screenshots';
}
