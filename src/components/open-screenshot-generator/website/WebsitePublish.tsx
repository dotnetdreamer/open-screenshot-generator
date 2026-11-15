"use client";

// The Publish section: who the site goes out as on GitHub, the repository and
// the address it gets, what is ready and what is not, the publish itself step
// by step, and the links to paste into App Store Connect and Play Console
// once it is online.

import React, { useState } from 'react';
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GithubIcon,
  Loader2Icon,
  RocketIcon,
  SquareIcon,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openExternal } from '@/lib/desktop';
import { getLocaleDef } from '@/lib/i18n/locales';
import { pageUrl } from '@/lib/website/render';
import { pagesSettingsUrl, repoNameProblem, repoPage, siteAddress, type GithubIdentity } from '@/lib/website/github';
import type { SiteDraft, SitePage } from '@/lib/website/types';
import { cn } from '@/lib/utils';
import { Gated } from '../growth/GrowthShared';
import { InfoTip } from '../capture/InfoTip';
import { CopyButton, Field, PanelSection } from './WebsiteShared';

export type IdentityState =
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'needs-scope'; who: GithubIdentity }
  | { state: 'ready'; who: GithubIdentity }
  | { state: 'error'; message: string };

export type PublishPhase = 'shots' | 'translate' | 'build' | 'repo' | 'upload' | 'commit' | 'pages' | 'live';

export interface PublishJob {
  /** The app whose site is going out: it can be another project's than the one on screen. */
  appName: string;
  phase: PublishPhase;
  done?: number;
  total?: number;
  /** The developer has to switch Pages on in the repository's settings. */
  needsPages?: boolean;
  branch?: string;
  /** Lines still untranslated after translating, by language: the publish waits for the developer to say go on or stop. */
  untranslated?: Array<{ locale: string; count: number }>;
}

const PHASES: Array<{ id: PublishPhase; label: string }> = [
  { id: 'shots', label: 'Getting your screenshots' },
  { id: 'translate', label: 'Translating' },
  { id: 'build', label: 'Making the pages' },
  { id: 'repo', label: 'Getting the repository ready' },
  { id: 'upload', label: 'Sending the files to GitHub' },
  { id: 'commit', label: 'Saving the new version' },
  { id: 'pages', label: 'Switching on GitHub Pages' },
  { id: 'live', label: 'Waiting for GitHub to put it online' },
];

const PAGE_LABEL: Record<SitePage, string> = { home: 'Home page', support: 'Support page', privacy: 'Privacy policy' };

