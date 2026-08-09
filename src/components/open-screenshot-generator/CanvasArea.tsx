"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Artboard } from './Artboard';
import type { ArtboardState, Point, ElementType, ShapeType, DeviceType, ArtboardElement } from '@/types/artboard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
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
  const { toast } = useToast();

  // State for artboard deletion confirmation
  const [artboardToDelete, setArtboardToDelete] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [isPanning, setIsPanning] = useState(false);
  const panStartCoords = useRef<{ x: number, y: number, scrollLeft: number, scrollTop: number } | null>(null);
  // Set when a pan actually moved the canvas, so the release doesn't fire a
  // click on whatever happens to sit under the cursor (artboard toolbar
  // buttons, elements) after the drag.
  const suppressNextClick = useRef(false);


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
    if (activeTool === 'select') {
      // Only deselect if the click is on the direct background of the content area
      if (e.target === contentAreaRef.current) {
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

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Capture phase: consume the press before an artboard or element can
      // start its own drag/selection with the hand tool active.
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick.current = false;
      setIsPanning(true);
      panStartCoords.current = {
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

    scrollViewport.addEventListener('mousedown', handleMouseDown, true);
    scrollViewport.addEventListener('click', handleClickCapture, true);
    return () => {
      scrollViewport.removeEventListener('mousedown', handleMouseDown, true);
      scrollViewport.removeEventListener('click', handleClickCapture, true);
    };
  }, [activeTool]);

  useEffect(() => {
    const scrollViewport = scrollViewportRef.current;
    if (!isPanning) return;

    const handleMouseMove = (e: MouseEvent) => {
        if (!panStartCoords.current || !scrollViewport) return;
        e.preventDefault(); // Prevent other interactions during pan
        const dx = e.clientX - panStartCoords.current.x;
        const dy = e.clientY - panStartCoords.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) suppressNextClick.current = true;
        scrollViewport.scrollLeft = panStartCoords.current.scrollLeft - dx;
        scrollViewport.scrollTop = panStartCoords.current.scrollTop - dy;
    };

    const handleMouseUp = () => {
        setIsPanning(false);
        panStartCoords.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning]);


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
      // The grab cursor lives on the viewport so it covers the whole canvas,
      // and the descendant rule overrides the per-element inline cursors
      // (pointer/grab/resize) that would otherwise win inside an artboard.
      viewportClassName={cn(
        activeTool === 'pan' && (isPanning
          ? 'cursor-grabbing [&_*]:!cursor-grabbing'
          : 'cursor-grab [&_*]:!cursor-grab')
      )}
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
          // Cursor is owned by the scroll viewport (see viewportClassName) so
          // the hand tool covers the canvas, not just this box.
          cursor: activeTool === 'select' ? 'default' : undefined,
          padding: '40px 12px 12px 12px',
        }}
        onMouseDown={handleMouseDownOnContentArea}
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

