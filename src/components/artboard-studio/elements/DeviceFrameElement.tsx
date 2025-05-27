"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ImagePlusIcon } from 'lucide-react';
import type { DeviceFrameElementProps as DeviceFrameElementType, DeviceType, DeviceStyleType } from '@/types/artboard';
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
  // Add a state to track if high-quality rendering should be used
  const [useHighQualityRendering, setUseHighQualityRendering] = useState(true);

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
            screenshotSrc: undefined, // Reset screenshot if custom frame changes
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

            let initialRect: { left: number; top: number; width: number; height: number };
            if (element.deviceType === 'custom') {
              initialRect = { left: 5, top: 5, width: 90, height: 90 }; // Default for custom
            } else {
              // For predefined devices, screenshot should fill the already padded screen area
              initialRect = { left: 0, top: 0, width: 100, height: 100 };
            }

            onUpdate({
              screenshotSrc: newImageSrc,
              naturalScreenshotWidth: naturalWidth,
              naturalScreenshotHeight: naturalHeight,
              screenshotRect: initialRect
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
      case 'iphone-15':
        deviceNativeAspectRatio = 390 / 844;
        framePaddingPercent = { top: 2.5, right: 3, bottom: 2.5, left: 3 };
        screenBorderRadius = 'calc(1.2rem * var(--scale-factor, 1))'; // More rounded corners
        deviceFrameOuterBorderRadius = 'calc(1.6rem * var(--scale-factor, 1))';
        deviceLabel = "iPhone 15";
        notchElement = (
          <div style={{
            position: 'absolute',
            top: `${framePaddingPercent.top * 0.2}%`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '28%',
            height: `${Math.max(18, baseElementHeight * 0.038)}px`,
            backgroundColor: deviceFrameBgColor,
            borderBottomLeftRadius: '1rem',
            borderBottomRightRadius: '1rem',
            zIndex: 3, // Above screen content
          }} />
        );
        break;
        
      case 'iphone-15-pro':
        deviceNativeAspectRatio = 390 / 844;
        framePaddingPercent = { top: 2.5, right: 3, bottom: 2.5, left: 3 };
        screenBorderRadius = 'calc(1.2rem * var(--scale-factor, 1))'; // More rounded corners
        deviceFrameOuterBorderRadius = 'calc(1.6rem * var(--scale-factor, 1))';
        deviceLabel = "iPhone 15 Pro";
        deviceFrameBgColor = '#1e1e1e'; // Darker titanium color
        notchElement = (
          <div style={{
            position: 'absolute',
            top: `${framePaddingPercent.top * 0.2}%`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '28%',
            height: `${Math.max(18, baseElementHeight * 0.038)}px`,
            backgroundColor: deviceFrameBgColor,
            borderBottomLeftRadius: '1rem',
            borderBottomRightRadius: '1rem',
            zIndex: 3, // Above screen content
          }} />
        );
        break;
        
      case 'iphone-14':
        deviceNativeAspectRatio = 390 / 844;
        framePaddingPercent = { top: 3, right: 3, bottom: 3, left: 3 };
        screenBorderRadius = 'calc(1rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(1.4rem * var(--scale-factor, 1))';
        deviceLabel = "iPhone 14";
        notchElement = (
          <div style={{
            position: 'absolute',
            top: `${framePaddingPercent.top * 0.2}%`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '32%',
            height: `${Math.max(20, baseElementHeight * 0.04)}px`,
            backgroundColor: deviceFrameBgColor,
            borderBottomLeftRadius: '0.9rem',
            borderBottomRightRadius: '0.9rem',
            zIndex: 3, // Above screen content
          }} />
        );
        break;
        
      case 'iphone-13':
        deviceNativeAspectRatio = 390 / 844;
        framePaddingPercent = { top: 3, right: 3, bottom: 3, left: 3 };
        screenBorderRadius = 'calc(0.9rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(1.3rem * var(--scale-factor, 1))';
        deviceLabel = "iPhone 13";
        notchElement = (
          <div style={{
            position: 'absolute',
            top: `${framePaddingPercent.top * 0.2}%`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '35%',
            height: `${Math.max(22, baseElementHeight * 0.042)}px`,
            backgroundColor: deviceFrameBgColor,
            borderBottomLeftRadius: '0.8rem',
            borderBottomRightRadius: '0.8rem',
            zIndex: 3, // Above screen content
          }} />
        );
        break;
        
      case 'iphone':
        deviceNativeAspectRatio = 390 / 844;
        framePaddingPercent = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 }; // Example values
        screenBorderRadius = 'calc(0.8rem * var(--scale-factor, 1))'; // Roughly 39px on 390 width base
        deviceFrameOuterBorderRadius = 'calc(1rem * var(--scale-factor, 1))'; // Roughly 50px
        deviceLabel = "iPhone";
        break;
      case 'android-bar':
        deviceNativeAspectRatio = 1080 / 2340; // Example ratio
        framePaddingPercent = { top: 6, right: 3, bottom: 3, left: 3 };
        screenBorderRadius = 'calc(0.7rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.9rem * var(--scale-factor, 1))';
        deviceLabel = "Android (Bar)";
        break;
      case 'android-notch':
        deviceNativeAspectRatio = 1080 / 2340; // Example ratio
        framePaddingPercent = { top: 3, right: 3, bottom: 3, left: 3 };
        screenBorderRadius = 'calc(0.7rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.9rem * var(--scale-factor, 1))';
        deviceLabel = "Android (Notch)";
        notchElement = (
          <div style={{
            position: 'absolute',
            top: `${framePaddingPercent.top * 0.75}%`, // Position within bezel
            left: '50%',
            transform: 'translateX(-50%)',
            width: '30%',
            height: `${Math.max(20, baseElementHeight * 0.04)}px`, // Dynamic height
            backgroundColor: deviceFrameBgColor,
            borderBottomLeftRadius: '8px',
            borderBottomRightRadius: '8px',
            zIndex: 3, // Above screen content
          }} />
        );
        break;
      case 'android-punch-hole':
        deviceNativeAspectRatio = 1080 / 2400; // Example ratio
        framePaddingPercent = { top: 3, right: 3, bottom: 3, left: 3 };
        screenBorderRadius = 'calc(0.7rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.9rem * var(--scale-factor, 1))';
        deviceLabel = "Android (Punch Hole)";
        notchElement = (
          <div style={{
            position: 'absolute',
            top: `${framePaddingPercent.top * 0.75}%`, // Position within bezel
            left: '50%',
            transform: 'translateX(-50%)',
            width: `${Math.max(15, baseElementHeight * 0.022)}px`, // Dynamic size
            height: `${Math.max(15, baseElementHeight * 0.022)}px`,
            backgroundColor: deviceFrameBgColor,
            borderRadius: '50%',
            zIndex: 3, // Above screen content
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
        framePaddingPercent = { top: 1.5, right: 1.5, bottom: 3.5, left: 1.5 }; // Smaller top/side, larger bottom for stand
        screenBorderRadius = 'calc(0.35rem * var(--scale-factor, 1))';
        deviceFrameOuterBorderRadius = 'calc(0.5rem * var(--scale-factor, 1))';
        deviceFrameBgColor = '#333';
        deviceLabel = "Desktop Monitor";
        break;
    }
  }

  // SVG-based rendering for device frames with perspective transforms
  const renderDeviceSVG = (
    borderRadius: string,
    screenRadius: string,
    paddingPercent: { top: number; right: number; bottom: number; left: number },
    screenBackgroundColor = '#000',
    frameBackgroundColor = '#111'
  ) => {
    // Convert borderRadius from CSS format (like '16px' or '1rem') to a number
    const extractRadiusNumber = (radius: string): number => {
      const num = parseFloat(radius.replace(/[^\d.]/g, ''));
      return isNaN(num) ? 16 : num;
    };
    
    const frameRadiusValue = extractRadiusNumber(borderRadius);
    const screenRadiusValue = extractRadiusNumber(screenRadius);
    
    // Calculate screen position and size based on padding percentages
    const screenLeft = paddingPercent.left;
    const screenTop = paddingPercent.top;
    const screenWidth = 100 - paddingPercent.left - paddingPercent.right;
    const screenHeight = 100 - paddingPercent.top - paddingPercent.bottom;
    
    // Notch rendering (simplified)
    let notchElement = null;
    if (element.deviceType === 'iphone' || element.deviceType?.includes('iphone-')) {
      const notchWidth = 28;
      const notchHeight = 4;
      notchElement = (
        <rect
          x={`${(100 - notchWidth) / 2}%`}
          y={`${screenTop * 0.4}%`}
          width={`${notchWidth}%`}
          height={`${notchHeight}%`}
          rx={notchHeight / 2}
          ry={notchHeight / 2}
          fill={frameBackgroundColor}
        />
      );
    } else if (element.deviceType === 'android-punch-hole') {
      // Punch hole
      const punchSize = 4;
      notchElement = (
        <circle
          cx={`${50}%`}
          cy={`${screenTop * 0.8}%`}
          r={`${punchSize / 2}%`}
          fill={frameBackgroundColor}
        />
      );
    } else if (element.deviceType === 'android-notch') {
      // Android notch
      const notchWidth = 25;
      const notchHeight = 3;
      notchElement = (
        <rect
          x={`${(100 - notchWidth) / 2}%`}
          y={`${screenTop * 0.4}%`}
          width={`${notchWidth}%`}
          height={`${notchHeight}%`}
          rx={notchHeight / 2}
          ry={notchHeight / 2}
          fill={frameBackgroundColor}
        />
      );
    }
    
    return (
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 100 100" 
        preserveAspectRatio="none"
        style={{
          overflow: 'visible',
          position: 'absolute',
          inset: 0,
        }}
      >
        {/* Device frame outer shape with shadow */}
        <defs>
          <filter id={`shadow-${element.id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.3" />
          </filter>
        </defs>
        
        {/* Main device frame shape */}
        <rect 
          x="0" 
          y="0" 
          width="100" 
          height="100" 
          rx={frameRadiusValue} 
          ry={frameRadiusValue} 
          fill={frameBackgroundColor}
          filter={`url(#shadow-${element.id})`}
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
        />
        
        {/* Screen area */}
        <rect
          x={screenLeft}
          y={screenTop}
          width={screenWidth}
          height={screenHeight}
          rx={screenRadiusValue}
          ry={screenRadiusValue}
          fill={screenBackgroundColor}
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
        />
        
        {/* Notch or punch hole if applicable */}
        {notchElement}
      </svg>
    );
  };
  
  // Define device perspective transforms with mirror-matching values for left and right
  const getDevicePerspectiveTransform = (styleType: DeviceStyleType = 'normal'): string => {
    switch (styleType) {
      case 'perspective-left':
        // Mirror the right perspective for consistency
        return 'matrix3d(1.04397, 0.095046, 0, -3.13e-05, -0.236454, 0.928959, 0, -3.99e-05, 0, 0, 1, 0, 26.0176, 24.4342, 0, 1)';
      case 'perspective-right':
        return 'matrix3d(1.04397, -0.095046, 0, 3.13e-05, 0.236454, 0.928959, 0, -3.99e-05, 0, 0, 1, 0, -26.0176, 24.4342, 0, 1)';
      case 'perspective-slight-right':
        return 'matrix3d(1.02397, -0.065046, 0, 2.13e-05, 0.136454, 0.968959, 0, -1.99e-05, 0, 0, 1, 0, -16.0176, 14.4342, 0, 1)';
      case 'perspective-slight-left':
        // Mirror the slight-right perspective for consistency
        return 'matrix3d(1.02397, 0.065046, 0, -2.13e-05, -0.136454, 0.968959, 0, -1.99e-05, 0, 0, 1, 0, 16.0176, 14.4342, 0, 1)';
      case 'perspective-front':
        return 'matrix3d(1, 0, 0, 0, 0, 0.98, 0, 0.0001, 0, 0, 1, 0, 0, 8, 0, 1)';
      case 'custom':
        return element.matrix3d || 'none';
      default:
        return 'none';
    }
  };
  
  // For SVG-based rendering
  const createSVGDeviceFrame = (color: string = '#000', opacity: number = 0.2) => {
    const frameRadius = parseFloat(String(deviceFrameOuterBorderRadius).replace(/[^\d.]/g, ''));
    const screenRadius = parseFloat(String(screenBorderRadius).replace(/[^\d.]/g, ''));
    
    return `
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="100" height="100" 
          rx="${frameRadius}" ry="${frameRadius}" 
          fill="none" 
          stroke="${color}" 
          stroke-opacity="${opacity}" 
          stroke-width="0.5" 
          vector-effect="non-scaling-stroke" />
      </svg>
    `;
  };
  
  // Check if we're using the SVG perspective mode
  const usingSvgPerspectiveMode = element.styleType && element.styleType !== 'normal';
  
  // Container style with hardware acceleration
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    perspective: '1200px',
    // Only apply transform at the container level when in perspective mode
    transform: usingSvgPerspectiveMode ? getDevicePerspectiveTransform(element.styleType) : 'none',
    transformStyle: 'preserve-3d',
    backfaceVisibility: 'hidden',
  };

  // Normal frame style
  const normalFrameStyle: React.CSSProperties = {
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
  
  // Screen style for normal mode
  const normalScreenStyle: React.CSSProperties = {
    width: `calc(100% - ${framePaddingPercent.left + framePaddingPercent.right}%)`,
    height: `calc(100% - ${framePaddingPercent.top + framePaddingPercent.bottom}%)`,
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'relative',
    borderRadius: screenBorderRadius,
    margin: `${framePaddingPercent.top}% ${framePaddingPercent.right}% ${framePaddingPercent.bottom}% ${framePaddingPercent.left}%`,
    zIndex: 1,
  };
  
  // SVG frame style for perspective mode
  const svgFrameStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    backgroundColor: deviceFrameBgColor,
    overflow: 'visible',
  };
  
  return (
    <div
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ cursor: 'default', position: 'relative' }}
    >
      {/* Apply transform to the outer container */}
      <div 
        className={usingSvgPerspectiveMode ? "device-container-svg" : "device-container"}
        style={containerStyle}
      >
        {usingSvgPerspectiveMode ? (
          // SVG-based device rendering for perspective mode
          <div style={svgFrameStyle}>
            {/* SVG for the device frame with proper vector rendering */}
            <svg 
              width="100%" 
              height="100%" 
              viewBox="0 0 100 100" 
              preserveAspectRatio="none"
              style={{
                position: 'absolute',
                inset: 0,
                overflow: 'visible',
              }}
            >
              {/* Main device frame background */}
              <rect 
                x="0" 
                y="0" 
                width="100" 
                height="100" 
                rx={parseFloat(String(deviceFrameOuterBorderRadius).replace(/[^\d.]/g, ''))}
                ry={parseFloat(String(deviceFrameOuterBorderRadius).replace(/[^\d.]/g, ''))}
                fill={deviceFrameBgColor}
                strokeWidth="0.5"
                stroke="rgba(0,0,0,0.2)"
                vectorEffect="non-scaling-stroke"
                shapeRendering="geometricPrecision"
              />
              
              {/* Screen area */}
              <rect
                x={framePaddingPercent.left}
                y={framePaddingPercent.top}
                width={100 - framePaddingPercent.left - framePaddingPercent.right}
                height={100 - framePaddingPercent.top - framePaddingPercent.bottom}
                rx={parseFloat(String(screenBorderRadius).replace(/[^\d.]/g, ''))}
                ry={parseFloat(String(screenBorderRadius).replace(/[^\d.]/g, ''))}
                fill="#000"
                vectorEffect="non-scaling-stroke"
                shapeRendering="geometricPrecision"
              />
              
              {/* Add notch if needed */}
              {element.deviceType === 'iphone' || element.deviceType?.includes('iphone-') ? (
                <rect
                  x={(100 - 28) / 2}
                  y={framePaddingPercent.top * 0.4}
                  width="28"
                  height="3"
                  rx="1.5"
                  ry="1.5"
                  fill={deviceFrameBgColor}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
            
            {/* Screenshot container for perspective mode */}
            {screenshot && element.screenshotRect && (
              <div 
                style={{
                  position: 'absolute',
                  left: `${framePaddingPercent.left}%`,
                  top: `${framePaddingPercent.top}%`,
                  width: `${100 - framePaddingPercent.left - framePaddingPercent.right}%`,
                  height: `${100 - framePaddingPercent.top - framePaddingPercent.bottom}%`,
                  overflow: 'hidden',
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: `${element.screenshotRect.left}%`,
                    top: `${element.screenshotRect.top}%`,
                    width: `${element.screenshotRect.width}%`,
                    height: `${element.screenshotRect.height}%`,
                    overflow: 'hidden',
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
              </div>
            )}
            
            {/* Upload UI for perspective mode */}
            {!screenshot && isSelected && (
              <div className="absolute inset-0 flex items-center justify-center">
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
              </div>
            )}
          </div>
        ) : (
          // Standard CSS-based device rendering for normal mode
          <div style={normalFrameStyle}>
            {notchElement}
            <div style={normalScreenStyle}> {/* Using the defined normalScreenStyle */}
              {screenshot && element.screenshotRect ? (
                <div
                  style={{
                    position: 'absolute',
                    left: `${element.screenshotRect.left}%`,
                    top: `${element.screenshotRect.top}%`,
                    width: `${element.screenshotRect.width}%`,
                    height: `${element.screenshotRect.height}%`,
                    overflow: 'hidden',
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
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-center p-2">
                  <UploadCloudIcon className="w-1/4 h-1/4 opacity-50 mb-2" data-ai-hint="upload cloud arrow"/>
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

