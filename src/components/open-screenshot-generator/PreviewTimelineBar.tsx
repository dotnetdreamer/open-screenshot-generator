"use client";
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, PauseIcon, PlayIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArtboardElement, ArtboardState, ElementAnimationPreset } from '@/types/artboard';
import { ENTER_DURATION_DEFAULT, EXIT_DURATION_DEFAULT } from '@/lib/video/animation';
import { GESTURE_DURATION_DEFAULT, GESTURE_TRIGGER_DEFAULT } from '@/lib/video/gestures';
import { PREVIEW_DURATION_MAX, artboardTimeline } from '@/lib/video/timeline';
import {
  getPlayback,
  pausePlayback,
  playArtboard,
  restartPlayback,
  seekPlayback,
  stopPlayback,
  usePlaybackSnapshot,
} from '@/lib/video/playback';

// The App Preview timeline, docked full width above the canvas tool pill. It
// appears as soon as a board with motion is selected — you get the shape of the
// video (what enters when, when a gesture fires, how long the recording runs)
// without pressing anything, and the playhead scrubs the live canvas.

interface PreviewTimelineBarProps {
  artboards: ArtboardState[];
  activeArtboardId: string | null;
  onSelectElement?: (elementId: string) => void;
  /** Commits a clip edit (drag/trim) back onto the element. */
  onUpdateElement?: (elementId: string, updates: Partial<ArtboardElement>) => void;
  /** Restacks `elementId` next to `targetElementId` (after it when `after`). */
  onReorderElement?: (elementId: string, targetElementId: string, after: boolean) => void;
  /** Sets an explicit preview length on the board (null clears the override). */
  onSetDuration?: (artboardId: string, seconds: number | null) => void;
  selectedElementId?: string | null;
}

/** Live state of a clip being dragged, before it is committed. */
interface ClipDrag {
  id: string;
  mode: 'move' | 'start' | 'end';
  pointerId: number;
  originX: number;
  originY: number;
  pxPerSecond: number;
  fromRow: number;
  /** False while dragging a layer that has never been animated. */
  animated: boolean;
  /** How many rows up (-) or down (+) the clip has been dragged. */
  rowDelta: number;
  from: { start: number; end: number };
  now: { start: number; end: number };
  moved: boolean;
}

/** dataTransfer type a draggable layer row carries (see LayersPanel). */
export const ELEMENT_DRAG_TYPE = 'application/artboard-element-id';

const SNAP_SECONDS = 0.05;
const MIN_CLIP_SECONDS = 0.2;
const ROW_HEIGHT = 18;
const TRACKS_HEIGHT_DEFAULT = 160;
const TRACKS_HEIGHT_MIN = 54;
const TRACKS_HEIGHT_MAX = 460;

const snap = (v: number) => Math.round(v / SNAP_SECONDS) * SNAP_SECONDS;

interface Track {
  id: string;
  label: string;
  start: number;
  end: number;
  /** Where the enter animation finishes, for the ramp cap. */
  enterEnd: number;
  kind: 'recording' | 'gesture' | 'text' | 'shape' | 'image' | 'device' | 'other';
  repeats: boolean;
  /**
   * False for a layer that is simply on screen the whole time. It still gets a
   * row — dragging it is how you animate it, which beats hunting for the
   * animation controls before the layer will even show up here.
   */
  animated: boolean;
}

/** What a layer gets the first time it is dragged onto the timeline. */
const DEFAULT_ENTER: ElementAnimationPreset = 'fade';
const DEFAULT_ENTER_DURATION = 0.6;

const KIND_CLASS: Record<Track['kind'], string> = {
  recording: 'bg-sky-500/70 border-sky-300/60',
  gesture: 'bg-amber-500/70 border-amber-300/60',
  text: 'bg-violet-500/60 border-violet-300/50',
  shape: 'bg-emerald-500/55 border-emerald-300/50',
  image: 'bg-teal-500/55 border-teal-300/50',
  device: 'bg-indigo-500/60 border-indigo-300/50',
  other: 'bg-slate-500/55 border-slate-300/50',
};

