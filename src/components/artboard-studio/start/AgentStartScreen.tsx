"use client";

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, KeyRound, Loader2, Sparkles, UserRound } from 'lucide-react';
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
import { buildRelayPrompt } from '@/lib/ai/promptBuilder';
import { buildTemplateCatalog, serializeCatalog } from '@/lib/ai/templateCatalog';
import type { UploadedScreenshot } from '@/lib/ai/imageUtils';
import type { AiProviderId } from '@/lib/ai/providers';
import {
  BridgeError,
  runViaExtension,
  type BridgeStage,
  type WebProviderId,
} from '@/lib/ai/extensionBridge';
import { ApiKeyModePanel } from './ApiKeyModePanel';
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

  const catalogText = useMemo(
    () => (isLoadingTemplates ? '' : serializeCatalog(buildTemplateCatalog(templates))),
    [templates, isLoadingTemplates]
  );

  const relayPrompt = useMemo(
    () => buildRelayPrompt(catalogText, instruction, screenshots.length),
    [catalogText, instruction, screenshots.length]
  );

  /** Both modes funnel here: validate, build, and show the confirmation card. */
  const acceptPlan = useCallback(
    (raw: unknown) => {
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

  const runExtensionMode = useCallback(
    async (provider: WebProviderId) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setStage(null);
      setError(null);
      setResult(null);
      try {
        const reply = await runViaExtension(
          {
            provider,
            prompt: relayPrompt,
            images: screenshots.map((shot) => ({
              fileName: shot.fileName,
              dataUrl: shot.aiDataUrl,
            })),
          },
          { onStage: setStage, signal: controller.signal }
        );
        acceptPlan(extractJson(reply));
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
    [acceptPlan, relayPrompt, screenshots]
  );

  const submitPastedReply = useCallback(
    (reply: string) => {
      setResult(null);
      try {
        acceptPlan(extractJson(reply));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That reply could not be read.');
      }
    },
    [acceptPlan]
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
        <Tabs defaultValue="web" className="w-full">
          <TabsList>
            <TabsTrigger value="web" className="gap-1.5">
              <UserRound className="h-3.5 w-3.5" />
              Free, use my account
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              Use my API key
            </TabsTrigger>
          </TabsList>
          <TabsContent value="web" className="mt-4">
            <WebSessionModePanel
              prompt={relayPrompt}
              screenshotCount={screenshots.length}
              busy={busy}
              disabled={screenshots.length === 0 && !instruction.trim()}
              stage={stage}
              onRunViaExtension={(provider) => void runExtensionMode(provider)}
              onSubmitPastedReply={submitPastedReply}
              onCancel={cancel}
            />
          </TabsContent>
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
