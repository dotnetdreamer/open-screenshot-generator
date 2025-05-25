
"use client";
import type React from 'react';
import { useState, useRef } from 'react';
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

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newScreenshotSrc = reader.result as string;
        setScreenshot(newScreenshotSrc);
        onUpdate({ screenshotSrc: newScreenshotSrc });
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };
  
  // Placeholder dimensions based on device type
  // These ratios are approximate for visual representation.
  let aspectRatio = 9 / 16; // Default for phones
  let framePadding = 'p-2'; // Padding inside the frame before screenshot
  let frameStyle: React.CSSProperties = {
    backgroundColor: '#111', // Dark frame color
    borderRadius: '1rem', // Rounded corners for devices
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    overflow: 'hidden', // Clip screenshot to frame
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  };
  
  let deviceLabel = "Device";

  switch (element.deviceType) {
    case 'iphone':
      aspectRatio = 390 / 844; // iPhone 13 Pro
      framePadding = 'p-[calc(0.03*min(100%,100vh))]'; // Dynamic padding
      deviceLabel = "iPhone";
      break;
    case 'android-phone':
      aspectRatio = 1080 / 2400; // Generic Android
      framePadding = 'p-[calc(0.03*min(100%,100vh))]';
      deviceLabel = "Android Phone";
      break;
    case 'tablet':
      aspectRatio = 768 / 1024; // iPad-like
      framePadding = 'p-[calc(0.025*min(100%,100vh))]';
      frameStyle.borderRadius = '0.75rem';
      deviceLabel = "Tablet";
      break;
    case 'desktop':
      aspectRatio = 16 / 9;
      framePadding = 'p-[calc(0.015*min(100%,100vh))]';
      frameStyle.borderRadius = '0.5rem';
      frameStyle.backgroundColor = '#333'; // Slightly lighter for desktop
      deviceLabel = "Desktop Monitor";
      break;
  }

  // The element's size props (width/height) define the outer bounds of the draggable component.
  // The device frame itself will scale to fit within these bounds while maintaining aspect ratio.
  const outerWidth = element.size.width * element.scale;
  const outerHeight = element.size.height * element.scale;

  let frameDisplayWidth, frameDisplayHeight;
  if (outerWidth / outerHeight > aspectRatio) { // Outer container is wider than device aspect ratio
    frameDisplayHeight = outerHeight;
    frameDisplayWidth = outerHeight * aspectRatio;
  } else { // Outer container is taller or equal
    frameDisplayWidth = outerWidth;
    frameDisplayHeight = outerWidth / aspectRatio;
  }
  
  const placeholderText = `Mockup: ${deviceLabel}`;

  return (
    <div 
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ 
        cursor: isSelected ? 'default' : 'pointer',
        position: 'relative',
      }}
    >
      <div 
        style={{
          ...frameStyle,
          width: `${frameDisplayWidth}px`,
          height: `${frameDisplayHeight}px`,
        }}
        className={framePadding}
      >
        {screenshot ? (
          <Image
            src={screenshot}
            alt={`${element.deviceType} screenshot`}
            layout="fill"
            objectFit="contain" // or "cover" depending on desired effect
            className="rounded-[calc(var(--radius)_-_6px)]" // Slightly smaller radius than frame
            data-ai-hint="app interface mobile"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-center p-2 rounded-md">
            <UploadCloudIcon className="w-1/4 h-1/4 opacity-50 mb-2" />
            <p className="text-xs">{placeholderText}</p>
            {isSelected && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background"
              onClick={triggerFileUpload}
            >
              Upload Screenshot
            </Button>
            )}
          </div>
        )}
      </div>
      {isSelected && !screenshot && ( // Show upload button prominently if selected and no image
         <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs py-1 px-2 h-auto opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={triggerFileUpload}
            style={{ transform: `translateX(-50%) scale(${1 / element.scale})` }}
          >
            <UploadCloudIcon className="w-3 h-3 mr-1" /> Upload
          </Button>
      )}
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
