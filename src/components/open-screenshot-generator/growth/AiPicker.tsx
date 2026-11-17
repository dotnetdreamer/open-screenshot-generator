"use client";

// The AI that answers, as the editor's Agent tab offers it: Claude Code or
// Codex on the user's own plan, or the provider set up in the AI panel. It is
// one setting (`aiWriter` in growth/settings.ts) for every AI job in Growth
// and in the Store compliance view, so a choice made in either holds in both.

import React from 'react';
import { SparklesIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ClaudeCodeLogo } from '../agent/ClaudeCodeLogo';
import { CodexLogo } from '../agent/CodexLogo';
import { AssistantAvatar } from './GrowthAssistantChat';

export type AiChoice = 'claude' | 'codex' | 'panel';

const AI_CHOICES: Array<{ id: AiChoice; name: string }> = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'panel', name: 'AI panel' },
];

export function AiLogo({ choice, tile = false, className }: { choice: AiChoice | null; tile?: boolean; className?: string }) {
  if (choice === 'claude') return <ClaudeCodeLogo tile={tile} className={className} />;
  if (choice === 'codex') return <CodexLogo tile={tile} className={className} />;
  return tile ? <AssistantAvatar className={className} /> : <SparklesIcon className={cn('text-[hsl(var(--growth-assistant))]', className)} />;
}

/** The switch between the three. A choice that cannot answer yet says why where the picker is used. */
export function AiPicker({ value, onPick, title }: { value: AiChoice | null; onPick: (choice: AiChoice) => void; title: string }) {
  return (
    <div
      role="radiogroup"
      aria-label="AI to use"
      className="flex rounded-lg border bg-muted/30 p-0.5"
      title={title}
    >
      {AI_CHOICES.map((choice) => (
        <button
          key={choice.id}
          type="button"
          role="radio"
          aria-checked={value === choice.id}
          onClick={() => onPick(choice.id)}
          className={cn(
            'inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
            value === choice.id ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <AiLogo choice={choice.id} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{choice.name}</span>
        </button>
      ))}
    </div>
  );
}
