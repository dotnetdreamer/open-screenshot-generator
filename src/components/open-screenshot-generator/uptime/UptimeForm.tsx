"use client";

// Adding or changing a monitor. A paste of an address fills the form, the
// five kinds each say when to pick them, and "Test it now" runs the real
// check before anything is saved, so the user sees what Uptime will see.

import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangleIcon, ArrowLeftIcon, CheckCircle2Icon, ChevronDownIcon, CircleHelpIcon, FlaskConicalIcon, Loader2Icon, PlusIcon, Trash2Icon, XCircleIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { TERRITORY_CODES, territoryName } from '@/lib/growth/territories';
import { cn } from '@/lib/utils';
import { applyDetected, detect, nameFromUrl } from '@/lib/uptime/detect';
import { uptimeCommands } from '@/lib/uptime/engine';
import { KIND_LABELS, formatDate, formatMs, storeName, targetText } from '@/lib/uptime/format';
import { targetKey } from '@/lib/uptime/suggest';
import { newMonitor, type DnsType, type JsonOp, type Monitor, type MonitorKind, type TestResult } from '@/lib/uptime/types';
import { KindIcon, Panel, useSuggestions, useUptimeView } from './UptimeShared';

const KINDS: Array<{ kind: MonitorKind; when: string }> = [
  { kind: 'http', when: 'A page or an API that should open, such as your site or your privacy policy' },
  { kind: 'port', when: 'A server that should take connections, such as a database or a game server' },
  { kind: 'ping', when: 'A computer or a router that should answer a ping' },
  { kind: 'dns', when: 'A domain record that should be there, or keep a value' },
  { kind: 'store', when: 'Your app on the App Store or Google Play, so you hear if it stops being on sale' },
];

const INTERVALS = [20, 30, 60, 120, 300, 600, 900, 1800, 3600];
const INTERVAL_WORDS: Record<number, string> = {
  20: 'Every 20 seconds',
  30: 'Every 30 seconds',
  60: 'Every minute',
  120: 'Every 2 minutes',
  300: 'Every 5 minutes',
  600: 'Every 10 minutes',
  900: 'Every 15 minutes',
  1800: 'Every 30 minutes',
  3600: 'Every hour',
};

const RETRIES: Array<[number, string]> = [
  [0, 'The first failed check'],
  [1, '2 failed checks in a row'],
  [2, '3 failed checks in a row'],
  [4, '5 failed checks in a row'],
];

const DNS_TYPES: Array<[DnsType, string]> = [
  ['A', 'A: the IPv4 address'],
  ['AAAA', 'AAAA: the IPv6 address'],
  ['CNAME', 'CNAME: the name it points to'],
  ['MX', 'MX: the mail servers'],
  ['TXT', 'TXT: text, such as SPF'],
  ['NS', 'NS: the name servers'],
  ['CAA', 'CAA: who may issue certificates'],
];

const JSON_OPS: Array<[JsonOp, string]> = [
  ['eq', 'is'],
  ['ne', 'is not'],
  ['contains', 'contains'],
  ['lt', 'is less than'],
  ['gt', 'is more than'],
];

const COMMON_PORTS: Array<[number, string]> = [
  [22, 'SSH'],
  [25, 'Mail'],
  [587, 'Mail sending'],
  [3306, 'MySQL'],
  [5432, 'PostgreSQL'],
  [6379, 'Redis'],
  [27017, 'MongoDB'],
  [25565, 'Minecraft'],
];

const COUNTRIES = [...TERRITORY_CODES].sort((a, b) => territoryName(a).localeCompare(territoryName(b)));

