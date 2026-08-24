"use client";

import React from 'react';
import { ArrowRight, Zap } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface QuickStartPromoCardProps {
  onStart: () => void;
}

/**
 * The fastest way in, sitting at the top of the start dialog's entry column.
 *
 * Deliberately louder than the AI card below it, because it is the one that
 * finishes in seconds and needs nothing but the files somebody already has.
 */
export function QuickStartPromoCard({ onStart }: QuickStartPromoCardProps) {
  return (
    <button
      type="button"
      onClick={onStart}
      className={cn(
        'group relative h-full w-full overflow-hidden rounded-xl border border-primary/40 bg-card px-4 py-3 text-left',
        'transition-colors hover:border-primary hover:bg-accent/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative flex h-full items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Zap className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">Drop your screenshots</h3>
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
              Fastest
            </span>
          </div>
        </div>
        {/* A span, not a Button: the whole card is already a <button>. */}
        <span className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}>
          Start
          <ArrowRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
