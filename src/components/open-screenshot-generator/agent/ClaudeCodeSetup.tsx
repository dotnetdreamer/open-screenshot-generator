"use client";

// What stands between the user and a working Claude Code, shared by the agent
// tab in the start dialog and the Agent panel in the dock: not installed, not
// signed in, a build that cannot start programs, or a binary that fails.

import { useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, LogIn, RefreshCw, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import type { AgentDetectionState, ClaudeDetection } from '@/lib/claudeCode/types';

export const CLAUDE_CODE_INSTALL_URL = 'https://code.claude.com/docs/en/quickstart';
export const DESKTOP_DOWNLOAD_URL = 'https://openscrgen.app';

export type ClaudeCodeReadiness = 'unknown' | 'checking' | 'ready' | 'missing' | 'signed-out' | 'sandboxed' | 'broken';

export function readinessOf(detection: AgentDetectionState): ClaudeCodeReadiness {
  if (detection.status === 'checking') return 'checking';
  if (detection.status !== 'done') return 'unknown';
  const result = detection.result;
  if (!result) return 'broken';
  if (result.unavailable) return 'sandboxed';
  if (!result.found) return 'missing';
  if (result.error) return 'broken';
  if (result.loggedIn === false) return 'signed-out';
  return 'ready';
}

const PLAN_NAMES: Record<string, string> = {
  pro: 'Pro',
  max: 'Max',
  team: 'Team',
  enterprise: 'Enterprise',
};

/** "2.1.202" out of "2.1.202 (Claude Code)". */
export function shortVersion(version: string | null | undefined): string | null {
  const match = version ? /\d+\.\d+\.\d+/.exec(version) : null;
  return match ? match[0] : null;
}

/** One line about the login the agent will use, or null when there is nothing worth saying. */
export function accountLine(result: ClaudeDetection | null): string | null {
  if (!result?.found || result.loggedIn !== true) return null;
  if (result.authMethod && result.authMethod !== 'claude.ai') {
    return 'Signed in with an API key, so the agent is billed to that key';
  }
  const plan = result.subscriptionType ? PLAN_NAMES[result.subscriptionType] ?? result.subscriptionType : null;
  return plan ? `Uses your Claude ${plan} plan` : 'Uses your Claude plan';
}

function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);
}

/** One copyable command. */
export function CommandLine({ command, className }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className={cn('flex items-center gap-1 rounded-md border bg-muted/50 py-1 pl-2.5 pr-1', className)}>
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={command}>
        {command}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => setCopied(true)).catch(() => {});
        }}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        title={copied ? 'Copied' : 'Copy command'}
        aria-label="Copy command"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function CheckAgainButton({ onRetry, checking }: { onRetry: () => void; checking: boolean }) {
  return (
    <Button size="sm" variant="outline" onClick={onRetry} disabled={checking}>
      <RefreshCw className={cn('mr-2 h-3.5 w-3.5', checking && 'animate-spin')} />
      Check again
    </Button>
  );
}

interface ClaudeCodeSetupProps {
  detection: AgentDetectionState;
  onRetry: () => void;
  /** Where a link goes. A detached panel window hands it to the editor. */
  onOpenLink?: (url: string) => void;
  className?: string;
}

/**
 * The fix for whatever readinessOf found. Renders nothing while Claude Code is
 * ready or has not been looked for yet.
 */
export function ClaudeCodeSetup({
  detection,
  onRetry,
  onOpenLink = (url) => void openExternal(url),
  className,
}: ClaudeCodeSetupProps) {
  const readiness = readinessOf(detection);
  const checking = detection.status === 'checking';

  if (readiness === 'missing') {
    const windows = isWindows();
    return (
      <Alert className={className}>
        <Download className="h-4 w-4" />
        <AlertTitle>Claude Code is not installed</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>Install it, run claude once in a terminal to sign in, then check again.</p>
          <CommandLine
            command={windows ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash'}
          />
          <p className="text-xs text-muted-foreground">
            {windows ? 'In PowerShell. ' : 'In a terminal. '}
            Or with npm: <code className="font-mono">npm install -g @anthropic-ai/claude-code</code>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <CheckAgainButton onRetry={onRetry} checking={checking} />
            <button
              type="button"
              onClick={() => onOpenLink(CLAUDE_CODE_INSTALL_URL)}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Installation guide
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  if (readiness === 'signed-out') {
    return (
      <Alert className={className}>
        <LogIn className="h-4 w-4" />
        <AlertTitle>Claude Code is not signed in</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>Run claude in a terminal and sign in with your Claude account, then check again.</p>
          <CommandLine command="claude" />
          <CheckAgainButton onRetry={onRetry} checking={checking} />
        </AlertDescription>
      </Alert>
    );
  }

  if (readiness === 'sandboxed') {
    return (
      <Alert className={className}>
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Not available in this version</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            The Mac App Store version cannot start other programs. The version from openscrgen.app can run
            Claude Code.
          </p>
          <button
            type="button"
            onClick={() => onOpenLink(DESKTOP_DOWNLOAD_URL)}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Get it from openscrgen.app
            <ExternalLink className="h-3 w-3" />
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  if (readiness === 'broken') {
    const reason = detection.result?.error || detection.error;
    return (
      <Alert className={className}>
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Claude Code did not answer</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            {reason
              ? `It said: ${reason}`
              : 'The app found no working copy of Claude Code. Make sure claude runs in a terminal, then check again.'}
          </p>
          <CheckAgainButton onRetry={onRetry} checking={checking} />
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
