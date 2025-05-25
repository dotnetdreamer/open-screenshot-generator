
"use client";
import type React from 'react';
import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { DraggableElement } from './elements/DraggableElement';
import { TextElement } from './elements/TextElement';
import { ShapeElement } from './elements/ShapeElement';
import { DeviceFrameElement } from './elements/DeviceFrameElement';
import type { ArtboardState as ArtboardType, ArtboardElement, Point, ElementType, ShapeType, DeviceType } from '@/types/artboard';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ArtboardProps {
  artboard: ArtboardType;
  isSelected: boolean; 
  onUpdateArtboardElements: (elements: ArtboardElement[]) => void;
  onUpdateArtboardDetails: (updatedDetails: Partial<ArtboardType>) => void;
  onSelectArtboard: () => void;
  globalZoom: number;
  selectedElementId: string | null;
  setSelectedElementId: (id: string | null) => void;
}

export interface ArtboardRef {
  addElement: (type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point) => string | undefined;
  deleteElementByIdG: (elementId: string) => void; // Renamed to avoid conflicts
}

export const Artboard = forwardRef<ArtboardRef, ArtboardProps>(({ 
  artboard, 
  isSelected, 
  onUpdateArtboardElements,
  onUpdateArtboardDetails,
  onSelectArtboard, 
  globalZoom,
  selectedElementId,
  setSelectedElementId
}, ref) => {
  const [elements, setElements] = useState<ArtboardElement[]>(artboard.elements);
  const artboardDivRef = useRef<HTMLDivElement>(null); // Renamed from artboardRef to avoid confusion with forwardRef
  const { toast } = useToast();

  useEffect(() => {
    setElements(artboard.elements);
  }, [artboard.elements]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    addElement: (type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point) => {
      const artboardRect = artboardDivRef.current?.getBoundingClientRect();
      let newElementX = artboard.size.width / 2 - 50; 
      let newElementY = artboard.size.height / 2 - 25;
      
      if (dropPosition && artboardRect) {
        newElementX = (dropPosition.x - artboardRect.left) / artboard.zoom - 50; // Adjust for element size (assuming 100 width)
        newElementY = (dropPosition.y - artboardRect.top) / artboard.zoom - 25; // Adjust for element size (assuming 50 height)
      }
      
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
          fontSize: 16, 
          color: '#333333',
          fontFamily: 'Arial',
          size: { width: 150, height: 30 },
        } as ArtboardElement;
      } else if (type === 'shape' && subType) {
        newElementToAdd = {
          ...newElementBase,
          type: 'shape',
          shapeType: subType as ShapeType,
          fillColor: '#5F9EA0', 
          strokeColor: '#333333',
          strokeWidth: 0, 
          size: { width: 100, height: 100 },
        } as ArtboardElement;
      } else if (type === 'device' && subType) {
        newElementToAdd = {
          ...newElementBase,
          type: 'device',
          deviceType: subType as DeviceType,
          size: { width: 150, height: 300 }, 
        } as ArtboardElement;
      }

      if (newElementToAdd) {
        const updatedElements = [...elements, newElementToAdd];
        setElements(updatedElements);
        onUpdateArtboardElements(updatedElements);
        setSelectedElementId(newElementToAdd.id);
        toast({ title: "Element Added", description: `${type} element created.`, variant: "default" });
        return newElementToAdd.id;
      }
      return undefined;
    },
    deleteElementByIdG: (elementId: string) => { // Renamed method
        handleDeleteElement(elementId);
    }
  }));

  const handleUpdateElement = (updatedElementData: ArtboardElement) => {
    const newElements = elements.map(el =>
      el.id === updatedElementData.id ? { ...el, ...updatedElementData } : el
    );
    setElements(newElements);
    onUpdateArtboardElements(newElements);
  };
  
  const partialUpdateElement = (elementId: string, updates: Partial<ArtboardElement>) => {
    const newElements = elements.map(el =>
      el.id === elementId ? { ...el, ...updates } : el
    );
    setElements(newElements);
    onUpdateArtboardElements(newElements);
  }

  const handleDeleteElement = (elementId: string) => {
    const newElements = elements.filter(el => el.id !== elementId);
    setElements(newElements);
    onUpdateArtboardElements(newElements);
    if (selectedElementId === elementId) {
      setSelectedElementId(null);
    }
    toast({ title: "Element deleted", description: `Element ID ${elementId} removed.`, variant: "default" });
  };

  const handleSelectElement = (elementId: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    setSelectedElementId(elementId);
    onSelectArtboard(); // Also ensure artboard is selected
  };

  const handleArtboardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === artboardDivRef.current) {
      setSelectedElementId(null);
    }
    onSelectArtboard();
  };

  return (
    <div
      ref={artboardDivRef}
      className={cn(
        "artboard relative shadow-lg overflow-hidden bg-card",
        isSelected ? "ring-2 ring-offset-2 ring-accent" : "ring-1 ring-border"
      )}
      style={{
        width: `${artboard.size.width}px`,
        height: `${artboard.size.height}px`,
        backgroundColor: artboard.backgroundColor,
        transform: `scale(${artboard.zoom})`, // This is artboard's internal zoom
        transformOrigin: 'top left',
      }}
      onClick={handleArtboardClick}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const type = e.dataTransfer.getData('application/artboard-element-type') as ElementType;
        const subType = e.dataTransfer.getData('application/artboard-element-subtype') as ShapeType | DeviceType | undefined;
        if (type && typeof (ref as React.MutableRefObject<ArtboardRef | null>)?.current?.addElement === 'function') {
          const dropX = e.clientX;
          const dropY = e.clientY;
          (ref as React.MutableRefObject<ArtboardRef | null>)?.current?.addElement(type, subType || undefined, {x: dropX, y: dropY});
        }
      }}
      onDragOver={(e) => {
        e.preventDefault(); 
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
          artboardZoom={artboard.zoom} // This is the artboard's own content zoom
          boundary={{width: artboard.size.width, height: artboard.size.height}}
        >
          {element.type === 'text' && (
            <TextElement 
              element={element} 
              onUpdate={(updates) => partialUpdateElement(element.id, updates)} 
              isSelected={selectedElementId === element.id}
              artboardZoom={artboard.zoom * element.scale} // Text needs combined zoom/scale
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
});

Artboard.displayName = "Artboard";

    