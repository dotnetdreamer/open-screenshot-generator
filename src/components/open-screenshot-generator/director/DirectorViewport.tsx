"use client";

// The film on screen: the 3D stage's canvas with the words drawn over it on a
// second canvas, fitted into the space the view gives it at the film's shape.
//
// It draws only when the player asks (while playing, or after a change). To go
// easy on the computer it draws fewer pixels while the film plays, fewer still
// when frames come late, and the full picture once it stops. The stage, and
// the graphics memory it holds, goes 20 seconds after Director is left, and
// comes back when Director shows again.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2Icon, PauseIcon, PlayIcon } from 'lucide-react';
import { DirectorStage } from '@/lib/director/stage';
import { backdropFor } from '@/lib/director/looks';
import { stageFrameAt, type HandMoves } from '@/lib/director/frame';
import { drawOverlay, type OverlayAssets } from '@/lib/director/overlay';
import { loadOverlayAssets, overlayAssetsKey } from '@/lib/director/overlayAssets';
import { FORMAT_ASPECT } from '@/lib/director/plan';
import { finishFor } from '@/lib/director/film';
import { placeholderScreen, PLACEHOLDER_SIZE } from '@/lib/director/placeholder';
import type { FilmPlayer } from '@/lib/director/player';
import type { Film, FilmPlan } from '@/lib/director/types';
import { cn } from '@/lib/utils';

/** Seconds after Director is left before the stage gives back its graphics memory. */
const RELEASE_AFTER_MS = 20_000;

export interface LiveTurn {
  /** Read on every frame: the phone's moves now, or null. */
  current: HandMoves | null;
}

