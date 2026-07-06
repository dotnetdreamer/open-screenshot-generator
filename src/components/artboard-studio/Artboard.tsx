"use client";

import type React from 'react';
import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { DraggableElement } from './elements/DraggableElement';
import { TextElement } from './elements/TextElement';
import { ShapeElement } from './elements/ShapeElement';
import { DeviceFrameElement } from './elements/DeviceFrameElement';
import { ImageElement } from './elements/ImageElement';
import type { ArtboardState as ArtboardType, ArtboardElement, Point, ElementType, ShapeType, DeviceType, DeviceFrameElementProps, ImageElementProps, ShapeElementProps, TextElementProps } from '@/types/artboard';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
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
  canDeleteArtboard: boolean;
  canMoveArtboardLeft: boolean;
  canMoveArtboardRight: boolean;
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
  canDeleteArtboard,
  canMoveArtboardLeft,
  canMoveArtboardRight,
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

  // Function to get background style that handles CSS variables properly
  const getBackgroundStyle = (): React.CSSProperties => {
    if (artboard.backgroundType === 'gradient' && artboard.backgroundGradient) {
      const { color1, color2, angle } = artboard.backgroundGradient;
      return {
        background: `linear-gradient(${angle}deg, ${color1}, ${color2})`,
      };
    }
    
    // For solid background
    const backgroundColor = artboard.backgroundColor;
    // If it's a CSS variable, use it directly
    if (backgroundColor?.toLowerCase().includes('var(') || backgroundColor?.toLowerCase().includes('hsl')) {
      return { backgroundColor: 'white' }; // Default to white
    }
    
    return { backgroundColor };
  };

  const [backgroundStyle, setBackgroundStyle] = useState<React.CSSProperties>(getBackgroundStyle());

  useEffect(() => {
    // Mark as initialized on client-side
    isClientInitialized.current = true;
    
    setElements(artboard.elements);
    
    // Compute background style based on artboard settings
    const newBackgroundStyle: React.CSSProperties = {};

    if (artboard.backgroundType === 'gradient' && artboard.backgroundGradient) {
      const { color1, color2, angle } = artboard.backgroundGradient;
      newBackgroundStyle.background = `linear-gradient(${angle}deg, ${color1}, ${color2})`;
    } else {
      newBackgroundStyle.backgroundColor = artboard.backgroundColor || 'hsl(var(--card))';
    }

    setBackgroundStyle(newBackgroundStyle);
  }, [artboard.elements, artboard.backgroundType, artboard.backgroundColor, artboard.backgroundGradient]);

  useImperativeHandle(ref, () => ({
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

      const newElementBase = {
        id: `el_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        position: { x: newElementX, y: newElementY },
        rotation: 0,
        scale: 1,
      };

      let newElementToAdd: ArtboardElement | null = null;

      if (type === 'text') {
        // Increase default font size to account for scaling
        newElementToAdd = {
          ...newElementBase,
          type: 'text',
          content: 'New Text',
          fontSize: 48,  // Increased from 16 to be more visible at 0.3 scale
          color: '#333333',
          fontFamily: 'Arial',
          size: { width: 400, height: 100 },  // Increased from 150x30
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
          const { defaultSize, name, ...restStyleProps } = styleProps;
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
  }));

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

  const handleSelectElement = (elementId: string, e: React.MouseEvent) => {
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

  return (
    <div className="relative mt-4" suppressHydrationWarning>
      <ArtboardToolbar
        artboardId={artboard.id}
        onAddNew={() => onAddNewArtboard()} 
        onDuplicate={onDuplicateArtboard}
        onDelete={onDeleteArtboard}
        onMove={onMoveArtboard}
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
            ...backgroundStyle,
          }}
          onClick={handleArtboardClick}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const type = e.dataTransfer.getData('application/artboard-element-type') as ElementType;
            const subType = e.dataTransfer.getData('application/artboard-element-subtype') as ShapeType | DeviceType | undefined;
            const rawStyleProps = e.dataTransfer.getData('application/artboard-element-styleprops');
            let styleProps: Record<string, any> | undefined;
            if (rawStyleProps) {
              try { styleProps = JSON.parse(rawStyleProps); } catch { styleProps = undefined; }
            }
            if (type && typeof (ref as React.MutableRefObject<ArtboardRef | null>)?.current?.addElement === 'function') {
              const dropX = e.clientX;
              const dropY = e.clientY;
              (ref as React.MutableRefObject<ArtboardRef | null>)?.current?.addElement(type, subType || undefined, {x: dropX, y: dropY}, styleProps);
            }
          }}
          onDragOver={(e) => {
            e.preventDefault(); 
            e.stopPropagation();
          }}
          suppressHydrationWarning
        >
          {elements.map(element => (
            <DraggableElement
              key={element.id}
              element={element}
              isSelected={selectedElementId === element.id}
              onSelect={handleSelectElement}
              onUpdateElement={handleUpdateElement}
              onDeleteElement={handleDeleteElement}
              artboardZoom={artboard.zoom}
              boundary={{width: artboard.size.width, height: artboard.size.height}}
            >
              {element.type === 'text' && (
                <TextElement 
                  element={element} 
                  onUpdate={(updates) => partialUpdateElement(element.id, updates)} 
                  isSelected={selectedElementId === element.id}
                  artboardZoom={artboard.zoom * element.scale}
                />
              )}
              {element.type === 'image' && (
                <ImageElement 
                  element={element as ImageElementProps} 
                  onUpdate={(updates) => partialUpdateElement(element.id, updates)} 
                  isSelected={selectedElementId === element.id}
                />
              )}
              {element.type === 'shape' && <ShapeElement element={element} />}
              {element.type === 'device' && (
                <DeviceFrameElement 
                  element={element} 
                  onUpdate={(updates) => partialUpdateElement(element.id, updates)} 
                  isSelected={selectedElementId === element.id} 
                />
              )}
            </DraggableElement>
          ))}
        </div>
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

