"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ImagePlusIcon } from 'lucide-react';
import type { DeviceFrameElementProps as DeviceFrameElementType, DeviceType, DeviceStyleType } from '@/types/artboard';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';
import { cn } from '@/lib/utils';
import { Device3DRenderer } from './Device3DRenderer';

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

  // Corner-handle resizing changes element.scale (not element.size), and the wrapper
  // renders at size * scale — so any px value must be derived from the effective width.
  const effectiveWidth = element.size.width * (element.scale || 1);

  // Label, native aspect, and screen geometry (bezel padding + screen corner
  // radius) live in the device registry — the single source of truth shared
  // with the swap engine and pickers. Only per-device chrome (outer radius,
  // body color, notch JSX) stays in the switch below.
  const deviceDescriptor = getDeviceDescriptor(element.deviceType);
  const deviceLabel = deviceDescriptor.label;
  const framePaddingPercent = deviceDescriptor.screen?.paddingPercent
    ?? { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 };
  const screenBorderRadius = deviceDescriptor.screen
    ? `${effectiveWidth * deviceDescriptor.screen.radiusFactor}px`
    : 'calc(0.8rem * var(--scale-factor, 1))';
  let deviceFrameOuterBorderRadius = 'calc(1rem * var(--scale-factor, 1))';
  let deviceFrameBgColor = '#111';
  let notchElement: React.ReactNode = null;

  if (element.deviceType !== 'custom') {
    switch (element.deviceType) {
      case 'iphone-15':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.14}px`;
        // Dynamic Island: rendered inside the screen. Width is % of screen,
        // aspect-ratio locks the pill shape no matter how the frame is resized.
        notchElement = (
          <div style={{
            position: 'absolute',
            top: '1.6%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '26%',
            aspectRatio: '3.5 / 1',
            backgroundColor: 'var(--notch-bg, #000)',
            borderRadius: '9999px',
            zIndex: 3, // Above screen content
          }} />
        );
        break;

      case 'iphone-15-pro':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.14}px`;
        deviceFrameBgColor = '#1e1e1e'; // Darker titanium color
        // Dynamic Island: rendered inside the screen. Width is % of screen,
        // aspect-ratio locks the pill shape no matter how the frame is resized.
        notchElement = (
          <div style={{
            position: 'absolute',
            top: '1.6%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '26%',
            aspectRatio: '3.5 / 1',
            backgroundColor: 'var(--notch-bg, #000)',
            borderRadius: '9999px',
            zIndex: 3, // Above screen content
          }} />
        );
        break;

      case 'iphone-17-pro-max':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.15}px`;
        deviceFrameBgColor = '#1e1e1e';
        // Dynamic Island pill, anchored inside the screen like the 15 Pro.
        notchElement = (
          <div style={{
            position: 'absolute',
            top: '1.5%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '25%',
            aspectRatio: '3.6 / 1',
            backgroundColor: 'var(--notch-bg, #000)',
            borderRadius: '9999px',
            zIndex: 3, // Above screen content
          }} />
        );
        break;

      case 'iphone-14':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.13}px`;
        // Classic notch: rendered inside the screen, glued to its top edge.
        // aspect-ratio + percentage radii keep the shape identical at any size.
        notchElement = (
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '32%',
            aspectRatio: '4.6 / 1',
            backgroundColor: `var(--notch-bg, var(--frame-bg, ${deviceFrameBgColor}))`,
            borderBottomLeftRadius: '11% 50%',
            borderBottomRightRadius: '11% 50%',
            zIndex: 3, // Above screen content
          }} />
        );
        break;

      case 'iphone-13':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.12}px`;
        // Classic notch: rendered inside the screen, glued to its top edge.
        // aspect-ratio + percentage radii keep the shape identical at any size.
        notchElement = (
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '34%',
            aspectRatio: '4.4 / 1',
            backgroundColor: `var(--notch-bg, var(--frame-bg, ${deviceFrameBgColor}))`,
            borderBottomLeftRadius: '11% 48%',
            borderBottomRightRadius: '11% 48%',
            zIndex: 3, // Above screen content
          }} />
        );
        break;

      case 'iphone-x':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.12}px`;
        // Classic notch: rendered inside the screen, glued to its top edge.
        // aspect-ratio + percentage radii keep the shape identical at any size.
        notchElement = (
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '36%',
            aspectRatio: '4.2 / 1',
            backgroundColor: `var(--notch-bg, var(--frame-bg, ${deviceFrameBgColor}))`,
            borderBottomLeftRadius: '12% 50%',
            borderBottomRightRadius: '12% 50%',
            zIndex: 3, // Above screen content
          }} />
        );
        break;

      case 'iphone':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.1}px`;
        break;
      case 'android-bar':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.025}px`;
        break;
      case 'android-notch':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.025}px`;
        // Notch rendered inside the screen, glued to its top edge.
        // aspect-ratio + percentage radii keep the shape identical at any size.
        notchElement = (
          <div style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '32%',
            aspectRatio: '5 / 1',
            backgroundColor: `var(--notch-bg, var(--frame-bg, ${deviceFrameBgColor}))`,
            borderBottomLeftRadius: '12% 60%',
            borderBottomRightRadius: '12% 60%',
            zIndex: 3, // Above screen content
          }} />
        );
        break;
      case 'android-punch-hole':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.025}px`;
        // Camera cutout rendered inside the screen; aspect-ratio keeps it a
        // perfect circle no matter how the frame is resized.
        notchElement = (
          <div style={{
            position: 'absolute',
            top: '1.2%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '5%',
            aspectRatio: '1 / 1',
            backgroundColor: 'var(--notch-bg, #000)',
            borderRadius: '50%',
            zIndex: 3, // Above screen content
          }} />
        );
        break;
      case 'tablet':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.02}px`;
        break;
      case 'ipad-pro-13':
        // Modern iPad Pro/Air slab: uniform thin bezel, softly rounded body.
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.05}px`;
        deviceFrameBgColor = '#1e1e1e';
        break;
      case 'ipad-11':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.055}px`;
        deviceFrameBgColor = '#1e1e1e';
        break;
      case 'tablet-7':
        // Chunkier bezels than the 10-inch; typical budget Android slate.
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.045}px`;
        break;
      case 'tablet-10':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.032}px`;
        break;
      case 'desktop':
        deviceFrameOuterBorderRadius = `${effectiveWidth * 0.013}px`;
        deviceFrameBgColor = '#333';
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
    
    // Notch rendering (simplified). Only iOS *phones* get the notch pill —
    // iPads are all-screen slabs with no cutout.
    let notchElement = null;
    const svgDescriptor = getDeviceDescriptor(element.deviceType);
    if (svgDescriptor.platform === 'ios' && svgDescriptor.category === 'phone') {
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
  
  // True-3D mode: rendered with three.js (real geometry, lighting and a camera
  // whose distance is proportional to the device) so the depth reads identically
  // at any element size and the screenshot wraps the screen face exactly.
  const is3DMode = element.styleType === '3d-left' || element.styleType === '3d-right';

  // Check if we're using the SVG perspective mode
  const usingSvgPerspectiveMode = element.styleType && element.styleType !== 'normal' && !is3DMode;

  // Colored-device presets: recolor / fade / hollow out the flat frame.
  const frameFill = element.frameColor ?? deviceFrameBgColor;
  const frameAlpha = element.frameOpacity ?? 1;
  const isOutlineFrame = element.frameStyle === 'outline';
  const frameFillCss = frameAlpha >= 1
    ? frameFill
    : `color-mix(in srgb, ${frameFill} ${Math.round(frameAlpha * 100)}%, transparent)`;

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
    // The global .device-container drop-shadow reads as a dirty halo behind
    // see-through or hollow frames — suppress it there (inline beats the class)
    filter: isOutlineFrame || frameAlpha < 1 ? 'none' : undefined,
  };

  // Frame style used for both normal and perspective modes
  const frameStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    // A drop shadow behind a see-through or hollow frame reads as a dark slab
    boxShadow: isOutlineFrame || frameAlpha < 1 ? 'none' : '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderRadius: deviceFrameOuterBorderRadius,
    backgroundColor: isOutlineFrame ? 'transparent' : frameFillCss,
    border: isOutlineFrame ? `${Math.max(2, effectiveWidth * 0.014)}px solid ${frameFillCss}` : undefined,
    boxSizing: 'border-box',
    ['--frame-bg' as any]: frameFill,
    ...(element.notchColor ? { ['--notch-bg' as any]: element.notchColor } : {}),
    ['--scale-factor' as any]: element.scale || 1,
    overflow: 'visible',
  };

  if (is3DMode) {
    return (
      <div
        className="w-full h-full flex items-center justify-center bg-transparent group"
        style={{ cursor: 'default', position: 'relative' }}
      >
        <Device3DRenderer
          deviceType={element.deviceType}
          side={element.styleType === '3d-left' ? 'left' : 'right'}
          screenshotSrc={screenshot}
          objectFit={element.screenshotObjectFit || 'cover'}
          pose={element.pose3d}
          frameColor={element.frameColor3d}
        />
        {!screenshot && (
          // Overlay text must scale with the element: the artboard is displayed
          // CSS-scaled down, so fixed 12px text becomes unreadable.
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground text-center pointer-events-none">
            <p
              className="bg-background/70 rounded"
              style={{
                fontSize: `${Math.max(14, effectiveWidth * 0.055)}px`,
                padding: `${effectiveWidth * 0.012}px ${effectiveWidth * 0.03}px`,
                borderRadius: `${effectiveWidth * 0.02}px`,
              }}
            >{`Mockup: ${deviceLabel} (3D)`}</p>
            {isSelected && (
              <Button
                data-export-exclude
                variant="outline"
                className="bg-background/80 hover:bg-background pointer-events-auto h-auto"
                style={{
                  zIndex: 10,
                  fontSize: `${Math.max(14, effectiveWidth * 0.065)}px`,
                  padding: `${effectiveWidth * 0.02}px ${effectiveWidth * 0.045}px`,
                  marginTop: `${effectiveWidth * 0.04}px`,
                  borderRadius: `${effectiveWidth * 0.025}px`,
                }}
                onClick={() => triggerFileUpload('screenshot')}
                onMouseDown={(e) => e.stopPropagation()}
              >
                Upload Screenshot
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
  
  // Screen style used for both normal and perspective modes.
  // Absolutely positioned with px insets derived from the effective width so the
  // bezel is uniform on all sides and scales with both size and scale. (The old
  // margin-based layout was broken: CSS % margins resolve against the WIDTH even
  // for top/bottom, while the height calc used the height — so the bottom bezel
  // grew as the element got taller, e.g. the Android bar issue.)
  const bezelPx = (percent: number) => (effectiveWidth * percent) / 100;
  const screenStyle: React.CSSProperties = {
    position: 'absolute',
    top: `${bezelPx(framePaddingPercent.top)}px`,
    right: `${bezelPx(framePaddingPercent.right)}px`,
    bottom: `${bezelPx(framePaddingPercent.bottom)}px`,
    left: `${bezelPx(framePaddingPercent.left)}px`,
    backgroundColor: '#000',
    overflow: 'hidden',
    borderRadius: screenBorderRadius,
    zIndex: 1,
  };
  
  return (
    <div
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ cursor: 'default', position: 'relative' }}
    >
      {/* Apply transform to the outer container */}
      <div
        className={usingSvgPerspectiveMode ? "device-container-perspective" : "device-container"}
        style={containerStyle}
      >
        {/* Use the same DOM structure for both modes */}
        <div style={frameStyle}>
          <div style={screenStyle}> {/* Using the unified screen style */}
            {/* All notches/islands/cutouts are anchored inside the screen so they
                stay glued to its top edge at any size or aspect ratio */}
            {notchElement}
            {screenshot && element.screenshotRect ? (
              <div
                style={{
                  position: 'absolute',
                  top: `${element.screenshotRect.top}%`,
                  left: `${element.screenshotRect.left}%`,
                  width: `${element.screenshotRect.width}%`,
                  height: `${element.screenshotRect.height}%`,
                  overflow: 'hidden',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <img
                  src={screenshot}
                  alt={`${element.deviceType} screenshot`}
                  style={{
                    cursor: 'default',
                    opacity: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: element.screenshotObjectFit || "cover",
                    position: 'absolute',
                    top: 0,
                    left: 0,
                  }}
                  onLoad={e => { (e.currentTarget as HTMLImageElement).style.opacity = '1'; }}
                  data-ai-hint="app interface mobile"
                  draggable={false}
                />
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-center p-2">
                <UploadCloudIcon className="w-1/4 h-1/4 opacity-50 mb-2" data-ai-hint="upload cloud arrow"/>
                {/* Sizes derive from the element width: the artboard is displayed
                    CSS-scaled way down, so fixed text-xs UI becomes unreadable */}
                <p style={{ fontSize: `${Math.max(14, effectiveWidth * 0.055)}px` }}>{`Mockup: ${deviceLabel}`}</p>
                {isSelected && (
                  <Button
                    data-export-exclude
                    variant="outline"
                    className="h-auto bg-background/80 hover:bg-background"
                    style={{
                      zIndex: 10,
                      fontSize: `${Math.max(14, effectiveWidth * 0.065)}px`,
                      padding: `${effectiveWidth * 0.02}px ${effectiveWidth * 0.045}px`,
                      marginTop: `${effectiveWidth * 0.04}px`,
                      borderRadius: `${effectiveWidth * 0.025}px`,
                    }}
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

