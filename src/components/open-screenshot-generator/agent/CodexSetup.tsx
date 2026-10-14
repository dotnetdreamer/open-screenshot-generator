"use client";

// What stands between the user and a working Codex, for the agent screen's
// Codex tab and a Codex chat in the Agent panel: not installed, not signed in,
// a login the app cannot share, a build that cannot start programs, or a
// binary that fails. ClaudeCodeSetup.tsx is the same for Claude Code.

import { Download, ExternalLink, KeyRound, LogIn, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { openExternal } from '@/lib/desktop';
import type { AgentDetectionState } from '@/lib/claudeCode/types';
import type { CodexDetection } from '@/lib/codex/types';
import { CheckAgainButton, CommandLine, DESKTOP_DOWNLOAD_URL } from './ClaudeCodeSetup';

export const CODEX_INSTALL_URL = 'https://developers.openai.com/codex/cli';

export type CodexReadiness =
  | 'unknown'
  | 'checking'
  | 'ready'
  | 'missing'
  | 'signed-out'
  | 'keyring'
  | 'sandboxed'
  | 'broken';

export function codexReadinessOf(detection: AgentDetectionState<CodexDetection>): CodexReadiness {
  if (detection.status === 'checking') return 'checking';
  if (detection.status !== 'done') return 'unknown';
  const result = detection.result;
  if (!result) return 'broken';
  if (result.unavailable) return 'sandboxed';
  if (!result.found) return 'missing';
  if (result.loggedIn === false) return result.loginStore === 'keyring' ? 'keyring' : 'signed-out';
  if (result.error) return 'broken';
  return 'ready';
}

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  promax: 'Pro Max',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
};

/** "0.162.0" out of "codex-cli 0.162.0-alpha.17.2". */
export function codexVersion(version: string | null | undefined): string | null {
  const match = version ? /\d+\.\d+\.\d+/.exec(version) : null;
  return match ? match[0] : null;
}

/** One line about the login Codex will use, or null when there is nothing worth saying. */
export function codexAccountLine(result: CodexDetection | null): string | null {
  if (!result?.found || result.loggedIn !== true) return null;
  if (result.authMethod === 'apiKey') return 'Signed in with an API key, so the agent is billed to that key';
  const plan = result.planType ? PLAN_NAMES[result.planType] : null;
  return plan ? `Uses your ChatGPT ${plan} plan` : 'Uses your ChatGPT plan';
}

interface CodexSetupProps {
  detection: AgentDetectionState<CodexDetection>;
  onRetry: () => void;
  /** Where a link goes. A detached panel window hands it to the editor. */
  onOpenLink?: (url: string) => void;
  className?: string;
}

/** The fix for whatever codexReadinessOf found. Renders nothing while Codex is ready or not looked for. */
export function CodexSetup({ detection, onRetry, onOpenLink = (url) => void openExternal(url), className }: CodexSetupProps) {
  const readiness = codexReadinessOf(detection);
  const checking = detection.status === 'checking';

  if (readiness === 'missing') {
    return (
      <Alert className={className}>
        <Download className="h-4 w-4" />
        <AlertTitle>Codex is not installed</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>Install it, run codex once in a terminal to sign in with ChatGPT, then check again.</p>
          <CommandLine command="npm install -g @openai/codex" />
          <p className="text-xs text-muted-foreground">
            The ChatGPT extension for VS Code comes with Codex too, and the app finds that copy.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <CheckAgainButton onRetry={onRetry} checking={checking} />
            <button
              type="button"
              onClick={() => onOpenLink(CODEX_INSTALL_URL)}
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
        <AlertTitle>Codex is not signed in</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>Run this in a terminal and sign in with your ChatGPT account, then check again.</p>
          <CommandLine command="codex login" />
          <CheckAgainButton onRetry={onRetry} checking={checking} />
        </AlertDescription>
      </Alert>
    );
  }

  if (readiness === 'keyring') {
    return (
      <Alert className={className}>
        <KeyRound className="h-4 w-4" />
        <AlertTitle>Codex keeps your login in the keychain</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            The app can only use a Codex login saved to a file. Sign in once more with this command, then check
            again.
          </p>
          <CommandLine command="codex login -c cli_auth_credentials_store=file" />
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
            The Mac App Store version cannot start other programs. The version from openscrgen.app can run Codex.
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
        <AlertTitle>Codex did not answer</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            {reason
              ? `It said: ${reason}`
              : 'The app found no working copy of Codex. Make sure codex runs in a terminal, then check again.'}
          </p>
          <CheckAgainButton onRetry={onRetry} checking={checking} />
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
