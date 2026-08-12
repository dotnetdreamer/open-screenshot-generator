"use client";
import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { elementVisualStyle } from '@/lib/elementStyle';
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

type HandleType = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | 'rotate';

// Update the constant for the display scale factor
const DISPLAY_SCALE_FACTOR = 0.3; // 30% of original size

// A press has to travel this far on screen before it counts as a drag. Below
// it the press is only a selection, so a twitchy mouse can no longer leave an
// element rotated by a degree or nudged by a pixel on what was meant as a click.
const DRAG_THRESHOLD_PX = 3;

// Holding Shift while rotating lands on clean angles (and back on 0) instead of
// creeping one degree at a time.
const ROTATION_SNAP_DEGREES = 15;

// The rotate handle used to be `cursor: grab` — the same hand the element body
// shows for "drag me somewhere else" — sitting flush against the top edge, so
// it read as the move affordance and aiming at the top of a short text box
// rotated it instead. A circular arrow says which control this is before the
// press lands. White halo under a dark stroke so it reads on any artboard.
const ROTATE_CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  '<g stroke="#ffffff" stroke-width="4"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.06 6.67 2.82L21 8"/><path d="M21 3v5h-5"/></g>' +
  '<g stroke="#18181b" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1.06 6.67 2.82L21 8"/><path d="M21 3v5h-5"/></g>' +
  '</svg>';
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_CURSOR_SVG)}") 12 12, crosshair`;

