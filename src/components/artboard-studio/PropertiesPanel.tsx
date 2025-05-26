"use client";

import type React from 'react';
import { useEffect, useState, useRef } from 'react';
import type { ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps, DeviceType, ArtboardState } from '@/types/artboard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { UploadCloudIcon, PaintbrushIcon, Palette } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface PropertiesPanelProps {
  selectedElement: ArtboardElement | null;
  onUpdateElement: (updates: Partial<ArtboardElement>) => void;
  activeArtboardDetails?: ArtboardState | null;
  onUpdateArtboardDetails?: (updates: Partial<ArtboardState>) => void;
  className?: string;
}

// Predefined solid colors
const solidColorPalette = [
  '#E97451', // Burnt Sienna
  '#FF8C00', // Dark Orange
  '#FF0000', // Red
  '#FF69B4', // Hot Pink
  '#9370DB', // Medium Purple
  '#4169E1', // Royal Blue
  '#0000FF', // Blue
  '#40E0D0', // Turquoise
  '#00CED1', // Dark Turquoise
  '#3CB371', // Medium Sea Green
  '#32CD32', // Lime Green
  '#006400', // Dark Green
  '#FFD700', // Gold
  '#D4AF37', // Metallic Gold
  '#8B4513', // Saddle Brown
  '#A52A2A', // Brown
  '#800000', // Maroon
  '#FFFFFF', // White
  '#808080', // Gray
  '#000000', // Black
];

// Expanded gradient presets with more modern and stylish options
const gradientPresets = [
  // Original aesthetically pleasing gradients
  { color1: '#00F260', color2: '#0575E6', angle: 45 },  // Green to Blue
  { color1: '#1A2980', color2: '#26D0CE', angle: 45 },  // Deep Blue to Cyan
  { color1: '#FC5C7D', color2: '#6A82FB', angle: 45 },  // Pink to Purple
  { color1: '#FFAFBD', color2: '#ffc3a0', angle: 45 },  // Light Pink to Light Orange
  
  // New modern vibrant gradients (inspired by your image)
  { color1: '#00FFCC', color2: '#00FF85', angle: 0 },   // Aqua to Mint
  { color1: '#00FFAA', color2: '#42A6FF', angle: 90 },  // Mint to Blue
  { color1: '#4158D0', color2: '#C850C0', angle: 45 },  // Royal Blue to Magenta
  { color1: '#0093E9', color2: '#80D0C7', angle: 160 }, // Azure to Turquoise
  { color1: '#00DBDE', color2: '#FC00FF', angle: 90 },  // Turquoise to Pink
  { color1: '#08AEEA', color2: '#2AF598', angle: 0 },   // Blue to Green
  
  // Vibrant color transitions
  { color1: '#FF9A8B', color2: '#FF6A88', angle: 45 },  // Coral to Pink
  { color1: '#FBAB7E', color2: '#F7CE68', angle: 0 },   // Orange to Yellow
  { color1: '#85FFBD', color2: '#FFFB7D', angle: 45 },  // Mint to Yellow
  { color1: '#FA8BFF', color2: '#2BD2FF', angle: 90 },  // Pink to Blue
  { color1: '#FF3CAC', color2: '#784BA0', angle: 135 }, // Magenta to Purple
  
  // Subtle professional gradients
  { color1: '#D4FC79', color2: '#96E6A1', angle: 45 },  // Lime to Green
  { color1: '#E2B0FF', color2: '#9F44D3', angle: 90 },  // Lavender to Purple
  { color1: '#F9D423', color2: '#FF4E50', angle: 45 },  // Yellow to Red
  { color1: '#A1C4FD', color2: '#C2E9FB', angle: 180 }, // Blue to Light Blue
  { color1: '#FFECD2', color2: '#FCB69F', angle: 0 },   // Cream to Peach
  
  // Dark mode friendly gradients
  { color1: '#434343', color2: '#000000', angle: 90 },  // Dark Gray to Black
  { color1: '#4B1248', color2: '#F0C27B', angle: 45 },  // Dark Purple to Gold
  { color1: '#093028', color2: '#237A57', angle: 45 },  // Dark Green to Forest Green
  { color1: '#1e3c72', color2: '#2a5298', angle: 180 }, // Navy Blue shades
  { color1: '#5D4157', color2: '#A8CABA', angle: 135 }, // Mauve to Pastel Green
];

