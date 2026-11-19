"use client";

// The picture being cut out, drawn over the chosen backdrop, with the brush.
//
// Two canvases the size of the picture sit behind the one on screen: the photo,
// and the mask in the alpha of an otherwise black picture. Each frame draws the
// photo and keeps it only where the mask is (`destination-in`), so a brush
// stroke updates one small rectangle of the mask canvas instead of rebuilding a
// cut-out the size of the photo. The backdrop is the element's CSS.
//
// Pointer events throughout (rule 20 in .agents/AGENTS.md): one finger paints,
// two pan and zoom. A trackpad or wheel pans, with Ctrl or Cmd it zooms.

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { BrushStroke, type BrushMode, type MaskPatch, type Rect } from '@/lib/cutout/refine';
import type { WorkingPicture } from '@/lib/cutout/picture';

export type Backdrop = 'checker' | 'white' | 'black' | 'color';

export interface CutoutCanvasHandle {
  /** Fit the whole picture in view. */
  fit(): void;
  zoomBy(factor: number): void;
  /** Redraw the mask canvas, all of it or one rectangle. */
  refresh(rect?: Rect): void;
}

interface CutoutCanvasProps {
  picture: WorkingPicture;
  /** The mask the brush paints on, the picture's size. */
  mask: Uint8Array;
  /** What to show instead of `mask` (the edge controls applied), or null for `mask` itself. */
  shown: Uint8Array | null;
  backdrop: Backdrop;
  backdropColor: string;
  showOriginal: boolean;
  /** Null while painting is not possible (a cut is under way). */
  brush: { mode: BrushMode; size: number } | null;
  onStroke: (patch: MaskPatch) => void;
  onZoomChange?: (scale: number) => void;
  className?: string;
}

const CHECKER =
  'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%) 50% / 20px 20px';

function backgroundOf(backdrop: Backdrop, color: string): string {
  if (backdrop === 'white') return '#ffffff';
  if (backdrop === 'black') return '#111111';
  if (backdrop === 'color') return color;
  return CHECKER;
}

