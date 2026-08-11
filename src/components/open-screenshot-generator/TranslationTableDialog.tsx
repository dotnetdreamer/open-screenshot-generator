"use client";

// Bulk string entry for the locale overlay.
//
// Six screens times three text layers times eight languages is roughly 400
// strings, and typing them one at a time through the Properties panel is not a
// path anybody finishes. This is the only place that scales, and it is also the
// only place that works with no translation service configured at all: export
// the CSV, hand it to a translator, import what comes back.
//
// Everything the user does here accumulates in dialog-local state and lands as
// ONE commit on Save, so an evening of translating is one undo entry rather
// than two hundred. Cancel discards, which is why the machine-translate result
// is adopted into the same local state instead of being committed on its own.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { saveBlobToDisk } from '@/lib/desktop';
import type { ArtboardState, TextElementProps } from '@/types/artboard';
import {
  getBaseLocale,
  getProjectLocales,
  localizableTextElements,
  overrideStateFor,
} from '@/lib/i18n/localization';
import { getLocaleDef, localeLabel, localeName } from '@/lib/i18n/locales';
import {
  applyLocaleTextWrites,
  planCsvImport,
  toCsv,
  type CsvImportChange,
  type LocaleTextWrite,
} from '@/lib/i18n/translationCsv';

export interface TranslationTableDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The BASE document. Snapshotted on open, never re-read while editing. */
  artboards: ArtboardState[];
  translationAvailable: boolean;
  initialLocale?: string | null;
  initialFilter?: 'all' | 'untranslated';
  /** ONE commit for the whole session: the next base document, and how many strings moved. */
  onSave: (nextArtboards: ArtboardState[], editedCount: number) => void;
  onMachineTranslate: (locale: string, only: 'empty' | 'stale') => Promise<ArtboardState[] | null>;
}

type RowFilter = 'all' | 'untranslated' | 'stale';

const FILTERS: Array<{ id: RowFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'untranslated', label: 'Untranslated' },
  { id: 'stale', label: 'Needs review' },
];

/** How much of the base string stands in for a layer with no name. */
const LABEL_LIMIT = 40;

function layerLabel(el: TextElementProps): string {
  const name = el.name?.trim();
  if (name) return name;
  const text = el.content.replace(/\s+/g, ' ').trim();
  return text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text;
}

/** Board ids, element ids and locale codes never contain a NUL. */
function cellKey(artboardId: string, elementId: string, locale: string): string {
  return `${artboardId}\u0000${elementId}\u0000${locale}`;
}

interface BoardGroup {
  board: ArtboardState;
  index: number;
  elements: TextElementProps[];
}

/**
 * Auto-growing cell. An invisible mirror in the same grid cell carries the same
 * text at the same metrics, so the row is as tall as the content needs without
 * a ref, a resize observer, or a measurement pass. The mirror follows the
 * PLACEHOLDER when the cell is empty, or a long base string would be clipped to
 * one line in exactly the rows that most need reading.
 */
function GrowingCell({
  value,
  placeholder,
  onChange,
  className,
  title,
}: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  className?: string;
  title?: string;
}) {
  return (
    <div className="grid">
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words border border-transparent px-2 py-1.5 text-sm leading-snug"
      >
        {`${value || placeholder}\n`}
      </span>
      <textarea
        value={value}
        placeholder={placeholder}
        title={title}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'col-start-1 row-start-1 w-full resize-none overflow-hidden rounded-md border border-input bg-background px-2 py-1.5 text-sm leading-snug',
          'ring-offset-background placeholder:italic placeholder:text-muted-foreground/70',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          className
        )}
      />
    </div>
  );
}

