"use client";

// Setup: the sites SEO checks, the Google key for Search Console and
// Analytics, the free API key for PageSpeed and the Chrome UX Report, and
// where the AI's SEO knowledge comes from.

import React, { useRef, useState } from 'react';
import { BookOpenIcon, ExternalLinkIcon, GlobeIcon, KeyRoundIcon, Loader2Icon, RefreshCwIcon, SparklesIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openExternal } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { isGoogleApiKey, readKeyFile, setSeoGoogle, useSeoGoogle } from '@/lib/seo/googleSettings';
import { addSiteAddress, forgetSite, startCheck, useSeo } from '@/lib/seo/state';
import { checkSeoKnowledge } from '@/lib/seo/sync';
import { SEO_REPO_URL } from '@/lib/seo/source';
import { CopyButton, formatAgo } from '../storeCompliance/StoreComplianceShared';
import { Gated } from '../growth/GrowthShared';
import { InfoTip } from '../capture/InfoTip';
import { PropertyPicker } from './SeoGoogle';
import { Card, CardTitle, useSeoView } from './SeoShared';

const APIS: Array<{ id: string; name: string; for: string }> = [
  { id: 'searchconsole.googleapis.com', name: 'Google Search Console API', for: 'Search' },
  { id: 'analyticsdata.googleapis.com', name: 'Google Analytics Data API', for: 'Visitors' },
  { id: 'analyticsadmin.googleapis.com', name: 'Google Analytics Admin API', for: 'the list of your Analytics properties' },
  { id: 'pagespeedonline.googleapis.com', name: 'PageSpeed Insights API', for: 'Speed, with your API key' },
  { id: 'chromeuxreport.googleapis.com', name: 'Chrome UX Report API', for: 'real visitors over six months' },
];

export function SeoSetup() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 md:p-6">
      <Sites />
      <GoogleKey />
      <ApiKey />
      <Knowledge />
    </div>
  );
}

