"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2Icon } from 'lucide-react';

// PNG export runs board by board, and a full App Store run is a dozen-plus
// captures at 1290×2796 — long enough that a closed dialog and a single
// "this might take a moment" toast left the user staring at nothing. This is
// the live readout for that work.

export interface PngExportProgress {
  // 1-based position of the file being worked on, counted across every pass
  // (the as-is capture plus each generated App Store format).
  fileIndex: number;
  fileCount: number;
  boardName: string;
  // Set only while a generated App Store format is being captured, so the
  // user can tell why more files are appearing than they have artboards.
  formatLabel?: string;
  // Set only while a multi-language run is in flight, for the same reason: a
  // 36-file export otherwise reads as "Image 22 of 36" with no way to tell
  // which language is on screen. A single-language export leaves it unset and
  // reads exactly as it always did.
  localeLabel?: string;
  // 'preparing' covers the canvas swap and settle before a format's first
  // capture, where there is no single board to name yet.
  phase: 'preparing' | 'rendering' | 'saving';
}

interface ExportProgressDialogProps {
  progress: PngExportProgress | null;
  onCancel: () => void;
  isCancelling: boolean;
}

export function ExportProgressDialog({
  progress,
  onCancel,
  isCancelling,
}: ExportProgressDialogProps) {
  // Each file spans two steps (render, then save) and both count as partly
  // done while they run, so the bar keeps moving even on a one-file export
  // rather than sitting at 0 until the whole thing is over. Monotonic: file N
  // rendering always reads lower than file N saving, which reads lower than
  // file N+1 rendering.
  const steps = Math.max(1, (progress?.fileCount ?? 1) * 2);
  const done = progress
    ? (progress.fileIndex - 1) * 2 +
      (progress.phase === 'saving' ? 1.5 : progress.phase === 'rendering' ? 0.5 : 0)
    : 0;
  const value = Math.min(100, Math.round((done / steps) * 100));

  const statusLine = !progress
    ? ''
    : progress.phase === 'preparing'
      ? `Preparing the ${progress.formatLabel ?? 'canvas'} layout`
      : progress.phase === 'saving'
        ? `Saving "${progress.boardName}"`
        : `Rendering "${progress.boardName}"`;

  return (
    <Dialog
      open={progress !== null}
      // Controlled by the export itself: the X asks the run to stop and the
      // dialog stays up until it actually has, so the work is never left
      // running behind a closed dialog.
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-[420px]"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            Exporting Screenshots
          </DialogTitle>
          <DialogDescription>
            {progress && progress.fileCount > 1
              ? `Image ${progress.fileIndex} of ${progress.fileCount}${
                  progress.localeLabel ? ` in ${progress.localeLabel}` : ''
                }. Keep this window open until it finishes.`
              : 'Keep this window open until it finishes.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-1">
          <Progress value={value} />
          <p className="text-xs text-muted-foreground truncate">
            {isCancelling ? 'Stopping after the current image' : statusLine}
            {progress?.formatLabel && progress.phase !== 'preparing' && !isCancelling
              ? ` for ${progress.formatLabel}`
              : ''}
            {/* Kept in the 'preparing' phase too, unlike the format: swapping
                the canvas to another language is exactly what is being
                prepared, so naming it there is the point. */}
            {progress?.localeLabel && !isCancelling ? ` in ${progress.localeLabel}` : ''}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={onCancel}
          disabled={isCancelling}
        >
          {isCancelling ? 'Stopping...' : 'Cancel'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
