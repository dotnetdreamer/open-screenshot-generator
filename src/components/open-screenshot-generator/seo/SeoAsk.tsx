"use client";

// Ask AI about the site: the AI gets the latest check, Google's numbers when
// they're connected and claude-seo's notes, and answers in plain words. One
// conversation per site, kept for the sitting (src/lib/seo/chat.ts).

import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpIcon, Loader2Icon, RotateCcwIcon, SquareIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { openExternal } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { setGrowthSettings, useGrowthSettings } from '@/lib/growth/settings';
import { askSeoQuestion, clearSeoChat, stopSeoChat, useSeoChat, type ChatItem } from '@/lib/seo/chat';
import { analyticsOf, searchOf } from '@/lib/seo/state';
import { AiLogo, AiPicker, type AiChoice } from '../growth/AiPicker';
import { Gated } from '../growth/GrowthShared';
import { RulesMarkdown, useMarkdown } from '../storeCompliance/RulesMarkdown';
import { useSeoView } from './SeoShared';

function Answer({ item }: { item: ChatItem }) {
  const blocks = useMarkdown(item.text);
  if (item.failed) return <p className="text-sm text-[hsl(var(--rules-critical))]">{item.text}</p>;
  return <RulesMarkdown blocks={blocks} onLink={(href) => void openExternal(href)} />;
}

export function SeoAsk() {
  const view = useSeoView();
  const chat = useSeoChat();
  const [settings] = useGrowthSettings();
  const site = view.site;
  const [text, setText] = useState(view.options.question ?? '');
  const list = useRef<HTMLDivElement>(null);
  const items = site ? chat.bySite[site.id] ?? [] : [];
  const pending = Boolean(site && chat.pendingFor === site.id);
  const aiChoice: AiChoice | null = settings.aiWriter && settings.aiWriter !== 'auto' ? settings.aiWriter : view.ai.inUse;

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [items.length, pending]);

  const send = (question: string) => {
    if (!site || !question.trim() || pending) return;
    void askSeoQuestion(site.id, site.name, question);
    setText('');
  };

  const suggestions = [
    'What should I fix first, and why?',
    view.run?.mode === 'draft' ? 'Is my site ready to publish?' : 'Why might my site not show up on Google yet?',
    'How do I get my app into ChatGPT and Perplexity answers?',
    searchOf(view.site?.id ?? null, view.state) ? 'Which searches could I win with a little work?' : 'What would connecting Search Console show me?',
  ];

  const reason = !site ? 'Add a site first' : view.ai.available ? null : view.ai.reason;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 md:p-6">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <AiLogo choice={aiChoice} tile className="h-12 w-12" />
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Ask about {site?.name ?? 'your site'}</h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  {view.run ? 'The AI reads the latest check' : 'Check your site first for better answers. The AI reads the check'}
                  {searchOf(view.site?.id ?? null, view.state) || analyticsOf(view.site?.id ?? null, view.state) ? ' and your Google numbers' : ''}, then answers in plain words.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((suggestion) => (
                  <Gated key={suggestion} reason={reason}>
                    <button type="button" className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--seo-accent))]/40 hover:text-foreground" onClick={() => send(suggestion)}>
                      {suggestion}
                    </button>
                  </Gated>
                ))}
              </div>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className={cn('flex gap-3', item.role === 'user' && 'justify-end')}>
                {item.role === 'ai' && <AiLogo choice={aiChoice} tile className="mt-0.5 h-7 w-7 shrink-0" />}
                <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5', item.role === 'user' ? 'bg-[hsl(var(--seo-accent))]/10 text-sm' : 'border bg-card')}>
                  {item.role === 'user' ? <p className="whitespace-pre-wrap text-sm">{item.text}</p> : <Answer item={item} />}
                </div>
              </div>
            ))
          )}
          {pending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              {view.ai.label ?? 'The AI'} is reading your site check
            </div>
          )}
        </div>
      </div>
      <div className="border-t bg-background/95 p-3">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-[350px] max-w-full">
              <AiPicker value={aiChoice} onPick={(choice) => setGrowthSettings({ aiWriter: choice })} title="The AI for SEO, Growth and Store compliance, one choice for all three" />
            </div>
            {items.length > 0 && site && (
              <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1.5 text-xs text-muted-foreground" onClick={() => clearSeoChat(site.id)}>
                <RotateCcwIcon className="h-3.5 w-3.5" />
                New conversation
              </Button>
            )}
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send(text);
            }}
          >
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send(text);
                }
              }}
              placeholder={site ? `Ask about ${site.name}` : 'Add a site first'}
              aria-label="Your question"
              rows={2}
              className="min-h-[44px] flex-1 resize-none font-sans text-sm"
              disabled={!site}
            />
            {pending ? (
              <Button type="button" size="icon" variant="outline" className="h-10 w-10 shrink-0" onClick={stopSeoChat} aria-label="Stop" title="Stop">
                <SquareIcon className="h-4 w-4" />
              </Button>
            ) : (
              <Gated reason={reason}>
                <Button type="submit" size="icon" className="h-10 w-10 shrink-0 bg-[hsl(var(--seo-accent))] text-white hover:bg-[hsl(var(--seo-accent))]/90 dark:text-background" disabled={!text.trim()} aria-label="Send" title="Send">
                  <ArrowUpIcon className="h-4 w-4" />
                </Button>
              </Gated>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
