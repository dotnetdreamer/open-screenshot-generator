"use client";

// Connecting App Store Connect and Google Play, and what each feed is doing.
//
// One key per store, shared with the upload dialog. Apple splits what a key may
// read by role, and Google by Play Console permission, so the status of every
// feed of the app on screen is shown on its own line with what it needs: a key
// that cannot read Sales and Trends still brings in reviews and the listing,
// and the line says what to change to get the rest.

import React, { useState } from 'react';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ClockIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Loader2Icon,
  MonitorDownIcon,
  OctagonAlertIcon,
  SettingsIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { openExternal } from '@/lib/desktop';
import { growthAiUnavailableReason, type GrowthAiWriterChoice } from '@/lib/growth/ai';
import { clearApp } from '@/lib/growth/db';
import { discardListingDrafts } from '@/lib/growth/listingDrafts';
import { discardReportSummaries } from '@/lib/growth/reportSummaries';
import { formatAgo } from '@/lib/growth/format';
import { bucketFromUri } from '@/lib/growth/play';
import { getGrowthSettings, useGrowthSettings } from '@/lib/growth/settings';
import { playAppId, type GrowthStore } from '@/lib/growth/stores';
import type { FeedState, GrowthFeed } from '@/lib/growth/types';
import { forgetAppStoreToken, forgetPlayToken, serviceAccountEmail, useStoreCredentials } from '@/lib/publish';
import { cn } from '@/lib/utils';
import { AppStoreCredentialsForm, PlayCredentialsForm } from '../publish/StoreCredentialsForms';
import { Gated, Panel, SectionTitle, useGrowthView } from './GrowthShared';

const DESKTOP_URL = 'https://openscrgen.app';
const VENDOR_URL = 'https://appstoreconnect.apple.com/itc/payments_and_financial_reports';
const PLAY_CONSOLE_URL = 'https://play.google.com/console';

const FEEDS: Record<GrowthStore, Array<{ feed: GrowthFeed; label: string; needs: string }>> = {
  appstore: [
    { feed: 'listing', label: 'Store page', needs: 'Needs a key with the Admin, App Manager or Marketing role' },
    { feed: 'reviews', label: 'Reviews and replies', needs: 'Needs a key with the Admin, App Manager or Customer Support role' },
    { feed: 'sales', label: 'Sales and Trends (downloads and earnings)', needs: 'Needs a key with the Admin, Finance or Sales role, and your vendor number' },
    { feed: 'analytics', label: 'App Analytics (times seen and download rate)', needs: 'Needs an Admin key the first time, to turn on App Analytics' },
    { feed: 'ratings', label: 'Ratings per country', needs: 'Needs no key, because ratings are public' },
  ],
  playstore: [
    { feed: 'listing', label: 'Store page', needs: 'Needs the service account to have access to your app in Play Console' },
    { feed: 'reviews', label: 'Reviews and replies', needs: 'Needs the permission to reply to reviews' },
    {
      feed: 'analytics',
      label: 'Report files (downloads, page visits and download rate)',
      needs: 'Needs your Cloud Storage URI and the permission to download bulk reports',
    },
    { feed: 'ratings', label: 'Ratings', needs: 'From the same report files as the downloads' },
  ],
};

const STATE_ICON: Record<FeedState, React.ComponentType<{ className?: string }>> = {
  idle: CircleDashedIcon,
  syncing: Loader2Icon,
  ok: CheckCircle2Icon,
  empty: CheckCircle2Icon,
  'needs-setup': SettingsIcon,
  pending: ClockIcon,
  forbidden: AlertTriangleIcon,
  error: OctagonAlertIcon,
};

const STATE_LABEL: Record<FeedState, string> = {
  idle: 'Not loaded yet',
  syncing: 'Refreshing',
  ok: 'Up to date',
  empty: 'Nothing yet',
  'needs-setup': 'Not set up yet',
  pending: 'Waiting for {owner}',
  forbidden: 'Your key has no access',
  error: 'Could not load',
};

