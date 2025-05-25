
"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, MoveIcon } from 'lucide-react'; 
import type { DeviceFrameElementProps as DeviceFrameElementType } from '@/types/artboard';
import { cn } from '@/lib/utils';

interface DeviceFrameElementProps {
  element: DeviceFrameElementType;
  onUpdate: (updatedElement: Partial<DeviceFrameElementType>) => void;
  isSelected: boolean;
}

export function DeviceFrameElement({ element, onUpdate, isSelected }: DeviceFrameElementProps) {
  const [screenshot, setScreenshot] = useState<string | undefined>(element.screenshotSrc);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Default to centered if no position is provided
  const [objectPosition, setObjectPosition] = useState<string>(element.screenshotObjectPosition || '50% 50%');


  useEffect(() => {
    setScreenshot(element.screenshotSrc);
    // When screenshotSrc changes, or is removed, reset to default/provided position
    setObjectPosition(element.screenshotObjectPosition || '50% 50%');
  }, [element.screenshotSrc, element.screenshotObjectPosition]);


  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newScreenshotSrc = reader.result as string;
        setScreenshot(newScreenshotSrc);
        const defaultPosition = '50% 50%'; // Always reset to center for a new image initially
        setObjectPosition(defaultPosition);
        onUpdate({ screenshotSrc: newScreenshotSrc, screenshotObjectPosition: defaultPosition });
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  let aspectRatio = 9 / 16; 
  let framePadding = 'p-2'; 
  let deviceFrameStyle: React.CSSProperties = {
    backgroundColor: '#111', 
    borderRadius: '1rem', 
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative', 
  };
  let screenStyle: React.CSSProperties = { 
    width: '100%',
    height: '100%',
    backgroundColor: '#000', 
    overflow: 'hidden', 
    position: 'relative', 
  };
  
  let deviceLabel = "Device";

  switch (element.deviceType) {
    case 'iphone':
      aspectRatio = 390 / 844; 
      framePadding = 'p-[3.5%]'; 
      screenStyle.borderRadius = '0.8rem'; 
      deviceLabel = "iPhone";
      break;
    case 'android-phone':
      aspectRatio = 1080 / 2400; 
      framePadding = 'p-[3.5%]';
      screenStyle.borderRadius = '0.8rem';
      deviceLabel = "Android Phone";
      break;
    case 'tablet':
      aspectRatio = 768 / 1024; 
      framePadding = 'p-[2.5%]';
      deviceFrameStyle.borderRadius = '0.75rem';
      screenStyle.borderRadius = '0.6rem';
      deviceLabel = "Tablet";
      break;
    case 'desktop':
      aspectRatio = 16 / 9;
      framePadding = 'p-[1.5%]';
      deviceFrameStyle.borderRadius = '0.5rem';
      screenStyle.borderRadius = '0.35rem';
      deviceFrameStyle.backgroundColor = '#333'; 
      deviceLabel = "Desktop Monitor";
      break;
  }

  const outerWidth = element.size.width;
  const outerHeight = element.size.height;

  let frameDisplayWidth, frameDisplayHeight;
  if (outerWidth / outerHeight > aspectRatio) { 
    frameDisplayHeight = outerHeight;
    frameDisplayWidth = outerHeight * aspectRatio;
  } else { 
    frameDisplayWidth = outerWidth;
    frameDisplayHeight = outerWidth / aspectRatio;
  }
  
  const placeholderText = `Mockup: ${deviceLabel}`;

  return (
    <div 
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ 
        cursor: 'default', // Removed panning cursor logic
        position: 'relative',
      }}
    >
      <div 
        style={{
          ...deviceFrameStyle,
          width: `${frameDisplayWidth}px`,
          height: `${frameDisplayHeight}px`,
        }}
        className={framePadding}
      >
        <div style={screenStyle}>
          {screenshot ? (
            <Image
              src={screenshot}
              alt={`${element.deviceType} screenshot`}
              layout="fill"
              objectFit="cover" 
              style={{ objectPosition: objectPosition, cursor: 'default' }} // Removed panning cursor
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
      {/* Removed the second upload button that was here */}
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
