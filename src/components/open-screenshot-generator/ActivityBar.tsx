"use client";

// The strip down the left edge of the window that switches between the app's
// views, the way VS Code's activity bar does, with each view's name under its
// icon so nobody has to guess from the picture: the editor, where the
// screenshots are made, Capture, where they are taken from the app running in
// a simulator or emulator, Director, where a screen recording becomes a video
// of a 3D phone with the camera moves worked out from the recording, Remove
// background, where people and products are
// cut out of photos for them, Growth, where their numbers come back, Store
// compliance, what the stores reject apps for and the checks to make before
// sending one, Website, where the app's own site is made from them, and SEO,
// where that site is checked for Google and AI search.
//
// A new view is one entry in ACTIVITIES and one branch where the layout draws
// the views (OpenScreenshotGeneratorLayout.tsx, `activity`). The editor stays
// mounted under every other view, so its canvas, selection and undo are as
// they were when it comes back.
//
// Below the views go places that open over whatever is on screen (Discover),
// and at the bottom the account and the app's own settings, where VS Code
// keeps Accounts and Manage. Those are `actions`: buttons with no view. A view
// can also sit under the actions (`belowActions`): Website, the app's own
// site, sits under Discover, and SEO under Website.

import React from 'react';
import { CameraIcon, ClapperboardIcon, GlobeIcon, PenToolIcon, ScissorsIcon, SearchCheckIcon, ShieldCheckIcon, TrendingUpIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ActivityId = 'editor' | 'capture' | 'director' | 'cutout' | 'growth' | 'compliance' | 'website' | 'seo';

export interface Activity {
  id: ActivityId;
  /** The name under the icon. */
  name: string;
  /** The tooltip and the accessible name, which starts with the name. Tests find the buttons by it. */
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Drawn under the actions (Discover) instead of with the views at the top. */
  belowActions?: boolean;
}

export const ACTIVITIES: Activity[] = [
  { id: 'editor', name: 'Editor', label: 'Editor', icon: PenToolIcon },
  { id: 'capture', name: 'Capture screenshots', label: 'Capture screenshots of your app', icon: CameraIcon },
  { id: 'director', name: 'Director', label: 'Director: phone videos of your app, with the camera moves made for you', icon: ClapperboardIcon },
  { id: 'cutout', name: 'Remove background', label: 'Remove background: cut people and products out of photos', icon: ScissorsIcon },
  { id: 'growth', name: 'Growth', label: 'Growth: downloads, reviews and your store page', icon: TrendingUpIcon },
  { id: 'compliance', name: 'Store compliance', label: 'Store compliance: avoid App Store and Google Play rejections', icon: ShieldCheckIcon },
  { id: 'website', name: 'Website', label: "Website: your app's home, support and privacy pages", icon: GlobeIcon, belowActions: true },
  { id: 'seo', name: 'SEO', label: "SEO: get your app's website found on Google and in AI answers", icon: SearchCheckIcon, belowActions: true },
];

/**
 * Where the bar ends, for the editor and the views drawn beside it. The bar
 * is 4.5rem wide, and only from md up: phones get no bar.
 */
export const BAR_INSET = { left: 'md:left-[4.5rem]', paddingLeft: 'md:pl-[4.5rem]' } as const;

/** A button on the bar that opens something rather than switching the view. */
export interface ActivityAction {
  id: string;
  /** The accessible name. Tests find the buttons by it. */
  label: string;
  /** The name under the icon, when the accessible name says more (Account adds the person's name). */
  name?: string;
  /** The tooltip, when it says more than the name. */
  title?: string;
  /** An icon, or the account's picture. */
  icon: React.ReactNode;
  onClick: () => void;
}

// 4rem buttons in the 4.5rem bar. A two word name takes two lines. The
// longest word, "screenshots", is 59 pixels wide at 11px in Arial, the app's
// font, and 65 in bold, as the open view's name is drawn. That stays centered,
// within the bar's 4px margin.
const BUTTON =
  'relative flex w-16 shrink-0 flex-col items-center gap-0.5 rounded-md px-0.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';
const IDLE = 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground';

/** The icon over its name. One slot size for every icon, the account's picture too, so the names line up. */
function Face({ icon, name, selected = false, badge }: { icon: React.ReactNode; name: string; selected?: boolean; badge?: React.ReactNode }) {
  return (
    <>
      <span className="relative flex h-6 w-6 items-center justify-center">
        {icon}
        {badge}
      </span>
      <span className={cn('text-center text-[11px] leading-[13px]', selected && 'font-semibold')}>{name}</span>
    </>
  );
}

function ViewButton({ activity, selected, count, onSelect }: { activity: Activity; selected: boolean; count: number; onSelect: (id: ActivityId) => void }) {
  const Icon = activity.icon;
  return (
    <button
      type="button"
      title={activity.label}
      aria-label={activity.label}
      aria-current={selected ? 'page' : undefined}
      onClick={() => onSelect(activity.id)}
      className={cn(BUTTON, selected ? 'text-sidebar-foreground' : IDLE)}
    >
      {/* The mark beside the view on screen, as VS Code draws it, at the bar's own edge. */}
      {selected && <span aria-hidden className="absolute -left-1 top-2 bottom-2 w-0.5 rounded-full bg-primary" />}
      <Face
        icon={<Icon className="h-5 w-5" />}
        name={activity.name}
        selected={selected}
        badge={
          count > 0 && (
            <span
              aria-hidden
              data-testid={`${activity.id}-badge`}
              className="absolute -right-3 -top-1.5 min-w-[1.1rem] rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white ring-2 ring-sidebar"
            >
              {count > 9 ? '9+' : count}
            </span>
          )
        }
      />
    </button>
  );
}

function ActionButton({ action }: { action: ActivityAction }) {
  return (
    <button type="button" title={action.title ?? action.label} aria-label={action.label} onClick={action.onClick} className={cn(BUTTON, IDLE)}>
      <Face icon={action.icon} name={action.name ?? action.label} />
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
        // Scrolls rather than cutting off About in a window too short for
        // every button. The scroll bar is hidden, as everywhere in the app.
        'z-20 w-[4.5rem] shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r bg-sidebar py-2 text-sidebar-foreground [scrollbar-width:none]',
        // The dev server draws Next's own badge over the bottom left corner,
        // where About would sit under it. Release builds have no badge.
        process.env.NODE_ENV === 'development' && 'pb-16',
        className
      )}
      data-testid="activity-bar"
    >
      {ACTIVITIES.filter((activity) => !activity.belowActions).map((activity) => (
        <ViewButton key={activity.id} activity={activity} selected={activity.id === active} count={badges[activity.id] ?? 0} onSelect={onSelect} />
      ))}
      {actions.length > 0 && <span aria-hidden className="my-1 h-px w-8 shrink-0 bg-sidebar-border" />}
      {actions.map((action) => (
        <ActionButton key={action.id} action={action} />
      ))}
      {ACTIVITIES.filter((activity) => activity.belowActions).map((activity) => (
        <ViewButton key={activity.id} activity={activity} selected={activity.id === active} count={badges[activity.id] ?? 0} onSelect={onSelect} />
      ))}
      {bottomActions.length > 0 && (
        <div className="mt-auto flex flex-col items-center gap-0.5">
          {bottomActions.map((action) => (
            <ActionButton key={action.id} action={action} />
          ))}
        </div>
      )}
    </nav>
  );
}
