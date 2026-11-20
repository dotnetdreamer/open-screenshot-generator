"use client";

// The Limelight viewport: the stage drawn at the video's shape, and the
// gestures that film it.
//
//   drag the stage          swings the camera round what it looks at
//   Shift-drag, right-drag  slides the camera sideways
//   scroll, pinch           moves the camera closer or further
//   two fingers on a pad    swings the camera, as a drag does
//   click a device          picks it
//   drag the picked device  moves it in the picture
//   Option-drag it          turns it
//   double-click a device   points the camera at it
//
// A device has to be picked before a drag moves it, so a drag that starts on
// a phone by chance swings the camera as any other drag does.
//
// Every gesture is drawn live on the stage without touching React state, and
// saved once when it ends: a camera move becomes a shot at the playhead
// (setShotAt), so moving the playhead and framing the view is all it takes
// to make the camera move. Events are pointer events throughout (rule 20),
// and the canvas has touch-action none so a finger's drag is never taken for
// a scroll.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { actorAt } from '@/lib/limelight/animate';
import { cameraPose, dollyBy, orbitBy, panBy } from '@/lib/limelight/camera';
import { cameraOnActor, cameraToFitAll, directorCamera, setPoseAt, setShotAt } from '@/lib/limelight/edit';
import { getPictureBlob } from '@/lib/limelight/store';
import { LimelightStage } from '@/lib/limelight/stage/stage';
import type { CameraState, LimelightScene, XYZ } from '@/lib/limelight/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EyeIcon, ScanIcon, VideoIcon } from 'lucide-react';
import { formatSeconds } from './controls';
import type { TimeStore } from './time';

/**
 * A mouse wheel, not a trackpad. The same test the canvas uses (rule 24,
 * `isMouseWheel` in CanvasArea.tsx): a wheel reports lines or pages, or a
 * legacy wheelDeltaY that is not three times deltaY.
 */
