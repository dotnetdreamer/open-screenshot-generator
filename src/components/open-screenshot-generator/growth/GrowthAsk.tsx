"use client";

// Questions about the app's numbers, answered by the AI the user set up, from
// the same digest the agent's get_store_overview tool returns. With the Claude
// Code or Codex agent available, the same question can go there instead, where
// the answer can turn straight into work on the screenshots.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BotIcon, Loader2Icon, SendIcon, SparklesIcon, UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { askAboutGrowth, type AskTurn } from '@/lib/growth/ai';
import { today } from '@/lib/growth/dates';
import { buildDigest } from '@/lib/growth/digest';
import { cn } from '@/lib/utils';
import { Gated, Panel, useGrowthView } from './GrowthShared';

const STARTERS = [
  'Did my new screenshots work?',
  'Why did downloads change over the last two weeks?',
  'Which language should I translate the screenshots into next?',
  'What are people complaining about in their reviews?',
  'Where do most of my downloads come from?',
];

export function GrowthAsk() {
  const view = useGrowthView();
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [draft, setDraft] = useState(view.tabOptions.question ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const digest = useMemo(
    () =>
      buildDigest({
        appId: view.app.id,
        appName: view.app.name,
        records: view.data.records,
        reviews: view.data.reviews,
        ratings: view.data.ratings,
        events: view.data.events,
        insights: view.insights,
        listing: view.data.listing,
        listingIssues: view.listingIssues,
        today: today(),
      }),
    [view.app, view.data, view.insights, view.listingIssues]
  );

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    const history = turns;
    setTurns([...history, { role: 'user', text }]);
    controller.current = new AbortController();
    try {
      const answer = await askAboutGrowth({ question: text, digest, history, signal: controller.current.signal });
      setTurns((list) => [...list, { role: 'assistant', text: answer }]);
    } catch (failure) {
      if (controller.current?.signal.aborted) return;
      console.error('Growth question failed', failure);
      setError(failure instanceof Error ? failure.message : 'No answer came back. Try again');
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };

  // A question handed over from an insight card is asked straight away.
  useEffect(() => {
    if (started.current || !view.tabOptions.question || !view.aiAvailable) return;
    started.current = true;
    void ask(view.tabOptions.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy]);

  useEffect(() => () => controller.current?.abort(), []);

  const agentReason =
    view.blocked.app ??
    (view.onAskAgent ? null : view.agentUnavailable ?? 'To ask the agent, install Claude Code or Codex and sign in');

  return (
    <div className="flex h-full min-h-[480px] flex-col gap-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {turns.length === 0 && (
          <Panel>
            <p className="text-sm font-medium">{view.app.id ? `Ask about ${view.app.name}` : 'Ask about your app'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {view.aiLabel
                ? `${view.aiLabel} answers using your numbers, reviews, store page and timeline.`
                : 'The AI answers using your numbers, reviews, store page and timeline.'}
            </p>
            {view.blocked.ai && <p className="mt-1 text-xs text-muted-foreground">{view.blocked.ai}.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="rounded-full border px-3 py-1 text-left text-xs hover:bg-muted"
                  onClick={() => (view.aiAvailable ? void ask(starter) : setDraft(starter))}
                >
                  {starter}
                </button>
              ))}
            </div>
          </Panel>
        )}
        {turns.map((turn, index) => (
          <div key={index} className={cn('flex gap-2', turn.role === 'user' && 'justify-end')}>
            {turn.role === 'assistant' && <BotIcon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm',
                turn.role === 'user' ? 'bg-foreground text-background' : 'border bg-card'
              )}
            >
              {turn.text}
            </div>
            {turn.role === 'user' && <UserIcon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            Reading the numbers
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div ref={bottom} />
      </div>

      <div className="space-y-2 rounded-lg border bg-card p-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about your downloads, reviews or store page"
          rows={2}
          className="resize-none border-0 text-sm shadow-none focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (view.aiAvailable) void ask(draft);
            }
          }}
          aria-label="Your question"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Gated reason={agentReason}>
            <Button
              variant="outline"
              size="sm"
              disabled={!draft.trim() && turns.length === 0}
              onClick={() => view.onAskAgent?.(draft.trim() || turns.filter((turn) => turn.role === 'user').pop()?.text || '')}
              title="Send the question to the agent. The agent can read your numbers and change your screenshots"
            >
              <BotIcon className="mr-1.5 h-4 w-4" />
              Ask the agent
            </Button>
          </Gated>
          {busy ? (
            <Button size="sm" variant="ghost" onClick={() => controller.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Gated reason={view.blocked.ai}>
              <Button size="sm" disabled={!draft.trim()} onClick={() => void ask(draft)}>
                <SendIcon className="mr-1.5 h-4 w-4" />
                Ask
              </Button>
            </Gated>
          )}
        </div>
      </div>
    </div>
  );
}
