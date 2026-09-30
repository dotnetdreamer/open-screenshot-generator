"use client";

// The Agent tab of the right dock: the Claude Code conversation and the box that
// keeps it going.
//
// A view only, like every panel RightDockPanels holds: it renders the snapshot
// it is given and reports what the user did through the handlers. The editor
// owns the process. That is what lets the same component sit in the dock and in
// a detached window on another display (rule 29 in AGENTS.md).

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  Crosshair,
  EyeOff,
  History,
  ImagePlus,
  Info,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Square,
  SquarePen,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { readScreenshotFile } from '@/lib/ai/imageUtils';
import { saveImageAsset } from '@/lib/mcp/assetStore';
import { useImageSrc } from '@/lib/mediaStore';
import { toolLabel } from '@/lib/claudeCode/toolLabels';
import { CLAUDE_MODEL_CHOICES, type AgentItem, type ClaudeModelChoice } from '@/lib/claudeCode/types';
import type { AgentAttachment, AgentPanelView } from '@/lib/claudeCode/view';
import { RunHistoryDialog } from '../start/RunHistoryDialog';
import { AgentMarkdown } from './AgentMarkdown';
import { ClaudeCodeLogo } from './ClaudeCodeLogo';
import { ClaudeCodeSetup, accountLine, readinessOf } from './ClaudeCodeSetup';

export interface AgentPanelHandlers {
  onSend: (text: string, attachments: AgentAttachment[]) => void;
  onStop: () => void;
  onNewChat: () => void;
  onDetect: () => void;
  onSetModel: (model: ClaudeModelChoice) => void;
  onHide: () => void;
  /** Open a web link. The editor window does it for a detached one. */
  onOpenLink: (url: string) => void;
}

interface AgentPanelProps {
  view: AgentPanelView;
  handlers: AgentPanelHandlers;
  /** A detached window that has lost the editor: nothing sent would arrive. */
  offline?: boolean;
  /**
   * In a detached window. Recent runs is left out there: its report download
   * needs the save dialog, which only the editor window may open.
   */
  detached?: boolean;
  className?: string;
}

// Per document, so a half-written message survives the panel unmounting on a
// tab switch or a dock collapse.
let draftText = '';
let draftAttachments: AgentAttachment[] = [];

const MAX_ATTACHMENTS = 4;
/** More tool calls in a row than this fold behind a "show all" row. */
const VISIBLE_STEPS = 4;

const SUGGESTIONS = [
  'Make the headlines bigger',
  'Try a darker background',
  'Add an artboard for another screenshot',
  'Write shorter headlines',
];

/** "Opus 5.5" out of "claude-opus-5-5", the raw id for anything else. */
function prettyModel(id: string | null): string | null {
  if (!id) return null;
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?/.exec(id);
  if (!match) return id;
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  return match[3] ? `${family} ${match[2]}.${match[3]}` : `${family} ${match[2]}`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatResetTime(epochSeconds: number | null): string | null {
  if (!epochSeconds) return null;
  try {
    return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return null;
  }
}

type Row =
  | { kind: 'item'; item: AgentItem }
  | { kind: 'steps'; id: string; items: Extract<AgentItem, { kind: 'tool' }>[] };

/** Consecutive tool calls become one block, so a long build reads as one step list. */
function groupRows(items: AgentItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (item.kind === 'tool') {
      if (last?.kind === 'steps') last.items.push(item);
      else rows.push({ kind: 'steps', id: `steps-${item.id}`, items: [item] });
    } else {
      rows.push({ kind: 'item', item });
    }
  }
  return rows;
}

function StepIcon({ status }: { status: 'running' | 'done' | 'error' }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
  if (status === 'error') return <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
}

function StepRow({ item }: { item: Extract<AgentItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const expandable = !!item.result;
  return (
    <li>
      <button
        type="button"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs',
          expandable ? 'hover:bg-muted' : 'cursor-default'
        )}
      >
        <StepIcon status={item.status} />
        <span className="shrink-0 font-medium">{toolLabel(item.name, item.status)}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.detail ?? ''}</span>
        {expandable && (
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
        )}
      </button>
      {item.image && (
        // What the agent looked at: its own small export of the artboard.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image}
          alt="The artboard as the agent saw it"
          className="ml-7 mt-1 max-h-44 max-w-[calc(100%-1.75rem)] rounded border bg-muted object-contain"
        />
      )}
      {open && item.result && (
        <pre className="ml-7 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 px-2 py-1.5 font-mono text-[10.5px] leading-snug text-muted-foreground">
          {item.result}
        </pre>
      )}
    </li>
  );
}

