"use client";

import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpDownIcon,
  CopyIcon,
  FileIcon,
  ImageIcon,
  LanguagesIcon,
  MoveIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
  ScalingIcon,
  SmartphoneIcon,
  SquareIcon,
  Trash2Icon,
  TypeIcon,
} from 'lucide-react';
import type { HistoryEntry, HistoryIcon } from '@/lib/historyLabels';
import { cn } from '@/lib/utils';

// Photoshop's History panel: every state the project has been in, oldest at the
// top, the current one highlighted. Clicking a row jumps the project straight
// to that state; the rows below it stay listed but dimmed, exactly like states
// you can still redo into, and the next edit replaces them.
interface HistoryPanelProps {
  entries: HistoryEntry[];
  currentIndex: number;
  onJumpTo: (index: number) => void;
}

const ICONS: Record<HistoryIcon, LucideIcon> = {
  open: FileIcon,
  add: PlusIcon,
  delete: Trash2Icon,
  move: MoveIcon,
  resize: ScalingIcon,
  rotate: RotateCwIcon,
  text: TypeIcon,
  color: PaletteIcon,
  order: ArrowUpDownIcon,
  artboard: SquareIcon,
  image: ImageIcon,
  device: SmartphoneIcon,
  edit: PencilIcon,
  copy: CopyIcon,
  translate: LanguagesIcon,
};

export function HistoryPanel({ entries, currentIndex, onJumpTo }: HistoryPanelProps) {
  const currentRowRef = useRef<HTMLButtonElement>(null);
  // Clock times differ between the prerender and the browser, so they are only
  // painted after mount.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentIndex, entries.length]);

  const undoneCount = Math.max(0, entries.length - 1 - currentIndex);

  return (
    <div className="flex h-full w-full min-h-0 flex-col bg-card">
      {/* "States", not "History": the tab it sits in already says History. */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-sm font-semibold">States</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {currentIndex + 1} of {entries.length}
        </span>
      </div>

      {/* Native overflow container, not Radix ScrollArea: ScrollArea under a
          height-capped flex parent silently stops scrolling. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-1.5">
          {entries.map((entry, index) => {
            const isCurrent = index === currentIndex;
            const isUndone = index > currentIndex;
            const Icon = ICONS[entry.icon] ?? PencilIcon;
            return (
              <button
                key={entry.id}
                ref={isCurrent ? currentRowRef : undefined}
                type="button"
                onClick={() => onJumpTo(index)}
                title={
                  isUndone
                    ? `Redo up to "${entry.label}"`
                    : isCurrent
                      ? 'Current state'
                      : `Step back to "${entry.label}"`
                }
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  isCurrent
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50',
                  isUndone && 'opacity-45'
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {entry.label}
                    {entry.detail ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">{entry.detail}</span>
                    ) : null}
                  </span>
                </span>
                {mounted && (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t px-3 py-2 text-[11px] leading-snug text-muted-foreground">
        {undoneCount > 0
          ? `Click any state to jump to it. ${undoneCount} state${undoneCount === 1 ? '' : 's'} ahead will be dropped by your next edit.`
          : 'Click any state to jump back to it'}
      </div>
    </div>
  );
}
