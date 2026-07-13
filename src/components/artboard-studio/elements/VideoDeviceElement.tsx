"use client";
import type React from 'react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UploadCloudIcon, ClapperboardIcon } from 'lucide-react';
import type { VideoDeviceElementProps as VideoDeviceElementType } from '@/types/artboard';
import { saveMedia, useMediaUrl } from '@/lib/mediaStore';
import { useToast } from '@/hooks/use-toast';
import { withBasePath } from '@/lib/basePath';
import { getFlatDeviceChrome, getFlatFrameStyles } from './deviceChrome';
import { VIDEO_ACCEPT } from './VideoElement';

interface VideoDeviceElementComponentProps {
  element: VideoDeviceElementType;
  onUpdate: (updates: Partial<VideoDeviceElementType>) => void;
  isSelected: boolean;
}

/**
 * Device mockup whose screen plays a screen recording (App Preview videos).
 * The frame itself is the SAME chrome the screenshot mockup draws
 * (elements/deviceChrome.tsx), so bezels, notches and Dynamic Islands can
 * never drift apart between the two element types. What differs is the screen
 * content and the properties: a recording, a trim, a fit — no screenshot rect,
 * no 3D pose.
 */
export function VideoDeviceElement({ element, onUpdate, isSelected }: VideoDeviceElementComponentProps) {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const mediaUrl = useMediaUrl(element.mediaId);

  const effectiveWidth = element.size.width * (element.scale || 1);
  const chrome = getFlatDeviceChrome(element.deviceType, effectiveWidth);
  const { frame, screen } = getFlatFrameStyles(chrome, effectiveWidth, {
    frameColor: element.frameColor,
    frameOpacity: element.frameOpacity,
    frameStyle: element.frameStyle,
    notchColor: element.notchColor,
    scale: element.scale,
  });
  const isTranslucent = (element.frameOpacity ?? 1) < 1 || element.frameStyle === 'outline';

  const handleRecordingUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (videoInputRef.current) videoInputRef.current.value = '';
    if (!file) return;
    setIsLoading(true);
    try {
      const { id, probe } = await saveMedia(file, file.name);
      onUpdate({
        mediaId: id,
        naturalVideoWidth: probe.width,
        naturalVideoHeight: probe.height,
        durationSeconds: probe.duration,
        trimStart: undefined,
        trimEnd: undefined,
      });
    } catch (error) {
      toast({
        title: 'Could not load recording',
        description: error instanceof Error ? error.message : 'The file could not be read.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fit = element.objectFit || 'cover';

  return (
    <div
      className="w-full h-full flex items-center justify-center bg-transparent group"
      style={{ cursor: 'default', position: 'relative' }}
    >
      <div
        className="device-container"
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          // The global .device-container drop-shadow reads as a dirty halo
          // behind see-through or hollow frames.
          filter: isTranslucent ? 'none' : undefined,
        }}
      >
        <div style={frame} data-device-frame={element.id}>
          <div style={screen} data-device-screen={element.id}>
            {/* Cutout sits above the screen content, exactly as on a real phone */}
            {chrome.notch}

            {element.mediaId && mediaUrl ? (
              <video
                data-screen-video={element.id}
                src={mediaUrl}
                muted
                loop
                autoPlay
                playsInline
                style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }}
                draggable={false}
              />
            ) : element.posterSrc ? (
              // Template placeholder until the user drops their recording in.
              <img
                src={withBasePath(element.posterSrc)}
                alt="Placeholder app screen"
                style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }}
                draggable={false}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground text-center p-2">
                <ClapperboardIcon className="w-1/4 h-1/4 opacity-50 mb-2" />
                <p style={{ fontSize: `${Math.max(14, effectiveWidth * 0.055)}px` }}>
                  {`${chrome.label} — no recording yet`}
                </p>
              </div>
            )}

            {/* Drop-your-recording affordance, shown over the poster too */}
            {isSelected && !element.mediaId && (
              <div
                data-export-exclude
                className="absolute inset-0 flex items-center justify-center"
                style={{ zIndex: 5, backgroundColor: element.posterSrc ? 'rgba(0,0,0,0.35)' : 'transparent' }}
              >
                <Button
                  variant="outline"
                  className="h-auto bg-background/90 hover:bg-background"
                  style={{
                    fontSize: `${Math.max(14, effectiveWidth * 0.065)}px`,
                    padding: `${effectiveWidth * 0.02}px ${effectiveWidth * 0.045}px`,
                    borderRadius: `${effectiveWidth * 0.025}px`,
                  }}
                  onClick={() => videoInputRef.current?.click()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <UploadCloudIcon className="mr-1.5" style={{ width: '1em', height: '1em' }} />
                  Upload Recording
                </Button>
              </div>
            )}
            {isSelected && element.mediaId && (
              <div
                data-export-exclude
                className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 hover:opacity-100 transition-opacity"
                style={{ zIndex: 5 }}
              >
                <Button
                  variant="secondary"
                  className="h-auto bg-background/90 hover:bg-background"
                  style={{
                    fontSize: `${Math.max(14, effectiveWidth * 0.06)}px`,
                    padding: `${effectiveWidth * 0.018}px ${effectiveWidth * 0.04}px`,
                    borderRadius: `${effectiveWidth * 0.025}px`,
                  }}
                  onClick={() => videoInputRef.current?.click()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  Change Recording
                </Button>
              </div>
            )}

            {isLoading && (
              <div
                data-export-exclude
                className="absolute inset-0 flex items-center justify-center bg-background/50"
                style={{ zIndex: 6 }}
              >
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            )}
          </div>
        </div>
      </div>

      <Input
        type="file"
        ref={videoInputRef}
        className="hidden"
        accept={VIDEO_ACCEPT}
        onChange={handleRecordingUpload}
      />
    </div>
  );
}