export function DirectorViewport({
  film,
  plan,
  player,
  active,
  live,
  busy,
  onError,
}: {
  film: Film;
  plan: FilmPlan;
  player: FilmPlayer;
  active: boolean;
  /** A linked phone's turn, shown in place of the plan's while it moves. */
  live?: LiveTurn;
  /** Words over the picture while something is being worked out (reading the recording). */
  busy?: string | null;
  onError?: (message: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<DirectorStage | null>(null);
  const filmRef = useRef(film);
  const planRef = useRef(plan);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [canvasKey, setCanvasKey] = useState(0);
  const [playing, setPlaying] = useState(player.isPlaying);
  const ratioRef = useRef({ draft: 1.25, lastFrame: 0, slow: 0, fast: 0 });
  /** The icon and badges the words draw, once decoded. */
  const assetsRef = useRef<OverlayAssets | null>(null);
  filmRef.current = film;
  planRef.current = plan;

  const aspect = FORMAT_ASPECT[film.format];

  // The biggest picture of the film's shape that fits the box.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (!w || !h) return;
      const width = Math.min(w, h * aspect);
      setSize({ width: Math.floor(width), height: Math.floor(width / aspect) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [aspect]);

  useEffect(() => player.subscribe(() => setPlaying(player.isPlaying)), [player]);

  const fullRatio = () => Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);

  const draw = useCallback(
    (t: number, newFrame: boolean) => {
      const stage = stageRef.current;
      const overlay = overlayRef.current;
      if (!stage || !overlay) return;
      const f = filmRef.current;
      const p = planRef.current;
      // While playing, a lighter picture; a governor drops pixels when frames come late.
      const now = performance.now();
      const r = ratioRef.current;
      if (player.isPlaying) {
        const gap = r.lastFrame ? now - r.lastFrame : 16;
        if (gap > 26) r.slow += 1;
        else if (gap < 18) r.fast += 1;
        if (r.slow > 8) {
          r.draft = Math.max(0.6, r.draft - 0.15);
          r.slow = 0;
          r.fast = 0;
        } else if (r.fast > 120) {
          r.draft = Math.min(fullRatio(), 1.5, r.draft + 0.1);
          r.fast = 0;
        }
      }
      r.lastFrame = player.isPlaying ? now : 0;
      const ratio = player.isPlaying ? Math.min(r.draft, fullRatio()) : fullRatio();
      const cssW = overlay.clientWidth;
      const cssH = overlay.clientHeight;
      if (!cssW || !cssH) return;
      const glCanvas = stage.canvas;
      if (glCanvas.width !== Math.round(cssW * ratio) || glCanvas.height !== Math.round(cssH * ratio)) {
        stage.setSize(cssW, cssH, ratio);
      }
      if (newFrame) stage.screenChanged();
      const frame = stageFrameAt(f, p, t, live?.current);
      try {
        stage.render(frame);
      } catch (error) {
        console.error('Director could not draw the film', error);
      }
      const words = Math.min(2, fullRatio());
      const ow = Math.round(cssW * words);
      const oh = Math.round(cssH * words);
      if (overlay.width !== ow || overlay.height !== oh) {
        overlay.width = ow;
        overlay.height = oh;
      }
      const ctx = overlay.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, ow, oh);
        drawOverlay(ctx, ow, oh, t, p.cues, f.format, backdropFor(f.look), f.text, p.duration, assetsRef.current, frame.pose.zoom);
      }
    },
    [player, live]
  );

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  /**
   * Frees the stage and its graphics memory at once. Its canvas is spent: a
   * canvas whose context was given up only ever hands back that dead context,
   * so the next stage gets a new canvas.
   */
  const release = useCallback(() => {
    const stage = stageRef.current;
    stageRef.current = null;
    if (!stage) return;
    stage.canvas.dataset.spent = '1';
    stage.dispose();
    stage.loseContext();
  }, []);

  // The stage: made when Director shows, given back a while after it's left.
  // (The film itself pauses when Director is left: the view tells the player.)
  useEffect(() => {
    if (!active) {
      const timer = window.setTimeout(() => {
        if (player.render === draw) player.render = null;
        release();
      }, RELEASE_AFTER_MS);
      return () => clearTimeout(timer);
    }
    const canvas = glRef.current;
    if (!canvas) return;
    if (canvas.dataset.spent) {
      // A new canvas comes with the next render, and this effect runs again for it.
      setCanvasKey((k) => k + 1);
      return;
    }
    if (!stageRef.current) {
      try {
        stageRef.current = new DirectorStage(canvas);
      } catch (error) {
        console.error('Director could not start its 3D stage', error);
        canvas.dataset.spent = '1';
        onErrorRef.current?.("This browser couldn't start the 3D picture. Try another browser, or the desktop app.");
        return;
      }
    }
    player.render = draw;
    player.requestDraw();
    return undefined;
  }, [active, canvasKey, draw, player, release]);

  // A graphics context lost on its own (the GPU was reset, or the system took
  // the memory back): ask for it back, and start over on a new canvas when it comes.
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    const lost = (event: Event) => {
      if (canvas.dataset.spent) return;
      event.preventDefault();
      canvas.dataset.spent = '1';
      stageRef.current?.dispose();
      stageRef.current = null;
    };
    const restored = () => setCanvasKey((k) => k + 1);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [canvasKey]);

  useEffect(() => () => release(), [release]);

  /** The phone's screen: the video playing now, or the placeholder in a film with no recording yet. */
  const applyScreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const video = player.video;
    if (video && video.videoWidth) stage.setScreen({ image: video, width: video.videoWidth, height: video.videoHeight });
    else if (!video) stage.setScreen({ image: placeholderScreen(), ...PLACEHOLDER_SIZE });
    player.requestDraw();
  }, [player]);

  // The look, the phone and the picture on its screen.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !active) return;
    try {
      stage.setLook(backdropFor(film.look));
      stage.setPhone(film.phone.deviceType, finishFor(film.phone.deviceType, film.phone.finish, film.look));
      applyScreen();
    } catch (error) {
      console.error('Director could not set up the stage', error);
    }
    player.requestDraw();
  }, [film.look, film.phone.deviceType, film.phone.finish, player, active, canvasKey, applyScreen]);

  // Anything else that changes the picture draws it again.
  useEffect(() => {
    player.requestDraw();
  }, [film, plan, size, player]);

  // The icon and the badges, decoded once each; the picture draws again when they come.
  const assetsKey = overlayAssetsKey(film.text);
  useEffect(() => {
    let current = true;
    void loadOverlayAssets(filmRef.current.text).then((assets) => {
      if (!current) return;
      assetsRef.current = assets;
      player.requestDraw();
    });
    return () => {
      current = false;
    };
  }, [assetsKey, player]);

  // Another recording (or none) comes on the screen: at a cut, or when one is added.
  useEffect(() => player.onScreen(applyScreen), [player, applyScreen]);

  return (
    <div ref={boxRef} className="relative flex h-full w-full min-h-0 items-center justify-center" data-testid="director-viewport">
      <div
        className="relative overflow-hidden rounded-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.45)] ring-1 ring-black/5 dark:ring-white/10"
        style={{ width: size.width, height: size.height }}
      >
        <canvas key={canvasKey} ref={glRef} className="absolute inset-0 h-full w-full" data-testid="director-canvas" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => void player.toggle()}
          className={cn(
            'absolute inset-0 flex items-center justify-center transition-opacity focus-visible:outline-none',
            playing ? 'opacity-0 hover:opacity-100 focus-visible:opacity-100' : 'opacity-100'
          )}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105">
            {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="ml-0.5 h-6 w-6" />}
          </span>
        </button>
        {busy && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/60 to-transparent px-3 pb-4 pt-10 text-sm font-medium text-white" data-testid="director-busy">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            {busy}
          </div>
        )}
      </div>
    </div>
  );
}
