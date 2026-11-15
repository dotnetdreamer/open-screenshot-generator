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
import { useEffect, useState } from 'react';

// A translation run takes seconds with the user's own AI and can take a minute
// with the app's free translator, which answers a few requests a minute.
// Without a readout a dialog that closed and went silent until a toast
// appeared would read as a hang. This is the live readout, and the only place
// the run can be stopped.

export interface TranslateProgress {
  /** The language at work, e.g. "Deutsch (de-DE)". A run of several lists them. */
  localeLabel: string;
  /** Strings written and strings to write, every language of the run together. */
  done: number;
  total: number;
  // Languages with nothing left to write, of how many the run covers (ticking
  // three at once in the manager). A single language run leaves the count at
  // 1 and the line stays quiet about it.
  localesDone: number;
  localeCount: number;
  // 'starting' covers the gap before the engine reports its first string,
  // where a bar pinned at 0 would look stuck.
  phase: 'starting' | 'translating';
  /** Who is translating, as it reads after "Using": "Claude Code (Max plan)". Unset until known. */
  engineLabel?: string;
}

interface TranslateProgressDialogProps {
  progress: TranslateProgress | null;
  onCancel: () => void;
  isCancelling: boolean;
}

export function TranslateProgressDialog({
  progress: current,
  onCancel,
  isCancelling,
}: TranslateProgressDialogProps) {
  // The run sets progress to null when it ends, and the dialog then fades out.
  // Showing the last reading through the fade keeps the AI's name and the
  // count on screen, where a null would flash an empty ": " line.
  const [last, setLast] = useState<TranslateProgress | null>(current);
  useEffect(() => {
    if (current) setLast(current);
  }, [current]);
  const progress = current ?? last;

  // Languages run side by side, so the bar counts strings across all of them.
  // It only ever moves forward.
  const value =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  const statusLine = !progress
    ? ''
    : progress.total === 0
      // Before the run has counted its work. Naming a number here would mean
      // showing a zero that is about to be wrong.
      ? 'Working out what needs translating'
      : progress.localeCount > 1
        ? `${progress.done} of ${progress.total} strings, ${progress.localesDone} of ${progress.localeCount} languages done`
        : `${progress.done} of ${progress.total} ${progress.total === 1 ? 'string' : 'strings'}`;

  return (
    <Dialog
      open={current !== null}
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
            {progress?.engineLabel
              ? `Using ${progress.engineLabel}. Anything you typed yourself is left alone.`
              : 'Anything you typed yourself is left alone.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-1">
          <Progress value={value} />
          <p className="text-xs text-muted-foreground truncate" dir="auto">
            {isCancelling
              ? 'Stopping, keeping what came back'
              : progress && progress.localeCount > 1
                ? statusLine
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
