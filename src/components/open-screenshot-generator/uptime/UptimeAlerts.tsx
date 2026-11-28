"use client";

// Where alerts go: this computer's own notifications, and the places the
// user adds (Slack, Discord, Telegram, ntfy or an address of their own),
// each with a test button. Under them, what was sent lately, a backup of the
// monitors, and how Uptime works.

import React, { useRef, useState } from 'react';
import {
  BellIcon,
  CheckCircle2Icon,
  DownloadIcon,
  InfoIcon,
  Loader2Icon,
  MessageCircleIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  SlackIcon,
  Trash2Icon,
  UploadIcon,
  WebhookIcon,
  XCircleIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { saveBlobToDisk } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { uptimeCommands } from '@/lib/uptime/engine';
import { changeSettings, shownSettings } from '@/lib/uptime/store';
import { formatWhen } from '@/lib/uptime/format';
import { targetKey } from '@/lib/uptime/suggest';
import { newTarget, type Monitor, type Settings, type Target, type TargetKind } from '@/lib/uptime/types';
import { Panel, PanelTitle, useUptimeView } from './UptimeShared';

const KIND_INFO: Record<TargetKind, { label: string; icon: React.ComponentType<{ className?: string }>; how: string }> = {
  slack: { label: 'Slack', icon: SlackIcon, how: 'In Slack, add the Incoming Webhooks app to a channel, then paste the address it gives you.' },
  discord: { label: 'Discord', icon: MessageCircleIcon, how: 'In Discord, open the channel settings, then Integrations, then Webhooks, and copy the webhook address.' },
  telegram: { label: 'Telegram', icon: SendIcon, how: 'Make a bot with @BotFather, add the bot to your chat, then paste the bot token and the chat number.' },
  ntfy: { label: 'ntfy', icon: BellIcon, how: 'Pick a topic name that\'s hard to guess and subscribe to it in the ntfy app. Uses ntfy.sh unless you type your own server.' },
  webhook: { label: 'Your own address', icon: WebhookIcon, how: 'Uptime sends a JSON message to this address for each alert: the event, the monitor, the reason and the time.' },
};

const REMIND: Array<[number, string]> = [
  [0, 'Never'],
  [15, 'Every 15 minutes'],
  [30, 'Every 30 minutes'],
  [60, 'Every hour'],
  [360, 'Every 6 hours'],
];

function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
}

