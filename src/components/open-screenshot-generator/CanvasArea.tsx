"use client";
import type React from 'react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Artboard } from './Artboard';
import type { ArtboardState, Point, ElementType, ShapeType, DeviceType, ArtboardElement } from '@/types/artboard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { dropElementOverrides } from '@/lib/i18n/localization';
import { DeleteArtboardDialog } from './DeleteArtboardDialog'; // Import the new dialog component

/**
 * An element added to or removed from a board on the canvas.
 *
 * The canvas renders a PROJECTION (one language) of the base document, and the
 * projection is only allowed to differ in a handful of text/media keys. So a
 * change to *which* elements exist cannot be expressed as "here is the new
 * array": rebuilding the base from a projected array would either bake one
 * language's strings into every language, or drop an element that is merely
 * hidden in the language being viewed. It travels as a delta instead, and the
 * parent applies it to the base document.
 *
 * `added` elements are safe to write verbatim: they were just built from
 * palette defaults, so no locale has anything to say about them yet.
 */
export interface CanvasStructuralChange {
  artboardId: string;
  added: ArtboardElement[];
  removedIds: string[];
}

/** Artboards are laid out, and drawn, at this fraction of their real pixels. */
const DISPLAY_SCALE_FACTOR = 0.3;
/** Matches ARTBOARD_MARGIN in the layout, which is where board positions start. */
const BOARD_LAYER_MARGIN = 15;
/** The hover toolbar above a board and its name label below it. */
const BOARD_LABEL_ROOM = 90;
/** Zoom range shared with the zoom pill in the layout. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** A pan has to travel this far before it swallows the click that ends it. */
const PAN_CLICK_SLOP_PX = 3;

/**
 * Applies a canvas structural change to the BASE board it came from, dropping
 * the removed elements' overrides in every locale in the same pass so a
 * re-minted id can never inherit a stale translation.
 */
export function applyCanvasStructuralChange(board: ArtboardState, change: CanvasStructuralChange): ArtboardState {
  const removed = new Set(change.removedIds);
  const kept = removed.size > 0 ? board.elements.filter(el => !removed.has(el.id)) : board.elements;
  // New elements land on top, which is where the canvas just drew them.
  const elements = change.added.length > 0 ? [...kept, ...change.added] : kept;
  if (elements === board.elements) return board;
  return dropElementOverrides({ ...board, elements }, change.removedIds);
}

interface CanvasAreaProps {
  /**
   * What the active language shows. Board count, board order and board ids are
   * identical to the base document, so every index and length below still means
   * what it did before the locale overlay existed.
   */
  artboards: ArtboardState[];
  /** Property edits only. The parent folds these back into the base document. */
  onUpdateArtboards: (artboards: ArtboardState[]) => void;
  /**
   * Adding and deleting elements. Absent means the canvas falls back to
   * onUpdateArtboards, which is correct only while there is no locale overlay.
   */
  onUpdateBaseArtboards?: (change: CanvasStructuralChange) => void;
  onAddElementToArtboard: (artboardId: string, type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point, styleProps?: Record<string, any>) => void;
  activeArtboardId: string | null;
  setActiveArtboardId: (id: string | null) => void;
  selectedElementIdOnActiveArtboard: string | null;
  setSelectedElementIdOnActiveArtboard: (elementId: string | null) => void;
  canvasZoom: number;
  artboardRefs: React.MutableRefObject<Record<string, any>>;
  onAddNewArtboardFromToolbar: (currentArtboardId: string) => void;
  onDuplicateArtboardFromToolbar: (artboardId: string) => void;
  onDeleteArtboardFromToolbar: (artboardId: string) => void;
  onMoveArtboardFromToolbar: (artboardId: string, direction: 'left' | 'right') => void;
  onTranslateArtboard?: (artboardId: string) => void;
  onExportArtboard?: (artboardId: string) => void;
  activeTool: 'select' | 'pan';
  /**
   * Set the canvas zoom. The parent owns it (the zoom pill reads the same
   * value); this is what pinching two fingers on the canvas drives.
   */
  onZoomChange?: (zoom: number) => void;
  // While a project/template is still loading (Dexie read + artboard build),
  // the parent sets this so the canvas shows a stable skeleton instead of a
  // fake placeholder artboard. Artboard positioning is owned by the parent
  // (calculateArtboardPositions in OpenScreenshotGeneratorLayout), not here.
  isLoading?: boolean;
  // The language on screen, null for the base language. Nothing here resolves a
  // locale (the parent hands us an already-resolved array); it only keys the
  // boards so a switch cannot leave a half-typed string behind, and tags the
  // canvas for the screenshot harness.
  activeLocale?: string | null;
}

