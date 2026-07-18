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

const HANDLE_SIZE_BASE = 10;
const HANDLE_OFFSET = -HANDLE_SIZE_BASE / 2;
const MIN_DISPLAY_SIZE = 20;

// Fingers need bigger grab targets than a mouse cursor. Evaluated per bundle
// load; handles only render client-side (isSelected), so no hydration risk.
const IS_COARSE_POINTER =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

// Screen pixels a pointer must travel before a tap turns into a move, so
// selecting an element never nudges it by a jittery pixel.
const DRAG_START_THRESHOLD_PX = 3;

type HandleType = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | 'rotate';

// Update the constant for the display scale factor
const DISPLAY_SCALE_FACTOR = 0.3; // 30% of original size

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
  const [currentScale, setCurrentScale] = useState<number>(element.scale); 

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
  // The pointer driving the current interaction; other fingers are ignored.
  const activePointerIdRef = useRef<number | null>(null);
  const dragStartClientRef = useRef<{ x: number; y: number } | null>(null);
  const movePassedThresholdRef = useRef(false);
  // Set once a gesture actually changed the element, so the click the browser
  // synthesizes at pointerup doesn't also trigger whatever is under the pointer.
  const didDragRef = useRef(false);

  useEffect(() => {
    setPosition(element.position);
    setCurrentSize(element.size);
    setCurrentRotation(element.rotation);
    setCurrentScale(element.scale);
  }, [element.id, element.position, element.size, element.rotation, element.scale]);

  const getPointerPositionInArtboardSpace = (e: { clientX: number; clientY: number }): Point => {
    const artboardDiv = elementRef.current?.offsetParent as HTMLElement | null;
    if (artboardDiv) {
      const artboardRect = artboardDiv.getBoundingClientRect();
      // Derive the on-screen scale from the artboard's rendered size so the
      // math holds at every canvas zoom (buttons, pinch, trackpad), which the
      // fixed DISPLAY_SCALE_FACTOR constant alone does not.
      const originalWidth = Number(artboardDiv.getAttribute('data-original-width'));
      const renderedScale =
        artboardRect.width > 0 && originalWidth > 0
          ? artboardRect.width / originalWidth
          : artboardZoom * DISPLAY_SCALE_FACTOR;
      return {
        x: (e.clientX - artboardRect.left) / renderedScale,
        y: (e.clientY - artboardRect.top) / renderedScale,
      };
    }
    return {
      x: e.clientX / (artboardZoom * DISPLAY_SCALE_FACTOR),
      y: e.clientY / (artboardZoom * DISPLAY_SCALE_FACTOR)
    };
  };


  const handleInteractionStart = (
    e: React.PointerEvent,
    mode: 'move' | 'rotate' | 'scale' | 'resize',
    handleType?: HandleType
  ) => {
    // One gesture at a time; a second finger belongs to the canvas pinch
    if (interactionMode) return;
    // Only the left mouse button drags; right-click opens the context menu.
    // Touch and pen always drag.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Mouse only: prevents text selection and native image drag. For touch,
    // canceling pointerdown makes Chromium suppress the whole touch-event
    // stream, which would break the canvas pinch and long-press detection;
    // scrolling and selection are already blocked by touch-action/user-select.
    if (e.pointerType === 'mouse') e.preventDefault();
    e.stopPropagation();
    if (!elementRef.current) return;

    if (!isSelected) {
      onSelect(element.id, e);
    }
    activePointerIdRef.current = e.pointerId;
    dragStartClientRef.current = { x: e.clientX, y: e.clientY };
    movePassedThresholdRef.current = mode !== 'move';
    didDragRef.current = false;
    setInteractionMode(mode);

    const mousePosArtboard = getPointerPositionInArtboardSpace(e);
    
    const displayWidth = currentSize.width * currentScale;
    const displayHeight = currentSize.height * currentScale;

    setInteractionStart({
      mouseX: mousePosArtboard.x,
      mouseY: mousePosArtboard.y,
      initialPosition: { ...position },
      initialSize: { ...currentSize }, 
      initialRotation: currentRotation,
      initialScale: currentScale, 
      elementCenter: {
        x: position.x + displayWidth / 2,
        y: position.y + displayHeight / 2,
      },
      handleType: handleType,
    });
  };

  useEffect(() => {
    // Drop the in-flight interaction without committing (browser stole the
    // gesture, or a two-finger canvas pinch started mid drag)
    const abortInteraction = () => {
      setPosition(element.position);
      setCurrentSize(element.size);
      setCurrentRotation(element.rotation);
      setCurrentScale(element.scale);
      setInteractionMode(null);
      setInteractionStart(null);
      activePointerIdRef.current = null;
      document.body.style.cursor = 'default';
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!interactionMode || !interactionStart || !elementRef.current) return;
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
      if (document.documentElement.hasAttribute('data-abs-pinch')) {
        abortInteraction();
        return;
      }
      e.preventDefault();

      // A tap must stay a tap: ignore sub-threshold movement before a move
      if (!movePassedThresholdRef.current) {
        const start = dragStartClientRef.current;
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START_THRESHOLD_PX) {
          return;
        }
        movePassedThresholdRef.current = true;
      }
      didDragRef.current = true;

      const mousePosArtboard = getPointerPositionInArtboardSpace(e);
      const { initialPosition, initialSize, initialRotation, initialScale, elementCenter, handleType } = interactionStart;
      
      const rad = currentRotation * (Math.PI / 180); 
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);

      const dxScreen = mousePosArtboard.x - interactionStart.mouseX;
      const dyScreen = mousePosArtboard.y - interactionStart.mouseY;

      let newPos = { ...position };
      let newSize = { ...currentSize };
      let newScale = currentScale;
      let newRotation = currentRotation;


      if (interactionMode === 'move') {
        newPos = { x: initialPosition.x + dxScreen, y: initialPosition.y + dyScreen };
        // No clamping on position, artboard's overflow:hidden will clip.
      } else if (interactionMode === 'rotate') {
        const angle = Math.atan2(mousePosArtboard.y - elementCenter.y, mousePosArtboard.x - elementCenter.x) * (180 / Math.PI);
        const startAngle = Math.atan2(interactionStart.mouseY - elementCenter.y, interactionStart.mouseX - elementCenter.x) * (180 / Math.PI);
        newRotation = initialRotation + (angle - startAngle);
        newRotation = Math.round(newRotation / 1) * 1; 

      } else if (interactionMode === 'scale' && handleType && ['tl', 'tr', 'bl', 'br'].includes(handleType)) { 
        const initialDistToCenter = Math.sqrt(Math.pow(interactionStart.mouseX - elementCenter.x, 2) + Math.pow(interactionStart.mouseY - elementCenter.y, 2));
        const currentDistToCenter = Math.sqrt(Math.pow(mousePosArtboard.x - elementCenter.x, 2) + Math.pow(mousePosArtboard.y - elementCenter.y, 2));

        if (initialDistToCenter === 0) return;
        let scaleFactor = currentDistToCenter / initialDistToCenter;
        let proposedNewUniformScale = initialScale * scaleFactor;
        
        proposedNewUniformScale = Math.max(0.05, Math.min(proposedNewUniformScale, 20));

        let newDisplayWidth = initialSize.width * proposedNewUniformScale;
        let newDisplayHeight = initialSize.height * proposedNewUniformScale;

        if (newDisplayWidth < MIN_DISPLAY_SIZE) {
            proposedNewUniformScale = MIN_DISPLAY_SIZE / initialSize.width;
        }
        if (newDisplayHeight < MIN_DISPLAY_SIZE) {
            proposedNewUniformScale = Math.max(proposedNewUniformScale, MIN_DISPLAY_SIZE / initialSize.height); // Ensure height doesn't force smaller scale than width
        }
        proposedNewUniformScale = Math.max(0.05, proposedNewUniformScale);

        newDisplayWidth = initialSize.width * proposedNewUniformScale;
        newDisplayHeight = initialSize.height * proposedNewUniformScale;
        
        let newPosX = elementCenter.x - newDisplayWidth / 2;
        let newPosY = elementCenter.y - newDisplayHeight / 2;
        
        // Boundary influence on scale (optional, could be removed for full freedom)
        // This attempts to stop scaling if an edge is "pushed" beyond a boundary.
        // if (newPosX < 0) { 
        //     if (initialSize.width > 0) proposedNewUniformScale = (elementCenter.x) * 2 / initialSize.width;
        // }
        // if (newPosY < 0) { 
        //     if (initialSize.height > 0) proposedNewUniformScale = (elementCenter.y) * 2 / initialSize.height;
        // }
        // if (newPosX + newDisplayWidth > boundary.width) {
        //     if (initialSize.width > 0) proposedNewUniformScale = (boundary.width - newPosX) / initialSize.width;
        // }
        // if (newPosY + newDisplayHeight > boundary.height) {
        //     if (initialSize.height > 0) proposedNewUniformScale = (boundary.height - newPosY) / initialSize.height;
        // }
        
        newScale = Math.max(0.05, Math.min(proposedNewUniformScale, 20));
        newDisplayWidth = initialSize.width * newScale;
        newDisplayHeight = initialSize.height * newScale;
        newPosX = elementCenter.x - newDisplayWidth / 2; // Recalculate position based on final scale
        newPosY = elementCenter.y - newDisplayHeight / 2;
        
        newPos.x = newPosX;
        newPos.y = newPosY;
       
      } else if (interactionMode === 'resize' && handleType) { 
        let currentDisplayWidth = initialSize.width * initialScale;
        let currentDisplayHeight = initialSize.height * initialScale;
        let newX = initialPosition.x;
        let newY = initialPosition.y;

        if (handleType === 'r') {
            let targetDisplayWidth = currentDisplayWidth + dxScreen;
            if (targetDisplayWidth < MIN_DISPLAY_SIZE) targetDisplayWidth = MIN_DISPLAY_SIZE;
            newSize.width = targetDisplayWidth / initialScale;
        } else if (handleType === 'l') {
            let targetDisplayWidth = currentDisplayWidth - dxScreen;
            if (targetDisplayWidth < MIN_DISPLAY_SIZE) {
                newX = initialPosition.x + (currentDisplayWidth - MIN_DISPLAY_SIZE);
                targetDisplayWidth = MIN_DISPLAY_SIZE;
            } else {
                newX = initialPosition.x + dxScreen;
            }
            newSize.width = targetDisplayWidth / initialScale;
            newPos.x = newX;
        } else if (handleType === 'b') {
            let targetDisplayHeight = currentDisplayHeight + dyScreen;
            if (targetDisplayHeight < MIN_DISPLAY_SIZE) targetDisplayHeight = MIN_DISPLAY_SIZE;
            newSize.height = targetDisplayHeight / initialScale;
        } else if (handleType === 't') {
            let targetDisplayHeight = currentDisplayHeight - dyScreen;
             if (targetDisplayHeight < MIN_DISPLAY_SIZE) {
                newY = initialPosition.y + (currentDisplayHeight - MIN_DISPLAY_SIZE);
                targetDisplayHeight = MIN_DISPLAY_SIZE;
            } else {
                newY = initialPosition.y + dyScreen;
            }
            newSize.height = targetDisplayHeight / initialScale;
            newPos.y = newY;
        }
      }
      
      setPosition(newPos);
      setCurrentSize(newSize);
      setCurrentScale(newScale);
      setCurrentRotation(newRotation);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!interactionMode || !interactionStart) return;
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;

      // Only update if there was actually a change
      const hasPositionChanged = position.x !== element.position.x || position.y !== element.position.y;
      const hasSizeChanged = currentSize.width !== element.size.width || currentSize.height !== element.size.height;
      const hasRotationChanged = currentRotation !== element.rotation;
      const hasScaleChanged = currentScale !== element.scale;
      
      if (hasPositionChanged || hasSizeChanged || hasRotationChanged || hasScaleChanged) {
        onUpdateElement({ 
          ...element, 
          position, 
          size: currentSize, 
          rotation: currentRotation, 
          scale: currentScale 
        });
      }
      
      setInteractionMode(null);
      setInteractionStart(null);
      activePointerIdRef.current = null;
      document.body.style.cursor = 'default';
    };

    const handlePointerCancel = (e: PointerEvent) => {
      if (!interactionMode) return;
      if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
      abortInteraction();
    };

    if (interactionMode) {
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerCancel);
      let cursor = 'default';
      if (interactionMode === 'move') cursor = 'grabbing';
      else if (interactionMode === 'rotate') cursor = 'grabbing'; 
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
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
      if (document.body.style.cursor !== 'default' && !interactionMode) {
        document.body.style.cursor = 'default';
      }
    };
  }, [interactionMode, interactionStart, element, onUpdateElement, artboardZoom, boundary, position, currentSize, currentRotation, currentScale, onSelect]);


  const displaySize = {
    width: currentSize.width * currentScale,
    height: currentSize.height * currentScale,
  };

  // Adjust handle sizes to be visible at small scale; fingers get a bigger
  // multiplier than a mouse cursor (plus the ::after hit inset in globals.css)
  const handleVisualScale = (IS_COARSE_POINTER ? 5 : 3) / artboardZoom;
  const outlineThickness = Math.max(1, 3 * (3 / artboardZoom));

  // On touch, edge handles on a small element would bury its body and turn
  // every drag into a resize; drop the edges that cannot fit next to the body
  // (corner scale, rotate and delete stay reachable outside the bounds).
  const handleArtboardSize = HANDLE_SIZE_BASE * handleVisualScale;
  const hideTopBottomHandles = IS_COARSE_POINTER && displaySize.height < handleArtboardSize * 2.5;
  const hideLeftRightHandles = IS_COARSE_POINTER && displaySize.width < handleArtboardSize * 2.5;


  const HandleComponent: React.FC<{
    positionStyle: React.CSSProperties;
    onPointerDown: (e: React.PointerEvent) => void;
    title: string;
    cursor: string;
    children?: React.ReactNode;
    className?: string;
    isCorner?: boolean;
  }> = ({ positionStyle, onPointerDown, title, cursor, children, className, isCorner = false }) => (
    <div
      data-interaction-handle
      className={cn(
        "absolute flex items-center justify-center bg-background border border-primary shadow-md opacity-90 hover:opacity-100",
        isCorner ? "rounded-full" : "rounded-sm",
        className
      )}
      style={{
        width: `${HANDLE_SIZE_BASE}px`,
        height: `${HANDLE_SIZE_BASE}px`,
        transform: `scale(${handleVisualScale})`,
        cursor: cursor,
        touchAction: 'none',
        ...positionStyle,
      }}
      onPointerDown={onPointerDown}
      title={title}
    >
      {children}
    </div>
  );
  
  const iconSizeClass = "w-2 h-2"; 

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
        // One finger on an element drags it; the browser must not scroll
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        // Handles start their own interaction; native controls inside the
        // element (upload buttons, the text editing textarea) keep working.
        if (target.closest('[data-interaction-handle]')) return;
        if (target.closest('button, input, textarea, select, [contenteditable="true"]')) return;
        e.stopPropagation(); // Prevent event from bubbling to artboard
        // Select and start moving in the same gesture (essential on touch,
        // where there is no separate hover/press affordance)
        handleInteractionStart(e, 'move');
      }}
      onClickCapture={(e) => {
        // The click the browser synthesizes after a drag must not activate
        // whatever ended up under the pointer
        if (didDragRef.current) {
          didDragRef.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      data-element-id={element.id}
      className="group" 
    >
      {isSelected && (
        <>
          {/* SVG selection outline for better rendering with transforms */}
          {element.type === 'device' && element.styleType && element.styleType !== 'normal' ? (
            <svg
              data-export-exclude
              className="absolute inset-0 pointer-events-none"
              style={{
                width: '100%',
                height: '100%',
                overflow: 'visible',
              }}
            >
              <rect 
                x="0" 
                y="0" 
                width="100%" 
                height="100%" 
                fill="none" 
                stroke="hsl(var(--primary))" 
                strokeWidth={outlineThickness} 
                vectorEffect="non-scaling-stroke"
                shapeRendering="geometricPrecision"
                rx="4" 
                ry="4" 
              />
            </svg>
          ) : (
            <div
              data-export-exclude
              className="absolute inset-0 pointer-events-none"
              style={{
                outline: `${outlineThickness}px solid hsl(var(--primary))`,
                outlineOffset: `${-outlineThickness}px`,
              }}
            />
          )}
        </>
      )}

      <div style={{ width: '100%', height: '100%', pointerEvents: interactionMode || !isSelected ? 'none' : 'auto' }}>
        {children}
      </div>

      {isSelected && (
        <>
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
                onPointerDown={(e) => handleInteractionStart(e, 'scale', corner)}
                title="Scale Proportional"
                cursor={cursor}
                className="bg-primary rounded-full" 
                isCorner 
              />
            );
          })}

          {(['t', 'b', 'l', 'r'] as HandleType[])
            .filter((edge) =>
              edge === 't' || edge === 'b' ? !hideTopBottomHandles : !hideLeftRightHandles
            )
            .map(edge => {
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
                onPointerDown={(e) => handleInteractionStart(e, 'resize', edge)}
                title="Resize"
                cursor={cursor}
                className="rounded-sm"
                isCorner={false} 
              />
            );
          })}

          <HandleComponent
            positionStyle={{
              // Farther out on touch so its enlarged hit area clears the body
              top: `${HANDLE_OFFSET - (HANDLE_SIZE_BASE * (IS_COARSE_POINTER ? 3 : 1.5))}px`,
              left: `calc(50% - ${HANDLE_SIZE_BASE/2}px)`,
            }}
            onPointerDown={(e) => handleInteractionStart(e, 'rotate', 'rotate')}
            title="Rotate"
            cursor="grab"
            className="rounded-full"
          >
            <RotateCcwIcon className={cn(iconSizeClass, "text-primary")} />
          </HandleComponent>
          
          <HandleComponent
             positionStyle={{
                top: `${HANDLE_OFFSET}px`, 
                right: `${HANDLE_OFFSET - HANDLE_SIZE_BASE - (HANDLE_SIZE_BASE * 0.5)}px`, 
             }}
             onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onDeleteElement(element.id);
             }}
             title="Delete Element"
             cursor="pointer"
             className="bg-destructive hover:bg-destructive/80 rounded-full" 
           >
            <Trash2Icon className={cn(iconSizeClass, "text-destructive-foreground")} />
          </HandleComponent>
        </>
      )}
    </div>
  );
}
