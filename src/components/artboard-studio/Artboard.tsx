
"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { DraggableElement } from './elements/DraggableElement';
import { TextElement } from './elements/TextElement';
import { ShapeElement } from './elements/ShapeElement';
import { DeviceFrameElement } from './elements/DeviceFrameElement';
import type { ArtboardState as ArtboardType, ArtboardElement, Point, ElementType, ShapeType, DeviceType } from '@/types/artboard';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ArtboardProps {
  artboard: ArtboardType;
  isSelected: boolean; // Is this artboard itself selected on a larger canvas (if implemented)
  onUpdateArtboard: (updatedArtboard: Partial<ArtboardType>) => void;
  onSelectArtboard: () => void;
  globalZoom: number; // Zoom level of the main canvas/viewport
}

export function Artboard({ artboard, isSelected, onUpdateArtboard, onSelectArtboard, globalZoom }: ArtboardProps) {
  const [elements, setElements] = useState<ArtboardElement[]>(artboard.elements);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const artboardRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    setElements(artboard.elements);
  }, [artboard.elements]);

  const handleUpdateElement = (updatedElementData: ArtboardElement) => {
    const newElements = elements.map(el =>
      el.id === updatedElementData.id ? { ...el, ...updatedElementData } : el
    );
    setElements(newElements);
    onUpdateArtboard({ elements: newElements });
  };
  
  const partialUpdateElement = (elementId: string, updates: Partial<ArtboardElement>) => {
    const newElements = elements.map(el =>
      el.id === elementId ? { ...el, ...updates } : el
    );
    setElements(newElements);
    onUpdateArtboard({ elements: newElements });
  }

  const handleDeleteElement = (elementId: string) => {
    const newElements = elements.filter(el => el.id !== elementId);
    setElements(newElements);
    onUpdateArtboard({ elements: newElements });
    setSelectedElementId(null);
    toast({ title: "Element deleted", description: `Element ID ${elementId} removed.`, variant: "default" });
  };

  const handleSelectElement = (elementId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent artboard selection when clicking an element
    setSelectedElementId(elementId);
  };

  const handleArtboardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Deselect element if clicking on artboard directly (not on an element)
    if (e.target === artboardRef.current) {
      setSelectedElementId(null);
    }
    onSelectArtboard();
  };

  // Add element function (called from parent, e.g. via drag and drop)
  // This is simplified, a real drag and drop would calculate position based on drop coordinates
  const addElement = (type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point) => {
    const artboardRect = artboardRef.current?.getBoundingClientRect();
    let newElementX = artboard.size.width / 2 - 50; // Default center
    let newElementY = artboard.size.height / 2 - 25;
    
    if (dropPosition && artboardRect) {
      // Convert dropPosition (relative to viewport) to position relative to artboard content
      newElementX = (dropPosition.x - artboardRect.left) / artboard.zoom - 25; // Adjust for element size
      newElementY = (dropPosition.y - artboardRect.top) / artboard.zoom - 25;
    }
    
    // Ensure within bounds
    newElementX = Math.max(0, Math.min(newElementX, artboard.size.width - 100));
    newElementY = Math.max(0, Math.min(newElementY, artboard.size.height - 50));


    const newElementBase = {
      id: `el_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      position: { x: newElementX, y: newElementY },
      rotation: 0,
      scale: 1,
    };

    let newElementToAdd: ArtboardElement | null = null;

    if (type === 'text') {
      newElementToAdd = {
        ...newElementBase,
        type: 'text',
        content: 'New Text',
        fontSize: 16 / artboard.zoom, // Adjust initial font size based on zoom
        color: '#333333',
        fontFamily: 'Arial',
        size: { width: 150, height: 30 },
      } as ArtboardElement;
    } else if (type === 'shape' && subType) {
      newElementToAdd = {
        ...newElementBase,
        type: 'shape',
        shapeType: subType as ShapeType,
        fillColor: '#5F9EA0', // Primary color
        strokeColor: '#333333',
        strokeWidth: 0, // No stroke by default
        size: { width: 100, height: 100 },
      } as ArtboardElement;
      if (subType === 'circle') (newElementToAdd as any).size = { width: 100, height: 100 };
    } else if (type === 'device' && subType) {
      newElementToAdd = {
        ...newElementBase,
        type: 'device',
        deviceType: subType as DeviceType,
        size: { width: 150, height: 300 }, // Default phone-like size
      } as ArtboardElement;
    }

    if (newElementToAdd) {
      const updatedElements = [...elements, newElementToAdd];
      setElements(updatedElements);
      onUpdateArtboard({ elements: updatedElements });
      setSelectedElementId(newElementToAdd.id);
      toast({ title: "Element Added", description: `${type} element created.`, variant: "default" });
    }
  };
  
  // Expose addElement via ref for parent component (CanvasArea)
  useEffect(() => {
    if (artboardRef.current) {
      (artboardRef.current as any).addElement = addElement;
    }
  }, [elements, artboard.zoom]); // Re-bind if elements or zoom change to capture current state

  return (
    <div
      ref={artboardRef}
      className={cn(
        "artboard relative shadow-lg overflow-hidden bg-card",
        isSelected ? "ring-2 ring-offset-2 ring-accent" : "ring-1 ring-border"
      )}
      style={{
        width: `${artboard.size.width}px`,
        height: `${artboard.size.height}px`,
        backgroundColor: artboard.backgroundColor,
        transform: `scale(${artboard.zoom})`,
        transformOrigin: 'top left', // Important for scaling behavior
        // transition: 'transform 0.1s ease-out', // Can be jerky with frequent updates
      }}
      onClick={handleArtboardClick}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const type = e.dataTransfer.getData('application/artboard-element-type') as ElementType;
        const subType = e.dataTransfer.getData('application/artboard-element-subtype') as ShapeType | DeviceType | undefined;
        if (type) {
          const artboardRect = artboardRef.current?.getBoundingClientRect();
          if (!artboardRect) return;

          const dropX = e.clientX;
          const dropY = e.clientY;
          
          addElement(type, subType || undefined, {x: dropX, y: dropY});
        }
      }}
      onDragOver={(e) => {
        e.preventDefault(); // Necessary to allow drop
        e.stopPropagation();
      }}
    >
      {elements.map(element => (
        <DraggableElement
          key={element.id}
          element={element}
          isSelected={selectedElementId === element.id}
          onSelect={handleSelectElement}
          onUpdateElement={handleUpdateElement}
          onDeleteElement={handleDeleteElement}
          artboardZoom={artboard.zoom}
          boundary={{width: artboard.size.width, height: artboard.size.height}}
        >
          {element.type === 'text' && (
            <TextElement 
              element={element} 
              onUpdate={(updates) => partialUpdateElement(element.id, updates)} 
              isSelected={selectedElementId === element.id}
              artboardZoom={artboard.zoom}
            />
          )}
          {element.type === 'shape' && <ShapeElement element={element} />}
          {element.type === 'device' && (
            <DeviceFrameElement 
              element={element} 
              onUpdate={(updates) => partialUpdateElement(element.id, updates)} 
              isSelected={selectedElementId === element.id} 
            />
          )}
        </DraggableElement>
      ))}
    </div>
  );
}

// Consider adding a method to artboardRef to get selected element for property inspector
// (artboardRef.current as any).getSelectedElement = () => elements.find(el => el.id === selectedElementId);

