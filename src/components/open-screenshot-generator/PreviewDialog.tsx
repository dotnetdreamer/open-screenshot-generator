"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { XIcon, ChevronLeftIcon, ChevronRightIcon, LanguagesIcon, SmartphoneIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { projectArtboards } from '@/lib/i18n/project';
import { StaticArtboard, getArtboardBackgroundStyle, count3dDevices } from './StaticArtboard';
import { StoreListingPreview } from './StoreListingPreview';
import type { ArtboardState } from '@/types/artboard';

/** One entry in the language pill row. `null` is the base language. */
export interface PreviewLocaleOption {
  code: string | null;
  label: string;
}

interface PreviewDialogProps {
  /** Already resolved for the language on screen. */
  artboards: ArtboardState[];
  initialArtboardId?: string | null;
  onClose: () => void;
  /**
   * The base document. The compare sheet projects each language from this
   * itself, so it can show every language at once without the editor having to
   * switch languages under the user.
   */
  baseArtboards?: ArtboardState[];
  localeOptions?: PreviewLocaleOption[];
  activeLocale?: string | null;
  onSelectLocale?: (locale: string | null) => void;
  /** Stands in for the app name in the store listing mockup. */
  projectName?: string;
  /**
   * Which view to open on. The toolbar's Preview menu points straight at one,
   * so the store mockup and the language sheet are one click from the top bar.
   */
  initialMode?: PreviewMode;
}

/** What the dialog body is showing. */
export type PreviewMode = 'single' | 'compare' | 'store';

// --- compare languages -------------------------------------------------------

const COMPARE_THUMB_HEIGHT = 150;

/**
 * The editor canvas is still mounted behind this dialog and is already
 * spending some of the browser's WebGL context budget (see count3dDevices), so
 * the proof sheet takes a deliberately small slice: nothing off screen is
 * mounted at all, and the visible cells are mounted in order until the 3D
 * budget runs out.
 */
const LIVE_3D_BUDGET = 6;
/** A ceiling on plain DOM cost too, for a project with many flat boards. */
const MAX_LIVE_THUMBS = 24;

interface CompareCell {
  key: string;
  board: ArtboardState;
  cost3d: number;
}

