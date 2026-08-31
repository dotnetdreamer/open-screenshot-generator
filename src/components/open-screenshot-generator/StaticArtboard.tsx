"use client";
import React from 'react';
import { artboardBackground } from '@/lib/artboardBackground';
import { ArtboardBackgroundImage } from './ArtboardBackgroundImage';
import { elementVisualStyle } from '@/lib/elementStyle';
import { TextElement } from './elements/TextElement';
import { ShapeElement } from './elements/ShapeElement';
import { DeviceFrameElement } from './elements/DeviceFrameElement';
import { ImageElement } from './elements/ImageElement';
import { VideoElement } from './elements/VideoElement';
import { VideoDeviceElement } from './elements/VideoDeviceElement';
import { GestureElement } from './elements/GestureElement';
import type {
  ArtboardState,
  ImageElementProps,
  DeviceFrameElementProps,
  TextElementProps,
  ShapeElementProps,
  VideoElementProps,
  VideoDeviceElementProps,
  GestureElementProps,
} from '@/types/artboard';

// The read-only render site, shared by every "show me what this looks like"
// surface (the preview dialog, the language proof sheet, the store listing
// mockup). It deliberately uses the same element components as the editor
// canvas, so none of those surfaces can drift from what actually exports.

const noop = () => {};

// Shared with the canvas and the PNG export so the preview cannot disagree
// with what actually renders (including for a half-filled gradient).
export const getArtboardBackgroundStyle = (artboard: ArtboardState): React.CSSProperties =>
  artboardBackground(artboard);

/**
 * How many WebGL contexts a board costs. Every 3D device element builds its own
 * THREE.WebGLRenderer and Chrome keeps roughly 16 alive before it starts
 * evicting the oldest one, which blanks whatever it evicted — so any surface
 * that mounts many boards at once budgets with this rather than mounting all
 * of them.
 */
export function count3dDevices(board: ArtboardState): number {
  let total = 0;
  for (const element of board.elements) {
    if (element.type !== 'device') continue;
    const style = (element as DeviceFrameElementProps).styleType;
    if (style === '3d-left' || style === '3d-right') total += 1;
  }
  return total;
}

// Renders an artboard exactly as it exports: same element components as the
// editor canvas, but read-only and clipped to the artboard bounds.
export function StaticArtboard({ artboard, scale }: { artboard: ArtboardState; scale: number }) {
  return (
    <div
      style={{
        width: `${artboard.size.width * scale}px`,
        height: `${artboard.size.height * scale}px`,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        // The canvas marks its own board with `.artboard`; this is the other
        // render site and needs the same marker, so the dark editor palette
        // stops at the artboard edge here too (see globals.css).
        data-artboard-surface=""
        style={{
          width: `${artboard.size.width}px`,
          height: `${artboard.size.height}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'relative',
          overflow: 'hidden',
          pointerEvents: 'none',
          ...getArtboardBackgroundStyle(artboard),
        }}
      >
        <ArtboardBackgroundImage artboard={artboard} />
        {artboard.elements.map(element => (
          <div
            key={element.id}
            style={{
              position: 'absolute',
              left: `${element.position.x}px`,
              top: `${element.position.y}px`,
              width: `${element.size.width * element.scale}px`,
              height: `${element.size.height * element.scale}px`,
              transform: `rotate(${element.rotation}deg)`,
              transformOrigin: 'center center',
              // Same shared shadow/blur/opacity the canvas applies through
              // DraggableElement — this dialog is the other render site, and it
              // is meant to show exactly what exports.
              ...elementVisualStyle(element),
            }}
          >
            {element.type === 'text' && (
              <TextElement
                element={element as TextElementProps}
                onUpdate={noop}
                isSelected={false}
                artboardZoom={artboard.zoom * element.scale}
              />
            )}
            {element.type === 'image' && (
              <ImageElement
                element={element as ImageElementProps}
                onUpdate={noop}
                isSelected={false}
              />
            )}
            {element.type === 'shape' && <ShapeElement element={element as ShapeElementProps} />}
            {element.type === 'device' && (
              <DeviceFrameElement
                element={element as DeviceFrameElementProps}
                onUpdate={noop}
                isSelected={false}
              />
            )}
            {element.type === 'video' && (
              <VideoElement
                element={element as VideoElementProps}
                onUpdate={noop}
                isSelected={false}
              />
            )}
            {element.type === 'video-device' && (
              <VideoDeviceElement
                element={element as VideoDeviceElementProps}
                onUpdate={noop}
                isSelected={false}
              />
            )}
            {element.type === 'gesture' && (
              <GestureElement element={element as GestureElementProps} isSelected={false} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
