"use client";

// Startup tips: a small wizard that opens with the app and keeps opening until
// the user unticks the box in its footer.
//
// It covers the two habits that save the most rework: one project for each
// device, rather than one project holding iPhone, iPad and Android at once, and
// a copy of the work kept somewhere other than this computer.
//
// Add a tip by appending to TIPS. The wizard sizes itself to the list.

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloudUploadIcon,
  DownloadIcon,
  FileJsonIcon,
  HardDriveUploadIcon,
  LayersIcon,
  LightbulbIcon,
  SmartphoneIcon,
  TabletIcon,
  LaptopIcon,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { isTauri } from '@/lib/desktop';
import { cn } from '@/lib/utils';

const SHOW_ON_STARTUP_KEY = 'open-screenshot-generator.show-startup-tips';

/**
 * Whether the wizard should open with the app. Unset counts as yes, so a first
 * visit sees the tips; storage being unavailable counts as no, because an
 * opt-out could not be remembered and the dialog would return on every load.
 */
export function shouldShowTipsOnStartup(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SHOW_ON_STARTUP_KEY) !== '0';
  } catch {
    return false;
  }
}

/**
 * The same preference the wizard's own checkbox writes. Exported because the
 * settings dialog offers it too, and both have to agree on the storage key.
 */
export function setShowTipsOnStartup(show: boolean): void {
  try {
    window.localStorage.setItem(SHOW_ON_STARTUP_KEY, show ? '1' : '0');
  } catch {
    // Private mode with storage blocked. The choice holds for this session.
  }
}

interface TipContext {
  /** Opens the account dialog, where the storage providers are connected. */
  onConnectStorage?: () => void;
  /** The desktop app keeps projects on the computer, with no browser to speak of. */
  desktop: boolean;
  /** A finger has no right-click, so the tab menu opens with a long press. */
  touch: boolean;
}

interface Tip {
  id: string;
  icon: LucideIcon;
  title: string;
  /** One sentence, rendered as the dialog's accessible description. */
  lead: (ctx: TipContext) => string;
  body: (ctx: TipContext) => React.ReactNode;
}

/**
 * A toolbar button drawn inside a sentence, so the reader knows which icon to
 * look for. Screen readers skip it, because the sentence names the button.
 */
function ToolbarIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      className="mx-0.5 inline-flex h-5 w-6 items-center justify-center rounded-md border bg-background align-middle text-foreground shadow-sm"
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