/** `onSync` is told which store's apps a saved setting changes. */
export function GrowthConnect({ desktop, onSync }: { desktop: boolean; onSync: (changed: GrowthStore) => void }) {
  const view = useGrowthView();
  const { credentials, saveAppStore, savePlay } = useStoreCredentials();
  const [settings, setSettings] = useGrowthSettings();
  const [editingKey, setEditingKey] = useState(false);
  const [editingPlayKey, setEditingPlayKey] = useState(false);
  // From storage, not from `settings`: the hook's first render is the defaults,
  // so a box started from it showed empty with Save on, and Save then erased
  // the vendor number. Setup only renders in the browser, after mount.
  const [vendor, setVendor] = useState(() => getGrowthSettings().vendorNumber ?? '');
  const [reportsUri, setReportsUri] = useState(() => getGrowthSettings().playReportsUri ?? '');
  const [confirmClear, setConfirmClear] = useState(false);
  const key = credentials.appstore;
  const playKey = credentials.playstore;
  const playEmail = playKey ? serviceAccountEmail(playKey) : null;
  const showingPlay = view.store === 'playstore';
  const uriProblem = reportsUri.trim() && !bucketFromUri(reportsUri) ? 'The text is not a Cloud Storage URI. A Cloud Storage URI starts with gs://' : null;

  // The web build shows the whole screen too, with what cannot work there disabled.
  const webOnly = desktop ? null : view.blocked.app;

  const appleKeyPanel = (
      <Panel>
        <SectionTitle
          title="App Store Connect API key"
          hint="Growth and the screenshot upload use the same key. The API key stays on your computer and goes only to Apple."
        />
        {webOnly ? (
          <Gated reason={webOnly}>
            <Button size="sm" variant="outline">
              <KeyRoundIcon className="mr-1.5 h-4 w-4" />
              Add your key
            </Button>
          </Gated>
        ) : key && !editingKey ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm">
              <KeyRoundIcon className="h-4 w-4 text-muted-foreground" />
              Key <span className="font-mono">{key.keyId}</span>
            </p>
            <Button variant="outline" size="sm" onClick={() => setEditingKey(true)}>
              Change key
            </Button>
          </div>
        ) : !key && !editingKey && showingPlay ? (
          // A Google Play app is on screen: the App Store form waits for a click.
          <Button size="sm" variant="outline" onClick={() => setEditingKey(true)}>
            <KeyRoundIcon className="mr-1.5 h-4 w-4" />
            Add your App Store Connect API key
          </Button>
        ) : (
          <AppStoreCredentialsForm
            value={key}
            onSave={(next) => {
              if (key) forgetAppStoreToken(key);
              saveAppStore(next);
              setEditingKey(false);
              onSync('appstore');
            }}
            onCancel={key || showingPlay ? () => setEditingKey(false) : undefined}
          />
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          A key with the Admin role loads all the data from Apple. A key with another role loads only part of the data.
        </p>
      </Panel>
  );

  const vendorPanel = (
      <Panel>
        <SectionTitle title="Vendor number" hint="Find the vendor number in App Store Connect, at the top of Payments and Financial Reports" />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={vendor}
            onChange={(event) => setVendor(event.target.value.replace(/\D/g, ''))}
            placeholder="85012345"
            inputMode="numeric"
            className="h-9 w-[180px] font-mono text-sm"
            aria-label="Vendor number"
          />
          <Gated reason={webOnly}>
            <Button
              size="sm"
              disabled={vendor === (settings.vendorNumber ?? '')}
              onClick={() => {
                setSettings({ vendorNumber: vendor || undefined });
                // A cleared number refreshes too, so Sales and Trends says what it needs.
                onSync('appstore');
              }}
            >
              Save
            </Button>
          </Gated>
          <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => void openExternal(VENDOR_URL)}>
            Open App Store Connect
            <ExternalLinkIcon className="ml-1 h-3 w-3" />
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          With the vendor number, a year of downloads, purchases and earnings loads in a few minutes. If Apple does not accept the
          vendor number, the Account Holder may need to accept an agreement. Look under Business in App Store Connect.
        </p>
      </Panel>
  );

  const playKeyPanel = (
      <Panel data-testid="growth-play-key">
        <SectionTitle
          title="Google Play service account key"
          hint="Growth and the screenshot upload use the same key. The key stays on your computer and goes only to Google."
        />
        {webOnly ? (
          <Gated reason={webOnly}>
            <Button size="sm" variant="outline">
              <KeyRoundIcon className="mr-1.5 h-4 w-4" />
              Add your Google Play key
            </Button>
          </Gated>
        ) : playKey && !editingPlayKey ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 text-sm">
              <p className="flex items-center gap-2">
                <KeyRoundIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs">{playEmail ?? 'Service account key'}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                App <span className="font-mono">{playKey.packageName}</span>
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditingPlayKey(true)}>
              Change key
            </Button>
          </div>
        ) : !playKey && !editingPlayKey && !showingPlay ? (
          // An App Store app, or none yet, is on screen: the Google Play form waits for a click.
          <Button size="sm" variant="outline" onClick={() => setEditingPlayKey(true)}>
            <KeyRoundIcon className="mr-1.5 h-4 w-4" />
            Add your Google Play key
          </Button>
        ) : (
          <PlayCredentialsForm
            value={playKey}
            onSave={(next) => {
              if (playKey) forgetPlayToken(playKey);
              savePlay(next);
              setEditingPlayKey(false);
              // The key's app owes a sync, which runs once that app shows.
              onSync('playstore');
              const id = playAppId(next.packageName);
              if (view.app.id !== id) setSettings({ appId: id });
            }}
            onCancel={playKey || !showingPlay ? () => setEditingPlayKey(false) : undefined}
          />
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Growth shows the app with the package name of the key. To see another app, change the package name.
        </p>
      </Panel>
  );

  const playReportsPanel = (
      <Panel>
        <SectionTitle
          title="Google Play report files"
          hint="Downloads, page visits and ratings on Google Play come from monthly report files that Google keeps for your account"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={reportsUri}
            onChange={(event) => setReportsUri(event.target.value)}
            placeholder="gs://pubsite_prod_rev_01234567890987654321"
            spellCheck={false}
            autoComplete="off"
            className="h-9 min-w-[220px] flex-1 font-mono text-xs"
            aria-label="Cloud Storage URI"
          />
          <Gated reason={webOnly}>
            <Button
              size="sm"
              disabled={reportsUri.trim() === (settings.playReportsUri ?? '') || !!uriProblem}
              onClick={() => {
                setSettings({ playReportsUri: reportsUri.trim() || undefined });
                onSync('playstore');
              }}
            >
              Save
            </Button>
          </Gated>
          <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => void openExternal(PLAY_CONSOLE_URL)}>
            Open Play Console
            <ExternalLinkIcon className="ml-1 h-3 w-3" />
          </Button>
        </div>
        {uriProblem && <p className="mt-2 text-xs text-destructive">{uriProblem}</p>}
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>
            In Play Console, open Manage account, then Play apps reports, then Statistics. Click Copy Cloud Storage URI, then paste
            the URI in the box above.
          </li>
          <li>
            Under Users and permissions, give the service account the View app information permission for the whole account. The
            permission can take a day or more to work.
          </li>
        </ol>
      </Panel>
  );

  return (
    <div className="space-y-4">
      {!desktop && (
        <Panel className="flex flex-col items-start gap-3">
          <MonitorDownIcon className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">Your own numbers need the desktop app</p>
          <p className="max-w-xl text-xs text-muted-foreground">
            Growth works in the desktop app only. The desktop app gets your numbers from Apple and Google with your own App Store
            Connect API key and Google Play service account key. The keys stay on your computer.
          </p>
          <Button size="sm" onClick={() => void openExternal(DESKTOP_URL)}>
            Get the desktop app
            <ExternalLinkIcon className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {/* The app's own store first; the other store's key waits below. */}
          {showingPlay ? (
            <>
              {playKeyPanel}
              {playReportsPanel}
              {appleKeyPanel}
              {vendorPanel}
            </>
          ) : (
            <>
              {appleKeyPanel}
              {vendorPanel}
              {playKeyPanel}
              {playReportsPanel}
            </>
          )}
        </div>

        <div className="space-y-4">
          <Panel>
            <SectionTitle
              title={`Data from ${view.words.owner}`}
              hint={view.data.lastSync ? `Updated ${formatAgo(view.data.lastSync)}` : 'Not loaded yet'}
            />
            <ul className="space-y-3">
              {FEEDS[view.store].map(({ feed, label, needs }) => {
                const status = view.data.status[feed];
                const Icon = STATE_ICON[status.state];
                return (
                  <li key={feed} className="flex gap-2.5">
                    <Icon
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        status.state === 'syncing' && 'animate-spin text-muted-foreground',
                        (status.state === 'ok' || status.state === 'empty') && 'text-[hsl(var(--growth-good))]',
                        (status.state === 'forbidden' || status.state === 'needs-setup' || status.state === 'pending') && 'text-amber-600 dark:text-amber-400',
                        status.state === 'error' && 'text-[hsl(var(--growth-bad))]',
                        status.state === 'idle' && 'text-muted-foreground'
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {label}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {STATE_LABEL[status.state].replace('{owner}', view.words.owner)}
                        </span>
                      </p>
                      {status.message && <p className="text-xs">{status.message}</p>}
                      <p className="text-[11px] text-muted-foreground">{needs}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!showingPlay && view.data.status.analytics.state === 'needs-setup' && (
              <p className="mt-3 rounded-md bg-muted p-2 text-xs">
                To turn on App Analytics, change to an Admin key and refresh once. Then you can go back to your other key. The first
                numbers take a day or two.
              </p>
            )}
          </Panel>

          <Panel className="space-y-3">
            <SectionTitle title="Settings" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="growth-ai-writer" className="text-xs font-normal">
                  AI to use
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  The AI writes replies, store page text, report summaries and answers. Automatic uses the first AI that is ready: Claude Code on your plan, then Codex, then the AI panel.
                </p>
                <p className="text-[11px] text-muted-foreground" data-testid="growth-ai-writer-status">
                  {view.aiLabel ? `Using ${view.aiLabel}` : growthAiUnavailableReason()}
                </p>
              </div>
              <Select
                value={settings.aiWriter ?? 'auto'}
                onValueChange={(value) => setSettings({ aiWriter: value as GrowthAiWriterChoice })}
              >
                <SelectTrigger id="growth-ai-writer" className="h-8 w-[150px] shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto" className="text-xs">Automatic</SelectItem>
                  <SelectItem value="claude" className="text-xs">Claude Code</SelectItem>
                  <SelectItem value="codex" className="text-xs">Codex</SelectItem>
                  <SelectItem value="panel" className="text-xs">AI panel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="growth-refresh" className="text-xs font-normal">
                Refresh when the numbers are older than
              </Label>
              <Select value={String(settings.refreshHours)} onValueChange={(value) => setSettings({ refreshHours: Number(value) })}>
                <SelectTrigger id="growth-refresh" className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1" className="text-xs">An hour</SelectItem>
                  <SelectItem value="6" className="text-xs">6 hours</SelectItem>
                  <SelectItem value="24" className="text-xs">A day</SelectItem>
                  <SelectItem value="0" className="text-xs">Never, I refresh myself</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="growth-monitor" className="text-xs font-normal">
                  Keep refreshing while you edit
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  While you work in the editor, Growth refreshes every app you refreshed before, as often as set above. The Growth
                  button shows the number of new insights.
                </p>
              </div>
              <Switch
                id="growth-monitor"
                checked={settings.monitor}
                disabled={settings.refreshHours <= 0}
                onCheckedChange={(checked) => setSettings({ monitor: checked })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="growth-history" className="text-xs font-normal">
                How far back to load downloads and earnings
              </Label>
              <Select value={String(settings.historyDays)} onValueChange={(value) => setSettings({ historyDays: Number(value) })}>
                <SelectTrigger id="growth-history" className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="90" className="text-xs">90 days</SelectItem>
                  <SelectItem value="180" className="text-xs">6 months</SelectItem>
                  <SelectItem value="365" className="text-xs">A year</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="growth-share" className="text-xs font-normal">
                  Let external AI tools see your store numbers
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  The agent can always see your App Store and Google Play numbers. With the switch on, other AI tools you connected to Open Screenshot Generator can see the numbers too. The numbers include your sales.
                </p>
              </div>
              <Switch id="growth-share" checked={settings.shareWithClients} onCheckedChange={(checked) => setSettings({ shareWithClients: checked })} />
            </div>
          </Panel>

          <Panel>
            <SectionTitle
              title={view.app.id ? `Data for ${view.app.name} on your computer` : 'Data on your computer'}
              hint="Removing the data keeps your API key, your screenshot uploads and the events you added. The next refresh loads the rest of the data again."
            />
            {confirmClear ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs">Remove the numbers, reviews and store page of {view.app.name}?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    void clearApp(view.app.id);
                    discardListingDrafts(view.app.id);
                    discardReportSummaries(view.app.id);
                    setConfirmClear(false);
                  }}
                >
                  Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Gated reason={view.app.id ? null : view.blocked.app}>
                <Button size="sm" variant="outline" onClick={() => setConfirmClear(true)}>
                  <Trash2Icon className="mr-1.5 h-4 w-4" />
                  Remove the data
                </Button>
              </Gated>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