export function UptimeAlerts() {
  const { view } = useUptimeView();
  const { toast } = useToast();
  // With the changes still saving made, so each shows the moment it's asked for.
  const settings = shownSettings(view);
  const [editing, setEditing] = useState<Target | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  // Each change is a function of the settings, applied to the settings as
  // the change before it left them (`changeSettings`), never to this copy.
  const save = async (change: (current: Settings) => Settings, done?: string) => {
    try {
      await changeSettings(change);
      if (done) toast({ title: done });
      return true;
    } catch (failure) {
      toast({ title: 'That setting wasn\'t saved', description: failure instanceof Error ? failure.message : String(failure), variant: 'destructive' });
      return false;
    }
  };

  const setDesktop = async (on: boolean) => {
    if (on && view.notifications === 'page' && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (error) {
        console.error('Notification permission request failed', error);
      }
    }
    await save((current) => ({ ...current, desktop: on }));
  };

  const testDesktop = async () => {
    setTesting('desktop');
    try {
      const how = await uptimeCommands.testAlert(null);
      if (how === 'page' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Uptime alerts work', { body: 'This is how an alert from Uptime looks.', silent: !settings.sound });
      }
      track('uptime_alert_test', { kind: 'desktop', how });
    } catch (failure) {
      toast({ title: 'The test wasn\'t sent', description: failure instanceof Error ? failure.message : String(failure), variant: 'destructive' });
    } finally {
      setTesting(null);
    }
  };

  const testTarget = async (target: Target) => {
    setTesting(target.id || 'new');
    try {
      await uptimeCommands.testAlert(target);
      toast({ title: `Test sent to ${target.name || KIND_INFO[target.kind].label}`, description: 'Check that it arrived.' });
      track('uptime_alert_test', { kind: target.kind, ok: true });
    } catch (failure) {
      toast({ title: `The test didn't reach ${target.name || KIND_INFO[target.kind].label}`, description: failure instanceof Error ? failure.message : String(failure), variant: 'destructive' });
      track('uptime_alert_test', { kind: target.kind, ok: false });
    } finally {
      setTesting(null);
    }
  };

  const saveTarget = async (target: Target) => {
    const change = (current: Settings) => ({ ...current, targets: target.id ? current.targets.map((other) => (other.id === target.id ? target : other)) : [...current.targets, target] });
    if (await save(change, target.id ? `${target.name || KIND_INFO[target.kind].label} saved` : `Alerts go to ${target.name || KIND_INFO[target.kind].label} now`)) setEditing(null);
  };

  const removeTarget = (target: Target) => void save((current) => ({ ...current, targets: current.targets.filter((other) => other.id !== target.id) }), `${target.name} removed`);

  const nativeNote =
    view.notifications === 'native'
      ? 'macOS shows it even when the app is in the background. Allow notifications for the app when macOS asks.'
      : view.notifications === 'page'
        ? 'Your system shows it. Allow notifications for the app when it asks.'
        : 'This copy of the app can\'t show system notifications, the installed app can. Alerts still show inside the app.';

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6" data-testid="uptime-alerts">
      <div>
        <h2 className="text-xl font-semibold leading-tight">Alerts</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Who hears about it when a monitor goes down, comes back, or its certificate is about to run out.</p>
      </div>

      <Panel className="space-y-4">
        <PanelTitle title="On this computer" />
        <SettingRow title="Show a notification" hint={nativeNote}>
          <Switch checked={settings.desktop} onCheckedChange={(on) => void setDesktop(on)} aria-label="Show a notification" />
        </SettingRow>
        <SettingRow title="Play a sound" hint="With each notification">
          <Switch checked={settings.sound} onCheckedChange={(sound) => void save((current) => ({ ...current, sound }))} aria-label="Play a sound" disabled={!settings.desktop} />
        </SettingRow>
        {!isWindows() && (
          <SettingRow title="Show the number down on the app icon" hint="In the Dock, while something is down">
            <Switch checked={settings.badge} onCheckedChange={(badge) => void save((current) => ({ ...current, badge }))} aria-label="Show the number down on the app icon" />
          </SettingRow>
        )}
        <SettingRow title="Remind me while it's down" hint="Another alert while a monitor stays down">
          <Select value={String(REMIND.some(([minutes]) => minutes === settings.remind) ? settings.remind : 0)} onValueChange={(value) => void save((current) => ({ ...current, remind: Number(value) }))}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Remind me while it's down">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REMIND.map(([minutes, text]) => (
                <SelectItem key={minutes} value={String(minutes)} className="text-xs">
                  {text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void testDesktop()} disabled={testing === 'desktop' || !settings.desktop}>
          {testing === 'desktop' ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <BellIcon className="h-3.5 w-3.5" />}
          Send a test notification
        </Button>
      </Panel>

      <Panel>
        <PanelTitle
          title="Other places"
          hint="Get alerts on your phone or in your team's chat"
          actions={
            !editing && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setEditing(newTarget('slack'))} data-testid="uptime-add-place">
                <PlusIcon className="h-3.5 w-3.5" />
                Add a place
              </Button>
            )
          }
        />
        {editing && !editing.id && <TargetForm target={editing} onCancel={() => setEditing(null)} onSave={saveTarget} onTest={testTarget} testing={testing !== null} />}
        {settings.targets.length === 0 && !editing ? (
          <p className="text-sm text-muted-foreground">No other places yet. Add Slack, Discord, Telegram, ntfy or your own address.</p>
        ) : (
          <ul className="divide-y">
            {settings.targets.map((target, index) =>
              editing?.id && editing.id === target.id ? (
                <li key={target.id} className="py-3">
                  <TargetForm target={editing} onCancel={() => setEditing(null)} onSave={saveTarget} onTest={testTarget} testing={testing !== null} />
                </li>
              ) : (
                <TargetRow key={target.id || `new-${index}`} target={target} testing={testing === target.id} onToggle={(enabled) => void saveTarget({ ...target, enabled })} onTest={() => void testTarget(target)} onEdit={() => setEditing(target)} onRemove={() => removeTarget(target)} />
              )
            )}
          </ul>
        )}
      </Panel>

      {view.deliveries.length > 0 && (
        <Panel>
          <PanelTitle title="Sent lately" hint="The last alerts that went to other places" />
          <ul className="space-y-1.5" data-testid="uptime-deliveries">
            {view.deliveries.slice(0, 12).map((delivery) => (
              <li key={`${delivery.at}:${delivery.target}`} className="flex items-start gap-2 text-sm">
                {delivery.ok ? <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--uptime-up-text))]" /> : <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--uptime-down-text))]" />}
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{delivery.name}</span>
                  <span className="text-muted-foreground">: {delivery.title}</span>
                  {!delivery.ok && <span className="block text-xs text-[hsl(var(--uptime-down-text))]">{delivery.note}</span>}
                </span>
                <time className="shrink-0 text-[11px] text-muted-foreground">{formatWhen(delivery.at, view.now)}</time>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Backup monitors={view.monitors} />

      <Panel className="flex gap-3 bg-muted/40">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">How Uptime works</p>
          <p>Uptime runs on this computer. It checks while the app is open, also when its window is in the background or minimised.</p>
          <p>When the app is closed or the computer sleeps, nothing is checked. The history shows a gap there instead of counting it as down, and a check that fails while this computer is offline doesn&apos;t count either.</p>
          <p>The history stays on this computer: every check for 30 days, and the hourly totals for 400 days.</p>
        </div>
      </Panel>
    </div>
  );
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function TargetRow({ target, testing, onToggle, onTest, onEdit, onRemove }: { target: Target; testing: boolean; onToggle: (enabled: boolean) => void; onTest: () => void; onEdit: () => void; onRemove: () => void }) {
  // A place still being added has no id until Rust answers.
  const adding = !target.id;
  const info = KIND_INFO[target.kind];
  const Icon = info.icon;
  const events = [target.down && 'down', target.up && 'back up', target.cert && 'certificates', target.news && 'new versions'].filter(Boolean).join(', ');
  return (
    <li className="flex flex-wrap items-center gap-3 py-3" data-testid="uptime-place">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', !target.enabled && 'text-muted-foreground')}>{target.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {info.label}
          {events ? `, for ${events}` : ', for nothing yet'}
        </p>
      </div>
      <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={onTest} disabled={adding || testing || !target.enabled}>
        {testing ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <SendIcon className="h-3.5 w-3.5" />}
        Test
      </Button>
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Change ${target.name}`} onClick={onEdit} disabled={adding}>
        <PencilIcon className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`Remove ${target.name}`} onClick={onRemove} disabled={adding}>
        <Trash2Icon className="h-3.5 w-3.5" />
      </Button>
      <Switch checked={target.enabled} onCheckedChange={onToggle} aria-label={`Send alerts to ${target.name}`} disabled={adding} />
    </li>
  );
}

function TargetForm({ target, onCancel, onSave, onTest, testing }: { target: Target; onCancel: () => void; onSave: (target: Target) => Promise<void>; onTest: (target: Target) => Promise<void>; testing: boolean }) {
  const [draft, setDraft] = useState<Target>(target);
  const [saving, setSaving] = useState(false);
  const info = KIND_INFO[draft.kind];
  const change = (patch: Partial<Target>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <form
      className="mb-3 space-y-3 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onSave(draft).finally(() => setSaving(false));
      }}
      data-testid="uptime-place-form"
    >
      {!target.id && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Where to send alerts">
          {(Object.keys(KIND_INFO) as TargetKind[]).map((kind) => {
            const Icon = KIND_INFO[kind].icon;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={draft.kind === kind}
                onClick={() => setDraft({ ...newTarget(kind), name: draft.name })}
                className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors', draft.kind === kind ? 'border-transparent bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground')}
              >
                <Icon className="h-3.5 w-3.5" />
                {KIND_INFO[kind].label}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{info.how}</p>
      {(draft.kind === 'slack' || draft.kind === 'discord' || draft.kind === 'webhook') && (
        <div className="space-y-1">
          <Label htmlFor="uptime-place-url" className="text-xs">
            {draft.kind === 'webhook' ? 'Address' : 'Webhook address'}
          </Label>
          <Input
            id="uptime-place-url"
            value={draft.url}
            onChange={(event) => change({ url: event.target.value })}
            placeholder={draft.kind === 'slack' ? 'https://hooks.slack.com/services/...' : draft.kind === 'discord' ? 'https://discord.com/api/webhooks/...' : 'https://example.com/alerts'}
            className="h-9 font-mono text-xs"
          />
        </div>
      )}
      {draft.kind === 'telegram' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="uptime-place-token" className="text-xs">
              Bot token
            </Label>
            <Input id="uptime-place-token" value={draft.token} onChange={(event) => change({ token: event.target.value })} placeholder="123456:ABC-DEF..." className="h-9 font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="uptime-place-chat" className="text-xs">
              Chat number
            </Label>
            <Input id="uptime-place-chat" value={draft.chat} onChange={(event) => change({ chat: event.target.value })} placeholder="-1001234567890" className="h-9 font-mono text-xs" />
          </div>
        </div>
      )}
      {draft.kind === 'ntfy' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="uptime-place-topic" className="text-xs">
              Topic
            </Label>
            <Input id="uptime-place-topic" value={draft.topic} onChange={(event) => change({ topic: event.target.value })} placeholder="my-app-alerts-7f3k" className="h-9 font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="uptime-place-server" className="text-xs">
              Server
            </Label>
            <Input id="uptime-place-server" value={draft.url} onChange={(event) => change({ url: event.target.value })} placeholder="https://ntfy.sh" className="h-9 font-mono text-xs" />
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="uptime-place-name" className="text-xs">
            Name
          </Label>
          <Input id="uptime-place-name" value={draft.name} onChange={(event) => change({ name: event.target.value })} placeholder={info.label} maxLength={60} className="h-9 text-sm" />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">Send when</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            {(
              [
                ['down', 'It goes down'],
                ['up', 'It\'s back up'],
                ['cert', 'A certificate runs out soon'],
                ['news', 'A new version is live'],
              ] as Array<[keyof Pick<Target, 'down' | 'up' | 'cert' | 'news'>, string]>
            ).map(([key, text]) => (
              <label key={key} className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={draft[key]} onCheckedChange={(checked) => change({ [key]: checked === true } as Partial<Target>)} />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void onTest(draft)} disabled={testing}>
          <SendIcon className="h-3.5 w-3.5" />
          Send a test
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : target.id ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

interface BackupFile {
  app: 'open-screenshot-generator';
  kind: 'uptime-monitors';
  version: 1;
  monitors: Monitor[];
}

function Backup({ monitors }: { monitors: Monitor[] }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const exportAll = async () => {
    const file: BackupFile = { app: 'open-screenshot-generator', kind: 'uptime-monitors', version: 1, monitors: monitors.map((monitor) => ({ ...monitor, skipAlerts: [] })) };
    const path = await saveBlobToDisk(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), 'uptime-monitors.json');
    if (path !== null) toast({ title: `${monitors.length} ${monitors.length === 1 ? 'monitor' : 'monitors'} saved to a file` });
  };

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as Partial<BackupFile>;
      if (parsed.kind !== 'uptime-monitors' || !Array.isArray(parsed.monitors)) throw new Error('That file isn\'t a list of Uptime monitors');
      const have = new Set(monitors.map(targetKey));
      let added = 0;
      let skipped = 0;
      const failed: string[] = [];
      for (const monitor of parsed.monitors) {
        if (have.has(targetKey(monitor))) {
          skipped += 1;
          continue;
        }
        try {
          await uptimeCommands.save({ ...monitor, id: '', skipAlerts: [] });
          have.add(targetKey(monitor));
          added += 1;
        } catch (error) {
          failed.push(`${monitor.name || 'A monitor'}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      toast({
        title: added ? `${added} ${added === 1 ? 'monitor' : 'monitors'} added` : 'No monitors added',
        description: [skipped ? `${skipped} were already here.` : '', failed.length ? `${failed.length} couldn't be added. ${failed[0]}` : ''].filter(Boolean).join(' ') || undefined,
        variant: failed.length && !added ? 'destructive' : undefined,
      });
      track('uptime_import', { added, skipped, failed: failed.length });
    } catch (error) {
      toast({ title: 'That file couldn\'t be read', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelTitle title="Your monitors" hint="Keep a copy, or move them to another computer. Places for alerts aren't in the file, since they hold your keys." />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void exportAll()} disabled={monitors.length === 0}>
          <DownloadIcon className="h-3.5 w-3.5" />
          Save to a file
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <UploadIcon className="h-3.5 w-3.5" />}
          Add from a file
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </div>
    </Panel>
  );
}
