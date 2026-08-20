"use client";

// The one screen the feature has: get a link, see who is here, stop.
//
// Deliberately not a permissions panel. There are no roles to pick, no invites
// to send and nothing to accept: the link IS the permission, exactly as it is
// for the read-only share, and the only decision anybody makes is whether to
// hand it over. Everything else the room needs (who you are, what colour you
// draw in, which board you are on) it works out by itself.

import React from 'react';
import {
  CopyIcon,
  Loader2Icon,
  LogOutIcon,
  RefreshCwIcon,
  UsersIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CollabPeer, CollabStatus, CollabUser } from '@/lib/collab/types';
import { CollabFace } from './CollabFace';

interface CollabDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: CollabStatus;
  /** The link to hand out, or null when there is not one yet. */
  inviteUrl: string | null;
  me: CollabUser | null;
  peers: CollabPeer[];
  isWorking: boolean;
  error: string | null;
  /** Save to the cloud if needed, mint a room, join it, copy the link. */
  onCreate: () => void;
  onCopy: () => void;
  /** Leave the room. The project stays open, editing carries on alone. */
  onLeave: () => void;
  /** Mint a new key, so every link handed out so far opens nothing. */
  onReset: () => void;
}

function Face({ user, label }: { user: CollabUser; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <CollabFace user={user} />
      <span className="min-w-0 truncate text-sm">{user.name}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{label}</span>
    </li>
  );
}

export function CollabDialog({
  open,
  onOpenChange,
  status,
  inviteUrl,
  me,
  peers,
  isWorking,
  error,
  onCreate,
  onCopy,
  onLeave,
  onReset,
}: CollabDialogProps) {
  const live = status === 'live' || status === 'connecting';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UsersIcon className="h-5 w-5" />
            Edit together
          </DialogTitle>
          <DialogDescription>
            Everyone with the link works on this project at the same time, and sees where the
            others are as they do it
          </DialogDescription>
        </DialogHeader>

        {!inviteUrl ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This puts a copy of the project in your cloud, then hands out a link that opens it
              live. People you send it to sign in with Google or GitHub, and edit alongside you.
            </p>
            <Button className="w-full" onClick={onCreate} disabled={isWorking}>
              {isWorking ? (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UsersIcon className="mr-2 h-4 w-4" />
              )}
              Create the invite link
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteUrl} className="h-9 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={onCopy} title="Copy the link">
                <CopyIcon className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Anyone holding this link can edit this project, so treat it like a key. The half
              after the # never reaches any server: it is what encrypts the session between the
              people in it.
            </p>

            {/* A link can outlive a session: the key is remembered with the
                project, so somebody who closed the tab yesterday opens this
                dialog holding a link they are not currently in a room for. */}
            {live ? (
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      status === 'live' ? 'bg-emerald-500' : 'bg-amber-500'
                    )}
                  />
                  {status === 'live' ? 'In the room' : 'Connecting'}
                </div>
                <ul className="space-y-2">
                  {me && <Face user={me} label="you" />}
                  {peers.map((peer) => (
                    <Face key={peer.clientId} user={peer.user} label="editing" />
                  ))}
                </ul>
                {!peers.length && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Nobody else has opened the link yet
                  </p>
                )}
              </div>
            ) : (
              <Button className="w-full" onClick={onCreate} disabled={isWorking}>
                {isWorking ? (
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UsersIcon className="mr-2 h-4 w-4" />
                )}
                Start the session
              </Button>
            )}

            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={onReset} disabled={isWorking} title="Every link handed out so far stops working">
                <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
                Reset the link
              </Button>
              {live && (
                <Button variant="outline" size="sm" onClick={onLeave}>
                  <LogOutIcon className="mr-1.5 h-3.5 w-3.5" />
                  Leave the session
                </Button>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
