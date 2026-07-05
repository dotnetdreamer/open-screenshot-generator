"use client";
import type React from 'react';
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TypeIcon,
  SquareIcon,
  CircleIcon,
  TriangleIcon,
  SmartphoneIcon,
  TabletIcon,
  MonitorIcon,
  ImagePlusIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  HexagonIcon,
  StarIcon,
  DiamondIcon,
  ImageIcon,
  LayersIcon,
  ChevronLeftIcon
} from "lucide-react";
import type { ElementType, ShapeType, DeviceType, ArtboardElement } from '@/types/artboard';
import { LayersPanel } from './LayersPanel';
import { ELEMENT_CATEGORIES, type ElementCategory, type LibraryElementDef } from '@/lib/elementLibrary';

interface ElementPaletteProps {
  onAddElement: (type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => void;
  activeArtboardElements: ArtboardElement[];
  selectedElementIdOnActiveArtboard: string | null;
  onSelectElementInLayerPanel: (elementId: string) => void;
  onMoveElementLayer: (elementId: string, direction: 'up' | 'down') => void;
  onDeleteElement: (elementId: string) => void;
  onRenameElement: (elementId: string, newName: string) => void;
  activeArtboardName?: string;
}

const DraggableItem: React.FC<{
  onDragStart: (e: React.DragEvent<HTMLElement>, type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => void,
  type: ElementType,
  subType?: ShapeType | DeviceType,
  label: string,
  icon: React.ReactNode,
  className?: string,
  styleProps?: Record<string, any>
}> =
  ({ onDragStart, type, subType, label, icon, className, styleProps }) => {
  return (
    <Button
      variant="ghost"
      className={`w-full justify-start p-2 h-auto text-left ${className}`}
      draggable
      onDragStart={(e) => onDragStart(e, type, subType, styleProps)}
      onClick={() => (onDragStart as any)(null, type, subType, styleProps)} // Fallback for click
      title={`Add ${label}`}
    >
      <div className="flex flex-col items-center text-center w-full">
        <div className="p-2 rounded-md bg-accent/10 mb-1">{icon}</div>
        <span className="text-xs">{label}</span>
      </div>
    </Button>
  );
}

/** Renders a library element's SVG path data as a small preview glyph. */
const ElementPreview: React.FC<{ item: LibraryElementDef; className?: string }> = ({ item, className }) => {
  const special = item.styleProps.specialProps || {};
  const strokeOnly = !!special.strokeOnly;
  const baseStrokeWidth = special.baseStrokeWidth ?? 4;
  const previewStrokeWidth = Math.min(3, Math.max(1.4, baseStrokeWidth * 0.18));
  return (
    <svg viewBox={special.viewBox || '0 0 100 100'} className={className} aria-hidden="true" focusable="false">
      <path
        d={item.styleProps.customPath}
        fill={strokeOnly ? 'none' : 'currentColor'}
        fillRule={special.fillRule === 'evenodd' ? 'evenodd' : undefined}
        stroke={strokeOnly ? 'currentColor' : 'none'}
        strokeWidth={strokeOnly ? previewStrokeWidth : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

/** Single draggable/clickable tile inside an open library category. */
const LibraryItemTile: React.FC<{
  item: LibraryElementDef;
  onDragStart: (e: React.DragEvent<HTMLElement>, type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => void;
}> = ({ item, onDragStart }) => {
  return (
    <button
      type="button"
      className="aspect-square w-full rounded-lg bg-accent/10 hover:bg-accent/25 transition-colors flex items-center justify-center p-2.5 text-foreground/90 cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => onDragStart(e, 'shape', 'custom-svg', item.styleProps)}
      onClick={() => (onDragStart as any)(null, 'shape', 'custom-svg', item.styleProps)}
      title={`Add ${item.label}`}
      aria-label={`Add ${item.label}`}
    >
      <ElementPreview item={item} className="w-full h-full" />
    </button>
  );
};

/** Category card shown in the library overview grid (mini previews + label). */
const CategoryCard: React.FC<{ category: ElementCategory; onOpen: (id: string) => void }> = ({ category, onOpen }) => {
  return (
    <button
      type="button"
      onClick={() => onOpen(category.id)}
      className="flex flex-col items-center gap-1.5 group"
      title={`Browse ${category.label}`}
    >
      <div className="w-full aspect-square rounded-xl bg-accent/10 group-hover:bg-accent/25 transition-colors p-3 grid grid-cols-3 grid-rows-2 gap-2 place-items-center text-foreground/90">
        {category.items.slice(0, 6).map(item => (
          <ElementPreview key={item.id} item={item} className="w-full h-full" />
        ))}
      </div>
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{category.label}</span>
    </button>
  );
};

export function ElementPalette({
  onAddElement,
  activeArtboardElements,
  selectedElementIdOnActiveArtboard,
  onSelectElementInLayerPanel,
  onMoveElementLayer,
  onDeleteElement,
  onRenameElement,
  activeArtboardName
}: ElementPaletteProps) {
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const openCategory = ELEMENT_CATEGORIES.find(c => c.id === openCategoryId) || null;

  const handleDragStart = (e: React.DragEvent<HTMLElement> | null, type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => {
    if (e) { // Drag event
      e.dataTransfer.setData('application/artboard-element-type', type);
      if (subType) {
        e.dataTransfer.setData('application/artboard-element-subtype', subType);
      }
      if (styleProps) {
        e.dataTransfer.setData('application/artboard-element-styleprops', JSON.stringify(styleProps));
      }
    } else { // Click event (simulated drag)
      onAddElement(type, subType, styleProps);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="elements" className="h-full flex flex-col">
        <TabsList className="grid w-[85%] grid-cols-3 mx-auto mt-2 h-7 p-0.5">
          <TabsTrigger value="elements" className="text-xs px-0.5 py-0.5 h-6">
            <TypeIcon className="w-3 h-3 mr-0.5" />
            Elements
          </TabsTrigger>
          <TabsTrigger value="devices" className="text-xs px-0.5 py-0.5 h-6">
            <SmartphoneIcon className="w-3 h-3 mr-0.5" />
            Devices
          </TabsTrigger>
          <TabsTrigger value="layers" className="text-xs px-0.5 py-0.5 h-6">
            <LayersIcon className="w-3 h-3 mr-0.5" />
            Layers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="elements" className="flex-grow p-3 pt-2 mt-0 min-h-0">
          <ScrollArea className="h-full">
            {openCategory ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-2 h-7 px-1.5 text-xs"
                  onClick={() => setOpenCategoryId(null)}
                >
                  <ChevronLeftIcon className="w-4 h-4 mr-0.5" />
                  Back
                </Button>
                <div className="grid grid-cols-3 gap-2 pr-1">
                  {openCategory.items.map(item => (
                    <LibraryItemTile key={item.id} item={item} onDragStart={handleDragStart} />
                  ))}
                </div>
              </div>
            ) : (
              <>
                <Card className="shadow-md">
                  <CardHeader className="p-3">
                    <CardTitle className="text-base">Basic Elements</CardTitle>
                  </CardHeader>
                  <CardContent className="p-2 grid grid-cols-3 gap-2">
                    {/* Text Element */}
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="text"
                      label="Text"
                      icon={<TypeIcon className="w-6 h-6 text-primary" />}
                    />

                    {/* Image Element */}
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="image"
                      label="Image"
                      icon={<ImageIcon className="w-6 h-6 text-primary" />}
                    />

                    {/* Basic Shapes */}
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="rectangle"
                      label="Rectangle"
                      icon={<SquareIcon className="w-6 h-6 text-primary" />}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="circle"
                      label="Circle"
                      icon={<CircleIcon className="w-6 h-6 text-primary" />}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="triangle"
                      label="Triangle"
                      icon={<TriangleIcon className="w-6 h-6 text-primary" />}
                    />

                    {/* Advanced Shapes */}
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="star"
                      label="Star"
                      icon={<StarIcon className="w-6 h-6 text-primary" />}
                      styleProps={{ customPoints: 5 }}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="hexagon"
                      label="Hexagon"
                      icon={<HexagonIcon className="w-6 h-6 text-primary" />}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="diamond"
                      label="Diamond"
                      icon={<DiamondIcon className="w-6 h-6 text-primary" />}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="message"
                      label="Message"
                      icon={<MessageSquareIcon className="w-6 h-6 text-primary" />}
                      styleProps={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 75%, 75% 75%, 75% 100%, 50% 75%, 0% 75%)' }}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="speech-bubble"
                      label="Speech"
                      icon={<MessageCircleIcon className="w-6 h-6 text-primary" />}
                      styleProps={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 75%, 85% 75%, 70% 100%, 70% 75%, 0% 75%)' }}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="pentagon"
                      label="Pentagon"
                      icon={<div className="w-6 h-6 flex items-center justify-center text-primary">5⬠</div>}
                    />
                  </CardContent>
                </Card>

                <Card className="shadow-md mt-3">
                  <CardHeader className="p-3">
                    <CardTitle className="text-base">Element Library</CardTitle>
                  </CardHeader>
                  <CardContent className="p-2 grid grid-cols-2 gap-x-2 gap-y-3">
                    {ELEMENT_CATEGORIES.map(category => (
                      <CategoryCard key={category.id} category={category} onOpen={setOpenCategoryId} />
                    ))}
                  </CardContent>
                </Card>
              </>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="devices" className="flex-grow p-3 pt-2 mt-0">
          <ScrollArea className="h-full">
            <Card className="shadow-md">
              <CardHeader className="p-3">
                <CardTitle className="text-base">Device Mockups</CardTitle>
              </CardHeader>
              <CardContent className="p-2 grid grid-cols-2 gap-2">
                <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-15-pro" label="iPhone 3D (Left)" icon={<SmartphoneIcon className="w-6 h-6 text-primary -rotate-12" />} styleProps={{ styleType: '3d-left' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-15-pro" label="iPhone 3D (Right)" icon={<SmartphoneIcon className="w-6 h-6 text-primary rotate-12" />} styleProps={{ styleType: '3d-right' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone" label="iPhone" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-15-pro" label="iPhone 15 Pro" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-15" label="iPhone 15" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-14" label="iPhone 14" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '26px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-13" label="iPhone 13" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '24px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-x" label="iPhone X" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '24px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="android-punch-hole" label="Android (Punch Hole)" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="android-notch" label="Android (Notch)" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="android-bar" label="Android (Bar)" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="tablet" label="Tablet" icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '12px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="desktop" label="Desktop" icon={<MonitorIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '8px' }} />
                <DraggableItem onDragStart={handleDragStart} type="device" subType="custom" label="Custom" icon={<ImagePlusIcon className="w-6 h-6 text-primary" />} />
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="layers" className="flex-grow p-3 pt-2 mt-0">
          <LayersPanel
            elements={activeArtboardElements}
            selectedElementId={selectedElementIdOnActiveArtboard}
            onSelectElement={onSelectElementInLayerPanel}
            onMoveElementLayer={onMoveElementLayer}
            onDeleteElement={onDeleteElement}
            onRenameElement={onRenameElement}
            activeArtboardName={activeArtboardName}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