function elementKind(el: ArtboardElement): Track['kind'] {
  switch (el.type) {
    case 'video':
    case 'video-device':
      return 'recording';
    case 'gesture':
      return 'gesture';
    case 'text':
      return 'text';
    case 'shape':
      return 'shape';
    case 'image':
      return 'image';
    case 'device':
      return 'device';
    default:
      return 'other';
  }
}

/** One row per element that does something over time, in canvas z-order. */
function buildTracks(ab: ArtboardState, duration: number): Track[] {
  const tracks: Track[] = [];
  for (const el of ab.elements) {
    const label = el.name || el.type;
    if ((el.type === 'video' || el.type === 'video-device') && (el.mediaId || el.videoSrc)) {
      const start = el.trimStart ?? 0;
      const stop = el.trimEnd ?? el.durationSeconds ?? duration;
      tracks.push({
        id: el.id,
        label,
        start: 0,
        end: Math.min(duration, Math.max(0.1, stop - start)),
        enterEnd: 0,
        kind: 'recording',
        repeats: false,
        animated: true,
      });
      continue;
    }
    if (el.type === 'gesture') {
      const gestureDuration = el.gestureDuration ?? GESTURE_DURATION_DEFAULT;
      const trigger = el.gestureRepeat ? 0 : el.triggerTime ?? GESTURE_TRIGGER_DEFAULT;
      tracks.push({
        id: el.id,
        label,
        start: trigger,
        end: el.gestureRepeat ? duration : Math.min(duration, trigger + gestureDuration),
        enterEnd: trigger,
        kind: 'gesture',
        repeats: !!el.gestureRepeat,
        animated: true,
      });
      continue;
    }
    if (el.animation) {
      const anim = el.animation;
      const start = anim.enter ? anim.enterDelay ?? 0 : 0;
      const enterEnd = anim.enter ? start + (anim.enterDuration ?? ENTER_DURATION_DEFAULT) : start;
      const end =
        anim.exit && anim.exitStart !== undefined
          ? Math.min(duration, anim.exitStart + (anim.exitDuration ?? EXIT_DURATION_DEFAULT))
          : duration;
      tracks.push({
        id: el.id,
        label,
        start,
        end,
        enterEnd,
        kind: elementKind(el),
        repeats: false,
        animated: true,
      });
      continue;
    }
    // Never animated: a full-length ghost row, waiting to be dragged.
    tracks.push({
      id: el.id,
      label,
      start: 0,
      end: duration,
      enterEnd: 0,
      kind: elementKind(el),
      repeats: false,
      animated: false,
    });
  }
  return tracks;
}

/**
 * Turn a dragged clip's new [start, end] into element props. Each kind stores
 * its timing differently, so this is where "the bar moved" becomes "the
 * animation is delayed by 1.2s" or "the recording is trimmed".
 */
function clipUpdates(
  el: ArtboardElement,
  track: Track,
  next: { start: number; end: number }
): Partial<ArtboardElement> | null {
  if (el.type === 'gesture') {
    const length = Math.max(MIN_CLIP_SECONDS, next.end - next.start);
    return { triggerTime: Math.max(0, next.start), gestureDuration: length } as Partial<ArtboardElement>;
  }

  if (el.type === 'video' || el.type === 'video-device') {
    // The recording always starts the board, so its bar edits the trim.
    const trimStart = Math.max(0, (el.trimStart ?? 0) + (next.start - track.start));
    const length = Math.max(MIN_CLIP_SECONDS, next.end - next.start);
    return { trimStart: trimStart || undefined, trimEnd: trimStart + length } as Partial<ArtboardElement>;
  }

  // No animation yet: this drag IS the "animate this layer" gesture. It lands
  // as a fade in at wherever it was dropped, which the properties panel and
  // the clip's own edges can refine from there.
  const anim = el.animation ?? { enter: DEFAULT_ENTER, enterDuration: DEFAULT_ENTER_DURATION };
  const enterDuration = anim.enterDuration ?? ENTER_DURATION_DEFAULT;
  const exitDuration = anim.exitDuration ?? EXIT_DURATION_DEFAULT;
  const updated = { ...anim, enterDelay: Math.max(0, next.start) };
  // Dragging the right edge in from the board's end is how an exit is added:
  // the clip now stops before the video does, which is exactly an exit.
  const endMoved = Math.abs(next.end - track.end) > SNAP_SECONDS / 2;
  if (endMoved) {
    if (anim.exit) {
      updated.exitStart = Math.max(next.start, next.end - exitDuration);
    } else {
      updated.exit = 'fade';
      updated.exitDuration = exitDuration;
      updated.exitStart = Math.max(next.start + enterDuration, next.end - exitDuration);
    }
  } else if (anim.exit && anim.exitStart !== undefined) {
    updated.exitStart = Math.max(0, anim.exitStart + (next.start - track.start));
  }
  return { animation: updated } as Partial<ArtboardElement>;
}

