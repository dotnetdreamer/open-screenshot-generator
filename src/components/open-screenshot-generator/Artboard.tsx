"use client";

import type React from 'react';
import { useState, useEffect, useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
import { DraggableElement } from './elements/DraggableElement';
import { TextElement } from './elements/TextElement';
import { ShapeElement } from './elements/ShapeElement';
import { DeviceFrameElement } from './elements/DeviceFrameElement';
import { ImageElement } from './elements/ImageElement';
import { VideoElement } from './elements/VideoElement';
import { VideoDeviceElement } from './elements/VideoDeviceElement';
import { GestureElement } from './elements/GestureElement';
import type { ArtboardState as ArtboardType, ArtboardElement, Point, ElementType, ShapeType, DeviceType, DeviceFrameElementProps, ImageElementProps, ShapeElementProps, TextElementProps, VideoElementProps, VideoDeviceElementProps, GestureElementProps, GestureType } from '@/types/artboard';
import { useToast } from '@/hooks/use-toast';
import { artboardBackground } from '@/lib/artboardBackground';
import { ArtboardBackgroundImage } from './ArtboardBackgroundImage';
import { measureTextHeight } from '@/lib/textFit';
import { cn } from '@/lib/utils';
import { artboardTimeline } from '@/lib/video/timeline';
import { PREVIEW_SCENE_DRAG_TYPE } from '@/lib/previewScenes';
import { getPlayback, stopPlayback, togglePlayback, usePlaybackRunning } from '@/lib/video/playback';
import { ArtboardToolbar } from './ArtboardToolbar'; // Import the new toolbar
import { Input } from '@/components/ui/input';
import { EditIcon } from 'lucide-react';

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
  onTranslateArtboard?: (artboardId: string) => void;
  onExportArtboard?: (artboardId: string) => void;
  canDeleteArtboard: boolean;
  canMoveArtboardLeft: boolean;
  canMoveArtboardRight: boolean;
  /**
   * What the other people in a live session are doing on this board.
   *
   * A render function rather than a node, because the only sane place to draw a
   * peer's ring is inside the board's own coordinate space, and how big a
   * screen pixel is in there is something only this component measures
   * (`screenScale` below). Absent outside a session, which is the usual case.
   */
  renderCollabOverlay?: (context: { screenScale: number }) => React.ReactNode;
}

