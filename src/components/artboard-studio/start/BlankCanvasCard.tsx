"use client";

import React from 'react';
import { ArrowRight, PlusIcon } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Size } from '@/types/artboard';

interface BlankCanvasCardProps {
  /** Canvas size of the tab that is currently active in the template picker. */
  size: Size;
  categoryLabel: string;
  onStartBlank: () => void;
}

/** The non-AI entry point, sharing the top row of the start dialog with {@link AgentPromoBanner}. */
export function BlankCanvasCard({ size, categoryLabel, onStartBlank }: BlankCanvasCardProps) {
  return (
    <button
      type="button"
      onClick={onStartBlank}
      className={cn(
        'group relative h-full w-full overflow-hidden rounded-xl border bg-card px-5 py-4 text-left',
        'transition-colors hover:border-foreground/20 hover:bg-accent/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
            <PlusIcon className="h-5 w-5" />
          </div>
          <h3 className="font-semibold tracking-tight">Start with a blank canvas</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          An empty {size.width} × {size.height} artboard sized for {categoryLabel}. Bring your own
          layout and add mockups, text and shapes as you go.
        </p>
        {/* A span, not a Button: the whole card is already a <button>. */}
        <span className={cn(buttonVariants({ variant: 'outline' }), 'mt-auto w-fit')}>
          Start blank
          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
