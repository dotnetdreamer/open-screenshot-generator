
"use client";
import type React from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ArtboardElement } from '@/types/artboard';
import { TypeIcon, SquareIcon, CircleIcon, TriangleIcon, SmartphoneIcon, ImagePlusIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LayersPanelProps {
  elements: ArtboardElement[];
  selectedElementId: string | null;
  onSelectElement: (elementId: string) => void;
  activeArtboardName?: string;
}

const getElementIcon = (element: ArtboardElement) => {
  switch (element.type) {
    case 'text':
      return <TypeIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
    case 'shape':
      switch (element.shapeType) {
        case 'rectangle':
          return <SquareIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
        case 'circle':
          return <CircleIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
        case 'triangle':
          return <TriangleIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
        default:
          return <SquareIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
      }
    case 'device':
       return <SmartphoneIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
    default:
      return <ImagePlusIcon className="w-4 h-4 mr-2 shrink-0 text-primary" />;
  }
};

const getElementLabel = (element: ArtboardElement): string => {
    let label = `${element.type.charAt(0).toUpperCase() + element.type.slice(1)}`;
    if (element.type === 'text' && element.content) {
        label = element.content.substring(0, 20) || "Text";
        if (element.content.length > 20) label += '...';
    } else if (element.type === 'shape') {
        label = `${element.shapeType.charAt(0).toUpperCase() + element.shapeType.slice(1)} Shape`;
    } else if (element.type === 'device') {
        label = `${element.deviceType.charAt(0).toUpperCase() + element.deviceType.slice(1)} Device`;
    }
    return label;
};

export function LayersPanel({ elements, selectedElementId, onSelectElement, activeArtboardName }: LayersPanelProps) {
  if (!activeArtboardName) {
    return (
      <Card className="shadow-md mt-4">
        <CardHeader className="p-3">
          <CardTitle className="text-base">Layers</CardTitle>
        </CardHeader>
        <CardContent className="p-3 text-sm text-muted-foreground">
          Select an artboard to see its layers.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md mt-4">
      <CardHeader className="p-3">
        <CardTitle className="text-base truncate" title={activeArtboardName}>
          Layers: {activeArtboardName}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[200px] max-h-[calc(100vh_-_550px)]"> {/* Adjusted max-height */}
          {elements.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No elements on this artboard.</div>
          ) : (
            <div className="p-2 space-y-1">
              {[...elements].reverse().map((element) => (
                <Button
                  key={element.id}
                  variant="ghost"
                  className={cn(
                    "w-full justify-start p-2 h-auto text-left text-sm items-center", // Changed text-xs to text-sm
                    element.id === selectedElementId ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  )}
                  onClick={() => onSelectElement(element.id)}
                  title={`Select ${getElementLabel(element)}`}
                >
                  {getElementIcon(element)}
                  <span className="truncate flex-grow">{getElementLabel(element)}</span>
                  {/* Visibility toggle - Placeholder for future */}
                  {/* <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto p-0 shrink-0 opacity-50 hover:opacity-100">
                    <EyeIcon className="w-4 h-4" />
                  </Button> */}
                </Button>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
