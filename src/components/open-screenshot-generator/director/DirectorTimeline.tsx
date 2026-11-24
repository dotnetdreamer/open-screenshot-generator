"use client";

// The film's timeline: a ruler, the recording as a strip of pictures with how
// much changes drawn over it, the camera (how close it is, over time), and the
// moments the director found as pills. Click or drag on the strip to move
// through the film; drag a pill to move its moment, or its ends to make it
// longer or shorter.
//
// The playhead moves in its own animation frame, from the player, so a
// playing film doesn't redraw the timeline sixty times a second.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HandIcon, KeyboardIcon, MoveVerticalIcon, PauseIcon, SmartphoneIcon, SparklesIcon, ZoomInIcon } from 'lucide-react';
import type { FilmPlayer } from '@/lib/director/player';
import { plannedPose } from '@/lib/director/plan';
import { MOMENT_WORDS } from '@/lib/director/film';
import type { Thumb } from '@/lib/director/sample';
import type { Film, FilmPlan, Moment, MomentKind } from '@/lib/director/types';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<MomentKind, React.ComponentType<{ className?: string }>> = {
  tap: HandIcon,
  type: KeyboardIcon,
  scroll: MoveVerticalIcon,
  screen: SmartphoneIcon,
  change: SparklesIcon,
  still: PauseIcon,
};

/** The moments the plan gives a close-up, read from its keys. */
export function closeUpIds(plan: FilmPlan): Set<string> {
  const ids = new Set<string>();
  for (const key of plan.keys) {
    const match = /^(?:close on|pan to) (m\d+)$/.exec(key.why ?? '');
    if (match) ids.add(match[1]);
  }
  return ids;
}

