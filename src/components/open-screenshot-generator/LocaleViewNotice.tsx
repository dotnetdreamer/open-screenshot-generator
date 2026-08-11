"use client";

// "You are looking at German, and not everything you do here stays in German."
//
// The whole locale overlay rests on one rule the canvas cannot show: text,
// fonts and screenshots are per language, everything else is shared. A user who
// drags a headline in German and finds it moved in English has been surprised
// by the feature working correctly, which is the one failure mode worth paying
// permanent chrome for.
//
// So this is a strip, not a toast, and it sits in the slot LocalFontNotice
// already owns: same geometry, same weight, directly under the toolbar, gone
// the moment the base language is showing again.

import { LanguagesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DEFAULT_BASE_LOCALE, localeName } from '@/lib/i18n/locales';

export interface LocaleViewNoticeProps {
  /** The language being viewed. Never the base one: the strip is hidden there. */
  locale: string;
  untranslatedCount: number;
  onBackToBase: () => void;
  onOpenTranslations: () => void;
  /**
   * The language the project is written in, for the "Back to" label. Optional
   * only so the strip cannot break when a caller has no localization yet; pass
   * getBaseLocale(artboards) rather than leaning on the default.
   */
  baseLocale?: string;
  /**
   * What an edit made here means. 'local' keeps it in this language, 'shared'
   * sends it to every language. Surfaced as a switch rather than left implicit,
   * because the same drag can legitimately mean either and no amount of prose
   * makes a user guess right.
   */
  editScope?: 'local' | 'shared';
  onEditScopeChange?: (scope: 'local' | 'shared') => void;
  className?: string;
}

export function LocaleViewNotice({
  locale,
  untranslatedCount,
  onBackToBase,
  onOpenTranslations,
  baseLocale = DEFAULT_BASE_LOCALE,
  editScope = 'local',
  onEditScopeChange,
  className,
}: LocaleViewNoticeProps) {
  const name = localeName(locale);
  const baseName = localeName(baseLocale);
  const local = editScope === 'local';

  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 border-b border-primary/30 bg-primary/5 px-4 py-2',
        'text-xs text-foreground',
        className
      )}
    >
      <LanguagesIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p className="flex-1 leading-relaxed">
        Viewing <span className="font-medium" dir="auto">{name}</span>.{' '}
        {local ? (
          <>
            What you change here stays in <span dir="auto">{name}</span>. Switch to{' '}
            <span dir="auto">{baseName}</span> to change the design everywhere.
          </>
        ) : (
          <>
            Text and screenshots stay in <span dir="auto">{name}</span>. Everything else you change
            here applies to every language.
          </>
        )}
      </p>

      {onEditScopeChange && (
        <div
          className="flex shrink-0 items-center gap-0.5 rounded-md border bg-background p-0.5"
          role="group"
          aria-label="What changes made here apply to"
        >
          <Button
            variant={local ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onEditScopeChange('local')}
            aria-pressed={local}
            title={`Anything you change stays in ${name}`}
          >
            <span dir="auto">{name} only</span>
          </Button>
          <Button
            variant={local ? 'ghost' : 'secondary'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onEditScopeChange('shared')}
            aria-pressed={!local}
            title="Position, size and style you change reach every language. Text and screenshots still stay here"
          >
            All languages
          </Button>
        </div>
      )}
      {untranslatedCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
          onClick={onOpenTranslations}
          title={`Open the translations table filtered to what ${name} is still missing`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
          {untranslatedCount} untranslated
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        onClick={onBackToBase}
      >
        <span dir="auto">Back to {baseName}</span>
      </Button>
    </div>
  );
}
