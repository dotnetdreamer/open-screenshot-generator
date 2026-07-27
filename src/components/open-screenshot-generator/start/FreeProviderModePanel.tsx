"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, Eye, Loader2, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { openExternal } from '@/lib/desktop';
import {
  FREE_PROVIDERS,
  FREE_PROVIDER_IDS,
  detectFreeProvider,
  loadFreeAiSettings,
  saveFreeAiSettings,
  type FreeProviderId,
  type FreeProviderStatus,
} from '@/lib/ai/freeProviders';

interface FreeProviderModePanelProps {
  screenshotCount: number;
  busy: boolean;
  disabled: boolean;
  onGenerate: (args: { provider: FreeProviderId; model: string }) => void;
  onCancel: () => void;
}

/**
 * Desktop-only free mode: no key, no account, no server of ours. Pollinations
 * is a free public cloud endpoint; Ollama and LM Studio run models on the
 * user's own machine. Detection happens live so the panel always reflects what
 * this machine can actually do.
 */
export function FreeProviderModePanel({
  screenshotCount,
  busy,
  disabled,
  onGenerate,
  onCancel,
}: FreeProviderModePanelProps) {
  const [provider, setProvider] = useState<FreeProviderId>('pollinations');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<FreeProviderStatus | null>(null);
  const [detecting, setDetecting] = useState(true);

  const detect = useCallback(async (id: FreeProviderId) => {
    setDetecting(true);
    setStatus(null);
    const result = await detectFreeProvider(id);
    setStatus(result);
    setDetecting(false);
    const stored = loadFreeAiSettings().models[id];
    const preferred =
      (stored && result.models.some((m) => m.id === stored) && stored) || result.models[0]?.id || '';
    setModel(preferred);
  }, []);

  // localStorage is only readable after mount (static export prerenders on the server).
  useEffect(() => {
    const initial = loadFreeAiSettings().provider;
    setProvider(initial);
    void detect(initial);
  }, [detect]);

  const info = FREE_PROVIDERS[provider];
  const selectedModel = status?.models.find((m) => m.id === model);
  const running = status?.running ?? false;

  const switchProvider = (next: FreeProviderId) => {
    setProvider(next);
    const stored = loadFreeAiSettings();
    saveFreeAiSettings({ ...stored, provider: next });
    void detect(next);
  };

  const submit = () => {
    if (!model) return;
    const stored = loadFreeAiSettings();
    saveFreeAiSettings({ provider, models: { ...stored.models, [provider]: model } });
    onGenerate({ provider, model });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="free-provider">Provider</Label>
          <Select
            value={provider}
            onValueChange={(value) => switchProvider(value as FreeProviderId)}
            disabled={busy}
          >
            <SelectTrigger id="free-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREE_PROVIDER_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {FREE_PROVIDERS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="free-model">Model</Label>
          <Select value={model} onValueChange={setModel} disabled={busy || detecting || !running}>
            <SelectTrigger id="free-model">
              <SelectValue placeholder={detecting ? 'Checking...' : 'No models found'} />
            </SelectTrigger>
            <SelectContent>
              {status?.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="flex items-center gap-2">
                    <span className="truncate">{m.label}</span>
                    {m.vision === true && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                        <Eye className="h-3 w-3" />
                        sees images
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {detecting ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking {info.label}...
        </div>
      ) : running ? (
        <Alert className="border-emerald-500/40 bg-emerald-500/5">
          {info.kind === 'cloud' ? (
            <Zap className="h-4 w-4 text-emerald-600" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          )}
          <AlertTitle>
            {info.kind === 'cloud'
              ? 'Free cloud service, ready'
              : `${info.label} detected, ${status?.models.length ?? 0} model${(status?.models.length ?? 0) === 1 ? '' : 's'} installed`}
          </AlertTitle>
          <AlertDescription>{info.description}</AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <Download className="h-4 w-4" />
          <AlertTitle>
            {info.kind === 'cloud' ? `${info.label} is unreachable` : `${info.label} is not running`}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{info.description}</p>
            <div className="flex flex-wrap items-center gap-3">
              {info.setupUrl && (
                <button
                  type="button"
                  onClick={() => void openExternal(info.setupUrl!)}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Get it at {info.setupUrlLabel}
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
              <Button size="sm" variant="outline" onClick={() => void detect(provider)}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {running && screenshotCount > 0 && selectedModel && selectedModel.vision !== true && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          This model may not be able to see your screenshots. Pick one with the &quot;sees
          images&quot; badge so the agent can read what is in them.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={disabled || busy || detecting || !running || !model}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {busy ? 'Designing...' : 'Generate design'}
        </Button>
        {busy && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
