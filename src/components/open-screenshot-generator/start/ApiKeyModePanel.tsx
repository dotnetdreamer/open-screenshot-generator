"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Eye, KeyRound, Loader2, RefreshCw, Sparkles } from 'lucide-react';
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
import { isTauri, openExternal } from '@/lib/desktop';
import { looksLikeVisionModel } from '@/lib/ai/freeProviders';
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  COMPATIBLE_PRESETS,
  CUSTOM_PRESET_ID,
  endpointApiKey,
  endpointHost,
  findCompatiblePreset,
  isLocalEndpoint,
  listCompatibleModels,
  loadAiSettings,
  normalizeBaseUrl,
  presetForBaseUrl,
  saveAiSettings,
  type AiProviderId,
  type AiSettings,
  type CompatibleModel,
} from '@/lib/ai/providers';

export interface ApiKeyRunArgs {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  /** The endpoint the user named, or empty for the provider's own. */
  baseUrl: string;
}

interface ApiKeyModePanelProps {
  busy: boolean;
  disabled: boolean;
  screenshotCount: number;
  onGenerate: (args: ApiKeyRunArgs) => void;
  onCancel: () => void;
}

/**
 * "Bring your own key" mode. Calls run straight from this browser through the
 * Vercel AI SDK, so no key ever leaves the machine, and nothing works without a
 * key the user pastes in.
 *
 * The last provider in the picker is any OpenAI-compatible endpoint at all: a
 * subscription we ship no entry for (MiniMax, DeepSeek, Groq), a gateway, or a
 * server on this machine. Two things follow from that and shape the rest:
 *
 *  - The endpoint, not the provider, is the identity. A key belongs to the host
 *    it was typed against and is swapped out the moment the host changes, so a
 *    DeepSeek key is never sent to Groq because the user changed their mind.
 *  - Nothing about an endpoint is known until it is asked. The model id is free
 *    text with the endpoint's own /models list behind a button, because a model
 *    id typed from memory is the likeliest way to get a 404 that reads like an
 *    outage.
 */
