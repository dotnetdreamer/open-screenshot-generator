"use client";

import { useEffect } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Monitor } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { openExternal } from '@/lib/desktop';
import { relayConfigured } from '@/lib/mcp/relayBridge';
import { claudeAgent, useClaudeAgent } from '@/lib/claudeCode/store';
import {
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_MODEL_CHOICES,
  type ClaudeEffortChoice,
  type ClaudeModelChoice,
} from '@/lib/claudeCode/types';
import { ClaudeCodeLogo } from '../agent/ClaudeCodeLogo';
import {
  ClaudeCodeSetup,
  DESKTOP_DOWNLOAD_URL,
  accountLine,
  readinessOf,
  shortVersion,
} from '../agent/ClaudeCodeSetup';

interface ClaudeCodeModePanelProps {
  /** Only the desktop app can start Claude Code. Known only after mount (rule 14). */
  desktop: boolean;
  /** Nothing to go on yet: no instruction, no screenshots and no code folder. */
  disabled: boolean;
  /** The project is being made and the chat started. */
  starting: boolean;
  onStart: () => void;
}

/**
 * The Claude Code tab of the agent screen. Unlike the other modes this one
 * returns no plan to review: pressing Start makes an empty project, hands the
 * chat to the Agent panel in the dock, and the agent builds the design there
 * with the app's own design tools.
 */
export function ClaudeCodeModePanel({ desktop, disabled, starting, onStart }: ClaudeCodeModePanelProps) {
  const agent = useClaudeAgent();
  const readiness = readinessOf(agent.detection);

  // The tab remounts on every switch (Radix drops an inactive panel's
  // children), and detect() reuses a recent answer rather than asking again.
  useEffect(() => {
    if (desktop) void claudeAgent.detect();
  }, [desktop]);

  if (!desktop) {
    return (
      <Alert>
        <Monitor className="h-4 w-4" />
        <AlertTitle>Claude Code runs in the desktop app</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            A web page cannot start programs on your computer. In the desktop app the agent runs in your own
            Claude Code, on the Claude plan you already use, and edits the project while you watch.
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
              To stay in the browser, connect Claude Code from a terminal instead: close this dialog and open
              the MCP button at the bottom right of the canvas.
            </p>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const result = agent.detection.result;
  const version = shortVersion(result?.version);
  const account = accountLine(result);
  const chatRunning = agent.session.status === 'working' || agent.session.status === 'starting';
  const canStart = !disabled && !starting && (readiness === 'ready' || readiness === 'unknown');

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ClaudeCodeLogo tile className="h-9 w-9" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Claude Code runs on your computer using your Claude plan. It builds your project with
          the app&apos;s design tools while you watch. Keep chatting in the Agent panel.
        </p>
      </div>

      {readiness === 'checking' || readiness === 'unknown' ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Looking for Claude Code...
        </div>
      ) : readiness === 'ready' ? (
        <Alert className="border-emerald-500/40 bg-emerald-500/5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertTitle>{version ? `Claude Code ${version} is ready` : 'Claude Code is ready'}</AlertTitle>
          {account && <AlertDescription>{account}</AlertDescription>}
        </Alert>
      ) : (
        <ClaudeCodeSetup detection={agent.detection} onRetry={() => void claudeAgent.detect(true)} />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="claude-code-model">Model</Label>
          <Select
            value={agent.model}
            onValueChange={(value) => claudeAgent.setModel(value as ClaudeModelChoice)}
            disabled={starting}
          >
            <SelectTrigger id="claude-code-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLAUDE_MODEL_CHOICES.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="claude-code-effort">Effort</Label>
          <Select
            value={agent.effort}
            onValueChange={(value) => claudeAgent.setEffort(value as ClaudeEffortChoice)}
            disabled={starting}
          >
            <SelectTrigger id="claude-code-effort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLAUDE_EFFORT_CHOICES.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {agent.model === 'haiku'
            ? 'Haiku has no effort levels, so it runs the same at any of them'
            : 'Higher effort makes a better design, takes longer and uses more of your plan'}
        </p>
      </div>

      <div className="space-y-2">
        <Button onClick={onStart} disabled={!canStart}>
          {starting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ClaudeCodeLogo mono className="mr-2 h-4 w-4" />
          )}
          {starting ? 'Starting...' : 'Start with Claude Code'}
        </Button>
        {chatRunning ? (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            A chat is still running in the Agent panel. Starting here stops it and begins a new one
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Starts a new project. Each message counts toward your Claude plan&apos;s usage limits
          </p>
        )}
      </div>
    </div>
  );
}
