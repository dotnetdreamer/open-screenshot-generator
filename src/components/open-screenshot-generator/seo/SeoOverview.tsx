"use client";

// Where SEO opens: the score, the few things to fix first, an AI fix plan,
// and Google's numbers at a glance. With no site yet, a way to add one.

import React, { useState } from 'react';
import { ArrowRightIcon, GlobeIcon, KeyRoundIcon, Loader2Icon, SearchCheckIcon, SparklesIcon, WandSparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { setGrowthSettings, useGrowthSettings } from '@/lib/growth/settings';
import { plainFinding } from '@/lib/seo/plain';
import { addSiteAddress, analyticsOf, makePlan, searchOf, speedOf, startCheck, useSeo } from '@/lib/seo/state';
import { useSeoGoogle } from '@/lib/seo/googleSettings';
import { formatAgo } from '../storeCompliance/StoreComplianceShared';
import { AiLogo, AiPicker, type AiChoice } from '../growth/AiPicker';
import { Delta, Gated } from '../growth/GrowthShared';
import { InfoTip } from '../capture/InfoTip';
import { AreaBars, Card, CardTitle, EmptyState, ScoreRing, SeverityBadge, Tile, changeOf, formatNumber, scoreTone, shortAddress, useSeoView } from './SeoShared';

export function SeoOverview() {
  const view = useSeoView();
  if (!view.site) return <Welcome />;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
      <CheckError />
      {view.run ? <Results /> : <FirstCheck />}
    </div>
  );
}

