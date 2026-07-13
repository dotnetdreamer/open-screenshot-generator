"use client";

import type React from 'react';
import { useEffect, useState, useRef } from 'react';
import type { ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps, ImageElementProps, DeviceType, DeviceStyleType, ArtboardState, VideoElementProps, VideoDeviceElementProps, GestureElementProps, GestureType, ElementAnimation, ElementAnimationPreset } from '@/types/artboard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { UploadCloudIcon, PaintbrushIcon, Palette, Plus, Minus, Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, ClapperboardIcon, Trash2Icon } from 'lucide-react';
import { saveMedia } from '@/lib/mediaStore';
import { VIDEO_ACCEPT } from './elements/VideoElement';
import { useToast } from '@/hooks/use-toast';
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
import { DEVICE_PICKER_GROUPS } from '@/lib/deviceRegistry';

// Panel headings. Derived names read badly for the compound types
// ("Video-device Properties"), so the user-facing ones are spelled out.
const ELEMENT_PANEL_TITLES: Partial<Record<ArtboardElement['type'], string>> = {
  'video-device': 'Recording Mockup',
  video: 'Recording Properties',
  gesture: 'Gesture Hint',
};

interface PropertiesPanelProps {
  selectedElement: ArtboardElement | null;
  onUpdateElement: (updates: Partial<ArtboardElement>) => void;
  activeArtboardDetails?: ArtboardState | null;
  onUpdateArtboardDetails?: (updates: Partial<ArtboardState>) => void;
  className?: string;
}

