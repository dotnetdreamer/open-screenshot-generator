"use client";

// The App Store listing: name, subtitle, keywords, promotional text,
// description and what's new, per language, with the checks beside it and
// every edit collected as a suggested change until the user applies them.
//
// Edits never go to Apple one keystroke at a time. They queue up as before and
// after pairs (ListingChange), which the user reads, trims and applies in one
// go, the same review step AI suggestions and quick fixes go through. Apple
// refuses changes to a version in review, and name and subtitle live on the
// app info, which has its own editable state, so each field says whether it
// can be changed right now and why not.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  LanguagesIcon,
  Loader2Icon,
  OctagonAlertIcon,
  PlusIcon,
  SparklesIcon,
  UploadCloudIcon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { reviewListingWithAi, suggestListingField, translateListingFields } from '@/lib/growth/ai';
import { addListingLanguage, applyListingChanges, editableAppInfoId, fetchListing } from '@/lib/growth/asc';
import { announceGrowthChange, writeListing } from '@/lib/growth/db';
import { recordListingChange } from '@/lib/growth/events';
import { cleanKeywords, collapseChanges, fieldLength, listingScore } from '@/lib/growth/listingChecks';
import { rebaseChanges, setListingAiIssues, setListingChanges, useListingDrafts, withoutApplied } from '@/lib/growth/listingDrafts';
import { LISTING_LANGUAGES, listingLanguageName } from '@/lib/growth/territories';
import {
  LISTING_FIELDS,
  LISTING_FIELD_LABELS,
  LISTING_LIMITS,
  type ListingChange,
  type ListingField,
  type ListingIssue,
  type ListingSnapshot,
} from '@/lib/growth/types';
import { cn } from '@/lib/utils';
import { EmptyState, Panel, SectionTitle, useGrowthView } from './GrowthShared';

const MULTILINE: ListingField[] = ['description', 'whatsNew', 'promotionalText'];

const PLATFORM_LABELS: Record<string, string> = { IOS: 'iOS', MAC_OS: 'macOS', TV_OS: 'tvOS', VISION_OS: 'visionOS' };

/** The version shoppers see now, as opposed to one being prepared or waiting for release. */
function isLiveState(state: string): boolean {
  return state === 'READY_FOR_SALE' || state === 'READY_FOR_DISTRIBUTION';
}

const SEVERITY_ICON = { problem: OctagonAlertIcon, warning: AlertTriangleIcon, tip: InfoIcon };

function fieldEditable(listing: ListingSnapshot, field: ListingField): { ok: boolean; why?: string } {
  if (field === 'promotionalText') return { ok: true };
  if (field === 'name' || field === 'subtitle') {
    return listing.appInfoEditable
      ? { ok: true }
      : { ok: false, why: 'Name and subtitle change with a new version. Create one in App Store Connect first' };
  }
  return listing.editable
    ? { ok: true }
    : { ok: false, why: `Version ${listing.versionString} is ${listing.state.toLowerCase().replace(/_/g, ' ')}, so only promotional text can change` };
}

