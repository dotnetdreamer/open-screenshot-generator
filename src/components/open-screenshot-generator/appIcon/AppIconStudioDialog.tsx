"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  DownloadIcon,
  FolderInputIcon,
  FolderOpenIcon,
  ImagePlusIcon,
  InfoIcon,
  Loader2Icon,
  MinusIcon,
  MonitorIcon,
  PencilIcon,
  SmartphoneIcon,
  StoreIcon,
  TabletSmartphoneIcon,
  XCircleIcon,
} from 'lucide-react';
import type { ArtboardState } from '@/types/artboard';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { isTauri, saveBlobToDisk } from '@/lib/desktop';
import { hexToRgb } from '@/lib/graphics/color';
import { lookFacesPending, readProjectLook, suggestedAppName } from '@/lib/creative/layouts';
import { saveImageBlobAsset } from '@/lib/mcp/assetStore';
import { checkIcon, measureIcon, withCheckAction, type CheckAction, type IconCheck, type IconPixelStats } from '@/lib/appIcon/checks';
import { exportFolderName, ICON_TARGETS, planIconExport, type IconTarget } from '@/lib/appIcon/exportPlan';
import { ExportStopped, renderIconFiles, zipIconFiles, type IconFile } from '@/lib/appIcon/exportIcons';
import { loadCapture, pixelsOf } from '@/lib/appIcon/raster';
import { ANDROID_MASKS, iconBoards, iconSettings, type AndroidMask } from '@/lib/appIcon/specs';
import {
  defaultPicks,
  leftAlone,
  pickLabel,
  picksOf,
  rivalAppIcons,
  rivalDevices,
  scanIsComplete,
  targetsForPicks,
  type IconProjectScan,
  type IconSaveResult,
  type IconWriteResult,
  type NotLookedIn,
  type ProjectPick,
} from '@/lib/appIcon/projectWrite';
import {
  ICON_STARTERS,
  buildLogoIcon,
  buildStarterIcon,
  inkNudge,
  type IconStarterId,
  type LogoFacts,
} from '@/lib/appIcon/starters';
import { useFontsLoaded } from '../creative/CreativeBoardBadge';
import { AppIconArt } from './AppIconArt';
import { AndroidHome, AndroidLayers, IphoneHome, MacDesktop, RealSizes, StoreCards, WALLPAPERS, type Wallpaper } from './AppIconScenes';

/** The three captures an export draws from, as data: URLs. */
export interface IconCaptureUrls {
  full: string;
  front: string;
  back: string;
}


interface AppIconStudioDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The base document, every language. */
  artboards: ArtboardState[];
  projectName: string;
  /** Which project is open, so a name typed for one doesn't follow the user into another. */
  projectKey: string | null;
  /** The icon to open on. Null opens the project's first, or the starters when it has none. */
  boardId: string | null;
  onAddIcon: (board: ArtboardState) => void;
  /** A change to the icon artboard; `label` names it in History. */
  onUpdateIcon: (boardId: string, patch: Partial<ArtboardState>, label?: string) => void;
  /** The app's name as typed, kept on the icon (empty for the project's own). */
  onRenameApp: (boardId: string, name: string) => void;
  /** Close and select the icon on the canvas, or one of its layers. */
  onEditOnCanvas: (boardId: string, elementId?: string) => void;
  /** Capture the icon's layers off the canvas, at `scale` of 1024. */
  captureLayers: (boardId: string, scale: number) => Promise<IconCaptureUrls | null>;
  /** Desktop: the user picks a folder, then `makeFiles` runs and the files go into it. Resolves to where they went, or null when cancelled. */
  onSaveToFolder?: (folder: string, makeFiles: () => Promise<readonly IconFile[]>) => Promise<IconSaveResult | null>;
  /** Desktop: the user picks where, then `makeZip` runs and Rust writes the zip there. Null when cancelled. */
  onSaveZip?: (fileName: string, makeZip: () => Promise<Blob>) => Promise<IconSaveResult | null>;
  /** Desktop: the app's own folder the user picks, and the icon places found in it. Null when cancelled. `onLooking` runs once a folder is picked and the scan starts. */
  onPickProject?: (onLooking: () => void) => Promise<IconProjectScan | null>;
  /** Desktop: the icon into the places ticked. Resolves to the paths written and any old file left behind. */
  onWriteProject?: (scan: IconProjectScan, picks: ProjectPick[], files: IconFile[]) => Promise<IconWriteResult>;
}

type Platform = 'ios' | 'android' | 'mac' | 'stores';

const TINTS = [
  { color: '#0A84FF', label: 'Blue' },
  { color: '#FF6482', label: 'Pink' },
  { color: '#30D158', label: 'Green' },
  { color: '#FF9F0A', label: 'Orange' },
  { color: '#BF5AF2', label: 'Purple' },
];

/** Why the scan didn't look in a folder, in the confirm list. */
const NOT_LOOKED_IN_REASON: Record<NotLookedIn['reason'], string> = {
  deep: 'too deep to open',
  unreadable: 'no permission to open',
  link: 'a shortcut to another folder',
};

