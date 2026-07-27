"use client";
import React from 'react';
import type { GestureElementProps } from '@/types/artboard';
import { GESTURE_DURATION_DEFAULT } from '@/lib/video/gestures';

interface GestureElementComponentProps {
  element: GestureElementProps;
  isSelected: boolean;
}

// On-canvas preview of a gesture hint. Loops forever so the designer sees the
// motion while placing it; the exported MP4 plays it once at triggerTime (or
// loops when gestureRepeat is on) via the procedural drawing in
// src/lib/video/gestures.ts. Keyframes live in globals.css (abs-gesture-*).
export function GestureElement({ element, isSelected }: GestureElementComponentProps) {
  const color = element.color || '#ffffff';
  const duration = `${element.gestureDuration ?? GESTURE_DURATION_DEFAULT}s`;
  const isTap = element.gestureType === 'tap' || element.gestureType === 'double-tap';
  const horizontal = element.gestureType === 'swipe-left' || element.gestureType === 'swipe-right';
  const reverse = element.gestureType === 'swipe-left' || element.gestureType === 'swipe-up';
  const tapDuration = element.gestureType === 'double-tap'
    ? `${(element.gestureDuration ?? GESTURE_DURATION_DEFAULT) / 2}s`
    : duration;

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
