"use client";

// Everything that happened to the app, on the chart and in a list, each with
// what the numbers did around it. Releases arrive on their own, screenshot
// uploads are written by the publish dialog, and anything else (a campaign, a
// price change, a feature placement) can be added here so it shows up in the
// comparisons and the AI's explanations.

import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarPlusIcon,
  FolderOpenIcon,
  ImagesIcon,
  MegaphoneIcon,
  PackageIcon,
  PencilLineIcon,
  StarIcon,
  StickyNoteIcon,
  TagIcon,
  Trash2Icon,
  TypeIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDay, isDay, today } from '@/lib/growth/dates';
import { deleteEvent } from '@/lib/growth/db';
import { addManualEvent } from '@/lib/growth/events';
import { eventImpact } from '@/lib/growth/impact';
import { METRICS, dailySeries, primaryCurrency, totalsFor, type MetricId } from '@/lib/growth/metrics';
import { EVENT_KIND_LABELS, type TimelineEvent, type TimelineEventKind } from '@/lib/growth/types';
import { cn } from '@/lib/utils';
import { TrendChart } from './GrowthCharts';
import { impactLine } from './GrowthOverview';
import { Delta, EmptyState, Panel, SectionTitle, useGrowthView } from './GrowthShared';

const KIND_ICON: Record<TimelineEventKind, React.ComponentType<{ className?: string }>> = {
  release: PackageIcon,
  screenshots: ImagesIcon,
  listing: TypeIcon,
  price: TagIcon,
  campaign: MegaphoneIcon,
  featured: StarIcon,
  'in-app-event': CalendarPlusIcon,
  note: StickyNoteIcon,
};

const ORIGIN_LABEL: Record<TimelineEvent['origin'], string> = {
  auto: 'From the App Store',
  publish: 'From the editor',
  listing: 'From this window',
  manual: 'Added by you',
};

const ADDABLE: TimelineEventKind[] = ['campaign', 'price', 'featured', 'in-app-event', 'release', 'note'];

export function GrowthTimeline() {
  const view = useGrowthView();
  const [metric, setMetric] = useState<MetricId>(view.data.records.some((record) => record.feeds.engagement) ? 'conversion' : 'downloads');
  const events = useMemo(() => [...view.data.events].sort((a, b) => b.date.localeCompare(a.date)), [view.data.events]);
  const range = useMemo(() => {
    const first = view.data.records[0]?.date;
    return { from: first && first < view.window.from ? first : view.window.from, to: view.window.to };
  }, [view.data.records, view.window]);
  const currency = primaryCurrency(totalsFor(view.byDate, range).proceeds);
  const points = useMemo(() => dailySeries(view.byDate, range, metric, {}, currency), [view.byDate, range, metric, currency]);

  useEffect(() => {
    if (!view.tabOptions.eventId) return;
    document.querySelector(`[data-event-id="${CSS.escape(view.tabOptions.eventId)}"]`)?.scrollIntoView({ block: 'center' });
  }, [view.tabOptions.eventId]);

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle
          title="Everything that happened"
          hint="Orange marks new screenshots. Hover a day to see what happened on it."
          actions={
            <Select value={metric} onValueChange={(value) => setMetric(value as MetricId)}>
              <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Metric on the chart">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METRICS) as MetricId[]).map((id) => (
                  <SelectItem key={id} value={id} className="text-xs">
                    {METRICS[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {view.data.records.length > 0 ? (
          <TrendChart points={points} metric={METRICS[metric]} currency={currency} events={view.data.events} showPrevious={false} highlightEventId={view.tabOptions.eventId} />
        ) : (
          <p className="text-xs text-muted-foreground">The chart fills in once the app has numbers.</p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {events.length === 0 ? (
            <EmptyState icon={CalendarPlusIcon} title="Nothing on the timeline yet">
              Releases are added on their own after a sync, and screenshot uploads from the editor are recorded here.
            </EmptyState>
          ) : (
            events.map((event) => <EventRow key={event.id} event={event} />)
          )}
        </div>
        <AddEventForm />
      </div>
    </div>
  );
}

function EventRow({ event }: { event: TimelineEvent }) {
  const view = useGrowthView();
  const Icon = KIND_ICON[event.kind];
  const impact = useMemo(
    () => (view.latest && view.data.records.length > 0 ? eventImpact(view.byDate, event, { latest: view.latest, events: view.data.events }) : null),
    [view.latest, view.byDate, event, view.data.events, view.data.records.length]
  );
  const highlighted = view.tabOptions.eventId === event.id;
  return (
    <Panel data-event-id={event.id} className={cn('flex gap-3', highlighted && 'ring-2 ring-[hsl(var(--growth-highlight))]')}>
      <div
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          event.kind === 'screenshots' ? 'bg-[hsl(var(--growth-highlight))]/15 text-[hsl(var(--growth-highlight))]' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{event.title}</p>
          <p className="text-xs text-muted-foreground">{formatDay(event.date, { withYear: true })}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {EVENT_KIND_LABELS[event.kind]} · {ORIGIN_LABEL[event.origin]}
          {event.version && event.kind !== 'release' ? ` · version ${event.version}` : ''}
        </p>
        {event.detail && <p className="mt-1 text-xs">{event.detail}</p>}
        {impact && event.kind !== 'note' && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{impactLine(impact)}</span>
            {(impact.verdict === 'better' || impact.verdict === 'worse') && <Delta change={impact.change} />}
            {impact.verdict === 'too-early' && impact.liveDate && (
              <span className="text-muted-foreground">Still measuring, {impact.daysToWait} more day{impact.daysToWait === 1 ? '' : 's'}</span>
            )}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {event.projectId && view.onOpenProject && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => view.onOpenProject?.(event.projectId!)}>
              <FolderOpenIcon className="mr-1.5 h-3.5 w-3.5" />
              Open {event.projectName ? `"${event.projectName}"` : 'the project'}
            </Button>
          )}
          {/* The sample's own events are generated, so only what a person added can go. */}
          {event.origin === 'manual' && !event.id.startsWith('sample-') && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void deleteEvent(event)}>
              <Trash2Icon className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function AddEventForm() {
  const view = useGrowthView();
  const [kind, setKind] = useState<TimelineEventKind>('campaign');
  const [date, setDate] = useState(today());
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) {
      setError('Give the event a name');
      return;
    }
    if (!isDay(date)) {
      setError('Pick a date');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addManualEvent({ appId: view.app.id, date, kind, title, detail });
      setTitle('');
      setDetail('');
    } catch (failure) {
      console.error('Adding a timeline event failed', failure);
      setError('The event could not be saved on this computer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel className="h-fit space-y-3">
      <SectionTitle title="Add an event" hint="Campaigns, price changes and features explain jumps in the numbers, and the AI uses them too." />
      <Select value={kind} onValueChange={(value) => setKind(value as TimelineEventKind)}>
        <SelectTrigger className="h-9 text-xs" aria-label="Kind of event">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ADDABLE.map((option) => (
            <SelectItem key={option} value={option} className="text-xs">
              {EVENT_KIND_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} className="h-9 text-sm" aria-label="Date" />
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What happened" className="h-9 text-sm" aria-label="What happened" />
      <Input value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Details, if any" className="h-9 text-sm" aria-label="Details" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button size="sm" className="w-full" onClick={() => void save()} disabled={saving}>
        <PencilLineIcon className="mr-1.5 h-4 w-4" />
        Add to the timeline
      </Button>
    </Panel>
  );
}
