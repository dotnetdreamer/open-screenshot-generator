"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clipboard, FolderOpen, Loader2, RotateCcw, Store, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import {
  collectDroppedFiles,
  collectPastedFiles,
  normalizePickedFiles,
  INTAKE_MAX,
} from '@/lib/intake/intakeFiles';

interface IntakeDropZoneProps {
  onFiles: (files: File[]) => void;
  /** Number already in the set, so the zone can say how much room is left. */
  count: number;
  busy?: boolean;
  /** Compact form, shown once the set is not empty. */
  compact?: boolean;
  onOpenStoreImport?: () => void;
  /** Offered when a previous set is still on this device. */
  remembered?: { count: number; onRestore: () => void } | null;
  /** False while this screen is mounted but covered by another view. */
  active?: boolean;
}

/**
 * Where screenshots come in.
 *
 * Four routes, because people use four: dropping files, dropping the whole
 * folder the simulator wrote, clicking to browse, and pasting a capture they
 * just took. The paste route is the one nobody builds and everybody tries,
 * and it is bound at the window while this is on screen rather than on a
 * focused element, because a user who just hit Cmd+Shift+4 has not clicked
 * anything yet.
 */
export function IntakeDropZone({
  onFiles,
  count,
  busy,
  compact,
  onOpenStoreImport,
  remembered,
  active = true,
}: IntakeDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pasteHint, setPasteHint] = useState(false);
  const coarse = useCoarsePointer();
  const depth = useRef(0);

  // Window level, so a screen capture can be pasted the moment this mounts
  // without anything being focused first.
  useEffect(() => {
    if (!active) return;
    const handle = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal a paste aimed at a field the user is typing in.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const files = collectPastedFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      setPasteHint(true);
      window.setTimeout(() => setPasteHint(false), 900);
      onFiles(files);
    };
    window.addEventListener('paste', handle);
    return () => window.removeEventListener('paste', handle);
  }, [onFiles, active]);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      // stopPropagation is not optional here. This zone renders INSIDE the
      // dialog-wide drop layer, which handles the same bubbling event, so
      // without it one drop is ingested twice: once here and once through the
      // layer, both starting from the same pre-drop set, and five screenshots
      // arrive as ten.
      event.stopPropagation();
      depth.current = 0;
      setDragging(false);
      const files = await collectDroppedFiles(event.dataTransfer);
      if (files.length > 0) onFiles(files);
    },
    [onFiles]
  );

  const room = Math.max(0, INTAKE_MAX - count);

  const pickers = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) onFiles(normalizePickedFiles(Array.from(event.target.files)));
          event.target.value = '';
        }}
      />
      <input
        ref={folderRef}
        type="file"
        accept="image/*"
        multiple
        // Non-standard, and the only way to browse to a folder. Missing support
        // just means the button falls back to picking files.
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        className="hidden"
        onChange={(event) => {
          if (event.target.files) onFiles(normalizePickedFiles(Array.from(event.target.files)));
          event.target.value = '';
        }}
      />
    </>
  );

  if (compact) {
    return (
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          depth.current++;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragLeave={(event) => {
          event.stopPropagation();
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={handleDrop}
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border'
        )}
      >
        {pickers}
        <span className="text-muted-foreground">
          {room > 0 ? `Drop more here, or` : `That is the limit of ${INTAKE_MAX}`}
        </span>
        {room > 0 && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
              Browse
            </Button>
            {onOpenStoreImport && (
              <Button type="button" variant="ghost" size="sm" onClick={onOpenStoreImport} disabled={busy}>
                <Store className="h-3.5 w-3.5" />
                From the App Store
              </Button>
            )}
          </>
        )}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
    );
  }

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragLeave={(event) => {
        // Counted, not toggled: dragging over a child fires leave on the parent.
        event.stopPropagation();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={handleDrop}
      className={cn(
        'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 bg-muted/20'
      )}
    >
      {pickers}

      <div
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full border bg-background text-muted-foreground transition-transform',
          (dragging || pasteHint) && 'scale-110 border-primary text-primary'
        )}
      >
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <UploadCloud className="h-6 w-6" />}
      </div>

      <div className="space-y-1">
        <p className="text-base font-semibold">
          {dragging ? 'Let go to add them' : 'Drop your screenshots here'}
        </p>
        <p className="text-sm text-muted-foreground">
          A folder works too. Any number from one to {INTAKE_MAX}, and you can reorder them after
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          Choose files
        </Button>
        {!coarse && (
          <Button type="button" variant="outline" onClick={() => folderRef.current?.click()} disabled={busy}>
            <FolderOpen className="h-4 w-4" />
            Choose a folder
          </Button>
        )}
        {onOpenStoreImport && (
          <Button type="button" variant="outline" onClick={onOpenStoreImport} disabled={busy}>
            <Store className="h-4 w-4" />
            Import from the App Store
          </Button>
        )}
      </div>

      {!coarse && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clipboard className="h-3.5 w-3.5" />
          Or just paste a screenshot you copied
        </p>
      )}

      {remembered && remembered.count > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={remembered.onRestore}
          disabled={busy}
          className="mt-1"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {`Bring back the ${remembered.count} from last time`}
        </Button>
      )}
    </div>
  );
}
