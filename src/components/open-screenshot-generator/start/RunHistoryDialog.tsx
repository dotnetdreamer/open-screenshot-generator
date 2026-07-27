"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  clearOperations,
  formatDuration,
  listOperations,
  MODE_LABEL,
  operationDurationMs,
  STATUS_LABEL,
  type Operation,
  type OperationStatus,
} from '@/lib/ai/operationLog';
import { OperationTimelineDialog } from './OperationTimelineDialog';

interface RunHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_DOT: Record<OperationStatus, string> = {
  running: 'bg-blue-500',
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  cancelled: 'bg-muted-foreground',
};

function whenLabel(t: number): string {
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function RunHistoryDialog({ open, onOpenChange }: RunHistoryDialogProps) {
  const [ops, setOps] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setOps(await listOperations());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const clearAll = useCallback(async () => {
    await clearOperations();
    await load();
  }, [load]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg gap-0 p-0">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Recent runs</DialogTitle>
            <DialogDescription>
              Every generate request is saved here with its full timeline and screenshots. Open one
              to inspect it or download an HTML report.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto px-2 py-2">
            {loading && ops.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading
              </div>
            ) : ops.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No runs yet. Generate something and it will show up here.
              </p>
            ) : (
              <ul className="space-y-1">
                {ops.map((op) => (
                  <li key={op.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(op.id)}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[op.status])} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{op.providerLabel}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {MODE_LABEL[op.mode]}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {op.instruction.trim() || 'No instruction'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        <span className="block">{whenLabel(op.startedAt)}</span>
                        <span className="block">
                          {STATUS_LABEL[op.status]} · {formatDuration(operationDurationMs(op))}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {ops.length > 0 && (
            <div className="flex justify-end border-t px-5 py-3">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void clearAll()}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear history
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <OperationTimelineDialog
        operationId={selected}
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </>
  );
}
