"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { XIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TextElement } from './elements/TextElement';
import { ShapeElement } from './elements/ShapeElement';
import { DeviceFrameElement } from './elements/DeviceFrameElement';
import { ImageElement } from './elements/ImageElement';
import { VideoElement } from './elements/VideoElement';
import { VideoDeviceElement } from './elements/VideoDeviceElement';
import { GestureElement } from './elements/GestureElement';
import type { ArtboardState, ImageElementProps, DeviceFrameElementProps, TextElementProps, ShapeElementProps, VideoElementProps, VideoDeviceElementProps, GestureElementProps } from '@/types/artboard';

interface PreviewDialogProps {
  artboards: ArtboardState[];
  initialArtboardId?: string | null;
  onClose: () => void;
}

const noop = () => {};

function getArtboardBackgroundStyle(artboard: ArtboardState): React.CSSProperties {
  if (artboard.backgroundType === 'gradient' && artboard.backgroundGradient) {
    const { color1, color2, angle } = artboard.backgroundGradient;
    return { background: `linear-gradient(${angle}deg, ${color1}, ${color2})` };
  }
  const backgroundColor = artboard.backgroundColor;
  if (!backgroundColor || backgroundColor.toLowerCase().includes('var(') || backgroundColor.toLowerCase().includes('hsl')) {
    return { backgroundColor: '#FFFFFF' };
  }
  return { backgroundColor };
}

// Renders an artboard exactly as it exports: same element components as the
// editor canvas, but read-only and clipped to the artboard bounds.
function StaticArtboard({ artboard, scale }: { artboard: ArtboardState; scale: number }) {
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

export function PreviewDialog({ artboards, initialArtboardId, onClose }: PreviewDialogProps) {
  const initialIndex = Math.max(0, artboards.findIndex(ab => ab.id === initialArtboardId));
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const goPrev = useCallback(() => {
    setCurrentIndex(prev => (prev > 0 ? prev - 1 : artboards.length - 1));
  }, [artboards.length]);

  const goNext = useCallback(() => {
    setCurrentIndex(prev => (prev < artboards.length - 1 ? prev + 1 : 0));
  }, [artboards.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };
    // Capture phase so editor shortcuts (Delete, Ctrl+Z, ...) never fire while previewing
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, goPrev, goNext]);

  if (artboards.length === 0) return null;

  const artboard = artboards[Math.min(currentIndex, artboards.length - 1)];

  const HEADER_HEIGHT = 56;
  const FILMSTRIP_HEIGHT = 132;
  const PADDING = 24;
  const availableWidth = Math.max(1, viewport.width - PADDING * 2);
  const availableHeight = Math.max(1, viewport.height - HEADER_HEIGHT - FILMSTRIP_HEIGHT - PADDING * 2);
  const fitScale = Math.min(
    availableWidth / artboard.size.width,
    availableHeight / artboard.size.height
  );

  const THUMB_HEIGHT = 96;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Preview">
      {/* Header */}
      <div className="flex items-center justify-between px-4" style={{ height: `${HEADER_HEIGHT}px` }}>
        <div className="text-sm text-white/70">
          <span className="font-medium text-white">{artboard.name}</span>
          <span className="ml-3">{artboard.size.width} × {artboard.size.height}px</span>
        </div>
        <div className="text-sm text-white/70">
          {currentIndex + 1} / {artboards.length}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-white hover:bg-white/10 hover:text-white"
          title="Close preview (Esc)"
        >
          <XIcon className="h-5 w-5" />
        </Button>
      </div>

      {/* Main preview area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden" style={{ padding: `${PADDING}px` }}>
        {artboards.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={goPrev}
            className="absolute left-4 top-1/2 z-10 h-12 w-12 -translate-y-1/2 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
            title="Previous artboard (←)"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </Button>
        )}

        {viewport.width > 0 && (
          <div className="shadow-2xl">
            <StaticArtboard artboard={artboard} scale={fitScale} />
          </div>
        )}

        {artboards.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={goNext}
            className="absolute right-4 top-1/2 z-10 h-12 w-12 -translate-y-1/2 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
            title="Next artboard (→)"
          >
            <ChevronRightIcon className="h-6 w-6" />
          </Button>
        )}
      </div>

      {/* Filmstrip of all artboards */}
      <div
        className="flex items-center justify-center gap-3 overflow-x-auto px-4"
        style={{ height: `${FILMSTRIP_HEIGHT}px` }}
      >
        {artboards.map((ab, index) => (
          <button
            key={ab.id}
            onClick={() => setCurrentIndex(index)}
            className={cn(
              "rounded-sm transition-all",
              index === currentIndex
                ? "ring-2 ring-white ring-offset-2 ring-offset-black"
                : "opacity-60 hover:opacity-100"
            )}
            title={ab.name}
          >
            <StaticArtboard artboard={ab} scale={THUMB_HEIGHT / ab.size.height} />
          </button>
        ))}
      </div>
    </div>
  );
}