function CompareThumb({
  cell,
  live,
  deferred,
  observer,
}: {
  cell: CompareCell;
  live: boolean;
  /** On screen but over the budget, so it says why it is not drawn. */
  deferred: boolean;
  observer: IntersectionObserver | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!observer || !node) return;
    observer.observe(node);
    return () => observer.unobserve(node);
  }, [observer]);

  const scale = COMPARE_THUMB_HEIGHT / cell.board.size.height;

  return (
    <div
      ref={ref}
      data-compare-cell={cell.key}
      title={cell.board.name}
      className="flex-shrink-0 overflow-hidden rounded-sm ring-1 ring-white/15"
      style={{
        width: `${Math.round(cell.board.size.width * scale)}px`,
        height: `${COMPARE_THUMB_HEIGHT}px`,
      }}
    >
      {live ? (
        <StaticArtboard artboard={cell.board} scale={scale} />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={getArtboardBackgroundStyle(cell.board)}
        >
          {deferred && (
            <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white/70">
              {cell.cost3d > 0 ? '3D paused' : 'Paused'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Read only proof sheet: one row per language, each row every board in that
 * language. It projects from the base document itself, so opening it never
 * changes which language the editor is showing.
 */
function CompareLanguagesSheet({
  baseArtboards,
  options,
}: {
  baseArtboards: ArtboardState[];
  options: PreviewLocaleOption[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set());

  const rows = useMemo(
    () =>
      options.map((option, rowIndex) => {
        const boards = projectArtboards(baseArtboards, option.code);
        return {
          option,
          cells: boards.map<CompareCell>((board) => ({
            key: `${rowIndex}:${board.id}`,
            board,
            cost3d: count3dDevices(board),
          })),
        };
      }),
    [baseArtboards, options]
  );

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        setVisibleKeys((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset.compareCell;
            if (!key) continue;
            if (entry.isIntersecting) {
              if (!next.has(key)) {
                next.add(key);
                changed = true;
              }
            } else if (next.delete(key)) {
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      // Mount a screen ahead of the scroll so a row is already drawn by the
      // time it arrives, without ever holding the whole sheet live.
      { root: scrollRef.current, rootMargin: '300px 0px' }
    );
    setObserver(io);
    return () => io.disconnect();
  }, []);

  // Visible cells claim the budget in reading order, so what goes without is
  // always the bottom of the screen rather than a different cell each scroll.
  const liveKeys = useMemo(() => {
    const live = new Set<string>();
    let budget = LIVE_3D_BUDGET;
    for (const row of rows) {
      for (const cell of row.cells) {
        if (!visibleKeys.has(cell.key)) continue;
        if (live.size >= MAX_LIVE_THUMBS) return live;
        if (cell.cost3d > budget) continue;
        budget -= cell.cost3d;
        live.add(cell.key);
      }
    }
    return live;
  }, [rows, visibleKeys]);

  return (
    // A native scroller, not a Radix ScrollArea: this sits under flex-1 and a
    // ScrollArea there silently stops scrolling.
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 pb-8">
      {rows.map((row) => (
        <div key={row.option.code ?? 'base'} className="mb-7">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-sm font-medium text-white">{row.option.label}</span>
            {row.option.code === null && <span className="text-xs text-white/50">Base</span>}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {row.cells.map((cell) => (
              <CompareThumb
                key={cell.key}
                cell={cell}
                live={liveKeys.has(cell.key)}
                deferred={visibleKeys.has(cell.key) && !liveKeys.has(cell.key)}
                observer={observer}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Language pills. The preview follows the editor's language, so picking one
 * here switches the editor too.
 */
function LocaleRow({
  options,
  activeLocale,
  onSelectLocale,
  height,
}: {
  options: PreviewLocaleOption[];
  activeLocale: string | null;
  onSelectLocale?: (locale: string | null) => void;
  height: number;
}) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center gap-2 overflow-x-auto px-4"
      style={{ height: `${height}px` }}
    >
      {options.map(option => (
        <button
          key={option.code ?? 'base'}
          type="button"
          onClick={() => onSelectLocale?.(option.code)}
          className={cn(
            "flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
            (option.code ?? null) === activeLocale
              ? "bg-white text-black"
              : "bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PreviewDialog({
  artboards,
  initialArtboardId,
  onClose,
  baseArtboards,
  localeOptions,
  activeLocale = null,
  onSelectLocale,
  projectName,
  initialMode = 'single',
}: PreviewDialogProps) {
  const initialIndex = Math.max(0, artboards.findIndex(ab => ab.id === initialArtboardId));
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const options = useMemo(() => localeOptions ?? [], [localeOptions]);
  const showLocaleRow = options.length > 1;
  const canCompare = showLocaleRow && !!baseArtboards;

  // A single-language project can still be sent here with 'compare' by a stale
  // menu, and an empty proof sheet is a dead end.
  const [mode, setMode] = useState<PreviewMode>(
    initialMode === 'compare' && !canCompare ? 'single' : initialMode
  );
  const compareOpen = mode === 'compare';
  const storeOpen = mode === 'store';

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

  // The proof sheet and the store mockup have no single board and no
  // filmstrip, so the arrow keys would move a selection nobody can see.
  const arrowsActive = mode === 'single' && artboards.length > 1;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && arrowsActive) {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight' && arrowsActive) {
        e.preventDefault();
        goNext();
      }
    };
    // Capture phase so editor shortcuts (Delete, Ctrl+Z, ...) never fire while previewing
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, goPrev, goNext, arrowsActive]);

  if (artboards.length === 0) return null;

  const artboard = artboards[Math.min(currentIndex, artboards.length - 1)];

  const HEADER_HEIGHT = 56;
  const FILMSTRIP_HEIGHT = 132;
  const LOCALE_ROW_HEIGHT = 44;
  const PADDING = 24;
  const availableWidth = Math.max(1, viewport.width - PADDING * 2);
  const availableHeight = Math.max(
    1,
    viewport.height
      - HEADER_HEIGHT
      - FILMSTRIP_HEIGHT
      - (showLocaleRow ? LOCALE_ROW_HEIGHT : 0)
      - PADDING * 2
  );
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
          {compareOpen ? (
            <span className="font-medium text-white">Every language</span>
          ) : storeOpen ? (
            <span className="font-medium text-white">Store listing</span>
          ) : (
            <>
              <span className="font-medium text-white">{artboard.name}</span>
              <span className="ml-3">{artboard.size.width} × {artboard.size.height}px</span>
            </>
          )}
        </div>
        <div className="text-sm text-white/70">
          {compareOpen
            ? `${options.length} languages`
            : storeOpen
              ? `${artboards.length} ${artboards.length === 1 ? 'screenshot' : 'screenshots'}`
              : `${currentIndex + 1} / ${artboards.length}`}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode(prev => (prev === 'store' ? 'single' : 'store'))}
            className={cn(
              "gap-2 text-white hover:bg-white/10 hover:text-white",
              storeOpen && "bg-white/15"
            )}
            title="See the screenshots at the size the store shows them"
          >
            <SmartphoneIcon className="h-4 w-4" />
            {storeOpen ? 'Back to preview' : 'Store preview'}
          </Button>
          {canCompare && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode(prev => (prev === 'compare' ? 'single' : 'compare'))}
              className={cn(
                "gap-2 text-white hover:bg-white/10 hover:text-white",
                compareOpen && "bg-white/15"
              )}
              title="Show every language side by side"
            >
              <LanguagesIcon className="h-4 w-4" />
              {compareOpen ? 'Back to preview' : 'Compare languages'}
            </Button>
          )}
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
      </div>

      {compareOpen && baseArtboards ? (
        <CompareLanguagesSheet baseArtboards={baseArtboards} options={options} />
      ) : storeOpen ? (
        <>
          <StoreListingPreview
            artboards={artboards}
            appName={projectName?.trim() || 'Your App'}
          />
          {/* The language pills stay: checking each locale's listing is the
              other half of why this view exists. */}
          {showLocaleRow && (
            <LocaleRow
              options={options}
              activeLocale={activeLocale}
              onSelectLocale={onSelectLocale}
              height={LOCALE_ROW_HEIGHT}
            />
          )}
        </>
      ) : (
      <>
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

      {showLocaleRow && (
        <LocaleRow
          options={options}
          activeLocale={activeLocale}
          onSelectLocale={onSelectLocale}
          height={LOCALE_ROW_HEIGHT}
        />
      )}

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
      </>
      )}
    </div>
  );
}
