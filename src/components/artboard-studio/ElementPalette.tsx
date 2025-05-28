"use client";
import type React from 'react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TypeIcon, SquareIcon, CircleIcon, TriangleIcon, SmartphoneIcon, TabletIcon, MonitorIcon, ImagePlusIcon } from "lucide-react";
import type { ElementType, ShapeType, DeviceType, ArtboardElement } from '@/types/artboard';
import { LayersPanel } from './LayersPanel'; // Import the new LayersPanel

interface ElementPaletteProps {
  onAddElement: (type: ElementType, subType?: ShapeType | DeviceType) => void;
  activeArtboardElements: ArtboardElement[];
  selectedElementIdOnActiveArtboard: string | null;
  onSelectElementInLayerPanel: (elementId: string) => void;
  onMoveElementLayer: (elementId: string, direction: 'up' | 'down') => void;
  activeArtboardName?: string;
}

const DraggableItem: React.FC<{ 
  onDragStart: (e: React.DragEvent<HTMLDivElement>, type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => void, 
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


export function ElementPalette({ 
  onAddElement,
  activeArtboardElements,
  selectedElementIdOnActiveArtboard,
  onSelectElementInLayerPanel,
  onMoveElementLayer,
  activeArtboardName 
}: ElementPaletteProps) {
  const handleDragStart = (e: React.DragEvent<HTMLDivElement> | null, type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => {
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
    <ScrollArea className="h-full p-1 flex flex-col">
      <div className="space-y-4 p-2 flex-shrink-0">
        <Card className="shadow-md">
          <CardHeader className="p-3">
            <CardTitle className="text-base">Basic Elements</CardTitle>
          </CardHeader>
          <CardContent className="p-2 grid grid-cols-2 gap-2">
            <DraggableItem onDragStart={handleDragStart} type="text" label="Text" icon={<TypeIcon className="w-6 h-6 text-primary" />} />
            <DraggableItem onDragStart={handleDragStart} type="shape" subType="rectangle" label="Rectangle" icon={<SquareIcon className="w-6 h-6 text-primary" />} />
            <DraggableItem onDragStart={handleDragStart} type="shape" subType="circle" label="Circle" icon={<CircleIcon className="w-6 h-6 text-primary" />} />
            <DraggableItem onDragStart={handleDragStart} type="shape" subType="triangle" label="Triangle" icon={<TriangleIcon className="w-6 h-6 text-primary" />} />
          </CardContent>
        </Card>

        <Card className="shadow-md">
          <CardHeader className="p-3">
            <CardTitle className="text-base">Device Mockups</CardTitle>
          </CardHeader>
          <CardContent className="p-2 grid grid-cols-2 gap-2">
            <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone" label="iPhone" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
            <DraggableItem onDragStart={handleDragStart} type="device" subType="android-punch-hole" label="Android (Punch Hole)" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
            <DraggableItem onDragStart={handleDragStart} type="device" subType="android-notch" label="Android (Notch)" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
            <DraggableItem onDragStart={handleDragStart} type="device" subType="android-bar" label="Android (Bar)" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
            <DraggableItem onDragStart={handleDragStart} type="device" subType="tablet" label="Tablet" icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '12px' }} />
            <DraggableItem onDragStart={handleDragStart} type="device" subType="desktop" label="Desktop" icon={<MonitorIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '8px' }} />
            <DraggableItem onDragStart={handleDragStart} type="device" subType="custom" label="Custom" icon={<ImagePlusIcon className="w-6 h-6 text-primary" />} />
          </CardContent>
        </Card>
      </div>
      
      {/* Layers Panel takes up remaining space */}
      <div className="flex-grow p-2 min-h-0">
        <LayersPanel 
          elements={activeArtboardElements}
          selectedElementId={selectedElementIdOnActiveArtboard}
          onSelectElement={onSelectElementInLayerPanel}
          onMoveElementLayer={onMoveElementLayer}
          activeArtboardName={activeArtboardName}
        />
      </div>
    </ScrollArea>
  );
}
