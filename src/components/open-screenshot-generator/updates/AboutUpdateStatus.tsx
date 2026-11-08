"use client";

// Where updates stand, in the About dialog under the version, with the button
// that acts on it. Desktop only, and only in the main editor window, which is
// the one that talks to the updater (lib/updates/store.ts). A store build
// says which store keeps it current; a build without an update server, and
// the web, show nothing here.

import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { showsUpdateSettings, statusLine } from '@/lib/updates/describe';
import { useUpdateSnapshot } from '@/lib/updates/store';
import { UpdateActionButton, UpdateDownloadBar } from './UpdateControls';

export function AboutUpdateStatus() {
  const snapshot = useUpdateSnapshot();
  if (!snapshot || !showsUpdateSettings(snapshot)) return null;

  const lastChecked =
    snapshot.phase.phase === 'upToDate' && snapshot.checkedAt
      ? formatDistanceToNow(snapshot.checkedAt, { addSuffix: true })
      : null;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5" data-about-updates>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm text-foreground">{statusLine(snapshot)}</p>
          {lastChecked && <p className="text-xs text-muted-foreground">Last checked {lastChecked}</p>}
        </div>
        {snapshot.mode !== 'off' && (
          <div className="shrink-0">
            <UpdateActionButton snapshot={snapshot} checkLabel="Check for updates" />
          </div>
        )}
      </div>
      <UpdateDownloadBar snapshot={snapshot} />
    </div>
  );
}