export const CutoutCanvas = React.forwardRef<CutoutCanvasHandle, CutoutCanvasProps>(function CutoutCanvas(
  { picture, mask, shown, backdrop, backdropColor, showOriginal, brush, onStroke, onZoomChange, className },
  ref
) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskImageRef = useRef<ImageData | null>(null);
  const viewRef = useRef({ scale: 1, x: 0, y: 0 });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const strokeRef = useRef<BrushStroke | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; scale: number; cx: number; cy: number; vx: number; vy: number } | null>(null);
  const frameRef = useRef(0);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // The latest props, read by callbacks that stay the same object for the
  // canvas's whole life: a callback remade on every render would remake the
  // resize observer, which resets the zoom each time it starts.
  const propsRef = useRef({ picture, mask, brush, showOriginal, onZoomChange });
  propsRef.current = { picture, mask, brush, showOriginal, onZoomChange };
  const [, setTick] = useState(0);

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !source || !maskCanvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const { brush, showOriginal } = propsRef.current;
    const { dpr } = sizeRef.current;
    const view = viewRef.current;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    context.imageSmoothingEnabled = view.scale < 3;
    context.imageSmoothingQuality = 'high';
    context.globalCompositeOperation = 'source-over';
    context.drawImage(source, 0, 0);
    if (!showOriginal) {
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(maskCanvas, 0, 0);
      context.globalCompositeOperation = 'source-over';
    }
    const cursor = cursorRef.current;
    if (cursor && brush) {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const radius = (brush.size / 2) * view.scale;
      context.beginPath();
      context.arc(cursor.x, cursor.y, Math.max(2, radius), 0, Math.PI * 2);
      context.lineWidth = 2;
      context.strokeStyle = 'rgba(0,0,0,0.55)';
      context.stroke();
      context.lineWidth = 1;
      context.strokeStyle = brush.mode === 'erase' ? 'rgba(255,255,255,0.95)' : 'rgba(110,231,183,0.95)';
      context.stroke();
    }
  }, []);

  const schedule = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  /** Copies the mask (or the shown one) into the mask canvas, in `rect` or whole. */
  const refresh = useCallback(
    (rect?: Rect) => {
      const maskCanvas = maskCanvasRef.current;
      const image = maskImageRef.current;
      if (!maskCanvas || !image) return;
      const { picture, mask } = propsRef.current;
      const { width, height } = picture;
      const area = rect ?? { x: 0, y: 0, width, height };
      const from = rect || !shownRef.current ? mask : shownRef.current;
      const data = image.data;
      for (let y = area.y; y < area.y + area.height; y++) {
        let i = y * width + area.x;
        for (let x = 0; x < area.width; x++, i++) data[i * 4 + 3] = from[i];
      }
      maskCanvas.getContext('2d')?.putImageData(image, 0, 0, area.x, area.y, area.width, area.height);
      schedule();
    },
    [schedule]
  );

  const fit = useCallback(() => {
    const { width, height } = sizeRef.current;
    if (!width || !height) return;
    const { picture, onZoomChange } = propsRef.current;
    const pad = 24;
    const scale = Math.min((width - pad * 2) / picture.width, (height - pad * 2) / picture.height, 4);
    viewRef.current = {
      scale,
      x: (width - picture.width * scale) / 2,
      y: (height - picture.height * scale) / 2,
    };
    onZoomChange?.(scale);
    schedule();
  }, [schedule]);

  const zoomAround = useCallback(
    (factor: number, cx: number, cy: number) => {
      const view = viewRef.current;
      const scale = Math.min(32, Math.max(0.05, view.scale * factor));
      const applied = scale / view.scale;
      viewRef.current = { scale, x: cx - (cx - view.x) * applied, y: cy - (cy - view.y) * applied };
      propsRef.current.onZoomChange?.(scale);
      schedule();
    },
    [schedule]
  );

  useImperativeHandle(
    ref,
    () => ({
      fit,
      zoomBy: (factor) => zoomAround(factor, sizeRef.current.width / 2, sizeRef.current.height / 2),
      refresh,
    }),
    [fit, refresh, zoomAround]
  );

  // The photo and the mask canvases, made again for each picture.
  useEffect(() => {
    const source = document.createElement('canvas');
    source.width = picture.width;
    source.height = picture.height;
    source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.width, picture.height), 0, 0);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = picture.width;
    maskCanvas.height = picture.height;
    sourceRef.current = source;
    maskCanvasRef.current = maskCanvas;
    maskImageRef.current = new ImageData(picture.width, picture.height);
    refresh();
    fit();
    setTick((tick) => tick + 1);
    return () => {
      // WebKit holds a canvas's memory until it is resized.
      source.width = 0;
      source.height = 0;
      maskCanvas.width = 0;
      maskCanvas.height = 0;
      sourceRef.current = null;
      maskCanvasRef.current = null;
      maskImageRef.current = null;
    };
    // fit and refresh change with the picture; this runs once per picture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture]);

  useEffect(() => {
    refresh();
  }, [shown, mask, refresh]);

  useEffect(() => {
    schedule();
  }, [showOriginal, brush, schedule]);

  // The on-screen canvas follows its box, at the screen's pixel density.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      const rect = box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      if (first) {
        first = false;
        fit();
      } else {
        schedule();
      }
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [fit, schedule]);

  // Wheel: registered by hand so it can stop the page from zooming (rule 24).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        zoomAround(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      const view = viewRef.current;
      viewRef.current = { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY };
      schedule();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [schedule, zoomAround]);

  // The handle is cleared too: React mounts twice in development, and a handle
  // left behind would stop `schedule` from ever asking for a frame again.
  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  const toPicture = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const view = viewRef.current;
    return { x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointersRef.current.set(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 2) {
      // A second finger: stop painting and pinch instead.
      strokeRef.current = null;
      const [a, b] = [...pointersRef.current.values()];
      const view = viewRef.current;
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: view.x, vy: view.y };
      return;
    }
    const pans = event.button === 1 || (event.button === 0 && (event.altKey || !brush));
    if (pans) {
      pinchRef.current = { distance: 0, scale: viewRef.current.scale, cx: event.clientX - rect.left, cy: event.clientY - rect.top, vx: viewRef.current.x, vy: viewRef.current.y };
      return;
    }
    if (event.button !== 0 || !brush) return;
    const point = toPicture(event.clientX, event.clientY);
    const radius = Math.max(1, brush.size / 2);
    strokeRef.current = new BrushStroke(mask, picture.width, picture.height, brush.mode, radius, 0.55);
    const changed = strokeRef.current.to(point.x, point.y);
    if (changed) refresh(changed);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    cursorRef.current = event.pointerType === 'mouse' ? local : null;
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, local);
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = Math.min(32, Math.max(0.05, pinch.scale * (distance / Math.max(1, pinch.distance))));
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const applied = scale / pinch.scale;
      viewRef.current = { scale, x: cx - (pinch.cx - pinch.vx) * applied, y: cy - (pinch.cy - pinch.vy) * applied };
      propsRef.current.onZoomChange?.(scale);
      schedule();
      return;
    }
    if (pinch && pointersRef.current.size === 1) {
      viewRef.current = { ...viewRef.current, x: pinch.vx + (local.x - pinch.cx), y: pinch.vy + (local.y - pinch.cy) };
      schedule();
      return;
    }
    const stroke = strokeRef.current;
    if (stroke) {
      const point = toPicture(event.clientX, event.clientY);
      const changed = stroke.to(point.x, point.y);
      if (changed) refresh(changed);
      return;
    }
    schedule();
  };

  const finishPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = pointersRef.current.size === 0 ? null : pinchRef.current;
    if (pointersRef.current.size === 0) pinchRef.current = null;
    const stroke = strokeRef.current;
    strokeRef.current = null;
    if (stroke) {
      const patch = stroke.finish();
      if (patch) onStroke(patch);
    }
  };

  return (
    <div
      ref={boxRef}
      className={cn('relative min-h-0 overflow-hidden', className)}
      style={{ background: backgroundOf(backdrop, backdropColor) }}
    >
      <canvas
        ref={canvasRef}
        data-testid="cutout-canvas"
        aria-label="The picture with its background removed"
        className={cn('absolute inset-0 h-full w-full', brush ? 'cursor-none' : 'cursor-grab')}
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerLeave={() => {
          cursorRef.current = null;
          schedule();
        }}
      />
    </div>
  );
});
