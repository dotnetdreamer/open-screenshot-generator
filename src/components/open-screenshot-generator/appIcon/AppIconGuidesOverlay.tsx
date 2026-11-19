"use client";

import React from 'react';
import type { ArtboardState } from '@/types/artboard';
import { androidSafeCircle, isIconBoard, superellipsePath } from '@/lib/appIcon/specs';
import { useEditorPreference } from '@/lib/editorPreferences';

const APPLE = '#38bdf8';
const SAFE = '#34d399';

/**
 * The guides over the app icon artboard: Apple's rounded square, with the
 * corners it cuts off shaded, and the circle in the middle that no Android
 * mask cuts into.
 *
 * A sibling of the `.artboard` node, never a child, like the header art's
 * safe area, so no export sees it; drawn in artboard pixels with strokes and
 * labels divided by the screen scale so they keep their size at any zoom. The
 * colours are literal for the same reason as there: out here the board's
 * forced light palette does not apply.
 */
export function AppIconGuidesOverlay({
  board,
  screenScale,
  displayScale,
}: {
  board: Pick<ArtboardState, 'appIcon' | 'size'>;
  /** Screen pixels per artboard pixel, zoom included. */
  screenScale: number;
  /** The board's own transform scale on the canvas. */
  displayScale: number;
}) {
  const [visible] = useEditorPreference('appIconGuides');
  if (!visible || !isIconBoard(board)) return null;
  const { width, height } = board.size;
  const side = Math.min(width, height);
  const px = 1 / (screenScale || displayScale);
  const safe = androidSafeCircle(board.size);
  const shape = superellipsePath(side);
  const label: React.CSSProperties = {
    position: 'absolute',
    padding: `${2 * px}px ${6 * px}px`,
    fontSize: `${11 * px}px`,
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: '0.02em',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    whiteSpace: 'nowrap',
    borderRadius: `${3 * px}px`,
  };

  return (
    <div
      data-export-exclude
      aria-hidden
      data-testid="app-icon-guides"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        transform: `scale(${displayScale})`,
        transformOrigin: 'top left',
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 4,
      }}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {/* The corners iOS rounds off, shaded: the board with the shape cut out of it. */}
        <path d={`M0 0H${width}V${height}H0Z ${shape}`} fill="rgba(15, 23, 42, 0.3)" fillRule="evenodd" />
        <path d={shape} fill="none" stroke={APPLE} strokeWidth={1.5 * px} />
        <circle cx={safe.cx} cy={safe.cy} r={safe.r} fill="none" stroke={SAFE} strokeWidth={1.5 * px} strokeDasharray={`${6 * px} ${4 * px}`} />
      </svg>
      <span style={{ ...label, left: `${8 * px}px`, top: `${8 * px}px`, color: '#082f49', background: APPLE }}>iPhone corners</span>
      <span style={{ ...label, left: '50%', bottom: `${8 * px}px`, transform: 'translateX(-50%)', color: '#052e16', background: SAFE }}>
        Android: keep your logo in this circle
      </span>
    </div>
  );
}
