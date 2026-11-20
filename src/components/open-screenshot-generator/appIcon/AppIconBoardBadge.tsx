"use client";

import React, { createContext, useContext, useMemo } from 'react';
import { SquircleIcon } from 'lucide-react';
import type { ArtboardState } from '@/types/artboard';
import { cn } from '@/lib/utils';
import { checkIcon, checkSummary } from '@/lib/appIcon/checks';
import { isIconBoard } from '@/lib/appIcon/specs';

/**
 * What the app icon's chip and live card can do. The editor provides it
 * around the canvas; anywhere else there is none and the chip only reports.
 */
export const AppIconActionsContext = createContext<{
  /** Open the app icon window on this artboard. */
  openStudio: (boardId: string) => void;
} | null>(null);

/**
 * The chip under the app icon artboard: what it is, and what the checks that
 * need no pixels find (sizes of words and lines, an empty front layer). The
 * window runs the rest. A click opens it.
 */
export function AppIconBoardBadge({ board }: { board: ArtboardState }) {
  const actions = useContext(AppIconActionsContext);
  const summary = useMemo(() => checkSummary(checkIcon(board, null)), [board]);
  if (!isIconBoard(board)) return null;
  return (
    <button
      type="button"
      // The board under the label must not take this press as a drag or a deselect.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        actions?.openStudio(board.id);
      }}
      disabled={!actions}
      data-export-exclude
      data-testid="app-icon-badge"
      title="Preview the icon and save every size"
      className={cn(
        'ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
        summary.level === 'error'
          ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15'
          : summary.level === 'warn'
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300'
            : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15'
      )}
    >
      <SquircleIcon className="h-3 w-3" />
      App icon
      <span className="opacity-70">· {summary.text}</span>
    </button>
  );
}
