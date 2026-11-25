"use client";

// Director: screen recordings in, a film of them on a 3D phone out. A new
// film starts from a template, then either from a recording (Director reads
// it for its moments, taps, typing, scrolls and new screens, and plans a
// camera that follows them) or from moves recorded with the user's phone
// against a stand-in screen, with the recording added later. The editor then
// has the film's picture, its timeline (clips of recordings, the camera, the
// moments, the words) and a panel for whatever is picked.
//
// Films are kept in their own database (src/lib/director/store.ts), one row
// each, saved half a second after a change. Recordings stay rows in the
// shared media table. Each clip is read for its moments once, in the
// background, one clip at a time.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, ClapperboardIcon, DownloadIcon, FilmIcon, HandIcon, Loader2Icon, QrCodeIcon, Redo2Icon, Undo2Icon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { getMediaAsset, getMediaUrl, saveMedia } from '@/lib/mediaStore';
import { fitPhone, newFilm, planFor } from '@/lib/director/film';
import { filmDuration } from '@/lib/director/frame';
import { FilmPlayer, type PlayerSchedule } from '@/lib/director/player';
import { readClip } from '@/lib/director/read';
import { deleteFilm, listFilms, saveFilm } from '@/lib/director/store';
import type { FilmTemplate } from '@/lib/director/templates';
import {
  addClip,
  addMoment,
  changeRecordingFrom,
  clipNeedsRead,
  clipSpans,
  editMoment,
  filmMoments,
  MAX_FILM_SECONDS,
  moveClip,
  removeClip,
  removeMoment,
  replaceClip,
  retimeMoment,
  splitAt,
  trimClip,
  withClipReading,
  type ClipReading,
} from '@/lib/director/timeline';
import type { Film, FilmClip, FilmSource, Moment } from '@/lib/director/types';
import { cn } from '@/lib/utils';
import { DirectorInspector } from './DirectorInspector';
import { BeginStep, PickRecordingStep, RecordingList, TemplateStep } from './DirectorStart';
import { DirectorTimeline, type TimelineSelection } from './DirectorTimeline';
import { DirectorViewport, type LiveTurn } from './DirectorViewport';
import { ExportDialog } from './ExportDialog';
import type { PhoneLinkActions, PhoneLinkState } from './PhoneLinkPanel';

export interface DirectorRecording {
  mediaId: string;
  name: string;
  /** Where it is in the project, in the user's words ("Artboard 3"). */
  where: string;
}

export interface DirectorProject {
  id: string | null;
  name: string;
  /** The app's name if the user gave one (projectAppName), else empty. */
  appName: string;
  colors: [string, string, string] | null;
  recordings: DirectorRecording[];
}

export interface DirectorWorkspaceProps {
  active: boolean;
  /** The open project, read when the view needs it. Absent on the phone page. */
  readProject?: () => DirectorProject;
  /** The account's sign-in, for linking a phone. */
  getToken?: () => string | null;
  onSignIn?: () => void;
  onBackToEditor?: () => void;
}

const ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.closest('[role="dialog"]') || !!el.closest('[role="slider"]');
}

/** Undo and redo for a film: whole films as steps, quick changes (typing, dragging) merged into one. */
function useHistory() {
  const [, bump] = useState(0);
  const api = useRef<{
    past: Film[];
    future: Film[];
    lastAt: number;
    record(previous: Film): void;
    undo(current: Film): Film | null;
    redo(current: Film): Film | null;
    clear(): void;
  } | null>(null);
  if (!api.current) {
    const h = {
      past: [] as Film[],
      future: [] as Film[],
      lastAt: 0,
      record(previous: Film) {
        const now = performance.now();
        if (now - h.lastAt > 600) {
          h.past.push(previous);
          if (h.past.length > 80) h.past.shift();
        }
        h.lastAt = now;
        h.future = [];
        bump((n) => n + 1);
      },
      undo(current: Film): Film | null {
        const previous = h.past.pop();
        if (!previous) return null;
        h.future.push(current);
        h.lastAt = 0;
        bump((n) => n + 1);
        return previous;
      },
      redo(current: Film): Film | null {
        const next = h.future.pop();
        if (!next) return null;
        h.past.push(current);
        h.lastAt = 0;
        bump((n) => n + 1);
        return next;
      },
      clear() {
        h.past = [];
        h.future = [];
        bump((n) => n + 1);
      },
    };
    api.current = h;
  }
  return api.current;
}

