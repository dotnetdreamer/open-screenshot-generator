"use client";

// The page a phone opens from Director's QR code: the phone becomes the
// camera rig for the film on the computer. It sends how the phone is turned
// (and a pinch, for moving closer) many times a second, and starts and stops
// a take. Works in Safari on iPhone and Chrome on Android, nothing to install.

import React, { useEffect, useRef, useState } from 'react';
import { CircleIcon, CrosshairIcon, Loader2Icon, SmartphoneIcon, SquareIcon } from 'lucide-react';
import { readRemoteFragment, RoomLink, type LinkStatus } from '@/lib/director/link';
import { askForMotion, keepScreenOn, PhoneMotion } from '@/lib/director/sensors';
import { IDENTITY, type Quat } from '@/lib/director/motion';
import { cn } from '@/lib/utils';

type Stage = 'no-link' | 'connecting' | 'ready' | 'live' | 'gone' | 'failed';

/** A CSS matrix for a turn, so the small phone on screen turns like the real one. */
function cssTurn(q: Quat): string {
  const [x, y, z, w] = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  // CSS y runs down the page: flip y on both sides of the turn.
  const flip = [1, -1, 1, 1];
  const out = m.map((v, i) => v * flip[i % 4] * flip[Math.floor(i / 4)]);
  return `matrix3d(${out.map((v) => v.toFixed(5)).join(',')})`;
}

