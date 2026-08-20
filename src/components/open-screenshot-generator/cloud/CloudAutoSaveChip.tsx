"use client";

// What auto saving to the cloud looks like from the canvas: one small mark at
// the end of the project name.
//
// It is deliberately the only UI the feature has, and deliberately wordless.
// Auto save that announces every push with a toast is worse than no auto save,
// a progress dialog for something nobody asked for would be worse still, and a
// pill that reads "Changes pending" next to the name is a sentence you have to
// read every time you glance at it. So: an icon, an animation while something
// is in flight, and the words in the tooltip for the moment you want them.
//
// Every visible state is clickable, and the click is always the thing a person
// would want next: sign in, answer the conflict, retry the failure, or push now.

import React from 'react';
import { CloudAlertIcon, CloudIcon, CloudOffIcon, Loader2Icon, type LucideIcon } from 'lucide-react';
import type { CloudAutoSaveStatus } from '@/lib/cloud/autoSave';
import type { CloudProject } from '@/lib/cloud';
import { cn } from '@/lib/utils';

interface CloudAutoSaveChipProps {
  status: CloudAutoSaveStatus;
  /** Send somebody through the account dialog, on its cloud tab. */
  onSignIn: () => void;
  /** Push now: what a paused or failed mark offers. */
  onSaveNow: () => void;
  /** Hand the remote row to the conflict dialog. */
  onResolveConflict: (remote: CloudProject) => void;
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
          'Saved in this browser only. Sign in and this project is kept in your cloud too',
      };
    case 'waiting':
      return {
        icon: CloudIcon,
        label: 'Auto save on',
        title: 'This project goes to your cloud on its own, shortly after you start working',
      };
    case 'pending':
      return {
        icon: null,
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

/**
 * Three dots, walking.
 *
 * The one state worth animating is the one where something is about to happen
 * and has not yet: a static icon there reads as "done", which is the opposite
 * of what it means. Staggered so it reads as motion rather than a flash.
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
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        face.loud ? 'text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
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
