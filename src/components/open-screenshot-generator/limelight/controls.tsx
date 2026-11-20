"use client";

// Small controls the Limelight panels share: a labelled slider with its value,
// a section heading, a row of choices and a colour well. A slider reports
// every step while it moves ('live') and once more when it is let go ('done'),
// so a drag is one undo step.

import React from 'react';
import { InfoIcon } from 'lucide-react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type ChangePhase = 'live' | 'done';

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b px-4 py-4 last:border-b-0">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** An (i) with the longer explanation behind it, as Capture's InfoTip does. */
export function Info({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex text-muted-foreground hover:text-foreground" aria-label={text}>
          <InfoIcon className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  info,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** How the value reads beside the label. */
  format?: (value: number) => string;
  info?: string;
  onChange: (value: number, phase: ChangePhase) => void;
  disabled?: boolean;
}) {
  const shown = format ? format(value) : `${Math.round(value * 100) / 100}`;
  return (
    <div className={cn('space-y-1.5', disabled && 'opacity-50')}>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="font-medium">{label}</span>
        {info && <Info text={info} />}
        <span className="ml-auto tabular-nums text-muted-foreground">{shown}</span>
      </div>
      {/* The app's Slider names only its root, so the thumb, which is what
          a screen reader and the tests find as the slider, is named here. */}
      <SliderPrimitive.Root
        className="relative flex w-full touch-none select-none items-center py-1"
        value={[Math.min(max, Math.max(min, value))]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([next]) => onChange(next, 'live')}
        onValueCommit={([next]) => onChange(next, 'done')}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={label}
          className="block h-4 w-4 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none"
        />
      </SliderPrimitive.Root>
    </div>
  );
}

export function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 3,
}: {
  label?: string;
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
  columns?: number;
}) {
  return (
    <div className="space-y-1.5">
      {label && <div className="text-xs font-medium">{label}</div>}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
              option.value === value ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorWell({ label, value, onChange }: { label: string; value: string; onChange: (value: string, phase: ChangePhase) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md border" style={{ background: value }}>
        <input
          type="color"
          value={value}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(event) => onChange(event.target.value, 'live')}
          onBlur={(event) => onChange(event.target.value, 'done')}
        />
      </span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto font-mono text-[11px] uppercase text-muted-foreground">{value}</span>
    </label>
  );
}

/** Seconds as the timeline reads them: 2.4 s, or 1:05.0 past a minute. */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 60) return `${s.toFixed(1)} s`;
  const minutes = Math.floor(s / 60);
  return `${minutes}:${(s - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

/** The playhead's clock: 0:02.4. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  return `${minutes}:${(s - minutes * 60).toFixed(1).padStart(4, '0')}`;
}
