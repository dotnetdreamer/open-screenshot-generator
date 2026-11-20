"use client";

// How fast a page loads, from Google: PageSpeed Insights tests it the way
// Google's own tool does, and the Chrome UX Report gives real Chrome
// visitors' numbers over 25 weeks. Both need a free Google API key and work
// in the browser too. Speed counts toward the site score once it has run.

import React, { useState } from 'react';
import { GaugeIcon, Loader2Icon, PlayIcon, UsersRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { VITALS, rate, type Rating, type Strategy, type VitalId } from '@/lib/seo/google';
import { useSeoGoogle } from '@/lib/seo/googleSettings';
import { CRUX_SHARED_HOST, loadCrux, runSpeed, siteIsWholeHost, siteOrigin, speedOf } from '@/lib/seo/state';
import { formatAgo } from '../storeCompliance/StoreComplianceShared';
import { Gated } from '../growth/GrowthShared';
import { InfoTip } from '../capture/InfoTip';
import { Card, CardTitle, ScoreRing, shortAddress, useSeoView } from './SeoShared';

const OPPORTUNITY_WORDS: Record<string, string> = {
  'render-blocking-resources': 'Files that hold up the first paint',
  'uses-responsive-images': 'Pictures bigger than the space they fill',
  'offscreen-images': 'Pictures below the screen that load first',
  'unminified-css': 'Style files that could be smaller',
  'unminified-javascript': 'Script files that could be smaller',
  'unused-css-rules': "Styles the page doesn't use",
  'unused-javascript': "Scripts the page doesn't use",
  'uses-optimized-images': 'Pictures that could be compressed more',
  'modern-image-formats': 'Pictures that could use WebP or AVIF',
  'uses-text-compression': 'Files sent without compression',
  'server-response-time': 'The server is slow to answer',
  redirects: 'Redirects before the page loads',
  'efficient-animated-content': 'Animated GIFs that could be videos',
  'duplicated-javascript': 'The same script loaded twice',
  'legacy-javascript': 'Extra script for old browsers',
  'uses-rel-preconnect': 'Connections to other sites made late',
  'prioritize-lcp-image': 'The main picture loads late',
};

const RATING_STYLE: Record<Rating, { words: string; text: string; dot: string }> = {
  good: { words: 'Good', text: 'text-[hsl(var(--growth-good))]', dot: 'bg-[hsl(var(--growth-good))]' },
  okay: { words: 'Needs work', text: 'text-[hsl(var(--rules-medium))]', dot: 'bg-[hsl(var(--rules-medium))]' },
  poor: { words: 'Poor', text: 'text-[hsl(var(--rules-critical))]', dot: 'bg-[hsl(var(--rules-critical))]' },
};

function formatVital(id: VitalId, value: number): string {
  if (id === 'cls') return value.toFixed(2);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

export function SeoSpeed() {
  const view = useSeoView();
  const google = useSeoGoogle();
  const site = view.site;
  const [strategy, setStrategy] = useState<Strategy>('mobile');
  const pages = (view.run?.pages ?? []).filter((page) => page.checks && (page.status ?? 200) < 400 && view.run?.mode === 'live');
  // The page picked belongs to the site it was picked on: after a switch of
  // site, the test is of the new site's home page until one of its own is picked.
  const [picked, setPicked] = useState<{ siteId: string; url: string } | null>(null);
  const url = (picked && site && picked.siteId === site.id && pages.some((page) => page.finalUrl === picked.url) ? picked.url : null) ?? pages[0]?.finalUrl ?? site?.url ?? '';
  const result = speedOf(site, strategy, view.state);
  const wholeHost = siteIsWholeHost(site, view.run);
  const busy = view.state.busy.speed === site?.id;
  const error = view.state.errors.speed?.siteId === site?.id ? view.state.errors.speed : null;
  const reason = !site ? 'Add a site first' : !site.url ? 'Publish the site first: PageSpeed tests pages that are online' : !google.apiKey ? 'Add a free Google API key under Setup first' : null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Speed</h2>
          <p className="text-xs text-muted-foreground">Google tests the page the way its PageSpeed tool does. It takes up to a minute.</p>
        </div>
        <div role="group" aria-label="Test on" className="flex rounded-lg border bg-muted/30 p-0.5">
          {(['mobile', 'desktop'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={strategy === choice}
              onClick={() => setStrategy(choice)}
              className={cn('rounded-md px-3 py-1 text-xs transition-colors', strategy === choice ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {choice === 'mobile' ? 'Phone' : 'Computer'}
            </button>
          ))}
        </div>
        {pages.length > 1 && (
          <Select value={url} onValueChange={(next) => site && setPicked({ siteId: site.id, url: next })}>
            <SelectTrigger className="h-8 w-[220px] text-xs" aria-label="Page to test">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pages.map((page) => (
                <SelectItem key={page.finalUrl} value={page.finalUrl} className="text-xs">
                  {page.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Gated reason={reason}>
          <Button size="sm" className="h-8 bg-[hsl(var(--seo-accent))] text-white hover:bg-[hsl(var(--seo-accent))]/90 dark:text-background" disabled={busy} onClick={() => site && void runSpeed(site.id, url || site.url, strategy)} data-testid="seo-test-speed">
            {busy ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlayIcon className="mr-1.5 h-3.5 w-3.5" />}
            {busy ? 'Testing' : result ? 'Test again' : 'Test speed'}
          </Button>
        </Gated>
      </div>
      {error && (
        <p className="rounded-xl border border-[hsl(var(--rules-critical))]/30 bg-[hsl(var(--rules-critical))]/5 p-3 text-sm" role="alert">
          {error.message}
        </p>
      )}
      {!result ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          {busy ? <Loader2Icon className="h-7 w-7 animate-spin text-[hsl(var(--seo-accent))]" /> : <GaugeIcon className="h-7 w-7 text-[hsl(var(--seo-accent))]" />}
          <p className="text-sm text-muted-foreground">
            {busy ? `Google is testing ${shortAddress(url || site?.url || '')}` : google.apiKey ? `No ${strategy === 'mobile' ? 'phone' : 'computer'} test yet` : "Google's PageSpeed only answers with a free Google API key."}
          </p>
          {!busy && !google.apiKey && (
            <Button size="sm" variant="outline" className="mt-1 h-8" onClick={() => view.goTo('setup')}>
              Add a key in Setup
            </Button>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <CardTitle
              icon={GaugeIcon}
              title={`${shortAddress(result.testedUrl ?? result.url)} on a ${strategy === 'mobile' ? 'phone' : 'computer'}`}
              hint={`Tested ${formatAgo(result.fetchedAt)} with Google's PageSpeed Insights${result.testedUrl && result.testedUrl !== result.url ? `. ${shortAddress(result.url)} redirects here` : ''}`}
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  ['Speed', result.scores.performance],
                  ['Accessibility', result.scores.accessibility],
                  ['Best practices', result.scores.bestPractices],
                  ['SEO', result.scores.seo],
                ] as const
              ).map(([label, score]) => (
                <div key={label} className="flex flex-col items-center gap-1.5">
                  <ScoreRing score={score} size={76} label={label} />
                  <p className="text-xs font-medium">{label}</p>
                </div>
              ))}
            </div>
            {Object.keys(result.lab).length > 0 && (
              <dl className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
                {result.lab.lcp && <LabFact label="Main picture shows" value={formatVital('lcp', result.lab.lcp.value)} rating={rate('lcp', result.lab.lcp.value)} />}
                {result.lab.fcp && <LabFact label="Something shows" value={formatVital('fcp', result.lab.fcp.value)} rating={rate('fcp', result.lab.fcp.value)} />}
                {result.lab.cls && <LabFact label="Page stays still" value={formatVital('cls', result.lab.cls.value)} rating={rate('cls', result.lab.cls.value)} />}
              </dl>
            )}
          </Card>

          {/* Site-wide numbers are a whole host's: for a site in a folder they'd be other sites' visitors too. */}
          {result.field && (result.field.scope === 'page' || wholeHost) && (
            <Card>
              <CardTitle
                icon={UsersRoundIcon}
                title="What real visitors get"
                hint={result.field.scope === 'page' ? 'From Chrome users who opened this page in the last 28 days' : 'For the whole site: this page alone has too few Chrome visitors'}
                actions={
                  <InfoTip label="About Core Web Vitals">
                    Google uses these three numbers from real visitors to judge a page&apos;s experience. A page passes when most visits are good on all three. The test above is one run in Google&apos;s lab; these are what people actually see.
                  </InfoTip>
                }
              />
              <dl className="grid gap-3 sm:grid-cols-3">
                {(['lcp', 'inp', 'cls'] as const).map((id) => {
                  const value = result.field?.metrics[id];
                  return value === undefined ? null : <LabFact key={id} label={VITALS[id].short} value={formatVital(id, value)} rating={rate(id, value)} title={VITALS[id].name} />;
                })}
              </dl>
            </Card>
          )}

          {result.opportunities.length > 0 && (
            <Card>
              <CardTitle title="What would make it faster" hint="PageSpeed's suggestions, the biggest saving first. The saving is Google's estimate." />
              <ul className="divide-y">
                {result.opportunities.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-2 text-sm" title={entry.title}>
                    <span className="min-w-0 flex-1">{OPPORTUNITY_WORDS[entry.id] ?? entry.title}</span>
                    {entry.saving && <span className="shrink-0 text-xs text-muted-foreground">{entry.saving}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <CruxCard hasKey={Boolean(google.apiKey)} />
    </div>
  );
}

function LabFact({ label, value, rating, title }: { label: string; value: string; rating: Rating; title?: string }) {
  const style = RATING_STYLE[rating];
  return (
    <div title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        <span className={cn('inline-flex items-center gap-1 text-xs font-medium', style.text)}>
          <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
          {style.words}
        </span>
      </dd>
    </div>
  );
}

/** 25 weeks of real visitors' numbers, one small chart per number, with Google's "good" line. */
function CruxCard({ hasKey }: { hasKey: boolean }) {
  const view = useSeoView();
  const site = view.site;
  const crux = view.data.crux;
  const busy = view.state.busy.crux === site?.id;
  const error = view.state.errors.crux?.siteId === site?.id ? view.state.errors.crux : null;
  const origin = siteOrigin(site, view.run);
  const wholeHost = siteIsWholeHost(site, view.run);
  return (
    <Card>
      <CardTitle
        icon={UsersRoundIcon}
        title="Real visitors over the last six months"
        hint="From the Chrome UX Report: how fast your site was for Chrome users, week by week. Sites with few visitors don't have one yet."
        actions={
          <Gated reason={!origin ? 'Publish the site first' : !wholeHost ? CRUX_SHARED_HOST : !hasKey ? 'Add a free Google API key under Setup first' : null}>
            <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => site && origin && void loadCrux(site.id, origin)}>
              {busy ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {crux ? 'Refresh' : 'Show it'}
            </Button>
          </Gated>
        }
      />
      {error && <p className="text-sm text-muted-foreground">{error.message}</p>}
      {crux && wholeHost && crux.origin === origin && (
        <div className="grid gap-4 sm:grid-cols-3">
          {(['lcp', 'inp', 'cls'] as const).map((id) => {
            const series = crux.series[id] ?? [];
            const values = series.filter((value): value is number => value !== null);
            if (!values.length) return null;
            const last = values[values.length - 1];
            return (
              <div key={id}>
                <p className="text-xs text-muted-foreground">{VITALS[id].short}</p>
                <p className="flex items-baseline gap-2">
                  <span className="text-base font-semibold tabular-nums">{formatVital(id, last)}</span>
                  <span className={cn('text-xs font-medium', RATING_STYLE[rate(id, last)].text)}>{RATING_STYLE[rate(id, last)].words}</span>
                </p>
                <Sparkline values={series} good={VITALS[id].good} label={`${VITALS[id].short}, week by week`} />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Sparkline({ values, good, label }: { values: Array<number | null>; good: number; label: string }) {
  const width = 200;
  const height = 44;
  const known = values.filter((value): value is number => value !== null);
  const max = Math.max(good * 1.6, ...known);
  const x = (index: number) => (values.length <= 1 ? 0 : (index / (values.length - 1)) * width);
  const y = (value: number) => height - 4 - (value / max) * (height - 8);
  const path = values
    .map((value, index) => (value === null ? null : `${x(index).toFixed(1)},${y(value).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-11 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <line x1={0} x2={width} y1={y(good)} y2={y(good)} stroke="hsl(var(--growth-good))" strokeDasharray="3 3" strokeOpacity={0.7} />
      <polyline points={path} fill="none" stroke="hsl(var(--growth-series))" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
