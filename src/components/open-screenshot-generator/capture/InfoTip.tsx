"use client";

// A small (i) button beside a heading or a setting in Capture. Pointing at it,
// or reaching it with the Tab key, shows the longer explanation, so the panel
// itself stays short. A click opens it too, for anyone who clicks instead of
// pointing. The text is drawn in a portal on the page's body, so neither the
// scrolling sidebar nor the popover the button sits in can cut it off or move it.

import React, { useState } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { InfoIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            // The tooltip closes on a click unless the click is marked handled.
            onClick={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
            // Focus from the Tab key opens the tooltip. Focus a script moves here,
            // such as a popover's first focus, does not.
            onFocus={(event) => {
              if (!event.currentTarget.matches(':focus-visible')) event.preventDefault();
            }}
            className={cn(
              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className
            )}
          >
            <InfoIcon className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipPrimitive.Portal>
          <TooltipContent side="right" align="start" collisionPadding={12} className="max-w-[280px] space-y-1.5 text-xs leading-relaxed">
            {children}
          </TooltipContent>
        </TooltipPrimitive.Portal>
      </Tooltip>
    </TooltipProvider>
  );
}
