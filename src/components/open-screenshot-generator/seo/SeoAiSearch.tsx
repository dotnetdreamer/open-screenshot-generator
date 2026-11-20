"use client";

// Whether AI tools can read the site: which AI crawlers and agents the
// site's robots.txt lets in, llms.txt (with an AI draft to start from), and
// whether the home page has its words without JavaScript.

import React, { useState } from 'react';
import { BotIcon, CheckCircle2Icon, DownloadIcon, FileTextIcon, HelpCircleIcon, Loader2Icon, MinusCircleIcon, SparklesIcon, XCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { saveBlobToDisk } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { draftLlmsTxt } from '@/lib/seo/ai';
import type { AgentRole, LlmsVerdict } from '@/lib/seo/checks';
import { llmsUnread } from '@/lib/seo/report';
import { getKnowledgeState } from '@/lib/seo/sync';
import { Gated } from '../growth/GrowthShared';
import { CopyButton } from '../storeCompliance/StoreComplianceShared';
import { InfoTip } from '../capture/InfoTip';
import { Card, CardTitle, EmptyState, useSeoView } from './SeoShared';

const ROLE_WORDS: Record<AgentRole, string> = {
  training: 'Collects pages to train AI models',
  search: 'Finds pages to show in AI answers',
  user: 'Opens a page when someone asks it to',
  control: 'A setting for how this company may use your pages for AI',
  ads: 'Checks the pages ads point to',
};

const TOOL_WORDS: Record<string, string> = {
  GPTBot: 'ChatGPT',
  'OAI-SearchBot': 'ChatGPT search',
  'ChatGPT-User': 'ChatGPT',
  'OAI-AdsBot': 'ChatGPT ads',
  ClaudeBot: 'Claude',
  'Claude-SearchBot': 'Claude search',
  'Claude-User': 'Claude',
  PerplexityBot: 'Perplexity',
  'Perplexity-User': 'Perplexity',
  'Google-Extended': 'Gemini and Google AI',
  'Google-Agent': 'Google AI',
  'Applebot-Extended': 'Apple Intelligence',
  CCBot: 'Common Crawl (used by many AI makers)',
};

export function SeoAiSearch() {
  const view = useSeoView();
  const run = view.run;
  if (!run) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState icon={BotIcon} title="Check your site first">
          <p className="max-w-sm text-sm text-muted-foreground">The check reads robots.txt and llms.txt and tells you which AI tools can read your site.</p>
          {view.site && (
            <Button className="mt-1" onClick={() => view.check()}>
              Check now
            </Button>
          )}
        </EmptyState>
      </div>
    );
  }
  // Per page when the run has it; a run from before looked at "/" alone.
  const access = run.aiAccess === undefined ? undefined : run.aiAccess;
  const accessOf = (token: string, rootAllowed: boolean): { home: boolean; blocked: string[] } | null => {
    if (access === null) return null;
    const entry = access?.find((item) => item.token === token);
    return entry ? { home: entry.homeAllowed, blocked: entry.blocked } : { home: rootAllowed, blocked: [] };
  };
  const rows = run.robots.agents.map((agent) => ({ agent, access: accessOf(agent.token, agent.rootAllowed) }));
  const keptOut = rows.filter((row) => row.access && !row.access.home).length;
  const partly = rows.filter((row) => row.access?.home && row.access.blocked.length).length;
  const summary =
    access === null
      ? "Your browser couldn't read your robots.txt, so this check can't say which AI tools may read your site. The desktop app can read it."
      : keptOut
        ? `${keptOut} AI ${keptOut === 1 ? 'tool is' : 'tools are'} kept out by your robots.txt.`
        : partly
          ? `${partly} AI ${partly === 1 ? 'tool is' : 'tools are'} kept from some of your pages.`
          : 'Every AI tool on the list may read the pages this check read.';
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div>
        <h2 className="text-base font-semibold">AI search</h2>
        <p className="text-xs text-muted-foreground">
          {summary} Being readable is the first step to showing up in ChatGPT, Claude, Perplexity and Google AI answers.
        </p>
      </div>

      <Card className="p-0">
        <div className="border-b p-4">
          <CardTitle
            icon={BotIcon}
            title="Who can read your site"
            hint={
              access === null
                ? "robots.txt couldn't be read, so these are unknown."
                : run.robots.reachable === 'missing'
                  ? "Your site has no robots.txt, so all of them may. That's fine unless you want to keep some out."
                  : run.robots.reachable === 'server-error'
                    ? 'robots.txt answers with an error, so careful crawlers treat the whole site as closed.'
                    : `From your site's robots.txt, for the ${run.pages.filter((page) => page.checks).length} pages this check read.`
            }
            actions={
              <InfoTip label="About these crawlers">
                AI companies read sites with named crawlers. A search crawler is what puts your pages into AI answers, so blocking one keeps you out of that tool. Training crawlers only collect pages for future models. Some agents that open a page for one person don't follow robots.txt at all.
              </InfoTip>
            }
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="seo-ai-agents">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">AI tool</th>
                <th className="px-4 py-2 font-medium">What it does</th>
                <th className="px-4 py-2 font-medium">Your site</th>
              </tr>
            </thead>
            <tbody className="divide-y [&>tr:nth-child(even)]:bg-transparent">
              {rows.map(({ agent, access: reads }) => (
                <tr key={agent.token}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{TOOL_WORDS[agent.token] ?? agent.vendor}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{agent.token}</p>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {ROLE_WORDS[agent.role]}
                    {agent.behaviour === 'generally ignores' || agent.behaviour === 'may not apply' ? <span className="block text-[11px]">May not follow robots.txt</span> : null}
                  </td>
                  <td className="px-4 py-2.5" data-testid={`seo-ai-access-${agent.token}`}>
                    {!reads ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <HelpCircleIcon className="h-3.5 w-3.5" />
                        Unknown
                      </span>
                    ) : !reads.home ? (
                      <span className={cn('inline-flex items-center gap-1 text-xs', agent.role === 'search' ? 'text-[hsl(var(--rules-high))]' : 'text-muted-foreground')}>
                        <XCircleIcon className="h-3.5 w-3.5" />
                        Kept out
                      </span>
                    ) : reads.blocked.length ? (
                      <span
                        className={cn('inline-flex items-center gap-1 text-xs', agent.role === 'search' ? 'text-[hsl(var(--rules-medium))]' : 'text-muted-foreground')}
                        title={`Kept from ${reads.blocked.join(', ')}`}
                      >
                        <MinusCircleIcon className="h-3.5 w-3.5" />
                        Kept from {reads.blocked.length} {reads.blocked.length === 1 ? 'page' : 'pages'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--growth-good))]">
                        <CheckCircle2Icon className="h-3.5 w-3.5" />
                        Can read it
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <LlmsCard verdict={run.llms} existing={run.llmsText} />

      {run.rendered && (
        <Card>
          <CardTitle
            icon={FileTextIcon}
            title="Words without JavaScript"
            hint="Many AI tools read a page without running its JavaScript, so the words have to be in the page itself."
          />
          <p className="text-sm">
            {run.rendered.status === 'fail'
              ? `Your home page shows ${run.rendered.words} words until JavaScript runs. AI tools that don't run it see an empty page.`
              : run.rendered.status === 'warn'
                ? `Your home page shows ${run.rendered.words} words without JavaScript. More of the main words in the page itself helps AI tools.`
                : `Your home page shows ${run.rendered.words} words without JavaScript. That's plenty for AI tools.`}
          </p>
        </Card>
      )}
    </div>
  );
}

