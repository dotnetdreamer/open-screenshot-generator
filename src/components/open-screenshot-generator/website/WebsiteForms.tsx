"use client";

// The Website view's editing panel, one screen per section: the app's facts,
// the look, the home page, the support page, the privacy policy and the
// languages. Every field writes into the site at once and the preview follows;
// the site is saved a moment later (store.ts).

import React, { useRef } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImageIcon,
  Loader2Icon,
  PaletteIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { LIMITS, MAX_FAQS, MAX_FEATURES, newId } from '@/lib/website/content';
import { LOCALES, getLocaleDef } from '@/lib/i18n/locales';
import { heroContrast } from '@/lib/website/theme';
import { useCustomFonts } from '@/services/customFonts';
import type { SiteDraft, SiteShot, SiteTheme } from '@/lib/website/types';
import { cn } from '@/lib/utils';
import { FontFamilySelect } from '../FontFamilySelect';
import { Gated } from '../growth/GrowthShared';
import { Field, PanelSection, PrivacyQuestions, SiteTextarea } from './WebsiteShared';

export type Update = (change: (draft: SiteDraft) => SiteDraft) => void;

function setFacts(update: Update, patch: Partial<SiteDraft['facts']>) {
  update((draft) => ({ ...draft, facts: { ...draft.facts, ...patch } }));
}

function setContent(update: Update, patch: Partial<SiteDraft['content']>) {
  update((draft) => ({ ...draft, content: { ...draft.content, ...patch } }));
}