/** What a recording picked in the file chooser (or from the project) is for. */
type PickAction = { kind: 'new'; template: FilmTemplate | null } | { kind: 'add' } | { kind: 'replace'; clipId: string } | { kind: 'from'; t: number };

type Step = { kind: 'templates' } | { kind: 'begin'; template: FilmTemplate | null } | { kind: 'pick'; template: FilmTemplate | null };

/** The moves-first card's words for each state of the phone link, so it never asks for a code that isn't there. */
const MOVES_FIRST_WORDS: Record<PhoneLinkState, string> = {
  off: 'Connect your phone, then record a take while the stand-in screen plays. Add your recording after.',
  signin: 'Sign in to connect your phone, then record a take while the stand-in screen plays. Add your recording after.',
  starting: 'Getting the code for your phone ready.',
  code: 'Scan the code with your phone, then press Record a take. Add your recording after.',
  failed: "Your phone couldn't connect. Try again, then record a take while the stand-in screen plays.",
  connected: 'Your phone is connected. Press Record a take and move it while the stand-in screen plays. Add your recording after.',
};

const PICK_TITLES: Record<Exclude<PickAction['kind'], 'new'>, string> = {
  add: 'Add a recording',
  replace: 'Change this recording',
  from: 'Change the recording from here',
};

/** The film's name follows its first recording until the user names it. */
function namedAfter(film: Film, source: FilmSource): Film {
  return film.named || film.clips.length !== 1 ? film : { ...film, name: source.name.replace(/\.[a-z0-9]{2,4}$/i, '') || film.name };
}

/** A recording read once is kept for the session, so undo or a split never reads it again. */
function readingKey(clip: Pick<FilmClip, 'mediaId' | 'in' | 'out'>): string {
  return `${clip.mediaId}@${clip.in.toFixed(2)}-${clip.out.toFixed(2)}`;
}