function Sites() {
  const view = useSeoView();
  const state = useSeo();
  const [address, setAddress] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Card>
      <CardTitle icon={GlobeIcon} title="Your sites" hint="Sites you make in the Website view show up here on their own." />
      {state.sites.length > 0 && (
        <ul className="mb-3 divide-y rounded-lg border">
          {state.sites.map((site) => (
            <li key={site.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{site.name}</p>
                <p className="truncate text-xs text-muted-foreground">{site.url || 'Not online yet, checked from the Website view'}</p>
              </div>
              {site.source === 'website' && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">From Website</span>}
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title={`Remove ${site.name} and its results`} aria-label={`Remove ${site.name}`} onClick={() => void forgetSite(site.id)}>
                <Trash2Icon className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await addSiteAddress(address);
          if ('problem' in result) {
            setProblem(result.problem);
            return;
          }
          setProblem(null);
          setAddress('');
          void startCheck(result.site.id, 'live', view.readProject);
          view.goTo('overview');
        }}
      >
        <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="myapp.com" aria-label="A website's address" className="h-9 flex-1" />
        <Button type="submit" variant="outline" className="h-9" disabled={!address.trim()}>
          Add and check
        </Button>
      </form>
      {problem && (
        <p className="mt-2 text-sm text-[hsl(var(--rules-critical))]" role="alert">
          {problem}
        </p>
      )}
    </Card>
  );
}

function Choice({ title, when, children, disabledReason }: { title: string; when: string; children: React.ReactNode; disabledReason?: string | null }) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center', disabledReason && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{disabledReason ?? when}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GoogleKey() {
  const view = useSeoView();
  const google = useSeoGoogle();
  const picker = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const active = google.active;
  const desktopReason = view.desktop ? null : "Needs the desktop app: a web page can't keep a private key safe";
  const projectQuery = active?.projectId ? `?project=${encodeURIComponent(active.projectId)}` : '';
  return (
    <Card data-testid="seo-google-key">
      <CardTitle
        icon={KeyRoundIcon}
        title="Google key"
        hint="For Search and Visitors: a service account key from Google Cloud. It's free, and it stays on this computer."
        actions={
          <InfoTip label="What the key can do">
            The app asks Google only to read: Search Console and Analytics numbers, never changes. The key works only for the sites whose owners add its email as a user, which you do yourself.
          </InfoTip>
        }
      />
      {active ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-[hsl(var(--growth-good))]/30 bg-[hsl(var(--growth-good))]/5 p-3">
            <p className="text-sm font-medium">{active.from === 'growth' ? "Using Growth's Google Play key" : 'Using the key you added'}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="break-all font-mono text-xs">{active.email}</span>
              <CopyButton text={active.email} label="Copy the email" />
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-medium">Then give the key's email access</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li>
                In <button type="button" className="text-foreground underline underline-offset-2" onClick={() => void openExternal('https://search.google.com/search-console/users')}>Search Console</button>, open your site, then Settings, Users and permissions, Add user. Paste the email and pick Full.
              </li>
              <li>
                In <button type="button" className="text-foreground underline underline-offset-2" onClick={() => void openExternal('https://analytics.google.com/analytics/web/')}>Google Analytics</button>, open Admin, then Property access management, then the plus button. Paste the email and pick Viewer.
              </li>
              <li>Turn on these Google APIs in the key&apos;s project:</li>
            </ol>
            <ul className="space-y-1 pl-5">
              {APIS.map((api) => (
                <li key={api.id} className="flex items-center gap-2 text-xs">
                  <button type="button" className="inline-flex items-center gap-1 underline underline-offset-2" onClick={() => void openExternal(`https://console.cloud.google.com/apis/library/${api.id}${projectQuery}`)}>
                    {api.name}
                    <ExternalLinkIcon className="h-3 w-3" />
                  </button>
                  <span className="text-muted-foreground">for {api.for}</span>
                </li>
              ))}
            </ul>
          </div>
          {view.site && (
            <div className="border-t pt-3">
              <p className="mb-2 text-sm font-medium">For {view.site.name}</p>
              <PropertyPicker />
            </div>
          )}
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => setSeoGoogle({ key: null, useGrowthKey: false })}>
            Stop using this key
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Choice title="Set up with Ask AI" when="Choose this if you don't have a key yet. Ask AI opens Google Cloud next to the chat and walks you through it. You sign in and say yes to each step." disabledReason={view.setUpGoogleWithAi ? null : desktopReason}>
            <Gated reason={view.setUpGoogleWithAi ? null : desktopReason}>
              <Button size="sm" className="h-8 bg-[hsl(var(--seo-accent))] text-white hover:bg-[hsl(var(--seo-accent))]/90 dark:text-background" onClick={() => view.setUpGoogleWithAi?.()}>
                <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />
                Set up with Ask AI
              </Button>
            </Gated>
          </Choice>
          <Choice title="Use the key from Growth" when="Choose this if you set up Google Play in Growth. The same key works once you give its email access." disabledReason={!google.growthKey ? 'Growth has no Google Play key yet' : desktopReason}>
            <Gated reason={!google.growthKey ? 'Growth has no Google Play key yet' : desktopReason}>
              <Button size="sm" variant="outline" className="h-8" onClick={() => setSeoGoogle({ useGrowthKey: true })}>
                Use it
              </Button>
            </Gated>
          </Choice>
          <Choice title="Add a key file" when="Choose this if you already made a service account key in Google Cloud. Pick its .json file." disabledReason={desktopReason}>
            <Gated reason={desktopReason}>
              <Button size="sm" variant="outline" className="h-8" onClick={() => picker.current?.click()}>
                <UploadIcon className="mr-1.5 h-3.5 w-3.5" />
                Pick the file
              </Button>
            </Gated>
            <input
              ref={picker}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                const read = readKeyFile(await file.text());
                if ('problem' in read) {
                  setProblem(read.problem);
                  return;
                }
                setProblem(null);
                setSeoGoogle({ key: read.json, useGrowthKey: false });
              }}
            />
          </Choice>
          {problem && (
            <p className="text-sm text-[hsl(var(--rules-critical))]" role="alert">
              {problem}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function ApiKey() {
  const google = useSeoGoogle();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Card>
      <CardTitle
        icon={KeyRoundIcon}
        title="Google API key"
        hint="For Speed: Google's PageSpeed only answers with one. It also shows real visitors over six months."
        actions={
          <InfoTip label="How to get an API key">
            In Google Cloud, open APIs and Services, then Credentials, then Create credentials, then API key. Restrict it to the PageSpeed Insights API and the Chrome UX Report API. It's free. Ask AI can make it with you too.
          </InfoTip>
        }
      />
      {google.apiKey ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{`${google.apiKey.slice(0, 6)}...${google.apiKey.slice(-4)}`}</span>
          <span className="text-xs text-[hsl(var(--growth-good))]">Saved</span>
          <Button variant="ghost" size="sm" className="ml-auto h-8 text-muted-foreground" onClick={() => setSeoGoogle({ apiKey: null })}>
            Remove it
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isGoogleApiKey(value)) {
              setProblem('That doesn\'t look like a Google API key. It starts with "AIza" and has 39 characters');
              return;
            }
            setProblem(null);
            setSeoGoogle({ apiKey: value.trim() });
            setValue('');
          }}
        >
          <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="AIza..." aria-label="Google API key" className="h-9 flex-1 font-mono" autoComplete="off" spellCheck={false} />
          <Button type="submit" variant="outline" className="h-9" disabled={!value.trim()}>
            Save
          </Button>
        </form>
      )}
      {problem && (
        <p className="mt-2 text-sm text-[hsl(var(--rules-critical))]" role="alert">
          {problem}
        </p>
      )}
    </Card>
  );
}

function Knowledge() {
  const view = useSeoView();
  const knowledge = view.knowledge;
  const files = knowledge.files.size;
  const problem = knowledge.problem;
  return (
    <Card>
      <CardTitle
        icon={BookOpenIcon}
        title="Where the advice comes from"
        hint="The checks and the AI's SEO notes come from claude-seo, an open source SEO toolkit. The notes download from GitHub when SEO opens, so they stay up to date without an app update."
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <button type="button" className="inline-flex items-center gap-1 text-foreground underline underline-offset-2" onClick={() => void openExternal(SEO_REPO_URL)}>
          claude-seo on GitHub
          <ExternalLinkIcon className="h-3 w-3" />
        </button>
        <span>
          {files ? `${files} files kept on this computer` : 'Not downloaded yet'}
          {knowledge.checkedAt ? `, checked ${formatAgo(knowledge.checkedAt)}` : ''}
        </span>
        {problem && <span className="text-[hsl(var(--rules-medium))]">{problem.kind === 'offline' ? "Couldn't reach GitHub" : problem.kind === 'limited' ? 'GitHub asked to wait a bit' : "Couldn't use the update"}</span>}
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1.5 text-xs" disabled={knowledge.checking} onClick={() => void checkSeoKnowledge({ force: true })}>
          {knowledge.checking ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <RefreshCwIcon className="h-3.5 w-3.5" />}
          Check for updates
        </Button>
      </div>
    </Card>
  );
}
