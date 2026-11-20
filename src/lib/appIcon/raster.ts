/**
 * Drawing an icon export's pictures from three captures of the icon artboard
 * (the whole icon, its front layer on transparent, its back layer), each at
 * 1024 x 1024. Browser only: everything here is a canvas.
 *
 * Shrinking happens in halves, never in one step: a 1024 picture drawn
 * straight into 16 pixels skips most of its pixels and comes out jagged.
 */

import { encodeOpaquePngDataUrl } from '@/lib/pngOpaque';
import type { IconRecipe } from './exportPlan';
import { ANDROID_LAYER_SCALE, MAC_BODY_SHARE, superellipsePath } from './specs';

export type CaptureSource = HTMLImageElement | HTMLCanvasElement;

export interface IconCaptures {
  /** The whole icon as the board draws it, with nothing painted behind. */
  full: CaptureSource;
  /** The front layer alone, on transparent. */
  front: CaptureSource;
  /** The back layer alone: the board's ground and its back elements. */
  back: CaptureSource;
}

export interface RecipeOptions {
  /** Painted behind anything see-through where the picture cannot have an alpha channel. */
  ground: string;
  /** The icon asks for a white front in iOS's dark and tinted icons. */
  whiteInDark: boolean;
}

export function loadCapture(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'sync';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A capture of the icon could not be read.'));
    image.src = dataUrl;
  });
}

function sourceSize(source: CaptureSource): number {
  return source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
}

function canvasOf(size: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not prepare a canvas for the icon.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

/** The source at `size`, shrunk in halves. */
export function scaled(source: CaptureSource, size: number): CaptureSource {
  let current: CaptureSource = source;
  let width = sourceSize(source);
  if (width === size) return source;
  while (width / 2 >= size * 1.0001 && width > 2) {
    const half = Math.max(size, Math.round(width / 2));
    const { canvas, context } = canvasOf(half);
    context.drawImage(current, 0, 0, half, half);
    current = canvas;
    width = half;
  }
  if (width === size) return current;
  const { canvas, context } = canvasOf(size);
  context.drawImage(current, 0, 0, size, size);
  return canvas;
}

/** Keeps the alpha, turns every colour white. */
function whiten(context: CanvasRenderingContext2D, size: number): void {
  context.save();
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, size, size);
  context.restore();
}

