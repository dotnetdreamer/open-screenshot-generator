
"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon } from 'lucide-react'; 
import type { DeviceFrameElementProps as DeviceFrameElementType } from '@/types/artboard';

interface DeviceFrameElementProps {
  element: DeviceFrameElementType;
  onUpdate: (updatedElement: Partial<DeviceFrameElementType>) => void;
  isSelected: boolean;
}

export function DeviceFrameElement({ element, onUpdate, isSelected }: DeviceFrameElementProps) {
  const [screenshot, setScreenshot] = useState<string | undefined>(element.screenshotSrc);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [objectPosition, setObjectPosition] = useState<string>('50% 50%'); // Default to center

  useEffect(() => {
    setScreenshot(element.screenshotSrc);
    // Reset to center when screenshot changes or is removed. 
    // User-defined position for existing screenshot is preserved by DraggableElement state.
    if (element.screenshotSrc && element.screenshotObjectPosition) {
      setObjectPosition(element.screenshotObjectPosition);
    } else {
      setObjectPosition('50% 50%');
    }
  }, [element.screenshotSrc, element.screenshotObjectPosition]);


  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newScreenshotSrc = reader.result as string;
        setScreenshot(newScreenshotSrc);
        const defaultPosition = '50% 50%';
        setObjectPosition(defaultPosition);
        onUpdate({ screenshotSrc: newScreenshotSrc, screenshotObjectPosition: defaultPosition });
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  let deviceNativeAspectRatio = 9 / 16; 
  let framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 }; // Default padding in %
  let screenBorderRadius = '0.8rem'; // Default screen border radius
  let deviceLabel = "Device";
  let deviceFrameBgColor = '#111';
  let deviceFrameOuterBorderRadius = '1rem';


  switch (element.deviceType) {
    case 'iphone':
      deviceNativeAspectRatio = 390 / 844; 
      // Padding values are a percentage of the smaller dimension of the screen area after padding.
      // These are illustrative and would need fine-tuning.
      framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 }; // Example: p-[3.5%] roughly
      screenBorderRadius = 'calc(0.8rem * var(--scale-factor, 1))'; // Scale border radius
      deviceFrameOuterBorderRadius = 'calc(1rem * var(--scale-factor, 1))';
      deviceLabel = "iPhone";
      break;
    case 'android-phone':
      deviceNativeAspectRatio = 1080 / 2400; 
      framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 };
      screenBorderRadius = 'calc(0.8rem * var(--scale-factor, 1))';
      deviceFrameOuterBorderRadius = 'calc(1rem * var(--scale-factor, 1))';
      deviceLabel = "Android Phone";
      break;
    case 'tablet':
      deviceNativeAspectRatio = 768 / 1024; 
      framePaddingPercent = { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 };
      screenBorderRadius = 'calc(0.6rem * var(--scale-factor, 1))';
      deviceFrameOuterBorderRadius = 'calc(0.75rem * var(--scale-factor, 1))';
      deviceLabel = "Tablet";
      break;
    case 'desktop':
      deviceNativeAspectRatio = 16 / 9;
      framePaddingPercent = { top: 1.5, right: 1.5, bottom: 3.5, left: 1.5 }; // More bottom padding for stand
      screenBorderRadius = 'calc(0.35rem * var(--scale-factor, 1))';
      deviceFrameOuterBorderRadius = 'calc(0.5rem * var(--scale-factor, 1))';
      deviceFrameBgColor = '#333';
      deviceLabel = "Desktop Monitor";
      break;
  }

  // The root div of DeviceFrameElement (class="w-full h-full") already has the scaled dimensions
  // from DraggableElement. We need to calculate the size of the visual frame *within* this root.
  // element.size is the base size of the DraggableElement's bounding box.
  
  const baseElementWidth = element.size.width;
  const baseElementHeight = element.size.height;

  let visualFrameStyle: React.CSSProperties = {
    backgroundColor: deviceFrameBgColor,
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative', // For positioning screen and other elements absolutely if needed
    borderRadius: deviceFrameOuterBorderRadius,
    // --scale-factor can be used by child elements if they need to adjust based on parent scale
    // For example, to keep border-radius visually consistent.
    // This requires DraggableElement to pass down its current scale or calculate it here.
    // For simplicity, we'll assume element.scale is the uniform scale from DraggableElement.
    ['--scale-factor' as any]: element.scale || 1,
  };

  // Determine dimensions of the visual frame to fit device aspect ratio inside element's aspect ratio
  const elementAspectRatio = baseElementWidth / baseElementHeight;

  if (elementAspectRatio > deviceNativeAspectRatio) {
    // Element is wider than device: device height matches element height, width is proportional
    visualFrameStyle.height = '100%';
    visualFrameStyle.width = `${(deviceNativeAspectRatio / elementAspectRatio) * 100}%`;
  } else {
    // Element is taller or same AR as device: device width matches element width, height is proportional
    visualFrameStyle.width = '100%';
    visualFrameStyle.height = `${(elementAspectRatio / deviceNativeAspectRatio) * 100}%`;
  }
  
  const screenStyle: React.CSSProperties = { 
    width: `calc(100% - ${framePaddingPercent.left + framePaddingPercent.right}%)`,
    height: `calc(100% - ${framePaddingPercent.top + framePaddingPercent.bottom}%)`,
    backgroundColor: '#000', 
    overflow: 'hidden', 
    position: 'relative', 
    borderRadius: screenBorderRadius,
    margin: `${framePaddingPercent.top}% ${framePaddingPercent.right}% ${framePaddingPercent.bottom}% ${framePaddingPercent.left}%`,
  };
  
  const placeholderText = `Mockup: ${deviceLabel}`;

  return (
    <div 
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ cursor: 'default', position: 'relative' }}
    >
      <div 
        style={visualFrameStyle}
        // The padding is now handled by the screenStyle's margin/calc for width/height
      >
        <div style={screenStyle}>
          {screenshot ? (
            <Image
              src={screenshot}
              alt={`${element.deviceType} screenshot`}
              layout="fill"
              objectFit="cover" 
              style={{ objectPosition: objectPosition, cursor: 'default' }}
              className="transition-opacity duration-300 ease-in-out" 
              onLoadingComplete={(img) => img.style.opacity = '1'}
              data-ai-hint="app interface mobile"
              draggable={false} 
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-center p-2">
              <UploadCloudIcon className="w-1/4 h-1/4 opacity-50 mb-2" />
              <p className="text-xs">{placeholderText}</p>
              {isSelected && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background"
                onClick={triggerFileUpload}
                onMouseDown={(e) => e.stopPropagation()} 
              >
                Upload Screenshot
              </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <Input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleImageUpload}
      />
    </div>
  );
}
