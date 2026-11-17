"use client";
// The Every device view: the project's design on every store size at once.
//
// Each device's artboards are laid out again from the design (src/lib/deviceSets/),
// live, in the language picked here. A person can pick another layout for any
// artboard, add a screenshot a device needs of its own (an iPad screenshot for
// the iPad set, which turns its frame into an iPad), and choose which sets the
// project exports. Everything chosen is written to the artboards through the
// editor's one door (onCommit), so it is saved, undone and shared like any edit.
//
// Switching devices keeps each artboard's preview mounted, so its layers glide
// to their places on the new screen (.osg-morph in globals.css).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckIcon,
  FolderPlusIcon,
  ImagePlusIcon,
  LayoutGridIcon,
  Loader2Icon,
  RectangleHorizontalIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import type { ArtboardState, DeviceSetLayout } from '@/types/artboard';
import type { DeviceFormat } from '@/lib/deviceRegistry';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { StaticArtboard, count3dDevices } from '../StaticArtboard';
import { flattenBoard3d } from '../start/quickstart/deckLayout';
import { InfoTip } from '../capture/InfoTip';
import { computeSpill, spillFor } from '@/lib/spanArtboards';
import { getBaseLocale, getProjectLocales } from '@/lib/i18n/localization';
import { localeName } from '@/lib/i18n/locales';
import { DEVICE_SET_STORES, DEVICE_SET_TARGETS, type DeviceSetTarget } from '@/lib/deviceSets/targets';
import { layoutsFor, sameShape, type DeviceLayout } from '@/lib/deviceSets/layout';
import { boardOnDevice, ownFormatOf, planFor, projectSetFormats, withBoardSet, withScreen, withSetFormats } from '@/lib/deviceSets/sets';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';
import { measureText } from '@/lib/deviceSets/measure';
import { saveImageBlobAsset } from '@/lib/mcp/assetStore';
import { useDeviceSets, type BoardOnDevice, type DeviceSetView } from './useDeviceSets';

/** 3D frames drawn live at once; the rest are drawn flat (see count3dDevices). */
const LIVE_3D_BUDGET = 6;

/** The widest an artboard is drawn in the strip, in CSS pixels. */
const MAX_CARD_WIDTH = 560;

const LAYOUT_NAMES: Record<DeviceLayout, string> = {
  stacked: 'Like your design',
  beside: 'Text on the left',
  'beside-flipped': 'Text on the right',
  scaled: 'Shrink to fit',
};

/** What a person would call the device a screenshot is for. */
function withArticle(name: string): string {
  return `${/^(i|[aeiou])/i.test(name) && !/^one/i.test(name) ? 'an' : 'a'} ${name}`;
}

function shotName(target: DeviceSetTarget): string {
  if (target.kind === 'desktop') return 'Mac';
  if (target.kind === 'tablet') return target.platform === 'ios' ? 'iPad' : 'tablet';
  return target.platform === 'ios' ? 'iPhone' : 'Android phone';
}

export interface EveryDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project as stored, in its main language. */
  artboards: ArtboardState[];
  /** The language the canvas shows, null for the main one. */
  activeLocale: string | null;
  /** Names the document on the canvas now, so work that ends later lands only in it. */
  canvasToken: () => number;
  /**
   * Writes a change to the project as it is when the change lands, never as
   * it was when the work began, so an edit made meanwhile stays. With `token`,
   * the write is turned down when another document is on the canvas by then.
   * False when the editor turned the change down.
   */
  onCommit: (change: (current: ArtboardState[]) => ArtboardState[], label: string, token?: number) => boolean;
  /** Makes a project of one device's set and opens it. */
  onOpenAsProject: (format: DeviceFormat) => Promise<void>;
  /** Opens the Export dialog. */
  onExport: () => void;
}

