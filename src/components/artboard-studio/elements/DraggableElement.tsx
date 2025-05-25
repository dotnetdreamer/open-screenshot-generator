
"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
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
  boundary: { width: number; height: number }; 
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
  const [currentRotation, setCurrentRotation] = useState<number>(element.rotation);
  const [currentScale, setCurrentScale] = useState<number>(element.scale);

  const [interactionMode, setInteractionMode] = useState<'move' | 'rotate' | 'scale' | null>(null);
  const [interactionStart, setInteractionStart] = useState<{
    mouseX: number; 
    mouseY: number;
    initialX: number; 
    initialY: number;
    initialRotation?: number;
    initialScale?: number;
    elementCenterX?: number; 
    elementCenterY?: number;
  } | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    setPosition(element.position);
    setCurrentRotation(element.rotation);
    setCurrentScale(element.scale);
  }, [element.position, element.rotation, element.scale]);

  const getMousePositionInArtboardSpace = (e: MouseEvent | React.MouseEvent): Point => {
    const artboardRect = elementRef.current?.offsetParent?.getBoundingClientRect();
    if (artboardRect) {
        // mouse clientX/Y - artboard's screen top/left = mouse relative to artboard top/left on screen
        // then divide by artboardZoom to get coords in artboard's unzoomed space
        return {
            x: (e.clientX - artboardRect.left) / artboardZoom,
            y: (e.clientY - artboardRect.top) / artboardZoom,
        };
    }
    // Fallback if offsetParent isn't the artboard div (should ideally not happen if DOM structure is consistent)
    // This simplified version assumes the artboard itself is at (0,0) of the zoomed canvas area,
    // which is true if the canvas isn't panned.
    return {
        x: e.clientX / artboardZoom, 
        y: e.clientY / artboardZoom,
    }
  };


  const handleInteractionStart = (e: React.MouseEvent, mode: 'move' | 'rotate' | 'scale') => {
    e.preventDefault();
    e.stopPropagation();
    if (!elementRef.current) return;
    
    onSelect(element.id, e); 
    setInteractionMode(mode);

    const mousePosArtboard = getMousePositionInArtboardSpace(e);
    
    const elCurrentScale = element.scale; 
    const elCurrentRotation = element.rotation;

    const scaledWidth = element.size.width * elCurrentScale;
    const scaledHeight = element.size.height * elCurrentScale;
    
    const elCenterX = element.position.x + scaledWidth / 2;
    const elCenterY = element.position.y + scaledHeight / 2;

    setInteractionStart({
      mouseX: mousePosArtboard.x,
      mouseY: mousePosArtboard.y,
      initialX: element.position.x,
      initialY: element.position.y,
      initialRotation: elCurrentRotation,
      initialScale: elCurrentScale,
      elementCenterX: elCenterX,
      elementCenterY: elCenterY,
    });
  };


  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!interactionMode || !interactionStart || !elementRef.current) return;
      e.preventDefault();

      const mousePosArtboard = getMousePositionInArtboardSpace(e);

      if (interactionMode === 'move') {
        let newX = interactionStart.initialX + (mousePosArtboard.x - interactionStart.mouseX);
        let newY = interactionStart.initialY + (mousePosArtboard.y - interactionStart.mouseY);
        
        const scaledWidth = element.size.width * currentScale;
        const scaledHeight = element.size.height * currentScale;

        newX = Math.max(0, Math.min(newX, boundary.width - scaledWidth));
        newY = Math.max(0, Math.min(newY, boundary.height - scaledHeight));
        
        setPosition({ x: newX, y: newY });
      } else if (interactionMode === 'rotate' && interactionStart.initialRotation !== undefined && interactionStart.elementCenterX !== undefined && interactionStart.elementCenterY !== undefined) {
        const angle = Math.atan2(
          mousePosArtboard.y - interactionStart.elementCenterY,
          mousePosArtboard.x - interactionStart.elementCenterX
        ) * (180 / Math.PI);
        const startAngle = Math.atan2(
          interactionStart.mouseY - interactionStart.elementCenterY,
          interactionStart.mouseX - interactionStart.elementCenterX
        ) * (180 / Math.PI);
        
        let newRotation = interactionStart.initialRotation + (angle - startAngle);
        newRotation = Math.round(newRotation / 1) * 1; 
        setCurrentRotation(newRotation);
      } else if (interactionMode === 'scale' && interactionStart.initialScale !== undefined && interactionStart.elementCenterX !== undefined && interactionStart.elementCenterY !== undefined) {
        const dx = mousePosArtboard.x - interactionStart.mouseX;
        // const dy = mousePosArtboard.y - interactionStart.mouseY; // Could use dy or distance for more complex scaling
        
        // Scale sensitivity: how much mouse movement affects scale.
        // Adjust this factor for more or less sensitivity.
        // A smaller divisor means more sensitivity (faster scaling).
        const scaleSensitivity = element.size.width > 0 ? element.size.width / 2 : 50; // Base on initial width
        const scaleChangeFactor = dx / scaleSensitivity; 

        let newScale = interactionStart.initialScale + scaleChangeFactor * interactionStart.initialScale; // Make change relative
        newScale = Math.max(0.05, Math.min(newScale, 20)); 
        
        const elCenterX = interactionStart.elementCenterX;
        const elCenterY = interactionStart.elementCenterY;
        const baseWidth = element.size.width;
        const baseHeight = element.size.height;

        let clampedScale = newScale;
        const newHalfWidth = (baseWidth * clampedScale) / 2;
        const newHalfHeight = (baseHeight * clampedScale) / 2;
        
        const newPosX = elCenterX - newHalfWidth;
        const newPosY = elCenterY - newHalfHeight;

        if (newPosX < 0) clampedScale = Math.min(clampedScale, (elCenterX * 2) / baseWidth);
        if (elCenterX + newHalfWidth > boundary.width) clampedScale = Math.min(clampedScale, ((boundary.width - elCenterX) * 2) / baseWidth);
        if (newPosY < 0) clampedScale = Math.min(clampedScale, (elCenterY * 2) / baseHeight);
        if (elCenterY + newHalfHeight > boundary.height) clampedScale = Math.min(clampedScale, ((boundary.height - elCenterY) * 2) / baseHeight);
        
        newScale = Math.max(0.05, Math.min(clampedScale, 20)); // Re-clamp after boundary check

        if (newScale !== currentScale) {
           // Adjust position to keep element centered during scale, if necessary
           const newScaledWidth = element.size.width * newScale;
           const newScaledHeight = element.size.height * newScale;
           const newPositionX = interactionStart.initialX + (element.size.width * interactionStart.initialScale - newScaledWidth) / 2;
           const newPositionY = interactionStart.initialY + (element.size.height * interactionStart.initialScale - newScaledHeight) / 2;
           
           // Ensure new position is within bounds
           const finalPosX = Math.max(0, Math.min(newPositionX, boundary.width - newScaledWidth));
           const finalPosY = Math.max(0, Math.min(newPositionY, boundary.height - newScaledHeight));
          
           setPosition({x: finalPosX, y: finalPosY});
           setCurrentScale(newScale);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!interactionMode || !interactionStart) return;
      
      let finalElementState = { ...element, position, rotation: currentRotation, scale: currentScale };
      onUpdateElement(finalElementState);

      setInteractionMode(null);
      setInteractionStart(null);
    };

    if (interactionMode) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = interactionMode === 'move' ? 'grabbing': (interactionMode === 'rotate' ? 'crosshair' : 'ew-resize');
    } else {
      document.body.style.cursor = 'default';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (document.body.style.cursor !== 'default') {
        document.body.style.cursor = 'default';
      }
    };
  }, [interactionMode, interactionStart, element, onUpdateElement, artboardZoom, boundary, position, currentRotation, currentScale]);


  const displayScaledSize = {
    width: element.size.width * currentScale,
    height: element.size.height * currentScale,
  };

  // Calculate scale factor for UI controls so they appear consistent regardless of artboardZoom or element scale
  const effectiveArtboardZoom = Math.max(artboardZoom, 0.1); // Prevent division by zero or excessively large scales
  const effectiveCurrentScale = Math.max(currentScale, 0.05); // Prevent division by zero or excessively large scales for element's own scale
  
  // We want the controls to appear as if they are their base CSS size on screen.
  // Their actual rendered size without correction would be: BaseCssSize * effectiveCurrentScale * effectiveArtboardZoom
  // So, the correction factor is: 1 / (effectiveCurrentScale * effectiveArtboardZoom)
  const visualCorrectionScaleFactor = 1 / (effectiveCurrentScale * effectiveArtboardZoom);

  const handleContainerStyle: React.CSSProperties = {
    transform: `scale(${visualCorrectionScaleFactor})`,
    // transformOrigin will be set per handle/toolbar
  };

  return (
    <div
      ref={elementRef}
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${displayScaledSize.width}px`,
        height: `${displayScaledSize.height}px`,
        transform: `rotate(${currentRotation}deg)`,
        transformOrigin: 'center center',
        cursor: interactionMode ? 'grabbing' : (isSelected ? 'default' : 'pointer'),
        outline: isSelected ? `2px solid hsl(var(--primary))` : 'none',
        // Increased outlineOffset for better visibility, especially with scaled controls
        outlineOffset: `${Math.max(2, 2 * visualCorrectionScaleFactor)}px`, 
        transition: interactionMode ? 'none' : 'outline 0.1s ease-in-out',
        boxSizing: 'border-box',
      }}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('[data-interaction-handle]')) {
            onSelect(element.id, e);
        }
      }}
      data-element-id={element.id}
      className="group"
    >
      <div style={{width: '100%', height: '100%', pointerEvents: interactionMode ? 'none' : 'auto'}}>
        {children}
      </div>

      {isSelected && (
        <>
          {/* Drag Handle (Top-Left) */}
          <div 
            data-interaction-handle 
            className="absolute -top-1 -left-1 p-1 bg-background border border-primary rounded-full shadow-lg cursor-grab active:cursor-grabbing opacity-80 group-hover:opacity-100 transition-opacity"
            title="Move (M)"
            style={{ ...handleContainerStyle, transformOrigin: 'top left' }}
            onMouseDown={(e) => handleInteractionStart(e, 'move')}
          >
            <MoveIcon className="w-4 h-4 text-primary" />
          </div>
          
          {/* Toolbar (Bottom-Right) */}
          <div 
            className="absolute -bottom-1 -right-1 flex space-x-1 bg-background border border-gray-300 rounded-md shadow-lg p-1 opacity-80 group-hover:opacity-100 transition-opacity"
            style={{ ...handleContainerStyle, transformOrigin: 'bottom right' }}
            onMouseDown={(e) => e.stopPropagation()} 
          >
            <Button 
              data-interaction-handle="edit" // Keep data-attribute for clarity if needed
              variant="ghost" size="icon" className="w-6 h-6 p-1 cursor-pointer" title="Edit (E)">
              <Edit2Icon className="w-4 h-4" />
            </Button>
            <Button 
              data-interaction-handle
              variant="ghost" size="icon" className="w-6 h-6 p-1 cursor-[grab] active:cursor-[grabbing]" title="Rotate (R)" 
              onMouseDown={(e) => handleInteractionStart(e, 'rotate')}>
              <RotateCcwIcon className="w-4 h-4" />
            </Button>
            <Button 
              data-interaction-handle
              variant="ghost" size="icon" className="w-6 h-6 p-1 cursor-[grab] active:cursor-[grabbing]" title="Scale (S)" 
              onMouseDown={(e) => handleInteractionStart(e, 'scale')}>
              <ScaleIcon className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" size="icon" className="w-6 h-6 p-1 text-destructive hover:text-destructive-foreground hover:bg-destructive cursor-pointer" title="Delete (Del)" 
              onClick={() => onDeleteElement(element.id)}>
              <Trash2Icon className="w-4 h-4"/>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
    