export interface ArtboardRef {
  addElement: (type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point, styleProps?: Record<string, any>) => string | undefined;
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
  onTranslateArtboard,
  onExportArtboard,
  canDeleteArtboard,
  canMoveArtboardLeft,
  canMoveArtboardRight,
  renderCollabOverlay,
}, ref) => {
  const [elements, setElements] = useState<ArtboardElement[]>(artboard.elements);
  const artboardDivRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  
  // State for artboard renaming
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState(artboard.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Use a ref to track client-side initialization
  const isClientInitialized = useRef(false);
  
  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Update local editing name when artboard name changes
  useEffect(() => {
    setEditingName(artboard.name);
  }, [artboard.name]);

  const handleDoubleClickName = () => {
    setIsEditingName(true);
    setEditingName(artboard.name);
  };

  const handleNameSubmit = () => {
    if (editingName.trim() && editingName.trim() !== artboard.name) {
      onUpdateArtboardDetails({ name: editingName.trim() });
    }
    setIsEditingName(false);
  };

  const handleNameCancel = () => {
    setEditingName(artboard.name);
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleNameCancel();
    }
  };

  // Function to get background style that handles CSS variables properly.
  // artboardBackground also repairs a half-filled gradient: an incomplete one
  // computes to background-image:none, which is how a board ends up rendering
  // (and exporting) flat white with nothing reporting an error.
  const getBackgroundStyle = (): React.CSSProperties => artboardBackground(artboard);

  const [backgroundStyle, setBackgroundStyle] = useState<React.CSSProperties>(getBackgroundStyle());

  useEffect(() => {
    // Mark as initialized on client-side
    isClientInitialized.current = true;
    
    setElements(artboard.elements);

    // Compute background style based on artboard settings
    setBackgroundStyle(artboardBackground(artboard));
  }, [artboard.elements, artboard.backgroundType, artboard.backgroundColor, artboard.backgroundGradient]);

  // Our own handle on the API below. The drop handler needs it, and it cannot
  // read `ref`: CanvasArea passes a CALLBACK ref (it files each board into a
  // map by id), so `ref` here is a function and `ref.current` is forever
  // undefined. A drop used to test exactly that and silently do nothing, which
  // is why a tile could only be added by clicking it.
  const selfRef = useRef<ArtboardRef | null>(null);

  useImperativeHandle(ref, () => {
    const api: ArtboardRef = {
    addElement: (type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point, styleProps?: Record<string, any>) => {
      const artboardRect = artboardDivRef.current?.getBoundingClientRect();
      let newElementX = artboard.size.width / 2 - 50; 
      let newElementY = artboard.size.height / 2 - 25;
      
      if (dropPosition && artboardRect) {
        // Adjust drop position to account for scaling
        newElementX = (dropPosition.x - artboardRect.left) / displayScaleFactor - 50;
        newElementY = (dropPosition.y - artboardRect.top) / displayScaleFactor - 25;
      }
      
      newElementX = Math.max(0, Math.min(newElementX, artboard.size.width - 100));
      newElementY = Math.max(0, Math.min(newElementY, artboard.size.height - 50));

      // Which palette tile this came from (see lib/libraryIds.ts). Rides in with
      // styleProps and sticks to the element so the Properties panel can name
      // the library item behind the layer.
      const libraryId = typeof styleProps?.libraryId === 'string' ? styleProps.libraryId : undefined;

      const newElementBase = {
        id: `el_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        position: { x: newElementX, y: newElementY },
        rotation: 0,
        scale: 1,
        ...(libraryId ? { libraryId } : {}),
      };

      let newElementToAdd: ArtboardElement | null = null;

      if (type === 'text') {
        // Increase default font size to account for scaling
        const textDefaults = {
          content: 'New Text',
          fontSize: 48, // Increased from 16 to be more visible at 0.3 scale
          fontFamily: 'Arial',
          scale: 1,
          lineHeight: 1.2,
        };
        // 48pt renders at 160px (fontSize / 0.3), so the old 400x100 box clipped
        // its own placeholder. Measure instead of guessing again: the box is
        // whatever one line of the default text actually needs.
        const textWidth = 700;
        const measured = measureTextHeight(
          { ...textDefaults, size: { width: textWidth, height: 0 } },
          textDefaults.content
        );
        const textSize = { width: textWidth, height: Math.ceil(measured) || 200 };
        newElementToAdd = {
          ...newElementBase,
          position: {
            x: Math.max(0, Math.min(newElementBase.position.x, artboard.size.width - textSize.width)),
            y: Math.max(0, Math.min(newElementBase.position.y, artboard.size.height - textSize.height)),
          },
          type: 'text',
          content: textDefaults.content,
          fontSize: textDefaults.fontSize,
          color: '#333333',
          fontFamily: textDefaults.fontFamily,
          size: textSize,
        } as TextElementProps;
      } else if (type === 'image') {
        const imageProps: ImageElementProps = {
          ...newElementBase,
          type: 'image',
          size: { width: 400, height: 300 },  // Default image size
          objectFit: 'cover' as const,
          opacity: 1,
          borderRadius: 0,
          // Transform properties with default values
          skewX: 0,
          skewY: 0,
          perspectiveX: 0,
          perspectiveY: 0,
          matrix3d: '',
        };
        // Palette presets (Images library) provide a ready-made asset
        if (styleProps) {
          if (typeof styleProps.imageSrc === 'string') {
            imageProps.imageSrc = styleProps.imageSrc;
            imageProps.objectFit = 'contain';
          }
          if (typeof styleProps.imageAlt === 'string') {
            imageProps.imageAlt = styleProps.imageAlt;
          }
          if (typeof styleProps.name === 'string' && styleProps.name) {
            imageProps.name = styleProps.name;
          }
          if (styleProps.defaultSize?.width && styleProps.defaultSize?.height) {
            imageProps.size = { width: styleProps.defaultSize.width, height: styleProps.defaultSize.height };
          }
        }
        newElementToAdd = imageProps;
      } else if (type === 'video') {
        const videoProps: VideoElementProps = {
          ...newElementBase,
          type: 'video',
          size: { width: 500, height: 900 }, // portrait recording footprint
          objectFit: 'cover' as const,
          opacity: 1,
          borderRadius: 0,
        };
        if (styleProps) {
          if (typeof styleProps.videoSrc === 'string') videoProps.videoSrc = styleProps.videoSrc;
          if (typeof styleProps.name === 'string' && styleProps.name) videoProps.name = styleProps.name;
          if (styleProps.defaultSize?.width && styleProps.defaultSize?.height) {
            videoProps.size = { width: styleProps.defaultSize.width, height: styleProps.defaultSize.height };
          }
        }
        newElementToAdd = videoProps;
      } else if (type === 'video-device') {
        const videoDevice: VideoDeviceElementProps = {
          ...newElementBase,
          type: 'video-device',
          deviceType: (subType as DeviceType) || 'iphone-15-pro',
          size: { width: 520, height: 1040 }, // 0.5-aspect box, like the screenshot mockups
          objectFit: 'cover',
        };
        if (typeof styleProps?.frameColor === 'string') videoDevice.frameColor = styleProps.frameColor;
        if (typeof styleProps?.notchColor === 'string') videoDevice.notchColor = styleProps.notchColor;
        if (typeof styleProps?.frameOpacity === 'number') videoDevice.frameOpacity = styleProps.frameOpacity;
        if (styleProps?.frameStyle === 'solid' || styleProps?.frameStyle === 'outline') {
          videoDevice.frameStyle = styleProps.frameStyle;
        }
        if (typeof styleProps?.name === 'string' && styleProps.name) videoDevice.name = styleProps.name;
        if (styleProps?.defaultSize?.width && styleProps?.defaultSize?.height) {
          videoDevice.size = { width: styleProps.defaultSize.width, height: styleProps.defaultSize.height };
        }
        // Center devices by their real size (click) or clamp fully inside the
        // artboard (drop) — the generic drop position assumes small elements.
        if (!dropPosition) {
          videoDevice.position = {
            x: Math.max(0, (artboard.size.width - videoDevice.size.width) / 2),
            y: Math.max(0, (artboard.size.height - videoDevice.size.height) / 2),
          };
        } else {
          videoDevice.position = {
            x: Math.max(0, Math.min(videoDevice.position.x, artboard.size.width - videoDevice.size.width)),
            y: Math.max(0, Math.min(videoDevice.position.y, artboard.size.height - videoDevice.size.height)),
          };
        }
        newElementToAdd = videoDevice;
      } else if (type === 'gesture') {
        const gestureProps: GestureElementProps = {
          ...newElementBase,
          type: 'gesture',
          gestureType: (styleProps?.gestureType as GestureType) || 'tap',
          color: typeof styleProps?.color === 'string' ? styleProps.color : '#ffffff',
          size: { width: 160, height: 160 },
          gestureRepeat: true,
        };
        if (typeof styleProps?.name === 'string' && styleProps.name) gestureProps.name = styleProps.name;
        if (styleProps?.defaultSize?.width && styleProps?.defaultSize?.height) {
          gestureProps.size = { width: styleProps.defaultSize.width, height: styleProps.defaultSize.height };
        }
        newElementToAdd = gestureProps;
      } else if (type === 'shape' && subType) {
        const shapeProps: Partial<ShapeElementProps> = {
          type: 'shape',
          shapeType: subType as ShapeType,
          fillColor: '#5F9EA0',
          strokeColor: '#333333',
          strokeWidth: 0,
          size: { width: 300, height: 300 },  // Increased from 100x100
          fillOpacity: 1, // Initialize with full opacity
        };

        // Add shape-specific properties based on subType
        if (subType === 'rectangle') {
          shapeProps.borderRadius = 0;
          shapeProps.borderRadiusType = 'uniform';
        } else if (subType === 'star') {
          shapeProps.customPoints = 5;
        } else if (subType === 'circle') {
          shapeProps.innerRadius = 0; // Initialize inner radius for circle
        } else if (subType === 'diamond') {
          shapeProps.innerRadius = 0; // Initialize inner radius for diamond
        }

        // Merge palette-provided props (library elements: customPath, clipPath, specialProps, ...)
        if (styleProps) {
          // libraryId is already on newElementBase; keep it out of the shape props.
          const { defaultSize, name, libraryId: _libraryId, ...restStyleProps } = styleProps;
          if (defaultSize?.width && defaultSize?.height) {
            shapeProps.size = { width: defaultSize.width, height: defaultSize.height };
          }
          if (typeof name === 'string' && name) {
            shapeProps.name = name;
          }
          Object.assign(shapeProps, restStyleProps);
        }

        newElementToAdd = {
          ...newElementBase,
          ...shapeProps
        } as ShapeElementProps;
      } else if (type === 'device' && subType) {
        const deviceElement: DeviceFrameElementProps = {
          ...newElementBase,
          type: 'device',
          deviceType: subType as DeviceType,
          // Increase device size to make it more visible with scaling
          size: { width: 600, height: 1200 }, // Increased from 150x300
        };
        if (subType === 'custom') {
          deviceElement.screenshotRect = { left: 5, top: 5, width: 90, height: 90 };
        } else {
           deviceElement.screenshotRect = { left: 0, top: 0, width: 100, height: 100 };
        }
        // Palette presets (e.g. the 3D device tiles) can pre-select a style
        if (styleProps?.styleType) {
          deviceElement.styleType = styleProps.styleType as DeviceFrameElementProps['styleType'];
        }
        if (styleProps?.pose3d) {
          deviceElement.pose3d = styleProps.pose3d as DeviceFrameElementProps['pose3d'];
        }
        if (styleProps?.frameColor3d) {
          deviceElement.frameColor3d = styleProps.frameColor3d as DeviceFrameElementProps['frameColor3d'];
        }
        // Colored-device presets (flat frames)
        if (typeof styleProps?.frameColor === 'string') {
          deviceElement.frameColor = styleProps.frameColor;
        }
        if (typeof styleProps?.frameOpacity === 'number') {
          deviceElement.frameOpacity = styleProps.frameOpacity;
        }
        if (styleProps?.frameStyle === 'solid' || styleProps?.frameStyle === 'outline') {
          deviceElement.frameStyle = styleProps.frameStyle;
        }
        if (typeof styleProps?.notchColor === 'string') {
          deviceElement.notchColor = styleProps.notchColor;
        }
        // Palette presets can request a device-accurate aspect ratio
        if (styleProps?.defaultSize?.width && styleProps?.defaultSize?.height) {
          deviceElement.size = { width: styleProps.defaultSize.width, height: styleProps.defaultSize.height };
        }
        // The generic drop position assumes small elements; center devices by
        // their real size (click) or clamp fully inside the artboard (drop) so
        // wide presets don't hang past the edge and export clipped.
        if (!dropPosition) {
          deviceElement.position = {
            x: Math.max(0, (artboard.size.width - deviceElement.size.width) / 2),
            y: Math.max(0, (artboard.size.height - deviceElement.size.height) / 2),
          };
        } else {
          deviceElement.position = {
            x: Math.max(0, Math.min(deviceElement.position.x, artboard.size.width - deviceElement.size.width)),
            y: Math.max(0, Math.min(deviceElement.position.y, artboard.size.height - deviceElement.size.height)),
          };
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
      // Fix to ensure deletion works correctly
      if (elements.find(el => el.id === elementId)) {
        const newElements = elements.filter(el => el.id !== elementId);
        setElements(newElements);
        onUpdateArtboardElements(newElements);
        setSelectedElementId(null);
        console.log(`Element deleted: ${elementId}`);
        return true;
      }
      return false;
    }
    };
    selfRef.current = api;
    return api;
  });

  const handleUpdateElement = (updatedElementData: ArtboardElement) => {
    const newElements = elements.map(el =>
      el.id === updatedElementData.id ? { ...el, ...updatedElementData } as ArtboardElement : el
    );
    setElements(newElements);
    onUpdateArtboardElements(newElements);
  };
  
  const partialUpdateElement = (elementId: string, updates: Partial<ArtboardElement>) => {
    const newElements = elements.map(el =>
      el.id === elementId ? { ...el, ...updates } as ArtboardElement : el
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
  };

  const handleSelectElement = (elementId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    setSelectedElementId(elementId);
  };

  const handleArtboardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only deselect element if the click is directly on the artboard background,
    // not on the toolbar or other child elements within the artboard wrapper.
    // Also check if the target is a DraggableElement or its children
    const target = e.target as HTMLElement;
    const isDraggableElement = target.closest('[data-element-id]');
    const isHandle = target.closest('[data-interaction-handle]');
    
    if (e.target === artboardDivRef.current && !isDraggableElement && !isHandle) {
      setSelectedElementId(null);
    }
    
    // Only select artboard if we're not clicking on an element
    if (!isDraggableElement && !isHandle) {
      onSelectArtboard();
    }
  };

  // Define display scale factor
  const displayScaleFactor = 0.3;

  // Calculate container dimensions
  const containerWidth = artboard.size.width * displayScaleFactor;
  const containerHeight = artboard.size.height * displayScaleFactor;

  // How much of a screen pixel one artboard pixel is worth right now: the 0.3
  // display scale times every canvas zoom transform stacked above this board.
  // Measured rather than derived, because the canvas applies its zoom in more
  // than one place and a drag handle sized off a stale guess is a handle a
  // finger cannot hit. Re-measured whenever the zoom or the window changes;
  // ResizeObserver is no use here, since a CSS transform leaves the layout box
  // exactly as it was.
  const [screenScale, setScreenScale] = useState(displayScaleFactor);
  useEffect(() => {
    const measure = () => {
      const node = artboardDivRef.current;
      if (!node || artboard.size.width <= 0) return;
      const width = node.getBoundingClientRect().width;
      if (width > 0) setScreenScale(width / artboard.size.width);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [globalZoom, artboard.size.width, artboard.zoom]);

  // App Preview playback. The timeline is read off the elements as they stand,
  // so adding an animation or dropping in a recording changes the preview
  // length straight away.
  const timeline = useMemo(() => artboardTimeline({ ...artboard, elements }), [artboard, elements]);
  const isPlaying = usePlaybackRunning(artboard.id);

  // A board that goes away (deleted, project swapped, language switched) must
  // not leave the clock running against an id nothing renders any more.
  useEffect(() => {
    const id = artboard.id;
    return () => {
      if (getPlayback().artboardId === id) stopPlayback();
    };
  }, [artboard.id]);

  return (
    <div className="relative mt-4" suppressHydrationWarning>
      <ArtboardToolbar
        artboardId={artboard.id}
        onAddNew={() => onAddNewArtboard()}
        onDuplicate={onDuplicateArtboard}
        onDelete={onDeleteArtboard}
        onMove={onMoveArtboard}
        onTranslate={onTranslateArtboard}
        onExport={onExportArtboard}
        onTogglePlayback={() => togglePlayback(artboard.id, timeline.duration)}
        canPlay={timeline.hasMotion}
        isPlaying={isPlaying}
        canDelete={canDeleteArtboard}
        canMoveLeft={canMoveArtboardLeft}
        canMoveRight={canMoveArtboardRight}
      />
      <div
        className={cn(
          "relative rounded-sm transition-shadow duration-150",
          isSelected
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-[0_0_0_6px_hsl(var(--primary)/0.25),0_4px_16px_hsl(var(--primary)/0.35)]"
            : "ring-1 ring-border"
        )}
        style={{
          width: `${containerWidth}px`,
          height: `${containerHeight}px`,
          position: 'relative',
          overflow: 'hidden', // Clip to artboard bounds so canvas matches the exported result
          marginTop: '1.25rem',
        }}
      >
        <div
          ref={artboardDivRef}
          data-artboard-dom-id={artboard.id}
          data-original-width={artboard.size.width}
          data-original-height={artboard.size.height}
          data-display-scale={displayScaleFactor}
          data-export-width={artboard.size.width} // Add explicit export dimensions
          data-export-height={artboard.size.height} // Add explicit export dimensions
          className="artboard relative shadow-lg bg-white"
          style={{
            width: `${artboard.size.width}px`,
            height: `${artboard.size.height}px`,
            transform: `scale(${displayScaleFactor})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
            marginTop: '0', // Keep this at 0
            overflow: 'hidden', // Clip to artboard bounds so canvas matches the exported result
            // NOTE: the board itself always takes pointer events, even mid
            // playback — locking it made a previewing board impossible to
            // select. Only its elements go inert while the timeline runs (see
            // DraggableElement), so the artwork cannot be dragged out from
            // under a moving animation.
            ...backgroundStyle,
          }}
          onClick={handleArtboardClick}
          onDrop={(e) => {
            e.preventDefault();
            // A preview scene becomes its own artboard, not a layer on this
            // one, so it is deliberately left to bubble up to the canvas
            // handler (which is why stopPropagation runs after this check and
            // not before it).
            if (e.dataTransfer.types.includes(PREVIEW_SCENE_DRAG_TYPE)) return;
            // Files from the desktop bubble for the same reason: the canvas
            // handler places them across EVERY board's empty device frames, not
            // just this one, so answering here would strand the rest of a
            // dropped folder on the board that happened to be under the cursor.
            if (e.dataTransfer.types.includes('Files')) return;
            e.stopPropagation();
            const type = e.dataTransfer.getData('application/artboard-element-type') as ElementType;
            const subType = e.dataTransfer.getData('application/artboard-element-subtype') as ShapeType | DeviceType | undefined;
            const rawStyleProps = e.dataTransfer.getData('application/artboard-element-styleprops');
            let styleProps: Record<string, any> | undefined;
            if (rawStyleProps) {
              try { styleProps = JSON.parse(rawStyleProps); } catch { styleProps = undefined; }
            }
            if (type) {
              // Client coords: addElement converts them against the board's own
              // rect and display scale.
              selfRef.current?.addElement(type, subType || undefined, { x: e.clientX, y: e.clientY }, styleProps);
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            // Same exception as the drop above, so the canvas can say "copy"
            // and the cursor stops claiming a file cannot be dropped here.
            if (e.dataTransfer.types.includes('Files')) return;
            e.stopPropagation();
          }}
          suppressHydrationWarning
        >
          <ArtboardBackgroundImage artboard={artboard} />
          {elements.map(element => {
            // Selection chrome (outlines, handles, upload overlays) is editing
            // furniture; while the timeline runs the board shows only what will
            // be in the exported video.
            const isElementSelected = selectedElementId === element.id && !isPlaying;
            return (
            <DraggableElement
              key={element.id}
              element={element}
              isSelected={isElementSelected}
              onSelect={handleSelectElement}
              onUpdateElement={handleUpdateElement}
              onDeleteElement={handleDeleteElement}
              artboardZoom={artboard.zoom}
              screenScale={screenScale}
              boundary={{width: artboard.size.width, height: artboard.size.height}}
              artboardId={artboard.id}
            >
              {element.type === 'text' && (
                <TextElement
                  element={element}
                  onUpdate={(updates) => partialUpdateElement(element.id, updates)}
                  isSelected={isElementSelected}
                  artboardZoom={artboard.zoom * element.scale}
                />
              )}
              {element.type === 'image' && (
                <ImageElement
                  element={element as ImageElementProps}
                  onUpdate={(updates) => partialUpdateElement(element.id, updates)}
                  isSelected={isElementSelected}
                />
              )}
              {element.type === 'shape' && <ShapeElement element={element} />}
              {element.type === 'device' && (
                <DeviceFrameElement
                  element={element}
                  onUpdate={(updates) => partialUpdateElement(element.id, updates)}
                  isSelected={isElementSelected}
                />
              )}
              {element.type === 'video' && (
                <VideoElement
                  element={element as VideoElementProps}
                  onUpdate={(updates) => partialUpdateElement(element.id, updates)}
                  isSelected={isElementSelected}
                  artboardId={artboard.id}
                />
              )}
              {element.type === 'video-device' && (
                <VideoDeviceElement
                  element={element as VideoDeviceElementProps}
                  onUpdate={(updates) => partialUpdateElement(element.id, updates)}
                  isSelected={isElementSelected}
                  artboardId={artboard.id}
                />
              )}
              {element.type === 'gesture' && (
                <GestureElement
                  element={element as GestureElementProps}
                  isSelected={isElementSelected}
                  artboardId={artboard.id}
                />
              )}
            </DraggableElement>
            );
          })}
        </div>

        {/* Live session marks: peers' selections and pointers.
            A SIBLING of the .artboard node above, never a child, because that
            node is exactly what the exporter rasterises. Same geometry and the
            same scale, so everything inside is drawn in artboard pixels. */}
        {renderCollabOverlay && (
          <div
            data-export-exclude
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${artboard.size.width}px`,
              height: `${artboard.size.height}px`,
              transform: `scale(${displayScaleFactor})`,
              transformOrigin: 'top left',
              pointerEvents: 'none',
              // Above the board, below the canvas chrome.
              zIndex: 5,
            }}
          >
            {renderCollabOverlay({ screenScale })}
          </div>
        )}
      </div>
      
      {/* Artboard name label below the artboard on main canvas */}
      <div className="absolute left-0 text-xs text-muted-foreground mt-1 flex items-center gap-1">
        {isEditingName ? (
          <Input
            ref={nameInputRef}
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            className="w-full p-1 text-center text-sm"
            placeholder="Artboard name"
          />
        ) : (
          <>
            <span 
              className="cursor-pointer p-0.5 rounded hover:bg-accent transition-colors" 
              onClick={handleDoubleClickName}
              title="Click to rename artboard"
            >
              <EditIcon className="w-3 h-3 text-muted-foreground hover:text-primary transition-colors" />
            </span>
            <span
              onDoubleClick={handleDoubleClickName}
              className={cn(
                "cursor-pointer text-center text-sm transition-colors",
                isSelected
                  ? "font-semibold text-primary"
                  : "font-medium text-muted-foreground hover:text-primary"
              )}
              title="Double-click to rename artboard"
            >
              {artboard.name}
            </span>
          </>
        )}
      </div>
    </div>
  );
});

Artboard.displayName = "Artboard";

