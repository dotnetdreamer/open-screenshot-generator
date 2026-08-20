"use client";

// What everybody else is doing, drawn on the board they are doing it on.
//
// Two marks, both in the artboard's OWN coordinates: a ring around whatever a
// peer has selected, and their pointer. That is the whole reason this lives
// inside `Artboard` rather than floating over the canvas — a ring computed in
// screen space would have to track the 0.3 display scale, the canvas zoom, the
// scroll and the board's own offset, and be wrong the moment any of them
// changed mid drag. Here an element at `position` is drawn at `position`.
//
// It is a sibling of the `.artboard` node, never a child, because that node is
// what the exporter rasterises: a cursor in a shipped App Store screenshot
// would be a very bad day.
//
// Everything that must stay a constant size on screen (the ring's stroke, the
// name chip, the pointer) is divided by `screenScale`, which Artboard measures
// off the DOM. Multiplying by the zoom would be close but not exact, and this
// is the one place where "close" reads as a wobble.

import React from 'react';
import type { ArtboardState } from '@/types/artboard';
import type { CollabPeer } from '@/lib/collab/types';

interface CollabBoardOverlayProps {
  artboard: ArtboardState;
  peers: CollabPeer[];
  /** Screen pixels per artboard pixel, measured by Artboard. */
  screenScale: number;
}

export function CollabBoardOverlay({ artboard, peers, screenScale }: CollabBoardOverlayProps) {
  if (!peers.length) return null;
  // One artboard pixel is `screenScale` screen pixels, so this is how many
  // artboard pixels make one screen pixel.
  const px = 1 / Math.max(screenScale, 0.0001);

  const elementsById = new Map(artboard.elements.map((element) => [element.id, element]));

  return (
    <div
      data-export-exclude
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 60,
      }}
    >
      {peers.map((peer) => {
        const selectedId =
          peer.selection?.artboardId === artboard.id ? peer.selection?.elementId : null;
        const element = selectedId ? elementsById.get(selectedId) : undefined;
        if (!element) return null;
        const scale = element.scale || 1;
        const width = element.size.width * scale;
        const height = element.size.height * scale;
        return (
          <div
            key={`sel-${peer.clientId}`}
            data-collab-selection={peer.user.id}
            style={{
              position: 'absolute',
              left: `${element.position.x}px`,
              top: `${element.position.y}px`,
              width: `${width}px`,
              height: `${height}px`,
              transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
              transformOrigin: 'center center',
              border: `${2 * px}px solid ${peer.user.color}`,
              borderRadius: `${3 * px}px`,
              boxSizing: 'border-box',
            }}
          >
            {/* The name sits above the ring, and flips inside it when the
                element is at the very top of the board, so a selection on a
                headline is not labelled off the canvas. */}
            <span
              style={{
                position: 'absolute',
                left: `${-2 * px}px`,
                top: element.position.y > 22 * px ? `${-20 * px}px` : `${height + 4 * px}px`,
                background: peer.user.color,
                color: '#fff',
                fontSize: `${11 * px}px`,
                lineHeight: 1,
                padding: `${4 * px}px ${6 * px}px`,
                borderRadius: `${4 * px}px`,
                whiteSpace: 'nowrap',
                fontWeight: 600,
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              {peer.user.name}
            </span>
          </div>
        );
      })}

      {peers.map((peer) => {
        if (peer.cursor?.artboardId !== artboard.id) return null;
        return (
          <div
            key={`cur-${peer.clientId}`}
            data-collab-cursor={peer.user.id}
            style={{
              position: 'absolute',
              left: `${peer.cursor.x}px`,
              top: `${peer.cursor.y}px`,
              // Every pointer is the same size on screen whatever the zoom, and
              // the hotspot stays on the point being indicated.
              transform: `scale(${px})`,
              transformOrigin: 'top left',
              willChange: 'transform',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: 'block' }}>
              <path
                d="M2 1.5 L12.5 10.5 L8 11 L10.5 15.5 L8.5 16.5 L6 12 L2.5 15 Z"
                fill={peer.user.color}
                stroke="#fff"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              style={{
                position: 'absolute',
                left: '14px',
                top: '14px',
                background: peer.user.color,
                color: '#fff',
                fontSize: '11px',
                lineHeight: 1,
                padding: '4px 6px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
                fontWeight: 600,
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              {peer.user.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
