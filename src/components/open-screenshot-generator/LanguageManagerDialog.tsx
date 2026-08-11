"use client";

// Picking the languages a project ships in.
//
// A multi-select grid, deliberately: a realistic App Store listing is six to
// ten languages, and one-locale-per-dialog turns that into nine round trips
// through the same three controls. Everything here is a list of codes plus one
// switch, so the whole flow is: say what the project is written in, tick the
// languages, confirm.
//
// Nothing about the design changes when this is confirmed. Every board still
// shows the base language until the user switches to one of these.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangleIcon, SearchIcon } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ArtboardState, LocaleEntry, ProjectLocalization } from '@/types/artboard';
import { DEFAULT_BASE_LOCALE, LOCALES, localeName, type LocaleDef } from '@/lib/i18n/locales';
import { getBaseLocale, getProjectLocales, localeCompletion } from '@/lib/i18n/localization';

export interface LanguageManagerDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The BASE document, so the removal warning can count what would be lost. */
  artboards: ArtboardState[];
  translationAvailable: boolean;
  onApply: (
    next: ProjectLocalization,
    opts: { machineTranslate: boolean; addedLocales: string[] }
  ) => void;
}

/**
 * The one legitimate read of ArtboardState.language: a default for a field the
 * user is about to confirm by hand. It holds a translate code ('de') and is set
 * only when a whole board translated cleanly, so it is a hint and never a key.
 * Boards that disagree, or a project where only some boards carry one, fall
 * back rather than guess.
 */
function seedBaseLocale(artboards: ArtboardState[]): string {
  if (artboards.length === 0) return DEFAULT_BASE_LOCALE;
  const first = artboards[0].language;
  if (!first || artboards.some((board) => board.language !== first)) return DEFAULT_BASE_LOCALE;
  return (
    LOCALES.find((def) => def.code === first)?.code ||
    LOCALES.find((def) => def.translateCode === first)?.code ||
    DEFAULT_BASE_LOCALE
  );
}

/**
 * What the stores call this language. Shown because the export filenames and
 * both upload paths are named by it, so a user comparing against App Store
 * Connect can see the match before committing to the language.
 */
function storeCodesLabel(def: LocaleDef): string {
  const parts: string[] = [];
  if (def.appleLocale) parts.push(`App Store ${def.appleLocale}`);
  if (def.playLanguage) parts.push(`Play ${def.playLanguage}`);
  return parts.length > 0 ? parts.join(', ') : 'No store listing';
}

