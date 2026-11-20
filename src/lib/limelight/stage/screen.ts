/**
 * What a device's display shows on the stage: one canvas per device, drawn
 * again only when the picture or a transition's progress changes, and laid on
 * the display as a texture. A screen that is not changing costs nothing per
 * frame; one in a transition is a 2D draw and one texture upload a frame,
 * for the half second the transition takes.
 *
 * Pictures come from StageMedia already decoded and no larger than
 * MAX_SIDE, so the canvas never holds more than the screen can show.
 */

import * as THREE from 'three';
import { easeProgress } from '../animate';
import type { ScreenFrame } from '../types';

/** The longest side of a screen's canvas, in pixels: sharp on a 4K frame, and 16 MB at most. */
export const MAX_SIDE = 2048;

export type Picture = ImageBitmap | HTMLCanvasElement | HTMLImageElement;

export function pictureSize(picture: Picture): { width: number; height: number } {
  if ('naturalWidth' in picture) return { width: picture.naturalWidth, height: picture.naturalHeight };
  return { width: picture.width, height: picture.height };
}

/** Draws `picture` to fill the rectangle, cropping like object-fit cover. */
function drawCover(ctx: CanvasRenderingContext2D, picture: Picture, x: number, y: number, w: number, h: number) {
  const size = pictureSize(picture);
  if (size.width <= 0 || size.height <= 0) return;
  const scale = Math.max(w / size.width, h / size.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(picture, (size.width - sw) / 2, (size.height - sh) / 2, sw, sh, x, y, w, h);
}

export class ScreenCanvas {
  readonly canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  private drawn = '';
  private readonly anisotropy: number;

  constructor(anisotropy: number) {
    this.anisotropy = anisotropy;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2;
    this.canvas.height = 4;
    this.texture = this.makeTexture();
  }

  private makeTexture(): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(this.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.anisotropy;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  /**
   * Draws the frame. Returns 'resized' when the canvas changed shape (the
   * texture was replaced and the display has to take the new one), 'drawn'
   * when only its pixels changed, or null when nothing did.
   */
  update(frame: ScreenFrame, get: (id: string | null | undefined) => Picture | null): 'resized' | 'drawn' | null {
    const current = get(frame.media);
    const previous = frame.previous !== undefined && frame.progress < 1 ? get(frame.previous) : null;
    const transitioning = frame.previous !== undefined && frame.progress < 1;
    const p = transitioning ? Math.round(frame.progress * 1000) / 1000 : 1;
    const key = `${frame.media}:${current ? 1 : 0}|${transitioning ? `${frame.previous}:${previous ? 1 : 0}|${frame.transition}|${p}` : ''}`;
    if (key === this.drawn) return null;
    this.drawn = key;

    // The canvas takes the shape of the picture coming in, at most MAX_SIDE.
    const shape = current ?? previous;
    let width = 600;
    let height = 1300;
    if (shape) {
      const size = pictureSize(shape);
      const k = Math.min(1, MAX_SIDE / Math.max(size.width, size.height));
      width = Math.max(2, Math.round(size.width * k));
      height = Math.max(2, Math.round(size.height * k));
    }
    let resized = false;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      // A texture keeps the size it was first uploaded at, so a new shape needs a new texture.
      this.texture.dispose();
      this.texture = this.makeTexture();
      resized = true;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return null;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    if (!transitioning || frame.transition === 'cut') {
      if (current) drawCover(ctx, current, 0, 0, width, height);
    } else {
      this.drawTransition(ctx, frame.transition, easeProgress('smooth', p), previous, current, width, height);
    }
    this.texture.needsUpdate = true;
    return resized ? 'resized' : 'drawn';
  }

  private drawTransition(
    ctx: CanvasRenderingContext2D,
    transition: ScreenFrame['transition'],
    p: number,
    previous: Picture | null,
    current: Picture | null,
    w: number,
    h: number
  ) {
    switch (transition) {
      case 'slide': {
        // The way an app opens a page: the new one comes in from the right
        // over the old, which moves a little to the left and dims.
        if (previous) {
          drawCover(ctx, previous, -0.3 * w * p, 0, w, h);
          ctx.fillStyle = `rgba(0, 0, 0, ${0.25 * p})`;
          ctx.fillRect(0, 0, w, h);
        }
        if (current) drawCover(ctx, current, (1 - p) * w, 0, w, h);
        break;
      }
      case 'scroll': {
        // Scrolling down a long page: the old screen moves up and the new one follows it.
        if (previous) drawCover(ctx, previous, 0, -p * h, w, h);
        if (current) drawCover(ctx, current, 0, (1 - p) * h, w, h);
        break;
      }
      case 'zoom': {
        // The way an app opens from its icon: the new screen grows from the middle.
        if (previous) drawCover(ctx, previous, 0, 0, w, h);
        if (current) {
          const s = 0.86 + 0.14 * p;
          ctx.globalAlpha = p;
          drawCover(ctx, current, (w * (1 - s)) / 2, (h * (1 - s)) / 2, w * s, h * s);
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'fade':
      default: {
        if (previous) drawCover(ctx, previous, 0, 0, w, h);
        if (current) {
          ctx.globalAlpha = p;
          drawCover(ctx, current, 0, 0, w, h);
          ctx.globalAlpha = 1;
        }
        break;
      }
    }
  }

  /** Forgets what was drawn, so a picture that arrived late is drawn next frame. */
  invalidate() {
    this.drawn = '';
  }

  dispose() {
    this.texture.dispose();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}
