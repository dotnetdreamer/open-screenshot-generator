"use client";

// Moving the phone in the film by hand. Two ways in:
//  - Your phone: the computer shows a code, the phone's camera opens a page
//    from it, and the 3D phone follows the real one live. Nothing to install.
//  - This phone: when Director itself runs on a phone, the phone's own
//    movement moves the 3D phone.
// Either way "Record movement" plays the film from the start and keeps every
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
    <svg viewBox={`0 0 ${size} ${size}`} className="h-40 w-40 rounded-lg bg-white p-1 shadow-sm" role="img" aria-label="QR code to connect your phone" data-testid="director-qr" data-link={text}>
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

/** What the view can ask of the panel from outside it. */
export interface PhoneLinkActions {
  /** Shows the QR code for a phone to scan, including after an earlier attempt failed. */
  connect: () => void;
}

/**
 * Where the phone link stands, for the view's words outside the panel: not
 * started, waiting for a sign-in, getting the code, the code up, tried and
 * not connected, or a phone moving the film.
 */
export type PhoneLinkState = 'off' | 'signin' | 'starting' | 'code' | 'failed' | 'connected';

const STATUS_WORDS: Record<LinkStatus, string> = {
  starting: 'Preparing the QR code',
  waiting: 'Scan the QR code with your phone',
  direct: 'Your phone is connected',
  relayed: 'Your phone is connected over the internet',
  closed: 'Phone disconnected',
  failed: "Couldn't connect your phone",
};