export function PreviewTimelineBar({
  artboards,
  activeArtboardId,
  onSelectElement,
  onUpdateElement,
  onReorderElement,
  onSetDuration,
  selectedElementId,
}: PreviewTimelineBarProps) {
  const [open, setOpen] = useState(true);
  // The ref is the truth during a drag; the state copy only exists so the clip
  // re-renders under the pointer. Reading the state in the pointerup handler
  // could see the value from before the last move — a fast drag then committed
  // nothing at all.
  const dragRef = useRef<ClipDrag | null>(null);
  const [drag, setDrag] = useState<ClipDrag | null>(null);
  const [durationDraft, setDurationDraft] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const playback = usePlaybackSnapshot();
  // The bar belongs to the SELECTED board, and only to it.
  const artboard = artboards.find((ab) => ab.id === activeArtboardId) ?? null;
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  // Track area height: a big board has dozens of clips, so the bar is grabbed
  // by its top edge and pulled taller, like any editor's timeline panel.
  const [tracksHeight, setTracksHeight] = useState(TRACKS_HEIGHT_DEFAULT);
  const resizeRef = useRef<{ pointerId: number; originY: number; from: number } | null>(null);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('abs-timeline-open') : null;
    if (stored !== null) setOpen(stored === '1');
    const storedHeight = typeof window !== 'undefined' ? window.localStorage.getItem('abs-timeline-height') : null;
    const parsed = storedHeight ? parseInt(storedHeight, 10) : NaN;
    if (!Number.isNaN(parsed)) {
      setTracksHeight(Math.max(TRACKS_HEIGHT_MIN, Math.min(TRACKS_HEIGHT_MAX, parsed)));
    }
  }, []);

  const beginResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    resizeRef.current = { pointerId: e.pointerId, originY: e.clientY, from: tracksHeight };
  };
  const moveResize = (e: React.PointerEvent) => {
    const state = resizeRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    // Dragging up (negative dy) grows the panel.
    const next = Math.max(
      TRACKS_HEIGHT_MIN,
      Math.min(TRACKS_HEIGHT_MAX, state.from + (state.originY - e.clientY))
    );
    setTracksHeight(next);
  };
  const endResize = () => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    try {
      window.localStorage.setItem('abs-timeline-height', String(tracksHeight));
    } catch {
      // private mode: the height just resets next session
    }
  };
  const toggleOpen = () => {
    setOpen((v) => {
      try {
        window.localStorage.setItem('abs-timeline-open', v ? '0' : '1');
      } catch {
        // private mode: the bar just forgets between sessions
      }
      return !v;
    });
  };

  // Esc leaves preview mode from anywhere, so a paused timeline can never be
  // something you have to hunt for a way out of.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopPlayback();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Selecting a different board ends the preview: the timeline goes with the
  // selection, and a board left running off to the side would keep animating
  // (and keep its recording rolling) behind your back. Read the store rather
  // than the render snapshot so this cannot act on a stale id.
  useEffect(() => {
    const loaded = getPlayback().artboardId;
    if (loaded && loaded !== activeArtboardId) stopPlayback();
  }, [activeArtboardId]);

  const timeline = useMemo(() => artboardTimeline(artboard), [artboard]);
  const tracks = useMemo(
    () => (artboard && timeline.hasMotion ? buildTracks(artboard, timeline.duration) : []),
    [artboard, timeline]
  );

  const isThisBoard = !!artboard && playback.artboardId === artboard.id;
  const duration = (isThisBoard && playback.duration) || timeline.duration;
  const time = isThisBoard ? playback.time : 0;

  // Length field: free text while you type (so it can be cleared and retyped),
  // committed on Enter or blur.
  const clampDuration = (v: number) => Math.max(1, Math.min(PREVIEW_DURATION_MAX, Math.round(v)));
  const commitDuration = (raw: string | null) => {
    setDurationDraft(null);
    if (raw === null) return;
    const value = parseFloat(raw);
    if (Number.isNaN(value) || !artboard) return;
    onSetDuration?.(artboard.id, clampDuration(value));
  };
  /**
   * Give a layer that has never been animated the default entrance, starting
   * at `at` seconds. This is what both the "+" button and a drop onto the
   * timeline do — the point being that you never have to go find the animation
   * controls to get a layer onto the timeline in the first place.
   */
  const animateLayerAt = (elementId: string, at: number) => {
    const el = artboard?.elements.find((candidate) => candidate.id === elementId);
    if (!el || !onUpdateElement) return;
    const start = Math.max(0, Math.min(snap(at), Math.max(0, duration - DEFAULT_ENTER_DURATION)));
    if (el.type === 'gesture') {
      onUpdateElement(elementId, { triggerTime: start } as Partial<ArtboardElement>);
      return;
    }
    if (el.type === 'video' || el.type === 'video-device') return; // a recording starts the board
    onUpdateElement(elementId, {
      animation: {
        ...(el.animation ?? {}),
        enter: el.animation?.enter ?? DEFAULT_ENTER,
        enterDelay: start,
        enterDuration: el.animation?.enterDuration ?? DEFAULT_ENTER_DURATION,
      },
    } as Partial<ArtboardElement>);
    onSelectElement?.(elementId);
  };

  const stepDuration = (delta: number) => {
    if (!artboard) return;
    setDurationDraft(null);
    onSetDuration?.(artboard.id, clampDuration(Math.round(duration) + delta));
  };
  // A half-typed length must not follow you to another board.
  useEffect(() => {
    setDurationDraft(null);
  }, [artboard?.id]);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const node = trackAreaRef.current;
      if (!node || !artboard) return;
      const rect = node.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      if (playback.artboardId !== artboard.id) {
        // Scrubbing a board that is not loaded yet loads it, paused, at the
        // second you pointed at.
        playArtboard(artboard.id, timeline.duration);
        pausePlayback();
      }
      seekPlayback(ratio * duration);
    },
    [artboard, duration, playback.artboardId, timeline.duration]
  );

  // --- clip dragging (move / trim), the video-editor part -------------------

  const beginClipDrag = (
    e: React.PointerEvent,
    track: Track,
    mode: ClipDrag['mode'],
    row: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const area = trackAreaRef.current;
    if (!area || !onUpdateElement) return;
    const pxPerSecond = area.getBoundingClientRect().width / Math.max(0.1, duration);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const started: ClipDrag = {
      id: track.id,
      mode,
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      pxPerSecond,
      fromRow: row,
      animated: track.animated,
      rowDelta: 0,
      from: { start: track.start, end: track.end },
      now: { start: track.start, end: track.end },
      moved: false,
    };
    dragRef.current = started;
    setDrag(started);
  };

  const moveClipDrag = (e: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    const dt = snap((e.clientX - current.originX) / current.pxPerSecond);
    const { start, end } = current.from;
    let next = { start, end };
    if (current.mode === 'move' && !current.animated) {
      // A never-animated layer runs the whole board, so there is nothing to
      // slide: dragging it sets where it comes IN, and the clip shortens from
      // the left. Without this the clamp below pinned it (end is already the
      // board's end) and the drag did nothing at all.
      next = { start: Math.max(0, Math.min(start + dt, end - MIN_CLIP_SECONDS)), end };
    } else if (current.mode === 'move') {
      const shift = Math.max(-start, Math.min(dt, duration - end));
      next = { start: start + shift, end: end + shift };
    } else if (current.mode === 'start') {
      next = { start: Math.max(0, Math.min(start + dt, end - MIN_CLIP_SECONDS)), end };
    } else {
      next = { start, end: Math.min(duration, Math.max(end + dt, start + MIN_CLIP_SECONDS)) };
    }
    // Vertical travel restacks the layer: a whole row is one step in z-order.
    // Only the body drag reorders; an edge drag is a trim and stays put.
    const rowDelta =
      current.mode === 'move' && onReorderElement
        ? Math.max(
            -current.fromRow,
            Math.min(tracks.length - 1 - current.fromRow, Math.round((e.clientY - current.originY) / ROW_HEIGHT))
          )
        : 0;
    const updated: ClipDrag = {
      ...current,
      now: next,
      rowDelta,
      moved:
        current.moved ||
        Math.abs(e.clientX - current.originX) > 2 ||
        Math.abs(e.clientY - current.originY) > 2,
    };
    dragRef.current = updated;
    setDrag(updated);
  };

  const endClipDrag = (e: React.PointerEvent) => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current || !artboard) return;
    if (!current.moved) {
      onSelectElement?.(current.id);
      return;
    }
    const el = artboard.elements.find((candidate) => candidate.id === current.id);
    const track = tracks.find((candidate) => candidate.id === current.id);
    if (!el || !track) return;

    // Restack first: the reorder rewrites the elements array, and the timing
    // patch below is applied by id, so the two never fight over one commit.
    if (current.rowDelta !== 0) {
      const target = tracks[current.fromRow + current.rowDelta];
      if (target && target.id !== current.id) {
        onReorderElement?.(current.id, target.id, current.rowDelta > 0);
      }
    }
    const timeChanged =
      Math.abs(current.now.start - current.from.start) > 1e-6 ||
      Math.abs(current.now.end - current.from.end) > 1e-6;
    if (!timeChanged) return;
    const updates = clipUpdates(el, track, current.now);
    if (updates) onUpdateElement?.(current.id, updates);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scrubbing.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    seekFromEvent(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!scrubbing.current) return;
    seekFromEvent(e.clientX);
  };
  const endScrub = () => {
    scrubbing.current = false;
  };

  if (!artboard || !timeline.hasMotion) return null;

  const playing = isThisBoard && playback.playing;
  const playheadPercent = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const ticks = Array.from({ length: Math.floor(duration) + 1 }, (_, i) => i);

  return (
    <div
      data-export-exclude
      className="pointer-events-auto absolute bottom-[4.25rem] left-3 right-3 z-30 max-md:bottom-[4.75rem]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="relative rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur">
        {/* Grab the top edge to make the timeline taller or shorter */}
        {open && (
          <div
            role="separator"
            aria-label="Resize timeline"
            title="Drag to resize the timeline"
            className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize rounded-t-xl"
            onPointerDown={beginResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          >
            <div className="mx-auto mt-[3px] h-0.5 w-10 rounded-full bg-border" />
          </div>
        )}

        {/* Transport row */}
        <div className="flex h-10 items-center gap-2 px-2">
          <button
            type="button"
            title={playing ? 'Pause preview' : 'Play preview'}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
            onClick={() => (playing ? pausePlayback() : playArtboard(artboard.id, timeline.duration))}
          >
            {playing ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            title="Restart"
            aria-label="Restart preview"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => restartPlayback()}
          >
            <RotateCcwIcon className="h-3.5 w-3.5" />
          </button>
          <span className="tabular-nums text-xs font-medium text-foreground">{time.toFixed(1)}s</span>
          <span className="text-xs text-muted-foreground">/</span>
          {onSetDuration ? (
            // The board's length is editable: Apple takes 15 to 30 seconds, but
            // a social cut or an ad is whatever you say it is. Deliberately not
            // <input type="number">: its spinners are unclickable at this size,
            // and a clamped controlled value fights every keystroke (clearing
            // the field to retype snapped it straight back).
            <span className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="Shorten preview by one second"
                title="One second shorter"
                className="flex h-6 w-5 items-center justify-center rounded border border-border text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                disabled={Math.round(duration) <= 1}
                onClick={() => stepDuration(-1)}
              >
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                aria-label="Preview length in seconds"
                title="Length of this preview, in seconds"
                value={durationDraft ?? String(Math.round(duration))}
                onChange={(e) => setDurationDraft(e.target.value.replace(/[^\d.]/g, ''))}
                onBlur={() => commitDuration(durationDraft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitDuration(durationDraft);
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === 'Escape') {
                    setDurationDraft(null);
                  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    stepDuration(e.key === 'ArrowUp' ? 1 : -1);
                  }
                }}
                className="h-6 w-9 rounded border border-border bg-background px-1 text-center text-xs tabular-nums text-foreground"
              />
              <button
                type="button"
                aria-label="Lengthen preview by one second"
                title="One second longer"
                className="flex h-6 w-5 items-center justify-center rounded border border-border text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                disabled={Math.round(duration) >= PREVIEW_DURATION_MAX}
                onClick={() => stepDuration(1)}
              >
                +
              </button>
              <span className="ml-0.5 text-xs text-muted-foreground">s</span>
              {artboard.previewDurationSeconds !== undefined && (
                <button
                  type="button"
                  title="Back to the length the content needs"
                  aria-label="Reset preview length"
                  className="rounded px-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => onSetDuration(artboard.id, null)}
                >
                  auto
                </button>
              )}
            </span>
          ) : (
            <span className="tabular-nums text-xs text-muted-foreground">{duration.toFixed(1)}s</span>
          )}
          <span className="truncate text-xs text-muted-foreground">{artboard.name}</span>
          <span className="ml-auto text-[11px] text-muted-foreground max-sm:hidden">
            {tracks.filter((t) => t.animated).length} of {tracks.length} layers animated
          </span>
          {isThisBoard && (
            <button
              type="button"
              title="Exit preview"
              aria-label="Exit preview"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => stopPlayback()}
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            title={open ? 'Collapse timeline' : 'Expand timeline'}
            aria-label={open ? 'Collapse timeline' : 'Expand timeline'}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={toggleOpen}
          >
            {open ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronUpIcon className="h-4 w-4" />}
          </button>
        </div>

        {/* Ruler + tracks. The whole block is one scrub surface, and a drop
            target: drag a layer in from the Layers panel and it is animated
            at the second you dropped it. */}
        <div
          ref={trackAreaRef}
          className={cn(
            'relative cursor-ew-resize select-none border-t border-border px-0 pb-2',
            dropActive && 'bg-primary/10'
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!dropActive) setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(e) => {
            const elementId = e.dataTransfer.getData(ELEMENT_DRAG_TYPE);
            setDropActive(false);
            if (!elementId) return;
            e.preventDefault();
            const rect = trackAreaRef.current?.getBoundingClientRect();
            if (!rect) return;
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            animateLayerAt(elementId, ratio * duration);
          }}
        >
          <div className="relative h-5">
            {ticks.map((s) => (
              <div
                key={s}
                className="absolute top-0 h-full border-l border-border/70"
                style={{ left: `${(s / duration) * 100}%` }}
              >
                <span className="ml-1 text-[10px] leading-5 text-muted-foreground">{s}s</span>
              </div>
            ))}
          </div>

          {open && (
            <div className="overflow-y-auto" style={{ height: `${tracksHeight}px` }}>
              {tracks.map((track, row) => {
                // A clip being dragged renders from the draft, so it follows
                // the pointer before anything is committed to the element.
                const live = drag?.id === track.id ? drag.now : { start: track.start, end: track.end };
                const left = (live.start / duration) * 100;
                const width = Math.max(0.6, ((live.end - live.start) / duration) * 100);
                const rampWidth =
                  track.enterEnd > track.start ? ((track.enterEnd - track.start) / duration) * 100 : 0;
                const editable = !!onUpdateElement;
                return (
                  <div
                    key={track.id}
                    className={cn(
                      'relative',
                      selectedElementId === track.id && 'bg-primary/10'
                    )}
                    style={{ height: `${ROW_HEIGHT}px` }}
                  >
                    <div
                      className={cn(
                        'group absolute top-[3px] h-3 rounded-sm border',
                        editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                        drag?.id === track.id && 'z-20 ring-1 ring-primary',
                        // A layer that has never been animated reads as a
                        // placeholder: dashed, see-through, "drag me".
                        track.animated ? KIND_CLASS[track.kind] : 'border-dashed border-muted-foreground/50 bg-muted/25',
                        !track.animated && 'opacity-70 hover:opacity-100'
                      )}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        transform:
                          drag?.id === track.id && drag.rowDelta
                            ? `translateY(${drag.rowDelta * ROW_HEIGHT}px)`
                            : undefined,
                      }}
                      title={
                        !editable
                          ? `${track.label} · ${track.start.toFixed(2)}s to ${track.end.toFixed(2)}s`
                          : track.animated
                            ? `${track.label} · drag sideways to retime, up or down to restack, edges to trim`
                            : `${track.label} · not animated. Drag it along the timeline (or press +) to fade it in there`
                      }
                      onPointerDown={(e) => beginClipDrag(e, track, 'move', row)}
                      onPointerMove={moveClipDrag}
                      onPointerUp={endClipDrag}
                      onPointerCancel={endClipDrag}
                    >
                      {rampWidth > 0 && (
                        <div
                          className="pointer-events-none h-full rounded-l-sm bg-white/25"
                          style={{ width: `${Math.min(100, (rampWidth / width) * 100)}%` }}
                        />
                      )}
                      <span
                        className={cn(
                          'pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium leading-none drop-shadow',
                          track.animated ? 'text-white/95' : 'text-muted-foreground'
                        )}
                      >
                        {track.label}
                      </span>
                      {editable && !track.animated && (
                        // One click animates the layer at the playhead, for
                        // anyone who would rather not drag.
                        <button
                          type="button"
                          aria-label={`Animate ${track.label}`}
                          title="Fade this layer in at the playhead"
                          className="absolute right-0.5 top-1/2 hidden h-3 w-3 -translate-y-1/2 items-center justify-center rounded-sm bg-primary text-[9px] leading-none text-primary-foreground group-hover:flex"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            animateLayerAt(track.id, time);
                          }}
                        >
                          +
                        </button>
                      )}
                      {editable && track.animated && (
                        <>
                          <div
                            className="absolute -left-0.5 top-0 h-full w-1.5 cursor-col-resize rounded-l-sm bg-white/0 hover:bg-white/60 group-hover:bg-white/35"
                            onPointerDown={(e) => beginClipDrag(e, track, 'start', row)}
                            onPointerMove={moveClipDrag}
                            onPointerUp={endClipDrag}
                            onPointerCancel={endClipDrag}
                          />
                          <div
                            className="absolute -right-0.5 top-0 h-full w-1.5 cursor-col-resize rounded-r-sm bg-white/0 hover:bg-white/60 group-hover:bg-white/35"
                            onPointerDown={(e) => beginClipDrag(e, track, 'end', row)}
                            onPointerMove={moveClipDrag}
                            onPointerUp={endClipDrag}
                            onPointerCancel={endClipDrag}
                          />
                        </>
                      )}
                    </div>
                    {drag?.id === track.id && drag.moved && (
                      <div
                        className="pointer-events-none absolute -top-[3px] z-10 rounded bg-popover px-1 py-0.5 text-[10px] font-medium tabular-nums text-popover-foreground shadow"
                        style={{ left: `calc(${left}% + ${width}%)` }}
                      >
                        {drag.now.start.toFixed(2)}s to {drag.now.end.toFixed(2)}s
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Playhead over everything */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary"
            style={{ left: `${playheadPercent}%` }}
          >
            <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rounded-full bg-primary shadow" />
          </div>
        </div>
      </div>
    </div>
  );
}