/** Grey by luminance over black, fully opaque: what iOS's tinted icon is made from. */
function greyOnBlack(context: CanvasRenderingContext2D, size: number): void {
  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const grey = Math.round((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * alpha);
    data[i] = grey;
    data[i + 1] = grey;
    data[i + 2] = grey;
    data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

/**
 * The back layer at `size`, with the board in the middle and its edges carried
 * out to the layer's edge. Android shows that outer part only while it moves or
 * pulses the icon, so carrying the edge colour out is enough there, and a
 * solid colour or a gradient comes out continuous.
 */
function bleed(context: CanvasRenderingContext2D, back: CaptureSource, size: number): void {
  const inner = Math.round(size / ANDROID_LAYER_SCALE);
  const offset = (size - inner) / 2;
  const source = scaled(back, inner);
  const edge = 1;
  const far = inner - edge;
  // Sides, then corners, then the board itself over the middle.
  context.drawImage(source, 0, 0, edge, inner, 0, offset, offset, inner);
  context.drawImage(source, far, 0, edge, inner, offset + inner, offset, offset, inner);
  context.drawImage(source, 0, 0, inner, edge, offset, 0, inner, offset);
  context.drawImage(source, 0, far, inner, edge, offset, offset + inner, inner, offset);
  context.drawImage(source, 0, 0, edge, edge, 0, 0, offset, offset);
  context.drawImage(source, far, 0, edge, edge, offset + inner, 0, offset, offset);
  context.drawImage(source, 0, far, edge, edge, 0, offset + inner, offset, offset);
  context.drawImage(source, far, far, edge, edge, offset + inner, offset + inner, offset, offset);
  context.drawImage(source, offset, offset);
}

function roundedPath(size: number, share: number): Path2D {
  const path = new Path2D();
  const r = size * share;
  path.moveTo(r, 0);
  path.arcTo(size, 0, size, size, r);
  path.arcTo(size, size, 0, size, r);
  path.arcTo(0, size, 0, 0, r);
  path.arcTo(0, 0, size, 0, r);
  path.closePath();
  return path;
}

/** Draws one recipe and returns the canvas, plus whether it must be written without alpha. */
export function drawRecipe(recipe: IconRecipe, captures: IconCaptures, options: RecipeOptions): { canvas: HTMLCanvasElement; noAlpha: boolean } {
  const size = recipe.size;
  const { canvas, context } = canvasOf(size);
  switch (recipe.kind) {
    case 'full': {
      if (recipe.noAlpha) {
        context.fillStyle = options.ground;
        context.fillRect(0, 0, size, size);
      }
      context.drawImage(scaled(captures.full, size), 0, 0, size, size);
      return { canvas, noAlpha: recipe.noAlpha };
    }
    case 'dark': {
      context.drawImage(scaled(captures.front, size), 0, 0, size, size);
      if (options.whiteInDark) whiten(context, size);
      return { canvas, noAlpha: false };
    }
    case 'tinted': {
      context.drawImage(scaled(captures.front, size), 0, 0, size, size);
      if (options.whiteInDark) whiten(context, size);
      greyOnBlack(context, size);
      return { canvas, noAlpha: true };
    }
    case 'android-layer': {
      if (recipe.layer === 'back') {
        bleed(context, captures.back, size);
        return { canvas, noAlpha: false };
      }
      const inner = Math.round(size / ANDROID_LAYER_SCALE);
      const offset = (size - inner) / 2;
      context.drawImage(scaled(captures.front, inner), offset, offset, inner, inner);
      if (recipe.layer === 'mono') whiten(context, size);
      return { canvas, noAlpha: false };
    }
    case 'android-legacy': {
      context.save();
      if (recipe.shape === 'circle') {
        context.beginPath();
        context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        context.clip();
      } else {
        context.clip(roundedPath(size, 0.16));
      }
      context.fillStyle = options.ground;
      context.fillRect(0, 0, size, size);
      context.drawImage(scaled(captures.full, size), 0, 0, size, size);
      context.restore();
      return { canvas, noAlpha: false };
    }
    case 'mac': {
      const body = size * MAC_BODY_SHARE;
      const offset = (size - body) / 2;
      const shape = new Path2D();
      shape.addPath(new Path2D(superellipsePath(body)), new DOMMatrix().translate(offset, offset));
      // The soft shadow Mac icons sit on, then the icon cut to its shape.
      context.save();
      context.shadowColor = 'rgba(0, 0, 0, 0.3)';
      context.shadowBlur = size * 0.02;
      context.shadowOffsetY = size * 0.01;
      context.fillStyle = options.ground;
      context.fill(shape);
      context.restore();
      context.save();
      context.clip(shape);
      context.drawImage(scaled(captures.full, Math.round(body)), offset, offset, body, body);
      context.restore();
      return { canvas, noAlpha: false };
    }
    case 'layer': {
      context.drawImage(scaled(recipe.layer === 'front' ? captures.front : captures.back, size), 0, 0, size, size);
      return { canvas, noAlpha: false };
    }
  }
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** PNG bytes. Without alpha the file is written here, because no browser will (pngOpaque.ts). */
export async function encodePng(canvas: HTMLCanvasElement, noAlpha: boolean): Promise<Uint8Array> {
  if (noAlpha) {
    const opaque = await encodeOpaquePngDataUrl(canvas);
    if (opaque) return dataUrlBytes(opaque);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  return dataUrlBytes(canvas.toDataURL('image/png'));
}

/** RGBA pixels of a capture at `size`, for the checks. */
export function pixelsOf(source: CaptureSource, size: number): { data: Uint8ClampedArray; width: number; height: number } {
  const { context } = canvasOf(size);
  context.drawImage(scaled(source, size), 0, 0, size, size);
  const image = context.getImageData(0, 0, size, size);
  return { data: image.data, width: size, height: size };
}
