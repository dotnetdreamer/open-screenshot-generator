"use client";

import React, { useCallback, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AGENT_LIMITS } from '@/lib/ai/agentPlanSchema';
import { readScreenshotFile, type UploadedScreenshot } from '@/lib/ai/imageUtils';

interface ScreenshotUploaderProps {
  screenshots: UploadedScreenshot[];
  onChange: (screenshots: UploadedScreenshot[]) => void;
  disabled?: boolean;
}

/**
 * Multi-file screenshot intake. The numbered badge on each thumbnail is the
 * `screenshotIndex` the agent plan refers to, and it is also the order the user
 * must attach files in when they run the manual relay steps.
 */
export function ScreenshotUploader({ screenshots, onChange, disabled }: ScreenshotUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
      if (images.length === 0) return;

      const room = AGENT_LIMITS.maxScreenshots - screenshots.length;
      if (room <= 0) {
        setError(`You can add at most ${AGENT_LIMITS.maxScreenshots} screenshots.`);
        return;
      }

      setError(null);
      setIsReading(true);
      try {
        const accepted = images.slice(0, room);
        const read = await Promise.all(accepted.map(readScreenshotFile));
        onChange([...screenshots, ...read]);
        if (images.length > accepted.length) {
          setError(`Only the first ${accepted.length} images were added (limit ${AGENT_LIMITS.maxScreenshots}).`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Those images could not be read.');
      } finally {
        setIsReading(false);
      }
    },
    [onChange, screenshots]
  );

  const remove = (id: string) => onChange(screenshots.filter((shot) => shot.id !== id));

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setIsDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
          disabled && 'opacity-60'
        )}
      >
        {isReading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <ImagePlus className="h-6 w-6 text-muted-foreground" />
        )}
        <p className="text-sm text-muted-foreground">
          Drop your app screenshots here, or
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || isReading}
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </Button>
        <p className="text-xs text-muted-foreground">
          PNG or JPG, up to {AGENT_LIMITS.maxScreenshots}. Order matters: the agent refers to them by
          number.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {screenshots.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {screenshots.map((shot, index) => (
            <li key={shot.id} className="group relative w-16">
              <div className="relative h-28 w-16 overflow-hidden rounded-md border bg-muted">
                {/* Plain img: these are in-memory data URLs, not routed assets. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.aiDataUrl}
                  alt={shot.fileName}
                  className="h-full w-full object-cover"
                />
                <span className="absolute left-1 top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-black/70 px-1 text-[11px] font-semibold tabular-nums text-white">
                  {index}
                </span>
              </div>
              <button
                type="button"
                onClick={() => remove(shot.id)}
                disabled={disabled}
                title={`Remove ${shot.fileName}`}
                className="touch-show absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