// Hoisted out of the component on purpose: declared inline it was a new
// component type on every render, so React tore down and rebuilt all ten
// handles on every mousemove of a drag.
const HandleComponent: React.FC<{
  positionStyle: React.CSSProperties;
  visualScale: number;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  title: string;
  cursor: string;
  children?: React.ReactNode;
  className?: string;
  isCorner?: boolean;
}> = ({ positionStyle, visualScale, onMouseDown, onClick, title, cursor, children, className, isCorner = false }) => (
  <div
    data-interaction-handle
    data-export-exclude
    className={cn(
      "absolute flex items-center justify-center bg-background border border-primary shadow-md opacity-90 hover:opacity-100",
      isCorner ? "rounded-full" : "rounded-sm",
      className
    )}
    style={{
      width: `${HANDLE_SIZE_BASE}px`,
      height: `${HANDLE_SIZE_BASE}px`,
      transform: `scale(${visualScale})`,
      cursor: cursor,
      ...positionStyle,
    }}
    onMouseDown={onMouseDown}
    onClick={onClick}
    title={title}
  >
    {children}
  </div>
);

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
    screenX: number;
    screenY: number;
  } | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);
  // Flipped once the press has travelled DRAG_THRESHOLD_PX. A ref, not state,
  // so arming does not re-run the listener effect mid-drag.
  const dragArmedRef = useRef(false);
  // The live transform, written synchronously by every mousemove. mouseup used
  // to commit whatever the last *render* held, which loses the final mousemove
  // whenever React is still flushing when the button comes up — the element
  // then lands a few pixels short of where it was dropped. Reading the ref
  // instead makes the commit exact.
  const latestRef = useRef({
    position: element.position,
    size: element.size,
    rotation: element.rotation,
    scale: element.scale,
  });

  useEffect(() => {
    setPosition(element.position);
    setCurrentSize(element.size);
    setCurrentRotation(element.rotation);
    setCurrentScale(element.scale);
    latestRef.current = {
      position: element.position,
      size: element.size,
      rotation: element.rotation,
      scale: element.scale,
    };
  }, [element.id, element.position, element.size, element.rotation, element.scale]);

  const getMousePositionInArtboardSpace = (e: MouseEvent | React.MouseEvent): Point => {
    const artboardDiv = elementRef.current?.offsetParent as HTMLElement | null;
    if (artboardDiv) {
      const artboardRect = artboardDiv.getBoundingClientRect();
      // Measure the scale rather than assuming it. The artboard is not only
      // drawn at DISPLAY_SCALE_FACTOR: CanvasArea wraps it in the canvas zoom
      // as well, so the old constant divisor was wrong the moment anyone
      // touched the zoom control, and the element raced ahead of (or lagged
      // behind) the cursor by exactly that factor. offsetWidth/Height are the
      // untransformed layout box, so the ratio is the real composite scale
      // however many transforms end up stacked above this element.
      const scaleX = artboardDiv.offsetWidth > 0 ? artboardRect.width / artboardDiv.offsetWidth : 1;
      const scaleY = artboardDiv.offsetHeight > 0 ? artboardRect.height / artboardDiv.offsetHeight : 1;
      return {
        x: (e.clientX - artboardRect.left) / (scaleX || 1),
        y: (e.clientY - artboardRect.top) / (scaleY || 1),
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
    handleType?: HandleType
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

    if (!isSelected) {
      onSelect(element.id, e);
    }
    setInteractionMode(mode);
    dragArmedRef.current = false;
    latestRef.current = {
      position: { ...position },
      size: { ...currentSize },
      rotation: currentRotation,
      scale: currentScale,
    };

    const mousePosArtboard = getMousePositionInArtboardSpace(e);

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
      screenX: e.clientX,
      screenY: e.clientY,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!interactionMode || !interactionStart || !elementRef.current) return;
      e.preventDefault();

      // Swallow the first few pixels. A click that only means "select this" no
      // longer commits a stray rotation or a one-pixel move on the way up.
      if (!dragArmedRef.current) {
        if (
          Math.abs(e.clientX - interactionStart.screenX) < DRAG_THRESHOLD_PX &&
          Math.abs(e.clientY - interactionStart.screenY) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        dragArmedRef.current = true;
      }

      const mousePosArtboard = getMousePositionInArtboardSpace(e);
      const { initialPosition, initialSize, initialRotation, initialScale, elementCenter, handleType } = interactionStart;

      const dxScreen = mousePosArtboard.x - interactionStart.mouseX;
      const dyScreen = mousePosArtboard.y - interactionStart.mouseY;

      // Base off the ref, not the render closure, for the same reason mouseup
      // does: a branch that leaves (say) rotation alone must carry forward the
      // live value, not one React has not re-rendered yet.
      let newPos = { ...latestRef.current.position };
      let newSize = { ...latestRef.current.size };
      let newScale = latestRef.current.scale;
      let newRotation = latestRef.current.rotation;


      if (interactionMode === 'move') {
        newPos = { x: initialPosition.x + dxScreen, y: initialPosition.y + dyScreen };
        // No clamping on position, artboard's overflow:hidden will clip.
      } else if (interactionMode === 'rotate') {
        const angle = Math.atan2(mousePosArtboard.y - elementCenter.y, mousePosArtboard.x - elementCenter.x) * (180 / Math.PI);
        const startAngle = Math.atan2(interactionStart.mouseY - elementCenter.y, interactionStart.mouseX - elementCenter.x) * (180 / Math.PI);
        newRotation = initialRotation + (angle - startAngle);
        newRotation = e.shiftKey
          ? Math.round(newRotation / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES
          : Math.round(newRotation);

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
      
      latestRef.current = { position: newPos, size: newSize, rotation: newRotation, scale: newScale };
      setPosition(newPos);
      setCurrentSize(newSize);
      setCurrentScale(newScale);
      setCurrentRotation(newRotation);
    };

    const handleMouseUp = () => {
      if (!interactionMode || !interactionStart) return;

      const live = latestRef.current;
      // Only update if there was actually a change
      const hasPositionChanged = live.position.x !== element.position.x || live.position.y !== element.position.y;
      const hasSizeChanged = live.size.width !== element.size.width || live.size.height !== element.size.height;
      const hasRotationChanged = live.rotation !== element.rotation;
      const hasScaleChanged = live.scale !== element.scale;

      if (hasPositionChanged || hasSizeChanged || hasRotationChanged || hasScaleChanged) {
        onUpdateElement({
          ...element,
          position: live.position,
          size: live.size,
          rotation: live.rotation,
          scale: live.scale,
        });
      }

      setInteractionMode(null);
      setInteractionStart(null);
      dragArmedRef.current = false;
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
    // Deliberately not depending on position/size/rotation/scale: the handlers
    // read those from latestRef, so listing them here would only tear down and
    // re-register the document listeners on every frame of a drag.
  }, [interactionMode, interactionStart, element, onUpdateElement, artboardZoom, boundary, onSelect]);


  const displaySize = {
    width: currentSize.width * currentScale,
    height: currentSize.height * currentScale,
  };

  // Adjust handle sizes to be visible at small scale
  const handleVisualScale = 3 / artboardZoom; // Increase from 1 to 3 to make handles more visible
  const outlineThickness = Math.max(1, 3 * handleVisualScale);

  // A handle's layout box is HANDLE_SIZE_BASE, but it is drawn — and hit-tested
  // — at handleVisualScale about its own centre, so this is what it actually
  // covers on the artboard.
  const handleFootprint = HANDLE_SIZE_BASE * handleVisualScale;
  // Rotate and Delete are not edge handles: they sit off the element entirely.
  // They used to be placed so their scaled boxes ended exactly on the edge,
  // which left no aiming margin at all — a press meant for the top of a short
  // text box landed on Rotate, and one meant for its top-right corner landed on
  // Delete. Park them a visible gap beyond the *edge handles*, not beyond the
  // edge: an edge handle straddles the border, so clearing only the border
  // still leaves Rotate all but touching the top resize grip.
  const satelliteGap = handleFootprint * 0.6;
  const satelliteClearance = handleFootprint / 2 + satelliteGap;
  const satelliteOffset = -HANDLE_SIZE_BASE / 2 - satelliteClearance - handleFootprint / 2;

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
        if (!(e.target as HTMLElement).closest('[data-interaction-handle]')) {
          e.stopPropagation(); // Prevent event from bubbling to artboard
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
                visualScale={handleVisualScale}
                onMouseDown={(e) => handleInteractionStart(e, 'scale', corner)}
                title="Scale Proportional"
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
                visualScale={handleVisualScale}
                onMouseDown={(e) => handleInteractionStart(e, 'resize', edge)}
                title="Resize"
                cursor={cursor}
                className="rounded-sm"
                isCorner={false}
              />
            );
          })}

          {/* Stem bridging the top resize grip and the rotate handle, so the
              handle reads as a control parked outside the element rather than
              as part of its top edge. */}
          <div
            data-export-exclude
            className="absolute pointer-events-none bg-primary/70"
            style={{
              left: '50%',
              top: `${-satelliteClearance}px`,
              width: `${Math.max(1, outlineThickness * 0.6)}px`,
              height: `${satelliteGap}px`,
              transform: 'translateX(-50%)',
            }}
          />

          <HandleComponent
            positionStyle={{
              top: `${satelliteOffset}px`,
              left: `calc(50% - ${HANDLE_SIZE_BASE/2}px)`,
            }}
            visualScale={handleVisualScale}
            onMouseDown={(e) => handleInteractionStart(e, 'rotate', 'rotate')}
            title="Rotate (hold Shift to snap to 15°)"
            cursor={ROTATE_CURSOR}
            className="rounded-full"
          >
            <RotateCcwIcon className={cn(iconSizeClass, "text-primary")} />
          </HandleComponent>

          <HandleComponent
             positionStyle={{
                top: `${HANDLE_OFFSET}px`,
                right: `${satelliteOffset}px`,
             }}
             visualScale={handleVisualScale}
             // Deleting fired on mousedown, so a press that slipped onto this
             // handle removed the element before the button came back up.
             // Swallow the press, act on the completed click.
             onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
             }}
             onClick={(e) => {
                e.stopPropagation();
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
