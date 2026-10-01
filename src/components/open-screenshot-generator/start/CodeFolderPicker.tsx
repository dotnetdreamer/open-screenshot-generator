"use client";

// The start screen's code folder row. In the desktop app it picks up to three
// folders of the user's app code through Rust's own dialog and holds them until
// Start hands them to the new Claude Code chat. A web page cannot start Claude
// Code, so on the web the same button explains where this works instead.

import React, { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, Folder, FolderPlus, Loader2, Monitor, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/lib/desktop';
import { relayConfigured } from '@/lib/mcp/relayBridge';
import { claudeAgent, useClaudeAgent } from '@/lib/claudeCode/store';
import { FOLDER_CAP_NOTICE, MAX_FOLDERS, alreadyAddedNotice, folderLabels } from '@/lib/claudeCode/folders';
import type { AgentFolder } from '@/lib/claudeCode/types';
import { DESKTOP_DOWNLOAD_URL, readinessOf } from '../agent/ClaudeCodeSetup';

interface CodeFolderPickerProps {
  /** The desktop app, where Rust's dialog can pick a folder. Known only after mount (rule 14). */
  desktop: boolean;
  folders: AgentFolder[];
  onChange: (folders: AgentFolder[]) => void;
  /** The Claude Code tab is the one selected. No other mode reads a folder. */
  claudeCode: boolean;
  /** A run is starting or going, so the folders stay as they are. */
  disabled?: boolean;
}

export function CodeFolderPicker({ desktop, folders, onChange, claudeCode, disabled = false }: CodeFolderPickerProps) {
  const agent = useClaudeAgent();
  const id = useId();
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  const pillId = `${id}-pill`;
  const alertId = `${id}-alert`;
  // Until mount this cannot tell the desktop app from the web (rule 14), so it
  // shows neither the web pill nor the web alert.
  const [mounted, setMounted] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [webHelpOpen, setWebHelpOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const addRef = useRef<HTMLButtonElement | null>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  /** Where focus goes once a removed chip is gone: the next chip's remove button, or null for the add button. */
  const focusAfterRemove = useRef<{ next: string | null } | null>(null);
  // The list as it stands, for a pick that ends after the render that began it.
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const pending = focusAfterRemove.current;
    if (!pending) return;
    focusAfterRemove.current = null;
    (pending.next ? removeRefs.current.get(pending.next) : addRef.current)?.focus();
  }, [folders]);

  // The Mac App Store build cannot start Claude Code at all.
  if (desktop && readinessOf(agent.detection) === 'sandboxed') return null;

  const web = mounted && !desktop;
  const labels = folderLabels(folders);

  /** Read out by a screen reader. Cleared first, so the same words twice are read twice. */
  const announce = (message: string) => {
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(message), 50);
  };

  const refuse = (message: string) => {
    setRefusal(message);
    announce(message);
  };

  const pick = async () => {
    if (!desktop) {
      setWebHelpOpen((open) => !open);
      return;
    }
    // Busy rather than disabled while the dialog is up, so the button keeps
    // the keyboard focus the dialog hands back.
    if (pickingRef.current || disabled) return;
    if (foldersRef.current.length >= MAX_FOLDERS) {
      refuse(FOLDER_CAP_NOTICE);
      return;
    }
    pickingRef.current = true;
    setPicking(true);
    setRefusal(null);
    try {
      const result = await claudeAgent.pickFolder();
      if (result.kind === 'refused') {
        refuse(result.message);
        return;
      }
      if (result.kind !== 'picked') return;
      const current = foldersRef.current;
      const index = current.findIndex((folder) => folder.path === result.folder.path);
      if (index >= 0) {
        // With the list unchanged, a silent return would look like a lost pick.
        refuse(alreadyAddedNotice(folderLabels(current)[index]));
        return;
      }
      if (current.length >= MAX_FOLDERS) {
        refuse(FOLDER_CAP_NOTICE);
        return;
      }
      const next = [...current, result.folder];
      onChange(next);
      announce(`Added ${folderLabels(next)[next.length - 1]}`);
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  };

  const remove = (path: string) => {
    if (disabled) return;
    const index = folders.findIndex((folder) => folder.path === path);
    const next = folders.filter((folder) => folder.path !== path);
    focusAfterRemove.current = { next: next[index]?.path ?? null };
    setRefusal(null);
    onChange(next);
  };

  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p id={labelId} className="text-sm font-medium">
          Your app&apos;s code <span className="font-normal text-muted-foreground">(Claude Code only)</span>
        </p>
        <Button
          ref={addRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void pick()}
          // The web button only opens and closes its explanation.
          disabled={desktop && disabled}
          aria-busy={picking || undefined}
          aria-expanded={web ? webHelpOpen : undefined}
          aria-controls={web ? alertId : undefined}
          aria-describedby={web ? `${pillId} ${helpId}` : helpId}
          aria-label="Add your app's code folder"
          // Full width on a phone, where the label and the pill can need two lines.
          className="h-auto min-h-9 w-full justify-start whitespace-normal py-1.5 text-left sm:w-auto"
        >
          {picking ? <Loader2 className="animate-spin" /> : <FolderPlus />}
          Add your app&apos;s code folder
          {web && (
            <span
              id={pillId}
              className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
            >
              Desktop app
            </span>
          )}
        </Button>
      </div>

      <p id={helpId} className="text-xs text-muted-foreground">
        Pick the top folder of your app&apos;s code. Claude Code reads your app&apos;s name, icon, colours and store
        text there and never changes a file in it
      </p>

      {folders.length > 0 && (
        <ul aria-label="Folders Claude Code can read" className="flex flex-wrap gap-1.5">
          {folders.map((folder, index) => (
            <li
              key={folder.path}
              title={`${folder.path}\nClaude Code can read this folder but not change it`}
              className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs"
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{labels[index]}</span>
              <button
                ref={(node) => {
                  if (node) removeRefs.current.set(folder.path, node);
                  else removeRefs.current.delete(folder.path);
                }}
                type="button"
                onClick={() => remove(folder.path)}
                disabled={disabled}
                aria-label={`Remove the ${labels[index]} folder`}
                title={`Remove the ${labels[index]} folder`}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {refusal && <p className="text-xs text-destructive">{refusal}</p>}

      {!claudeCode && folders.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {folders.length === 1
            ? 'Only the Claude Code tab reads this folder'
            : 'Only the Claude Code tab reads these folders'}
        </p>
      )}

      {web && (
        <Alert id={alertId} hidden={!webHelpOpen}>
          <Monitor className="h-4 w-4" />
          <AlertTitle>Code folders need the desktop app</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Claude Code reads the folder on your computer, and only the desktop app can start Claude Code. There
              the agent uses your app&apos;s real name, icon, colours and store text from its code.
            </p>
            <button
              type="button"
              onClick={() => void openExternal(DESKTOP_DOWNLOAD_URL)}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Get the desktop app
              <ExternalLink className="h-3 w-3" />
            </button>
            {relayConfigured() && (
              <p className="text-xs text-muted-foreground">
                To stay in the browser, run <code className="rounded bg-muted px-1 font-mono">claude</code> in a
                terminal inside your app&apos;s folder, then close this dialog and connect it with the MCP button at
                the bottom right of the canvas.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
