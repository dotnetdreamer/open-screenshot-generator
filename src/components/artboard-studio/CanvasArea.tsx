"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Artboard } from './Artboard';
import type { ArtboardState, Point, ElementType, ShapeType, DeviceType, ArtboardElement } from '@/types/artboard';
import { ScrollArea } from '@/components/ui/scroll-area';
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
}

const initialArtboardState: ArtboardState = {
  id: 'artboard_default_1',
  name: 'My First Artboard',
  position: { x: 50, y: 50 }, 
  size: { width: 1290, height: 2796 }, // Updated size
  elements: [
    {
      id: 'el_intro_text',
      type: 'text',
      content: 'Welcome to Artboard Studio!',
      position: { x: 50, y: 50 },
      size: { width: 300, height: 50 },
      fontSize: 24,
      color: '#333333',
      fontFamily: 'Arial',
      rotation: 0,
      scale: 1,
    } as ArtboardElement,
    {
      id: 'el_intro_shape',
      type: 'shape',
      shapeType: 'rectangle',
      position: { x: 100, y: 150 },
      size: { width: 100, height: 80 },
      fillColor: 'hsl(var(--primary))',
      strokeColor: 'hsl(var(--foreground))',
      strokeWidth: 2,
      rotation: 0,
      scale: 1,
    } as ArtboardElement
  ],
  backgroundColor: 'hsl(var(--card))', 
  zoom: 1, 
};

// Reduce the margin between artboards
const ARTBOARD_MARGIN = 15; // Reduced from 30
const DISPLAY_SCALE_FACTOR = 0.3; // Keep the same scale factor

// Update the calculateArtboardPositions function to maintain closer spacing
function calculateArtboardPositions(artboards: ArtboardState[]): ArtboardState[] {
  let currentX = ARTBOARD_MARGIN;
  return artboards.map(ab => {
    const newPosition = { x: currentX, y: ARTBOARD_MARGIN };
    
    // Calculate the next position with reduced margin
    currentX += (ab.size.width * DISPLAY_SCALE_FACTOR) + ARTBOARD_MARGIN;
    
    return { ...ab, position: newPosition };
  });
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
    activeTool,
}: CanvasAreaProps) {
  const [artboards, setArtboards] = useState<ArtboardState[]>(externalArtboards.length > 0 ? externalArtboards : [initialArtboardState]);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // State for artboard deletion confirmation
  const [artboardToDelete, setArtboardToDelete] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [isPanning, setIsPanning] = useState(false);
  const panStartCoords = useRef<{ x: number, y: number, scrollLeft: number, scrollTop: number } | null>(null);


  useEffect(() => {
    // Make sure we're always using the latest external artboards (including size and position changes)
    const updatedArtboards = externalArtboards.length > 0 ? externalArtboards : [initialArtboardState];
    setArtboards(updatedArtboards);
    
    // If no artboard is currently active and we have artboards, select the first one
    if (!activeArtboardId && updatedArtboards.length > 0) {
      setActiveArtboardId(updatedArtboards[0].id);
    }
  }, [externalArtboards, activeArtboardId, setActiveArtboardId]);

  const handleUpdateArtboardElements = (artboardId: string, elements: ArtboardElement[]) => {
    const newArtboards = artboards.map(ab =>
      ab.id === artboardId ? { ...ab, elements } : ab
    );
    setArtboards(newArtboards);
    onUpdateArtboards(newArtboards); 
  };

  const handleUpdateArtboardDetails = (artboardId: string, updatedData: Partial<ArtboardState>) => {
     const newArtboards = artboards.map(ab =>
      ab.id === artboardId ? { ...ab, ...updatedData } : ab
    );
    setArtboards(newArtboards);
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
      // Only deselect if the click is on the direct background of the content area
      if (e.target === contentAreaRef.current) { 
        setActiveArtboardId(null);
        setSelectedElementIdOnActiveArtboard(null);
      }
    }
  };

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
        <div
          style={{
            transform: `scale(${canvasZoom})`,
            transformOrigin: 'top left',
            width: "100%",
            height: "100%",
          }}
        >
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
                ref={el => artboardRefs.current[artboard.id] = el}
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

