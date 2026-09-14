"use client";

// What syncing to the user's own storage looks like from the canvas: a second
// small mark at the end of the project name, next to the cloud one.
//
// Two marks in one pill for two destinations is the likeliest way this whole
// feature gets misread, so the two are kept deliberately unalike. This one
// never borrows the cloud icon set, and every tooltip names the destination in
// words the user chose themselves ("your Google Drive", "your gists") rather
// than saying "the cloud" a second time.
//
// It renders NOTHING in the two resting states, which is most of the time: the
// switch is off by default, and a project nobody has saved to their storage has
// nothing to report. A person who never opted in never sees it at all.

import React from 'react';
import {
  CheckIcon,
  FolderSyncIcon,
  HardDriveIcon,
  Loader2Icon,
  PlugZapIcon,
  TriangleAlertIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import type { AccountSyncStatus } from '@/lib/account/autoSync';
import type { CloudProjectSummary } from '@/lib/account/types';
import { cn } from '@/lib/utils';

interface AccountSyncChipProps {
  status: AccountSyncStatus;
  /** Open the account dialog, because nobody is connected. */
  onConnect: () => void;
  /** Push now: what a stopped or failed mark offers. */
  onSyncNow: () => void;
  /** Hand the remote copy to the dialog that asks what to do about it. */
  onResolveConflict: (remote: CloudProjectSummary) => void;
  className?: string;
}

interface ChipFace {
  /** Null when the mark is the animated dots rather than an icon. */
  icon: LucideIcon | null;
  /** Read out to a screen reader, and shown on hover. */
  label: string;
  title: string;
  spin?: boolean;
  /** Needs a person, so it is allowed to be louder than the rest. */
  loud?: boolean;
}

/**
 * A provider's own sentence, with its full stop taken off.
 *
 * Every AccountAuthError message ends in one, and three of the faces below join
 * the message to a clause of their own, so without this the tooltip reads
 * "Please connect again.. Click to reconnect".
 */
function stem(message: string): string {
  return message.replace(/\.\s*$/, '');
}

function timeLabel(savedAt: number | null): string {
  if (!savedAt) return '';
  return new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function faceFor(status: AccountSyncStatus): ChipFace | null {
  const where = status.provider === 'github' ? 'your gists' : 'your Google Drive';
  const when = timeLabel(status.savedAt);

  switch (status.state) {
    // Nothing to say, and saying it would be worse than silence: the switch is
    // off, or this project has never been put in the user's storage at all.
    case 'disabled':
    case 'unlinked':
      return null;
    case 'signed-out':
      return {
        icon: PlugZapIcon,
        label: 'Connect storage',
        title: 'Connect Google Drive or GitHub to keep your saved projects up to date',
      };
    case 'waiting':
      return {
        icon: HardDriveIcon,
        label: 'Syncing on',
        title: `Changes to this project go to ${where} on their own`,
      };
    case 'pending':
      return {
        icon: null,
        label: 'Changes pending',
        title: when
          ? `Saved to ${where} at ${when}. The newest edits go up in a moment, or click to send now`
          : `Your edits go to ${where} in a moment. Click to send now`,
      };
    case 'syncing':
      return {
        icon: Loader2Icon,
        label: 'Syncing',
        title: `Sending this project to ${where}`,
        spin: true,
      };
    case 'synced':
      return {
        icon: CheckIcon,
        label: 'Synced',
        title: when
          ? `Up to date in ${where}, sent at ${when}. Click to send again`
          : `Up to date in ${where}. Click to send again`,
      };
    case 'retrying':
      return {
        icon: FolderSyncIcon,
        label: 'Retrying',
        title: `${stem(status.message || `That did not reach ${where}`)}. Trying again shortly, or click to try now`,
      };
    case 'paused-collab':
      return {
        icon: UsersIcon,
        label: 'Held while editing together',
        title: `Everyone's edits are landing here, and they go to ${where} once the live session ends`,
      };
    case 'conflict':
      return {
        icon: TriangleAlertIcon,
        label: 'Changed somewhere else',
        title: `${stem(status.message || `The copy in ${where} changed`)}. Click to choose which one to keep`,
        loud: true,
      };
    case 'blocked':
      return {
        icon: TriangleAlertIcon,
        label: 'Cannot sync this project',
        title: status.message || `This project cannot be kept up to date in ${where}`,
        loud: true,
      };
    case 'needs-attention':
      return {
        icon: PlugZapIcon,
        label: 'Reconnect to keep syncing',
        title: `${stem(status.message || 'The sign in stopped working')}. Click to try again`,
        loud: true,
      };
  }
}

/**
 * Three dots, walking.
 *
 * The one state worth animating is the one where something is about to happen
 * and has not yet: a static icon there reads as "done", which is the opposite
 * of what it means.
 */
function PendingDots({ loud }: { loud?: boolean }) {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'h-1 w-1 rounded-full animate-bounce',
            loud ? 'bg-destructive' : 'bg-muted-foreground'
          )}
          style={{ animationDelay: `${index * 140}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  );
}

export function AccountSyncChip({
  status,
  onConnect,
  onSyncNow,
  onResolveConflict,
  className,
}: AccountSyncChipProps) {
  const face = faceFor(status);
  if (!face) return null;

  const Icon = face.icon;
  const handleClick = () => {
    if (status.state === 'syncing' || status.state === 'paused-collab') return;
    if (status.state === 'signed-out') {
      onConnect();
      return;
    }
    if (status.state === 'needs-attention') {
      // NOT the account dialog. The session was deliberately kept (the syncer
      // never signs anybody out), so that dialog would render its signed-in
      // face with nothing to click, and returning from it would leave the
      // syncer stopped for good: `syncNow` is the only thing that clears a
      // stop. This click is also the user gesture the web token renewal wants,
      // which is the thing that was missing when it failed on a timer.
      onSyncNow();
      return;
    }
    if (status.conflict) {
      onResolveConflict(status.conflict);
      return;
    }
    onSyncNow();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      // The bar sits over the canvas, so a press here must not reach the pan
      // handler underneath it (AGENTS.md rule 20: pointer events, never mouse).
      onPointerDown={(event) => event.stopPropagation()}
      disabled={status.state === 'syncing' || status.state === 'paused-collab'}
      title={face.title}
      aria-label={`Sync to your own storage: ${face.label}`}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        face.loud
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        'disabled:cursor-default disabled:hover:bg-transparent',
        className
      )}
    >
      {Icon ? (
        <Icon className={cn('h-3.5 w-3.5', face.spin && 'animate-spin')} />
      ) : (
        <PendingDots loud={face.loud} />
      )}
    </button>
  );
}