function LinkRow({ label, url, note }: { label: string; url: string; note?: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">
          {label}
          {note && <span className="ml-1.5 font-normal text-muted-foreground">{note}</span>}
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={url}>
          {url}
        </p>
      </div>
      <CopyButton text={url} label={`Copy the ${label.toLowerCase()} link`} />
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void openExternal(url)} aria-label={`Open the ${label.toLowerCase()}`} title="Open">
        <ExternalLinkIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** GitHub turned the app down when it switched Pages on: the one step the developer does in GitHub's settings. */
function PagesStep({ owner, repo, branch }: { owner: string; repo: string; branch: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs" data-testid="site-pages-step">
      <p className="font-medium">One more step: switch on GitHub Pages</p>
      <p className="text-muted-foreground">
        GitHub didn&apos;t let the app do this part. In the repository&apos;s settings, under Build and deployment, choose Deploy from a branch, then {branch} and / (root), and press
        Save. The app keeps checking while this view is open and shows when the site is online.
      </p>
      <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void openExternal(pagesSettingsUrl(owner, repo))}>
        Open the Pages settings
        <ExternalLinkIcon className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function WebsitePublish({
  draft,
  desktop,
  identity,
  signingIn,
  deviceCode,
  onSignIn,
  onCancelSignIn,
  onSignOut,
  repo,
  onRepo,
  checklist,
  blocked,
  job,
  onPublish,
  onStop,
  onGoOn,
  onZip,
  zipBusy,
  changed,
}: {
  draft: SiteDraft;
  desktop: boolean;
  identity: IdentityState;
  signingIn: boolean;
  deviceCode: { userCode: string; verificationUri: string } | null;
  onSignIn: (token?: string) => void;
  onCancelSignIn: () => void;
  /** Only for the Website view's own sign-in; the account's is signed out in Account. */
  onSignOut?: () => void;
  repo: string;
  onRepo: (name: string) => void;
  checklist: Array<{ ok: boolean; label: string; detail?: string }>;
  /** Why publishing cannot start, null when it can. */
  blocked: string | null;
  job: PublishJob | null;
  onPublish: () => void;
  onStop: () => void;
  /** Publish with the untranslated lines in the site's own language. */
  onGoOn: () => void;
  onZip: () => void;
  zipBusy: boolean;
  /** The site changed since it was last published. */
  changed: boolean;
}) {
  const [token, setToken] = useState('');
  const who = identity.state === 'ready' || identity.state === 'needs-scope' ? identity.who : null;
  const nameProblem = repoNameProblem(repo);
  const address = who && !nameProblem ? siteAddress(who.login, repo) : null;
  const published = draft.publish;
  const current = job ? PHASES.findIndex((phase) => phase.id === job.phase) : -1;
  const site = published?.url;

  return (
    <div className="space-y-6">
      {published && !job && (
        <PanelSection
          title={published.live ? 'Your website is online' : 'Your website is on its way'}
          hint={
            published.live
              ? changed
                ? 'You changed the site since. Publish again to put the changes online'
                : 'Paste these links into App Store Connect and Play Console'
              : published.pagesPending
                ? 'GitHub has the files. It puts them online once Pages is on'
                : 'GitHub takes a minute or two the first time'
          }
        >
          {published.pagesPending && !published.live && <PagesStep owner={published.owner} repo={published.repo} branch={published.branch} />}
          <div className="rounded-lg border px-3" data-testid="site-links">
            <LinkRow label="Home page" url={pageUrl(site!, draft, draft.baseLocale, 'home')} />
            <LinkRow label="Support page" url={pageUrl(site!, draft, draft.baseLocale, 'support')} note="Support URL" />
            <LinkRow label="Privacy policy" url={pageUrl(site!, draft, draft.baseLocale, 'privacy')} note="Privacy policy URL" />
          </div>
          {draft.languages.length > 1 && (
            <details className="rounded-lg border px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">Links in the other languages</summary>
              <div className="mt-1 divide-y">
                {draft.languages
                  .filter((locale) => locale !== draft.baseLocale)
                  .map((locale) => (
                    <div key={locale} className="py-1">
                      <p className="pt-1 text-[11px] font-semibold">{getLocaleDef(locale)?.nativeName ?? locale}</p>
                      {(['support', 'privacy'] as SitePage[]).map((page) => (
                        <LinkRow key={page} label={PAGE_LABEL[page]} url={pageUrl(site!, draft, locale, page)} />
                      ))}
                    </div>
                  ))}
              </div>
            </details>
          )}
          <div className="grid gap-2">
            <div className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
              <p className="flex items-center gap-1 font-semibold">
                App Store Connect
                <InfoTip label="Where the links go in App Store Connect">
                  <p>The privacy policy link goes under App Privacy, in Privacy Policy URL.</p>
                  <p>The support link goes on each version&apos;s page, in Support URL. Each language has its own, so you can use the link in that language.</p>
                </InfoTip>
              </p>
              <p className="text-muted-foreground">Privacy policy link under App Privacy. Support link on the version page</p>
            </div>
            <div className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
              <p className="flex items-center gap-1 font-semibold">
                Google Play Console
                <InfoTip label="Where the links go in Play Console">
                  <p>The privacy policy link goes under Policy and programs, then App content, then Privacy policy.</p>
                  <p>The home page and your email go under Store presence, then Store settings, in the store listing contact details.</p>
                </InfoTip>
              </p>
              <p className="text-muted-foreground">Privacy policy link under App content. Home page and email under Store settings</p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-7 w-fit gap-1 px-2 text-xs" onClick={() => void openExternal(repoPage(published.owner, published.repo))}>
            <GithubIcon className="h-3.5 w-3.5" />
            See the repository on GitHub
          </Button>
        </PanelSection>
      )}

      <PanelSection title="GitHub" hint="The site goes in a public repository on your GitHub account, and GitHub puts it online for free">
        {identity.state === 'checking' && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
            Checking your GitHub sign-in
          </p>
        )}
        {identity.state === 'error' && <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{identity.message}</p>}
        {who && (
          <div className="flex items-center gap-2 rounded-lg border p-2.5">
            <Avatar className="h-8 w-8">
              {who.avatarUrl && <AvatarImage src={who.avatarUrl} alt="" />}
              <AvatarFallback className="text-xs">{who.login.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{who.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                github.com/{who.login}
                {who.source === 'account' ? ', your account sign-in' : ''}
              </p>
            </div>
            {onSignOut && (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onSignOut}>
                Sign out
              </Button>
            )}
          </div>
        )}
        {identity.state === 'needs-scope' && (
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
            <p className="font-medium">GitHub needs one more permission</p>
            <p className="text-muted-foreground">To make the site&apos;s repository, the app needs access to your public repositories. Your private ones stay out of reach.</p>
          </div>
        )}
        {(identity.state === 'none' || identity.state === 'needs-scope' || identity.state === 'error') &&
          (deviceCode ? (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <p className="text-xs text-muted-foreground">Enter this code on GitHub to finish signing in. The app keeps waiting</p>
              <p className="text-center font-mono text-lg tracking-widest" data-testid="site-device-code">
                {deviceCode.userCode}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={() => void openExternal(deviceCode.verificationUri)}>
                  Open {deviceCode.verificationUri.replace(/^https?:\/\//, '')}
                  <ExternalLinkIcon className="h-3 w-3" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={onCancelSignIn}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Button type="button" className="w-full gap-2" disabled={signingIn} onClick={() => onSignIn()}>
                {signingIn ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <GithubIcon className="h-4 w-4" />}
                {identity.state === 'needs-scope' ? 'Allow access to public repositories' : 'Sign in with GitHub'}
              </Button>
              {!desktop && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">Or paste a GitHub token with public_repo access</p>
                  <div className="flex gap-1.5">
                    <Input type="password" aria-label="GitHub token" value={token} onChange={(event) => setToken(event.target.value)} placeholder="ghp_..." className="h-8 text-xs" />
                    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={!token.trim() || signingIn} onClick={() => onSignIn(token.trim())}>
                      Use token
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
      </PanelSection>

      <PanelSection title="Address">
        <Field
          label="Repository name"
          htmlFor="site-repo"
          hint={nameProblem ?? (address ? <span className="break-all">Your site: {address}</span> : 'Sign in to see the address')}
          info={
            <>
              <p>The repository holds the site&apos;s files, and its name is the last part of the address.</p>
              <p>A repository called your-name.github.io makes the site the address itself, without a name after it.</p>
            </>
          }
        >
          <Input id="site-repo" value={repo} onChange={(event) => onRepo(event.target.value.trim())} className={cn('h-9 font-mono text-xs', nameProblem && 'border-destructive')} />
        </Field>
      </PanelSection>

      <PanelSection title="Before it goes out">
        <ul className="space-y-1.5" data-testid="site-checklist">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-xs">
              {item.ok ? <CheckCircle2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--growth-good))]" /> : <CircleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />}
              <span>
                {item.label}
                {item.detail && <span className="block text-muted-foreground">{item.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </PanelSection>

      {job ? (
        <div className="space-y-3 rounded-lg border p-3" role="status" data-testid="site-publish-progress">
          <p className="text-xs font-semibold">Publishing {job.appName || 'the site'}</p>
          <ol className="space-y-1.5">
            {PHASES.map((phase, index) => {
              const done = index < current;
              const now = index === current;
              return (
                <li key={phase.id} className={cn('flex items-center gap-2 text-xs', !done && !now && 'text-muted-foreground')}>
                  {done ? (
                    <CheckCircle2Icon className="h-3.5 w-3.5 text-[hsl(var(--growth-good))]" />
                  ) : now ? (
                    <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CircleDashedIcon className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {phase.label}
                    {now && job.total ? <span className="ml-1 tabular-nums text-muted-foreground">{job.done ?? 0} of {job.total}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
          {job.needsPages && published && <PagesStep owner={published.owner} repo={published.repo} branch={job.branch ?? published.branch} />}
          {job.untranslated ? (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs" data-testid="site-untranslated">
              <p className="font-medium">Some lines aren&apos;t translated</p>
              <p className="text-muted-foreground">
                {job.untranslated.map((entry) => `${getLocaleDef(entry.locale)?.nativeName ?? entry.locale}: ${entry.count}`).join(', ')}. Until they&apos;re translated they show in{' '}
                {getLocaleDef(draft.baseLocale)?.nativeName ?? draft.baseLocale}. You can publish now and again later.
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" className="h-7 text-xs" onClick={onGoOn}>
                  Publish anyway
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onStop}>
                  <SquareIcon className="h-3 w-3" />
                  Stop
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onStop}>
              <SquareIcon className="h-3 w-3" />
              Stop
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Gated reason={blocked}>
            <Button type="button" className="w-full gap-2" onClick={onPublish} data-testid="site-publish">
              <RocketIcon className="h-4 w-4" />
              {published ? 'Publish the changes' : 'Publish the website'}
            </Button>
          </Gated>
          {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
        </div>
      )}

      <div className="border-t pt-4">
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" disabled={zipBusy} onClick={onZip}>
          {zipBusy ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <DownloadIcon className="h-3.5 w-3.5" />}
          Save the site as a ZIP
        </Button>
        <p className="px-2 text-[11px] text-muted-foreground">To put it on a server of your own instead</p>
      </div>
    </div>
  );
}
