"use client";

// Ask AI on the Website view: the developer says what to change, the AI
// changes the site (src/lib/website/ai.ts), and the preview beside it shows
// the change at once. The newest change can be undone. When the AI needs
// something it does not know, such as an email address, it asks, and the
// answer goes in the same box.

import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpIcon, Loader2Icon, SparklesIcon, SquareIcon, Undo2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SiteChatItem } from '@/lib/website/store';
import { cn } from '@/lib/utils';
import { SiteTextarea } from './WebsiteShared';
import { Gated } from '../growth/GrowthShared';
import type { AiStatus } from './WebsiteShared';

const EXAMPLES = [
  'Make the headline shorter and friendlier',
  'Add a question about restoring purchases',
  'We use Firebase Analytics and Crashlytics',
  'Make the colors match our blue, #1a73e8',
];

export function WebsiteChat({
  chat,
  ai,
  busy,
  fingerprint,
  onSend,
  onStop,
  onUndo,
}: {
  chat: SiteChatItem[];
  ai: AiStatus;
  /** An answer is on its way. */
  busy: boolean;
  /** The site as it is now (siteFingerprint), to offer Undo only while nothing changed since the answer. */
  fingerprint: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onUndo: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const newest = [...chat].reverse().find((item) => item.role === 'assistant');
  const lastWithUndo = newest?.before && newest.after === fingerprint ? newest.id : undefined;

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, busy]);

  const send = (value: string) => {
    const message = value.trim();
    if (!message || busy || !ai.available) return;
    onSend(message);
    setText('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {chat.length === 0 ? (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--growth-assistant))]/15 text-[hsl(var(--growth-assistant))]">
                <SparklesIcon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Tell the AI what to change</p>
                <p className="text-xs text-muted-foreground">{ai.available ? `${ai.label ?? 'The AI'} changes the site, and the preview shows it` : ai.reason}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={!ai.available || busy}
                  onClick={() => send(example)}
                  className="block w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.map((item) =>
            item.role === 'user' ? (
              <div key={item.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">{item.text}</p>
              </div>
            ) : (
              <div key={item.id} className="flex gap-2" data-testid="site-chat-answer">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--growth-assistant))]/15 text-[hsl(var(--growth-assistant))]">
                  <SparklesIcon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 max-w-[90%] space-y-1.5">
                  <p className={cn('whitespace-pre-wrap rounded-2xl rounded-tl-md bg-muted px-3 py-2 text-sm', item.failed && 'bg-destructive/10 text-destructive')}>{item.text}</p>
                  {(item.changed?.length || item.refused?.length) ? (
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      {item.changed?.map((field) => (
                        <span key={field} className="rounded-full bg-[hsl(var(--growth-good))]/10 px-2 py-0.5 text-[hsl(var(--growth-good))]">
                          {field}
                        </span>
                      ))}
                      {item.refused?.length ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-800 dark:text-amber-300" title="The site turned these down: too long, or naming an address you didn't give">
                          Left as they were: {item.refused.join(', ')}
                        </span>
                      ) : null}
                      {item.id === lastWithUndo && item.before && (
                        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => onUndo(item.id)}>
                          <Undo2Icon className="h-3 w-3" />
                          Undo
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            {ai.label ?? 'The AI'} is working on it
          </div>
        )}
      </div>
      <form
        className="border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send(text);
        }}
      >
        <div className="relative">
          <SiteTextarea
            aria-label="Ask for a change"
            value={text}
            rows={2}
            disabled={!ai.available}
            placeholder={ai.available ? 'Ask for a change, or answer the AI' : ai.reason ?? 'Set up an AI first'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send(text);
              }
            }}
            className="min-h-[64px] resize-none pr-12 text-sm"
          />
          <div className="absolute bottom-2 right-2">
            {busy ? (
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={onStop} aria-label="Stop" title="Stop the AI">
                <SquareIcon className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Gated reason={ai.available ? null : ai.reason}>
                <Button type="submit" size="icon" className="h-8 w-8" disabled={!text.trim()} aria-label="Send" title="Send">
                  <ArrowUpIcon className="h-4 w-4" />
                </Button>
              </Gated>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