export function PropertiesPanel({ 
  selectedElement, 
  onUpdateElement, 
  activeArtboardDetails, 
  onUpdateArtboardDetails,
  className 
}: PropertiesPanelProps) {
  // Use a ref to track client-side initialization
  const isClient = useRef(false);
  const [isClientSide, setIsClientSide] = useState(false);
  
  // Background state for artboard
  const [solidColor, setSolidColor] = useState('#FFFFFF');
  const [gradientColor1, setGradientColor1] = useState('#00F260');
  const [gradientColor2, setGradientColor2] = useState('#0575E6');
  const [gradientAngle, setGradientAngle] = useState(45);
  const [activeBackgroundTab, setActiveBackgroundTab] = useState<'solid' | 'gradient'>('solid');

  const [localContent, setLocalContent] = useState('');
  const hiddenFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadPurpose, setUploadPurpose] = useState<'customFrame' | 'screenshot' | null>(null);

  const [screenshotLeft, setScreenshotLeft] = useState(5);
  const [screenshotTop, setScreenshotTop] = useState(5);
  const [screenshotWidth, setScreenshotWidth] = useState(90);
  const [screenshotHeight, setScreenshotHeight] = useState(90);

  useEffect(() => {
    // Mark as client-side rendered to avoid hydration issues
    isClient.current = true;
    setIsClientSide(true);
    
    if (selectedElement?.type === 'text') {
      setLocalContent((selectedElement as TextElementProps).content);
    }
    if (selectedElement?.type === 'device') {
      const deviceElement = selectedElement as DeviceFrameElementProps;
      if (deviceElement.screenshotRect) { // Applies to all device types if rect exists
        setScreenshotLeft(deviceElement.screenshotRect.left);
        setScreenshotTop(deviceElement.screenshotRect.top);
        setScreenshotWidth(deviceElement.screenshotRect.width);
        setScreenshotHeight(deviceElement.screenshotRect.height);
      } else {
        // Default values if no rect (e.g. before screenshot upload)
        setScreenshotLeft(5);
        setScreenshotTop(5);
        setScreenshotWidth(90);
        setScreenshotHeight(90);
      }
    }

    // Initialize background controls when artboard is selected and after client-side rendering
    if (isClient.current && !selectedElement && activeArtboardDetails) {
      setSolidColor(activeArtboardDetails.backgroundColor || '#FFFFFF');
      setActiveBackgroundTab(activeArtboardDetails.backgroundType || 'solid');
      
      if (activeArtboardDetails.backgroundGradient) {
        setGradientColor1(activeArtboardDetails.backgroundGradient.color1);
        setGradientColor2(activeArtboardDetails.backgroundGradient.color2);
        setGradientAngle(activeArtboardDetails.backgroundGradient.angle);
      }
    }
  }, [selectedElement, activeArtboardDetails]);

  // Handle background tab change
  const handleBackgroundTabChange = (value: string) => {
    if (!onUpdateArtboardDetails) return;
    
    const tabValue = value as 'solid' | 'gradient';
    setActiveBackgroundTab(tabValue);
    
    // When switching tabs, update the background type
    const updates: Partial<ArtboardState> = {
      backgroundType: tabValue
    };
    
    // Initialize gradient settings if switching to gradient and not already set
    if (tabValue === 'gradient' && activeArtboardDetails && !activeArtboardDetails.backgroundGradient) {
      updates.backgroundGradient = {
        color1: gradientColor1,
        color2: gradientColor2,
        angle: gradientAngle
      };
    }
    
    onUpdateArtboardDetails(updates);
  };

  // Handle solid color change
  const handleSolidColorChange = (color: string) => {
    if (!onUpdateArtboardDetails) return;
    
    setSolidColor(color);
    onUpdateArtboardDetails({ backgroundColor: color });
  };

  // Handle gradient color or angle change
  const handleGradientChange = (
    property: 'color1' | 'color2' | 'angle',
    value: string | number
  ) => {
    if (!onUpdateArtboardDetails || !activeArtboardDetails) return;
    
    const updates = { 
      ...(activeArtboardDetails.backgroundGradient || { 
        color1: gradientColor1, 
        color2: gradientColor2, 
        angle: gradientAngle 
      }) 
    };
    
    if (property === 'color1') {
      setGradientColor1(value as string);
      updates.color1 = value as string;
    } else if (property === 'color2') {
      setGradientColor2(value as string);
      updates.color2 = value as string;
    } else if (property === 'angle') {
      setGradientAngle(value as number);
      updates.angle = value as number;
    }
    
    onUpdateArtboardDetails({ backgroundGradient: updates });
  };

  // Apply a gradient preset
  const applyGradientPreset = (preset: { color1: string; color2: string; angle: number }) => {
    if (!onUpdateArtboardDetails) return;
    
    setGradientColor1(preset.color1);
    setGradientColor2(preset.color2);
    setGradientAngle(preset.angle);
    
    onUpdateArtboardDetails({
      backgroundType: 'gradient',
      backgroundGradient: preset
    });
  };

  // Text element handlers
  const handleTextContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalContent(e.target.value);
  };

  const handleTextContentBlur = () => {
    if (selectedElement?.type === 'text' && localContent !== (selectedElement as TextElementProps).content) {
      onUpdateElement({ content: localContent });
    }
  };

  // Device element handlers
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
        if (uploadPurpose === 'customFrame' && selectedElement?.deviceType === 'custom') {
          onUpdateElement({ customFrameSrc: dataUrl, screenshotSrc: undefined, screenshotRect: undefined, naturalScreenshotHeight: undefined, naturalScreenshotWidth: undefined });
        } else if (uploadPurpose === 'screenshot') {
          const img = new window.Image();
          img.onload = () => {
            onUpdateElement({
              screenshotSrc: dataUrl,
              naturalScreenshotWidth: img.naturalWidth,
              naturalScreenshotHeight: img.naturalHeight,
              screenshotRect: { left: 5, top: 5, width: 90, height: 90 } // Default rect for all
            });
          };
          img.src = dataUrl;
        }
        setUploadPurpose(null);
      };
      reader.readAsDataURL(file);
    }
    if (hiddenFileInputRef.current) {
      hiddenFileInputRef.current.value = "";
    }
  };

  const handleScreenshotRectChange = (type: 'left' | 'top' | 'width' | 'height', value: number) => {
    const currentRect = (selectedElement as DeviceFrameElementProps)?.screenshotRect || { left: 5, top: 5, width: 90, height: 90 };
    const newRect = { ...currentRect };

    if (type === 'left') { setScreenshotLeft(value); newRect.left = value; }
    if (type === 'top') { setScreenshotTop(value); newRect.top = value; }
    if (type === 'width') { setScreenshotWidth(value); newRect.width = value; }
    if (type === 'height') { setScreenshotHeight(value); newRect.height = value; }

    onUpdateElement({ screenshotRect: newRect });
  };

  // Fix: Define the renderDeviceProperties function here
  const renderDeviceProperties = (element: DeviceFrameElementProps) => (
    <>
      {element.deviceType === 'custom' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleImageUploadButtonClick('customFrame')}
          className="text-xs h-8"
        >
          <UploadCloudIcon className="w-3 h-3 mr-1.5" />
          {element.customFrameSrc ? 'Change Mockup' : 'Upload Mockup'}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleImageUploadButtonClick('screenshot')}
        className="text-xs h-8"
      >
        <UploadCloudIcon className="w-3 h-3 mr-1.5" />
        {element.screenshotSrc ? 'Change Screenshot' : 'Upload Screenshot'}
      </Button>

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
      {/* Screenshot adjustment sliders for ALL device types if screenshotSrc and screenshotRect exist */}
      {element.screenshotSrc && element.screenshotRect && (
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

  // Make sure the renderTextProperties and renderShapeProperties functions are defined here as well
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

  // No element or artboard selected
  if (!selectedElement && !activeArtboardDetails) {
    return (
      <div className={cn("h-auto bg-card border-b shadow-sm flex items-center px-4 py-2 text-sm text-muted-foreground min-h-[56px]", className)} suppressHydrationWarning>
        No element selected. Select an element or artboard to see its properties.
      </div>
    );
  }

  // Artboard background properties
  if (!selectedElement && activeArtboardDetails && isClientSide) {
    return (
      <div className={cn("h-auto bg-card border-b shadow-sm flex items-center px-4 py-2 space-x-4 text-sm flex-wrap gap-y-2 min-h-[56px]", className)} suppressHydrationWarning>
        <span className="font-semibold capitalize text-muted-foreground">
          Artboard Properties:
        </span>

        <div className="flex flex-col space-y-1">
          <Label htmlFor="bgType" className="text-xs">Background Type</Label>
          <RadioGroup 
            id="bgType"
            value={activeBackgroundTab}
            onValueChange={handleBackgroundTabChange}
            className="flex items-center space-x-4 h-8"
          >
            <div className="flex items-center space-x-1">
              <RadioGroupItem value="solid" id="solid" />
              <Label htmlFor="solid" className="text-xs cursor-pointer">Solid</Label>
            </div>
            <div className="flex items-center space-x-1">
              <RadioGroupItem value="gradient" id="gradient" />
              <Label htmlFor="gradient" className="text-xs cursor-pointer">Gradient</Label>
            </div>
          </RadioGroup>
        </div>

        {activeBackgroundTab === 'solid' ? (
          <div className="flex flex-col space-y-1">
            <Label htmlFor="bgColor" className="text-xs">Background Color</Label>
            <div className="flex items-center space-x-2">
              <Input
                id="bgColor"
                type="color"
                value={solidColor}
                onChange={(e) => handleSolidColorChange(e.target.value)}
                className="w-8 h-8 p-1"
              />
              <Input
                type="text"
                value={solidColor.toUpperCase()}
                onChange={(e) => handleSolidColorChange(e.target.value)}
                className="w-24 font-mono text-xs h-8"
              />
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col space-y-1">
              <Label className="text-xs">First Color</Label>
              <div className="flex items-center space-x-2">
                <Input
                  type="color"
                  value={gradientColor1}
                  onChange={(e) => handleGradientChange('color1', e.target.value)}
                  className="w-8 h-8 p-1"
                />
                <Input
                  type="text"
                  value={gradientColor1.toUpperCase()}
                  onChange={(e) => handleGradientChange('color1', e.target.value)}
                  className="w-24 font-mono text-xs h-8"
                />
              </div>
            </div>
            
            <div className="flex flex-col space-y-1">
              <Label className="text-xs">Second Color</Label>
              <div className="flex items-center space-x-2">
                <Input
                  type="color"
                  value={gradientColor2}
                  onChange={(e) => handleGradientChange('color2', e.target.value)}
                  className="w-8 h-8 p-1"
                />
                <Input
                  type="text"
                  value={gradientColor2.toUpperCase()}
                  onChange={(e) => handleGradientChange('color2', e.target.value)}
                  className="w-24 font-mono text-xs h-8"
                />
              </div>
            </div>
            
            <div className="flex flex-col space-y-1 min-w-[120px]">
              <Label htmlFor="gradientAngle" className="text-xs">
                Angle: {gradientAngle}°
              </Label>
              <Slider
                id="gradientAngle"
                min={0}
                max={360}
                step={1}
                value={[gradientAngle]}
                onValueChange={(value) => handleGradientChange('angle', value[0])}
                className="w-24"
              />
            </div>
          </>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <Palette className="w-3 h-3 mr-1" />
              <span>{activeBackgroundTab === 'solid' ? 'Color Presets' : 'Gradient Presets'}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2">
            <div className="space-y-2">
              <Label className="text-xs">
                {activeBackgroundTab === 'solid' ? 'Color Palette' : 'Gradient Presets'}
              </Label>
              
              {activeBackgroundTab === 'solid' ? (
                <div className="grid grid-cols-5 gap-1">
                  {solidColorPalette.slice(0, 20).map((color, index) => (
                    <button
                      key={`solid-${index}`}
                      className="w-8 h-8 rounded border border-border hover:opacity-80 focus:ring-2 focus:ring-primary"
                      style={{ backgroundColor: color }}
                      onClick={() => handleSolidColorChange(color)}
                      title={color}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {gradientPresets.map((preset, index) => (
                    <button
                      key={`gradient-${index}`}
                      className="h-10 rounded border border-border hover:opacity-80 focus:ring-2 focus:ring-primary"
                      style={{
                        background: `linear-gradient(${preset.angle}deg, ${preset.color1}, ${preset.color2})`
                      }}
                      onClick={() => applyGradientPreset(preset)}
                    />
                  ))}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // Element properties
  if (selectedElement) {
    return (
      <div className={cn("h-auto bg-card border-b shadow-sm flex items-center px-4 py-2 space-x-4 text-sm flex-wrap gap-y-2 min-h-[56px]", className)} suppressHydrationWarning>
        <span className="font-semibold capitalize text-muted-foreground">
          {selectedElement.type}
          {selectedElement.type === 'device' ? ` (${(selectedElement as DeviceFrameElementProps).deviceType})` : ''}
          {' '}Properties:
        </span>
        {selectedElement.type === 'text' && renderTextProperties(selectedElement as TextElementProps)}
        {selectedElement.type === 'shape' && renderShapeProperties(selectedElement as ShapeElementProps)}
        {selectedElement.type === 'device' && renderDeviceProperties(selectedElement as DeviceFrameElementProps)}
      </div>
    );
  }

  // Default fallback
  return (
    <div className={cn("h-auto bg-card border-b shadow-sm flex items-center px-4 py-2 text-sm text-muted-foreground min-h-[56px]", className)} suppressHydrationWarning>
      Loading properties...
    </div>
  );
}
