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
  // Each file counts as two half-steps (render, save) so a one-file export
  // still shows the bar move instead of sitting at 0 until it is all over.
  const steps = Math.max(1, (progress?.fileCount ?? 1) * 2);
  const done = progress
    ? (progress.fileIndex - 1) * 2 + (progress.phase === 'saving' ? 1 : 0)
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
              ? `Image ${progress.fileIndex} of ${progress.fileCount}. Keep this window open until it finishes.`
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
