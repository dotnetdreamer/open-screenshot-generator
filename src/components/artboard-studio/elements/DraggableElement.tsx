
"use client";
import type React from 'react';
import { useState, useEffect } from 'react';
import { MoveIcon, RotateCcwIcon, ScaleIcon, Trash2Icon, Edit2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ArtboardElement, Point } from '@/types/artboard';

interface DraggableElementProps {
  element: ArtboardElement;
  isSelected: boolean;
  onSelect: (elementId: string, e: React.MouseEvent) => void;
  onUpdateElement: (element: ArtboardElement) => void;
  onDeleteElement: (elementId: string) => void;
  artboardZoom: number;
  boundary: { width: number; height: number }; // Artboard boundary
  children: React.ReactNode;
}

export function DraggableElement({ 
  element, 
  isSelected, 
  onSelect, 
  onUpdateElement,
  onDeleteElement, 
  artboardZoom, 
  boundary,
  children 
}: DraggableElementProps) {
  const [position, setPosition] = useState<Point>(element.position);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number, y: number, initialX: number, initialY: number } | null>(null);

  useEffect(() => {
    setPosition(element.position);
  }, [element.position]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only allow dragging if directly clicking the element, not its children like input fields
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(element.id, e); // Select on drag start
      setIsDragging(true);
      setDragStart({ 
        x: e.clientX / artboardZoom, 
        y: e.clientY / artboardZoom,
        initialX: position.x,
        initialY: position.y
      });
    } else {
      onSelect(element.id, e); // Still select if clicking on the element itself
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragStart) return;
      e.preventDefault();
      
      let newX = dragStart.initialX + (e.clientX / artboardZoom - dragStart.x);
      let newY = dragStart.initialY + (e.clientY / artboardZoom - dragStart.y);

      // Boundary checks
      newX = Math.max(0, Math.min(newX, boundary.width - element.size.width * element.scale));
      newY = Math.max(0, Math.min(newY, boundary.height - element.size.height * element.scale));
      
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging || !dragStart) return;
      setIsDragging(false);
      setDragStart(null);
      
      // Final position update, ensuring it's within bounds
      let finalX = dragStart.initialX + (e.clientX / artboardZoom - dragStart.x);
      let finalY = dragStart.initialY + (e.clientY / artboardZoom - dragStart.y);
      finalX = Math.max(0, Math.min(finalX, boundary.width - element.size.width * element.scale));
      finalY = Math.max(0, Math.min(finalY, boundary.height - element.size.height * element.scale));

      onUpdateElement({ ...element, position: { x: finalX, y: finalY } });
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart, element, onUpdateElement, artboardZoom, boundary]);


  const scaledSize = {
    width: element.size.width * element.scale,
    height: element.size.height * element.scale,
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${scaledSize.width}px`,
        height: `${scaledSize.height}px`,
        transform: `rotate(${element.rotation}deg)`,
        transformOrigin: 'center center',
        cursor: isDragging ? 'grabbing' : 'grab',
        outline: isSelected ? `2px solid hsl(var(--primary))` : 'none',
        outlineOffset: '2px',
        transition: isDragging ? 'none' : 'outline 0.1s ease-in-out',
        boxSizing: 'border-box',
      }}
      onMouseDown={handleMouseDown} // This makes the entire element draggable via its drag handle
      data-element-id={element.id}
      className="group"
    >
      {children}
      {isSelected && (
        <>
          {/* Drag Handle */}
          <div 
            data-drag-handle 
            className="absolute -top-2 -left-2 p-0.5 bg-background border border-primary rounded-full shadow-lg cursor-grab active:cursor-grabbing opacity-50 group-hover:opacity-100 transition-opacity"
            title="Move"
            style={{ transform: `scale(${1 / artboardZoom})`}}
          >
            <MoveIcon className="w-3 h-3 text-primary" />
          </div>
          {/* Toolbar for selected element */}
          <div 
            className="absolute -bottom-2 -right-2 flex space-x-0.5 bg-background border border-gray-300 rounded-md shadow-lg p-0.5 opacity-80 group-hover:opacity-100 transition-opacity"
            style={{ transform: `scale(${1 / artboardZoom})`, transformOrigin: 'bottom right' }}
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking toolbar
          >
            <Button variant="ghost" size="icon" className="w-5 h-5 p-0.5" title="Edit (Not implemented)">
              <Edit2Icon className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="w-5 h-5 p-0.5" title="Rotate (Not implemented)">
              <RotateCcwIcon className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="w-5 h-5 p-0.5" title="Scale (Not implemented)">
              <ScaleIcon className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="w-5 h-5 p-0.5 text-destructive hover:text-destructive-foreground hover:bg-destructive" title="Delete" onClick={() => onDeleteElement(element.id)}>
              <Trash2Icon className="w-3 h-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
