"use client";

// What Settings and the About dialog share for desktop updates: the one
// button that acts on where updates stand, and the download bar. Both read
// the shared copy of Rust's state (lib/updates/store.ts).

import React, { useState } from 'react';
import { DownloadIcon, Loader2Icon, RefreshCwIcon, RotateCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { downloadPercent } from '@/lib/updates/describe';
import { checkForUpdates, openDownloadPage, restartIntoUpdate } from '@/lib/updates/store';
import type { UpdateSnapshot } from '@/lib/updates/types';

/**
 * Restart now when an update is ready or going in, Download when this copy
 * can only link to one, and a check otherwise. A check from here shows no
 * toast: the status line beside the button says what it found.
 */
export function UpdateActionButton({
  snapshot,
  checkLabel,
}: {
  snapshot: UpdateSnapshot;
  /** What the check button says; the About dialog spells it out, Settings has the context. */
  checkLabel: string;
}) {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const { phase } = snapshot;

  if (phase.phase === 'ready' || phase.phase === 'installing') {
    const going = restarting || phase.phase === 'installing';
    const restart = async () => {
      setRestarting(true);
      const problem = await restartIntoUpdate();
      setRestarting(false);
      if (problem) toast(problem);
    };
    return (
      <Button size="sm" disabled={going} onClick={() => void restart()}>
        {going ? (
          <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCwIcon className="mr-1.5 h-3.5 w-3.5" />
        )}
        Restart now
      </Button>
    );
  }

  if (phase.phase === 'available') {
    const { update } = phase;
    return (
      <Button size="sm" variant="outline" onClick={() => void openDownloadPage(update)}>
        <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
        Download
      </Button>
    );
  }

  const busy = checking || phase.phase === 'checking' || phase.phase === 'downloading';
  const check = async () => {
    setChecking(true);
    await checkForUpdates(false);
    setChecking(false);
  };
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void check()}>
      {busy ? (
        <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
      )}
      {checkLabel}
    </Button>
  );
}

/** A thin bar while an update downloads and its size is known; nothing otherwise. */
export function UpdateDownloadBar({ snapshot }: { snapshot: UpdateSnapshot }) {
  const { phase } = snapshot;
  if (phase.phase !== 'downloading') return null;
  const percent = downloadPercent(phase.received, phase.total);
  if (percent === null) return null;
  return <Progress value={percent} className="h-1.5" aria-label="Update download" />;
}
