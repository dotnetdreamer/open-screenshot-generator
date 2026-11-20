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
import { getMediaAsset, type MediaAsset } from '@/lib/mediaStore';
import { useAccount } from '@/lib/account/store';
import {
  CutoutWorkerError,
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
import { NOT_OPEN } from '@/lib/cutout/worker/protocol';
import { megabytes } from '@/lib/cutout/models';
import {
  deleteLibraryImage,
  getLibraryImage,
  isOutOfRoom,
  OUT_OF_ROOM,
  photoOf,
  PictureChangedError,
  renameLibraryImage,
  saveLibraryCut,
  setLibraryImageState,
  useLibraryImages,
  type LibraryImageRow,
} from '@/lib/cutout/library';
import { addPictureFiles, mayBePicture, PICTURE_ACCEPT } from '@/lib/cutout/add';
import { drainLibraryQueue, onLibraryCutStep } from '@/lib/cutout/queue';
import { asPng, decodeMask, decodePicture, encodeMask, encodeRgba, thumbnailOf, type WorkingPicture } from '@/lib/cutout/picture';
import { swapPatch, type BrushMode, type MaskPatch } from '@/lib/cutout/refine';
import { describeSync, libraryBackupLabel, syncLibrary } from '@/lib/cutout/backup';
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
  /** The opening of the picture these belong to, the same object for every change made in it. */
  session: EditSession;
}

/**
 * What an edit of a picture starts from: the photo its mask is over, and the
 * version of the picture it opened at (or this view saved last). A save names
 * both, so one made over an older version is refused (saveLibraryCut).
 */
interface Basis {
  photo: MediaAsset;
  mediaId: string | undefined;
  sourceMediaId: string | undefined;
}

/**
 * One opening of a picture, from when it is shown until it is opened again or
 * another one is. Every change made in it is saved over its own basis, which
 * only its own saves move on, so a save that runs late (queued behind others,
 * or after the view moved to another picture) keeps the mask with the version
 * it was drawn on: one made over a version the picture no longer is, is
 * refused, never written over the newer one.
 */
interface EditSession {
  /** The worker's name for the picture in this opening. */
  key: string;
  basis: Basis;
  /** Changes made in it, and how many of them a save has kept. */
  made: number;
  kept: number;
  /** Its changes were made over a version the picture no longer is: they went, and it saves no more. */
  over: boolean;
  /**
   * The versions of the picture it opened at or saved (`versionOf`). The list
   * showing one of them is no change made elsewhere: the list hears of a save
   * a moment after the save is done, so for that moment it shows the version
   * before.
   */
  known: Set<string>;
}

/** Which version of a picture a row shows: its picture and its photo. */
const versionOf = (row: Pick<LibraryImageRow, 'mediaId' | 'sourceMediaId'>) => `${row.mediaId ?? ''}|${row.sourceMediaId ?? ''}`;

