"use client";

import React from 'react';
import type { ArtboardState } from '@/types/artboard';
import { iphoneHeaderButtonsFor, safeAreaFor } from '@/lib/creative/specs';
import { useEditorPreference } from '@/lib/editorPreferences';

/**
 * Apple's art safe area, drawn over an App Store header or search artboard.
 *
 * Everything outside it is dimmed, because that is the part a device may cut
 * off: an iPhone shows about the middle 43% of a header, by our measurements
 * (Apple publishes none). On header art two dashed circles mark where iOS
 * floats the back and share buttons, over the safe area's top corners. A
 * sibling of the
 * `.artboard` node like the collab marks, never a child, so the exporter never
 * sees it, and drawn in artboard pixels with the stroke and label divided by
 * the screen scale so they stay the same size at any zoom. The colours are
 * literal for the same reason the marquee's are: out here the board's forced
 * light palette does not apply.
 */
export function CreativeSafeAreaOverlay({
  board,
  screenScale,
  displayScale,
}: {
  board: Pick<ArtboardState, 'creativeAsset' | 'size'>;
  /** Screen pixels per artboard pixel, zoom included. */
  screenScale: number;
  /** The board's own transform scale on the canvas. */
  displayScale: number;
}) {
  const [visible] = useEditorPreference('creativeSafeArea');
  const safe = safeAreaFor(board);
  if (!visible || !safe) return null;
  // One screen pixel, in artboard pixels.
  const px = 1 / (screenScale || displayScale);
  // Where iOS floats the back and share buttons over a header on an iPhone.
  const buttons = iphoneHeaderButtonsFor(board);

  return (
    <div
      data-export-exclude
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${board.size.width}px`,
        height: `${board.size.height}px`,
        transform: `scale(${displayScale})`,
        transformOrigin: 'top left',
        pointerEvents: 'none',
        overflow: 'hidden',
        // Above the board, below the collab marks and the marquee.
        zIndex: 4,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${safe.x}px`,
          top: `${safe.y}px`,
          width: `${safe.width}px`,
          height: `${safe.height}px`,
          outline: `${1.5 * px}px dashed #34d399`,
          boxShadow: `0 0 0 ${board.size.width + board.size.height}px rgba(15, 23, 42, 0.26)`,
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: `${-1.5 * px}px`,
            top: 0,
            transform: 'translateY(-100%)',
            padding: `${2 * px}px ${6 * px}px`,
            fontSize: `${11 * px}px`,
            lineHeight: 1.3,
            fontWeight: 600,
            letterSpacing: '0.02em',
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
            whiteSpace: 'nowrap',
            color: '#052e16',
            background: '#34d399',
            borderRadius: `${3 * px}px ${3 * px}px 0 0`,
          }}
        >
          Art safe area
        </span>
      </div>
      {buttons.map((button, index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            left: `${button.x}px`,
            top: `${button.y}px`,
            width: `${button.width}px`,
            height: `${button.height}px`,
            borderRadius: '50%',
            border: `${1.5 * px}px dashed rgba(52, 211, 153, 0.9)`,
            background: 'rgba(52, 211, 153, 0.12)',
          }}
        />
      ))}
    </div>
  );
}