/** The name of a tab, menu item or button, as the reader will see it on screen. */
function Control({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

/** Example project names for the first tip, with the screenshot size each device needs. */
const SIZE_EXAMPLES: { icon: LucideIcon; name: string; size: string }[] = [
  { icon: SmartphoneIcon, name: 'iPhone', size: '1206 × 2622' },
  { icon: TabletIcon, name: 'iPad 13-inch', size: '2064 × 2752' },
  { icon: SmartphoneIcon, name: 'Android phone', size: '1080 × 1920' },
  { icon: TabletIcon, name: '10-inch tablet', size: '1440 × 2560' },
  { icon: LaptopIcon, name: 'Mac', size: '2560 × 1600' },
];

const TIPS: Tip[] = [
  {
    id: 'one-project-per-size',
    icon: LayersIcon,
    title: 'One design for every device',
    lead: () => 'Make your screenshots once, and the app lays them out again for iPad, Android and Mac.',
    body: ({ touch }) => (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          The App Store and Google Play want a different screenshot size for each device.{' '}
          {touch ? 'Tap' : 'Click'} the phone button <ToolbarIcon icon={SmartphoneIcon} /> in the toolbar
          and choose <Control>Every device</Control> to see your screenshots on each one. Turn on
          Export next to a device there to get its screenshots too.
        </p>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="mb-1.5 text-xs text-muted-foreground">For example:</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {SIZE_EXAMPLES.map((example) => (
              <li key={example.name} className="flex min-w-0 items-center gap-2">
                <example.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium">{example.name}</span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {example.size}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Want to change the iPad screenshots by hand? In <Control>Every device</Control>, pick{' '}
          <Control>iPad 13-inch</Control> and choose <Control>Make an iPad 13-inch project</Control>. Your
          iPhone project stays the same.
        </p>
      </div>
    ),
  },
  {
    id: 'never-lose-work',
    icon: CloudUploadIcon,
    title: 'Keep a copy so you never lose work',
    lead: ({ desktop }) =>
      desktop ? 'Your projects are saved only on this computer.' : 'Your projects are saved only in this browser.',
    body: ({ onConnectStorage, desktop, touch }) => (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {desktop
            ? 'If this computer breaks, your projects are lost.'
            : 'If you clear your browser data, your projects are deleted.'}{' '}
          Got a new computer? Your projects stay on the old one. Two ways to keep a copy:
        </p>
        <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-start gap-2">
            <HardDriveUploadIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <Control>Your own Google Drive or GitHub.</Control> Connect your account once. Then{' '}
              {touch ? 'tap' : 'click'} the Save button <ToolbarIcon icon={CloudUploadIcon} /> in the toolbar and
              choose <Control>To your own storage</Control> whenever you finish working. Google
              Drive keeps videos too, but GitHub can&apos;t save a project that has videos.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <FileJsonIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <Control>A project file.</Control> No sign-in needed. {touch ? 'Tap' : 'Click'} the Export button{' '}
              <ToolbarIcon icon={DownloadIcon} /> in the toolbar, choose{' '}
              <Control>Project file</Control>, and keep the file somewhere safe.
            </p>
          </div>
        </div>
        {onConnectStorage && (
          <Button variant="outline" size="sm" onClick={onConnectStorage}>
            <CloudUploadIcon className="mr-1.5 h-3.5 w-3.5" />
            Connect Google Drive or GitHub
          </Button>
        )}
      </div>
    ),
  },
];

interface TipsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to the account dialog by the layout. Omitted, the button is hidden. */
  onConnectStorage?: () => void;
}

export function TipsDialog({ open, onOpenChange, onConnectStorage }: TipsDialogProps) {
  const [index, setIndex] = useState(0);
  const [showOnStartup, setShowOnStartup] = useState(true);
  const advanceRef = useRef<HTMLButtonElement>(null);

  // Reopening always starts at the first tip, and the box reflects what is
  // actually stored (localStorage is only readable after mount).
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setShowOnStartup(shouldShowTipsOnStartup());
  }, [open]);

  const tip = TIPS[Math.min(index, TIPS.length - 1)];
  const isLast = index >= TIPS.length - 1;
  const TipIcon = tip.icon;
  const touch = useCoarsePointer();
  // The dialog only renders open, which happens after mount, so the server
  // render never reaches this.
  const ctx: TipContext = { onConnectStorage, desktop: isTauri(), touch };

  // Persist on change rather than on close: closing with Escape or the X still
  // has to honour an unticked box.
  const handleShowOnStartupChange = (next: boolean) => {
    setShowOnStartup(next);
    setShowTipsOnStartup(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Radix would focus the first tabbable child, which is a step dot:
          // the wizard opened with a focus ring on a 6px dot and Enter jumped
          // pages. Put it on the button that walks the wizard instead.
          event.preventDefault();
          advanceRef.current?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex items-start gap-3 pr-6 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TipIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <LightbulbIcon className="h-3 w-3" />
                Tip {index + 1} of {TIPS.length}
              </p>
              <DialogTitle className="mt-1.5">{tip.title}</DialogTitle>
              <DialogDescription className="mt-1.5">{tip.lead(ctx)}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {tip.body(ctx)}

        {TIPS.length > 1 && (
          <div className="flex items-center justify-center gap-1.5">
            {TIPS.map((entry, i) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Tip ${i + 1}, ${entry.title}`}
                aria-current={i === index}
                className={cn(
                  'h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  i === index ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60'
                )}
              />
            ))}
          </div>
        )}

        <DialogFooter className="mt-1 flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
          <div className="flex items-center gap-2">
            <Checkbox
              id="tips-show-on-startup"
              checked={showOnStartup}
              onCheckedChange={(value) => handleShowOnStartupChange(value === true)}
            />
            <Label htmlFor="tips-show-on-startup" className="text-sm font-normal text-muted-foreground">
              Show these tips when I open the app
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index === 0}
            >
              <ArrowLeftIcon className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>
            {/* One button that changes label, not two: swapping elements on the
                last step would drop focus, and Enter should walk the whole
                wizard and then close it. */}
            <Button
              ref={advanceRef}
              size="sm"
              onClick={() => (isLast ? onOpenChange(false) : setIndex((current) => current + 1))}
            >
              {isLast ? (
                'Got it'
              ) : (
                <>
                  Next
                  <ArrowRightIcon className="ml-1.5 h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
