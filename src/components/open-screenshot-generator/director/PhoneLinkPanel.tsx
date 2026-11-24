"use client";

// Moving the phone in the film by hand. Two ways in:
//  - Your phone: the computer shows a code, the phone's camera opens a page
//    from it, and the 3D phone follows the real one live. Nothing to install.
//  - This phone: when Director itself runs on a phone, the phone's own
//    movement moves the 3D phone.
// Either way "Record a take" plays the film from the start and keeps every
// movement until the end, and the film then moves the way the hand did.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CircleIcon, CrosshairIcon, Loader2Icon, QrCodeIcon, SmartphoneIcon, SquareIcon, Trash2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { encodeQr, qrPath } from '@/lib/qr';
import { getTicket, isLinkConfigured, LinkSignInRequired, remotePageUrl, RoomLink, type LinkStatus, type MotionReading } from '@/lib/director/link';
import { compactSamples, steadySamples, TurnFilter, type Quat } from '@/lib/director/motion';
import { askForMotion, keepScreenOn, PhoneMotion } from '@/lib/director/sensors';
import { filmDuration } from '@/lib/director/frame';
import type { FilmPlayer } from '@/lib/director/player';
import type { Film, MotionSample, MotionTake } from '@/lib/director/types';
import { cn } from '@/lib/utils';
import type { LiveTurn } from './DirectorViewport';
import { InfoTip } from '../capture/InfoTip';

function QrCode({ text }: { text: string }) {
  const qr = useMemo(() => {
    try {
      return encodeQr(text, { ecc: 'M' });
    } catch (error) {
      console.error('The link is too long for a QR code', error);
      return null;
    }
  }, [text]);
  if (!qr) return null;
  const size = qr.size + 8;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-40 w-40 rounded-lg bg-white p-1 shadow-sm" role="img" aria-label="QR code for your phone" data-testid="director-qr" data-link={text}>
      <rect width={size} height={size} fill="#fff" />
      <path d={qrPath(qr, 4)} fill="#0b0b0f" />
    </svg>
  );
}

/** True where the phone the page runs on can move the film itself. */
function useThisPhoneCanMove(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    setCan(coarse && typeof DeviceOrientationEvent !== 'undefined');
  }, []);
  return can;
}

const STATUS_WORDS: Record<LinkStatus, string> = {
  starting: 'Getting ready',
  waiting: 'Scan the code with your phone',
  direct: 'Your phone is connected',
  relayed: 'Your phone is connected through the internet',
  closed: 'Not connected',
  failed: "Couldn't connect",
};

