"use client";

// The Mac App Store version runs in Apple's sandbox, where Claude Code and
// Codex can't see their sign-in. A script the user saves in the app's folder
// in ~/Library/Application Scripts runs outside it (src-tauri/src/outside.rs),
// and the app can't write that folder itself, so this card asks the user to
// save it once from a save dialog the app opens there. ClaudeCodeSetup and
// CodexSetup show it while the detection says the helper is missing or old.

import { useState } from 'react';
import { FileCog, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { addAppStoreHelper } from '@/lib/appStoreHelper';
import { InfoTip } from '../capture/InfoTip';

interface AppStoreHelperSetupProps {
  /** "Claude Code" or "Codex", for the title. */
  agentName: string;
  /** Whose plan the agent runs on: "Claude" or "ChatGPT". */
  planName: string;
  /** A helper an older version saved, which this one can't use. */
  outdated: boolean;
  /** Looks for the agent again once the helper is saved. */
  onAdded: () => void;
  className?: string;
}

export function AppStoreHelperSetup({ agentName, planName, outdated, onAdded, className }: AppStoreHelperSetupProps) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setAdding(true);
    setError(null);
    try {
      if (await addAppStoreHelper()) onAdded();
    } catch (err) {
      console.error('Adding the App Store helper failed', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Alert className={className}>
      <FileCog className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-1">
        {outdated ? `Update the helper to use ${agentName}` : `Let this app start ${agentName}`}
        <InfoTip label="What's the helper file?">
          <p>It's a small text file that lets this app start Claude Code and Codex for you, signed in as you.</p>
          <p>
            It's saved in your Library folder, under Application Scripts. This app can read it but can't change it.
            To undo this, delete the file.
          </p>
        </InfoTip>
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {outdated
            ? 'This version of the app needs a newer helper file. Click Update the helper, then click Save, and then Replace.'
            : `Mac App Store apps can't start other programs on their own, so this app needs a small helper file. Click Add the helper, then click Save in the window that opens. You only do this once, and ${agentName} then works with your own ${planName} plan.`}
        </p>
        {error && <p className="text-destructive">{error}</p>}
        <Button size="sm" onClick={() => void add()} disabled={adding}>
          {adding && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {outdated ? 'Update the helper' : 'Add the helper'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