/** How each fix reads in History. */
const FIX_HISTORY: Partial<Record<CheckAction['kind'], string>> = {
  'move-to-back': 'Move to the back',
  'move-to-back-and-white': 'Move to the back',
  'light-in-dark': 'White in dark mode',
  'fill-ground': 'Fill with white',
};

/** Names typed in the starters, per project, until the icon is made with one. */
const startersNames = new Map<string, string>();

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const TARGETS_KEY = 'open-screenshot-generator.app-icon-targets';

function readTargets(): IconTarget[] {
  const fallback = ICON_TARGETS.filter((entry) => entry.defaultOn).map((entry) => entry.id);
  try {
    const raw = window.localStorage.getItem(TARGETS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const known = new Set(ICON_TARGETS.map((entry) => entry.id));
    const picked = Array.isArray(parsed) ? parsed.filter((id): id is IconTarget => known.has(id)) : [];
    return picked.length > 0 ? picked : fallback;
  } catch {
    return fallback;
  }
}

function writeTargets(targets: IconTarget[]): void {
  try {
    window.localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
  } catch {
    // A browser that keeps nothing just asks again next time.
  }
}

/** A solid colour to put behind anything see-through where a picture cannot be. */
function opaqueGround(board: ArtboardState): string {
  const color = board.backgroundType === 'gradient' ? board.backgroundGradient?.color1 : board.backgroundColor;
  return color && hexToRgb(color) ? color : '#FFFFFF';
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-lg bg-muted p-1" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
              value === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One check, with its fixes. A fix that changes the icon shows the icon as it
 * would be after it, in the look the check is about, so the user sees what a
 * button does before pressing it.
 */
function CheckRow({
  check,
  board,
  tint,
  onAction,
}: {
  check: IconCheck;
  board: ArtboardState;
  tint: string;
  onAction: (action: CheckAction) => void;
}) {
  const Icon = check.level === 'ok' ? CheckCircle2Icon : check.level === 'warn' ? AlertTriangleIcon : XCircleIcon;
  return (
    <li className="flex gap-2.5 py-2" data-check={check.id} data-level={check.level}>
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          check.level === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : check.level === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className={cn('text-xs', check.level === 'ok' ? 'text-muted-foreground' : 'font-medium')}>{check.title}</p>
        {check.detail && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{check.detail}</p>}
        {check.actions && check.actions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {check.actions.map((action, at) => {
              const after = withCheckAction(board, action);
              const look = check.id === 'dark' || check.id === 'front' ? 'dark' : 'light';
              return (
                <Button
                  key={`${action.kind}-${at}`}
                  variant={at === 0 && check.actions!.length > 1 ? 'secondary' : 'outline'}
                  size="sm"
                  className={cn('h-auto gap-2 py-1 text-[11px]', after ? 'pl-1 pr-2.5' : 'px-2.5')}
                  onClick={() => onAction(action)}
                  title={after ? (look === 'dark' ? 'How the dark icon will look' : 'How the icon will look') : undefined}
                >
                  {after && (
                    <span aria-hidden className="shrink-0">
                      <AppIconArt board={after} size={28} shape="apple" look={look} tint={tint} label="" />
                    </span>
                  )}
                  {action.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </li>
  );
}

/** What a logo is before it becomes an icon: stored once, then measured. */
async function readLogo(file: File): Promise<LogoFacts> {
  const stored = await saveImageBlobAsset(file, { name: file.name });
  const url = URL.createObjectURL(file);
  try {
    const image = await loadCapture(url);
    const width = stored.width || image.naturalWidth || 1024;
    const height = stored.height || image.naturalHeight || 1024;
    const side = 64;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    let opaque = false;
    let light = false;
    if (context) {
      const scale = Math.min(side / width, side / height);
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const x = Math.round((side - w) / 2);
      const y = Math.round((side - h) / 2);
      context.drawImage(image, x, y, w, h);
      const data = context.getImageData(x, y, w, h).data;
      let solid = 0;
      let lit = 0;
      let inked = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] >= 250) solid += 1;
        if (data[i + 3] > 32) {
          inked += 1;
          lit += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        }
      }
      const pixels = data.length / 4;
      opaque = solid / pixels > 0.995;
      light = inked > 0 && lit / inked > 0.8;
    }
    return { src: stored.ref, width, height, opaque, light };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AppIconStudioDialog({
  isOpen,
  onOpenChange,
  artboards,
  projectName,
  projectKey,
  boardId,
  onAddIcon,
  onUpdateIcon,
  onRenameApp,
  onEditOnCanvas,
  captureLayers,
  onSaveToFolder,
  onSaveZip,
  onPickProject,
  onWriteProject,
}: AppIconStudioDialogProps) {
  const icons = useMemo(() => iconBoards(artboards), [artboards]);
  const [chosenId, setChosenId] = useState<string | null>(boardId);
  useEffect(() => {
    if (isOpen) setChosenId(boardId);
  }, [isOpen, boardId]);
  const board = icons.find((entry) => entry.id === chosenId) ?? icons[0] ?? null;

  // The app's name lives on the icon, so every project keeps its own, in
  // every tab and after a reload. Before there is an icon, a name typed in
  // the starters is kept per project until the icon is made with it.
  const suggestedName = suggestedAppName(projectName) || 'Your app';
  const nameKey = projectKey ?? '';
  const [, setStartersVersion] = useState(0);
  const startersTyped = startersNames.get(nameKey) ?? '';
  const typeStartersName = (name: string) => {
    startersNames.set(nameKey, name);
    setStartersVersion((version) => version + 1);
  };
  const iconTyped = board ? iconSettings(board).appName ?? '' : '';
  const addIcon = (made: ArtboardState) => {
    const name = startersTyped.trim() ? startersTyped : undefined;
    startersNames.delete(nameKey);
    onAddIcon(name ? { ...made, appIcon: { ...iconSettings(made), appName: name } } : made);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0', board ? 'h-[min(92vh,840px)] max-w-[1180px]' : 'max-w-[1060px]')}
        data-testid="app-icon-dialog"
      >
        {board ? (
          <Studio
            key={board.id}
            board={board}
            icons={icons}
            onChoose={setChosenId}
            appName={iconTyped.trim() || suggestedName}
            typedName={iconTyped}
            suggestedName={suggestedName}
            onAppName={(name) => onRenameApp(board.id, name)}
            onUpdateIcon={onUpdateIcon}
            onEditOnCanvas={onEditOnCanvas}
            captureLayers={captureLayers}
            onSaveToFolder={onSaveToFolder}
            onSaveZip={onSaveZip}
            onPickProject={onPickProject}
            onWriteProject={onWriteProject}
            isOpen={isOpen}
          />
        ) : (
          <Starters
            artboards={artboards}
            appName={startersTyped.trim() || suggestedName}
            typedName={startersTyped}
            suggestedName={suggestedName}
            onAppName={typeStartersName}
            onCancel={() => onOpenChange(false)}
            onAdd={addIcon}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- the starters ---------------------------------------------------------------

function Starters({
  artboards,
  appName,
  typedName,
  suggestedName,
  onAppName,
  onCancel,
  onAdd,
}: {
  artboards: ArtboardState[];
  /** The name the starters are made from. */
  appName: string;
  /** What the user typed, which the field shows as it is. */
  typedName: string;
  suggestedName: string;
  onAppName: (name: string) => void;
  onCancel: () => void;
  onAdd: (board: ArtboardState) => void;
}) {
  const fontsLoaded = useFontsLoaded();
  const look = useMemo(() => readProjectLook(artboards, appName), [artboards, appName]);
  const [picked, setPicked] = useState<IconStarterId | 'logo'>('letter');
  const [logo, setLogo] = useState<LogoFacts | null>(null);
  const [readingLogo, setReadingLogo] = useState(false);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cards = useMemo(
    () => ICON_STARTERS.map((starter) => ({ starter, board: buildStarterIcon(starter.id, look, { appName, seed: 'pick', nudge: inkNudge }) })),
    // fontsLoaded: a face that arrives moves the letters, which were measured in the fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [look, appName, fontsLoaded]
  );
  const logoBoard = useMemo(() => (logo ? buildLogoIcon(look, logo, { seed: 'pick' }) : null), [look, logo]);

  const chooseLogo = async (file: File | undefined) => {
    if (!file) return;
    setReadingLogo(true);
    try {
      setLogo(await readLogo(file));
      setPicked('logo');
    } catch (error) {
      toast({
        title: "That picture couldn't be read",
        description: error instanceof Error ? error.message : 'Try a PNG, JPEG, WebP or SVG file.',
        variant: 'destructive',
      });
    } finally {
      setReadingLogo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const add = async () => {
    setAdding(true);
    try {
      const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      if (picked === 'logo') {
        if (!logo) return;
        onAdd(buildLogoIcon(look, logo, { seed }));
        return;
      }
      // The letters are placed by measuring them, so the face comes first.
      const pending = lookFacesPending(look);
      if (pending) await pending;
      onAdd(buildStarterIcon(picked, look, { appName, seed, nudge: inkNudge }));
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4">
        <DialogTitle>Make your app icon</DialogTitle>
        <DialogDescription>
          Start from your app&apos;s name and colours, or from your logo. You can change anything later on the canvas
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Label htmlFor="app-icon-name" className="shrink-0 text-xs">
            App name
          </Label>
          <Input
            id="app-icon-name"
            value={typedName}
            onChange={(event) => onAppName(event.target.value)}
            placeholder={suggestedName}
            className="h-8 w-64 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" role="radiogroup" aria-label="How to start">
          {cards.map(({ starter, board }) => (
            <StarterCard
              key={starter.id}
              label={starter.label}
              blurb={starter.blurb}
              selected={picked === starter.id}
              onSelect={() => setPicked(starter.id)}
            >
              <AppIconArt board={board} size={112} shape="apple" />
            </StarterCard>
          ))}
          <StarterCard
            label="Your logo"
            blurb={logo ? 'You can pick another picture any time' : 'A PNG, JPEG, WebP or SVG picture'}
            selected={picked === 'logo'}
            onSelect={() => (logo ? setPicked('logo') : fileRef.current?.click())}
            testId="app-icon-logo-card"
          >
            {logoBoard ? (
              <AppIconArt board={logoBoard} size={112} shape="apple" />
            ) : (
              <div className="flex h-[112px] w-[112px] flex-col items-center justify-center gap-1.5 rounded-[26px] border-2 border-dashed border-muted-foreground/30 text-muted-foreground">
                {readingLogo ? <Loader2Icon className="h-5 w-5 animate-spin" /> : <ImagePlusIcon className="h-5 w-5" />}
                <span className="text-[11px] font-medium">Use your logo</span>
              </div>
            )}
          </StarterCard>
        </div>
        {logo && (
          <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => fileRef.current?.click()}>
            Use a different picture
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          data-testid="app-icon-logo-input"
          onChange={(event) => void chooseLogo(event.target.files?.[0])}
        />
        <p className="mt-6 flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Your icon becomes a square artboard on your canvas. You design the icon once, and every size for iPhone, Android
            and Mac is made from that one design.
          </span>
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-3">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => void add()} disabled={adding || (picked === 'logo' && !logo)}>
          {adding && <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />}
          Add icon
        </Button>
      </div>
    </>
  );
}

function StarterCard({
  label,
  blurb,
  selected,
  onSelect,
  children,
  testId,
}: {
  label: string;
  blurb: string;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-colors',
        selected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted'
      )}
    >
      {children}
      <span>
        <span className="block text-xs font-medium">{label}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{blurb}</span>
      </span>
    </button>
  );
}

// --- the studio -----------------------------------------------------------------

function Studio({
  board,
  icons,
  onChoose,
  appName,
  typedName,
  suggestedName,
  onAppName,
  onUpdateIcon,
  onEditOnCanvas,
  captureLayers,
  onSaveToFolder,
  onSaveZip,
  onPickProject,
  onWriteProject,
  isOpen,
}: {
  board: ArtboardState;
  icons: ArtboardState[];
  onChoose: (id: string) => void;
  /** The name the previews and the export use. */
  appName: string;
  /** What the user typed, which the field shows as it is. */
  typedName: string;
  /** The project's own name, shown in the empty field. */
  suggestedName: string;
  onAppName: (name: string) => void;
  onUpdateIcon: (boardId: string, patch: Partial<ArtboardState>, label?: string) => void;
  onEditOnCanvas: (boardId: string, elementId?: string) => void;
  captureLayers: (boardId: string, scale: number) => Promise<IconCaptureUrls | null>;
  onSaveToFolder?: (folder: string, makeFiles: () => Promise<readonly IconFile[]>) => Promise<IconSaveResult | null>;
  onSaveZip?: (fileName: string, makeZip: () => Promise<Blob>) => Promise<IconSaveResult | null>;
  onPickProject?: (onLooking: () => void) => Promise<IconProjectScan | null>;
  onWriteProject?: (scan: IconProjectScan, picks: ProjectPick[], files: IconFile[]) => Promise<IconWriteResult>;
  isOpen: boolean;
}) {
  const settings = iconSettings(board);
  const [platform, setPlatform] = useState<Platform>('ios');
  const [iosLook, setIosLook] = useState<'light' | 'dark' | 'tinted'>('light');
  const [tint, setTint] = useState(TINTS[0].color);
  const [androidLook, setAndroidLook] = useState<'light' | 'dark' | 'themed'>('light');
  const [mask, setMask] = useState<AndroidMask>('circle');
  const [showSafe, setShowSafe] = useState(false);
  const [wallpaper, setWallpaper] = useState<Wallpaper>('aurora');
  const [darkScene, setDarkScene] = useState(false);

  // The checks that need pixels, measured off the canvas a moment after each change.
  const [stats, setStats] = useState<IconPixelStats | null>(null);
  const [measuring, setMeasuring] = useState(true);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setMeasuring(true);
    const timer = window.setTimeout(async () => {
      try {
        const urls = await captureLayers(board.id, 0.25);
        if (!urls || cancelled) return;
        const [full, front] = await Promise.all([loadCapture(urls.full), loadCapture(urls.front)]);
        if (cancelled) return;
        setStats(measureIcon(pixelsOf(full, 256), pixelsOf(front, 256)));
      } catch (error) {
        console.warn('Could not measure the app icon', error);
      } finally {
        if (!cancelled) setMeasuring(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [board, captureLayers, isOpen]);
  const checks = useMemo(() => checkIcon(board, stats), [board, stats]);
  const problems = checks.filter((check) => check.level !== 'ok');

  // A fix that changes the icon is applied from the very board its preview
  // shows, as one change, so what the user clicks is what they saw.
  const runAction = (action: CheckAction) => {
    const after = withCheckAction(board, action);
    if (after) {
      onUpdateIcon(
        board.id,
        {
          elements: after.elements,
          appIcon: after.appIcon,
          backgroundType: after.backgroundType,
          backgroundColor: after.backgroundColor,
          backgroundGradient: after.backgroundGradient,
        },
        FIX_HISTORY[action.kind]
      );
      return;
    }
    switch (action.kind) {
      case 'select':
        onEditOnCanvas(board.id, action.elementId);
        return;
      case 'show-android':
        setPlatform('android');
        setShowSafe(true);
        return;
    }
  };

  // --- export ---
  const [targets, setTargets] = useState<IconTarget[]>(() => readTargets());
  const toggleTarget = (id: IconTarget, on: boolean) => {
    setTargets((current) => {
      const next = on ? [...new Set([...current, id])] : current.filter((entry) => entry !== id);
      const ordered = ICON_TARGETS.map((entry) => entry.id).filter((entry) => next.includes(entry));
      writeTargets(ordered);
      return ordered;
    });
  };
  // While files are made, Stop can stop them. Once they're made they go to
  // disk in one step that can't stop halfway, so `saving` hides Stop.
  const [progress, setProgress] = useState<{ done: number; total: number; saving: boolean } | null>(null);
  const stopRef = useRef(false);
  const savingRef = useRef(false);
  const stop = () => {
    // A click that lands after the files went to disk changes nothing: the result is shown either way.
    if (!savingRef.current) stopRef.current = true;
  };
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const desktop = mounted && isTauri();
  const folder = exportFolderName(appName);

  /** Makes every file for `which`. Throws ExportStopped if Stop is pressed first. */
  const render = async (which: readonly IconTarget[] = targets): Promise<IconFile[]> => {
    const plan = planIconExport(appName, which);
    if (plan.length === 0) throw new Error('Tick at least one kind of file to export.');
    stopRef.current = false;
    savingRef.current = false;
    setProgress({ done: 0, total: plan.length, saving: false });
    const urls = await captureLayers(board.id, 1);
    if (!urls) throw new Error('The icon artboard is not on the canvas. Open the project in the editor and try again.');
    const [full, front, back] = await Promise.all([loadCapture(urls.full), loadCapture(urls.front), loadCapture(urls.back)]);
    const files = await renderIconFiles(
      plan,
      { full, front, back },
      { ground: opaqueGround(board), whiteInDark: settings.dark === 'light' },
      (done, total) => setProgress({ done, total, saving: false }),
      () => stopRef.current
    );
    // The last check before anything is saved.
    if (stopRef.current) throw new ExportStopped();
    savingRef.current = true;
    setProgress({ done: plan.length, total: plan.length, saving: true });
    return files;
  };

  /** Names the old files a save couldn't remove. True when there were some. */
  const toldLeftOver = (leftOver: readonly string[], title: string, otherwise = '') => {
    if (leftOver.length === 0) return false;
    console.warn('App icon: old files left behind', leftOver);
    // Each entry is the file's place inside the folder picked, then why it couldn't be removed.
    const names = leftOver.map((entry) => entry.split(': ')[0]);
    toast({
      title,
      description: `${names.length === 1 ? 'Delete this file' : 'Delete these files'}${otherwise}: ${names.join(', ')}`,
      variant: 'destructive',
    });
    return true;
  };

  const failed = (error: unknown, nothingSaved = 'Nothing was saved.') => {
    if (error instanceof ExportStopped) {
      toast({ title: 'Export stopped', description: nothingSaved });
      return;
    }
    console.error('App icon export failed', error);
    toast({
      title: "The icons couldn't be saved",
      description: error instanceof Error ? error.message : String(error || 'Try again in a moment.'),
      variant: 'destructive',
    });
  };

  // Putting the icon in a project: the places found, waiting for a yes.
  const [scan, setScan] = useState<IconProjectScan | null>(null);
  const [picked, setPicked] = useState<ProjectPick[]>([]);
  const [looking, setLooking] = useState(false);
  // The list of places is far down the side panel: bring it into view when it opens.
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scan) confirmRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [scan]);
  const lookInProject = async () => {
    if (!onPickProject) return;
    try {
      const found = await onPickProject(() => setLooking(true));
      if (!found) return;
      const places = picksOf(found);
      if (places.length === 0) {
        const unread = found.notLookedIn?.[0];
        toast({
          title: 'No app icon found in that folder',
          description:
            leftAlone(found).length > 0
              ? "The folder only has Apple Watch or Apple TV icons, and those aren't made here."
              : unread
                ? `Some folders couldn't be opened, like ${unread.path}. Pick the folder that has just your app in it.`
                : "Pick the folder with your app's code. The folder needs an iPhone or Android app icon somewhere inside.",
          variant: 'destructive',
        });
        return;
      }
      setScan(found);
      setPicked(defaultPicks(found));
    } catch (error) {
      failed(error);
    } finally {
      setLooking(false);
    }
  };
  const replaceInProject = async () => {
    if (!scan || !onWriteProject || picked.length === 0) return;
    try {
      const files = await render(targetsForPicks(picked));
      const result = await onWriteProject(scan, picked, files);
      setScan(null);
      if (toldLeftOver(result.leftOver, 'New icon added, but some old files are still there', ', or your app may not build')) return;
      toast({
        title: 'New icon added to your app',
        description: `${result.written.length} files changed in ${listed(picked.map((pick) => pick.path))}. Build your app to see the new icon.`,
      });
    } catch (error) {
      failed(error, 'Nothing in your app was changed.');
    } finally {
      setProgress(null);
    }
  };

  const exportTo = async (where: 'zip' | 'folder') => {
    try {
      // On the desktop the user picks where first, then the files are made.
      let made: IconFile[] = [];
      const makeFiles = async () => (made = await render());
      const makeZip = async () => zipIconFiles(folder, await makeFiles());
      if (where === 'zip') {
        // The desktop writes the zip through Rust, whole or not at all; the web downloads it.
        const saved = onSaveZip ? await onSaveZip(`${folder}.zip`, makeZip) : await saveBlobToDisk(makeZip, `${folder}.zip`);
        if (saved === null) return;
        if (typeof saved === 'object' && toldLeftOver(saved.leftOver, 'Icons saved, but an old copy is still there')) return;
        toast({ title: 'Icons saved', description: `${made.length} files in ${folder}.zip. The README file inside says where each file goes.` });
      } else if (where === 'folder' && onSaveToFolder) {
        const saved = await onSaveToFolder(folder, makeFiles);
        if (saved === null) return;
        if (toldLeftOver(saved.leftOver, 'Icons saved, but some old copies are still there')) return;
        toast({ title: 'Icons saved', description: `${made.length} files in ${saved.path}` });
      }
    } catch (error) {
      failed(error);
    } finally {
      setProgress(null);
    }
  };

  const nothingPicked = targets.length === 0;

  const scene = (() => {
    switch (platform) {
      case 'ios':
        return <IphoneHome board={board} appName={appName} look={iosLook} tint={tint} wallpaper={wallpaper} width={300} />;
      case 'android':
        return <AndroidHome board={board} appName={appName} look={androidLook} mask={mask} wallpaper={wallpaper} width={300} />;
      case 'mac':
        return <MacDesktop board={board} appName={appName} dark={darkScene} width={540} />;
      case 'stores':
        return <StoreCards board={board} appName={appName} dark={darkScene} />;
    }
  })();

  const realLook =
    platform === 'ios' ? iosLook : platform === 'android' ? (androidLook === 'themed' ? (darkScene ? 'themed-dark' : 'themed-light') : 'light') : 'light';

  const realSizeBlock =
    platform === 'stores' ? null : (
      <div className="space-y-2">
        <p className="text-xs font-medium">Actual size</p>
        <RealSizes
          board={board}
          platform={platform}
          look={realLook}
          tint={tint}
          mask={mask}
          dark={platform === 'ios' ? iosLook !== 'light' : platform === 'android' ? androidLook === 'dark' : darkScene}
          layout={platform === 'mac' ? 'row' : 'list'}
        />
      </div>
    );

  return (
    <>
      <DialogHeader className="shrink-0 border-b px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
          <div className="space-y-1">
            <DialogTitle>App icon</DialogTitle>
            <DialogDescription>See your icon on phones and in the stores, then export every size</DialogDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {icons.length > 1 && (
              <Segmented
                label="Which icon"
                value={board.id}
                options={icons.map((icon, index) => ({ value: icon.id, label: icon.name || `Icon ${index + 1}` }))}
                onChange={onChoose}
                size="sm"
              />
            )}
            <Input
              aria-label="App name"
              value={typedName}
              onChange={(event) => onAppName(event.target.value)}
              className="h-8 w-44 text-sm"
              placeholder={suggestedName}
            />
            <Button variant="outline" size="sm" className="h-8" onClick={() => onEditOnCanvas(board.id)}>
              <PencilIcon className="mr-1.5 h-3.5 w-3.5" />
              Edit on the canvas
            </Button>
          </div>
        </div>
      </DialogHeader>

      {/* Wide: the previews and the side panel scroll on their own, and the
          export button stays under the panel. Narrow: everything above the
          export button scrolls as one page, so the button never drops out of
          the window. */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 overflow-y-auto lg:contents" data-testid="app-icon-body">
          {/* The scenes */}
          <section
            className="flex min-w-0 flex-col border-b px-6 py-4 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r"
            aria-label="Previews"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                label="Where"
                value={platform}
                onChange={setPlatform}
                options={[
                  { value: 'ios', label: 'iPhone', icon: SmartphoneIcon },
                  { value: 'android', label: 'Android', icon: TabletSmartphoneIcon },
                  { value: 'mac', label: 'Mac', icon: MonitorIcon },
                  { value: 'stores', label: 'Stores', icon: StoreIcon },
                ]}
              />
              <div className="flex flex-wrap items-center gap-2">
                {platform === 'ios' && (
                  <>
                    <Segmented
                      label="Look"
                      size="sm"
                      value={iosLook}
                      onChange={setIosLook}
                      options={[
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                        { value: 'tinted', label: 'Tinted' },
                      ]}
                    />
                    {iosLook === 'tinted' && (
                      <div className="flex items-center gap-1" role="radiogroup" aria-label="Tint colour">
                        {TINTS.map((entry) => (
                          <button
                            key={entry.color}
                            type="button"
                            role="radio"
                            aria-checked={tint === entry.color}
                            aria-label={entry.label}
                            title={entry.label}
                            onClick={() => setTint(entry.color)}
                            className={cn('h-5 w-5 rounded-full ring-offset-2 ring-offset-background', tint === entry.color && 'ring-2 ring-foreground/60')}
                            style={{ background: entry.color }}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
                {platform === 'android' && (
                  <>
                    <Segmented
                      label="Look"
                      size="sm"
                      value={androidLook}
                      onChange={setAndroidLook}
                      options={[
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                        { value: 'themed', label: 'Themed' },
                      ]}
                    />
                    <Segmented
                      label="Shape"
                      size="sm"
                      value={mask}
                      onChange={setMask}
                      options={ANDROID_MASKS.map((entry) => ({ value: entry.id, label: entry.label }))}
                    />
                  </>
                )}
                {(platform === 'mac' || platform === 'stores') && (
                  <Segmented
                    label="Look"
                    size="sm"
                    value={darkScene ? 'dark' : 'light'}
                    onChange={(value) => setDarkScene(value === 'dark')}
                    options={[
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center gap-8 py-5 md:flex-row md:items-start lg:flex-col lg:items-center xl:flex-row xl:items-center">
              <div className="flex justify-center" data-testid="app-icon-scene" data-platform={platform}>
                {scene}
              </div>
              {/* The Mac has nothing beside its desktop: its sizes go under it. */}
              {(platform === 'ios' || platform === 'android') && (
                <div className="flex w-full max-w-[300px] flex-col gap-5">
                  {platform === 'android' && (
                    <div className="flex flex-col items-center gap-2.5 text-center">
                      <AndroidLayers board={board} mask={mask} size={124} showSafe={showSafe} />
                      <p className="max-w-[240px] text-[11px] leading-snug text-muted-foreground">
                        When someone touches the icon, Android moves the front a little over the back
                      </p>
                      <div className="flex items-center gap-2">
                        <Switch id="app-icon-safe" checked={showSafe} onCheckedChange={setShowSafe} />
                        <Label htmlFor="app-icon-safe" className="text-xs font-normal">
                          Show the part no phone cuts off
                        </Label>
                      </div>
                    </div>
                  )}
                  {realSizeBlock}
                  {(platform === 'ios' || platform === 'android') && (
                    <div className="flex items-center justify-center gap-2" role="radiogroup" aria-label="Wallpaper">
                      <span className="text-[11px] text-muted-foreground">Wallpaper</span>
                      {WALLPAPERS.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          role="radio"
                          aria-checked={wallpaper === entry.id}
                          aria-label={entry.label}
                          title={entry.label}
                          onClick={() => setWallpaper(entry.id)}
                          className={cn('h-5 w-8 rounded-md ring-offset-2 ring-offset-background', wallpaper === entry.id && 'ring-2 ring-foreground/60')}
                          style={{ background: entry.css }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* The Mac's sizes are wider than a column, so they go under its desktop. */}
            {platform === 'mac' && realSizeBlock}
          </section>

          {/* Checks and export */}
          <aside className="flex flex-col lg:col-start-2 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto" aria-label="Checks and export">
            <div className="border-b px-5 py-4">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Before you export</h3>
                {measuring && <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Checking" />}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {problems.length === 0 ? 'All good. Your icon is easy to see at every size' : 'A few things to look at'}
              </p>
              <ul className="mt-1 divide-y" data-testid="app-icon-checks">
                {checks.map((check) => (
                  <CheckRow key={check.id} check={check} board={board} tint={tint} onAction={runAction} />
                ))}
              </ul>
            </div>

            <div className="border-b px-5 py-4">
              <h3 className="text-sm font-semibold">Dark and tinted icons</h3>
              <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">How your icon looks when an iPhone is set to dark or tinted</p>
              <Segmented
                label="Dark and tinted icons"
                size="sm"
                value={settings.dark === 'light' ? 'light' : 'keep'}
                onChange={(value) => onUpdateIcon(board.id, { appIcon: value === 'light' ? { ...settings, dark: 'light' } : { ...settings, dark: undefined } })}
                options={[
                  { value: 'keep', label: 'Your colours' },
                  { value: 'light', label: 'White' },
                ]}
              />
              <div className="mt-3 flex items-center gap-3">
                <AppIconArt board={board} size={44} shape="apple" look="dark" label="Dark icon" />
                <AppIconArt board={board} size={44} shape="apple" look="tinted" tint={tint} label="Tinted icon" />
              </div>
            </div>

            <div className="flex-1 px-5 py-4">
              <h3 className="text-sm font-semibold">Export</h3>
              <ul className="mt-2 space-y-2.5">
                {ICON_TARGETS.map((target) => (
                  <li key={target.id} className="flex items-start gap-2.5">
                    <Checkbox
                      id={`app-icon-target-${target.id}`}
                      checked={targets.includes(target.id)}
                      onCheckedChange={(checked) => toggleTarget(target.id, checked === true)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={`app-icon-target-${target.id}`} className="cursor-pointer font-normal">
                      <span className="block text-xs font-medium">{target.label}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">{target.blurb}</span>
                    </Label>
                  </li>
                ))}
              </ul>

              {scan && !progress && (
                <div ref={confirmRef} className="mt-4 rounded-lg border bg-muted/30 p-3" data-testid="app-icon-project-confirm">
                  <p className="text-xs font-medium">Replace the icon in these places?</p>
                  <p className="mt-0.5 break-all text-[11px] text-muted-foreground">In {scan.root}</p>
                  <ul className="mt-2 space-y-1.5">
                    {picksOf(scan).map((place) => {
                      const on = picked.some((entry) => entry.path === place.path);
                      return (
                        <li key={place.path} className="flex items-start gap-2">
                          <Checkbox
                            id={`app-icon-place-${place.path}`}
                            checked={on}
                            onCheckedChange={(checked) =>
                              setPicked((current) => (checked === true ? [...current.filter((entry) => entry.path !== place.path), place] : current.filter((entry) => entry.path !== place.path)))
                            }
                            className="mt-0.5"
                          />
                          <Label htmlFor={`app-icon-place-${place.path}`} className="cursor-pointer font-normal">
                            <span className="block text-xs font-medium">{pickLabel(place)}</span>
                            <span className="block break-all text-[11px] leading-snug text-muted-foreground">{place.path}</span>
                          </Label>
                        </li>
                      );
                    })}
                  </ul>
                  {leftAlone(scan).length > 0 && (
                    <ul className="mt-2 space-y-1.5" data-testid="app-icon-project-left-alone">
                      {leftAlone(scan).map((place) => (
                        <li key={place.path} className="flex items-start gap-2 text-muted-foreground">
                          <MinusIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <span>
                            <span className="block text-xs">{place.reason}</span>
                            <span className="block break-all text-[11px] leading-snug">{place.path}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                )}
                {/* Only while none of those icons is ticked: once one is, the note has done its job. */}
                {rivalAppIcons(scan).length > 0 && !rivalAppIcons(scan).some((place) => picked.some((entry) => entry.path === place.path)) && (
                  <p className="mt-2 text-[11px] text-muted-foreground" data-testid="app-icon-project-rivals">
                    This folder has more than one app icon for {rivalDevices(rivalAppIcons(scan))}, so none of them is ticked. Tick the icon your app uses
                  </p>
                )}
                {!scanIsComplete(scan) && (
                  <div className="mt-2 text-[11px] text-muted-foreground" data-testid="app-icon-project-incomplete">
                    <p>
                      {scan.truncated
                        ? "The folder is too big to look through, so nothing is ticked. Pick the folder that has just your app in it"
                        : "Some folders couldn't be opened, so nothing is ticked. Another app's icon might be inside those folders"}
                    </p>
                    {(scan.notLookedIn ?? []).length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {(scan.notLookedIn ?? []).slice(0, 3).map((place) => (
                          <li key={place.path} className="break-all">
                            {place.path}, {NOT_LOOKED_IN_REASON[place.reason]}
                          </li>
                        ))}
                        {(scan.notLookedInCount ?? 0) > 3 && <li>and {(scan.notLookedInCount ?? 0) - 3} more</li>}
                      </ul>
                    )}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {picked.length === 0
                    ? 'Tick where the new icon should go'
                    : 'The old icon files in the ticked places will be replaced. If you use git, you can get the old files back'}
                </p>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* What the export does next, always in view */}
        <div className="border-t bg-background px-5 py-3 lg:col-start-2 lg:row-start-2" data-testid="app-icon-actions">
          {progress ? (
            <div className="space-y-2" data-testid="app-icon-export-progress">
              <Progress value={progress.saving ? 100 : progress.total > 0 ? (progress.done / progress.total) * 100 : 0} />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{progress.saving ? 'Saving the files' : `Making file ${progress.done} of ${progress.total}`}</span>
                {!progress.saving && (
                  <button type="button" className="hover:text-foreground" onClick={stop}>
                    Stop
                  </button>
                )}
              </div>
            </div>
          ) : looking ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="app-icon-project-looking">
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Looking through your app&apos;s folder
            </div>
          ) : scan ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setScan(null)}>
                Cancel
              </Button>
              <Button className="flex-1" disabled={picked.length === 0} onClick={() => void replaceInProject()}>
                Replace the icon
              </Button>
            </div>
          ) : desktop && (onSaveToFolder || onPickProject) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="w-full" disabled={nothingPicked}>
                  Export icons
                  <ChevronDownIcon className="ml-1.5 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {onPickProject && (
                  <DropdownMenuItem onSelect={() => void lookInProject()} className="items-start gap-2 py-2">
                    <FolderInputIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <span className="block text-sm">Put the icon in my app</span>
                      <span className="block text-[11px] text-muted-foreground">Pick your app&apos;s folder. You&apos;ll see what changes before anything is saved</span>
                    </span>
                  </DropdownMenuItem>
                )}
                {onSaveToFolder && (
                  <DropdownMenuItem onSelect={() => void exportTo('folder')} className="items-start gap-2 py-2">
                    <FolderOpenIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <span className="block text-sm">Save to a folder</span>
                      <span className="block text-[11px] text-muted-foreground">All the files in a new folder called {folder}</span>
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void exportTo('zip')} className="items-start gap-2 py-2">
                  <DownloadIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="block text-sm">Save as a zip</span>
                    <span className="block text-[11px] text-muted-foreground">One file to keep or send to your developer: {folder}.zip</span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button className="w-full" disabled={nothingPicked} onClick={() => void exportTo('zip')}>
              <DownloadIcon className="mr-1.5 h-4 w-4" />
              Download a zip
            </Button>
          )}
          {nothingPicked && !progress && !looking && !scan && <p className="mt-2 text-[11px] text-muted-foreground">Tick at least one to export</p>}
        </div>
      </div>
    </>
  );
}