const LLMS_WORDS: Record<LlmsVerdict['lighthouse'], { title: string; tone: string }> = {
  pass: { title: 'Your llms.txt is in good shape', tone: 'text-[hsl(var(--growth-good))]' },
  fail: { title: 'Your llms.txt has mistakes', tone: 'text-[hsl(var(--rules-medium))]' },
  'not-applicable': { title: "Your site doesn't have an llms.txt yet", tone: 'text-muted-foreground' },
};

function LlmsCard({ verdict, existing }: { verdict: LlmsVerdict; existing: string | null }) {
  const view = useSeoView();
  const [draft, setDraft] = useState<{ text: string; verdict: LlmsVerdict } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A file the check couldn't read says nothing either way.
  const unread = llmsUnread(verdict);
  const words = unread ? { title: "This check couldn't read llms.txt, so it can't say whether you have one", tone: 'text-muted-foreground' } : LLMS_WORDS[verdict.lighthouse];
  const write = async () => {
    if (!view.run) return;
    setBusy(true);
    setProblem(null);
    try {
      setDraft(await draftLlmsTxt({ run: view.run, siteName: view.site?.name ?? '', knowledge: getKnowledgeState() }));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The AI did not answer. Try again');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="seo-llms">
      <CardTitle
        icon={FileTextIcon}
        title="llms.txt"
        hint="A short guide to your site for AI tools, in a file called llms.txt at the root of the site. It's a proposal, not a rule: Google doesn't use it, and Lighthouse checks it."
        actions={
          <Gated reason={view.ai.available ? null : view.ai.reason}>
            <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => void write()}>
              {busy ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />}
              {busy ? 'Writing' : draft ? 'Write again' : verdict.lighthouse === 'pass' ? 'Write a new one' : 'Write one with AI'}
            </Button>
          </Gated>
        }
      />
      <p className={cn('text-sm font-medium', words.tone)}>{words.title}</p>
      {!unread && verdict.errors.length > 0 && verdict.lighthouse === 'fail' && (
        <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
          {verdict.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {problem && (
        <p className="mt-2 text-sm text-[hsl(var(--rules-critical))]" role="alert">
          {problem}
        </p>
      )}
      {draft && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn('text-xs', draft.verdict.lighthouse === 'pass' ? 'text-[hsl(var(--growth-good))]' : 'text-[hsl(var(--rules-medium))]')}>
              {draft.verdict.lighthouse === 'pass' ? 'This draft passes the Lighthouse check' : `This draft still has mistakes: ${draft.verdict.errors.join(', ')}`}
            </p>
            <div className="ml-auto flex gap-2">
              <CopyButton text={draft.text} label="Copy" />
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void saveBlobToDisk(new Blob([draft.text], { type: 'text/markdown' }), 'llms.txt')}>
                <DownloadIcon className="h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-3 font-mono text-xs text-foreground">{draft.text}</pre>
          <p className="text-xs text-muted-foreground">Read it through, then put it at the root of your site as llms.txt, next to robots.txt.</p>
        </div>
      )}
      {!draft && existing && verdict.lighthouse !== 'not-applicable' && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Show the file your site has</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-3 font-mono text-xs text-foreground">{existing.slice(0, 20000)}</pre>
        </details>
      )}
    </Card>
  );
}