export function PhoneLinkPanel({
  film,
  player,
  live,
  getToken,
  onSignIn,
  onTake,
  onLiveChange,
  update,
}: {
  film: Film;
  player: FilmPlayer;
  live: LiveTurn;
  /** The account's sign-in, for the connection server. */
  getToken: () => string | null;
  onSignIn?: () => void;
  onTake: (take: MotionTake) => void;
  /** Tells the view a phone is moving the film live, so it draws on every reading. */
  onLiveChange: () => void;
  update: (change: (film: Film) => Film) => void;
}) {
  const [mode, setMode] = useState<'off' | 'link' | 'this'>('off');
  const [status, setStatus] = useState<LinkStatus>('closed');
  const [detail, setDetail] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [following, setFollowing] = useState(true);
  const [motionNote, setMotionNote] = useState<string | null>(null);
  const linkRef = useRef<RoomLink | null>(null);
  const motionRef = useRef<PhoneMotion | null>(null);
  const filterRef = useRef(new TurnFilter());
  const samplesRef = useRef<MotionSample[]>([]);
  const recordingRef = useRef(false);
  const followingRef = useRef(true);
  const releaseWakeRef = useRef<(() => void) | null>(null);
  const thisPhone = useThisPhoneCanMove();
  const filmRef = useRef(film);
  filmRef.current = film;
  followingRef.current = following;

  /** One reading from either source: shown live, and kept when a take is being recorded. */
  const onReading = (q: Quat, zoom: number) => {
    const steady = filterRef.current.push(q, performance.now() / 1000);
    live.current = followingRef.current || recordingRef.current ? { q: steady, zoom } : null;
    if (recordingRef.current) {
      // The reading is a little late by the time it arrives: a direct link takes a few hundredths of a second.
      const late = linkRef.current?.currentStatus === 'relayed' ? 0.09 : 0.03;
      samplesRef.current.push({ t: Math.max(0, player.time - (mode === 'this' ? 0 : late)), q, zoom });
    }
    onLiveChange();
  };

  const stopRecording = (keep: boolean) => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    player.pause();
    player.loop = true;
    const samples = samplesRef.current;
    samplesRef.current = [];
    if (keep && samples.length >= 10) {
      const take: MotionTake = {
        id: `take_${Date.now().toString(36)}`,
        recordedAt: Date.now(),
        samples: compactSamples(steadySamples(samples)),
        source: mode === 'this' ? 'this-phone' : 'remote',
      };
      onTake(take);
      // Show the take: the live phone stops steering the picture until asked again.
      setFollowing(false);
      live.current = null;
      onLiveChange();
    }
  };

  const startingRef = useRef(false);
  const startRecording = async () => {
    if (recordingRef.current || startingRef.current) return;
    startingRef.current = true;
    samplesRef.current = [];
    setFollowing(true);
    player.loop = false;
    try {
      await player.seek(0);
      await player.play();
    } finally {
      startingRef.current = false;
    }
    // The take starts once the film plays: "the film stopped, so the take
    // ends" must not hear the seek to the start.
    if (!player.isPlaying) {
      player.loop = true;
      return;
    }
    recordingRef.current = true;
    setRecording(true);
  };

  // A take ends with the film.
  useEffect(
    () =>
      player.subscribe(() => {
        if (recordingRef.current && !player.isPlaying) stopRecording(true);
        const link = linkRef.current;
        if (link) link.sendState({ recording: recordingRef.current, playing: player.isPlaying, t: Math.round(player.time * 10) / 10, duration: Math.round(filmDuration(filmRef.current) * 10) / 10 });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player]
  );

  const disconnect = () => {
    stopRecording(false);
    linkRef.current?.close();
    linkRef.current = null;
    motionRef.current?.stop();
    motionRef.current = null;
    releaseWakeRef.current?.();
    releaseWakeRef.current = null;
    live.current = null;
    filterRef.current.reset();
    player.loop = true;
    setMode('off');
    setUrl(null);
    setStatus('closed');
    onLiveChange();
  };

  useEffect(() => () => disconnect(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const connectPhone = async () => {
    setMode('link');
    setDetail(null);
    setNeedsSignIn(false);
    setStatus('starting');
    try {
      const ticket = await getTicket(getToken());
      const link = new RoomLink('desk', ticket, {
        onStatus: (next, why) => {
          setStatus(next);
          setDetail(why ?? null);
        },
        onMotion: (reading: MotionReading) => onReading(reading.q, reading.zoom),
        onRecord: (on) => (on ? void startRecording() : stopRecording(true)),
        onPeer: (present) => {
          filterRef.current.reset();
          if (!present) {
            live.current = null;
            onLiveChange();
          }
        },
      });
      linkRef.current = link;
      await link.connect();
      setUrl(remotePageUrl(link.room, ticket));
    } catch (error) {
      if (error instanceof LinkSignInRequired) {
        setNeedsSignIn(true);
        setStatus('closed');
        return;
      }
      setStatus('failed');
      setDetail(error instanceof Error ? error.message : 'Try again in a moment.');
    }
  };

  const useThisPhone = async () => {
    // Asked inside the tap: Safari only asks then.
    const access = await askForMotion();
    if (access !== 'granted') {
      setMotionNote(
        access === 'denied'
          ? 'Motion is turned off for this page. Reload the page and tap Allow when Safari asks.'
          : access === 'insecure'
            ? 'Phones only share their movement with pages that use https.'
            : "This browser doesn't share the phone's movement."
      );
      return;
    }
    setMotionNote(null);
    setMode('this');
    setFollowing(true);
    filterRef.current.reset();
    const motion = new PhoneMotion();
    motionRef.current = motion;
    let heard = false;
    motion.start(
      (q) => {
        if (!heard) {
          heard = true;
          setMotionNote(null);
        }
        onReading(q, 1);
      },
      () => setMotionNote("No movement came from this phone's sensors.")
    );
    releaseWakeRef.current = await keepScreenOn();
  };

  const take = film.take;
  const connected = mode === 'this' || status === 'direct' || status === 'relayed';

  return (
    <div className="space-y-3" data-testid="director-phone-panel">
      {mode === 'off' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Move your phone and the phone in the video moves the same way. Nothing to install.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => void connectPhone()}
              disabled={!isLinkConfigured()}
              title={isLinkConfigured() ? undefined : "Connecting a phone isn't set up in this copy of the app"}
            >
              <QrCodeIcon className="h-3.5 w-3.5" />
              Use your phone
            </Button>
            {thisPhone && (
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void useThisPhone()}>
                <SmartphoneIcon className="h-3.5 w-3.5" />
                Move this phone
              </Button>
            )}
          </div>
          {!isLinkConfigured() && <p className="text-[11px] text-muted-foreground">Connecting a phone isn&apos;t set up in this copy of the app.</p>}
          {motionNote && <p className="text-[11px] text-amber-600 dark:text-amber-400">{motionNote}</p>}
          {needsSignIn && (
            <div className="rounded-md border bg-muted/40 p-2 text-[11px]">
              <p>Sign in to connect your phone. The connection server only lets signed-in people in.</p>
              {onSignIn && (
                <Button type="button" size="sm" variant="outline" className="mt-2 h-7" onClick={onSignIn}>
                  Sign in
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {mode === 'link' && !connected && (
        <div className="flex flex-col items-center gap-2 text-center">
          {status === 'starting' && <Loader2Icon className="my-14 h-5 w-5 animate-spin text-muted-foreground" />}
          {url && status === 'waiting' && <QrCode text={url} />}
          <p className="text-xs font-medium" data-testid="director-link-status">
            {STATUS_WORDS[status]}
          </p>
          {status === 'waiting' && (
            <p className="text-[11px] text-muted-foreground">
              Point your phone&apos;s camera at the code and open the link. Works on iPhone and Android.
            </p>
          )}
          {detail && status === 'failed' && <p className="text-[11px] text-muted-foreground">{detail}</p>}
          <Button type="button" size="sm" variant="ghost" className="h-7 gap-1" onClick={disconnect}>
            <XIcon className="h-3.5 w-3.5" />
            Cancel
          </Button>
        </div>
      )}

      {connected && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-medium" data-testid="director-link-status">
            <span className={cn('h-2 w-2 rounded-full', recording ? 'animate-pulse bg-red-500' : 'bg-emerald-500')} />
            {recording ? 'Recording your moves' : mode === 'this' ? 'This phone moves the video' : STATUS_WORDS[status]}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Hold the phone the way the phone in the video should face, then press Center. Pinch on your phone to move closer.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className={cn('h-8 gap-1.5', recording && 'bg-red-600 text-white hover:bg-red-600/90')}
              onClick={() => (recording ? stopRecording(true) : void startRecording())}
              data-testid="director-record-take"
            >
              {recording ? <SquareIcon className="h-3 w-3 fill-current" /> : <CircleIcon className="h-3 w-3 fill-red-500 text-red-500" />}
              {recording ? 'Stop' : 'Record a take'}
            </Button>
            {mode === 'this' && (
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => motionRef.current?.center()}>
                <CrosshairIcon className="h-3.5 w-3.5" />
                Center
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
          {!recording && (
            <label className="flex items-center justify-between gap-2 text-xs">
              <span>Follow my phone now</span>
              <Switch
                checked={following}
                onCheckedChange={(on) => {
                  setFollowing(on);
                  if (!on) live.current = null;
                  onLiveChange();
                }}
              />
            </label>
          )}
        </div>
      )}

      {take && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2.5" data-testid="director-take">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-medium">
              <Switch checked={film.motion === 'hand'} onCheckedChange={(on) => update((f) => ({ ...f, motion: on ? 'hand' : 'auto' }))} aria-label="Use my take" />
              Use my take
            </label>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Delete the take"
              title="Delete the take"
              onClick={() => update((f) => ({ ...f, take: null, motion: 'auto' }))}
            >
              <Trash2Icon className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {Math.round(take.samples[take.samples.length - 1]?.t ?? 0)} seconds of moves, recorded {take.source === 'this-phone' ? 'on this phone' : 'with your phone'}
          </p>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1">
                How much it turns
                <InfoTip label="About how much it turns">Under 100% calms your moves down. Over 100% makes them bigger.</InfoTip>
              </span>
              <span className="tabular-nums text-muted-foreground">{Math.round(film.takeStrength * 100)}%</span>
            </div>
            <Slider
              min={20}
              max={150}
              step={5}
              value={[Math.round(film.takeStrength * 100)]}
              onValueChange={([v]) => update((f) => ({ ...f, takeStrength: v / 100 }))}
              aria-label="How much it turns"
            />
          </div>
        </div>
      )}
    </div>
  );
}
