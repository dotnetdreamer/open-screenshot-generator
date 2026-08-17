"use client";
import React, { useEffect, useRef } from 'react';
import type { GestureElementProps } from '@/types/artboard';
import { GESTURE_DURATION_DEFAULT, drawGesture, gesturePhaseAt } from '@/lib/video/gestures';
import { usePlaybackTime } from '@/lib/video/playback';

interface GestureElementComponentProps {
  element: GestureElementProps;
  isSelected: boolean;
  /** Board this hint sits on, so it can follow the playback clock. */
  artboardId?: string;
}

// On-canvas preview of a gesture hint. Idle it loops forever so the designer
// sees the motion while placing it (CSS keyframes in globals.css,
// abs-gesture-*). While the board's timeline is playing it switches to the
// export's own procedural drawing (src/lib/video/gestures.ts) on a canvas, so
// it appears at triggerTime and traces exactly the frames the MP4 will carry.
export function GestureElement({ element, isSelected, artboardId }: GestureElementComponentProps) {
  const color = element.color || '#ffffff';
  const duration = `${element.gestureDuration ?? GESTURE_DURATION_DEFAULT}s`;
  const isTap = element.gestureType === 'tap' || element.gestureType === 'double-tap';
  const horizontal = element.gestureType === 'swipe-left' || element.gestureType === 'swipe-right';
  const reverse = element.gestureType === 'swipe-left' || element.gestureType === 'swipe-up';
  const tapDuration = element.gestureType === 'double-tap'
    ? `${(element.gestureDuration ?? GESTURE_DURATION_DEFAULT) / 2}s`
    : duration;

  const playbackTime = usePlaybackTime(artboardId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phase = playbackTime === null ? null : gesturePhaseAt(element, playbackTime);
  // Drawn in artboard pixels; the artboard's own 0.3 display transform (plus
  // the canvas zoom) scales it down, so it stays crisp.
  const boxWidth = Math.max(1, Math.round(element.size.width * (element.scale || 1)));
  const boxHeight = Math.max(1, Math.round(element.size.height * (element.scale || 1)));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (phase === null) return;
    drawGesture(ctx, element, { x: 0, y: 0, width: canvas.width, height: canvas.height }, phase);
  }, [phase, element, boxWidth, boxHeight]);

  if (playbackTime !== null) {
    return (
      <canvas
        ref={canvasRef}
        width={boxWidth}
        height={boxHeight}
        style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
      />
    );
  }

  return (
    <div
      className="w-full h-full relative flex items-center justify-center"
      style={{ pointerEvents: 'none' }}
    >
      {isTap ? (
        <>
          {/* Fingertip dot */}
          <div
            style={{
              position: 'absolute',
              width: '32%',
              height: '32%',
              borderRadius: '50%',
              backgroundColor: color,
              opacity: 0.9,
              animation: `abs-gesture-tap-dot ${tapDuration} ease-out infinite`,
            }}
          />
          {/* Expanding ripple ring */}
          <div
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              border: `3px solid ${color}`,
              animation: `abs-gesture-tap-ring ${tapDuration} ease-out infinite`,
            }}
          />
        </>
      ) : (
        <div
          style={{
            position: 'absolute',
            width: '22%',
            height: '22%',
            maxWidth: '22%',
            maxHeight: '22%',
            aspectRatio: '1 / 1',
            borderRadius: '50%',
            backgroundColor: color,
            boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 35%, transparent)`,
            animation: `${horizontal ? 'abs-gesture-swipe-x' : 'abs-gesture-swipe-y'} ${duration} ease-in-out infinite`,
            animationDirection: reverse ? 'reverse' : 'normal',
          }}
        />
      )}
      {isSelected && (
        <div
          data-export-exclude
          className="absolute inset-0 rounded-full border border-dashed"
          style={{ borderColor: `color-mix(in srgb, ${color} 60%, transparent)` }}
        />
      )}
    </div>
  );
}