function Field({ label, hint, htmlFor, children, className }: { label: string; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice<T extends string | number>({ value, onChange, options, label, id }: { value: T; onChange: (value: T) => void; options: Array<[T, string]>; label: string; id?: string }) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange((typeof value === 'number' ? Number(next) : next) as T)}>
      <SelectTrigger id={id} className="h-9 text-sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([option, text]) => (
          <SelectItem key={String(option)} value={String(option)} className="text-sm">
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function suggestedName(monitor: Monitor): string {
  switch (monitor.kind) {
    case 'http':
      return monitor.url ? nameFromUrl(monitor.url) : '';
    case 'port':
      return monitor.host ? `${monitor.host} port ${monitor.port}` : '';
    case 'ping':
      return monitor.host;
    case 'dns':
      return monitor.host ? `${monitor.host} ${monitor.dnsType} record` : '';
    case 'store':
      return monitor.appId ? `${monitor.appId} on ${monitor.store === 'google' ? 'Google Play' : 'the App Store'}` : '';
  }
}

export function UptimeForm({ seed, editId }: { seed?: Monitor; editId?: string }) {
  const { view, go, monitorOf, summaryOf } = useUptimeView();
  const { toast } = useToast();
  const editing = editId ? monitorOf(editId) : undefined;
  const [draft, setDraft] = useState<Monitor>(() => editing ?? seed ?? newMonitor('http'));
  // A name Uptime made (from the address, or the store's name for the app)
  // follows what the monitor watches; one the user typed stays.
  // Whether the user typed the name, as the monitor says: a pasted link's or
  // a suggestion's name is one Uptime made, and a saved monitor keeps which
  // it was (`autoName`), since a clear forgets the app's name. A monitor
  // saved before that was kept is read from its name: Uptime's if it is
  // the one Uptime would make, from the address or the store's name.
  const [nameTouched, setNameTouched] = useState(() => {
    const base = editing ?? seed;
    if (!base) return false;
    if (typeof base.autoName === 'boolean') return !base.autoName;
    const appName = base.kind === 'store' && base.id ? summaryOf(base.id)?.detail.appName : undefined;
    return base.name !== suggestedName(base) && !(appName && base.name === storeName(appName, base.store));
  });
  // Read when a test's answer lands, which is after the render that started it.
  const nameTouchedNow = useRef(nameTouched);
  nameTouchedNow.current = nameTouched;
  const [paste, setPaste] = useState('');
  const [pasted, setPasted] = useState<MonitorKind | null>(null);
  const [more, setMore] = useState(false);
  const [testing, setTesting] = useState(false);
  // The answer, with the settings it was for: shown only while the form
  // still has them.
  const [result, setResult] = useState<{ answer: TestResult; tested: Monitor } | null>(null);
  // Moves on with every change to what the check does, so an answer to a
  // test of earlier settings is dropped when it lands.
  const testRun = useRef(0);
  const { suggestions, hide } = useSuggestions(view.monitors);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const forgetTest = () => {
    testRun.current += 1;
    setResult(null);
    setTesting(false);
  };

  const change = (patch: Partial<Monitor>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      // Only a new target renames: the interval leaves the store's name alone.
      if (!nameTouched && suggestedName(next) !== suggestedName(current)) next.name = suggestedName(next);
      return next;
    });
    forgetTest();
    setProblem(null);
  };

  const onPaste = (text: string) => {
    setPaste(text);
    const detected = detect(text);
    setPasted(detected?.kind ?? null);
    if (!detected) return;
    setDraft((current) => {
      const next = applyDetected({ ...current, name: nameTouched ? current.name : '' }, detected);
      if (nameTouched) next.name = current.name;
      return next;
    });
    forgetTest();
    setProblem(null);
  };

  const duplicate = useMemo(() => {
    const key = targetKey(draft);
    return view.monitors.find((monitor) => monitor.id !== draft.id && targetKey(monitor) === key) ?? null;
  }, [draft, view.monitors]);

  const test = async () => {
    const run = ++testRun.current;
    const tested = draft;
    setTesting(true);
    setResult(null);
    setProblem(null);
    try {
      const answer = await uptimeCommands.test(tested);
      if (run !== testRun.current) return;
      setResult({ answer, tested });
      track('uptime_test', { kind: tested.kind, ok: answer.ok });
      // The store's name for the app, unless the user has typed one, before
      // the test or while it ran.
      if (answer.ok && tested.kind === 'store' && answer.detail.appName && !nameTouchedNow.current) {
        const named = storeName(answer.detail.appName, tested.store);
        setDraft((current) => ({ ...current, name: named }));
      }
    } catch (failure) {
      if (run !== testRun.current) return;
      setResult(null);
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (run === testRun.current) setTesting(false);
    }
  };

  const fillFrom = (monitor: Monitor) => {
    setDraft({ ...monitor });
    setNameTouched(!monitor.autoName);
    setPaste('');
    setPasted(null);
    forgetTest();
    setProblem(null);
  };

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      const saved = await uptimeCommands.save({ ...draft, autoName: !nameTouched });
      track(editing ? 'uptime_edit' : 'uptime_add', { kind: saved.kind, interval: saved.interval });
      toast({ title: editing ? `${saved.name} saved` : `Watching ${saved.name}`, description: editing ? undefined : 'The first check runs now.' });
      go({ name: 'monitor', id: saved.id });
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const targets = view.settings.targets;
  const httpLike = draft.kind === 'http';

  return (
    <form
      className="mx-auto grid max-w-5xl gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_320px]"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      data-testid="uptime-form"
    >
      <div className="min-w-0 space-y-4">
        <div className="flex items-start gap-2">
          <Button type="button" size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" aria-label="Back" onClick={() => go(editing ? { name: 'monitor', id: editing.id } : { name: 'overview' })}>
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold leading-tight">{editing ? `Change ${editing.name}` : 'Add a monitor'}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{editing ? 'The history stays when you change the settings.' : 'Tell Uptime what to check. You can test it before you save.'}</p>
          </div>
        </div>

        {!editing && suggestions && suggestions.length > 0 && (
          <Panel className="space-y-2" data-testid="uptime-form-suggestions">
            <p className="text-xs font-medium">From your apps</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <span key={suggestion.key} className="inline-flex items-center rounded-full border bg-card text-xs">
                  <button type="button" onClick={() => fillFrom(suggestion.monitor)} className="inline-flex items-center gap-1.5 rounded-l-full py-1 pl-2.5 pr-1.5 transition-colors hover:bg-muted" title={suggestion.hint}>
                    <KindIcon kind={suggestion.monitor.kind} className="h-3.5 w-3.5 text-muted-foreground" />
                    {suggestion.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => hide(suggestion.key)}
                    className="rounded-r-full py-1 pl-1 pr-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={`Don't suggest ${suggestion.title} again`}
                    title="Don't suggest this again"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </Panel>
        )}

        {!editing && (
          <Panel className="space-y-1.5">
            <Label htmlFor="uptime-paste" className="text-xs font-medium">
              Paste an address to fill the form
            </Label>
            <Input
              id="uptime-paste"
              value={paste}
              onChange={(event) => onPaste(event.target.value)}
              placeholder="https://example.com, db.example.com:5432 or an App Store link"
              className="h-10 text-sm"
              autoFocus={!seed}
              data-testid="uptime-paste"
            />
            {paste.trim() && (
              <p className="text-[11px] text-muted-foreground" aria-live="polite">
                {pasted ? `Reads as a ${KIND_LABELS[pasted].toLowerCase()}. Check the fields below.` : 'That doesn\'t look like an address yet.'}
              </p>
            )}
          </Panel>
        )}

        <Panel>
          <p className="mb-2 text-xs font-medium" id="uptime-kind-label">
            What to check
          </p>
          <div role="radiogroup" aria-labelledby="uptime-kind-label" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {KINDS.map(({ kind, when }) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={draft.kind === kind}
                onClick={() => change({ kind })}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                  draft.kind === kind ? 'border-[hsl(var(--uptime-accent))] bg-[hsl(var(--uptime-accent)/0.06)] ring-1 ring-[hsl(var(--uptime-accent))]' : 'hover:bg-muted/50'
                )}
                data-kind={kind}
              >
                <KindIcon kind={kind} className={cn('mt-0.5 h-4 w-4', draft.kind === kind ? 'text-[hsl(var(--uptime-accent))]' : 'text-muted-foreground')} />
                <span>
                  <span className="block text-sm font-medium">{KIND_LABELS[kind]}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{when}</span>
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel className="space-y-4">
          {draft.kind === 'http' && (
            <Field label="Web address" htmlFor="uptime-url" hint="The full address, as you'd open it in a browser">
              <Input id="uptime-url" value={draft.url} onChange={(event) => change({ url: event.target.value })} placeholder="https://example.com" className="h-9 text-sm" inputMode="url" data-testid="uptime-url" />
            </Field>
          )}
          {(draft.kind === 'port' || draft.kind === 'ping' || draft.kind === 'dns') && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Field label={draft.kind === 'dns' ? 'Domain' : 'Server'} htmlFor="uptime-host" hint={draft.kind === 'dns' ? 'Such as example.com' : 'A name such as db.example.com, or an address such as 192.168.1.10'}>
                <Input id="uptime-host" value={draft.host} onChange={(event) => change({ host: event.target.value })} placeholder={draft.kind === 'dns' ? 'example.com' : 'db.example.com'} className="h-9 text-sm" data-testid="uptime-host" />
              </Field>
              {draft.kind === 'port' && (
                <Field label="Port" htmlFor="uptime-port">
                  <Input id="uptime-port" type="number" min={1} max={65535} value={draft.port || ''} onChange={(event) => change({ port: Number(event.target.value) || 0 })} className="h-9 text-sm tabular-nums" data-testid="uptime-port" />
                </Field>
              )}
              {draft.kind === 'dns' && (
                <Field label="Record" htmlFor="uptime-dns-type">
                  <Choice id="uptime-dns-type" label="Record" value={draft.dnsType} onChange={(dnsType) => change({ dnsType })} options={DNS_TYPES} />
                </Field>
              )}
            </div>
          )}
          {draft.kind === 'port' && (
            <div className="flex flex-wrap gap-1.5" aria-label="Common ports">
              {COMMON_PORTS.map(([port, name]) => (
                <button key={port} type="button" onClick={() => change({ port })} className={cn('rounded-full border px-2 py-0.5 text-[11px] transition-colors', draft.port === port ? 'border-transparent bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
                  {name} {port}
                </button>
              ))}
            </div>
          )}
          {draft.kind === 'dns' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Must include (optional)" htmlFor="uptime-dns-expect" hint="Separate several values with commas. Leave it empty to accept any answer">
                <Input id="uptime-dns-expect" value={draft.dnsExpect} onChange={(event) => change({ dnsExpect: event.target.value })} placeholder={draft.dnsType === 'MX' ? '10 mail.example.com' : draft.dnsType === 'TXT' ? 'v=spf1' : '93.184.215.14'} className="h-9 text-sm" />
              </Field>
              <Field label="DNS server (optional)" htmlFor="uptime-dns-server" hint="Leave it empty to ask the one this computer uses">
                <Input id="uptime-dns-server" value={draft.dnsServer} onChange={(event) => change({ dnsServer: event.target.value })} placeholder="1.1.1.1" className="h-9 text-sm" />
              </Field>
            </div>
          )}
          {draft.kind === 'store' && (
            <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_200px]">
              <Field label="Store" htmlFor="uptime-store">
                <Choice
                  id="uptime-store"
                  label="Store"
                  value={draft.store}
                  onChange={(store) => change({ store })}
                  options={[
                    ['apple', 'App Store'],
                    ['google', 'Google Play'],
                  ]}
                />
              </Field>
              <Field label={draft.store === 'google' ? 'Package name' : 'App Store number'} htmlFor="uptime-app" hint={draft.store === 'google' ? 'Such as com.example.app' : 'The number after "id" in the app\'s link'}>
                <Input id="uptime-app" value={draft.appId} onChange={(event) => change({ appId: event.target.value.trim() })} placeholder={draft.store === 'google' ? 'com.example.app' : '1234567890'} className="h-9 text-sm" data-testid="uptime-app" />
              </Field>
              <Field label="Country" htmlFor="uptime-country">
                <Select value={draft.country.toUpperCase()} onValueChange={(code) => change({ country: code.toLowerCase() })}>
                  <SelectTrigger id="uptime-country" className="h-9 text-sm" aria-label="Country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((code) => (
                      <SelectItem key={code} value={code} className="text-sm">
                        {territoryName(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
          {draft.kind === 'store' && draft.store === 'google' && (
            <Field label="Counts as up when" htmlFor="uptime-listed" hint="Pick the page for an app that isn't out yet">
              <Choice
                id="uptime-listed"
                label="Counts as up when"
                value={draft.listedOk ? 'listed' : 'install'}
                onChange={(value) => change({ listedOk: value === 'listed' })}
                options={[
                  ['install', 'People in that country can install it'],
                  ['listed', 'Its page is there, for an app open for pre-registration'],
                ]}
              />
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="uptime-name" hint="How it shows in the list and in alerts">
              <Input
                id="uptime-name"
                value={draft.name}
                onChange={(event) => {
                  setNameTouched(true);
                  setDraft((current) => ({ ...current, name: event.target.value }));
                }}
                placeholder="My website"
                maxLength={80}
                className="h-9 text-sm"
                data-testid="uptime-name"
              />
            </Field>
            <Field label="How often" htmlFor="uptime-interval">
              <Choice id="uptime-interval" label="How often" value={INTERVALS.includes(draft.interval) ? draft.interval : 60} onChange={(interval) => change({ interval })} options={INTERVALS.map((seconds) => [seconds, INTERVAL_WORDS[seconds]] as [number, string])} />
            </Field>
          </div>
          <Field label="Call it down after" htmlFor="uptime-retries" hint="A second check avoids alerts for a moment's hiccup">
            <Choice id="uptime-retries" label="Call it down after" value={RETRIES.some(([count]) => count === draft.retries) ? draft.retries : 1} onChange={(retries) => change({ retries })} options={RETRIES} />
          </Field>
          {duplicate && (
            <p className="flex items-center gap-1.5 rounded-md bg-[hsl(var(--uptime-pending)/0.14)] px-3 py-2 text-xs text-[hsl(var(--uptime-pending-text))]">
              <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />
              {duplicate.name} already checks this.
            </p>
          )}
        </Panel>

        <Panel className="p-0">
          <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setMore((open) => !open)} aria-expanded={more}>
            <span>
              <span className="block text-sm font-medium">More settings</span>
              <span className="block text-[11px] text-muted-foreground">
                {httpLike ? 'Words to look for, a JSON value, the status codes, headers and certificates' : 'How long to wait, and when a check counts as slow'}
              </span>
            </span>
            <ChevronDownIcon className={cn('h-4 w-4 text-muted-foreground transition-transform', more && 'rotate-180')} />
          </button>
          {more && (
            <div className="space-y-4 border-t p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Give up after" htmlFor="uptime-timeout">
                  <Choice
                    id="uptime-timeout"
                    label="Give up after"
                    value={[5, 10, 15, 20, 30, 60].includes(draft.timeout) ? draft.timeout : 10}
                    onChange={(timeout) => change({ timeout })}
                    options={[5, 10, 15, 20, 30, 60].map((seconds) => [seconds, `${seconds} seconds`] as [number, string])}
                  />
                </Field>
                <Field label="Check again after" htmlFor="uptime-retry-interval" hint="After a failed check">
                  <Choice
                    id="uptime-retry-interval"
                    label="Check again after"
                    value={[10, 20, 30, 60].includes(draft.retryInterval) ? draft.retryInterval : 20}
                    onChange={(retryInterval) => change({ retryInterval })}
                    options={[
                      [10, '10 seconds'],
                      [20, '20 seconds'],
                      [30, '30 seconds'],
                      [60, '1 minute'],
                    ]}
                  />
                </Field>
                <Field label="Slow when over" htmlFor="uptime-slow" hint="Marked on the chart">
                  <Choice
                    id="uptime-slow"
                    label="Slow when over"
                    value={[0, 500, 1000, 2000, 3000, 5000].includes(draft.slowMs) ? draft.slowMs : 0}
                    onChange={(slowMs) => change({ slowMs })}
                    options={[
                      [0, 'Off'],
                      [500, formatMs(500)],
                      [1000, formatMs(1000)],
                      [2000, formatMs(2000)],
                      [3000, formatMs(3000)],
                      [5000, formatMs(5000)],
                    ]}
                  />
                </Field>
              </div>

              {httpLike && (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Look for words (optional)" htmlFor="uptime-keyword" className="sm:col-span-2" hint="Catches a page that opens but shows an error">
                      <Input id="uptime-keyword" value={draft.keyword} onChange={(event) => change({ keyword: event.target.value })} placeholder="Add to cart" className="h-9 text-sm" />
                    </Field>
                    <Field label="Up when the words are" htmlFor="uptime-keyword-mode">
                      <Choice
                        id="uptime-keyword-mode"
                        label="Up when the words are"
                        value={draft.keywordAbsent ? 'absent' : 'present'}
                        onChange={(mode) => change({ keywordAbsent: mode === 'absent' })}
                        options={[
                          ['present', 'On the page'],
                          ['absent', 'Not on the page'],
                        ]}
                      />
                    </Field>
                  </div>
                  {draft.keyword && (
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked={draft.keywordCase} onCheckedChange={(checked) => change({ keywordCase: checked === true })} />
                      Capital letters must match
                    </label>
                  )}
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)]">
                    <Field label="JSON value (optional)" htmlFor="uptime-json-path" hint="For an API, such as status or data.items[0].state">
                      <Input id="uptime-json-path" value={draft.jsonPath} onChange={(event) => change({ jsonPath: event.target.value })} placeholder="status" className="h-9 font-mono text-xs" />
                    </Field>
                    <Field label="Up when it" htmlFor="uptime-json-op">
                      <Choice id="uptime-json-op" label="Up when it" value={draft.jsonOp} onChange={(jsonOp) => change({ jsonOp })} options={JSON_OPS} />
                    </Field>
                    <Field label="Value" htmlFor="uptime-json-expected" hint="Leave empty to only need the value there">
                      <Input id="uptime-json-expected" value={draft.jsonExpected} onChange={(event) => change({ jsonExpected: event.target.value })} placeholder="ok" className="h-9 text-sm" />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Good status codes" htmlFor="uptime-accept" hint="Ranges and codes, such as 200-299, 301">
                      <Input id="uptime-accept" value={draft.accept} onChange={(event) => change({ accept: event.target.value })} className="h-9 text-sm tabular-nums" />
                    </Field>
                    <Field label="Ask with" htmlFor="uptime-method">
                      <Choice id="uptime-method" label="Ask with" value={draft.method} onChange={(method) => change({ method })} options={['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) => [method, method] as [string, string])} />
                    </Field>
                    <Field label="Warn before the certificate runs out" htmlFor="uptime-cert-days">
                      <Choice
                        id="uptime-cert-days"
                        label="Warn before the certificate runs out"
                        value={[0, 7, 14, 30].includes(draft.certDays) ? draft.certDays : 14}
                        onChange={(certDays) => change({ certDays })}
                        options={[
                          [0, 'Never'],
                          [7, '7 days before'],
                          [14, '14 days before'],
                          [30, '30 days before'],
                        ]}
                      />
                    </Field>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        <span className="block text-xs font-medium">Follow redirects</span>
                        <span className="block text-[11px] text-muted-foreground">Off checks only the first answer, such as a 301</span>
                      </span>
                      <Switch checked={draft.redirects > 0} onCheckedChange={(on) => change({ redirects: on ? 10 : 0 })} aria-label="Follow redirects" />
                    </label>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        <span className="block text-xs font-medium">Accept a certificate that isn&apos;t valid</span>
                        <span className="block text-[11px] text-muted-foreground">Only for a test server you trust. Visitors would see a warning</span>
                      </span>
                      <Switch checked={draft.ignoreTls} onCheckedChange={(ignoreTls) => change({ ignoreTls })} aria-label="Accept a certificate that isn't valid" />
                    </label>
                  </div>
                  <HeaderRows monitor={draft} onChange={(headers) => change({ headers })} />
                  {!['GET', 'HEAD'].includes(draft.method) && (
                    <Field label="Body" htmlFor="uptime-body" hint="Sent with the request. JSON is sent as JSON">
                      <Textarea id="uptime-body" value={draft.body} onChange={(event) => change({ body: event.target.value })} className="min-h-[80px] font-mono text-xs" placeholder='{"ping": true}' />
                    </Field>
                  )}
                </>
              )}
            </div>
          )}
        </Panel>

        {targets.length > 0 && (
          <Panel className="space-y-2">
            <p className="text-xs font-medium">Send alerts to</p>
            {targets.map((target) => (
              <label key={target.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!draft.skipAlerts.includes(target.id)}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, skipAlerts: checked === true ? current.skipAlerts.filter((id) => id !== target.id) : [...current.skipAlerts, target.id] }))
                  }
                />
                {target.name}
                {!target.enabled && <span className="text-[11px] text-muted-foreground">(turned off)</span>}
              </label>
            ))}
            <p className="text-[11px] text-muted-foreground">{view.settings.desktop ? 'This computer shows a notification too.' : 'Notifications on this computer are off.'}</p>
          </Panel>
        )}

        {problem && (
          <p className="flex items-start gap-1.5 rounded-md bg-[hsl(var(--uptime-down)/0.12)] px-3 py-2 text-sm text-[hsl(var(--uptime-down-text))]" role="alert" data-testid="uptime-form-problem">
            <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {problem}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => go(editing ? { name: 'monitor', id: editing.id } : { name: 'overview' })}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="min-w-[140px] bg-[hsl(var(--uptime-accent))] text-white hover:bg-[hsl(var(--uptime-accent))]/90 dark:text-background" data-testid="uptime-save">
            {saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : editing ? 'Save changes' : 'Start watching'}
          </Button>
        </div>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <Panel className="space-y-3">
          <div>
            <p className="text-sm font-semibold">Test it now</p>
            <p className="text-[11px] text-muted-foreground">Runs the check once from this computer. Nothing is saved.</p>
          </div>
          <Button type="button" variant="outline" className="w-full gap-1.5" onClick={() => void test()} disabled={testing} data-testid="uptime-test">
            {testing ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <FlaskConicalIcon className="h-4 w-4" />}
            {testing ? 'Checking' : 'Test it now'}
          </Button>
          {result && <TestAnswer result={result.answer} monitor={result.tested} />}
        </Panel>
      </aside>
    </form>
  );
}

