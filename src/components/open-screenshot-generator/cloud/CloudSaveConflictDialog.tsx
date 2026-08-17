"use client";

// The fork in the road when a cloud save would land on top of something this
// device did not put there.
//
// Not the same question SaveToAccountDialog asks. That one appears on every
// second save, because bring-your-own-storage keeps no record of what this
// device last wrote and so cannot tell a routine re-save from a collision. The
// cloud can: it stamps every row with `updated`, and the link table remembers
// the stamp from the last successful push. So a normal re-save is silent, and
// this only appears when the two genuinely disagree, which means the project was
// saved from somewhere else in between.
//
// There is no "save as a copy" here, deliberately. The remote row is keyed by
// the project id, so a copy would need a new one, and a second project that is a
// fork of the first is a bigger decision than a save dialog should make on
// somebody's behalf. Open the other copy first if you want to compare them.

import React from 'react';
import { CloudUploadIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CloudProject } from '@/lib/cloud';

interface CloudSaveConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row already up there, so the prompt can name a date. */
  remote: CloudProject | null;
  isSaving: boolean;
  /** Push anyway, replacing what is in the cloud. */
  onOverwrite: () => void;
  /** Abandon this save and pull the cloud copy down instead. */
  onOpenRemote: () => void;
}

function whenLabel(value: string | undefined): string {
  // PocketBase writes `2026-08-17 09:12:44.512Z`, with a space rather than a T.
  const parsed = Date.parse(String(value || '').replace(' ', 'T'));
  if (Number.isNaN(parsed)) return 'earlier';
  return new Date(parsed).toLocaleString();
}

export function CloudSaveConflictDialog({
  open,
  onOpenChange,
  remote,
  isSaving,
  onOverwrite,
  onOpenRemote,
}: CloudSaveConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlertIcon className="h-5 w-5" />
            There is already a copy in the cloud
          </DialogTitle>
          <DialogDescription>
            &quot;{remote?.name}&quot; was saved {whenLabel(remote?.updated)}, and not from this
            device. Saving now replaces it, and that older version is gone for good.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={onOpenRemote} disabled={isSaving}>
            Open the cloud copy instead
          </Button>
          <Button onClick={onOverwrite} disabled={isSaving}>
            {isSaving ? (
              <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <CloudUploadIcon className="mr-1.5 h-4 w-4" />
            )}
            Replace it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
