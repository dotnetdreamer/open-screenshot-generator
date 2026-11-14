"use client";

// Capture: screenshots of the user's app from the iOS Simulator or an Android
// emulator or phone, straight into the project's frames, in every language.
//
// The left column is the device: which one, its screen live, the button that
// takes the screenshot, the app and the switches. The right is the grid of
// frames by language (CaptureGrid). Two ways to fill it:
//
//   - By hand: choose a cell, go to the screen on the device, take it. With
//     "Next frame" on, the next cell in the row is chosen, so clicking through
//     the app and pressing Take fills a whole row.
//   - On its own: a frame that knows how to reach its screen (the app's first
//     screen, or a link) can be taken in every language. Each screenshot then
//     starts from a fresh launch in that language, waits until the screen
//     stops moving, and the lot goes into the project as one undo step.
//
// The editor stays the only writer of the project: everything that changes it
// goes out through the on* callbacks, which commit through the layout's
// handleArtboardsUpdate. The view is mounted on its first visit and kept, like
// Growth, so a run keeps going while the editor is in front.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CameraIcon,
  CircleIcon,
  DownloadIcon,
  LanguagesIcon,
  Loader2Icon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  SquareIcon,
  SunIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import * as device$ from '@/lib/capture/desktop';
import { captureCells, captureTargets, cellKey, type CaptureCell, type CaptureTarget } from '@/lib/capture/frames';
import { appLanguageFor } from '@/lib/capture/locales';
import { bestRunningDevice, deviceFit, modelForFrame, shapeDifference, SHAPE_WARNING } from '@/lib/capture/match';
import type { ClipPlacement, ShotPlacement } from '@/lib/capture/place';
import { pause, waitUntilStill } from '@/lib/capture/settle';
import { getCaptureSession, updateCaptureSession, useCaptureSession, type Appearance } from '@/lib/capture/session';
import { ensureTidy, forgetTidy, shootDevice, untidy } from '@/lib/capture/shoot';
import type { CaptureApp, CaptureDevice, CaptureDevices, CapturedShot } from '@/lib/capture/types';
import { isTauri, openExternal } from '@/lib/desktop';
import { getBaseLocale, getProjectLocales } from '@/lib/i18n/localization';
import { localeName } from '@/lib/i18n/locales';
import { saveMedia } from '@/lib/mediaStore';
import { useThumbnail } from '@/lib/capture/thumbnails';
import type { ArtboardState, CaptureScreen } from '@/types/artboard';
import { cn } from '@/lib/utils';
import { firstReason } from '../growth/GrowthShared';
import { CaptureGrid, frameTitle } from './CaptureGrid';
import { LiveView } from './LiveView';

const DESKTOP_URL = 'https://openscrgen.app';
const DESKTOP_ONLY = 'Needs the desktop app';

/** A frame to choose, from whoever switched to Capture. A new nonce chooses again. */
export interface CaptureRequest {
  boardId: string;
  elementId: string;
  /** A project language; null is the base language. */
  locale: string | null;
  nonce: number;
}

/**
 * Where a recording went. A recording goes into the project it was started
 * in: `projectName` names that project when it is not the one open now.
 */
export type ClipOutcome =
  | { placed: true; projectName: string | null }
  | { placed: false; reason: 'missed' | 'closed' | 'busy' };

export interface CaptureWorkspaceProps {
  /** True while Capture is the view on screen. */
  active: boolean;
  /** The base document of the project on the canvas. */
  artboards: ArtboardState[];
  /** The language the canvas shows; null is the base language. */
  canvasLocale: string | null;
  request: CaptureRequest | null;
  /** The project on the canvas now, read again when a run commits. */
  getProjectId: () => string | null;
  /** Puts screenshots into frames as one undo step. Null when the commit was turned down. */
  onPlaceShots: (placements: ShotPlacement[], detail: string) => { missed: number } | null;
  /** Puts a recording into its frame in `projectId`, the project it was started in. */
  onPlaceClip: (projectId: string | null, placement: ClipPlacement, detail: string) => Promise<ClipOutcome>;
  onSetScreen: (boardId: string, elementId: string, screen: CaptureScreen | undefined) => void;
  onOpenLanguages: () => void;
  onBackToEditor: () => void;
}

const STATE_TEXT: Record<CaptureDevice['state'], string> = {
  running: 'Running',
  starting: 'Starting',
  off: 'Off',
  unauthorized: 'Waiting for your OK on the phone',
  offline: 'Not answering',
};

function deviceValue(device: Pick<CaptureDevice, 'platform' | 'id'>): string {
  return `${device.platform}|${device.id}`;
}

function sameDevice(a: Pick<CaptureDevice, 'platform' | 'id'> | null | undefined, b: Pick<CaptureDevice, 'platform' | 'id'> | null | undefined): boolean {
  return !!a && !!b && a.platform === b.platform && a.id === b.id;
}

