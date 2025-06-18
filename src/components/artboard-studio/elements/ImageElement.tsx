"use client";
import type React from 'react';
import { useState, useRef } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ImageIcon } from 'lucide-react';
import type { ImageElementProps } from '@/types/artboard';
import { cn } from '@/lib/utils';

interface ImageElementComponentProps {
  element: ImageElementProps;
  onUpdate: (updatedElement: Partial<ImageElementProps>) => void;
  isSelected: boolean;
}

export function ImageElement({ element, onUpdate, isSelected }: ImageElementComponentProps) {
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="w-full h-full relative bg-muted/10 flex items-center justify-center overflow-hidden">
      {element.imageSrc ? (
        <div className="w-full h-full relative">
          <Image
            src={element.imageSrc}
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
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity">
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
        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-muted-foreground/30 rounded-lg">
          <ImageIcon className="w-1/4 h-1/4 opacity-50 mb-2" />
          <p className="text-xs text-center px-2">No image selected</p>
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