function move<T>(list: T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

function Counter({ value, limit }: { value: string; limit: number }) {
  const length = Array.from(value).length;
  return <span className={cn('tabular-nums', length > limit && 'text-destructive')}>{length} of {limit}</span>;
}

function RowTools({ index, total, label, onMove, onRemove }: { index: number; total: number; label: string; onMove: (by: number) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`} title="Move up">
        <ArrowUpIcon className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`} title="Move down">
        <ArrowDownIcon className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={`Remove ${label}`} title="Remove">
        <Trash2Icon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// --- your app ----------------------------------------------------------------------------

export interface GrowthAppChoice {
  id: string;
  name: string;
  store: 'appstore' | 'playstore';
}

export function AppSection({
  draft,
  update,
  growthApps,
  lookingUp,
  onLookup,
  onPickGrowthApp,
  onIconFile,
  onStoreIcon,
}: {
  draft: SiteDraft;
  update: Update;
  growthApps: GrowthAppChoice[];
  lookingUp: boolean;
  onLookup: () => void;
  onPickGrowthApp: (app: GrowthAppChoice) => void;
  onIconFile: (file: File) => void;
  onStoreIcon: () => void;
}) {
  const facts = draft.facts;
  const picker = useRef<HTMLInputElement>(null);
  const hasAppleLink = /id\d{6,}/.test(facts.appStoreUrl);
  return (
    <div className="space-y-6">
      <PanelSection title="Your app" hint="The site shows these on every page">
        {growthApps.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Fill in from Growth</p>
            <div className="flex flex-wrap gap-1.5">
              {growthApps.map((app) => (
                <Button key={app.id} type="button" variant="outline" size="sm" className="h-7 rounded-full text-xs" onClick={() => onPickGrowthApp(app)}>
                  {app.name}
                  <span className="ml-1 text-muted-foreground">{app.store === 'appstore' ? 'App Store' : 'Google Play'}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[22%] border bg-muted">
            {facts.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={facts.icon} alt="App icon" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => picker.current?.click()}>
              {facts.icon ? 'Change the icon' : 'Choose an icon'}
            </Button>
            {hasAppleLink && (
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onStoreIcon}>
                Use the App Store icon
              </Button>
            )}
            {facts.icon && (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setFacts(update, { icon: '' })}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onIconFile(file);
              event.target.value = '';
            }}
          />
        </div>
        <Field label="App name" htmlFor="site-app-name">
          <Input id="site-app-name" value={facts.appName} maxLength={LIMITS.appName} onChange={(event) => setFacts(update, { appName: event.target.value })} />
        </Field>
        <Field label="One line about your app" htmlFor="site-tagline" hint="Shows under the name when you share a link to the site">
          <Input id="site-tagline" value={facts.tagline} maxLength={LIMITS.tagline} placeholder="What it does, in a few words" onChange={(event) => setFacts(update, { tagline: event.target.value })} />
        </Field>
        <Field label="App Store link" htmlFor="site-apple">
          <div className="flex gap-1.5">
            <Input id="site-apple" value={facts.appStoreUrl} placeholder="https://apps.apple.com/app/id..." onChange={(event) => setFacts(update, { appStoreUrl: event.target.value.trim() })} />
            <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 text-xs" disabled={!hasAppleLink || lookingUp} onClick={onLookup} title="Fill in the name, maker and icon from the App Store">
              {lookingUp ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : 'Fill in'}
            </Button>
          </div>
        </Field>
        <Field label="Google Play link" htmlFor="site-play">
          <Input id="site-play" value={facts.playStoreUrl} placeholder="https://play.google.com/store/apps/details?id=..." onChange={(event) => setFacts(update, { playStoreUrl: event.target.value.trim() })} />
        </Field>
      </PanelSection>
      <PanelSection title="You" hint="For the support page and the privacy policy">
        <Field label="Support email" htmlFor="site-email" hint="Apple and Google need a way for people to reach you. It shows on the support page">
          <Input id="site-email" type="email" value={facts.supportEmail} placeholder="help@example.com" onChange={(event) => setFacts(update, { supportEmail: event.target.value.trim() })} />
        </Field>
        <Field label="Your name or your company's" htmlFor="site-developer" hint="The privacy policy says who makes the app">
          <Input id="site-developer" value={facts.developer} maxLength={LIMITS.developer} onChange={(event) => setFacts(update, { developer: event.target.value })} />
        </Field>
        <Field label="Where you're based" htmlFor="site-location" hint="A country or city, for the privacy policy. You can leave it empty">
          <Input id="site-location" value={facts.location} maxLength={LIMITS.location} onChange={(event) => setFacts(update, { location: event.target.value })} />
        </Field>
      </PanelSection>
    </div>
  );
}

// --- the look ---------------------------------------------------------------------------

function ColorField({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  const id = `site-color-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
        />
        {/* Uncontrolled, so a half-typed colour can sit in the box; a whole one lands. */}
        <Input
          id={id}
          key={value}
          defaultValue={value}
          onChange={(event) => {
            const next = event.target.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toLowerCase());
          }}
          className="h-9 w-28 font-mono text-xs"
          maxLength={7}
        />
      </div>
    </Field>
  );
}

export function LookSection({
  draft,
  update,
  suggested,
  hasShots,
}: {
  draft: SiteDraft;
  update: Update;
  /** The colours and face the screenshots and icon give. */
  suggested: Pick<SiteTheme, 'source' | 'brand' | 'brand2' | 'accent' | 'headingFont' | 'headingWeight'>;
  hasShots: boolean;
}) {
  const theme = draft.theme;
  const setTheme = (patch: Partial<SiteTheme>) => update((current) => ({ ...current, theme: { ...current.theme, ...patch, source: 'custom' } }));
  const lowContrast = heroContrast(theme) < 4.5;
  const imported = useCustomFonts().some((font) => font.family === theme.headingFont);
  const following = theme.source !== 'custom';
  return (
    <div className="space-y-6">
      <PanelSection
        title="Colors"
        hint={following ? `From your ${theme.source === 'icon' ? 'app icon' : theme.source === 'screenshots' ? 'screenshots' : 'defaults'}` : 'Your own colors'}
        actions={
          !following || suggested.brand !== theme.brand ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 text-xs"
              onClick={() => update((current) => ({ ...current, theme: { ...current.theme, source: suggested.source, brand: suggested.brand, brand2: suggested.brand2, accent: suggested.accent } }))}
            >
              <PaletteIcon className="h-3.5 w-3.5" />
              {suggested.source === 'screenshots' ? "Use my screenshots' colors" : suggested.source === 'icon' ? "Use my icon's colors" : 'Use the default colors'}
            </Button>
          ) : null
        }
      >
        <div className="h-16 rounded-xl ring-1 ring-border" style={{ background: `linear-gradient(135deg, ${theme.brand}, ${theme.brand2})` }} aria-hidden />
        <ColorField label="Main color" value={theme.brand} onChange={(value) => setTheme({ brand: value })} />
        <ColorField label="Second color" value={theme.brand2} onChange={(value) => setTheme({ brand2: value })} hint="The top of the home page fades from the main color to this one" />
        <ColorField label="Links and highlights" value={theme.accent} onChange={(value) => setTheme({ accent: value })} />
        {lowContrast && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300" role="status">
            <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Text on these two colors is hard to read. Make them both darker or both lighter
          </p>
        )}
      </PanelSection>
      <PanelSection title="Headings" hint={theme.headingFont && theme.headingFont === suggested.headingFont ? 'The font of your screenshots' : undefined}>
        <Field label="Font" htmlFor="site-font">
          <FontFamilySelect
            id="site-font"
            value={theme.headingFont || 'system-ui'}
            onValueChange={(value) =>
              update((current) => ({ ...current, theme: { ...current.theme, headingFont: value === 'system-ui' ? '' : value, shareFont: false, source: current.theme.source } }))
            }
            leadingItems={<SelectItem value="system-ui">The phone&apos;s own font</SelectItem>}
          />
        </Field>
        {imported && (
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Put this font on the website</span>
              <span className="block text-xs text-muted-foreground">
                {theme.shareFont ? 'Anyone can download the font file from the site' : "Only if its license allows websites. Until then the headings use the phone's own font"}
              </span>
            </span>
            <Switch
              checked={!!theme.shareFont}
              onCheckedChange={(value) => update((current) => ({ ...current, theme: { ...current.theme, shareFont: value } }))}
              aria-label="Put this font on the website"
            />
          </label>
        )}
        <Field label="Weight" htmlFor="site-weight">
          <Select value={String(theme.headingWeight || 700)} onValueChange={(value) => update((current) => ({ ...current, theme: { ...current.theme, headingWeight: Number(value) } }))}>
            <SelectTrigger id="site-weight" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[400, 500, 600, 700, 800, 900].map((weight) => (
                <SelectItem key={weight} value={String(weight)}>
                  {{ 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' }[weight]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </PanelSection>
      <PanelSection title="On the pages">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Show the screenshots
            {!hasShots && <span className="block text-xs text-muted-foreground">This project has no screenshots yet</span>}
          </span>
          <Switch checked={draft.options.screenshots} onCheckedChange={(value) => update((current) => ({ ...current, options: { ...current.options, screenshots: value } }))} aria-label="Show the screenshots" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Say it was made with Open Screenshot Generator</span>
          <Switch checked={draft.options.credit} onCheckedChange={(value) => update((current) => ({ ...current, options: { ...current.options, credit: value } }))} aria-label="Say it was made with Open Screenshot Generator" />
        </label>
      </PanelSection>
    </div>
  );
}

// --- the home page -----------------------------------------------------------------------

function ShotPicker({ value, shots, onChange, label }: { value: number; shots: SiteShot[]; onChange: (value: number) => void; label: string }) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger className="h-8 text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="-1" className="text-xs">
          No screenshot
        </SelectItem>
        {shots.map((shot, index) => (
          <SelectItem key={shot.boardId} value={String(index)} className="text-xs">
            <span className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.url} alt="" className="h-6 w-auto rounded-sm" />
              Screenshot {index + 1}
              {shot.caption ? `: ${shot.caption.slice(0, 28)}` : ''}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function HomeSection({ draft, update, shots }: { draft: SiteDraft; update: Update; shots: SiteShot[] }) {
  const content = draft.content;
  const features = content.features;
  const setFeature = (index: number, patch: Partial<(typeof features)[number]>) =>
    update((current) => ({ ...current, content: { ...current.content, features: current.content.features.map((feature, at) => (at === index ? { ...feature, ...patch } : feature)) } }));
  return (
    <div className="space-y-6">
      <PanelSection title="Top of the page">
        <Field label="Headline" htmlFor="site-headline" hint={<Counter value={content.headline} limit={LIMITS.headline} />}>
          <Input id="site-headline" value={content.headline} onChange={(event) => setContent(update, { headline: event.target.value })} />
        </Field>
        <Field label="Line under the headline" htmlFor="site-subhead" hint={<Counter value={content.subhead} limit={LIMITS.subhead} />}>
          <SiteTextarea id="site-subhead" rows={3} value={content.subhead} onChange={(event) => setContent(update, { subhead: event.target.value })} />
        </Field>
      </PanelSection>
      <PanelSection
        title="Features"
        hint="Each one shows next to one of your screenshots"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 text-xs"
            disabled={features.length >= MAX_FEATURES}
            onClick={() =>
              setContent(update, {
                features: [...features, { id: newId('f'), title: '', body: '', shot: features.length < shots.length ? features.length : -1 }],
              })
            }
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add a feature
          </Button>
        }
      >
        {features.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No features yet. Add one, or ask the AI to write them from your screenshots</p>}
        {features.map((feature, index) => (
          <div key={feature.id} className="space-y-2 rounded-lg border p-3" data-testid="site-feature">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold tracking-widest text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
              <RowTools
                index={index}
                total={features.length}
                label={`feature ${index + 1}`}
                onMove={(by) => setContent(update, { features: move(features, index, by) })}
                onRemove={() => setContent(update, { features: features.filter((_, at) => at !== index) })}
              />
            </div>
            <Input aria-label={`Feature ${index + 1} title`} placeholder="Title" value={feature.title} onChange={(event) => setFeature(index, { title: event.target.value })} />
            <SiteTextarea aria-label={`Feature ${index + 1} text`} placeholder="One or two sentences about it" rows={2} value={feature.body} onChange={(event) => setFeature(index, { body: event.target.value })} />
            {shots.length > 0 && <ShotPicker value={feature.shot} shots={shots} onChange={(shot) => setFeature(index, { shot })} label={`Screenshot for feature ${index + 1}`} />}
          </div>
        ))}
      </PanelSection>
      <PanelSection title="Further down">
        <Field label="Heading over the screenshots" htmlFor="site-gallery">
          <Input id="site-gallery" value={content.galleryTitle} onChange={(event) => setContent(update, { galleryTitle: event.target.value })} />
        </Field>
        <Field label="Closing heading" htmlFor="site-cta">
          <Input id="site-cta" value={content.ctaTitle} onChange={(event) => setContent(update, { ctaTitle: event.target.value })} />
        </Field>
        <Field label="Closing line" htmlFor="site-cta-body">
          <Input id="site-cta-body" value={content.ctaBody} onChange={(event) => setContent(update, { ctaBody: event.target.value })} />
        </Field>
        <Field label="Description for search engines" htmlFor="site-description" hint={<Counter value={content.description} limit={LIMITS.description} />}>
          <SiteTextarea id="site-description" rows={2} value={content.description} onChange={(event) => setContent(update, { description: event.target.value })} />
        </Field>
      </PanelSection>
    </div>
  );
}

// --- the support page ----------------------------------------------------------------------

export function SupportSection({ draft, update }: { draft: SiteDraft; update: Update }) {
  const content = draft.content;
  const faqs = content.faqs;
  const setFaq = (index: number, patch: Partial<(typeof faqs)[number]>) =>
    update((current) => ({ ...current, content: { ...current.content, faqs: current.content.faqs.map((faq, at) => (at === index ? { ...faq, ...patch } : faq)) } }));
  return (
    <div className="space-y-6">
      <PanelSection title="Support page" hint={draft.facts.supportEmail ? `People write to ${draft.facts.supportEmail}` : 'Add your support email under Your app'}>
        <Field label="Opening" htmlFor="site-support-intro">
          <SiteTextarea id="site-support-intro" rows={3} value={content.supportIntro} onChange={(event) => setContent(update, { supportIntro: event.target.value })} />
        </Field>
        <Field label="Next to the email button" htmlFor="site-contact-note" hint="What to tell you when they write">
          <SiteTextarea id="site-contact-note" rows={2} value={content.contactNote} onChange={(event) => setContent(update, { contactNote: event.target.value })} />
        </Field>
      </PanelSection>
      <PanelSection
        title="Questions and answers"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 text-xs"
            disabled={faqs.length >= MAX_FAQS}
            onClick={() => setContent(update, { faqs: [...faqs, { id: newId('q'), question: '', answer: '' }] })}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add a question
          </Button>
        }
      >
        {faqs.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No questions yet</p>}
        {faqs.map((faq, index) => (
          <div key={faq.id} className="space-y-2 rounded-lg border p-3" data-testid="site-faq">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">Question {index + 1}</span>
              <RowTools
                index={index}
                total={faqs.length}
                label={`question ${index + 1}`}
                onMove={(by) => setContent(update, { faqs: move(faqs, index, by) })}
                onRemove={() => setContent(update, { faqs: faqs.filter((_, at) => at !== index) })}
              />
            </div>
            <Input aria-label={`Question ${index + 1}`} placeholder="The question" value={faq.question} onChange={(event) => setFaq(index, { question: event.target.value })} />
            <SiteTextarea aria-label={`Answer ${index + 1}`} placeholder="The answer" rows={3} value={faq.answer} onChange={(event) => setFaq(index, { answer: event.target.value })} />
          </div>
        ))}
      </PanelSection>
    </div>
  );
}

// --- the privacy policy --------------------------------------------------------------------

export function PrivacySection({ draft, update }: { draft: SiteDraft; update: Update }) {
  return (
    <div className="space-y-6">
      <PanelSection title="What your app collects" hint="The privacy policy is written from your answers. Tick everything your app does">
        <PrivacyQuestions answers={draft.privacy} onChange={(privacy) => update((current) => ({ ...current, privacy }))} idPrefix="site-privacy" />
      </PanelSection>
      <PanelSection title="In your own words" hint="Anything else the policy should say. It shows under More details">
        <SiteTextarea
          aria-label="More details for the privacy policy"
          rows={4}
          value={draft.content.privacyExtra}
          onChange={(event) => setContent(update, { privacyExtra: event.target.value })}
        />
      </PanelSection>
      <Field label="Last updated" htmlFor="site-privacy-date" hint="Change it when you change what the app collects">
        <Input
          id="site-privacy-date"
          type="date"
          value={draft.privacy.updated}
          onChange={(event) => event.target.value && update((current) => ({ ...current, privacy: { ...current.privacy, updated: event.target.value } }))}
          className="h-9 w-44"
        />
      </Field>
      <p className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
        This policy is a starting point, not legal advice. Read it in the preview and make sure every sentence matches what your app really does.
        {draft.privacy.uses.length > 0 && !draft.privacy.personalizedAds ? " It says you don't sell anyone's data, so don't use it if you do." : ''}
      </p>
    </div>
  );
}

// --- languages ----------------------------------------------------------------------------------

export function LanguagesSection({
  draft,
  update,
  missing,
  projectLocales,
  translating,
  translateReason,
  onTranslate,
  onStop,
}: {
  draft: SiteDraft;
  update: Update;
  /** Lines each language still lacks. */
  missing: Record<string, number>;
  /** The languages the project's screenshots are in. */
  projectLocales: string[];
  translating: { done: number; total: number; engine: string } | null;
  /** Why the site cannot be translated now, null when it can. */
  translateReason: string | null;
  onTranslate: () => void;
  onStop: () => void;
}) {
  const outstanding = draft.languages.reduce((sum, locale) => sum + (missing[locale] ?? 0), 0);
  const available = LOCALES.filter((locale) => !draft.languages.includes(locale.code));
  return (
    <div className="space-y-6">
      <PanelSection title="Languages" hint="Every page is in each of these languages. Your screenshots show in their own language when the project has it">
        <ul className="divide-y rounded-lg border">
          {draft.languages.map((locale) => {
            const def = getLocaleDef(locale);
            const base = locale === draft.baseLocale;
            const lines = missing[locale] ?? 0;
            return (
              <li key={locale} className="flex items-center gap-3 px-3 py-2.5" data-testid="site-language" data-locale={locale}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {def?.nativeName ?? locale}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">{locale}</span>
                  </p>
                  <p className={cn('text-xs', lines > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
                    {base && lines === 0
                      ? 'The language the site is written in'
                      : lines > 0
                        ? `${lines} ${lines === 1 ? 'line' : 'lines'} to translate`
                        : 'Ready'}
                    {!base && !projectLocales.includes(locale) && draft.options.screenshots ? '. Screenshots in the base language' : ''}
                  </p>
                </div>
                {!base && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${def?.name ?? locale}`}
                    title="Remove this language"
                    onClick={() => update((current) => ({ ...current, languages: current.languages.filter((code) => code !== locale) }))}
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <Select value="" onValueChange={(code) => update((current) => ({ ...current, languages: [...current.languages, code] }))}>
          <SelectTrigger className="h-9 text-sm" aria-label="Add a language">
            <SelectValue placeholder="Add a language" />
          </SelectTrigger>
          <SelectContent>
            {available.map((locale) => (
              <SelectItem key={locale.code} value={locale.code}>
                {locale.name} ({locale.nativeName})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelSection>
      <PanelSection title="Translation">
        {translating ? (
          <div className="space-y-2 rounded-lg border p-3" role="status">
            <p className="flex items-center gap-2 text-sm">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Translating with {translating.engine}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${translating.total ? Math.round((translating.done / translating.total) * 100) : 5}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="tabular-nums">
                {translating.done} of {translating.total}
              </span>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onStop}>
                Stop
              </Button>
            </div>
          </div>
        ) : outstanding === 0 ? (
          <p className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <SparklesIcon className="h-3.5 w-3.5" />
            Every language is ready
          </p>
        ) : (
          <div className="space-y-1.5">
            <Gated reason={translateReason}>
              <Button type="button" className="w-full gap-1.5" onClick={onTranslate}>
                <RefreshCwIcon className="h-4 w-4" />
                Translate {outstanding} {outstanding === 1 ? 'line' : 'lines'}
              </Button>
            </Gated>
            <p className="text-xs text-muted-foreground">
              {translateReason ?? "Lines you haven't translated show in the base language. Publishing translates them too"}
            </p>
          </div>
        )}
      </PanelSection>
    </div>
  );
}
