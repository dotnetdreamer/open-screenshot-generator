"use client";

import React, { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { collectDroppedFiles } from '@/lib/intake/intakeFiles';

interface DialogDropLayerProps {
  /** Off on the agent screen, which runs its own intake. */
  active: boolean;
  onFiles: (files: File[]) => void;
  children: React.ReactNode;
}

/**
 * The whole start dialog as a drop target.
 *
 * This is what turns the fast path from a screen you have to find into a
 * gesture that always works. Somebody browsing the template gallery who drags
 * their screenshots onto it should not have to notice a card first, go back,
 * and start again: the drop is the intent, and it is unambiguous.
 */
export function DialogDropLayer({ active, onFiles, children }: DialogDropLayerProps) {
  const [dragging, setDragging] = useState(false);
  // Counted, not toggled. Dragging over a child fires dragleave on the parent,
  // so a boolean flickers the overlay off every time the pointer crosses a card.
  const depth = useRef(0);

  const reset = useCallback(() => {
    depth.current = 0;
    setDragging(false);
  }, []);

  // The wrapper is rendered unconditionally, and `active` only turns the
  // handlers off. Returning a Fragment instead when inactive would change the
  // element TYPE at this position, and React tears down and rebuilds the whole
  // subtree when that happens: stepping into the AI screen would wipe the quick
  // start's uploaded set, its order and everything typed into it.
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(event) => {
        if (!active || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!active || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        if (!active) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!active || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        reset();
        // Read the transfer synchronously. The items list is neutered at the
        // end of the event turn, so awaiting first loses a dropped folder.
        void collectDroppedFiles(event.dataTransfer).then((files) => {
          if (files.length > 0) onFiles(files);
        });
      }}
    >
      {children}
      {active && dragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary bg-background/90 backdrop-blur animate-in fade-in-0 duration-150">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary text-primary">
            <UploadCloud className="h-7 w-7" />
          </div>
          <p className="text-lg font-semibold">Drop them anywhere</p>
          <p className="text-sm text-muted-foreground">
            Every design that fits will show your own screens
          </p>
        </div>
      )}
    </div>
  );
}