export function DirectorWorkspace({ active, readProject, getToken, onSignIn, onBackToEditor }: DirectorWorkspaceProps) {
  const { toast } = useToast();
  const [project, setProject] = useState<DirectorProject | null>(null);
  const [films, setFilms] = useState<Film[]>([]);
  const [film, setFilm] = useState<Film | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'templates' });
  const [reading, setReading] = useState<{ clipId: string; fraction: number } | null>(null);
  const [selection, setSelection] = useState<TimelineSelection>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [picker, setPicker] = useState<Exclude<PickAction, { kind: 'new' }> | null>(null);
  const [player, setPlayer] = useState<FilmPlayer | null>(null);
  const live = useRef<LiveTurn['current']>(null);
  const linkActions = useRef<PhoneLinkActions | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const filmRef = useRef<Film | null>(null);
  const pendingRef = useRef<PickAction | null>(null);
  const readAbort = useRef<AbortController | null>(null);
  const readingRef = useRef<string | null>(null);
  const failedReads = useRef(new Set<string>());
  const readCache = useRef(new Map<string, ClipReading>());
  const autoplayRef = useRef(false);
  /** Where a film just opened starts, applied once the player has its schedule. */
  const pendingSeek = useRef<number | null>(null);
  /** A film made moves first shows the code for the phone as soon as it opens: its id, while that holds. */
  const [autoConnectFor, setAutoConnectFor] = useState<string | null>(null);
  /** Where the phone link stands: the moves-first card says what to do next from it. */
  const [linkState, setLinkState] = useState<PhoneLinkState>('off');
  const [loadedMedia, setLoadedMedia] = useState<string | null>(null);
  const saveTimer = useRef(0);
  const history = useHistory();
  filmRef.current = film;

  // The player lives as long as the view.
  useEffect(() => {
    const next = new FilmPlayer();
    setPlayer(next);
    return () => next.dispose();
  }, []);

  // Out of sight, nothing plays: not a film whose reading ends then, nor a take a phone starts.
  useEffect(() => {
    if (player) player.hidden = !active;
  }, [player, active]);

  // Every video on this device, whichever project was open when it was made.
  const refreshFilms = useCallback(async () => {
    try {
      setFilms(await listFilms());
    } catch (error) {
      console.error('Director could not list the videos', error);
    }
  }, []);

  // What the open project has, read each time the view shows.
  useEffect(() => {
    if (!active) return;
    const read = readProject?.() ?? null;
    setProject(read);
    void refreshFilms();
  }, [active, readProject, refreshFilms]);

  const persist = useCallback((next: Film) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveFilm(next).catch((error) => console.error('Director could not save the video', error));
    }, 500);
  }, []);

  /** Every change to the open film: kept for undo, saved, drawn. */
  const update = useCallback(
    (change: (film: Film) => Film) => {
      const current = filmRef.current;
      if (!current) return;
      const changed = change(current);
      if (changed === current) return;
      const next = { ...changed, updatedAt: Date.now() };
      history.record(current);
      filmRef.current = next;
      setFilm(next);
      persist(next);
    },
    [history, persist]
  );

  /** A change made by Director itself (a reading arriving): saved and drawn, but not a step to undo. */
  const quietly = useCallback(
    (next: Film) => {
      filmRef.current = next;
      setFilm(next);
      persist(next);
    },
    [persist]
  );

  const plan = useMemo(() => (film ? planFor(film) : null), [film]);

  // The player follows the clips, the film's length and the sound.
  const scheduleKey = film
    ? `${film.id}|` +
      clipSpans(film)
        .map((span) => `${span.clip.mediaId}@${span.start.toFixed(3)}-${span.end.toFixed(3)}:${span.clip.in.toFixed(3)}`)
        .join('|') + `|${filmDuration(film).toFixed(3)}`
    : '';
  const schedule = useMemo<PlayerSchedule | null>(() => {
    const current = filmRef.current;
    if (!current) return null;
    return { segments: clipSpans(current).map((span) => ({ mediaId: span.clip.mediaId, start: span.start, end: span.end, in: span.clip.in })), duration: filmDuration(current) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleKey]);
  useEffect(() => {
    if (!player || !schedule) return;
    player.setSchedule(schedule);
    // A film just opened goes to its start point now that the player knows its length.
    if (pendingSeek.current !== null) {
      void player.seek(pendingSeek.current);
      pendingSeek.current = null;
    }
  }, [player, schedule]);
  useEffect(() => {
    if (player && film) player.sound = film.sound.recording;
  }, [player, film?.sound.recording]); // eslint-disable-line react-hooks/exhaustive-deps

  // A video for each recording the film uses.
  const mediaKey = film ? Array.from(new Set(film.clips.map((clip) => clip.mediaId))).join(',') : '';
  const filmId = film?.id ?? '';
  useEffect(() => {
    if (!player || !filmId) return;
    let cancelled = false;
    void (async () => {
      const urls = new Map<string, string>();
      const missing: string[] = [];
      for (const mediaId of mediaKey ? mediaKey.split(',') : []) {
        const url = await getMediaUrl(mediaId);
        if (url) urls.set(mediaId, url);
        else missing.push(mediaId);
      }
      if (cancelled) return;
      if (missing.length) {
        const names = (filmRef.current?.clips ?? []).filter((clip) => missing.includes(clip.mediaId)).map((clip) => clip.name);
        toast({ title: 'A recording in this video is missing', description: `${names[0] ?? 'A recording'} is no longer on this device. Pick its clip and change the recording.` });
      }
      try {
        await player.load(urls);
      } catch (error) {
        if (!cancelled) toast({ title: "A recording can't be played here", description: error instanceof Error ? error.message : 'Try an MP4 file.' });
        return;
      }
      if (!cancelled) setLoadedMedia(`${filmId}|${mediaKey}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [player, filmId, mediaKey, toast]);

  // Each clip read for its moments, one at a time, in the background.
  const readOne = useCallback(
    async (target: Film, clip: FilmClip) => {
      const key = readingKey(clip);
      const cached = readCache.current.get(key);
      const apply = (result: ClipReading) => {
        const current = filmRef.current;
        if (!current || current.id !== target.id) return;
        const now = current.clips.find((c) => c.id === clip.id);
        if (!now || now.mediaId !== clip.mediaId) return;
        quietly(withClipReading(current, clip.id, result));
      };
      if (cached) {
        apply(cached);
        return;
      }
      readingRef.current = clip.id;
      setReading({ clipId: clip.id, fraction: 0 });
      // The film playing while the recording is read would take frames from the reader.
      const wasPlaying = !!player?.isPlaying;
      player?.pause();
      const controller = new AbortController();
      readAbort.current = controller;
      try {
        const url = await getMediaUrl(clip.mediaId);
        if (!url) throw new Error(`${clip.name} is no longer on this device.`);
        // Progress at most five times a second: each one draws the editor again,
        // and the reader needs the page's time for its frames.
        let shownAt = 0;
        const onProgress = (fraction: number) => {
          const now = performance.now();
          if (now - shownAt < 200 && fraction < 1) return;
          shownAt = now;
          setReading({ clipId: clip.id, fraction });
        };
        const result = await readClip(clip, url, { signal: controller.signal, onProgress });
        if (controller.signal.aborted) return;
        readCache.current.set(key, result);
        apply(result);
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return;
        failedReads.current.add(key);
        console.error('Director could not read the recording', error);
        toast({ title: "Director couldn't read a recording", description: error instanceof Error ? error.message : 'Try another recording.' });
      } finally {
        if (readingRef.current === clip.id) {
          readingRef.current = null;
          setReading(null);
        }
        if (readAbort.current === controller) readAbort.current = null;
        if (wasPlaying && filmRef.current?.id === target.id && !controller.signal.aborted) void player?.play();
      }
    },
    [quietly, toast, player]
  );

  useEffect(() => {
    if (!film || readingRef.current) return;
    // Reading waits for the film's own videos, so the two never fight over frames.
    if (film.clips.length && loadedMedia !== `${film.id}|${mediaKey}`) return;
    const next = film.clips.find((clip) => clipNeedsRead(clip) && !failedReads.current.has(readingKey(clip)));
    if (next) {
      void readOne(film, next);
      return;
    }
    // Everything read: a film just opened starts playing, once its videos are ready.
    if (autoplayRef.current && player && film.clips.length && loadedMedia === `${film.id}|${mediaKey}`) {
      autoplayRef.current = false;
      void player.play();
    }
  }, [film, reading, readOne, player, loadedMedia, mediaKey]);

  const open = useCallback(
    (target: Film, autoplay = true, at = 0) => {
      readAbort.current?.abort();
      readingRef.current = null;
      setReading(null);
      history.clear();
      setSelection(null);
      filmRef.current = target;
      autoplayRef.current = autoplay && target.clips.length > 0;
      player?.pause();
      pendingSeek.current = at;
      setFilm(target);
    },
    [player, history]
  );

  const full = useCallback(() => {
    toast({ title: 'There is no room for that recording', description: `A video can be up to ${MAX_FILM_SECONDS} seconds. Trim a recording or take one out first.` });
  }, [toast]);

  /** A recording picked in the file chooser or from the project, used for what was asked. */
  const applySource = useCallback(
    async (source: FilmSource) => {
      const action = pendingRef.current ?? { kind: 'new' as const, template: null };
      pendingRef.current = null;
      setPicker(null);
      if (action.kind === 'new') {
        const made = newFilm({ projectId: project?.id ?? null, title: project?.appName ?? '', colors: project?.colors ?? null, template: action.template });
        const added = addClip(made, source);
        if (!added) {
          full();
          return;
        }
        const ready = namedAfter(fitPhone(added.film), source);
        await saveFilm(ready);
        setFilms((list) => [ready, ...list]);
        setStep({ kind: 'templates' });
        open(ready);
        return;
      }
      const current = filmRef.current;
      if (!current) return;
      const result =
        action.kind === 'add'
          ? addClip(current, source)
          : action.kind === 'replace'
            ? { film: replaceClip(current, action.clipId, source), clipId: action.clipId }
            : changeRecordingFrom(current, action.t, source);
      if (!result) {
        full();
        return;
      }
      // The first recording in a film made moves first plays once it's read, as a new film does.
      if (!current.clips.length) autoplayRef.current = true;
      update(() => namedAfter(fitPhone(result.film), source));
      setSelection({ kind: 'clip', id: result.clipId });
      const span = clipSpans(result.film).find((s) => s.clip.id === result.clipId);
      if (span && player) void player.seek(span.start);
    },
    [project, full, open, update, player]
  );

  const addFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
        toast({ title: "That isn't a video", description: 'Choose a screen recording, an MP4 or MOV file.' });
        return;
      }
      try {
        const { id, probe } = await saveMedia(file, file.name);
        if (probe.width > probe.height) {
          toast({ title: 'This recording is sideways', description: 'Director shows it on a phone held upright. Record in portrait for the best result.' });
        }
        await applySource({ mediaId: id, name: file.name, width: probe.width, height: probe.height, duration: probe.duration });
      } catch (error) {
        toast({ title: "That recording couldn't be read", description: error instanceof Error ? error.message : 'Use an MP4 or MOV file.' });
      }
    },
    [applySource, toast]
  );

  const applyRecording = useCallback(
    async (recording: DirectorRecording) => {
      const asset = await getMediaAsset(recording.mediaId);
      if (!asset) {
        toast({ title: 'That recording is no longer on this device', description: 'Add it to the project again.' });
        return;
      }
      await applySource({ mediaId: recording.mediaId, name: recording.name, width: asset.width ?? 886, height: asset.height ?? 1920, duration: asset.duration ?? 10 });
    },
    [applySource, toast]
  );

  /** Asks for a recording: straight to the file chooser, or a choice when the project has recordings. */
  const ask = useCallback(
    (action: PickAction) => {
      pendingRef.current = action;
      if (action.kind !== 'new' && project && project.recordings.length > 0) setPicker(action);
      else fileRef.current?.click();
    },
    [project]
  );

  const startMovesFirst = useCallback(
    async (template: FilmTemplate | null) => {
      const made = newFilm({ projectId: project?.id ?? null, title: project?.appName ?? '', colors: project?.colors ?? null, template });
      await saveFilm(made);
      setFilms((list) => [made, ...list]);
      setStep({ kind: 'templates' });
      // On a computer the phone's code shows at once; on a phone, Move this phone is the way in.
      setAutoConnectFor(typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? null : made.id);
      // Past the opening rise, so the phone shows at rest, whole.
      open(made, false, 2);
    },
    [project, open]
  );

  const close = useCallback(() => {
    readAbort.current?.abort();
    player?.pause();
    clearTimeout(saveTimer.current);
    const current = filmRef.current;
    if (current) void saveFilm(current);
    setFilm(null);
    filmRef.current = null;
    setSelection(null);
    setAutoConnectFor(null);
    history.clear();
    void refreshFilms();
  }, [player, history, refreshFilms]);

  const remove = useCallback(
    async (target: Film) => {
      await deleteFilm(target.id);
      setFilms((list) => list.filter((f) => f.id !== target.id));
      toast({ title: `Deleted ${target.name}` });
    },
    [toast]
  );

  const split = useCallback(() => {
    if (!player) return;
    const current = filmRef.current;
    if (!current) return;
    const result = splitAt(current, player.time);
    if (!result) return;
    update(() => result.film);
    setSelection({ kind: 'clip', id: result.right });
  }, [player, update]);

  const deleteSelected = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'moment') update((f) => removeMoment(f, selection.id));
    else update((f) => removeClip(f, selection.id));
    setSelection(null);
  }, [selection, update]);

  const undo = useCallback(
    (redo: boolean) => {
      const current = filmRef.current;
      if (!current) return;
      const next = redo ? history.redo(current) : history.undo(current);
      if (next) {
        filmRef.current = next;
        setFilm(next);
        persist(next);
      }
    },
    [history, persist]
  );

  // Space plays, S splits, Delete takes out what's picked, the arrows step, Cmd+Z and Cmd+Shift+Z undo and redo.
  useEffect(() => {
    if (!active || !film) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === ' ' && !mod) {
        if ((event.target as HTMLElement)?.tagName === 'BUTTON') return;
        event.preventDefault();
        void player?.toggle();
      } else if ((event.key === 's' || event.key === 'S') && !mod) {
        event.preventDefault();
        split();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
        event.preventDefault();
        deleteSelected();
      } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !mod && player && (event.target === document.body || event.target === null)) {
        event.preventDefault();
        const delta = (event.shiftKey ? 1 : 1 / 30) * (event.key === 'ArrowLeft' ? -1 : 1);
        void player.seek(player.time + delta);
      } else if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo(event.shiftKey);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, film, player, selection, split, deleteSelected, undo]);

  // Saving what's waiting when the view goes away.
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      const current = filmRef.current;
      if (current) void saveFilm(current);
      readAbort.current?.abort();
    },
    []
  );

  const moments = useMemo(() => (film ? filmMoments(film) : []), [film]);
  const selectedMoment = film && selection?.kind === 'moment' ? moments.find((m) => m.id === selection.id) ?? null : null;
  const selectedClip = film && selection?.kind === 'clip' ? film.clips.find((c) => c.id === selection.id) ?? null : null;
  const readingClip = reading && film ? film.clips.find((clip) => clip.id === reading.clipId) : null;
  const busy = reading ? `Finding the moments in ${readingClip?.name.replace(/\.[a-z0-9]{2,4}$/i, '') ?? 'your recording'}, ${Math.round(reading.fraction * 100)}%` : null;
  const noRecording = !!film && film.clips.length === 0;

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = Array.from(event.dataTransfer.files).find((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    if (!file) return;
    if (film) pendingRef.current = { kind: 'add' };
    else pendingRef.current = { kind: 'new', template: step.kind === 'templates' ? null : step.template };
    void addFile(file);
  };

  const clipActions = {
    onTrim: (clipId: string, patch: { in?: number; out?: number }) => update((f) => trimClip(f, clipId, patch)),
    onReplace: (clipId: string) => ask({ kind: 'replace', clipId }),
    onChangeFrom: () => player && ask({ kind: 'from', t: player.time }),
    onSplit: split,
    onMove: (clipId: string, toIndex: number) => update((f) => moveClip(f, clipId, toIndex)),
    onRemove: (clipId: string) => {
      update((f) => removeClip(f, clipId));
      setSelection(null);
    },
    onReadAgain: (clipId: string) => {
      const clip = filmRef.current?.clips.find((c) => c.id === clipId);
      if (clip) {
        readCache.current.delete(readingKey(clip));
        failedReads.current.delete(readingKey(clip));
      }
      quietly({ ...filmRef.current!, clips: filmRef.current!.clips.map((c) => (c.id === clipId ? { ...c, read: null } : c)) });
    },
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
      data-testid="director-view"
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          // A file chosen with nothing asked for: a new film from the step the user is on.
          if (!pendingRef.current) pendingRef.current = filmRef.current ? { kind: 'add' } : { kind: 'new', template: step.kind === 'templates' ? null : step.template };
          void addFile(file);
        }}
        data-testid="director-file"
      />
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:gap-3 sm:px-4">
        {film ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={close} aria-label="All videos">
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="hidden sm:inline">All videos</span>
          </Button>
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClapperboardIcon className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {film ? (
            <Input
              value={film.name}
              onChange={(e) => update((f) => ({ ...f, name: e.target.value, named: true }))}
              className="h-8 max-w-xs border-transparent bg-transparent px-1.5 text-sm font-semibold shadow-none hover:border-border focus-visible:border-border"
              aria-label="Video name"
              maxLength={80}
            />
          ) : (
            <>
              <h1 className="text-sm font-semibold">Director</h1>
              <p className="truncate text-xs text-muted-foreground">Phone videos of your app, filmed for you</p>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {film && (
            <>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Undo" title="Undo" disabled={history.past.length === 0} onClick={() => undo(false)}>
                <Undo2Icon className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Redo" title="Redo" disabled={history.future.length === 0} onClick={() => undo(true)}>
                <Redo2Icon className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setExportOpen(true)}
                disabled={reading !== null || noRecording}
                title={noRecording ? 'Add a recording first' : reading !== null ? 'Wait until the recording has been read' : undefined}
                data-testid="director-export"
              >
                {exporting ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <DownloadIcon className="h-3.5 w-3.5" />}
                Export video
              </Button>
            </>
          )}
          {!film && step.kind === 'pick' && (
            <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => ask({ kind: 'new', template: step.template })}>
              <UploadIcon className="h-3.5 w-3.5" />
              Choose a recording
            </Button>
          )}
          {onBackToEditor && (
            <Button type="button" variant="ghost" size="sm" className={cn('h-8', film && 'hidden md:inline-flex')} onClick={onBackToEditor}>
              <span className="hidden sm:inline">Back to the editor</span>
              <span className="sm:hidden">Editor</span>
            </Button>
          )}
        </div>
      </header>

      {!film || !plan || !player ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {step.kind === 'templates' && (
            <TemplateStep
              project={project}
              films={films}
              onPick={(template) => setStep({ kind: 'begin', template })}
              onOpenFilm={(f) => {
                setStep({ kind: 'templates' });
                open(f);
              }}
              onDeleteFilm={(f) => void remove(f)}
            />
          )}
          {step.kind === 'begin' && (
            <BeginStep
              template={step.template}
              onBack={() => setStep({ kind: 'templates' })}
              onRecordingFirst={() => setStep({ kind: 'pick', template: step.template })}
              onMovesFirst={() => void startMovesFirst(step.template)}
            />
          )}
          {step.kind === 'pick' && (
            <PickRecordingStep
              project={project}
              dragging={dragging}
              onBack={() => setStep({ kind: 'begin', template: step.template })}
              onChoose={() => ask({ kind: 'new', template: step.template })}
              onUseRecording={(recording) => {
                pendingRef.current = { kind: 'new', template: step.template };
                void applyRecording(recording);
              }}
            />
          )}
        </div>
      ) : (
        // On a phone, one column that scrolls: the picture, the timeline, then the panel.
        <div className="min-h-0 flex-1 overflow-y-auto md:flex md:flex-row md:overflow-hidden" data-testid="director-film">
          <div className="flex min-w-0 flex-col md:min-h-0 md:flex-1">
            <div className="h-[52svh] min-h-[18rem] p-3 sm:p-5 md:h-auto md:flex-1">
              <DirectorViewport film={film} plan={plan} player={player} active={active} live={live} busy={busy} onError={(message) => toast({ title: "The 3D picture couldn't start", description: message })} />
            </div>
            {noRecording && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-amber-500/[0.06] px-4 py-2.5" data-testid="director-moves-first-card">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <HandIcon className="h-4 w-4" />
                </span>
                <div className="min-w-[14rem] flex-1 text-xs">
                  <p className="font-semibold">{film.take ? 'Your moves are recorded' : 'Moves first'}</p>
                  <p className="text-muted-foreground">{film.take ? 'Add your recording to see it on the phone.' : MOVES_FIRST_WORDS[linkState]}</p>
                </div>
                <div className="flex gap-1.5">
                  {!film.take && linkState === 'signin' && onSignIn && (
                    <Button type="button" size="sm" variant="outline" className="h-8" onClick={onSignIn}>
                      Sign in
                    </Button>
                  )}
                  {!film.take && (linkState === 'off' || linkState === 'failed') && (
                    <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => linkActions.current?.connect()}>
                      <QrCodeIcon className="h-3.5 w-3.5" />
                      {linkState === 'failed' ? 'Try again' : 'Use your phone'}
                    </Button>
                  )}
                  <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => ask({ kind: 'add' })}>
                    <FilmIcon className="h-3.5 w-3.5" />
                    Add recording
                  </Button>
                </div>
              </div>
            )}
            <div className="border-t">
              <DirectorTimeline
                film={film}
                plan={plan}
                player={player}
                selection={selection}
                onSelect={setSelection}
                reading={reading}
                onRetimeMoment={(id, start, end) => {
                  const current = filmRef.current;
                  if (!current) return;
                  const moved = retimeMoment(current, id, { start, end });
                  update(() => moved.film);
                  // Moved into another clip, the moment has that clip's id now: what had it picked follows it.
                  if (moved.id !== id) setSelection((picked) => (picked?.kind === 'moment' && picked.id === id ? { kind: 'moment', id: moved.id } : picked));
                }}
                onTrimClip={(clipId, patch) => update((f) => trimClip(f, clipId, patch))}
                onMoveClip={(clipId, toIndex) => update((f) => moveClip(f, clipId, toIndex))}
                onSplit={split}
                onChangeFrom={() => ask(film.clips.length ? { kind: 'from', t: player.time } : { kind: 'add' })}
                onAddRecording={() => ask({ kind: 'add' })}
                onAddCloseUp={() => {
                  const result = addMoment(film, player.time);
                  if (!result) return;
                  update(() => result.film);
                  setSelection({ kind: 'moment', id: result.id });
                }}
                onDeleteSelected={deleteSelected}
              />
            </div>
          </div>
          <aside className="w-full border-t md:min-h-0 md:w-80 md:shrink-0 md:overflow-y-auto md:border-l md:border-t-0">
            <DirectorInspector
              film={film}
              player={player}
              selected={selectedMoment}
              selectedClip={selectedClip}
              clipActions={clipActions}
              brandColors={project?.colors ?? null}
              live={live}
              linkActions={linkActions}
              autoConnect={autoConnectFor === film.id}
              getToken={() => getToken?.() ?? null}
              onSignIn={onSignIn}
              // No code to scan until the user signs in: the moves-first card says connect instead.
              onLinkStateChange={setLinkState}
              onLiveChange={() => player.requestDraw()}
              update={update}
              editMoment={(id, patch: Partial<Moment>) => update((f) => editMoment(f, id, patch))}
              removeMoment={(id) => {
                update((f) => removeMoment(f, id));
                setSelection(null);
              }}
            />
          </aside>
        </div>
      )}
      {film && <ExportDialog film={film} open={exportOpen} onOpenChange={setExportOpen} onExporting={setExporting} />}
      <Dialog
        open={!!picker}
        onOpenChange={(open) => {
          if (open) return;
          setPicker(null);
          pendingRef.current = null;
        }}
      >
        <DialogContent className="sm:max-w-lg" data-testid="director-recording-picker">
          <DialogHeader>
            <DialogTitle>{picker ? PICK_TITLES[picker.kind] : ''}</DialogTitle>
            <DialogDescription>Choose a file, or a recording already in this project.</DialogDescription>
          </DialogHeader>
          <Button type="button" className="w-full gap-1.5" onClick={() => fileRef.current?.click()}>
            <UploadIcon className="h-4 w-4" />
            Choose a file
          </Button>
          {project && project.recordings.length > 0 && <RecordingList recordings={project.recordings} onUse={(recording) => void applyRecording(recording)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

