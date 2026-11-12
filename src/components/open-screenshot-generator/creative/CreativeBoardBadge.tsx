"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AlertTriangleIcon, CheckCircle2Icon, XCircleIcon } from 'lucide-react';
import type { ArtboardState } from '@/types/artboard';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { checkCreativeView } from '@/lib/creative/check';
import { canRebuildCreativeBoard } from '@/lib/creative/layouts';
import { onFontsSettled } from '@/lib/fontsSettled';
import { creativeSpec, isCreativeAssetKind } from '@/lib/creative/specs';
import { useEditorPreference } from '@/lib/editorPreferences';
import { localeName } from '@/lib/i18n/locales';

const BADGE_LABEL = { header: 'Header', search: 'Search', universal: 'Universal' } as const;

/**
 * What the chip can do to its artboard. The editor provides it around the
 * canvas. Anywhere else there is none, and the chip only reports.
 */
export const CreativeBoardActionsContext = createContext<{
  /** Lay the design out again, keeping its words, screens and type. */
  rebuild: (boardId: string) => void;
} | null>(null);

/**
 * Goes up each time the page finishes loading a font. The check measures text
 * in whatever face is loaded, so a check run before the project's font arrived
 * has to run again once it has.
 */
export function useFontsLoaded(): number {
  const [loaded, setLoaded] = useState(0);
  useEffect(() => onFontsSettled(() => setLoaded((count) => count + 1)), []);
  return loaded;
}

/**
 * The chip under an App Store header or search artboard: what it is, and what
 * the store check finds in it as the canvas shows it now.
 *
 * It checks the language on screen, so switching language re-checks it; the
 * store listing preview has the same list. Clicking opens the list itself.
 */
export function CreativeBoardBadge({
  board,
  locale,
}: {
  /** The artboard as the canvas draws it, already in the language on screen. */
  board: ArtboardState;
  locale: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [safeArea, setSafeArea] = useEditorPreference('creativeSafeArea');
  const fontsLoaded = useFontsLoaded();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const issues = useMemo(() => checkCreativeView(board, locale), [board, locale, fontsLoaded]);
  const actions = useContext(CreativeBoardActionsContext);
  const canRebuild = useMemo(() => !!actions && canRebuildCreativeBoard(board), [actions, board]);
  if (!isCreativeAssetKind(board.creativeAsset)) return null;
  const spec = creativeSpec(board.creativeAsset);
  const errors = issues.filter((issue) => issue.level === 'error').length;
  const warnings = issues.length - errors;
  const status = errors > 0 ? `${errors} to fix` : warnings > 0 ? `${warnings} to check` : 'Ready';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // The board under the label must not take this press as a drag or a
          // deselect.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          data-export-exclude
          className={cn(
            'ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
            errors > 0
              ? 'border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-400'
              : warnings > 0
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400'
          )}
          title={`App Store check for the ${spec.label.toLowerCase()}`}
        >
          {errors > 0 ? (
            <XCircleIcon className="h-3 w-3" />
          ) : warnings > 0 ? (
            <AlertTriangleIcon className="h-3 w-3" />
          ) : (
            <CheckCircle2Icon className="h-3 w-3" />
          )}
          <span>{BADGE_LABEL[spec.kind]}</span>
          <span className="opacity-70">{status}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">{spec.label}</p>
          <p className="text-xs text-muted-foreground">
            {spec.sizeLabel}, {spec.imageFormats.join(' or ')}
            {locale ? `. Checked in ${localeName(locale)}` : ''}
          </p>
        </div>
        <CreativeIssueList issues={issues} className="max-h-72 overflow-y-auto px-4 py-3" />
        {canRebuild && actions && (
          <div className="border-t px-4 py-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-full text-xs"
              onClick={() => {
                setOpen(false);
                actions.rebuild(board.id);
              }}
            >
              Rebuild design
            </Button>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              Sets your words and screens out again to fill an iPhone. Layers you added stay
            </p>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
          <Label htmlFor={`safe-area-${board.id}`} className="text-xs font-normal">
            Show the safe area
          </Label>
          <Switch id={`safe-area-${board.id}`} checked={safeArea} onCheckedChange={setSafeArea} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The rows of a check, or the all-clear. Shared with the store listing preview. */
export function CreativeIssueList({
  issues,
  className,
  tone = 'default',
}: {
  issues: ReturnType<typeof checkCreativeView>;
  className?: string;
  /** `inverse` for the dark preview overlay. */
  tone?: 'default' | 'inverse';
}) {
  const muted = tone === 'inverse' ? 'text-white/60' : 'text-muted-foreground';
  if (issues.length === 0) {
    return (
      <div className={cn('flex items-start gap-2', className)}>
        <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-medium">Ready for App Store Connect</p>
          <p className={cn('text-xs', muted)}>
            The right size, text inside the safe area, and none of the copy the store rules name. App Review has
            the last word.
          </p>
        </div>
      </div>
    );
  }
  return (
    <ul className={cn('space-y-2.5', className)}>
      {issues.map((issue) => (
        <li key={issue.key} className="flex items-start gap-2">
          {issue.level === 'error' ? (
            <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          ) : (
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium leading-snug">{issue.title}</p>
            {issue.detail && <p className={cn('break-words text-xs', muted)}>{issue.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