export function CanvasArea({
    artboards: externalArtboards,
    onUpdateArtboards,
    onUpdateBaseArtboards,
    onAddElementToArtboard,
    activeArtboardId,
    setActiveArtboardId,
    selectedElementIdOnActiveArtboard,
    setSelectedElementIdOnActiveArtboard,
    canvasZoom,
    artboardRefs,
    onAddNewArtboardFromToolbar,
    onDuplicateArtboardFromToolbar,
    onDeleteArtboardFromToolbar,
    onMoveArtboardFromToolbar,
    onTranslateArtboard,
    onExportArtboard,
    activeTool,
    onZoomChange,
    isLoading = false,
    activeLocale = null,
}: CanvasAreaProps) {
  // The parent is the single source of truth for artboards. We render the prop
  // directly (no private mirror copy) so a newly loaded template paints on the
  // same commit it arrives — the old double-buffer painted the previous/empty
  // state for one frame first, which is what produced the "blank artboard then
  // real template" flash.
  const artboards = externalArtboards;
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  // The zoomed layer the boards actually sit in, measured by the pinch handler.
  const boardLayerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // State for artboard deletion confirmation
  const [artboardToDelete, setArtboardToDelete] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [isPanning, setIsPanning] = useState(false);
  const panStartCoords = useRef<{ pointerId: number, x: number, y: number, scrollLeft: number, scrollTop: number } | null>(null);
  // Set when a pan actually moved the canvas, so the release doesn't fire a
  // click on whatever happens to sit under the cursor (artboard toolbar
  // buttons, elements) after the drag.
  const suppressNextClick = useRef(false);
  // The live pinch: two fingers on the canvas, zooming and panning together.
  const pinchRef = useRef<{
    startDistance: number;
    startZoom: number;
    /** The canvas point under the midpoint of the two fingers, kept pinned. */
    anchor: Point;
    /** Padding between the scroll origin and the board layer, unzoomed. */
    padding: Point;
  } | null>(null);
  // Written by pinch, read once the zoom has repainted: setting scroll in the
  // same tick would use the old, pre-zoom scroll extents and get clamped.
  const pendingScrollRef = useRef<Point | null>(null);
  const zoomRef = useRef(canvasZoom);
  zoomRef.current = canvasZoom;

  /**
   * How much room the boards need, in board-layer pixels (the same units
   * `artboard.position` uses, i.e. already at the 0.3 display scale).
   *
   * This is what makes the canvas scrollable at all. The layer is scaled with a
   * CSS transform, and a transform does not change a layout box, so the scroll
   * extents have to be stated outright; without them the viewport's scrollWidth
   * equalled its clientWidth and nothing to the right of the first screen could
   * be reached by scrolling, panning or a swipe.
   */
  const contentExtent = useMemo(() => {
    let width = 0;
    let height = 0;
    for (const board of artboards) {
      width = Math.max(width, board.position.x + board.size.width * DISPLAY_SCALE_FACTOR);
      height = Math.max(height, board.position.y + board.size.height * DISPLAY_SCALE_FACTOR);
    }
    return {
      // Room on the right/bottom to match the margin the boards start at, plus
      // the board's own furniture: the hover toolbar above it and the name
      // label below it, neither of which is part of its box.
      width: width + BOARD_LAYER_MARGIN,
      height: height + BOARD_LAYER_MARGIN + BOARD_LABEL_ROOM,
    };
  }, [artboards]);


  // Safety net: if real artboards exist but none is selected (e.g. after a
  // drag-add that didn't set selection), select the first. The template/project
  // load paths in the parent already select on load, and with no fake fallback
  // artboard this can no longer select a phantom id.
  useEffect(() => {
    if (!activeArtboardId && externalArtboards.length > 0) {
      setActiveArtboardId(externalArtboards[0].id);
    }
  }, [externalArtboards, activeArtboardId, setActiveArtboardId]);

  // Artboard hands back its whole element array for four different gestures:
  // drag/resize/restyle (a property edit), the palette drop and the imperative
  // addElement (an add), and the delete handle plus deleteElementByIdG (a
  // delete). Only the property edit may be folded back through a language
  // projection, so the two structural cases are diffed out here and travel as a
  // delta to the base document instead.
  const handleUpdateArtboardElements = (artboardId: string, elements: ArtboardElement[]) => {
    const board = artboards.find(ab => ab.id === artboardId);
    if (onUpdateBaseArtboards && board) {
      const before = new Set(board.elements.map(el => el.id));
      const after = new Set(elements.map(el => el.id));
      const added = elements.filter(el => !before.has(el.id));
      const removedIds = board.elements.filter(el => !after.has(el.id)).map(el => el.id);
      if (added.length > 0 || removedIds.length > 0) {
        onUpdateBaseArtboards({ artboardId, added, removedIds });
        return;
      }
    }
    const newArtboards = artboards.map(ab =>
      ab.id === artboardId ? { ...ab, elements } : ab
    );
    onUpdateArtboards(newArtboards);
  };

  const handleUpdateArtboardDetails = (artboardId: string, updatedData: Partial<ArtboardState>) => {
     const newArtboards = artboards.map(ab =>
      ab.id === artboardId ? { ...ab, ...updatedData } : ab
    );
    onUpdateArtboards(newArtboards);
  }
  
  const handleSelectArtboard = (artboardId: string) => {
    setActiveArtboardId(artboardId);
  };

  const handlePointerDownOnContentArea = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool === 'select') {
      // Only deselect if the press is on the direct background of the content
      // area, or on the empty part of the board layer around the boards.
      if (e.target === contentAreaRef.current || e.target === boardLayerRef.current) {
        setActiveArtboardId(null);
        setSelectedElementIdOnActiveArtboard(null);
      }
    }
  };

  // The hand tool is wired to the scroll viewport, not to the content div.
  // The content div is `min-w-full` × 2000px *before* its own `scale(zoom)`,
  // so its box never covers the whole canvas: everything past the first
  // viewport width (i.e. the gaps between artboards once you scroll right) and
  // the strip above the boards fall outside it. Artboards still showed `grab`
  // only because cursor is inherited by descendants, which is why panning
  // appeared to work over a board and nowhere else. The viewport always spans
  // the visible canvas, so grabbing anywhere works.
  useEffect(() => {
    const scrollViewport = scrollViewportRef.current;
    if (!scrollViewport || activeTool !== 'pan') return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // A second finger is a pinch, not a second pan. Let the touch handlers
      // below take it.
      if (pinchRef.current) return;
      // Capture phase: consume the press before an artboard or element can
      // start its own drag/selection with the hand tool active.
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick.current = false;
      setIsPanning(true);
      panStartCoords.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        scrollLeft: scrollViewport.scrollLeft,
        scrollTop: scrollViewport.scrollTop,
      };
    };

    const handleClickCapture = (e: MouseEvent) => {
      if (!suppressNextClick.current) return;
      suppressNextClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    };

    scrollViewport.addEventListener('pointerdown', handlePointerDown, true);
    scrollViewport.addEventListener('click', handleClickCapture, true);
    return () => {
      scrollViewport.removeEventListener('pointerdown', handlePointerDown, true);
      scrollViewport.removeEventListener('click', handleClickCapture, true);
    };
  }, [activeTool]);

  useEffect(() => {
    const scrollViewport = scrollViewportRef.current;
    if (!isPanning) return;

    const handlePointerMove = (e: PointerEvent) => {
        const start = panStartCoords.current;
        if (!start || !scrollViewport) return;
        if (e.pointerId !== start.pointerId) return;
        e.preventDefault(); // Prevent other interactions during pan
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) > PAN_CLICK_SLOP_PX || Math.abs(dy) > PAN_CLICK_SLOP_PX) suppressNextClick.current = true;
        scrollViewport.scrollLeft = start.scrollLeft - dx;
        scrollViewport.scrollTop = start.scrollTop - dy;
    };

    const handlePointerUp = (e: PointerEvent) => {
        if (panStartCoords.current && e.pointerId !== panStartCoords.current.pointerId) return;
        setIsPanning(false);
        panStartCoords.current = null;
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
    return () => {
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isPanning]);

  /**
   * Two fingers on the canvas: pinch to zoom, and drag the pair to pan, both at
   * once and with whatever is under the midpoint staying under it. One finger
   * is left alone so it still scrolls the canvas the way it scrolls any page.
   *
   * Deliberately touch events and not pointer events: cancelling the browser's
   * own pan/zoom needs preventDefault on a non-passive touchmove. Doing it with
   * `touch-action: none` instead would cost the one-finger scroll everywhere on
   * the canvas, which is the gesture people reach for most.
   */
  useEffect(() => {
    const scrollViewport = scrollViewportRef.current;
    if (!scrollViewport || !onZoomChange) return;

    const midpoint = (touches: TouchList): Point => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });
    const spread = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const layer = boardLayerRef.current;
      if (!layer) return;
      const zoom = zoomRef.current;
      const layerRect = layer.getBoundingClientRect();
      const viewportRect = scrollViewport.getBoundingClientRect();
      const renderedScale = layerRect.width / (layer.offsetWidth || 1);
      if (!(renderedScale > 0)) return;
      const mid = midpoint(e.touches);
      pinchRef.current = {
        startDistance: Math.max(1, spread(e.touches)),
        startZoom: zoom,
        anchor: {
          x: (mid.x - layerRect.left) / renderedScale,
          y: (mid.y - layerRect.top) / renderedScale,
        },
        // Whatever sits between the scroll origin and the board layer, measured
        // once and re-applied at the new zoom.
        padding: {
          x: (layerRect.left - viewportRect.left + scrollViewport.scrollLeft) / zoom,
          y: (layerRect.top - viewportRect.top + scrollViewport.scrollTop) / zoom,
        },
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      const pinch = pinchRef.current;
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const mid = midpoint(e.touches);
      const nextZoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, (pinch.startZoom * spread(e.touches)) / pinch.startDistance)
      );
      // Where the anchored canvas point lands at the new zoom, minus where the
      // fingers are now: dragging the pair sideways pans, pinching zooms, and
      // the two compose without fighting each other.
      const viewportRect = scrollViewport.getBoundingClientRect();
      const target = {
        x: (pinch.padding.x + pinch.anchor.x) * nextZoom - (mid.x - viewportRect.left),
        y: (pinch.padding.y + pinch.anchor.y) * nextZoom - (mid.y - viewportRect.top),
      };
      if (nextZoom === zoomRef.current) {
        // Already at a zoom limit, so no re-render is coming to carry the
        // scroll: two fingers still pan, they just cannot zoom any further.
        scrollViewport.scrollLeft = Math.max(0, target.x);
        scrollViewport.scrollTop = Math.max(0, target.y);
        return;
      }
      pendingScrollRef.current = target;
      onZoomChange(nextZoom);
    };

    const endPinch = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current = null;
    };

    scrollViewport.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollViewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    scrollViewport.addEventListener('touchend', endPinch);
    scrollViewport.addEventListener('touchcancel', endPinch);
    return () => {
      scrollViewport.removeEventListener('touchstart', handleTouchStart);
      scrollViewport.removeEventListener('touchmove', handleTouchMove);
      scrollViewport.removeEventListener('touchend', endPinch);
      scrollViewport.removeEventListener('touchcancel', endPinch);
    };
  }, [onZoomChange]);

  // The scroll the pinch asked for, applied after the zoom has been laid out.
  // Setting it inside the touchmove would clamp it against the old extents.
  useEffect(() => {
    const target = pendingScrollRef.current;
    const scrollViewport = scrollViewportRef.current;
    if (!target || !scrollViewport) return;
    pendingScrollRef.current = null;
    scrollViewport.scrollLeft = Math.max(0, target.x);
    scrollViewport.scrollTop = Math.max(0, target.y);
  }, [canvasZoom]);


  const handleDropOnCanvas = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/artboard-element-type') as ElementType;
    const subType = e.dataTransfer.getData('application/artboard-element-subtype') as ShapeType | DeviceType | undefined;
    const rawStyleProps = e.dataTransfer.getData('application/artboard-element-styleprops');
    let styleProps: Record<string, any> | undefined;
    if (rawStyleProps) {
      try { styleProps = JSON.parse(rawStyleProps); } catch { styleProps = undefined; }
    }

    if (activeArtboardId && type) {
        const artboardComponent = artboardRefs.current[activeArtboardId];
        if (artboardComponent && (artboardComponent as any).addElement) {
            const dropPosition = { x: e.clientX, y: e.clientY };
            onAddElementToArtboard(activeArtboardId, type, subType, dropPosition, styleProps);
        } else {
            toast({ title: "Error", description: "Could not add element. Artboard not found or ready.", variant: "destructive"});
        }
    } else if (type) {
        toast({ title: "No Artboard Selected", description: "Please select an artboard to add the element.", variant: "destructive"});
    }
  };

  const handleDragOverCanvas = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); 
  };

  // Handle artboard deletion with confirmation if needed
  const handleDeleteArtboard = (artboardId: string) => {
    const artboard = artboards.find(ab => ab.id === artboardId);
    
    if (!artboard) return;
    
    // Check if the artboard has any elements. `elements` is what THIS language
    // shows, so a board whose every element is hidden in the active language
    // would look empty; its override map is the tell that other languages still
    // have something on it, and deleting the board takes those with it.
    if (artboard.elements.length > 0 || !!artboard.localized) {
      // If it has elements, store the ID and show confirmation dialog
      setArtboardToDelete(artboardId);
      setDeleteDialogOpen(true);
    } else {
      // If no elements, delete immediately without confirmation
      onDeleteArtboardFromToolbar(artboardId);
    }
  };

  // Confirm deletion after dialog
  const confirmDeleteArtboard = () => {
    if (artboardToDelete) {
      onDeleteArtboardFromToolbar(artboardToDelete);
      setArtboardToDelete(null);
      setDeleteDialogOpen(false);
    }
  };
  
  return (
    <ScrollArea
      className="h-full w-full bg-background flex-grow"
      viewportRef={scrollViewportRef}
      // The grab cursor lives on the viewport so it covers the whole canvas,
      // and the descendant rule overrides the per-element inline cursors
      // (pointer/grab/resize) that would otherwise win inside an artboard.
      viewportClassName={cn(
        activeTool === 'pan' && (isPanning
          ? 'cursor-grabbing [&_*]:!cursor-grabbing'
          : 'cursor-grab [&_*]:!cursor-grab'),
        // With the hand tool the pan handler owns the gesture, so the browser
        // must not also scroll the viewport: one finger would move the canvas
        // twice as far as it travelled. In select mode the browser keeps it,
        // which is what makes a one-finger swipe scroll the canvas.
        activeTool === 'pan' && 'touch-none'
      )}
      // 100% of the canvas column, not 100vh: on a phone the viewport unit
      // counts the browser chrome, so a vh-sized canvas hangs its last inch
      // under the address bar and the floating tool pills go with it.
      style={{ height: "100%", overflowY: "auto" }}
    >
      <div
        ref={contentAreaRef}
        className="relative"
        data-canvas-locale={activeLocale ?? ''}
        style={{
          // The scrollable box. Stated in pixels rather than left to the
          // content, because the layer below is sized by a CSS transform and a
          // transform contributes nothing to a scroll extent: without this the
          // canvas could not scroll sideways at all, so boards past the first
          // screen were unreachable at any zoom.
          width: `${contentExtent.width * canvasZoom}px`,
          height: `${contentExtent.height * canvasZoom}px`,
          minWidth: '100%',
          minHeight: '100%',
          // Cursor is owned by the scroll viewport (see viewportClassName) so
          // the hand tool covers the canvas, not just this box.
          cursor: activeTool === 'select' ? 'default' : undefined,
        }}
        onPointerDown={handlePointerDownOnContentArea}
        onDrop={handleDropOnCanvas}
        onDragOver={handleDragOverCanvas}
      >
        <div
          ref={boardLayerRef}
          style={{
            transform: `scale(${canvasZoom})`,
            transformOrigin: 'top left',
            position: 'relative',
            width: `${contentExtent.width}px`,
            height: `${contentExtent.height}px`,
          }}
        >
          {/* While the project is still loading, show artboard-shaped skeletons
              instead of a placeholder artboard. This is the stable state the
              refresh/?projectId path used to fill with the fake "My First
              Artboard" card. */}
          {isLoading && artboards.length === 0 && (
            <div
              className="flex gap-4 p-2"
              role="status"
              aria-label="Loading project"
              data-export-exclude
            >
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-3">
                  <Skeleton className="h-[560px] w-[270px] rounded-[2rem]" />
                  <Skeleton className="h-4 w-24 rounded" />
                </div>
              ))}
            </div>
          )}

          {artboards.map((artboard, index) => (
            // Keyed by language as well as id: Artboard and TextElement both
            // mirror their props into local state, and an inline edit left open
            // across a language switch would blur its old text into the new
            // language. A switch is a deliberate, rare gesture, so paying a
            // remount (3D devices dispose and re-create their context, see
            // Device3DRenderer) buys a guaranteed clean slate.
            <div
              key={`${artboard.id}:${activeLocale ?? ''}`}
              style={{
                position: 'absolute',
                left: `${artboard.position.x}px`,
                top: `${artboard.position.y}px`,
                pointerEvents: activeTool === 'pan' && isPanning ? 'none' : 'auto',
              }}
            >
              <Artboard
                ref={el => { artboardRefs.current[artboard.id] = el; }}
                artboard={artboard}
                isSelected={activeArtboardId === artboard.id}
                onUpdateArtboardElements={(elements) => handleUpdateArtboardElements(artboard.id, elements)}
                onUpdateArtboardDetails={(details) => handleUpdateArtboardDetails(artboard.id, details)}
                onSelectArtboard={() => handleSelectArtboard(artboard.id)}
                globalZoom={canvasZoom}
                selectedElementId={activeArtboardId === artboard.id ? selectedElementIdOnActiveArtboard : null}
                setSelectedElementId={(elementId) => {
                  // Always set the active artboard when selecting an element
                  if (elementId && activeArtboardId !== artboard.id) {
                    setActiveArtboardId(artboard.id);
                  }
                  setSelectedElementIdOnActiveArtboard(elementId);
                }}
                onAddNewArtboard={() => onAddNewArtboardFromToolbar(artboard.id)}
                onDuplicateArtboard={onDuplicateArtboardFromToolbar}
                onDeleteArtboard={handleDeleteArtboard}
                onMoveArtboard={onMoveArtboardFromToolbar}
                onTranslateArtboard={onTranslateArtboard}
                onExportArtboard={onExportArtboard}
                canDeleteArtboard={artboards.length > 1}
                canMoveArtboardLeft={index > 0}
                canMoveArtboardRight={index < artboards.length - 1}
              />
            </div>
          ))}
          
          {/* Artboard Delete Confirmation Dialog */}
          {artboardToDelete && (
            <DeleteArtboardDialog
              isOpen={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
              onConfirmDelete={confirmDeleteArtboard}
              artboardName={artboards.find(ab => ab.id === artboardToDelete)?.name || 'Untitled Artboard'}
              elementCount={artboards.find(ab => ab.id === artboardToDelete)?.elements.length || 0}
            />
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

