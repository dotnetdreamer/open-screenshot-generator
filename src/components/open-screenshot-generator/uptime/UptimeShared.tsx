"use client";

// The pieces every Uptime screen uses: how a state looks (an icon, a word
// and a colour, never the colour alone), the icon for each kind of monitor,
// the stat tile and the panel, and the context the screens read the view
// through.

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  GlobeIcon,
  NetworkIcon,
  PauseCircleIcon,
  RadarIcon,
  RotateCwIcon,
  ServerIcon,
  ShoppingBagIcon,
  WifiOffIcon,
  XCircleIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { uptimeCommands } from '@/lib/uptime/engine';
import { STATE_LABELS } from '@/lib/uptime/format';
import { findSuggestions, targetKey, type Suggestion } from '@/lib/uptime/suggest';
import type { BeatStatus, Monitor, MonitorKind, MonitorState, Summary, UptimeView } from '@/lib/uptime/types';

export type UptimeSection = { name: 'overview' } | { name: 'monitor'; id: string } | { name: 'add'; seed?: Monitor } | { name: 'edit'; id: string } | { name: 'alerts' };

export interface UptimeContextValue {
  view: UptimeView;
  desktop: boolean;
  active: boolean;
  now: number;
  go: (section: UptimeSection) => void;
  monitorOf: (id: string) => Monitor | undefined;
  summaryOf: (id: string) => Summary | undefined;
}

const UptimeContext = React.createContext<UptimeContextValue | null>(null);
export const UptimeProvider = UptimeContext.Provider;

const HIDDEN_KEY = 'osg-uptime-hidden-suggestions';

function readHidden(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]');
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The monitors worth adding that aren't watched yet (suggest.ts), less the
 * ones the user hid. Read again whenever the list of monitors changes, so
 * watching one leaves the rest on offer.
 */
export function useSuggestions(monitors: Monitor[]) {
  const [found, setFound] = useState<Suggestion[] | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const watched = monitors.map(targetKey).join('|');
  useEffect(() => setHidden(readHidden()), []);
  useEffect(() => {
    let current = true;
    void findSuggestions(monitors).then((next) => current && setFound(next));
    return () => {
      current = false;
    };
    // The keys say everything about the monitors that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched]);
  const hide = useCallback((key: string) => {
    setHidden((current) => {
      const next = Array.from(new Set([...current, key]));
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch (error) {
        console.error('The hidden suggestions could not be saved', error);
      }
      return next;
    });
  }, []);
  return { suggestions: found ? found.filter((suggestion) => !hidden.includes(suggestion.key)) : null, hide };
}

/** Saves a suggestion as a monitor and opens it. */
export function useWatch() {
  const { go } = useUptimeView();
  const { toast } = useToast();
  const [adding, setAdding] = useState<string | null>(null);
  const watch = useCallback(
    async (suggestion: Suggestion) => {
      setAdding(suggestion.key);
      try {
        const saved = await uptimeCommands.save(suggestion.monitor);
        track('uptime_suggestion', { kind: saved.kind });
        toast({ title: `Watching ${saved.name}`, description: 'The first check runs now.' });
        go({ name: 'monitor', id: saved.id });
      } catch (failure) {
        toast({ title: 'That monitor wasn\'t added', description: failure instanceof Error ? failure.message : String(failure), variant: 'destructive' });
      } finally {
        setAdding(null);
      }
    },
    [go, toast]
  );
  return { watch, adding };
}

export function useUptimeView(): UptimeContextValue {
  const value = React.useContext(UptimeContext);
  if (!value) throw new Error('useUptimeView outside the Uptime view');
  return value;
}

/** The colour of a state, as a CSS colour. */
export function stateColor(state: MonitorState | BeatStatus): string {
  switch (state) {
    case 'up':
      return 'hsl(var(--uptime-up))';
    case 'down':
      return 'hsl(var(--uptime-down))';
    case 'pending':
      return 'hsl(var(--uptime-pending))';
    case 'offline':
      return 'hsl(var(--uptime-offline))';
    default:
      return 'hsl(var(--uptime-offline))';
  }
}

/** The text colour for a state's word, readable on the card and on the state's own tint. */
export function stateText(state: MonitorState): string {
  switch (state) {
    case 'up':
      return 'text-[hsl(var(--uptime-up-text))]';
    case 'down':
      return 'text-[hsl(var(--uptime-down-text))]';
    case 'pending':
      return 'text-[hsl(var(--uptime-pending-text))]';
    default:
      return 'text-muted-foreground';
  }
}

export function stateTint(state: MonitorState): string {
  switch (state) {
    case 'up':
      return 'bg-[hsl(var(--uptime-up)/0.12)]';
    case 'down':
      return 'bg-[hsl(var(--uptime-down)/0.12)]';
    case 'pending':
      return 'bg-[hsl(var(--uptime-pending)/0.16)]';
    default:
      return 'bg-muted';
  }
}

export function StateIcon({ state, className }: { state: MonitorState | 'offline'; className?: string }) {
  const Icon =
    state === 'up' ? CheckCircle2Icon : state === 'down' ? XCircleIcon : state === 'pending' ? RotateCwIcon : state === 'paused' ? PauseCircleIcon : state === 'offline' ? WifiOffIcon : CircleDashedIcon;
  return <Icon aria-hidden className={cn('shrink-0', className)} />;
}

/** The state as a small pill: its icon and its word, on its tint. */
export function StateChip({ state, className, label }: { state: MonitorState; className?: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', stateTint(state), stateText(state), className)} data-state={state}>
      <StateIcon state={state} className="h-3 w-3" />
      {label ?? STATE_LABELS[state]}
    </span>
  );
}

/**
 * A dot for a list row. A monitor that is down gets a ring that keeps
 * pulsing, the one moving thing on the screen, unless the user asked for
 * less motion.
 */
export function StatusDot({ state, className }: { state: MonitorState; className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex h-2.5 w-2.5 shrink-0', className)}>
      {state === 'down' && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping" style={{ background: stateColor('down') }} />}
      <span
        className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', (state === 'paused' || state === 'unknown') && 'border-2 bg-transparent')}
        style={state === 'paused' || state === 'unknown' ? { borderColor: stateColor(state) } : { background: stateColor(state) }}
      />
    </span>
  );
}

export const KIND_ICONS: Record<MonitorKind, React.ComponentType<{ className?: string }>> = {
  http: GlobeIcon,
  port: ServerIcon,
  ping: RadarIcon,
  dns: NetworkIcon,
  store: ShoppingBagIcon,
};

export function KindIcon({ kind, className }: { kind: MonitorKind; className?: string }) {
  const Icon = KIND_ICONS[kind];
  return <Icon className={cn('shrink-0', className)} />;
}

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]', className)} {...rest}>
      {children}
    </div>
  );
}

export function PanelTitle({ title, hint, actions }: { title: string; hint?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A stat tile: a label, a value, and a line under it. */
export function Tile({ label, value, hint, icon, tone, testId }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: MonitorState; testId?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-4 py-3" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn('mt-1 truncate text-2xl font-semibold leading-tight', tone && stateText(tone))}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** One label and value in a details list. */
export function Fact({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-sm', mono && 'font-mono text-xs')}>{children}</dd>
    </div>
  );
}
