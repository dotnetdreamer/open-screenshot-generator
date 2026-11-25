"use client";

// Exporting a film to an MP4 file. On the desktop app the file's place is
// asked first and the video is made after, so a cancel makes nothing. On a
// phone the finished video can go straight to the share sheet (save it to
// Photos, or post it).

import React, { useEffect, useRef, useState } from 'react';
import { DownloadIcon, Loader2Icon, Share2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { isTauri, saveBlobToDisk } from '@/lib/desktop';
import { exportBlocker, exportFilm, FILM_SIZES, filmFileName } from '@/lib/director/exportFilm';
import { filmDuration } from '@/lib/director/frame';
import type { Film } from '@/lib/director/types';
import { cn } from '@/lib/utils';

type Phase = { kind: 'ready' } | { kind: 'working'; done: number; total: number } | { kind: 'done'; blob: Blob | null; path?: string | null } | { kind: 'failed'; message: string };

/**
 * True on a phone or tablet that can hand the video to its share sheet. A
 * computer's browser may share files too, but people there expect a download.
 */
function canShareVideo(blob: Blob, name: string): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false;
  if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return false;
  try {
    return navigator.canShare({ files: [new File([blob], name, { type: 'video/mp4' })] });
  } catch {
    return false;
  }
}

export function ExportDialog({ film, open, onOpenChange, onExporting }: { film: Film; open: boolean; onOpenChange: (open: boolean) => void; onExporting?: (busy: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const [fps, setFps] = useState<30 | 60>(film.fps);
  const abortRef = useRef<AbortController | null>(null);
  const blocker = film.clips.length ? exportBlocker() : 'Add a recording first. The video is made from it.';
  const size = FILM_SIZES[film.format];
  const seconds = Math.round(filmDuration(film) * 10) / 10;
  const name = filmFileName(film);

  useEffect(() => {
    if (open) setPhase({ kind: 'ready' });
  }, [open]);

  const make = async (signal: AbortSignal) =>
    exportFilm({ ...film, fps }, { fps, signal, onProgress: (done, total) => setPhase({ kind: 'working', done, total }) });

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    onExporting?.(true);
    try {
      if (isTauri()) {
        // Where first, then the video: a cancel makes nothing.
        let made = false;
        const path = await saveBlobToDisk(async () => {
          made = true;
          setPhase({ kind: 'working', done: 0, total: 1 });
          return make(controller.signal);
        }, name);
        if (path === null && !made) {
          setPhase({ kind: 'ready' });
          return;
        }
        setPhase({ kind: 'done', blob: null, path });
        return;
      }
      setPhase({ kind: 'working', done: 0, total: 1 });
      const blob = await make(controller.signal);
      // On a computer the browser saves it right away; on a phone the person picks where it goes.
      if (!canShareVideo(blob, name)) await saveBlobToDisk(blob, name);
      setPhase({ kind: 'done', blob });
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        setPhase({ kind: 'ready' });
        return;
      }
      console.error('Director could not export the video', error);
      setPhase({ kind: 'failed', message: error instanceof Error ? error.message : 'Try again, or pick a shorter part of the recording.' });
    } finally {
      abortRef.current = null;
      onExporting?.(false);
    }
  };

  const share = async (blob: Blob) => {
    try {
      await navigator.share({ files: [new File([blob], name, { type: 'video/mp4' })], title: film.name });
    } catch {
      // Closing the share sheet is not an error.
    }
  };

  const working = phase.kind === 'working';
  const percent = working ? Math.round((phase.done / Math.max(1, phase.total)) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && working) abortRef.current?.abort();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="director-export-dialog">
        <DialogHeader>
          <DialogTitle>Export video</DialogTitle>
          <DialogDescription>
            An MP4 file, {size.width} by {size.height}, {seconds} seconds long.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === 'ready' && (
          <div className="space-y-3">
            <div className="flex gap-2" role="radiogroup" aria-label="Smoothness">
              {([30, 60] as const).map((rate) => (
                <button
                  key={rate}
                  type="button"
                  role="radio"
                  aria-checked={fps === rate}
                  onClick={() => setFps(rate)}
                  className={cn('flex-1 rounded-lg border px-3 py-2 text-left transition-colors', fps === rate ? 'border-primary bg-primary/10' : 'hover:bg-muted')}
                >
                  <span className="block text-xs font-semibold">{rate} frames a second</span>
                  <span className="block text-[11px] text-muted-foreground">{rate === 30 ? 'Smaller file, quicker to make' : 'Smoother moves, takes twice as long'}</span>
                </button>
              ))}
            </div>
            {blocker && <p className="text-xs text-amber-600 dark:text-amber-400">{blocker}</p>}
          </div>
        )}

        {working && (
          <div className="space-y-2" data-testid="director-export-progress">
            <Progress value={percent} className="h-2" />
            <p className="text-xs text-muted-foreground">
              Making the video, {percent}% done. You can keep working in other views.
            </p>
          </div>
        )}

        {phase.kind === 'done' && (
          <div className="space-y-2 text-sm" data-testid="director-export-done">
            <p className="font-medium">Your video is ready</p>
            {phase.path && <p className="break-all text-xs text-muted-foreground">Saved to {phase.path}</p>}
            {phase.blob && canShareVideo(phase.blob, name) && <p className="text-xs text-muted-foreground">Save it to Photos or send it straight to an app.</p>}
          </div>
        )}

        {phase.kind === 'failed' && (
          <p className="text-sm text-destructive" role="alert">
            {phase.message}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {phase.kind === 'ready' && (
            <Button type="button" onClick={() => void start()} disabled={!!blocker} className="gap-1.5" data-testid="director-export-start">
              <DownloadIcon className="h-4 w-4" />
              Export video
            </Button>
          )}
          {working && (
            <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()} className="gap-1.5">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Stop
            </Button>
          )}
          {phase.kind === 'done' && phase.blob && canShareVideo(phase.blob, name) && (
            <Button type="button" onClick={() => void share(phase.blob!)} className="gap-1.5">
              <Share2Icon className="h-4 w-4" />
              Share or save
            </Button>
          )}
          {phase.kind === 'done' && phase.blob && (
            <Button type="button" variant="outline" onClick={() => void saveBlobToDisk(phase.blob!, name)} className="gap-1.5">
              <DownloadIcon className="h-4 w-4" />
              {canShareVideo(phase.blob, name) ? 'Download' : 'Download again'}
            </Button>
          )}
          {(phase.kind === 'done' || phase.kind === 'failed') && (
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