function isMouseWheel(event: WheelEvent): boolean {
  if (event.deltaMode !== 0) return true;
  const legacy = (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (typeof legacy === 'number' && legacy !== 0) return legacy !== -3 * event.deltaY;
  return false;
}

interface Gesture {
  mode: 'orbit' | 'pan' | 'move' | 'turn';
  pointerId: number;
  startX: number;
  startY: number;
  camera: CameraState;
  scene: LimelightScene;
  actorId?: string;
  base?: { position: XYZ; turn: { yaw: number; pitch: number; roll: number } };
  /** What a click without a drag picks. */
  clicked: string | null;
  moved: boolean;
  live?: { camera?: CameraState; scene?: LimelightScene };
}

export interface ViewportProps {
  scene: LimelightScene;
  time: TimeStore;
  playing: boolean;
  active: boolean;
  selectedActorId: string | null;
  onSelectActor: (actorId: string | null) => void;
  /** Saves a change as one undo step. */
  onCommit: (next: LimelightScene) => void;
  /** Called on any gesture's start, so playback can stop. */
  onGestureStart: () => void;
  stageRef: React.MutableRefObject<LimelightStage | null>;
}

const FRAME_MARGIN = 28;

export function LimelightViewport({ scene, time, playing, active, selectedActorId, onSelectActor, onCommit, onGestureStart, stageRef }: ViewportProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Holds the stage's own canvas and takes the gestures.
  const canvasRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const [frameBox, setFrameBox] = useState({ width: 0, height: 0 });
  const [note, setNote] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const selectedRef = useRef(selectedActorId);
  selectedRef.current = selectedActorId;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const gestureRef = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; midX: number; midY: number; camera: CameraState } | null>(null);
  const pinchCamera = useRef<CameraState | null>(null);
  const wheelRef = useRef<{ camera: CameraState; timer: number } | null>(null);
  const noteTimer = useRef(0);
  const rebuildTimer = useRef(0);
  // Looking from outside: the director's camera, which gestures move and nothing saves.
  const [outside, setOutside] = useState(false);
  const outsideRef = useRef(false);
  outsideRef.current = outside;
  const directorRef = useRef<CameraState | null>(null);
  const rebuilds = useRef<number[]>([]);

  /**
   * A stage whose WebGL context is gone draws nothing, though the clock
   * goes on, so the stage is made again on a new canvas. Four times in half
   * a minute and it stops trying and says so, rather than taking contexts
   * from the editor's 3D devices one after another.
   */
  const rebuild = useCallback(() => {
    window.clearTimeout(rebuildTimer.current);
    const now = Date.now();
    rebuilds.current = rebuilds.current.filter((at) => now - at < 30_000);
    if (rebuilds.current.length >= 4) {
      setStageError('The 3D view keeps stopping. Close some other tabs or windows that show 3D, then try again.');
      return;
    }
    rebuilds.current.push(now);
    setGeneration((n) => n + 1);
  }, []);

  const say = useCallback((text: string) => {
    setNote(text);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 1800);
  }, []);

  // ---- the stage ------------------------------------------------------------

  /** Keeps the selection's outline on the device it frames, after every frame. */
  const placeSelection = useCallback(() => {
    const outline = selectionRef.current;
    const stage = stageRef.current;
    if (!outline) return;
    const id = selectedRef.current;
    const box = id && stage ? stage.actorBox(id) : null;
    if (!box) {
      outline.style.display = 'none';
      return;
    }
    outline.style.display = 'block';
    outline.style.transform = `translate(${box.left - 4}px, ${box.top - 4}px)`;
    outline.style.width = `${box.width + 8}px`;
    outline.style.height = `${box.height + 8}px`;
  }, [stageRef]);

  useEffect(() => {
    const mount = canvasRef.current;
    if (!mount) return;
    let stage: LimelightStage;
    try {
      stage = new LimelightStage({
        loadMedia: getPictureBlob,
        onFrame: () => placeSelection(),
        // A context dropped for good never comes back, so a new stage after a
        // moment; one that does come back makes it at once.
        onContextLost: () => {
          window.clearTimeout(rebuildTimer.current);
          rebuildTimer.current = window.setTimeout(rebuild, 1200);
        },
        onContextRestored: () => rebuild(),
      });
    } catch (error) {
      console.error('Limelight could not start WebGL', error);
      setStageError("This browser couldn't start 3D. Try closing other tabs or windows with 3D in them.");
      return;
    }
    setStageError(null);
    stage.canvas.className = 'block h-full w-full';
    stage.canvas.setAttribute('data-testid', 'limelight-canvas');
    mount.appendChild(stage.canvas);
    stageRef.current = stage;
    stage.setScene(sceneRef.current);
    stage.setTime(time.get());
    // Made again mid-play, it draws the light frames of playback, as the one it replaces did.
    stage.setInteractive(playingRef.current);
    if (outsideRef.current && directorRef.current) {
      stage.setGuides(true);
      stage.setCameraOverride(directorRef.current);
    }
    const unsubscribe = time.subscribe(() => stage.setTime(time.get()));
    return () => {
      unsubscribe();
      if (stageRef.current === stage) stageRef.current = null;
      stage.dispose();
      stage.canvas.remove();
    };
  }, [generation, placeSelection, rebuild, stageRef, time]);

  useEffect(() => () => window.clearTimeout(rebuildTimer.current), []);

  // A tab coming back draws at once, and makes the stage again if the
  // context went while it was away.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const stage = stageRef.current;
      if (!stage || stage.isLost) rebuild();
      else stage.invalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [rebuild, stageRef]);

  useEffect(() => {
    // A gesture draws its own scene until it ends.
    if (!gestureRef.current?.live?.scene) stageRef.current?.setScene(scene);
  }, [scene, stageRef]);

  useEffect(() => {
    stageRef.current?.setInteractive(playing);
  }, [playing, stageRef]);

  useEffect(() => {
    if (active) stageRef.current?.invalidate();
  }, [active, stageRef]);

  useEffect(() => {
    placeSelection();
  }, [selectedActorId, placeSelection]);

  // The frame is the video's shape, as large as fits.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      // A view in the back has no size; its frame stays as it was for when it comes back.
      if (box.clientWidth === 0 || box.clientHeight === 0) return;
      const availableW = Math.max(40, box.clientWidth - 2 * FRAME_MARGIN);
      const availableH = Math.max(40, box.clientHeight - 2 * FRAME_MARGIN);
      const aspect = sceneRef.current.format.width / sceneRef.current.format.height;
      let width = availableW;
      let height = width / aspect;
      if (height > availableH) {
        height = availableH;
        width = height * aspect;
      }
      setFrameBox({ width: Math.floor(width), height: Math.floor(height) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [scene.format.width, scene.format.height]);

  useEffect(() => {
    if (frameBox.width > 0) stageRef.current?.setViewport(frameBox.width, frameBox.height, window.devicePixelRatio || 1);
  }, [frameBox, stageRef, generation]);

  // ---- gestures -------------------------------------------------------------

  const aspect = scene.format.width / scene.format.height;

  /** The camera a gesture starts from: the director's when looking from outside, the video's otherwise. */
  const viewCamera = useCallback(
    (): CameraState | null => (outsideRef.current ? directorRef.current : stageRef.current?.viewCamera() ?? null),
    [stageRef]
  );

  /** Ends a camera gesture: from outside it only moves the director's camera; otherwise it is a shot. */
  const endCamera = useCallback(
    (camera: CameraState) => {
      const stage = stageRef.current;
      if (outsideRef.current) {
        directorRef.current = camera;
        stage?.setCameraOverride(camera);
        return;
      }
      stage?.setCameraOverride(null);
      commitCameraRef.current(camera);
    },
    [stageRef]
  );
  const commitCameraRef = useRef<(camera: CameraState) => void>(() => {});

  const toggleOutside = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const next = !outsideRef.current;
    if (next) {
      directorRef.current = directorCamera(sceneRef.current, sceneRef.current.format.width / sceneRef.current.format.height);
      stage.setGuides(true);
      stage.setCameraOverride(directorRef.current);
    } else {
      stage.setGuides(false);
      stage.setCameraOverride(null);
    }
    setOutside(next);
  }, [stageRef]);

  /** Saves a camera as the shot at the playhead and says what happened. */
  const commitCamera = useCallback(
    (camera: CameraState) => {
      const at = time.get();
      const result = setShotAt(sceneRef.current, at, camera);
      const index = result.scene.camera.shots.findIndex((shot) => shot.id === result.shotId) + 1;
      onCommit(result.scene);
      say(result.added ? `Shot ${index} added at ${formatSeconds(at)}` : `Shot ${index} changed`);
    },
    [onCommit, say, time]
  );
  commitCameraRef.current = commitCamera;

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    const camera = viewCamera();
    if (!stage || !camera) return;
    onGestureStart();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = local(event);
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, point);
      if (touches.current.size === 2) {
        // A second finger: the one-finger gesture becomes a pinch.
        gestureRef.current = null;
        const [a, b] = [...touches.current.values()];
        pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, camera };
        stage.setInteractive(true);
        return;
      }
    }
    const panning = event.shiftKey || event.button === 1 || event.button === 2;
    const hit = panning ? null : stage.pick(point.x, point.y);
    const gesture: Gesture = { mode: panning ? 'pan' : 'orbit', pointerId: event.pointerId, startX: point.x, startY: point.y, camera, scene: sceneRef.current, clicked: hit, moved: false };
    if (hit && hit === selectedRef.current) {
      const actor = sceneRef.current.actors.find((a) => a.id === hit);
      if (actor) {
        const still = actorAt({ ...actor, motion: { float: 0, spin: 0 } }, time.get());
        gesture.mode = event.altKey ? 'turn' : 'move';
        gesture.actorId = hit;
        gesture.base = { position: still.position, turn: still.turn };
      }
    }
    gestureRef.current = gesture;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const point = local(event);
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, point);
      const pinch = pinchRef.current;
      if (pinch && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        let next = { ...pinch.camera, distance: Math.max(4, pinch.camera.distance * (pinch.distance / Math.max(1, distance))) };
        next = panBy(next, midX - pinch.midX, midY - pinch.midY, frameBox.height, aspect);
        pinchCamera.current = next;
        stage.setCameraOverride(next);
        return;
      }
    }
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = point.x - gesture.startX;
    const dy = point.y - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    if (!gesture.moved) {
      gesture.moved = true;
      stage.setInteractive(true);
    }
    if (gesture.mode === 'orbit' || gesture.mode === 'pan') {
      const camera = gesture.mode === 'orbit' ? orbitBy(gesture.camera, dx, dy, frameBox.height) : panBy(gesture.camera, dx, dy, frameBox.height, aspect);
      gesture.live = { camera };
      stage.setCameraOverride(camera);
      return;
    }
    if (!gesture.actorId || !gesture.base) return;
    let values;
    if (gesture.mode === 'move') {
      // Moves the device in the picture's plane, at its own depth, so it stays under the pointer.
      const pose = cameraPose(gesture.camera, aspect);
      const p = gesture.base.position;
      const forward = { x: pose.target.x - pose.position.x, y: pose.target.y - pose.position.y, z: pose.target.z - pose.position.z };
      const length = Math.hypot(forward.x, forward.y, forward.z) || 1;
      const depth = Math.max(1, ((p.x - pose.position.x) * forward.x + (p.y - pose.position.y) * forward.y + (p.z - pose.position.z) * forward.z) / length);
      const perPixel = (2 * depth * Math.tan((pose.fov * Math.PI) / 360)) / Math.max(1, frameBox.height);
      values = {
        position: {
          x: p.x + (pose.right.x * dx - pose.up.x * dy) * perPixel,
          y: Math.max(0, p.y + (pose.right.y * dx - pose.up.y * dy) * perPixel),
          z: p.z + (pose.right.z * dx - pose.up.z * dy) * perPixel,
        },
      };
    } else {
      const t = gesture.base.turn;
      values = { turn: { yaw: t.yaw + dx * 0.5, pitch: t.pitch + dy * 0.5, roll: t.roll } };
    }
    const next = setPoseAt(gesture.scene, gesture.actorId, time.get(), values).scene;
    gesture.live = { scene: next };
    stage.setScene(next);
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const stage = stageRef.current;
    if (event.pointerType === 'touch') {
      touches.current.delete(event.pointerId);
      const pinch = pinchRef.current;
      if (pinch) {
        if (touches.current.size < 2) {
          pinchRef.current = null;
          const camera = pinchCamera.current;
          stage?.setInteractive(playing);
          if (camera && !cancelled) endCamera(camera);
          else if (!outsideRef.current) stage?.setCameraOverride(null);
        }
        return;
      }
    }
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (!stage) return;
    stage.setInteractive(playing);
    if (!gesture.moved) {
      // A click: picks what is under it, or nothing.
      onSelectActor(gesture.clicked);
      return;
    }
    if (gesture.live?.camera) {
      if (cancelled) {
        stage.setCameraOverride(outsideRef.current ? directorRef.current : null);
        return;
      }
      endCamera(gesture.live.camera);
      return;
    }
    if (gesture.live?.scene) {
      if (cancelled) {
        stage.setScene(sceneRef.current);
        return;
      }
      onCommit(gesture.live.scene);
    }
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    const camera = viewCamera();
    if (!stage || !camera || outsideRef.current) return;
    const point = local(event);
    const hit = stage.pick(point.x, point.y);
    if (!hit) return;
    const actor = sceneRef.current.actors.find((a) => a.id === hit);
    commitCamera(cameraOnActor(sceneRef.current, hit, time.get(), camera));
    if (actor) say(`The camera looks at ${actor.name}`);
  };

  // Wheel and trackpad, registered by hand: React's wheel listeners are passive and can't stop the page zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const wheel = wheelRef.current;
      const camera = wheel?.camera ?? viewCamera();
      if (!camera) return;
      onGestureStart();
      let next: CameraState;
      if (event.ctrlKey) {
        // A pinch on a trackpad comes as a wheel with Ctrl held, in small steps.
        next = dollyBy(camera, event.deltaY * 6);
      } else if (isMouseWheel(event)) {
        const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
        next = dollyBy(camera, Math.max(-240, Math.min(240, pixels)));
      } else {
        next = orbitBy(camera, -event.deltaX * 0.6, -event.deltaY * 0.6, frameBox.height);
      }
      stage.setInteractive(true);
      stage.setCameraOverride(next);
      if (wheel) window.clearTimeout(wheel.timer);
      wheelRef.current = {
        camera: next,
        timer: window.setTimeout(() => {
          wheelRef.current = null;
          stage.setInteractive(false);
          endCamera(next);
        }, 320),
      };
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [endCamera, frameBox.height, onGestureStart, stageRef, generation]);

  return (
    <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,hsl(var(--muted))_0%,hsl(var(--background))_75%)]" data-testid="limelight-viewport">
      {stageError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground" role="alert">
          <p className="max-w-sm">{stageError}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              rebuilds.current = [];
              setStageError(null);
              setGeneration((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shadow-2xl ring-1 ring-black/10" style={{ width: frameBox.width, height: frameBox.height }}>
          <div
            ref={canvasRef}
            role="application"
            className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
            aria-label="3D stage: drag to move the camera, scroll to zoom, click a device and drag it to move it"
            data-testid="limelight-stage"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => endPointer(event)}
            onPointerCancel={(event) => endPointer(event, true)}
            onDoubleClick={onDoubleClick}
            onContextMenu={(event) => event.preventDefault()}
          />
          <div
            ref={selectionRef}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 hidden rounded-lg border-2 border-primary/80 shadow-[0_0_0_9999px_transparent]"
          />
          {note && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white" role="status">
              {note}
            </div>
          )}
        </div>
      )}
      <div className="absolute left-3 top-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 gap-1.5 px-2 text-xs shadow-sm"
          title={outside ? 'Shows the whole stage and the path of the camera' : 'Moves the camera back until every device and title is in the shot, at the playhead'}
          onClick={() => {
            if (outsideRef.current) {
              directorRef.current = directorCamera(sceneRef.current, sceneRef.current.format.width / sceneRef.current.format.height);
              stageRef.current?.setCameraOverride(directorRef.current);
              return;
            }
            const camera = viewCamera();
            if (!camera) return;
            onGestureStart();
            commitCamera(cameraToFitAll(sceneRef.current, time.get(), camera));
          }}
        >
          <ScanIcon className="h-3.5 w-3.5" />
          Fit all
        </Button>
        <Button
          type="button"
          size="sm"
          variant={outside ? 'default' : 'secondary'}
          className="ml-1.5 h-7 gap-1.5 px-2 text-xs shadow-sm"
          aria-pressed={outside}
          title={outside ? 'Back to what the video shows' : "Look at the stage from outside, with the camera's path and shots"}
          onClick={toggleOutside}
        >
          {outside ? <VideoIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
          {outside ? 'Through the camera' : 'From outside'}
        </Button>
      </div>
      {outside && (
        <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-background/85 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm">
          The line is the camera's path. Dots are shots; the orange shape is the camera now
        </div>
      )}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-1 flex flex-wrap justify-center gap-x-3 gap-y-0.5 px-4 text-[11px] text-muted-foreground transition-opacity',
          playing && 'opacity-0'
        )}
      >
        <span className="whitespace-nowrap">Drag to move the camera</span>
        <span className="whitespace-nowrap">Shift-drag to slide</span>
        <span className="whitespace-nowrap">Scroll to zoom</span>
        <span className="whitespace-nowrap">Click a phone, then drag it to move it</span>
      </div>
    </div>
  );
}
