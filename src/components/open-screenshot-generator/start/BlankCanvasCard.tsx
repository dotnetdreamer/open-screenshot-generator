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

/** The non-AI entry point, stacked under {@link AgentPromoBanner} beside the recent projects. */
export function BlankCanvasCard({ size, categoryLabel, onStartBlank }: BlankCanvasCardProps) {
  return (
    <button
      type="button"
      onClick={onStartBlank}
      className={cn(
        'group relative h-full w-full overflow-hidden rounded-xl border bg-card px-4 py-3 text-left',
        'transition-colors hover:border-foreground/20 hover:bg-accent/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      <div className="flex h-full items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
          <PlusIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold tracking-tight">Start with a blank canvas</h3>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            An empty {size.width} × {size.height} artboard sized for {categoryLabel}.
          </p>
        </div>
        {/* A span, not a Button: the whole card is already a <button>. */}
        <span className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}>
          Start blank
          <ArrowRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
