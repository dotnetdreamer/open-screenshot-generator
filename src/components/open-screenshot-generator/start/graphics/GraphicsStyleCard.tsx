"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { StaticArtboard } from '@/components/open-screenshot-generator/StaticArtboard';
import type { ArtboardState } from '@/types/artboard';
import { flattenBoard3d } from '@/components/open-screenshot-generator/start/quickstart/deckLayout';

interface GraphicsStyleCardProps {
  board: ArtboardState;
  label: string;
  blurb: string;
  /** Rendered width of the board inside the card, in px. */
  width: number;
  /** Whether this card may mount a live 3D frame, or must render it flat. */
  downgrade3d?: boolean;
  selected?: boolean;
  onSelect: () => void;
  onUse: () => void;
}

/**
 * One style, rendered at the format the user is looking at.
 *
 * The screenshot deck's card cannot be reused here, and the reason is the
 * opposite of what it looks like. `deckBoardBox` sizes by HEIGHT because that
 * deck mixes five canvas shapes in one row and height is the only dimension
 * they can share. A graphics deck is homogeneous: every card holds one board at
 * the one active format. So width is the shared dimension here, and sizing by
 * height instead would give a 4:1 LinkedIn cover a card four times wider than a
 * story's.
 */
export function GraphicsStyleCard({
  board,
  label,
  blurb,
  width,
  downgrade3d,
  selected,
  onSelect,
  onUse,
}: GraphicsStyleCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  // Mount the board only once the card has been scrolled to. Eight boards, each
  // holding up to three device frames, is a lot to build for a grid whose lower
  // half is usually below the fold.
  useEffect(() => {
    if (seen) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);

  const shown = useMemo(
    () => (downgrade3d ? flattenBoard3d(board) : board),
    [board, downgrade3d]
  );
  const scale = width / board.size.width;
  const height = board.size.height * scale;

  return (
    <div
      ref={ref}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border bg-card p-2 transition-colors',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50'
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onUse}
        className="block overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ height }}
        aria-label={`${label}. ${blurb}`}
      >
        {seen ? (
          <StaticArtboard artboard={shown} scale={scale} />
        ) : (
          <div className="h-full w-full animate-pulse rounded-lg bg-muted" style={{ width }} />
        )}
      </button>
      <div className="flex items-center gap-2 px-1 pb-0.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold tracking-tight">{label}</p>
          <p className="truncate text-[11px] text-muted-foreground">{blurb}</p>
        </div>
        <Button
          size="sm"
          variant={selected ? 'default' : 'ghost'}
          className="h-7 shrink-0 px-2 text-xs"
          onClick={onUse}
        >
          Open
          <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
