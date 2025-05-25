
"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Artboard } from './Artboard';
import type { ArtboardState, Point, ElementType, ShapeType, DeviceType, ArtboardElement } from '@/types/artboard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';

interface CanvasAreaProps {
  artboards: ArtboardState[];
  onUpdateArtboards: (artboards: ArtboardState[]) => void;
  onAddElementToArtboard: (artboardId: string, type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point) => void;
  activeArtboardId: string | null;
  setActiveArtboardId: (id: string | null) => void;
  selectedElementIdOnActiveArtboard: string | null;
  setSelectedElementIdOnActiveArtboard: (elementId: string | null) => void;
  canvasZoom: number;
  artboardRefs: React.MutableRefObject<Record<string, any>>;
  // Props for ArtboardToolbar actions
  onAddNewArtboardFromToolbar: (currentArtboardId: string) => void;
  onDuplicateArtboardFromToolbar: (artboardId: string) => void;
  onDeleteArtboardFromToolbar: (artboardId: string) => void;
  onMoveArtboardFromToolbar: (artboardId: string, direction: 'left' | 'right') => void;
}

const initialArtboardState: ArtboardState = {
  id: 'artboard_default_1',
  name: 'My First Artboard',
  position: { x: 50, y: 50 }, 
  size: { width: 1024, height: 768 },
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
}: CanvasAreaProps) {
  const [artboards, setArtboards] = useState<ArtboardState[]>(externalArtboards.length > 0 ? externalArtboards : [initialArtboardState]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    setArtboards(externalArtboards.length > 0 ? externalArtboards : [initialArtboardState]);
  }, [externalArtboards]);

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

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === canvasRef.current) {
      setActiveArtboardId(null);
      setSelectedElementIdOnActiveArtboard(null);
    }
  };

  const handleDropOnCanvas = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/artboard-element-type') as ElementType;
    const subType = e.dataTransfer.getData('application/artboard-element-subtype') as ShapeType | DeviceType | undefined;
    
    if (activeArtboardId && type) {
        const artboardComponent = artboardRefs.current[activeArtboardId];
        if (artboardComponent && (artboardComponent as any).addElement) {
            const dropPosition = { x: e.clientX, y: e.clientY };
            onAddElementToArtboard(activeArtboardId, type, subType, dropPosition);
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

  return (
    <ScrollArea className="h-full w-full bg-background flex-grow" viewportRef={canvasRef}>
      <div
        ref={canvasRef}
        className="relative w-max min-w-full min-h-full p-12" 
        style={{ 
          transform: `scale(${canvasZoom})`, 
          transformOrigin: 'top left',
        }}
        onClick={handleCanvasClick}
        onDrop={handleDropOnCanvas}
        onDragOver={handleDragOverCanvas}
      >
        {artboards.map((artboard, index) => (
          <div
            key={artboard.id}
            style={{
              position: 'absolute', 
              left: `${artboard.position.x}px`,
              top: `${artboard.position.y}px`,
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
              setSelectedElementId={setSelectedElementIdOnActiveArtboard}
              // Toolbar props
              onAddNewArtboard={() => onAddNewArtboardFromToolbar(artboard.id)}
              onDuplicateArtboard={onDuplicateArtboardFromToolbar}
              onDeleteArtboard={onDeleteArtboardFromToolbar}
              onMoveArtboard={onMoveArtboardFromToolbar}
              canDeleteArtboard={artboards.length > 1}
              canMoveArtboardLeft={index > 0}
              canMoveArtboardRight={index < artboards.length - 1}
            />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
