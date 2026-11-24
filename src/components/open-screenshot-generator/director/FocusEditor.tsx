"use client";

// Where a close-up looks: the recording's frame at the moment, with a box
// to drag and resize. Works with a finger too (pointer events, no hover).

import React, { useEffect, useRef, useState } from 'react';
import type { Rect01 } from '@/lib/director/types';

const MIN = 0.08;

export function FocusEditor({ video, focus, onChange }: { video: HTMLVideoElement; focus: Rect01; onChange: (focus: Rect01) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Rect01 | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'corner'; x: number; y: number; from: Rect01 } | null>(null);
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 0.46;

  // The frame on screen now, drawn again after every seek.
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || !video.videoWidth) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    };
    draw();
    video.addEventListener('seeked', draw);
    video.addEventListener('loadeddata', draw);
    return () => {
      video.removeEventListener('seeked', draw);
      video.removeEventListener('loadeddata', draw);
    };
  }, [video]);

  const shown = draft ?? focus;

  const begin = (event: React.PointerEvent, mode: 'move' | 'corner') => {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { mode, x: event.clientX, y: event.clientY, from: shown };
  };

  const move = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const box = boxRef.current;
    if (!drag || !box) return;
    const dx = (event.clientX - drag.x) / box.clientWidth;
    const dy = (event.clientY - drag.y) / box.clientHeight;
    const f = drag.from;
    if (drag.mode === 'move') {
      setDraft({ ...f, x: Math.min(1 - f.w, Math.max(0, f.x + dx)), y: Math.min(1 - f.h, Math.max(0, f.y + dy)) });
    } else {
      setDraft({ ...f, w: Math.min(1 - f.x, Math.max(MIN, f.w + dx)), h: Math.min(1 - f.y, Math.max(MIN, f.h + dy)) });
    }
  };

  const end = () => {
    if (dragRef.current && draft) onChange(draft);
    dragRef.current = null;
    setDraft(null);
  };

  return (
    <div
      ref={boxRef}
      className="relative mx-auto w-full max-w-[11rem] overflow-hidden rounded-lg border bg-black touch-none"
      style={{ aspectRatio: String(aspect) }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      data-testid="director-focus-editor"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-0 bg-black/45" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${shown.x * 100}% ${shown.y * 100}%, ${shown.x * 100}% ${(shown.y + shown.h) * 100}%, ${(shown.x + shown.w) * 100}% ${(shown.y + shown.h) * 100}%, ${(shown.x + shown.w) * 100}% ${shown.y * 100}%, ${shown.x * 100}% ${shown.y * 100}%)` }} />
      <div
        role="button"
        tabIndex={0}
        aria-label="Move what the close-up shows"
        className="absolute cursor-move rounded-[3px] border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }}
        onPointerDown={(e) => begin(e, 'move')}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.05 : 0.01;
          const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          const delta = moves[e.key];
          if (!delta) return;
          e.preventDefault();
          onChange({ ...focus, x: Math.min(1 - focus.w, Math.max(0, focus.x + delta[0])), y: Math.min(1 - focus.h, Math.max(0, focus.y + delta[1])) });
        }}
      >
        <span
          aria-hidden
          className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-primary shadow"
          onPointerDown={(e) => begin(e, 'corner')}
        />
      </div>
    </div>
  );
}