export function EveryDeviceDialog({
  open,
  onOpenChange,
  artboards,
  activeLocale,
  canvasToken,
  onCommit,
  onOpenAsProject,
  onExport,
}: EveryDeviceDialogProps) {
  const { toast } = useToast();
  // The device the project is designed at, read from its size: a set made for
  // the iPad can keep its phone frames, and is still the iPad's.
  const ownFormat = useMemo(() => ownFormatOf(artboards), [artboards]);
  const [view, setView] = useState<'device' | 'all'>('device');
  const [selected, setSelected] = useState<DeviceFormat>(() => firstOther(ownFormat));
  const [locale, setLocale] = useState<string | null>(activeLocale);
  const [opening, setOpening] = useState(false);

  // A fresh look each time the view opens: the canvas language, a device that is not the design's own.
  useEffect(() => {
    if (!open) return;
    setLocale(activeLocale);
    setSelected((current) => (current === ownFormat ? firstOther(ownFormat) : current));
  }, [open, activeLocale, ownFormat]);

  const sets = useDeviceSets(artboards, DEVICE_SET_TARGETS, ownFormat, locale, open);
  const making = useMemo(() => projectSetFormats(artboards), [artboards]);
  const baseLocale = useMemo(() => getBaseLocale(artboards), [artboards]);
  const languages = useMemo(() => getProjectLocales(artboards).map((entry) => entry.code), [artboards]);
  const current = sets.get(selected);

  const commit = useCallback(
    (change: (current: ArtboardState[]) => ArtboardState[], label: string, token?: number) => {
      if (!onCommit(change, label, token)) {
        toast({
          title: "That wasn't saved",
          description: 'The project was busy, or you opened another project. Please try again.',
        });
      }
    },
    [onCommit, toast]
  );

  const setLayout = (boardId: string, target: DeviceSetTarget, layout: DeviceLayout | null) =>
    commit(
      (current) =>
        withBoardSet(current, boardId, target.id, (set) => ({ ...set, layout: (layout ?? undefined) as DeviceSetLayout | undefined })),
      `Layout on ${target.name}`
    );

  const setShot = async (board: BoardOnDevice, elementId: string, target: DeviceSetTarget, file: File | null) => {
    const forLocale = locale && locale !== baseLocale ? locale : null;
    if (!file) {
      commit(
        (current) => withBoardSet(current, board.base.id, target.id, (set) => withScreen(set, elementId, forLocale, null)),
        `Remove the ${shotName(target)} screenshot`
      );
      return;
    }
    if (forLocale && !board.base.deviceSets?.[target.id]?.screens?.[elementId]) {
      toast({
        title: `Add the ${localeName(baseLocale)} one first`,
        description: `The ${localeName(baseLocale)} ${shotName(target)} screenshot shows in every language. After that, you can add one for each language.`,
      });
      return;
    }
    // Storing the picture takes a moment, and the project can change meanwhile.
    const token = canvasToken();
    try {
      const stored = await saveImageBlobAsset(file, { name: file.name });
      const shot = {
        screenshotSrc: stored.ref,
        naturalScreenshotWidth: stored.width,
        naturalScreenshotHeight: stored.height,
      };
      commit(
        (current) => withBoardSet(current, board.base.id, target.id, (set) => withScreen(set, elementId, forLocale, shot)),
        `${shotName(target)} screenshot`,
        token
      );
      // The frame turns into the device's whatever the picture's shape, so say
      // when the picture is turned the other way and will be cut to fit.
      const upright = target.frame ? getDeviceDescriptor(target.frame).nativeAspect < 1 : target.kind === 'phone';
      if (stored.width && stored.height && stored.width > stored.height === upright) {
        toast({
          title: stored.width > stored.height ? 'That screenshot is sideways' : 'That screenshot is upright',
          description:
            !upright
              ? `The ${shotName(target)} is wide, so the top and bottom of your screenshot are cut off. Use a screenshot from ${withArticle(shotName(target))} to show all of it.`
              : `The ${shotName(target)} stands upright, so the sides of your screenshot are cut off. Take it with the ${shotName(target)} upright to show all of it.`,
        });
      }
    } catch (error) {
      console.error('Could not store the screenshot', error);
      toast({ title: "That picture couldn't be opened", description: 'Try a PNG or a JPEG.', variant: 'destructive' });
    }
  };

  const setMaking = (target: DeviceSetTarget, on: boolean) =>
    commit(
      (current) => {
        const list = projectSetFormats(current);
        return withSetFormats(current, on ? [...list, target.id] : list.filter((id) => id !== target.id));
      },
      on ? `Export ${target.name} screenshots` : `Stop exporting ${target.name} screenshots`
    );

  const openAsProject = async () => {
    if (!current || current.own) return;
    setOpening(true);
    try {
      await onOpenAsProject(current.target.id);
      onOpenChange(false);
    } finally {
      setOpening(false);
    }
  };

  const hasBoards = (current?.boards.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-every-device=""
        className="flex h-[92vh] w-[min(1500px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3 pr-12">
          <div className="min-w-0">
            <DialogTitle className="text-base">Your screenshots on every device</DialogTitle>
            <DialogDescription className="text-xs">
              Each store wants screenshots in its own sizes. We&apos;ve remade yours for each device. Turn on Export for the ones you need.
            </DialogDescription>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {languages.length > 0 && (
              <Select
                value={locale && locale !== baseLocale ? locale : baseLocale}
                onValueChange={(value) => setLocale(value === baseLocale ? null : value)}
              >
                <SelectTrigger className="h-8 w-44 text-xs" aria-label="Language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[baseLocale, ...languages].map((code) => (
                    <SelectItem key={code} value={code} className="text-xs">
                      {localeName(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div role="radiogroup" aria-label="What to show" className="flex rounded-md border p-0.5">
              <ViewButton active={view === 'device'} onClick={() => setView('device')} icon={<SquareIcon className="h-3.5 w-3.5" />}>
                One device
              </ViewButton>
              <ViewButton active={view === 'all'} onClick={() => setView('all')} icon={<LayoutGridIcon className="h-3.5 w-3.5" />}>
                All devices
              </ViewButton>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <DeviceList
            sets={sets}
            selected={view === 'device' ? selected : null}
            making={making}
            onSelect={(id) => {
              setSelected(id);
              setView('device');
            }}
            onMaking={setMaking}
          />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/40">
            {!hasBoards ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                Add a screenshot to see it on other devices
              </div>
            ) : view === 'all' ? (
              <Overview
                sets={sets}
                onPick={(id) => {
                  setSelected(id);
                  setView('device');
                }}
              />
            ) : current ? (
              <SetStrip
                set={current}
                locale={locale}
                onLayout={(boardId, layout) => setLayout(boardId, current.target, layout)}
                onShot={(board, elementId, file) => void setShot(board, elementId, current.target, file)}
              />
            ) : null}
          </main>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <p className="mr-auto text-xs text-muted-foreground">
            {making.length > 0
              ? `When you export, you also get: ${DEVICE_SET_TARGETS.filter((t) => making.includes(t.id)).map((t) => t.name).join(', ')}.`
              : 'Turn on Export next to a device to get its screenshots too.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!current || current.own || !hasBoards || opening || view !== 'device'}
            onClick={() => void openAsProject()}
            title={current && !current.own ? `A new project with the ${current.target.name} screenshots, to change by hand. This project stays the same.` : undefined}
          >
            {opening ? <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" /> : <FolderPlusIcon className="mr-1.5 h-4 w-4" />}
            {current && !current.own ? `Make ${withArticle(current.target.name)} project` : 'Make a project for this device'}
          </Button>
          <Button size="sm" onClick={onExport}>
            <UploadIcon className="mr-1.5 h-4 w-4" />
            Export
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function firstOther(own: DeviceFormat | null): DeviceFormat {
  return (DEVICE_SET_TARGETS.find((target) => target.kind === 'tablet' && target.id !== own) ?? DEVICE_SET_TARGETS[0]).id;
}

function ViewButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** A small outline of the device's screen shape: tall for a phone, squarer for an iPad, wide for a Mac. */
function ShapeGlyph({ target, active }: { target: DeviceSetTarget; active: boolean }) {
  const { width, height } = target.preset.artboard;
  const box = 26;
  const w = width >= height ? box : Math.round((box * width) / height);
  const h = width >= height ? Math.round((box * height) / width) : box;
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden="true">
      <span
        className={cn('rounded-[3px] border-2 transition-colors', active ? 'border-primary' : 'border-muted-foreground/60')}
        style={{ width: w, height: h }}
      />
    </span>
  );
}

function statusOf(set: DeviceSetView | undefined): { tone: 'ok' | 'warn' | 'own'; text: string } {
  if (!set) return { tone: 'ok', text: '' };
  if (set.own) return { tone: 'own', text: 'Your original' };
  if (set.needsShots > 0) return { tone: 'warn', text: `Needs ${shotName(set.target)} screenshots` };
  if (set.shrunk > 0) return { tone: 'warn', text: `${set.shrunk} made smaller to fit` };
  return { tone: 'ok', text: 'Ready' };
}

function DeviceList({
  sets,
  selected,
  making,
  onSelect,
  onMaking,
}: {
  sets: Map<DeviceFormat, DeviceSetView>;
  selected: DeviceFormat | null;
  making: DeviceFormat[];
  onSelect: (id: DeviceFormat) => void;
  onMaking: (target: DeviceSetTarget, on: boolean) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // On a narrow screen the list is a row that scrolls: the device on show is kept in view.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-device-choice][aria-pressed="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);
  // Arrow keys move between devices, the way a list of choices does.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-device-choice]') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const next = buttons[(at + step + buttons.length) % buttons.length];
    next.focus();
    next.click();
  };
  return (
    <aside
      ref={listRef}
      onKeyDown={onKeyDown}
      aria-label="Devices"
      className="flex shrink-0 gap-3 overflow-x-auto border-b p-3 md:w-80 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r"
    >
      {DEVICE_SET_STORES.map((store) => (
        <section key={store.id} className="flex shrink-0 gap-1 md:flex-col">
          <h3 className="hidden px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:block">
            {store.label}
          </h3>
          {DEVICE_SET_TARGETS.filter((target) => target.store === store.id).map((target) => {
            const set = sets.get(target.id);
            const status = statusOf(set);
            const active = selected === target.id;
            const on = making.includes(target.id);
            return (
              <div
                key={target.id}
                className={cn(
                  'group flex w-72 shrink-0 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors md:w-auto',
                  active ? 'border-primary/50 bg-primary/5' : 'border-transparent hover:bg-accent'
                )}
              >
                <button
                  type="button"
                  data-device-choice=""
                  aria-pressed={active}
                  onClick={() => onSelect(target.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ShapeGlyph target={target} active={active} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{target.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {target.preset.artboard.width}×{target.preset.artboard.height}
                    </span>
                    {status.text && (
                      <span
                        className={cn(
                          'block text-[11px] leading-tight',
                          status.tone === 'warn' && 'text-amber-700 dark:text-amber-400',
                          status.tone === 'own' && 'text-primary',
                          status.tone === 'ok' && 'text-emerald-700 dark:text-emerald-400'
                        )}
                      >
                        {status.text}
                      </span>
                    )}
                  </span>
                </button>
                {!set?.own && (
                  <label htmlFor={`export-${target.id}`} className="cursor-pointer text-[11px] text-muted-foreground">
                    Export
                  </label>
                )}
                {!set?.own && (
                  <Switch
                    id={`export-${target.id}`}
                    checked={on}
                    onCheckedChange={(checked) => onMaking(target, checked)}
                    aria-label={`Export ${target.name} screenshots too`}
                    title={on ? `Your ${target.name} screenshots are exported too` : `Export ${target.name} screenshots too`}
                    className="scale-90"
                  />
                )}
              </div>
            );
          })}
        </section>
      ))}
    </aside>
  );
}

/** The height a list of artboards is drawn at, from the room the strip has. */
function useStripHeight(ref: React.RefObject<HTMLElement | null>, reserve: number): number {
  const [height, setHeight] = useState(420);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setHeight(Math.max(180, Math.min(620, entry.contentRect.height - reserve)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, reserve]);
  return height;
}

function SetStrip({
  set,
  locale,
  onLayout,
  onShot,
}: {
  set: DeviceSetView;
  locale: string | null;
  onLayout: (boardId: string, layout: DeviceLayout | null) => void;
  onShot: (board: BoardOnDevice, elementId: string, file: File | null) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const height = useStripHeight(stripRef, set.own ? 90 : 190);
  const shown = useMemo(() => set.boards.map((board) => board.shown), [set.boards]);
  const spill = useMemo(() => computeSpill(shown), [shown]);
  // Flat copies for the layout thumbnails, whose 3D frames would each cost a WebGL context.
  const flat = useMemo(() => shown.map(flattenBoard3d), [shown]);
  // Live 3D frames up to the budget, in reading order; the rest drawn flat.
  const drawn = useMemo(() => {
    let budget = LIVE_3D_BUDGET;
    return shown.map((board) => {
      const cost = count3dDevices(board, spillFor(spill, board.id));
      if (cost <= budget) {
        budget -= cost;
        return board;
      }
      return flattenBoard3d(board);
    });
  }, [shown, spill]);
  const { target } = set;
  const name = shotName(target);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-1 pt-4">
        <h2 className="text-lg font-semibold">{target.name}</h2>
        <span className="text-xs text-muted-foreground">
          {target.preset.artboard.width}×{target.preset.artboard.height} · {target.note}
        </span>
      </div>
      {set.own ? (
        <p className="px-5 text-xs text-muted-foreground">This is the size you designed for, so your screenshots look exactly as you made them.</p>
      ) : set.phoneShots > 0 ? (
        <div className="mx-5 mt-1 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <ImagePlusIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {`These screenshots show your app on a phone. To show ${withArticle(target.kind === 'desktop' ? 'MacBook' : name)} instead, add a screenshot from ${withArticle(name)} under each one.`}
          </span>
          <InfoTip label={`Why a screenshot from ${withArticle(name)}`}>
            <p>
              {target.store === 'app-store'
                ? "Apple wants iPad screenshots to show your app on an iPad. We don't stretch your phone screenshots into an iPad shape, because that would cut parts of your app off."
                : target.store === 'mac-app-store'
                  ? 'The Mac App Store wants screenshots that show your app on a Mac.'
                  : "Google Play shows these screenshots on tablets. We don't stretch your phone screenshots into a tablet shape, because that would cut parts of your app off."}
            </p>
          </InfoTip>
        </div>
      ) : set.needsShots > 0 ? (
        <div className="mx-5 mt-1 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <ImagePlusIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {set.needsShots === 1
              ? `One of your screenshots doesn't fit ${withArticle(name)} screen, so its edges get cut off. To fix this, add a screenshot from ${withArticle(name)} under it.`
              : `${set.needsShots} of your screenshots don't fit ${withArticle(name)} screen, so their edges get cut off. To fix this, add a screenshot from ${withArticle(name)} under each one.`}
          </span>
        </div>
      ) : set.shrunk > 0 ? (
        <p className="px-5 text-xs text-muted-foreground">
          {set.shrunk === 1 ? '1 screenshot' : `${set.shrunk} screenshots`} didn't fit this shape well, so we made {set.shrunk === 1 ? 'it' : 'them'} smaller to fit. To fix {set.shrunk === 1 ? 'it' : 'them'} by hand, use Make {withArticle(target.name)} project below.
        </p>
      ) : null}

      <div ref={stripRef} className="flex min-h-0 flex-1 items-start gap-6 overflow-x-auto px-5 pb-4 pt-4">
        {set.boards.map((board, index) => (
          <BoardCard
            key={board.base.id}
            board={board}
            drawn={drawn[index]}
            spill={spillFor(spill, board.base.id)}
            height={height}
            set={set}
            locale={locale}
            neighbors={flat}
            index={index}
            onLayout={(layout) => onLayout(board.base.id, layout)}
            onShot={(elementId, file) => onShot(board, elementId, file)}
          />
        ))}
      </div>
    </div>
  );
}

function BoardCard({
  board,
  drawn,
  spill,
  height,
  set,
  locale,
  neighbors,
  index,
  onLayout,
  onShot,
}: {
  board: BoardOnDevice;
  drawn: ArtboardState;
  spill: ReturnType<typeof spillFor>;
  height: number;
  set: DeviceSetView;
  locale: string | null;
  neighbors: ArtboardState[];
  index: number;
  onLayout: (layout: DeviceLayout | null) => void;
  onShot: (elementId: string, file: File | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFrame = useRef<string | null>(null);
  const { target } = set;
  const name = shotName(target);
  // A wide artboard (the Mac's) is held to a width that leaves room for the next one.
  const scale = Math.min(height / drawn.size.height, MAX_CARD_WIDTH / drawn.size.width);
  const width = drawn.size.width * scale;
  const shownHeight = drawn.size.height * scale;
  // A phone screenshot fits every phone, so a phone only asks for its own
  // where the design's screenshot is another shape. A tablet or a Mac asks
  // for one in every frame.
  const frames = target.kind === 'phone' ? board.frames.filter((frame) => frame.wrongShape || frame.hasOwnScreen) : board.frames;
  // A drop goes to the first frame without a screenshot of its own.
  const dropFrame = frames.find((frame) => !frame.hasOwnScreen)?.elementId ?? frames[0]?.elementId ?? null;

  const pick = (elementId: string) => {
    pendingFrame.current = elementId;
    inputRef.current?.click();
  };

  const takesShots = !set.own && frames.length > 0;

  return (
    <figure className="flex shrink-0 flex-col gap-2" style={{ width: Math.max(width, 150) }}>
      <div
        className={cn(
          'osg-morph relative overflow-hidden rounded-md bg-background shadow-sm ring-1 ring-black/10 transition-shadow dark:ring-white/10',
          dragging && 'ring-2 ring-primary'
        )}
        style={{ width, height: shownHeight }}
        onDragOver={(event) => {
          if (!takesShots || !dropFrame || !event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          setDragging(false);
          if (!takesShots || !dropFrame) return;
          const file = [...event.dataTransfer.files].find((candidate) => candidate.type.startsWith('image/'));
          if (!file) return;
          event.preventDefault();
          onShot(dropFrame, file);
        }}
      >
        <StaticArtboard artboard={drawn} scale={scale} spill={spill} />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/15 text-center text-sm font-medium text-primary">
            Drop a screenshot from {withArticle(name)}
          </div>
        )}
      </div>
      <figcaption className="flex flex-col gap-2">
        <span className="truncate text-xs text-muted-foreground" title={board.base.name}>
          {board.base.name}
        </span>
        {!set.own && board.plan && (
          <LayoutPicker board={board} set={set} locale={locale} neighbors={neighbors} index={index} onLayout={onLayout} />
        )}
        {takesShots &&
          frames.map((frame, index) => (
            <div key={frame.elementId} className="flex items-center gap-1">
              <Button
                variant={frame.hasOwnScreen ? 'ghost' : 'outline'}
                size="sm"
                className="h-7 flex-1 justify-start px-2 text-xs"
                onClick={() => pick(frame.elementId)}
              >
                {frame.hasOwnScreen ? <CheckIcon className="mr-1 h-3.5 w-3.5 text-primary" /> : <ImagePlusIcon className="mr-1 h-3.5 w-3.5" />}
                <span className="truncate">
                  {frame.hasOwnScreen ? `Change the ${name} screenshot` : `Add a screenshot from ${withArticle(name)}`}
                  {frames.length > 1 ? ` ${index + 1}` : ''}
                </span>
              </Button>
              {frame.hasOwnScreen && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onShot(frame.elementId, null)}
                  aria-label={`Remove the ${name} screenshot${frames.length > 1 ? ` ${index + 1}` : ''}`}
                  title={`Remove the ${name} screenshot`}
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file && pendingFrame.current) onShot(pendingFrame.current, file);
          }}
        />
      </figcaption>
    </figure>
  );
}

/**
 * The layouts this artboard can have on the device, each drawn small with the
 * artboard's own content, so the choice is made by looking, not by name.
 */
function LayoutPicker({
  board,
  set,
  locale,
  neighbors,
  index,
  onLayout,
}: {
  board: BoardOnDevice;
  set: DeviceSetView;
  locale: string | null;
  /** The device's artboards as drawn, flat, for what a neighbour's layer carries over. */
  neighbors: ArtboardState[];
  index: number;
  onLayout: (layout: DeviceLayout | null) => void;
}) {
  const { target } = set;
  const size = target.preset.artboard;
  const picked = board.base.deviceSets?.[target.id]?.layout ?? null;
  const used = board.plan?.layout ?? 'scaled';
  // The layout the automatic choice lands on, which is the one in use unless
  // another was picked.
  const automatic = useMemo(
    () => (picked ? planFor(board.base, target.id, { layout: 'auto', measure: measureText })?.layout ?? null : used),
    // board.shown changes when a font arrives, which is when to measure again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board.base, board.shown, picked, used, target.id]
  );
  const options = useMemo(() => {
    if (sameShape(board.base.size, size)) return [];
    const offered = layoutsFor(board.base, size);
    return (['stacked', 'beside', 'beside-flipped', 'scaled'] as DeviceLayout[])
      .filter((layout) => offered.includes(layout))
      .map((layout) => {
        const plan = planFor(board.base, target.id, { layout, measure: measureText });
        const shown = flattenBoard3d(
          plan ? boardOnDevice(board.inLanguage, plan, board.base, target.id, locale, measureText) : board.shown
        );
        const list = neighbors.map((neighbor, at) => (at === index ? shown : neighbor));
        return {
          layout,
          fits: layout === 'scaled' || (!!plan && !plan.fellBack),
          shown,
          spill: spillFor(computeSpill(list), shown.id),
        };
      })
      .filter((option) => option.fits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.base, board.inLanguage, board.shown, size, target.id, locale, neighbors, index]);
  if (options.length === 0) return null;
  const thumb = 46;
  const scale = thumb / size.height;
  const caption = board.plan?.fellBack
    ? picked
      ? `Layout: shrink to fit, because ${LAYOUT_NAMES[picked].toLowerCase()} didn't fit`
      : 'Layout: shrink to fit, because no other layout fit'
    : `Layout: ${LAYOUT_NAMES[used].toLowerCase()}${!picked && used === automatic ? ' (our pick)' : ''}`;
  return (
    <div className="flex flex-col gap-1">
      <div role="radiogroup" aria-label={`Layout of ${board.base.name}`} className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.layout === used;
          const isAutomatic = option.layout === automatic;
          const label = `${LAYOUT_NAMES[option.layout]}${isAutomatic ? ' (our pick)' : ''}`;
          return (
            <button
              key={option.layout}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              title={label}
              onClick={() => onLayout(isAutomatic ? null : option.layout)}
              className={cn(
                'relative overflow-hidden rounded-sm ring-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'ring-2 ring-primary' : 'opacity-70 ring-black/15 hover:opacity-100 dark:ring-white/15'
              )}
              style={{ width: size.width * scale, height: thumb }}
            >
              <StaticArtboard artboard={option.shown} scale={scale} spill={option.spill} />
              {option.layout === 'scaled' && (
                <RectangleHorizontalIcon
                  className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-sm bg-background/80 p-px text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
      <span className="text-[11px] text-muted-foreground">{caption}</span>
    </div>
  );
}

/** Every device in rows, every artboard in columns: the whole store presence at a glance. */
function Overview({ sets, onPick }: { sets: Map<DeviceFormat, DeviceSetView>; onPick: (id: DeviceFormat) => void }) {
  const cell = 132;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <div className="flex flex-col gap-5">
        {DEVICE_SET_TARGETS.map((target) => {
          const set = sets.get(target.id);
          if (!set) return null;
          const status = statusOf(set);
          return (
            <section key={target.id} className="flex items-start gap-4">
              <button
                type="button"
                onClick={() => onPick(target.id)}
                className="w-36 shrink-0 rounded-md p-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Show the ${target.name} screenshots`}
              >
                <span className="block text-sm font-medium">{target.name}</span>
                <span className={cn('block text-[11px] text-muted-foreground', status.tone === 'warn' && 'text-amber-700 dark:text-amber-400')}>
                  {status.text}
                </span>
              </button>
              <OverviewRow set={set} cell={cell} onPick={() => onPick(target.id)} />
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** One device's artboards, small, with what a layer crossing an edge carries onto its neighbour. */
function OverviewRow({ set, cell, onPick }: { set: DeviceSetView; cell: number; onPick: () => void }) {
  const flat = useMemo(() => set.boards.map((board) => flattenBoard3d(board.shown)), [set.boards]);
  const spill = useMemo(() => computeSpill(flat), [flat]);
  return (
    <div className="flex gap-2">
      {flat.map((board, index) => (
        <button
          key={board.id}
          type="button"
          onClick={onPick}
          className="overflow-hidden rounded-sm shadow-sm ring-1 ring-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:ring-white/10"
          aria-label={`${set.boards[index].base.name} on ${set.target.name}`}
          style={{ width: (board.size.width * cell) / board.size.height, height: cell }}
        >
          <StaticArtboard artboard={board} scale={cell / board.size.height} spill={spillFor(spill, board.id)} />
        </button>
      ))}
    </div>
  );
}
