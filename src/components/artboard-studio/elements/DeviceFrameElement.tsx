
"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ImagePlusIcon } from 'lucide-react'; 
import type { DeviceFrameElementProps as DeviceFrameElementType } from '@/types/artboard';

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
          onUpdate({ customFrameSrc: newImageSrc, screenshotSrc: undefined }); // Reset screenshot when custom frame changes
        } else if (uploadTarget === 'screenshot') {
          setScreenshot(newImageSrc);
          onUpdate({ screenshotSrc: newImageSrc });
        }
        setUploadTarget(null); // Reset upload target
      };
      reader.readAsDataURL(file);
    }
     // Clear the input value to allow re-uploading the same file
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };

  const triggerFileUpload = (target: 'customFrame' | 'screenshot') => {
    setUploadTarget(target);
    fileInputRef.current?.click();
  };

  let deviceNativeAspectRatio = 9 / 16; 
  let framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 };
  let screenBorderRadius = '0.8rem';
  let deviceLabel = "Device";
  let deviceFrameBgColor = '#111';
  let deviceFrameOuterBorderRadius = '1rem';

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
        framePaddingPercent = { top: 1.5, right: 1.5, bottom: 3.5, left: 1.5 };
        screenBorderRadius = 'calc(0.35rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.5rem * var(--scale-factor, 1))';
        deviceFrameBgColor = '#333';
        deviceLabel = "Desktop Monitor";
        break;
    }
  }


  const baseElementWidth = element.size.width;
  const baseElementHeight = element.size.height;

  let visualFrameStyle: React.CSSProperties = {
    width: '100%', // For custom, the frame image dictates aspect within this box
    height: '100%',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderRadius: deviceFrameOuterBorderRadius,
    backgroundColor: element.deviceType === 'custom' ? 'transparent' : deviceFrameBgColor,
    ['--scale-factor' as any]: element.scale || 1,
  };
  
  if (element.deviceType !== 'custom') {
    const elementAspectRatio = baseElementWidth / baseElementHeight;
    if (elementAspectRatio > deviceNativeAspectRatio) {
      visualFrameStyle.height = '100%';
      visualFrameStyle.width = `${(deviceNativeAspectRatio / elementAspectRatio) * 100}%`;
    } else {
      visualFrameStyle.width = '100%';
      visualFrameStyle.height = `${(elementAspectRatio / deviceNativeAspectRatio) * 100}%`;
    }
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

  // Custom Mockup Specific Rendering
  if (element.deviceType === 'custom') {
    return (
      <div 
        className="w-full h-full flex items-center justify-center bg-transparent group"
        style={{ cursor: 'default', position: 'relative' }}
      >
        <div style={{...visualFrameStyle, borderRadius: '0.5rem' /* Consistent rounding for custom container */ }}>
          {!customFrame ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground p-4">
              <ImagePlusIcon className="w-1/3 h-1/3 opacity-50 mb-3" />
              <p className="text-sm mb-3 text-center">Custom Mockup Area</p>
              {isSelected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background"
                  onClick={() => triggerFileUpload('customFrame')}
                  onMouseDown={(e) => e.stopPropagation()} 
                >
                  Upload Mockup Image
                </Button>
              )}
            </div>
          ) : (
            <div className="relative w-full h-full">
              <Image
                src={customFrame}
                alt="Custom Mockup Frame"
                layout="fill"
                objectFit="contain" // Show the whole custom mockup
                className="transition-opacity duration-300 ease-in-out" 
                onLoadingComplete={(img) => img.style.opacity = '1'}
                draggable={false}
              />
              {screenshot ? (
                 <div style={{
                    position: 'absolute',
                    top: '50%', 
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    // Screenshot area is 90% of the custom frame's container, adjust as needed
                    width: '90%', 
                    height: '90%', 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden', // Clip screenshot if it's larger than this area
                  }}>
                    <Image
                      src={screenshot}
                      alt={`Screenshot`}
                      layout="fill" // Fill the 90% container
                      objectFit="contain" // Contain screenshot within that 90% area
                      style={{ objectPosition: "50% 50%", cursor: 'default' }}
                      className="transition-opacity duration-300 ease-in-out" 
                      onLoadingComplete={(img) => img.style.opacity = '1'}
                      data-ai-hint="app interface general"
                      draggable={false} 
                    />
                </div>
              ) : (
                isSelected && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 group-hover:bg-black/50 transition-colors">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="text-xs py-1 px-2 h-auto"
                      onClick={() => triggerFileUpload('screenshot')}
                      onMouseDown={(e) => e.stopPropagation()} 
                    >
                      <UploadCloudIcon className="w-4 h-4 mr-1.5" /> Upload Screenshot
                    </Button>
                  </div>
                )
              )}
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

  // Standard Device Mockup Rendering
  return (
    <div 
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ cursor: 'default', position: 'relative' }}
    >
      <div 
        style={visualFrameStyle}
      >
        <div style={screenStyle}>
          {screenshot ? (
            <Image
              src={screenshot}
              alt={`${element.deviceType} screenshot`}
              layout="fill"
              objectFit="cover" 
              style={{ objectPosition: element.screenshotObjectPosition || "50% 50%", cursor: 'default' }}
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
