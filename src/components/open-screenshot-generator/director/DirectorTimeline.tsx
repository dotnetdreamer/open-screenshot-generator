"use client";

// The film's timeline, an editor of its own: a toolbar, a ruler, then four
// tracks.
//  - Screen: the clips, each a part of one recording, drawn as a strip of its
//    pictures. Drag a clip to move it among the others; drag its ends to show
//    more or less of its recording.
//  - Camera: how close the camera is over time, and the stretch a take made
//    by hand covers.
//  - Moments: what the director found, as pills. Drag one to move it, or its
//    ends to make it longer or shorter.
//  - Words: the title, the captions and the end words, where they show.
// The toolbar splits a clip, changes the recording from the playhead on,
// adds recordings and close-ups, deletes what's picked, and zooms (also with
// Ctrl or Cmd and the scroll wheel). The playhead moves in its own animation
// frame, from the player, so a playing film doesn't redraw the timeline sixty
// times a second, and the strip draws only the part of the film in view.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FilmIcon,
  HandIcon,
  KeyboardIcon,
  MinusIcon,
  MoveVerticalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  ScissorsIcon,
  SmartphoneIcon,
  SparklesIcon,
  Trash2Icon,
  TypeIcon,
  VideoIcon,
  ZoomInIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { FilmPlayer } from '@/lib/director/player';
import { plannedPose } from '@/lib/director/plan';
import { MOMENT_WORDS } from '@/lib/director/film';
import { bodyLength, clipSpans, cutTimes, filmMoments, MIN_SPLIT_SIDE, sourceTime, spanAt, trimClip, type ClipSpan } from '@/lib/director/timeline';
import type { Film, FilmPlan, Moment, MomentKind } from '@/lib/director/types';
import { cn } from '@/lib/utils';
import { plainWords } from '@/lib/director/overlay';

const KIND_ICON: Record<MomentKind, React.ComponentType<{ className?: string }>> = {
  tap: HandIcon,
  type: KeyboardIcon,
  scroll: MoveVerticalIcon,
  screen: SmartphoneIcon,
  change: SparklesIcon,
  still: PauseIcon,
};

export type TimelineSelection = { kind: 'clip'; id: string } | { kind: 'moment'; id: string } | null;

/** The moments the plan gives a close-up, read from its keys. */
export function closeUpIds(plan: FilmPlan): Set<string> {
  const ids = new Set<string>();
  for (const key of plan.keys) {
    const match = /^(?:close on|pan to) (\S+)$/.exec(key.why ?? '');
    if (match) ids.add(match[1]);
  }
  return ids;
}

export function formatTime(t: number, tenths = true): string {
  const safe = Math.max(0, t);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  const s = tenths ? seconds.toFixed(1).padStart(4, '0') : String(Math.floor(seconds)).padStart(2, '0');
  return `${minutes}:${s}`;
}

function rulerLabel(t: number): string {
  return t < 60 ? `${Math.round(t)}s` : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
}

