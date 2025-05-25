
"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArtboardElement, Point, Size } from '@/types/artboard';

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

const HANDLE_SIZE_BASE = 10; // Base size for handles in pixels
const HANDLE_OFFSET = -HANDLE_SIZE_BASE / 2; // For centering handles on the outline
const MIN_DISPLAY_SIZE = 20; // Minimum display width/height in pixels (for base size or scaled size)

type HandleType = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | 'rotate';

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
  const [currentSize, setCurrentSize] = useState<Size>(element.size); // Base size
  const [currentRotation, setCurrentRotation] = useState<number>(element.rotation);
  const [currentScale, setCurrentScale] = useState<number>(element.scale); // Uniform scale

  const [interactionMode, setInteractionMode] = useState<'move' | 'rotate' | 'scale' | 'resize' | null>(null);
  const [interactionStart, setInteractionStart] = useState<{
    mouseX: number;
    mouseY: number;
    initialPosition: Point;
    initialSize: Size; // base size at start
    initialRotation: number;
    initialScale: number; // uniform scale at start
    elementCenter: Point;
    handleType?: HandleType;
  } | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPosition(element.position);
    setCurrentSize(element.size);
    setCurrentRotation(element.rotation);
    setCurrentScale(element.scale);
  }, [element.id, element.position, element.size, element.rotation, element.scale]); // Added element.id to reset on element change

  const getMousePositionInArtboardSpace = (e: MouseEvent | React.MouseEvent): Point => {
    const artboardDiv = elementRef.current?.offsetParent as HTMLElement | null;
    if (artboardDiv) {
      const artboardRect = artboardDiv.getBoundingClientRect();
      return {
        x: (e.clientX - artboardRect.left) / artboardZoom,
        y: (e.clientY - artboardRect.top) / artboardZoom,
      };
    }
    return { x: e.clientX / artboardZoom, y: e.clientY / artboardZoom };
  };


  const handleInteractionStart = (
    e: React.MouseEvent,
    mode: 'move' | 'rotate' | 'scale' | 'resize',
    handleType?: HandleType
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!elementRef.current) return;

    if (!isSelected) { // Select if not already selected, unless it's a move on an already selected element
      onSelect(element.id, e);
    }
    setInteractionMode(mode);

    const mousePosArtboard = getMousePositionInArtboardSpace(e);
    
    // Current display size for center calculation
    const displayWidth = currentSize.width * currentScale;
    const displayHeight = currentSize.height * currentScale;

    setInteractionStart({
      mouseX: mousePosArtboard.x,
      mouseY: mousePosArtboard.y,
      initialPosition: { ...position },
      initialSize: { ...currentSize }, // Store base size
      initialRotation: currentRotation,
      initialScale: currentScale, // Store uniform scale
      elementCenter: {
        x: position.x + displayWidth / 2,
        y: position.y + displayHeight / 2,
      },
      handleType: handleType,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!interactionMode || !interactionStart || !elementRef.current) return;
      e.preventDefault();

      const mousePosArtboard = getMousePositionInArtboardSpace(e);
      const { initialPosition, initialSize, initialRotation, initialScale, elementCenter, handleType } = interactionStart;
      
      const rad = currentRotation * (Math.PI / 180); // Use currentRotation for dynamic updates if needed
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);

      const dxScreen = mousePosArtboard.x - interactionStart.mouseX;
      const dyScreen = mousePosArtboard.y - interactionStart.mouseY;

      let newPos = { ...position };
      let newSize = { ...currentSize };
      let newScale = currentScale;
      let newRotation = currentRotation;


      if (interactionMode === 'move') {
        let newX = initialPosition.x + dxScreen;
        let newY = initialPosition.y + dyScreen;
        
        const displayW = newSize.width * newScale; // Use current newSize and newScale
        const displayH = newSize.height * newScale;

        newX = Math.max(0, Math.min(newX, boundary.width - displayW));
        newY = Math.max(0, Math.min(newY, boundary.height - displayH));
        newPos = { x: newX, y: newY };

      } else if (interactionMode === 'rotate') {
        const angle = Math.atan2(mousePosArtboard.y - elementCenter.y, mousePosArtboard.x - elementCenter.x) * (180 / Math.PI);
        const startAngle = Math.atan2(interactionStart.mouseY - elementCenter.y, interactionStart.mouseX - elementCenter.x) * (180 / Math.PI);
        newRotation = initialRotation + (angle - startAngle);
        newRotation = Math.round(newRotation / 1) * 1; // Snap to 1 degree

      } else if (interactionMode === 'scale' && handleType && ['tl', 'tr', 'bl', 'br'].includes(handleType)) { // Proportional corner scaling
        const initialDistToCenter = Math.sqrt(Math.pow(interactionStart.mouseX - elementCenter.x, 2) + Math.pow(interactionStart.mouseY - elementCenter.y, 2));
        const currentDistToCenter = Math.sqrt(Math.pow(mousePosArtboard.x - elementCenter.x, 2) + Math.pow(mousePosArtboard.y - elementCenter.y, 2));

        if (initialDistToCenter === 0) return;
        let scaleFactor = currentDistToCenter / initialDistToCenter;
        let proposedNewUniformScale = initialScale * scaleFactor;
        
        // Clamp scale factor
        proposedNewUniformScale = Math.max(0.05, Math.min(proposedNewUniformScale, 20));

        let newDisplayWidth = initialSize.width * proposedNewUniformScale;
        let newDisplayHeight = initialSize.height * proposedNewUniformScale;

        // Ensure minimum display size
        if (newDisplayWidth < MIN_DISPLAY_SIZE) {
            proposedNewUniformScale = MIN_DISPLAY_SIZE / initialSize.width;
            newDisplayWidth = MIN_DISPLAY_SIZE;
        }
        if (newDisplayHeight < MIN_DISPLAY_SIZE) {
            proposedNewUniformScale = MIN_DISPLAY_SIZE / initialSize.height;
            newDisplayHeight = MIN_DISPLAY_SIZE;
        }
        proposedNewUniformScale = Math.max(0.05, proposedNewUniformScale); // Re-check min scale after MIN_DISPLAY_SIZE enforcement

        newDisplayWidth = initialSize.width * proposedNewUniformScale;
        newDisplayHeight = initialSize.height * proposedNewUniformScale;
        
        let newPosX = elementCenter.x - newDisplayWidth / 2;
        let newPosY = elementCenter.y - newDisplayHeight / 2;

        // Boundary checks - adjust scale if necessary to fit
        if (newPosX < 0) { 
            newPosX = 0; 
            // Recalculate scale if pinned to left edge
            if (initialSize.width > 0) proposedNewUniformScale = (elementCenter.x - newPosX) * 2 / initialSize.width;
        }
        if (newPosY < 0) { 
            newPosY = 0; 
            if (initialSize.height > 0) proposedNewUniformScale = (elementCenter.y - newPosY) * 2 / initialSize.height;
        }
        
        // Recalculate display dimensions with potentially adjusted scale
        newDisplayWidth = initialSize.width * proposedNewUniformScale;
        newDisplayHeight = initialSize.height * proposedNewUniformScale;

        if (newPosX + newDisplayWidth > boundary.width) {
            if (initialSize.width > 0) proposedNewUniformScale = (boundary.width - newPosX) / initialSize.width;
            // If scaling caused center to shift, it might need complex adjustment.
            // For simplicity, try to ensure right edge is within bounds.
            // A more robust solution would consider the center point relative to the fixed edge.
        }
        if (newPosY + newDisplayHeight > boundary.height) {
            if (initialSize.height > 0) proposedNewUniformScale = (boundary.height - newPosY) / initialSize.height;
        }
        
        // Final check on scale and recalculate derived values
        newScale = Math.max(0.05, Math.min(proposedNewUniformScale, 20));
        newDisplayWidth = initialSize.width * newScale;
        newDisplayHeight = initialSize.height * newScale;
        newPosX = elementCenter.x - newDisplayWidth / 2;
        newPosY = elementCenter.y - newDisplayHeight / 2;
        
        // Clamp position after all scale adjustments
        newPos.x = Math.max(0, Math.min(newPosX, boundary.width - newDisplayWidth));
        newPos.y = Math.max(0, Math.min(newPosY, boundary.height - newDisplayHeight));
        // newSize remains initialSize for uniform scaling

      } else if (interactionMode === 'resize' && handleType) { // Non-proportional edge resizing
        // Deltas in screen space, need to be applied to size considering rotation.
        // This simple approach works best for unrotated or slightly rotated elements for direct edge manipulation.
        // For heavily rotated elements, it effectively resizes the bounding box in screen space.
        
        let currentDisplayWidth = initialSize.width * initialScale;
        let currentDisplayHeight = initialSize.height * initialScale;

        if (handleType === 'r') {
            let newW = currentDisplayWidth + dxScreen;
            newW = Math.max(MIN_DISPLAY_SIZE, newW);
            if (initialPosition.x + newW > boundary.width) newW = boundary.width - initialPosition.x;
            newSize.width = newW / initialScale;
        } else if (handleType === 'l') {
            let newW = currentDisplayWidth - dxScreen;
            let newX = initialPosition.x + dxScreen;
            if (newX < 0) { newW += newX; newX = 0; } // newX becomes negative, add it to newW to shrink
            newW = Math.max(MIN_DISPLAY_SIZE, newW);
            if (newX + newW > boundary.width) newW = boundary.width - newX; // Ensure it doesn't go past boundary
            
            newSize.width = newW / initialScale;
            newPos.x = newX;
        } else if (handleType === 'b') {
            let newH = currentDisplayHeight + dyScreen;
            newH = Math.max(MIN_DISPLAY_SIZE, newH);
            if (initialPosition.y + newH > boundary.height) newH = boundary.height - initialPosition.y;
            newSize.height = newH / initialScale;
        } else if (handleType === 't') {
            let newH = currentDisplayHeight - dyScreen;
            let newY = initialPosition.y + dyScreen;
            if (newY < 0) { newH += newY; newY = 0; }
            newH = Math.max(MIN_DISPLAY_SIZE, newH);
            if (newY + newH > boundary.height) newH = boundary.height - newY;

            newSize.height = newH / initialScale;
            newPos.y = newY;
        }
      }
      
      // Update state for continuous feedback
      setPosition(newPos);
      setCurrentSize(newSize);
      setCurrentScale(newScale);
      setCurrentRotation(newRotation);
    };

    const handleMouseUp = () => {
      if (!interactionMode || !interactionStart) return;
      // Final update to parent
      onUpdateElement({ 
        ...element, 
        position, 
        size: currentSize, 
        rotation: currentRotation, 
        scale: currentScale 
      });
      setInteractionMode(null);
      setInteractionStart(null);
      document.body.style.cursor = 'default';
    };

    if (interactionMode) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      let cursor = 'default';
      if (interactionMode === 'move') cursor = 'grabbing';
      else if (interactionMode === 'rotate') cursor = 'grabbing'; // Using 'grabbing' for rotate too
      else if (interactionMode === 'scale' || interactionMode === 'resize') {
        const ht = interactionStart?.handleType;
        if (ht === 'tr' || ht === 'bl') cursor = 'nesw-resize';
        else if (ht === 'tl' || ht === 'br') cursor = 'nwse-resize';
        else if (ht === 't' || ht === 'b') cursor = 'ns-resize';
        else if (ht === 'l' || ht === 'r') cursor = 'ew-resize';
      }
      document.body.style.cursor = cursor;
    } else {
      document.body.style.cursor = 'default';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (document.body.style.cursor !== 'default' && !interactionMode) {
        document.body.style.cursor = 'default';
      }
    };
  }, [interactionMode, interactionStart, element, onUpdateElement, artboardZoom, boundary, position, currentSize, currentRotation, currentScale, onSelect]);


  // Calculate the actual display size after uniform scaling
  const displaySize = {
    width: currentSize.width * currentScale,
    height: currentSize.height * currentScale,
  };

  // Handles should visually stay same size on canvas zoom
  // The transform: scale() on handles makes them appear consistent.
  // The outline thickness should also visually appear consistent.
  const handleVisualScale = 1 / artboardZoom; 
  const outlineThickness = Math.max(1, 1 * handleVisualScale);


  const HandleComponent: React.FC<{
    positionStyle: React.CSSProperties;
    onMouseDown: (e: React.MouseEvent) => void;
    title: string;
    cursor: string;
    children?: React.ReactNode;
    className?: string;
    isCorner?: boolean;
  }> = ({ positionStyle, onMouseDown, title, cursor, children, className, isCorner = false }) => (
    <div
      data-interaction-handle // Important: prevents move start on handle click
      className={cn(
        "absolute flex items-center justify-center bg-background border border-primary shadow-md opacity-90 hover:opacity-100",
        isCorner ? "rounded-full" : "rounded-sm", // Circles for corners, squares for edges
        className
      )}
      style={{
        width: `${HANDLE_SIZE_BASE}px`,
        height: `${HANDLE_SIZE_BASE}px`,
        transform: `scale(${handleVisualScale})`, // Apply visual scale here
        cursor: cursor,
        ...positionStyle,
      }}
      onMouseDown={onMouseDown}
      title={title}
    >
      {children}
    </div>
  );
  
  const iconSizeClass = "w-2 h-2"; // Tailwind class for 0.5rem, e.g., 8px

  return (
    <div
      ref={elementRef}
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${displaySize.width}px`, // Use scaled display size
        height: `${displaySize.height}px`, // Use scaled display size
        transform: `rotate(${currentRotation}deg)`,
        transformOrigin: 'center center',
        cursor: isSelected && interactionMode === null ? 'grab' : (interactionMode ? document.body.style.cursor : 'pointer'),
        boxSizing: 'border-box',
      }}
      onMouseDown={(e) => {
        // Only initiate move if not clicking on a handle
        if (!(e.target as HTMLElement).closest('[data-interaction-handle]')) {
          if (isSelected) {
            handleInteractionStart(e, 'move');
          } else {
            onSelect(element.id, e); // Select if not selected and not on a handle
          }
        }
      }}
      data-element-id={element.id}
      className="group" // For potential group-hover states if needed later
    >
      {/* Selection Outline - visual only, pointer events none */}
      {isSelected && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            // Adjust outline based on handleVisualScale for consistent appearance
            outline: `${outlineThickness}px solid hsl(var(--primary))`, 
            // Negative offset to make it sit "on" the border, not outside
            outlineOffset: `${-outlineThickness}px`, 
          }}
        />
      )}

      {/* Element Content Itself */}
      {/* Child needs to fill this div. pointerEvents managed by interactionMode */}
      <div style={{ width: '100%', height: '100%', pointerEvents: interactionMode || !isSelected ? 'none' : 'auto' }}>
        {children}
      </div>

      {/* Interaction Handles - only show if selected */}
      {isSelected && (
        <>
          {/* Corner Scale Handles (Proportional) */}
          {(['tl', 'tr', 'bl', 'br'] as HandleType[]).map(corner => {
            let posStyle: React.CSSProperties = {};
            let cursor = 'default';
            if (corner === 'tl') { posStyle = { top: `${HANDLE_OFFSET}px`, left: `${HANDLE_OFFSET}px` }; cursor = 'nwse-resize'; }
            if (corner === 'tr') { posStyle = { top: `${HANDLE_OFFSET}px`, right: `${HANDLE_OFFSET}px` }; cursor = 'nesw-resize'; }
            if (corner === 'bl') { posStyle = { bottom: `${HANDLE_OFFSET}px`, left: `${HANDLE_OFFSET}px` }; cursor = 'nesw-resize'; }
            if (corner === 'br') { posStyle = { bottom: `${HANDLE_OFFSET}px`, right: `${HANDLE_OFFSET}px` }; cursor = 'nwse-resize'; }
            
            return (
              <HandleComponent
                key={corner}
                positionStyle={posStyle}
                onMouseDown={(e) => handleInteractionStart(e, 'scale', corner)}
                title="Scale Proportional"
                cursor={cursor}
                className="bg-primary" // Make corner handles distinct
                isCorner // True for circular style
              />
            );
          })}

          {/* Edge Resize Handles (Non-Proportional) */}
          {(['t', 'b', 'l', 'r'] as HandleType[]).map(edge => {
            let posStyle: React.CSSProperties = {};
            let cursor = 'default';
            if (edge === 't') { posStyle = { top: `${HANDLE_OFFSET}px`, left: `calc(50% - ${HANDLE_SIZE_BASE/2}px)`}; cursor = 'ns-resize'; }
            if (edge === 'b') { posStyle = { bottom: `${HANDLE_OFFSET}px`, left: `calc(50% - ${HANDLE_SIZE_BASE/2}px)`}; cursor = 'ns-resize'; }
            if (edge === 'l') { posStyle = { left: `${HANDLE_OFFSET}px`, top: `calc(50% - ${HANDLE_SIZE_BASE/2}px)`}; cursor = 'ew-resize'; }
            if (edge === 'r') { posStyle = { right: `${HANDLE_OFFSET}px`, top: `calc(50% - ${HANDLE_SIZE_BASE/2}px)`}; cursor = 'ew-resize'; }

             return (
              <HandleComponent
                key={edge}
                positionStyle={posStyle}
                onMouseDown={(e) => handleInteractionStart(e, 'resize', edge)}
                title="Resize"
                cursor={cursor}
                isCorner={false} // Square style
              />
            );
          })}

          {/* Rotate Handle */}
          <HandleComponent
            positionStyle={{
              top: `${HANDLE_OFFSET - (HANDLE_SIZE_BASE * 1.5)}px`, // Position further above
              left: `calc(50% - ${HANDLE_SIZE_BASE/2}px)`,
              cursor: 'grab', // Changed from crosshair to grab
            }}
            onMouseDown={(e) => handleInteractionStart(e, 'rotate', 'rotate')}
            title="Rotate"
            className="rounded-full"
          >
            <RotateCcwIcon className={cn(iconSizeClass, "text-primary")} />
          </HandleComponent>
          
          {/* Delete Handle */}
          <HandleComponent
             positionStyle={{
                // Position it away from a corner scale handle, e.g., top-right but offset
                top: `${HANDLE_OFFSET}px`, 
                right: `${HANDLE_OFFSET - HANDLE_SIZE_BASE - (HANDLE_SIZE_BASE * 0.5)}px`, // Further offset from TR corner
                cursor: 'pointer',
             }}
             onMouseDown={(e) => {
                e.stopPropagation(); // Prevent triggering artboard/element selection
                onDeleteElement(element.id);
             }}
             title="Delete Element"
             className="bg-destructive hover:bg-destructive/80 rounded-full" // Make it circular too
           >
            <Trash2Icon className={cn(iconSizeClass, "text-destructive-foreground")} />
          </HandleComponent>
        </>
      )}
    </div>
  );
}

