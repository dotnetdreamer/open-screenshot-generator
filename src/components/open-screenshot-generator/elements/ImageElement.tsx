"use client";
import React from 'react';
import { useState, useRef } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ImageIcon } from 'lucide-react';
import type { ImageElementProps } from '@/types/artboard';
import { cn } from '@/lib/utils';
import { withBasePath } from '@/lib/basePath';
import { useImageSrc } from '@/lib/mediaStore';
import { saveImageBlobAsset } from '@/lib/mcp/assetStore';
import { imageTint, imageTintFilter } from '@/lib/elementStyle';
import { ImageTintFilter } from './ImageTintFilter';

interface ImageElementComponentProps {
  element: ImageElementProps;
  onUpdate: (updatedElement: Partial<ImageElementProps>) => void;
  isSelected: boolean;
}

export function ImageElement({ element, onUpdate, isSelected }: ImageElementComponentProps) {
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Uploads land in the Dexie media table and the element keeps only an
  // asset:<id> reference — inlining the file as a data URL made every undo
  // snapshot and autosave duplicate it (issue #19).
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (!file) return;
    setIsLoading(true);
    try {
      const asset = await saveImageBlobAsset(file, { name: file.name });
      onUpdate({
        imageSrc: asset.ref,
        imageAlt: file.name,
      });
    } catch (error) {
      console.error('Could not store the uploaded image.', error);
    } finally {
      setIsLoading(false);
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
      return {
        transform: transformString,
        transformOrigin: 'center center',
        transformStyle: 'preserve-3d' as const
      };
    }
    
    return {};
  };

  const transformStyle = generateTransformStyle();

  // asset:<id> references resolve to a cached object URL; plain URLs pass
  // through. undefined while a reference is still loading from Dexie.
  const resolvedSrc = useImageSrc(element.imageSrc);

  // A colour over the painted pixels only, so a contained picture's empty bars
  // and a cut-out PNG's transparent ground are left alone. A layer is small
  // enough for a filter to be the right tool here; the BOARD background, which
  // can be several megapixels, uses a plain scrim instead.
  const tint = imageTint(element.tintColor, element.tintOpacity, element.id);

  return (
    <div
      className="w-full h-full relative flex items-center justify-center"
      style={{
        perspective: '1000px' // Add perspective for 3D transforms
      }}
    >
      {resolvedSrc ? (
        <div
          className="w-full h-full relative"
          style={transformStyle}
        >
          {tint && <ImageTintFilter tint={tint} />}
          <Image
            src={withBasePath(resolvedSrc)}
            alt={element.imageAlt || 'Uploaded image'}
            fill
            style={{
              objectFit: element.objectFit || 'cover',
              // opacity is NOT applied here: it lives on BaseElement now and is
              // applied once around the whole element (src/lib/elementStyle.ts).
              // Setting it in both places multiplied it — 0.5 rendered as 0.25.
              borderRadius: element.borderRadius ? `${element.borderRadius}px` : '0px',
              filter: imageTintFilter(tint)
            }}
            className="transition-opacity duration-200"
            onLoadingComplete={() => setIsLoading(false)}
            draggable={false}
          />
          {/* data-touch-reveal: there is no hover on a touch screen, so this
              overlay shows outright once the element is selected (globals.css). */}
          {isSelected && (
            <div
              data-touch-reveal
              className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity"
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={triggerFileUpload}
                onPointerDown={(e) => e.stopPropagation()}
                className="text-xs bg-background/90 hover:bg-background"
              >
                <UploadCloudIcon className="w-3 h-3 mr-1" />
                Change Image
              </Button>
            </div>
          )}
        </div>
      ) : element.imageSrc ? (
        // A reference still resolving from Dexie: hold the space, no dashed
        // "empty" state flashing before the image appears.
        <div className="w-full h-full" />
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
              onPointerDown={(e) => e.stopPropagation()}
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
