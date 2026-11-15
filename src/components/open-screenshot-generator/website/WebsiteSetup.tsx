"use client";

// A project's first visit to the Website view: what the site will be, with a
// preview of it made from the project already, and the three questions that
// make it (the app, what it collects, how it looks and in which languages).

import React, { useEffect, useState } from 'react';
import { CheckIcon, GlobeIcon, ImageIcon, LifeBuoyIcon, Loader2Icon, ShieldCheckIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { LOCALES, getLocaleDef } from '@/lib/i18n/locales';
import { LIMITS } from '@/lib/website/content';
import type { PrivacyAnswers, SiteDraft, SiteFacts, SiteShot, SiteTheme } from '@/lib/website/types';
import type { TranslationBook } from '@/lib/website/strings';
import { cn } from '@/lib/utils';
import { Gated } from '../growth/GrowthShared';
import type { GrowthAppChoice } from './WebsiteForms';
import { WebsitePreview } from './WebsitePreview';
import { Field, PrivacyQuestions, type AiStatus, SiteTextarea } from './WebsiteShared';

const EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function WebsiteWelcome({
  appName,
  previewDraft,
  shots,
  known,
  languages,
  hasShots,
  onStart,
}: {
  appName: string;
  previewDraft: SiteDraft | null;
  shots: SiteShot[];
  known: TranslationBook;
  languages: string[];
  hasShots: boolean;
  onStart: () => void;
}) {
  const names = languages.map((code) => getLocaleDef(code)?.nativeName ?? code);
  const points = [
    { icon: ImageIcon, title: 'A home page', text: hasShots ? 'With your screenshots, your colors and links to the stores' : 'With your colors and links to the stores' },
    { icon: LifeBuoyIcon, title: 'A support page', text: 'Your email and answers to the questions people ask' },
    { icon: ShieldCheckIcon, title: 'A privacy policy', text: 'Written from a few questions about what your app collects' },
    {
      icon: GlobeIcon,
      title: names.length > 1 ? `In ${names.length} languages` : 'In your language',
      text: names.length > 1 ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}, like your screenshots` : 'Add more languages any time',
    },
  ];
  return (
    <div className="grid h-full min-h-0 gap-8 overflow-y-auto p-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:p-10" data-testid="website-welcome">
      <div className="flex flex-col justify-center gap-6">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <SparklesIcon className="h-3.5 w-3.5" />
            Free, on your own GitHub
          </span>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">{appName ? `A website for ${appName}` : 'A website for your app'}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Apple and Google ask every app for a support page and a privacy policy. Make both here, plus a home page, and put them online in a few minutes.
          </p>
        </div>
        <ul className="space-y-3">
          {points.map((point) => (
            <li key={point.title} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <point.icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">{point.title}</span>
                <span className="block text-xs text-muted-foreground">{point.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <Button size="lg" className="w-full gap-2 sm:w-auto" onClick={onStart}>
            Make my website
          </Button>
          {!hasShots && <p className="text-xs text-muted-foreground">This project has no screenshots yet. The site works without them, or open the project with your screenshots first</p>}
        </div>
      </div>
      <div className="flex min-h-[420px] flex-col">
        {previewDraft && (
          <WebsitePreview
            draft={previewDraft}
            page="home"
            locale={previewDraft.baseLocale}
            device="desktop"
            scheme="light"
            shots={shots}
            known={known}
            address="your-name.github.io/your-app/"
            onNavigate={() => undefined}
          />
        )}
      </div>
    </div>
  );
}

export interface SetupResult {
  facts: SiteFacts;
  privacy: PrivacyAnswers;
  theme: SiteTheme;
  languages: string[];
  writeWithAi: boolean;
  notes: string;
}

const STEPS = ['Your app', 'Privacy', 'Look and languages'];

export function WebsiteSetupDialog({
  open,
  onOpenChange,
  initial,
  baseLocale,
  projectLocales,
  growthApps,
  ai,
  onLookup,
  onFinish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Omit<SetupResult, 'writeWithAi' | 'notes'>;
  baseLocale: string;
  projectLocales: string[];
  growthApps: GrowthAppChoice[];
  ai: AiStatus;
  /** The app's name, maker and icon from an App Store link, to fill the form with. */
  onLookup: (appStoreUrl: string) => Promise<Partial<SiteFacts> | null>;
  onFinish: (result: SetupResult) => void;
}) {
  const [step, setStep] = useState(0);
  const [facts, setFacts] = useState(initial.facts);
  const [privacy, setPrivacy] = useState(initial.privacy);
  const [theme, setTheme] = useState(initial.theme);
  const [languages, setLanguages] = useState(initial.languages);
  const [writeWithAi, setWriteWithAi] = useState(true);
  const [notes, setNotes] = useState('');
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setFacts(initial.facts);
    setPrivacy(initial.privacy);
    setTheme(initial.theme);
    setLanguages(initial.languages);
    setWriteWithAi(true);
    setNotes('');
    // Only a new opening starts the form again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lookup = async (url: string) => {
    setLookingUp(true);
    try {
      const found = await onLookup(url);
      if (found) setFacts((current) => ({ ...current, ...Object.fromEntries(Object.entries(found).filter(([key, value]) => value && !current[key as keyof SiteFacts])) }));
    } finally {
      setLookingUp(false);
    }
  };

  const emailOk = EMAIL.test(facts.supportEmail.trim());
  const reason =
    step === 0
      ? !facts.appName.trim()
        ? 'Give your app a name'
        : facts.supportEmail.trim() && !emailOk
          ? 'Check the support email'
          : null
      : step === 1
        ? privacy.answered
          ? null
          : 'Tick what your app collects, or Nothing'
        : null;

  const finish = () => onFinish({ facts: { ...facts, appName: facts.appName.trim() }, privacy: { ...privacy, answered: true }, theme, languages, writeWithAi: writeWithAi && ai.available, notes });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="website-setup">
        <DialogHeader>
          <DialogTitle>Make your website</DialogTitle>
          <DialogDescription>Three short steps. You can change every answer later</DialogDescription>
        </DialogHeader>
        <ol className="flex gap-2" aria-label="Steps">
          {STEPS.map((label, index) => (
            <li key={label} className={cn('flex flex-1 items-center gap-2 rounded-full px-3 py-1.5 text-xs', index === step ? 'bg-primary text-primary-foreground' : index < step ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} aria-current={index === step ? 'step' : undefined}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">{index < step ? <CheckIcon className="h-3 w-3" /> : index + 1}</span>
              <span className="truncate">{label}</span>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-4">
            {growthApps.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Fill in from Growth</p>
                <div className="flex flex-wrap gap-1.5">
                  {growthApps.map((app) => (
                    <Button
                      key={app.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-full text-xs"
                      onClick={() => {
                        if (app.store === 'appstore') {
                          const url = `https://apps.apple.com/app/id${app.id}`;
                          setFacts((current) => ({ ...current, appName: current.appName || app.name, appStoreUrl: url }));
                          void lookup(url);
                        } else {
                          setFacts((current) => ({ ...current, appName: current.appName || app.name, playStoreUrl: `https://play.google.com/store/apps/details?id=${app.id.replace(/^play:/, '')}` }));
                        }
                      }}
                    >
                      {app.name}
                      <span className="ml-1 text-muted-foreground">{app.store === 'appstore' ? 'App Store' : 'Google Play'}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <Field label="App name" htmlFor="setup-name">
              <Input id="setup-name" value={facts.appName} maxLength={LIMITS.appName} onChange={(event) => setFacts({ ...facts, appName: event.target.value })} autoFocus />
            </Field>
            <Field label="One line about your app" htmlFor="setup-tagline" hint="It goes under the headline. You can leave it empty">
              <Input id="setup-tagline" value={facts.tagline} maxLength={LIMITS.tagline} placeholder="What it does, in a few words" onChange={(event) => setFacts({ ...facts, tagline: event.target.value })} />
            </Field>
            <Field label="App Store link" htmlFor="setup-apple" hint="Paste it and the app fills in the rest it can">
              <div className="flex gap-1.5">
                <Input id="setup-apple" value={facts.appStoreUrl} placeholder="https://apps.apple.com/app/id..." onChange={(event) => setFacts({ ...facts, appStoreUrl: event.target.value.trim() })} />
                <Button type="button" variant="outline" className="shrink-0" disabled={!/id\d{6,}/.test(facts.appStoreUrl) || lookingUp} onClick={() => void lookup(facts.appStoreUrl)}>
                  {lookingUp ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Fill in'}
                </Button>
              </div>
            </Field>
            <Field label="Google Play link" htmlFor="setup-play">
              <Input id="setup-play" value={facts.playStoreUrl} placeholder="https://play.google.com/store/apps/details?id=..." onChange={(event) => setFacts({ ...facts, playStoreUrl: event.target.value.trim() })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Support email" htmlFor="setup-email" hint={facts.supportEmail && !emailOk ? 'That email looks wrong' : 'Apple and Google need a way to reach you'}>
                <Input id="setup-email" type="email" value={facts.supportEmail} placeholder="help@example.com" onChange={(event) => setFacts({ ...facts, supportEmail: event.target.value.trim() })} />
              </Field>
              <Field label="Your name or your company's" htmlFor="setup-developer" hint="The privacy policy says who makes the app">
                <Input id="setup-developer" value={facts.developer} maxLength={LIMITS.developer} onChange={(event) => setFacts({ ...facts, developer: event.target.value })} />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm">What does {facts.appName.trim() || 'your app'} collect?</p>
            <PrivacyQuestions answers={privacy} onChange={setPrivacy} idPrefix="setup-privacy" />
            <p className="text-xs text-muted-foreground">The privacy policy is written from these answers. It&apos;s a starting point, not legal advice</p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">Colors</p>
              <div className="flex items-center gap-3">
                <div className="h-12 w-28 shrink-0 rounded-lg ring-1 ring-border" style={{ background: `linear-gradient(135deg, ${theme.brand}, ${theme.brand2})` }} aria-hidden />
                <div className="flex gap-2">
                  {(['brand', 'brand2', 'accent'] as const).map((key) => (
                    <input
                      key={key}
                      type="color"
                      aria-label={{ brand: 'Main color', brand2: 'Second color', accent: 'Links and highlights' }[key]}
                      value={theme[key]}
                      onChange={(event) => setTheme({ ...theme, [key]: event.target.value, source: 'custom' })}
                      className="h-9 w-11 cursor-pointer rounded-md border bg-transparent p-1"
                    />
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {theme.source === 'screenshots' ? 'From your screenshots.' : theme.source === 'icon' ? 'From your app icon.' : theme.source === 'default' ? 'No screenshots to take colors from, so pick your own.' : 'Your own colors.'} You can change them later too
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Languages</p>
              <div className="flex flex-wrap gap-1.5">
                {[baseLocale, ...LOCALES.map((locale) => locale.code).filter((code) => code !== baseLocale && (projectLocales.includes(code) || languages.includes(code)))].map((code) => {
                  const on = languages.includes(code);
                  const base = code === baseLocale;
                  return (
                    <button
                      key={code}
                      type="button"
                      disabled={base}
                      aria-pressed={on}
                      onClick={() => setLanguages(on ? languages.filter((item) => item !== code) : [...languages, code])}
                      className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', on ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted', base && 'cursor-default')}
                    >
                      {getLocaleDef(code)?.nativeName ?? code}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">The languages of your screenshots. Add others under Languages later</p>
            </div>
            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Write the words with AI</span>
                  <span className="block text-xs text-muted-foreground">
                    {ai.available ? `${ai.label ?? 'The AI'} writes the home and support pages from your screenshots` : ai.reason ?? 'Set up an AI first'}
                  </span>
                </span>
                <Switch checked={writeWithAi && ai.available} disabled={!ai.available} onCheckedChange={setWriteWithAi} aria-label="Write the words with AI" />
              </label>
              {writeWithAi && ai.available && (
                <SiteTextarea
                  aria-label="Anything the AI should know"
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Anything the AI should know? Like who the app is for, or what makes it different"
                  className="text-sm"
                />
              )}
              {!ai.available && <p className="text-[11px] text-muted-foreground">Without an AI, the site starts with your screenshots&apos; words and simple sentences you can edit</p>}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Gated reason={reason}>
              <Button type="button" onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : finish())}>
                {step < STEPS.length - 1 ? 'Next' : 'Make my website'}
              </Button>
            </Gated>
            {reason && <span className="text-[11px] text-muted-foreground">{reason}</span>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
