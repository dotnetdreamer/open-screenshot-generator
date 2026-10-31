"use client";

import React, { createContext, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ArtboardState, CreativeAssetKind } from '@/types/artboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { TouchDragBinding } from '@/hooks/use-touch-drag';
import {
  buildCreativeBoard,
  CREATIVE_LOOKS,
  readProjectLook,
  suggestedAppName,
  type CreativeLook,
} from '@/lib/creative/layouts';
import { creativeSpec } from '@/lib/creative/specs';
import { CREATIVE_LOOK_DRAG_TYPE, encodeCreativeLookChoice, type CreativeLookChoice } from '@/lib/creative/paletteDrag';
import { CreativeLookThumb } from './CreativeLookThumb';
import type { PaletteTilePayload } from '../ElementPalette';

/** What the Header tab draws its designs from. The layout provides it. */
export interface StoreArtSource {
  /** The base document, every language. */
  artboards: ArtboardState[];
  projectId: string | null;
  projectName: string;
}

/**
 * A context and not a palette prop, because the palette is memoized: handing
 * it the artboards would rebuild every tile in every tab on each edit. Only this
 * tab reads them, and only while it is open, since an inactive tab's content is
 * unmounted.
 */
export const StoreArtSourceContext = createContext<StoreArtSource | null>(null);

const KINDS: CreativeAssetKind[] = ['header', 'search', 'universal'];

/** What a tile calls its design in its accessible name and on the drag ghost. */
const NOUN: Record<CreativeAssetKind, string> = {
  header: 'header',
  search: 'search result',
  universal: 'universal image',
};

const NO_BOARDS: ArtboardState[] = [];

/**
 * App names typed into the tab, per project. Module scope, so a name survives
 * the tab being closed and opened again, which unmounts it.
 */
const typedNames = new Map<string, string>();

/**
 * The palette's Header tab: every App Store header and search design, drawn
 * from the open project the same way the add dialog draws them. A click adds
 * one at the start of the canvas; a drag, by mouse or by finger, puts it after
 * the artboard it lands on.
 */
