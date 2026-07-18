"use client";
import React from 'react';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ImageIcon } from 'lucide-react';
import type { ImageElementProps } from '@/types/artboard';
import { cn } from '@/lib/utils';
import { withBasePath } from '@/lib/basePath';

interface ImageElementComponentProps {
  element: ImageElementProps;
  onUpdate: (updatedElement: Partial<ImageElementProps>) => void;
  isSelected: boolean;
}

export function ImageElement({ element, onUpdate, isSelected }: ImageElementComponentProps) {
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debug: Log the element properties
  useEffect(() => {
    console.log('ImageElement props changed:', {
      id: element.id,
      skewX: element.skewX,
      skewY: element.skewY,
      perspectiveX: element.perspectiveX,
      perspectiveY: element.perspectiveY,
      matrix3d: element.matrix3d
    });
  }, [element.id, element.skewX, element.skewY, element.perspectiveX, element.perspectiveY, element.matrix3d]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsLoading(true);
      const reader = new FileReader();
      reader.onloadend = () => {
        const imageDataUrl = reader.result as string;
        onUpdate({
          imageSrc: imageDataUrl,
          imageAlt: file.name,
        });
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  // Generate CSS transform based on element properties
  const generateTransformStyle = (): React.CSSProperties => {
    const transforms: string[] = [];
    
    // Apply skew transforms
    if (element.skewX && element.skewX !== 0) {
      transforms.push(`skewX(${element.skewX}deg)`);
    }
    if (element.skewY && element.skewY !== 0) {
      transforms.push(`skewY(${element.skewY}deg)`);
    }
    
    // Apply perspective tilts
    if (element.perspectiveX && element.perspectiveX !== 0) {
      transforms.push(`rotateX(${element.perspectiveX}deg)`);
    }
    if (element.perspectiveY && element.perspectiveY !== 0) {
      transforms.push(`rotateY(${element.perspectiveY}deg)`);
    }
    
    // If custom matrix3d is provided, use it instead of individual transforms
    if (element.matrix3d && element.matrix3d.trim()) {
      return {
        transform: element.matrix3d,
        transformOrigin: 'center center',
        transformStyle: 'preserve-3d' as const
      };
    }
    
    if (transforms.length > 0) {
      const transformString = transforms.join(' ');
      console.log('ImageElement transform:', transformString, 'Element:', element.id);
      return {
        transform: transformString,
        transformOrigin: 'center center',
        transformStyle: 'preserve-3d' as const
      };
    }
    
    return {};
  };

  const transformStyle = generateTransformStyle();

  return (
    <div
      className="w-full h-full relative flex items-center justify-center"
      style={{
        perspective: '1000px' // Add perspective for 3D transforms
      }}
    >
      {element.imageSrc ? (
        <div 
          className="w-full h-full relative"
          style={transformStyle}
        >
          <Image
            src={withBasePath(element.imageSrc)}
            alt={element.imageAlt || 'Uploaded image'}
            fill
            style={{
              objectFit: element.objectFit || 'cover',
              opacity: element.opacity || 1,
              borderRadius: element.borderRadius ? `${element.borderRadius}px` : '0px'
            }}
            className="transition-opacity duration-200"
            onLoadingComplete={() => setIsLoading(false)}
            draggable={false}
          />
          {isSelected && (
            <div className="touch-show absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity">
              <Button
                variant="secondary"
                size="sm"
                onClick={triggerFileUpload}
                onMouseDown={(e) => e.stopPropagation()}
                className="text-xs bg-background/90 hover:bg-background"
              >
                <UploadCloudIcon className="w-3 h-3 mr-1" />
                Change Image
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground border border-dashed border-muted-foreground/20 rounded-lg">
          <ImageIcon className="w-1/4 h-1/4 opacity-25 mb-2" />
          <p className="text-xs text-center px-2 opacity-50">No image selected</p>
          {isSelected && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-xs bg-background/80 hover:bg-background"
              onClick={triggerFileUpload}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <UploadCloudIcon className="w-3 h-3 mr-1" />
              Upload Image
            </Button>
          )}
        </div>
      )}
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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
