"use client";

// What auto saving to the cloud looks like from the canvas: one small pill in
// the bottom left, next to the project name.
//
// It is deliberately the only UI the feature has. Auto save that announces every
// push with a toast is worse than no auto save, and a progress dialog for
// something nobody asked for would be worse still. So the pill is quiet while
// things work, and it is the one place that says so when they do not.
//
// Every visible state is clickable, and the click is always the thing a person
// would want next: sign in, answer the conflict, retry the failure, or push now.

import React from 'react';
import {
  CloudAlertIcon,
  CloudIcon,
  CloudOffIcon,
  CloudUploadIcon,
  Loader2Icon,
  type LucideIcon,
} from 'lucide-react';
import type { CloudAutoSaveStatus } from '@/lib/cloud/autoSave';
import type { CloudProject } from '@/lib/cloud';
import { cn } from '@/lib/utils';

interface CloudAutoSaveChipProps {
  status: CloudAutoSaveStatus;
  /** Send somebody through the account dialog, on its cloud tab. */
  onSignIn: () => void;
  /** Push now: what a paused or failed chip offers. */
  onSaveNow: () => void;
  /** Hand the remote row to the conflict dialog. */
  onResolveConflict: (remote: CloudProject) => void;
  className?: string;
}

interface ChipFace {
  icon: LucideIcon;
  label: string;
  title: string;
  spin?: boolean;
  /** Needs a person, so it is allowed to be louder than the rest. */
  loud?: boolean;
}

function timeLabel(savedAt: number | null): string {
  if (!savedAt) return '';
  return new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function faceFor(status: CloudAutoSaveStatus): ChipFace | null {
  const when = timeLabel(status.savedAt);

  switch (status.state) {
    case 'disabled':
      return null;
    case 'signed-out':
      return {
        icon: CloudOffIcon,
        label: 'Sign in to sync',
        title:
          status.message ||
          'Projects are saved in this browser only. Sign in and this one is kept in your cloud too',
      };
    case 'waiting':
      return {
        icon: CloudIcon,
        label: 'Auto save on',
        title: 'This project goes to your cloud on its own, shortly after you start working',
      };
    case 'pending':
      return {
        icon: CloudUploadIcon,
        label: 'Changes pending',
        title: status.pendingAssets
          ? `${status.pendingAssets} file${status.pendingAssets === 1 ? '' : 's'} still to upload. Click to push now`
          : when
            ? `Saved to your cloud at ${when}. The newest edits go up in a moment, or click to push now`
            : 'Your edits go to the cloud in a moment. Click to push now',
      };
    case 'saving':
      return {
        icon: Loader2Icon,
        label: 'Saving',
        title: 'Sending this project to your cloud',
        spin: true,
      };
    case 'saved':
      return {
        icon: CloudIcon,
        label: 'Saved',
        title: when ? `In your cloud, saved at ${when}. Click to save again` : 'In your cloud. Click to save again',
      };
    case 'retrying':
      return {
        icon: CloudAlertIcon,
        label: 'Retrying',
        title: `${status.message || 'That did not reach the cloud'}. Trying again shortly, or click to try now`,
      };
    case 'paused':
      return {
        icon: CloudAlertIcon,
        label: 'Auto save paused',
        title: status.message || 'The cloud refused that save',
        loud: true,
      };
  }
}

export function CloudAutoSaveChip({
  status,
  onSignIn,
  onSaveNow,
  onResolveConflict,
  className,
}: CloudAutoSaveChipProps) {
  const face = faceFor(status);
  if (!face) return null;

  const Icon = face.icon;
  const handleClick = () => {
    if (status.state === 'saving') return;
    if (status.state === 'signed-out') {
      onSignIn();
      return;
    }
    if (status.conflict) {
      onResolveConflict(status.conflict);
      return;
    }
    onSaveNow();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      // The bar sits over the canvas, so a press here must not reach the pan
      // handler underneath it.
      onPointerDown={(event) => event.stopPropagation()}
      disabled={status.state === 'saving'}
      title={face.title}
      aria-label={`Cloud auto save: ${face.label}`}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        face.loud ? 'text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        'disabled:cursor-default disabled:hover:bg-transparent',
        className
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', face.spin && 'animate-spin')} />
      {/* The label is the first thing to go when the canvas gets narrow: the
          icon and the tooltip still carry the state. */}
      <span className="hidden lg:inline">{face.label}</span>
    </button>
  );
}
