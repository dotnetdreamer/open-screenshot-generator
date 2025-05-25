
"use client";
import type React from 'react';
import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { DraggableElement } from './elements/DraggableElement';
import { TextElement } from './elements/TextElement';
import { ShapeElement } from './elements/ShapeElement';
import { DeviceFrameElement } from './elements/DeviceFrameElement';
import type { ArtboardState as ArtboardType, ArtboardElement, Point, ElementType, ShapeType, DeviceType, DeviceFrameElementProps } from '@/types/artboard';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ArtboardToolbar } from './ArtboardToolbar'; // Import the new toolbar

interface ArtboardProps {
  artboard: ArtboardType;
  isSelected: boolean; 
  onUpdateArtboardElements: (elements: ArtboardElement[]) => void;
  onUpdateArtboardDetails: (updatedDetails: Partial<ArtboardType>) => void;
  onSelectArtboard: () => void;
  globalZoom: number;
  selectedElementId: string | null;
  setSelectedElementId: (id: string | null) => void;
  // Props for the ArtboardToolbar
  onAddNewArtboard: () => void;
  onDuplicateArtboard: (artboardId: string) => void;
  onDeleteArtboard: (artboardId: string) => void;
  onMoveArtboard: (artboardId: string, direction: 'left' | 'right') => void;
  canDeleteArtboard: boolean;
  canMoveArtboardLeft: boolean;
  canMoveArtboardRight: boolean;
}

export interface ArtboardRef {
  addElement: (type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point) => string | undefined;
  deleteElementByIdG: (elementId: string) => void;
}

export const Artboard = forwardRef<ArtboardRef, ArtboardProps>(({ 
  artboard, 
  isSelected, 
  onUpdateArtboardElements,
  onUpdateArtboardDetails,
  onSelectArtboard, 
  globalZoom,
  selectedElementId,
  setSelectedElementId,
  onAddNewArtboard,
  onDuplicateArtboard,
  onDeleteArtboard,
  onMoveArtboard,
  canDeleteArtboard,
  canMoveArtboardLeft,
  canMoveArtboardRight,
}, ref) => {
  const [elements, setElements] = useState<ArtboardElement[]>(artboard.elements);
  const artboardDivRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    setElements(artboard.elements);
  }, [artboard.elements]);

  useImperativeHandle(ref, () => ({
    addElement: (type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point) => {
      const artboardRect = artboardDivRef.current?.getBoundingClientRect();
      let newElementX = artboard.size.width / 2 - 50; 
      let newElementY = artboard.size.height / 2 - 25;
      
      if (dropPosition && artboardRect) {
        newElementX = (dropPosition.x - artboardRect.left) / artboard.zoom - 50;
        newElementY = (dropPosition.y - artboardRect.top) / artboard.zoom - 25;
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
        const deviceElement: DeviceFrameElementProps = {
          ...newElementBase,
          type: 'device',
          deviceType: subType as DeviceType,
          size: { width: 150, height: 300 }, // Default size for devices
        };
        if (subType === 'custom') {
          deviceElement.screenshotRect = { left: 5, top: 5, width: 90, height: 90 };
        } else {
          deviceElement.screenshotRect = { left: 0, top: 0, width: 100, height: 100 };
        }
        newElementToAdd = deviceElement as ArtboardElement;
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
    deleteElementByIdG: (elementId: string) => {
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
    onSelectArtboard(); 
  };

  const handleArtboardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only deselect element if the click is directly on the artboard background,
    // not on the toolbar or other child elements within the artboard wrapper.
    if (e.target === artboardDivRef.current) {
      setSelectedElementId(null);
    }
    onSelectArtboard();
  };

  return (
    <div className="relative"> {/* Wrapper for artboard and its toolbar */}
      <ArtboardToolbar
        artboardId={artboard.id}
        onAddNew={() => onAddNewArtboard()} 
        onDuplicate={onDuplicateArtboard}
        onDelete={onDeleteArtboard}
        onMove={onMoveArtboard}
        canDelete={canDeleteArtboard}
        canMoveLeft={canMoveArtboardLeft}
        canMoveRight={canMoveArtboardRight}
      />
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
          transform: `scale(${artboard.zoom})`,
          transformOrigin: 'top left',
          marginTop: '2.5rem', // Always add margin-top for the toolbar
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
            artboardZoom={artboard.zoom}
            boundary={{width: artboard.size.width, height: artboard.size.height}}
          >
            {element.type === 'text' && (
              <TextElement 
                element={element} 
                onUpdate={(updates) => partialUpdateElement(element.id, updates)} 
                isSelected={selectedElementId === element.id}
                artboardZoom={artboard.zoom * element.scale}
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
    </div>
  );
});

Artboard.displayName = "Artboard";

