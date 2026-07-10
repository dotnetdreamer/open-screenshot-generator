"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, KeyRound, Loader2, Sparkles, UserRound, Zap } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { Project } from '@/types/artboard';
import { AgentPlanSchema, formatPlanIssues, type AgentPlan } from '@/lib/ai/agentPlanSchema';
import { AgentBuildError, buildProjectFromPlan, type BuildResult } from '@/lib/ai/buildProjectFromPlan';
import { AgentError, generatePlan } from '@/lib/ai/generatePlan';
import { extractJson } from '@/lib/ai/jsonExtract';
import { buildCatalogArtifacts, resolveAliases, type AliasMap } from '@/lib/ai/aliasCatalog';
import {
  buildHostedCatalog,
  HOSTED_CATALOG_URL,
  readUrlFetchCapability,
  verifyHostedCatalog,
  writeUrlFetchCapability,
} from '@/lib/ai/hostedCatalog';
import {
  CANNOT_FETCH_SENTINEL,
  buildCompactRelayPrompt,
  buildRelayPrompt,
  buildUrlRelayPrompt,
} from '@/lib/ai/promptBuilder';
import { buildTemplateCatalog, serializeCatalog } from '@/lib/ai/templateCatalog';
import type { UploadedScreenshot } from '@/lib/ai/imageUtils';
import type { AiProviderId } from '@/lib/ai/providers';
import type { WebProviderId } from '@/lib/ai/webAdapters';
import {
  BridgeError,
  loginToProvider,
  runViaEmbeddedWebview,
  type BridgeStage,
} from '@/lib/ai/webSessionDesktop';
import {
  FreeProviderError,
  runFreeProvider,
  type FreeProviderId,
} from '@/lib/ai/freeProviders';
import { isTauri } from '@/lib/desktop';
import { ApiKeyModePanel } from './ApiKeyModePanel';
import { FreeProviderModePanel } from './FreeProviderModePanel';
import { ScreenshotUploader } from './ScreenshotUploader';
import { WebSessionModePanel } from './WebSessionModePanel';

interface AgentStartScreenProps {
  templates: Project[];
  isLoadingTemplates: boolean;
  onCreateProject: (project: Project, options: { nameOverride?: string }) => void | Promise<void>;
}

const EXAMPLE_INSTRUCTIONS = [
  'Put my screenshots into the template that fits them best',
  'Use the Breathora template and rewrite the copy for my meditation app',
  'Design something new from scratch based on my screenshots',
];

/**
 * Hard per-message caps, in characters, for providers that reject long
 * messages outright ("The message you submitted was too long"). ChatGPT's
 * free tier bounces at roughly 4k chars. Providers not listed get the full
 * compact prompt. When a cap applies, the catalog degrades stepwise (fewer
 * detailed templates, then a slim index only) until the prompt fits.
 */
const PROMPT_BUDGETS: Partial<Record<WebProviderId, number>> = {
  chatgpt: 3900,
};

