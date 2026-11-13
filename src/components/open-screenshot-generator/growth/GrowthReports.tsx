"use client";

// Weekly, monthly and yearly reports. The figures are computed here and are
// always there; the summary paragraph is written by the AI on request and kept
// on this computer with the report (reportSummaries.ts), so it is written once
// per period rather than every time the tab opens.
//
// Save as PDF draws ReportSheet, a print layout in fixed light colours and
// system fonts, off screen and hands it to reportPdf.ts. The sheet goes into
// document.body through a portal: the dialog is transformed, and a fixed
// element inside a transformed one is placed relative to it, not the window.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, CopyIcon, FileDownIcon, FileTextIcon, Loader2Icon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatWindow, type DayWindow } from '@/lib/growth/dates';
import {
  buildReport,
  comparisonNote,
  earlierPeriod,
  latestCompletePeriod,
  periodTitle,
  reportFacts,
  reportMarkdown,
  reportPlainText,
  reviewsSentence,
  type PeriodReport,
  type ReportPeriod,
} from '@/lib/growth/report';
import { reportPdf } from '@/lib/growth/reportPdf';
import { useReportSummary, writeKeptReportSummary } from '@/lib/growth/reportSummaries';
import { saveBlobToDisk } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { EmptyState, Gated, Panel, SectionTitle, useGrowthView } from './GrowthShared';

const PERIODS: Array<{ id: ReportPeriod; label: string; column: string; noun: string }> = [
  { id: 'week', label: 'Weekly', column: 'This week', noun: 'week' },
  { id: 'month', label: 'Monthly', column: 'This month', noun: 'month' },
  { id: 'year', label: 'Yearly', column: 'This year', noun: 'year' },
];

