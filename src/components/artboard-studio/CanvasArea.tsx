"use client";
import type React from 'react';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Artboard } from './Artboard';
import type { ArtboardState, Point, ElementType, ShapeType, DeviceType, ArtboardElement } from '@/types/artboard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { DeleteArtboardDialog } from './DeleteArtboardDialog'; // Import the new dialog component

interface CanvasAreaProps {
  artboards: ArtboardState[];
  onUpdateArtboards: (artboards: ArtboardState[]) => void;
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
  activeTool: 'select' | 'pan';
  // While a project/template is still loading (Dexie read + artboard build),
  // the parent sets this so the canvas shows a stable skeleton instead of a
  // fake placeholder artboard. Artboard positioning is owned by the parent
  // (calculateArtboardPositions in ArtboardStudioLayout), not here.
  isLoading?: boolean;
  // Lets pinch (touch) and ctrl+wheel (trackpad) zoom the canvas; the parent
  // owns the zoom state and clamps it to the same range as the zoom buttons.
  onCanvasZoomChange?: (zoom: number) => void;
}

const MIN_CANVAS_ZOOM = 0.1;
const MAX_CANVAS_ZOOM = 4;
// The canvas applies `scale(canvasZoom)` on two nested divs, so the scale
// actually painted is zoom squared; scroll anchoring must use that value.
const effectiveScale = (zoom: number) => zoom * zoom;

