"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { elementVisualStyle } from '@/lib/elementStyle';
import { useT } from '@/i18n';
import type { ArtboardElement, Point, Size } from '@/types/artboard';

interface DraggableElementProps {
  element: ArtboardElement;
  isSelected: boolean;
  // modifiers.additive (Shift/Ctrl/Cmd click) toggles the element in/out of
  // the current selection; a plain click selects it alone.
  onSelect: (elementId: string, modifiers?: { additive?: boolean }) => void;
  onUpdateElement: (element: ArtboardElement) => void;
  onDeleteElement: (elementId: string) => void;
  artboardZoom: number;
  // Canvas-level zoom, only used to keep the selection handles a constant
  // on-screen size. Mouse conversion reads the rendered DOM instead.
  canvasZoom?: number;
  // Group-drag hooks, provided when this element may be part of a
  // multi-selection. onGroupDragStart returns true when a multi-selection is
  // active, in which case the parent translates the whole set and commits
  // once on onGroupDragEnd.
  onGroupDragStart?: (elementId: string) => boolean;
  onGroupDragMove?: (dx: number, dy: number) => void;
  onGroupDragEnd?: (dx: number, dy: number) => void;
  boundary: { width: number; height: number };
  children: React.ReactNode;
}

const HANDLE_SIZE_BASE = 10; 
const HANDLE_OFFSET = -HANDLE_SIZE_BASE / 2; 
const MIN_DISPLAY_SIZE = 20; 

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
  canvasZoom = 1,
  onGroupDragStart,
  onGroupDragMove,
  onGroupDragEnd,
  boundary,
  children
}: DraggableElementProps) {
  const t = useT();
  const scaleProportionalTitle = t('elements.scaleProportional');
  const resizeTitle = t('elements.resize');
  const rotateTitle = t('elements.rotate');
  const deleteTitle = t('elements.deleteElement');
  const [position, setPosition] = useState<Point>(element.position);
  const [currentSize, setCurrentSize] = useState<Size>(element.size); 
  const [currentRotation, setCurrentRotation] = useState<number>(element.rotation);
  const [currentScale, setCurrentScale] = useState<number>(element.scale); 

  const [interactionMode, setInteractionMode] = useState<'move' | 'rotate' | 'scale' | 'resize' | null>(null);
  const [interactionStart, setInteractionStart] = useState<{
    mouseX: number;
    mouseY: number;
    clientX: number;
    clientY: number;
    initialPosition: Point;
    initialSize: Size; 
    initialRotation: number;
    initialScale: number; 
    elementCenter: Point;
    handleType?: HandleType;
    // Move-mode extras: whether the whole selection is being translated by
    // the parent, and what a no-movement click means for the selection when
    // the gesture ends (modifier-click toggles off, plain click on a member
    // of a multi-selection collapses to it alone).
    groupDrag?: boolean;
    clickAction?: 'toggle-off' | 'collapse' | 'none';
  } | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);
  // Latest move delta during a group drag, so mouseup can hand the parent the
  // final translation for its single history commit.
  const groupDragDeltaRef = useRef<Point>({ x: 0, y: 0 });

  useEffect(() => {
    setPosition(element.position);
    setCurrentSize(element.size);
    setCurrentRotation(element.rotation);
    setCurrentScale(element.scale);
  }, [element.id, element.position, element.size, element.rotation, element.scale]);

  // Convert a mouse event to artboard coordinates via the artboard's rendered
  // size, which already includes the display scale, the canvas zoom and every
  // ancestor transform. Deriving the factor from the DOM (instead of dividing
  // by constants) keeps the cursor 1:1 with the dragged element at ANY zoom,
  // with sub-pixel precision.
  const getMousePositionInArtboardSpace = (e: MouseEvent | React.MouseEvent): Point => {
    const artboardDiv = (elementRef.current?.closest('[data-artboard-dom-id]') ??
      elementRef.current?.offsetParent) as HTMLElement | null;
    if (artboardDiv) {
      const artboardRect = artboardDiv.getBoundingClientRect();
      const originalWidth = Number(artboardDiv.getAttribute('data-original-width')) || boundary.width;
      const renderedScale = artboardRect.width > 0 && originalWidth > 0
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
    e: React.MouseEvent,
    mode: 'move' | 'rotate' | 'scale' | 'resize',
    handleType?: HandleType,
    options?: { clickAction?: 'toggle-off' | 'collapse' | 'none' }
  ) => {
    // Only the left button drags; right-click opens the context menu instead
    if (e.button !== 0) return;
    // preventDefault below suppresses the browser's native focus transfer,
    // which would otherwise blur (and thereby commit) an in-progress edit in
    // a side-panel input — e.g. the text Content field. Blur it explicitly
    // so pending edits are applied before the canvas interaction starts.
    // Focus inside this element (the inline text editor) is left alone.
    const active = document.activeElement as HTMLElement | null;
    if (
      active &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) &&
      !elementRef.current?.contains(active)
    ) {
      active.blur();
    }
    e.preventDefault();
    e.stopPropagation();
    if (!elementRef.current) return;

    // Handles (scale/rotate/resize) on an unselected element select it first;
    // move gestures manage their own selection before calling this.
    if (!isSelected && options?.clickAction === undefined) { 
      onSelect(element.id, { additive: false });
    }
    setInteractionMode(mode);

    // Moving an element that belongs to a multi-selection translates the
    // whole set; the parent drives the positions from here on.
    const groupDrag = mode === 'move' ? (onGroupDragStart?.(element.id) ?? false) : false;
    groupDragDeltaRef.current = { x: 0, y: 0 };

    const mousePosArtboard = getMousePositionInArtboardSpace(e);
    
    const displayWidth = currentSize.width * currentScale;
    const displayHeight = currentSize.height * currentScale;

    setInteractionStart({
      mouseX: mousePosArtboard.x,
      mouseY: mousePosArtboard.y,
      clientX: e.clientX,
      clientY: e.clientY,
      initialPosition: { ...position },
      initialSize: { ...currentSize }, 
      initialRotation: currentRotation,
      initialScale: currentScale, 
      elementCenter: {
        x: position.x + displayWidth / 2,
        y: position.y + displayHeight / 2,
      },
      handleType: handleType,
      groupDrag,
      clickAction: options?.clickAction,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!interactionMode || !interactionStart || !elementRef.current) return;
      e.preventDefault();

      const mousePosArtboard = getMousePositionInArtboardSpace(e);
      const { initialPosition, initialSize, initialRotation, initialScale, elementCenter, handleType } = interactionStart;
      // Ctrl/Cmd held = free precise movement: bypass any snapping or
      // rounding and keep full sub-pixel precision.
      const freeMovement = e.ctrlKey || e.metaKey;
      
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
        if (interactionStart.groupDrag) {
          // The parent translates every selected element by the same delta
          // and commits once on mouseup. Update this element's own position
          // too so the dragged one tracks the cursor in the same frame.
          groupDragDeltaRef.current = { x: dxScreen, y: dyScreen };
          onGroupDragMove?.(dxScreen, dyScreen);
          setPosition({ x: initialPosition.x + dxScreen, y: initialPosition.y + dyScreen });
          return;
        }
        newPos = { x: initialPosition.x + dxScreen, y: initialPosition.y + dyScreen };
        // No clamping on position, artboard's overflow:hidden will clip.
      } else if (interactionMode === 'rotate') {
        const angle = Math.atan2(mousePosArtboard.y - elementCenter.y, mousePosArtboard.x - elementCenter.x) * (180 / Math.PI);
        const startAngle = Math.atan2(interactionStart.mouseY - elementCenter.y, interactionStart.mouseX - elementCenter.x) * (180 / Math.PI);
        newRotation = initialRotation + (angle - startAngle);
        if (!freeMovement) {
          newRotation = Math.round(newRotation / 1) * 1; 
        }

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

    const handleMouseUp = (e: MouseEvent) => {
      if (!interactionMode || !interactionStart) return;

      // A click (no real movement) on a move interaction never commits; it
      // only adjusts the selection: modifier-click toggles the element off,
      // a plain click on a member of a multi-selection collapses to it alone.
      const movedDistance = Math.hypot(e.clientX - interactionStart.clientX, e.clientY - interactionStart.clientY);
      const wasClick = interactionMode === 'move' && movedDistance <= 3;

      if (wasClick) {
        if (interactionStart.clickAction === 'toggle-off') {
          onSelect(element.id, { additive: true });
        } else if (interactionStart.clickAction === 'collapse') {
          onSelect(element.id, { additive: false });
        }
        setInteractionMode(null);
        setInteractionStart(null);
        document.body.style.cursor = 'default';
        return;
      }

      if (interactionStart.groupDrag) {
        const delta = groupDragDeltaRef.current;
        onGroupDragEnd?.(delta.x, delta.y);
        groupDragDeltaRef.current = { x: 0, y: 0 };
        setInteractionMode(null);
        setInteractionStart(null);
        document.body.style.cursor = 'default';
        return;
      }

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
      document.body.style.cursor = 'default';
    };

    if (interactionMode) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
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
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (document.body.style.cursor !== 'default' && !interactionMode) {
        document.body.style.cursor = 'default';
      }
    };
  }, [interactionMode, interactionStart, element, onUpdateElement, artboardZoom, canvasZoom, boundary, position, currentSize, currentRotation, currentScale, onSelect, onGroupDragMove, onGroupDragEnd]);


  const displaySize = {
    width: currentSize.width * currentScale,
    height: currentSize.height * currentScale,
  };

  // Adjust handle sizes to be visible at small scale, and divide out the
  // canvas zoom so they stay a constant on-screen size at any zoom level.
  const handleVisualScale = 3 / (artboardZoom * canvasZoom); // Increase from 1 to 3 to make handles more visible
  const outlineThickness = Math.max(1, 3 * handleVisualScale);


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
        isCorner ? "rounded-full" : "rounded-sm", 
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
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-interaction-handle]')) return;
        if (e.button !== 0) return;
        e.stopPropagation(); // Prevent event from bubbling to artboard
        const additiveClick = e.shiftKey || e.ctrlKey || e.metaKey;
        if (additiveClick) {
          if (isSelected) {
            // Modifier+click on a selected element toggles it off, unless the
            // gesture turns into a drag (Ctrl+drag = free movement).
            handleInteractionStart(e, 'move', undefined, { clickAction: 'toggle-off' });
          } else {
            // Modifier+click on an unselected element adds it to the selection.
            onSelect(element.id, { additive: true });
            handleInteractionStart(e, 'move', undefined, { clickAction: 'none' });
          }
          return;
        }
        if (isSelected) {
          handleInteractionStart(e, 'move', undefined, { clickAction: 'collapse' });
        } else {
          onSelect(element.id, { additive: false }); 
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

      {/* Shadow/blur/opacity go on this wrapper, not on the outer box: that
          keeps the selection outline and the handles crisp while the rendered
          artwork picks up the treatment (and casts a silhouette-shaped
          shadow). See src/lib/elementStyle.ts. */}
      <div
        style={{
          width: '100%',
          height: '100%',
          pointerEvents: interactionMode || !isSelected ? 'none' : 'auto',
          ...elementVisualStyle(element),
        }}
      >
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
                onMouseDown={(e) => handleInteractionStart(e, 'scale', corner)}
                title={scaleProportionalTitle}
                cursor={cursor}
                className="bg-primary rounded-full" 
                isCorner 
              />
            );
          })}

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
                title={resizeTitle}
                cursor={cursor}
                className="rounded-sm"
                isCorner={false} 
              />
            );
          })}

          <HandleComponent
            positionStyle={{
              top: `${HANDLE_OFFSET - (HANDLE_SIZE_BASE * 1.5)}px`, 
              left: `calc(50% - ${HANDLE_SIZE_BASE/2}px)`,
            }}
            onMouseDown={(e) => handleInteractionStart(e, 'rotate', 'rotate')}
            title={rotateTitle}
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
             onMouseDown={(e) => {
                e.stopPropagation(); 
                onDeleteElement(element.id);
             }}
             title={deleteTitle}
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