export function GrowthReports() {
  const view = useGrowthView();
  const [period, setPeriod] = useState<ReportPeriod>('week');
  const periodSpec = PERIODS.find((entry) => entry.id === period) ?? PERIODS[0];
  const periods = useMemo(() => {
    const latest = latestCompletePeriod(view.data.records, period);
    if (!latest) return [] as DayWindow[];
    const first = view.data.records[0]?.date ?? latest.from;
    const out: DayWindow[] = [latest];
    while (out.length < 12) {
      const previous = earlierPeriod(out[out.length - 1], period);
      if (previous.to < first) break;
      out.push(previous);
    }
    return out;
  }, [view.data.records, period]);
  const [selected, setSelected] = useState<string>('');
  useEffect(() => setSelected(periods[0]?.from ?? ''), [periods]);
  const span = periods.find((entry) => entry.from === selected) ?? periods[0];

  const report = useMemo(
    () =>
      span
        ? buildReport({ appName: view.app.name, records: view.data.records, reviews: view.data.reviews, events: view.data.events, period, window: span })
        : null,
    [span, view.app.name, view.data.records, view.data.reviews, view.data.events, period]
  );
  // The year so far grows every day, so its summary is kept per end day.
  const summaryKey = report
    ? `report:summary:${view.app.id}:${period}:${report.window.from}${period === 'year' ? `:${report.window.to}` : ''}`
    : '';
  // Kept by the period it was written for, outside this screen: one that
  // arrives after the user moved to another period or section waits under its
  // own period, and never shows beside other figures.
  const kept = useReportSummary(summaryKey);
  const summary = kept.text;
  const busy = kept.writing;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState<PrintJob | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Save as PDF mounts the print layout, lets it lay out, draws it and takes
  // it away again. Once per click, from the report and summary on screen at
  // the click, whatever the user picks while it is being made.
  useEffect(() => {
    if (!printing) return;
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const sheet = sheetRef.current;
        if (!sheet || cancelled) return;
        const blob = await reportPdf(sheet, `${printing.report.appName}: ${printing.report.title}`);
        if (cancelled) return;
        await saveBlobToDisk(blob, `${printing.fileStem}.pdf`);
      } catch (failure) {
        console.error('Saving the report as PDF failed', failure);
        if (!cancelled) setError('The PDF could not be made. Save the report as Markdown instead');
      } finally {
        if (!cancelled) setPrinting(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [printing]);

  useEffect(() => setError(null), [summaryKey]);

  if (!report || !span) {
    return (
      <EmptyState icon={FileTextIcon} title="No complete period yet">
        A weekly report appears once the numbers cover a whole week, Monday to Sunday, a monthly one once they cover a whole
        month, and a yearly one with the first numbers of the year.
      </EmptyState>
    );
  }

  const fileStem = fileStemFor(view.app.name, periodSpec.noun, report);
  const note = comparisonNote(report);
  const savePdf = () => setPrinting({ report, summary, column: periodSpec.column, fileStem });

  const writeSummary = () => {
    setError(null);
    // A failure is kept with the period and shown from there.
    writeKeptReportSummary(summaryKey, reportFacts(report), view.app.name).catch((failure) =>
      console.error('The report summary failed', failure)
    );
  };

  const save = async (format: 'md' | 'txt') => {
    const text = format === 'md' ? reportMarkdown(report, summary) : reportPlainText(report, summary);
    const blob = new Blob([text], { type: format === 'md' ? 'text/markdown' : 'text/plain' });
    try {
      await saveBlobToDisk(blob, `${fileStem}.${format}`);
    } catch (failure) {
      console.error('Saving the report failed', failure);
      setError('The report could not be saved there. Try another folder');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportMarkdown(report, summary));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Copying is blocked here. Save the report as a file instead');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Report period">
          {PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPeriod(option.id)}
              className={cn('rounded px-3 py-1 text-xs', period === option.id ? 'bg-foreground text-background' : 'hover:bg-muted')}
              aria-pressed={period === option.id}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Select value={span.from} onValueChange={setSelected}>
          <SelectTrigger className="h-8 w-[220px] text-xs" aria-label="Which period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((entry) => (
              <SelectItem key={entry.from} value={entry.from} className="text-xs">
                {period === 'year' ? `${periodTitle(entry, period)}, ${formatWindow(entry)}` : formatWindow(entry)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <CheckIcon className="mr-1.5 h-4 w-4" /> : <CopyIcon className="mr-1.5 h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="outline" size="sm" disabled={printing !== null} onClick={savePdf}>
            {printing ? <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" /> : <FileDownIcon className="mr-1.5 h-4 w-4" />}
            Save as PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => void save('md')}>
            <FileDownIcon className="mr-1.5 h-4 w-4" />
            Save as Markdown
          </Button>
          <Button variant="outline" size="sm" onClick={() => void save('txt')}>
            <FileDownIcon className="mr-1.5 h-4 w-4" />
            Save as text
          </Button>
        </div>
      </div>

      <Panel className="space-y-4" data-testid="growth-report">
        <div>
          <h3 className="text-lg font-semibold">
            {view.app.name}: {report.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {formatWindow(report.window)}, compared with {formatWindow(report.previous)}
          </p>
        </div>

        <div className="rounded-md bg-muted/50 p-3">
          {summary ? (
            <p className="whitespace-pre-line text-sm">{summary}</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">A few sentences on what changed and what to do next, written from these figures.</p>
              <Gated reason={view.blocked.ai}>
                <Button size="sm" disabled={busy} onClick={writeSummary}>
                  {busy ? <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" /> : <SparklesIcon className="mr-1.5 h-4 w-4" />}
                  Write the summary
                </Button>
              </Gated>
            </div>
          )}
          {(error ?? kept.failure) && <p className="mt-2 text-xs text-destructive">{error ?? kept.failure}</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-transparent text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Metric</th>
                <th className="py-2 text-right font-medium">{periodSpec.column}</th>
                <th className="py-2 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((line) => (
                <tr key={line.label} className="border-b last:border-0">
                  <td className="py-2">{line.label}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{line.value}</td>
                  <td
                    className={cn(
                      'py-2 text-right text-xs tabular-nums',
                      line.good === true && 'text-[hsl(var(--growth-good))]',
                      line.good === false && 'text-[hsl(var(--growth-bad))]',
                      line.good === null && 'text-muted-foreground'
                    )}
                  >
                    {line.change ?? 'n/a'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {note && (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="growth-report-note">
              {note}
            </p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {report.territories.length > 0 && (
            <div>
              <SectionTitle title="Storefronts" />
              <ul className="space-y-1 text-xs">
                {report.territories.map((row) => (
                  <li key={row.name} className="flex justify-between gap-2">
                    <span>{row.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="font-medium text-foreground">{row.downloads}</span> · {row.share}
                      {row.change ? ` · ${row.change}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.sources.length > 0 && (
            <div>
              <SectionTitle title="How people found the app" />
              <ul className="space-y-1 text-xs">
                {report.sources.map((row) => (
                  <li key={row.name} className="flex justify-between gap-2">
                    <span>{row.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="font-medium text-foreground">{row.downloads}</span> downloads · {row.conversion}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <SectionTitle title="Reviews" />
            <p className="text-xs">{reviewsSentence(report)}</p>
            {report.reviews.topics.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Topics: {report.reviews.topics.join(', ')}</p>}
          </div>
          <div>
            <SectionTitle title="Timeline" />
            {report.events.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing recorded in this period.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {report.events.map((event) => (
                  <li key={`${event.date}${event.label}`}>
                    <span className="text-muted-foreground">{event.date}</span> {event.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {report.missingDays > 0 && (
          <p className="text-xs text-muted-foreground">
            {report.missingDays} day{report.missingDays === 1 ? '' : 's'} in this period have no numbers from App Store Connect yet.
          </p>
        )}
      </Panel>

      {printing &&
        createPortal(
          // Off screen, and the wrapper rather than the sheet is moved: the
          // capture copies the sheet's own styles, and a sheet placed off
          // screen would be drawn off screen too.
          <div aria-hidden style={{ position: 'fixed', left: -100_000, top: 0, pointerEvents: 'none' }}>
            <ReportSheet ref={sheetRef} report={printing.report} summary={printing.summary} column={printing.column} />
          </div>,
          document.body
        )}
    </div>
  );
}

/** What Save as PDF prints: the report as it was on screen at the click. */
interface PrintJob {
  report: PeriodReport;
  summary: string | null;
  column: string;
  fileStem: string;
}

function fileStemFor(appName: string, noun: string, report: PeriodReport): string {
  // "Ludo Wala: 3D & Action" loses its colon and ampersand, and the spaces
  // either side of the ampersand would otherwise stay doubled.
  return `${appName.replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'app'} ${noun} ${report.window.from}`;
}

// The print layout: fixed light colours, whatever the app's theme, and system
// fonts, which the capture draws without downloading anything. Every block a
// page may end before carries data-pdf-block.
const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';
const GOOD = '#007a00';
const BAD = '#d23f3f';
const SHEET_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", sans-serif';

const ReportSheet = React.forwardRef<HTMLDivElement, { report: PeriodReport; summary: string | null; column: string }>(
  function ReportSheet({ report, summary, column }, ref) {
    const note = comparisonNote(report);
    const heading = (text: string) => (
      <p data-pdf-block style={{ margin: '22px 0 8px', fontSize: 13, fontWeight: 600, color: INK }}>
        {text}
      </p>
    );
    const row = (key: string, cells: React.ReactNode[], widths: string, header = false) => (
      <div
        key={key}
        data-pdf-block
        style={{
          display: 'grid',
          gridTemplateColumns: widths,
          gap: 12,
          padding: '6px 0',
          borderBottom: `1px solid ${RULE}`,
          fontSize: header ? 11 : 12,
          color: header ? MUTED : INK,
          fontWeight: header ? 500 : 400,
        }}
      >
        {cells}
      </div>
    );
    return (
      <div
        ref={ref}
        style={{ width: 720, padding: 4, background: '#ffffff', color: INK, fontFamily: SHEET_FONT, lineHeight: 1.45 }}
      >
        <div data-pdf-block>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {report.appName}: {report.title}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: MUTED }}>
            {formatWindow(report.window)}, compared with {formatWindow(report.previous)}
          </p>
        </div>

        {summary && (
          <>
            {heading('Summary')}
            {summary
              .trim()
              .split(/\n{2,}/)
              .map((paragraph, index) => (
                <p key={index} data-pdf-block style={{ margin: '0 0 8px', fontSize: 12, whiteSpace: 'pre-line' }}>
                  {paragraph}
                </p>
              ))}
          </>
        )}

        {heading('Numbers')}
        {row('head', [<span key="m">Metric</span>, <span key="v" style={{ textAlign: 'right' }}>{column}</span>, <span key="c" style={{ textAlign: 'right' }}>Change</span>], '1fr 160px 90px', true)}
        {report.lines.map((line) =>
          row(line.label, [
            <span key="m">{line.label}</span>,
            <span key="v" style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{line.value}</span>,
            <span
              key="c"
              style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: line.good === true ? GOOD : line.good === false ? BAD : MUTED }}
            >
              {line.change ?? 'n/a'}
            </span>,
          ], '1fr 160px 90px')
        )}
        {note && (
          <p data-pdf-block style={{ margin: '8px 0 0', fontSize: 11, color: MUTED }}>
            {note}
          </p>
        )}

        {report.territories.length > 0 && (
          <>
            {heading('Storefronts')}
            {row('head', [<span key="n">Storefront</span>, <span key="d" style={{ textAlign: 'right' }}>Downloads</span>, <span key="s" style={{ textAlign: 'right' }}>Share</span>, <span key="c" style={{ textAlign: 'right' }}>Change</span>], '1fr 110px 70px 90px', true)}
            {report.territories.map((territory) =>
              row(territory.name, [
                <span key="n">{territory.name}</span>,
                <span key="d" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{territory.downloads}</span>,
                <span key="s" style={{ textAlign: 'right', color: MUTED }}>{territory.share}</span>,
                <span key="c" style={{ textAlign: 'right', color: MUTED }}>{territory.change ?? ''}</span>,
              ], '1fr 110px 70px 90px')
            )}
          </>
        )}

        {report.sources.length > 0 && (
          <>
            {heading('How people found the app')}
            {row('head', [<span key="n">Source</span>, <span key="i" style={{ textAlign: 'right' }}>Impressions</span>, <span key="d" style={{ textAlign: 'right' }}>Downloads</span>, <span key="c" style={{ textAlign: 'right' }}>Conversion</span>], '1fr 110px 100px 90px', true)}
            {report.sources.map((source) =>
              row(source.name, [
                <span key="n">{source.name}</span>,
                <span key="i" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{source.impressions}</span>,
                <span key="d" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{source.downloads}</span>,
                <span key="c" style={{ textAlign: 'right', color: MUTED }}>{source.conversion}</span>,
              ], '1fr 110px 100px 90px')
            )}
          </>
        )}

        {heading('Reviews')}
        <p data-pdf-block style={{ margin: 0, fontSize: 12 }}>
          {reviewsSentence(report)}
          {report.reviews.topics.length > 0 ? ` Topics: ${report.reviews.topics.join(', ')}.` : ''}
        </p>

        {report.events.length > 0 && (
          <>
            {heading('Timeline')}
            {report.events.map((event) => (
              <p key={`${event.date}${event.label}`} data-pdf-block style={{ margin: '0 0 4px', fontSize: 12 }}>
                <span style={{ color: MUTED }}>{event.date}</span> {event.label}
              </p>
            ))}
          </>
        )}

        {report.missingDays > 0 && (
          <p data-pdf-block style={{ margin: '18px 0 0', fontSize: 11, color: MUTED }}>
            {report.missingDays} day{report.missingDays === 1 ? '' : 's'} in this period have no numbers from App Store Connect yet.
          </p>
        )}
        <p data-pdf-block style={{ margin: '22px 0 0', fontSize: 10, color: MUTED }}>
          Made with Open Screenshot Generator
        </p>
      </div>
    );
  }
);
