
"use client";
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, MoveIcon } from 'lucide-react'; // Added MoveIcon for panning hint
import type { DeviceFrameElementProps as DeviceFrameElementType } from '@/types/artboard';
import { cn } from '@/lib/utils';

interface DeviceFrameElementProps {
  element: DeviceFrameElementType;
  onUpdate: (updatedElement: Partial<DeviceFrameElementType>) => void;
  isSelected: boolean;
}

export function DeviceFrameElement({ element, onUpdate, isSelected }: DeviceFrameElementProps) {
  const [screenshot, setScreenshot] = useState<string | undefined>(element.screenshotSrc);
  const [objectPosition, setObjectPosition] = useState<string>(element.screenshotObjectPosition || '50% 50%');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLDivElement>(null); // Ref for the image container to attach drag listeners

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number, y: number, initialObjectX: number, initialObjectY: number } | null>(null);

  useEffect(() => {
    setScreenshot(element.screenshotSrc);
    // Reset object position if screenshot changes or is removed
    if (element.screenshotSrc && element.screenshotSrc !== screenshot) {
        const newPos = element.screenshotObjectPosition || '50% 50%';
        setObjectPosition(newPos);
    } else if (!element.screenshotSrc) {
        setObjectPosition('50% 50%');
    }
  }, [element.screenshotSrc, element.screenshotObjectPosition, screenshot]);


  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newScreenshotSrc = reader.result as string;
        setScreenshot(newScreenshotSrc);
        const defaultPosition = '50% 50%';
        setObjectPosition(defaultPosition); // Reset position for new image
        onUpdate({ screenshotSrc: newScreenshotSrc, screenshotObjectPosition: defaultPosition });
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const parseObjectPosition = (posStr: string): { x: number, y: number } => {
    const parts = posStr.split(' ');
    return {
      x: parseFloat(parts[0]) || 50,
      y: parseFloat(parts[1]) || 50,
    };
  };

  const handlePanStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSelected || !screenshot) return;
    e.preventDefault();
    e.stopPropagation(); // Prevent main element drag
    
    const currentPos = parseObjectPosition(objectPosition);
    setIsPanning(true);
    setPanStart({
      x: e.clientX,
      y: e.clientY,
      initialObjectX: currentPos.x,
      initialObjectY: currentPos.y,
    });
    document.body.style.cursor = 'grabbing';
  };

  const handlePanMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !panStart) return;
    e.preventDefault();
    e.stopPropagation();

    const deltaX = e.clientX - panStart.x;
    const deltaY = e.clientY - panStart.y;

    // Sensitivity: how many pixels of mouse move for 1% change in object-position
    // This needs to be adjusted based on the image container's display size for intuitive feel
    // For simplicity, using a fixed sensitivity.
    // A more robust solution would scale sensitivity with element.scale and artboardZoom.
    const sensitivityFactor = imageRef.current ?  Math.min(imageRef.current.clientWidth, imageRef.current.clientHeight) / 100 : 5;


    let newObjectX = panStart.initialObjectX - (deltaX / sensitivityFactor);
    let newObjectY = panStart.initialObjectY - (deltaY / sensitivityFactor);

    newObjectX = Math.max(0, Math.min(100, newObjectX));
    newObjectY = Math.max(0, Math.min(100, newObjectY));

    setObjectPosition(`${newObjectX.toFixed(1)}% ${newObjectY.toFixed(1)}%`);
  };

  const handlePanEnd = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    e.preventDefault();
    e.stopPropagation();
    
    setIsPanning(false);
    setPanStart(null);
    onUpdate({ screenshotObjectPosition: objectPosition });
    document.body.style.cursor = 'default';
  };
  
  // Listener for mouse move and up on the document to handle dragging outside the element
  useEffect(() => {
    const moveHandler = (e: MouseEvent) => {
      if (isPanning && panStart) {
         // Simulate React event for handlePanMove
        handlePanMove(e as any as React.MouseEvent<HTMLDivElement>);
      }
    };
    const upHandler = (e: MouseEvent) => {
      if (isPanning) {
        // Simulate React event for handlePanEnd
        handlePanEnd(e as any as React.MouseEvent<HTMLDivElement>);
      }
    };

    if (isPanning) {
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
    }
    return () => {
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
      if (document.body.style.cursor === 'grabbing') {
        document.body.style.cursor = 'default';
      }
    };
  }, [isPanning, panStart, objectPosition]);


  let aspectRatio = 9 / 16; 
  let framePadding = 'p-2'; 
  let deviceFrameStyle: React.CSSProperties = {
    backgroundColor: '#111', 
    borderRadius: '1rem', 
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative', // For positioning elements inside like buttons
  };
  let screenStyle: React.CSSProperties = { // Style for the inner "screen" area
    width: '100%',
    height: '100%',
    backgroundColor: '#000', // Screen off color
    overflow: 'hidden', // Crucial for containing the image
    position: 'relative', // For next/image with layout="fill"
  };
  
  let deviceLabel = "Device";

  switch (element.deviceType) {
    case 'iphone':
      aspectRatio = 390 / 844; 
      framePadding = 'p-[3.5%]'; // Adjusted padding for better screen-to-frame ratio
      screenStyle.borderRadius = '0.8rem'; // Slightly less than frame for inset look
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

  const outerWidth = element.size.width; // No element.scale here as it's applied by DraggableElement
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
        cursor: isSelected && screenshot && !isPanning ? 'grab' : (isPanning ? 'grabbing': 'default'),
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
        <div ref={imageRef} style={screenStyle} 
             onMouseDown={handlePanStart} 
             // onMouseMove={handlePanMove} // Handled by document listener now
             // onMouseUp={handlePanEnd}     // Handled by document listener now
             // onMouseLeave={handlePanEnd} // Optional: end pan if mouse leaves element
        >
          {screenshot ? (
            <Image
              src={screenshot}
              alt={`${element.deviceType} screenshot`}
              layout="fill"
              objectFit="cover" 
              style={{ objectPosition: objectPosition, cursor: isSelected ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
              className="transition-opacity duration-300 ease-in-out" // Smooth fade-in
              onLoadingComplete={(img) => img.style.opacity = '1'}
              data-ai-hint="app interface mobile"
              draggable={false} // Prevent native image dragging
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
                // Prevent pan start when clicking button
                onMouseDown={(e) => e.stopPropagation()} 
              >
                Upload Screenshot
              </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {isSelected && !screenshot && ( 
         <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs py-1 px-2 h-auto opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={triggerFileUpload}
            style={{ transform: `translateX(-50%) scale(${1 / element.scale})` }}
             // Prevent pan start when clicking button
            onMouseDown={(e) => e.stopPropagation()}
          >
            <UploadCloudIcon className="w-3 h-3 mr-1" /> Upload
          </Button>
      )}
      {isSelected && screenshot && ( // Hint for panning
        <div 
          className="absolute top-1 right-1 p-0.5 bg-background/70 border border-primary/50 rounded-full shadow-lg text-primary opacity-50 group-hover:opacity-100 transition-opacity text-xs flex items-center"
          style={{ transform: `scale(${1 / element.scale})`, transformOrigin: 'top right' }}
          title="Pan Screenshot"
        >
          <MoveIcon className="w-2 h-2" />
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

