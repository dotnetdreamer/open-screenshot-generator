"use client";

// The display list, as menu items.
//
// Shared by the editor's dock menu and a detached window's own menu so both
// spell a display the same way, and so a machine with one display shows nothing
// in either rather than a menu with a single item that does nothing.

import { CheckIcon, MonitorIcon } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { MonitorInfo } from '@/lib/panels/monitors';

interface MonitorMenuItemsProps {
  monitors: MonitorInfo[];
  /** The display the window is on now, ticked in the list. */
  currentId?: string | null;
  onPick: (monitor: MonitorInfo) => void;
  label?: string;
  /** Draw a rule above the group. False for the first group in a menu. */
  withSeparator?: boolean;
}

export function MonitorMenuItems({
  monitors,
  currentId,
  onPick,
  label = 'Move to display',
  withSeparator = true,
}: MonitorMenuItemsProps) {
  if (monitors.length < 2) return null;
  return (
    <>
      {withSeparator && <DropdownMenuSeparator />}
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        {label}
      </DropdownMenuLabel>
      {monitors.map((monitor) => {
        const isCurrent = !!currentId && currentId === monitor.id;
        return (
          <DropdownMenuItem
            key={monitor.id}
            onSelect={() => onPick(monitor)}
            className="gap-2"
          >
            <MonitorIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{monitor.label}</span>
            {isCurrent && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
