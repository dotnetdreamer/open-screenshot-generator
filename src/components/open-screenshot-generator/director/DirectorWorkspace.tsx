"use client";

// Director: a screen recording in, a film of it on a 3D phone out. The view
// reads the recording for its moments (taps, typing, scrolls, new screens),
// plans a camera that follows them, and plays the film while the person
// changes the look, the moments, or moves the phone with their own phone.
//
// Films are kept in their own database (src/lib/director/store.ts), one row
// each, saved half a second after a change. The recording stays a row in the
// shared media table.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, ClapperboardIcon, DownloadIcon, FilmIcon, Loader2Icon, PlusIcon, Redo2Icon, Trash2Icon, Undo2Icon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { getMediaAsset, getMediaUrl, saveMedia } from '@/lib/mediaStore';
import { ANALYSIS_VERSION } from '@/lib/director/analyze';
import { addMoment, editMoment, MAX_FILM_SECONDS, newFilm, planFor, removeMoment, trimLength, withAnalysis } from '@/lib/director/film';
import { filmDuration } from '@/lib/director/frame';
import { FilmPlayer } from '@/lib/director/player';
import { readRecording } from '@/lib/director/read';
import { deleteFilm, listFilms, saveFilm } from '@/lib/director/store';
import type { Film, FilmSource, Moment } from '@/lib/director/types';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { DirectorInspector } from './DirectorInspector';
import { DirectorTimeline } from './DirectorTimeline';
import { DirectorViewport, type LiveTurn } from './DirectorViewport';
import { ExportDialog } from './ExportDialog';

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
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.closest('[role="dialog"]');
}