function HeaderRows({ monitor, onChange }: { monitor: Monitor; onChange: (headers: Monitor['headers']) => void }) {
  const rows = monitor.headers;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Headers (optional)</p>
      {rows.map((row, index) => (
        <div key={index} className="flex gap-2">
          <Input value={row.name} onChange={(event) => onChange(rows.map((other, at) => (at === index ? { ...other, name: event.target.value } : other)))} placeholder="Authorization" aria-label="Header name" className="h-8 w-40 font-mono text-xs" />
          <Input value={row.value} onChange={(event) => onChange(rows.map((other, at) => (at === index ? { ...other, value: event.target.value } : other)))} placeholder="Bearer ..." aria-label="Header value" className="h-8 flex-1 font-mono text-xs" />
          <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Remove this header" onClick={() => onChange(rows.filter((_, at) => at !== index))}>
            <Trash2Icon className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => onChange([...rows, { name: '', value: '' }])}>
        <PlusIcon className="h-3.5 w-3.5" />
        Add a header
      </Button>
    </div>
  );
}

function TestAnswer({ result, monitor }: { result: TestResult; monitor: Monitor }) {
  const detail = result.detail;
  const unclear = !result.ok && Boolean(result.inconclusive);
  return (
    <div
      className={cn('space-y-2 rounded-lg p-3', result.ok ? 'bg-[hsl(var(--uptime-up)/0.10)]' : unclear ? 'bg-muted' : 'bg-[hsl(var(--uptime-down)/0.10)]')}
      data-testid="uptime-test-result"
      data-ok={result.ok}
      data-unclear={unclear || undefined}
    >
      <p className={cn('flex items-center gap-1.5 text-sm font-semibold', result.ok ? 'text-[hsl(var(--uptime-up-text))]' : unclear ? 'text-foreground' : 'text-[hsl(var(--uptime-down-text))]')}>
        {result.ok ? <CheckCircle2Icon className="h-4 w-4" /> : unclear ? <CircleHelpIcon className="h-4 w-4" /> : <XCircleIcon className="h-4 w-4" />}
        {result.ok ? 'It works' : unclear ? "Couldn't tell" : 'This check would fail'}
      </p>
      {unclear && <p className="text-xs text-muted-foreground">A check like this counts as neither up nor down, so it never sends a down alert.</p>}
      <p className="break-all text-[11px] text-muted-foreground">{targetText(monitor)}</p>
      {!result.ok && result.msg && <p className="text-sm">{result.msg}</p>}
      <dl className="space-y-1 text-xs">
        {result.ms !== null && result.ms !== undefined && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Answered in</dt>
            <dd className="font-medium tabular-nums">{formatMs(result.ms)}</dd>
          </div>
        )}
        {result.code !== null && result.code !== undefined && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium tabular-nums">{result.code}</dd>
          </div>
        )}
        {detail.ip && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="truncate font-medium">{detail.ip}</dd>
          </div>
        )}
        {detail.finalUrl && (
          <div>
            <dt className="text-muted-foreground">Ended up at</dt>
            <dd className="break-all font-medium">{detail.finalUrl}</dd>
          </div>
        )}
        {detail.cert && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Certificate until</dt>
            <dd className="font-medium">{formatDate(detail.cert.expires)}</dd>
          </div>
        )}
        {detail.appName && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">App</dt>
            <dd className="truncate font-medium">{detail.appName}</dd>
          </div>
        )}
        {detail.offer && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Google Play offers</dt>
            <dd className="font-medium">{detail.offer === 'Install' ? 'Install' : detail.offer === 'Pre-register' ? 'Pre-registration' : detail.offer === 'Listed' ? 'The page only' : `Buy, ${detail.offer}`}</dd>
          </div>
        )}
        {detail.version && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-medium">{detail.version}</dd>
          </div>
        )}
        {detail.found !== undefined && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{monitor.jsonPath}</dt>
            <dd className="truncate font-mono font-medium">{detail.found}</dd>
          </div>
        )}
        {detail.answers && detail.answers.length > 0 && (
          <div>
            <dt className="text-muted-foreground">Records</dt>
            {detail.answers.slice(0, 6).map((answer) => (
              <dd key={answer} className="break-all font-mono">
                {answer}
              </dd>
            ))}
          </div>
        )}
      </dl>
      {detail.tech && !result.ok && <p className="break-words font-mono text-[10px] text-muted-foreground">{detail.tech}</p>}
    </div>
  );
}
