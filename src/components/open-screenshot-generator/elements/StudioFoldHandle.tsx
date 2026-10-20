"use client";
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { FoldHorizontal, FoldVertical } from 'lucide-react';
import type { DeviceFrameElementProps } from '@/types/artboard';
import type { SelectionChrome } from './DraggableElement';
import {
  FOLD_GRIP_REACH,
  studioFoldGrip,
  studioFoldTo,
  studioFrame,
  studioLensOf,
  studioModelFor,
  studioOrientationOf,
  studioPostureOf,
  withStudioRehug,
  type StudioFrame,
} from '@/lib/device3dStudio';
import { endStudioLive, publishStudioLive } from '@/lib/device3dStudioLive';
import { screenScaleOf, toElementSpace } from './studioHandleSpace';

interface StudioFoldHandleProps {
  element: DeviceFrameElementProps;
  chrome: SelectionChrome;
  /** Writes one finished fold, box included, as a single edit. */
  onCommit: (updates: Partial<DeviceFrameElementProps>) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  /** Where the grip was as the drag began, in box pixels. */
  grip: { x: number; y: number };
  /** The frame the renderer keeps drawing at until the fold lands. */
  frame: StudioFrame;
  reach: number;
  start: number;
  latest: number;
  moved: boolean;
}

const SNAP_DEGREES = 15;
const DRAG_THRESHOLD_PX = 3;
const FLAT = 180;
/** How far out the grip is tried, nearest the hinge first, until it clears the rotate handle. */
const REACHES = [FOLD_GRIP_REACH, 0.85, 0.95];
/** The rotate handle's size at the centre, which the grip keeps clear of. */
const ROTATE_HANDLE_SIZE = 30;
const GRIP_SIZE = 26;

/**
 * A foldable's fold grip: a round handle on the half that swings, which a
 * drag folds and unfolds to any opening. The half follows the pointer round
 * its swing at whatever angle the device is turned to, Shift snaps to 15
 * degrees, and a double-click opens it flat.
 *
 * Like the rotate handle, nothing commits while the drag is in flight: the
 * renderer follows through device3dStudioLive, and the release writes the
 * opening together with the box fitted round the new silhouette, so one fold
 * is one undo step. Esc during a drag puts the phone back as it was.
 */
export function StudioFoldHandle({ element, chrome, onCommit }: StudioFoldHandleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const model = studioModelFor(element.deviceType);
  const [live, setLive] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const elementRef = useRef(element);
  elementRef.current = element;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const commit = (opening: number) => {
    const current = elementRef.current;
    const currentModel = studioModelFor(current.deviceType);
    const next = Math.round(opening);
    if (currentModel && Math.abs(next - studioPostureOf(current, currentModel).opening) >= 0.5) {
      commitRef.current(withStudioRehug(current, { fold3d: next }));
    }
    endStudioLive(current.id);
    setLive(null);
  };

  // Leaving the selection (or the canvas) mid-drag drops the preview.
  useEffect(() => {
    const id = element.id;
    return () => endStudioLive(id, 'cancel');
  }, [element.id]);

  // Esc cancels a drag in flight.
  useEffect(() => {
    if (live === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = null;
      endStudioLive(elementRef.current.id, 'cancel');
      setLive(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [live]);

  if (!model?.fold) return null;

  // ---- geometry, in the element's own box pixels -----------------------------
  const orientation = studioOrientationOf(element);
  const lens = studioLensOf(element);
  const posture = studioPostureOf(element, model);
  const scale = element.scale || 1;
  const boxW = element.size.width * scale;
  const boxH = element.size.height * scale;
  const hs = chrome.handleScale;
  const size = GRIP_SIZE * hs;
  const drag = dragRef.current;

  let frame: StudioFrame;
  let reach: number;
  let grip: { x: number; y: number };
  if (drag && live !== null) {
    frame = drag.frame;
    reach = drag.reach;
    grip = studioFoldGrip(model, orientation, lens, { opening: live, across: posture.across }, frame, boxW, boxH, reach);
  } else {
    frame = studioFrame(model, orientation, lens, boxW, boxH, posture);
    // The rotate handle sits on the device centre; the grip moves out along
    // its half until the two are clear of each other.
    const cx = boxW / 2 - frame.centerU * frame.scale;
    const cy = boxH / 2 + frame.centerV * frame.scale;
    const clear = ((ROTATE_HANDLE_SIZE + GRIP_SIZE) / 2 + 6) * hs;
    reach = REACHES[REACHES.length - 1];
    grip = studioFoldGrip(model, orientation, lens, posture, frame, boxW, boxH, reach);
    for (const r of REACHES) {
      const g = studioFoldGrip(model, orientation, lens, posture, frame, boxW, boxH, r);
      if (Math.hypot(g.x - cx, g.y - cy) >= clear) {
        reach = r;
        grip = g;
        break;
      }
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || dragRef.current) return;
    // Mouse only: preventing a touch pointerdown makes Chromium drop the whole
    // touch stream, which the canvas pinch and long press listen to.
    if (e.pointerType === 'mouse') e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grip,
      frame,
      reach,
      start: posture.opening,
      latest: posture.opening,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
    }
    const move = toElementSpace(e.clientX - d.startX, e.clientY - d.startY, screenScaleOf(rootRef.current), element.rotation || 0);
    const pointer = { x: d.grip.x + move.x, y: d.grip.y + move.y };
    let next = studioFoldTo(model, orientation, lens, posture.across, d.frame, boxW, boxH, pointer, d.latest, d.reach);
    if (e.shiftKey) next = Math.round(next / SNAP_DEGREES) * SNAP_DEGREES;
    d.latest = next;
    setLive(next);
    publishStudioLive(element.id, { fold: next });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    dragRef.current = null;
    if (!d.moved) {
      setLive(null);
      return;
    }
    commit(d.latest);
  };

  const shown = live ?? posture.opening;
  // The hinge runs side to side on screen when it is across, so the halves close up and down.
  const Icon = posture.across ? FoldVertical : FoldHorizontal;
  return (
    <div ref={rootRef} data-export-exclude className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
      <button
        type="button"
        data-interaction-handle
        aria-label="Fold or unfold"
        title="Drag to fold or unfold. Double-click to open flat"
        className="absolute flex items-center justify-center rounded-full border border-primary bg-background/90 text-primary shadow-md pointer-events-auto hover:bg-accent"
        style={{
          left: grip.x - size / 2,
          top: grip.y - size / 2,
          width: size,
          height: size,
          borderWidth: Math.max(1, hs * 0.8),
          cursor: live !== null ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          e.stopPropagation();
          commit(FLAT);
        }}
      >
        <Icon style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={2} />
      </button>
      {live !== null && (
        <div
          className="absolute whitespace-nowrap rounded-full border bg-background/95 text-muted-foreground shadow-md tabular-nums"
          style={{
            left: grip.x,
            top: grip.y + size / 2 + 8 * hs,
            transform: 'translateX(-50%)',
            fontSize: 11 * hs,
            padding: `${3 * hs}px ${9 * hs}px`,
          }}
        >
          Opening {Math.round(shown)}°
        </div>
      )}
    </div>
  );
}
