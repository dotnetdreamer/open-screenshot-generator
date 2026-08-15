"use client";

// Startup tips: a small wizard that opens with the app and keeps opening until
// the user unticks the box in its footer.
//
// It covers the two habits that save the most rework: keeping one project per
// store size instead of one project holding phone, tablet, iOS and Android at
// once, and keeping a copy of the work somewhere other than this browser.
//
// Add a tip by appending to TIPS. The wizard sizes itself to the list.

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloudUploadIcon,
  FileTextIcon,
  LayersIcon,
  LightbulbIcon,
  SmartphoneIcon,
  TabletIcon,
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
}

interface Tip {
  id: string;
  icon: LucideIcon;
  title: string;
  /** One sentence, rendered as the dialog's accessible description. */
  lead: string;
  body: (ctx: TipContext) => React.ReactNode;
}

/** Example project names for tip one, with the size each store slot expects. */
const SIZE_EXAMPLES: { icon: LucideIcon; name: string; size: string }[] = [
  { icon: SmartphoneIcon, name: 'MyApp iPhone', size: '1290 × 2796' },
  { icon: TabletIcon, name: 'MyApp iPad 13-inch', size: '2064 × 2752' },
  { icon: SmartphoneIcon, name: 'MyApp Android phone', size: '1080 × 1920' },
  { icon: TabletIcon, name: 'MyApp Android tablet', size: '1440 × 2560' },
];

const TIPS: Tip[] = [
  {
    id: 'one-project-per-size',
    icon: LayersIcon,
    title: 'One project per store size',
    lead: 'Give phone, tablet, iOS and Android a project each instead of putting them all in one.',
    body: () => (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every store slot wants its own pixel size, and the format buttons in the toolbar
          convert a whole project at once. Keep the sizes apart and publishing each one is a
          quick check and an export. Mix all four into a single project and you rearrange the
          layout by hand every time.
        </p>
        <ul className="grid gap-1.5 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
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
        <p className="text-xs leading-relaxed text-muted-foreground">
          Built one already? Export it as JSON, import it straight back for a fresh copy, rename
          the copy, then switch that copy to the next format.
        </p>
      </div>
    ),
  },
  {
    id: 'never-lose-work',
    icon: CloudUploadIcon,
    title: 'Keep a copy so you never lose work',
    lead: 'Projects live in this browser only, so clearing site data takes them with it.',
    body: ({ onConnectStorage }) => (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nothing is uploaded anywhere by default. Clearing site data, a new machine or a fresh
          browser profile all start you from zero. Connect your own Google Drive or GitHub, then
          use Save to account in the toolbar after each session. The files stay in your storage,
          we never hold them.
        </p>
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-start gap-2">
            <CloudUploadIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Google Drive</span> keeps the whole
              project, uploaded screenshots included.{' '}
              <span className="font-medium text-foreground">GitHub</span> saves it as a private
              gist, which holds the design but not video or media files.
            </p>
          </div>
          <div className="mt-2 flex items-start gap-2">
            <FileTextIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Rather not sign in? The toolbar&apos;s Export menu has Project file, which writes a
              single .json you can keep beside your app&apos;s assets or commit to your own repo.
            </p>
          </div>
        </div>
        {onConnectStorage && (
          <Button variant="outline" size="sm" onClick={onConnectStorage}>
            <CloudUploadIcon className="mr-1.5 h-3.5 w-3.5" />
            Connect storage
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
              <DialogDescription className="mt-1.5">{tip.lead}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {tip.body({ onConnectStorage })}

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
