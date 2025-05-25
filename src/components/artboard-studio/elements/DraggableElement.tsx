
"use client";
import type React from 'react';
import { useState, useEffect, useRef }
from 'react';
import { RotateCcwIcon, Trash2Icon, Maximize2Icon } from 'lucide-react'; // Using Maximize2 for scale for now
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

const HANDLE_SIZE_BASE = 16; // Base size for handles in pixels (will be scaled)
const HANDLE_OFFSET = -HANDLE_SIZE_BASE / 2; // For centering handles on the outline

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
    initialWidth?: number;
    initialHeight?: number;
    elementCenterX?: number;
    elementCenterY?: number;
    aspectRatio?: number;
    handleType?: 'corner' | 'rotate'; // To know which scale handle is used
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
      return {
        x: (e.clientX - artboardRect.left) / artboardZoom,
        y: (e.clientY - artboardRect.top) / artboardZoom,
      };
    }
    return { x: e.clientX / artboardZoom, y: e.clientY / artboardZoom };
  };

  const handleInteractionStart = (
    e: React.MouseEvent,
    mode: 'move' | 'rotate' | 'scale',
    handleType?: 'corner' | 'rotate'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!elementRef.current) return;

    if (mode !== 'move' || !isSelected) { // Select if not already selected, or if interacting with a handle
        onSelect(element.id, e);
    }
    setInteractionMode(mode);

    const mousePosArtboard = getMousePositionInArtboardSpace(e);
    const elCurrentScale = element.scale;
    const elCurrentRotation = element.rotation;

    const baseWidth = element.size.width;
    const baseHeight = element.size.height;
    const scaledWidth = baseWidth * elCurrentScale;
    const scaledHeight = baseHeight * elCurrentScale;

    const elCenterX = element.position.x + scaledWidth / 2;
    const elCenterY = element.position.y + scaledHeight / 2;

    setInteractionStart({
      mouseX: mousePosArtboard.x,
      mouseY: mousePosArtboard.y,
      initialX: element.position.x,
      initialY: element.position.y,
      initialRotation: elCurrentRotation,
      initialScale: elCurrentScale,
      initialWidth: baseWidth, // Store base width/height for scaling
      initialHeight: baseHeight,
      elementCenterX: elCenterX,
      elementCenterY: elCenterY,
      aspectRatio: baseWidth / baseHeight,
      handleType: handleType,
    });
  };


  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!interactionMode || !interactionStart || !elementRef.current) return;
      e.preventDefault();

      const mousePosArtboard = getMousePositionInArtboardSpace(e);
      const { initialX, initialY, initialRotation, initialScale, initialWidth, initialHeight, elementCenterX, elementCenterY, aspectRatio, handleType } = interactionStart;


      if (interactionMode === 'move') {
        let newX = initialX + (mousePosArtboard.x - interactionStart.mouseX);
        let newY = initialY + (mousePosArtboard.y - interactionStart.mouseY);

        const scaledWidth = initialWidth! * currentScale;
        const scaledHeight = initialHeight! * currentScale;

        newX = Math.max(0, Math.min(newX, boundary.width - scaledWidth));
        newY = Math.max(0, Math.min(newY, boundary.height - scaledHeight));

        setPosition({ x: newX, y: newY });

      } else if (interactionMode === 'rotate' && initialRotation !== undefined && elementCenterX !== undefined && elementCenterY !== undefined) {
        const angle = Math.atan2(
          mousePosArtboard.y - elementCenterY,
          mousePosArtboard.x - elementCenterX
        ) * (180 / Math.PI);
        const startAngle = Math.atan2(
          interactionStart.mouseY - elementCenterY,
          interactionStart.mouseX - elementCenterX
        ) * (180 / Math.PI);

        let newRotation = initialRotation + (angle - startAngle);
        newRotation = Math.round(newRotation / 1) * 1; // Snap to 1 degree
        setCurrentRotation(newRotation);

      } else if (interactionMode === 'scale' && initialScale !== undefined && elementCenterX !== undefined && elementCenterY !== undefined && initialWidth !== undefined && initialHeight !== undefined && aspectRatio !== undefined) {
        // Calculate distance from element center to initial mouse down on handle
        const initialDistToCenter = Math.sqrt(
            Math.pow(interactionStart.mouseX - elementCenterX, 2) + Math.pow(interactionStart.mouseY - elementCenterY, 2)
        );
        // Calculate distance from element center to current mouse position
        const currentDistToCenter = Math.sqrt(
            Math.pow(mousePosArtboard.x - elementCenterX, 2) + Math.pow(mousePosArtboard.y - elementCenterY, 2)
        );

        if (initialDistToCenter === 0) return; // Avoid division by zero

        let scaleFactor = currentDistToCenter / initialDistToCenter;
        let newScale = initialScale * scaleFactor;
        newScale = Math.max(0.05, Math.min(newScale, 20));

        // Calculate new dimensions and position based on center anchor
        const newScaledWidth = initialWidth * newScale;
        const newScaledHeight = initialHeight * newScale;

        let newPositionX = elementCenterX - newScaledWidth / 2;
        let newPositionY = elementCenterY - newScaledHeight / 2;
        
        // Boundary checks for scaling
        if (newPositionX < 0 || newPositionX + newScaledWidth > boundary.width || newPositionY < 0 || newPositionY + newScaledHeight > boundary.height) {
            // If scaling makes it go out of bounds, try to clamp the scale
            let scaleXBound = newScale;
            let scaleYBound = newScale;

            if (newPositionX < 0) scaleXBound = (elementCenterX * 2) / initialWidth;
            if (newPositionX + newScaledWidth > boundary.width) scaleXBound = ((boundary.width - elementCenterX) * 2) / initialWidth;
            if (newPositionY < 0) scaleYBound = (elementCenterY * 2) / initialHeight;
            if (newPositionY + newScaledHeight > boundary.height) scaleYBound = ((boundary.height - elementCenterY) * 2) / initialHeight;
            
            newScale = Math.min(scaleXBound, scaleYBound, newScale);
            newScale = Math.max(0.05, newScale); // Re-apply min scale
        }
        
        const finalScaledWidth = initialWidth * newScale;
        const finalScaledHeight = initialHeight * newScale;
        const finalPositionX = elementCenterX - finalScaledWidth / 2;
        const finalPositionY = elementCenterY - finalScaledHeight / 2;

        setPosition({ x: finalPositionX, y: finalPositionY });
        setCurrentScale(newScale);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!interactionMode || !interactionStart) return;

      let finalElementState = { ...element, position, rotation: currentRotation, scale: currentScale };
      onUpdateElement(finalElementState);

      setInteractionMode(null);
      setInteractionStart(null);
      document.body.style.cursor = 'default';
    };

    if (interactionMode) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 
        interactionMode === 'move' ? 'grabbing' :
        interactionMode === 'rotate' ? 'crosshair' : // Or a specific rotate cursor
        interactionMode === 'scale' ? 'nwse-resize' : // Default for corner scaling
        'default';
    } else {
      document.body.style.cursor = 'default';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (document.body.style.cursor !== 'default' && !interactionMode) { // Check if cursor was set by this effect
        document.body.style.cursor = 'default';
      }
    };
  }, [interactionMode, interactionStart, element, onUpdateElement, artboardZoom, boundary, position, currentRotation, currentScale]);


  const displayScaledSize = {
    width: element.size.width * currentScale,
    height: element.size.height * currentScale,
  };

  // Inverse scale for handles to keep them visually consistent
  // This scale is applied to the handle elements themselves
  const handleVisualScale = 1 / (artboardZoom * currentScale);
  const outlineThickness = Math.max(1, 1 / artboardZoom); // Thinner outline when zoomed out


  const HandleComponent: React.FC<{
    positionStyle: React.CSSProperties;
    onMouseDown: (e: React.MouseEvent) => void;
    title: string;
    children: React.ReactNode;
    className?: string;
  }> = ({ positionStyle, onMouseDown, title, children, className }) => (
    <div
      data-interaction-handle
      className={cn(
        "absolute flex items-center justify-center bg-background border border-primary rounded-sm shadow-md cursor-pointer opacity-90 hover:opacity-100",
        className
      )}
      style={{
        width: `${HANDLE_SIZE_BASE}px`,
        height: `${HANDLE_SIZE_BASE}px`,
        transform: `scale(${handleVisualScale})`, // Scale the handle itself
        ...positionStyle,
      }}
      onMouseDown={onMouseDown}
      title={title}
    >
      {children}
    </div>
  );
  
  const iconSizeClass = "w-3 h-3"; // Smaller icons for handles


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
        cursor: isSelected && interactionMode === null ? 'grab' : (interactionMode ? document.body.style.cursor : 'pointer'),
        boxSizing: 'border-box',
        // The outline is now a separate div for better control
      }}
      onMouseDown={(e) => {
        // If the click is directly on the element and not a handle, initiate move.
        if (!(e.target as HTMLElement).closest('[data-interaction-handle]') && isSelected) {
            handleInteractionStart(e, 'move');
        } else if (!isSelected) {
            onSelect(element.id, e);
        }
      }}
      data-element-id={element.id}
      className="group"
    >
      {/* Selection Outline */}
      {isSelected && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            outline: `${outlineThickness}px solid hsl(var(--primary))`,
            outlineOffset: `${outlineThickness * 2}px`, // Keep offset proportional to thickness
          }}
        />
      )}

      {/* Element Content */}
      <div style={{ width: '100%', height: '100%', pointerEvents: interactionMode || !isSelected ? 'none' : 'auto' }}>
        {children}
      </div>

      {/* Handles - only show if selected */}
      {isSelected && (
        <>
          {/* Scale Handles (Corners) */}
          {['tl', 'tr', 'bl', 'br'].map(corner => {
            let posStyle: React.CSSProperties = {};
            if (corner === 'tl') posStyle = { top: `${HANDLE_OFFSET}px`, left: `${HANDLE_OFFSET}px`, transformOrigin: 'top left', cursor: 'nwse-resize' };
            if (corner === 'tr') posStyle = { top: `${HANDLE_OFFSET}px`, right: `${HANDLE_OFFSET}px`, transformOrigin: 'top right', cursor: 'nesw-resize' };
            if (corner === 'bl') posStyle = { bottom: `${HANDLE_OFFSET}px`, left: `${HANDLE_OFFSET}px`, transformOrigin: 'bottom left', cursor: 'nesw-resize' };
            if (corner === 'br') posStyle = { bottom: `${HANDLE_OFFSET}px`, right: `${HANDLE_OFFSET}px`, transformOrigin: 'bottom right', cursor: 'nwse-resize' };
            
            return (
              <HandleComponent
                key={corner}
                positionStyle={posStyle}
                onMouseDown={(e) => handleInteractionStart(e, 'scale', 'corner')}
                title="Scale"
                className="rounded-full bg-primary hover:bg-primary/80" // Make scale handles distinct (e.g. circles)
              >
                {/* <Maximize2Icon className={cn(iconSizeClass, "text-primary-foreground")} /> */}
              </HandleComponent>
            );
          })}

          {/* Rotate Handle (Top Middle) */}
          <HandleComponent
            positionStyle={{
              top: `${HANDLE_OFFSET - HANDLE_SIZE_BASE}px`, // Position above the element
              left: `calc(50% + ${HANDLE_OFFSET}px)`,
              transformOrigin: 'center center',
              cursor: 'crosshair', // Or a custom rotate cursor
            }}
            onMouseDown={(e) => handleInteractionStart(e, 'rotate', 'rotate')}
            title="Rotate"
            className="rounded-full"
          >
            <RotateCcwIcon className={cn(iconSizeClass, "text-primary")} />
          </HandleComponent>
          
          {/* Delete Handle (Top Right, slightly offset from scale handle) */}
          <HandleComponent
             positionStyle={{
                top: `${HANDLE_OFFSET}px`, 
                right: `${HANDLE_OFFSET - HANDLE_SIZE_BASE - (HANDLE_SIZE_BASE * 0.2)}px`, // Offset further right
                transformOrigin: 'top right',
                cursor: 'pointer',
             }}
             onMouseDown={(e) => {
                e.stopPropagation(); // Prevent move/select
                onDeleteElement(element.id);
             }}
             title="Delete Element"
             className="bg-destructive hover:bg-destructive/80"
           >
            <Trash2Icon className={cn(iconSizeClass, "text-destructive-foreground")} />
          </HandleComponent>
        </>
      )}
    </div>
  );
}

    
