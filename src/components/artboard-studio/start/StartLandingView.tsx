"use client";

import React from 'react';
import { ArrowRight, FilePlus2, LayoutTemplate, Sparkles } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Size } from '@/types/artboard';

interface StartLandingViewProps {
  templateCount: number;
  isLoadingTemplates: boolean;
  blankSize: Size;
  onChooseTemplates: () => void;
  onStartAgent: () => void;
  onStartBlank: () => void;
}

/**
 * The three ways into a project. The AI path is the hero: full width, its own
 * gradient shell, and the only card with a primary button.
 */
export function StartLandingView({
  templateCount,
  isLoadingTemplates,
  blankSize,
  onChooseTemplates,
  onStartAgent,
  onStartBlank,
}: StartLandingViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onStartAgent}
        className={cn(
          'group relative w-full overflow-hidden rounded-xl p-[1.5px] text-left',
          'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400',
          'transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        )}
      >
        <div className="relative flex flex-col gap-5 rounded-[10px] bg-background p-6 sm:flex-row sm:items-center sm:gap-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-fuchsia-500/10 blur-3xl transition-opacity group-hover:opacity-150"
          />
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-semibold tracking-tight">Start with the AI agent</h3>
              <span className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                New
              </span>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Upload your app screenshots and say what you want. The agent picks a template, drops
              your screens into the mockups and rewrites the copy. Bring your own API key, or use the
              free Claude, ChatGPT or Gemini account you already have.
            </p>
          </div>
          {/* A span, not a Button: the whole card is already a <button>, and a
              nested one is invalid HTML that trips React's hydration check. */}
          <span
            className={cn(
              buttonVariants({ size: 'lg' }),
              'w-full shrink-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white sm:w-auto'
            )}
          >
            Open the agent
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </button>

      <div className="grid gap-4 sm:grid-cols-2">
        <SecondaryCard
          icon={<LayoutTemplate className="h-5 w-5" />}
          title="Choose a template"
          description={
            isLoadingTemplates
              ? 'Loading the template library...'
              : `${templateCount} ready made layouts for the App Store, Apple Watch and Google Play.`
          }
          actionLabel="Browse templates"
          onClick={onChooseTemplates}
        />
        <SecondaryCard
          icon={<FilePlus2 className="h-5 w-5" />}
          title="Start blank"
          description={`An empty ${blankSize.width} x ${blankSize.height} artboard. Build it your way.`}
          actionLabel="New blank project"
          onClick={onStartBlank}
        />
      </div>
    </div>
  );
}

function SecondaryCard({
  icon,
  title,
  description,
  actionLabel,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col items-start gap-3 rounded-xl border bg-card p-5 text-left',
        'transition-colors hover:border-primary/40 hover:bg-accent/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
        {icon}
      </div>
      <div className="flex-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <span className="inline-flex items-center text-sm font-medium text-primary">
        {actionLabel}
        <ArrowRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