export function PhoneRemote() {
  const [stage, setStage] = useState<Stage>('connecting');
  const [status, setStatus] = useState<LinkStatus>('starting');
  const [note, setNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [clock, setClock] = useState({ t: 0, duration: 0 });
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState<Quat>(IDENTITY);
  const linkRef = useRef<RoomLink | null>(null);
  const motionRef = useRef<PhoneMotion | null>(null);
  const zoomRef = useRef(1);
  const pinchRef = useRef<{ ids: Map<number, { x: number; y: number }>; startDistance: number; startZoom: number }>({ ids: new Map(), startDistance: 0, startZoom: 1 });
  const releaseRef = useRef<(() => void) | null>(null);
  const lastPaint = useRef(0);

  // The link is the part after #. A new one in the same tab (another code
  // scanned, or the link pasted in) changes only that part, and the page
  // doesn't load again, so it's followed here.
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  useEffect(() => {
    if (hash === null) return;
    const target = readRemoteFragment(hash);
    if (!target) {
      setStage('no-link');
      return;
    }
    setStage('connecting');
    setNote(null);
    const link = new RoomLink('phone', target.ticket, {
      onStatus: (next, detail) => {
        setStatus(next);
        if (next === 'failed') {
          setStage('failed');
          setNote(detail ?? null);
        }
      },
      onPeer: (present) => setStage((current) => (present ? (current === 'connecting' ? 'ready' : current) : 'gone')),
      onState: (state) => {
        setRecording(state.recording);
        setClock({ t: state.t, duration: state.duration });
      },
    }, target.room);
    linkRef.current = link;
    link.connect().catch(() => setStage('failed'));
    return () => {
      link.close();
      motionRef.current?.stop();
      motionRef.current = null;
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [hash]);

  const start = async () => {
    const access = await askForMotion();
    if (access !== 'granted') {
      setNote(
        access === 'denied'
          ? 'Motion is off for this page. Reload it and tap Allow when your phone asks.'
          : access === 'insecure'
            ? "This page needs https to read the phone's movement."
            : "This browser doesn't share the phone's movement. Try Safari or Chrome."
      );
      return;
    }
    setNote(null);
    const motion = new PhoneMotion();
    motionRef.current = motion;
    let heard = false;
    motion.start(
      (q) => {
        // Readings came after all: the note about the sensors no longer holds.
        if (!heard) {
          heard = true;
          setNote(null);
        }
        linkRef.current?.sendMotion({ q, zoom: zoomRef.current });
        // The small phone on screen, at most 30 times a second.
        const now = performance.now();
        if (now - lastPaint.current > 33) {
          lastPaint.current = now;
          setTurn(q);
        }
      },
      () => setNote("No movement is coming from this phone's sensors.")
    );
    releaseRef.current = await keepScreenOn();
    setStage('live');
  };

  const record = (on: boolean) => {
    linkRef.current?.sendRecord(on);
    if ('vibrate' in navigator) navigator.vibrate?.(on ? 30 : [20, 40, 20]);
  };

  // Two fingers pinch to move closer or farther; a double tap puts it back.
  const onPointerDown = (event: React.PointerEvent) => {
    const pinch = pinchRef.current;
    pinch.ids.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.ids.size === 2) {
      const [a, b] = Array.from(pinch.ids.values());
      pinch.startDistance = Math.hypot(a.x - b.x, a.y - b.y);
      pinch.startZoom = zoomRef.current;
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const pinch = pinchRef.current;
    if (!pinch.ids.has(event.pointerId)) return;
    pinch.ids.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.ids.size === 2 && pinch.startDistance > 0) {
      const [a, b] = Array.from(pinch.ids.values());
      const next = Math.min(2.5, Math.max(0.7, (pinch.startZoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.startDistance));
      zoomRef.current = next;
      setZoom(next);
    }
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pinchRef.current.ids.delete(event.pointerId);
  };

  const shell = 'flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-[#07080d] px-6 text-center text-white';

  if (stage === 'no-link') {
    return (
      <main className={shell}>
        <SmartphoneIcon className="h-8 w-8 text-white/60" />
        <h1 className="text-lg font-semibold">Open this page from Director</h1>
        <p className="max-w-xs text-sm text-white/60">On your computer, open Director, press Use your phone, and scan the code with this phone&apos;s camera.</p>
      </main>
    );
  }
  if (stage === 'connecting') {
    return (
      <main className={shell}>
        <Loader2Icon className="h-7 w-7 animate-spin text-white/70" />
        <p className="text-sm text-white/70">Connecting to your computer</p>
      </main>
    );
  }
  if (stage === 'failed' || stage === 'gone') {
    return (
      <main className={shell}>
        <SmartphoneIcon className="h-8 w-8 text-white/60" />
        <h1 className="text-lg font-semibold">{stage === 'gone' ? 'Your computer closed the link' : "Couldn't connect"}</h1>
        <p className="max-w-xs text-sm text-white/60">{note ?? 'Press Use your phone in Director again and scan the new code.'}</p>
      </main>
    );
  }
  if (stage === 'ready') {
    return (
      <main className={shell}>
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg">
          <SmartphoneIcon className="h-8 w-8" />
        </div>
        <h1 className="text-xl font-semibold">Connected to Director</h1>
        <p className="max-w-xs text-sm text-white/65">Move this phone and the phone in the video moves the same way. Your phone will ask to share its movement.</p>
        <button type="button" onClick={() => void start()} className="w-full max-w-xs rounded-2xl bg-white px-6 py-4 text-base font-semibold text-black active:scale-[0.98]" data-testid="remote-start">
          Start
        </button>
        {note && <p className="max-w-xs text-sm text-amber-300">{note}</p>}
      </main>
    );
  }

  const seconds = (v: number) => `${v.toFixed(1)}s`;
  return (
    <main
      className="flex min-h-[100dvh] touch-none select-none flex-col bg-[#07080d] text-white"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        zoomRef.current = 1;
        setZoom(1);
      }}
      data-testid="remote-live"
    >
      <div className="flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] text-xs text-white/70">
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', recording ? 'animate-pulse bg-red-500' : 'bg-emerald-400')} />
          {recording ? `Recording ${seconds(clock.t)} of ${seconds(clock.duration)}` : status === 'direct' ? 'Connected' : 'Connected through the internet'}
        </span>
        <span className="tabular-nums">Zoom {zoom.toFixed(1)}x</span>
      </div>

      <div className="flex flex-1 items-center justify-center [perspective:700px]">
        <div
          className="h-48 w-24 rounded-[1.6rem] border-[3px] border-white/80 bg-gradient-to-br from-indigo-500/40 to-fuchsia-500/30 shadow-[0_30px_60px_-20px_rgba(99,102,241,0.6)]"
          style={{ transform: `${cssTurn(turn)} scale(${zoom})` }}
          aria-hidden
        />
      </div>

      <p className="px-6 text-center text-xs text-white/55">Hold the phone the way the phone in the video should face, then press Center. Pinch to move closer.</p>
      {note && <p className="px-6 pt-2 text-center text-xs text-amber-300">{note}</p>}

      <div className="grid grid-cols-2 gap-3 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <button
          type="button"
          onClick={() => motionRef.current?.center()}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-4 text-sm font-semibold active:bg-white/20"
          data-testid="remote-center"
        >
          <CrosshairIcon className="h-4 w-4" />
          Center
        </button>
        <button
          type="button"
          onClick={() => record(!recording)}
          className={cn('flex items-center justify-center gap-2 rounded-2xl px-4 py-4 text-sm font-semibold active:scale-[0.98]', recording ? 'bg-white text-black' : 'bg-red-600 text-white')}
          data-testid="remote-record"
        >
          {recording ? <SquareIcon className="h-4 w-4 fill-current" /> : <CircleIcon className="h-4 w-4 fill-current" />}
          {recording ? 'Stop' : 'Record a take'}
        </button>
      </div>
    </main>
  );
}
