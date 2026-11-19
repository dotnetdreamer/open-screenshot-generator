"use client";

// Remove background: the activity bar's view for cutting people and things out
// of photos, and the list of the user's own pictures that the palette's Custom
// tab places on artboards (src/lib/cutout).
//
// Pictures are cut in the order they were added, one at a time, by the queue
// (queue.ts); the one on screen shows each mask as it arrives, Apple's first on
// a Mac and the model's after it. Every change is kept on its own: a brush
// stroke or an edge setting saves a new picture a moment later, so there is no
// Save button to forget.

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  CloudUploadIcon,
  DownloadIcon,
  EraserIcon,
  EyeIcon,
  ImagePlusIcon,
  InfoIcon,
  Loader2Icon,
  MaximizeIcon,
  MinusIcon,
  PaintbrushIcon,
  PlusIcon,
  Redo2Icon,
  RotateCcwIcon,
  ScissorsIcon,
  SparklesIcon,
  Trash2Icon,
  Undo2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { saveBlobToDisk } from '@/lib/desktop';
import { getMediaAsset } from '@/lib/mediaStore';
import { useAccount } from '@/lib/account/store';
import {
  DEFAULT_RENDER,
  detectCutout,
  downloadCutoutModel,
  forgetPicture,
  openPicture,
  renderCutout,
  shapeMask,
  stopCutoutDownload,
  useCutoutStatus,
  type CutStep,
  type CutoutEngine,
  type RenderSettings,
} from '@/lib/cutout/engine';
import { megabytes } from '@/lib/cutout/models';
import {
  deleteLibraryImage,
  getLibraryImage,
  renameLibraryImage,
  saveLibraryCut,
  setLibraryImageState,
  useLibraryImages,
  type LibraryImageRow,
} from '@/lib/cutout/library';
import { addPictureFiles, PICTURE_ACCEPT } from '@/lib/cutout/add';
import { drainLibraryQueue, onLibraryCutStep } from '@/lib/cutout/queue';
import { decodeMask, decodePicture, encodeMask, encodeRgba, thumbnailOf, type WorkingPicture } from '@/lib/cutout/picture';
import { swapPatch, type BrushMode, type MaskPatch } from '@/lib/cutout/refine';
import { libraryBackupLabel, syncLibrary } from '@/lib/cutout/backup';
import { useThumbUrl } from './thumbs';
import { CutoutCanvas, type Backdrop, type CutoutCanvasHandle } from './CutoutCanvas';

export interface CutoutRequest {
  /** Show this library picture. */
  imageId?: string;
  nonce: number;
}

interface CutoutWorkspaceProps {
  active: boolean;
  request: CutoutRequest | null;
  flushRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  /** Puts a picture on the active artboard and goes back to the editor. */
  onPlace: (row: LibraryImageRow) => void;
  onOpenAccount: () => void;
  onBackToEditor: () => void;
  /** Hands a picture to the Claude Code or Codex agent, when one can take it. */
  onAskAgent?: (row: LibraryImageRow) => void;
  agentUnavailable?: string;
}

const ENGINE_WORDS: Record<CutoutEngine, string> = {
  existing: 'This picture had no background to remove',
  color: 'Plain background removed',
  model: 'Background removed',
  vision: 'Background removed by your Mac',
};

type Undo = { kind: 'mask'; patch: MaskPatch } | { kind: 'settings'; settings: RenderSettings };

interface Open {
  id: string;
  picture: WorkingPicture;
  mask: Uint8Array;
  settings: RenderSettings;
  engine?: CutoutEngine;
}

function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={text}>
          <InfoIcon className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[16rem] text-xs leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function stateWords(row: LibraryImageRow): string | null {
  if (row.state === 'waiting') return 'Waiting its turn';
  if (row.state === 'cutting') return 'Removing the background';
  if (row.state === 'failed') return "Couldn't remove the background";
  return null;
}

