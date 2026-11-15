"use client";

// The Ask AI conversation: the messages, the steps the assistant takes in the
// browser, the cards that need the user (a yes before a change, their turn
// in the browser, a key file), and the box they type in. The conversation
// itself lives in src/lib/growth/setup/assistant.ts.

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  FileKeyIcon,
  GlobeIcon,
  HandIcon,
  InfoIcon,
  KeyboardIcon,
  KeyRoundIcon,
  ListIcon,
  Loader2Icon,
  MousePointerClickIcon,
  PaperclipIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareIcon,
  XCircleIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  addKeyFile,
  answerApproval,
  finishWaiting,
  sendMessage,
  stopAssistant,
  type AssistantPhase,
  type ChatItem,
  type StepKind,
} from '@/lib/growth/setup/assistant';
import type { SyncProgress } from '@/lib/growth/types';
import { cn } from '@/lib/utils';
import { Gated } from './GrowthShared';

type StepItem = Extract<ChatItem, { kind: 'step' }>;
type Row = ChatItem | { id: string; kind: 'steps'; steps: StepItem[] };

const STEP_ICON: Record<StepKind, React.ComponentType<{ className?: string }>> = {
  open: GlobeIcon,
  click: MousePointerClickIcon,
  type: KeyboardIcon,
  pick: ListIcon,
  scroll: ArrowDownIcon,
  point: HandIcon,
  read: BookOpenIcon,
};

/** Steps one after another make one block. */
function rows(items: ChatItem[]): Row[] {
  const out: Row[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (item.kind === 'step' && last?.kind === 'steps') last.steps.push(item);
    else if (item.kind === 'step') out.push({ id: `steps-${item.id}`, kind: 'steps', steps: [item] });
    else out.push(item);
  }
  return out;
}

export function AssistantAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[hsl(var(--growth-assistant))] to-[hsl(var(--growth-series))] text-white shadow-sm',
        className
      )}
    >
      <SparklesIcon className="h-3.5 w-3.5" />
    </span>
  );
}

