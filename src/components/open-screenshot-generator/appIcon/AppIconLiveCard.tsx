"use client";

import React from 'react';
import { XIcon } from 'lucide-react';
import type { ArtboardState } from '@/types/artboard';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useEditorPreference } from '@/lib/editorPreferences';
import { AppIconArt, type IconLook, type IconShape } from './AppIconArt';

const LOOKS: { label: string; look: IconLook; shape: IconShape }[] = [
  { label: 'Light', look: 'light', shape: 'apple' },
  { label: 'Dark', look: 'dark', shape: 'apple' },
  { label: 'Tinted', look: 'tinted', shape: 'apple' },
  { label: 'Android', look: 'light', shape: 'circle' },
];

/**
 * The icon at Home Screen size while it is being designed: the four looks
 * people will see it in, live as the canvas changes, over the canvas's
 * bottom right corner whenever the icon artboard is the one selected.
 */
export function AppIconLiveCard({
  board,
  onOpenStudio,
  onClose,
}: {
  board: ArtboardState;
  onOpenStudio: () => void;
  onClose: () => void;
}) {
  const [guides, setGuides] = useEditorPreference('appIconGuides');
  return (
    <div
      className="pointer-events-auto w-[296px] rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur"
      data-testid="app-icon-live-card"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Your app icon on a phone</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Hide the live preview">
          <XIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex items-start justify-between rounded-lg bg-muted/50 px-2 py-2.5">
        {LOOKS.map((entry) => (
          <figure key={entry.label} className="flex w-[60px] flex-col items-center gap-1">
            <AppIconArt board={board} size={52} shape={entry.shape} look={entry.look} label={`${entry.label} icon`} />
            <figcaption className="text-[10px] text-muted-foreground">{entry.label}</figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Switch id="app-icon-live-guides" checked={guides} onCheckedChange={setGuides} className="scale-90" />
          <Label htmlFor="app-icon-live-guides" className="text-[11px] font-normal text-muted-foreground">
            Guides
          </Label>
        </div>
        <Button size="sm" className="h-7 px-3 text-xs" onClick={onOpenStudio}>
          Preview and export
        </Button>
      </div>
    </div>
  );
}
