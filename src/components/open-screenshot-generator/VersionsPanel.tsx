"use client";

// Saved versions, in the dock tab after History.
//
// The two are neighbours because they answer neighbouring questions, and they
// are separate tabs because the questions are not the same one: History is this
// sitting and goes with the reload, a version survives one. A row here can be
// put back on the canvas (which is an ordinary edit, so it can be undone) or
// opened as a separate project, which is how one template becomes two variants.
//
// Nothing here deletes anything a person named. Automatic checkpoints thin
// themselves (see lib/versions/store.ts); the button on a row is for a person
// who wants one gone now.

import React, { useEffect, useRef, useState } from 'react';
import {
  BookmarkIcon,
  ClockIcon,
  CopyPlusIcon,
  Loader2Icon,
  RotateCcwIcon,
  ShieldIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ProjectVersionMeta } from '@/lib/versions/store';

interface VersionsPanelProps {
  versions: ProjectVersionMeta[];
  /** Null while nothing is open, which is when saving is not offered. */
  projectId: string | null;
  isBusy: boolean;
  onSaveNamed: (label: string) => void;
  onRestore: (version: ProjectVersionMeta) => void;
  onOpenCopy: (version: ProjectVersionMeta) => void;
  onDelete: (version: ProjectVersionMeta) => void;
  className?: string;
}

const KIND_ICON = {
  named: BookmarkIcon,
  auto: ClockIcon,
  safety: ShieldIcon,
} as const;

/** "4 minutes ago", down to "just now". Recomputed on render, which is enough. */
function ago(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return date.toLocaleDateString();
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VersionsPanel({
  versions,
  projectId,
  isBusy,
  onSaveNamed,
  onRestore,
  onOpenCopy,
  onDelete,
  className,
}: VersionsPanelProps) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Times are relative, so the prerender and the browser disagree about them.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  const startNaming = () => {
    const named = versions.filter((version) => version.kind === 'named').length;
    setDraft(`Version ${named + 1}`);
    setNaming(true);
  };

  const commit = () => {
    const label = draft.trim();
    setNaming(false);
    if (label) onSaveNamed(label);
  };

  return (
    <div className={cn('flex h-full w-full min-h-0 flex-col bg-card', className)}>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="text-sm font-semibold">Versions</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={startNaming}
          disabled={!projectId || isBusy || naming}
          title="Keep this exact state, under a name of your choosing"
        >
          {isBusy ? (
            <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <BookmarkIcon className="mr-1 h-3.5 w-3.5" />
          )}
          Save this state
        </Button>
      </div>

      {naming && (
        <div className="shrink-0 border-b p-2">
          <Input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Delete and Backspace here must not reach the canvas shortcut
              // that removes the selected element.
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setNaming(false);
              }
            }}
            onBlur={commit}
            className="h-8 text-sm"
            placeholder="Name this version"
          />
        </div>
      )}

      {/* Native overflow, not Radix ScrollArea: one under a height-capped flex
          parent silently stops scrolling. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <p className="px-3 py-4 text-xs leading-relaxed text-muted-foreground">
            None yet. One is kept whenever you open this project and start working, every so often
            while you edit, and before anything that changes the whole project. Save this state
            names one yourself.
          </p>
        ) : (
          <ul className="p-1.5">
            {versions.map((version) => {
              const Icon = KIND_ICON[version.kind] ?? ClockIcon;
              return (
                <li
                  key={version.id}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      version.kind === 'named' ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{version.label}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {mounted ? ago(version.createdAt) : ''} · {version.boards} board
                      {version.boards === 1 ? '' : 's'} · {sizeLabel(version.bytes)}
                    </span>
                  </span>
                  {/* Shown on hover with a mouse, always on a touch screen:
                      a finger never hovers (see globals.css). */}
                  <span
                    data-touch-reveal
                    className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Put this state back on the canvas"
                      onClick={() => onRestore(version)}
                      disabled={isBusy}
                    >
                      <RotateCcwIcon className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Open this state as a separate project"
                      onClick={() => onOpenCopy(version)}
                      disabled={isBusy}
                    >
                      <CopyPlusIcon className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Delete this version"
                      onClick={() => onDelete(version)}
                      disabled={isBusy}
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