function formatLength(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

function StartScreen({
  project,
  films,
  dragging,
  onChoose,
  onUseRecording,
  onOpenFilm,
  onDeleteFilm,
}: {
  project: DirectorProject | null;
  films: Film[];
  dragging: boolean;
  onChoose: () => void;
  onUseRecording: (recording: DirectorRecording) => void;
  onOpenFilm: (film: Film) => void;
  onDeleteFilm: (film: Film) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12" data-testid="director-start">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg">
          <ClapperboardIcon className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold sm:text-2xl">Turn a screen recording into a phone video</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Director finds the taps, typing and scrolling in your recording, and films them on a 3D phone with the camera moving to each one. Or move the phone yourself with your own phone.
        </p>
      </div>

      <button
        type="button"
        onClick={onChoose}
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
        )}
        data-testid="director-drop"
      >
        <UploadIcon className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm font-semibold">Drop a screen recording here, or choose one</span>
        <span className="text-xs text-muted-foreground">MP4 or MOV, from an iPhone, an Android phone or the Capture screenshots view. Up to {MAX_FILM_SECONDS} seconds is used</span>
      </button>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          Recording on iPhone
          <InfoTip label="How to record your screen on iPhone">
            Open Control Center and tap the record button. If it isn&apos;t there, add Screen Recording in Settings, Control Center.
          </InfoTip>
        </span>
        <span className="flex items-center gap-1">
          Recording on Android
          <InfoTip label="How to record your screen on Android">Swipe down twice from the top and tap Screen record. Turn on Show touches if you want your taps in the video too.</InfoTip>
        </span>
      </div>

      {project && project.recordings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recordings in this project</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {project.recordings.map((recording) => (
              <button
                key={recording.mediaId}
                type="button"
                onClick={() => onUseRecording(recording)}
                className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <FilmIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{recording.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{recording.where}</span>
                </span>
                <span className="text-xs font-medium text-primary">Use this</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {films.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your videos</h2>
          <div className="grid gap-2 sm:grid-cols-2" data-testid="director-films">
            {films.map((film) => (
              <div key={film.id} className="group flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpenFilm(film)}>
                  {film.strip?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={film.strip[Math.min(film.strip.length - 1, 2)].url} alt="" className="h-10 w-5 shrink-0 rounded object-cover" />
                  ) : (
                    <FilmIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{film.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatLength(filmDuration(film))}, {new Date(film.updatedAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${film.name}`}
                  title="Delete"
                  className="text-muted-foreground opacity-60 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={() => onDeleteFilm(film)}
                >
                  <Trash2Icon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}

export function DirectorWorkspace({ active, readProject, getToken, onSignIn, onBackToEditor }: DirectorWorkspaceProps) {
  const { toast } = useToast();
  const [project, setProject] = useState<DirectorProject | null>(null);
  const [films, setFilms] = useState<Film[]>([]);
  const [film, setFilm] = useState<Film | null>(null);
  const [thumbs, setThumbs] = useState<{ t: number; url: string }[]>([]);
  const [reading, setReading] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [player, setPlayer] = useState<FilmPlayer | null>(null);
  const live = useRef<LiveTurn['current']>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const filmRef = useRef<Film | null>(null);
  const readAbort = useRef<AbortController | null>(null);
  const saveTimer = useRef(0);
  const history = useHistory();
  filmRef.current = film;

  // The player lives as long as the view.
  useEffect(() => {
    const next = new FilmPlayer();
    setPlayer(next);
    return () => next.dispose();
  }, []);

  // Every video on this device, whichever project was open when it was made:
  // a video made before a new project has its id was kept under none, and
  // would drop out of a list of the project's own.
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
      const next = { ...change(current), updatedAt: Date.now() };
      history.record(current);
      filmRef.current = next;
      setFilm(next);
      persist(next);
    },
    [history, persist]
  );

  const plan = useMemo(() => (film ? planFor(film) : null), [film]);

  // The player follows the film's timing and sound.
  useEffect(() => {
    if (!player || !film) return;
    player.setTiming({ trimStart: film.trim.start, trimEnd: film.trim.end, duration: filmDuration(film) });
    player.sound = film.sound.recording;
  }, [player, film]);

  const read = useCallback(
    async (target: Film) => {
      readAbort.current?.abort();
      const controller = new AbortController();
      readAbort.current = controller;
      const url = await getMediaUrl(target.source.mediaId);
      if (!url) throw new Error('The recording is no longer on this device.');
      setReading(0);
      try {
        const result = await readRecording(target, url, { signal: controller.signal, onProgress: (f) => setReading(f) });
        if (controller.signal.aborted) return;
        const current = filmRef.current;
        if (!current || current.id !== target.id) return;
        const next = { ...withAnalysis(current, result.moments, result.activity), strip: result.thumbs };
        filmRef.current = next;
        setFilm(next);
        setThumbs(result.thumbs);
        await saveFilm(next);
      } finally {
        if (readAbort.current === controller) {
          readAbort.current = null;
          setReading(null);
        }
      }
    },
    []
  );

  const open = useCallback(
    async (target: Film) => {
      if (!player) return;
      readAbort.current?.abort();
      history.clear();
      setSelectedId(null);
      filmRef.current = target;
      setFilm(target);
      setThumbs(target.strip ?? []);
      const url = await getMediaUrl(target.source.mediaId);
      if (!url) {
        toast({ title: 'That recording is no longer on this device', description: 'Add the recording again to make a new video.' });
        setFilm(null);
        return;
      }
      player.setTiming({ trimStart: target.trim.start, trimEnd: target.trim.end, duration: filmDuration(target) });
      try {
        await player.load(url);
      } catch (error) {
        toast({ title: "This recording can't be played here", description: error instanceof Error ? error.message : 'Try an MP4 file.' });
        return;
      }
      if (target.analysisVersion < ANALYSIS_VERSION || !target.strip?.length) {
        try {
          await read(target);
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') return;
          console.error('Director could not read the recording', error);
          toast({ title: "Director couldn't read the recording", description: error instanceof Error ? error.message : 'Try another recording.' });
          return;
        }
      }
      void player.play();
    },
    [player, history, read, toast]
  );

  const start = useCallback(
    async (source: FilmSource) => {
      const made = newFilm(source, { projectId: project?.id ?? null, title: project?.appName ?? '', colors: project?.colors ?? null });
      if (source.duration > MAX_FILM_SECONDS) {
        toast({ title: `Director uses the first ${MAX_FILM_SECONDS} seconds`, description: 'Trim the recording to pick another part.' });
      }
      await saveFilm(made);
      setFilms((list) => [made, ...list]);
      await open(made);
    },
    [project, open, toast]
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
        await start({ mediaId: id, name: file.name, width: probe.width, height: probe.height, duration: probe.duration });
      } catch (error) {
        toast({ title: "That recording couldn't be read", description: error instanceof Error ? error.message : 'Use an MP4 or MOV file.' });
      }
    },
    [start, toast]
  );

  const useRecording = useCallback(
    async (recording: DirectorRecording) => {
      const asset = await getMediaAsset(recording.mediaId);
      if (!asset) {
        toast({ title: 'That recording is no longer on this device', description: 'Add it to the project again.' });
        return;
      }
      await start({ mediaId: recording.mediaId, name: recording.name, width: asset.width ?? 886, height: asset.height ?? 1920, duration: asset.duration ?? 10 });
    },
    [start, toast]
  );

  const close = useCallback(() => {
    readAbort.current?.abort();
    player?.pause();
    setFilm(null);
    filmRef.current = null;
    setSelectedId(null);
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

  // Space plays, Delete removes the picked moment, Cmd+Z and Cmd+Shift+Z undo and redo.
  useEffect(() => {
    if (!active || !film) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === ' ' && !mod) {
        event.preventDefault();
        void player?.toggle();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        update((f) => removeMoment(f, selectedId));
        setSelectedId(null);
      } else if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        const current = filmRef.current;
        if (!current) return;
        const next = event.shiftKey ? history.redo(current) : history.undo(current);
        if (next) {
          filmRef.current = next;
          setFilm(next);
          persist(next);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, film, player, selectedId, update, history, persist]);

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

  const selected = film && selectedId ? film.moments.find((m) => m.id === selectedId) ?? null : null;
  const busy = reading !== null ? `Finding the moments in your recording, ${Math.round(reading * 100)}%` : null;

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = Array.from(event.dataTransfer.files).find((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    if (file) void addFile(file);
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
          if (file) void addFile(file);
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
              onChange={(e) => update((f) => ({ ...f, name: e.target.value }))}
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
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Undo" title="Undo" disabled={history.past.length === 0} onClick={() => {
                const next = filmRef.current && history.undo(filmRef.current);
                if (next) {
                  filmRef.current = next;
                  setFilm(next);
                  persist(next);
                }
              }}>
                <Undo2Icon className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Redo" title="Redo" disabled={history.future.length === 0} onClick={() => {
                const next = filmRef.current && history.redo(filmRef.current);
                if (next) {
                  filmRef.current = next;
                  setFilm(next);
                  persist(next);
                }
              }}>
                <Redo2Icon className="h-4 w-4" />
              </Button>
              <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => setExportOpen(true)} disabled={reading !== null} title={reading !== null ? 'Wait until the recording has been read' : undefined} data-testid="director-export">
                {exporting ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <DownloadIcon className="h-3.5 w-3.5" />}
                Export video
              </Button>
            </>
          )}
          {!film && (
            <Button type="button" size="sm" className="h-8 gap-1.5" onClick={() => fileRef.current?.click()}>
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
          <StartScreen
            project={project}
            films={films}
            dragging={dragging}
            onChoose={() => fileRef.current?.click()}
            onUseRecording={(recording) => void useRecording(recording)}
            onOpenFilm={(f) => void open(f)}
            onDeleteFilm={(f) => void remove(f)}
          />
        </div>
      ) : (
        // On a phone, one column that scrolls: the picture, the timeline, then the panel.
        <div className="min-h-0 flex-1 overflow-y-auto md:flex md:flex-row md:overflow-hidden" data-testid="director-film">
          <div className="flex min-w-0 flex-col md:min-h-0 md:flex-1">
            <div className="h-[56svh] min-h-[18rem] p-3 sm:p-5 md:h-auto md:flex-1">
              <DirectorViewport film={film} plan={plan} player={player} active={active} live={live} busy={busy} onError={(message) => toast({ title: "The 3D picture couldn't start", description: message })} />
            </div>
            <div className="border-t">
              <DirectorTimeline
                film={film}
                plan={plan}
                player={player}
                thumbs={thumbs}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onRetime={(id, start, end) => update((f) => editMoment(f, id, { start, end }))}
              />
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-xs text-muted-foreground">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1"
                  onClick={() => {
                    const { film: next, id } = addMoment(film, Math.min(player.time, trimLength(film) - 0.6));
                    update(() => next);
                    setSelectedId(id);
                  }}
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add a close-up here
                </Button>
                <span>
                  {film.moments.length === 0 && reading === null ? 'No moments found yet. Add a close-up where something happens.' : `${film.moments.length} moments. Click one to change it`}
                </span>
              </div>
            </div>
          </div>
          <aside className="w-full border-t md:min-h-0 md:w-80 md:shrink-0 md:overflow-y-auto md:border-l md:border-t-0">
            <DirectorInspector
              film={film}
              player={player}
              selected={selected}
              brandColors={project?.colors ?? null}
              live={live}
              getToken={() => getToken?.() ?? null}
              onSignIn={onSignIn}
              onLiveChange={() => player.requestDraw()}
              update={update}
              editMoment={(id, patch: Partial<Moment>) => update((f) => editMoment(f, id, patch))}
              removeMoment={(id) => {
                update((f) => removeMoment(f, id));
                setSelectedId(null);
              }}
            />
          </aside>
        </div>
      )}
      {film && <ExportDialog film={film} open={exportOpen} onOpenChange={setExportOpen} onExporting={setExporting} />}
    </div>
  );
}