export function CanvasArea({
    artboards: externalArtboards, 
    onUpdateArtboards,
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
    activeTool,
    isLoading = false,
    onCanvasZoomChange,
}: CanvasAreaProps) {
  // The parent is the single source of truth for artboards. We render the prop
  // directly (no private mirror copy) so a newly loaded template paints on the
  // same commit it arrives — the old double-buffer painted the previous/empty
  // state for one frame first, which is what produced the "blank artboard then
  // real template" flash.
  const artboards = externalArtboards;
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // State for artboard deletion confirmation
  const [artboardToDelete, setArtboardToDelete] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [isPanning, setIsPanning] = useState(false);
  const panStartCoords = useRef<{ x: number, y: number, scrollLeft: number, scrollTop: number } | null>(null);
  const panPointerIdRef = useRef<number | null>(null);
  // A background touch may be a scroll, not a tap; deselect happens on
  // pointerup only if the finger barely moved.
  const bgTouchRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  // Zoom gesture plumbing. Refs mirror the latest props so the touch/wheel
  // listeners (attached once, non-passive) never read stale values.
  const canvasZoomRef = useRef(canvasZoom);
  canvasZoomRef.current = canvasZoom;
  const onZoomChangeRef = useRef(onCanvasZoomChange);
  onZoomChangeRef.current = onCanvasZoomChange;
  // Scroll offsets that keep the gesture's anchor point fixed, applied on the
  // commit where the new scale actually paints (see the layout effect below).
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    startScrollLeft: number;
    startScrollTop: number;
    startMidX: number;
    startMidY: number;
  } | null>(null);


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

  const handlePointerDownOnContentArea = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool === 'pan') {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (pinchRef.current) return; // two fingers are a zoom, not a pan
      // If pan tool is active, initiate panning regardless of the exact target within contentArea,
      // as long as the scroll viewport exists.
      if (scrollViewportRef.current) {
        e.preventDefault(); // Prevent default actions like text selection or artboard interaction
        panPointerIdRef.current = e.pointerId;
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
      // Only deselect if the press is on the direct background of the content
      // area. A mouse press deselects immediately (original behavior); a touch
      // waits for pointerup because the finger may be starting a scroll.
      if (e.target === contentAreaRef.current) {
        if (e.pointerType === 'mouse') {
          setActiveArtboardId(null);
          setSelectedElementIdOnActiveArtboard(null);
        } else {
          bgTouchRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
        }
      }
    }
  };

  const handlePointerUpOnContentArea = (e: React.PointerEvent<HTMLDivElement>) => {
    const bgTouch = bgTouchRef.current;
    if (!bgTouch || e.pointerId !== bgTouch.pointerId) return;
    bgTouchRef.current = null;
    // Still on the background and barely moved: that was a deselect tap
    if (
      e.target === contentAreaRef.current &&
      Math.hypot(e.clientX - bgTouch.x, e.clientY - bgTouch.y) < 10
    ) {
      setActiveArtboardId(null);
      setSelectedElementIdOnActiveArtboard(null);
    }
  };

  useEffect(() => {
    const scrollViewport = scrollViewportRef.current;
    const contentArea = contentAreaRef.current;

    const stopPanning = () => {
        setIsPanning(false);
        panPointerIdRef.current = null;
        if (contentArea) {
            contentArea.style.cursor = activeTool === 'pan' ? 'grab' : 'default';
        }
        panStartCoords.current = null;
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!isPanning || !panStartCoords.current || !scrollViewport) return;
        if (panPointerIdRef.current !== null && e.pointerId !== panPointerIdRef.current) return;
        if (pinchRef.current) { stopPanning(); return; } // second finger joined: zoom wins
        e.preventDefault(); // Prevent other interactions during pan
        const dx = e.clientX - panStartCoords.current.x;
        const dy = e.clientY - panStartCoords.current.y;
        scrollViewport.scrollLeft = panStartCoords.current.scrollLeft - dx;
        scrollViewport.scrollTop = panStartCoords.current.scrollTop - dy;
    };

    const handlePointerUp = (e: PointerEvent) => {
        if (!isPanning) return;
        if (panPointerIdRef.current !== null && e.pointerId !== panPointerIdRef.current) return;
        stopPanning();
    };

    if (isPanning) {
        document.addEventListener('pointermove', handlePointerMove);
        document.addEventListener('pointerup', handlePointerUp);
        document.addEventListener('pointercancel', handlePointerUp);
        return () => {
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
            document.removeEventListener('pointercancel', handlePointerUp);
        };
    }
  }, [isPanning, activeTool]);

  // Pinch to zoom (two fingers) and trackpad ctrl+wheel zoom, both anchored at
  // the gesture midpoint / cursor. Attached natively because touchmove/wheel
  // must be non-passive to call preventDefault.
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const clampZoom = (z: number) => Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, z));
    const touchDist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const midpoint = (a: Touch, b: Touch) => {
      const rect = viewport.getBoundingClientRect();
      return {
        x: (a.clientX + b.clientX) / 2 - rect.left,
        y: (a.clientY + b.clientY) / 2 - rect.top,
      };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const mid = midpoint(a, b);
      pinchRef.current = {
        startDist: Math.max(touchDist(a, b), 1),
        startZoom: canvasZoomRef.current,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
        startMidX: mid.x,
        startMidY: mid.y,
      };
      // Signals a live element drag (DraggableElement) to abort cleanly
      document.documentElement.setAttribute('data-abs-pinch', '');
    };

    const handleTouchMove = (e: TouchEvent) => {
      const pinch = pinchRef.current;
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const mid = midpoint(a, b);
      // Painted scale is zoom², so finger spread maps to zoom via square root
      const targetZoom = clampZoom(pinch.startZoom * Math.sqrt(touchDist(a, b) / pinch.startDist));
      const k = effectiveScale(targetZoom) / effectiveScale(pinch.startZoom);
      const left = (pinch.startScrollLeft + pinch.startMidX) * k - mid.x;
      const top = (pinch.startScrollTop + pinch.startMidY) * k - mid.y;
      if (targetZoom !== canvasZoomRef.current && onZoomChangeRef.current) {
        pendingScrollRef.current = { left, top };
        onZoomChangeRef.current(targetZoom);
      } else {
        // Pure two-finger pan (or zoom already clamped): scroll directly
        viewport.scrollLeft = left;
        viewport.scrollTop = top;
      }
    };

    const endPinch = (e: TouchEvent) => {
      if (pinchRef.current && e.touches.length < 2) {
        pinchRef.current = null;
        document.documentElement.removeAttribute('data-abs-pinch');
      }
    };

    const handleWheel = (e: WheelEvent) => {
      // Trackpad pinches arrive as ctrl+wheel; plain wheel keeps scrolling
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (!onZoomChangeRef.current) return;
      const rect = viewport.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;
      const startZoom = canvasZoomRef.current;
      const targetZoom = clampZoom(startZoom * Math.exp(-e.deltaY * 0.0015));
      if (targetZoom === startZoom) return;
      const k = effectiveScale(targetZoom) / effectiveScale(startZoom);
      pendingScrollRef.current = {
        left: (viewport.scrollLeft + vx) * k - vx,
        top: (viewport.scrollTop + vy) * k - vy,
      };
      onZoomChangeRef.current(targetZoom);
    };

    // iOS Safari's proprietary gesture events would zoom the page itself
    const blockGesture = (e: Event) => e.preventDefault();

    viewport.addEventListener('touchstart', handleTouchStart, { passive: false });
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    viewport.addEventListener('touchend', endPinch);
    viewport.addEventListener('touchcancel', endPinch);
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    viewport.addEventListener('gesturestart', blockGesture);
    viewport.addEventListener('gesturechange', blockGesture);
    return () => {
      viewport.removeEventListener('touchstart', handleTouchStart);
      viewport.removeEventListener('touchmove', handleTouchMove);
      viewport.removeEventListener('touchend', endPinch);
      viewport.removeEventListener('touchcancel', endPinch);
      viewport.removeEventListener('wheel', handleWheel);
      viewport.removeEventListener('gesturestart', blockGesture);
      viewport.removeEventListener('gesturechange', blockGesture);
      document.documentElement.removeAttribute('data-abs-pinch');
    };
  }, []);

  // Apply the scroll offsets computed for a zoom gesture on the same commit
  // the new scale paints, so the anchor point never visibly jumps.
  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current;
    const pending = pendingScrollRef.current;
    if (viewport && pending) {
      viewport.scrollLeft = pending.left;
      viewport.scrollTop = pending.top;
      pendingScrollRef.current = null;
    }
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
    <ScrollArea
      className="h-full w-full bg-background flex-grow"
      viewportRef={scrollViewportRef}
      style={{ height: "100%", overflowY: "auto" }}
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
          // One finger on the background scrolls natively in select mode;
          // the pan tool drives scrolling itself. Pinch is always custom.
          touchAction: activeTool === 'pan' ? 'none' : 'pan-x pan-y',
        }}
        onPointerDown={handlePointerDownOnContentArea}
        onPointerUp={handlePointerUpOnContentArea}
        onDrop={handleDropOnCanvas}
        onDragOver={handleDragOverCanvas}
      >
        <div
          style={{
            transform: `scale(${canvasZoom})`,
            transformOrigin: 'top left',
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

