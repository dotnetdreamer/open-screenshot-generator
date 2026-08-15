"use client";

// The project's language control, living in the toolbar's flex-grow spacer.
//
// Everything to do with language is behind this one button, translating
// included. A globe and a translate glyph sitting side by side were two
// controls that a glance could not tell apart, and the second one was reached
// for far less often than its width suggested.
//
// Two shapes on purpose. A project with no languages gets a ghost button, so
// the feature costs a project that will never use it exactly one word of
// chrome. Once languages exist the trigger collapses to globe + code + chevron,
// because the toolbar's right-hand run is already several icon buttons, and a
// full language name here squeezes that run at laptop widths.
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
  /** Open the translate dialog for the whole project. */
  onTranslate?: () => void;
  /**
   * False when the translate dialog has no engine to call. Separate from
   * `translationAvailable`, which gates the bulk refresh: the two answer to
   * different configuration and collapsing them would disable the wrong item.
   */
  translateEnabled?: boolean;
  /** False when no machine translation engine is configured. */
  translationAvailable: boolean;
  className?: string;
}

/**
 * "Translate text", which both shapes of this control carry.
 *
 * A component rather than a copied block so the two menus cannot drift on the
 * label or on which flag disables it.
 */
function TranslateItem({
  onTranslate,
  enabled,
}: {
  onTranslate?: () => void;
  enabled: boolean;
}) {
  if (!onTranslate) return null;
  return (
    <DropdownMenuItem
      onClick={onTranslate}
      disabled={!enabled}
      title={
        enabled
          ? 'Translate the text on these artboards'
          : 'Translation is disabled because API URLs are not configured'
      }
    >
      {/* The globe is the language set. Translating is a different verb, so it
          keeps the A-and-character glyph it carried as its own button. */}
      <LanguagesIcon className="opacity-80" />
      Translate text
    </DropdownMenuItem>
  );
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
  onTranslate,
  translateEnabled = true,
  translationAvailable,
  className,
}: LanguageSwitcherProps) {
  const baseLocale = getBaseLocale(artboards);
  const locales = getProjectLocales(artboards);

  if (locales.length === 0) {
    // No languages yet, so there is nothing to switch between and the trigger
    // is a noun rather than the action it used to be. The menu exists at all
    // because translating lives here too, and it is worth reaching without
    // first adding a language: the translate dialog handles a project that has
    // none, which is how most people meet the feature.
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={cn('h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground', className)}
            title="Add a language, or translate this project"
          >
            <GlobeIcon className="h-4 w-4" />
            <span className="text-sm">Language</span>
            <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onClick={onManageLanguages}>
            <GlobeIcon className="opacity-80" />
            Add language
          </DropdownMenuItem>
          <TranslateItem onTranslate={onTranslate} enabled={translateEnabled} />
        </DropdownMenuContent>
      </DropdownMenu>
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

        <TranslateItem onTranslate={onTranslate} enabled={translateEnabled} />
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
        {/* Globe, matching the collapsed "Add language" button and the locale
            chip above: the globe is the language set, and the toolbar's
            LanguagesIcon is the translate action. */}
        <DropdownMenuItem onClick={onManageLanguages}>
          <GlobeIcon className="opacity-80" />
          Manage languages
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
