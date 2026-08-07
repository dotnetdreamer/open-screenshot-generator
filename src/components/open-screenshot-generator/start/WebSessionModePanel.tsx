"use client";

import React from 'react';
import { FlaskConical, Loader2, LogIn, Monitor, PlugZap, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BRIDGE_STAGE_TEXT, type BridgeStage } from '@/lib/ai/webSessionDesktop';
import { WEB_PROVIDERS, WEB_PROVIDER_IDS, type WebProviderId } from '@/lib/ai/webAdapters';
import { useT } from '@/i18n';

interface WebSessionModePanelProps {
  busy: boolean;
  disabled: boolean;
  stage: BridgeStage | null;
  /** true inside the desktop app: drive the provider in an in-app window. */
  desktop: boolean;
  /** Runs the provider automatically in the app's embedded webview. */
  onRunProvider: (provider: WebProviderId) => void;
  /** Open a provider window so the user can sign in first. */
  onLogin: (provider: WebProviderId) => void;
  onCancel: () => void;
}

/**
 * The free path: no API key, just the Claude / ChatGPT / Gemini / ... account
 * the user is already signed into.
 *
 * Desktop only: the app opens the assistant in its own window, the user signs
 * in once, and it runs there from then on (hidden, or visible via Settings >
 * "Show assistant window while it works"). A web page cannot reach another
 * site's session, so in the browser this tab just points at the desktop app.
 */
export function WebSessionModePanel({
  busy,
  disabled,
  stage,
  desktop,
  onRunProvider,
  onLogin,
  onCancel,
}: WebSessionModePanelProps) {
  const t = useT();
  if (!desktop) {
    return (
      <Alert>
        <Monitor className="h-4 w-4" />
        <AlertTitle>{t('startPanel.desktopOnlyTitle')}</AlertTitle>
        <AlertDescription>{t('startPanel.desktopOnlyDesc')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <Alert className="border-emerald-500/40 bg-emerald-500/5">
        <PlugZap className="h-4 w-4 text-emerald-600" />
        <AlertTitle>{t('startPanel.runsLocally')}</AlertTitle>
        <AlertDescription>
          {t('startPanel.runsLocallyDesc', { menuItem: t('startPanel.assistantWindowMenuItem') })}
        </AlertDescription>
      </Alert>
      <div className="grid gap-2 sm:grid-cols-2">
        {WEB_PROVIDER_IDS.map((id) => (
          <div key={id} className="flex items-center gap-1.5">
            <Button
              variant="outline"
              className="flex-1 justify-start"
              disabled={disabled || busy}
              onClick={() => onRunProvider(id)}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {t('startPanel.useProvider', { provider: WEB_PROVIDERS[id].label })}
              {!WEB_PROVIDERS[id].tested && (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                  <FlaskConical className="h-3 w-3" />
                  {t('startPanel.beta')}
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground"
              title={t('startPanel.signInTo', { provider: WEB_PROVIDERS[id].label })}
              disabled={busy}
              onClick={() => onLogin(id)}
            >
              <LogIn className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      {busy && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="flex-1 text-muted-foreground">
            {stage ? `${BRIDGE_STAGE_TEXT[stage]}...` : t('startPanel.working')}
          </span>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  );
}
