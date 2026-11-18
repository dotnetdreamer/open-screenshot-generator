"use client";

// The app's code in Ask AI: a folder the user picks so Claude Code can read
// their code when it answers or checks the app. Only the folder's location
// goes with the prompt (codeFolder.ts); Claude Code opens the files itself.
// One folder per project, shown beside the message box and in the check.
// When macOS keeps Claude Code out of the folder, or is asking the user, the
// folder says so and Ask AI answers without the code until macOS lets it in.

import React, { useEffect, useState } from 'react';
import { FolderIcon, FolderPlusIcon, Loader2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { knownAgentWriters } from '@/lib/ai/agentPrompt';
import { isTauri } from '@/lib/desktop';
import { useGrowthSettings } from '@/lib/growth/settings';
import {
  chooseCodeFolder,
  folderBlockOf,
  lookAtFolder,
  lookingAt,
  recheckBlockedFolder,
  removeCodeFolder,
  useCodeFolder,
  type CodeFolder,
  type FolderBlock,
} from '@/lib/storeCompliance/codeFolder';
import { useRulesChat } from '@/lib/storeCompliance/chat';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { Gate, useRulesView } from './StoreComplianceShared';

export interface CodeFolderState {
  folder: CodeFolder | null;
  /** The folder goes with the next prompt: there is one, and Claude Code is the AI that answers. */
  readsCode: boolean;
  /** Why Claude Code cannot read a folder now, or null when it can. */
  reason: string | null;
  /** An answer is on its way, so the folder stays as it is until it lands. */
  busy: boolean;
  /** Claude Code can never run in this build (the Mac App Store's), so nothing about code shows. */
  hidden: boolean;
  /** macOS keeps Claude Code out of the folder, or is asking the user first. */
  block: FolderBlock | null;
}

const ONLY_CLAUDE = 'Only Claude Code can read code. Pick Claude Code above';
const BLOCKED = 'macOS blocks this folder. Allow it in System Settings > Privacy & Security > Files & Folders';
const ASKING = 'macOS is asking about this folder. Click Allow in its message';

export function useCodeFolderState(): CodeFolderState {
  const view = useRulesView();
  const busy = !!useRulesChat().running;
  const [settings] = useGrowthSettings();
  const folder = useCodeFolder(view.project.id) ?? null;
  // Known only after mount (rule 14 in .agents/AGENTS.md).
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isTauri()), []);
  const claude = view.ai.inUse === 'claude' && !view.ai.reason;
  // The AI picked above, or the one that answers when the choice is left to the app.
  const choice = settings.aiWriter && settings.aiWriter !== 'auto' ? settings.aiWriter : view.ai.inUse;
  const block = folder ? folderBlockOf(folder.path) : null;
  let reason: string | null = null;
  if (!desktop) reason = 'Reading your code needs the desktop app';
  else if (!claude) reason = choice === 'claude' || choice === null ? view.ai.reason ?? 'Looking for Claude Code' : ONLY_CLAUDE;
  else if (block) reason = block === 'refused' ? BLOCKED : ASKING;
  // Read on each render: the view renders again when a look at the CLIs ends.
  const hidden = desktop && !!knownAgentWriters()?.claude.sandboxed;
  // A blocked folder is looked at again once a session, and whenever the
  // window comes back to the front, as it does after System Settings or
  // after macOS's question is answered.
  const path = desktop && folder && block ? folder.path : null;
  useEffect(() => {
    if (!path) return;
    recheckBlockedFolder(path);
    const again = () => void lookAtFolder(path);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [path]);
  return { folder, readsCode: !!folder && !reason && !hidden, reason, busy, hidden, block };
}

/** Look at the folder again, for a folder macOS blocked or is asking about. */
export function CheckAgain({ folder }: { folder: CodeFolder }) {
  const busy = lookingAt(folder.path);
  return (
    <button
      type="button"
      onClick={() => void lookAtFolder(folder.path)}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded px-1 text-xs font-medium text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground disabled:cursor-wait disabled:no-underline disabled:opacity-60"
    >
      {busy && <Loader2Icon className="h-3 w-3 animate-spin" />}
      {busy ? 'Checking' : 'Check again'}
    </button>
  );
}

function AboutCode() {
  return (
    <InfoTip label="How Claude Code reads your code">
      <p>Only the folder&apos;s location is sent. Claude Code opens the files it needs itself, the same way it does in your terminal.</p>
      <p>It can&apos;t change your files or run anything. It can&apos;t open files with passwords or keys, like .env.</p>
      <p>Reading code uses your Claude plan, and a check can take a few minutes.</p>
    </InfoTip>
  );
}

/** Pick, show and take off the folder. `compact` is the line above the message box. */
export function CodeFolderControl({ state, compact = false, addLabel = "Add your app's code" }: { state: CodeFolderState; compact?: boolean; addLabel?: string }) {
  const view = useRulesView();
  const [picking, setPicking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const pick = async () => {
    if (picking) return;
    setPicking(true);
    setRefusal(null);
    try {
      const result = await chooseCodeFolder(view.project.id);
      if (result.kind === 'refused') setRefusal(result.message);
    } finally {
      setPicking(false);
    }
  };

  const { folder } = state;
  if (state.hidden) return null;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', compact ? 'text-xs' : 'text-sm')} data-testid="store-compliance-code-folder">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {folder ? (
          <>
            <span
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs"
              title={folder.path}
            >
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{folder.name}</span>
              <button
                type="button"
                onClick={() => void removeCodeFolder(view.project.id)}
                disabled={state.busy}
                aria-label={`Stop reading the ${folder.name} folder`}
                title="Stop reading this folder"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
            {state.reason ? (
              <span className="text-xs text-[hsl(var(--rules-medium))]" data-testid="store-compliance-code-folder-reason">
                {state.reason}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Claude Code can read this folder</span>
            )}
            {state.block && <CheckAgain folder={folder} />}
          </>
        ) : (
          <Gate reason={state.reason ?? (state.busy ? 'Wait for the answer that is on its way' : null)}>
            <Button
              type="button"
              variant={compact ? 'ghost' : 'outline'}
              size="sm"
              onClick={() => void pick()}
              aria-busy={picking || undefined}
              aria-label="Add your app's code folder"
              className={cn('gap-1.5', compact ? 'h-7 px-2 text-xs text-muted-foreground' : 'h-8 text-xs')}
            >
              {picking ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <FolderPlusIcon className="h-3.5 w-3.5" />}
              {addLabel}
            </Button>
          </Gate>
        )}
        <AboutCode />
      </div>
      {refusal && (
        <p className="text-xs text-destructive" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