function Welcome() {
  const view = useSeoView();
  const state = useSeo();
  const [address, setAddress] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const websiteSites = state.sites.filter((site) => site.source === 'website');
  const add = async () => {
    const result = await addSiteAddress(address);
    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    void startCheck(result.site.id, 'live', view.readProject);
  };
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[hsl(var(--seo-accent))] to-[hsl(var(--seo-accent))]/70 text-white shadow-md dark:text-background">
        <SearchCheckIcon className="h-7 w-7" />
      </span>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Check your app&apos;s website</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          See what keeps your site from showing up on Google and in AI answers like ChatGPT, and how to fix it. It&apos;s free, and you don&apos;t need an account.
        </p>
      </div>
      <form
        className="flex w-full max-w-md flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="myapp.com" aria-label="Your website's address" className="h-10 flex-1" autoComplete="url" />
        <Button type="submit" className="h-10 bg-[hsl(var(--seo-accent))] text-white hover:bg-[hsl(var(--seo-accent))]/90 dark:text-background" disabled={!address.trim()}>
          Check my site
        </Button>
      </form>
      {problem && (
        <p className="-mt-3 text-sm text-[hsl(var(--rules-critical))]" role="alert">
          {problem}
        </p>
      )}
      {!view.desktop && (
        <p className="-mt-3 max-w-md text-xs text-muted-foreground">
          In the browser, only sites that let other sites read them can be checked, like GitHub Pages. The desktop app checks any site.
        </p>
      )}
      {websiteSites.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">Or check a site you made in Website</p>
          <div className="flex flex-wrap justify-center gap-2">
            {websiteSites.map((site) => (
              <Button key={site.id} variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void startCheck(site.id, site.url ? 'live' : 'draft', view.readProject)}>
                <GlobeIcon className="h-3.5 w-3.5" />
                {site.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Uses the checks from claude-seo, an open source SEO toolkit
        <InfoTip label="What the check looks at">
          About 60 checks of each page and of the whole site: titles and descriptions, headings, links, pictures, phone setup, robots.txt, the sitemap, what AI tools can read, and copy that reads machine-made. It reads up to 30 pages and changes nothing on your site.
        </InfoTip>
      </p>
    </div>
  );
}

function CheckError() {
  const view = useSeoView();
  const error = view.state.errors.check;
  if (!error || error.siteId !== view.site?.id) return null;
  return (
    <div className="rounded-xl border border-[hsl(var(--rules-critical))]/30 bg-[hsl(var(--rules-critical))]/5 p-4 text-sm" role="alert" data-testid="seo-check-problem">
      <p className="font-medium">The check couldn&apos;t read {view.site?.name}</p>
      <p className="mt-1 text-muted-foreground">{error.message}</p>
    </div>
  );
}

const PHASE_WORDS: Record<string, string> = {
  start: 'Opening the home page',
  robots: 'Reading robots.txt and the sitemap',
  pages: 'Reading pages',
  extras: 'Looking for llms.txt',
  done: 'Putting it together',
};

function FirstCheck() {
  const view = useSeoView();
  const site = view.site!;
  const progress = view.state.progress?.siteId === site.id ? view.state.progress : null;
  if (progress || view.state.busy.check === site.id) {
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center" aria-busy="true">
        <Loader2Icon className="h-7 w-7 animate-spin text-[hsl(var(--seo-accent))]" />
        <p className="text-sm font-medium" role="status">
          {progress ? `${PHASE_WORDS[progress.phase]}${progress.phase === 'pages' ? `, ${progress.done} of ${progress.total}` : ''}` : 'Starting the check'}
        </p>
        {progress?.current && <p className="max-w-full truncate text-xs text-muted-foreground">{shortAddress(progress.current)}</p>}
      </Card>
    );
  }
  const draft = !site.url;
  return (
    <EmptyState icon={SearchCheckIcon} title={draft ? `${site.name} isn't online yet` : `Check ${site.name}`}>
      <p className="max-w-md text-sm text-muted-foreground">
        {draft
          ? "Check the pages the Website view will publish, so you can fix them before anyone sees them. Nothing is sent anywhere."
          : 'Reads up to 30 pages, robots.txt, the sitemap and llms.txt, then tells you what to fix first. It takes about a minute.'}
      </p>
      <Button className="mt-1 bg-[hsl(var(--seo-accent))] text-white hover:bg-[hsl(var(--seo-accent))]/90 dark:text-background" onClick={() => view.check()}>
        {draft ? 'Check before publishing' : 'Check now'}
      </Button>
    </EmptyState>
  );
}

function Results() {
  const view = useSeoView();
  const run = view.run!;
  const score = view.score ?? run.score;
  const tone = scoreTone(score.overall);
  const before = view.previous ? view.previous.score.overall : null;
  const pagesRead = run.pages.filter((page) => page.checks).length;
  const top = run.findings.slice(0, 5);
  const progress = view.state.progress?.siteId === view.site?.id ? view.state.progress : null;
  // A Website view site that moved keeps its last check, of the old address (state.ts, liveRunOf).
  const moved = run.mode === 'live' && !!run.site && !!view.site?.url && run.site !== view.site.url ? run.site : null;
  return (
    <>
      <Card className="grid gap-6 md:grid-cols-[auto,1fr] md:items-center" data-testid="seo-score">
        <div className="flex items-center gap-4">
          <ScoreRing score={score.overall} label="Site score" size={124} />
          <div className="space-y-1">
            <p className={cn('text-lg font-semibold', tone.text)}>{tone.words}</p>
            {before !== null && before !== score.overall && (
              <p className="text-xs text-muted-foreground">
                {score.overall > before ? 'Up' : 'Down'} {Math.abs(score.overall - before)} since the check before
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Checked {formatAgo(run.finishedAt)}, {pagesRead} {pagesRead === 1 ? 'page' : 'pages'}
              {run.leftOut ? `, ${run.leftOut} more not read` : ''}
            </p>
            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', run.mode === 'draft' ? 'bg-[hsl(var(--rules-medium))]/10 text-[hsl(var(--rules-medium))]' : 'bg-[hsl(var(--seo-accent))]/10 text-[hsl(var(--seo-accent))]')}>
              {run.mode === 'draft' ? 'Before publishing' : 'Live site'}
            </span>
            {progress && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <Loader2Icon className="h-3 w-3 animate-spin" />
                Checking again, {progress.done} of {progress.total}
              </p>
            )}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-1">
            <p className="text-xs font-medium">By area</p>
            <InfoTip label="How the score works">
              Each area is scored from what the check found, weighted the way claude-seo weights a site audit: basics and words count most, pictures least. Speed counts once you test it under Speed. Something found on every page costs more than something on one page.
            </InfoTip>
          </div>
          <AreaBars areas={score.areas} onPick={() => view.goTo('check')} />
        </div>
      </Card>

      {(moved || run.note || run.unread?.length) && (
        <div className="space-y-1 rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground" data-testid="seo-run-notes">
          {moved && (
            <p className="font-medium text-foreground">
              This check read {shortAddress(moved)}, where the site was before. Check again to read it at {shortAddress(view.site!.url)}.
            </p>
          )}
          {run.note && <p>{run.note}</p>}
          {run.unread?.length ? (
            <p title={run.unread.map(shortAddress).join('\n')}>
              Your browser couldn&apos;t read {run.unread.length === 1 ? shortAddress(run.unread[0]) : `${run.unread.length} addresses on this site`}, so{' '}
              {run.unread.length === 1 ? "it isn't" : "they aren't"} counted as missing or broken. The desktop app reads them.
            </p>
          ) : null}
        </div>
      )}

      <Card>
        <CardTitle
          title={top.length ? 'Fix these first' : 'Nothing important to fix'}
          hint={top.length ? `${run.findings.length} things found in all. Each one says why it matters and what to do.` : 'The check found nothing that holds your site back. Check again after you change it.'}
          actions={
            run.findings.length > 0 ? (
              <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => view.goTo('check')}>
                See all
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Button>
            ) : null
          }
        />
        <ul className="divide-y" data-testid="seo-top-findings">
          {top.map((finding) => {
            const plain = plainFinding(finding.id);
            const onPages = new Set(finding.pages.map((page) => page.url).filter(Boolean)).size;
            return (
              <li key={finding.id}>
                <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-muted/40" onClick={() => view.goTo('check', { finding: finding.id })}>
                  <SeverityBadge severity={finding.severity} className="w-[104px] justify-center" />
                  <span className="min-w-0 flex-1 truncate text-sm">{plain.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{onPages > 1 ? `${onPages} pages` : onPages === 1 ? '1 page' : 'Whole site'}</span>
                  <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      <PlanCard />
      <GoogleGlance />
    </>
  );
}

function PlanCard() {
  const view = useSeoView();
  const [settings] = useGrowthSettings();
  const site = view.site!;
  const run = view.run!;
  const plan = view.data.plan;
  const busy = view.state.busy.plan === site.id;
  const error = view.state.errors.plan?.siteId === site.id ? view.state.errors.plan : null;
  const fresh = plan?.runId === run.id;
  const aiChoice: AiChoice | null = settings.aiWriter && settings.aiWriter !== 'auto' ? settings.aiWriter : view.ai.inUse;
  return (
    <Card data-testid="seo-plan">
      <CardTitle
        icon={WandSparklesIcon}
        title="Your fix plan"
        hint={plan ? (fresh ? `Made ${formatAgo(plan.madeAt)} from the latest check` : 'Made from an older check. Make it again to match the latest one.') : 'AI turns the check into a few clear steps, the one that helps most first.'}
        actions={
          <>
            <div className="w-[350px] max-w-full">
              <AiPicker value={aiChoice} onPick={(choice) => setGrowthSettings({ aiWriter: choice })} title="The AI for SEO, Growth and Store compliance, one choice for all three" />
            </div>
            <Gated reason={view.ai.available ? null : view.ai.reason}>
              <Button size="sm" variant={plan ? 'outline' : 'default'} className={cn('h-8', !plan && 'bg-[hsl(var(--seo-accent))] text-white hover:bg-[hsl(var(--seo-accent))]/90 dark:text-background')} disabled={busy} onClick={() => void makePlan(site.id, site.name)}>
                {busy ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />}
                {busy ? 'Writing the plan' : plan ? 'Make it again' : 'Make my fix plan'}
              </Button>
            </Gated>
          </>
        }
      />
      {error && (
        <p className="mb-2 text-sm text-[hsl(var(--rules-critical))]" role="alert">
          {error.message}
        </p>
      )}
      {plan ? (
        <div className="space-y-3">
          {plan.summary && <p className="text-sm">{plan.summary}</p>}
          <ol className="space-y-2">
            {plan.steps.map((step, index) => (
              <li key={index} className="flex gap-3 rounded-lg border bg-background/60 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--seo-accent))]/10 text-xs font-semibold text-[hsl(var(--seo-accent))]">{index + 1}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{step.title}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{step.effort === 'quick' ? 'Quick' : step.effort === 'big' ? 'Bigger job' : 'Some work'}</span>
                  </div>
                  {step.why && <p className="text-xs text-muted-foreground">{step.why}</p>}
                  {step.how && <p className="text-sm">{step.how}</p>}
                  {step.findings.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {step.findings.map((id) => (
                        <button key={id} type="button" className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-[hsl(var(--seo-accent))]/40 hover:text-foreground" onClick={() => view.goTo('check', { finding: id })}>
                          {plainFinding(id).title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AiLogo choice={aiChoice} className="h-3 w-3" />
            Written by {view.ai.label ?? 'AI'} from the check and claude-seo&apos;s notes. The check itself is made by code.
          </p>
        </div>
      ) : (
        !busy && <p className="text-sm text-muted-foreground">No plan yet. It takes about half a minute.</p>
      )}
    </Card>
  );
}

function GoogleGlance() {
  const view = useSeoView();
  const google = useSeoGoogle();
  const search = searchOf(view.site?.id ?? null, view.state);
  const analytics = analyticsOf(view.site?.id ?? null, view.state);
  const mobile = speedOf(view.site, 'mobile', view.state);
  if (!search && !analytics && !mobile) {
    return (
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--seo-accent))]/10 text-[hsl(var(--seo-accent))]">
          <KeyRoundIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">See your numbers from Google</p>
          <p className="text-xs text-muted-foreground">How many people find your site on Google, what they search for, who visits and how fast your pages load. Free, with your own Google account.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {view.setUpGoogleWithAi && !google.active && (
            <Button size="sm" className="h-8 bg-[hsl(var(--seo-accent))] text-white hover:bg-[hsl(var(--seo-accent))]/90 dark:text-background" onClick={view.setUpGoogleWithAi}>
              <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
              Set up with Ask AI
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8" onClick={() => view.goTo(google.active ? 'search' : 'setup')}>
            {google.active ? 'Open Search' : 'Set it up myself'}
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => view.goTo('speed')}>
            Test speed
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {search && (
        <>
          <button type="button" className="text-left" onClick={() => view.goTo('search')}>
            <Tile label="Clicks from Google" value={formatNumber(search.totals.clicks)}>
              <Delta change={changeOf(search.totals.clicks, search.previous.clicks)} /> last 28 days
            </Tile>
          </button>
          <button type="button" className="text-left" onClick={() => view.goTo('search')}>
            <Tile label="Times seen on Google" value={formatNumber(search.totals.impressions)}>
              <Delta change={changeOf(search.totals.impressions, search.previous.impressions)} /> last 28 days
            </Tile>
          </button>
        </>
      )}
      {analytics && (
        <button type="button" className="text-left" onClick={() => view.goTo('visitors')}>
          <Tile label="Visitors" value={formatNumber(analytics.totals.users)}>
            <Delta change={changeOf(analytics.totals.users, analytics.previous.users)} /> last 28 days
          </Tile>
        </button>
      )}
      {mobile && (
        <button type="button" className="text-left" onClick={() => view.goTo('speed')}>
          <Tile label="Speed on phones" value={<span className={scoreTone(mobile.scores.performance).text}>{mobile.scores.performance ?? '?'}</span>}>
            Tested {formatAgo(mobile.fetchedAt)}
          </Tile>
        </button>
      )}
    </div>
  );
}
