"use client";

// The card a tab shows when the pointer rests on it: the project's first few
// artboards, small, and what kind of tab it is.
//
// The artboards are drawn live with StaticArtboard, the same read-only renderer
// the previews use, rather than from a captured thumbnail. Capturing one on
// every tab switch would put an html-to-image pass in front of each switch;
// drawing on hover costs nothing until somebody hovers. 3D frames are drawn
// flat (flattenBoard3d), so a hover card never takes a WebGL context away from
// the canvas.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoonIcon } from 'lucide-react';
import type { ArtboardState } from '@/types/artboard';
import { computeSpill, spillFor } from '@/lib/spanArtboards';
import type { ProjectTab } from '@/lib/tabs/tabModel';
import type { TabSummary } from '@/lib/tabs/summary';
import { StaticArtboard } from '../StaticArtboard';
import { flattenBoard3d } from '../start/quickstart/deckLayout';

/** How many artboards the card shows. */
const BOARDS_SHOWN = 4;
const STRIP_HEIGHT = 92;
const CARD_WIDTH = 288;

export type TabArtboardsSource = ArtboardState[] | Promise<ArtboardState[] | null> | null;

interface TabHoverCardProps {
  tab: ProjectTab;
  anchor: DOMRect;
  summary?: TabSummary;
  isActive: boolean;
  isSleeping: boolean;
  /** Its undo history is on disk and comes back when it opens (it slept in this sitting). */
  keepsUndo?: boolean;
  /** Where the artboards come from: the canvas, the parking lot, or a read of the saved row. */
  artboards: TabArtboardsSource;
  shortcut?: string;
}

function describe(summary: TabSummary | undefined): string {
  if (!summary || summary.artboards === 0) return '';
  const parts = [
    summary.artboards === 1 ? '1 artboard' : `${summary.artboards} artboards`,
    `${summary.width} x ${summary.height}`,
  ];
  // The base language counts too: a project with German added is in two.
  if (summary.languages > 0) parts.push(`${summary.languages + 1} languages`);
  return parts.join(' · ');
}

export function TabHoverCard({
  tab,
  anchor,
  summary,
  isActive,
  isSleeping,
  keepsUndo = false,
  artboards,
  shortcut,
}: TabHoverCardProps) {
  const [resolved, setResolved] = useState<ArtboardState[] | null>(() =>
    Array.isArray(artboards) ? artboards : null
  );
  useEffect(() => {
    if (Array.isArray(artboards)) {
      setResolved(artboards);
      return;
    }
    if (!artboards) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    void artboards.then((boards) => {
      if (!cancelled) setResolved(boards);
    });
    return () => {
      cancelled = true;
    };
  }, [artboards]);

  const shown = useMemo(() => {
    if (!resolved?.length) return [];
    const spill = computeSpill(resolved);
    return resolved.slice(0, BOARDS_SHOWN).map((board) => ({
      board: flattenBoard3d(board),
      spill: spillFor(spill, board.id),
    }));
  }, [resolved]);

  // Under the tab, kept inside the window. Measured after the first render
  // because the card's own height depends on what it ended up holding.
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>(() => ({
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - CARD_WIDTH - 8)),
    top: anchor.bottom + 6,
  }));
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const width = card.offsetWidth || CARD_WIDTH;
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
      top: Math.min(anchor.bottom + 6, window.innerHeight - card.offsetHeight - 8),
    });
  }, [anchor, shown.length]);

  const detail = describe(summary);
  const totalWidth = shown.reduce(
    (width, item) => width + (item.board.size.width * STRIP_HEIGHT) / Math.max(1, item.board.size.height),
    0
  );
  // Narrow boards fit four across; wide ones (a feature graphic) are scaled
  // down further so the strip never runs off the card.
  const fit = Math.min(1, (CARD_WIDTH - 24 - (shown.length - 1) * 6) / Math.max(1, totalWidth));
  const height = STRIP_HEIGHT * fit;

  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      data-tab-hover-card
      className="pointer-events-none fixed z-[70] w-72 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex h-[116px] items-center justify-center gap-1.5 bg-muted/50 px-3">
        {shown.length > 0 ? (
          shown.map(({ board, spill }) => (
            <div
              key={board.id}
              className="overflow-hidden rounded-[5px] shadow-sm ring-1 ring-black/10 dark:ring-white/10"
            >
              <StaticArtboard artboard={board} scale={height / Math.max(1, board.size.height)} spill={spill} />
            </div>
          ))
        ) : (
          <div className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: Math.min(BOARDS_SHOWN, Math.max(1, summary?.artboards ?? 3)) }).map((_, index) => (
              <div
                key={index}
                className="h-[84px] w-[39px] animate-pulse rounded-[5px] bg-muted-foreground/15"
                style={index === 0 && summary ? { background: summary.accent, opacity: 0.55 } : undefined}
              />
            ))}
          </div>
        )}
      </div>
      <div className="space-y-1 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <p className={tab.preview ? 'line-clamp-2 text-sm font-medium italic' : 'line-clamp-2 text-sm font-medium'}>
            {tab.name || 'Untitled project'}
          </p>
          {shortcut && (
            <kbd className="mt-0.5 shrink-0 rounded border bg-muted px-1.5 font-sans text-[10px] font-medium text-muted-foreground">
              {shortcut}
            </kbd>
          )}
        </div>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        {tab.preview && (
          <p className="text-xs text-muted-foreground">
            Preview. The next project you open takes this tab unless you edit it
          </p>
        )}
        {isSleeping && !isActive && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MoonIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            {keepsUndo
              ? 'Sleeping to save memory. Undo history comes back when you open this tab'
              : 'Not opened since the app started. Undo history starts over when you open it'}
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
