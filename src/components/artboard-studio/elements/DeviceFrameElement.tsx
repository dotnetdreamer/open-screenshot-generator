
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
        if (uploadTarget === 'customFrame' && element.deviceType === 'custom') {
          setCustomFrame(newImageSrc);
          onUpdate({
            customFrameSrc: newImageSrc,
            // Reset screenshot if custom frame changes, as aspect ratios/fit might change
            screenshotSrc: undefined,
            screenshotRect: undefined,
            naturalScreenshotWidth: undefined,
            naturalScreenshotHeight: undefined,
          });
        } else if (uploadTarget === 'screenshot') {
          setScreenshot(newImageSrc);
          const img = new window.Image();
          img.onload = () => {
            const naturalWidth = img.naturalWidth;
            const naturalHeight = img.naturalHeight;
            onUpdate({
              screenshotSrc: newImageSrc,
              naturalScreenshotWidth: naturalWidth,
              naturalScreenshotHeight: naturalHeight,
              screenshotRect: { // Default to 90% centered for all device types
                left: 5,
                top: 5,
                width: 90,
                height: 90
              }
            });
          };
          img.src = newImageSrc;
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

  let deviceNativeAspectRatio = 9 / 16;
  let framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 };
  let screenBorderRadius = 'calc(0.8rem * var(--scale-factor, 1))';
  let deviceFrameOuterBorderRadius = 'calc(1rem * var(--scale-factor, 1))';
  let deviceLabel = "Device";
  let deviceFrameBgColor = '#111';
  let notchElement: React.ReactNode = null;

  if (element.deviceType !== 'custom') {
    switch (element.deviceType) {
      case 'iphone':
        deviceNativeAspectRatio = 390 / 844;
        framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 };
        screenBorderRadius = 'calc(0.8rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(1rem * var(--scale-factor, 1))';
        deviceLabel = "iPhone";
        break;
      case 'android-bar':
        deviceNativeAspectRatio = 1080 / 2340;
        framePaddingPercent = { top: 6, right: 3, bottom: 3, left: 3 };
        screenBorderRadius = 'calc(0.7rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.9rem * var(--scale-factor, 1))';
        deviceLabel = "Android (Bar)";
        break;
      case 'android-notch':
        deviceNativeAspectRatio = 1080 / 2340;
        framePaddingPercent = { top: 3, right: 3, bottom: 3, left: 3 };
        screenBorderRadius = 'calc(0.7rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.9rem * var(--scale-factor, 1))';
        deviceLabel = "Android (Notch)";
        notchElement = (
          <div style={{
            position: 'absolute',
            top: `${framePaddingPercent.top * 0.75}%`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '30%',
            height: `${Math.max(20, baseElementHeight * 0.04)}px`,
            backgroundColor: deviceFrameBgColor,
            borderBottomLeftRadius: '8px',
            borderBottomRightRadius: '8px',
            zIndex: 3,
          }} />
        );
        break;
      case 'android-punch-hole':
        deviceNativeAspectRatio = 1080 / 2400;
        framePaddingPercent = { top: 3, right: 3, bottom: 3, left: 3 };
        screenBorderRadius = 'calc(0.7rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.9rem * var(--scale-factor, 1))';
        deviceLabel = "Android (Punch Hole)";
        notchElement = (
          <div style={{
            position: 'absolute',
            top: `${framePaddingPercent.top * 0.75}%`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: `${Math.max(15, baseElementHeight * 0.022)}px`,
            height: `${Math.max(15, baseElementHeight * 0.022)}px`,
            backgroundColor: deviceFrameBgColor,
            borderRadius: '50%',
            zIndex: 3,
          }} />
        );
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
    overflow: 'visible',
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

  const screenStyle: React.CSSProperties = element.deviceType !== 'custom' ? {
    width: `calc(100% - ${framePaddingPercent.left + framePaddingPercent.right}%)`,
    height: `calc(100% - ${framePaddingPercent.top + framePaddingPercent.bottom}%)`,
    backgroundColor: '#000',
    overflow: 'hidden', // Screen area clips its content
    position: 'relative',
    borderRadius: screenBorderRadius,
    margin: `${framePaddingPercent.top}% ${framePaddingPercent.right}% ${framePaddingPercent.bottom}% ${framePaddingPercent.left}%`,
    zIndex: 1,
  } : {};


  if (element.deviceType === 'custom') {
    // Custom device rendering: Screenshot masked by custom frame, then visual frame on top
    const screenshotWrapperStyle: React.CSSProperties = {
      position: 'absolute',
      zIndex: 1, // Screenshot layer
      pointerEvents: 'none', // Let interactions pass through to DraggableElement
      ...(element.screenshotRect && {
        left: `${element.screenshotRect.left}%`,
        top: `${element.screenshotRect.top}%`,
        width: `${element.screenshotRect.width}%`,
        height: `${element.screenshotRect.height}%`,
      }),
      WebkitMaskImage: `url(${customFrame})`,
      maskImage: `url(${customFrame})`,
      WebkitMaskSize: 'contain',
      maskSize: 'contain',
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
      WebkitMaskRepeat: 'no-repeat',
      maskRepeat: 'no-repeat',
    };

    return (
      <div
        className="w-full h-full flex items-center justify-center bg-transparent group relative"
        style={{ cursor: 'default' }}
      >
        {/* Screenshot Layer (Masked) */}
        {element.screenshotSrc && customFrame && (
          <div style={screenshotWrapperStyle} className="w-full h-full">
            <Image
              src={element.screenshotSrc}
              alt="Screenshot"
              layout="fill"
              objectFit={element.screenshotObjectFit || "contain"}
              className="transition-opacity duration-300 ease-in-out"
              style={{ opacity: 0 }}
              onLoadingComplete={(img) => { img.style.opacity = '1'; }}
              data-ai-hint="app interface general"
              draggable={false}
            />
          </div>
        )}

        {/* Custom Mockup Frame Visual Layer (On Top) */}
        {customFrame && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
            <Image
              src={customFrame}
              alt="Custom Mockup Frame"
              layout="fill"
              objectFit="contain"
              className="transition-opacity duration-300 ease-in-out"
              style={{ opacity: 0 }}
              onLoadingComplete={(img) => { img.style.opacity = '1'; }}
              data-ai-hint="device mockup custom"
              draggable={false}
            />
          </div>
        )}

        {/* Upload Buttons Layer */}
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
          {customFrame && !element.screenshotSrc && isSelected && (
            <Button
              variant="secondary"
              size="sm"
              className="text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background"
              onClick={() => triggerFileUpload('screenshot')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <UploadCloudIcon className="w-4 h-4 mr-1.5" /> Upload Screenshot
            </Button>
          )}
          {((!customFrame && !isSelected) || (customFrame && !element.screenshotSrc && !isSelected)) && (
            <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground p-4 pointer-events-none">
              <ImagePlusIcon className="w-1/3 h-1/3 opacity-50 mb-3" data-ai-hint="upload image plus" />
              <p className="text-sm mb-3 text-center">
                {!customFrame ? "Custom Mockup Area" : "Upload Screenshot"}
              </p>
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

  // Standard (Predefined) Device Mockup Rendering
  return (
    <div
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ cursor: 'default', position: 'relative' }}
    >
      <div style={visualFrameStyle}>
        {notchElement}
        <div style={screenStyle}> {/* Screen content area */}
          {screenshot && element.screenshotRect ? (
             <div
              style={{
                position: 'absolute', // Position relative to screenStyle parent
                left: `${element.screenshotRect.left}%`,
                top: `${element.screenshotRect.top}%`,
                width: `${element.screenshotRect.width}%`,
                height: `${element.screenshotRect.height}%`,
                overflow: 'hidden', // Clip the image
              }}
            >
              <Image
                src={screenshot}
                alt={`${element.deviceType} screenshot`}
                layout="fill"
                objectFit={element.screenshotObjectFit || "contain"}
                className="transition-opacity duration-300 ease-in-out"
                style={{
                  cursor: 'default',
                  opacity: 0,
                }}
                onLoadingComplete={(img) => { img.style.opacity = '1'; }}
                data-ai-hint="app interface mobile"
                draggable={false}
              />
            </div>
          ) : screenshot ? ( // Fallback if screenshotRect isn't defined (e.g., before first adjustment)
            <Image
                src={screenshot}
                alt={`${element.deviceType} screenshot (fallback)`}
                layout="fill"
                objectFit={element.screenshotObjectFit || "cover"} // Cover might be better default for predefined
                className="transition-opacity duration-300 ease-in-out"
                style={{
                  cursor: 'default',
                  opacity: 0,
                }}
                onLoadingComplete={(img) => { img.style.opacity = '1'; }}
                data-ai-hint="app interface mobile"
                draggable={false}
              />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-center p-2">
              <UploadCloudIcon className="w-1/4 h-1/4 opacity-50 mb-2" data-ai-hint="upload cloud arrow" />
              <p className="text-xs">{`Mockup: ${deviceLabel}`}</p>
              {isSelected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background"
                  style={{ zIndex: 10 }}
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
