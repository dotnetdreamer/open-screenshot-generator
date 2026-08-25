"use client";

import React from 'react';
import { ArrowRight, Shapes } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface GraphicsPromoCardProps {
  onStart: () => void;
}

/**
 * The second entry in the start dialog's column: the same screenshots, but for
 * everywhere the app gets talked about rather than the store listing itself.
 *
 * A span rather than a Button for the call to action, because the whole card is
 * already a <button> and nesting one inside another is invalid.
 */
export function GraphicsPromoCard({ onStart }: GraphicsPromoCardProps) {
  return (
    <button
      type="button"
      onClick={onStart}
      className={cn(
        'group relative h-full w-full overflow-hidden rounded-xl border bg-card px-4 py-3 text-left',
        'transition-colors hover:border-primary/60 hover:bg-accent/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative flex h-full items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/90 text-background shadow-sm">
          <Shapes className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold tracking-tight">Make social graphics</h3>
          <p className="truncate text-xs text-muted-foreground">
            Link previews, posts, stories and banners
          </p>
        </div>
        <span className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'shrink-0')}>
          Start
          <ArrowRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
