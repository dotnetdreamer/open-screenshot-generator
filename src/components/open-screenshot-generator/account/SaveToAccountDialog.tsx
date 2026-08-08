"use client";

// The fork in the road when "Save to account" would land on top of something.
//
// A save used to be silent: providers match on the project id, so the second
// save replaced the first with no way back (cloud storage keeps no version
// history we read). This asks first, and only when there is genuinely
// something to overwrite. A first save never sees this dialog.

import React, { useEffect, useState } from 'react';
import { CloudUploadIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type SaveMode = 'replace' | 'copy';

interface SaveToAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the copy already in the account, the one "Replace" writes over. */
  existingName: string;
  /** When it was last saved there, shown so the user can tell which copy it is. */
  existingModifiedAt?: Date;
  /** Pre-filled name for the new copy. */
  suggestedName: string;
  /** "Google Drive" / "GitHub gists", for copy that names where this goes. */
  storageLabel: string;
  isSaving: boolean;
  onReplace: () => void;
  onSaveCopy: (name: string) => void;
}

export function SaveToAccountDialog({
  open,
  onOpenChange,
  existingName,
  existingModifiedAt,
  suggestedName,
  storageLabel,
  isSaving,
  onReplace,
  onSaveCopy,
}: SaveToAccountDialogProps) {
  const [mode, setMode] = useState<SaveMode>('replace');
  const [name, setName] = useState(suggestedName);

  // Reopening for a different project must not carry the last name over.
  useEffect(() => {
    if (open) {
      setMode('replace');
      setName(suggestedName);
    }
  }, [open, suggestedName]);

  const trimmed = name.trim();
  const canSave = !isSaving && (mode === 'replace' || trimmed.length > 0);

  const submit = () => {
    if (!canSave) return;
    if (mode === 'replace') onReplace();
    else onSaveCopy(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudUploadIcon className="h-5 w-5" />
            Save to your {storageLabel}
          </DialogTitle>
          <DialogDescription>
            This project is already saved there. Replace that copy, or keep both by
            saving this one under a new name.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          className="grid gap-3 py-1"
          value={mode}
          onValueChange={(value) => setMode(value as SaveMode)}
        >
          <div className="flex items-start space-x-2">
            <RadioGroupItem id="save-replace" value="replace" className="mt-0.5" disabled={isSaving} />
            <div className="grid gap-0.5 leading-none">
              <Label htmlFor="save-replace">Replace the saved copy</Label>
              <p className="text-xs text-muted-foreground">
                Overwrites &quot;{existingName}&quot;
                {existingModifiedAt ? `, last saved ${existingModifiedAt.toLocaleString()}` : ''}. The
                older version is gone for good
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-2">
            <RadioGroupItem id="save-copy" value="copy" className="mt-0.5" disabled={isSaving} />
            <div className="grid flex-1 gap-1.5 leading-none">
              <Label htmlFor="save-copy">Save as a new project</Label>
              <p className="text-xs text-muted-foreground">
                Adds a second file to your {storageLabel} and leaves the saved copy alone
              </p>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onFocus={() => setMode('copy')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="New project name"
                disabled={isSaving}
                aria-label="Name for the new project"
                className="h-8"
              />
            </div>
          </div>
        </RadioGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSave}>
            {isSaving && <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />}
            {mode === 'replace' ? 'Replace' : 'Save as new'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
