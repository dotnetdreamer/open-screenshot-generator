"use client";

// Who is in the room, in the toolbar.
//
// It is the whole status display for a live session: a face per person in their
// own colour (the same colour their cursor and their selection ring carry on
// the canvas, which is what makes "who moved that" answerable at a glance), and
// a dot that says whether this browser is actually connected.
//
// Renders nothing at all when there is no session, so the toolbar of somebody
// working alone is exactly what it was.

import React from 'react';
import { UsersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CollabPeer, CollabStatus, CollabUser } from '@/lib/collab/types';
import { CollabFace } from './CollabFace';

interface CollabBarProps {
  status: CollabStatus;
  me: CollabUser | null;
  peers: CollabPeer[];
  onOpen: () => void;
}

/** How many faces before the rest become a "+3". */
const MAX_FACES = 4;

/** Overlapped, so a room of five reads as a group rather than a row. */
function StackedFace({ user, title }: { user: CollabUser; title: string }) {
  return <CollabFace user={user} title={title} className="-ml-2 ring-2 ring-card first:ml-0" />;
}

export function CollabBar({ status, me, peers, onOpen }: CollabBarProps) {
  if (status === 'off') return null;

  const faces = peers.slice(0, MAX_FACES);
  const extra = peers.length - faces.length;

  return (
    <Button
      variant="outline"
      className="h-8 shrink-0 gap-2 pl-2 pr-2.5"
      onClick={onOpen}
      title={
        peers.length
          ? `Editing together with ${peers.map((peer) => peer.user.name).join(', ')}`
          : 'Nobody else is here yet. Click to copy the invite link'
      }
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          status === 'live' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
        )}
      />
      {me && <StackedFace user={me} title={`${me.name} (you)`} />}
      {faces.map((peer) => (
        <StackedFace key={peer.clientId} user={peer.user} title={peer.user.name} />
      ))}
      {extra > 0 && (
        <span className="-ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold ring-2 ring-card">
          +{extra}
        </span>
      )}
      {!peers.length && <UsersIcon className="h-4 w-4 opacity-70" />}
    </Button>
  );
}