function Steps({ steps }: { steps: StepItem[] }) {
  const [open, setOpen] = useState(false);
  const hidden = steps.length > 4 && !open ? steps.length - 3 : 0;
  const shown = hidden ? steps.slice(-3) : steps;
  return (
    <div className="ml-10 border-l-2 border-[hsl(var(--growth-assistant))]/25 pl-3" data-testid="growth-assistant-steps">
      {hidden > 0 && (
        <button
          type="button"
          className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(true)}
        >
          <ChevronDownIcon className="h-3 w-3" />
          {hidden} earlier {hidden === 1 ? 'step' : 'steps'}
        </button>
      )}
      <ol className="space-y-1">
        {shown.map((step) => {
          const Icon = STEP_ICON[step.step];
          return (
            <li key={step.id} className="flex items-start gap-2 text-xs">
              {step.state === 'running' ? (
                <Loader2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[hsl(var(--growth-assistant))]" />
              ) : step.state === 'failed' ? (
                <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--growth-bad))]" />
              ) : (
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className={cn('min-w-0', step.state === 'running' ? 'text-foreground' : 'text-muted-foreground')}>
                {step.text}
                {step.detail && <span className="block text-[11px] text-[hsl(var(--growth-bad))]">{step.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function readKeyFile(file: File): Promise<void> {
  return file.text().then((content) => {
    const json = file.name.toLowerCase().endsWith('.json') || content.trim().startsWith('{');
    addKeyFile({ kind: json ? 'play-key' : 'apple-key', fileName: file.name, content }, 'user');
  });
}

/** A hidden file box and the way to open it, for key files the user already has. */
export function useKeyFilePicker() {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept=".p8,.json,application/json,application/x-pem-file,text/plain"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void readKeyFile(file);
      }}
    />
  );
  return { element, open: () => input.current?.click() };
}

function Card({ tone = 'plain', icon: Icon, children, className }: { tone?: 'plain' | 'assistant' | 'good' | 'warn'; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'ml-10 flex gap-3 rounded-xl border p-3',
        tone === 'assistant' && 'border-[hsl(var(--growth-assistant))]/40 bg-[hsl(var(--growth-assistant))]/5',
        tone === 'good' && 'border-[hsl(var(--growth-good))]/30 bg-[hsl(var(--growth-good))]/5',
        tone === 'warn' && 'border-amber-500/40 bg-amber-500/5',
        tone === 'plain' && 'bg-card',
        className
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          tone === 'assistant' && 'text-[hsl(var(--growth-assistant))]',
          tone === 'good' && 'text-[hsl(var(--growth-good))]',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
          tone === 'plain' && 'text-muted-foreground'
        )}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function KeyRequest({ item, onPick }: { item: Extract<ChatItem, { kind: 'key-request' }>; onPick: () => void }) {
  const apple = item.fileKind === 'apple';
  return (
    <Card tone={item.state === 'asking' ? 'assistant' : 'plain'} icon={FileKeyIcon}>
      <p className="text-sm font-medium">{apple ? 'Add your .p8 key file' : 'Add your service account key file'}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {apple
          ? 'Choose the AuthKey file you downloaded from App Store Connect, or drop it here. It stays on this computer and the AI never sees it.'
          : 'Choose the JSON key file you downloaded from Google Cloud, or drop it here. It stays on this computer and the AI never sees it.'}
      </p>
      {item.state === 'asking' && (
        <Button size="sm" variant="outline" className="mt-2.5 h-8" onClick={onPick}>
          <PaperclipIcon className="mr-1.5 h-3.5 w-3.5" />
          Choose file
        </Button>
      )}
    </Card>
  );
}

function RefreshCard({ item, progress }: { item: Extract<ChatItem, { kind: 'refresh' }>; progress: SyncProgress | null }) {
  if (item.state === 'running') {
    const share = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 6;
    return (
      <Card icon={RefreshCwIcon}>
        <p className="text-sm font-medium">Loading your numbers</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{progress ? `Reading ${progress.label}` : 'Starting'}</p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-[hsl(var(--growth-assistant))] transition-[width]" style={{ width: `${share}%` }} />
        </div>
      </Card>
    );
  }
  return (
    <Card tone={item.state === 'done' ? 'good' : 'warn'} icon={item.state === 'done' ? CheckCircle2Icon : CircleAlertIcon}>
      <p className="text-sm font-medium">{item.state === 'done' ? 'Numbers loaded' : 'The refresh stopped'}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {item.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Card>
  );
}

export interface AssistantMessagesProps {
  items: ChatItem[];
  phase: AssistantPhase;
  running: boolean;
  progress: SyncProgress | null;
  onPickKeyFile: () => void;
}

export function AssistantMessages({ items, phase, running, progress, onPickKeyFile }: AssistantMessagesProps) {
  const list = rows(items);
  const lastAssistant = [...items].reverse().find((item) => item.kind === 'assistant')?.id;
  const lastItem = items[items.length - 1];
  return (
    <div className="space-y-3" role="log" aria-live="polite" aria-label="Conversation with the assistant">
      {list.map((row) => {
        switch (row.kind) {
          case 'user':
            return (
              <div key={row.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
                  {row.text}
                </p>
              </div>
            );
          case 'assistant':
            return (
              <div key={row.id} className="flex gap-3">
                <AssistantAvatar />
                <div className="min-w-0 flex-1 pt-0.5">
                  {row.text && <p className="whitespace-pre-line text-sm leading-relaxed">{row.text}</p>}
                  {row.choices.length > 0 && row.id === lastAssistant && lastItem?.id === row.id && !running && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {row.choices.map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          className="rounded-full border border-[hsl(var(--growth-assistant))]/40 px-3 py-1 text-xs font-medium text-[hsl(var(--growth-assistant))] transition-colors hover:bg-[hsl(var(--growth-assistant))]/10"
                          onClick={() => sendMessage(choice)}
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          case 'steps':
            return <Steps key={row.id} steps={row.steps} />;
          case 'approval': {
            const where = row.where?.replace(/[?:.\s]+$/, '');
            return row.state === 'asking' ? (
              <Card key={row.id} tone="assistant" icon={ShieldCheckIcon}>
                <p className="text-sm font-medium">
                  Can I {row.verb} &quot;{row.action}&quot;{where ? <> in &quot;{where}&quot;</> : null}?
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  It&apos;s {row.site ? `on ${row.site} and ` : ''}can change your account, so I&apos;m checking with you first.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" className="h-8" onClick={() => answerApproval(row.id, true)}>
                    Yes, {row.verb} it
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => answerApproval(row.id, false)}>
                    I&apos;ll {row.verb} it myself
                  </Button>
                </div>
              </Card>
            ) : (
              <p key={row.id} className="ml-10 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheckIcon className="h-3.5 w-3.5" />
                {row.state === 'allowed' ? `You said yes to "${row.action}"` : `You'll ${row.verb} "${row.action}" yourself`}
              </p>
            );
          }
          case 'waiting':
            return row.state === 'waiting' ? (
              <Card key={row.id} tone="assistant" icon={HandIcon}>
                <p className="text-sm font-medium">Your turn</p>
                <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{row.text}</p>
                <Button size="sm" variant="outline" className="mt-2.5 h-8" onClick={() => finishWaiting(row.id)}>
                  I&apos;m done
                </Button>
              </Card>
            ) : null;
          case 'saved':
            return (
              <Card key={row.id} tone="good" icon={CheckCircle2Icon}>
                <p className="text-sm font-medium">{row.title}</p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{row.detail}</p>
              </Card>
            );
          case 'key-file':
            return (
              <Card key={row.id} icon={KeyRoundIcon}>
                <p className="text-sm font-medium">Got {row.fileName}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.detail}. The key stays on this computer.</p>
              </Card>
            );
          case 'key-request':
            return <KeyRequest key={row.id} item={row} onPick={onPickKeyFile} />;
          case 'refresh':
            return <RefreshCard key={row.id} item={row} progress={progress} />;
          case 'notice':
            return (
              <p
                key={row.id}
                className={cn(
                  'ml-10 flex items-start gap-1.5 text-xs',
                  row.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {row.tone === 'error' ? <CircleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span>{row.text}</span>
              </p>
            );
        }
      })}
      {running && (phase === 'thinking' || phase === 'reading') && (
        <div className="flex items-center gap-3" data-testid="growth-assistant-thinking">
          <AssistantAvatar className="opacity-80" />
          <span className="flex items-center gap-1" aria-hidden>
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-[hsl(var(--growth-assistant))]"
                style={{ animationDelay: `${dot * 140}ms` }}
              />
            ))}
          </span>
          <span className="text-xs text-muted-foreground">{phase === 'reading' ? 'Reading the page' : 'Thinking'}</span>
        </div>
      )}
    </div>
  );
}

export interface AssistantComposerProps {
  reason: string | null;
  running: boolean;
  placeholder: string;
  onPickKeyFile: () => void;
  /** Text to start the box with, such as a question from an insight card. */
  initial?: string;
}

/**
 * What the user typed and has not sent. The composer goes whenever the screen
 * does (another section, the editor), and the words wait here for it.
 */
let unsent = '';

export function AssistantComposer({ reason, running, placeholder, onPickKeyFile, initial }: AssistantComposerProps) {
  const [draft, setDraftState] = useState(initial ?? unsent);
  const setDraft = (value: string) => {
    unsent = value;
    setDraftState(value);
  };
  const box = useRef<HTMLTextAreaElement>(null);

  // The box grows with what is typed, up to about six lines.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 150)}px`;
  }, [draft]);

  const send = () => {
    if (reason || !draft.trim()) return;
    sendMessage(draft);
    setDraft('');
  };

  return (
    <div className="rounded-2xl border bg-card shadow-sm transition-shadow focus-within:border-[hsl(var(--growth-assistant))]/50 focus-within:shadow-[0_0_0_3px_hsl(var(--growth-assistant)/0.12)]">
      <textarea
        ref={box}
        value={draft}
        rows={1}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
        placeholder={placeholder}
        aria-label="Your message"
        className="block max-h-[150px] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm outline-none [font-family:inherit] placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs text-muted-foreground"
          onClick={onPickKeyFile}
          title="Add a .p8 or service account key file you already have. The AI never sees it"
        >
          <PaperclipIcon className="mr-1 h-3.5 w-3.5" />
          Add a key file
        </Button>
        <span className="ml-auto" />
        {running ? (
          <Button size="icon" variant="outline" className="h-8 w-8 shrink-0 rounded-full" onClick={stopAssistant} title="Stop">
            <SquareIcon className="h-3 w-3 fill-current" />
          </Button>
        ) : (
          <Gated reason={reason}>
            <Button size="icon" className="h-8 w-8 shrink-0 rounded-full" aria-label="Send" disabled={!draft.trim()} onClick={send}>
              <ArrowUpIcon className="h-4 w-4" />
            </Button>
          </Gated>
        )}
      </div>
    </div>
  );
}

/** Drop a key file anywhere on the conversation. */
export function useKeyFileDrop() {
  const [over, setOver] = useState(false);
  const handlers = {
    onDragOver: (event: React.DragEvent) => {
      if (!Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      setOver(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setOver(false);
    },
    onDrop: (event: React.DragEvent) => {
      const file = event.dataTransfer.files?.[0];
      setOver(false);
      if (!file) return;
      event.preventDefault();
      void readKeyFile(file);
    },
  };
  return { over, handlers };
}