function matchesQuery(def: LocaleDef, query: string): boolean {
  if (!query) return true;
  const haystack = [def.name, def.nativeName, def.code, def.appleLocale, def.playLanguage]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export function LanguageManagerDialog({
  open,
  onOpenChange,
  artboards,
  translationAvailable,
  onApply,
}: LanguageManagerDialogProps) {
  const [baseLocale, setBaseLocale] = useState<string>(DEFAULT_BASE_LOCALE);
  const [selected, setSelected] = useState<string[]>([]);
  const [machineTranslate, setMachineTranslate] = useState(false);
  const [query, setQuery] = useState('');

  // Latest boards, read only on the closed to open edge. Depending on the prop
  // directly would re-seed mid-session on any unrelated commit (the array is a
  // new reference on every edit) and wipe the ticks the user just made.
  const artboardsRef = useRef(artboards);
  artboardsRef.current = artboards;

  // The languages the project had when the dialog opened, so unticking one can
  // be told apart from never having added it.
  const [existing, setExisting] = useState<LocaleEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    const boards = artboardsRef.current;
    const entries = getProjectLocales(boards);
    setExisting(entries);
    setSelected(entries.map((entry) => entry.code));
    setBaseLocale(entries.length > 0 ? getBaseLocale(boards) : seedBaseLocale(boards));
    setMachineTranslate(translationAvailable);
    setQuery('');
  }, [open, translationAvailable]);

  const existingCodes = useMemo(() => new Set(existing.map((entry) => entry.code)), [existing]);
  const selectedCodes = useMemo(() => new Set(selected), [selected]);
  const added = useMemo(
    () => selected.filter((code) => !existingCodes.has(code)),
    [selected, existingCodes]
  );
  const removed = useMemo(
    () => existing.filter((entry) => !selectedCodes.has(entry.code)),
    [existing, selectedCodes]
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(
    () => LOCALES.filter((def) => matchesQuery(def, normalizedQuery)),
    [normalizedQuery]
  );

  // Reassigning the base language re-points every override at a different
  // source string, which is a migration and not a checkbox. It stays editable
  // only while the project has no languages at all, which is the moment it is
  // actually a choice.
  const baseLocked = existing.length > 0;

  const toggle = (code: string) => {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((other) => other !== code) : [...prev, code]
    );
  };

  const handleBaseChange = (code: string) => {
    setBaseLocale(code);
    // The base language is never one of the export languages: it IS the
    // document, so an override on it could only shadow itself.
    setSelected((prev) => prev.filter((other) => other !== code));
  };

  // Strings that would be deleted with the unticked languages. Counted rather
  // than described, because "some translations" is not a number anyone can
  // weigh a decision against.
  const doomedStrings = useMemo(
    () =>
      removed.reduce(
        (total, entry) => total + localeCompletion(artboards, entry.code).translated,
        0
      ),
    [removed, artboards]
  );

  // A base language with no export languages is a no-op, so confirming needs a
  // language to have moved in or out of the list.
  const changed = added.length > 0 || removed.length > 0;

  const handleApply = () => {
    // Kept languages keep their own entry, so autoFont and autoFit survive a
    // trip through this dialog. New ones are stored as a bare code: both flags
    // default to on when absent, and a sparse entry keeps projectData small.
    const kept = existing.filter((entry) => selectedCodes.has(entry.code));
    const keptCodes = new Set(kept.map((entry) => entry.code));
    const fresh: LocaleEntry[] = LOCALES.filter(
      (def) => selectedCodes.has(def.code) && !keptCodes.has(def.code)
    ).map((def) => ({ code: def.code }));

    onApply(
      { baseLocale, locales: [...kept, ...fresh] },
      { machineTranslate: machineTranslate && translationAvailable, addedLocales: added }
    );
    onOpenChange(false);
  };

  const applyLabel =
    added.length > 0 && removed.length === 0
      ? `Add ${added.length} ${added.length === 1 ? 'language' : 'languages'}`
      : 'Save languages';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Header, base picker, search and footer stay put; only the grid scrolls,
          so the dialog never clips off a short viewport. */}
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4">
          <DialogTitle>Languages</DialogTitle>
          <DialogDescription>
            Every language shares one layout. Only text, fonts and screenshots can differ, so a
            change to the design reaches all of them at once.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 space-y-3 border-b bg-muted/40 px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="base-locale" className="text-sm">
              This project is written in
            </Label>
            {/* The title rides on the wrapper, not the trigger: a disabled
                button swallows the hover that would show it. */}
            <div
              className="min-w-[14rem] flex-1"
              title={
                baseLocked
                  ? 'The base language is set with the first language you add. Changing it later would re-point every translation'
                  : undefined
              }
            >
              <Select value={baseLocale} onValueChange={handleBaseChange} disabled={baseLocked}>
                <SelectTrigger id="base-locale" className="h-9 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((def) => (
                    <SelectItem key={def.code} value={def.code}>
                      <span dir="auto">{def.nativeName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{def.code}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search languages"
              aria-label="Search languages"
              className="h-9 bg-background pl-8"
            />
          </div>
        </div>

        {/* Native overflow div, not a Radix ScrollArea: one under a flex-1 or
            max-h parent silently stops scrolling (known repo quirk). */}
        <div className="show-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No language matches &ldquo;{query.trim()}&rdquo;
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {visible.map((def) => {
                const isBase = def.code === baseLocale;
                const isSelected = selectedCodes.has(def.code);
                const isRemoval = existingCodes.has(def.code) && !isSelected;
                return (
                  <label
                    key={def.code}
                    htmlFor={`locale-${def.code}`}
                    className={cn(
                      'flex items-start gap-3 rounded-md border p-2.5 transition-shadow',
                      isBase
                        ? 'cursor-default border-border bg-muted/50'
                        : 'cursor-pointer hover:shadow-xl',
                      !isBase && isSelected && 'border-primary bg-primary/5 ring-1 ring-primary',
                      isRemoval && 'border-amber-500/50 bg-amber-500/5'
                    )}
                  >
                    <Checkbox
                      id={`locale-${def.code}`}
                      className="mt-0.5"
                      checked={isBase || isSelected}
                      disabled={isBase}
                      onCheckedChange={() => toggle(def.code)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="min-w-0 truncate text-sm font-medium" dir="auto">
                          {def.nativeName}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {def.code}
                        </span>
                        {isBase && (
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            Base
                          </span>
                        )}
                      </div>
                      {def.nativeName !== def.name && (
                        <p className="truncate text-xs text-muted-foreground">{def.name}</p>
                      )}
                      <p className="truncate text-[11px] text-muted-foreground">
                        {storeCodesLabel(def)}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-3 border-t px-6 py-3">
          {removed.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="flex-1 leading-relaxed">
                Removing{' '}
                <span className="font-medium" dir="auto">
                  {removed.map((entry) => localeName(entry.code)).join(', ')}
                </span>{' '}
                {removed.length === 1 ? 'deletes its' : 'deletes their'} translations
                {doomedStrings > 0
                  ? `, ${doomedStrings} ${doomedStrings === 1 ? 'string' : 'strings'} written so far`
                  : ''}
                . The layout is untouched
              </p>
            </div>
          )}

          {/* The title rides on the row, not the Switch: a disabled control
              swallows the hover that would show it. */}
          <div
            className="flex items-start gap-3"
            title={
              translationAvailable
                ? undefined
                : 'Machine translation is not configured, so translations are typed in or imported from a CSV'
            }
          >
            <Switch
              id="machine-translate"
              checked={machineTranslate && translationAvailable}
              disabled={!translationAvailable}
              onCheckedChange={setMachineTranslate}
            />
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="machine-translate"
                className={cn('text-sm', !translationAvailable && 'text-muted-foreground')}
              >
                Fill in machine translations to start from
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Machine translations are marked so you can replace them. Anything you type is never
                overwritten
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t px-6 py-4">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleApply} disabled={!changed}>
            {applyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
