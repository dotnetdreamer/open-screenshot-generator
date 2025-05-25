
"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ImagePlusIcon } from 'lucide-react';
import type { DeviceFrameElementProps as DeviceFrameElementType } from '@/types/artboard';
import { cn } from '@/lib/utils';

interface DeviceFrameElementProps {
  element: DeviceFrameElementType;
  onUpdate: (updatedElement: Partial<DeviceFrameElementType>) => void;
  isSelected: boolean;
}

export function DeviceFrameElement({ element, onUpdate, isSelected }: DeviceFrameElementProps) {
  const [screenshot, setScreenshot] = useState<string | undefined>(element.screenshotSrc);
  const [customFrame, setCustomFrame] = useState<string | undefined>(element.customFrameSrc);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<'customFrame' | 'screenshot' | null>(null);

  useEffect(() => {
    setScreenshot(element.screenshotSrc);
  }, [element.screenshotSrc]);

  useEffect(() => {
    setCustomFrame(element.customFrameSrc);
  }, [element.customFrameSrc]);


  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && uploadTarget) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newImageSrc = reader.result as string;
        if (uploadTarget === 'customFrame') {
          setCustomFrame(newImageSrc);
          // Optionally reset screenshot if custom frame changes, or keep it.
          // For now, let's keep it, user can change screenshot separately.
          // setScreenshot(undefined); 
          onUpdate({ customFrameSrc: newImageSrc }); 
        } else if (uploadTarget === 'screenshot') {
          setScreenshot(newImageSrc);
          onUpdate({ screenshotSrc: newImageSrc });
        }
        setUploadTarget(null); 
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) {
        fileInputRef.current.value = ""; 
    }
  };

  const triggerFileUpload = (target: 'customFrame' | 'screenshot') => {
    setUploadTarget(target);
    fileInputRef.current?.click();
  };

  const baseElementWidth = element.size.width;
  const baseElementHeight = element.size.height;

  // Default values for predefined devices
  let deviceNativeAspectRatio = 9 / 16;
  let framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 }; // Default for iPhone-like
  let screenBorderRadius = 'calc(0.8rem * var(--scale-factor, 1))'; // Scalable radius
  let deviceFrameOuterBorderRadius = 'calc(1rem * var(--scale-factor, 1))';
  let deviceLabel = "Device";
  let deviceFrameBgColor = '#111';

  if (element.deviceType !== 'custom') {
    switch (element.deviceType) {
      case 'iphone':
        deviceNativeAspectRatio = 390 / 844;
        framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 };
        screenBorderRadius = 'calc(0.8rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(1rem * var(--scale-factor, 1))';
        deviceLabel = "iPhone";
        break;
      case 'android-phone':
        deviceNativeAspectRatio = 1080 / 2400;
        framePaddingPercent = { top: 3, right: 3, bottom: 3, left: 3 };
        screenBorderRadius = 'calc(0.7rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.9rem * var(--scale-factor, 1))';
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
        framePaddingPercent = { top: 1.5, right: 1.5, bottom: 3.5, left: 1.5 };
        screenBorderRadius = 'calc(0.35rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.5rem * var(--scale-factor, 1))';
        deviceFrameBgColor = '#333';
        deviceLabel = "Desktop Monitor";
        break;
    }
  }

  const visualFrameStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderRadius: deviceFrameOuterBorderRadius,
    backgroundColor: deviceFrameBgColor,
    ['--scale-factor' as any]: element.scale || 1,
  };

  if (element.deviceType !== 'custom') {
    const elementAspectRatio = baseElementWidth / baseElementHeight;
    if (elementAspectRatio > deviceNativeAspectRatio) {
      visualFrameStyle.height = '100%';
      visualFrameStyle.width = `${(baseElementHeight * deviceNativeAspectRatio) / baseElementWidth * 100}%`;
    } else {
      visualFrameStyle.width = '100%';
      visualFrameStyle.height = `${(baseElementWidth / deviceNativeAspectRatio) / baseElementHeight * 100}%`;
    }
  }

  const screenStyle: React.CSSProperties = {
    width: `calc(100% - ${framePaddingPercent.left + framePaddingPercent.right}%)`,
    height: `calc(100% - ${framePaddingPercent.top + framePaddingPercent.bottom}%)`,
    backgroundColor: '#000', // Fallback if screenshot doesn't load
    overflow: 'hidden',
    position: 'relative',
    borderRadius: screenBorderRadius,
    margin: `${framePaddingPercent.top}% ${framePaddingPercent.right}% ${framePaddingPercent.bottom}% ${framePaddingPercent.left}%`,
  };


  if (element.deviceType === 'custom') {
    return (
      <div
        className="w-full h-full flex items-center justify-center bg-transparent group relative"
        style={{ cursor: 'default' }}
      >
        {/* Screenshot Layer (Behind) */}
        {screenshot && (
          <Image
            src={screenshot}
            alt="Screenshot"
            layout="fill"
            objectFit={element.screenshotObjectFit || "contain"}
            className="transition-opacity duration-300 ease-in-out"
            style={{
              opacity: 0,
              position: 'absolute',
              zIndex: 1, 
            }}
            onLoadingComplete={(img) => { img.style.opacity = '1'; }}
            data-ai-hint="app interface general"
            draggable={false}
          />
        )}

        {/* Custom Mockup Frame Visual Layer (On Top) */}
        {customFrame && (
          <Image
            src={customFrame}
            alt="Custom Mockup Frame"
            layout="fill"
            objectFit="contain" 
            className="transition-opacity duration-300 ease-in-out"
            style={{
              opacity: 0,
              position: 'absolute', 
              zIndex: 2, 
              pointerEvents: 'none', 
            }}
            onLoadingComplete={(img) => { img.style.opacity = '1'; }}
            data-ai-hint="device mockup custom"
            draggable={false}
          />
        )}
        
        {/* Upload Buttons Layer (Highest z-index) */}
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ zIndex: 10 }}>
          {!customFrame && isSelected && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background"
              onClick={() => triggerFileUpload('customFrame')}
              onMouseDown={(e) => e.stopPropagation()} 
            >
              <ImagePlusIcon className="w-4 h-4 mr-1.5" /> Upload Mockup Image
            </Button>
          )}
          {customFrame && !screenshot && isSelected && (
            <Button
              variant="secondary"
              size="sm"
              className="text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background" // Ensuring button is visible
              onClick={() => triggerFileUpload('screenshot')}
              onMouseDown={(e) => e.stopPropagation()} 
            >
              <UploadCloudIcon className="w-4 h-4 mr-1.5" /> Upload Screenshot
            </Button>
          )}
           {/* Placeholder if no custom frame and not selected */}
          {!customFrame && !isSelected && (
             <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground p-4 pointer-events-none">
                <ImagePlusIcon className="w-1/3 h-1/3 opacity-50 mb-3" data-ai-hint="upload image plus" />
                <p className="text-sm mb-3 text-center">Custom Mockup Area</p>
            </div>
          )}
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

  // Standard Device Mockup Rendering (iPhone, Android, etc.)
  return (
    <div
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ cursor: 'default', position: 'relative' }} 
    >
      <div style={visualFrameStyle}> 
        <div style={screenStyle}> 
          {screenshot ? (
            <Image
              src={screenshot}
              alt={`${element.deviceType} screenshot`}
              layout="fill" 
              objectFit={element.screenshotObjectFit || "cover"} 
              style={{
                cursor: 'default',
                opacity: 0, 
              }}
              className="transition-opacity duration-300 ease-in-out"
              onLoadingComplete={(img) => { img.style.opacity = '1'; }} 
              data-ai-hint="app interface mobile"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-center p-2">
              <UploadCloudIcon className="w-1/4 h-1/4 opacity-50 mb-2" data-ai-hint="upload cloud arrow"/>
              <p className="text-xs">{`Mockup: ${deviceLabel}`}</p>
              {isSelected && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background"
                style={{zIndex: 10}}
                onClick={() => triggerFileUpload('screenshot')}
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

