"use client";
import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ClapperboardIcon } from 'lucide-react';
import type { VideoElementProps } from '@/types/artboard';
import { saveMedia, useMediaUrl } from '@/lib/mediaStore';
import { useToast } from '@/hooks/use-toast';
import { withBasePath } from '@/lib/basePath';

interface VideoElementComponentProps {
  element: VideoElementProps;
  onUpdate: (updates: Partial<VideoElementProps>) => void;
  isSelected: boolean;
}

// Accepted recording containers. MOV is what iPhones produce; the browser
// plays it as long as the codec is H.264/HEVC-in-MP4-compatible.
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';

export function VideoElement({ element, onUpdate, isSelected }: VideoElementComponentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const mediaUrl = useMediaUrl(element.mediaId);
  // Media-table blob wins; template/demo assets fall back to a URL source.
  const src = element.mediaId
    ? mediaUrl ?? undefined
    : element.videoSrc
      ? withBasePath(element.videoSrc)
      : undefined;

  const handleVideoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setIsLoading(true);
    try {
      const { id, probe } = await saveMedia(file, file.name);
      onUpdate({
        mediaId: id,
        videoSrc: undefined,
        naturalVideoWidth: probe.width,
        naturalVideoHeight: probe.height,
        durationSeconds: probe.duration,
        trimStart: undefined,
        trimEnd: undefined,
      });
    } catch (error) {
      toast({
        title: 'Could not load video',
        description: error instanceof Error ? error.message : 'The file could not be read.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const triggerFileUpload = () => fileInputRef.current?.click();

  return (
    <div className="w-full h-full relative flex items-center justify-center">
      {src ? (
        <div className="w-full h-full relative">
          <video
            data-video-layer={element.id}
            src={src}
            muted
            loop
            autoPlay
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: element.objectFit || 'cover',
              opacity: element.opacity ?? 1,
              borderRadius: element.borderRadius ? `${element.borderRadius}px` : undefined,
              display: 'block',
            }}
            draggable={false}
          />
          {isSelected && (
            <div className="touch-show absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity" data-export-exclude>
              <Button
                variant="secondary"
                size="sm"
                onClick={triggerFileUpload}
                onMouseDown={(e) => e.stopPropagation()}
                className="text-xs bg-background/90 hover:bg-background"
              >
                <UploadCloudIcon className="w-3 h-3 mr-1" />
                Change Recording
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground border border-dashed border-muted-foreground/20 rounded-lg">
          <ClapperboardIcon className="w-1/4 h-1/4 opacity-25 mb-2" />
          <p className="text-xs text-center px-2 opacity-50">
            {element.mediaId ? 'Recording not found in this browser' : 'No recording yet'}
          </p>
          {isSelected && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-xs bg-background/80 hover:bg-background"
              onClick={triggerFileUpload}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <UploadCloudIcon className="w-3 h-3 mr-1" />
              Upload Recording
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
        accept={VIDEO_ACCEPT}
        onChange={handleVideoUpload}
      />
    </div>
  );
}