/** The finished picture for one opening of a picture, handing the worker the picture again when it let it go. */
async function renderOpen(current: Open, mask: Uint8Array): Promise<Awaited<ReturnType<typeof renderCutout>>> {
  const { key } = current.session;
  try {
    return await renderCutout(key, mask, current.settings);
  } catch (error) {
    if (!(error instanceof CutoutWorkerError) || error.message !== NOT_OPEN) throw error;
    await openPicture(key, current.picture);
    return renderCutout(key, mask, current.settings);
  }
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

/** True on a screen worked with fingers: no mouse to hover, a finger to point. */
function useTouchFirst(): boolean {
  const [touchFirst, setTouchFirst] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(hover: none) and (pointer: coarse)');
    const update = () => setTouchFirst(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return touchFirst;
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
  // On a phone or tablet a finger swiped over the picture would erase it, so
  // there the brush is off until Erase or Bring back is tapped, and tapping
  // the lit one turns it off again.
  const touchFirst = useTouchFirst();
  const [fingerBrush, setFingerBrush] = useState(false);
  const fingerPaints = !touchFirst || fingerBrush;
  const pickBrush = (mode: BrushMode) => {
    if (touchFirst && fingerBrush && brushMode === mode) {
      setFingerBrush(false);
      return;
    }
    setBrushMode(mode);
    setFingerBrush(true);
  };
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
  // The change waiting for its save: the opening it was made in, as it was
  // after the change. A save started for it saves that opening, whichever
  // picture is on screen by then.
  const pendingRef = useRef<Open | null>(null);
  // Counts openings, for the worker's names for them.
  const openingsRef = useRef(0);
  // The opening this view handed the worker. Another one opening lets it go,
  // once the saves still to run for it have.
  const workerKeyRef = useRef<string | null>(null);
  // Opens the picture again when it changed elsewhere, or a save found it so.
  const [reopened, setReopened] = useState(0);
  // The load the picture on screen came from (loadedKey below).
  const openedKeyRef = useRef('');
  // The settings an edge slider started its drag from, which undo goes back to.
  const dragFrom = useRef<RenderSettings | null>(null);

  const selected = useMemo(() => rows?.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);

  // `save`, for the code above where it is made.
  const saveRef = useRef<(target: Open) => Promise<boolean>>(async () => true);

  /** Saves a change still waiting for its moment now, before the view moves to another picture or opening. */
  const startPending = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void saveRef.current(pending);
  }, []);

  /**
   * Shows another picture. A change still waiting on the one on screen is
   * saved first, for every way a picture is chosen: a tile, a picture just
   * added or dropped, a request from the editor.
   */
  const choose = useCallback(
    (id: string | null) => {
      startPending();
      setSelectedId(id);
    },
    [startPending]
  );

  useEffect(() => {
    if (!active) return;
    void detectCutout();
    void drainLibraryQueue();
  }, [active]);

  // A request names a picture to show (the palette's "Remove background").
  useEffect(() => {
    if (request?.imageId) choose(request.imageId);
  }, [request, choose]);

  // A picture just added, chosen before the list has it: the list catches up
  // a moment later, and until then the choice stands.
  const arrivingRef = useRef<string | null>(null);

  // The first picture is shown when nothing is.
  useEffect(() => {
    if (!rows) return;
    if (selectedId && rows.some((row) => row.id === selectedId)) {
      if (arrivingRef.current === selectedId) arrivingRef.current = null;
      return;
    }
    if (selectedId && arrivingRef.current === selectedId) return;
    choose(rows[0]?.id ?? null);
  }, [rows, selectedId, choose]);

  const clearHistory = () => {
    undoRef.current = [];
    redoRef.current = [];
    setHistoryTick((tick) => tick + 1);
  };

  // Opens the selected picture: its photo and its mask. Again when a cut
  // finishes, but not when this view saved an edit: the canvas has it already,
  // and opening again would lose the zoom and the undo history.
  const cutting = selected?.state === 'waiting' || selected?.state === 'cutting';
  const loadedKey = selected ? `${selected.id}|${cutting ? 'cutting' : 'settled'}|${reopened}` : '';
  useEffect(() => {
    // A change still waiting belongs to the opening on screen until now.
    startPending();
    if (!selected) {
      setOpen(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // A picture restored without its photo gets a copy of itself as one, so
      // a hand edit saved here fits the same photo the next time it opens.
      // The mask and settings come with it, from the row as photoOf left it.
      const source = await photoOf(selected.id);
      if (!source) throw new Error('This picture is no longer on this device');
      const picture = await decodePicture(source.photo.blob);
      let mask: Uint8Array;
      if (source.mask) mask = await decodeMask(source.mask.blob, picture.width, picture.height);
      else {
        // No cut yet: the photo's own transparency is the mask.
        mask = new Uint8Array(picture.width * picture.height);
        if (picture.hasAlpha) for (let i = 0; i < mask.length; i++) mask[i] = picture.rgba[i * 4 + 3];
        else mask.fill(255);
      }
      if (cancelled) return;
      // Each opening is the worker's own picture, so a save of the one
      // before (the same picture at another version, or another picture)
      // still draws on what it was drawn over. That one goes from the worker
      // once its saves ran.
      const session: EditSession = {
        key: `${selected.id}#${(openingsRef.current += 1)}`,
        basis: { photo: source.photo, mediaId: source.row.mediaId, sourceMediaId: source.row.sourceMediaId },
        made: 0,
        kept: 0,
        over: false,
        // The row as the list showed it, and as photoOf left it (a copy of the picture kept as its photo).
        known: new Set([versionOf(selected), versionOf(source.row)]),
      };
      const previous = workerKeyRef.current;
      if (previous) {
        void saveChain.current.then(() => {
          if (workerKeyRef.current !== previous) forgetPicture(previous);
        });
      }
      workerKeyRef.current = session.key;
      await openPicture(session.key, picture);
      if (cancelled) {
        forgetPicture(session.key);
        return;
      }
      const next: Open = { id: selected.id, picture, mask, settings: { ...DEFAULT_RENDER, ...source.row.settings }, engine: source.row.engine, session };
      openRef.current = next;
      openedKeyRef.current = loadedKey;
      setOpen(next);
      setShown(null);
      // The edge settings it was saved with, on the mask as the picture has them.
      reshape(next);
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
    startPending();
    const key = workerKeyRef.current;
    workerKeyRef.current = null;
    if (key) void saveChain.current.then(() => forgetPicture(key));
  }, [startPending]);

  // The picture on screen changed somewhere else: an edit saved in another
  // window, or a newer version a backup brought. It opens again as it is now,
  // so the next change here starts from that version. A change made here and
  // not saved yet is left alone; its save finds the same and opens it again.
  useEffect(() => {
    if (!selected || !open || open.id !== selected.id || saving || openedKeyRef.current !== loadedKey) return;
    const { session } = open;
    if (session.known.has(versionOf(selected))) return;
    if (pendingRef.current?.session === session || (!session.over && session.kept < session.made)) return;
    setReopened((count) => count + 1);
  }, [selected, open, saving, loadedKey]);

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

  /**
   * Saves `target`: an opening of a picture as it was after a change. The
   * mask is the one on screen now; the version it is saved over is the
   * opening's own, read when the save's turn comes, so the saves queued
   * before it in the same opening count and nothing else does.
   */
  const save = useCallback((target: Open): Promise<boolean> => {
    const { session } = target;
    if (session.over) return Promise.resolve(true);
    const mask = target.mask.slice();
    // This save keeps every change made in the opening until now.
    const made = session.made;
    setSaving(true);
    const job = saveChain.current.then(async () => {
      if (session.over) return true;
      try {
        const rendered = await renderOpen(target, mask);
        // An opening the view left, sent to the worker again for this save.
        if (workerKeyRef.current !== session.key) forgetPicture(session.key);
        const rgba = new Uint8ClampedArray(rendered.rgba);
        const [picture, maskFile, thumb] = await Promise.all([
          encodeRgba(rgba, rendered.width, rendered.height),
          encodeMask(mask, target.picture.width, target.picture.height),
          thumbnailOf(rgba, rendered.width, rendered.height),
        ]);
        const { basis } = session;
        const row = await saveLibraryCut(target.id, {
          picture,
          mask: maskFile,
          width: rendered.width,
          height: rendered.height,
          thumb: await thumb.arrayBuffer(),
          settings: target.settings,
          rect: rendered.rect,
          photo: basis.photo,
          basis: basis.mediaId,
        });
        if (row) {
          // The next save in this opening starts from this version. A
          // picture that had no room for its photo when it opened has the
          // photo kept now.
          const photo = row.sourceMediaId && row.sourceMediaId !== basis.photo.id ? { ...basis.photo, id: row.sourceMediaId } : basis.photo;
          session.basis = { photo, mediaId: row.mediaId, sourceMediaId: row.sourceMediaId };
          session.known.add(versionOf(row));
        }
        session.kept = Math.max(session.kept, made);
        return true;
      } catch (error) {
        console.error('Saving a cut-out failed', error);
        const changed = error instanceof PictureChangedError;
        const onScreen = openRef.current?.session === session;
        // Made over a version the picture no longer is: the opening's
        // changes go, and the picture opens again as it is now.
        if (changed) {
          session.kept = session.made;
          session.over = true;
        }
        if (changed && onScreen) setReopened((count) => count + 1);
        toast({
          title: "Your change wasn't saved",
          description: changed
            ? `The picture changed while you were editing it${onScreen ? ', so it was opened again as it is now' : ''}.`
            : isOutOfRoom(error)
              ? OUT_OF_ROOM
              : error instanceof Error
                ? error.message
                : 'Try again.',
        });
        return false;
      }
    });
    saveChain.current = job;
    void job.then(() => {
      if (saveChain.current === job) setSaving(false);
    });
    return job;
  }, [toast]);
  saveRef.current = save;

  /** A change was made in the opening on screen: it is saved a moment later, or sooner when the view moves on. */
  const scheduleSave = useCallback(() => {
    const current = openRef.current;
    if (!current) return;
    // A change still waiting in another opening goes now, rather than with this one's timer.
    if (pendingRef.current && pendingRef.current.session !== current.session) startPending();
    current.session.made += 1;
    pendingRef.current = current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) void save(pending);
    }, 900);
  }, [save, startPending]);

  /**
   * Saves a change still waiting, before an export, a placement or a backup.
   * False when the picture on screen has a change no save could keep; a save
   * that failed is tried again here, and only for that opening's own changes:
   * another picture's failure, or a change let go since, holds nothing up.
   */
  const flushSave = useCallback(async (): Promise<boolean> => {
    const current = openRef.current;
    const pending = pendingRef.current;
    if (pending) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingRef.current = null;
      const saved = save(pending);
      if (pending.session === current?.session) return saved;
    }
    await saveChain.current;
    const { session } = openRef.current ?? {};
    if (session && !session.over && session.kept < session.made) return save(openRef.current as Open);
    return true;
  }, [save]);

  /** Changes on screen that will not be saved: the picture is cut again, or deleted. */
  const letChangesGo = (id: string) => {
    const pending = pendingRef.current;
    if (pending?.id === id) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      pendingRef.current = null;
      pending.session.kept = pending.session.made;
    }
    const current = openRef.current;
    if (current?.id === id) current.session.kept = current.session.made;
  };

  useImperativeHandle(flushRef, () => flushSave, [flushSave]);

  const savedSelection = async () => {
    if (!selected || !(await flushSave())) return null;
    const row = await getLibraryImage(selected.id);
    return row && !row.deletedAt ? row : null;
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
    if (files.length === 0) return;
    if (!files.some(mayBePicture)) {
      toast({ title: 'Only photos can be added', description: 'Use PNG, JPG, WebP or HEIC files.' });
      return;
    }
    // Every file goes in, so the count and the names in the message cover the
    // ones that are not photos too.
    const result = await addPictureFiles(files, { cut: true }).catch((error) => {
      toast({ title: "The photos couldn't be added", description: error instanceof Error ? error.message : 'Try again.' });
      return null;
    });
    if (result?.reason) {
      toast({ title: `${result.notAdded} of the ${files.length} files ${result.notAdded === 1 ? "wasn't" : "weren't"} added`, description: result.reason });
    }
    if (result?.added.length) {
      // Saved first, as every way of choosing a picture does: a change made
      // a moment ago on the one on screen is kept with that one.
      arrivingRef.current = result.added[0].id;
      choose(result.added[0].id);
    }
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
    try {
      // A picture kept as it came is a JPEG when it has no transparency.
      await saveBlobToDisk(await asPng(asset.blob), `${row.name}.png`);
    } catch (error) {
      toast({ title: "The picture wasn't exported", description: error instanceof Error ? error.message : 'Try again.' });
    }
  };

  const cutAgain = async () => {
    if (!selected) return;
    letChangesGo(selected.id);
    await setLibraryImageState(selected.id, 'waiting');
    void drainLibraryQueue();
  };

  /** The whole photo back, as it came: the parts it had see-through stay so. */
  const keepWhole = () => {
    const current = openRef.current;
    if (!current) return;
    const { picture, mask } = current;
    const before = mask.slice();
    if (picture.hasAlpha) for (let i = 0; i < mask.length; i++) mask[i] = picture.rgba[i * 4 + 3];
    else mask.fill(255);
    onStroke({ rect: { x: 0, y: 0, width: picture.width, height: picture.height }, before });
    canvasRef.current?.refresh();
  };

  const backup = async () => {
    if (!account.session) {
      onOpenAccount();
      return;
    }
    setSyncing(true);
    try {
      // A change that cannot be saved stays on screen, and its own message
      // said so; every picture already saved is backed up all the same.
      await flushSave();
      const result = await syncLibrary();
      toast(describeSync(result, libraryBackupLabel(account.session.provider)));
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

        {/* Three columns from tablet width up. A phone has no room for them side
            by side, so there they stack and the whole view scrolls: the
            pictures as a strip, the picture, then its settings. The picture
            stays at the top while the settings scroll under it, so a slider's
            change shows as it is dragged. A screen too short for both (a
            small phone on its side) would have the picture cover them all,
            so there it scrolls away with the rest. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-visible">
          <aside className="flex shrink-0 flex-col gap-3 border-b p-3 md:w-56 md:overflow-y-auto md:border-b-0 md:border-r" aria-label="Your pictures">
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
              <div className="flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible md:pb-0">
                {rows!.map((row) => (
                  <div key={row.id} className="w-20 shrink-0 md:w-auto">
                    <LibraryTile row={row} selected={row.id === selectedId} onSelect={() => choose(row.id)} />
                  </div>
                ))}
              </div>
            )}
          </aside>

          <main
            className="relative flex h-[45svh] shrink-0 flex-col bg-background max-md:[@media(min-height:32rem)]:sticky max-md:[@media(min-height:32rem)]:top-0 max-md:[@media(min-height:32rem)]:z-10 max-md:[@media(min-height:32rem)]:min-h-[14rem] md:h-auto md:min-h-0 md:min-w-0 md:flex-1 md:bg-muted/30"
            aria-label="The picture"
            data-testid="cutout-picture"
          >
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
                  fingerPaints={fingerPaints}
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

          <aside className="flex shrink-0 flex-col gap-4 border-t p-3 md:w-64 md:overflow-y-auto md:border-l md:border-t-0" aria-label="Edit the cut-out">
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
                      variant={fingerPaints && brushMode === 'erase' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      aria-pressed={fingerPaints && brushMode === 'erase'}
                      title="Paint over the parts you want gone, or press X to switch"
                      onClick={() => pickBrush('erase')}
                    >
                      <EraserIcon className="h-3.5 w-3.5" />
                      Erase
                    </Button>
                    <Button
                      type="button"
                      variant={fingerPaints && brushMode === 'keep' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      aria-pressed={fingerPaints && brushMode === 'keep'}
                      title="Paint over the parts you want back, or press X to switch"
                      onClick={() => pickBrush('keep')}
                    >
                      <PaintbrushIcon className="h-3.5 w-3.5" />
                      Bring back
                    </Button>
                  </div>
                  {touchFirst && (
                    <p className="text-[11px] leading-snug text-muted-foreground" data-testid="cutout-finger-hint">
                      {fingerBrush
                        ? `Tap ${brushMode === 'erase' ? 'Erase' : 'Bring back'} again to stop painting`
                        : 'Tap Erase or Bring back, then paint with your finger'}
                    </p>
                  )}
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
                  letChangesGo(row.id);
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
