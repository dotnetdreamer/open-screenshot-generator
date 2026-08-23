"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { withBasePath } from '@/lib/basePath';
import { StaticArtboard } from '@/components/open-screenshot-generator/StaticArtboard';
import type { ArtboardState, DeviceFrameElementProps, Project } from '@/types/artboard';
import { fillTemplate, type FillOptions, type PlaceableShot } from '@/lib/intake/autoFill';
import type { TemplateScore } from '@/lib/intake/templateIndex';
import { deckBoardBox, flattenBoard3d } from './deckLayout';

interface TemplateMatchCardProps {
  template: Project;
  scored: TemplateScore;
  shots: PlaceableShot[];
  fillOptions: FillOptions;
  /** Which uploaded shot lands in which device element, by element id. */
  ownerOf?: Map<string, number>;
  /**
   * Whether this card may mount live boards. The deck hands out a budget,
   * because a 3D device frame costs a WebGL context and the browser evicts the
   * oldest one once roughly sixteen are alive, blanking it.
   */
  live: boolean;
  /** Over budget: render live, but with the 3D frames flattened. */
  downgrade3d?: boolean;
  /** The shot the user is pointing at, so the board holding it can answer. */
  highlightShot?: number | null;
  onHoverBoard?: (shotIndex: number | null) => void;
  selected?: boolean;
  onSelect: () => void;
  onUse: () => void;
}

/**
 * One ranked result, showing the user's own screenshots inside a finished
 * design.
 *
 * This is the whole argument for the flow. Every competitor asks for a name, a
 * category and a context paragraph, then runs a model, and only then shows you
 * something. Here the boards are rendered from the real artboard components,
 * with the real screenshots in the real frames, before the user has typed
 * anything. It is the same renderer the canvas and the PNG export use, so what
 * is in this card is what comes out.
 *
 * The boards mount only once the card has been scrolled to, and a card the 3D
 * budget cannot cover still renders the user's content: it flattens the frames
 * rather than falling back to a stock picture of somebody else's app.
 */
export function TemplateMatchCard({
  template,
  scored,
  shots,
  fillOptions,
  ownerOf,
  live,
  downgrade3d,
  highlightShot,
  onHoverBoard,
  selected,
  onSelect,
  onUse,
}: TemplateMatchCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  const box = useMemo(() => deckBoardBox(scored.entry.canvas), [scored.entry.canvas]);

  // Mount the live boards only once the card has been scrolled to. With ninety
  // candidates in the deck, building every board up front is both a long task
  // and a pile of WebGL contexts nobody is looking at.
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const boards = useMemo((): ArtboardState[] | null => {
    if (!live || !visible || shots.length === 0) return null;
    // 'keep' rather than the caller's policy: a card is a look at the design,
    // and trimming boards out of the preview would make two templates that fit
    // differently look identical.
    const result = fillTemplate(template, shots, { ...fillOptions, unusedBoards: 'keep' });
    const filled = (result.project.projectData ?? []).slice(0, box.boardsShown);
    return downgrade3d ? filled.map(flattenBoard3d) : filled;
  }, [live, visible, shots, template, fillOptions, box.boardsShown, downgrade3d]);

  const isPlaceholder = !template.previewImage || template.previewImage.includes('placehold.co');
  const columns = boards?.length ?? box.boardsShown;

  /** The first shot a board holds, for the hover handshake with the strip. */
  const shotOnBoard = (board: ArtboardState): number | null => {
    if (!ownerOf) return null;
    for (const element of board.elements) {
      if (element.type !== 'device') continue;
      const owner = ownerOf.get((element as DeviceFrameElementProps).id);
      if (owner !== undefined) return owner;
    }
    return null;
  };

  const badge =
    shots.length === 0
      ? `${scored.entry.slots.length} ${scored.entry.slots.length === 1 ? 'slot' : 'slots'}`
      : scored.fits === shots.length
        ? `Holds all ${shots.length}`
        : scored.entry.slots.length < shots.length
          ? `Fits ${scored.entry.slots.length} of ${shots.length}`
          : `Room for ${scored.entry.slots.length}`;

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      // Width follows the boards, because the deck mixes canvas shapes that
      // differ by more than 4x and a fixed grid column would letterbox most of
      // them. flex-wrap in the parent absorbs the variation.
      style={{ width: box.boardWidth * columns + 8 * (columns - 1) + 24 }}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-left transition-all',
        'hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected && 'border-primary shadow-lg ring-1 ring-primary'
      )}
    >
      {/* Card chrome stays OUTSIDE whatever StaticArtboard marks with
          data-artboard-surface, or it inherits the forced-light artboard
          palette and stops reading in dark mode. */}
      <div className="relative overflow-hidden bg-muted/40 p-3">
        {boards && boards.length > 0 ? (
          <div className="flex gap-2 overflow-hidden">
            {boards.map((board) => {
              const owner = shotOnBoard(board);
              const lit = owner !== null && owner === highlightShot;
              return (
                <div
                  key={board.id}
                  onPointerEnter={() => onHoverBoard?.(owner)}
                  onPointerLeave={() => onHoverBoard?.(null)}
                  className={cn(
                    'relative overflow-hidden rounded transition-shadow',
                    lit && 'shadow-[0_0_0_3px_hsl(var(--primary))]'
                  )}
                >
                  <StaticArtboard artboard={board} scale={box.boardHeight / board.size.height} />
                </div>
              );
            })}
          </div>
        ) : template.previewImage ? (
          <div className="relative w-full overflow-hidden rounded" style={{ height: box.boardHeight }}>
            <Image
              src={withBasePath(template.previewImage)}
              alt={template.name}
              fill
              sizes="440px"
              className={isPlaceholder ? 'object-cover' : 'object-contain'}
            />
          </div>
        ) : (
          <div className="w-full rounded bg-muted" style={{ height: box.boardHeight }} />
        )}

        {/* One badge, and it says the thing that actually decides the pick. */}
        <span className="absolute right-4 top-4 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground shadow-sm backdrop-blur">
          {badge}
        </span>

        {/* Say so when the design has more boards than the card can show, or a
            five board template and a three board one look identical here. */}
        {boards && scored.entry.boardCount > boards.length && (
          <span className="absolute bottom-4 right-4 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground shadow-sm backdrop-blur">
            {`+${scored.entry.boardCount - boards.length} more`}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 border-t p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{template.name}</h4>
          <Button
            size="sm"
            variant={selected ? 'default' : 'ghost'}
            onClick={(event) => {
              event.stopPropagation();
              onUse();
            }}
            className="h-7 shrink-0 px-2 text-xs"
          >
            Use
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
        {scored.reasons.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {scored.reasons.map((reason) => (
              <li
                key={reason}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/60 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
              >
                {reason === 'Matches your words' && <Sparkles className="h-2.5 w-2.5" />}
                {reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