export function AgentStartScreen({
  templates,
  isLoadingTemplates,
  onCreateProject,
}: AgentStartScreenProps) {
  const [screenshots, setScreenshots] = useState<UploadedScreenshot[]>([]);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<BridgeStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The built-in free providers need the Tauri HTTP bridge, so the tab only
  // exists in the desktop app. isTauri() reads window, hence the effect: the
  // static export must prerender the same markup the browser hydrates.
  const [desktop, setDesktop] = useState(false);
  const [mode, setMode] = useState('web');
  useEffect(() => {
    if (isTauri()) setDesktop(true);
  }, []);

  // Compact two-tier catalog + the alias map that turns the reply's short
  // refs (t12/d0/x1) back into real ids. Built in one pass so they can't
  // drift; falls back to the legacy full catalog if anything goes wrong.
  const catalogArtifacts = useMemo(() => {
    if (isLoadingTemplates) return null;
    try {
      return buildCatalogArtifacts(buildTemplateCatalog(templates), {
        screenshots: screenshots.map((shot) => ({ width: shot.width, height: shot.height })),
        instruction,
      });
    } catch {
      return null;
    }
  }, [templates, isLoadingTemplates, screenshots, instruction]);

  const catalogText = useMemo(
    () =>
      catalogArtifacts?.catalogText ??
      (isLoadingTemplates ? '' : serializeCatalog(buildTemplateCatalog(templates))),
    [catalogArtifacts, templates, isLoadingTemplates]
  );

  const relayPrompt = useMemo(
    () => buildRelayPrompt(catalogText, instruction, screenshots.length),
    [catalogText, instruction, screenshots.length]
  );

  // The repo-hosted catalog twin: same text and refs the deployed
  // /data/ai/catalog.txt carries, rebuilt locally for the expected token and
  // the alias map. Independent of instruction/screenshots.
  const hostedCatalog = useMemo(() => {
    if (isLoadingTemplates || templates.length === 0) return null;
    try {
      return buildHostedCatalog(templates);
    } catch {
      return null;
    }
  }, [templates, isLoadingTemplates]);

  /**
   * Fits the whole relay message under a provider's per-message cap: measures
   * the wrapper with an empty catalog, gives the catalog whatever is left,
   * and lets the serializer degrade until it fits.
   */
  const buildBudgetedRelay = useCallback(
    (budgetChars: number): { prompt: string; aliasMap: AliasMap } | null => {
      try {
        const overhead = buildCompactRelayPrompt('', instruction, screenshots.length, true).length;
        const artifacts = buildCatalogArtifacts(
          buildTemplateCatalog(templates),
          {
            screenshots: screenshots.map((shot) => ({ width: shot.width, height: shot.height })),
            instruction,
          },
          { budgetChars: Math.max(1000, budgetChars - overhead) }
        );
        return {
          prompt: buildCompactRelayPrompt(
            artifacts.catalogText,
            instruction,
            screenshots.length,
            artifacts.hasDetail
          ),
          aliasMap: artifacts.aliasMap,
        };
      } catch {
        return null;
      }
    },
    [templates, screenshots, instruction]
  );

  /** Both modes funnel here: validate, build, and show the confirmation card. */
  const acceptPlan = useCallback(
    (reply: unknown, aliasMap?: AliasMap) => {
      const raw = aliasMap ? resolveAliases(reply, aliasMap) : reply;
      const parsed = AgentPlanSchema.safeParse(raw);
      if (!parsed.success) {
        setError(
          `That reply was not a usable plan. ${formatPlanIssues(parsed.error, 3).join(' | ')}`
        );
        return;
      }
      try {
        setResult(buildProjectFromPlan(parsed.data as AgentPlan, screenshots, templates));
        setError(null);
      } catch (err) {
        setError(
          err instanceof AgentBuildError
            ? err.message
            : 'The plan could not be turned into a project.'
        );
      }
    },
    [screenshots, templates]
  );

  const runApiMode = useCallback(
    async (args: { provider: AiProviderId; model: string; apiKey: string }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const plan = await generatePlan({
          ...args,
          instruction,
          screenshots,
          templates,
          signal: controller.signal,
        });
        acceptPlan(plan);
      } catch (err) {
        setError(err instanceof AgentError ? err.message : 'Something went wrong.');
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [acceptPlan, instruction, screenshots, templates]
  );

  const runWebSession = useCallback(
    async (provider: WebProviderId) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setStage(null);
      setError(null);
      setResult(null);
      try {
        // Desktop only: the app drives the provider in its own in-app window
        // and resolves to the raw reply text. On the web the panel points to
        // the desktop app instead of offering run buttons. Screenshots attach
        // on the first send only: a URL->inline fallback reuses the same
        // conversation, so re-attaching would duplicate the uploads.
        let imagesSent = false;
        const send = (prompt: string) => {
          const images = imagesSent
            ? []
            : screenshots.map((shot) => ({ fileName: shot.fileName, dataUrl: shot.aiDataUrl }));
          imagesSent = true;
          return runViaEmbeddedWebview(
            { provider, prompt, images },
            { onStage: setStage, signal: controller.signal }
          );
        };

        // Inline prompt: providers with a hard message cap get a terse prompt
        // and a catalog shrunk to fit; the rest get the full compact prompt.
        const runInline = async () => {
          const budget = PROMPT_BUDGETS[provider];
          const payload = (budget ? buildBudgetedRelay(budget) : null) ?? {
            prompt: relayPrompt,
            aliasMap: catalogArtifacts?.aliasMap,
          };
          acceptPlan(extractJson(await send(payload.prompt)), payload.aliasMap);
        };

        // URL mode first: the message carries only the hosted catalog URL, and
        // the reply must echo the file's verification token. Decide whether to
        // even attempt it:
        //   - a cached 'ok' (same token) skips the preflight entirely;
        //   - a cached 'fail' skips URL mode (a provider we know cannot fetch);
        //   - otherwise preflight, so a catalog that is missing or built from
        //     different templates than this client holds falls back to inline
        //     without ever blaming the provider.
        const cached = hostedCatalog ? readUrlFetchCapability(provider, hostedCatalog.token) : null;
        let attemptUrl = false;
        if (hostedCatalog && cached === 'ok') {
          attemptUrl = true;
        } else if (hostedCatalog && cached !== 'fail') {
          const reachable = await verifyHostedCatalog(hostedCatalog.token, controller.signal);
          if (controller.signal.aborted) return;
          attemptUrl = reachable === 'ok';
          if (!attemptUrl) {
            console.info(
              `[agent] hosted catalog ${reachable} (${HOSTED_CATALOG_URL}); using the inline catalog. Deploy or regenerate it to enable URL mode.`
            );
          }
        }

        if (attemptUrl && hostedCatalog) {
          const reply = await send(
            buildUrlRelayPrompt(HOSTED_CATALOG_URL, instruction, screenshots.length)
          );
          let raw: unknown = null;
          try {
            raw = extractJson(reply);
          } catch {
            raw = null;
          }
          const echoed =
            raw && typeof raw === 'object' && !Array.isArray(raw)
              ? (raw as Record<string, unknown>).sourceToken
              : null;
          if (echoed === hostedCatalog.token) {
            writeUrlFetchCapability(provider, hostedCatalog.token, 'ok');
            acceptPlan(raw, hostedCatalog.aliasMap);
          } else {
            // Only an explicit, plan-less refusal is proof the provider could
            // not fetch and worth remembering. A token-less-but-otherwise-valid
            // reply, or the sentinel merely quoted inside a real plan's prose,
            // is treated as a one-off: fall back this run, cache nothing, retry
            // URL mode next time.
            if (raw === null && reply.includes(CANNOT_FETCH_SENTINEL)) {
              writeUrlFetchCapability(provider, hostedCatalog.token, 'fail');
            }
            await runInline();
          }
        } else {
          await runInline();
        }
      } catch (err) {
        if (!(err instanceof BridgeError && err.code === 'cancelled')) {
          setError(err instanceof Error ? err.message : 'The assistant could not be reached.');
        }
      } finally {
        abortRef.current = null;
        setStage(null);
        setBusy(false);
      }
    },
    [acceptPlan, relayPrompt, screenshots, instruction, catalogArtifacts, buildBudgetedRelay, hostedCatalog]
  );

  const loginWebProvider = useCallback((provider: WebProviderId) => {
    void loginToProvider(provider).catch(() => {
      setError('The sign-in window could not be opened.');
    });
  }, []);

  const runFreeMode = useCallback(
    async (args: { provider: FreeProviderId; model: string }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const reply = await runFreeProvider({
          ...args,
          prompt: relayPrompt,
          images: screenshots.map((shot) => shot.aiDataUrl),
          signal: controller.signal,
        });
        acceptPlan(extractJson(reply), catalogArtifacts?.aliasMap);
      } catch (err) {
        if (!(err instanceof FreeProviderError && err.code === 'cancelled')) {
          setError(err instanceof Error ? err.message : 'The provider could not be reached.');
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [acceptPlan, relayPrompt, screenshots, catalogArtifacts]
  );

  const cancel = () => abortRef.current?.abort();

  const create = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await onCreateProject(result.project, { nameOverride: result.project.name });
    } finally {
      setBusy(false);
    }
  };

  if (isLoadingTemplates) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-2">
      <section className="space-y-2">
        <Label className="text-sm font-medium">1. Add your app screenshots</Label>
        <ScreenshotUploader screenshots={screenshots} onChange={setScreenshots} disabled={busy} />
      </section>

      <section className="space-y-2">
        <Label htmlFor="agent-instruction" className="text-sm font-medium">
          2. Tell the agent what you want
        </Label>
        <Textarea
          id="agent-instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          disabled={busy}
          placeholder="Put my screenshots into a clean dark template and write copy for a habit tracker called Droply."
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_INSTRUCTIONS.map((example) => (
            <button
              key={example}
              type="button"
              disabled={busy}
              onClick={() => setInstruction(example)}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <Label className="text-sm font-medium">3. Choose how the agent runs</Label>
        <Tabs value={mode} onValueChange={setMode} className="w-full">
          <TabsList>
            <TabsTrigger value="web" className="gap-1.5">
              <UserRound className="h-3.5 w-3.5" />
              Free, use my account
            </TabsTrigger>
            {desktop && (
              <TabsTrigger value="free" className="gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Free, built in
              </TabsTrigger>
            )}
            <TabsTrigger value="api" className="gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              Use my API key
            </TabsTrigger>
          </TabsList>
          <TabsContent value="web" className="mt-4">
            <WebSessionModePanel
              busy={busy}
              disabled={screenshots.length === 0 && !instruction.trim()}
              stage={stage}
              desktop={desktop}
              onRunProvider={(provider) => void runWebSession(provider)}
              onLogin={loginWebProvider}
              onCancel={cancel}
            />
          </TabsContent>
          {desktop && (
            <TabsContent value="free" className="mt-4">
              <FreeProviderModePanel
                screenshotCount={screenshots.length}
                busy={busy}
                disabled={screenshots.length === 0 && !instruction.trim()}
                onGenerate={(args) => void runFreeMode(args)}
                onCancel={cancel}
              />
            </TabsContent>
          )}
          <TabsContent value="api" className="mt-4">
            <ApiKeyModePanel
              busy={busy}
              disabled={screenshots.length === 0 && !instruction.trim()}
              onGenerate={(args) => void runApiMode(args)}
              onCancel={cancel}
            />
          </TabsContent>
        </Tabs>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      )}

      {result && <PlanSummary result={result} busy={busy} onCreate={() => void create()} />}
    </div>
  );
}

function PlanSummary({
  result,
  busy,
  onCreate,
}: {
  result: BuildResult;
  busy: boolean;
  onCreate: () => void;
}) {
  const { summary, warnings, project } = result;
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold">{project.name}</h4>
          {project.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{project.description}</p>
          )}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li>
              {summary.action === 'use-template'
                ? `Template: ${summary.templateName}`
                : 'Brand new design'}
            </li>
            <li>{summary.artboardCount} artboards</li>
            <li>{summary.screenshotsPlaced} screenshots placed</li>
            {summary.textsUpdated > 0 && <li>{summary.textsUpdated} texts rewritten</li>}
          </ul>
          {warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-amber-600 dark:text-amber-500">
              {warnings.slice(0, 4).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
        <Button onClick={onCreate} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create project
        </Button>
      </div>
    </section>
  );
}
