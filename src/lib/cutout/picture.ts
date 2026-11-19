// Pictures in and out of the background remover: decoding a file into RGBA
// at a working size, and encoding the results. Browser only (canvas).

/**
 * The longest side a picture is worked on at. A cut-out goes into a store
 * screenshot, the tallest of which is 2868 pixels, and every buffer here is
 * width times height times four bytes: a 12 megapixel photo at full size is
 * 48 MB a copy, and the Mac app's web view has been killed at about 500 MB.
 */
export const WORKING_SIDE = 3072;

export interface WorkingPicture {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** True when some pixel is not fully opaque. */
  hasAlpha: boolean;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** WebKit keeps a canvas's memory until it is resized, so every one made here is let go this way. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** The size a picture is worked on at, keeping its shape. */
export function workingSize(width: number, height: number, maxSide = WORKING_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Decodes a picture file into RGBA at its working size, the camera's rotation applied. */
export async function decodePicture(blob: Blob, maxSide = WORKING_SIDE): Promise<WorkingPicture> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("That file isn't a photo the app can open. Use a PNG, JPG, WebP or HEIC file");
  }
  try {
    const size = workingSize(bitmap.width, bitmap.height, maxSide);
    const canvas = canvasOf(size.width, size.height);
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('This browser could not draw the picture');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const rgba = context.getImageData(0, 0, size.width, size.height).data;
      let hasAlpha = false;
      for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] !== 255) {
          hasAlpha = true;
          break;
        }
      }
      return { rgba, width: size.width, height: size.height, hasAlpha };
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    bitmap.close();
  }
}

/** RGBA drawn at another size, through the browser's own smoothing. */
export function scaleRgba(rgba: Uint8ClampedArray, width: number, height: number, toWidth: number, toHeight: number): Uint8ClampedArray {
  if (toWidth === width && toHeight === height) return rgba;
  const source = canvasOf(width, height);
  const target = canvasOf(toWidth, toHeight);
  try {
    source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const context = target.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser could not draw the picture');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, toWidth, toHeight);
    return context.getImageData(0, 0, toWidth, toHeight).data;
  } finally {
    releaseCanvas(source);
    releaseCanvas(target);
  }
}

/** RGBA to a file: PNG keeps transparency, JPEG is for an opaque photo. */
export async function encodeRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92
): Promise<Blob> {
  const canvas = canvasOf(width, height);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not draw the picture');
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error('The picture could not be saved');
    return blob;
  } finally {
    releaseCanvas(canvas);
  }
}

/** One byte a pixel (a mask) as a greyscale PNG, the way it is kept. */
export function encodeMask(mask: Uint8Array, width: number, height: number): Promise<Blob> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return encodeRgba(rgba, width, height, 'image/png');
}

/** A mask kept as a greyscale PNG, back to one byte a pixel. */
export async function decodeMask(blob: Blob, width: number, height: number): Promise<Uint8Array> {
  const picture = await decodePicture(blob, Math.max(width, height));
  const mask = new Uint8Array(width * height);
  if (picture.width !== width || picture.height !== height) throw new Error('The saved cut-out does not match its picture');
  for (let i = 0; i < mask.length; i++) mask[i] = picture.rgba[i * 4];
  return mask;
}

/** A small copy for lists and the palette, transparency kept (PNG). */
export async function thumbnailOf(rgba: Uint8ClampedArray, width: number, height: number, side = 256): Promise<Blob> {
  const size = workingSize(width, height, side);
  return encodeRgba(scaleRgba(rgba, width, height, size.width, size.height), size.width, size.height, 'image/png');
}
