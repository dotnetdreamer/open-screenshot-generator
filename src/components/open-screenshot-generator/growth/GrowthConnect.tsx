"use client";

// Connecting App Store Connect, and what each feed is doing.
//
// One key, shared with the upload dialog. Apple splits what a key may read by
// role, so the status of every feed is shown on its own line with the role it
// needs: a key that cannot read Sales and Trends still brings in reviews and
// the listing, and the line says what to change to get the rest.

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
import { clearApp } from '@/lib/growth/db';
import { discardListingDrafts } from '@/lib/growth/listingDrafts';
import { formatAgo } from '@/lib/growth/format';
import { useGrowthSettings } from '@/lib/growth/settings';
import type { FeedState, GrowthFeed } from '@/lib/growth/types';
import { forgetAppStoreToken, useStoreCredentials } from '@/lib/publish';
import { cn } from '@/lib/utils';
import { AppStoreCredentialsForm } from '../publish/StoreCredentialsForms';
import { Panel, SectionTitle, useGrowthView } from './GrowthShared';

const DESKTOP_URL = 'https://openscrgen.app';
const VENDOR_URL = 'https://appstoreconnect.apple.com/itc/payments_and_financial_reports';

const FEEDS: Array<{ feed: GrowthFeed; label: string; needs: string }> = [
  { feed: 'listing', label: 'Listing', needs: 'Admin, App Manager or Marketing' },
  { feed: 'reviews', label: 'Reviews and replies', needs: 'Admin, App Manager or Customer Support' },
  { feed: 'sales', label: 'Sales and Trends', needs: 'Admin, Finance or Sales, plus the vendor number' },
  { feed: 'analytics', label: 'App Analytics', needs: 'An Admin key once, to switch the reports on' },
  { feed: 'ratings', label: 'Ratings per storefront', needs: 'Nothing: these are public' },
];

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
  idle: 'Not synced yet',
  syncing: 'Syncing',
  ok: 'Up to date',
  empty: 'Nothing yet',
  'needs-setup': 'Needs setting up',
  pending: 'Waiting for Apple',
  forbidden: 'The key cannot read this',
  error: 'Failed',
};

