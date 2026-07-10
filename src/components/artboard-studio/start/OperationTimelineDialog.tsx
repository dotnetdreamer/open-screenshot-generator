"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Download,
  Info,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { saveBlobToDisk, sanitizeFileName } from '@/lib/desktop';
import {
  formatDuration,
  getOperation,
  MODE_LABEL,
  operationDurationMs,
  STATUS_LABEL,
  type Operation,
  type OperationStatus,
  type TimelineEntry,
} from '@/lib/ai/operationLog';
import { renderOperationReportHtml } from '@/lib/ai/operationReport';

interface OperationTimelineDialogProps {
  operationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_BADGE: Record<OperationStatus, string> = {
  running: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  error: 'bg-red-500/15 text-red-600 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
};

function relTime(t: number, startedAt: number): string {
  return `+${((t - startedAt) / 1000).toFixed(2)}s`;
}

/** Load the operation from IndexedDB whenever the dialog opens for a new id. */
function useOperation(operationId: string | null, open: boolean) {
  const [op, setOp] = useState<Operation | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!operationId) return;
    setLoading(true);
    const found = await getOperation(operationId);
    setOp(found ?? null);
    setLoading(false);
  }, [operationId]);

  useEffect(() => {
    // Drop any previous run's data first: this dialog instance is reused for
    // different operations (from the error icon and from Recent runs), and
    // without this the prior run's timeline and download would flash under the
    // header while the new id loads.
    setOp(null);
    if (!open || !operationId) return;
    void load();
    // Screenshots are captured fire-and-forget and can persist a moment after
    // the run ends; reload once shortly after so late ones show up.
    const timer = setTimeout(() => void load(), 1600);
    return () => clearTimeout(timer);
  }, [open, operationId, load]);

  return { op, loading, reload: load };
}

export function OperationTimelineDialog({
  operationId,
  open,
  onOpenChange,
}: OperationTimelineDialogProps) {
  const { op, loading, reload } = useOperation(operationId, open);
  const [zoom, setZoom] = useState<string | null>(null);

  const download = useCallback(async () => {
    if (!op) return;
    const html = renderOperationReportHtml(op);
    const blob = new Blob([html], { type: 'text/html' });
    const stamp = new Date(op.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await saveBlobToDisk(blob, sanitizeFileName(`operation-${op.provider}-${op.status}-${stamp}.html`));
  }, [op]);

  const entries = op ? [...op.entries].sort((a, b) => a.t - b.t) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            Run timeline
          </DialogTitle>
          <DialogDescription>
            {op
              ? 'Everything that happened between the app and the provider for this request.'
              : 'Loading this run.'}
          </DialogDescription>
        </DialogHeader>

        {op && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-3 text-sm">
            <span className="font-semibold">{op.providerLabel}</span>
            <Badge className={cn('border-transparent', STATUS_BADGE[op.status])}>
              {STATUS_LABEL[op.status]}
            </Badge>
            <span className="text-muted-foreground">{MODE_LABEL[op.mode]}</span>
            {op.model && <span className="text-muted-foreground">{op.model}</span>}
            <span className="text-muted-foreground">
              {formatDuration(operationDurationMs(op))}
            </span>
            <span className="text-muted-foreground">{entries.length} events</span>
          </div>
        )}

        {op?.status === 'error' && op.errorMessage && (
          <div className="mx-5 mt-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
            {op.errorCode && <code className="mr-2 font-mono text-xs">{op.errorCode}</code>}
            {op.errorMessage}
          </div>
        )}

        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          {loading && !op ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading
            </div>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No events were recorded for this run.
            </p>
          ) : (
            <ol className="space-y-2.5">
              {entries.map((entry, i) => (
                <TimelineRow
                  key={i}
                  entry={entry}
                  startedAt={op?.startedAt ?? entry.t}
                  onZoom={setZoom}
                />
              ))}
            </ol>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t px-5 py-3 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => void download()} disabled={!op}>
            <Download className="mr-2 h-4 w-4" />
            Download HTML report
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Portaled to the body so it escapes the start dialog's transformed,
          z-50 stacking context (a CSS transform becomes the containing block
          for position:fixed); inline, the lightbox rendered behind and mis-sized. */}
      {zoom &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6"
            onClick={() => setZoom(null)}
            role="presentation"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={zoom}
              alt="Screenshot"
              className="max-h-full max-w-full rounded-md shadow-2xl"
            />
          </div>,
          document.body
        )}
    </Dialog>
  );
}

const KIND_META: Record<
  TimelineEntry['kind'],
  { color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  stage: { color: 'border-l-emerald-500', icon: Activity },
  message: { color: 'border-l-blue-500', icon: ArrowRight },
  screenshot: { color: 'border-l-violet-500', icon: Camera },
  note: { color: 'border-l-muted-foreground/40', icon: Info },
  error: { color: 'border-l-red-500', icon: AlertTriangle },
};

function TimelineRow({
  entry,
  startedAt,
  onZoom,
}: {
  entry: TimelineEntry;
  startedAt: number;
  onZoom: (src: string) => void;
}) {
  const meta = KIND_META[entry.kind];
  const Icon =
    entry.kind === 'message' && entry.direction === 'provider-to-app' ? ArrowLeft : meta.icon;

  return (
    <li className={cn('rounded-md border border-l-2 bg-card px-3 py-2', meta.color)}>
      <div className="flex items-center gap-2 text-sm">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">{relTime(entry.t, startedAt)}</span>
        <span className="font-medium">{entry.label}</span>
        {entry.code && (
          <code className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-500">
            {entry.code}
          </code>
        )}
      </div>

      {entry.kind === 'screenshot' && entry.image && (
        <button
          type="button"
          onClick={() => onZoom(entry.image!)}
          className="mt-2 block w-full overflow-hidden rounded border transition hover:opacity-90"
          title="Click to enlarge"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={entry.image} alt={entry.label} className="max-h-56 w-full object-contain bg-muted/30" />
        </button>
      )}

      {entry.detail && (
        <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
          {entry.detail}
        </pre>
      )}
    </li>
  );
}
