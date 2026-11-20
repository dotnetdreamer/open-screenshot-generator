"use client";

// The palette's Custom tab: the user's own pictures (src/lib/cutout/library.ts),
// placed like the Images tab's photos. A tile carries the picture's `asset:`
// reference, so the artboard holds the picture by id the way an upload does.
// Pictures still being cut show here too, and can be placed once they are done.

import React, { useRef } from 'react';
import { ImagePlusIcon, Loader2Icon, ScissorsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { customLibraryId } from '@/lib/libraryIds';
import { addPictureFiles, PICTURE_ACCEPT } from '@/lib/cutout/add';
import { markLibraryImagePlaced, refOf, setLibraryImageState, useLibraryImages, type LibraryImageRow } from '@/lib/cutout/library';
import { drainLibraryQueue } from '@/lib/cutout/queue';
import type { TouchDragBinding } from '@/hooks/use-touch-drag';
import type { PaletteTilePayload } from '../ElementPalette';
import { useThumbUrl } from './thumbs';

/** The size a picture lands at: its own shape, the long side 520 pixels. */
export function placedSize(width: number, height: number): { width: number; height: number } {
  const scale = 520 / Math.max(1, width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** What a library picture puts on an artboard, as the palette's styleProps. */
export function placementProps(row: LibraryImageRow): Record<string, unknown> | null {
  const ref = refOf(row);
  if (!ref || !row.width || !row.height) return null;
  return { imageSrc: ref, imageAlt: row.name, name: row.name, defaultSize: placedSize(row.width, row.height) };
}

type DragStart = (
  e: React.DragEvent<HTMLElement> | null,
  type: 'image',
  subType: undefined,
  styleProps: Record<string, unknown>,
  libraryId: string
) => void;

function Tile({
  row,
  onDragStart,
  bindTouch,
  onCut,
}: {
  row: LibraryImageRow;
  onDragStart: DragStart;
  bindTouch?: (payload: PaletteTilePayload) => TouchDragBinding;
  onCut: (row: LibraryImageRow) => void;
}) {
  const url = useThumbUrl(row);
  const props = placementProps(row);
  const libraryId = customLibraryId(row.id);
  const busy = row.state === 'waiting' || row.state === 'cutting';
  const ready = !!props && !busy;
  return (
    <div className="group relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-accent/10 p-1.5 transition-colors hover:bg-accent/25 disabled:cursor-default disabled:opacity-60"
            disabled={!ready}
            draggable={ready}
            onDragStart={(event) => {
              if (!props) return;
              void markLibraryImagePlaced(row.id);
              onDragStart(event, 'image', undefined, props, libraryId);
            }}
            onClick={() => {
              if (!props) return;
              void markLibraryImagePlaced(row.id);
              onDragStart(null, 'image', undefined, props, libraryId);
            }}
            {...(ready && bindTouch ? bindTouch({ label: row.name, type: 'image', styleProps: props, libraryId }) : {})}
            aria-label={busy ? `${row.name}, removing the background` : `Add ${row.name} (${libraryId})`}
            data-testid="custom-image-tile"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {url && <img src={url} alt="" className="max-h-full max-w-full object-contain" draggable={false} />}
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2Icon className="h-4 w-4 animate-spin text-foreground/70" />
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[16rem] px-2.5 py-1.5">
          <div className="text-xs font-medium">{busy ? 'Removing the background' : `Add ${row.name}`}</div>
        </TooltipContent>
      </Tooltip>
      {ready && (
        <button
          type="button"
          title="Remove the background"
          aria-label={`Remove the background from ${row.name}`}
          onClick={() => onCut(row)}
          data-touch-reveal
          className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm hover:bg-background group-hover:flex"
        >
          <ScissorsIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function CustomPaletteTab({
  onDragStart,
  bindTouch,
  onOpenCutout,
}: {
  onDragStart: DragStart;
  bindTouch?: (payload: PaletteTilePayload) => TouchDragBinding;
  /** Opens the background remover, on a picture when one is given. Absent where there is no such view. */
  onOpenCutout?: (imageId?: string) => void;
}) {
  const rows = useLibraryImages();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const add = async (files: File[]) => {
    try {
      await addPictureFiles(files, { cut: false });
    } catch (error) {
      toast({ title: "Those pictures couldn't be added", description: error instanceof Error ? error.message : 'Try again.' });
    }
  };

  const cut = async (row: LibraryImageRow) => {
    // A picture kept as it came gets its background removed; one already cut
    // opens in the view, where its cut can change.
    if (row.state === 'plain') {
      await setLibraryImageState(row.id, 'waiting');
      void drainLibraryQueue();
    }
    onOpenCutout?.(row.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-8 flex-1 gap-1.5 text-xs" onClick={() => fileRef.current?.click()}>
          <ImagePlusIcon className="h-3.5 w-3.5" />
          Add pictures
        </Button>
        {onOpenCutout && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 flex-1 gap-1.5 text-xs"
            title="Take the background out of your photos"
            onClick={() => onOpenCutout()}
          >
            <ScissorsIcon className="h-3.5 w-3.5" />
            Remove background
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={PICTURE_ACCEPT}
          multiple
          className="hidden"
          data-testid="custom-file-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) void add(files);
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {rows && rows.length === 0 && (
          <p className="px-1 pt-2 text-[11px] leading-snug text-muted-foreground">
            Your own pictures show up here. Add some, or use Remove background to take the background out of a photo.
          </p>
        )}
        {rows && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {rows.map((row) => (
              <Tile key={row.id} row={row} onDragStart={onDragStart} bindTouch={bindTouch} onCut={(target) => void cut(target)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