export function GrowthConnect({ desktop, onSync }: { desktop: boolean; onSync: () => void }) {
  const view = useGrowthView();
  const { credentials, saveAppStore } = useStoreCredentials();
  const [settings, setSettings] = useGrowthSettings();
  const [editingKey, setEditingKey] = useState(false);
  const [vendor, setVendor] = useState(settings.vendorNumber ?? '');
  const [confirmClear, setConfirmClear] = useState(false);
  const key = credentials.appstore;

  if (!desktop) {
    return (
      <Panel className="flex flex-col items-start gap-3">
        <MonitorDownIcon className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">Your own numbers need the desktop app</p>
        <p className="max-w-xl text-xs text-muted-foreground">
          App Store Connect does not answer requests from a browser tab, so the web version can only show the sample app. The
          desktop app talks to Apple directly with your own key, which stays on your computer.
        </p>
        <Button size="sm" onClick={() => void openExternal(DESKTOP_URL)}>
          Get the desktop app
          <ExternalLinkIcon className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Panel>
          <SectionTitle
            title="App Store Connect key"
            hint="The same key the upload dialog uses. It is stored on this computer and sent to Apple only."
          />
          {key && !editingKey ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm">
                <KeyRoundIcon className="h-4 w-4 text-muted-foreground" />
                Key <span className="font-mono">{key.keyId}</span>
              </p>
              <Button variant="outline" size="sm" onClick={() => setEditingKey(true)}>
                Change key
              </Button>
            </div>
          ) : (
            <AppStoreCredentialsForm
              value={key}
              onSave={(next) => {
                if (key) forgetAppStoreToken(key);
                saveAppStore(next);
                setEditingKey(false);
                onSync();
              }}
              onCancel={key ? () => setEditingKey(false) : undefined}
            />
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            One key with the Admin role reads everything here. A key with a smaller role works for the parts it may read, as
            listed under each feed.
          </p>
        </Panel>

        <Panel>
          <SectionTitle title="Vendor number" hint="Sales and Trends needs it on every request. It is all digits, at the top left of Payments and Financial Reports." />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={vendor}
              onChange={(event) => setVendor(event.target.value.replace(/\D/g, ''))}
              placeholder="85012345"
              inputMode="numeric"
              className="h-9 w-[180px] font-mono text-sm"
              aria-label="Vendor number"
            />
            <Button
              size="sm"
              disabled={vendor === (settings.vendorNumber ?? '')}
              onClick={() => {
                setSettings({ vendorNumber: vendor || undefined });
                if (vendor) onSync();
              }}
            >
              Save
            </Button>
            <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => void openExternal(VENDOR_URL)}>
              Find it
              <ExternalLinkIcon className="ml-1 h-3 w-3" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            With it, a year of downloads, purchases and proceeds arrives in a few minutes. If Apple refuses it, an agreement may be
            waiting for the Account Holder under Business in App Store Connect.
          </p>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel>
          <SectionTitle title="What is connected" hint={view.data.lastSync ? `Last sync ${formatAgo(view.data.lastSync)}` : 'Not synced yet'} />
          <ul className="space-y-3">
            {FEEDS.map(({ feed, label, needs }) => {
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
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{STATE_LABEL[status.state]}</span>
                    </p>
                    {status.message && <p className="text-xs">{status.message}</p>}
                    <p className="text-[11px] text-muted-foreground">Needs: {needs}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          {view.data.status.analytics.state === 'needs-setup' && (
            <p className="mt-3 rounded-md bg-muted p-2 text-xs">
              Apple makes App Analytics reports for an app only after an Admin key asks for them once. Change to an Admin key,
              sync once, and you can switch back to a smaller key afterwards. The first reports take a day or two.
            </p>
          )}
        </Panel>

        <Panel className="space-y-3">
          <SectionTitle title="Settings" />
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="growth-refresh" className="text-xs font-normal">
              Sync when the last sync is older than
            </Label>
            <Select value={String(settings.refreshHours)} onValueChange={(value) => setSettings({ refreshHours: Number(value) })}>
              <SelectTrigger id="growth-refresh" className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1" className="text-xs">An hour</SelectItem>
                <SelectItem value="6" className="text-xs">6 hours</SelectItem>
                <SelectItem value="24" className="text-xs">A day</SelectItem>
                <SelectItem value="0" className="text-xs">Never, I sync myself</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="growth-monitor" className="text-xs font-normal">
                Keep checking while the app is open
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Syncs every app you have synced here on that schedule, with Growth closed, and counts new insights on the Growth
                button.
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
              Sales and Trends history to load
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
                Let other MCP clients read these numbers
              </Label>
              <p className="text-[11px] text-muted-foreground">
                The app&apos;s own Claude Code and Codex agents can always read them. This adds any other program you connected to
                the design server, and the numbers include sales.
              </p>
            </div>
            <Switch id="growth-share" checked={settings.shareWithClients} onCheckedChange={(checked) => setSettings({ shareWithClients: checked })} />
          </div>
        </Panel>

        {!view.sample && (
          <Panel>
            <SectionTitle
              title={`Data for ${view.app.name} on this computer`}
              hint="Removing it keeps the key, the screenshot uploads and the events you added. The next sync loads the rest again."
            />
            {confirmClear ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs">Remove the numbers, reviews and listing for this app?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    void clearApp(view.app.id);
                    discardListingDrafts(view.app.id);
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
              <Button size="sm" variant="outline" onClick={() => setConfirmClear(true)}>
                <Trash2Icon className="mr-1.5 h-4 w-4" />
                Remove this app&apos;s data
              </Button>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
