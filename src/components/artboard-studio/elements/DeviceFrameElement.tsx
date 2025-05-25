
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
          // When a new custom frame is uploaded, clear the existing screenshot 
          // as it might not be relevant to the new frame.
          setScreenshot(undefined); 
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
        fileInputRef.current.value = ""; // Allow re-uploading the same file
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
  let deviceFrameBgColor = '#111'; // Default bezel color for predefined devices
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
        framePaddingPercent = { top: 1.5, right: 1.5, bottom: 3.5, left: 1.5 }; // More bottom bezel for stand
        screenBorderRadius = 'calc(0.35rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.5rem * var(--scale-factor, 1))';
        deviceFrameBgColor = '#333';
        deviceLabel = "Desktop Monitor";
        break;
    }
  }

  const visualFrameStyle: React.CSSProperties = {
    width: '100%', // Visual frame should attempt to fill the draggable element
    height: '100%',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative', // For positioning screen content within it
    borderRadius: deviceFrameOuterBorderRadius,
    backgroundColor: deviceFrameBgColor, 
    ['--scale-factor' as any]: element.scale || 1, // For calc() in border-radius
  };

  // Adjust visual frame size to maintain native aspect ratio for predefined devices
  if (element.deviceType !== 'custom') {
    const elementAspectRatio = element.size.width / element.size.height;
    // If element is wider than native, height is 100%, width adjusts
    if (elementAspectRatio > deviceNativeAspectRatio) {
      visualFrameStyle.height = '100%';
      visualFrameStyle.width = `${(baseElementHeight * deviceNativeAspectRatio) / baseElementWidth * 100}%`;
    } else { // If element is taller (or same), width is 100%, height adjusts
      visualFrameStyle.width = '100%';
      visualFrameStyle.height = `${(baseElementWidth / deviceNativeAspectRatio) / baseElementHeight * 100}%`;
    }
  }


  const screenStyle: React.CSSProperties = {
    // Screen dimensions relative to its direct parent (visualFrameStyle div)
    width: `calc(100% - ${framePaddingPercent.left + framePaddingPercent.right}%)`,
    height: `calc(100% - ${framePaddingPercent.top + framePaddingPercent.bottom}%)`,
    backgroundColor: '#000', // Fallback if screenshot doesn't load
    overflow: 'hidden',
    position: 'relative', // For screenshot image positioning
    borderRadius: screenBorderRadius,
    // Margin centers the screen within the visualFrame based on padding percentages
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
            {/* Screenshot Layer - Rendered first, so it's underneath the frame */}
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

            {/* Custom Mockup Frame Layer - Rendered second, so it's on top */}
            {/* This image MUST have transparency for the screen area */}
            <Image
              src={customFrame}
              alt="Custom Mockup Frame"
              layout="fill"
              objectFit="contain" // The frame image itself should be contained
              className="transition-opacity duration-300 ease-in-out"
              onLoadingComplete={(img) => { img.style.opacity = '1'; }}
              style={{
                opacity: 0,
                // This layer should not capture pointer events if a screenshot is also present,
                // allowing the DraggableElement to handle interactions.
                // If no screenshot, it can be interactive to show the upload button.
                pointerEvents: screenshot ? 'none' : 'auto', 
              }}
              data-ai-hint="device mockup custom"
              draggable={false}
            />
            
            {/* Screenshot Upload Button (appears if no screenshot, overlays the custom frame) */}
            {!screenshot && isSelected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 group-hover:bg-black/50 transition-colors z-10">
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-xs py-1 px-2 h-auto"
                  onClick={() => triggerFileUpload('screenshot')}
                  onMouseDown={(e) => e.stopPropagation()} // Prevent drag start on button click
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
                onMouseDown={(e) => e.stopPropagation()} // Prevent drag start
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

  // Standard Device Mockup Rendering (iPhone, Android, etc.)
  return (
    <div
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ cursor: 'default', position: 'relative' }} // Ensure parent has context for absolute children
    >
      <div style={visualFrameStyle}> {/* This div now correctly scales and maintains aspect ratio */}
        <div style={screenStyle}> {/* Screen is positioned and sized within visualFrameStyle */}
          {screenshot ? (
            <Image
              src={screenshot}
              alt={`${element.deviceType} screenshot`}
              layout="fill" // Fill the screenStyle div
              objectFit={element.screenshotObjectFit || "cover"} // Cover or contain within screenStyle
              style={{
                cursor: 'default',
                opacity: 0, // For fade-in effect
              }}
              className="transition-opacity duration-300 ease-in-out"
              onLoadingComplete={(img) => { img.style.opacity = '1'; }} // Fade-in on load
              data-ai-hint="app interface mobile"
              draggable={false}
            />
          ) : (
            // Placeholder for when no screenshot is uploaded
            <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-center p-2">
              <UploadCloudIcon className="w-1/4 h-1/4 opacity-50 mb-2" data-ai-hint="upload cloud arrow"/>
              <p className="text-xs">{placeholderText}</p>
              {/* Upload button appears only if the element is selected */}
              {isSelected && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-xs py-1 px-2 h-auto bg-background/80 hover:bg-background z-10"
                onClick={() => triggerFileUpload('screenshot')}
                onMouseDown={(e) => e.stopPropagation()} // Prevent drag start on button click
              >
                Upload Screenshot
              </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Hidden file input for image uploads */}
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

