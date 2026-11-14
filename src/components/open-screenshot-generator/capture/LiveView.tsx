"use client";

// The device's screen, a few times a second, beside the grid. It is the same
// picture the next screenshot will be (the tidy status bar included), so the
// user sees what goes into the frame before taking it.
//
// Each frame is a small screenshot from the desktop app: a JPEG of about
// 0.6 MB in about 0.25 s from the iOS Simulator, a PNG in about 1.5 s from an
// Android emulator (measured on the Mac this was built on). The next one is
// asked for once the last one has arrived, so a slow device slows the view
// down instead of queueing work. Nothing is asked for while the view is
// hidden or while a run samples the screen itself (`frame`).

import React, { useEffect, useRef, useState } from 'react';
import { CameraIcon, SmartphoneIcon } from 'lucide-react';
import { takeScreenshot } from '@/lib/capture/desktop';
import type { CaptureDevice } from '@/lib/capture/types';
import { cn } from '@/lib/utils';

interface LiveViewProps {
  /** A running device, or null. */
  device: CaptureDevice | null;
  /** Ask the device for frames. Off while the view is hidden. */
  polling: boolean;
  /** A frame from elsewhere, shown in place of polling. */
  frame?: Blob | null;
  /** Shape to hold while there is no picture yet, width over height. */
  aspect: number;
  /** Why there is nothing to show, when there is no device. */
  emptyText: string;
  onTake?: () => void;
  takeReason?: string | null;
}

export function LiveView({ device, polling, frame, aspect, emptyText, onTake, takeReason }: LiveViewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const urlRef = useRef<string | null>(null);

  const show = (blob: Blob) => {
    const next = URL.createObjectURL(blob);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next;
    setUrl(next);
  };

  useEffect(() => {
    if (frame) show(frame);
  }, [frame]);

  // By platform and id, not the object: the device list is read again every
  // few seconds, and a new object for the same device must not restart this.
  const platform = device?.platform;
  const id = device?.id;
  useEffect(() => {
    if (!platform || !id || !polling || frame) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let wait = 350;
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          const blob = await takeScreenshot(platform, id, true);
          if (!stopped) show(blob);
        }
      } catch {
        // A device that went away or is busy: try again a little later.
        wait = 2000;
      }
      if (!stopped) timer = setTimeout(tick, wait);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [platform, id, polling, frame]);

  // A new device starts from nothing rather than the last one's screen.
  useEffect(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setUrl(null);
    setSize(null);
  }, [platform, id]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const shape = size ? size.width / size.height : aspect;
  const canTake = !!onTake && !takeReason && !!url;

  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={canTake ? onTake : undefined}
        disabled={!canTake}
        title={canTake ? 'Click to take a screenshot' : (takeReason ?? undefined)}
        aria-label={device ? `Screen of ${device.name}` : 'Device screen'}
        data-testid="capture-live-view"
        className={cn(
          'group relative max-h-[44vh] w-full max-w-[240px] overflow-hidden rounded-[22px] border-[6px] border-foreground/85 bg-muted shadow-sm',
          canTake && 'cursor-pointer',
          !canTake && 'cursor-default'
        )}
        style={{ aspectRatio: shape }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) setSize({ width: naturalWidth, height: naturalHeight });
            }}
          />
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
            <SmartphoneIcon className="h-6 w-6" />
            {emptyText}
          </span>
        )}
        {canTake && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/0 opacity-0 transition-opacity group-hover:bg-foreground/20 group-hover:opacity-100">
            <span className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow">
              <CameraIcon className="h-3.5 w-3.5" />
              Take screenshot
            </span>
          </span>
        )}
      </button>
    </div>
  );
}
