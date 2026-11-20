"use client";

// Limelight: the activity bar's view for filming the user's app on a 3D
// stage with a real camera (src/lib/limelight). The scenes list on the left,
// the stage in the middle with the timeline under it, and the panel for what
// is picked on the right.
//
// The open scene lives here as React state; every change goes through
// `commit`, which records an undo step and saves the scene a moment later,
// so there is no Save button to forget. The playhead's time is kept outside
// React (TimeStore) so playback redraws the stage and the clock only.

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  BookmarkPlusIcon,
  ChevronDownIcon,
  ClapperboardIcon,
  FilmIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
  SparklesIcon,
  CopyIcon,
  ImageDownIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  Redo2Icon,
  SmartphoneIcon,
  Trash2Icon,
  TypeIcon,
  Undo2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
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
import { ToastAction } from '@/components/ui/toast';
import { saveBlobToDisk } from '@/lib/desktop';
import type { ArtboardState } from '@/types/artboard';
import { actorAt } from '@/lib/limelight/animate';
import {
  addActor,
  cameraToFitAll,
  cannotAdd,
  freeName,
  removeActor,
  removePose,
  removeShot,
  rename,
  setScreenAt,
  setScreens,
  setShotAt,
} from '@/lib/limelight/edit';
import { SceneHistory } from '@/lib/limelight/history';
import { setLimelightHost } from '@/lib/limelight/mcp';
import { ExportStopped, canExportVideo, exportSceneVideo, frameCount } from '@/lib/limelight/exportVideo';
import { storeRuleProblem } from '@/lib/limelight/presets';
import { Progress } from '@/components/ui/progress';
import { DriveNotGoogle, DriveSignInNeeded, listDriveScenes, openSceneFromDrive, saveSceneToDrive, type LimelightRemoteScene } from '@/lib/limelight/drive';
import { AccountAuthError } from '@/lib/account/types';
import { useAccount } from '@/lib/account/store';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { originOf, projectShots, shotBlob, type ProjectShot } from '@/lib/limelight/projectShots';
import { DEFAULT_LIFT, defaultFormat, deviceHeight, deviceWidth, newDeviceActor, newScene, newTextActor, sceneMediaIds } from '@/lib/limelight/scene';
import { buildTemplate, fromMyTemplate, templateById } from '@/lib/limelight/templates';
import {
  addPicture,
  saveMyTemplate,
  deleteScene,
  duplicateScene,
  getMeta,
  getScene,
  holdPictures,
  listScenes,
  putScene,
  setMeta,
  setSceneThumb,
  type SceneSummary,
} from '@/lib/limelight/store';
import type { LimelightStage } from '@/lib/limelight/stage/stage';
import type { DeviceActor, LimelightScene, ScreenOrigin } from '@/lib/limelight/types';
import { cn } from '@/lib/utils';
import { LimelightGallery, type GalleryChoice } from './LimelightGallery';
import { LimelightInspector } from './LimelightInspector';
import { LimelightTimeline, type LimelightSelection } from './LimelightTimeline';
import { LimelightViewport } from './LimelightViewport';
import { formatSeconds } from './controls';
import { TimeStore } from './time';

export interface LimelightProject {
  id: string | null;
  name: string;
  artboards: ArtboardState[];
}

export interface LimelightWorkspaceProps {
  active: boolean;
  /** The project open in the editor, read when its screenshots are needed. */
  readProject: () => LimelightProject;
  /** Set to a function that writes the open scene now, false when the write failed; the window's close hook calls it (rule 39a). */
  flushRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  /** Hands a request about the open scene to the agent. Unset when no agent can take it. */
  onAskAgent?: (request: string, scene: { id: string; name: string }) => void;
  /** Why Ask AI is off, when onAskAgent is unset. */
  agentUnavailable?: string;
  /** The agent is answering, maybe changing this scene. */
  agentWorking?: boolean;
  /** Shows the agent's chat in the editor. */
  onShowAgent?: () => void;
  /** Opens the account dialog to sign in with Google Drive. */
  onOpenAccount?: () => void;
}

const ASK_EXAMPLES = [
  'Make the camera go all the way round the phone',
  'Add my app name as a title over the phone',
  'Make it 20 seconds long for the App Store',
  'Use the Night look and slow the camera down',
];

