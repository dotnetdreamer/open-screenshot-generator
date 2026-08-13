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

// Machine translation is one network round trip per distinct string, against a
// per minute budget, so a six board project in three languages is a minute of
// nothing happening. Adding a language used to close its dialog and go silent
// until a toast appeared at the end, which reads as a hang. This is the live
// readout, and the only place the run can be stopped.

export interface TranslateProgress {
  /** The language being worked on right now, e.g. "Deutsch (de-DE)". */
  localeLabel: string;
  /** Strings finished and strings to do, within THIS language. */
  done: number;
  total: number;
  // Set when one run covers several languages (ticking three at once in the
  // manager). A single language run leaves the count at 1 and the line stays
  // quiet about it.
  localeIndex: number;
  localeCount: number;
  // 'starting' covers the gap before the engine reports its first string,
  // where a bar pinned at 0 would look stuck.
  phase: 'starting' | 'translating';
}

interface TranslateProgressDialogProps {
  progress: TranslateProgress | null;
  onCancel: () => void;
  isCancelling: boolean;
}

export function TranslateProgressDialog({
  progress,
  onCancel,
  isCancelling,
}: TranslateProgressDialogProps) {
  // Weight each language equally and fill within it, so a three language run
  // crosses a third of the bar per language instead of restarting at zero.
  // Monotonic across the whole run.
  const perLocale = progress && progress.total > 0 ? progress.done / progress.total : 0;
  const value = progress
    ? Math.min(
        100,
        Math.round((((progress.localeIndex - 1) + perLocale) / Math.max(1, progress.localeCount)) * 100)
      )
    : 0;

  const statusLine = !progress
    ? ''
    : progress.total === 0
      // Before the run has counted its work. Naming a number here would mean
      // showing a zero that is about to be wrong.
      ? 'Working out what needs translating'
      : `${progress.done} of ${progress.total} ${progress.total === 1 ? 'string' : 'strings'}`;

  return (
    <Dialog
      open={progress !== null}
      // Controlled by the run itself, like the export dialog: the X asks it to
      // stop and the dialog stays up until it has, so work is never left going
      // behind a closed dialog.
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
            Translating
          </DialogTitle>
          <DialogDescription>
            {progress && progress.localeCount > 1
              ? `Language ${progress.localeIndex} of ${progress.localeCount}. Anything you typed yourself is left alone.`
              : 'Anything you typed yourself is left alone.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-1">
          <Progress value={value} />
          <p className="text-xs text-muted-foreground truncate" dir="auto">
            {isCancelling
              ? 'Stopping, keeping what came back'
              : `${progress?.localeLabel ?? ''}: ${statusLine}`}
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
