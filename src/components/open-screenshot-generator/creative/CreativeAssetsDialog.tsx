"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { InfoIcon } from 'lucide-react';
import type { ArtboardState, CreativeAssetKind } from '@/types/artboard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { CreativeLookThumb } from './CreativeLookThumb';
import {
  buildCreativeBoard,
  CREATIVE_LOOKS,
  defaultLook,
  readProjectLook,
  suggestedAppName,
  type CreativeLook,
} from '@/lib/creative/layouts';
import { creativeBoards, creativeSpec, type CreativePlacement } from '@/lib/creative/specs';

type Mode = 'pair' | 'universal';

/** Card width per kind, so a row of looks reads at a glance. */
const CARD_WIDTH: Record<CreativeAssetKind, number> = { header: 300, search: 228, universal: 352 };

interface CreativeAssetsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The base document, every language. */
  artboards: ArtboardState[];
  projectName: string;
  /** Hands back the finished artboards, header first. */
  onAdd: (boards: ArtboardState[]) => void;
}

/**
 * Pick the App Store header and search art for this project.
 *
 * Every card is a real artboard built from the project's own look (see
 * lib/creative/layouts.ts), so what is picked here is exactly what lands on
 * the canvas, translations included. The shade over each card is about what an
 * iPhone shows of it (measured, see specs.ts): most of a header never reaches
 * a phone, and this is the moment that is cheapest to learn.
 */
export function CreativeAssetsDialog({ isOpen, onOpenChange, artboards, projectName, onAdd }: CreativeAssetsDialogProps) {
  const [mode, setMode] = useState<Mode>('pair');
  const [picked, setPicked] = useState<Record<CreativeAssetKind, string>>({
    header: defaultLook('header'),
    search: defaultLook('search'),
    universal: defaultLook('universal'),
  });
  const [showCrop, setShowCrop] = useState(true);
  const [appName, setAppName] = useState('');

  // A fresh start each time it opens, like the export dialog. The name starts
  // from the project's (see suggestedAppName).
  useEffect(() => {
    if (!isOpen) return;
    setMode('pair');
    setPicked({ header: defaultLook('header'), search: defaultLook('search'), universal: defaultLook('universal') });
    setAppName(suggestedAppName(projectName));
    // Only on opening: a rename while it is open must not wipe what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const look = useMemo(() => readProjectLook(artboards, appName), [artboards, appName]);
  const languageCount = 1 + look.locales.length;
  const existing = useMemo(() => creativeBoards(artboards).length, [artboards]);

  // Only built while open: each card is a whole artboard.
  const cards = useMemo(() => {
    if (!isOpen) return null;
    const build = (kind: CreativeAssetKind) =>
      CREATIVE_LOOKS[kind].map((entry) => ({ entry, board: buildCreativeBoard(kind, entry.id, look, 'preview') }));
    return { header: build('header'), search: build('search'), universal: build('universal') };
  }, [isOpen, look]);

  const kinds: CreativeAssetKind[] = mode === 'pair' ? ['header', 'search'] : ['universal'];

  const add = () => {
    const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    onAdd(kinds.map((kind) => buildCreativeBoard(kind, picked[kind], look, `${seed}${kind[0]}`)));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-[1040px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4">
          <DialogTitle>App Store header and search</DialogTitle>
          <DialogDescription>
            New in iOS 27. Built from this project&apos;s colours, type, headline and screens
            {languageCount > 1 ? `, in all ${languageCount} of its languages` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="creative-app-name" className="shrink-0 text-xs">
                App name
              </Label>
              <Input
                id="creative-app-name"
                value={appName}
                onChange={(event) => setAppName(event.target.value)}
                placeholder="As it reads on the App Store"
                className="h-8 w-56 text-sm"
              />
            </div>
            <div className="flex rounded-lg bg-muted p-1" role="radiogroup" aria-label="What to make">
              {(
                [
                  { value: 'pair', label: 'Header and search result' },
                  { value: 'universal', label: 'One universal image' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.value}
                  onClick={() => setMode(option.value)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    mode === option.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="creative-show-crop" checked={showCrop} onCheckedChange={setShowCrop} />
              <Label htmlFor="creative-show-crop" className="text-xs font-normal">
                Show what an iPhone shows
              </Label>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {mode === 'pair'
              ? 'Two designs: a header that shows your brand, and a search result that says what the app does. Apple recommends this split'
              : 'One 16:9 PNG that App Store Connect uses in both places. Its safe area is small, so keep it to your name or one image'}
          </p>

          {cards &&
            kinds.map((kind) => {
              const spec = creativeSpec(kind);
              return (
                <section key={kind} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold">{spec.label}</h3>
                    <span className="text-xs text-muted-foreground">{spec.sizeLabel}</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {cards[kind].map(({ entry, board }) => (
                      <LookCard
                        key={entry.id}
                        entry={entry}
                        board={board}
                        width={CARD_WIDTH[kind]}
                        placement={kind === 'search' ? 'search' : 'header'}
                        showCrop={showCrop}
                        selected={picked[kind] === entry.id}
                        onSelect={() => setPicked((current) => ({ ...current, [kind]: entry.id }))}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

          <p className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Shows on iOS 27 and iPadOS 27. In App Store Connect, add it under Header and Search Results on the
              version page, or submit it on its own from the Asset Library.
              {existing > 0 ? ' This project already has some, and these go next to them so you can compare.' : ''}
            </span>
          </p>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={add}>{kinds.length === 1 ? 'Add 1 artboard' : `Add ${kinds.length} artboards`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LookCard({
  entry,
  board,
  width,
  placement,
  showCrop,
  selected,
  onSelect,
}: {
  entry: CreativeLook;
  board: ArtboardState;
  width: number;
  placement: CreativePlacement;
  showCrop: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-1.5 rounded-lg p-1.5 text-left transition-colors',
        selected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted'
      )}
      style={{ width: width + 12 }}
    >
      <CreativeLookThumb board={board} width={width} placement={placement} showCrop={showCrop} />
      <div className="px-0.5">
        <p className="text-xs font-medium">{entry.label}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{entry.blurb}</p>
      </div>
    </button>
  );
}
