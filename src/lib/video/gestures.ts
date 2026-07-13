// Procedural canvas drawing for gesture hint overlays (tap ripples, swipe
// trails). The export compositor calls drawGesture per frame; the on-canvas
// editor preview approximates the same look with CSS keyframes (see
// GestureElement.tsx + globals.css) so what you place is what exports.

import type { GestureElementProps } from '@/types/artboard';

export const GESTURE_DURATION_DEFAULT = 1.2;
export const GESTURE_TRIGGER_DEFAULT = 0.5;

export interface GestureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Phase 0..1 of the gesture at video time `t`, or null when it isn't playing. */
export function gesturePhaseAt(el: GestureElementProps, t: number): number | null {
  const duration = el.gestureDuration ?? GESTURE_DURATION_DEFAULT;
  if (duration <= 0) return null;
  if (el.gestureRepeat) {
    return (Math.max(0, t) % duration) / duration;
  }
  const start = el.triggerTime ?? GESTURE_TRIGGER_DEFAULT;
  if (t < start || t > start + duration) return null;
  return (t - start) / duration;
}

/** When a one-shot gesture finishes (loop gestures report their first play). */
export function gestureEndTime(el: GestureElementProps): number {
  const duration = el.gestureDuration ?? GESTURE_DURATION_DEFAULT;
  return (el.gestureRepeat ? 0 : el.triggerTime ?? GESTURE_TRIGGER_DEFAULT) + duration;
}

function withAlpha(ctx: CanvasRenderingContext2D, alpha: number, draw: () => void) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.max(0, Math.min(1, alpha));
  draw();
  ctx.globalAlpha = prev;
}

function drawTapRipple(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  phase: number
) {
  // Solid fingertip dot that presses (shrinks slightly) then lifts.
  const press = phase < 0.3 ? phase / 0.3 : 1;
  const lift = phase > 0.75 ? (phase - 0.75) / 0.25 : 0;
  const dotRadius = radius * 0.32 * (1 - 0.15 * press);
  withAlpha(ctx, 0.9 * (1 - lift), () => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, dotRadius), 0, Math.PI * 2);
    ctx.fill();
  });
  // Expanding ring, born at the press moment.
  const ringPhase = Math.max(0, (phase - 0.25) / 0.75);
  if (ringPhase > 0) {
    withAlpha(ctx, 0.8 * (1 - ringPhase), () => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, radius * 0.07 * (1 - ringPhase * 0.5));
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (0.35 + 0.65 * ringPhase), 0, Math.PI * 2);
      ctx.stroke();
    });
  }
}

/**
 * Draw one gesture frame into `rect` (artboard-space px, canvas already
 * transformed for element rotation by the caller).
 */
export function drawGesture(
  ctx: CanvasRenderingContext2D,
  el: GestureElementProps,
  rect: GestureRect,
  phase: number
) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const radius = Math.min(rect.width, rect.height) / 2;
  const color = el.color || '#ffffff';

  switch (el.gestureType) {
    case 'tap':
      drawTapRipple(ctx, cx, cy, radius, color, phase);
      return;
    case 'double-tap': {
      // Two quick taps inside one duration.
      const local = phase < 0.5 ? phase / 0.5 : (phase - 0.5) / 0.5;
      drawTapRipple(ctx, cx, cy, radius, color, local);
      return;
    }
    case 'swipe-left':
    case 'swipe-right':
    case 'swipe-up':
    case 'swipe-down': {
      // A fingertip dot travelling across the box with a fading trail.
      const travel = easedTravel(phase);
      const horizontal = el.gestureType === 'swipe-left' || el.gestureType === 'swipe-right';
      const sign = el.gestureType === 'swipe-right' || el.gestureType === 'swipe-down' ? 1 : -1;
      const span = (horizontal ? rect.width : rect.height) * 0.8;
      const startOffset = (-sign * span) / 2;
      const pos = startOffset + sign * span * travel;
      const dotX = horizontal ? cx + pos : cx;
      const dotY = horizontal ? cy : cy + pos;
      const dotRadius = Math.max(3, radius * 0.22);
      const fade = phase > 0.8 ? 1 - (phase - 0.8) / 0.2 : 1;

      // Trail: a few ghost dots behind the fingertip.
      for (let i = 1; i <= 4; i++) {
        const trailTravel = Math.max(0, travel - i * 0.09);
        const trailPos = startOffset + sign * span * trailTravel;
        withAlpha(ctx, fade * 0.45 * (1 - i / 5), () => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(
            horizontal ? cx + trailPos : cx,
            horizontal ? cy : cy + trailPos,
            dotRadius * (1 - i * 0.12),
            0,
            Math.PI * 2
          );
          ctx.fill();
        });
      }
      withAlpha(ctx, fade * 0.95, () => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }
  }
}

function easedTravel(phase: number): number {
  // Hold briefly, travel with ease-in-out, hold at the end.
  const p = Math.max(0, Math.min(1, (phase - 0.12) / 0.68));
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}