function AskAi({ disabled, reason, onSend }: { disabled: boolean; reason?: string; onSend: (request: string) => void }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const send = () => {
    const words = request.trim();
    if (!words) return;
    onSend(words);
    setRequest('');
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" disabled={disabled} title={disabled ? reason : 'Tell the AI what the video should do'}>
          <SparklesIcon className="h-3.5 w-3.5" /> Ask AI
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 p-3">
        <p className="text-xs font-medium">What should the video do?</p>
        <Textarea
          value={request}
          autoFocus
          aria-label="What should the video do?"
          placeholder="Swing the camera round the phone, then move in on the screen"
          className="min-h-20 font-sans text-sm"
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
          }}
        />
        <div className="flex flex-wrap gap-1">
          {ASK_EXAMPLES.map((example) => (
            <button key={example} type="button" className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setRequest(example)}>
              {example}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground">You can undo what it changes here</p>
          <Button type="button" size="sm" className="ml-auto h-8" onClick={send} disabled={!request.trim()}>
            Send
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const SAVE_DELAY_MS = 400;
const THUMB_DELAY_MS = 2500;
const LAST_SCENE_KEY = 'last-scene';

function sceneThumbUrl(summary: SceneSummary): string | null {
  if (!summary.thumb) return null;
  return URL.createObjectURL(new Blob([summary.thumb], { type: summary.thumbType ?? 'image/jpeg' }));
}

function SceneRow({
  summary,
  open,
  onOpen,
  onDuplicate,
  onSaveTemplate,
  onDelete,
}: {
  summary: SceneSummary;
  open: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onSaveTemplate: () => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = sceneThumbUrl(summary);
    setUrl(next);
    return () => {
      if (next) URL.revokeObjectURL(next);
    };
  }, [summary]);
  const aspect = summary.width > 0 && summary.height > 0 ? summary.width / summary.height : 9 / 16;
  return (
    <div className={cn('group flex items-center gap-2 rounded-lg p-1.5 transition-colors', open ? 'bg-primary/10' : 'hover:bg-muted')}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={onOpen} aria-current={open ? 'true' : undefined}>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {url ? (
            <img src={url} alt="" className="max-h-full max-w-full object-contain" style={{ aspectRatio: aspect }} />
          ) : (
            <ClapperboardIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{summary.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatSeconds(summary.duration)}, {summary.devices === 1 ? '1 device' : `${summary.devices} devices`}
          </div>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 opacity-60 group-hover:opacity-100" aria-label={`More for ${summary.name}`} data-touch-reveal>
            <MoreHorizontalIcon className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onDuplicate}>
            <CopyIcon className="mr-2 h-3.5 w-3.5" /> Make a copy
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSaveTemplate}>
            <BookmarkPlusIcon className="mr-2 h-3.5 w-3.5" /> Save as my template
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
            <Trash2Icon className="mr-2 h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** A menu, list, popover or dialog open over the view: keys belong to it. A tooltip doesn't count. */
function overlayOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper] [role="dialog"], [data-radix-popper-content-wrapper] [role="listbox"], [data-radix-popper-content-wrapper] [role="menu"]'
  );
}

