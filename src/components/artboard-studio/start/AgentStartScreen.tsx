"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, History, Info, KeyRound, Loader2, Sparkles, Trash2, UserRound, Zap } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { Project } from '@/types/artboard';
import { AgentPlanSchema, formatPlanIssues, type AgentPlan } from '@/lib/ai/agentPlanSchema';
import { AgentBuildError, buildProjectFromPlan, type BuildResult } from '@/lib/ai/buildProjectFromPlan';
import { AgentError, generatePlan } from '@/lib/ai/generatePlan';
import { extractJsonCandidates } from '@/lib/ai/jsonExtract';
import { buildCatalogArtifacts, resolveAliases, type AliasMap } from '@/lib/ai/aliasCatalog';
import {
  buildHostedCatalog,
  clearUrlFetchCapabilities,
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
import { AI_PROVIDERS, type AiProviderId } from '@/lib/ai/providers';
import { WEB_PROVIDERS, type WebProviderId } from '@/lib/ai/webAdapters';
import {
  BridgeError,
  clearWebSessions,
  loginToProvider,
  runViaEmbeddedWebview,
  type BridgeStage,
} from '@/lib/ai/webSessionDesktop';
import {
  FREE_PROVIDERS,
  FreeProviderError,
  runFreeProvider,
  type FreeProviderId,
} from '@/lib/ai/freeProviders';
import { OperationRecorder, type OperationStatus } from '@/lib/ai/operationLog';
import { isTauri } from '@/lib/desktop';
import { useToast } from '@/hooks/use-toast';
import { ApiKeyModePanel } from './ApiKeyModePanel';
import { FreeProviderModePanel } from './FreeProviderModePanel';
import { OperationTimelineDialog } from './OperationTimelineDialog';
import { RunHistoryDialog } from './RunHistoryDialog';
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

/** What acceptPlan reports back so a run can record its final status. */
type PlanOutcome = { ok: true } | { ok: false; message: string };

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

  // The finished operation behind the current error, so the alert's info icon
  // can open its timeline; plus the timeline and run-history dialog flags.
  const [errorOpId, setErrorOpId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

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

  /**
   * Validate a reply and build the project without touching UI state, so a
   * caller can try several candidates and only commit the one that works.
   */
  const evaluatePlan = useCallback(
    (
      reply: unknown,
      aliasMap?: AliasMap
    ): { ok: true; result: BuildResult } | { ok: false; message: string } => {
      const raw = aliasMap ? resolveAliases(reply, aliasMap) : reply;
      const parsed = AgentPlanSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          message: `That reply was not a usable plan. ${formatPlanIssues(parsed.error, 3).join(' | ')}`,
        };
      }
      try {
        return { ok: true, result: buildProjectFromPlan(parsed.data as AgentPlan, screenshots, templates) };
      } catch (err) {
        return {
          ok: false,
          message:
            err instanceof AgentBuildError
              ? err.message
              : 'The plan could not be turned into a project.',
        };
      }
    },
    [screenshots, templates]
  );

  /**
   * Commit a single already-parsed plan value (API and hosted-URL modes, where
   * the reply is one object). Shows the confirmation card or the error, and
   * returns the outcome so the caller can record it in the run's timeline.
   */
  const acceptPlan = useCallback(
    (reply: unknown, aliasMap?: AliasMap): PlanOutcome => {
      const outcome = evaluatePlan(reply, aliasMap);
      if (outcome.ok) {
        setResult(outcome.result);
        setError(null);
        return { ok: true };
      }
      setError(outcome.message);
      return { ok: false, message: outcome.message };
    },
    [evaluatePlan]
  );

  /**
   * Commit the first usable plan from a raw assistant reply that may hold more
   * than one JSON object. Gemini sometimes answers with two options (two
   * drafts), and chatty replies can lead with a small example object; trying
   * each candidate in turn means a rejected first block no longer sinks the run.
   */
  const acceptPlanFromReply = useCallback(
    (reply: string, aliasMap?: AliasMap): PlanOutcome => {
      let firstFailure: string | null = null;
      for (const candidate of extractJsonCandidates(reply)) {
        const outcome = evaluatePlan(candidate, aliasMap);
        if (outcome.ok) {
          setResult(outcome.result);
          setError(null);
          return { ok: true };
        }
        if (firstFailure === null) firstFailure = outcome.message;
      }
      const message =
        firstFailure ??
        'Could not find a usable plan in that reply. Copy the whole JSON code block from the assistant.';
      setError(message);
      return { ok: false, message };
    },
    [evaluatePlan]
  );

  const runApiMode = useCallback(
    async (args: { provider: AiProviderId; model: string; apiKey: string }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      setResult(null);
      setErrorOpId(null);
      setInfoOpen(false);
      const recorder = new OperationRecorder({
        mode: 'api',
        provider: args.provider,
        providerLabel: AI_PROVIDERS[args.provider].label,
        model: args.model,
        instruction,
        screenshotCount: screenshots.length,
      });
      let status: OperationStatus = 'error';
      try {
        recorder.message('app-to-provider', 'Request sent', {
          detail: `provider: ${args.provider}\nmodel: ${args.model}\nscreenshots: ${screenshots.length}\n\n${instruction}`,
        });
        const plan = await generatePlan({
          ...args,
          instruction,
          screenshots,
          templates,
          signal: controller.signal,
        });
        recorder.message('provider-to-app', 'Plan received', {
          detail: JSON.stringify(plan, null, 2),
        });
        const outcome = acceptPlan(plan);
        status = outcome.ok ? 'success' : 'error';
        if (outcome.ok) recorder.note('Plan accepted, project built');
        else recorder.error('plan-rejected', outcome.message);
      } catch (err) {
        if (controller.signal.aborted) {
          status = 'cancelled';
        } else {
          const message = err instanceof AgentError ? err.message : 'Something went wrong.';
          setError(message);
          recorder.error(err instanceof AgentError ? 'provider-error' : 'unknown', message);
          status = 'error';
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        if (status === 'error') setErrorOpId(recorder.id);
        void recorder.finish(status);
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
      setErrorOpId(null);
      setInfoOpen(false);

      const recorder = new OperationRecorder({
        mode: 'web',
        provider,
        providerLabel: WEB_PROVIDERS[provider].label,
        instruction,
        screenshotCount: screenshots.length,
      });
      let status: OperationStatus = 'error';
      const applyOutcome = (outcome: PlanOutcome) => {
        if (outcome.ok) {
          status = 'success';
          recorder.note('Plan accepted, project built');
        } else {
          status = 'error';
          recorder.error('plan-rejected', outcome.message);
        }
      };

      try {
        // Desktop only: the app drives the provider in its own in-app window
        // and resolves to the raw reply text. On the web the panel points to
        // the desktop app instead of offering run buttons. Screenshots attach
        // on the first send only: a URL->inline fallback reuses the same
        // conversation, so re-attaching would duplicate the uploads.
        let imagesSent = false;
        const send = async (prompt: string, label: string) => {
          const images = imagesSent
            ? []
            : screenshots.map((shot) => ({ fileName: shot.fileName, dataUrl: shot.aiDataUrl }));
          imagesSent = true;
          recorder.message('app-to-provider', label, { detail: prompt });
          const reply = await runViaEmbeddedWebview(
            { provider, prompt, images },
            { onStage: setStage, signal: controller.signal, recorder }
          );
          recorder.message('provider-to-app', 'Reply received', { detail: reply });
          return reply;
        };

        // Inline prompt: providers with a hard message cap get a terse prompt
        // and a catalog shrunk to fit; the rest get the full compact prompt.
        const runInline = async () => {
          const budget = PROMPT_BUDGETS[provider];
          const payload = (budget ? buildBudgetedRelay(budget) : null) ?? {
            prompt: relayPrompt,
            aliasMap: catalogArtifacts?.aliasMap,
          };
          applyOutcome(acceptPlanFromReply(await send(payload.prompt, 'Prompt sent (inline catalog)'), payload.aliasMap));
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
          if (controller.signal.aborted) {
            status = 'cancelled';
            return;
          }
          attemptUrl = reachable === 'ok';
          if (!attemptUrl) {
            console.info(
              `[agent] hosted catalog ${reachable} (${HOSTED_CATALOG_URL}); using the inline catalog. Deploy or regenerate it to enable URL mode.`
            );
          }
        }

        if (attemptUrl && hostedCatalog) {
          const reply = await send(
            buildUrlRelayPrompt(HOSTED_CATALOG_URL, instruction, screenshots.length),
            'Prompt sent (hosted catalog URL)'
          );
          // Try EVERY JSON object in the reply, not just the first: a reasoning
          // model (GLM) prefixes its answer with an empty scratch/skeleton plan,
          // so "first parseable object" grabs the wrong one. The fetch succeeded
          // only if some object echoes our verification token.
          const echoedPlan = extractJsonCandidates(reply).find(
            (c) =>
              c !== null &&
              typeof c === 'object' &&
              !Array.isArray(c) &&
              (c as Record<string, unknown>).sourceToken === hostedCatalog.token
          );
          if (echoedPlan) {
            writeUrlFetchCapability(provider, hostedCatalog.token, 'ok');
            applyOutcome(acceptPlan(echoedPlan, hostedCatalog.aliasMap));
          } else {
            // No object echoed the token. If the provider explicitly said it
            // could not fetch, remember that so later runs skip URL mode -- even
            // when it also emitted a junk empty-plan skeleton alongside the
            // sentinel. GLM does exactly that; requiring "no JSON at all" (raw
            // === null) left the verdict uncached and made EVERY GLM run re-pay
            // the URL preflight + a wasted provider round-trip. A token-less
            // reply with NO sentinel stays a one-off: cache nothing, retry URL
            // next time (covers a real plan whose prose merely quotes it).
            if (reply.includes(CANNOT_FETCH_SENTINEL)) {
              writeUrlFetchCapability(provider, hostedCatalog.token, 'fail');
            }
            recorder.note('Hosted-catalog URL did not return a usable plan; retrying with the inline catalog');
            await runInline();
          }
        } else {
          await runInline();
        }
      } catch (err) {
        if (err instanceof BridgeError && err.code === 'cancelled') {
          status = 'cancelled';
        } else {
          const message = err instanceof Error ? err.message : 'The assistant could not be reached.';
          setError(message);
          recorder.error(err instanceof BridgeError ? err.code : 'unknown', message);
          status = 'error';
        }
      } finally {
        abortRef.current = null;
        setStage(null);
        setBusy(false);
        if (status === 'error') setErrorOpId(recorder.id);
        void recorder.finish(status);
      }
    },
    [acceptPlan, acceptPlanFromReply, relayPrompt, screenshots, instruction, catalogArtifacts, buildBudgetedRelay, hostedCatalog]
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
      setErrorOpId(null);
      setInfoOpen(false);
      const recorder = new OperationRecorder({
        mode: 'free',
        provider: args.provider,
        providerLabel: FREE_PROVIDERS[args.provider].label,
        model: args.model,
        instruction,
        screenshotCount: screenshots.length,
      });
      let status: OperationStatus = 'error';
      try {
        recorder.message('app-to-provider', 'Prompt sent', { detail: relayPrompt });
        const reply = await runFreeProvider({
          ...args,
          prompt: relayPrompt,
          images: screenshots.map((shot) => shot.aiDataUrl),
          signal: controller.signal,
        });
        recorder.message('provider-to-app', 'Reply received', { detail: reply });
        const outcome = acceptPlanFromReply(reply, catalogArtifacts?.aliasMap);
        status = outcome.ok ? 'success' : 'error';
        if (outcome.ok) recorder.note('Plan accepted, project built');
        else recorder.error('plan-rejected', outcome.message);
      } catch (err) {
        if (err instanceof FreeProviderError && err.code === 'cancelled') {
          status = 'cancelled';
        } else {
          const message = err instanceof Error ? err.message : 'The provider could not be reached.';
          setError(message);
          recorder.error(err instanceof FreeProviderError ? err.code : 'unknown', message);
          status = 'error';
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        if (status === 'error') setErrorOpId(recorder.id);
        void recorder.finish(status);
      }
    },
    [acceptPlanFromReply, relayPrompt, screenshots, catalogArtifacts, instruction]
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
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">3. Choose how the agent runs</Label>
          <div className="flex items-center gap-1">
            {desktop && <ClearSessionsButton busy={busy} />}
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <History className="h-3.5 w-3.5" />
              Recent runs
            </button>
          </div>
        </div>
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
        <Alert variant="destructive" className="relative pr-12">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
          {errorOpId && (
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              title="See what happened: full timeline and screenshots"
              aria-label="See what happened"
              className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Info className="h-4 w-4" />
            </button>
          )}
        </Alert>
      )}

      {result && <PlanSummary result={result} busy={busy} onCreate={() => void create()} />}

      <OperationTimelineDialog operationId={errorOpId} open={infoOpen} onOpenChange={setInfoOpen} />
      <RunHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

/**
 * Sign out of every connected assistant. Desktop only: the "use my account"
 * sessions live in the app's embedded webviews, so this wipes their shared
 * cookie jar and forgets the cached fetch verdicts, letting a stuck provider
 * start clean. Guarded by a confirm dialog since it is a sign-out.
 */
function ClearSessionsButton({ busy }: { busy: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const clear = useCallback(async () => {
    setClearing(true);
    try {
      await clearWebSessions();
      clearUrlFetchCapabilities();
      toast({
        title: 'Sessions cleared',
        description:
          'Signed out of every connected assistant. The next run will ask you to sign in again.',
      });
      setOpen(false);
    } catch (err) {
      toast({
        title: 'Could not clear sessions',
        description: err instanceof Error ? err.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setClearing(false);
    }
  }, [toast]);

  return (
    <AlertDialog open={open} onOpenChange={(next) => !clearing && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear sessions
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear all assistant sessions?</AlertDialogTitle>
          <AlertDialogDescription>
            This signs you out of every connected assistant (Claude, ChatGPT, Gemini, and the
            rest) by clearing their saved logins. Your projects and run history are not affected.
            Use it to start fresh if a provider is stuck. You will sign in again on the next run.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            // Keep the dialog open until the async work settles, then close it
            // ourselves so a failure can stay put and show the error toast.
            onClick={(e) => {
              e.preventDefault();
              void clear();
            }}
            disabled={clearing}
          >
            {clearing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Clear sessions
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
