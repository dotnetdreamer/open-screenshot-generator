
"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ImagePlusIcon } from 'lucide-react';
import type { DeviceFrameElementProps as DeviceFrameElementType, DeviceType } from '@/types/artboard';

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
          onUpdate({ customFrameSrc: newImageSrc, screenshotSrc: undefined }); 
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

  let deviceNativeAspectRatio = 9 / 16;
  let framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 };
  let screenBorderRadius = '0.8rem';
  let deviceLabel = "Device";
  let deviceFrameBgColor = '#111';
  let deviceFrameOuterBorderRadius = '1rem';

  const baseElementWidth = element.size.width;
  const baseElementHeight = element.size.height;

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
    const elementAspectRatio = element.size.width / element.size.height;
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
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'relative',
    borderRadius: screenBorderRadius,
    margin: `${framePaddingPercent.top}% ${framePaddingPercent.right}% ${framePaddingPercent.bottom}% ${framePaddingPercent.left}%`,
  };

  const placeholderText = `Mockup: ${deviceLabel}`;

  if (element.deviceType === 'custom') {
    return (
      <div
        className="w-full h-full flex items-center justify-center bg-transparent group relative"
        style={{ cursor: 'default' }}
      >
        {customFrame ? (
          <>
            {/* Container for the screenshot, this div will be masked */}
            <div
              className="absolute inset-0 w-full h-full"
              style={{
                maskImage: `url(${customFrame})`,
                maskSize: 'contain',
                maskRepeat: 'no-repeat',
                maskPosition: 'center',
                WebkitMaskImage: `url(${customFrame})`,
                WebkitMaskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
              }}
            >
              {screenshot && (
                <Image
                  src={screenshot}
                  alt="Screenshot"
                  layout="fill"
                  objectFit={element.screenshotObjectFit || "contain"}
                  className="transition-opacity duration-300 ease-in-out"
                  onLoadingComplete={(img) => { img.style.opacity = '1'; }}
                  style={{ opacity: 0 }}
                  data-ai-hint="app interface general"
                  draggable={false}
                />
              )}
            </div>

            {/* Visual Mockup Frame (Overlay) - Renders the bezels etc. */}
            {/* This image shows the device frame itself and should be on top of the masked screenshot */}
            <Image
              src={customFrame}
              alt="Custom Mockup Frame"
              layout="fill"
              objectFit="contain" // The frame itself should also be contained
              className="transition-opacity duration-300 ease-in-out"
              onLoadingComplete={(img) => { img.style.opacity = '1'; }}
              style={{
                opacity: 0,
                pointerEvents: 'none', // Allows clicks to pass through to elements behind (like upload button if screenshot isn't there)
              }}
              data-ai-hint="device mockup custom"
              draggable={false}
            />
            
            {/* Screenshot Upload Button (appears if no screenshot, on top of custom frame) */}
            {!screenshot && isSelected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 group-hover:bg-black/50 transition-colors z-10">
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
            )}
          </>
        ) : (
          // Initial state: "Upload Mockup Image" button
          <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground p-4">
            <ImagePlusIcon className="w-1/3 h-1/3 opacity-50 mb-3" data-ai-hint="upload image plus" />
            <p className="text-sm mb-3 text-center">Custom Mockup Area</p>
            {isSelected && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background z-10"
                onClick={() => triggerFileUpload('customFrame')}
                onMouseDown={(e) => e.stopPropagation()}
              >
                Upload Mockup Image
              </Button>
            )}
          </div>
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

  // Standard Device Mockup Rendering
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
              <UploadCloudIcon className="w-1/4 h-1/4 opacity-50 mb-2" data-ai-hint="upload cloud arrow" />
              <p className="text-xs">{placeholderText}</p>
              {isSelected && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background z-10"
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
