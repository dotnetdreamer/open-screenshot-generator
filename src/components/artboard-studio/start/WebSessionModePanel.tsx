"use client";

import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  PlugZap,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { openExternal } from '@/lib/desktop';
import {
  BRIDGE_STAGE_TEXT,
  WEB_PROVIDERS,
  WEB_PROVIDER_IDS,
  detectExtension,
  type BridgeStage,
  type WebProviderId,
} from '@/lib/ai/extensionBridge';

interface WebSessionModePanelProps {
  prompt: string;
  screenshotCount: number;
  busy: boolean;
  disabled: boolean;
  stage: BridgeStage | null;
  /** Drives the site through the companion extension. */
  onRunViaExtension: (provider: WebProviderId) => void;
  /** Parses text the user pasted back from a chat window. */
  onSubmitPastedReply: (reply: string) => void;
  onCancel: () => void;
}

const EXTENSION_DOC_URL =
  'https://github.com/ikhan-dev/artboard-studio/tree/main/extension#readme';

/**
 * The free path: no API key, just the Claude / ChatGPT / Gemini account the
 * user is already signed into.
 *
 * With the companion extension installed this is one click. Without it, a page
 * cannot reach another origin's session, so the panel falls back to a manual
 * relay: copy the prompt, paste it into the chat with the screenshots attached,
 * paste the JSON reply back here.
 */
export function WebSessionModePanel({
  prompt,
  screenshotCount,
  busy,
  disabled,
  stage,
  onRunViaExtension,
  onSubmitPastedReply,
  onCancel,
}: WebSessionModePanelProps) {
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [checkedExtension, setCheckedExtension] = useState(false);
  const [copied, setCopied] = useState<WebProviderId | 'prompt' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [reply, setReply] = useState('');
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    void detectExtension().then((version) => {
      if (cancelled) return;
      setExtensionVersion(version);
      setCheckedExtension(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyPrompt = async (tag: WebProviderId | 'prompt') => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(tag);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(null), 2000);
      return true;
    } catch {
      // Denied permission, or a non secure context. Show the raw prompt instead.
      setCopyFailed(true);
      window.setTimeout(() => promptRef.current?.select(), 0);
      return false;
    }
  };

  const openSite = async (id: WebProviderId) => {
    // Both the clipboard write and the popup have to ride the same user gesture.
    await copyPrompt(id);
    void openExternal(WEB_PROVIDERS[id].url);
  };

  const hasExtension = Boolean(extensionVersion);

  return (
    <div className="space-y-5">
      {hasExtension ? (
        <div className="space-y-3">
          <Alert className="border-emerald-500/40 bg-emerald-500/5">
            <PlugZap className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Companion extension connected</AlertTitle>
            <AlertDescription>
              Pick the assistant you are signed into. Artboard Studio will run the prompt in a
              background tab and bring the answer back here.
            </AlertDescription>
          </Alert>
          <div className="grid gap-2 sm:grid-cols-3">
            {WEB_PROVIDER_IDS.map((id) => (
              <Button
                key={id}
                variant="outline"
                className="justify-start"
                disabled={disabled || busy}
                onClick={() => onRunViaExtension(id)}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Use {WEB_PROVIDERS[id].label}
              </Button>
            ))}
          </div>
          {busy && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="flex-1 text-muted-foreground">
                {stage ? `${BRIDGE_STAGE_TEXT[stage]}...` : 'Working...'}
              </span>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      ) : (
        checkedExtension && (
          <Alert>
            <PlugZap className="h-4 w-4" />
            <AlertTitle>One click mode needs the companion extension</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                A web page cannot reach the session on another site, so driving Claude, ChatGPT or
                Gemini for you happens inside a small browser extension. Install it once and this
                becomes a single button.
              </p>
              <button
                type="button"
                onClick={() => void openExternal(EXTENSION_DOC_URL)}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Install the companion extension
                <ExternalLink className="h-3 w-3" />
              </button>
            </AlertDescription>
          </Alert>
        )
      )}

      <div className="space-y-4">
        <p className="text-sm font-medium text-muted-foreground">
          {hasExtension ? 'Or do it by hand' : 'Do it by hand, in three steps'}
        </p>

        <Step index={1} title="Copy the prompt and open your assistant" done={copied !== null}>
          <div className="flex flex-wrap gap-2">
            {WEB_PROVIDER_IDS.map((id) => (
              <Button key={id} variant="outline" size="sm" onClick={() => void openSite(id)}>
                {copied === id ? (
                  <Check className="mr-2 h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                )}
                Copy and open {WEB_PROVIDERS[id].label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => void copyPrompt('prompt')}>
              {copied === 'prompt' ? (
                <Check className="mr-2 h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <ClipboardCopy className="mr-2 h-3.5 w-3.5" />
              )}
              Copy prompt only
            </Button>
          </div>
          {copyFailed && (
            <Textarea
              ref={promptRef}
              readOnly
              value={prompt}
              rows={6}
              className="mt-2 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </Step>

        <Step index={2} title="Paste it into the chat and attach your screenshots" done={false}>
          <p className="text-sm text-muted-foreground">
            {screenshotCount > 0
              ? `Attach all ${screenshotCount} screenshots in the same order as the numbered thumbnails above (thumbnail 0 first), then send.`
              : 'Add screenshots above first, then attach them in the chat in the same order.'}
          </p>
        </Step>

        <Step index={3} title="Paste the reply back here" done={false}>
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={5}
            placeholder='Paste the assistant&apos;s whole reply, including the ```json code block.'
            className="font-mono text-xs"
            disabled={busy}
          />
          <Button
            className="mt-2"
            disabled={disabled || busy || !reply.trim()}
            onClick={() => onSubmitPastedReply(reply)}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Build my project
          </Button>
        </Step>
      </div>
    </div>
  );
}

function Step({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
          done ? 'border-emerald-500 bg-emerald-500 text-white' : 'text-muted-foreground'
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : index}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}