export function LimelightWorkspace({ active, readProject, flushRef, onAskAgent, agentUnavailable, agentWorking, onShowAgent, onOpenAccount }: LimelightWorkspaceProps) {
  const { toast } = useToast();
  const [summaries, setSummaries] = useState<SceneSummary[] | null>(null);
  const [scene, setScene] = useState<LimelightScene | null>(null);
  const [selection, setSelection] = useState<LimelightSelection>({ kind: 'scene' });
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [historyTick, setHistoryTick] = useState(0);
  const [deleting, setDeleting] = useState<SceneSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shots, setShots] = useState<ProjectShot[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const account = useAccount();
  const [driveProgress, setDriveProgress] = useState<string | null>(null);
  const [driveList, setDriveList] = useState<LimelightRemoteScene[] | null>(null);
  const [driveOpen, setDriveOpen] = useState(false);
  // While a video is made: how far it got. The stage draws the video's frames, so the view waits.
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  /** True while a video is made: the stage holds the scene it films, so no list picture is drawn meanwhile. */
  const exportingRef = useRef(false);
  const timeRef = useRef(new TimeStore());
  const fitAllRef = useRef<() => void>(() => {});
  const time = timeRef.current;
  const stageRef = useRef<LimelightStage | null>(null);
  const historyRef = useRef(new SceneHistory());
  const sceneRef = useRef<LimelightScene | null>(null);
  sceneRef.current = scene;
  const saveTimer = useRef(0);
  const thumbTimer = useRef(0);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const unsaved = useRef<LimelightScene | null>(null);

  // ---- saving ---------------------------------------------------------------

  const refreshList = useCallback(async () => {
    try {
      setSummaries(await listScenes());
    } catch (error) {
      console.error('Limelight could not list scenes', error);
      setSummaries([]);
    }
  }, []);

  const writeNow = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(saveTimer.current);
    const next = unsaved.current;
    if (!next) return pendingSave.current ? pendingSave.current : true;
    unsaved.current = null;
    // The pictures only its undo steps show, so a delete elsewhere keeps them.
    const own = sceneMediaIds(next);
    const held = [...historyRef.current.pictures()].filter((id) => !own.has(id));
    const write = putScene(next, held).then(
      () => true,
      (error) => {
        console.error('Limelight could not save the scene', error);
        toast({ title: "Your scene couldn't be saved", description: 'The browser may be out of space. Free some up and make a change to try again.' });
        return false;
      }
    );
    pendingSave.current = write;
    const saved = await write;
    if (pendingSave.current === write) pendingSave.current = null;
    return saved;
  }, [toast]);

  useImperativeHandle(flushRef, () => writeNow, [writeNow]);

  // What a delete must not take, right now: the open scene's pictures and
  // its undo steps', newer than the last save.
  useEffect(
    () =>
      holdPictures(() => {
        const ids = historyRef.current.pictures();
        if (sceneRef.current) for (const id of sceneMediaIds(sceneRef.current)) ids.add(id);
        return ids;
      }),
    []
  );

  const makeThumb = useCallback(async () => {
    const stage = stageRef.current;
    const current = sceneRef.current;
    if (!stage || !current || exportingRef.current) return;
    try {
      const aspect = current.format.width / current.format.height;
      const height = 160;
      const blob = await stage.renderStill({ width: Math.round(height * aspect), height, time: Math.min(1, current.format.duration / 3), type: 'image/jpeg' });
      await setSceneThumb(current.id, blob);
      void refreshList();
    } catch (error) {
      console.warn('Limelight could not draw the list picture', error);
    }
  }, [refreshList]);

  const scheduleSave = useCallback(
    (next: LimelightScene) => {
      unsaved.current = next;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void writeNow().then((saved) => {
          if (!saved) return;
          window.clearTimeout(thumbTimer.current);
          thumbTimer.current = window.setTimeout(() => void makeThumb(), THUMB_DELAY_MS);
        });
      }, SAVE_DELAY_MS);
    },
    [makeThumb, writeNow]
  );

  /** Every change to the open scene: an undo step, then a save a moment later. */
  const commit = useCallback(
    (next: LimelightScene, merge?: string) => {
      const before = sceneRef.current;
      if (!before || next === before) return;
      historyRef.current.record(before, merge);
      sceneRef.current = next;
      setScene(next);
      setHistoryTick((n) => n + 1);
      scheduleSave(next);
    },
    [scheduleSave]
  );
  const seal = useCallback(() => historyRef.current.seal(), []);

  const undo = useCallback(() => {
    const current = sceneRef.current;
    if (!current) return;
    const previous = historyRef.current.undo(current);
    if (!previous) return;
    sceneRef.current = previous;
    setScene(previous);
    setHistoryTick((n) => n + 1);
    scheduleSave(previous);
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const current = sceneRef.current;
    if (!current) return;
    const next = historyRef.current.redo(current);
    if (!next) return;
    sceneRef.current = next;
    setScene(next);
    setHistoryTick((n) => n + 1);
    scheduleSave(next);
  }, [scheduleSave]);

  // ---- opening scenes -------------------------------------------------------

  const openScene = useCallback(
    async (id: string) => {
      await writeNow();
      const next = await getScene(id);
      if (!next) {
        toast({ title: 'That scene is no longer on this device' });
        void refreshList();
        return;
      }
      historyRef.current.clear();
      setPlaying(false);
      time.set(0);
      setSelection({ kind: 'scene' });
      sceneRef.current = next;
      setScene(next);
      setHistoryTick((n) => n + 1);
      void setMeta(LAST_SCENE_KEY, id);
    },
    [refreshList, time, toast, writeNow]
  );

  // The list, and the scene open last time, on the first visit.
  const started = useRef(false);
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void (async () => {
      const list = await listScenes().catch(() => [] as SceneSummary[]);
      setSummaries(list);
      const last = await getMeta<string>(LAST_SCENE_KEY).catch(() => undefined);
      const pick = list.find((summary) => summary.id === last) ?? list[0];
      if (pick) await openScene(pick.id);
    })();
  }, [active, openScene]);

  // The project's screenshots, read again each time the view comes forward.
  useEffect(() => {
    if (!active) return;
    try {
      setShots(projectShots(readProject().artboards));
    } catch {
      setShots([]);
    }
  }, [active, readProject]);

  useEffect(() => setName(scene?.name ?? ''), [scene?.name]);

  // The agents' Limelight tools read and change the open scene through the view,
  // so the view never saves its older copy over theirs (src/lib/limelight/mcp.ts).
  useEffect(() => {
    setLimelightHost({
      openScene: () => sceneRef.current,
      apply: (next) => {
        if (sceneRef.current?.id !== next.id) return;
        commit(next);
        seal();
      },
      flush: writeNow,
      refresh: () => void refreshList(),
    });
    return () => setLimelightHost(null);
  }, [commit, refreshList, seal, writeNow]);

  // Saves on the way out, and on a reload.
  useEffect(() => {
    const onHide = () => void writeNow();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      void writeNow();
    };
  }, [writeNow]);

  /** Copies pictures in and gives back their ids, with where each came from. */
  const importPictures = useCallback(
    async (source: { files: File[] } | { shots: ProjectShot[] }): Promise<Array<{ id: string }>> => {
      const project = readProject();
      const items: Array<{ blob: Blob; name: string; from?: ScreenOrigin }> = [];
      if ('files' in source) {
        for (const file of source.files) items.push({ blob: file, name: file.name });
      } else {
        for (const shot of source.shots) {
          const blob = await shotBlob(shot.src);
          if (blob) items.push({ blob, name: shot.artboardName, from: originOf(project.id, shot) });
        }
      }
      const added: Array<{ id: string }> = [];
      const failed: string[] = [];
      for (const item of items) {
        try {
          added.push(await addPicture(item.blob, item.name, item.from));
        } catch (error) {
          failed.push(error instanceof Error ? error.message : item.name);
        }
      }
      if (failed.length > 0) toast({ title: failed.length === 1 ? "One picture couldn't be added" : `${failed.length} pictures couldn't be added`, description: failed[0] });
      return added;
    },
    [readProject, toast]
  );

  /** A new scene from the gallery's choice, with the open project's own screenshots on its screens. */
  const createFrom = useCallback(
    async (choice: GalleryChoice) => {
      setBusy('new');
      try {
        await writeNow();
        const project = readProject();
        const name = project.name ? `${project.name} promo` : undefined;
        // The pictures the gallery's previews showed: the user's own screenshots,
        // or the project's sample ones when it has none of its own yet.
        const all = projectShots(project.artboards);
        const own = all.filter((shot) => !shot.sample).slice(0, 6);
        const source = own.length > 0 ? own : all.slice(0, 3);
        const pictures = (source.length > 0 ? await importPictures({ shots: source }) : []).map((picture) => picture.id);
        // The size the gallery's previews were drawn at: the open scene's, or the default.
        const format = sceneRef.current?.format ?? defaultFormat();
        let next: LimelightScene | null;
        if (choice.kind === 'builtin') {
          const template = templateById(choice.id);
          next = buildTemplate(choice.id, { format, pictures, title: project.name, name: name ?? template?.name });
        } else if (choice.kind === 'mine') {
          next = fromMyTemplate(choice.template.scene, pictures, name ?? choice.template.name);
        } else {
          next = newScene({ name: name ?? 'Untitled scene', media: pictures[0] ?? null, format });
          // More screenshots take turns on the phone over the length of the video.
          const phone = next.actors[0];
          if (phone && pictures.length > 1) {
            const gap = next.format.duration / pictures.length;
            for (const [i, picture] of pictures.slice(1).entries()) next = setScreenAt(next, phone.id, gap * (i + 1), picture, { transition: 'slide' });
          }
        }
        if (!next) return;
        await putScene(next);
        await refreshList();
        await openScene(next.id);
        window.setTimeout(() => void makeThumb(), 900);
      } catch (error) {
        console.error('Limelight could not make a scene', error);
        toast({ title: "The scene couldn't be made", description: 'Try again in a moment.' });
      } finally {
        setBusy(null);
      }
    },
    [importPictures, makeThumb, openScene, readProject, refreshList, toast, writeNow]
  );

  const saveAsTemplate = useCallback(
    async (summary: SceneSummary) => {
      await writeNow();
      const scene = await getScene(summary.id);
      if (!scene) return;
      try {
        // The list's own picture of the scene, when there is one.
        const thumb = summary.thumb ? new Blob([summary.thumb], { type: summary.thumbType ?? 'image/jpeg' }) : undefined;
        await saveMyTemplate(scene, scene.name, thumb);
        toast({ title: 'Saved as your template', description: `${scene.name} is in Start a scene now, under Your templates.` });
      } catch (error) {
        console.error('Limelight could not save a template', error);
        toast({ title: "The template couldn't be saved", description: 'The browser may be out of space.' });
      }
    },
    [toast, writeNow]
  );

  const addPicturesTo = useCallback(
    async (actorId: string, source: { files: File[] } | { shots: ProjectShot[] }) => {
      const pictures = await importPictures(source);
      const current = sceneRef.current;
      if (!current || pictures.length === 0) return;
      const device = current.actors.find((actor): actor is DeviceActor => actor.id === actorId && actor.kind === 'device');
      if (!device) return;
      const start = device.screens.length === 0 ? 0 : time.get();
      const gap = pictures.length > 1 ? Math.max(1.5, (current.format.duration - start) / pictures.length) : 0;
      let next = current;
      pictures.forEach((picture, i) => {
        next = setScreenAt(next, actorId, Math.min(current.format.duration, start + gap * i), picture.id);
      });
      commit(next);
      seal();
    },
    [commit, importPictures, seal, time]
  );

  // ---- adding things ---------------------------------------------------------

  const addDevice = useCallback(() => {
    const current = sceneRef.current;
    if (!current) return;
    const blocked = cannotAdd(current, 'device');
    if (blocked) {
      toast({ title: blocked });
      return;
    }
    // Beside the devices already there, on the right.
    const devices = current.actors.filter((actor): actor is DeviceActor => actor.kind === 'device');
    const at = time.get();
    const right = devices.reduce((edge, device) => {
      const frame = actorAt(device, at);
      return Math.max(edge, frame.position.x + (deviceWidth(device.device) * frame.scale) / 2);
    }, -Infinity);
    const template = devices[0];
    const kind = template?.device ?? undefined;
    const actor = newDeviceActor(kind, {});
    actor.name = freeName(current, actor.name);
    const width = deviceWidth(actor.device);
    const x = Number.isFinite(right) ? right + 3 + width / 2 : 0;
    actor.poses = [{ ...actor.poses[0], position: { x, y: deviceHeight(actor.device) / 2 + DEFAULT_LIFT, z: 0 } }];
    const next = addActor(current, actor);
    commit(next);
    seal();
    setSelection({ kind: 'actor', id: actor.id });
    if (devices.length > 0) {
      toast({
        title: `${actor.name} added on the right`,
        description: 'It may be outside the shot. Fit moves the camera back to see every device.',
        action: (
          <ToastAction altText="Fit every device in the shot" onClick={() => fitAllRef.current()}>
            Fit
          </ToastAction>
        ),
      });
    }
  }, [commit, seal, time, toast]);

  const addTitle = useCallback(() => {
    const current = sceneRef.current;
    if (!current) return;
    const blocked = cannotAdd(current, 'text');
    if (blocked) {
      toast({ title: blocked });
      return;
    }
    const devices = current.actors.filter((actor): actor is DeviceActor => actor.kind === 'device');
    const top = devices.reduce((edge, device) => Math.max(edge, actorAt(device, time.get()).position.y + deviceHeight(device.device) / 2), 10);
    const first = devices[0] ? actorAt(devices[0], time.get()).position : { x: 0, y: 0, z: 0 };
    // The app's name, over the first device and level with it, so it is in focus with it.
    const actor = newTextActor(readProject().name.trim().slice(0, 60) || 'Your app', { x: first.x, y: top + 2.5, z: first.z });
    actor.name = freeName(current, actor.name);
    // Dark words on a light backdrop, light ones on a dark one.
    const dark = ['night', 'noir'].includes(current.look.environment);
    actor.color = dark ? '#ffffff' : '#111111';
    commit(addActor(current, actor));
    seal();
    setSelection({ kind: 'actor', id: actor.id });
  }, [commit, readProject, seal, time, toast]);

  /** Frames every device and title at the playhead, as the shot there. */
  const fitAll = useCallback(() => {
    const latest = sceneRef.current;
    const camera = stageRef.current?.viewCamera();
    if (!latest || !camera) return;
    commit(setShotAt(latest, time.get(), cameraToFitAll(latest, time.get(), camera)).scene);
    seal();
  }, [commit, seal, time]);
  fitAllRef.current = fitAll;

  const addShotHere = useCallback(() => {
    const current = sceneRef.current;
    const camera = stageRef.current?.viewCamera();
    if (!current || !camera) return;
    const result = setShotAt(current, time.get(), camera);
    commit(result.scene);
    seal();
    setSelection({ kind: 'shot', id: result.shotId });
  }, [commit, seal, time]);

  const deleteSelection = useCallback(() => {
    const current = sceneRef.current;
    if (!current) return;
    if (selection.kind === 'shot') {
      if (current.camera.shots.length > 1) commit(removeShot(current, selection.id));
      setSelection({ kind: 'scene' });
    } else if (selection.kind === 'pose') {
      commit(removePose(current, selection.actorId, selection.id));
      setSelection({ kind: 'actor', id: selection.actorId });
    } else if (selection.kind === 'screen') {
      const device = current.actors.find((actor): actor is DeviceActor => actor.id === selection.actorId && actor.kind === 'device');
      if (device) commit(setScreens(current, device.id, device.screens.filter((screen) => screen.id !== selection.id)));
      setSelection({ kind: 'actor', id: selection.actorId });
    } else if (selection.kind === 'actor') {
      commit(removeActor(current, selection.id));
      setSelection({ kind: 'scene' });
    }
    seal();
  }, [commit, seal, selection]);

  const savePicture = useCallback(async () => {
    const stage = stageRef.current;
    const current = sceneRef.current;
    if (!stage || !current) return;
    setBusy('picture');
    try {
      const blob = await stage.renderStill({ width: current.format.width, height: current.format.height, time: time.get() });
      const fileName = `${current.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Limelight'} ${time.get().toFixed(1)}s.png`;
      const saved = await saveBlobToDisk(blob, fileName);
      if (saved !== null) toast({ title: 'Picture saved', description: fileName });
    } catch (error) {
      console.error('Limelight could not save a picture', error);
      toast({ title: "The picture couldn't be made", description: error instanceof Error ? error.message : 'Try again in a moment.' });
    } finally {
      setBusy(null);
    }
  }, [time, toast]);

  // ---- the video ------------------------------------------------------------

  const exportVideo = useCallback(async () => {
    const stage = stageRef.current;
    const current = sceneRef.current;
    if (!stage || !current) return;
    if (!canExportVideo()) {
      toast({ title: "This browser can't make videos", description: 'Use the desktop app, Chrome or Edge.' });
      return;
    }
    setPlaying(false);
    const controller = new AbortController();
    exportAbort.current = controller;
    const total = frameCount(current.format.duration, current.format.fps);
    setExporting({ done: 0, total });
    exportingRef.current = true;
    try {
      await writeNow();
      let shown = -1;
      const blob = await exportSceneVideo(stage, current, {
        signal: controller.signal,
        // Once a percent, not once a frame: the view needn't draw again 900 times.
        onProgress: (done) => {
          const percent = Math.floor((done / total) * 100);
          if (percent === shown) return;
          shown = percent;
          setExporting({ done, total });
        },
      });
      const fileName = `${current.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Limelight'}.mp4`;
      const saved = await saveBlobToDisk(blob, fileName);
      if (saved !== null) {
        // An agent's change that came in while the video was made isn't in it.
        const notes = [
          storeRuleProblem(current.format),
          sceneRef.current !== current ? 'The scene changed while it was made, so the video shows it as it was when you pressed Export video' : null,
        ].filter((note): note is string => !!note);
        toast({ title: 'Video saved', description: notes.length > 0 ? `${fileName}. ${notes.join('. ')}.` : fileName });
      }
    } catch (error) {
      if (error instanceof ExportStopped) toast({ title: 'Export stopped' });
      else {
        console.error('Limelight could not make the video', error);
        toast({ title: "The video couldn't be made", description: error instanceof Error ? error.message : 'Try again in a moment.' });
      }
    } finally {
      exportAbort.current = null;
      exportingRef.current = false;
      setExporting(null);
      if (sceneRef.current !== current) window.setTimeout(() => void makeThumb(), THUMB_DELAY_MS);
    }
  }, [makeThumb, toast, writeNow]);

  // ---- Google Drive ---------------------------------------------------------

  /** What a Drive error asks of the user: sign in, switch to Drive, or just what went wrong. */
  const driveTrouble = useCallback(
    (error: unknown, what: string) => {
      if (error instanceof DriveSignInNeeded || error instanceof AccountAuthError) {
        if (error instanceof AccountAuthError) toast({ title: 'Your Google sign-in expired', description: 'Sign in again to use Google Drive.' });
        onOpenAccount?.();
        return;
      }
      if (error instanceof DriveNotGoogle) {
        toast({ title: 'Scenes save to Google Drive', description: 'Videos are too big for GitHub. Sign out in Account, then sign in with Google Drive.' });
        return;
      }
      console.error(`Limelight could not ${what}`, error);
      toast({ title: what === 'save' ? "The scene couldn't be saved to Google Drive" : "Google Drive couldn't be read", description: error instanceof Error ? error.message : 'Try again in a moment.' });
    },
    [onOpenAccount, toast]
  );

  const saveToDrive = useCallback(async () => {
    const current = sceneRef.current;
    if (!current) return;
    if (!account.session) {
      onOpenAccount?.();
      return;
    }
    setDriveProgress('Saving');
    try {
      if (!(await writeNow())) return;
      const result = await saveSceneToDrive(current.id, (done, total) => setDriveProgress(total > 1 ? `Saving ${Math.min(done + 1, total)} of ${total}` : 'Saving'));
      toast({
        title: 'Saved to Google Drive',
        description: result.sent > 0 ? `${current.name} and ${result.sent === 1 ? 'its picture' : `${result.sent} pictures`} are in Open Screenshot Generator Limelight, in your Drive.` : `${current.name} is in Open Screenshot Generator Limelight, in your Drive.`,
      });
    } catch (error) {
      driveTrouble(error, 'save');
    } finally {
      setDriveProgress(null);
    }
  }, [account.session, driveTrouble, onOpenAccount, toast, writeNow]);

  const openDriveList = useCallback(async () => {
    if (!account.session) {
      onOpenAccount?.();
      return;
    }
    setDriveOpen(true);
    setDriveList(null);
    try {
      setDriveList(await listDriveScenes());
    } catch (error) {
      setDriveOpen(false);
      driveTrouble(error, 'read');
    }
  }, [account.session, driveTrouble, onOpenAccount]);

  const openFromDrive = useCallback(
    async (remote: LimelightRemoteScene) => {
      setBusy(`drive:${remote.folderId}`);
      try {
        await writeNow();
        const { scene: opened, copy } = await openSceneFromDrive(remote);
        await refreshList();
        await openScene(opened.id);
        setDriveOpen(false);
        if (copy) toast({ title: 'Opened as a copy', description: "The scene here has changes the one in Google Drive doesn't have, so both are kept." });
      } catch (error) {
        driveTrouble(error, 'read');
      } finally {
        setBusy(null);
      }
    },
    [driveTrouble, openScene, refreshList, toast, writeNow]
  );

  // ---- playback -------------------------------------------------------------

  const duration = scene?.format.duration ?? 0;
  const togglePlay = useCallback(() => {
    setPlaying((now) => {
      if (!now && time.get() >= duration - 1e-3) time.set(0);
      return !now;
    });
  }, [duration, time]);

  useEffect(() => {
    if (!playing || duration <= 0) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let t = time.get() + dt;
      if (t >= duration) {
        if (loop) t %= duration;
        else {
          time.set(duration);
          setPlaying(false);
          return;
        }
      }
      time.set(t);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, loop, playing, time]);

  // A view in the back stops playing.
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);

  const seek = useCallback(
    (t: number) => {
      setPlaying(false);
      time.set(Math.min(duration, Math.max(0, t)));
    },
    [duration, time]
  );

  // ---- keys -----------------------------------------------------------------

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!sceneRef.current || isTyping(event.target) || overlayOpen()) return;
      const mod = event.metaKey || event.ctrlKey;
      const frame = 1 / (sceneRef.current.format.fps || 30);
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (mod) {
        return;
      } else if (event.key === ' ') {
        event.preventDefault();
        togglePlay();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = (event.shiftKey ? 1 : frame) * (event.key === 'ArrowLeft' ? -1 : 1);
        seek(time.get() + step);
      } else if (event.key === 'Home') {
        seek(0);
      } else if (event.key === 'End') {
        seek(duration);
      } else if (event.key.toLowerCase() === 'k') {
        addShotHere();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, addShotHere, deleteSelection, duration, redo, seek, time, togglePlay, undo]);

  // Read on every render; historyTick is what makes one happen after a change.
  void historyTick;
  const canUndo = historyRef.current.canUndo;
  const canRedo = historyRef.current.canRedo;

  // ---- drawing --------------------------------------------------------------

  const viewCamera = useCallback(() => stageRef.current?.viewCamera() ?? null, []);

  return (
    <TooltipProvider delayDuration={300}>
      <section className="flex h-full min-h-0 flex-col bg-background" data-testid="limelight-view" aria-labelledby="limelight-view-title">
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClapperboardIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 id="limelight-view-title" className="text-sm font-semibold">
              Limelight
            </h1>
            <p className="truncate text-xs text-muted-foreground">Film your app in 3D with a real camera</p>
          </div>
          {scene && (
            <Input
              value={name}
              aria-label="Scene name"
              className="ml-2 h-8 w-56 text-sm font-medium"
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                if (name.trim() && name !== scene.name) {
                  commit(rename(scene, name));
                  seal();
                  void writeNow().then(() => refreshList());
                } else setName(scene.name);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              }}
            />
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {scene && agentWorking && (
              <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary" role="status">
                <Loader2Icon className="h-3 w-3 animate-spin" /> The AI is working
                {onShowAgent && (
                  <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={onShowAgent}>
                    See the chat
                  </button>
                )}
              </span>
            )}
            {scene && (
              <>
                <AskAi
                  disabled={!onAskAgent || !!agentWorking}
                  reason={agentWorking ? 'The AI is still working on your last request' : agentUnavailable}
                  onSend={(request) => {
                    const current = sceneRef.current;
                    if (!current || !onAskAgent) return;
                    // The agent reads the scene from the database: write what is on screen first.
                    void writeNow().then(() => onAskAgent(request, { id: current.id, name: current.name }));
                  }}
                />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo">
                  <Undo2Icon className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo">
                  <Redo2Icon className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5">
                      <PlusIcon className="h-3.5 w-3.5" /> Add <ChevronDownIcon className="h-3 w-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={addDevice}>
                      <SmartphoneIcon className="mr-2 h-3.5 w-3.5" /> Device
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={addTitle}>
                      <TypeIcon className="mr-2 h-3.5 w-3.5" /> Title
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={addShotHere}>
                      <PlusIcon className="mr-2 h-3.5 w-3.5" /> Camera shot at the playhead (K)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => void saveToDrive()}
                  disabled={driveProgress !== null}
                  title={account.session ? 'Saves this scene and its pictures in your Google Drive' : 'Sign in with Google Drive to save your scenes there'}
                >
                  {driveProgress ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <CloudUploadIcon className="h-3.5 w-3.5" />}
                  {driveProgress ?? 'Save to Drive'}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void savePicture()} disabled={busy === 'picture'}>
                  {busy === 'picture' ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <ImageDownIcon className="h-3.5 w-3.5" />}
                  Save picture
                </Button>
                <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => void exportVideo()} disabled={exporting !== null}>
                  <FilmIcon className="h-3.5 w-3.5" /> Export video
                </Button>
              </>
            )}
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-56 shrink-0 flex-col border-r" aria-label="Your scenes">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="text-xs font-semibold text-muted-foreground">Your scenes</span>
              <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={() => setGalleryOpen(true)} disabled={busy === 'new'}>
                {busy === 'new' ? <Loader2Icon className="h-3 w-3 animate-spin" /> : <PlusIcon className="h-3 w-3" />}
                New scene
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
              {summaries === null && <p className="px-2 py-4 text-xs text-muted-foreground">Loading your scenes</p>}
              {summaries?.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">No scenes yet</p>}
              {summaries?.map((summary) => (
                <SceneRow
                  key={summary.id}
                  summary={summary}
                  open={scene?.id === summary.id}
                  onOpen={() => void openScene(summary.id)}
                  onDuplicate={() =>
                    void (async () => {
                      await writeNow();
                      const copy = await duplicateScene(summary.id);
                      await refreshList();
                      if (copy) await openScene(copy.id);
                    })()
                  }
                  onSaveTemplate={() => void saveAsTemplate(summary)}
                  onDelete={() => setDeleting(summary)}
                />
              ))}
            </div>
            <div className="border-t p-2">
              <Button type="button" size="sm" variant="ghost" className="h-8 w-full justify-start gap-1.5 text-xs" onClick={() => void openDriveList()}>
                <CloudDownloadIcon className="h-3.5 w-3.5" /> Open from Google Drive
              </Button>
            </div>
          </nav>
          {scene ? (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <LimelightViewport
                  scene={scene}
                  time={time}
                  playing={playing}
                  active={active}
                  selectedActorId={selection.kind === 'actor' ? selection.id : selection.kind === 'pose' || selection.kind === 'screen' ? selection.actorId : null}
                  onSelectActor={(actorId) => setSelection(actorId ? { kind: 'actor', id: actorId } : { kind: 'scene' })}
                  onCommit={(next) => {
                    commit(next);
                    seal();
                  }}
                  onGestureStart={() => setPlaying(false)}
                  stageRef={stageRef}
                />
                <LimelightTimeline
                  scene={scene}
                  time={time}
                  playing={playing}
                  loop={loop}
                  selection={selection}
                  onPlay={togglePlay}
                  onLoop={() => setLoop((on) => !on)}
                  onSeek={seek}
                  onSelect={setSelection}
                  onCommit={commit}
                  onDragEnd={seal}
                />
              </div>
              <LimelightInspector
                scene={scene}
                selection={selection}
                time={time}
                hasPostEffects={stageRef.current?.hasPostEffects ?? true}
                projectShots={shots}
                onSelect={setSelection}
                onCommit={commit}
                onSeal={seal}
                onSeek={seek}
                viewCamera={viewCamera}
                onAddPictures={addPicturesTo}
                onFitAll={fitAll}
              />
            </>
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-center p-8">
              <div className="max-w-md text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ClapperboardIcon className="h-7 w-7" />
                </div>
                <h2 className="text-lg font-semibold">Film your app in 3D</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Put your screenshots on real phones and tablets, light them like a product shoot, and move the camera round them. Every scene is saved on this device as you go.
                </p>
                <Button type="button" className="mt-5 gap-1.5" onClick={() => setGalleryOpen(true)} disabled={busy === 'new' || summaries === null}>
                  {busy === 'new' ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <PlusIcon className="h-4 w-4" />}
                  Start a scene
                </Button>
                {!shots.some((shot) => !shot.sample) && (
                  <p className="mt-3 text-xs text-muted-foreground">Open a project with your screenshots in the editor, and they'll go on the phone for you.</p>
                )}
              </div>
            </div>
          )}
        </div>
        <Dialog open={exporting !== null}>
          <DialogContent className="max-w-sm [&>button]:hidden" data-testid="limelight-export" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Making your video</DialogTitle>
              <DialogDescription>
                {exporting ? `Frame ${exporting.done} of ${exporting.total}` : ''}. Each frame is drawn at full size, so this takes a little while.
              </DialogDescription>
            </DialogHeader>
            <Progress value={exporting ? (exporting.done / exporting.total) * 100 : 0} aria-label="How much of the video is made" />
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => exportAbort.current?.abort()}>
                Stop
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={driveOpen} onOpenChange={setDriveOpen}>
          <DialogContent className="max-w-md" data-testid="limelight-drive">
            <DialogHeader>
              <DialogTitle>Open from Google Drive</DialogTitle>
              <DialogDescription>Scenes you saved in Open Screenshot Generator Limelight, in your Drive.</DialogDescription>
            </DialogHeader>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {driveList === null && (
                <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" /> Looking in your Drive
                </p>
              )}
              {driveList?.length === 0 && <p className="py-6 text-sm text-muted-foreground">No scenes in your Drive yet. Save to Google Drive puts one there.</p>}
              {driveList?.map((remote) => (
                <button
                  key={remote.folderId}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void openFromDrive(remote)}
                  className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left hover:border-primary disabled:opacity-60"
                >
                  <ClapperboardIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{remote.name}</span>
                    {remote.modifiedTime && <span className="block text-[11px] text-muted-foreground">Saved {new Date(remote.modifiedTime).toLocaleString()}</span>}
                  </span>
                  {busy === `drive:${remote.folderId}` && <Loader2Icon className="h-4 w-4 animate-spin" />}
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
        <LimelightGallery
          open={galleryOpen}
          onOpenChange={setGalleryOpen}
          shots={shots}
          projectName={readProject().name}
          format={scene?.format ?? defaultFormat()}
          onPick={createFrom}
        />
        <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
              <AlertDialogDescription>The scene goes from this device. Pictures other scenes use stay.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const target = deleting;
                  setDeleting(null);
                  if (!target) return;
                  void (async () => {
                    if (sceneRef.current?.id === target.id) {
                      window.clearTimeout(saveTimer.current);
                      unsaved.current = null;
                      sceneRef.current = null;
                      setScene(null);
                      historyRef.current.clear();
                    }
                    await deleteScene(target.id);
                    const list = await listScenes();
                    setSummaries(list);
                    if (!sceneRef.current && list[0]) await openScene(list[0].id);
                  })();
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
