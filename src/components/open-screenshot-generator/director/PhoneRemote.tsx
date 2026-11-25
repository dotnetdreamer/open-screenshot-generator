"use client";

// The page a phone opens from Director's QR code: the phone becomes the
// camera rig for the film on the computer. It sends how the phone is turned
// (and a pinch, for moving closer) many times a second, and starts and stops
// a take. Works in Safari on iPhone and Chrome on Android, nothing to install.

import React, { useEffect, useRef, useState } from 'react';
import { CircleIcon, CrosshairIcon, Loader2Icon, SmartphoneIcon, SquareIcon } from 'lucide-react';
import { readRemoteFragment, RoomLink, type LinkStatus } from '@/lib/director/link';
import { depthZoom } from '@/lib/director/depth';
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
  /** Pinch and distance together, as sent: for the zoom shown on this screen. */
  const [shownZoom, setShownZoom] = useState(1);
  const [turn, setTurn] = useState<Quat>(IDENTITY);
  /** Forward and back, as the computer has it: off unless turned on there or here. */
  const [depthOn, setDepthOn] = useState(false);
  const depthOnRef = useRef(false);
  depthOnRef.current = depthOn;
  /** Forward and back as last tapped here, until the computer says the same or 3 seconds pass. */
  const depthAskedRef = useRef<{ on: boolean; at: number; sent: number } | null>(null);
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
        const on = state.depth;
        if (on === undefined) return;
        const asked = depthAskedRef.current;
        const now = performance.now();
        if (asked && now - asked.at < 3000) {
          // Tapped here and the computer hasn't caught up: ask again, at most every 0.4 seconds.
          if (on === asked.on) depthAskedRef.current = null;
          else if (now - asked.sent > 400) {
            asked.sent = now;
            linkRef.current?.sendDepth(asked.on);
          }
          return;
        }
        depthAskedRef.current = null;
        if (on !== depthOnRef.current) {
          // Turned on at the computer: the distance starts from where the phone is now.
          if (on) motionRef.current?.restartDepth();
          depthOnRef.current = on;
          setDepthOn(on);
        }
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
          ? 'Reload this page, tap Turn on tilt controls and allow access to motion when asked'
          : access === 'insecure'
            ? 'To use tilt controls, open this page at a secure address beginning with https://'
            : 'For tilt controls, open this link in Safari on iPhone or Chrome on Android'
      );
      return;
    }
    setNote(null);
    const motion = new PhoneMotion();
    motionRef.current = motion;
    let heard = false;
    motion.start(
      (q, _t, depth) => {
        // Readings came after all: the note about the sensors no longer holds.
        if (!heard) {
          heard = true;
          setNote(null);
        }
        // The distance goes only while forward and back is on.
        linkRef.current?.sendMotion(depthOnRef.current ? { q, zoom: zoomRef.current, depth } : { q, zoom: zoomRef.current });
        const total = zoomRef.current * (depthOnRef.current ? depthZoom(depth) : 1);
        // The small phone on screen, at most 30 times a second.
        const now = performance.now();
        if (now - lastPaint.current > 33) {
          lastPaint.current = now;
          setTurn(q);
          setShownZoom(total);
        }
      },
      () => setNote("Tilt your phone to check that the preview turns with it")
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
        <h1 className="text-lg font-semibold">Connect this phone to Director</h1>
        <p className="max-w-xs text-sm text-white/60">On your computer, open your video in Director and choose <strong>Connect a phone</strong></p>
        <p className="max-w-xs text-sm text-white/60">On this phone, scan the QR code with the camera and tap the link</p>
      </main>
    );
  }
  if (stage === 'connecting') {
    return (
      <main className={shell}>
        <Loader2Icon className="h-7 w-7 animate-spin text-white/70" />
        <p className="text-sm text-white/70">Connecting to Director on your computer</p>
      </main>
    );
  }
  if (stage === 'failed' || stage === 'gone') {
    return (
      <main className={shell}>
        <SmartphoneIcon className="h-8 w-8 text-white/60" />
        <h1 className="text-lg font-semibold">{stage === 'gone' ? 'Your computer disconnected' : "This phone couldn't connect"}</h1>
        <p className="max-w-xs text-sm text-white/60">{note ?? 'Choose Connect a phone on your computer, then scan the new QR code with this phone'}</p>
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
        <p className="max-w-xs text-sm text-white/65">To control the camera by tilting this phone, tap Allow if your browser asks for access to motion</p>
        <button type="button" onClick={() => void start()} className="w-full max-w-xs rounded-2xl bg-white px-6 py-4 text-base font-semibold text-black active:scale-[0.98]" data-testid="remote-start">
          Turn on tilt controls
        </button>
        {note && <p className="max-w-xs text-sm text-amber-300">{note}</p>}
      </main>
    );
  }

  const seconds = (v: number) => `${v.toFixed(1)} s`;
  return (
    <main
      className="flex min-h-[100dvh] touch-none select-none flex-col bg-[#07080d] text-white"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        zoomRef.current = 1;
      }}
      data-testid="remote-live"
    >
      <div className="flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] text-xs text-white/70">
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', recording ? 'animate-pulse bg-red-500' : 'bg-emerald-400')} />
          {recording ? `Recording phone movements · ${seconds(clock.t)} of ${seconds(clock.duration)}` : status === 'direct' ? 'Connected to Director' : 'Connected to Director over the internet'}
        </span>
        <span className="tabular-nums" data-testid="remote-zoom">
          Zoom {shownZoom.toFixed(1)}x
        </span>
      </div>

      <div className="flex flex-1 items-center justify-center [perspective:700px]">
        <div
          className="h-48 w-24 rounded-[1.6rem] border-[3px] border-white/80 bg-gradient-to-br from-indigo-500/40 to-fuchsia-500/30 shadow-[0_30px_60px_-20px_rgba(99,102,241,0.6)]"
          style={{ transform: `${cssTurn(turn)} scale(${shownZoom})` }}
          aria-hidden
        />
      </div>

      <p className="px-6 text-center text-xs text-white/55">
        <span className="block">{recording
          ? 'Tilt your phone while the video plays to record its angles'
          : 'Hold your phone comfortably and tap Set starting angle before you tilt it'}</span>
        <span className="block">{depthOn ? 'Bring your phone toward you to zoom in or move it away to zoom out' : 'Spread two fingers to zoom in or pinch to zoom out'}</span>
      </p>
      {note && <p className="px-6 pt-2 text-center text-xs text-amber-300">{note}</p>}
      <div className="flex justify-center pt-3">
        <button
          type="button"
          onClick={() => {
            const next = !depthOnRef.current;
            const now = performance.now();
            depthAskedRef.current = { on: next, at: now, sent: now };
            depthOnRef.current = next;
            setDepthOn(next);
            if (next) motionRef.current?.restartDepth();
            linkRef.current?.sendDepth(next);
          }}
          aria-pressed={depthOn}
          className={cn('flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium', depthOn ? 'bg-white/15 text-white' : 'bg-white/5 text-white/60')}
          data-testid="remote-depth"
        >
          <span className={cn('h-2 w-2 rounded-full', depthOn ? 'bg-emerald-400' : 'bg-white/30')} />
          Zoom by moving your phone ({depthOn ? 'on' : 'off'})
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <button
          type="button"
          onClick={() => motionRef.current?.center()}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-4 text-sm font-semibold active:bg-white/20"
          data-testid="remote-center"
        >
          <CrosshairIcon className="h-4 w-4" />
          Set starting angle
        </button>
        <button
          type="button"
          onClick={() => record(!recording)}
          className={cn('flex items-center justify-center gap-2 rounded-2xl px-4 py-4 text-sm font-semibold active:scale-[0.98]', recording ? 'bg-white text-black' : 'bg-red-600 text-white')}
          data-testid="remote-record"
        >
          {recording ? <SquareIcon className="h-4 w-4 fill-current" /> : <CircleIcon className="h-4 w-4 fill-current" />}
          {recording ? 'Stop recording' : 'Start recording'}
        </button>
      </div>
    </main>
  );
}
