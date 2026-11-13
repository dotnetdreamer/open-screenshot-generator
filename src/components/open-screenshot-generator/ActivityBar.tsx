"use client";

// The strip down the left edge of the window that switches between the app's
// views, the way VS Code's activity bar does: the editor, where the screenshots
// are made, and Growth, where their numbers come back.
//
// A new view is one entry in ACTIVITIES and one branch where the layout draws
// the views (OpenScreenshotGeneratorLayout.tsx, `activity`). The editor stays
// mounted under every other view, so its canvas, selection and undo are as
// they were when it comes back.
//
// Below the views go places that open over whatever is on screen (Discover),
// and at the bottom the account and the app's own settings, where VS Code
// keeps Accounts and Manage. Those are `actions`: buttons with no view.

import React from 'react';
import { PenToolIcon, TrendingUpIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ActivityId = 'editor' | 'growth';

export interface Activity {
  id: ActivityId;
  /** The tooltip and the accessible name. Tests find the buttons by it. */
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const ACTIVITIES: Activity[] = [
  { id: 'editor', label: 'Editor', icon: PenToolIcon },
  { id: 'growth', label: 'Growth: downloads, reviews and your store page', icon: TrendingUpIcon },
];

/** A button on the bar that opens something rather than switching the view. */
export interface ActivityAction {
  id: string;
  /** The accessible name. Tests find the buttons by it. */
  label: string;
  /** The tooltip, when it says more than the name. */
  title?: string;
  /** An icon, or the account's picture. */
  icon: React.ReactNode;
  onClick: () => void;
}

const BUTTON =
  'relative flex h-11 w-11 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';
const IDLE = 'text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground';

function ActionButton({ action }: { action: ActivityAction }) {
  return (
    <button type="button" title={action.title ?? action.label} aria-label={action.label} onClick={action.onClick} className={cn(BUTTON, IDLE)}>
      {action.icon}
    </button>
  );
}

export function ActivityBar({
  active,
  onSelect,
  badges = {},
  actions = [],
  bottomActions = [],
  className,
}: {
  active: ActivityId;
  onSelect: (id: ActivityId) => void;
  /** A count to show on a view's button, such as Growth's new insights. */
  badges?: Partial<Record<ActivityId, number>>;
  /** Under the views. */
  actions?: ActivityAction[];
  /** At the foot of the bar. */
  bottomActions?: ActivityAction[];
  className?: string;
}) {
  return (
    <nav
      aria-label="Views"
      className={cn(
        'z-20 w-12 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2 text-sidebar-foreground',
        // The dev server draws Next's own badge over the bottom left corner,
        // where About would sit under it. Release builds have no badge.
        process.env.NODE_ENV === 'development' && 'pb-16',
        className
      )}
      data-testid="activity-bar"
    >
      {ACTIVITIES.map((activity) => {
        const Icon = activity.icon;
        const selected = activity.id === active;
        const count = badges[activity.id] ?? 0;
        return (
          <button
            key={activity.id}
            type="button"
            title={activity.label}
            aria-label={activity.label}
            aria-current={selected ? 'page' : undefined}
            onClick={() => onSelect(activity.id)}
            className={cn(BUTTON, selected ? 'text-sidebar-foreground' : IDLE)}
          >
            {/* The mark beside the view on screen, as VS Code draws it. */}
            {selected && <span aria-hidden className="absolute -left-0.5 top-2 bottom-2 w-0.5 rounded-full bg-primary" />}
            <Icon className="h-5 w-5" />
            {count > 0 && (
              <span
                aria-hidden
                data-testid={`${activity.id}-badge`}
                className="absolute bottom-1 right-0.5 min-w-[1.1rem] rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white"
              >
                {count > 9 ? '9+' : count}
              </span>
            )}
          </button>
        );
      })}
      {actions.length > 0 && <span aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />}
      {actions.map((action) => (
        <ActionButton key={action.id} action={action} />
      ))}
      {bottomActions.length > 0 && (
        <div className="mt-auto flex flex-col items-center gap-1">
          {bottomActions.map((action) => (
            <ActionButton key={action.id} action={action} />
          ))}
        </div>
      )}
    </nav>
  );
}
