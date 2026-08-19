"use client";

// App settings. Reached from the sidebar footer, where the Tips button used to
// be: tips moved in here as one section among others.
//
// Adding a setting: write a <SettingsSection>, and inside it a <SettingsRow>
// per control. Rows carry the label, the explanation and the control; the
// section carries the heading. Nothing else has to change.

import React, { useEffect, useRef, useState } from 'react';
import {
  LightbulbIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemePreference } from '@/lib/theme';
import { useEditorPreference } from '@/lib/editorPreferences';
import { isDiscoverConfigured } from '@/lib/discover/session';
import { shouldShowTipsOnStartup, setShowTipsOnStartup } from './TipsDialog';
import { cn } from '@/lib/utils';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
];

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-4 rounded-lg border p-4">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  htmlFor,
  control,
  /** Puts the control under the label instead of beside it, for wide controls. */
  stacked = false,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  control: React.ReactNode;
  stacked?: boolean;
}) {
  const text = (
    <div className="min-w-0 space-y-0.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  );

  if (stacked) {
    return (
      <div className="space-y-2.5">
        {text}
        {control}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      {text}
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // Arrow keys walk the group and only the checked option is tabbable, which is
  // what a radiogroup owes a keyboard: one stop in the tab order, and the ring
  // lands on what is actually selected rather than on whichever option happens
  // to be first.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : 0;
    if (step === 0) return;
    event.preventDefault();
    const current = THEME_OPTIONS.findIndex((option) => option.value === theme);
    const next = THEME_OPTIONS[(current + step + THEME_OPTIONS.length) % THEME_OPTIONS.length];
    setTheme(next.value);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-theme-option="${next.value}"]`)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={handleKeyDown}
      className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1"
    >
      {THEME_OPTIONS.map((option) => {
        const selected = theme === option.value;
        const OptionIcon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-theme-option={option.value}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTheme(option.value)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-md px-2 py-2.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              // A primary tint rather than a raised surface: the track is
              // bg-muted and the selected pill has to read as picked in both
              // themes, where "one step lighter" points opposite ways.
              selected
                ? 'bg-primary/15 text-foreground ring-1 ring-primary/50'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
            )}
          >
            <OptionIcon className={cn('h-4 w-4', selected && 'text-primary')} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the tips wizard. The layout closes this dialog first. */
  onOpenTips: () => void;
}

export function SettingsDialog({ open, onOpenChange, onOpenTips }: SettingsDialogProps) {
  const { theme, resolvedTheme } = useTheme();
  const [tipsOnStartup, setTipsOnStartup] = useState(true);
  // Both live in localStorage and both have readers that are already mounted
  // (the canvas, the auto saver), so they go through the shared preference
  // store rather than being read and written here. Flipping one takes effect
  // on the open project immediately.
  const [autoSaveToCloud, setAutoSaveToCloud] = useEditorPreference('cloudAutoSave');
  const [wheelZoom, setWheelZoom] = useEditorPreference('wheelZoom');
  const contentRef = useRef<HTMLDivElement>(null);

  // localStorage is only readable after mount, and the wizard's own checkbox
  // writes the same key, so re-read on every open rather than caching it.
  useEffect(() => {
    if (!open) return;
    setTipsOnStartup(shouldShowTipsOnStartup());
  }, [open]);

  const handleTipsOnStartupChange = (next: boolean) => {
    setTipsOnStartup(next);
    setShowTipsOnStartup(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        // focus:outline-none because onOpenAutoFocus parks focus on this
        // container, and a programmatically focused div draws the browser's
        // default ring around the whole dialog.
        className="sm:max-w-lg focus:outline-none"
        // No description element, so tell Radix not to look for one.
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Radix focuses the first tabbable child, which is the theme control:
          // the dialog would open with a focus ring sitting on a theme option,
          // reading as a second, contradictory selection. Park focus on the
          // dialog itself; Tab and Escape still work from there.
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <SettingsSection title="Appearance">
            <SettingsRow
              label="Theme"
              description={
                theme === 'system'
                  ? `Following your system, which is ${resolvedTheme} right now`
                  : 'Applies to the app only. Artboards stay light in both themes so a design looks the same on screen as it does in the exported image'
              }
              control={<ThemeToggle />}
              stacked
            />
          </SettingsSection>

          <SettingsSection title="Canvas">
            <SettingsRow
              label="Zoom with the mouse wheel"
              description="A wheel over the canvas zooms instead of scrolling. A trackpad is left alone, so two fingers still scroll, and Ctrl or Cmd with the wheel zooms either way"
              htmlFor="settings-wheel-zoom"
              control={
                <Switch id="settings-wheel-zoom" checked={wheelZoom} onCheckedChange={setWheelZoom} />
              }
            />
          </SettingsSection>

          {/* No backend in this build means there is no cloud to save to, and a
              switch for a feature that cannot run is worse than no switch. */}
          {isDiscoverConfigured() && (
            <SettingsSection title="Cloud">
              <SettingsRow
                label="Save to your cloud automatically"
                description="Keeps the open project in your cloud on its own, shortly after each round of edits. Sign in to use it, and watch the corner of the canvas to see where it got to"
                htmlFor="settings-cloud-auto-save"
                control={
                  <Switch
                    id="settings-cloud-auto-save"
                    checked={autoSaveToCloud}
                    onCheckedChange={setAutoSaveToCloud}
                  />
                }
              />
            </SettingsSection>
          )}

          <SettingsSection title="Tips">
            <SettingsRow
              label="Show tips at startup"
              description="Opens the tips wizard when you open the app"
              htmlFor="settings-tips-on-startup"
              control={
                <Switch
                  id="settings-tips-on-startup"
                  checked={tipsOnStartup}
                  onCheckedChange={handleTipsOnStartupChange}
                />
              }
            />
            <SettingsRow
              label="Tips"
              description="How to organise projects per store size, and how to keep a copy of your work"
              control={
                <Button variant="outline" size="sm" onClick={onOpenTips}>
                  <LightbulbIcon className="mr-1.5 h-3.5 w-3.5" />
                  View tips
                </Button>
              }
            />
          </SettingsSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}
