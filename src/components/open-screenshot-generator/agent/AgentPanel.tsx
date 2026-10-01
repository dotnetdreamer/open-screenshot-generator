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
  Activity,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  Crosshair,
  EyeOff,
  Folder,
  FolderPlus,
  History,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  MoreHorizontal,
  RefreshCw,
  Square,
  SquarePen,
  Trash2,
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
import { toolImageAlt, toolLabel, toolSkipped } from '@/lib/claudeCode/toolLabels';
import { FOLDER_CAP_NOTICE, MAX_FOLDERS } from '@/lib/claudeCode/folders';
import { CLAUDE_MODEL_CHOICES, type AgentItem, type ClaudeModelChoice } from '@/lib/claudeCode/types';
import type { AgentAttachment, AgentPanelFolder, AgentPanelView } from '@/lib/claudeCode/view';
import type { AgentChatListItem } from '@/lib/claudeCode/chats';
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
  /** Go back to a past chat, and to its project when another one is open. */
  onOpenChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  /** Open a web link. The editor window does it for a detached one. */
  onOpenLink: (url: string) => void;
  /**
   * Pick a code folder for the chat. The editor window opens the dialog; the
   * pick shows up as a new entry in view.folders, and a refusal or the cap as
   * view.folderNotice.
   */
  onAddFolder: () => void;
  /** Take a folder off the chat, by its path in view.folders. */
  onRemoveFolder: (path: string) => void;
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

/** For a chat with a code folder: what the agent can find there. */
const FOLDER_SUGGESTIONS = [
  "Use my app's name and colours",
  'Put my app icon on the first artboard',
  "Write headlines from my app's features",
];

/**
 * How long a click on the folder button waits for the view to say the dialog
 * opened. A detached window hears it only from the next snapshot, and never
 * does when the dialog opened and closed between two snapshots.
 */
const PICK_WAIT_MS = 4000;

/** The folder a pick put at the end of the list, when the list is the old one plus one. */
function appendedFolder(before: string[], folders: AgentPanelFolder[]): AgentPanelFolder | null {
  if (folders.length !== before.length + 1) return null;
  return before.every((path, index) => folders[index].path === path) ? folders[folders.length - 1] : null;
}

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

function StepIcon({ status, skipped }: { status: 'running' | 'done' | 'error'; skipped: boolean }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
  // A file the settings keep out of reach (a secret, a lock file, a dependency
  // or build folder): refused on purpose, not broken.
  if (skipped) return <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  if (status === 'error') return <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
}

function StepRow({ item }: { item: Extract<AgentItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const expandable = !!item.result;
  const skipped = toolSkipped(item.name, item.status, item.result);
  // The end of a file path is the telling part, so a long one loses its start.
  const pathDetail = item.name === 'Read' || item.name === 'import_project_image';
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
        <StepIcon status={item.status} skipped={skipped} />
        <span className="shrink-0 font-medium">{toolLabel(item.name, item.status, item.result)}</span>
        {pathDetail && item.detail ? (
          // Right to left only so the ellipsis goes at the start; the bdi keeps
          // the path itself reading left to right.
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground [direction:rtl]">
            <bdi>{item.detail}</bdi>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.detail ?? ''}</span>
        )}
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
          alt={toolImageAlt(item.name, item.input)}
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

/** "4 min ago", down to "just now", the way the Versions panel says it. */
function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(at).toLocaleDateString();
}