export function PhoneLinkPanel({
  film,
  player,
  live,
  actionsRef,
  autoConnect,
  getToken,
  onSignIn,
  onLinkStateChange,
  onTake,
  onLiveChange,
  update,
}: {
  film: Film;
  player: FilmPlayer;
  live: LiveTurn;
  actionsRef?: React.MutableRefObject<PhoneLinkActions | null>;
  /** Show the code as soon as the panel is up. */
  autoConnect?: boolean;
  /** The account's sign-in, for the connection server. */
  getToken: () => string | null;
  onSignIn?: () => void;
  /** Hears where the link stands each time that changes, and 'off' when the panel goes. */
  onLinkStateChange?: (state: PhoneLinkState) => void;
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
  const updateRef = useRef(update);
  updateRef.current = update;
  followingRef.current = following;

  /** One reading from either source: shown live, and kept when a take is being recorded. */
  const onReading = (q: Quat, zoom: number, depth?: number) => {
    const steady = filterRef.current.push(q, performance.now() / 1000);
    live.current = followingRef.current || recordingRef.current ? { q: steady, zoom, depth } : null;
    if (recordingRef.current) {
      // The reading is a little late by the time it arrives: a direct link takes a few hundredths of a second.
      const late = linkRef.current?.currentStatus === 'relayed' ? 0.09 : 0.03;
      const sample: MotionSample = { t: Math.max(0, player.time - (mode === 'this' ? 0 : late)), q, zoom };
      if (depth !== undefined) sample.depth = depth;
      samplesRef.current.push(sample);
    }
    onLiveChange();
  };

  /** Tells the phone where the film is, and whether forward and back is on. */
  const sendState = (frequent = true) => {
    const link = linkRef.current;
    if (!link) return;
    const f = filmRef.current;
    link.sendState(
      {
        recording: recordingRef.current,
        playing: player.isPlaying,
        t: Math.round(player.time * 10) / 10,
        duration: Math.round(filmDuration(f) * 10) / 10,
        depth: !!f.handDepth,
      },
      frequent
    );
  };

  // Once a second as well: the phone catches up on a state the link dropped,
  // and its clock keeps up while the film is paused.
  useEffect(() => {
    const timer = window.setInterval(() => sendState(), 1000);
    return () => window.clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Out of sight (the phone's Record with Director hidden): nothing starts, and the film stays where it was.
    if (recordingRef.current || startingRef.current || player.hidden) return;
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
        sendState();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player]
  );

  // Forward and back turned on or off, here or on the phone: the phone hears it
  // at once, and a phone just turned on starts the distance from where it is.
  useEffect(() => {
    sendState(false);
    if (film.handDepth) motionRef.current?.restartDepth();
  }, [film.handDepth]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Bumped by every connect and disconnect: a connect still on its way when another starts gives up. */
  const connectSeq = useRef(0);

  const disconnect = () => {
    connectSeq.current += 1;
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

  // A film made moves first: the code shows without a click. In development
  // React runs this twice, with a disconnect between; the second run connects again.
  useEffect(() => {
    if (autoConnect && isLinkConfigured()) void connectPhone();
  }, [autoConnect]); // eslint-disable-line react-hooks/exhaustive-deps

  const connectPhone = async () => {
    const seq = ++connectSeq.current;
    // A link left from a try that failed goes first.
    linkRef.current?.close();
    linkRef.current = null;
    setMode('link');
    setDetail(null);
    setNeedsSignIn(false);
    setStatus('starting');
    try {
      const ticket = await getTicket(getToken());
      if (seq !== connectSeq.current) return;
      const link = new RoomLink('desk', ticket, {
        onStatus: (next, why) => {
          setStatus(next);
          setDetail(why ?? null);
        },
        onMotion: (reading: MotionReading) => onReading(reading.q, reading.zoom, reading.depth),
        onRecord: (on) => (on ? void startRecording() : stopRecording(true)),
        onDepth: (on) => updateRef.current((f) => (!!f.handDepth === on ? f : { ...f, handDepth: on })),
        onPeer: (present) => {
          filterRef.current.reset();
          if (present) {
            // A phone that just joined learns the film's state, forward and back included.
            sendState(false);
            return;
          }
          live.current = null;
          onLiveChange();
        },
      });
      linkRef.current = link;
      await link.connect();
      if (seq !== connectSeq.current) {
        link.close();
        if (linkRef.current === link) linkRef.current = null;
        return;
      }
      setUrl(remotePageUrl(link.room, ticket));
    } catch (error) {
      // The answer to a try that a newer one (or Cancel) overtook: the link as it is now stands.
      if (seq !== connectSeq.current) return;
      if (error instanceof LinkSignInRequired) {
        // Signing in is the way forward: the note and its button show at once,
        // with the option to connect a phone above them.
        setNeedsSignIn(true);
        setMode('off');
        setStatus('closed');
        return;
      }
      setStatus('failed');
      setDetail(error instanceof Error ? error.message : 'Try connecting again');
    }
  };

  const useThisPhone = async () => {
    // Asked inside the tap: Safari only asks then.
    const access = await askForMotion();
    if (access !== 'granted') {
      setMotionNote(
        access === 'denied'
          ? 'Reload this page, tap Use this phone and allow access to motion when asked'
          : access === 'insecure'
            ? 'To use tilt controls, open Director at a secure address beginning with https://'
            : 'For tilt controls, open Director in Safari on iPhone or Chrome on Android'
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
      (q, _t, depth) => {
        if (!heard) {
          heard = true;
          setMotionNote(null);
        }
        // Bringing this phone closer moves in, with forward and back on, as on the phone page.
        onReading(q, 1, filmRef.current.handDepth ? depth : undefined);
      },
      () => setMotionNote("Tilt your phone to check that the preview turns with it")
    );
    releaseWakeRef.current = await keepScreenOn();
  };

  const take = film.take;
  const connected = mode === 'this' || status === 'direct' || status === 'relayed';
  const linkState: PhoneLinkState = connected
    ? 'connected'
    : mode === 'link'
      ? status === 'starting'
        ? 'starting'
        : status === 'waiting'
          ? 'code'
          : 'failed'
      : needsSignIn
        ? 'signin'
        : 'off';
  // The view's card under the picture says what to do next, so it hears each change.
  const linkStateRef = useRef(onLinkStateChange);
  linkStateRef.current = onLinkStateChange;
  useEffect(() => {
    linkStateRef.current?.(linkState);
  }, [linkState]);
  useEffect(() => () => linkStateRef.current?.('off'), []);
  if (actionsRef) {
    actionsRef.current = {
      connect: () => {
        if (isLinkConfigured() && (linkState === 'off' || linkState === 'signin' || linkState === 'failed')) void connectPhone();
      },
    };
  }

  return (
    <div className="space-y-3" data-testid="director-phone-panel">
      {mode === 'off' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Tilt your phone to try different camera angles in the preview before you record</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => void connectPhone()}
              disabled={!isLinkConfigured()}
              title={isLinkConfigured() ? undefined : 'This version of Director cannot connect to another phone'}
            >
              <QrCodeIcon className="h-3.5 w-3.5" />
              Connect a phone
            </Button>
            {thisPhone && (
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void useThisPhone()}>
                <SmartphoneIcon className="h-3.5 w-3.5" />
                Use this phone
              </Button>
            )}
          </div>
          {!isLinkConfigured() && <p className="text-[11px] text-muted-foreground">This version of Director cannot connect to another phone</p>}
          {motionNote && <p className="text-[11px] text-amber-600 dark:text-amber-400">{motionNote}</p>}
          {needsSignIn && (
            <div className="rounded-md border bg-muted/40 p-2 text-[11px]">
              <p>Sign in and choose Connect a phone to get your QR code</p>
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
              Point your phone camera at the code, then tap the link on your phone
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
            {recording ? 'Recording your phone movements' : mode === 'this' ? 'Tilt this phone to turn the preview' : STATUS_WORDS[status]}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {recording
              ? 'Tilt your phone while the video plays, then choose Stop recording when you finish'
              : 'Set the starting angle on your phone, then choose Start recording to play the video from the beginning and record how you tilt your phone'}
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
              {recording ? 'Stop recording' : 'Start recording'}
            </Button>
            {mode === 'this' && (
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => motionRef.current?.center()}>
                <CrosshairIcon className="h-3.5 w-3.5" />
                Set starting angle
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
          {!recording && (
            <label className="flex items-center justify-between gap-2 text-xs">
              <span>Follow my phone in the preview</span>
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

      {(connected || take) && (
        <div className="flex items-center justify-between gap-2 text-xs" data-testid="director-depth">
          <span className="flex items-center gap-1">
            Zoom by moving your phone
            <InfoTip label="How to zoom by moving your phone">
              Bring your phone toward you to zoom in or move it away to zoom out
            </InfoTip>
          </span>
          <Switch checked={!!film.handDepth} onCheckedChange={(on) => update((f) => ({ ...f, handDepth: on }))} aria-label="Zoom by moving your phone" />
        </div>
      )}

      {take && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2.5" data-testid="director-take">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-medium">
              <Switch checked={film.motion === 'hand'} onCheckedChange={(on) => update((f) => ({ ...f, motion: on ? 'hand' : 'auto' }))} aria-label="Use my saved phone movements" />
              Use my saved phone movements
            </label>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Delete saved phone movements"
              title="Delete saved phone movements"
              onClick={() => update((f) => ({ ...f, take: null, motion: 'auto' }))}
            >
              <Trash2Icon className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Recorded {take.source === 'this-phone' ? 'on this phone' : 'with your phone'} · {Math.round(take.samples[take.samples.length - 1]?.t ?? 0)} s
          </p>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1">
                Amount of tilt
                <InfoTip label="How tilt affects your video">Use 100% to match your tilt or a lower setting for a gentler turn</InfoTip>
              </span>
              <span className="tabular-nums text-muted-foreground">{Math.round(film.takeStrength * 100)}%</span>
            </div>
            <Slider
              min={20}
              max={150}
              step={5}
              value={[Math.round(film.takeStrength * 100)]}
              onValueChange={([v]) => update((f) => ({ ...f, takeStrength: v / 100 }))}
              aria-label="Amount of tilt"
            />
          </div>
        </div>
      )}
    </div>
  );
}