/** Pictures for the strip, kept across renders; `onLoad` asks for a redraw when one arrives. */
function useImageCache(onLoad: () => void) {
  const cache = useRef(new Map<string, HTMLImageElement>());
  const loadRef = useRef(onLoad);
  loadRef.current = onLoad;
  return useCallback((url: string): HTMLImageElement | null => {
    let img = cache.current.get(url);
    if (!img) {
      img = new Image();
      img.onload = () => loadRef.current();
      img.src = url;
      cache.current.set(url, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }, []);
}

const SNAP_PX = 8;
/** The narrowest a moment's pill is drawn, and the height of a row of them. */
const MIN_PILL = 28;
const ROW_H = 26;
/** The size of a found moment's marker. */
const MARKER = 18;

type Drag =
  | { kind: 'moment'; id: string; mode: 'move' | 'start' | 'end'; x: number; start: number; end: number }
  | { kind: 'trim'; clipId: string; side: 'in' | 'out'; x: number; from: number }
  | { kind: 'press'; clipId: string; x: number; t: number }
  | { kind: 'reorder'; clipId: string; x: number; t: number };

export interface DirectorTimelineProps {
  film: Film;
  plan: FilmPlan;
  player: FilmPlayer;
  selection: TimelineSelection;
  onSelect: (selection: TimelineSelection) => void;
  /** The clip being read for its moments, and how far it got. */
  reading: { clipId: string; fraction: number } | null;
  onRetimeMoment: (id: string, start: number, end: number) => void;
  onTrimClip: (clipId: string, patch: { in?: number; out?: number }) => void;
  onMoveClip: (clipId: string, toIndex: number) => void;
  onSplit: () => void;
  onChangeFrom: () => void;
  onAddRecording: () => void;
  onAddCloseUp: () => void;
  onDeleteSelected: () => void;
}

export function DirectorTimeline({
  film,
  plan,
  player,
  selection,
  onSelect,
  reading,
  onRetimeMoment,
  onTrimClip,
  onMoveClip,
  onSplit,
  onChangeFrom,
  onAddRecording,
  onAddCloseUp,
  onDeleteSelected,
}: DirectorTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<{ momentId?: string; start?: number; end?: number; clipPatch?: { clipId: string; in?: number; out?: number }; dropIndex?: number } | null>(null);
  const [now, setNow] = useState({ t: player.time, playing: player.isPlaying });
  const [redraw, setRedraw] = useState(0);
  const image = useImageCache(() => setRedraw((n) => n + 1));

  const duration = plan.duration;
  const pps = viewW > 0 ? (viewW / Math.max(1, duration)) * zoom : 0;
  const contentW = Math.max(viewW, Math.ceil(duration * pps));

  // While a clip's end is dragged, everything is drawn from the film as it would be.
  const shownFilm = useMemo(() => (preview?.clipPatch ? trimClip(film, preview.clipPatch.clipId, preview.clipPatch) : film), [film, preview?.clipPatch]);
  const spans = useMemo(() => clipSpans(shownFilm), [shownFilm]);
  const body = bodyLength(shownFilm);
  // A pause (nothing happening) still steers the camera, but isn't worth a pill.
  const moments = useMemo(() => filmMoments(film).filter((m) => m.kind !== 'still' || m.edited || m.shot !== 'auto'), [film]);
  const cuts = useMemo(() => cutTimes(film), [film]);
  const closes = useMemo(() => closeUpIds(plan), [plan]);

  // What the camera does gets a pill: the close-ups, and every moment the
  // user changed or captioned. Everything else Director found is a small
  // marker on a line of its own, so a busy stretch never becomes a pile.
  const featured = useCallback((m: Moment) => closes.has(m.id) || !!m.edited || m.shot !== 'auto' || !!m.caption?.trim(), [closes]);
  const rows = useMemo(() => {
    const edges: number[] = [];
    const row = new Map<string, number>();
    for (const m of moments) {
      if (!featured(m)) continue;
      const left = m.start * pps;
      const right = left + Math.max(MIN_PILL, (m.end - m.start) * pps) + 2;
      let r = edges.findIndex((edge) => edge <= left);
      if (r < 0 && edges.length < 2) r = edges.length;
      if (r < 0) r = edges.indexOf(Math.min(...edges));
      edges[r] = right;
      row.set(m.id, r);
    }
    return { row, count: Math.max(1, edges.length) };
  }, [moments, pps, featured]);
  const pillsHeight = rows.count * ROW_H + (rows.count - 1) * 2;
  const momentsHeight = pillsHeight + 4 + MARKER;

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewW(scroller.clientWidth));
    observer.observe(scroller);
    setViewW(scroller.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Time for the toolbar, ten times a second.
  useEffect(() => player.subscribe(() => setNow({ t: player.time, playing: player.isPlaying })), [player]);

  // The strip: each clip's pictures and how much changes in it, for the part in view only.
  useEffect(() => {
    const canvas = stripRef.current;
    if (!canvas || !viewW || !pps) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const h = canvas.clientHeight;
    canvas.width = Math.round(viewW * ratio);
    canvas.height = Math.round(h * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, viewW, h);
    const left = scrollLeft;
    const right = scrollLeft + viewW;
    for (const span of spans) {
      const x0 = span.start * pps;
      const x1 = span.end * pps;
      if (x1 < left || x0 > right) continue;
      const clip = span.clip;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - left + 1, 0, Math.max(0, x1 - x0 - 2), h);
      ctx.clip();
      const thumbs = clip.strip ?? [];
      const sample = thumbs.length ? image(thumbs[0].url) : null;
      const tileW = Math.max(8, (h * (sample?.naturalWidth || clip.width || 9)) / (sample?.naturalHeight || clip.height || 16));
      if (thumbs.length) {
        // Tiles line up with the clip's start, and only the ones in view are drawn.
        const first = x0 + Math.floor(Math.max(0, left - x0) / tileW) * tileW;
        for (let x = first; x < Math.min(x1, right); x += tileW) {
          const s = clip.in + ((x + tileW / 2) / pps - span.start);
          let best = 0;
          for (let i = 1; i < thumbs.length; i++) if (Math.abs(thumbs[i].t - s) < Math.abs(thumbs[best].t - s)) best = i;
          const img = image(thumbs[best].url);
          if (img) ctx.drawImage(img, x - left, 0, tileW, h);
        }
      } else {
        ctx.fillStyle = 'rgba(120, 120, 140, 0.18)';
        ctx.fillRect(x0 - left, 0, x1 - x0, h);
      }
      const activity = clip.activity;
      if (activity && activity.values.length) {
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.55)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.05)');
        ctx.beginPath();
        ctx.moveTo(x0 - left, h);
        const from = activity.start ?? 0;
        activity.values.forEach((v, i) => {
          const s = from + (i + 0.5) * activity.step;
          if (s < clip.in || s > clip.out) return;
          ctx.lineTo((span.start + (s - clip.in)) * pps - left, h - v * h * 0.85);
        });
        ctx.lineTo(x1 - left, h);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
      }
      ctx.restore();
    }
  }, [spans, viewW, pps, scrollLeft, image, redraw]);

  // The camera lane: how close the camera is over time.
  const cameraPath = useMemo(() => {
    if (!contentW || !pps) return '';
    const points: string[] = [];
    const steps = Math.min(600, Math.max(40, Math.round(contentW / 4)));
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * duration;
      const z = plannedPose(plan, t).zoom;
      const y = 23 - Math.min(1, Math.max(0, (z - 0.8) / 1.6)) * 20;
      points.push(`${(t * pps).toFixed(1)},${y.toFixed(1)}`);
    }
    return `M0,24 L${points.join(' L')} L${(duration * pps).toFixed(1)},24 Z`;
  }, [plan, duration, pps, contentW]);

  // The playhead, moved every frame while the film plays, and kept in view.
  useEffect(() => {
    let raf = 0;
    const place = () => {
      const head = headRef.current;
      if (!head || !pps) return;
      const x = player.time * pps;
      head.style.transform = `translateX(${x}px)`;
      const scroller = scrollRef.current;
      if (scroller && player.isPlaying && zoom > 1) {
        if (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollLeft = Math.max(0, x - scroller.clientWidth * 0.2);
      }
    };
    const loop = () => {
      place();
      if (player.isPlaying) raf = requestAnimationFrame(loop);
    };
    const unsubscribe = player.subscribe(() => {
      cancelAnimationFrame(raf);
      loop();
    });
    place();
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [player, pps, zoom]);

  // Ctrl or Cmd and the wheel zooms around the pointer.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = scroller.getBoundingClientRect();
      const pointer = event.clientX - rect.left;
      setZoom((current) => {
        const next = Math.min(12, Math.max(1, current * Math.exp(-event.deltaY * 0.0025)));
        const t = (scroller.scrollLeft + pointer) / Math.max(1, (scroller.clientWidth / Math.max(1, duration)) * current);
        requestAnimationFrame(() => {
          scroller.scrollLeft = Math.max(0, t * (scroller.clientWidth / Math.max(1, duration)) * next - pointer);
        });
        return next;
      });
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [duration]);

  const timeAt = (clientX: number) => {
    const rect = contentRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, (clientX - rect.left) / Math.max(1e-6, pps)));
  };

  /** `t` pulled onto the playhead or a cut when it's within a few pixels of one. */
  const snap = (t: number, except?: number) => {
    const targets = [player.time, 0, ...cuts, bodyLength(film)];
    let best = t;
    let bestD = SNAP_PX / Math.max(1e-6, pps);
    for (const target of targets) {
      if (except !== undefined && Math.abs(target - except) < 1e-6) continue;
      const d = Math.abs(target - t);
      if (d < bestD) {
        bestD = d;
        best = target;
      }
    }
    return best;
  };

  const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    void player.seek(timeAt(event.clientX));
  };

  // ---- moments
  const startMomentDrag = (event: React.PointerEvent, moment: Moment, mode: 'move' | 'start' | 'end') => {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    onSelect({ kind: 'moment', id: moment.id });
    setDrag({ kind: 'moment', id: moment.id, mode, x: event.clientX, start: moment.start, end: moment.end });
  };

  // ---- clips
  const startClipPress = (event: React.PointerEvent, span: ClipSpan) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({ kind: 'press', clipId: span.clip.id, x: event.clientX, t: timeAt(event.clientX) });
  };

  const startTrim = (event: React.PointerEvent, span: ClipSpan, side: 'in' | 'out') => {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    onSelect({ kind: 'clip', id: span.clip.id });
    setDrag({ kind: 'trim', clipId: span.clip.id, side, x: event.clientX, from: side === 'in' ? span.clip.in : span.clip.out });
  };

  const dropIndexAt = (t: number, clipId: string) => {
    const others = clipSpans(film).filter((s) => s.clip.id !== clipId);
    let index = 0;
    let at = 0;
    for (const span of others) {
      const length = span.end - span.start;
      if (t > at + length / 2) index += 1;
      at += length;
    }
    return index;
  };

  const onMove = (event: React.PointerEvent) => {
    if (!drag || !pps) return;
    const dt = (event.clientX - drag.x) / pps;
    if (drag.kind === 'moment') {
      let { start, end } = drag;
      if (drag.mode === 'move') {
        const span = end - start;
        start = snap(Math.min(Math.max(0, start + dt), Math.max(0, body - span)));
        end = start + span;
      } else if (drag.mode === 'start') {
        start = snap(Math.min(Math.max(0, start + dt), end - 0.2));
      } else {
        end = snap(Math.max(Math.min(body, end + dt), start + 0.2));
      }
      setPreview({ momentId: drag.id, start, end });
    } else if (drag.kind === 'trim') {
      setPreview({ clipPatch: { clipId: drag.clipId, [drag.side]: Math.max(0, drag.from + dt) } });
    } else if (drag.kind === 'press') {
      if (Math.abs(event.clientX - drag.x) > 6 && film.clips.length > 1) setDrag({ ...drag, kind: 'reorder' });
    } else if (drag.kind === 'reorder') {
      setPreview({ dropIndex: dropIndexAt(timeAt(event.clientX), drag.clipId) });
    }
  };

  const onUp = (event: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'moment') {
      if (preview?.momentId === drag.id && preview.start !== undefined && preview.end !== undefined && (preview.start !== drag.start || preview.end !== drag.end)) {
        onRetimeMoment(drag.id, preview.start, preview.end);
        void player.seek(preview.start);
      } else {
        void player.seek(drag.start);
      }
    } else if (drag.kind === 'trim') {
      if (preview?.clipPatch) onTrimClip(drag.clipId, preview.clipPatch);
    } else if (drag.kind === 'press') {
      onSelect({ kind: 'clip', id: drag.clipId });
      void player.seek(timeAt(event.clientX));
    } else if (drag.kind === 'reorder') {
      if (preview?.dropIndex !== undefined) onMoveClip(drag.clipId, preview.dropIndex);
      onSelect({ kind: 'clip', id: drag.clipId });
    }
    setDrag(null);
    setPreview(null);
  };

  const step = (() => {
    const visible = viewW / Math.max(1e-6, pps);
    const targets = [0.5, 1, 2, 5, 10, 15, 30, 60];
    return targets.find((s) => visible / s <= 14) ?? 60;
  })();
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(Math.round(t * 100) / 100);

  const nowSpan = spanAt(film, now.t);
  const canSplit = !!nowSpan && now.t - nowSpan.start >= MIN_SPLIT_SIDE && nowSpan.end - now.t >= MIN_SPLIT_SIDE && now.t < bodyLength(film);
  const take = film.take && film.take.samples.length > 1 ? film.take : null;
  const takeEnd = take ? take.samples[take.samples.length - 1].t : 0;
  const reorderLine = drag?.kind === 'reorder' && preview?.dropIndex !== undefined ? (() => {
    const others = clipSpans(film).filter((s) => s.clip.id !== drag.clipId);
    const at = others.slice(0, preview.dropIndex).reduce((sum, s) => sum + (s.end - s.start), 0);
    return at * pps;
  })() : null;

  const trackLabel = (Icon: React.ComponentType<{ className?: string }>, text: string, height: string) => (
    <div className={cn('flex items-center gap-1.5 pl-2.5 text-[11px] font-medium text-muted-foreground sm:pl-3', height)}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden truncate sm:inline">{text}</span>
    </div>
  );

  return (
    <div className="select-none pb-2" data-testid="director-timeline">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5 sm:px-3" role="toolbar" aria-label="Timeline">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={now.playing ? 'Pause the film' : 'Play the film'} title={now.playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => void player.toggle()}>
          {now.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
        </Button>
        <span className="min-w-[6.5rem] px-1 font-mono text-xs tabular-nums text-muted-foreground" data-testid="director-time">
          {formatTime(now.t)} / {formatTime(duration)}
        </span>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={onSplit} disabled={!canSplit} title="Split the recording at the playhead (S)" data-testid="director-split">
          <ScissorsIcon className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Split</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={onChangeFrom} title="Show another recording from the playhead on" data-testid="director-change-from">
          <RepeatIcon className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{film.clips.length ? 'Change recording here' : 'Add recording'}</span>
        </Button>
        {film.clips.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={onAddRecording} title="Add a recording after the others" data-testid="director-add-recording">
            <FilmIcon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Add recording</span>
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2" onClick={onAddCloseUp} disabled={!film.clips.length} title={film.clips.length ? 'Add a close-up at the playhead' : 'Add a recording first'} data-testid="director-add-closeup">
          <ZoomInIcon className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Close-up here</span>
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onDeleteSelected} disabled={!selection} aria-label="Delete what's picked" title="Delete what's picked (Delete)" data-testid="director-delete-selected">
          <Trash2Icon className="h-3.5 w-3.5" />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} disabled={zoom <= 1}>
            <MinusIcon className="h-3.5 w-3.5" />
          </Button>
          <Slider className="w-16 sm:w-24" min={1} max={12} step={0.1} value={[zoom]} onValueChange={([z]) => setZoom(z)} aria-label="Timeline zoom" />
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Zoom in" title="Zoom in (Ctrl or Cmd and scroll)" onClick={() => setZoom((z) => Math.min(12, z * 1.5))} disabled={zoom >= 12}>
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex">
        {/* Track names */}
        <div className="w-9 shrink-0 border-r pt-5 sm:w-[88px]" aria-hidden>
          {trackLabel(VideoIcon, 'Screen', 'h-14')}
          {trackLabel(SmartphoneIcon, 'Camera', 'mt-1.5 h-7')}
          <div style={{ height: momentsHeight }} className="mt-1.5">
            {trackLabel(HandIcon, 'Moments', 'h-[26px]')}
          </div>
          {trackLabel(TypeIcon, 'Words', 'mt-1.5 h-6')}
        </div>

        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden" onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
          <div ref={contentRef} className="relative pr-6" style={{ width: contentW }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {/* Ruler */}
            <div
              className="relative h-5 cursor-pointer text-[10px] text-muted-foreground touch-none"
              onPointerDown={scrub}
              onPointerMove={(e) => e.buttons === 1 && !drag && void player.seek(timeAt(e.clientX))}
              role="slider"
              aria-label="Move through the film"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 10) / 10}
              aria-valuenow={Math.round(now.t * 10) / 10}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') void player.seek(player.time + (e.shiftKey ? 1 : 1 / 30));
                if (e.key === 'ArrowLeft') void player.seek(player.time - (e.shiftKey ? 1 : 1 / 30));
              }}
            >
              {ticks.map((t) => (
                <span key={t} className="absolute top-0.5 flex -translate-x-px items-center gap-1 tabular-nums" style={{ left: t * pps }}>
                  <span className="h-2 w-px bg-border" />
                  {rulerLabel(t)}
                </span>
              ))}
            </div>

            {/* Screen: the clips */}
            <div className="relative h-14 overflow-hidden rounded-md bg-muted/60">
              <canvas ref={stripRef} className="pointer-events-none absolute top-0 h-full" style={{ left: scrollLeft, width: viewW }} />
              {film.clips.length === 0 && (
                <button
                  type="button"
                  onClick={onAddRecording}
                  className="absolute inset-y-1 left-1 flex items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary/40 bg-background/60 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
                  style={{ width: Math.max(80, body * pps - 8) }}
                  data-testid="director-add-first-recording"
                >
                  <PlusIcon className="h-4 w-4" />
                  Add your recording
                </button>
              )}
              {spans.map((span) => {
                const selected = selection?.kind === 'clip' && selection.id === span.clip.id;
                const w = (span.end - span.start) * pps;
                const isReading = reading?.clipId === span.clip.id;
                const dragging = drag?.kind === 'reorder' && drag.clipId === span.clip.id;
                return (
                  <div
                    key={span.clip.id}
                    className={cn(
                      'group absolute inset-y-0 cursor-pointer touch-none rounded-md border-2 transition-[box-shadow,opacity]',
                      selected ? 'border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.25)]' : 'border-background/80 hover:border-primary/50',
                      dragging && 'opacity-60'
                    )}
                    style={{ left: span.start * pps, width: Math.max(4, w) }}
                    onPointerDown={(e) => startClipPress(e, span)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelect({ kind: 'clip', id: span.clip.id });
                        void player.seek(span.start);
                      }
                    }}
                    data-testid="director-clip"
                    data-clip-id={span.clip.id}
                    aria-label={`${span.clip.name}, ${formatTime(span.end - span.start)} long`}
                  >
                    {w > 56 && (
                      <span className="pointer-events-none absolute left-1 top-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                        {span.clip.name.replace(/\.[a-z0-9]{2,4}$/i, '')}
                      </span>
                    )}
                    {w > 90 && (
                      <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/55 px-1 py-0.5 font-mono text-[9px] text-white/90">{formatTime(span.end - span.start)}</span>
                    )}
                    {isReading && (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-black/30">
                        <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(reading!.fraction * 100)}%` }} />
                      </span>
                    )}
                    {/* Trim handles */}
                    <span
                      className={cn('absolute inset-y-0 -left-0.5 w-2.5 cursor-ew-resize rounded-l-md bg-primary/80 opacity-0 transition-opacity group-hover:opacity-100', selected && 'opacity-100')}
                      onPointerDown={(e) => startTrim(e, span, 'in')}
                      aria-hidden
                      data-testid="director-clip-trim-in"
                    />
                    <span
                      className={cn('absolute inset-y-0 -right-0.5 w-2.5 cursor-ew-resize rounded-r-md bg-primary/80 opacity-0 transition-opacity group-hover:opacity-100', selected && 'opacity-100')}
                      onPointerDown={(e) => startTrim(e, span, 'out')}
                      aria-hidden
                      data-testid="director-clip-trim-out"
                    />
                  </div>
                );
              })}
              {reorderLine !== null && <div className="pointer-events-none absolute inset-y-0 z-10 w-1 -translate-x-1/2 rounded-full bg-primary" style={{ left: reorderLine }} />}
              {/* The end hold: the last picture stays while the phone turns to face the viewer. */}
              {duration - body > 0.05 && (
                <div
                  className="absolute inset-y-0 flex items-center justify-center rounded-md bg-[repeating-linear-gradient(135deg,hsl(var(--muted))_0_6px,hsl(var(--background))_6px_12px)] text-[10px] font-medium text-muted-foreground"
                  style={{ left: body * pps, width: (duration - body) * pps }}
                >
                  {(duration - body) * pps > 40 ? 'End' : ''}
                </div>
              )}
              {drag?.kind === 'trim' && preview?.clipPatch && (() => {
                const span = spans.find((s) => s.clip.id === drag.clipId);
                if (!span) return null;
                const x = drag.side === 'in' ? span.start * pps : span.end * pps;
                const s = drag.side === 'in' ? span.clip.in : span.clip.out;
                return (
                  <span className="pointer-events-none absolute -top-0.5 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background" style={{ left: x }}>
                    {drag.side === 'in' ? 'Starts' : 'Ends'} {formatTime(s)} into the recording
                  </span>
                );
              })()}
            </div>

            {/* Camera */}
            <div className="relative mt-1.5 h-7">
              <svg className="absolute inset-0 h-full" style={{ width: duration * pps }} viewBox={`0 0 ${Math.max(1, duration * pps)} 24`} preserveAspectRatio="none" aria-hidden>
                <path d={cameraPath} className="fill-primary/20 stroke-primary/80" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              </svg>
              {take && (
                <div
                  className={cn(
                    'absolute top-0.5 flex h-6 items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[10px] font-medium',
                    film.motion === 'hand' ? 'border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'border-dashed border-muted-foreground/40 text-muted-foreground'
                  )}
                  style={{ left: take.samples[0].t * pps, width: Math.max(24, (Math.min(takeEnd, duration) - take.samples[0].t) * pps) }}
                  title={film.motion === 'hand' ? 'Your moves turn the phone here' : 'Your moves, turned off'}
                  data-testid="director-take-band"
                >
                  <HandIcon className="h-3 w-3 shrink-0" />
                  {(takeEnd - take.samples[0].t) * pps > 80 && <span className="truncate">{film.motion === 'hand' ? 'Your moves' : 'Your moves, off'}</span>}
                </div>
              )}
            </div>

            {/* Moments: pills for what the camera does, markers for the rest */}
            <div className="relative mt-1.5" style={{ height: momentsHeight }}>
              <div className="absolute inset-x-0 h-px bg-border" style={{ top: pillsHeight + 4 + MARKER / 2 }} aria-hidden />
              {moments.map((moment) => {
                const shown = preview?.momentId === moment.id && preview.start !== undefined ? { ...moment, start: preview.start, end: preview.end! } : moment;
                const Icon = KIND_ICON[moment.kind];
                const close = closes.has(moment.id);
                const skipped = moment.shot === 'skip';
                const left = shown.start * pps;
                const picked = selection?.kind === 'moment' && selection.id === moment.id;
                const label = `${MOMENT_WORDS[moment.kind]} at ${shown.start.toFixed(1)} seconds${close ? ', close-up' : ''}${skipped ? ', left out' : ''}`;
                const onKey = (e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect({ kind: 'moment', id: moment.id });
                    void player.seek(moment.start);
                  }
                };
                if (!featured(moment)) {
                  return (
                    <button
                      key={moment.id}
                      type="button"
                      className={cn(
                        'absolute flex -translate-x-1/2 cursor-grab items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:border-primary/60 hover:text-foreground touch-none active:cursor-grabbing',
                        picked && 'border-primary text-foreground ring-2 ring-primary/40'
                      )}
                      style={{ left: left + MARKER / 2, top: pillsHeight + 4, width: MARKER, height: MARKER }}
                      title={label}
                      aria-label={label}
                      aria-pressed={picked}
                      onPointerDown={(e) => startMomentDrag(e, moment, 'move')}
                      onKeyDown={onKey}
                      data-testid="director-moment"
                      data-moment-id={moment.id}
                      data-close="false"
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </button>
                  );
                }
                const w = Math.max(MIN_PILL, (shown.end - shown.start) * pps);
                const top = (rows.row.get(moment.id) ?? 0) * (ROW_H + 2);
                return (
                  <div
                    key={moment.id}
                    className={cn(
                      'absolute flex items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[11px] font-medium shadow-sm touch-none',
                      close ? 'border-primary/50 bg-primary/15 text-foreground' : 'border-border bg-background text-muted-foreground',
                      skipped && 'opacity-50',
                      picked && 'ring-2 ring-primary'
                    )}
                    style={{ left, width: w, top, height: ROW_H }}
                    data-testid="director-moment"
                    data-moment-id={moment.id}
                    data-close={close ? 'true' : 'false'}
                  >
                    <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => startMomentDrag(e, moment, 'start')} aria-hidden />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 cursor-grab items-center gap-1 focus-visible:outline-none active:cursor-grabbing"
                      aria-label={label}
                      aria-pressed={picked}
                      onPointerDown={(e) => startMomentDrag(e, moment, 'move')}
                      onKeyDown={onKey}
                    >
                      {close ? <ZoomInIcon className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Icon className="h-3.5 w-3.5 shrink-0" />}
                      {w > 64 && <span className={cn('truncate', skipped && 'line-through')}>{plainWords(moment.caption?.trim() ?? '') || MOMENT_WORDS[moment.kind]}</span>}
                    </button>
                    <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => startMomentDrag(e, moment, 'end')} aria-hidden />
                  </div>
                );
              })}
            </div>

            {/* Words */}
            <div className="relative mt-1.5 h-6">
              {plan.cues.map((cue, index) => (
                <button
                  type="button"
                  key={`${cue.role}-${index}`}
                  className={cn(
                    'absolute top-0 flex h-6 items-center overflow-hidden rounded-md px-1.5 text-[10px] font-medium',
                    cue.role === 'title' && 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
                    cue.role === 'caption' && 'bg-muted text-foreground/80',
                    cue.role === 'end' && 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300'
                  )}
                  style={{ left: cue.start * pps, width: Math.max(20, (cue.end - cue.start) * pps) }}
                  onClick={() => void player.seek(cue.start)}
                  title={plainWords(cue.text)}
                >
                  <span className="truncate">{plainWords(cue.text)}</span>
                </button>
              ))}
            </div>

            {/* Cuts, through every track */}
            {cuts.map((cut) => (
              <div key={cut} className="pointer-events-none absolute bottom-0 top-5 w-px bg-foreground/25" style={{ left: cut * pps }} aria-hidden />
            ))}

            {/* Playhead */}
            <div ref={headRef} className="pointer-events-none absolute inset-y-0 left-0 z-10 w-0" aria-hidden>
              <div className="absolute -left-px top-3 bottom-0 w-0.5 rounded-full bg-primary shadow-[0_0_0_1px_hsl(var(--background))]" />
              <div className="absolute -left-[5px] top-2.5 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-primary" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Film time `t` in a clip, in that clip's recording seconds: for the inspector's readouts. */
export function recordingSecondsAt(film: Film, t: number): number | null {
  const span = spanAt(film, t);
  return span ? sourceTime(span, t) : null;
}