export function GrowthListing() {
  const view = useGrowthView();
  const listing = view.data.listing;
  const [locale, setLocale] = useState<string>(() => view.tabOptions.locale ?? listing?.primaryLocale ?? 'en-US');
  // Edits and AI findings live outside this screen (listingDrafts.ts): the
  // window mounts a new one for every section, and they must survive that.
  const appId = view.app.id;
  const drafts = useListingDrafts(appId);
  const changes = useMemo(() => (listing ? rebaseChanges(drafts.changes, listing) : drafts.changes), [drafts.changes, listing]);
  const aiIssues = drafts.aiIssues;
  const setChanges = useCallback(
    (update: ListingChange[] | ((current: ListingChange[]) => ListingChange[])) => setListingChanges(appId, update),
    [appId]
  );
  const setAiIssues = useCallback((issues: ListingIssue[]) => setListingAiIssues(appId, issues), [appId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [translateFields, setTranslateFields] = useState<ListingField[]>(['subtitle', 'keywords', 'promotionalText', 'description', 'whatsNew']);
  // Which language the AI is translating into, while it does (each can take a minute).
  const [translating, setTranslating] = useState<string | null>(null);
  const [newLanguage, setNewLanguage] = useState('');

  useEffect(() => {
    if (listing && !listing.locales.some((entry) => entry.locale === locale)) setLocale(listing.primaryLocale);
  }, [listing, locale]);

  const issues = useMemo(() => {
    const ai = aiIssues.filter((issue) => listing?.locales.some((entry) => entry.locale === issue.locale && entry[issue.field!] === issue.fix?.before));
    return [...view.listingIssues, ...ai];
  }, [view.listingIssues, aiIssues, listing]);

  if (!listing) {
    return (
      <EmptyState icon={InfoIcon} title="No listing loaded">
        {view.data.status.listing.message ?? 'Sync the app to load its listing from App Store Connect.'}
      </EmptyState>
    );
  }

  const current = listing.locales.find((entry) => entry.locale === locale) ?? listing.locales[0];
  const pending = collapseChanges(changes);
  const valueOf = (field: ListingField) =>
    pending.find((change) => change.locale === current.locale && change.field === field)?.after ?? current[field];
  const score = listingScore(view.listingIssues, listing.locales.length);
  const localeIssues = issues.filter((issue) => issue.locale === current.locale);

  const upsert = (entries: ListingChange[]) =>
    setChanges((existing) => {
      const next = [...existing];
      for (const entry of entries) {
        const index = next.findIndex((item) => item.locale === entry.locale && item.field === entry.field);
        const base = listing.locales.find((item) => item.locale === entry.locale)?.[entry.field] ?? entry.before;
        const change = { ...entry, before: base };
        if (index >= 0) next[index] = change;
        else next.push(change);
      }
      return next.filter((item) => item.after !== item.before);
    });

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      console.error('Growth listing action failed', error);
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'That did not work. Try again' });
    } finally {
      setBusy(null);
    }
  };

  const refreshListing = async () => {
    if (!view.credentials) return;
    const fresh = await fetchListing(view.credentials, { id: view.app.id, primaryLocale: listing.primaryLocale });
    if (fresh) {
      await writeListing(fresh);
      announceGrowthChange(view.app.id);
    }
  };

  const apply = () =>
    run('apply', async () => {
      const toApply = collapseChanges(changes);
      if (toApply.length === 0) return;
      for (const change of toApply) {
        if (!fieldEditable(listing, change.field).ok) {
          throw new Error(`${LISTING_FIELD_LABELS[change.field]} cannot change right now. Remove it from the list first`);
        }
        if (fieldLength(change.after) > LISTING_LIMITS[change.field]) {
          throw new Error(`${listingLanguageName(change.locale)} ${LISTING_FIELD_LABELS[change.field].toLowerCase()} is over its ${LISTING_LIMITS[change.field]} character limit`);
        }
      }
      if (view.sample) {
        const next: ListingSnapshot = {
          ...listing,
          locales: listing.locales.map((entry) => {
            const updated = { ...entry };
            for (const change of toApply.filter((item) => item.locale === entry.locale)) updated[change.field] = change.after;
            return updated;
          }),
          fetchedAt: Date.now(),
        };
        await writeListing(next);
        announceGrowthChange(view.app.id);
        setMessage({ tone: 'ok', text: `Applied ${toApply.length} change${toApply.length === 1 ? '' : 's'} to the sample listing on this computer` });
        setChanges((latest) => withoutApplied(latest, toApply));
        setAiIssues([]);
      } else {
        if (!view.credentials) throw new Error('Connect an App Store Connect key first');
        const result = await applyListingChanges(view.credentials, listing, toApply);
        const took = new Set(result.applied);
        const applied = toApply.filter((change) => took.has(`${change.locale}:${change.field}`));
        if (applied.length > 0) {
          // A change shows on the store when the version it was written to
          // does, so only an edit to the live version counts from today.
          await recordListingChange({
            appId: view.app.id,
            fields: Array.from(new Set(applied.map((change) => LISTING_FIELD_LABELS[change.field].toLowerCase()))),
            locales: Array.from(new Set(applied.map((change) => change.locale))),
            versionString: isLiveState(listing.state) ? undefined : listing.versionString,
          });
          await refreshListing();
        }
        // What Apple refused stays in the list, to fix and apply again, and so
        // does anything typed while Apple was answering.
        setChanges((latest) => withoutApplied(latest, applied));
        if (applied.length > 0) setAiIssues([]);
        setMessage(
          result.warnings.length > 0
            ? { tone: 'error', text: `Applied ${applied.length} of ${toApply.length}. ${result.warnings.join(' ')}` }
            : { tone: 'ok', text: `Applied ${applied.length} change${applied.length === 1 ? '' : 's'} in App Store Connect` }
        );
      }
    });

  const canApply = view.canWrite || view.sample;
  const addable = LISTING_LANGUAGES.filter((code) => !listing.locales.some((entry) => entry.locale === code));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">
                Version {listing.versionString}
                {listing.platform !== 'IOS' && ` for ${PLATFORM_LABELS[listing.platform] ?? listing.platform}`}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                  {listing.state.toLowerCase().replace(/_/g, ' ')}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {listing.editable
                  ? `Every field can change until the version is submitted. Shoppers see the changes once version ${listing.versionString} is out.`
                  : 'Live or in review: only promotional text can change.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className={cn('text-2xl font-semibold leading-none', score >= 80 ? 'text-[hsl(var(--growth-good))]' : score < 55 ? 'text-[hsl(var(--growth-bad))]' : '')}>
                  {score}
                </p>
                <p className="text-[11px] text-muted-foreground">listing score</p>
              </div>
              {view.aiAvailable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void run('ai-review', async () => {
                      const found = await reviewListingWithAi(listing);
                      setAiIssues(found);
                      setMessage({ tone: 'ok', text: found.length > 0 ? `The AI found ${found.length} wording issue${found.length === 1 ? '' : 's'}` : 'The AI found no spelling or wording mistakes' });
                    })
                  }
                >
                  {busy === 'ai-review' ? <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" /> : <SparklesIcon className="mr-1.5 h-4 w-4" />}
                  Proofread with AI
                </Button>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Listing languages">
            {listing.locales.map((entry) => {
              const count = issues.filter((issue) => issue.locale === entry.locale && issue.severity !== 'tip').length;
              return (
                <button
                  key={entry.locale}
                  type="button"
                  role="tab"
                  aria-selected={entry.locale === current.locale}
                  onClick={() => setLocale(entry.locale)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs',
                    entry.locale === current.locale ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'
                  )}
                >
                  {listingLanguageName(entry.locale)}
                  {entry.locale === listing.primaryLocale && <span className="ml-1 opacity-70">(primary)</span>}
                  {count > 0 && <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] tabular-nums text-amber-700 dark:text-amber-300">{count}</span>}
                </button>
              );
            })}
            {view.canWrite && listing.editable && addable.length > 0 && (
              <div className="flex items-center gap-1">
                <Select value={newLanguage} onValueChange={setNewLanguage}>
                  <SelectTrigger className="h-7 w-[150px] text-xs" aria-label="Language to add">
                    <SelectValue placeholder="Add a language" />
                  </SelectTrigger>
                  <SelectContent>
                    {addable.map((code) => (
                      <SelectItem key={code} value={code} className="text-xs">
                        {listingLanguageName(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newLanguage && (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('add-language', async () => {
                        if (!view.credentials) throw new Error('Connect an App Store Connect key first');
                        const primary = listing.locales.find((entry) => entry.locale === listing.primaryLocale);
                        const infoId = await editableAppInfoId(view.credentials, view.app.id);
                        await addListingLanguage(view.credentials, listing, newLanguage, infoId, primary?.name ?? view.app.name);
                        await refreshListing();
                        setLocale(newLanguage);
                        setNewLanguage('');
                        setMessage({ tone: 'ok', text: `${listingLanguageName(newLanguage)} added. Translate its fields below, then apply` });
                      })
                    }
                  >
                    {busy === 'add-language' ? <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PlusIcon className="mr-1 h-3.5 w-3.5" />}
                    Add
                  </Button>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel className="space-y-4">
          <SectionTitle
            title={`${listingLanguageName(current.locale)} listing`}
            hint="Edits collect on the right as suggested changes. Nothing reaches the store until you apply them."
          />
          {LISTING_FIELDS.map((field) => {
            const value = valueOf(field);
            const length = fieldLength(value);
            const limit = LISTING_LIMITS[field];
            const editable = fieldEditable(listing, field);
            const changed = value !== current[field];
            const fieldProps = {
              id: `growth-field-${field}`,
              value,
              disabled: !editable.ok,
              title: editable.why,
              className: cn('text-sm', changed && 'border-[hsl(var(--growth-highlight))]'),
              onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                upsert([{ locale: current.locale, field, before: current[field], after: event.target.value }]),
            };
            return (
              <div key={field} className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`growth-field-${field}`} className="text-xs font-medium">
                    {LISTING_FIELD_LABELS[field]}
                    {changed && <span className="ml-2 text-[11px] font-normal text-[hsl(var(--growth-highlight))]">edited</span>}
                  </label>
                  <div className="flex items-center gap-1">
                    {field === 'keywords' && editable.ok && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => {
                          const cleanup = cleanKeywords({ ...current, keywords: value, name: valueOf('name'), subtitle: valueOf('subtitle') });
                          if (cleanup.keywords === value) {
                            setMessage({ tone: 'ok', text: 'The keywords are already clean' });
                            return;
                          }
                          upsert([{ locale: current.locale, field, before: current[field], after: cleanup.keywords, reason: `Freed ${cleanup.saved} characters` }]);
                        }}
                        title="Remove spaces after commas, repeats, and words the name and subtitle already have"
                      >
                        <WandSparklesIcon className="mr-1 h-3 w-3" />
                        Clean up
                      </Button>
                    )}
                    {view.aiAvailable && editable.ok && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`suggest:${field}`, async () => {
                            const after = await suggestListingField({ listing, locale: current.locale, field });
                            upsert([{ locale: current.locale, field, before: current[field], after, reason: 'Written by AI' }]);
                          })
                        }
                      >
                        {busy === `suggest:${field}` ? <Loader2Icon className="mr-1 h-3 w-3 animate-spin" /> : <SparklesIcon className="mr-1 h-3 w-3" />}
                        Suggest
                      </Button>
                    )}
                    <span className={cn('text-[11px] tabular-nums', length > limit ? 'text-destructive' : 'text-muted-foreground')}>
                      {length} / {limit}
                    </span>
                  </div>
                </div>
                {MULTILINE.includes(field) ? (
                  <Textarea {...fieldProps} rows={field === 'description' ? 8 : field === 'whatsNew' ? 3 : 2} />
                ) : (
                  <Input {...fieldProps} />
                )}
                {!editable.ok && <p className="text-[11px] text-muted-foreground">{editable.why}</p>}
              </div>
            );
          })}

          {view.aiAvailable && current.locale === listing.primaryLocale && listing.locales.length > 1 && (
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="text-xs font-medium">Translate into the other {listing.locales.length - 1} languages</p>
              <div className="flex flex-wrap gap-3">
                {LISTING_FIELDS.filter((field) => field !== 'name').map((field) => (
                  <label key={field} className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={translateFields.includes(field)}
                      onCheckedChange={(checked) =>
                        setTranslateFields((list) => (checked ? [...list, field] : list.filter((item) => item !== field)))
                      }
                    />
                    {LISTING_FIELD_LABELS[field]}
                  </label>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null || translateFields.length === 0}
                onClick={() =>
                  void run('translate', async () => {
                    const others = listing.locales.map((entry) => entry.locale).filter((code) => code !== listing.primaryLocale);
                    const result = await translateListingFields({
                      listing,
                      from: listing.primaryLocale,
                      to: others,
                      fields: translateFields,
                      onProgress: (code, index, total) => setTranslating(`${listingLanguageName(code)}, ${index + 1} of ${total}`),
                    }).finally(() => setTranslating(null));
                    upsert(result.changes.filter((change) => fieldEditable(listing, change.field).ok));
                    setMessage({
                      tone: result.failed.length > 0 ? 'error' : 'ok',
                      text: `${result.changes.length} translated field${result.changes.length === 1 ? '' : 's'} added to the suggested changes${
                        result.failed.length > 0 ? `. No answer for ${result.failed.map(listingLanguageName).join(', ')}` : ''
                      }`,
                    });
                  })
                }
              >
                {busy === 'translate' ? <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" /> : <LanguagesIcon className="mr-1.5 h-4 w-4" />}
                Translate with AI
              </Button>
              {translating && (
                <p className="text-[11px] text-muted-foreground" role="status">
                  Translating into {translating}
                </p>
              )}
            </div>
          )}
        </Panel>

        <LiveScreenshots />
      </div>

      <div className="space-y-4">
        <Panel>
          <SectionTitle
            title="Suggested changes"
            hint={pending.length === 0 ? 'Fixes, AI suggestions and your edits wait here until you apply them.' : undefined}
          />
          {pending.length > 0 && (
            <ul className="mb-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {pending.map((change) => (
                <li key={`${change.locale}:${change.field}`} className="rounded-md border p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">
                      {listingLanguageName(change.locale)}, {LISTING_FIELD_LABELS[change.field].toLowerCase()}
                    </p>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setChanges((list) => list.filter((item) => !(item.locale === change.locale && item.field === change.field)))}
                      aria-label="Remove this change"
                      title="Remove this change"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {change.reason && <p className="text-muted-foreground">{change.reason}</p>}
                  <p className="mt-1 line-clamp-3 break-words text-muted-foreground line-through decoration-[hsl(var(--growth-bad))]/60">{change.before || 'empty'}</p>
                  <p className="mt-0.5 line-clamp-4 break-words">{change.after || 'empty'}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending.length === 0 || busy !== null || !canApply} onClick={() => void apply()} title={canApply ? undefined : 'Applying needs the desktop app and an App Store Connect key'}>
              {busy === 'apply' ? <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" /> : <UploadCloudIcon className="mr-1.5 h-4 w-4" />}
              {view.sample ? 'Apply to the sample' : 'Apply in App Store Connect'}
            </Button>
            {pending.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setChanges([])}>
                Discard all
              </Button>
            )}
          </div>
          {message && (
            <p className={cn('mt-2 text-xs', message.tone === 'error' ? 'text-destructive' : 'text-[hsl(var(--growth-good))]')}>{message.text}</p>
          )}
        </Panel>

        <Panel>
          <SectionTitle
            title={`Checks for ${listingLanguageName(current.locale)}`}
            actions={
              localeIssues.some((issue) => issue.fix) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => upsert(localeIssues.filter((issue) => issue.fix).map((issue) => issue.fix!))}
                >
                  Add every fix
                </Button>
              ) : undefined
            }
          />
          {localeIssues.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2Icon className="h-4 w-4 text-[hsl(var(--growth-good))]" />
              Nothing to fix in this language.
            </p>
          ) : (
            <ul className="space-y-2">
              {localeIssues.map((issue) => {
                const Icon = SEVERITY_ICON[issue.severity];
                return (
                  <li key={issue.id} className="flex gap-2 text-xs">
                    <Icon
                      className={cn(
                        'mt-0.5 h-3.5 w-3.5 shrink-0',
                        issue.severity === 'problem' && 'text-[hsl(var(--growth-bad))]',
                        issue.severity === 'warning' && 'text-amber-600 dark:text-amber-400',
                        issue.severity === 'tip' && 'text-muted-foreground'
                      )}
                    />
                    <div className="min-w-0">
                      <p className="font-medium">{issue.title}</p>
                      <p className="text-muted-foreground">{issue.detail}</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {issue.fix && fieldEditable(listing, issue.fix.field).ok && (
                          <button type="button" className="font-medium text-[hsl(var(--growth-series))] hover:underline" onClick={() => upsert([issue.fix!])}>
                            Fix
                          </button>
                        )}
                        {issue.id.endsWith(':screenshots-borrowed') && (
                          <button type="button" className="font-medium text-[hsl(var(--growth-series))] hover:underline" onClick={() => view.onLocalize([issue.locale])}>
                            Translate the screenshots
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** The screenshots shoppers see today, from the public lookup, beside the way to replace them. */
function LiveScreenshots() {
  const view = useGrowthView();
  const live = view.data.live;
  if (view.sample || !live || live.screenshotUrls.length === 0) {
    return (
      <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Screenshots</p>
          <p className="text-xs text-muted-foreground">
            The screenshots are the part of the listing most people look at. Upload a new set from the editor and the overview
            measures it against this one.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={view.onPublish}>
          <UploadCloudIcon className="mr-1.5 h-4 w-4" />
          Upload screenshots
        </Button>
      </Panel>
    );
  }
  return (
    <Panel>
      <SectionTitle
        title={`On the store now, version ${live.version}`}
        hint="What shoppers in the storefront checked first see. The first three also show in search results."
        actions={
          <Button size="sm" variant="outline" onClick={view.onPublish}>
            <UploadCloudIcon className="mr-1.5 h-4 w-4" />
            Upload new screenshots
          </Button>
        }
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {live.screenshotUrls.slice(0, 10).map((url, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            alt={`Live screenshot ${index + 1}`}
            className={cn('h-56 w-auto shrink-0 rounded-md border object-contain', index < 3 && 'ring-1 ring-[hsl(var(--growth-series))]/50')}
            loading="lazy"
          />
        ))}
      </div>
    </Panel>
  );
}
