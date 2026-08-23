"use client";

import React, { useCallback, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { deviceLabel, shortDeviceLabel } from '@/lib/intake/autoFill';
import type { IntakeShot } from '@/lib/intake/intakeFiles';

interface ScreenshotStripProps {
  shots: IntakeShot[];
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onAddMore: () => void;
  max: number;
  disabled?: boolean;
  /** The shot the user is pointing at somewhere else, lit up here. */
  highlight?: number | null;
  onHoverShot?: (index: number | null) => void;
  /**
   * A finger never hovers, so on a coarse pointer the same relationship is
   * shown by tapping a chip to pin it.
   */
  pinned?: number | null;
  onPin?: (index: number | null) => void;
  /** Where this shot lands in the design currently under the pointer. */
  slotLabel?: (index: number) => string | null;
}

/**
 * The uploaded set, as a row you can rearrange.
 *
 * The number on a thumbnail is not decoration: it is the board this screenshot
 * lands on, so the order here is the order of the finished store listing. That
 * is the whole reason this is draggable rather than a static gallery.
 *
 * Reordering is written on pointer events with setPointerCapture, the same
 * shape the App Preview timeline uses, because HTML5 drag and drop does not
 * fire for a finger at all and no sortable library is installed. The arrow
 * buttons beside each tile are not a fallback for that, they are the keyboard
 * and screen reader path, and every other reorderable list in this app is
 * driven by exactly those buttons.
 */
export function ScreenshotStrip({
  shots,
  onReorder,
  onRemove,
  onAddMore,
  max,
  disabled,
  highlight,
  onHoverShot,
  pinned,
  onPin,
  slotLabel,
}: ScreenshotStripProps) {
  const railRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ id: string; from: number; over: number } | null>(null);
  const dragRef = useRef<{ id: string; from: number; over: number; moved: boolean } | null>(null);

  /** Which slot the pointer is over, from the tile centres on the rail. */
  const slotAt = useCallback((clientX: number): number => {
    const rail = railRef.current;
    if (!rail) return 0;
    const tiles = Array.from(rail.querySelectorAll<HTMLElement>('[data-shot-tile]'));
    for (let index = 0; index < tiles.length; index++) {
      const box = tiles[index].getBoundingClientRect();
      if (clientX < box.left + box.width / 2) return index;
    }
    return tiles.length - 1;
  }, []);

  const beginDrag = (event: React.PointerEvent, id: string, from: number) => {
    if (disabled || shots.length < 2) return;
    // Let a secondary button open the browser's own menu.
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { id, from, over: from, moved: false };
    setDrag({ id, from, over: from });
  };

  const moveDrag = (event: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    const over = slotAt(event.clientX);
    // A 3px threshold keeps a plain click from counting as a zero-distance
    // reorder, which would fight the remove button underneath it.
    const moved = current.moved || Math.abs(event.movementX) > 0;
    if (over === current.over && moved === current.moved) return;
    dragRef.current = { ...current, over, moved };
    setDrag({ id: current.id, from: current.from, over });
  };

  const endDrag = (event: React.PointerEvent) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (!current || current.over === current.from) return;
    onReorder(current.from, current.over);
  };

  const move = (from: number, delta: number) => {
    const to = from + delta;
    if (to < 0 || to >= shots.length) return;
    onReorder(from, to);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <ul
        ref={railRef}
        className="flex flex-wrap gap-3"
        aria-label="Uploaded screenshots, in board order"
      >
        {shots.map((shot, index) => {
          const isDragging = drag?.id === shot.id;
          const isTarget = !!drag && drag.id !== shot.id && drag.over === index;
          const isLit = highlight === index || pinned === index;
          const label = slotLabel?.(index) ?? null;
          return (
            <li
              key={shot.id}
              data-shot-tile=""
              onPointerEnter={(event) => {
                if (event.pointerType !== 'mouse') return;
                onHoverShot?.(index);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== 'mouse') return;
                onHoverShot?.(null);
              }}
              className={cn(
                'group relative w-[74px] transition-transform',
                isDragging && 'opacity-40',
                isTarget && 'translate-x-1'
              )}
            >
              <div
                // touch-action: none, or the browser claims the gesture to
                // scroll the rail and cancels the drag halfway through.
                style={{ touchAction: 'none' }}
                onPointerDown={(event) => beginDrag(event, shot.id, index)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={() => onPin?.(pinned === index ? null : index)}
                className={cn(
                  'relative aspect-[9/19.5] w-full overflow-hidden rounded-lg border bg-muted',
                  (isTarget || isLit) && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                  shots.length > 1 && !disabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                )}
              >
                {/* Plain img: an in-memory data URL, not a routed asset. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.aiDataUrl}
                  alt={shot.fileName}
                  draggable={false}
                  className="pointer-events-none h-full w-full object-cover"
                />
                <span className="pointer-events-none absolute left-1 top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-black/70 px-1 text-[11px] font-semibold tabular-nums text-white">
                  {index + 1}
                </span>
                {shot.analysis.looksFramed && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-amber-500/90 text-white">
                        <AlertTriangle className="h-3 w-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="z-[60] max-w-[15rem] text-sm">
                      This one looks like it already sits in a device frame. Upload the raw capture instead, or it goes in a frame twice
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              <button
                type="button"
                onClick={() => onRemove(shot.id)}
                disabled={disabled}
                title={`Remove ${shot.fileName}`}
                data-touch-reveal
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>

              <div className="mt-1 flex items-center justify-between gap-0.5">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={disabled || index === 0}
                  title="Move earlier"
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-center text-[10px] leading-tight',
                        label === 'unused' ? 'text-muted-foreground/50' : 'text-muted-foreground',
                        label && label !== 'unused' && 'font-medium text-primary'
                      )}
                    >
                      {label ?? shortDeviceLabel(shot.analysis.device)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="z-[60] text-sm">
                    <span className="font-medium">{shot.fileName}</span>
                    <br />
                    {shot.width} x {shot.height}, detected as {deviceLabel(shot.analysis.device)}
                  </TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={disabled || index === shots.length - 1}
                  title="Move later"
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}

        {shots.length < max && (
          <li className="w-[74px]">
            <Button
              type="button"
              variant="outline"
              onClick={onAddMore}
              disabled={disabled}
              className="flex aspect-[9/19.5] h-auto w-full flex-col gap-1 border-dashed p-0 text-muted-foreground"
            >
              <ImagePlus className="h-4 w-4" />
              <span className="text-[10px] font-medium">Add</span>
            </Button>
          </li>
        )}
      </ul>
    </TooltipProvider>
  );
}
