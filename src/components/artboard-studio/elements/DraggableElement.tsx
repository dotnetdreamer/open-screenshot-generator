
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
  artboardZoom: number; // Zoom of the artboard's content
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
    mouseX: number; // Mouse position in artboard's unzoomed space
    mouseY: number;
    initialX: number; // Element's initial position
    initialY: number;
    initialRotation?: number;
    initialScale?: number;
    elementCenterX?: number; // Element center in artboard's unzoomed space
    elementCenterY?: number;
  } | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    setPosition(element.position);
    setCurrentRotation(element.rotation);
    setCurrentScale(element.scale);
  }, [element.position, element.rotation, element.scale]);

  const getMousePositionInArtboardSpace = (e: MouseEvent | React.MouseEvent): Point => {
    // This function assumes artboardZoom correctly reflects the scaling of the artboard content area
    // and that e.clientX/Y are viewport coordinates.
    // If the artboard itself is on a panned/zoomed canvas, further transformations would be needed here.
    // For now, assuming artboardZoom is the primary factor for mouse coordinate transformation.
    
    // If the artboard itself (the parent of DraggableElement) has a getBoundingClientRect,
    // we should use it to make mouse positions relative to the artboard.
    // const artboardRect = elementRef.current?.parentElement?.parentElement?.getBoundingClientRect(); // a bit fragile
    // if (artboardRect) {
    //   return {
    //     x: (e.clientX - artboardRect.left) / artboardZoom,
    //     y: (e.clientY - artboardRect.top) / artboardZoom,
    //   };
    // }
    // Simplified: assumes clientX/Y can be scaled directly by artboardZoom
    // This works if the artboard's top-left is effectively (0,0) in the coordinate system artboardZoom applies to.
    return {
        x: e.clientX / artboardZoom,
        y: e.clientY / artboardZoom,
    }
  };


  const handleInteractionStart = (e: React.MouseEvent, mode: 'move' | 'rotate' | 'scale') => {
    e.preventDefault();
    e.stopPropagation();
    if (!elementRef.current) return;
    
    onSelect(element.id, e); // Select element on interaction start
    setInteractionMode(mode);

    const mousePosArtboard = getMousePositionInArtboardSpace(e);
    
    const elCurrentScale = element.scale; // Use current scale from prop for initial calculations
    const elCurrentRotation = element.rotation; // Use current rotation from prop

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
        
        setPosition({ x: newX, y: newY }); // Local update for smooth feedback
        // Parent update will happen on mouseUp
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
        newRotation = Math.round(newRotation / 1) * 1; // Snap to 1 degree, can be adjusted
        setCurrentRotation(newRotation); // Local update
        // onUpdateElement({ ...element, rotation: newRotation }); // Update parent immediately
      } else if (interactionMode === 'scale' && interactionStart.initialScale !== undefined && interactionStart.elementCenterX !== undefined && interactionStart.elementCenterY !== undefined) {
        const dx = mousePosArtboard.x - interactionStart.mouseX;
        const dy = mousePosArtboard.y - interactionStart.mouseY;
        // Using distance from center might be more intuitive for scaling
        // For simplicity, let's use horizontal distance from start for now
        const scaleChangeFactor = dx / 100; // 100px drag = 1.0 scale change
        let newScale = interactionStart.initialScale + scaleChangeFactor;
        newScale = Math.max(0.1, Math.min(newScale, 10)); // Min 10%, Max 1000% scale
        
        // Boundary checks for scaling (centered)
        const elCenterX = interactionStart.elementCenterX;
        const elCenterY = interactionStart.elementCenterY;
        const baseWidth = element.size.width;
        const baseHeight = element.size.height;

        let clampedScale = newScale;
        const newHalfWidth = (baseWidth * clampedScale) / 2;
        const newHalfHeight = (baseHeight * clampedScale) / 2;

        if (elCenterX - newHalfWidth < 0) clampedScale = Math.min(clampedScale, (2 * elCenterX) / baseWidth);
        if (elCenterX + newHalfWidth > boundary.width) clampedScale = Math.min(clampedScale, (2 * (boundary.width - elCenterX)) / baseWidth);
        if (elCenterY - newHalfHeight < 0) clampedScale = Math.min(clampedScale, (2 * elCenterY) / baseHeight);
        if (elCenterY + newHalfHeight > boundary.height) clampedScale = Math.min(clampedScale, (2 * (boundary.height - elCenterY)) / baseHeight);
        
        newScale = Math.max(0.1, Math.min(clampedScale, 10));
        setCurrentScale(newScale); // Local update
        // onUpdateElement({ ...element, scale: newScale }); // Update parent immediately
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!interactionMode || !interactionStart) return;
      
      let finalElementState = { ...element, position, rotation: currentRotation, scale: currentScale };

      if (interactionMode === 'move') {
         finalElementState.position = position; // Use the locally updated position
      }
      // For rotate and scale, currentRotation and currentScale hold the latest values
      
      onUpdateElement(finalElementState);

      setInteractionMode(null);
      setInteractionStart(null);
    };

    if (interactionMode) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [interactionMode, interactionStart, element, onUpdateElement, artboardZoom, boundary, position, currentRotation, currentScale]);


  const displayScaledSize = {
    width: element.size.width * currentScale,
    height: element.size.height * currentScale,
  };

  // Calculate the scale factor for UI controls so they appear consistent regardless of artboardZoom or element scale
  // The goal is for the control icons to be roughly same visual size on screen.
  // ArtboardZoom scales the entire artboard. Element's own scale scales the element.
  // Controls are children of element, so they are affected by element.scale.
  // Controls are also affected by artboardZoom.
  // To counteract both, divide by (artboardZoom * currentScale).
  // However, artboardZoom is for the artboard's canvas, element.scale is for the element.
  // The controls are positioned relative to the element, which is then scaled by artboardZoom.
  // So, transform: `scale(${1 / (artboardZoom * currentScale)})` is too much.
  // Just `scale(${1 / artboardZoom})` was for when controls were outside the element's own scale.
  // Now, since `currentScale` affects the element size, and controls are positioned relative to that,
  // we need to make them smaller if `currentScale` is large.
  // The controls are inside a div that has element.scale applied to it.
  // So, the base size of the controls is already scaled by currentScale.
  // We only need to counteract artboardZoom for the controls to appear fixed size on screen.
  // However, if element.scale is very small, 1/artboardZoom could make controls too large relative to element.
  // Let's try `scale(${1 / Math.max(artboardZoom, 0.1)})` for toolbar, and icons inside are fixed size.
  // The parent div is scaled by `element.scale`. So if icons are 10px, they become `10 * element.scale` px.
  // Then the whole thing is scaled by artboardZoom. So `10 * element.scale * artboardZoom`.
  // We want them to be `10px` on screen. So `10 / (element.scale * artboardZoom)`.
  const controlToolbarScale = 1 / Math.max(artboardZoom, 0.25); // Make controls less affected by extreme zoom out
  const controlIconScale = 1 / Math.max(currentScale, 0.25); // Make icons smaller if element is huge, larger if element is tiny
  const finalControlIconTransform = `scale(${controlIconScale})`;
  const finalToolbarTransform = `scale(${controlToolbarScale})`;


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
        outlineOffset: '2px',
        transition: interactionMode ? 'none' : 'outline 0.1s ease-in-out',
        boxSizing: 'border-box',
      }}
      onMouseDown={(e) => {
        // Allow click-to-select anywhere on element if not on a handle
        // Actual dragging is initiated by specific handles now.
        if (!(e.target as HTMLElement).closest('[data-interaction-handle]')) {
            onSelect(element.id, e);
        }
      }}
      data-element-id={element.id}
      className="group"
    >
      {/* Render children with a wrapper that ensures they don't capture drag events unless intended */}
      <div style={{width: '100%', height: '100%', pointerEvents: interactionMode ? 'none' : 'auto'}}>
        {children}
      </div>

      {isSelected && (
        <>
          {/* Drag Handle */}
          <div 
            data-interaction-handle 
            className="absolute -top-2 -left-2 p-0.5 bg-background border border-primary rounded-full shadow-lg cursor-grab active:cursor-grabbing opacity-80 group-hover:opacity-100 transition-opacity"
            title="Move"
            style={{ transform: finalToolbarTransform, transformOrigin: 'top left' }}
            onMouseDown={(e) => handleInteractionStart(e, 'move')}
          >
            <MoveIcon className="w-3 h-3 text-primary" style={{transform: finalControlIconTransform}} />
          </div>
          
          {/* Toolbar for selected element */}
          <div 
            className="absolute -bottom-2 -right-2 flex space-x-0.5 bg-background border border-gray-300 rounded-md shadow-lg p-0.5 opacity-80 group-hover:opacity-100 transition-opacity"
            style={{ transform: finalToolbarTransform, transformOrigin: 'bottom right' }}
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking toolbar itself
          >
            <Button 
              data-interaction-handle
              variant="ghost" size="icon" className="w-5 h-5 p-0.5 cursor-pointer" title="Edit (N/A)">
              <Edit2Icon className="w-3 h-3" style={{transform: finalControlIconTransform}} />
            </Button>
            <Button 
              data-interaction-handle
              variant="ghost" size="icon" className="w-5 h-5 p-0.5 cursor-[grab] active:cursor-[grabbing]" title="Rotate" 
              onMouseDown={(e) => handleInteractionStart(e, 'rotate')}>
              <RotateCcwIcon className="w-3 h-3" style={{transform: finalControlIconTransform}}/>
            </Button>
            <Button 
              data-interaction-handle
              variant="ghost" size="icon" className="w-5 h-5 p-0.5 cursor-[grab] active:cursor-[grabbing]" title="Scale" 
              onMouseDown={(e) => handleInteractionStart(e, 'scale')}>
              <ScaleIcon className="w-3 h-3" style={{transform: finalControlIconTransform}} />
            </Button>
            <Button 
              variant="ghost" size="icon" className="w-5 h-5 p-0.5 text-destructive hover:text-destructive-foreground hover:bg-destructive cursor-pointer" title="Delete" 
              onClick={() => onDeleteElement(element.id)}>
              <Trash2Icon className="w-3 h-3" style={{transform: finalControlIconTransform}}/>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

    