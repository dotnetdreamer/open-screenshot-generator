
"use client";
import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Artboard } from './Artboard';
import type { ArtboardState, Point, ElementType, ShapeType, DeviceType } from '@/types/artboard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';

interface CanvasAreaProps {
  artboards: ArtboardState[];
  onUpdateArtboards: (artboards: ArtboardState[]) => void;
  onAddElementToArtboard: (artboardId: string, type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point) => void;
  activeArtboardId: string | null;
  setActiveArtboardId: (id: string | null) => void;
  canvasZoom: number;
}

const initialArtboardState: ArtboardState = {
  id: 'artboard_default_1',
  name: 'My First Artboard',
  position: { x: 50, y: 50 }, // Position on the canvas if canvas is pannable
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
    },
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
    }
  ],
  backgroundColor: 'hsl(var(--card))', // White background for artboard
  zoom: 1, // Initial zoom level for the artboard content itself
};

export function CanvasArea({ 
    artboards: externalArtboards, 
    onUpdateArtboards,
    onAddElementToArtboard,
    activeArtboardId,
    setActiveArtboardId,
    canvasZoom // This is the zoom for the entire canvas viewport
}: CanvasAreaProps) {
  const [artboards, setArtboards] = useState<ArtboardState[]>(externalArtboards.length > 0 ? externalArtboards : [initialArtboardState]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const artboardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { toast } = useToast();

  useEffect(() => {
    setArtboards(externalArtboards.length > 0 ? externalArtboards : [initialArtboardState]);
  }, [externalArtboards]);

  const handleUpdateArtboard = (artboardId: string, updatedData: Partial<ArtboardState>) => {
    const newArtboards = artboards.map(ab =>
      ab.id === artboardId ? { ...ab, ...updatedData } : ab
    );
    setArtboards(newArtboards);
    onUpdateArtboards(newArtboards); // Propagate change upwards
  };
  
  const handleSelectArtboard = (artboardId: string) => {
    setActiveArtboardId(artboardId);
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Deselect artboard if clicking on canvas background
    if (e.target === canvasRef.current) {
      setActiveArtboardId(null);
    }
  };

  const handleDropOnCanvas = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/artboard-element-type') as ElementType;
    const subType = e.dataTransfer.getData('application/artboard-element-subtype') as ShapeType | DeviceType | undefined;
    
    if (activeArtboardId && type) {
        const artboardDiv = artboardRefs.current[activeArtboardId];
        if (artboardDiv && (artboardDiv as any).addElement) {
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
    e.preventDefault(); // Necessary to allow drop
  };


  // Center the first artboard (or active one) approximately.
  // This is a simplified centering. True panning/infinite canvas is more complex.
  const canvasPadding = 50; // Padding around artboards

  return (
    <ScrollArea className="h-full w-full bg-background flex-grow" viewportRef={canvasRef}>
      <div
        ref={canvasRef}
        className="relative w-max min-w-full min-h-full p-12" // p-12 for padding around artboards
        style={{ 
          transform: `scale(${canvasZoom})`, 
          transformOrigin: 'top left',
          // Ensure there's enough space for artboards
        }}
        onClick={handleCanvasClick}
        onDrop={handleDropOnCanvas}
        onDragOver={handleDragOverCanvas}
      >
        {artboards.map((artboard) => (
          <div
            key={artboard.id}
            style={{
              position: 'absolute', // Artboards are positioned absolutely on the canvas
              left: `${artboard.position.x}px`,
              top: `${artboard.position.y}px`,
              // Adding some margin around artboards if multiple are displayed
              // marginBottom: '20px', 
              // marginRight: '20px',
            }}
            // This outer div could handle artboard dragging on the canvas in the future
            // For now, artboards are statically positioned based on artboard.position
          >
            <Artboard
              ref={el => artboardRefs.current[artboard.id] = el}
              artboard={artboard}
              isSelected={activeArtboardId === artboard.id}
              onUpdateArtboard={(updatedData) => handleUpdateArtboard(artboard.id, updatedData)}
              onSelectArtboard={() => handleSelectArtboard(artboard.id)}
              globalZoom={canvasZoom} // Pass down the main canvas zoom
            />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
