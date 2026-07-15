"use client";

import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AgentPromoBannerProps {
  onStartAgent: () => void;
}

/**
 * The AI entry point, sitting beside the recent projects at the foot of the
 * start dialog and stacked above the blank-canvas card.
 *
 * It shares the screen with the gallery rather than replacing it: templates
 * stay visible and one click away, which is what most sessions still want.
 */
export function AgentPromoBanner({ onStartAgent }: AgentPromoBannerProps) {
  return (
    <button
      type="button"
      onClick={onStartAgent}
      className={cn(
        'group relative h-full w-full overflow-hidden rounded-xl p-[1.5px] text-left',
        'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      <div className="relative flex h-full items-center gap-3 rounded-[10px] bg-background px-4 py-3">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-fuchsia-500/10 blur-3xl"
        />
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">Start with the AI agent</h3>
            <span className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
              New
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            Upload your screenshots and say what you want. Run it free with the built-in providers,
            your Claude, ChatGPT or Gemini account, or your own API key.
          </p>
        </div>
        {/* A span, not a Button: the whole card is already a <button>, and a
            nested one is invalid HTML that trips React's hydration check. */}
        <span
          className={cn(
            buttonVariants({ size: 'sm' }),
            'shrink-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white'
          )}
        >
          Open the agent
          <ArrowRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