/**
 * A control that is turned off says why when pointed at, the way Growth's
 * Gated does. `block` keeps a full width control full width while it is off.
 */
function Gate({ reason, block, children }: { reason: string | null | undefined; block?: boolean; children: React.ReactElement<{ disabled?: boolean }> }) {
  if (!reason) return children;
  return (
    <span className={cn('cursor-not-allowed', block ? 'flex min-w-0 flex-1' : 'inline-flex')} title={reason} data-gated-reason={reason}>
      {React.cloneElement(children, { disabled: true })}
    </span>
  );
}

/** "an iPhone 17 Pro Max", "a Pixel 9". */
function withArticle(name: string): string {
  return /^(i[A-Z]|[AEIOUaeiou])/.test(name) ? `an ${name}` : `a ${name}`;
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Something went wrong on the device.';
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function ShotThumb({ shot, onClick, reason }: { shot: CapturedShot; onClick: () => void; reason: string | null }) {
  const src = useThumbnail(shot.ref, 112);
  const time = new Date(shot.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <Gate reason={reason}>
      <button
        type="button"
        onClick={onClick}
        title={`${shot.deviceName}${shot.language ? `, ${localeName(shot.language)}` : ''}, ${time}. Click to put it in the chosen frame`}
        className="w-14 shrink-0 overflow-hidden rounded-lg border bg-muted hover:ring-2 hover:ring-primary"
        style={{ aspectRatio: shot.width && shot.height ? shot.width / shot.height : 0.46 }}
      >
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
        )}
      </button>
    </Gate>
  );
}

function Section({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      {title && <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>}
      {children}
    </section>
  );
}