function formatSeconds(t: number): string {
  return t < 60 ? `${Math.floor(t)}s` : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

function useImages(thumbs: Thumb[]): HTMLImageElement[] {
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  useEffect(() => {
    let cancelled = false;
    const loaded = thumbs.map((thumb) => {
      const img = new Image();
      img.src = thumb.url;
      return img;
    });
    Promise.all(loaded.map((img) => img.decode().catch(() => undefined))).then(() => {
      if (!cancelled) setImages(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [thumbs]);
  return images;
}

interface Drag {
  id: string;
  mode: 'move' | 'start' | 'end';
  x: number;
  start: number;
  end: number;
}

export function DirectorTimeline({
  film,
  plan,
  player,
  thumbs,
  selectedId,
  onSelect,
  onRetime,
}: {
  film: Film;
  plan: FilmPlan;
  player: FilmPlayer;
  thumbs: Thumb[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRetime: (id: string, start: number, end: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; start: number; end: number } | null>(null);
  const duration = plan.duration;
  const recordingEnd = film.trim.end - film.trim.start;
  const pps = width > 0 ? width / duration : 0;
  const images = useImages(thumbs);
  const closes = useMemo(() => closeUpIds(plan), [plan]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => setWidth(track.clientWidth));
    observer.observe(track);
    setWidth(track.clientWidth);
    return () => observer.disconnect();
  }, []);

  // The strip: pictures from the recording, with the activity drawn over them.
  useEffect(() => {
    const canvas = stripRef.current;
    if (!canvas || !width) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const h = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(h * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, h);
    const endX = Math.min(width, recordingEnd * pps);
    if (images.length && thumbs.length) {
      const first = images[0];
      const tileW = Math.max(8, (h * (first.naturalWidth || 9)) / (first.naturalHeight || 16));
      for (let x = 0; x < endX; x += tileW) {
        const t = (x + tileW / 2) / pps;
        let best = 0;
        for (let i = 1; i < thumbs.length; i++) if (Math.abs(thumbs[i].t - t) < Math.abs(thumbs[best].t - t)) best = i;
        const img = images[best];
        if (img?.complete) ctx.drawImage(img, x, 0, Math.min(tileW, endX - x), h);
      }
    }
    const activity = film.activity;
    if (activity && activity.values.length) {
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, 'rgba(99, 102, 241, 0.55)');
      gradient.addColorStop(1, 'rgba(99, 102, 241, 0.05)');
      ctx.beginPath();
      ctx.moveTo(0, h);
      activity.values.forEach((v, i) => ctx.lineTo(Math.min(endX, (i + 0.5) * activity.step * pps), h - v * h * 0.9));
      ctx.lineTo(endX, h);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }, [images, thumbs, width, pps, film.activity, recordingEnd]);

  // The camera lane: how close the camera is over time.
  const cameraPath = useMemo(() => {
    if (!width) return '';
    const points: string[] = [];
    const steps = Math.min(400, Math.max(40, Math.round(width / 3)));
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * duration;
      const zoom = plannedPose(plan, t).zoom;
      const y = 18 - Math.min(1, Math.max(0, (zoom - 0.8) / 2.5)) * 15;
      points.push(`${((t / duration) * width).toFixed(1)},${y.toFixed(1)}`);
    }
    return `M0,20 L${points.join(' L')} L${width},20 Z`;
  }, [plan, duration, width]);

  // The playhead, moved every frame while the film plays.
  useEffect(() => {
    let raf = 0;
    const place = () => {
      const head = headRef.current;
      if (head && pps) head.style.transform = `translateX(${player.time * pps}px)`;
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
  }, [player, pps]);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, (clientX - rect.left) / Math.max(1, pps)));
  };

  const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(null);
    void player.seek(timeAt(event.clientX));
  };

  const startDrag = (event: React.PointerEvent, moment: Moment, mode: Drag['mode']) => {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    onSelect(moment.id);
    setDrag({ id: moment.id, mode, x: event.clientX, start: moment.start, end: moment.end });
  };

  const moveDrag = (event: React.PointerEvent) => {
    if (!drag || !pps) return;
    const dt = (event.clientX - drag.x) / pps;
    let { start, end } = drag;
    if (drag.mode === 'move') {
      const span = end - start;
      start = Math.min(Math.max(0, start + dt), Math.max(0, recordingEnd - span));
      end = start + span;
    } else if (drag.mode === 'start') {
      start = Math.min(Math.max(0, start + dt), end - 0.2);
    } else {
      end = Math.max(Math.min(recordingEnd, end + dt), start + 0.2);
    }
    setDragPreview({ id: drag.id, start, end });
  };

  const endDrag = () => {
    if (drag && dragPreview && (dragPreview.start !== drag.start || dragPreview.end !== drag.end)) {
      onRetime(drag.id, dragPreview.start, dragPreview.end);
      void player.seek(dragPreview.start);
    } else if (drag) {
      void player.seek(drag.start);
    }
    setDrag(null);
    setDragPreview(null);
  };

  const step = duration > 40 ? 5 : duration > 16 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  return (
    <div className="select-none px-4 pb-3 pt-2" data-testid="director-timeline">
      <div ref={trackRef} className="relative">
        {/* Ruler */}
        <div className="relative h-4 text-[10px] text-muted-foreground" onPointerDown={scrub} onPointerMove={(e) => e.buttons && void player.seek(timeAt(e.clientX))}>
          {ticks.map((t) => (
            <span key={t} className="absolute top-0 -translate-x-1/2 tabular-nums" style={{ left: t * pps }}>
              {formatSeconds(t)}
            </span>
          ))}
        </div>
        {/* The recording */}
        <div
          className="relative h-14 cursor-pointer overflow-hidden rounded-md bg-muted touch-none"
          onPointerDown={scrub}
          onPointerMove={(e) => e.buttons && void player.seek(timeAt(e.clientX))}
          aria-label="Move through the film"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 10) / 10}
          aria-valuenow={Math.round(player.time * 10) / 10}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') void player.seek(player.time + (e.shiftKey ? 1 : 1 / 30));
            if (e.key === 'ArrowLeft') void player.seek(player.time - (e.shiftKey ? 1 : 1 / 30));
          }}
        >
          <canvas ref={stripRef} className="absolute inset-0 h-full w-full" />
          {/* The end hold: the last picture stays while the phone turns to face the viewer. */}
          <div
            className="absolute inset-y-0 right-0 flex items-center justify-center bg-[repeating-linear-gradient(135deg,hsl(var(--muted))_0_6px,hsl(var(--background))_6px_12px)] text-[10px] font-medium text-muted-foreground"
            style={{ left: recordingEnd * pps }}
          >
            {(duration - recordingEnd) * pps > 40 ? 'End' : ''}
          </div>
        </div>
        {/* The camera */}
        <svg className="mt-1 block h-5 w-full" viewBox={`0 0 ${Math.max(1, width)} 20`} preserveAspectRatio="none" aria-hidden>
          <path d={cameraPath} className="fill-primary/15 stroke-primary/60" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        {/* The moments */}
        <div className="relative mt-1 h-8" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {film.moments.map((moment) => {
            const shown = dragPreview?.id === moment.id ? { ...moment, ...dragPreview } : moment;
            const Icon = KIND_ICON[moment.kind];
            const close = closes.has(moment.id);
            const skipped = moment.shot === 'skip';
            const left = shown.start * pps;
            const w = Math.max(30, (shown.end - shown.start) * pps);
            const selected = moment.id === selectedId;
            return (
              <div
                key={moment.id}
                className={cn(
                  'absolute top-0 flex h-8 items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[11px] font-medium shadow-sm touch-none',
                  close ? 'border-primary/50 bg-primary/15 text-foreground' : 'border-border bg-background text-muted-foreground',
                  skipped && 'opacity-50',
                  selected && 'ring-2 ring-primary'
                )}
                style={{ left, width: w }}
                data-testid="director-moment"
                data-moment-id={moment.id}
                data-close={close ? 'true' : 'false'}
              >
                <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => startDrag(e, moment, 'start')} aria-hidden />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-grab items-center gap-1 focus-visible:outline-none active:cursor-grabbing"
                  aria-label={`${MOMENT_WORDS[moment.kind]} at ${shown.start.toFixed(1)} seconds${close ? ', close-up' : ''}${skipped ? ', left out' : ''}`}
                  aria-pressed={selected}
                  onPointerDown={(e) => startDrag(e, moment, 'move')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(moment.id);
                      void player.seek(moment.start);
                    }
                  }}
                >
                  {close ? <ZoomInIcon className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Icon className="h-3.5 w-3.5 shrink-0" />}
                  {w > 64 && <span className={cn('truncate', skipped && 'line-through')}>{MOMENT_WORDS[moment.kind]}</span>}
                </button>
                <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => startDrag(e, moment, 'end')} aria-hidden />
              </div>
            );
          })}
        </div>
        {/* Playhead */}
        <div ref={headRef} className="pointer-events-none absolute inset-y-0 left-0 z-10 w-0" aria-hidden>
          <div className="absolute -left-px top-3 bottom-0 w-0.5 rounded-full bg-primary shadow-[0_0_0_1px_hsl(var(--background))]" />
          <div className="absolute -left-[5px] top-2.5 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-primary" />
        </div>
      </div>
    </div>
  );
}
