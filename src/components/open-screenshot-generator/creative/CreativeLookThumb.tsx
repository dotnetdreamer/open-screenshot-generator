"use client";

import React from 'react';
import type { ArtboardState } from '@/types/artboard';
import { cn } from '@/lib/utils';
import { StaticArtboard } from '../StaticArtboard';
import { iphoneCropFor, type CreativePlacement } from '@/lib/creative/specs';

/**
 * A header or search design drawn small, with the part an iPhone shows marked
 * when `showCrop` is on. The add dialog's cards and the palette's Header tab
 * both draw their designs with it.
 */
export function CreativeLookThumb({
  board,
  width,
  placement,
  showCrop,
}: {
  board: ArtboardState;
  width: number;
  placement: CreativePlacement;
  showCrop: boolean;
}) {
  const scale = width / board.size.width;
  const crop = showCrop ? iphoneCropFor(board, placement) : null;
  return (
    <div
      className="relative overflow-hidden rounded-md ring-1 ring-border"
      style={{ width, height: Math.round(board.size.height * scale) }}
    >
      <StaticArtboard artboard={board} scale={scale} />
      {crop && (
        <div
          className="pointer-events-none absolute rounded-[3px]"
          style={{
            left: crop.x * scale,
            top: crop.y * scale,
            width: crop.width * scale,
            height: crop.height * scale,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.3)',
            outline: '1.5px solid rgba(255, 255, 255, 0.95)',
          }}
        >
          {/* Above the window when there is room, so it never sits on the
              art it is pointing at. */}
          <span
            className={cn(
              'absolute left-0 rounded bg-black/60 px-1 text-[9px] font-medium leading-4 text-white',
              crop.y * scale >= 18 ? '-top-[18px]' : 'left-1 top-1'
            )}
          >
            iPhone
          </span>
        </div>
      )}
    </div>
  );
}