export function CaptureWorkspace({
  active,
  artboards,
  canvasLocale,
  request,
  getProjectId,
  onPlaceShots,
  onPlaceClip,
  onSetScreen,
  onOpenLanguages,
  onBackToEditor,
}: CaptureWorkspaceProps) {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const desktop = mounted && isTauri();
  const session = useCaptureSession();

  // ---- the project ---------------------------------------------------------
  const baseLocale = useMemo(() => getBaseLocale(artboards), [artboards]);
  const locales = useMemo(
    () => [baseLocale, ...getProjectLocales(artboards).map((entry) => entry.code).filter((code) => code !== baseLocale)],
    [artboards, baseLocale]
  );
  const targets = useMemo(() => captureTargets(artboards), [artboards]);
  const cells = useMemo(() => captureCells(artboards, targets, locales, baseLocale), [artboards, targets, locales, baseLocale]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected: CaptureCell | null = selectedKey ? cells.get(selectedKey) ?? null : null;
  const selectedTarget = selected?.target ?? null;
  const selectedTargetRef = useRef<CaptureTarget | null>(null);
  selectedTargetRef.current = selectedTarget;

  // The first frame, in the language on the canvas, until the user chooses.
  useEffect(() => {
    if (selected || targets.length === 0) return;
    const locale = canvasLocale && locales.includes(canvasLocale) ? canvasLocale : baseLocale;
    setSelectedKey(cellKey(targets[0].key, locale));
  }, [selected, targets, canvasLocale, locales, baseLocale]);

  useEffect(() => {
    if (!request) return;
    const target = targets.find((candidate) => candidate.boardId === request.boardId && candidate.elementId === request.elementId);
    if (!target) return;
    const locale = request.locale && locales.includes(request.locale) ? request.locale : baseLocale;
    setSelectedKey(cellKey(target.key, locale));
    // Only a new request chooses: the project changing under it must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  // ---- devices --------------------------------------------------------------
  const [devices, setDevices] = useState<CaptureDevices | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string[]>([]);
  const startingRef = useRef(starting);
  startingRef.current = starting;
  const all = useMemo(() => (devices ? [...devices.ios.devices, ...devices.android.devices] : []), [devices]);
  const device = useMemo(
    () => (session.device ? all.find((candidate) => sameDevice(candidate, session.device)) ?? null : null),
    [all, session.device]
  );
  const running = device?.state === 'running' ? device : null;
  const [apps, setApps] = useState<CaptureApp[] | null>(null);
  const appsRef = useRef(apps);
  appsRef.current = apps;
  const loadApps = useCallback(async (target: CaptureDevice) => {
    try {
      const list = await device$.listApps(target.platform, target.id);
      setApps(list);
      const current = getCaptureSession().appIds[target.platform];
      if (!current || !list.some((candidate) => candidate.id === current)) {
        const pick = list.find((candidate) => candidate.running) ?? (list.length === 1 ? list[0] : undefined);
        if (pick) updateCaptureSession({ appIds: { ...getCaptureSession().appIds, [target.platform]: pick.id } });
      }
    } catch {
      setApps([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const listed = await device$.listDevices();
      setDevices(listed);
      setListError(null);
      const everything = [...listed.ios.devices, ...listed.android.devices];
      const picked = getCaptureSession().device;
      // An emulator that was off is listed as `avd:<name>`; once it runs it
      // has an adb serial instead, under the same name.
      const fresh = picked
        ? everything.find((candidate) => sameDevice(candidate, picked)) ??
          (picked.id.startsWith('avd:')
            ? everything.find((candidate) => candidate.kind === 'emulator' && candidate.name === picked.name && !candidate.id.startsWith('avd:'))
            : undefined)
        : undefined;
      if (fresh) {
        // Restarted since: its status bar is the real one again.
        if (picked && picked.state !== 'running' && fresh.state === 'running') forgetTidy(fresh);
        if (!picked || !sameDevice(fresh, picked) || fresh.state !== picked.state || fresh.name !== picked.name || fresh.os !== picked.os) {
          updateCaptureSession({ device: fresh });
        }
      } else {
        const best = bestRunningDevice(selectedTargetRef.current, everything);
        if (!sameDevice(best, picked)) updateCaptureSession({ device: best });
      }
      // None of the user's apps was on the device last time: look again, so an
      // app installed from Xcode or Android Studio since then shows up.
      const now = getCaptureSession().device;
      if (now?.state === 'running' && appsRef.current?.length === 0) void loadApps(now);
      setStarting((ids) => ids.filter((id) => everything.some((candidate) => candidate.id === id && candidate.state !== 'running')));
    } catch (error) {
      setListError(message(error));
    }
  }, [loadApps]);

  useEffect(() => {
    if (!active || !desktop) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(tick, startingRef.current.length > 0 ? 2000 : 5000);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, desktop, refresh]);

  const pickDevice = (value: string) => {
    const next = all.find((candidate) => deviceValue(candidate) === value) ?? null;
    if (running && !sameDevice(running, next)) void untidy(running).catch(() => undefined);
    setApps(null);
    updateCaptureSession({ device: next });
  };

  const start = async (target: CaptureDevice) => {
    setStarting((ids) => [...ids, target.id]);
    try {
      await device$.startDevice(target.platform, target.id);
      // An emulator gets a new adb serial once it runs; the list finds it by name.
      updateCaptureSession({ device: target });
      void refresh();
    } catch (error) {
      setStarting((ids) => ids.filter((id) => id !== target.id));
      toast({ title: `${target.name} did not start`, description: message(error) });
    }
  };

  const [making, setMaking] = useState(false);
  const wantedModel = selectedTarget && devices ? modelForFrame(selectedTarget, devices.ios.models) : null;
  const hasWantedSimulator =
    !!wantedModel && all.some((candidate) => candidate.platform === 'ios' && candidate.model === wantedModel.id);
  const makeSimulator = async () => {
    if (!wantedModel) return;
    setMaking(true);
    try {
      const udid = await device$.createSimulator(wantedModel.id);
      await device$.startDevice('ios', udid);
      updateCaptureSession({
        device: { id: udid, platform: 'ios', kind: 'simulator', name: wantedModel.name, state: 'starting', os: '', model: wantedModel.id },
      });
      setStarting((ids) => [...ids, udid]);
      void refresh();
    } catch (error) {
      toast({ title: `The ${wantedModel.name} simulator was not made`, description: message(error) });
    } finally {
      setMaking(false);
    }
  };

  // ---- the app on the device -----------------------------------------------
  const appId = running ? session.appIds[running.platform] ?? null : null;
  const app = apps?.find((candidate) => candidate.id === appId) ?? null;
  const runningKey = running ? deviceValue(running) : null;
  useEffect(() => {
    setApps(null);
    if (running && active) void loadApps(running);
    // runningKey: a new object for the same device must not list the apps again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningKey, active, loadApps]);

  // The language Capture last opened the app in, per device.
  const [appLocale, setAppLocale] = useState<string | null>(null);
  useEffect(() => setAppLocale(null), [runningKey, appId]);

  // ---- switches -------------------------------------------------------------
  useEffect(() => {
    if (!running || !active) return;
    const work = session.tidy ? ensureTidy(running) : untidy(running);
    work.catch((error) => toast({ title: 'The status bar did not change', description: message(error) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningKey, session.tidy, active]);

  const setAppearance = async (appearance: Appearance) => {
    updateCaptureSession({ appearance });
    if (!running || appearance === 'as-set') return;
    try {
      await device$.setAppearance(running.platform, running.id, appearance === 'dark');
    } catch (error) {
      toast({ title: 'Light or dark did not change', description: message(error) });
    }
  };

  // ---- taking ---------------------------------------------------------------
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Map<string, string>>(() => new Map());
  const [runFrame, setRunFrame] = useState<Blob | null>(null);
  const [run, setRun] = useState<{ label: string; done: number; total: number; controller: AbortController } | null>(null);
  // Which project and frame it records for, kept from the start: the grid and
  // the open project can both change before Stop.
  const [recording, setRecording] = useState<{
    device: CaptureDevice;
    key: string;
    projectId: string | null;
    frame: { boardId: string; elementId: string; locale: string };
    title: string;
    startedAt: number;
  } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setTick((value) => value + 1), 500);
    return () => clearInterval(timer);
  }, [recording]);

  const flash = (key: string) => {
    setFlashKey(key);
    setTimeout(() => setFlashKey((current) => (current === key ? null : current)), 1200);
  };

  /** The next screenshot frame in the same row, or null at its end. */
  const nextInRow = (key: string): string | null => {
    const cell = cells.get(key);
    if (!cell) return null;
    const index = targets.findIndex((target) => target.key === cell.target.key);
    const next = targets.slice(index + 1).find((target) => target.kind === cell.target.kind);
    return next ? cellKey(next.key, cell.locale) : null;
  };

  const shapeNote = (target: CaptureTarget, width: number, height: number, from: string): string | null => {
    const difference = shapeDifference(target.screenAspect, width, height);
    if (difference === null || difference < SHAPE_WARNING) return null;
    return `The ${from} screen is a different shape from the ${target.deviceLabel} frame, so some of the screenshot is cut off. A simulator or emulator of the same model fits exactly.`;
  };

  const place = (placements: ShotPlacement[], detail: string): boolean => {
    const result = onPlaceShots(placements, detail);
    if (!result) {
      toast({ title: 'The screenshots did not go into the project', description: 'The editor was busy. They are under Taken this session.' });
      return false;
    }
    if (result.missed > 0) {
      toast({
        title: result.missed === 1 ? 'One screenshot found no frame' : `${result.missed} screenshots found no frame`,
        description: 'The frame was deleted or is hidden in that language. The screenshots are under Taken this session.',
      });
    }
    return result.missed < placements.length;
  };

  const takeOne = async () => {
    if (!running || !selected || !selectedKey) return;
    const key = selectedKey;
    const cell = selected;
    const projectId = getProjectId();
    setBusy('Taking the screenshot');
    setWorkingKey(key);
    setNote(null);
    try {
      const shot = await shootDevice(running, appLocale);
      if (getProjectId() !== projectId) {
        toast({
          title: 'The screenshot did not go into the project',
          description: 'Another project is open now. The screenshot is under Taken this session.',
        });
        return;
      }
      const ok = place(
        [{ boardId: cell.target.boardId, elementId: cell.target.elementId, locale: cell.locale, ref: shot.ref, width: shot.width, height: shot.height }],
        `${frameTitle(cell.target)}, ${localeName(cell.locale)}`
      );
      if (ok) {
        flash(key);
        setNote(shapeNote(cell.target, shot.width, shot.height, running.name));
        if (getCaptureSession().advance) {
          const next = nextInRow(key);
          if (next) setSelectedKey(next);
        }
      }
    } catch (error) {
      toast({ title: 'The screenshot was not taken', description: message(error) });
    } finally {
      setBusy(null);
      setWorkingKey(null);
    }
  };

  const putShot = (shot: CapturedShot) => {
    if (!selected || !selectedKey || selected.target.kind !== 'screenshot') return;
    if (place([{ boardId: selected.target.boardId, elementId: selected.target.elementId, locale: selected.locale, ref: shot.ref, width: shot.width, height: shot.height }], `${frameTitle(selected.target)}, ${localeName(selected.locale)}`)) {
      flash(selectedKey);
      setNote(shapeNote(selected.target, shot.width, shot.height, shot.deviceName));
    }
  };

  const startRecording = async () => {
    if (!running || !selected || !selectedKey || selected.target.kind !== 'recording') return;
    const from = running;
    const cell = selected;
    const key = selectedKey;
    const projectId = getProjectId();
    // Busy turns Record off, so a second click cannot start a second recorder.
    setBusy('Starting the recording');
    try {
      await ensureTidy(from);
      await device$.startRecording(from.platform, from.id);
      setRecording({
        device: from,
        key,
        projectId,
        frame: { boardId: cell.target.boardId, elementId: cell.target.elementId, locale: cell.locale },
        title: `${frameTitle(cell.target)}, ${localeName(cell.locale)}`,
        startedAt: Date.now(),
      });
    } catch (error) {
      toast({ title: 'The recording did not start', description: message(error) });
    } finally {
      setBusy(null);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    const { device: from, key, projectId, frame, title } = recording;
    setRecording(null);
    setBusy('Saving the recording');
    try {
      const blob = await device$.stopRecording(from.platform, from.id);
      const { id, probe } = await saveMedia(blob, `${from.name} recording.mp4`);
      const outcome = await onPlaceClip(
        projectId,
        { ...frame, mediaId: id, width: probe.width, height: probe.height, duration: probe.duration },
        title
      );
      if (outcome.placed && outcome.projectName === null) flash(key);
      else if (outcome.placed) {
        toast({ title: `The recording went into ${outcome.projectName}`, description: 'That project was open when you clicked Record.' });
      } else {
        toast({
          title: 'The recording did not go into the project',
          description:
            outcome.reason === 'missed'
              ? 'The frame was deleted or is hidden in that language.'
              : outcome.reason === 'closed'
                ? 'The project you clicked Record in is closed now.'
                : 'The editor was busy.',
        });
      }
    } catch (error) {
      toast({ title: 'The recording was not saved', description: message(error) });
    } finally {
      setBusy(null);
    }
  };

  const openInLanguage = async (locale: string) => {
    if (!running || !appId) return;
    const name = localeName(locale);
    setBusy(`Opening your app in ${name}`);
    try {
      await device$.launchApp(running.platform, running.id, appId, appLanguageFor(locale, running.platform));
      setAppLocale(locale);
      if (selected) setSelectedKey(cellKey(selected.target.key, locale));
    } catch (error) {
      toast({ title: `Your app did not open in ${name}`, description: message(error) });
    } finally {
      setBusy(null);
    }
  };

  /** Takes each job from a fresh launch in its language, then commits the lot as one step. */
  const runJobs = async (jobs: Array<{ target: CaptureTarget; locale: string }>, what: string) => {
    if (!running || !appId || jobs.length === 0) return;
    const from = running;
    const controller = new AbortController();
    const projectId = getProjectId();
    const placements: ShotPlacement[] = [];
    let moving = 0;
    setNote(null);
    setRun({ label: what, done: 0, total: jobs.length, controller });
    try {
      await ensureTidy(from);
      for (const job of jobs) {
        if (controller.signal.aborted) break;
        const key = cellKey(job.target.key, job.locale);
        setWorkingKey(key);
        setRun((current) => current && { ...current, label: `${localeName(job.locale)}: ${frameTitle(job.target)}` });
        await device$.launchApp(from.platform, from.id, appId, appLanguageFor(job.locale, from.platform), job.target.screen?.link);
        setAppLocale(job.locale);
        const still = await waitUntilStill(() => device$.takeScreenshot(from.platform, from.id, true), {
          signal: controller.signal,
          onFrame: setRunFrame,
          minMs: 1000,
          maxMs: 15_000,
        });
        if (!still) moving += 1;
        if (controller.signal.aborted) break;
        const shot = await shootDevice(from, job.locale);
        placements.push({ boardId: job.target.boardId, elementId: job.target.elementId, locale: job.locale, ref: shot.ref, width: shot.width, height: shot.height });
        setPending((current) => new Map(current).set(key, shot.ref));
        setRun((current) => current && { ...current, done: current.done + 1 });
        await pause(150, controller.signal).catch(() => undefined);
      }
    } catch (error) {
      if (!isAbort(error)) toast({ title: 'Capture stopped', description: message(error) });
    } finally {
      setRun(null);
      setWorkingKey(null);
      setRunFrame(null);
      if (placements.length > 0) {
        if (getProjectId() !== projectId) {
          toast({
            title: 'The screenshots did not go into the project',
            description: 'Another project is open now. The screenshots are under Taken this session.',
          });
        } else if (place(placements, placements.length === 1 ? '1 screen' : `${placements.length} screens`)) {
          toast({
            title: placements.length === 1 ? 'Took 1 screenshot' : `Took ${placements.length} screenshots`,
            description:
              moving > 0
                ? `${moving === 1 ? 'One screen' : `${moving} screens`} kept moving and ${moving === 1 ? 'was' : 'were'} taken anyway. Check the grid.`
                : undefined,
          });
        }
      }
      setPending(new Map());
    }
  };

  const everyLanguageJobs = (target: CaptureTarget) =>
    locales.filter((locale) => !cells.get(cellKey(target.key, locale))?.hidden).map((locale) => ({ target, locale }));

  const everythingJobs = () =>
    locales.flatMap((locale) =>
      targets
        .filter((target) => target.kind === 'screenshot' && target.screen && !cells.get(cellKey(target.key, locale))?.hidden)
        .map((target) => ({ target, locale }))
    );

  // ---- reasons a button is off ------------------------------------------------
  const noProject = artboards.length === 0;
  const working = !!busy || !!run || !!recording;
  const deviceReason = !desktop ? DESKTOP_ONLY : !running ? 'Start a device first' : null;
  const cellReason = !selected ? 'Choose a frame in the grid first' : selected.hidden ? `${frameTitle(selected.target)} is hidden in ${localeName(selected.locale)}` : null;
  const busyReason = run ? 'Wait for Capture to finish, or stop it' : busy ? 'Wait for the last step to finish' : null;
  const takeReason = firstReason(deviceReason, cellReason, selected?.target.kind === 'recording' ? 'This frame plays a recording. Use Record' : null, busyReason, recording ? 'Stop the recording first' : null);
  const recordReason = firstReason(deviceReason, cellReason, busyReason);
  const appReason = firstReason(deviceReason, !appId ? 'Choose your app first' : null, busyReason, recording ? 'Stop the recording first' : null);
  const everyReason = firstReason(
    appReason,
    cellReason,
    selected?.target.kind === 'recording' ? 'Recordings are taken one at a time' : null,
    selected && !selected.target.screen ? 'Set how Capture gets to this screen first, with the button above its column' : null
  );
  const everythingReason = firstReason(
    appReason,
    targets.some((target) => target.kind === 'screenshot' && target.screen) ? null : 'Set how Capture gets to at least one screen first'
  );
  const screenReason = !desktop ? DESKTOP_ONLY : null;
  const shotReason = firstReason(cellReason, selected?.target.kind === 'recording' ? 'This frame plays a recording' : null, working ? 'Wait for Capture to finish' : null);

  const missingNotes: string[] = [];
  if (desktop && devices) {
    const wantsIos = targets.some((target) => target.platform === 'ios');
    const wantsAndroid = targets.some((target) => target.platform === 'android');
    if (devices.ios.missing === 'xcode') missingNotes.push('For iPhone and iPad screenshots, install Xcode from the Mac App Store. Xcode comes with the iPhone Simulator.');
    if (devices.ios.missing === 'mac' && wantsIos) missingNotes.push('The iPhone Simulator needs a Mac with Xcode.');
    if (devices.android.missing === 'sdk' && (wantsAndroid || !wantsIos)) {
      missingNotes.push('For Android screenshots, install Android Studio and make an emulator in it, or connect a phone with USB debugging on.');
    }
  }

  const iosDevices = all.filter((candidate) => candidate.platform === 'ios');
  const androidDevices = all.filter((candidate) => candidate.platform === 'android');
  const fit = selectedTarget && running ? deviceFit(selectedTarget, running) : null;
  const elapsed = recording ? formatClock(Date.now() - recording.startedAt) : null;
  const liveAspect = selectedTarget?.screenAspect ?? 0.46;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" data-testid="capture-view" aria-labelledby="capture-view-title">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CameraIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 id="capture-view-title" className="text-sm font-semibold">
            Capture
          </h1>
          <p className="truncate text-xs text-muted-foreground">Screenshots of your app from a simulator or emulator, straight into your artboards</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onBackToEditor}>
            Back to the editor
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-r p-4" aria-label="Device">
          {!desktop ? (
            <Section>
              <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm">
                <p className="font-medium">Capture needs the desktop app</p>
                <p className="text-xs text-muted-foreground">
                  The desktop app takes screenshots from the iPhone Simulator on a Mac, and from Android emulators and phones on Mac, Windows and Linux.
                </p>
                <Button size="sm" className="gap-1.5" onClick={() => void openExternal(DESKTOP_URL)}>
                  <DownloadIcon className="h-3.5 w-3.5" />
                  Get the desktop app
                </Button>
              </div>
            </Section>
          ) : null}

          <Section title="Device">
            <div className="flex items-center gap-1.5">
              <Gate block reason={!desktop ? DESKTOP_ONLY : all.length === 0 ? 'No simulator or emulator found yet' : run ? 'Wait for Capture to finish, or stop it' : null}>
                <Select value={device ? deviceValue(device) : ''} onValueChange={pickDevice}>
                  <SelectTrigger className="h-9 min-w-0 flex-1 text-sm" aria-label="Device">
                    <SelectValue placeholder="Choose a device" />
                  </SelectTrigger>
                  <SelectContent>
                    {iosDevices.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-xs">iPhone and iPad simulators</SelectLabel>
                        {iosDevices.map((candidate) => (
                          <SelectItem key={deviceValue(candidate)} value={deviceValue(candidate)} className="text-sm">
                            {candidate.name}
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {candidate.os}, {STATE_TEXT[candidate.state]}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {androidDevices.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="text-xs">Android</SelectLabel>
                        {androidDevices.map((candidate) => (
                          <SelectItem key={deviceValue(candidate)} value={deviceValue(candidate)} className="text-sm">
                            {candidate.name}
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {candidate.kind === 'phone' ? 'Phone' : candidate.os}, {STATE_TEXT[candidate.state]}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </Gate>
              <Gate reason={!desktop ? DESKTOP_ONLY : null}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  title="Look for devices again"
                  aria-label="Look for devices again"
                  onClick={() => {
                    void refresh();
                    if (running) void loadApps(running);
                  }}
                >
                  <RefreshCwIcon className="h-4 w-4" />
                </Button>
              </Gate>
            </div>
            {device && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="capture-device-state">
                <CircleIcon className={cn('h-2 w-2', device.state === 'running' ? 'fill-green-500 text-green-500' : 'fill-muted-foreground/40 text-muted-foreground/40')} />
                {starting.includes(device.id) && device.state !== 'running' ? 'Starting' : STATE_TEXT[device.state]}
                {device.os && device.state === 'running' ? `, ${device.os}` : null}
              </p>
            )}
            {device && device.state === 'off' && (
              <Button size="sm" variant="outline" className="w-full gap-1.5" disabled={starting.includes(device.id)} onClick={() => void start(device)}>
                {starting.includes(device.id) ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <PlayIcon className="h-3.5 w-3.5" />}
                {starting.includes(device.id) ? `Starting ${device.name}` : `Start ${device.name}`}
              </Button>
            )}
            {device?.state === 'unauthorized' && (
              <p className="text-xs text-muted-foreground">Unlock the phone and allow USB debugging for this computer.</p>
            )}
            {wantedModel && !hasWantedSimulator && desktop && (
              <div className="space-y-1.5 rounded-lg border border-dashed p-3">
                <p className="text-xs text-muted-foreground">
                  The frame is {withArticle(wantedModel.name)}. A simulator of the same model fits the frame exactly.
                </p>
                <Button size="sm" variant="outline" className="w-full gap-1.5" disabled={making} onClick={() => void makeSimulator()}>
                  {making ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <PlusIcon className="h-3.5 w-3.5" />}
                  Make {withArticle(wantedModel.name)} simulator
                </Button>
              </div>
            )}
            {fit === 'other' && selectedTarget && (
              <p className="text-xs text-muted-foreground">
                The frame is {withArticle(selectedTarget.deviceLabel)}, but {running?.name} runs {running?.platform === 'ios' ? 'iOS' : 'Android'}.
              </p>
            )}
            {missingNotes.map((text) => (
              <p key={text} className="text-xs text-muted-foreground">
                {text}
              </p>
            ))}
            {desktop && devices && all.length === 0 && missingNotes.length === 0 && (
              <p className="text-xs text-muted-foreground">No simulators or emulators yet. Make one in Xcode or Android Studio, and the new device shows up here.</p>
            )}
            {listError && <p className="text-xs text-destructive">{listError}</p>}
          </Section>

          <LiveView
            device={running}
            polling={active && !!running && !run}
            frame={run ? runFrame : null}
            aspect={liveAspect}
            emptyText={
              !desktop
                ? 'The screen of your simulator or emulator shows here'
                : running
                  ? `Waiting for the screen of ${running.name}`
                  : device
                    ? `Start ${device.name} to see its screen here`
                    : 'Choose a device to see its screen here'
            }
            onTake={selectedTarget?.kind === 'recording' ? undefined : () => void takeOne()}
            takeReason={takeReason}
          />

          <Section>
            {/* Stop stays whatever is chosen in the grid, or in whichever project is open. */}
            {recording ? (
              <Button className="w-full gap-2" variant="destructive" onClick={() => void stopRecording()}>
                <SquareIcon className="h-4 w-4" />
                Stop and use the recording {elapsed}
              </Button>
            ) : selectedTarget?.kind === 'recording' ? (
              <Gate block reason={recordReason}>
                <Button className="w-full gap-2" onClick={() => void startRecording()}>
                  {busy === 'Starting the recording' ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CircleIcon className="h-4 w-4 fill-current" />}
                  Record
                </Button>
              </Gate>
            ) : (
              <Gate block reason={takeReason}>
                <Button className="w-full gap-2" onClick={() => void takeOne()}>
                  {busy === 'Taking the screenshot' ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CameraIcon className="h-4 w-4" />}
                  Take screenshot
                </Button>
              </Gate>
            )}
            {recording ? (
              <p className="text-center text-xs text-muted-foreground" data-testid="capture-target">
                Goes into {recording.title}
              </p>
            ) : (
              selected && (
                <p className="text-center text-xs text-muted-foreground" data-testid="capture-target">
                  Goes into {frameTitle(selected.target)}, {localeName(selected.locale)}
                </p>
              )
            )}
            {appLocale && selected && appLocale !== selected.locale && !run && (
              <p className="text-center text-xs text-muted-foreground">
                Your app shows {localeName(appLocale)} now. Click Open in {localeName(selected.locale)} in the grid first.
              </p>
            )}
            {note && <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">{note}</p>}
          </Section>

          <Section title="Your app">
            <Gate block reason={firstReason(deviceReason, apps && apps.length === 0 ? 'None of your apps is on this device yet' : null)}>
              <Select
                value={appId ?? ''}
                onValueChange={(value) => running && updateCaptureSession({ appIds: { ...getCaptureSession().appIds, [running.platform]: value } })}
                // An app installed since the device started shows up when the list opens.
                onOpenChange={(open) => {
                  if (open && running) void loadApps(running);
                }}
              >
                <SelectTrigger className="h-9 text-sm" aria-label="Your app">
                  <SelectValue placeholder={apps === null && running ? 'Looking for your apps' : 'Choose your app'} />
                </SelectTrigger>
                <SelectContent>
                  {(apps ?? []).map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id} className="text-sm">
                      {candidate.name}
                      {candidate.name !== candidate.id && <span className="ml-1.5 text-xs text-muted-foreground">{candidate.id}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Gate>
            {running && apps && apps.length === 0 && (
              <p className="text-xs text-muted-foreground">
                None of your apps is on {running.name} yet. Run your app on {running.name} once from {running.platform === 'ios' ? 'Xcode' : 'Android Studio'}, then choose your app here.
              </p>
            )}
            {app && (
              <p className="text-xs text-muted-foreground">
                {running?.platform === 'ios'
                  ? 'Capture opens your app with the launch argument -OSGScreenshots YES. Your app can read -OSGScreenshots to show sample content.'
                  : 'Capture opens your app with the intent extra osg_screenshots set to true. Your app can read osg_screenshots to show sample content.'}
              </p>
            )}
          </Section>

          <Section title="Settings">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="capture-tidy" className="text-sm">
                  Tidy status bar
                </Label>
                <p className="text-xs text-muted-foreground">9:41, full signal and a full battery</p>
              </div>
              <Switch id="capture-tidy" checked={session.tidy} onCheckedChange={(tidy) => updateCaptureSession({ tidy })} disabled={!desktop} />
            </div>
            <div className="space-y-1">
              <p className="text-sm">Light or dark</p>
              <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1" role="radiogroup" aria-label="Light or dark">
                {(
                  [
                    { value: 'as-set', label: 'As is', icon: SmartphoneIcon },
                    { value: 'light', label: 'Light', icon: SunIcon },
                    { value: 'dark', label: 'Dark', icon: MoonIcon },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={session.appearance === option.value}
                    disabled={!desktop}
                    onClick={() => void setAppearance(option.value)}
                    className={cn(
                      'flex items-center justify-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground disabled:opacity-50',
                      session.appearance === option.value && 'bg-background font-medium text-foreground shadow-sm'
                    )}
                  >
                    <option.icon className="h-3 w-3" />
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="capture-advance" className="text-sm">
                  Next frame after each screenshot
                </Label>
                <p className="text-xs text-muted-foreground">Fill a row while you go through your app</p>
              </div>
              <Switch id="capture-advance" checked={session.advance} onCheckedChange={(advance) => updateCaptureSession({ advance })} />
            </div>
          </Section>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {noProject ? (
            <div className="m-auto max-w-sm space-y-3 text-center">
              <p className="text-sm font-medium">Open a project first</p>
              <p className="text-xs text-muted-foreground">Capture fills the phone frames of the project open in the editor.</p>
              <Button size="sm" onClick={onBackToEditor}>
                Back to the editor
              </Button>
            </div>
          ) : targets.length === 0 ? (
            <div className="m-auto max-w-sm space-y-3 text-center">
              <p className="text-sm font-medium">This project has no phone frames yet</p>
              <p className="text-xs text-muted-foreground">Add a phone from Devices in the editor, then come back to fill it.</p>
              <Button size="sm" onClick={onBackToEditor}>
                Back to the editor
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Gate reason={everyReason}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => selectedTarget && void runJobs(everyLanguageJobs(selectedTarget), `${frameTitle(selectedTarget)} in every language`)}
                  >
                    <LanguagesIcon className="h-3.5 w-3.5" />
                    This screen in every language
                  </Button>
                </Gate>
                <Gate reason={everythingReason}>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void runJobs(everythingJobs(), 'Every screen in every language')}>
                    <WandSparklesIcon className="h-3.5 w-3.5" />
                    Every screen in every language
                  </Button>
                </Gate>
                {locales.length === 1 && (
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={onOpenLanguages}>
                    <PlusIcon className="h-3.5 w-3.5" />
                    Add languages
                  </Button>
                )}
              </div>

              {run && (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3" role="status" data-testid="capture-run">
                  <Loader2Icon className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{run.label}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary transition-all" style={{ width: `${(run.done / Math.max(1, run.total)) * 100}%` }} />
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {run.done} of {run.total}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => run.controller.abort()}>
                    Stop
                  </Button>
                </div>
              )}

              <CaptureGrid
                targets={targets}
                locales={locales}
                baseLocale={baseLocale}
                cells={cells}
                pending={pending}
                working={workingKey}
                selectedKey={selectedKey}
                flashKey={flashKey}
                appLocale={appLocale}
                onSelect={(key) => !run && setSelectedKey(key)}
                onOpenInLanguage={(locale) => void openInLanguage(locale)}
                openReason={appReason}
                onSetScreen={(target, screen) => onSetScreen(target.boardId, target.elementId, screen)}
                screenReason={screenReason}
              />

              {locales.length === 1 && (
                <p className="text-xs text-muted-foreground">
                  This project has one language. Click Add languages to take each screen in more languages.
                </p>
              )}

              <Section title="Taken this session">
                {session.shots.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Screenshots you take show here, so you can put one in another frame too.</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {session.shots.map((shot) => (
                      <ShotThumb key={shot.ref} shot={shot} reason={shotReason} onClick={() => putShot(shot)} />
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </main>
      </div>
    </section>
  );
}