// Transform presets for quick application
const transformPresets = [
  {
    name: 'None',
    description: 'No transform',
    values: { skewX: 0, skewY: 0, perspectiveX: 0, perspectiveY: 0, matrix3d: '' }
  },
  {
    name: 'Slight Tilt',
    description: 'Slight perspective tilt',
    values: { skewX: 0, skewY: 0, perspectiveX: 5, perspectiveY: 2, matrix3d: '' }
  },
  {
    name: 'Left Perspective',
    description: 'Strong left perspective',
    values: { skewX: 0, skewY: 0, perspectiveX: 0, perspectiveY: 25, matrix3d: '' }
  },
  {
    name: 'Right Perspective',
    description: 'Strong right perspective',
    values: { skewX: 0, skewY: 0, perspectiveX: 0, perspectiveY: -25, matrix3d: '' }
  },
  {
    name: 'Skew Right',
    description: 'Skew to the right',
    values: { skewX: 15, skewY: 0, perspectiveX: 0, perspectiveY: 0, matrix3d: '' }
  },
  {
    name: 'Skew Left',
    description: 'Skew to the left',
    values: { skewX: -15, skewY: 0, perspectiveX: 0, perspectiveY: 0, matrix3d: '' }
  },
  {
    name: 'App Store Style',
    description: 'Popular app store preview style',
    values: { skewX: 0, skewY: 0, perspectiveX: 0, perspectiveY: 0, matrix3d: 'matrix3d(1.11397, -0.175046, 0, 6.13e-05, 0.536454, 0.828959, 0, -5.99e-05, 0, 0, 1, 0, -76.0176, 64.4342, 0, 1)' }
  }
];

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
  const { toast } = useToast();
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

  // App Preview recordings (device screen video + standalone video element)
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const handleRecordingSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (videoFileInputRef.current) videoFileInputRef.current.value = '';
    if (!file || !selectedElement) return;
    try {
      const { id, probe } = await saveMedia(file, file.name);
      if (selectedElement.type === 'video-device') {
        onUpdateElement({
          mediaId: id,
          naturalVideoWidth: probe.width,
          naturalVideoHeight: probe.height,
          durationSeconds: probe.duration,
          trimStart: undefined,
          trimEnd: undefined,
        });
      } else if (selectedElement.type === 'video') {
        onUpdateElement({
          mediaId: id,
          videoSrc: undefined,
          naturalVideoWidth: probe.width,
          naturalVideoHeight: probe.height,
          durationSeconds: probe.duration,
          trimStart: undefined,
          trimEnd: undefined,
        });
      }
    } catch (error) {
      toast({
        title: 'Could not load recording',
        description: error instanceof Error ? error.message : 'The file could not be read.',
        variant: 'destructive',
      });
    }
  };

  const secondsInput = (value: number | undefined, onChange: (v: number | undefined) => void, id: string, placeholder: string) => (
    <Input
      id={id}
      type="number"
      min={0}
      step={0.1}
      className="h-8 text-xs"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(undefined);
        const v = parseFloat(raw);
        if (!Number.isNaN(v) && v >= 0) onChange(v);
      }}
    />
  );

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
            // Predefined devices already carry a padded screen area, so the
            // screenshot should FILL it (0,0,100,100); insetting reveals the
            // black screen background as a fake bezel and hides the notch /
            // punch-hole (black on black). Only the 'custom' frame needs the
            // 5% inset. Mirrors DeviceFrameElement's own upload handler.
            const isCustomFrame =
              selectedElement?.type === 'device' &&
              (selectedElement as DeviceFrameElementProps).deviceType === 'custom';
            onUpdateElement({
              screenshotSrc: dataUrl,
              naturalScreenshotWidth: img.naturalWidth,
              naturalScreenshotHeight: img.naturalHeight,
              screenshotRect: isCustomFrame
                ? { left: 5, top: 5, width: 90, height: 90 }
                : { left: 0, top: 0, width: 100, height: 100 },
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
      {element.deviceType !== 'custom' && (
        <div className="flex flex-col space-y-1 min-w-[150px]">
          <Label htmlFor="deviceModel" className="text-xs">
            Device Model
          </Label>
          <Select
            value={element.deviceType}
            onValueChange={(v) => {
              if (v !== element.deviceType) {
                // The layout routes deviceType changes through the
                // screen-aware swap (bounds refit + overlay adaptation).
                onUpdateElement({ deviceType: v as DeviceType });
              }
            }}
          >
            <SelectTrigger id="deviceModel" className="h-8 text-xs">
              <SelectValue placeholder="Select Device" />
            </SelectTrigger>
            <SelectContent>
              {DEVICE_PICKER_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.devices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
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
            <SelectItem value="3d-left">3D — Left Side</SelectItem>
            <SelectItem value="3d-right">3D — Right Side</SelectItem>
            <SelectItem value="perspective-left">Left Angle</SelectItem>
            <SelectItem value="perspective-slight-left">Slight Left</SelectItem>
            <SelectItem value="perspective-right">Right Angle</SelectItem>
            <SelectItem value="perspective-slight-right">Slight Right</SelectItem>
            <SelectItem value="perspective-front">Front Angle</SelectItem>
            <SelectItem value="custom">Custom Matrix3D</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 3D pose + body finish (only for the true-3D styles) */}
      {(element.styleType === '3d-left' || element.styleType === '3d-right') && (
        <>
          <div className="flex flex-col space-y-1 min-w-[150px]">
            <Label htmlFor="devicePose3d" className="text-xs">3D Pose</Label>
            <Select
              value={element.pose3d || 'classic'}
              onValueChange={(v) => onUpdateElement({ pose3d: v as DeviceFrameElementProps['pose3d'] })}
            >
              <SelectTrigger id="devicePose3d" className="h-8 text-xs">
                <SelectValue placeholder="Select Pose" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="classic">Classic</SelectItem>
                <SelectItem value="front">Front</SelectItem>
                <SelectItem value="upright">Upright</SelectItem>
                <SelectItem value="side">Side</SelectItem>
                <SelectItem value="tilted">Tilted</SelectItem>
                <SelectItem value="reclined">Reclined</SelectItem>
                <SelectItem value="laying">Laying</SelectItem>
                <SelectItem value="floating">Floating</SelectItem>
                <SelectItem value="drifting">Drifting</SelectItem>
                <SelectItem value="isometric">Isometric</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col space-y-1 min-w-[150px]">
            <Label htmlFor="deviceFinish3d" className="text-xs">Body Finish</Label>
            <Select
              value={element.frameColor3d || 'titanium'}
              onValueChange={(v) => onUpdateElement({ frameColor3d: v as DeviceFrameElementProps['frameColor3d'] })}
            >
              <SelectTrigger id="deviceFinish3d" className="h-8 text-xs">
                <SelectValue placeholder="Select Finish" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="titanium">Titanium</SelectItem>
                <SelectItem value="black">Black</SelectItem>
                <SelectItem value="white">White</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* Colored-frame controls for the flat styles */}
      {element.styleType !== '3d-left' && element.styleType !== '3d-right' && element.deviceType !== 'custom' && (
        <>
          <div className="grid grid-cols-2 gap-2 min-w-[100%]">
            <div>
              <Label htmlFor="deviceFrameColor" className="text-xs">Frame Color</Label>
              <div className="flex mt-1.5">
                <Input
                  id="deviceFrameColor"
                  type="color"
                  className="w-8 h-8 p-1 cursor-pointer"
                  value={element.frameColor || '#111111'}
                  onChange={(e) => onUpdateElement({ frameColor: e.target.value })}
                />
                <Input
                  type="text"
                  className="flex-1 h-8 ml-2 text-xs"
                  value={element.frameColor || ''}
                  placeholder="default"
                  onChange={(e) => onUpdateElement({ frameColor: e.target.value || undefined })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="deviceNotchColor" className="text-xs">Notch Color</Label>
              <div className="flex mt-1.5">
                <Input
                  id="deviceNotchColor"
                  type="color"
                  className="w-8 h-8 p-1 cursor-pointer"
                  value={element.notchColor || '#000000'}
                  onChange={(e) => onUpdateElement({ notchColor: e.target.value })}
                />
                <Input
                  type="text"
                  className="flex-1 h-8 ml-2 text-xs"
                  value={element.notchColor || ''}
                  placeholder="default"
                  onChange={(e) => onUpdateElement({ notchColor: e.target.value || undefined })}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col space-y-1 min-w-[150px]">
            <Label htmlFor="deviceFrameOpacity" className="text-xs">
              Frame Opacity: {Math.round((element.frameOpacity ?? 1) * 100)}%
            </Label>
            <Slider
              id="deviceFrameOpacity"
              min={0}
              max={100}
              step={1}
              value={[(element.frameOpacity ?? 1) * 100]}
              onValueChange={(v) => onUpdateElement({ frameOpacity: v[0] / 100 })}
              className="my-2"
            />
          </div>
          <div className="flex flex-col space-y-1 min-w-[150px]">
            <Label htmlFor="deviceFrameStyle" className="text-xs">Frame Style</Label>
            <Select
              value={element.frameStyle || 'solid'}
              onValueChange={(v) => onUpdateElement({ frameStyle: v as DeviceFrameElementProps['frameStyle'] })}
            >
              <SelectTrigger id="deviceFrameStyle" className="h-8 text-xs">
                <SelectValue placeholder="Frame Style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solid">Solid</SelectItem>
                <SelectItem value="outline">Outline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

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

  // Phone/tablet mockup playing a screen recording. Deliberately NOT the
  // screenshot device panel: no screenshot upload, no screenshot rect sliders,
  // no 3D pose or perspective (a recording only composites into a flat frame).
  const renderVideoDeviceProperties = (element: VideoDeviceElementProps) => (
    <>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="vdDeviceModel" className="text-xs">Device Model</Label>
        <Select
          value={element.deviceType}
          onValueChange={(v) => onUpdateElement({ deviceType: v as DeviceType })}
        >
          <SelectTrigger id="vdDeviceModel" className="h-8 text-xs">
            <SelectValue placeholder="Select Device" />
          </SelectTrigger>
          <SelectContent>
            {DEVICE_PICKER_GROUPS.filter((g) => g.platform !== 'neutral').map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.devices
                  // Watches can't host an App Preview video (Apple takes
                  // screenshots only for watchOS), so they're left out.
                  .filter((d) => d.category !== 'watch')
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col space-y-1.5 border rounded-md p-2 bg-muted/30">
        <Label className="text-xs font-medium flex items-center gap-1">
          <ClapperboardIcon className="w-3.5 h-3.5" />
          Screen Recording
        </Label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => videoFileInputRef.current?.click()}
            className="text-xs h-8"
          >
            <UploadCloudIcon className="w-3 h-3 mr-1.5" />
            {element.mediaId ? 'Change Recording' : 'Upload Recording'}
          </Button>
          {element.mediaId && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8"
              onClick={() =>
                onUpdateElement({
                  mediaId: undefined,
                  trimStart: undefined,
                  trimEnd: undefined,
                  durationSeconds: undefined,
                  naturalVideoWidth: undefined,
                  naturalVideoHeight: undefined,
                })
              }
            >
              <Trash2Icon className="w-3 h-3 mr-1" />
              Remove
            </Button>
          )}
        </div>
        {element.mediaId ? (
          <>
            {element.durationSeconds ? (
              <p className="text-[11px] text-muted-foreground">
                {element.naturalVideoWidth}×{element.naturalVideoHeight}, {element.durationSeconds.toFixed(1)}s
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="vdTrimStart" className="text-xs">Trim start (s)</Label>
                {secondsInput(element.trimStart, (v) => onUpdateElement({ trimStart: v }), 'vdTrimStart', '0')}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="vdTrimEnd" className="text-xs">Trim end (s)</Label>
                {secondsInput(element.trimEnd, (v) => onUpdateElement({ trimEnd: v }), 'vdTrimEnd', 'full length')}
              </div>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Record your app on the phone, then drop the MP4 or MOV in here. It
            plays inside the screen and renders into the exported video.
          </p>
        )}
      </div>

      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="vdFit" className="text-xs">Recording Fit</Label>
        <Select
          value={element.objectFit || 'cover'}
          onValueChange={(v) => onUpdateElement({ objectFit: v as VideoDeviceElementProps['objectFit'] })}
        >
          <SelectTrigger id="vdFit" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cover">Cover (fill the screen)</SelectItem>
            <SelectItem value="contain">Contain (show all of it)</SelectItem>
            <SelectItem value="fill">Stretch</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="vdScale" className="text-xs">
          Scale: {Math.round((element.scale || 1) * 100)}%
        </Label>
        <Slider
          id="vdScale"
          min={10}
          max={500}
          step={1}
          value={[(element.scale || 1) * 100]}
          onValueChange={(value) => onUpdateElement({ scale: value[0] / 100 })}
          className="my-2"
        />
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="vdRotation" className="text-xs">
          Rotation: {Math.round(element.rotation || 0)}°
        </Label>
        <Slider
          id="vdRotation"
          min={-180}
          max={180}
          step={1}
          value={[element.rotation || 0]}
          onValueChange={(value) => onUpdateElement({ rotation: value[0] })}
          className="my-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 min-w-[100%]">
        <div>
          <Label htmlFor="vdFrameColor" className="text-xs">Frame Color</Label>
          <div className="flex mt-1.5">
            <Input
              id="vdFrameColor"
              type="color"
              className="w-8 h-8 p-1 cursor-pointer"
              value={element.frameColor || '#1e1e1e'}
              onChange={(e) => onUpdateElement({ frameColor: e.target.value })}
            />
            <Input
              type="text"
              className="flex-1 h-8 ml-2 text-xs"
              value={element.frameColor || ''}
              placeholder="default"
              onChange={(e) => onUpdateElement({ frameColor: e.target.value || undefined })}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="vdNotchColor" className="text-xs">Notch Color</Label>
          <div className="flex mt-1.5">
            <Input
              id="vdNotchColor"
              type="color"
              className="w-8 h-8 p-1 cursor-pointer"
              value={element.notchColor || '#000000'}
              onChange={(e) => onUpdateElement({ notchColor: e.target.value })}
            />
            <Input
              type="text"
              className="flex-1 h-8 ml-2 text-xs"
              value={element.notchColor || ''}
              placeholder="default"
              onChange={(e) => onUpdateElement({ notchColor: e.target.value || undefined })}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="vdFrameOpacity" className="text-xs">
          Frame Opacity: {Math.round((element.frameOpacity ?? 1) * 100)}%
        </Label>
        <Slider
          id="vdFrameOpacity"
          min={0}
          max={100}
          step={1}
          value={[(element.frameOpacity ?? 1) * 100]}
          onValueChange={(v) => onUpdateElement({ frameOpacity: v[0] / 100 })}
          className="my-2"
        />
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="vdFrameStyle" className="text-xs">Frame Style</Label>
        <Select
          value={element.frameStyle || 'solid'}
          onValueChange={(v) => onUpdateElement({ frameStyle: v as VideoDeviceElementProps['frameStyle'] })}
        >
          <SelectTrigger id="vdFrameStyle" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="outline">Outline</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );

  const renderVideoProperties = (element: VideoElementProps) => (
    <>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => videoFileInputRef.current?.click()}
          className="text-xs h-8"
        >
          <UploadCloudIcon className="w-3 h-3 mr-1.5" />
          {element.mediaId || element.videoSrc ? 'Change Recording' : 'Upload Recording'}
        </Button>
      </div>
      {element.durationSeconds ? (
        <p className="text-xs text-muted-foreground">
          {element.naturalVideoWidth}×{element.naturalVideoHeight}, {element.durationSeconds.toFixed(1)}s
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="vTrimStart" className="text-xs">Trim start (s)</Label>
          {secondsInput(element.trimStart, (v) => onUpdateElement({ trimStart: v }), 'vTrimStart', '0')}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="vTrimEnd" className="text-xs">Trim end (s)</Label>
          {secondsInput(element.trimEnd, (v) => onUpdateElement({ trimEnd: v }), 'vTrimEnd', 'full length')}
        </div>
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="videoObjectFit" className="text-xs">Fit</Label>
        <Select
          value={element.objectFit || 'cover'}
          onValueChange={(value) => onUpdateElement({ objectFit: value as VideoElementProps['objectFit'] })}
        >
          <SelectTrigger id="videoObjectFit" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cover">Cover</SelectItem>
            <SelectItem value="contain">Contain</SelectItem>
            <SelectItem value="fill">Fill</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="videoOpacity" className="text-xs">
          Opacity: {Math.round((element.opacity ?? 1) * 100)}%
        </Label>
        <Slider
          id="videoOpacity"
          min={0}
          max={100}
          step={1}
          value={[(element.opacity ?? 1) * 100]}
          onValueChange={(value) => onUpdateElement({ opacity: value[0] / 100 })}
          className="my-2"
        />
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="videoRadius" className="text-xs">
          Corner Radius: {element.borderRadius || 0}px
        </Label>
        <Slider
          id="videoRadius"
          min={0}
          max={200}
          step={1}
          value={[element.borderRadius || 0]}
          onValueChange={(value) => onUpdateElement({ borderRadius: value[0] })}
          className="my-2"
        />
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="videoScale" className="text-xs">
          Scale: {Math.round((element.scale || 1) * 100)}%
        </Label>
        <Slider
          id="videoScale"
          min={10}
          max={500}
          step={1}
          value={[(element.scale || 1) * 100]}
          onValueChange={(value) => onUpdateElement({ scale: value[0] / 100 })}
          className="my-2"
        />
      </div>
    </>
  );

  const renderGestureProperties = (element: GestureElementProps) => (
    <>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="gestureType" className="text-xs">Gesture</Label>
        <Select
          value={element.gestureType}
          onValueChange={(value) => onUpdateElement({ gestureType: value as GestureType })}
        >
          <SelectTrigger id="gestureType" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tap">Tap</SelectItem>
            <SelectItem value="double-tap">Double Tap</SelectItem>
            <SelectItem value="swipe-left">Swipe Left</SelectItem>
            <SelectItem value="swipe-right">Swipe Right</SelectItem>
            <SelectItem value="swipe-up">Swipe Up</SelectItem>
            <SelectItem value="swipe-down">Swipe Down</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="gestureColor" className="text-xs">Color</Label>
        <div className="flex mt-1.5">
          <Input
            id="gestureColor"
            type="color"
            className="w-8 h-8 p-1 cursor-pointer"
            value={element.color || '#ffffff'}
            onChange={(e) => onUpdateElement({ color: e.target.value })}
          />
          <Input
            type="text"
            className="flex-1 h-8 ml-2 text-xs"
            value={element.color || ''}
            onChange={(e) => onUpdateElement({ color: e.target.value })}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <input
          id="gestureRepeat"
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={element.gestureRepeat ?? false}
          onChange={(e) => onUpdateElement({ gestureRepeat: e.target.checked })}
        />
        <Label htmlFor="gestureRepeat" className="text-xs">Loop for the whole video</Label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {!element.gestureRepeat && (
          <div className="grid gap-1">
            <Label htmlFor="gestureTrigger" className="text-xs">Plays at (s)</Label>
            {secondsInput(element.triggerTime, (v) => onUpdateElement({ triggerTime: v }), 'gestureTrigger', '0.5')}
          </div>
        )}
        <div className="grid gap-1">
          <Label htmlFor="gestureDuration" className="text-xs">Length (s)</Label>
          {secondsInput(element.gestureDuration, (v) => onUpdateElement({ gestureDuration: v }), 'gestureDuration', '1.2')}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Loops on the canvas as a preview. In the exported video it plays at the
        time set above.
      </p>
    </>
  );

  // Enter/exit animation for the exported App Preview video. Available on
  // every visual element type; gestures carry their own timing instead.
  const updateAnimation = (patch: Partial<ElementAnimation>) => {
    if (!selectedElement) return;
    const next: ElementAnimation = { ...(selectedElement.animation || {}), ...patch };
    if (!next.enter) {
      next.enterDelay = undefined;
      next.enterDuration = undefined;
    }
    if (!next.exit) {
      next.exitStart = undefined;
      next.exitDuration = undefined;
    }
    onUpdateElement({ animation: next.enter || next.exit ? next : undefined });
  };

  const ANIMATION_OPTIONS: { value: ElementAnimationPreset; label: string }[] = [
    { value: 'fade', label: 'Fade' },
    { value: 'slide-up', label: 'Slide Up' },
    { value: 'slide-down', label: 'Slide Down' },
    { value: 'slide-left', label: 'Slide Left' },
    { value: 'slide-right', label: 'Slide Right' },
    { value: 'scale-up', label: 'Scale Up' },
    { value: 'pop', label: 'Pop' },
  ];

  const renderAnimationProperties = (element: ArtboardElement) => (
    <div className="border-t pt-3 flex flex-col space-y-2">
      <Label className="text-xs font-medium flex items-center gap-1">
        <ClapperboardIcon className="w-3.5 h-3.5" />
        Video Animation
      </Label>
      <p className="text-[11px] text-muted-foreground">
        Plays in the exported App Preview video. The canvas stays static.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="animEnter" className="text-xs">Enter</Label>
          <Select
            value={element.animation?.enter ?? 'none'}
            onValueChange={(value) =>
              updateAnimation({ enter: value === 'none' ? undefined : (value as ElementAnimationPreset) })
            }
          >
            <SelectTrigger id="animEnter" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {ANIMATION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {element.animation?.enter && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="animEnterDelay" className="text-xs">Delay (s)</Label>
              {secondsInput(element.animation?.enterDelay, (v) => updateAnimation({ enterDelay: v }), 'animEnterDelay', '0')}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="animEnterDuration" className="text-xs">Length (s)</Label>
              {secondsInput(element.animation?.enterDuration, (v) => updateAnimation({ enterDuration: v }), 'animEnterDuration', '0.6')}
            </div>
          </>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="animExit" className="text-xs">Exit</Label>
          <Select
            value={element.animation?.exit ?? 'none'}
            onValueChange={(value) =>
              updateAnimation({ exit: value === 'none' ? undefined : (value as ElementAnimationPreset) })
            }
          >
            <SelectTrigger id="animExit" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {ANIMATION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {element.animation?.exit && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="animExitStart" className="text-xs">Starts at (s)</Label>
              {secondsInput(element.animation?.exitStart, (v) => updateAnimation({ exitStart: v }), 'animExitStart', 'never')}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="animExitDuration" className="text-xs">Length (s)</Label>
              {secondsInput(element.animation?.exitDuration, (v) => updateAnimation({ exitDuration: v }), 'animExitDuration', '0.6')}
            </div>
          </>
        )}
      </div>
    </div>
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
  const renderImageProperties = (element: ImageElementProps) => {
    console.log('Rendering image properties for element:', element.id, 'skewX:', element.skewX, 'skewY:', element.skewY);
    
    return (
    <div className="space-y-4">
      {/* Image Upload and Basic Properties */}
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

      {/* Transform Properties */}
      <div className="space-y-3">
        <div className="text-sm font-medium text-foreground border-b pb-1">Transform</div>
        
        {/* Transform Presets */}
        <div>
          <Label className="text-xs mb-2 block">Transform Presets</Label>
          <div className="grid grid-cols-2 gap-2">
            {transformPresets.map((preset) => (
              <Button
                key={preset.name}
                variant="outline"
                size="sm"
                onClick={() => {
                  console.log('Applying transform preset:', preset.name, preset.values);
                  onUpdateElement(preset.values);
                }}
                className="text-xs h-8 justify-start"
                title={preset.description}
              >
                {preset.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Skew Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="skewX" className="text-xs mb-1 block">
              Skew X: {element.skewX || 0}°
            </Label>
            <Slider
              id="skewX"
              min={-45}
              max={45}
              step={1}
              value={[element.skewX || 0]}
              onValueChange={(value) => {
                console.log('Updating skewX to:', value[0]);
                onUpdateElement({ skewX: value[0] });
              }}
              className="my-2"
            />
          </div>
          
          <div>
            <Label htmlFor="skewY" className="text-xs mb-1 block">
              Skew Y: {element.skewY || 0}°
            </Label>
            <Slider
              id="skewY"
              min={-45}
              max={45}
              step={1}
              value={[element.skewY || 0]}
              onValueChange={(value) => {
                console.log('Updating skewY to:', value[0]);
                onUpdateElement({ skewY: value[0] });
              }}
              className="my-2"
            />
          </div>
        </div>

        {/* Perspective Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="perspectiveX" className="text-xs mb-1 block">
              Perspective X: {element.perspectiveX || 0}°
            </Label>
            <Slider
              id="perspectiveX"
              min={-60}
              max={60}
              step={1}
              value={[element.perspectiveX || 0]}
              onValueChange={(value) => {
                console.log('Updating perspectiveX to:', value[0]);
                onUpdateElement({ perspectiveX: value[0] });
              }}
              className="my-2"
            />
          </div>
          
          <div>
            <Label htmlFor="perspectiveY" className="text-xs mb-1 block">
              Perspective Y: {element.perspectiveY || 0}°
            </Label>
            <Slider
              id="perspectiveY"
              min={-60}
              max={60}
              step={1}
              value={[element.perspectiveY || 0]}
              onValueChange={(value) => {
                console.log('Updating perspectiveY to:', value[0]);
                onUpdateElement({ perspectiveY: value[0] });
              }}
              className="my-2"
            />
          </div>
        </div>

        {/* Custom Matrix3D */}
        <div>
          <Label htmlFor="matrix3d" className="text-xs mb-1 block">
            Custom Matrix3D
          </Label>
          <Textarea
            id="matrix3d"
            value={element.matrix3d || ''}
            onChange={(e) => onUpdateElement({ matrix3d: e.target.value })}
            placeholder="matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"
            className="text-xs h-20 resize-none"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Enter a custom CSS matrix3d transform. Leave blank to use individual controls above.
          </p>
        </div>

        {/* Reset Transform Button */}
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onUpdateElement({ 
              skewX: 0, 
              skewY: 0, 
              perspectiveX: 0, 
              perspectiveY: 0,
              matrix3d: '' 
            })}
            className="text-xs"
          >
            Reset Transform
          </Button>
        </div>
      </div>
    </div>
  );
  };

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
          {/* Artboard Name */}
          <div className="space-y-2">
            <Label htmlFor="artboardName" className="text-xs font-medium">Artboard Name</Label>
            <Input
              id="artboardName"
              value={activeArtboardDetails.name || ''}
              onChange={(e) => onUpdateArtboardDetails?.({ name: e.target.value })}
              placeholder="Enter artboard name"
              className="text-sm"
            />
          </div>
          
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
            {ELEMENT_PANEL_TITLES[selectedElement.type] ??
              `${selectedElement.type.charAt(0).toUpperCase() + selectedElement.type.slice(1)} Properties`}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
          {selectedElement.type === 'text' && renderTextProperties(selectedElement as TextElementProps)}
          {selectedElement.type === 'shape' && renderShapeProperties(selectedElement as ShapeElementProps)}
          {selectedElement.type === 'device' && renderDeviceProperties(selectedElement as DeviceFrameElementProps)}
          {selectedElement.type === 'image' && renderImageProperties(selectedElement as ImageElementProps)}
          {selectedElement.type === 'video' && renderVideoProperties(selectedElement as VideoElementProps)}
          {selectedElement.type === 'video-device' && renderVideoDeviceProperties(selectedElement as VideoDeviceElementProps)}
          {selectedElement.type === 'gesture' && renderGestureProperties(selectedElement as GestureElementProps)}
          {selectedElement.type !== 'gesture' && renderAnimationProperties(selectedElement)}
        </div>

        {/* Move the hidden file input outside of device-specific rendering */}
        <Input
          type="file"
          ref={hiddenFileInputRef}
          onChange={handleFileSelected}
          className="hidden"
          accept="image/*"
        />
        <Input
          type="file"
          ref={videoFileInputRef}
          onChange={handleRecordingSelected}
          className="hidden"
          accept={VIDEO_ACCEPT}
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