function LibraryTile({ row, selected, onSelect }: { row: LibraryImageRow; selected: boolean; onSelect: () => void }) {
  const url = useThumbUrl(row);
  const words = stateWords(row);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={words ? `${row.name}, ${words.toLowerCase()}` : row.name}
      data-testid="cutout-tile"
      className={cn(
        'group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,hsl(var(--background))_0%_50%)] bg-[length:14px_14px] p-1.5 transition-colors',
        selected ? 'border-primary ring-2 ring-primary/40' : 'hover:border-foreground/30'
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" className="max-h-full max-w-full object-contain" draggable={false} />}
      {words && (
        <span className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded bg-background/90 px-1 py-0.5 text-[10px] font-medium leading-tight text-foreground">
          {row.state === 'cutting' && <Loader2Icon className="h-3 w-3 animate-spin" />}
          {words}
        </span>
      )}
    </button>
  );
}

function ModelCard() {
  const status = useCutoutStatus();
  const { toast } = useToast();
  const model = status.model;
  if (!model || status.phase === 'unknown' || status.phase === 'ready' || status.phase === 'loading') return null;
  const size = megabytes(model.bytes);
  const start = () =>
    downloadCutoutModel()
      .then(() => {
        void drainLibraryQueue();
      })
      .catch((error) => {
        if ((error as { stopped?: boolean })?.stopped) return;
        toast({ title: "The download didn't finish", description: error instanceof Error ? error.message : 'Try again in a moment.' });
      });
  if (status.phase === 'downloading') {
    const received = Math.min(status.received, model.bytes);
    return (
      <div className="rounded-lg border bg-card p-3" data-testid="cutout-model-card">
        <p className="text-xs font-medium">Downloading</p>
        <Progress value={(received / model.bytes) * 100} className="mt-2 h-1.5" />
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {megabytes(received)} of {size} done
          </span>
          <button type="button" className="font-medium text-foreground hover:underline" onClick={() => stopCutoutDownload()}>
            Stop
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-card p-3" data-testid="cutout-model-card">
      <p className="text-xs font-medium">{status.phase === 'failed' ? "The download didn't finish" : status.vision ? 'Get cleaner edges' : 'One download to get started'}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        {status.phase === 'failed' && status.error
          ? status.error
          : status.vision
            ? `Your Mac can already remove backgrounds. Download this once (${size}) and hair and small details come out cleaner.`
            : `Removing backgrounds needs a one-time download (${size}). After that, everything works without internet.`}
      </p>
      <Button type="button" size="sm" className="mt-2 h-7 w-full gap-1.5 text-xs" onClick={start}>
        <DownloadIcon className="h-3.5 w-3.5" />
        {status.phase === 'failed' ? 'Try again' : `Download (${size})`}
      </Button>
    </div>
  );
}

export function CutoutWorkspace({ active, request, flushRef, onPlace, onOpenAccount, onBackToEditor, onAskAgent, agentUnavailable }: CutoutWorkspaceProps) {
  const { toast } = useToast();
  const rows = useLibraryImages();
  const status = useCutoutStatus();
  const account = useAccount();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [shown, setShown] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [brushMode, setBrushMode] = useState<BrushMode>('erase');
  const [brushSize, setBrushSize] = useState(40);
  const [backdrop, setBackdrop] = useState<Backdrop>('checker');
  const [backdropColor, setBackdropColor] = useState('#3b82f6');
  const [showOriginal, setShowOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<LibraryImageRow | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [, setHistoryTick] = useState(0);
  const canvasRef = useRef<CutoutCanvasHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<Undo[]>([]);
  const redoRef = useRef<Undo[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChain = useRef<Promise<boolean>>(Promise.resolve(true));
  const shapeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  // The settings an edge slider started its drag from, which undo goes back to.
  const dragFrom = useRef<RenderSettings | null>(null);

  const selected = useMemo(() => rows?.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);

  useEffect(() => {
    if (!active) return;
    void detectCutout();
    void drainLibraryQueue();
  }, [active]);

  // A request names a picture to show (the palette's "Remove background").
  useEffect(() => {
    if (request?.imageId) setSelectedId(request.imageId);
  }, [request]);

  // The first picture is shown when nothing is.
  useEffect(() => {
    if (!rows) return;
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  const clearHistory = () => {
    undoRef.current = [];
    redoRef.current = [];
    setHistoryTick((tick) => tick + 1);
  };

  // Opens the selected picture: its photo and its mask. Again when a cut
  // finishes, but not when this view saved an edit: the canvas has it already,
  // and opening again would lose the zoom and the undo history.
  const cutting = selected?.state === 'waiting' || selected?.state === 'cutting';
  const loadedKey = selected ? `${selected.id}|${cutting ? 'cutting' : 'settled'}` : '';
  useEffect(() => {
    if (!selected) {
      setOpen(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const source = selected.sourceMediaId ? await getMediaAsset(selected.sourceMediaId) : undefined;
      const fallback = !source && selected.mediaId ? await getMediaAsset(selected.mediaId) : undefined;
      const blob = source?.blob ?? fallback?.blob;
      if (!blob) throw new Error('This picture is no longer on this device');
      const picture = await decodePicture(blob);
      let mask: Uint8Array;
      const maskRow = selected.maskMediaId ? await getMediaAsset(selected.maskMediaId) : undefined;
      if (maskRow) mask = await decodeMask(maskRow.blob, picture.width, picture.height);
      else if (fallback || selected.state === 'plain') {
        mask = new Uint8Array(picture.width * picture.height);
        if (picture.hasAlpha) for (let i = 0; i < mask.length; i++) mask[i] = picture.rgba[i * 4 + 3];
        else mask.fill(255);
      } else mask = new Uint8Array(picture.width * picture.height).fill(255);
      await openPicture(selected.id, picture);
      if (cancelled) return;
      setOpen({ id: selected.id, picture, mask, settings: { ...DEFAULT_RENDER, ...selected.settings }, engine: selected.engine });
      setShown(null);
      clearHistory();
    })()
      .catch((error) => {
        if (cancelled) return;
        console.error('Opening a picture failed', error);
        setOpen(null);
        toast({ title: "That picture couldn't be opened", description: error instanceof Error ? error.message : 'Try another one.' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The key says when the picture or its saved cut changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);

  useEffect(() => () => {
    const current = openRef.current;
    if (current) forgetPicture(current.id);
  }, []);

  // The queue's masks for the picture on screen, as they improve.
  useEffect(
    () =>
      onLibraryCutStep((id, step: CutStep | null) => {
        const current = openRef.current;
        if (!step || !current || current.id !== id || step.width !== current.picture.width || step.height !== current.picture.height) return;
        current.mask.set(step.mask);
        const next = { ...current, engine: step.engine };
        openRef.current = next;
        setOpen(next);
        canvasRef.current?.refresh();
      }),
    []
  );

  // The edge controls, shown on the mask a moment after they change.
  const reshape = useCallback((current: Open) => {
    if (shapeTimer.current) clearTimeout(shapeTimer.current);
    shapeTimer.current = setTimeout(() => {
      const { edge, softness } = current.settings;
      if (!edge && softness <= 0) {
        setShown(null);
        return;
      }
      void shapeMask(current.mask, current.picture.width, current.picture.height, edge, softness)
        .then((mask) => {
          if (openRef.current?.id === current.id) setShown(mask);
        })
        .catch((error) => console.error('Showing the edge failed', error));
    }, 120);
  }, []);

  const save = useCallback((): Promise<boolean> => {
    const current = openRef.current;
    saveTimer.current = null;
    if (!current) return Promise.resolve(true);
    const mask = current.mask.slice();
    setSaving(true);
    const job = saveChain.current.then(async () => {
      try {
        const rendered = await renderCutout(current.id, mask, current.settings);
        const rgba = new Uint8ClampedArray(rendered.rgba);
        const [picture, maskFile, thumb] = await Promise.all([
          encodeRgba(rgba, rendered.width, rendered.height),
          encodeMask(mask, current.picture.width, current.picture.height),
          thumbnailOf(rgba, rendered.width, rendered.height),
        ]);
        await saveLibraryCut(current.id, {
          picture,
          mask: maskFile,
          width: rendered.width,
          height: rendered.height,
          thumb: await thumb.arrayBuffer(),
          settings: current.settings,
          rect: rendered.rect,
        });
        return true;
      } catch (error) {
        console.error('Saving a cut-out failed', error);
        toast({ title: "Your change wasn't saved", description: error instanceof Error ? error.message : 'Try again.' });
        return false;
      }
    });
    saveChain.current = job;
    void job.then(() => {
      if (saveChain.current === job) setSaving(false);
    });
    return job;
  }, [toast]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 900);
  }, [save]);

  const flushSave = useCallback(async () => {
    if (!saveTimer.current) return saveChain.current;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    return save();
  }, [save]);

  useImperativeHandle(flushRef, () => flushSave, [flushSave]);

  const savedSelection = async () => {
    if (!selected || !(await flushSave())) return null;
    const row = await getLibraryImage(selected.id);
    return row && !row.deletedAt ? row : null;
  };

  /** Shows another picture, saving the one on screen first if a change is waiting. */
  const select = (id: string) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      void save();
    }
    setSelectedId(id);
  };

  /** A slider drag is one undo step, back to where the drag began. */
  const commitDrag = () => {
    if (!dragFrom.current) return;
    undoRef.current.push({ kind: 'settings', settings: dragFrom.current });
    redoRef.current = [];
    dragFrom.current = null;
    setHistoryTick((tick) => tick + 1);
  };

  const changeSettings = (patch: Partial<RenderSettings>, record = true) => {
    const current = openRef.current;
    if (!current) return;
    if (record) {
      undoRef.current.push({ kind: 'settings', settings: current.settings });
      redoRef.current = [];
    } else if (!dragFrom.current) {
      dragFrom.current = current.settings;
    }
    const next = { ...current, settings: { ...current.settings, ...patch } };
    // At once, not at the next render: a save started right after this (Add to
    // artboard straight after a switch) reads openRef.
    openRef.current = next;
    setOpen(next);
    reshape(next);
    scheduleSave();
  };

  const onStroke = (patch: MaskPatch) => {
    undoRef.current.push({ kind: 'mask', patch });
    redoRef.current = [];
    setHistoryTick((tick) => tick + 1);
    const current = openRef.current;
    if (current) reshape(current);
    scheduleSave();
  };

  const step = (from: React.MutableRefObject<Undo[]>, to: React.MutableRefObject<Undo[]>) => {
    const current = openRef.current;
    const entry = from.current.pop();
    if (!current || !entry) return;
    if (entry.kind === 'mask') {
      to.current.push({ kind: 'mask', patch: swapPatch(current.mask, current.picture.width, entry.patch) });
      canvasRef.current?.refresh(entry.patch.rect);
      reshape(current);
    } else {
      to.current.push({ kind: 'settings', settings: current.settings });
      const next = { ...current, settings: entry.settings };
      openRef.current = next;
      setOpen(next);
      reshape(next);
    }
    setHistoryTick((tick) => tick + 1);
    scheduleSave();
  };
  const undo = () => step(undoRef, redoRef);
  const redo = () => step(redoRef, undoRef);

  // Keys while the view is in front and nobody is typing.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, [contenteditable="true"]') || target.closest('[role="menu"], [role="dialog"]'))) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (!mod && event.key === '[') setBrushSize((size) => Math.max(4, Math.round(size / 1.25)));
      else if (!mod && event.key === ']') setBrushSize((size) => Math.min(400, Math.round(size * 1.25)));
      else if (!mod && event.key.toLowerCase() === 'x') setBrushMode((mode) => (mode === 'erase' ? 'keep' : 'erase'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // undo and redo read refs; binding once per activation is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const addFiles = async (files: File[]) => {
    const pictures = files.filter((file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif|gif|avif)$/i.test(file.name));
    if (pictures.length === 0) {
      toast({ title: 'Only photos can be added', description: 'Use PNG, JPG, WebP or HEIC files.' });
      return;
    }
    const added = await addPictureFiles(pictures, { cut: true }).catch((error) => {
      toast({ title: "The photos couldn't be added", description: error instanceof Error ? error.message : 'Try again.' });
      return [];
    });
    if (added.length) setSelectedId(added[0].id);
    void drainLibraryQueue();
  };

  const place = async () => {
    const row = await savedSelection();
    if (row) onPlace(row);
  };

  const exportPng = async () => {
    const row = await savedSelection();
    if (!row?.mediaId) return;
    const asset = await getMediaAsset(row.mediaId);
    if (!asset) return;
    await saveBlobToDisk(asset.blob, `${row.name}.png`).catch((error) =>
      toast({ title: "The picture wasn't exported", description: error instanceof Error ? error.message : 'Try again.' })
    );
  };

  const cutAgain = async () => {
    if (!selected) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    await setLibraryImageState(selected.id, 'waiting');
    void drainLibraryQueue();
  };

  const keepWhole = () => {
    const current = openRef.current;
    if (!current) return;
    const before = current.mask.slice();
    current.mask.fill(255);
    onStroke({ rect: { x: 0, y: 0, width: current.picture.width, height: current.picture.height }, before });
    canvasRef.current?.refresh();
  };

  const backup = async () => {
    if (!account.session) {
      onOpenAccount();
      return;
    }
    setSyncing(true);
    try {
      if (!(await flushSave())) return;
      const result = await syncLibrary();
      toast({
        title: 'Your pictures are backed up',
        description: result.uploaded || result.downloaded
          ? `${result.uploaded} saved to ${libraryBackupLabel(account.session.provider)}, ${result.downloaded} brought back to this computer.`
          : `${libraryBackupLabel(account.session.provider)} already had all your pictures.`,
      });
    } catch (error) {
      toast({ title: "Your pictures weren't backed up", description: error instanceof Error ? error.message : 'Try again.' });
    } finally {
      setSyncing(false);
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const count = rows?.length ?? 0;
  const settings = open?.settings ?? DEFAULT_RENDER;

  return (
    <TooltipProvider delayDuration={200}>
      <section
        className="flex h-full min-h-0 flex-col bg-background"
        data-testid="cutout-view"
        aria-labelledby="cutout-view-title"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScissorsIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 id="cutout-view-title" className="text-sm font-semibold">
              Remove background
            </h1>
            <p className="truncate text-xs text-muted-foreground">Cut out people and products from your photos</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {(status.phase === 'ready' || status.vision) && (
              <span
                className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                data-testid="cutout-offline"
                title={status.phase === 'ready' ? 'Everything needed is on this computer' : 'Your Mac removes backgrounds without internet'}
              >
                Works without internet
              </span>
            )}
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void backup()} disabled={syncing}>
              {syncing ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <CloudUploadIcon className="h-3.5 w-3.5" />}
              {account.session ? `Back up to ${libraryBackupLabel(account.session.provider)}` : 'Sign in to back up'}
            </Button>
            <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => fileRef.current?.click()}>
              <ImagePlusIcon className="h-3.5 w-3.5" />
              Add photos
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onBackToEditor}>
              Back to the editor
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept={PICTURE_ACCEPT}
              multiple
              className="hidden"
              data-testid="cutout-file-input"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                void addFiles(files);
              }}
            />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r p-3" aria-label="Your pictures">
            <ModelCard />
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold">Your pictures</h2>
              {count > 0 && <span className="text-[11px] text-muted-foreground">{count}</span>}
            </div>
            {count === 0 ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Photos you add show up here. You'll find them in the Custom tab of the editor too.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {rows!.map((row) => (
                  <LibraryTile key={row.id} row={row} selected={row.id === selectedId} onSelect={() => select(row.id)} />
                ))}
              </div>
            )}
          </aside>

          <main className="relative flex min-w-0 flex-1 flex-col bg-muted/30" aria-label="The picture">
            {open && selected ? (
              <>
                <CutoutCanvas
                  ref={canvasRef}
                  picture={open.picture}
                  mask={open.mask}
                  shown={shown}
                  backdrop={backdrop}
                  backdropColor={backdropColor}
                  showOriginal={showOriginal}
                  brush={cutting ? null : { mode: brushMode, size: brushSize }}
                  onStroke={onStroke}
                  onZoomChange={setZoom}
                  className="flex-1"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                  <div className="pointer-events-auto flex items-center gap-1 rounded-full border bg-background/95 px-1.5 py-1 shadow-sm">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Zoom out" onClick={() => canvasRef.current?.zoomBy(1 / 1.25)}>
                      <MinusIcon className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-11 text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Zoom in" onClick={() => canvasRef.current?.zoomBy(1.25)}>
                      <PlusIcon className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Show the whole picture" onClick={() => canvasRef.current?.fit()}>
                      <MaximizeIcon className="h-3.5 w-3.5" />
                    </Button>
                    <span aria-hidden className="mx-1 h-4 w-px bg-border" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      title="Hold to see the photo as it was"
                      onPointerDown={() => setShowOriginal(true)}
                      onPointerUp={() => setShowOriginal(false)}
                      onPointerLeave={() => setShowOriginal(false)}
                    >
                      <EyeIcon className="h-3.5 w-3.5" />
                      Before
                    </Button>
                  </div>
                </div>
                {cutting && (
                  <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs shadow-sm" data-testid="cutout-busy">
                    <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                    {selected.state === 'waiting' ? 'Waiting for the other photos to finish' : 'Removing the background'}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6">
                {loading ? (
                  <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className={cn(
                      'flex w-full max-w-md flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                      dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30'
                    )}
                    data-testid="cutout-drop"
                  >
                    <ImagePlusIcon className="h-8 w-8 text-muted-foreground" />
                    <span className="text-sm font-medium">Drop photos here, or click to choose</span>
                    <span className="text-xs leading-snug text-muted-foreground">
                      Your photos stay on this computer. Nothing gets uploaded.
                    </span>
                  </button>
                )}
              </div>
            )}
            {dragging && open && (
              <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5 text-sm font-medium">
                Drop the photos here
              </div>
            )}
          </main>

          <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l p-3" aria-label="Edit the cut-out">
            {selected && open ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="cutout-name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="cutout-name"
                    key={selected.id}
                    defaultValue={selected.name}
                    className="h-8 text-xs"
                    onBlur={(event) => void renameLibraryImage(selected.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    }}
                  />
                  {/* Only once the cut is saved: a setting changed before then would be
                      replaced by the saved cut when it lands. */}
                  {open.engine && !cutting && <p className="text-[11px] text-muted-foreground">{ENGINE_WORDS[open.engine]}</p>}
                  {selected.state === 'failed' && <p className="text-[11px] text-destructive">{selected.error}</p>}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium">Fix by hand</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      type="button"
                      variant={brushMode === 'erase' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      aria-pressed={brushMode === 'erase'}
                      title="Paint over the parts you want gone, or press X to switch"
                      onClick={() => setBrushMode('erase')}
                    >
                      <EraserIcon className="h-3.5 w-3.5" />
                      Erase
                    </Button>
                    <Button
                      type="button"
                      variant={brushMode === 'keep' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      aria-pressed={brushMode === 'keep'}
                      title="Paint over the parts you want back, or press X to switch"
                      onClick={() => setBrushMode('keep')}
                    >
                      <PaintbrushIcon className="h-3.5 w-3.5" />
                      Bring back
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="w-16 shrink-0 text-[11px] text-muted-foreground">Brush size</Label>
                    <Slider value={[brushSize]} min={4} max={400} step={1} onValueChange={([value]) => setBrushSize(value)} aria-label="Brush size" />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={cutting || undoRef.current.length === 0} onClick={undo}>
                      <Undo2Icon className="h-3.5 w-3.5" />
                      Undo
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={cutting || redoRef.current.length === 0} onClick={redo}>
                      <Redo2Icon className="h-3.5 w-3.5" />
                      Redo
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-medium">Edges</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] text-muted-foreground">Shrink or grow</Label>
                      <Hint text="Drag left to trim off a thin line of the old background. Drag right if the edge cuts into the person or product." />
                    </div>
                    <Slider
                      value={[settings.edge]}
                      min={-10}
                      max={10}
                      step={1}
                      aria-label="Shrink or grow the edges"
                      disabled={cutting}
                      onValueChange={([value]) => changeSettings({ edge: value }, false)}
                      onValueCommit={commitDrag}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] text-muted-foreground">Soften</Label>
                      <Hint text="Makes the edges a little blurry. A little helps with hair and fur." />
                    </div>
                    <Slider
                      value={[settings.softness]}
                      min={0}
                      max={20}
                      step={1}
                      aria-label="Soften the edges"
                      disabled={cutting}
                      onValueChange={([value]) => changeSettings({ softness: value }, false)}
                      onValueCommit={commitDrag}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="cutout-clean" className="text-[11px]">
                      Fix colored edges
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Hint text="Takes leftover color from the old background out of the edges, so hair doesn't look outlined." />
                      <Switch id="cutout-clean" disabled={cutting} checked={settings.cleanColors} onCheckedChange={(checked) => changeSettings({ cleanColors: checked })} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="cutout-trim" className="text-[11px]">
                      Cut off empty space
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Hint text="Crops the picture close around what's left, so the picture is easier to place on an artboard." />
                      <Switch id="cutout-trim" disabled={cutting} checked={settings.trim} onCheckedChange={(checked) => changeSettings({ trim: checked })} />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium">Try on a background</p>
                  <div className="flex items-center gap-1.5">
                    {(['checker', 'white', 'black', 'color'] as Backdrop[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        title={option === 'checker' ? 'Checkerboard, to see what is see-through' : option === 'color' ? 'A color you pick' : option === 'white' ? 'White' : 'Black'}
                        aria-pressed={backdrop === option}
                        onClick={() => setBackdrop(option)}
                        className={cn('h-7 w-7 rounded-md border', backdrop === option && 'ring-2 ring-primary')}
                        style={{
                          background:
                            option === 'checker'
                              ? 'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%) 50% / 10px 10px'
                              : option === 'white'
                                ? '#ffffff'
                                : option === 'black'
                                  ? '#111111'
                                  : backdropColor,
                        }}
                      />
                    ))}
                    {backdrop === 'color' && (
                      <input
                        type="color"
                        value={backdropColor}
                        onChange={(event) => setBackdropColor(event.target.value)}
                        className="h-7 w-9 cursor-pointer rounded border bg-transparent"
                        aria-label="Pick the background color"
                      />
                    )}
                  </div>
                </div>

                <div className="mt-auto space-y-1.5 pt-2">
                  <Button type="button" size="sm" className="h-8 w-full gap-1.5 text-xs" disabled={cutting || !selected.mediaId} onClick={() => void place()} data-testid="cutout-place">
                    <PlusIcon className="h-3.5 w-3.5" />
                    Add to artboard
                  </Button>
                  {onAskAgent && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full gap-1.5 text-xs"
                      disabled={cutting || !selected.mediaId || !!agentUnavailable}
                      title={agentUnavailable ?? 'The AI assistant puts the picture into your design for you'}
                      onClick={async () => {
                        const row = await savedSelection();
                        if (row) onAskAgent(row);
                      }}
                    >
                      <SparklesIcon className="h-3.5 w-3.5" />
                      Ask AI to use the picture
                    </Button>
                  )}
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={cutting || !selected.mediaId} onClick={() => void exportPng()}>
                      <DownloadIcon className="h-3.5 w-3.5" />
                      Export as PNG
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={cutting}>
                          <RotateCcwIcon className="h-3.5 w-3.5" />
                          Start over
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void cutAgain()}>Remove the background again</DropdownMenuItem>
                        <DropdownMenuItem onSelect={keepWhole}>Keep the whole photo</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full gap-1.5 text-xs text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete(selected)}
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                  {saving && <p className="text-center text-[11px] text-muted-foreground">Saving</p>}
                </div>
              </>
            ) : (
              <p className="text-[11px] leading-snug text-muted-foreground">
                Choose a picture on the left to fix it, or add photos to start.
              </p>
            )}
          </aside>
        </div>

        <AlertDialog open={!!confirmDelete} onOpenChange={(value) => !value && setConfirmDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The picture leaves Your pictures and the Custom tab. Artboards that already use the picture won't change.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const row = confirmDelete;
                  setConfirmDelete(null);
                  if (!row) return;
                  if (saveTimer.current && openRef.current?.id === row.id) {
                    clearTimeout(saveTimer.current);
                    saveTimer.current = null;
                  }
                  void deleteLibraryImage(row.id);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </TooltipProvider>
  );
}
