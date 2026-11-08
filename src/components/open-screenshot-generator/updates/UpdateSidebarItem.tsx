"use client";

// The update prompt: an item at the top of the sidebar footer, there only while
// an update is ready to restart into, out for download by hand, or going in.
// Clicking it opens the details and the button that acts on them.
//
// It reads the shared copy of Rust's state (lib/updates/store.ts), so on the
// web and in every window but the main editor it renders nothing.

import React, { useEffect, useRef, useState } from 'react';
import { DownloadIcon, Loader2Icon, RotateCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useToast } from '@/hooks/use-toast';
import { promptFor, releaseDate, type UpdatePrompt } from '@/lib/updates/describe';
import {
  getUpdateSnapshot,
  openDownloadPage,
  restartIntoUpdate,
  usePromptRequests,
  useUpdateSnapshot,
} from '@/lib/updates/store';
import { cn } from '@/lib/utils';

const LABELS: Record<UpdatePrompt['kind'], string> = {
  ready: 'Restart to update',
  available: 'New version available',
  installing: 'Installing update',
};

export function UpdateSidebarItem() {
  const snapshot = useUpdateSnapshot();
  const promptRequests = usePromptRequests();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // An open nobody clicked for must not take the keyboard from the canvas.
  const openedUnasked = useRef(false);
  const seenRequests = useRef(promptRequests);

  useEffect(() => {
    if (promptRequests === seenRequests.current) return;
    seenRequests.current = promptRequests;
    if (promptFor(getUpdateSnapshot())) {
      openedUnasked.current = true;
      setOpen(true);
    }
  }, [promptRequests]);

  const prompt = promptFor(snapshot);
  if (!prompt) return null;
  const { kind, update } = prompt;
  const installing = kind === 'installing' || restarting;
  const date = releaseDate(update);

  const restart = async () => {
    setRestarting(true);
    const problem = await restartIntoUpdate();
    setRestarting(false);
    if (problem) toast(problem);
  };

  const download = () => {
    setOpen(false);
    void openDownloadPage(update);
  };

  const Icon = installing ? Loader2Icon : kind === 'ready' ? RotateCwIcon : DownloadIcon;

  return (
    <SidebarMenuItem>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) openedUnasked.current = false;
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <SidebarMenuButton
            tooltip={LABELS[kind]}
            className="w-full text-primary hover:text-primary data-[state=open]:text-primary"
            data-update-kind={kind}
          >
            <Icon className={cn(installing && 'animate-spin')} />
            <span className="truncate group-data-[collapsible=icon]:hidden">{LABELS[kind]}</span>
            <span
              aria-hidden
              className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary group-data-[collapsible=icon]:hidden"
            />
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="end"
          className="w-80 space-y-3"
          onOpenAutoFocus={(event) => {
            if (openedUnasked.current) event.preventDefault();
          }}
        >
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              {kind === 'available'
                ? `Version ${update.version} is out`
                : kind === 'ready'
                  ? `Version ${update.version} is ready`
                  : `Installing version ${update.version}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {date ? `You have ${update.currentVersion}. Released ${date}` : `You have ${update.currentVersion}`}
            </p>
          </div>

          {update.critical && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              This version fixes a serious problem. Update as soon as you can.
            </p>
          )}

          {update.notes && (
            <div className="space-y-1">
              <p className="text-xs font-medium">What&apos;s new</p>
              <div className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {update.notes}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {kind === 'available'
              ? 'This copy of the app cannot update itself. Download the new version and install it in place of this one.'
              : 'The app restarts into the new version. Your work is saved first.'}
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={installing} onClick={() => setOpen(false)}>
              Later
            </Button>
            {kind === 'available' ? (
              <Button size="sm" onClick={download}>
                <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
                Download
              </Button>
            ) : (
              <Button size="sm" disabled={installing} onClick={() => void restart()}>
                {installing ? (
                  <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCwIcon className="mr-1.5 h-3.5 w-3.5" />
                )}
                {installing ? 'Restarting' : 'Restart now'}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
