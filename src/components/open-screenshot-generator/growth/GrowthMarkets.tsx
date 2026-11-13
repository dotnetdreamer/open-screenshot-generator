"use client";

// Storefronts: who looks, who downloads, and the main language of each
// storefront's App Store. That language comes from a table
// (territories.ts), not from Apple: a phone set to another language the store
// supports sees that one. The language view is the one that leads back into
// the editor: a main language the listing does not have is the case for
// translating the screenshots next.

import React, { useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, GlobeIcon, LanguagesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCount, formatMoney, formatRate } from '@/lib/growth/format';
import { byTerritory, primaryCurrency, totalsFor, type BreakdownRow } from '@/lib/growth/metrics';
import { languageCovers, listingLanguageFor, listingLanguageName, territoryName } from '@/lib/growth/territories';
import { cn } from '@/lib/utils';
import { BarList } from './GrowthCharts';
import { Delta, EmptyState, Panel, SectionTitle, useGrowthView } from './GrowthShared';

type SortKey = 'downloads' | 'impressions' | 'pageViews' | 'conversion' | 'change';

export function GrowthMarkets() {
  const view = useGrowthView();
  const [sort, setSort] = useState<SortKey>('downloads');
  const [descending, setDescending] = useState(true);
  const rows = useMemo(() => byTerritory(view.byDate, view.window), [view.byDate, view.window]);
  const all = useMemo(() => totalsFor(view.byDate, view.window), [view.byDate, view.window]);
  const currency = primaryCurrency(all.proceeds);
  const languages = view.data.listing?.locales.map((locale) => locale.locale) ?? [];

  // Grouped by the language's name, so the four English listings (US, UK,
  // Canada, Australia) read as one line while Brazilian and European
  // Portuguese stay apart, as they do on the store.
  const byLanguage = useMemo(() => {
    const base = all.hasEngagement ? all.pageViews : all.downloads;
    const map = new Map<string, { language: string; share: number; territories: string[]; covered: boolean }>();
    for (const row of rows) {
      const language = listingLanguageFor(row.key);
      const name = listingLanguageName(language);
      const share = base > 0 ? (all.hasEngagement ? row.totals.pageViews : row.totals.downloads) / base : 0;
      const entry = map.get(name) ?? {
        language,
        share: 0,
        territories: [],
        covered: languages.some((locale) => languageCovers(locale, language)),
      };
      entry.share += share;
      entry.territories.push(row.key);
      map.set(name, entry);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].share - a[1].share);
  }, [rows, all, languages]);

  const value = (row: BreakdownRow, key: SortKey): number => {
    switch (key) {
      case 'downloads':
        return row.totals.downloads;
      case 'impressions':
        return row.totals.impressions;
      case 'pageViews':
        return row.totals.pageViews;
      case 'conversion':
        return row.totals.conversion ?? -1;
      case 'change':
        return row.change ?? -Infinity;
    }
  };
  const sorted = [...rows].sort((a, b) => (descending ? value(b, sort) - value(a, sort) : value(a, sort) - value(b, sort)));

  if (rows.length === 0) {
    return (
      <EmptyState icon={GlobeIcon} title="No storefront numbers yet">
        Storefronts fill in after a sync with Sales and Trends or App Analytics.
      </EmptyState>
    );
  }

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th className={cn('px-3 py-2 font-medium', align === 'right' && 'text-right')}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => {
          if (sort === key) setDescending((value) => !value);
          else {
            setSort(key);
            setDescending(true);
          }
        }}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sort === key && (descending ? <ArrowDownIcon className="h-3 w-3" /> : <ArrowUpIcon className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle
            title="Shoppers by their store's main language"
            hint={`Share of ${all.hasEngagement ? 'product page views' : 'downloads'}, by each storefront's main language`}
          />
          <ul className="space-y-2">
            {byLanguage.slice(0, 8).map(([name, entry]) => (
              <li key={name} className="flex items-center gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{name}</span>
                    <span className="tabular-nums text-muted-foreground">{Math.round(entry.share * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-[hsl(var(--growth-series))]" style={{ width: `${Math.max(2, entry.share * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {entry.territories.slice(0, 4).map(territoryName).join(', ')}
                    {entry.territories.length > 4 ? ` and ${entry.territories.length - 4} more` : ''}
                  </p>
                </div>
                {entry.covered ? (
                  <span className="shrink-0 rounded-full bg-[hsl(var(--growth-good))]/10 px-2 py-0.5 text-[11px] text-[hsl(var(--growth-good))]">Listed</span>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 shrink-0 text-[11px]" onClick={() => view.onLocalize([entry.language])}>
                    <LanguagesIcon className="mr-1 h-3 w-3" />
                    Translate
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <SectionTitle title="First-time downloads by storefront" />
          <BarList
            rows={rows.slice(0, 10).map((row) => ({
              key: row.key,
              label: territoryName(row.key),
              value: row.totals.downloads,
              display: formatCount(row.totals.downloads),
              sub: `${Math.round(row.share * 100)}%`,
            }))}
          />
        </Panel>
      </div>

      <Panel className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            {/* bg-muted overrides the global teal table header (globals.css), which is for document tables. */}
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Storefront</th>
                {header('impressions', 'Impressions')}
                {header('pageViews', 'Page views')}
                {header('conversion', 'Conversion')}
                {header('downloads', 'Downloads')}
                {header('change', 'Change')}
                <th className="px-3 py-2 text-right font-medium" title="In the currency each storefront pays in">
                  Proceeds
                </th>
                <th className="px-3 py-2 text-left font-medium">Main language</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const language = listingLanguageFor(row.key);
                const covered = languages.length === 0 || languages.some((locale) => languageCovers(locale, language));
                return (
                  <tr
                    key={row.key}
                    className={cn('border-b last:border-0', view.tabOptions.territory === row.key && 'bg-[hsl(var(--growth-series))]/5')}
                  >
                    <td className="px-3 py-2">
                      <span className="font-medium">{territoryName(row.key)}</span>
                      <span className="ml-1.5 text-muted-foreground">{row.key}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.totals.hasEngagement ? formatCount(row.totals.impressions) : 'n/a'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.totals.hasEngagement ? formatCount(row.totals.pageViews) : 'n/a'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatRate(row.totals.conversion)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCount(row.totals.downloads)}</td>
                    <td className="px-3 py-2 text-right">
                      <Delta change={row.change} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.totals.hasSales
                        ? (() => {
                            const own = primaryCurrency(row.totals.proceeds, currency);
                            return formatMoney(row.totals.proceeds[own] ?? 0, own);
                          })()
                        : 'n/a'}
                    </td>
                    <td className={cn('px-3 py-2', !covered && 'text-amber-700 dark:text-amber-300')}>
                      {covered ? listingLanguageName(language) : `No ${listingLanguageName(language)} listing`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      {Object.keys(all.proceeds).length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Proceeds are in the currency each storefront pays in. Across the period:{' '}
          {Object.entries(all.proceeds)
            .sort((a, b) => b[1] - a[1])
            .map(([code, amount]) => formatMoney(amount, code))
            .join(', ')}
          .
        </p>
      )}
    </div>
  );
}
