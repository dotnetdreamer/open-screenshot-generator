
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
const MIN_DISPLAY_SIZE = 20; // Minimum display width/height in pixels

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
  const [currentSize, setCurrentSize] = useState<Size>(element.size);
  const [currentRotation, setCurrentRotation] = useState<number>(element.rotation);
  const [currentScale, setCurrentScale] = useState<number>(element.scale); // Uniform scale

  const [interactionMode, setInteractionMode] = useState<'move' | 'rotate' | 'scale' | 'resize' | null>(null);
  const [interactionStart, setInteractionStart] = useState<{
    mouseX: number;
    mouseY: number;
    initialPosition: Point;
    initialSize: Size;
    initialRotation: number;
    initialScale: number;
    elementCenter: Point;
    handleType?: HandleType;
  } | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPosition(element.position);
    setCurrentSize(element.size);
    setCurrentRotation(element.rotation);
    setCurrentScale(element.scale);
  }, [element.position, element.size, element.rotation, element.scale]);

  const getMousePositionInArtboardSpace = (e: MouseEvent | React.MouseEvent): Point => {
    const artboardDiv = elementRef.current?.offsetParent; // This should be the div with artboard.zoom scale
    if (artboardDiv) {
      const artboardRect = artboardDiv.getBoundingClientRect();
      // The artboard itself is scaled by artboard.zoom, which is different from canvasZoom.
      // Here, we are interested in positions *within* an artboard, relative to its top-left.
      // The DraggableElement positions (element.position.x/y) are in the artboard's own coordinate system.
      // The artboard's content is scaled by artboard.zoom (internal artboard zoom, not canvasZoom).
      // However, DraggableElement itself receives artboardZoom, which seems to be the canvasZoom.
      // For calculations within DraggableElement, we need positions relative to the artboard's unscaled coordinate system.
      
      // Let's assume the artboardZoom prop IS the zoom level of the container holding this DraggableElement (i.e., canvasZoom).
      // The element.position is already in unscaled artboard coordinates.
      // So, clientX/Y needs to be mapped to that.
      return {
        x: (e.clientX - artboardRect.left) / artboardZoom,
        y: (e.clientY - artboardRect.top) / artboardZoom,
      };
    }
    // Fallback, less accurate if artboardRef's parent is not the direct scaled container
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

    if (mode !== 'move' || !isSelected) {
      onSelect(element.id, e);
    }
    setInteractionMode(mode);

    const mousePosArtboard = getMousePositionInArtboardSpace(e);
    
    const initialDisplayWidth = currentSize.width * currentScale;
    const initialDisplayHeight = currentSize.height * currentScale;

    setInteractionStart({
      mouseX: mousePosArtboard.x,
      mouseY: mousePosArtboard.y,
      initialPosition: { ...position },
      initialSize: { ...currentSize },
      initialRotation: currentRotation,
      initialScale: currentScale,
      elementCenter: {
        x: position.x + initialDisplayWidth / 2,
        y: position.y + initialDisplayHeight / 2,
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
      
      const rad = currentRotation * (Math.PI / 180);
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);

      const dxScreen = mousePosArtboard.x - interactionStart.mouseX;
      const dyScreen = mousePosArtboard.y - interactionStart.mouseY;

      if (interactionMode === 'move') {
        let newX = initialPosition.x + dxScreen;
        let newY = initialPosition.y + dyScreen;
        
        const displayW = currentSize.width * currentScale;
        const displayH = currentSize.height * currentScale;

        newX = Math.max(0, Math.min(newX, boundary.width - displayW));
        newY = Math.max(0, Math.min(newY, boundary.height - displayH));
        setPosition({ x: newX, y: newY });

      } else if (interactionMode === 'rotate') {
        const angle = Math.atan2(mousePosArtboard.y - elementCenter.y, mousePosArtboard.x - elementCenter.x) * (180 / Math.PI);
        const startAngle = Math.atan2(interactionStart.mouseY - elementCenter.y, interactionStart.mouseX - elementCenter.x) * (180 / Math.PI);
        let newRotation = initialRotation + (angle - startAngle);
        setCurrentRotation(Math.round(newRotation / 1) * 1);

      } else if (interactionMode === 'scale' && handleType && ['tl', 'tr', 'bl', 'br'].includes(handleType)) { // Proportional corner scaling
        const initialDistToCenter = Math.sqrt(Math.pow(interactionStart.mouseX - elementCenter.x, 2) + Math.pow(interactionStart.mouseY - elementCenter.y, 2));
        const currentDistToCenter = Math.sqrt(Math.pow(mousePosArtboard.x - elementCenter.x, 2) + Math.pow(mousePosArtboard.y - elementCenter.y, 2));

        if (initialDistToCenter === 0) return;
        let scaleFactor = currentDistToCenter / initialDistToCenter;
        let newUniformScale = initialScale * scaleFactor;
        newUniformScale = Math.max(0.05, Math.min(newUniformScale, 20)); // Min/max uniform scale

        // Ensure minimum display size
        if (initialSize.width * newUniformScale < MIN_DISPLAY_SIZE) {
            newUniformScale = MIN_DISPLAY_SIZE / initialSize.width;
        }
        if (initialSize.height * newUniformScale < MIN_DISPLAY_SIZE) {
            newUniformScale = MIN_DISPLAY_SIZE / initialSize.height;
        }
        newUniformScale = Math.max(0.05, newUniformScale); // re-check min scale

        const newDisplayWidth = initialSize.width * newUniformScale;
        const newDisplayHeight = initialSize.height * newUniformScale;

        let newPosX = elementCenter.x - newDisplayWidth / 2;
        let newPosY = elementCenter.y - newDisplayHeight / 2;

        // Boundary checks - adjust scale if necessary
        if (newPosX < 0) { newUniformScale = (elementCenter.x * 2) / initialSize.width; newPosX = 0; }
        if (newPosY < 0) { newUniformScale = (elementCenter.y * 2) / initialSize.height; newPosY = 0; }
        if (newPosX + (initialSize.width * newUniformScale) > boundary.width) { newUniformScale = ((boundary.width - elementCenter.x) * 2) / initialSize.width; }
        if (newPosY + (initialSize.height * newUniformScale) > boundary.height) { newUniformScale = ((boundary.height - elementCenter.y) * 2) / initialSize.height; }
        newUniformScale = Math.max(0.05, newUniformScale);


        const finalNewDisplayWidth = initialSize.width * newUniformScale;
        const finalNewDisplayHeight = initialSize.height * newUniformScale;
        newPosX = elementCenter.x - finalNewDisplayWidth / 2;
        newPosY = elementCenter.y - finalNewDisplayHeight / 2;
        
        // Clamp position after scale adjustment
        newPosX = Math.max(0, Math.min(newPosX, boundary.width - finalNewDisplayWidth));
        newPosY = Math.max(0, Math.min(newPosY, boundary.height - finalNewDisplayHeight));

        setCurrentScale(newUniformScale);
        setPosition({ x: newPosX, y: newPosY });
        // currentSize remains initialSize for uniform scaling

      } else if (interactionMode === 'resize' && handleType) { // Non-proportional edge resizing
        let newPos = { ...position };
        let newSize = { ...currentSize };

        // Deltas in element's local unrotated coordinate system
        // (approximated for now, works best for unrotated elements)
        const localDx = dxScreen * cosR + dyScreen * sinR;
        const localDy = -dxScreen * sinR + dyScreen * cosR;

        const initialDisplayW = initialSize.width * initialScale;
        const initialDisplayH = initialSize.height * initialScale;

        if (handleType === 'r') {
            let newDisplayW = initialDisplayW + localDx;
            newDisplayW = Math.max(MIN_DISPLAY_SIZE, newDisplayW);
            newSize.width = newDisplayW / initialScale;
        } else if (handleType === 'l') {
            let newDisplayW = initialDisplayW - localDx;
            newDisplayW = Math.max(MIN_DISPLAY_SIZE, newDisplayW);
            newSize.width = newDisplayW / initialScale;
            // Adjust position to keep right edge fixed (approximately)
            newPos.x = initialPosition.x + (initialDisplayW - newDisplayW) * cosR / initialScale;
            newPos.y = initialPosition.y + (initialDisplayW - newDisplayW) * sinR / initialScale;
        } else if (handleType === 'b') {
            let newDisplayH = initialDisplayH + localDy;
            newDisplayH = Math.max(MIN_DISPLAY_SIZE, newDisplayH);
            newSize.height = newDisplayH / initialScale;
        } else if (handleType === 't') {
            let newDisplayH = initialDisplayH - localDy;
            newDisplayH = Math.max(MIN_DISPLAY_SIZE, newDisplayH);
            newSize.height = newDisplayH / initialScale;
            // Adjust position to keep bottom edge fixed (approximately)
            newPos.x = initialPosition.x - (initialDisplayH - newDisplayH) * sinR / initialScale;
            newPos.y = initialPosition.y + (initialDisplayH - newDisplayH) * cosR / initialScale;
        }

        // Boundary checks for size and position
        const finalDisplayW = newSize.width * currentScale;
        const finalDisplayH = newSize.height * currentScale;

        if (newPos.x < 0) { newPos.x = 0; }
        if (newPos.y < 0) { newPos.y = 0; }
        if (newPos.x + finalDisplayW > boundary.width) {
            if (handleType === 'l') { // Resizing from left, width shrinks
                 newSize.width = (boundary.width - newPos.x) / currentScale;
            } else { // Resizing from right, position fixed or width shrinks
                 newSize.width = (boundary.width - newPos.x) / currentScale;
            }
        }
        if (newPos.y + finalDisplayH > boundary.height) {
             if (handleType === 't') {
                 newSize.height = (boundary.height - newPos.y) / currentScale;
             } else {
                 newSize.height = (boundary.height - newPos.y) / currentScale;
             }
        }
        // Ensure minimum base size if scale is applied
        newSize.width = Math.max(MIN_DISPLAY_SIZE / currentScale, newSize.width);
        newSize.height = Math.max(MIN_DISPLAY_SIZE / currentScale, newSize.height);
        
        setCurrentSize(newSize);
        setPosition(newPos);
      }
    };

    const handleMouseUp = () => {
      if (!interactionMode || !interactionStart) return;
      onUpdateElement({ ...element, position, size: currentSize, rotation: currentRotation, scale: currentScale });
      setInteractionMode(null);
      setInteractionStart(null);
      document.body.style.cursor = 'default';
    };

    if (interactionMode) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      let cursor = 'default';
      if (interactionMode === 'move') cursor = 'grabbing';
      else if (interactionMode === 'rotate') cursor = 'crosshair'; // Or specific rotate cursor
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


  const displaySize = {
    width: currentSize.width * currentScale,
    height: currentSize.height * currentScale,
  };

  const handleVisualScale = 1 / artboardZoom; // Handles should visually stay same size on canvas zoom
  const outlineThickness = Math.max(1, 1 / (artboardZoom * currentScale));


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
      data-interaction-handle
      className={cn(
        "absolute flex items-center justify-center bg-background border border-primary shadow-md opacity-90 hover:opacity-100",
        isCorner ? "rounded-full" : "rounded-sm", // Circles for corners, squares for edges
        className
      )}
      style={{
        width: `${HANDLE_SIZE_BASE}px`,
        height: `${HANDLE_SIZE_BASE}px`,
        transform: `scale(${handleVisualScale})`,
        cursor: cursor,
        ...positionStyle,
      }}
      onMouseDown={onMouseDown}
      title={title}
    >
      {children}
    </div>
  );
  
  const iconSizeClass = "w-[6px] h-[6px]"; // Smaller icons for handles

  return (
    <div
      ref={elementRef}
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${displaySize.width}px`,
        height: `${displaySize.height}px`,
        transform: `rotate(${currentRotation}deg)`,
        transformOrigin: 'center center',
        cursor: isSelected && interactionMode === null ? 'grab' : (interactionMode ? document.body.style.cursor : 'pointer'),
        boxSizing: 'border-box',
      }}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('[data-interaction-handle]')) {
          if (isSelected) {
            handleInteractionStart(e, 'move');
          } else {
            onSelect(element.id, e);
          }
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
            outlineOffset: `${outlineThickness}px`,
          }}
        />
      )}

      {/* Element Content */}
      <div style={{ width: '100%', height: '100%', pointerEvents: interactionMode || !isSelected ? 'none' : 'auto' }}>
        {children}
      </div>

      {isSelected && (
        <>
          {/* Corner Scale Handles */}
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
                className="bg-primary"
                isCorner
              />
            );
          })}

          {/* Edge Resize Handles */}
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
              />
            );
          })}

          {/* Rotate Handle */}
          <HandleComponent
            positionStyle={{
              top: `${HANDLE_OFFSET - (HANDLE_SIZE_BASE * 1.5)}px`, // Position further above
              left: `calc(50% - ${HANDLE_SIZE_BASE/2}px)`,
              cursor: 'crosshair',
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
                top: `${HANDLE_OFFSET}px`, 
                right: `${HANDLE_OFFSET - HANDLE_SIZE_BASE - (HANDLE_SIZE_BASE * 0.5)}px`, // Offset from corner
                cursor: 'pointer',
             }}
             onMouseDown={(e) => {
                e.stopPropagation();
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
