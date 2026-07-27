"use client";

import React, { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  loadAiSettings,
  saveAiSettings,
  type AiProviderId,
} from '@/lib/ai/providers';

interface ApiKeyModePanelProps {
  busy: boolean;
  disabled: boolean;
  onGenerate: (args: { provider: AiProviderId; model: string; apiKey: string }) => void;
  onCancel: () => void;
}

/**
 * "Bring your own key" mode. Calls run straight from this browser through the
 * Vercel AI SDK, so no key ever leaves the machine, and nothing works without a
 * key the user pastes in.
 */
export function ApiKeyModePanel({ busy, disabled, onGenerate, onCancel }: ApiKeyModePanelProps) {
  const [provider, setProvider] = useState<AiProviderId>('anthropic');
  const [model, setModel] = useState<string>(AI_PROVIDERS.anthropic.defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(false);

  // localStorage is only readable after mount (static export prerenders on the server).
  useEffect(() => {
    const stored = loadAiSettings();
    const storedKey = stored.keys[stored.provider];
    setProvider(stored.provider);
    setModel(stored.models[stored.provider] ?? AI_PROVIDERS[stored.provider].defaultModel);
    if (storedKey) {
      setApiKey(storedKey);
      setRemember(true);
    }
  }, []);

  const info = AI_PROVIDERS[provider];

  const switchProvider = (next: AiProviderId) => {
    const stored = loadAiSettings();
    setProvider(next);
    setModel(stored.models[next] ?? AI_PROVIDERS[next].defaultModel);
    setApiKey(stored.keys[next] ?? '');
  };

  const submit = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    const stored = loadAiSettings();
    saveAiSettings({
      provider,
      models: { ...stored.models, [provider]: model },
      keys: remember
        ? { ...stored.keys, [provider]: trimmed }
        : { ...stored.keys, [provider]: undefined },
    });
    onGenerate({ provider, model, apiKey: trimmed });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="agent-provider">Provider</Label>
          <Select
            value={provider}
            onValueChange={(value) => switchProvider(value as AiProviderId)}
            disabled={busy}
          >
            <SelectTrigger id="agent-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDER_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {AI_PROVIDERS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-model">Model</Label>
          <Select value={model} onValueChange={setModel} disabled={busy}>
            <SelectTrigger id="agent-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {info.models.map((id) => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agent-key" className="flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          {info.label} API key
        </Label>
        <Input
          id="agent-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={info.keyPlaceholder}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={busy}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="agent-remember"
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
              disabled={busy}
            />
            <Label htmlFor="agent-remember" className="text-xs font-normal text-muted-foreground">
              Remember on this device (stored unencrypted in this browser)
            </Label>
          </div>
          <button
            type="button"
            onClick={() => void openExternal(info.keyUrl)}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Get a key at {info.keyUrlLabel}
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={disabled || busy || !apiKey.trim()}>
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