export function StoreArtPaletteTab({
  onAdd,
  bindTouch,
}: {
  onAdd: (choice: CreativeLookChoice) => void;
  /** The palette's long-press drag, so a finger can drop a design too. */
  bindTouch?: (payload: PaletteTilePayload) => TouchDragBinding;
}) {
  const source = useContext(StoreArtSourceContext);
  const nameKey = source?.projectId ?? '';
  const [, setTypedVersion] = useState(0);
  const appName = typedNames.get(nameKey) ?? suggestedAppName(source?.projectName ?? '');
  const changeAppName = (name: string) => {
    typedNames.set(nameKey, name);
    setTypedVersion((version) => version + 1);
  };
  const [showCrop, setShowCrop] = useState(true);

  // Every design is a whole artboard, so they are rebuilt at low priority:
  // typing in a text box or the name field stays quick, and the designs catch up.
  const artboards = useDeferredValue(source?.artboards ?? NO_BOARDS);
  const deferredName = useDeferredValue(appName);
  const look = useMemo(() => readProjectLook(artboards, deferredName), [artboards, deferredName]);
  const sections = useMemo(
    () =>
      KINDS.map((kind) => ({
        kind,
        spec: creativeSpec(kind),
        designs: CREATIVE_LOOKS[kind].map((entry) => ({
          entry,
          // A seed per design, so no two designs on the page share element ids.
          board: buildCreativeBoard(kind, entry.id, look, `palette-${kind}-${entry.id}`),
        })),
      })),
    [look]
  );
  const languageCount = 1 + look.locales.length;

  // The designs are drawn at the column's width, measured, so they fill the
  // sidebar at whatever size it is.
  const listRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(0);
  const hasSource = source !== null;
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const measure = () => setListWidth(Math.floor(node.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasSource]);
  // The tile's own padding, 6px a side.
  const thumbWidth = listWidth - 12;

  if (!source) return null;

  return (
    <div className="h-full overflow-y-auto">
      <Card className="shadow-md">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-base">App Store header and search</CardTitle>
        </CardHeader>
        <CardContent className="p-2 pt-0">
          <p className="mb-3 px-1 text-[11px] leading-snug text-muted-foreground">
            Built from this project&apos;s colours, type, headline and screens
            {languageCount > 1 ? `, in all ${languageCount} of its languages` : ''}. Click one to add it at the
            start of the canvas, or drag it onto the canvas to put it after an artboard.
          </p>
          <div className="mb-2 space-y-1 px-1">
            <Label htmlFor="palette-store-art-name" className="text-xs">
              App name
            </Label>
            <Input
              id="palette-store-art-name"
              value={appName}
              onChange={(event) => changeAppName(event.target.value)}
              placeholder="As it reads on the App Store"
              className="h-8 text-sm"
            />
          </div>
          <div className="mb-3 flex items-center justify-between gap-2 px-1">
            <Label htmlFor="palette-store-art-crop" className="text-xs font-normal">
              Show what an iPhone shows
            </Label>
            <Switch id="palette-store-art-crop" checked={showCrop} onCheckedChange={setShowCrop} />
          </div>

          <div ref={listRef} className="space-y-3">
            {thumbWidth > 0 &&
              sections.map(({ kind, spec, designs }) => (
                <section key={kind} aria-label={spec.label}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 px-1">
                    <h3 className="text-xs font-semibold">{spec.label}</h3>
                    <span className="text-[10px] text-muted-foreground">{spec.sizeLabel}</span>
                  </div>
                  <div className="grid gap-1">
                    {designs.map(({ entry, board }) => (
                      <DesignTile
                        key={entry.id}
                        kind={kind}
                        entry={entry}
                        board={board}
                        width={thumbWidth}
                        showCrop={showCrop}
                        appName={appName}
                        onAdd={onAdd}
                        bindTouch={bindTouch}
                      />
                    ))}
                  </div>
                </section>
              ))}
          </div>

          <p className="mt-3 rounded-md bg-accent/15 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
            Shows on iOS 27 and iPadOS 27. The label next to each artboard&apos;s name says whether it is ready
            for App Store Connect.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function DesignTile({
  kind,
  entry,
  board,
  width,
  showCrop,
  appName,
  onAdd,
  bindTouch,
}: {
  kind: CreativeAssetKind;
  entry: CreativeLook;
  board: ArtboardState;
  width: number;
  showCrop: boolean;
  appName: string;
  onAdd: (choice: CreativeLookChoice) => void;
  bindTouch?: (payload: PaletteTilePayload) => TouchDragBinding;
}) {
  const choice: CreativeLookChoice = { kind, lookId: entry.id, appName };
  const label = `${entry.label} ${NOUN[kind]}`;
  return (
    <button
      type="button"
      className="flex w-full flex-col gap-1 rounded-lg p-1.5 text-left transition-colors hover:bg-accent/25 cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(CREATIVE_LOOK_DRAG_TYPE, encodeCreativeLookChoice(choice));
        event.dataTransfer.effectAllowed = 'copy';
        // The whole tile follows the pointer, not whichever picture inside it
        // the drag started on.
        const box = event.currentTarget.getBoundingClientRect();
        event.dataTransfer.setDragImage(event.currentTarget, event.clientX - box.left, event.clientY - box.top);
      }}
      onClick={() => onAdd(choice)}
      {...(bindTouch ? bindTouch({ label, creativeLook: choice }) : {})}
      aria-label={`Add the ${label}`}
    >
      {/* Inert, so the pictures inside a design never start a drag of their own. */}
      <span className="pointer-events-none block">
        <CreativeLookThumb
          board={board}
          width={width}
          placement={kind === 'search' ? 'search' : 'header'}
          showCrop={showCrop}
        />
      </span>
      <span className="block px-0.5">
        <span className="block text-xs font-semibold leading-tight text-foreground">{entry.label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{entry.blurb}</span>
      </span>
    </button>
  );
}
