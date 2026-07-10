"use client";

import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AgentPromoBannerProps {
  onStartAgent: () => void;
}

/**
 * The AI entry point, sitting above the template tabs in the start dialog.
 *
 * It shares that screen with the gallery rather than replacing it: templates
 * stay visible and one click away, which is what most sessions still want.
 */
export function AgentPromoBanner({ onStartAgent }: AgentPromoBannerProps) {
  return (
    <button
      type="button"
      onClick={onStartAgent}
      className={cn(
        'group relative w-full shrink-0 overflow-hidden rounded-xl p-[1.5px] text-left',
        'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      <div className="relative flex flex-col gap-4 rounded-[10px] bg-background px-5 py-4 sm:flex-row sm:items-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-fuchsia-500/10 blur-3xl"
        />
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold tracking-tight">Start with the AI agent</h3>
            <span className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              New
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upload your app screenshots and say what you want. The agent picks a template, drops your
            screens into the mockups and rewrites the copy. Run it free with the built-in providers in
            the desktop app, use the Claude, ChatGPT or Gemini account you already have, or bring your
            own API key.
          </p>
        </div>
        {/* A span, not a Button: the whole banner is already a <button>, and a
            nested one is invalid HTML that trips React's hydration check. */}
        <span
          className={cn(
            buttonVariants(),
            'w-full shrink-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white sm:w-auto'
          )}
        >
          Open the agent
          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
