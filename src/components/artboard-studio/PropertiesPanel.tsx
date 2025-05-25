
"use client";

import type React from 'react';
import { useEffect, useState } from 'react';
import type { ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps } from '@/types/artboard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea'; // Using Textarea for multi-line text content
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

interface PropertiesPanelProps {
  selectedElement: ArtboardElement | null;
  onUpdateElement: (updates: Partial<ArtboardElement>) => void;
}

export function PropertiesPanel({ selectedElement, onUpdateElement }: PropertiesPanelProps) {
  const [localContent, setLocalContent] = useState('');

  useEffect(() => {
    if (selectedElement?.type === 'text') {
      setLocalContent((selectedElement as TextElementProps).content);
    }
  }, [selectedElement]);

  const handleTextContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalContent(e.target.value);
  };

  const handleTextContentBlur = () => {
    if (selectedElement?.type === 'text' && localContent !== (selectedElement as TextElementProps).content) {
      onUpdateElement({ content: localContent });
    }
  };


  if (!selectedElement) {
    return (
      <div className="h-14 bg-card border-b shadow-sm flex items-center px-4 text-sm text-muted-foreground">
        No element selected. Select an element to see its properties.
      </div>
    );
  }

  const renderTextProperties = (element: TextElementProps) => (
    <>
      <div className="flex flex-col space-y-1">
        <Label htmlFor="textContent" className="text-xs">Content:</Label>
        <Textarea
          id="textContent"
          value={localContent}
          onChange={handleTextContentChange}
          onBlur={handleTextContentBlur}
          className="text-sm h-16"
          rows={2}
        />
      </div>
      <div className="flex flex-col space-y-1">
        <Label htmlFor="fontSize" className="text-xs">Font Size:</Label>
        <Input
          id="fontSize"
          type="number"
          value={element.fontSize}
          onChange={(e) => onUpdateElement({ fontSize: parseInt(e.target.value, 10) || 16 })}
          className="text-sm h-8"
        />
      </div>
      <div className="flex flex-col space-y-1">
        <Label htmlFor="fontColor" className="text-xs">Color:</Label>
        <Input
          id="fontColor"
          type="color"
          value={element.color}
          onChange={(e) => onUpdateElement({ color: e.target.value })}
          className="text-sm h-8 p-1"
        />
      </div>
      <div className="flex flex-col space-y-1">
        <Label htmlFor="fontFamily" className="text-xs">Font Family:</Label>
        <Input
          id="fontFamily"
          type="text"
          value={element.fontFamily}
          onChange={(e) => onUpdateElement({ fontFamily: e.target.value })}
          className="text-sm h-8"
        />
      </div>
    </>
  );

  const renderShapeProperties = (element: ShapeElementProps) => (
    <>
      <div className="flex flex-col space-y-1">
        <Label htmlFor="fillColor" className="text-xs">Fill Color:</Label>
        <Input
          id="fillColor"
          type="color"
          value={element.fillColor}
          onChange={(e) => onUpdateElement({ fillColor: e.target.value })}
          className="text-sm h-8 p-1"
        />
      </div>
      <div className="flex flex-col space-y-1">
        <Label htmlFor="strokeColor" className="text-xs">Stroke Color:</Label>
        <Input
          id="strokeColor"
          type="color"
          value={element.strokeColor}
          onChange={(e) => onUpdateElement({ strokeColor: e.target.value })}
          className="text-sm h-8 p-1"
        />
      </div>
      <div className="flex flex-col space-y-1">
        <Label htmlFor="strokeWidth" className="text-xs">Stroke Width:</Label>
        <Input
          id="strokeWidth"
          type="number"
          value={element.strokeWidth}
          min={0}
          onChange={(e) => onUpdateElement({ strokeWidth: parseInt(e.target.value, 10) || 0 })}
          className="text-sm h-8"
        />
      </div>
    </>
  );

  const renderDeviceProperties = (element: DeviceFrameElementProps) => (
    <>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="deviceScale" className="text-xs">
          Scale: {Math.round(element.scale * 100)}%
        </Label>
        <Slider
          id="deviceScale"
          min={10} // Represents 0.1
          max={500} // Represents 5.0
          step={1} // Represents 0.01
          value={[element.scale * 100]}
          onValueChange={(value) => onUpdateElement({ scale: value[0] / 100 })}
          className="my-2"
        />
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="deviceRotation" className="text-xs">
          Rotation: {Math.round(element.rotation)}°
        </Label>
        <Slider
          id="deviceRotation"
          min={-180}
          max={180}
          step={1}
          value={[element.rotation]}
          onValueChange={(value) => onUpdateElement({ rotation: value[0] })}
          className="my-2"
        />
      </div>
    </>
  );

  return (
    <div className="h-auto bg-card border-b shadow-sm flex items-center px-4 py-2 space-x-4 text-sm flex-wrap gap-y-2">
      <span className="font-semibold capitalize text-muted-foreground">{selectedElement.type} Properties:</span>
      {selectedElement.type === 'text' && renderTextProperties(selectedElement as TextElementProps)}
      {selectedElement.type === 'shape' && renderShapeProperties(selectedElement as ShapeElementProps)}
      {selectedElement.type === 'device' && renderDeviceProperties(selectedElement as DeviceFrameElementProps)}
    </div>
  );
}
