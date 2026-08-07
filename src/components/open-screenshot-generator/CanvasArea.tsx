"use client";
import type React from 'react';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Artboard } from './Artboard';
import type { ArtboardState, Point, ElementType, ShapeType, DeviceType, ArtboardElement } from '@/types/artboard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { DeleteArtboardDialog } from './DeleteArtboardDialog'; // Import the new dialog component
import { elementBounds } from '@/lib/elementAlignment';

interface CanvasAreaProps {
  artboards: ArtboardState[];
  onUpdateArtboards: (artboards: ArtboardState[]) => void;
  onAddElementToArtboard: (artboardId: string, type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point, styleProps?: Record<string, any>) => void;
  activeArtboardId: string | null;
  setActiveArtboardId: (id: string | null) => void;
  selectedElementIdsOnActiveArtboard: string[];
  setSelectedElementIdOnActiveArtboard: (elementId: string | null, modifiers?: { additive?: boolean }) => void;
  // Bulk replace, used by the marquee (rubber-band) selection.
  setSelectedElementIdsOnActiveArtboard: (elementIds: string[]) => void;
  canvasZoom: number;
  // Wheel-zoom updates flow back to the parent so the zoom pill stays in sync.
  onCanvasZoomChange: (zoom: number) => void;
  artboardRefs: React.MutableRefObject<Record<string, any>>;
  onAddNewArtboardFromToolbar: (currentArtboardId: string) => void;
  onDuplicateArtboardFromToolbar: (artboardId: string) => void;
  onDeleteArtboardFromToolbar: (artboardId: string) => void;
  onMoveArtboardFromToolbar: (artboardId: string, direction: 'left' | 'right') => void;
  onTranslateArtboard?: (artboardId: string) => void;
  onExportArtboard?: (artboardId: string) => void;
  activeTool: 'select' | 'pan';
  // While a project/template is still loading (Dexie read + artboard build),
  // the parent sets this so the canvas shows a stable skeleton instead of a
  // fake placeholder artboard. Artboard positioning is owned by the parent
  // (calculateArtboardPositions in OpenScreenshotGeneratorLayout), not here.
  isLoading?: boolean;
}