function StepList({ items }: { items: Extract<AgentItem, { kind: 'tool' }>[] }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded ? 0 : Math.max(0, items.length - VISIBLE_STEPS);
  const shown = hidden ? items.slice(hidden) : items;
  return (
    <div className="rounded-lg border bg-muted/20 px-1 py-1">
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
        >
          <ChevronRight className="h-3.5 w-3.5" />
          {hidden} earlier step{hidden === 1 ? '' : 's'}
        </button>
      )}
      <ul>
        {shown.map((item) => (
          <StepRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function NoticeRow({ item }: { item: Extract<AgentItem, { kind: 'notice' }> }) {
  const Icon = item.tone === 'error' ? CircleAlert : item.tone === 'warning' ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md px-2 py-1.5 text-xs',
        item.tone === 'error' && 'bg-destructive/10 text-destructive',
        item.tone === 'warning' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        item.tone === 'info' && 'text-muted-foreground'
      )}
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words">{item.text}</span>
    </div>
  );
}

function AttachmentThumb({ attachment, onRemove }: { attachment: AgentAttachment; onRemove: () => void }) {
  const src = useImageSrc(attachment.ref);
  return (
    <div className="group relative h-14 w-10 shrink-0 overflow-hidden rounded border bg-muted" title={attachment.fileName}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={attachment.fileName} className="h-full w-full object-cover" />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-background/90 text-foreground shadow"
        title="Remove"
        aria-label={`Remove ${attachment.fileName}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function AgentPanel({ view, handlers, offline = false, detached = false, className }: AgentPanelProps) {
  const [text, setText] = useState(draftText);
  const [attachments, setAttachments] = useState<AgentAttachment[]>(draftAttachments);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    draftText = text;
  }, [text]);
  useEffect(() => {
    draftAttachments = attachments;
  }, [attachments]);

  const working = view.status === 'working' || view.status === 'starting';
  const readiness = readinessOf(view.detection);
  const needsSetup = readiness === 'missing' || readiness === 'signed-out' || readiness === 'sandboxed' || readiness === 'broken';
  const blocked = !view.available || offline || (needsSetup && readiness !== 'broken');
  const canSend = !blocked && !working && !attaching && (text.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);

  // Follow the conversation while the user is at the bottom of it; leave them
  // alone once they have scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [view.items, working]);

  // Grow the box with what is typed, up to a limit.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const rows = useMemo(() => groupRows(view.items), [view.items]);
  const account = accountLine(view.detection.result);
  const modelName = prettyModel(view.resolvedModel) ?? CLAUDE_MODEL_CHOICES.find((c) => c.value === view.model)?.label ?? null;
  const statusLine = working
    ? view.status === 'starting'
      ? 'Starting...'
      : 'Working...'
    : modelName;

  const submit = () => {
    if (!canSend) return;
    handlers.onSend(text.trim() || 'Use the attached screenshots', attachments);
    setText('');
    setAttachments([]);
    setAttachError(null);
    stickToBottom.current = true;
  };
  // Stop takes the Send button's place the moment a message goes out, so the
  // second click of a double click on Send lands on Stop. The browser counts
  // clicks by time and place, not by element, so that one arrives with a
  // detail of 2, and it is not a change of mind.
  const stop = (event: React.MouseEvent) => {
    if (event.detail > 1) return;
    handlers.onStop();
  };

  const addFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/')).slice(0, MAX_ATTACHMENTS - attachments.length);
    if (!images.length) return;
    setAttaching(true);
    setAttachError(null);
    try {
      const stored: AgentAttachment[] = [];
      for (const file of images) {
        // Stored once as an asset, so the agent places it by reference and the
        // editor window can read it back from the shared IndexedDB.
        const shot = await readScreenshotFile(file);
        const asset = await saveImageAsset(shot.dataUrl, { name: file.name });
        stored.push({ ref: asset.ref, width: shot.width, height: shot.height, fileName: file.name });
      }
      setAttachments((previous) => [...previous, ...stored].slice(0, MAX_ATTACHMENTS));
    } catch (error) {
      console.error('Could not attach an image for the agent', error);
      setAttachError('That image could not be read');
    } finally {
      setAttaching(false);
    }
  };

  const placeholder = offline
    ? 'Waiting for the editor window'
    : !view.available
      ? 'Claude Code runs in the desktop app'
      : blocked
        ? 'Set up Claude Code first'
        : 'Ask the agent to change something';

  const rateLimited = view.rateLimit?.status === 'rejected';
  const nearLimit = view.rateLimit?.status === 'allowed_warning';
  const resetAt = formatResetTime(view.rateLimit?.resetsAt ?? null);

  return (
    <div
      data-agent-panel
      className={cn('flex h-full min-h-0 w-full flex-col', className)}
      onDragOver={(event) => {
        if (!blocked && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (blocked || !event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        void addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <ClaudeCodeLogo className="h-4 w-4" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold leading-tight">Claude Code</p>
          {statusLine && <p className="truncate text-[11px] leading-tight text-muted-foreground">{statusLine}</p>}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handlers.onNewChat}
          disabled={view.items.length === 0 && !view.resumable}
          title="Start a new chat"
          aria-label="Start a new chat"
        >
          <SquarePen className="h-3.5 w-3.5" />
        </Button>
        {/* Not modal: a modal menu hands focus back to its trigger when a press
            on the canvas closes it, and the editor's shortcuts then think the
            keyboard is still in the chat. The content is marked as part of the
            chat, since it renders in a portal outside it: arrow keys there move
            through the menu, not the selected layer. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Agent options" aria-label="Agent options">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60" data-agent-panel="">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Model</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={view.model}
              onValueChange={(value) => handlers.onSetModel(value as ClaudeModelChoice)}
            >
              {CLAUDE_MODEL_CHOICES.map((choice) => (
                <DropdownMenuRadioItem key={choice.value} value={choice.value} className="text-xs">
                  {choice.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            {!detached && (
              <DropdownMenuItem className="gap-2 text-xs" onSelect={() => setHistoryOpen(true)}>
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                Recent runs
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="gap-2 text-xs" onSelect={handlers.onDetect}>
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              Check Claude Code again
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-xs" onSelect={handlers.onHide}>
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              Hide this tab
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {needsSetup && (
          <ClaudeCodeSetup
            detection={view.detection}
            onRetry={handlers.onDetect}
            onOpenLink={handlers.onOpenLink}
            className="mb-3 text-xs"
          />
        )}

        {view.omitted > 0 && (
          <p className="mb-2 text-center text-[11px] text-muted-foreground">
            {view.omitted} earlier message{view.omitted === 1 ? ' is' : 's are'} not shown here
          </p>
        )}

        {rows.length === 0 && !working ? (
          <div className="flex flex-col items-center px-2 pt-4 text-center">
            <ClaudeCodeLogo tile className="h-10 w-10" />
            <p className="mt-3 text-sm font-semibold">Talk to the agent</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ask for a change and watch the canvas. The agent edits this project with the app&apos;s design tools.
            </p>
            {account && <p className="mt-1 text-xs text-muted-foreground">{account}</p>}
            {!blocked && (
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setText(suggestion);
                      textRef.current?.focus();
                    }}
                    className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              if (row.kind === 'steps') return <StepList key={row.id} items={row.items} />;
              const { item } = row;
              if (item.kind === 'user') {
                return (
                  <div key={item.id} className="flex justify-end">
                    <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary/10 px-3 py-2 text-[13px] leading-relaxed">
                      {item.text}
                      {item.attachments > 0 && (
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <ImagePlus className="h-3 w-3" />
                          {item.attachments} image{item.attachments === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              }
              if (item.kind === 'text') {
                return <AgentMarkdown key={item.id} text={item.text} onOpenLink={handlers.onOpenLink} />;
              }
              if (item.kind === 'notice') return <NoticeRow key={item.id} item={item} />;
              return null;
            })}
          </div>
        )}

        {working && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{view.status === 'starting' ? 'Starting Claude Code...' : 'Working...'}</span>
            {view.turnStartedAt && <span className="tabular-nums">{formatElapsed(now - view.turnStartedAt)}</span>}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-2">
        {(rateLimited || nearLimit) && (
          <p
            className={cn(
              'mb-1.5 flex items-start gap-1.5 text-[11px]',
              rateLimited ? 'text-destructive' : 'text-amber-600 dark:text-amber-500'
            )}
          >
            <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
            {rateLimited
              ? resetAt
                ? `Your Claude plan hit its usage limit. It resets at ${resetAt}`
                : 'Your Claude plan hit its usage limit'
              : 'Close to your Claude plan usage limit'}
          </p>
        )}
        {view.contextLabel && (
          <p
            className="mb-1.5 flex items-center gap-1 text-[11px] text-muted-foreground"
            title="The agent is told what is selected, so you can say this or it"
          >
            <Crosshair className="h-3 w-3 shrink-0" />
            <span className="truncate">About {view.contextLabel}</span>
          </p>
        )}
        {attachments.length > 0 && (
          <div className="mb-1.5 flex gap-1.5">
            {attachments.map((attachment) => (
              <AttachmentThumb
                key={attachment.ref}
                attachment={attachment}
                onRemove={() => setAttachments((previous) => previous.filter((a) => a.ref !== attachment.ref))}
              />
            ))}
          </div>
        )}
        {attachError && <p className="mb-1.5 text-[11px] text-destructive">{attachError}</p>}
        <div className="rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring">
          <textarea
            ref={textRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // The Enter that accepts an IME conversion is not a send. WebKit
              // (the Mac app) ends the composition before that keydown, so
              // isComposing is already false there and only keyCode 229 says so.
              const composing = event.nativeEvent.isComposing || event.keyCode === 229;
              if (event.key === 'Enter' && !event.shiftKey && !composing) {
                event.preventDefault();
                submit();
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length && !blocked) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
            rows={2}
            disabled={blocked}
            placeholder={placeholder}
            aria-label="Message the agent"
            className="block max-h-40 min-h-[2.75rem] w-full resize-none bg-transparent px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => fileRef.current?.click()}
              disabled={blocked || attaching || attachments.length >= MAX_ATTACHMENTS}
              title="Attach screenshots"
              aria-label="Attach screenshots"
            >
              {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void addFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
            {working ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={stop}
                title="Stop the agent"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7 rounded-full"
                onClick={submit}
                disabled={!canSend}
                title="Send"
                aria-label="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {!detached && <RunHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />}
    </div>
  );
}
