"use client";

import type React from 'react';
import { useEffect, useState, useRef } from 'react';
import type { ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps, ImageElementProps, DeviceType, DeviceStyleType, ArtboardState } from '@/types/artboard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { UploadCloudIcon, PaintbrushIcon, Palette, Plus, Minus, Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel
} from "@/components/ui/select";
import { getFontOptions, getGroupedFontOptions } from '@/services/fontService';

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
  const [uploadPurpose, setUploadPurpose] = useState<'customFrame' | 'screenshot' | 'image' | null>(null);

  const [screenshotLeft, setScreenshotLeft] = useState(5);
  const [screenshotTop, setScreenshotTop] = useState(5);
  const [screenshotWidth, setScreenshotWidth] = useState(90);
  const [screenshotHeight, setScreenshotHeight] = useState(90);

  // Text element states for styling options
  const [fontWeight, setFontWeight] = useState<string>('normal');
  const [fontStyle, setFontStyle] = useState<string>('normal');
  const [textDecoration, setTextDecoration] = useState<string>('none');
  const [textAlign, setTextAlign] = useState<string>('left');
  const [lineHeight, setLineHeight] = useState<number>(1.2);

  // Add state for shape corner controls
  const [borderRadiusType, setBorderRadiusType] = useState<'uniform' | 'individual'>('uniform');
  const [uniformBorderRadius, setUniformBorderRadius] = useState<number>(0);
  const [cornerTopLeft, setCornerTopLeft] = useState<number>(0);
  const [cornerTopRight, setCornerTopRight] = useState<number>(0);
  const [cornerBottomRight, setCornerBottomRight] = useState<number>(0);
  const [cornerBottomLeft, setCornerBottomLeft] = useState<number>(0);
  const [customPoints, setCustomPoints] = useState<number>(5);
  
  // Add state for circle inner radius
  const [innerRadius, setInnerRadius] = useState<number>(0);
  
  // Add state for fill opacity
  const [fillOpacity, setFillOpacity] = useState<number>(1);

  // Function to convert CSS variables to hex color
  const cssVarToHex = (cssVar: string): string => {
    // Check if it's a CSS variable format like 'hsl(var(--card))'
    if (cssVar?.toLowerCase().includes('var(--') || cssVar?.toLowerCase().includes('hsl')) {
      // Return a default color that matches the theme
      return '#FFFFFF'; // Default white to match light theme card color
    }
    return cssVar || '#FFFFFF';
  };

  useEffect(() => {
    // Mark as client-side rendered to avoid hydration issues
    isClient.current = true;
    setIsClientSide(true);
    
    if (selectedElement?.type === 'text') {
      const textElement = selectedElement as TextElementProps;
      setLocalContent(textElement.content);
      // Set text styling states with default values if not present
      setFontWeight(textElement.fontWeight || 'normal');
      setFontStyle(textElement.fontStyle || 'normal');
      setTextDecoration(textElement.textDecoration || 'none');
      setTextAlign(textElement.textAlign || 'left');
      setLineHeight(textElement.lineHeight || 1.2);
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
    if (selectedElement?.type === 'shape') {
      const shapeElement = selectedElement as ShapeElementProps;
      // Initialize shape-specific states
      setCustomPoints(shapeElement.customPoints || 5);
      setInnerRadius(shapeElement.innerRadius || 0);
      setFillOpacity(shapeElement.fillOpacity || 1);
      
      // Initialize corner radius states
      setBorderRadiusType(shapeElement.borderRadiusType || 'uniform');
      setUniformBorderRadius(typeof shapeElement.borderRadius === 'number' ? shapeElement.borderRadius : 0);
      setCornerTopLeft(shapeElement.borderRadiusTopLeft || 0);
      setCornerTopRight(shapeElement.borderRadiusTopRight || 0);
      setCornerBottomRight(shapeElement.borderRadiusBottomRight || 0);
      setCornerBottomLeft(shapeElement.borderRadiusBottomLeft || 0);
    }

    // Initialize background controls when artboard is selected and after client-side rendering
    if (isClient.current && !selectedElement && activeArtboardDetails) {
      // Convert CSS variables to hex if needed
      const backgroundColor = cssVarToHex(activeArtboardDetails.backgroundColor);
      setSolidColor(backgroundColor);
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
    
    // Don't allow setting CSS variables through the color picker
    if (color?.toLowerCase().includes('var(') || color?.toLowerCase().includes('hsl(var')) {
      color = '#FFFFFF';
    }
    
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
  const handleImageUploadButtonClick = (purpose: 'customFrame' | 'screenshot' | 'image') => {
    setUploadPurpose(purpose);
    hiddenFileInputRef.current?.click();
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && uploadPurpose) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        if (uploadPurpose === 'customFrame' && selectedElement && selectedElement.type === 'device' && (selectedElement as DeviceFrameElementProps).deviceType === 'custom') {
          onUpdateElement({ customFrameSrc: dataUrl, screenshotSrc: undefined, screenshotRect: undefined, naturalScreenshotHeight: undefined, naturalScreenshotWidth: undefined });
        } else if (uploadPurpose === 'screenshot') {
          const img = new window.Image();
          img.onload = () => {
            onUpdateElement({
              screenshotSrc: dataUrl,
              naturalScreenshotWidth: img.naturalWidth,
              naturalScreenshotHeight: img.naturalHeight,
              screenshotRect: { left: 5, top: 5, width: 90, height: 90 }
            });
          };
          img.src = dataUrl;
        } else if (uploadPurpose === 'image') {
          onUpdateElement({
            imageSrc: dataUrl,
            imageAlt: file.name,
          });
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

  // Add device style type handler
  const handleDeviceStyleTypeChange = (styleType: string) => {
    if (selectedElement?.type === 'device') {
      onUpdateElement({ styleType: styleType as DeviceStyleType });
    }
  };
  
  // Add custom matrix3d handler
  const handleCustomMatrix3dChange = (matrix3d: string) => {
    if (selectedElement?.type === 'device') {
      onUpdateElement({ matrix3d });
    }
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
      
      {/* Device style type selector with the new perspective options */}
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="deviceStyleType" className="text-xs">
          Device Perspective
        </Label>
        <Select
          value={element.styleType || 'normal'}
          onValueChange={handleDeviceStyleTypeChange}
        >
          <SelectTrigger id="deviceStyleType" className="h-8 text-xs">
            <SelectValue placeholder="Select Perspective" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="perspective-left">Left Angle</SelectItem>
            <SelectItem value="perspective-slight-left">Slight Left</SelectItem>
            <SelectItem value="perspective-right">Right Angle</SelectItem>
            <SelectItem value="perspective-slight-right">Slight Right</SelectItem>
            <SelectItem value="perspective-front">Front Angle</SelectItem>
            <SelectItem value="custom">Custom Matrix3D</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Show custom matrix3d input when custom style is selected */}
      {element.styleType === 'custom' && (
        <div className="flex flex-col space-y-1 min-w-[100%]">
          <Label htmlFor="customMatrix3d" className="text-xs">
            Custom Matrix3D
          </Label>
          <Input
            id="customMatrix3d"
            value={element.matrix3d || ''}
            onChange={(e) => handleCustomMatrix3dChange(e.target.value)}
            placeholder="matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)"
            className="text-xs h-8 font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Example: matrix3d(1.04438, 0.150877, 0, -5.73e-05, -1.65196, 2.31898, 0, -0.0001854, 0, 0, 1, 0, 64.9858, -3.12602, 0, 1)
          </p>
        </div>
      )}
      
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

  // Update text styling - simplified to directly update element
  const toggleFontStyle = (property: 'fontWeight' | 'fontStyle' | 'textDecoration', value: string) => {
    if (!selectedElement || selectedElement.type !== 'text') return;
    
    let newValue = value;
    
    // Toggle logic
    if (property === 'fontWeight') {
      newValue = fontWeight === 'bold' ? 'normal' : 'bold';
      setFontWeight(newValue);
    }
    else if (property === 'fontStyle') {
      newValue = fontStyle === 'italic' ? 'normal' : 'italic';
      setFontStyle(newValue);
    }
    else if (property === 'textDecoration') {
      // Handle multiple text decorations (underline, line-through)
      const currentDecoration = textDecoration || 'none';
      if (value === 'underline') {
        newValue = currentDecoration.includes('underline')
          ? currentDecoration.replace('underline', '').trim()
          : `${currentDecoration === 'none' ? '' : currentDecoration} underline`.trim();
      } else if (value === 'line-through') {
        newValue = currentDecoration.includes('line-through')
          ? currentDecoration.replace('line-through', '').trim()
          : `${currentDecoration === 'none' ? '' : currentDecoration} line-through`.trim();
      }
      
      // If empty after removing decorations, set to 'none'
      if (!newValue) newValue = 'none';
      setTextDecoration(newValue);
    }
    
    // Direct update to the element
    const updates: Partial<TextElementProps> = {};
    updates[property] = newValue;
    onUpdateElement(updates);
  };

  // Update text alignment - simplified direct update
  const setTextAlignment = (alignment: string) => {
    if (!selectedElement || selectedElement.type !== 'text') return;
    setTextAlign(alignment);
    onUpdateElement({ textAlign: alignment });
  };

  // Update line height - handle direct update
  const handleLineHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedElement || selectedElement.type !== 'text') return;
    const value = parseFloat(e.target.value) || 1.2;
    setLineHeight(value);
    onUpdateElement({ lineHeight: value });
  };

  // Render text properties in a more compact horizontal layout
  const renderTextProperties = (element: TextElementProps) => {
    const groupedFonts = getGroupedFontOptions();
    
    return (
      <div className="space-y-4">
        {/* Content */}
        <div className="space-y-2">
          <Label htmlFor="textContent" className="text-xs font-medium">Content</Label>
          <Input
            id="textContent"
            value={localContent}
            onChange={(e) => setLocalContent(e.target.value)}
            onBlur={handleTextContentBlur}
            className="text-sm"
          />
        </div>
        
        {/* Font Family */}
        <div className="space-y-2">
          <Label htmlFor="fontFamily" className="text-xs font-medium">Font Family</Label>
          <Select
            value={element.fontFamily || 'Arial'}
            onValueChange={(value) => onUpdateElement({ fontFamily: value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Font Family" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>System Fonts</SelectLabel>
                {groupedFonts.system.map(font => (
                  <SelectItem 
                    key={font.value} 
                    value={font.value}
                    style={{ fontFamily: `${font.value}, ${font.category}` }}
                  >
                    {font.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Latin Fonts</SelectLabel>
                {groupedFonts.latin.map(font => (
                  <SelectItem 
                    key={font.value} 
                    value={font.value}
                    style={{ fontFamily: `${font.value}, ${font.category}` }}
                  >
                    {font.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Arabic Fonts</SelectLabel>
                {groupedFonts.arabic.map(font => (
                  <SelectItem 
                    key={font.value} 
                    value={font.value}
                    style={{ fontFamily: `${font.value}, ${font.category}` }}
                  >
                    {font.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Urdu Fonts</SelectLabel>
                {groupedFonts.urdu.map(font => (
                  <SelectItem 
                    key={font.value} 
                    value={font.value}
                    style={{ fontFamily: `${font.value}, ${font.category}` }}
                  >
                    {font.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Multilingual</SelectLabel>
                {groupedFonts.multilingual.map(font => (
                  <SelectItem 
                    key={font.value} 
                    value={font.value}
                    style={{ fontFamily: `${font.value}, ${font.category}` }}
                  >
                    {font.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
          
        {/* Font Size and Line Height */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="fontSize" className="text-xs font-medium">Font Size</Label>
            <Input
              id="fontSize"
              type="number"
              value={element.fontSize}
              onChange={(e) => onUpdateElement({ fontSize: parseInt(e.target.value, 10) || 16 })}
              className="text-sm"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="lineHeight" className="text-xs font-medium">Line Height</Label>
            <Input
              id="lineHeight"
              type="number"
              value={lineHeight}
              onChange={handleLineHeightChange}
              className="text-sm"
              step="0.1"
            />
          </div>
        </div>
          
        {/* Font Color */}
        <div className="space-y-2">
          <Label htmlFor="fontColor" className="text-xs font-medium">Color</Label>
          <div className="flex items-center gap-2">
            <Input
              id="fontColor"
              type="color"
              value={element.color}
              onChange={(e) => onUpdateElement({ color: e.target.value })}
              className="w-10 h-10 p-1"
            />
            <Input
              type="text"
              value={element.color}
              onChange={(e) => onUpdateElement({ color: e.target.value })}
              className="flex-1 text-xs font-mono"
            />
          </div>
        </div>
          
        {/* Font Style */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Text Style</Label>
          <div className="flex items-center space-x-1 flex-wrap gap-1">
            <Button
              variant={fontWeight === 'bold' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleFontStyle('fontWeight', 'bold')}
              title="Bold"
            >
              <Bold className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={fontStyle === 'italic' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleFontStyle('fontStyle', 'italic')}
              title="Italic"
            >
              <Italic className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={textDecoration?.includes('underline') ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleFontStyle('textDecoration', 'underline')}
              title="Underline"
            >
              <Underline className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={textDecoration?.includes('line-through') ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleFontStyle('textDecoration', 'line-through')}
              title="Strikethrough"
            >
              <Strikethrough className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
          
        {/* Text Alignment */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Text Alignment</Label>
          <div className="flex items-center space-x-1">
            <Button
              variant={textAlign === 'left' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setTextAlignment('left')}
              title="Align Left"
            >
              <AlignLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={textAlign === 'center' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setTextAlignment('center')}
              title="Align Center"
            >
              <AlignCenter className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={textAlign === 'right' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setTextAlignment('right')}
              title="Align Right"
            >
              <AlignRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Add handlers for corner controls
  const handleBorderRadiusTypeChange = (type: 'uniform' | 'individual') => {
    setBorderRadiusType(type);
    if (type === 'uniform') {
      onUpdateElement({
        borderRadiusType: 'uniform',
        borderRadius: uniformBorderRadius,
        borderRadiusTopLeft: undefined,
        borderRadiusTopRight: undefined,
        borderRadiusBottomRight: undefined,
        borderRadiusBottomLeft: undefined
      });
    } else {
      onUpdateElement({
        borderRadiusType: 'individual',
        borderRadius: undefined,
        borderRadiusTopLeft: cornerTopLeft,
        borderRadiusTopRight: cornerTopRight,
        borderRadiusBottomRight: cornerBottomRight,
        borderRadiusBottomLeft: cornerBottomLeft
      });
    }
  };

  const handleUniformBorderRadiusChange = (radius: number) => {
    setUniformBorderRadius(radius);
    onUpdateElement({
      borderRadius: radius
    });
  };

  const handleIndividualCornerChange = (
    corner: 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft',
    value: number
  ) => {
    switch (corner) {
      case 'topLeft':
        setCornerTopLeft(value);
        onUpdateElement({ borderRadiusTopLeft: value });
        break;
      case 'topRight':
        setCornerTopRight(value);
        onUpdateElement({ borderRadiusTopRight: value });
        break;
      case 'bottomRight':
        setCornerBottomRight(value);
        onUpdateElement({ borderRadiusBottomRight: value });
        break;
      case 'bottomLeft':
        setCornerBottomLeft(value);
        onUpdateElement({ borderRadiusBottomLeft: value });
        break;
    }
  };

  // Add the missing handleCustomPointsChange function
  const handleCustomPointsChange = (points: number) => {
    setCustomPoints(points);
    onUpdateElement({
      customPoints: points
    });
  };

  // Add handler for circle inner radius
  const handleInnerRadiusChange = (radius: number) => {
    setInnerRadius(radius);
    onUpdateElement({
      innerRadius: radius
    });
  };

  // Add handler for fill opacity
  const handleFillOpacityChange = (opacity: number) => {
    setFillOpacity(opacity);
    onUpdateElement({
      fillOpacity: opacity
    });
  };

  // Function to render image properties
  const renderImageProperties = (element: ImageElementProps) => (
    <div className="w-full flex flex-wrap gap-2 items-start">
      {/* Image Upload Button */}
      <div className="flex-shrink-0">
        <Label className="text-xs mb-1 block">Image</Label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleImageUploadButtonClick('image')}
          className="text-xs h-8"
        >
          <UploadCloudIcon className="w-3 h-3 mr-1.5" />
          {element.imageSrc ? 'Change Image' : 'Upload Image'}
        </Button>
      </div>

      {/* Object Fit */}
      <div className="w-[120px]">
        <Label htmlFor="objectFit" className="text-xs mb-1 block">Object Fit</Label>
        <Select
          value={element.objectFit || 'cover'}
          onValueChange={(value) => onUpdateElement({ objectFit: value as 'contain' | 'cover' | 'fill' | 'none' | 'scale-down' })}
        >
          <SelectTrigger id="objectFit" className="h-8 text-xs">
            <SelectValue placeholder="Object Fit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cover">Cover</SelectItem>
            <SelectItem value="contain">Contain</SelectItem>
            <SelectItem value="fill">Fill</SelectItem>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="scale-down">Scale Down</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Opacity */}
      <div className="w-[120px]">
        <Label htmlFor="opacity" className="text-xs mb-1 block">
          Opacity: {Math.round((element.opacity || 1) * 100)}%
        </Label>
        <Slider
          id="opacity"
          min={0}
          max={1}
          step={0.01}
          value={[element.opacity || 1]}
          onValueChange={(value) => onUpdateElement({ opacity: value[0] })}
          className="my-2"
        />
      </div>

      {/* Border Radius */}
      <div className="w-[120px]">
        <Label htmlFor="imageBorderRadius" className="text-xs mb-1 block">
          Border Radius: {element.borderRadius || 0}px
        </Label>
        <Slider
          id="imageBorderRadius"
          min={0}
          max={50}
          step={1}
          value={[element.borderRadius || 0]}
          onValueChange={(value) => onUpdateElement({ borderRadius: value[0] })}
          className="my-2"
        />
      </div>

      {/* Image Alt Text */}
      <div className="flex-1 min-w-[150px]">
        <Label htmlFor="imageAlt" className="text-xs mb-1 block">Alt Text</Label>
        <Input
          id="imageAlt"
          value={element.imageAlt || ''}
          onChange={(e) => onUpdateElement({ imageAlt: e.target.value })}
          placeholder="Describe the image"
          className="text-xs h-8"
        />
      </div>
    </div>
  );

  // Function to render shape-specific controls
  const renderShapeProperties = (element: ShapeElementProps) => {
    console.log('renderShapeProperties called with element:', element);
    console.log('element.shapeType:', element.shapeType);
    console.log('element.innerRadius:', element.innerRadius);
    
    return (
    <div className="space-y-4">
      {/* Shape Fill and Stroke controls - horizontal layout */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="fillColor">Fill Color</Label>
          <div className="flex mt-1.5">
            <Input
              id="fillColor"
              type="color"
              className="w-10 h-10 p-1 cursor-pointer"
              value={element.fillColor}
              onChange={(e) => onUpdateElement({ fillColor: e.target.value })}
            />
            <Input
              type="text"
              className="flex-1 h-10 ml-2"
              value={element.fillColor}
              onChange={(e) => onUpdateElement({ fillColor: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="strokeColor">Stroke Color</Label>
          <div className="flex mt-1.5">
            <Input
              id="strokeColor"
              type="color"
              className="w-10 h-10 p-1 cursor-pointer"
              value={element.strokeColor}
              onChange={(e) => onUpdateElement({ strokeColor: e.target.value })}
            />
            <Input
              type="text"
              className="flex-1 h-10 ml-2"
              value={element.strokeColor}
              onChange={(e) => onUpdateElement({ strokeColor: e.target.value })}
            />
          </div>
        </div>
      </div>
      
      <div>
        <Label htmlFor="strokeWidth">Stroke Width</Label>
        <div className="flex items-center gap-2">
          <Input
            id="strokeWidth"
            type="range"
            min="0"
            max="20"
            step="1"
            className="flex-1"
            value={element.strokeWidth || 0}
            onChange={(e) => onUpdateElement({ strokeWidth: parseInt(e.target.value) })}
          />
          <div className="w-10 text-center">{element.strokeWidth || 0}px</div>
        </div>
      </div>

      {/* Shape-specific controls */}
      {element.shapeType === 'star' && (
        <div>
          <Label htmlFor="customPoints">Star Points</Label>
          <div className="flex items-center gap-2">
            <Input
              id="customPoints"
              type="range"
              min="3"
              max="12"
              step="1"
              className="flex-1"
              value={customPoints}
              onChange={(e) => handleCustomPointsChange(parseInt(e.target.value))}
            />
            <div className="w-10 text-center">{customPoints}</div>
          </div>
        </div>
      )}

      {/* Circle and Diamond inner radius control */}
      {(element.shapeType === 'circle' || element.shapeType === 'diamond') && (
        <div>
          <Label htmlFor="innerRadius">Inner Radius</Label>
          <div className="flex items-center gap-2">
            <Input
              id="innerRadius"
              type="range"
              min="0"
              max="95"
              step="1"
              className="flex-1"
              value={innerRadius}
              onChange={(e) => handleInnerRadiusChange(parseInt(e.target.value))}
            />
            <div className="w-12 text-center">{innerRadius}%</div>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Creates a ring/donut shape when {'>'}0
          </div>
        </div>
      )}

      {/* Fill Opacity control for all shapes */}
      <div>
        <Label htmlFor="fillOpacity">Fill Opacity</Label>
        <div className="flex items-center gap-2">
          <Input
            id="fillOpacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            className="flex-1"
            value={fillOpacity}
            onChange={(e) => handleFillOpacityChange(parseFloat(e.target.value))}
          />
          <div className="w-12 text-center">{Math.round(fillOpacity * 100)}%</div>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Adjust transparency of the fill color
        </div>
      </div>

      {/* Only show corner controls for rectangle shape - with improved horizontal layout */}
      {element.shapeType === 'rectangle' && (
        <>
          <div>
            <Label>Corner Type</Label>
            <div className="flex gap-2 mt-1.5">
              <Button
                variant={borderRadiusType === 'uniform' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleBorderRadiusTypeChange('uniform')}
                className="flex-1"
              >
                Uniform
              </Button>
              <Button
                variant={borderRadiusType === 'individual' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleBorderRadiusTypeChange('individual')}
                className="flex-1"
              >
                Individual
              </Button>
            </div>
          </div>

          {borderRadiusType === 'uniform' ? (
            <div>
              <Label htmlFor="uniformRadius">Corner Radius</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="uniformRadius"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  className="flex-1"
                  value={uniformBorderRadius}
                  onChange={(e) => handleUniformBorderRadiusChange(parseInt(e.target.value))}
                />
                <div className="w-12 text-center">{uniformBorderRadius}px</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Individual Corners</Label>
                <div className="flex items-center space-x-2">
                  <div className="text-xs text-muted-foreground">Preview:</div>
                  <div className="w-10 h-10 border border-dashed border-muted-foreground rounded-md overflow-hidden">
                    <div 
                      className="w-full h-full bg-primary/20"
                      style={{
                        borderTopLeftRadius: `${cornerTopLeft}px`,
                        borderTopRightRadius: `${cornerTopRight}px`,
                        borderBottomRightRadius: `${cornerBottomRight}px`,
                        borderBottomLeftRadius: `${cornerBottomLeft}px`,
                      }}
                    />
                  </div>
                </div>
              </div>
              
              {/* Enhanced horizontal layout for corner controls */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between">
                    <Label htmlFor="cornerTL" className="text-xs">Top Left</Label>
                    <div className="text-xs">{cornerTopLeft}px</div>
                  </div>
                  <Input
                    id="cornerTL"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    className="w-full h-6"
                    value={cornerTopLeft}
                    onChange={(e) => handleIndividualCornerChange('topLeft', parseInt(e.target.value))}
                  />
                </div>
                
                <div>
                  <div className="flex justify-between">
                    <Label htmlFor="cornerTR" className="text-xs">Top Right</Label>
                    <div className="text-xs">{cornerTopRight}px</div>
                  </div>
                  <Input
                    id="cornerTR"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    className="w-full h-6"
                    value={cornerTopRight}
                    onChange={(e) => handleIndividualCornerChange('topRight', parseInt(e.target.value))}
                  />
                </div>
                
                <div>
                  <div className="flex justify-between">
                    <Label htmlFor="cornerBL" className="text-xs">Bottom Left</Label>
                    <div className="text-xs">{cornerBottomLeft}px</div>
                  </div>
                  <Input
                    id="cornerBL"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    className="w-full h-6"
                    value={cornerBottomLeft}
                    onChange={(e) => handleIndividualCornerChange('bottomLeft', parseInt(e.target.value))}
                  />
                </div>
                
                <div>
                  <div className="flex justify-between">
                    <Label htmlFor="cornerBR" className="text-xs">Bottom Right</Label>
                    <div className="text-xs">{cornerBottomRight}px</div>
                  </div>
                  <Input
                    id="cornerBR"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    className="w-full h-6"
                    value={cornerBottomRight}
                    onChange={(e) => handleIndividualCornerChange('bottomRight', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
    );
  };

  // No element or artboard selected
  if (!selectedElement && !activeArtboardDetails) {
    return (
      <div className={cn("w-full h-full bg-card border-l shadow-md flex flex-col overflow-hidden", className)} suppressHydrationWarning>
        <div className="px-4 py-3 border-b bg-card">
          <div className="font-medium text-foreground">Properties</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="text-sm text-muted-foreground">Select an element or artboard to see its properties.</div>
        </div>
      </div>
    );
  }

  // Artboard background properties
  if (!selectedElement && activeArtboardDetails && isClientSide) {
    // Ensure we display a proper hex color, not CSS variables
    const displayColor = cssVarToHex(solidColor);
    
    return (
      <div className={cn("w-full h-full bg-card border-l shadow-md flex flex-col overflow-hidden", className)} suppressHydrationWarning>
        <div className="px-4 py-3 border-b bg-card">
          <div className="font-medium text-foreground">Artboard Background</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
          <div className="space-y-2">
            <Label htmlFor="bgType" className="text-xs font-medium">Background Type</Label>
            <RadioGroup 
              id="bgType"
              value={activeBackgroundTab}
              onValueChange={handleBackgroundTabChange}
              className="flex flex-col space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="solid" id="solid" />
                <Label htmlFor="solid" className="text-xs cursor-pointer">Solid Color</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="gradient" id="gradient" />
                <Label htmlFor="gradient" className="text-xs cursor-pointer">Gradient</Label>
              </div>
            </RadioGroup>
          </div>

          {activeBackgroundTab === 'solid' ? (
            <div className="space-y-2">
              <Label htmlFor="bgColor" className="text-xs font-medium">Background Color</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Input
                    id="bgColor"
                    type="color"
                    value={displayColor}
                    onChange={(e) => handleSolidColorChange(e.target.value)}
                    className="w-10 h-10 p-1"
                  />
                  <Input
                    type="text"
                    value={displayColor.toUpperCase()}
                    onChange={(e) => handleSolidColorChange(e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium">First Color</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="color"
                    value={gradientColor1}
                    onChange={(e) => handleGradientChange('color1', e.target.value)}
                    className="w-10 h-10 p-1"
                  />
                  <Input
                    type="text"
                    value={gradientColor1.toUpperCase()}
                    onChange={(e) => handleGradientChange('color1', e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs font-medium">Second Color</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="color"
                    value={gradientColor2}
                    onChange={(e) => handleGradientChange('color2', e.target.value)}
                    className="w-10 h-10 p-1"
                  />
                  <Input
                    type="text"
                    value={gradientColor2.toUpperCase()}
                    onChange={(e) => handleGradientChange('color2', e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="gradientAngle" className="text-xs font-medium">
                  Angle: {gradientAngle}°
                </Label>
                <Slider
                  id="gradientAngle"
                  min={0}
                  max={360}
                  step={1}
                  value={[gradientAngle]}
                  onValueChange={(value) => handleGradientChange('angle', value[0])}
                  className="w-full"
                />
              </div>
            </div>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
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
      </div>
    );
  }

  // Element properties
  if (selectedElement) {
    return (
      <div className={cn("w-full h-full bg-card border-l shadow-md flex flex-col overflow-hidden", className)} suppressHydrationWarning>
        <div className="px-4 py-3 border-b bg-card">
          <div className="font-medium text-foreground">
            {selectedElement.type.charAt(0).toUpperCase() + selectedElement.type.slice(1)} Properties
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
          {selectedElement.type === 'text' && renderTextProperties(selectedElement as TextElementProps)}
          {selectedElement.type === 'shape' && renderShapeProperties(selectedElement as ShapeElementProps)}
          {selectedElement.type === 'device' && renderDeviceProperties(selectedElement as DeviceFrameElementProps)}
          {selectedElement.type === 'image' && renderImageProperties(selectedElement as ImageElementProps)}
        </div>
        
        {/* Move the hidden file input outside of device-specific rendering */}
        <Input
          type="file"
          ref={hiddenFileInputRef}
          onChange={handleFileSelected}
          className="hidden"
          accept="image/*"
        />
      </div>
    );
  }

  // Default fallback
  return (
    <div className={cn("w-full h-full bg-card border-l shadow-md flex flex-col overflow-hidden", className)} suppressHydrationWarning>
      <div className="px-4 py-3 border-b bg-card">
        <div className="font-medium text-foreground">Properties</div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="text-sm text-muted-foreground">Select an element to view properties</div>
      </div>
    </div>
  );
}