function ChatGroup({
  label,
  chats,
  showProject,
  busy,
  onOpen,
  onDelete,
}: {
  label: string;
  chats: AgentChatListItem[];
  showProject: boolean;
  busy: boolean;
  onOpen: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}) {
  return (
    <section>
      <p className="mb-1 px-2 text-[11px] font-semibold text-muted-foreground">{label}</p>
      <ul className="space-y-0.5">
        {chats.map((chat) => (
          <li
            key={chat.id}
            className={cn('group flex items-center gap-1 rounded-md pr-1', chat.current ? 'bg-primary/10' : 'hover:bg-muted/60')}
          >
            <button
              type="button"
              disabled={busy && !chat.current}
              onClick={() => onOpen(chat.id)}
              className="min-w-0 flex-1 px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block truncate text-xs font-medium">{chat.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {[showProject ? (chat.projectName ?? 'Unnamed project') : null, chat.current ? 'Open now' : ago(chat.updatedAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            {/* The open chat has no delete: start a new chat to leave it first. */}
            {!chat.current && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                onClick={() => onDelete(chat.id)}
                title="Delete this chat"
                aria-label="Delete this chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every saved chat, this project's first, in place of the transcript. */
function PastChats({
  chats,
  projectId,
  busy,
  onOpen,
  onDelete,
}: {
  chats: AgentChatListItem[];
  projectId: string | null;
  busy: boolean;
  onOpen: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}) {
  if (chats.length === 0) {
    return (
      <div className="flex flex-col items-center px-2 pt-6 text-center">
        <History className="h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm font-semibold">No past chats yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every chat with the agent is kept here, so you can go back to it later.
        </p>
      </div>
    );
  }
  const here = projectId ? chats.filter((chat) => chat.projectId === projectId) : [];
  const elsewhere = chats.filter((chat) => !projectId || chat.projectId !== projectId);
  return (
    <div className="space-y-4">
      {busy && <p className="px-2 text-[11px] text-muted-foreground">Stop the agent to open another chat</p>}
      {here.length > 0 && (
        <ChatGroup label="This project" chats={here} showProject={false} busy={busy} onOpen={onOpen} onDelete={onDelete} />
      )}
      {elsewhere.length > 0 && (
        <ChatGroup
          label={here.length > 0 ? 'Other projects' : 'Past chats'}
          chats={elsewhere}
          showProject
          busy={busy}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

export function AgentPanel({ view, handlers, offline = false, detached = false, className }: AgentPanelProps) {
  const [text, setText] = useState(draftText);
  const [attachments, setAttachments] = useState<AgentAttachment[]>(draftAttachments);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const addFolderRef = useRef<HTMLButtonElement | null>(null);
  const removeFolderRefs = useRef(new Map<string, HTMLButtonElement>());
  /**
   * A folder pick this panel asked for, until it ends: `asked` at the click,
   * `open` once the view says the dialog is up, `closing` for a moment after
   * it says the dialog shut, in case the new folder comes a snapshot later.
   * `known` is the folder list at the click, so the one the pick adds can be
   * told apart.
   */
  const pickRef = useRef<{ phase: 'asked' | 'open' | 'closing'; known: string[]; notice: string | null } | null>(null);
  const pickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Covers the moment between a click and the snapshot that says the dialog is open. */
  const [pickAsked, setPickAsked] = useState(false);
  /** A chip whose remove button was pressed: focus moves on once it is gone. */
  const removingRef = useRef<{ path: string; index: number; rest: string[] } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  /** The folder notice last read out. One already on screen at mount is not read again. */
  const lastNotice = useRef(view.folderNotice);

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
  // A folder the agent was not started with is worth a message on its own.
  const canSend =
    !blocked && !working && !attaching && (text.trim().length > 0 || attachments.length > 0 || view.foldersPending);
  const picking = view.folderPicking || pickAsked;
  // Access to a folder ends with its process, which a running turn still needs.
  const removeLocked = blocked || working;

  /** Read out by a screen reader. Cleared first, so the same words twice are read twice. */
  const announce = (message: string) => {
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(message), 50);
  };

  const clearPickTimer = () => {
    if (pickTimer.current) clearTimeout(pickTimer.current);
    pickTimer.current = null;
  };
  const endPick = () => {
    pickRef.current = null;
    setPickAsked(false);
    clearPickTimer();
  };
  /** Stop waiting after `ms` unless the pick has moved on to another phase by then. */
  const endPickAfter = (phase: 'asked' | 'closing', ms: number) => {
    clearPickTimer();
    pickTimer.current = setTimeout(() => {
      pickTimer.current = null;
      if (pickRef.current?.phase === phase) endPick();
    }, ms);
  };
  useEffect(
    () => () => {
      if (pickTimer.current) clearTimeout(pickTimer.current);
    },
    []
  );

  const addFolder = () => {
    if (blocked || picking) return;
    if (view.folders.length >= MAX_FOLDERS) {
      // No dialog opens at the cap: the store answers with the cap notice.
      // When that is the notice already, nothing on screen changes, so a
      // screen reader hears it from here.
      if (view.folderNotice === FOLDER_CAP_NOTICE) announce(FOLDER_CAP_NOTICE);
      handlers.onAddFolder();
      return;
    }
    pickRef.current = { phase: 'asked', known: view.folders.map((folder) => folder.path), notice: view.folderNotice };
    setPickAsked(true);
    endPickAfter('asked', PICK_WAIT_MS);
    handlers.onAddFolder();
  };

  // How a pick ended, read off the view, because a detached window has no
  // other way to hear it. A new folder at the end of the list means it was
  // picked: the message box gets focus and a screen reader hears its name. A
  // dialog that closed with nothing new was cancelled or refused, and focus
  // stays on the button, which was never disabled.
  useEffect(() => {
    const pick = pickRef.current;
    if (!pick) return;
    const added = appendedFolder(pick.known, view.folders);
    if (added) {
      endPick();
      textRef.current?.focus();
      announce(`Added ${added.label}`);
    } else if (view.folderPicking) {
      pick.phase = 'open';
      clearPickTimer();
    } else if (pick.phase === 'open') {
      pick.phase = 'closing';
      setPickAsked(false);
      endPickAfter('closing', 600);
    } else if (pick.phase === 'asked' && view.folderNotice && view.folderNotice !== pick.notice) {
      // Refused before any dialog opened.
      endPick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.folderPicking, view.folders, view.folderNotice]);

  // A refusal or the cap shows in the error line, and a screen reader hears it.
  useEffect(() => {
    if (view.folderNotice && view.folderNotice !== lastNotice.current) announce(view.folderNotice);
    lastNotice.current = view.folderNotice;
  }, [view.folderNotice]);

  const removeFolder = (folder: AgentPanelFolder, index: number) => {
    if (removeLocked) return;
    const rest = view.folders.filter((entry) => entry.path !== folder.path).map((entry) => entry.path);
    removingRef.current = { path: folder.path, index, rest };
    handlers.onRemoveFolder(folder.path);
  };

  // Once the chip has gone, focus goes to the remove button of the chip that
  // took its place, or to the add button when it was the last one. A list
  // that changed some other way (another chat opened) moves nothing.
  useEffect(() => {
    const removing = removingRef.current;
    if (!removing) return;
    const paths = view.folders.map((folder) => folder.path);
    if (paths.includes(removing.path)) return;
    removingRef.current = null;
    if (paths.length !== removing.rest.length || paths.some((path, i) => path !== removing.rest[i])) return;
    const next = view.folders[removing.index];
    (next ? removeFolderRefs.current.get(next.path) : addFolderRef.current)?.focus();
  }, [view.folders]);

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
    const fallback =
      attachments.length === 0
        ? 'Use the folder I added'
        : view.foldersPending
          ? 'Use the attached screenshots and the folder I added'
          : 'Use the attached screenshots';
    handlers.onSend(text.trim() || fallback, attachments);
    setText('');
    setAttachments([]);
    setAttachError(null);
    setChatsOpen(false);
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
          className={cn('h-7 w-7', chatsOpen && 'bg-accent text-accent-foreground')}
          onClick={() => setChatsOpen((open) => !open)}
          aria-pressed={chatsOpen}
          title="Past chats"
          aria-label="Past chats"
        >
          <History className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setChatsOpen(false);
            handlers.onNewChat();
          }}
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
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
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
        {chatsOpen ? (
          <PastChats
            chats={view.chats}
            projectId={view.projectId}
            busy={working}
            onOpen={(chatId) => {
              setChatsOpen(false);
              stickToBottom.current = true;
              handlers.onOpenChat(chatId);
            }}
            onDelete={handlers.onDeleteChat}
          />
        ) : (
          <>
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
                    {(view.folders.length > 0 ? FOLDER_SUGGESTIONS : SUGGESTIONS).map((suggestion) => (
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
                    return (
                      <AgentMarkdown
                        key={item.id}
                        text={item.text}
                        onOpenLink={handlers.onOpenLink}
                        linksAsText={view.linksAsText}
                      />
                    );
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
          </>
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
        {view.folders.length > 0 && (
          // For the whole chat, unlike the pictures below, which go with one message.
          <ul aria-label="Folders Claude Code can read" className="mb-1.5 flex flex-wrap gap-1">
            {view.folders.map((folder, index) => (
              <li
                key={folder.path}
                title={`${folder.path}\nClaude Code can read this folder but not change it`}
                className="flex min-w-0 max-w-full items-center gap-1 rounded-md border bg-muted/40 py-px pl-1.5 pr-px text-[11px] text-muted-foreground"
              >
                <Folder className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate">{folder.label}</span>
                <button
                  ref={(node) => {
                    if (node) removeFolderRefs.current.set(folder.path, node);
                    else removeFolderRefs.current.delete(folder.path);
                  }}
                  type="button"
                  onClick={() => removeFolder(folder, index)}
                  // aria-disabled rather than disabled: the button keeps focus
                  // and its tooltip while a turn runs.
                  aria-disabled={removeLocked || undefined}
                  aria-label={`Remove the ${folder.label} folder`}
                  title={working ? 'Stop the agent to remove a folder' : `Remove the ${folder.label} folder`}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
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
        {view.folderNotice && <p className="mb-1.5 text-[11px] text-destructive">{view.folderNotice}</p>}
        <p role="status" className="sr-only">
          {announcement}
        </p>
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
            <div className="flex items-center gap-0.5">
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
              {/* Never disabled while the dialog is open, only busy: disabling
                  it would drop the keyboard focus the dialog hands back. At the
                  cap a click explains the cap instead of opening the dialog. */}
              <Button
                ref={addFolderRef}
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={addFolder}
                disabled={blocked}
                aria-busy={picking || undefined}
                title="Add your app's code folder"
                aria-label="Add your app's code folder"
              >
                {picking ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
              </Button>
            </div>
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