export function ApiKeyModePanel({
  busy,
  disabled,
  screenshotCount,
  onGenerate,
  onCancel,
}: ApiKeyModePanelProps) {
  const [provider, setProvider] = useState<AiProviderId>('anthropic');
  const [model, setModel] = useState<string>(AI_PROVIDERS.anthropic.defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  /** Only consulted while the URL field is empty; otherwise the URL decides. */
  const [presetChoice, setPresetChoice] = useState('');
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [discovered, setDiscovered] = useState<CompatibleModel[] | null>(null);
  /** The host that list came from, so editing the URL retires it. */
  const [discoveredFor, setDiscoveredFor] = useState('');
  const [listing, setListing] = useState(false);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  /** Which endpoint the key and model on screen belong to. */
  const [boundHost, setBoundHost] = useState('');
  const [desktop, setDesktop] = useState(false);
  const modelListId = useId();
  // Bumped by anything that invalidates an in-flight model listing, so a slow
  // endpoint answering after the user moved on cannot write into the new state.
  const listingToken = useRef(0);

  // isTauri() reads window, and the static export prerenders the same markup
  // the browser hydrates, so the desktop-only note waits for mount.
  useEffect(() => {
    if (isTauri()) setDesktop(true);
  }, []);

  /** Put every field back to what this provider was last left on. */
  const hydrate = useCallback((next: AiProviderId, stored: AiSettings) => {
    const target = AI_PROVIDERS[next];
    const storedBase = stored.baseUrls[next] ?? '';
    const storedKey = target.requiresBaseUrl
      ? endpointApiKey(stored, storedBase)
      : (stored.keys[next] ?? '');
    listingToken.current += 1;
    setProvider(next);
    setBaseUrl(storedBase);
    setModel(stored.models[next] ?? target.defaultModel);
    setApiKey(storedKey);
    setBoundHost(target.requiresBaseUrl ? endpointHost(storedBase) : '');
    setRemember(Boolean(storedKey));
    setDiscovered(null);
    setDiscoveredFor('');
    setModelsNote(null);
    setShowEndpoint(Boolean(storedBase) && !target.requiresBaseUrl);
    if (target.requiresBaseUrl) setPresetChoice(presetForBaseUrl(storedBase)?.id ?? '');
  }, []);

  // localStorage is only readable after mount (static export prerenders on the server).
  useEffect(() => {
    const stored = loadAiSettings();
    hydrate(stored.provider, stored);
  }, [hydrate]);

  const info = AI_PROVIDERS[provider];
  const custom = info.requiresBaseUrl === true;
  const normalized = normalizeBaseUrl(baseUrl);
  const host = endpointHost(normalized);
  const local = isLocalEndpoint(normalized);
  // The URL is the truth about which service this is. The stored choice only
  // fills the picker in before anything has been typed.
  const matched = presetForBaseUrl(normalized);
  const preset = custom
    ? (matched ??
      (normalized ? findCompatiblePreset(CUSTOM_PRESET_ID) : findCompatiblePreset(presetChoice)))
    : null;
  const presetValue = custom ? (matched?.id ?? (normalized ? CUSTOM_PRESET_ID : presetChoice)) : '';
  const named = preset && preset.id !== CUSTOM_PRESET_ID ? preset : null;

  // A key belongs to the endpoint it was typed against. If the URL has moved on
  // since, the key on screen is not the one a request may use.
  const keyInUse =
    !custom || boundHost === host ? apiKey.trim() : endpointApiKey(loadAiSettings(), normalized);

  const models = discoveredFor === host && discovered ? discovered : null;
  const suggestions = models ? models.map((m) => m.id) : (preset?.models ?? []);
  const seesImages = models
    ? models.find((m) => m.id === model)?.vision === true
    : looksLikeVisionModel(model);

  const ready = custom
    ? normalized.length > 0 && model.trim().length > 0 && (local || keyInUse.length > 0)
    : apiKey.trim().length > 0;

  /**
   * Point the key at whatever endpoint is now on screen. Called when the service
   * changes and when the URL field is left, never on each keystroke: a key would
   * otherwise be wiped halfway through typing the host it belongs to.
   */
  const adoptEndpoint = useCallback(
    (nextBaseUrl: string) => {
      const nextHost = endpointHost(nextBaseUrl);
      if (nextHost === boundHost) return;
      const storedKey = endpointApiKey(loadAiSettings(), nextBaseUrl);
      setApiKey(storedKey);
      setBoundHost(nextHost);
      setRemember(Boolean(storedKey));
    },
    [boundHost]
  );

  const applyPreset = (id: string) => {
    listingToken.current += 1;
    setPresetChoice(id);
    setDiscovered(null);
    setDiscoveredFor('');
    setModelsNote(null);
    const next = findCompatiblePreset(id);
    // "Other" is a choice about the picker, not about the endpoint: whatever
    // the user already typed stays exactly as it is.
    if (!next || next.id === CUSTOM_PRESET_ID) return;
    setBaseUrl(next.baseUrl);
    setModel(next.models[0] ?? '');
    adoptEndpoint(next.baseUrl);
  };

  const loadModels = useCallback(async () => {
    const token = (listingToken.current += 1);
    const forHost = endpointHost(baseUrl);
    setListing(true);
    setModelsNote(null);
    try {
      const found = await listCompatibleModels({ baseUrl, apiKey: apiKey.trim() });
      // The user switched provider or endpoint while this was in flight. Writing
      // now would put one endpoint's model ids against another's URL.
      if (listingToken.current !== token) return;
      setDiscovered(found);
      setDiscoveredFor(forHost);
      setModelsNote(`${found.length} model${found.length === 1 ? '' : 's'} on this endpoint`);
      setModel((current) => (found.some((m) => m.id === current) ? current : found[0].id));
    } catch (error) {
      if (listingToken.current !== token) return;
      setDiscovered(null);
      setDiscoveredFor('');
      setModelsNote(error instanceof Error ? error.message : 'Could not list the models');
    } finally {
      if (listingToken.current === token) setListing(false);
    }
  }, [apiKey, baseUrl]);

  const submit = () => {
    if (!ready) return;
    const trimmedModel = model.trim();
    const stored = loadAiSettings();
    const compatibleKeys = { ...stored.compatibleKeys };
    if (custom && host) {
      if (remember && keyInUse) compatibleKeys[host] = keyInUse;
      else delete compatibleKeys[host];
    }
    saveAiSettings({
      provider,
      models: { ...stored.models, [provider]: trimmedModel },
      baseUrls: { ...stored.baseUrls, [provider]: normalized },
      compatibleKeys,
      keys: custom
        ? stored.keys
        : remember
          ? { ...stored.keys, [provider]: keyInUse }
          : { ...stored.keys, [provider]: undefined },
    });
    onGenerate({ provider, model: trimmedModel, apiKey: keyInUse, baseUrl: normalized });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="agent-provider">Provider</Label>
          <Select
            value={provider}
            onValueChange={(value) => hydrate(value as AiProviderId, loadAiSettings())}
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

        {custom ? (
          <div className="space-y-1.5">
            <Label htmlFor="agent-service">Service</Label>
            <Select value={presetValue} onValueChange={applyPreset} disabled={busy}>
              <SelectTrigger id="agent-service">
                <SelectValue placeholder="Pick one, or paste a URL" />
              </SelectTrigger>
              <SelectContent>
                {COMPATIBLE_PRESETS.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
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
        )}
      </div>

      {custom && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="agent-base-url">Base URL</Label>
            <Input
              id="agent-base-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.minimax.io/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={(e) => {
                // A model id belongs to its endpoint just as a key does. Only
                // once there was an endpoint to leave, so someone who types the
                // model before the URL keeps what they typed.
                if (boundHost && endpointHost(e.target.value) !== boundHost) setModel('');
                adoptEndpoint(e.target.value);
              }}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Where /chat/completions would start. Paste the whole endpoint if that is what you
              have, the tail is trimmed for you
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-model-id">Model</Label>
            <div className="flex gap-2">
              <Input
                id="agent-model-id"
                list={modelListId}
                autoComplete="off"
                spellCheck={false}
                placeholder="model id"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
              />
              <datalist id={modelListId}>
                {suggestions.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadModels()}
                disabled={busy || listing || normalized.length === 0}
                title="Ask this endpoint what it serves"
              >
                {listing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="ml-2 hidden sm:inline">Load</span>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {seesImages && model.trim().length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  <Eye className="h-3 w-3" />
                  sees images
                </span>
              )}
              {modelsNote && <span className="text-xs text-muted-foreground">{modelsNote}</span>}
            </div>
          </div>
        </div>
      )}

      {custom && screenshotCount > 0 && model.trim().length > 0 && !seesImages && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Nothing in that model name says it can see images. If the agent ignores your screenshots,
          pick a vision model on this endpoint
        </p>
      )}

      {custom && !desktop && (
        <p className="text-xs text-muted-foreground">
          In a browser this only works if the endpoint allows direct calls from a web page. The
          desktop app has no such limit, and it is the only way to reach a server on this machine
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="agent-key" className="flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" />
          {custom ? (named ? `${named.label} API key` : 'API key') : `${info.label} API key`}
          {custom && local && <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        <Input
          id="agent-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={custom && local ? 'usually not needed' : info.keyPlaceholder}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            // Typed against this endpoint, so it is this endpoint's key.
            setBoundHost(host);
          }}
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
          {custom && preset?.setupUrl ? (
            <button
              type="button"
              onClick={() => void openExternal(preset.setupUrl!)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Get it at {preset.setupUrlLabel}
              <ExternalLink className="h-3 w-3" />
            </button>
          ) : (
            (custom ? named?.keyUrl : info.keyUrl) && (
              <button
                type="button"
                onClick={() => void openExternal((custom ? named!.keyUrl! : info.keyUrl))}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Get a key at {custom ? named!.keyUrlLabel : info.keyUrlLabel}
                <ExternalLink className="h-3 w-3" />
              </button>
            )
          )}
        </div>
      </div>

      {!custom && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowEndpoint((open) => !open)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showEndpoint ? '' : '-rotate-90'}`}
            />
            Custom base URL
          </button>
          {showEndpoint && (
            <>
              <Input
                id="agent-provider-base-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={info.defaultBaseUrl}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                For a proxy, a gateway or a self-hosted clone of this provider. Leave it empty to
                call {info.label} directly
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={disabled || busy || !ready}>
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