export function CanvasArea({
    artboards: externalArtboards, 
    onUpdateArtboards,
    onAddElementToArtboard,
    activeArtboardId,
    setActiveArtboardId,
    selectedElementIdsOnActiveArtboard,
    setSelectedElementIdOnActiveArtboard,
    setSelectedElementIdsOnActiveArtboard,
    canvasZoom,
    onCanvasZoomChange,
    artboardRefs,
    onAddNewArtboardFromToolbar,
    onDuplicateArtboardFromToolbar,
    onDeleteArtboardFromToolbar,
    onMoveArtboardFromToolbar,
    onTranslateArtboard,
    onExportArtboard,
    activeTool,
    isLoading = false,
}: CanvasAreaProps) {
  // The parent is the single source of truth for artboards. We render the prop
  // directly (no private mirror copy) so a newly loaded template paints on the
  // same commit it arrives — the old double-buffer painted the previous/empty
  // state for one frame first, which is what produced the "blank artboard then
  // real template" flash.
  const artboards = externalArtboards;
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const contentInnerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // State for artboard deletion confirmation
  const [artboardToDelete, setArtboardToDelete] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [isPanning, setIsPanning] = useState(false);
  const panStartCoords = useRef<{ x: number, y: number, scrollLeft: number, scrollTop: number } | null>(null);

  // Marquee (rubber-band) selection. The rectangle is painted by mutating the
  // overlay div's style directly during mousemove, so a drag does not
  // re-render the artboard subtree sixty times a second.
  const [marqueeActive, setMarqueeActive] = useState(false);
  const marqueeDivRef = useRef<HTMLDivElement>(null);
  const marqueeStartRef = useRef<{
    startX: number;
    startY: number;
    scopeArtboardId: string | null;
    clickedArtboardId: string | null;
    additive: boolean;
  } | null>(null);

  // Latest-values mirror for the marquee/wheel handlers, which register
  // document listeners that must not capture stale state.
  const latestRef = useRef({ artboards, activeArtboardId, selectedElementIdsOnActiveArtboard });
  latestRef.current = { artboards, activeArtboardId, selectedElementIdsOnActiveArtboard };

  // Mouse-wheel zoom, anchored at the cursor. Non-passive so preventDefault
  // can stop the page scroll while zooming. Pans (Shift/Alt, horizontal
  // trackpad deltas) keep the native scroll behavior; only zoom gestures are
  // intercepted. Pinch-to-zoom arrives as ctrlKey+wheel and zooms too.
  const canvasZoomRef = useRef(canvasZoom);
  canvasZoomRef.current = canvasZoom;
  const zoomAnchorRef = useRef<{ contentX: number; contentY: number; relX: number; relY: number } | null>(null);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const handleWheel = (e: WheelEvent) => {
      const isPan = e.shiftKey || e.altKey || (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY));
      if (isPan) return;
      e.preventDefault();
      const oldZoom = canvasZoomRef.current;
      const nextZoom = Math.min(4, Math.max(0.1, oldZoom * Math.exp(-e.deltaY * 0.002)));
      if (nextZoom === oldZoom) return;
      const rect = viewport.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      // Content point under the cursor, in unscaled content coordinates. The
      // layout effect below re-anchors it after the zoom render lands.
      zoomAnchorRef.current = {
        contentX: (relX + viewport.scrollLeft) / oldZoom,
        contentY: (relY + viewport.scrollTop) / oldZoom,
        relX,
        relY,
      };
      onCanvasZoomChange(nextZoom);
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [onCanvasZoomChange]);

  // Keep the cursor-anchored content point fixed across a wheel zoom by
  // adjusting the scroll offsets once the new transform is committed.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const viewport = scrollViewportRef.current;
    if (!anchor || !viewport) return;
    zoomAnchorRef.current = null;
    viewport.scrollLeft = anchor.contentX * canvasZoom - anchor.relX;
    viewport.scrollTop = anchor.contentY * canvasZoom - anchor.relY;
  }, [canvasZoom]);


  // Safety net: if real artboards exist but none is selected (e.g. after a
  // drag-add that didn't set selection), select the first. The template/project
  // load paths in the parent already select on load, and with no fake fallback
  // artboard this can no longer select a phantom id.
  useEffect(() => {
    if (!activeArtboardId && externalArtboards.length > 0) {
      setActiveArtboardId(externalArtboards[0].id);
    }
  }, [externalArtboards, activeArtboardId, setActiveArtboardId]);

  const handleUpdateArtboardElements = (artboardId: string, elements: ArtboardElement[]) => {
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

  const handleMouseDownOnContentArea = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'pan') {
      // If pan tool is active, initiate panning regardless of the exact target within contentArea,
      // as long as the scroll viewport exists.
      if (scrollViewportRef.current) {
        e.preventDefault(); // Prevent default actions like text selection or artboard interaction
        setIsPanning(true);
        panStartCoords.current = {
            x: e.clientX,
            y: e.clientY,
            scrollLeft: scrollViewportRef.current.scrollLeft,
            scrollTop: scrollViewportRef.current.scrollTop,
        };
        if (contentAreaRef.current) contentAreaRef.current.style.cursor = 'grabbing';
      }
    } else if (activeTool === 'select') {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Element mousedowns never reach here (DraggableElement stops
      // propagation); handles and the artboard toolbar are not marquee ground.
      if (target.closest('[data-interaction-handle]') || target.closest('[data-element-id]')) return;
      const artboardNode = target.closest('[data-artboard-dom-id]') as HTMLElement | null;
      const isEmptyCanvas = target === contentAreaRef.current || target === contentInnerRef.current;
      // Clicks on artboard chrome (name label, toolbar) neither deselect nor marquee.
      if (!artboardNode && !isEmptyCanvas) return;

      // preventDefault blocks the native focus transfer, so blur (and commit)
      // any pending panel/canvas text edit explicitly before starting.
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        active.blur();
      }
      e.preventDefault();

      const clickedArtboardId = artboardNode?.getAttribute('data-artboard-dom-id') ?? null;
      if (clickedArtboardId && clickedArtboardId !== latestRef.current.activeArtboardId) {
        setActiveArtboardId(clickedArtboardId);
      }
      marqueeStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        // A drag that began on an artboard tests only that artboard; one that
        // began on empty canvas falls back to the active artboard.
        scopeArtboardId: clickedArtboardId ?? latestRef.current.activeArtboardId,
        clickedArtboardId,
        additive: e.shiftKey || e.ctrlKey || e.metaKey,
      };
      setMarqueeActive(true);
    }
  };

  // Marquee drag tracking + finalization. Registered once per drag; the
  // overlay div is positioned by direct style mutation.
  useEffect(() => {
    if (!marqueeActive) return;
    const start = marqueeStartRef.current;
    const overlay = marqueeDivRef.current;
    if (!start || !overlay) return;

    let currentX = start.startX;
    let currentY = start.startY;
    let dragged = false;

    const paintOverlay = () => {
      overlay.style.left = `${Math.min(start.startX, currentX)}px`;
      overlay.style.top = `${Math.min(start.startY, currentY)}px`;
      overlay.style.width = `${Math.abs(currentX - start.startX)}px`;
      overlay.style.height = `${Math.abs(currentY - start.startY)}px`;
    };
    paintOverlay();

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      currentX = e.clientX;
      currentY = e.clientY;
      if (Math.abs(currentX - start.startX) > 3 || Math.abs(currentY - start.startY) > 3) {
        dragged = true;
      }
      paintOverlay();
    };

    const handleMouseUp = () => {
      setMarqueeActive(false);
      const { artboards: currentArtboards, activeArtboardId: currentActiveId, selectedElementIdsOnActiveArtboard: currentSelection } = latestRef.current;

      if (!dragged) {
        // Plain click on background: clear the element selection, and on
        // empty canvas also drop the active artboard (previous behavior).
        if (!start.additive) {
          setSelectedElementIdsOnActiveArtboard([]);
          if (!start.clickedArtboardId) setActiveArtboardId(null);
        }
        return;
      }

      // The mouseup is followed by a click event on the same background;
      // swallow it once so it cannot clear the selection the marquee just made.
      const swallowClick = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      document.addEventListener('click', swallowClick, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener('click', swallowClick, true), 100);

      const marqueeRect = {
        left: Math.min(start.startX, currentX),
        top: Math.min(start.startY, currentY),
        right: Math.max(start.startX, currentX),
        bottom: Math.max(start.startY, currentY),
      };

      const candidates = start.scopeArtboardId && currentArtboards.some((ab) => ab.id === start.scopeArtboardId)
        ? currentArtboards.filter((ab) => ab.id === start.scopeArtboardId)
        : currentArtboards;

      // Convert the screen-space rectangle into each artboard's coordinate
      // space via its rendered size, then keep the intersecting elements.
      let best: { artboardId: string; ids: string[] } | null = null;
      for (const ab of candidates) {
        const node = contentInnerRef.current?.querySelector(`[data-artboard-dom-id="${ab.id}"]`) as HTMLElement | null;
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const originalWidth = Number(node.getAttribute('data-original-width')) || ab.size.width;
        const scale = rect.width > 0 && originalWidth > 0 ? rect.width / originalWidth : 1;
        const area = {
          left: (marqueeRect.left - rect.left) / scale,
          top: (marqueeRect.top - rect.top) / scale,
          right: (marqueeRect.right - rect.left) / scale,
          bottom: (marqueeRect.bottom - rect.top) / scale,
        };
        const ids = ab.elements
          .filter((el) => {
            const b = elementBounds(el);
            return b.left < area.right && b.right > area.left && b.top < area.bottom && b.bottom > area.top;
          })
          .map((el) => el.id);
        if (ids.length === 0) continue;
        if (start.scopeArtboardId === ab.id) {
          best = { artboardId: ab.id, ids };
          break;
        }
        if (!best || ids.length > best.ids.length) {
          best = { artboardId: ab.id, ids };
        }
      }

      if (best) {
        if (best.artboardId !== currentActiveId) {
          setActiveArtboardId(best.artboardId);
        }
        if (start.additive && best.artboardId === currentActiveId) {
          setSelectedElementIdsOnActiveArtboard([...new Set([...currentSelection, ...best.ids])]);
        } else {
          setSelectedElementIdsOnActiveArtboard(best.ids);
        }
      } else if (!start.additive) {
        setSelectedElementIdsOnActiveArtboard([]);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    // The drag's fixed start data lives in marqueeStartRef; re-running only on
    // activation keeps the listeners stable for the whole gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marqueeActive]);

  useEffect(() => {
    const scrollViewport = scrollViewportRef.current;
    const contentArea = contentAreaRef.current;

    const handleMouseMove = (e: MouseEvent) => {
        if (!isPanning || !panStartCoords.current || !scrollViewport) return;
        e.preventDefault(); // Prevent other interactions during pan
        const dx = e.clientX - panStartCoords.current.x;
        const dy = e.clientY - panStartCoords.current.y;
        scrollViewport.scrollLeft = panStartCoords.current.scrollLeft - dx;
        scrollViewport.scrollTop = panStartCoords.current.scrollTop - dy;
    };

    const handleMouseUp = (e: MouseEvent) => {
        if (!isPanning) return;
        setIsPanning(false);
        if (contentArea) {
            contentArea.style.cursor = activeTool === 'pan' ? 'grab' : 'default';
        }
        panStartCoords.current = null;
    };

    if (isPanning) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }
  }, [isPanning, activeTool]);


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

  const getCursorStyle = () => {
    if (activeTool === 'pan') {
      return isPanning ? 'grabbing' : 'grab';
    }
    return 'default';
  }

  // Handle artboard deletion with confirmation if needed
  const handleDeleteArtboard = (artboardId: string) => {
    const artboard = artboards.find(ab => ab.id === artboardId);
    
    if (!artboard) return;
    
    // Check if the artboard has any elements
    if (artboard.elements.length > 0) {
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
    <>
    <ScrollArea
      className="h-full w-full bg-background flex-grow"
      viewportRef={scrollViewportRef}
      style={{ height: "100vh", overflowY: "auto" }}
    >
      <div
        ref={contentAreaRef}
        className="relative w-max min-w-full"
        style={{
          // Restore a large minHeight to always allow scrolling
          minHeight: "2000px",
          transform: `scale(${canvasZoom})`,
          transformOrigin: 'top left',
          cursor: getCursorStyle(),
          padding: '40px 12px 12px 12px',
        }}
        onMouseDown={handleMouseDownOnContentArea}
        onDrop={handleDropOnCanvas}
        onDragOver={handleDragOverCanvas}
      >
        {/* The canvas zoom lives ONLY on the outer wrapper above. A second
            scale() here used to compound it into canvasZoom², which is what
            made element drags outrun the cursor at any zoom but 100%. */}
        <div
          ref={contentInnerRef}
          style={{
            width: "100%",
            height: "100%",
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
            <div
              key={artboard.id}
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
                selectedElementIds={activeArtboardId === artboard.id ? selectedElementIdsOnActiveArtboard : []}
                setSelectedElementId={(elementId, modifiers) => {
                  // Always set the active artboard when selecting an element
                  if (elementId && activeArtboardId !== artboard.id) {
                    setActiveArtboardId(artboard.id);
                  }
                  setSelectedElementIdOnActiveArtboard(elementId, modifiers);
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

    {/* Marquee selection rectangle. position:fixed in client coordinates, so
        it must live outside the zoomed (transformed) content tree. */}
    {marqueeActive && (
      <div
        ref={marqueeDivRef}
        data-export-exclude
        className="pointer-events-none fixed z-50 border border-primary bg-primary/10"
      />
    )}
    </>
  );
}

