
"use client";

import type React from 'react';
import { useEffect, useState, useRef } from 'react';
import type { ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps, DeviceType } from '@/types/artboard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { UploadCloudIcon } from 'lucide-react';

interface PropertiesPanelProps {
  selectedElement: ArtboardElement | null;
  onUpdateElement: (updates: Partial<ArtboardElement>) => void;
}

export function PropertiesPanel({ selectedElement, onUpdateElement }: PropertiesPanelProps) {
  const [localContent, setLocalContent] = useState('');
  const hiddenFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadPurpose, setUploadPurpose] = useState<'customFrame' | 'screenshot' | null>(null);

  // Local state for screenshotRect sliders to provide immediate feedback
  const [screenshotLeft, setScreenshotLeft] = useState(5);
  const [screenshotTop, setScreenshotTop] = useState(5);
  const [screenshotWidth, setScreenshotWidth] = useState(90);
  const [screenshotHeight, setScreenshotHeight] = useState(90);


  useEffect(() => {
    if (selectedElement?.type === 'text') {
      setLocalContent((selectedElement as TextElementProps).content);
    }
    if (selectedElement?.type === 'device') {
      const deviceElement = selectedElement as DeviceFrameElementProps;
      if (deviceElement.screenshotRect && deviceElement.deviceType === 'custom') { // Ensure rect exists for custom devices
        setScreenshotLeft(deviceElement.screenshotRect.left);
        setScreenshotTop(deviceElement.screenshotRect.top);
        setScreenshotWidth(deviceElement.screenshotRect.width);
        setScreenshotHeight(deviceElement.screenshotRect.height);
      } else {
        // Optionally reset if not a custom device with a rect, or if rect is removed
        // For now, retain previous values if not applicable, they won't be shown
      }
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

  const handleImageUploadButtonClick = (purpose: 'customFrame' | 'screenshot') => {
    setUploadPurpose(purpose);
    hiddenFileInputRef.current?.click();
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && uploadPurpose) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        if (uploadPurpose === 'customFrame') {
          onUpdateElement({ customFrameSrc: dataUrl, screenshotSrc: undefined, screenshotRect: undefined }); // Reset screenshot if frame changes
        } else if (uploadPurpose === 'screenshot') {
           const img = new window.Image();
            img.onload = () => {
                onUpdateElement({ 
                    screenshotSrc: dataUrl,
                    naturalScreenshotWidth: img.naturalWidth,
                    naturalScreenshotHeight: img.naturalHeight,
                    screenshotRect: { left: 5, top: 5, width: 90, height: 90 } // Default rect
                });
            };
            img.src = dataUrl;
        }
        setUploadPurpose(null);
      };
      reader.readAsDataURL(file);
    }
     if (hiddenFileInputRef.current) {
        hiddenFileInputRef.current.value = ""; // Allow re-uploading same file
    }
  };
  
  const handleScreenshotRectChange = (type: 'left' | 'top' | 'width' | 'height', value: number) => {
    // Ensure current values for other properties are used
    const currentRect = (selectedElement as DeviceFrameElementProps)?.screenshotRect || { left: 5, top: 5, width: 90, height: 90};
    
    const newRect = {
        left: type === 'left' ? value : currentRect.left,
        top: type === 'top' ? value : currentRect.top,
        width: type === 'width' ? value : currentRect.width,
        height: type === 'height' ? value : currentRect.height,
    };

    // Update local state for immediate slider feedback
    if (type === 'left') setScreenshotLeft(value);
    if (type === 'top') setScreenshotTop(value);
    if (type === 'width') setScreenshotWidth(value);
    if (type === 'height') setScreenshotHeight(value);

    onUpdateElement({ screenshotRect: newRect });
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
      {element.deviceType === 'custom' && (
        <div className="flex items-end space-x-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => handleImageUploadButtonClick('customFrame')}
            className="text-xs h-8"
          >
            <UploadCloudIcon className="w-3 h-3 mr-1.5" /> 
            {element.customFrameSrc ? 'Change Mockup' : 'Upload Mockup'}
          </Button>
          {element.customFrameSrc && (
             <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleImageUploadButtonClick('screenshot')}
                className="text-xs h-8"
            >
                <UploadCloudIcon className="w-3 h-3 mr-1.5" /> 
                {element.screenshotSrc ? 'Change Screenshot' : 'Upload Screenshot'}
            </Button>
          )}
        </div>
      )}
       {element.deviceType !== 'custom' && !element.screenshotSrc && (
         <Button 
            variant="outline" 
            size="sm" 
            onClick={() => handleImageUploadButtonClick('screenshot')}
            className="text-xs h-8"
        >
            <UploadCloudIcon className="w-3 h-3 mr-1.5" /> Upload Screenshot
        </Button>
      )}
       {element.deviceType !== 'custom' && element.screenshotSrc && (
         <Button 
            variant="outline" 
            size="sm" 
            onClick={() => handleImageUploadButtonClick('screenshot')}
            className="text-xs h-8"
        >
            <UploadCloudIcon className="w-3 h-3 mr-1.5" /> Change Screenshot
        </Button>
      )}


      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="deviceScale" className="text-xs">
          Scale: {Math.round((element.scale || 1) * 100)}%
        </Label>
        <Slider
          id="deviceScale"
          min={10} 
          max={500} 
          step={1} 
          value={[(element.scale || 1) * 100]}
          onValueChange={(value) => onUpdateElement({ scale: value[0] / 100 })}
          className="my-2"
        />
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="deviceRotation" className="text-xs">
          Rotation: {Math.round(element.rotation || 0)}°
        </Label>
        <Slider
          id="deviceRotation"
          min={-180}
          max={180}
          step={1}
          value={[element.rotation || 0]}
          onValueChange={(value) => onUpdateElement({ rotation: value[0] })}
          className="my-2"
        />
      </div>
      {element.deviceType === 'custom' && element.screenshotSrc && element.screenshotRect && (
        <>
            <div className="flex flex-col space-y-1 min-w-[120px]">
                <Label htmlFor="ssLeft" className="text-xs">Screenshot Left: {screenshotLeft}%</Label>
                <Slider id="ssLeft" min={-50} max={150} step={0.5} value={[screenshotLeft]} onValueChange={(val) => handleScreenshotRectChange('left', val[0])} />
            </div>
            <div className="flex flex-col space-y-1 min-w-[120px]">
                <Label htmlFor="ssTop" className="text-xs">Screenshot Top: {screenshotTop}%</Label>
                <Slider id="ssTop" min={-50} max={150} step={0.5} value={[screenshotTop]} onValueChange={(val) => handleScreenshotRectChange('top', val[0])} />
            </div>
            <div className="flex flex-col space-y-1 min-w-[120px]">
                <Label htmlFor="ssWidth" className="text-xs">Screenshot Width: {screenshotWidth}%</Label>
                <Slider id="ssWidth" min={10} max={200} step={0.5} value={[screenshotWidth]} onValueChange={(val) => handleScreenshotRectChange('width', val[0])} />
            </div>
            <div className="flex flex-col space-y-1 min-w-[120px]">
                <Label htmlFor="ssHeight" className="text-xs">Screenshot Height: {screenshotHeight}%</Label>
                <Slider id="ssHeight" min={10} max={200} step={0.5} value={[screenshotHeight]} onValueChange={(val) => handleScreenshotRectChange('height', val[0])} />
            </div>
        </>
      )}
      <Input 
        type="file" 
        ref={hiddenFileInputRef} 
        onChange={handleFileSelected} 
        className="hidden"
        accept="image/*"
      />
    </>
  );

  return (
    <div className="h-auto bg-card border-b shadow-sm flex items-center px-4 py-2 space-x-4 text-sm flex-wrap gap-y-2">
      <span className="font-semibold capitalize text-muted-foreground">{selectedElement.type}{selectedElement.type === 'device' ? ` (${selectedElement.deviceType})`: ''} Properties:</span>
      {selectedElement.type === 'text' && renderTextProperties(selectedElement as TextElementProps)}
      {selectedElement.type === 'shape' && renderShapeProperties(selectedElement as ShapeElementProps)}
      {selectedElement.type === 'device' && renderDeviceProperties(selectedElement as DeviceFrameElementProps)}
    </div>
  );
}
