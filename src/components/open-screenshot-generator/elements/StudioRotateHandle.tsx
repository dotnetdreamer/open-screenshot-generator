"use client";
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Rotate3d } from 'lucide-react';
import type { Device3DOrientation, DeviceFrameElementProps } from '@/types/artboard';
import type { SelectionChrome } from './DraggableElement';
import {
  sameOrientation,
  studioFrame,
  studioLensOf,
  studioModelFor,
  studioOrientationOf,
  studioSphereRadius,
  turntableTurn,
  withStudioRehug,
} from '@/lib/device3dStudio';
import { endStudioLive, publishStudioLive } from '@/lib/device3dStudioLive';

interface StudioRotateHandleProps {
  element: DeviceFrameElementProps;
  chrome: SelectionChrome;
  /** Writes one finished turn, box included, as a single edit. */
  onCommit: (updates: Partial<DeviceFrameElementProps>) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  start: Device3DOrientation;
  moved: boolean;
  latest: Device3DOrientation;
}

const SNAP_DEGREES = 15;
const DRAG_THRESHOLD_PX = 3;
const FRONT: Device3DOrientation = { yaw: 0, pitch: 0, roll: 0 };

/**
 * The 3D Studio device's rotate handle: a round grip at the centre of the
 * selected device, the way 3D models are turned in slide apps. Dragging it
 * turns the device like a turntable, across to spin it round its long side
 * and up or down to tip it, and Shift snaps to 15 degrees. Dragging anywhere
 * else on the device still moves it, and the grips round the box still resize
 * and spin it flat, so there is no mode to enter or leave. A double-click on
 * the handle turns the device back to face the front.
 *
 * Nothing commits while a drag is in flight: the renderer follows through
 * device3dStudioLive, and the release writes the angle together with the box
 * fitted round the new silhouette, so one turn is one undo step. Esc during a
 * drag puts the device back where it was.
 */
export function StudioRotateHandle({ element, chrome, onCommit }: StudioRotateHandleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const model = studioModelFor(element.deviceType);
  const committed = studioOrientationOf(element);
  const lens = studioLensOf(element);
  const [live, setLive] = useState<Device3DOrientation | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // Read by listeners that outlive the render that made them.
  const elementRef = useRef(element);
  elementRef.current = element;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const commit = (next: Device3DOrientation) => {
    const current = elementRef.current;
    if (!sameOrientation(next, studioOrientationOf(current), 0.005)) {
      commitRef.current(withStudioRehug(current, { rotation3d: next }));
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
    if (!live) return;
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

  if (!model) return null;

  // ---- geometry, in the element's own box pixels -----------------------------
  const scale = element.scale || 1;
  const boxW = element.size.width * scale;
  const boxH = element.size.height * scale;
  const frame = studioFrame(model, committed, lens, boxW, boxH);
  // The device centre in the box, and how far a drag must go to turn it.
  const ox = boxW / 2 - frame.centerU * frame.scale;
  const oy = boxH / 2 + frame.centerV * frame.scale;
  const radius = studioSphereRadius(model, lens) * frame.scale;
  const hs = chrome.handleScale;
  const size = 30 * hs;

  /** Screen pixels per artboard pixel, measured, so every zoom is right. */
  const screenScale = () => {
    const wrapper = rootRef.current?.parentElement;
    const board = wrapper?.offsetParent as HTMLElement | null;
    if (board && board.offsetWidth > 0) return board.getBoundingClientRect().width / board.offsetWidth;
    return 0.3;
  };
  /** A screen-space vector in the element's own (unrotated) frame, artboard px. */
  const toLocal = (dx: number, dy: number) => {
    const k = screenScale() || 1;
    const a = (-(element.rotation || 0) * Math.PI) / 180;
    const x = dx / k;
    const y = dy / k;
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  };

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
      start: committed,
      moved: false,
      latest: committed,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    const d = toLocal(e.clientX - drag.startX, e.clientY - drag.startY);
    const next = turntableTurn(drag.start, d.x, d.y, radius, e.shiftKey ? SNAP_DEGREES : 0);
    drag.latest = next;
    setLive(next);
    publishStudioLive(element.id, { orientation: next });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    dragRef.current = null;
    if (!drag.moved) {
      setLive(null);
      return;
    }
    commit(drag.latest);
  };

  const shown = live ?? committed;
  return (
    <div ref={rootRef} data-export-exclude className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
      <button
        type="button"
        data-interaction-handle
        aria-label="Rotate in 3D"
        title="Drag to turn in 3D. Double-click to face the front"
        className="absolute flex items-center justify-center rounded-full border border-primary bg-background/90 text-primary shadow-md pointer-events-auto hover:bg-accent"
        style={{
          left: ox - size / 2,
          top: oy - size / 2,
          width: size,
          height: size,
          borderWidth: Math.max(1, hs * 0.8),
          cursor: live ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          e.stopPropagation();
          commit(FRONT);
        }}
      >
        <Rotate3d style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={2} />
      </button>
      {live && (
        <div
          className="absolute whitespace-nowrap rounded-full border bg-background/95 text-muted-foreground shadow-md tabular-nums"
          style={{
            left: ox,
            top: oy + size / 2 + 8 * hs,
            transform: 'translateX(-50%)',
            fontSize: 11 * hs,
            padding: `${3 * hs}px ${9 * hs}px`,
          }}
        >
          Turn {Math.round(shown.yaw)}°, tilt {Math.round(shown.pitch)}°
        </div>
      )}
    </div>
  );
}
