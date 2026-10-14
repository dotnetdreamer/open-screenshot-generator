"use client";

import { useEffect } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Monitor } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { openExternal } from '@/lib/desktop';
import { claudeAgent, useClaudeAgent } from '@/lib/claudeCode/store';
import { codexModelChoices } from '@/lib/claudeCode/view';
import { clampCodexEffort } from '@/lib/codex/effort';
import { CODEX_EFFORT_CHOICES, type CodexEffortChoice } from '@/lib/codex/types';
import { CodexLogo } from '../agent/CodexLogo';
import { DESKTOP_DOWNLOAD_URL } from '../agent/ClaudeCodeSetup';
import { CodexSetup, codexAccountLine, codexReadinessOf, codexVersion } from '../agent/CodexSetup';

interface CodexModePanelProps {
  /** Only the desktop app can start Codex. Known only after mount (rule 14). */
  desktop: boolean;
  /** Nothing to go on yet: no instruction and no screenshots. */
  disabled: boolean;
  /** The project is being made and the chat started. */
  starting: boolean;
  onStart: () => void;
}

/**
 * The Codex tab of the agent screen. Like the Claude Code tab it returns no
 * plan to review: Start makes an empty project, hands the chat to the Agent
 * panel in the dock, and Codex builds the design there with the app's design
 * tools.
 */
export function CodexModePanel({ desktop, disabled, starting, onStart }: CodexModePanelProps) {
  const agent = useClaudeAgent();
  const readiness = codexReadinessOf(agent.codexDetection);

  // The tab remounts on every switch, and detectCodex() reuses a recent answer.
  useEffect(() => {
    if (desktop) void claudeAgent.detectCodex();
  }, [desktop]);

  if (!desktop) {
    return (
      <Alert>
        <Monitor className="h-4 w-4" />
        <AlertTitle>Codex runs in the desktop app</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            A web page cannot start programs on your computer. In the desktop app the agent runs in your own Codex, on
            the ChatGPT plan you already use, and edits the project while you watch.
          </p>
          <button
            type="button"
            onClick={() => void openExternal(DESKTOP_DOWNLOAD_URL)}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Get the desktop app
            <ExternalLink className="h-3 w-3" />
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  const result = agent.codexDetection.result;
  const version = codexVersion(result?.version);
  const account = codexAccountLine(result);
  const models = codexModelChoices(result);
  const picked = models.find((choice) => choice.value === agent.codexModel) ?? null;
  // A saved model the list does not have (yet) stays pickable as itself.
  const modelMenu =
    picked || agent.codexModel === 'default'
      ? models
      : [...models, { value: agent.codexModel, label: agent.codexModel, efforts: [] }];
  const efforts = picked?.efforts ?? [];
  const effort = clampCodexEffort(agent.codexEffort, efforts);
  const effortMenu = efforts.length ? CODEX_EFFORT_CHOICES.filter((choice) => efforts.includes(choice.value)) : CODEX_EFFORT_CHOICES;
  const chatRunning = agent.session.status === 'working' || agent.session.status === 'starting';
  const canStart = !disabled && !starting && (readiness === 'ready' || readiness === 'unknown');

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <CodexLogo tile className="h-9 w-9" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Codex runs on your computer using your ChatGPT plan. It builds your project with the app&apos;s design tools
          while you watch. Keep chatting in the Agent panel.
        </p>
      </div>

      {readiness === 'checking' || readiness === 'unknown' ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Looking for Codex...
        </div>
      ) : readiness === 'ready' ? (
        <Alert className="border-emerald-500/40 bg-emerald-500/5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertTitle>{version ? `Codex ${version} is ready` : 'Codex is ready'}</AlertTitle>
          {account && <AlertDescription>{account}</AlertDescription>}
        </Alert>
      ) : (
        <CodexSetup detection={agent.codexDetection} onRetry={() => void claudeAgent.detectCodex(true)} />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="codex-model">Model</Label>
          <Select
            value={agent.codexModel}
            onValueChange={(value) => claudeAgent.setCodexModel(value)}
            disabled={starting}
          >
            <SelectTrigger id="codex-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelMenu.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="codex-effort">Effort</Label>
          <Select
            value={effort}
            onValueChange={(value) => claudeAgent.setCodexEffort(value as CodexEffortChoice)}
            disabled={starting}
          >
            <SelectTrigger id="codex-effort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {effortMenu.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Higher effort makes a better design, takes longer and uses more of your plan
        </p>
      </div>

      <div className="space-y-2">
        <Button onClick={onStart} disabled={!canStart}>
          {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CodexLogo className="mr-2 h-4 w-4" />}
          {starting ? 'Starting...' : 'Start with Codex'}
        </Button>
        {chatRunning ? (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            A chat is still running in the Agent panel. Starting here stops it and begins a new one
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Starts a new project. Each message counts toward your ChatGPT plan&apos;s Codex usage limits
          </p>
        )}
      </div>
    </div>
  );
}