export function TranslationTableDialog({
  open,
  onOpenChange,
  artboards,
  translationAvailable,
  initialLocale,
  initialFilter,
  onSave,
  onMachineTranslate,
}: TranslationTableDialogProps) {
  const { toast } = useToast();

  // The document this session started from. Replaced only by a machine
  // translate run, never by the prop: re-reading `artboards` mid-session would
  // throw away everything typed so far.
  const [source, setSource] = useState<ArtboardState[]>(artboards);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<RowFilter>('all');
  const [localeFilter, setLocaleFilter] = useState<string>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<'empty' | 'stale' | null>(null);
  const [review, setReview] = useState<
    { changes: CsvImportChange[]; unmatched: number; picked: boolean[] } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-seed on open only. `artboards`, `initialLocale` and `initialFilter` are
  // deliberately not dependencies: they change while the dialog is open (the
  // parent keeps editing) and reacting to them would reset the session.
  useEffect(() => {
    if (!open) return;
    setSource(artboards);
    setEdits({});
    setCollapsed({});
    setReview(null);
    setFilter(initialFilter || 'all');
    setLocaleFilter(initialLocale || 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const baseLocale = useMemo(() => getBaseLocale(source), [source]);
  const baseLanguageName = getLocaleDef(baseLocale)?.name || baseLocale;
  const allLocales = useMemo(
    () => getProjectLocales(source).map((entry) => entry.code),
    [source]
  );
  const localeColumns = useMemo(
    () => (localeFilter === 'all' ? allLocales : allLocales.filter((code) => code === localeFilter)),
    [allLocales, localeFilter]
  );

  const groups = useMemo<BoardGroup[]>(
    () =>
      source.map((board, index) => ({
        board,
        index,
        elements: localizableTextElements(board),
      })),
    [source]
  );

  const boardById = useMemo(() => new Map(source.map((board) => [board.id, board])), [source]);

  const storedValue = useCallback(
    (artboardId: string, elementId: string, locale: string) =>
      boardById.get(artboardId)?.localized?.[locale]?.[elementId]?.content ?? '',
    [boardById]
  );

  const valueOf = useCallback(
    (artboardId: string, elementId: string, locale: string) => {
      const edited = edits[cellKey(artboardId, elementId, locale)];
      return edited !== undefined ? edited : storedValue(artboardId, elementId, locale);
    },
    [edits, storedValue]
  );

  const stateOf = useCallback(
    (board: ArtboardState, el: TextElementProps, locale: string) => {
      const edited = edits[cellKey(board.id, el.id, locale)];
      // A cell somebody just typed in is manual by definition, and cannot be
      // stale: it was written against the base string as it reads right now.
      if (edited !== undefined) return edited ? 'manual' : 'inherited';
      return overrideStateFor(el, board.localized?.[locale]?.[el.id]);
    },
    [edits]
  );

  /** Drops writes that match what is already stored, so the count stays honest. */
  const mergeEdits = useCallback(
    (writes: LocaleTextWrite[]) => {
      setEdits((prev) => {
        const next = { ...prev };
        for (const write of writes) {
          const key = cellKey(write.artboardId, write.elementId, write.locale);
          if (write.value === storedValue(write.artboardId, write.elementId, write.locale)) {
            delete next[key];
          } else {
            next[key] = write.value;
          }
        }
        return next;
      });
    },
    [storedValue]
  );

  const editedCount = Object.keys(edits).length;

  const buildDraft = useCallback(() => {
    const writes: LocaleTextWrite[] = Object.entries(edits).map(([key, value]) => {
      const [artboardId, elementId, locale] = key.split('\u0000');
      return { artboardId, elementId, locale, value };
    });
    return { artboards: applyLocaleTextWrites(source, writes), writes };
  }, [edits, source]);

  // Header counts, including everything typed but not yet saved.
  const completion = useMemo(() => {
    const result: Record<string, { translated: number; total: number }> = {};
    for (const locale of allLocales) {
      let translated = 0;
      let total = 0;
      for (const group of groups) {
        for (const el of group.elements) {
          total++;
          if (valueOf(group.board.id, el.id, locale).trim()) translated++;
        }
      }
      result[locale] = { translated, total };
    }
    return result;
  }, [allLocales, groups, valueOf]);

  // Deliberately reads the SNAPSHOT, not the pending edits: filtering on what
  // the user is typing would make a row vanish from under the cursor on the
  // first keystroke of an "Untranslated" pass, which is exactly the pass where
  // somebody is working down the list one row at a time.
  const matchesFilter = useCallback(
    (board: ArtboardState, el: TextElementProps) => {
      if (filter === 'all') return true;
      return localeColumns.some((locale) => {
        const override = board.localized?.[locale]?.[el.id];
        if (filter === 'untranslated') return !override?.content;
        const state = overrideStateFor(el, override);
        return state === 'stale-auto' || state === 'stale-manual';
      });
    },
    [filter, localeColumns]
  );

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          elements: group.elements.filter((el) => matchesFilter(group.board, el)),
        }))
        .filter((group) => group.elements.length > 0),
    [groups, matchesFilter]
  );

  // --- actions ---------------------------------------------------------------

  const machineLocale =
    localeFilter !== 'all'
      ? localeFilter
      : allLocales.length === 1
        ? allLocales[0]
        : undefined;

  const machineHint = !translationAvailable
    ? 'Set up translation to fill these in automatically'
    : !machineLocale
      ? 'Choose one language above to translate'
      : undefined;

  const handleMachineTranslate = async (only: 'empty' | 'stale') => {
    if (!machineLocale || busy) return;
    setBusy(only);
    try {
      const next = await onMachineTranslate(machineLocale, only);
      if (!next) return;
      setSource(next);
      // Anything typed by hand stays, and wins: it is re-applied over the
      // machine's output when this session saves. Writes that the machine
      // happened to land on exactly are dropped so the count stays honest.
      setEdits((prev) => {
        const kept: Record<string, string> = {};
        const boards = new Map(next.map((board) => [board.id, board]));
        for (const [key, value] of Object.entries(prev)) {
          const [artboardId, elementId, locale] = key.split('\u0000');
          const stored = boards.get(artboardId)?.localized?.[locale]?.[elementId]?.content ?? '';
          if (value !== stored) kept[key] = value;
        }
        return kept;
      });
    } catch (error) {
      console.error('Machine translation failed', error);
      toast({
        title: 'Translation failed',
        description: error instanceof Error ? error.message : 'Nothing was changed',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleExportCsv = async () => {
    try {
      const csv = toCsv(buildDraft().artboards, allLocales);
      // The BOM is what makes Excel read the file as UTF-8 instead of mangling
      // every accent. planCsvImport strips it again on the way back in.
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      await saveBlobToDisk(blob, 'translations.csv');
    } catch (error) {
      console.error('CSV export failed', error);
      toast({ title: 'Could not save the CSV', variant: 'destructive' });
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const plan = planCsvImport(buildDraft().artboards, text);
      setReview({ ...plan, picked: plan.changes.map(() => true) });
    } catch (error) {
      console.error('CSV import failed', error);
      toast({ title: 'Could not read the CSV', variant: 'destructive' });
    }
  };

  const handleApplyReview = () => {
    if (!review) return;
    const picked = review.changes.filter((_, index) => review.picked[index]);
    mergeEdits(
      picked.map((change) => ({
        artboardId: change.artboardId,
        elementId: change.elementId,
        locale: change.locale,
        value: change.to,
      }))
    );
    setReview(null);
    toast({
      title: `${picked.length} ${picked.length === 1 ? 'string' : 'strings'} brought in`,
      description: 'Check them in the table, then save',
    });
  };

  const handleSave = () => {
    const { artboards: next, writes } = buildDraft();
    onSave(next, writes.length);
    onOpenChange(false);
  };

  // --- render ----------------------------------------------------------------

  const columnCount = 2 + localeColumns.length;
  const pickedCount = review ? review.picked.filter(Boolean).length : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-[1400px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-14">
          <DialogTitle>Translations</DialogTitle>
          <DialogDescription>
            One row per text layer, one column per language. The {baseLanguageName} column is
            read only, edit those strings on the canvas.
          </DialogDescription>
        </DialogHeader>

        {allLocales.length === 0 ? (
          <div className="flex min-h-[200px] flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            This project has no other languages yet. Add one first, then come back here to fill
            in the strings.
          </div>
        ) : review ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-muted/40 px-6 py-3">
              <p className="text-sm">
                <span className="font-medium">{review.changes.length}</span>{' '}
                {review.changes.length === 1 ? 'string differs' : 'strings differ'} from what you
                have
                {review.unmatched > 0 && (
                  <span className="text-muted-foreground">
                    , {review.unmatched}{' '}
                    {review.unmatched === 1 ? 'row matched' : 'rows matched'} nothing in this
                    project
                  </span>
                )}
              </p>
              {review.changes.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() =>
                    setReview((prev) =>
                      prev
                        ? {
                            ...prev,
                            picked: prev.picked.map(() => !prev.picked.every(Boolean)),
                          }
                        : prev
                    )
                  }
                >
                  {review.picked.every(Boolean) ? 'Clear all' : 'Select all'}
                </Button>
              )}
            </div>

            <div className="show-scrollbar min-h-0 flex-1 overflow-auto px-6 py-4">
              {review.changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing in that file differs from what this project already has
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {review.changes.map((change, index) => (
                    <li
                      key={`${change.artboardId}-${change.elementId}-${change.locale}`}
                      className="flex items-start gap-3 p-3"
                    >
                      <Checkbox
                        id={`csv-row-${index}`}
                        className="mt-1 shrink-0"
                        checked={review.picked[index]}
                        onCheckedChange={(checked) =>
                          setReview((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  picked: prev.picked.map((value, i) =>
                                    i === index ? !!checked : value
                                  ),
                                }
                              : prev
                          )
                        }
                      />
                      <label htmlFor={`csv-row-${index}`} className="min-w-0 flex-1 cursor-pointer">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{change.label}</span>
                          <span>{localeLabel(change.locale)}</span>
                          {change.matchedBy === 'text' && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
                              matched by text, not by id
                            </span>
                          )}
                        </div>
                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground line-through">
                            {change.from || 'nothing yet'}
                          </p>
                          <p className="whitespace-pre-wrap break-words text-sm">{change.to}</p>
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/40 px-6 py-3">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                title={machineHint}
                disabled={!translationAvailable || !machineLocale || busy !== null}
                onClick={() => handleMachineTranslate('empty')}
              >
                {busy === 'empty' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Translate empty
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                title={machineHint}
                disabled={!translationAvailable || !machineLocale || busy !== null}
                onClick={() => handleMachineTranslate('stale')}
              >
                {busy === 'stale' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Translate stale
              </Button>

              <div className="mx-1 h-5 w-px bg-border" />

              <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExportCsv}>
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </Button>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Select value={localeFilter} onValueChange={setLocaleFilter}>
                  <SelectTrigger className="h-8 w-[190px]" aria-label="Languages shown">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All languages</SelectItem>
                    {allLocales.map((code) => (
                      <SelectItem key={code} value={code}>
                        {localeLabel(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center rounded-md border p-0.5">
                  {FILTERS.map((entry) => (
                    <Button
                      key={entry.id}
                      size="sm"
                      variant={filter === entry.id ? 'secondary' : 'ghost'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setFilter(entry.id)}
                    >
                      {entry.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Native overflow container, not a Radix ScrollArea: one sized with
                flex-1 under a max-h parent silently stops scrolling. overflow-x
                lives here too, so a wide language set scrolls inside the table
                instead of pushing the dialog sideways. */}
            <div className="show-scrollbar min-h-0 flex-1 overflow-auto">
              {visibleGroups.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  {filter === 'untranslated'
                    ? 'Every string has a translation in the languages shown'
                    : filter === 'stale'
                      ? `Nothing is waiting on a ${baseLanguageName} change`
                      : 'This project has no text layers yet'}
                </p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-10 w-[200px] min-w-[200px] bg-background px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground shadow-[inset_0_-1px_0_hsl(var(--border))]">
                        Layer
                      </th>
                      <th className="sticky top-0 z-10 min-w-[220px] bg-background px-3 py-2 text-left text-xs font-semibold shadow-[inset_0_-1px_0_hsl(var(--border))]">
                        {localeName(baseLocale)}
                        <span className="ml-1.5 font-normal text-muted-foreground">base</span>
                      </th>
                      {localeColumns.map((locale) => {
                        const count = completion[locale];
                        return (
                          <th
                            key={locale}
                            className="sticky top-0 z-10 min-w-[240px] bg-background px-3 py-2 text-left text-xs font-semibold shadow-[inset_0_-1px_0_hsl(var(--border))]"
                          >
                            {localeName(locale)}
                            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                              {count ? `${count.translated}/${count.total}` : ''}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGroups.map((group) => {
                      const isCollapsed = !!collapsed[group.board.id];
                      return (
                        <React.Fragment key={group.board.id}>
                          <tr>
                            <td colSpan={columnCount} className="border-y bg-muted/40 p-0">
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium hover:bg-muted"
                                onClick={() =>
                                  setCollapsed((prev) => ({
                                    ...prev,
                                    [group.board.id]: !prev[group.board.id],
                                  }))
                                }
                                aria-expanded={!isCollapsed}
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span className="tabular-nums text-muted-foreground">
                                  {group.index + 1}
                                </span>
                                <span className="truncate">{group.board.name}</span>
                                <span className="ml-auto text-muted-foreground">
                                  {group.elements.length}
                                </span>
                              </button>
                            </td>
                          </tr>

                          {!isCollapsed &&
                            group.elements.map((el) => (
                              <tr key={el.id} className="border-b last:border-b-0">
                                <td className="max-w-[200px] px-3 py-2 align-top text-xs text-muted-foreground">
                                  <span className="line-clamp-3 break-words">{layerLabel(el)}</span>
                                </td>
                                <td className="p-1 align-top">
                                  <div className="whitespace-pre-wrap break-words rounded-md border border-transparent bg-muted/50 px-2 py-1.5 text-sm leading-snug">
                                    {el.content}
                                  </div>
                                </td>
                                {localeColumns.map((locale) => {
                                  const state = stateOf(group.board, el, locale);
                                  const stale = state === 'stale-auto' || state === 'stale-manual';
                                  return (
                                    <td key={locale} className="relative p-1 align-top">
                                      <GrowingCell
                                        value={valueOf(group.board.id, el.id, locale)}
                                        placeholder={`(${el.content})`}
                                        title={
                                          stale
                                            ? `${baseLanguageName} changed since this was translated`
                                            : undefined
                                        }
                                        className={cn(stale && 'border-l-2 border-l-amber-500')}
                                        onChange={(next) =>
                                          mergeEdits([
                                            {
                                              artboardId: group.board.id,
                                              elementId: el.id,
                                              locale,
                                              value: next,
                                            },
                                          ])
                                        }
                                      />
                                      {(state === 'auto' || state === 'stale-auto') && (
                                        <span className="pointer-events-none absolute bottom-2 right-2.5 rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                          auto
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        <DialogFooter className="shrink-0 items-center gap-2 border-t px-6 py-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {review
              ? 'Nothing is written until you apply, and nothing is saved until you save'
              : editedCount > 0
                ? `${editedCount} ${editedCount === 1 ? 'string' : 'strings'} edited, saved as one step`
                : 'Amber rule means the base string changed after that translation was written'}
          </p>
          <div className="flex items-center gap-2">
            {review ? (
              <>
                <Button variant="outline" onClick={() => setReview(null)}>
                  Back
                </Button>
                <Button onClick={handleApplyReview} disabled={pickedCount === 0}>
                  Apply {pickedCount > 0 ? pickedCount : ''}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={editedCount === 0}>
                  Save
                </Button>
              </>
            )}
          </div>
        </DialogFooter>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so re-picking the same file after a fix still fires.
            e.target.value = '';
            if (file) void handleImportFile(file);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
