"use client";

// The project's language control, living in the toolbar's flex-grow spacer.
//
// Two shapes on purpose. A project with no languages gets a single ghost
// button, so the feature costs a project that will never use it exactly one
// word of chrome. Once languages exist it collapses to globe + code + chevron,
// because the toolbar's right-hand run is already eight icon buttons plus a
// labelled one, and a full language name here squeezes that run at laptop
// widths.
//
// It reads the base document, never a projection: the counts have to describe
// every language at once, and a projected array has already lost the overrides
// they are counted from.

import {
  ChevronDownIcon,
  GlobeIcon,
  LanguagesIcon,
  RefreshCwIcon,
  TableIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ArtboardState } from '@/types/artboard';
import { getBaseLocale, getProjectLocales, localeCompletion } from '@/lib/i18n/localization';
import { localeLabel, localeName } from '@/lib/i18n/locales';

export interface LanguageSwitcherProps {
  /** The BASE document, every language. Never a projection. */
  artboards: ArtboardState[];
  /** null means the base language is showing. */
  activeLocale: string | null;
  onSelectLocale: (locale: string | null) => void;
  onManageLanguages: () => void;
  onOpenTranslations: () => void;
  onUpdateTranslations: () => void;
  /** False when no machine translation engine is configured. */
  translationAvailable: boolean;
  className?: string;
}

/**
 * What fits in a 90px trigger. The primary subtag reads as the language
 * ('de-DE' becomes 'DE'), except when the project ships two flavours of one:
 * en-US beside en-GB would both read 'EN', and a wrong code is worse than a
 * wide one.
 */
function shortCode(code: string, projectCodes: string[]): string {
  const primary = code.split('-')[0];
  const shared = projectCodes.filter((other) => other.split('-')[0] === primary).length > 1;
  return (shared ? code : primary).toUpperCase();
}

/** The "4/6" on a language row, plus the amber dot that says it is short. */
function Completion({ translated, total }: { translated: number; total: number }) {
  if (total === 0) return null;
  const short = translated < total;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-4">
      <span className="text-xs tabular-nums text-muted-foreground">
        {translated}/{total}
      </span>
      {short && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-amber-500"
          aria-label={`${total - translated} untranslated`}
        />
      )}
    </span>
  );
}

export function LanguageSwitcher({
  artboards,
  activeLocale,
  onSelectLocale,
  onManageLanguages,
  onOpenTranslations,
  onUpdateTranslations,
  translationAvailable,
  className,
}: LanguageSwitcherProps) {
  const baseLocale = getBaseLocale(artboards);
  const locales = getProjectLocales(artboards);

  if (locales.length === 0) {
    return (
      <Button
        variant="ghost"
        className={cn('h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground', className)}
        onClick={onManageLanguages}
        title="Export this project in more than one language"
      >
        <GlobeIcon className="h-4 w-4" />
        <span className="text-sm">Add language</span>
      </Button>
    );
  }

  const projectCodes = [baseLocale, ...locales.map((entry) => entry.code)];
  const showing = activeLocale ?? baseLocale;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn('h-8 min-w-[86px] justify-start gap-1.5 px-2', className)}
          title={`Showing ${localeLabel(showing)}`}
        >
          <GlobeIcon className="h-4 w-4 opacity-80" />
          <span className="text-sm font-medium tabular-nums">
            {shortCode(showing, projectCodes)}
          </span>
          <ChevronDownIcon className="ml-auto h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs">Showing</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* The base language first, always. It is the one language that cannot
            be incomplete, so it carries a label where the others carry a count. */}
        <DropdownMenuCheckboxItem
          checked={activeLocale === null}
          onClick={() => onSelectLocale(null)}
        >
          <span className="min-w-0 truncate" dir="auto">
            {localeName(baseLocale)}
          </span>
          <span className="ml-1.5 shrink-0 text-xs text-muted-foreground">{baseLocale}</span>
          <span className="ml-auto shrink-0 pl-4 text-xs text-muted-foreground">Base</span>
        </DropdownMenuCheckboxItem>

        {locales.map((entry) => {
          const completion = localeCompletion(artboards, entry.code);
          return (
            <DropdownMenuCheckboxItem
              key={entry.code}
              checked={activeLocale === entry.code}
              onClick={() => onSelectLocale(entry.code)}
            >
              <span className="min-w-0 truncate" dir="auto">
                {localeName(entry.code)}
              </span>
              <span className="ml-1.5 shrink-0 text-xs text-muted-foreground">{entry.code}</span>
              <Completion {...completion} />
            </DropdownMenuCheckboxItem>
          );
        })}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onOpenTranslations}>
          <TableIcon className="opacity-80" />
          Translations table
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onUpdateTranslations}
          disabled={!translationAvailable}
          title={
            translationAvailable
              ? 'Fill in what is empty and refresh machine translations whose English changed'
              : 'Machine translation is not configured, so translations are typed or imported'
          }
        >
          <RefreshCwIcon className="opacity-80" />
          Update translations
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onManageLanguages}>
          <LanguagesIcon className="opacity-80" />
          Manage languages
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
