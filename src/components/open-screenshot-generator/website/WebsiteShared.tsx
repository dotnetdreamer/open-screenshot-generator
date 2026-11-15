"use client";

// Pieces the Website view's screens share: a labelled field, a section of the
// editing panel, the privacy questions (asked when a site is made and again
// under Privacy policy), a copy button, and which AI can write right now.

import React, { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { growthAiLabel, growthAiUnavailableReason, isGrowthAiAvailable, onGrowthAiChange } from '@/lib/growth/ai';
import { PRIVACY_QUESTIONS, cleanPrivacy } from '@/lib/website/privacy';
import type { DataUse, PrivacyAnswers } from '@/lib/website/types';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';

export function Field({
  label,
  htmlFor,
  hint,
  info,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  /** Longer details behind an (i). */
  info?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={htmlFor} className="text-xs font-medium">
          {label}
        </Label>
        {info && <InfoTip label={`About ${label.toLowerCase()}`}>{info}</InfoTip>}
      </div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The app's Textarea in the interface face. The shared one sets no font, so
 * a textarea falls back to the browser's monospace.
 */
export const SiteTextarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<typeof Textarea>>(({ className, ...props }, ref) => (
  <Textarea ref={ref} className={cn('font-sans', className)} {...props} />
));
SiteTextarea.displayName = 'SiteTextarea';

export function PanelSection({ title, hint, children, actions }: { title: string; hint?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A button that copies `text`, and says so for a moment. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('h-7 gap-1 px-2 text-xs', className)}
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch((error) => console.error('Copying failed', error));
      }}
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export interface AiStatus {
  available: boolean;
  label: string | null;
  /** Why no AI can write now, null when one can. */
  reason: string | null;
}

/** Which AI writes for the site: the one Growth writes with (growth/ai.ts). */
export function useAiStatus(active: boolean): AiStatus {
  const [status, setStatus] = useState<AiStatus>({ available: false, label: null, reason: 'Looking for an AI' });
  useEffect(() => {
    if (!active) return;
    const refresh = () => setStatus({ available: isGrowthAiAvailable(), label: growthAiLabel(), reason: growthAiUnavailableReason() });
    refresh();
    return onGrowthAiChange(refresh);
  }, [active]);
  return status;
}

/** The privacy questions, each a tick with the services behind it. */
export function PrivacyQuestions({ answers, onChange, idPrefix }: { answers: PrivacyAnswers; onChange: (next: PrivacyAnswers) => void; idPrefix: string }) {
  const nothing = answers.answered && answers.uses.length === 0;
  const set = (next: Partial<PrivacyAnswers>) => onChange(cleanPrivacy({ ...answers, ...next, answered: true }));
  const toggle = (use: DataUse, on: boolean) => set({ uses: on ? [...answers.uses, use] : answers.uses.filter((item) => item !== use) });
  return (
    <div className="space-y-3">
      <label
        htmlFor={`${idPrefix}-nothing`}
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
          nothing ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/50'
        )}
      >
        <Checkbox
          id={`${idPrefix}-nothing`}
          checked={nothing}
          onCheckedChange={(value) => {
            if (value === true) set({ uses: [], services: {}, personalizedAds: false });
          }}
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">Nothing</span>
          <span className="block text-xs text-muted-foreground">My app collects no personal data. Everything stays on the phone</span>
        </span>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {PRIVACY_QUESTIONS.map((question) => {
          const on = answers.uses.includes(question.use);
          const id = `${idPrefix}-${question.use}`;
          return (
            <div key={question.use} className={cn('rounded-lg border p-3 transition-colors', on ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/40')}>
              <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
                <Checkbox id={id} checked={on} onCheckedChange={(value) => toggle(question.use, value === true)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{question.label}</span>
                  <span className="block text-xs text-muted-foreground">{question.hint}</span>
                </span>
              </label>
              {on && question.services && (
                <Input
                  aria-label={`Services for ${question.label.toLowerCase()}`}
                  value={answers.services[question.use] ?? ''}
                  onChange={(event) => onChange({ ...answers, answered: true, services: { ...answers.services, [question.use]: event.target.value } })}
                  onBlur={() => onChange(cleanPrivacy({ ...answers, answered: true }))}
                  placeholder={`Which services? Like ${question.services}`}
                  className="mt-2 h-8 text-xs"
                />
              )}
              {on && question.use === 'ads' && (
                <label className="mt-2 flex items-center justify-between gap-2 text-xs">
                  <span>Ads are picked from what people do</span>
                  <Switch
                    checked={answers.personalizedAds}
                    disabled={answers.children}
                    onCheckedChange={(value) => set({ personalizedAds: value })}
                    aria-label="Ads are picked from what people do"
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
      {answers.uses.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="site-privacy-services-note">
          The policy says the services you name are the only companies that get people&apos;s data, so name every one.
        </p>
      )}
      <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Made for children under 13</span>
          <span className="block text-xs text-muted-foreground">Turn this on if kids are who the app is for</span>
        </span>
        <Switch checked={answers.children} onCheckedChange={(value) => set({ children: value })} aria-label="Made for children under 13" />
      </label>
      {answers.uses.length > 0 && (
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Delete data within a month of being asked</span>
            <span className="block text-xs text-muted-foreground">Turn this on only if you do. The policy then promises it</span>
          </span>
          <Switch
            checked={!!answers.deleteWithinMonth}
            onCheckedChange={(value) => set({ deleteWithinMonth: value })}
            aria-label="Delete data within a month of being asked"
          />
        </label>
      )}
    </div>
  );
}
