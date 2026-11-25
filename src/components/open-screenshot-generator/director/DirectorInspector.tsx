"use client";

// Director's side panel: what's picked on the timeline (a clip or a moment),
// then how the camera moves, the phone moved by hand, the backdrop, the
// phone, the shape of the video, the words, the end card and the sound. A film with no
// recording yet starts with its length and the way to add one, and puts
// moving the phone by hand first.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { ArrowLeftIcon, ArrowRightIcon, FilmIcon, ImagePlusIcon, RefreshCwIcon, RepeatIcon, ScissorsIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { studioModelFor } from '@/lib/device3dStudio';
import { BACKDROPS, backdropFor, brandBackdrop, parseColor, toHex, type Backdrop, type Glow } from '@/lib/director/looks';
import { plainWords, wordColors } from '@/lib/director/overlay';
import { iconFromFile } from '@/lib/director/overlayAssets';
import { FILM_PHONES, finishFor, MOMENT_WORDS, withTake } from '@/lib/director/film';
import type { FilmPlayer } from '@/lib/director/player';
import { clipLength, MIN_SPLIT_SIDE, spanAt } from '@/lib/director/timeline';
import type { DirectorStyle, EndCard, Film, FilmClip, FilmFormat, Moment, MotionTake, Rect01, ShotChoice, WordsStyle } from '@/lib/director/types';
import type { DeviceType } from '@/types/artboard';
import { cn } from '@/lib/utils';
import { FocusEditor } from './FocusEditor';
import { PhoneLinkPanel, type PhoneLinkActions, type PhoneLinkState } from './PhoneLinkPanel';
import { InfoTip } from '../capture/InfoTip';
import type { LiveTurn } from './DirectorViewport';
import { formatTime } from './DirectorTimeline';

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-2.5 border-b px-4 py-3.5 last:border-b-0" data-testid={testId}>
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const STYLES: { id: DirectorStyle; name: string; when: string }[] = [
  { id: 'calm', name: 'Calm', when: 'Slow, gentle moves. Good for apps people read' },
  { id: 'lively', name: 'Lively', when: 'Follows every tap. Good for most apps' },
  { id: 'bold', name: 'Bold', when: 'Fast, big moves. Good for games and ads' },
  { id: 'cinematic', name: 'Cinematic', when: 'Close, steep angles and fast pull-backs. Good for launches' },
];

const WORD_STYLES: { id: WordsStyle; name: string; when: string }[] = [
  { id: 'soft', name: 'Soft', when: 'Rises in at the top. Good for most videos' },
  { id: 'headline', name: 'Headline', when: 'Big words on the left. Good on dark backgrounds' },
  { id: 'punchy', name: 'Bold captions', when: 'Capitals at the bottom. Good for ads' },
];

/** The card a film gets when the switch is first turned on. */
const NEW_CARD: EndCard = { on: true, name: '', appStore: true, googlePlay: true, light: false };

/** A colour well: the colour shown, the browser's picker under it. */
function ColorPick({ label, value, onChange, testId }: { label: string; value: string; onChange: (value: string) => void; testId?: string }) {
  const rgb = parseColor(value);
  const hex = rgb ? toHex(rgb) : '#000000';
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
      <span className="relative h-6 w-6 overflow-hidden rounded-md ring-1 ring-black/15 dark:ring-white/20" style={{ background: hex }}>
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={`${label} color`} data-testid={testId} />
      </span>
      {label}
    </label>
  );
}

/** A store badge in or out, as a small on and off chip. */
function BadgeChip({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors', on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted')}
    >
      {label}
    </button>
  );
}

const SHAPES: { id: FilmFormat; name: string; ratio: string; when: string }[] = [
  { id: 'vertical', name: 'Tall', ratio: '9:16', when: 'Reels, TikTok, Shorts' },
  { id: 'portrait', name: 'Portrait', ratio: '4:5', when: 'Instagram and Facebook posts' },
  { id: 'square', name: 'Square', ratio: '1:1', when: 'Any feed' },
  { id: 'landscape', name: 'Wide', ratio: '16:9', when: 'YouTube and websites' },
];

const SHOTS: { id: ShotChoice; name: string }[] = [
  { id: 'auto', name: 'Let Director choose' },
  { id: 'close', name: 'Close-up' },
  { id: 'wide', name: 'Whole phone' },
  { id: 'skip', name: 'Leave out' },
];

/** A glow in the swatch: soft where it's soft, a solid disc where the backdrop has one, where it sits. */
function swatchSpot(glow: Glow, at: string): string {
  if (!glow.disc) return `radial-gradient(circle at ${at}, ${glow.color} 0%, transparent 55%)`;
  return `radial-gradient(circle at ${50 + glow.x * 100}% ${50 - glow.y * 100}%, ${glow.color} 0 ${glow.r * 100}%, transparent ${glow.r * 100 + 1}%)`;
}

function Swatch({ backdrop, selected, onClick }: { backdrop: Backdrop; selected: boolean; onClick: () => void }) {
  const [a, b] = backdrop.glows;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={backdrop.name}
      aria-label={backdrop.name}
      className={cn('group flex flex-col items-center gap-1 text-[10px] text-muted-foreground', selected && 'text-foreground')}
    >
      <span
        className={cn('h-10 w-10 rounded-lg ring-1 ring-black/10 transition-shadow', selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'group-hover:ring-foreground/30')}
        style={{
          background: `${swatchSpot(a, '25% 30%')}, ${swatchSpot(b, '78% 75%')}, linear-gradient(${backdrop.top}, ${backdrop.bottom})`,
        }}
      />
      <span className="max-w-[3.5rem] truncate">{backdrop.name}</span>
    </button>
  );
}

/** Two handles on one track: the start and the end of the part of a recording a clip shows. */
function PartSlider({ max, value, onChange, onCommit }: { max: number; value: [number, number]; onChange: (value: [number, number]) => void; onCommit: (value: [number, number]) => void }) {
  const thumb =
    'block h-4 w-4 rounded-full border-2 border-primary bg-background shadow-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  return (
    <SliderPrimitive.Root
      className="relative flex h-5 w-full touch-none select-none items-center"
      min={0}
      max={max}
      step={0.1}
      minStepsBetweenThumbs={5}
      value={value}
      onValueChange={(v) => onChange([v[0], v[1]])}
      onValueCommit={(v) => onCommit([v[0], v[1]])}
      data-testid="director-clip-range"
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className={thumb} aria-label="Start of the part" />
      <SliderPrimitive.Thumb className={thumb} aria-label="End of the part" />
    </SliderPrimitive.Root>
  );
}

/** The player's time, ten times a second. */
function usePlayerTime(player: FilmPlayer): number {
  const [t, setT] = useState(player.time);
  useEffect(() => player.subscribe(() => setT(player.time)), [player]);
  return t;
}

const LENGTHS = [10, 15, 20, 30, 45, 60];

function NoRecordingPanel({ film, update }: { film: Film; update: (change: (film: Film) => Film) => void }) {
  return (
    <Section title="No recording yet" testId="director-no-recording">
      <p className="text-xs text-muted-foreground">
        Record your moves with your phone first, then add the recording. Until then the video is {film.placeholderLength} seconds long.
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Length before the recording">
        {LENGTHS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            aria-pressed={film.placeholderLength === seconds}
            onClick={() => update((f) => ({ ...f, placeholderLength: seconds }))}
            className={cn('rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors', film.placeholderLength === seconds ? 'border-primary bg-primary/10' : 'hover:bg-muted')}
          >
            {seconds}s
          </button>
        ))}
      </div>
    </Section>
  );
}

export interface ClipActions {
  onTrim: (clipId: string, patch: { in?: number; out?: number }) => void;
  onReplace: (clipId: string) => void;
  onChangeFrom: () => void;
  onSplit: () => void;
  onMove: (clipId: string, toIndex: number) => void;
  onRemove: (clipId: string) => void;
  onReadAgain: (clipId: string) => void;
}

function ClipPanel({ film, clip, player, actions }: { film: Film; clip: FilmClip; player: FilmPlayer; actions: ClipActions }) {
  const t = usePlayerTime(player);
  const index = film.clips.findIndex((c) => c.id === clip.id);
  const span = spanAt(film, t);
  const inClip = !!span && span.clip.id === clip.id;
  const canSplit = inClip && t - span!.start >= MIN_SPLIT_SIDE && span!.end - t >= MIN_SPLIT_SIDE;
  const [range, setRange] = useState<[number, number]>([clip.in, clip.out]);
  useEffect(() => setRange([clip.in, clip.out]), [clip.in, clip.out]);
  const name = clip.name.replace(/\.[a-z0-9]{2,4}$/i, '');
  return (
    <Section title={film.clips.length > 1 ? `Recording ${index + 1} of ${film.clips.length}` : 'Recording'} testId="director-clip-panel">
      <div className="flex items-center gap-2">
        {clip.strip?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.strip[Math.min(clip.strip.length - 1, 2)].url} alt="" className="h-12 w-6 shrink-0 rounded object-cover ring-1 ring-black/10" />
        ) : (
          <FilmIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={clip.name}>
            {name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatTime(clipLength(clip))} of {formatTime(clip.duration)} used, {clip.moments.filter((m) => m.kind !== 'still' && !m.removed).length} moments
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span>Part of the recording</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {formatTime(range[0])} to {formatTime(range[1])}
          </span>
        </div>
        <PartSlider max={Math.max(0.5, clip.duration)} value={range} onChange={setRange} onCommit={(value) => actions.onTrim(clip.id, { in: value[0], out: value[1] })} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => actions.onReplace(clip.id)} data-testid="director-replace-clip">
          <RefreshCwIcon className="h-3.5 w-3.5" />
          Change recording
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={actions.onChangeFrom} disabled={!inClip} title={inClip ? undefined : 'Move the playhead into this recording first'}>
          <RepeatIcon className="h-3.5 w-3.5" />
          From {formatTime(t)}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={actions.onSplit} disabled={!canSplit} title={canSplit ? undefined : 'Move the playhead inside this recording to split it'}>
          <ScissorsIcon className="h-3.5 w-3.5" />
          Split at {formatTime(t)}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => actions.onReadAgain(clip.id)} title="Find the moments in this recording again">
          <RefreshCwIcon className="h-3.5 w-3.5" />
          Read again
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={index <= 0} onClick={() => actions.onMove(clip.id, index - 1)} aria-label="Move earlier" title="Move earlier">
            <ArrowLeftIcon className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={index >= film.clips.length - 1} onClick={() => actions.onMove(clip.id, index + 1)} aria-label="Move later" title="Move later">
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => actions.onRemove(clip.id)}>
          <Trash2Icon className="h-3.5 w-3.5" />
          Take out of the video
        </button>
      </div>
    </Section>
  );
}

function MomentPanel({ film, moment, player, update, onRemove }: { film: Film; moment: Moment; player: FilmPlayer; update: (id: string, patch: Partial<Moment>) => void; onRemove: () => void }) {
  return (
    <Section title={`${MOMENT_WORDS[moment.kind]} at ${moment.start.toFixed(1)}s`} testId="director-moment-panel">
      <div className="grid grid-cols-2 gap-1.5">
        {SHOTS.map((shot) => (
          <button
            key={shot.id}
            type="button"
            aria-pressed={moment.shot === shot.id}
            onClick={() => update(moment.id, { shot: shot.id, ...(shot.id === 'close' && !moment.focus ? { focus: { x: 0.2, y: 0.35, w: 0.6, h: 0.22 } } : {}) })}
            className={cn(
              'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
              moment.shot === shot.id ? 'border-primary bg-primary/10 text-foreground' : 'hover:bg-muted'
            )}
          >
            {shot.name}
          </button>
        ))}
      </div>
      {moment.focus && moment.shot !== 'skip' && moment.shot !== 'wide' && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">Drag the box to what the close-up should show</p>
          {player.video && <FocusEditor video={player.video} focus={moment.focus} onChange={(focus: Rect01) => update(moment.id, { focus, shot: moment.shot === 'auto' ? 'close' : moment.shot })} />}
        </div>
      )}
      {film.text.captions && (
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Caption while it plays</span>
          <Input
            value={moment.caption ?? ''}
            placeholder="Book a table in two taps"
            maxLength={80}
            onChange={(e) => update(moment.id, { caption: e.target.value })}
            className="h-8 text-sm"
            data-testid="director-caption"
          />
        </label>
      )}
      <button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={onRemove}>
        <Trash2Icon className="h-3.5 w-3.5" />
        Delete this moment
      </button>
    </Section>
  );
}

export function DirectorInspector({
  film,
  player,
  selected,
  selectedClip,
  clipActions,
  brandColors,
  live,
  linkActions,
  autoConnect,
  getToken,
  onSignIn,
  onLinkStateChange,
  onLiveChange,
  update,
  editMoment,
  removeMoment,
}: {
  film: Film;
  player: FilmPlayer;
  selected: Moment | null;
  selectedClip: FilmClip | null;
  clipActions: ClipActions;
  /** The open project's colors, for the backdrop made from them. */
  brandColors: [string, string, string] | null;
  live: LiveTurn;
  /** Lets the view connect a phone from outside the panel. */
  linkActions?: React.MutableRefObject<PhoneLinkActions | null>;
  /** Show the code for a phone as soon as the panel is up (a film made moves first). */
  autoConnect?: boolean;
  getToken: () => string | null;
  onSignIn?: () => void;
  /** Hears where the phone link stands, for the words under the picture. */
  onLinkStateChange?: (state: PhoneLinkState) => void;
  onLiveChange: () => void;
  update: (change: (film: Film) => Film) => void;
  editMoment: (id: string, patch: Partial<Moment>) => void;
  removeMoment: (id: string) => void;
}) {
  const brand = useMemo(() => {
    const colors = film.look.colors ?? brandColors;
    return colors ? brandBackdrop(colors) : null;
  }, [film.look.colors, brandColors]);
  const model = useMemo(() => studioModelFor(film.phone.deviceType), [film.phone.deviceType]);
  const groups = [
    { label: 'iPhone', phones: FILM_PHONES.filter((p) => p.platform === 'ios') },
    { label: 'Android', phones: FILM_PHONES.filter((p) => p.platform === 'android') },
  ];

  const handSection = (
    <Section title="Move it by hand" testId="director-hand">
      <PhoneLinkPanel
        film={film}
        player={player}
        live={live}
        actionsRef={linkActions}
        autoConnect={autoConnect}
        getToken={getToken}
        onSignIn={onSignIn}
        onLinkStateChange={onLinkStateChange}
        onLiveChange={onLiveChange}
        update={update}
        onTake={(take: MotionTake) => update((f) => withTake(f, take))}
      />
    </Section>
  );
  const noRecording = film.clips.length === 0;
  const wordsStyle = film.text.style ?? 'soft';
  const colors = wordColors(wordsStyle, backdropFor(film.look.backdrop === 'brand' && !film.look.colors && brandColors ? { ...film.look, colors: brandColors } : film.look), film.text);
  const card = film.text.card;
  const setCard = (patch: Partial<EndCard>) => update((f) => ({ ...f, text: { ...f.text, card: { ...(f.text.card ?? NEW_CARD), ...patch } } }));
  const iconInput = useRef<HTMLInputElement>(null);
  const [iconNote, setIconNote] = useState<string | null>(null);

  return (
    <div className="text-sm" data-testid="director-inspector">
      {noRecording && handSection}
      {noRecording && <NoRecordingPanel film={film} update={update} />}
      {selectedClip && <ClipPanel film={film} clip={selectedClip} player={player} actions={clipActions} />}
      {selected && <MomentPanel film={film} moment={selected} player={player} update={editMoment} onRemove={() => removeMoment(selected.id)} />}

      <Section title="Camera" testId="director-style">
        <div className="space-y-1.5">
          {STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              aria-pressed={film.style === style.id}
              onClick={() => update((f) => ({ ...f, style: style.id }))}
              className={cn(
                'flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors',
                film.style === style.id ? 'border-primary bg-primary/10' : 'hover:bg-muted'
              )}
            >
              <span className="text-xs font-semibold">{style.name}</span>
              <span className="text-[11px] text-muted-foreground">{style.when}</span>
            </button>
          ))}
        </div>
      </Section>

      {!noRecording && handSection}

      <Section title="Background" testId="director-background">
        <div className="grid grid-cols-4 gap-2">
          {brand && (
            <Swatch
              backdrop={brand}
              selected={film.look.backdrop === 'brand'}
              onClick={() => update((f) => ({ ...f, look: { backdrop: 'brand', colors: f.look.colors ?? brandColors ?? undefined } }))}
            />
          )}
          {BACKDROPS.map((backdrop) => (
            <Swatch key={backdrop.id} backdrop={backdrop} selected={film.look.backdrop === backdrop.id} onClick={() => update((f) => ({ ...f, look: { ...f.look, backdrop: backdrop.id } }))} />
          ))}
        </div>
      </Section>

      <Section title="Phone" testId="director-phone">
        <Select
          value={film.phone.deviceType}
          onValueChange={(value) => update((f) => ({ ...f, phone: { deviceType: value as DeviceType, picked: true } }))}
        >
          <SelectTrigger className="h-8 text-sm" aria-label="Phone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.phones.map((phone) => (
                  <SelectItem key={phone.deviceType} value={phone.deviceType}>
                    {phone.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {model && model.finishes.length > 1 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Phone color">
            {model.finishes.map((finish) => {
              const on = finishFor(film.phone.deviceType, film.phone.finish, film.look) === finish.id;
              return (
                <button
                  key={finish.id}
                  type="button"
                  title={finish.label}
                  aria-label={finish.label}
                  aria-pressed={on}
                  onClick={() => update((f) => ({ ...f, phone: { ...f.phone, finish: finish.id } }))}
                  className={cn('h-6 w-6 rounded-full ring-1 ring-black/15', on && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
                  style={{ background: `linear-gradient(135deg, ${finish.frame}, ${finish.back})` }}
                />
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Video shape" testId="director-shape">
        <div className="grid grid-cols-2 gap-1.5">
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              type="button"
              aria-pressed={film.format === shape.id}
              onClick={() => update((f) => ({ ...f, format: shape.id }))}
              className={cn('rounded-lg border px-2.5 py-2 text-left transition-colors', film.format === shape.id ? 'border-primary bg-primary/10' : 'hover:bg-muted')}
            >
              <span className="block text-xs font-semibold">
                {shape.name} <span className="font-normal text-muted-foreground">{shape.ratio}</span>
              </span>
              <span className="block text-[11px] text-muted-foreground">{shape.when}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Words" testId="director-words">
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="How the words look">
          {WORD_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              aria-pressed={wordsStyle === style.id}
              title={style.when}
              onClick={() => update((f) => ({ ...f, text: { ...f.text, style: style.id } }))}
              className={cn('rounded-lg border px-2 py-1.5 text-left text-xs font-semibold transition-colors', wordsStyle === style.id ? 'border-primary bg-primary/10' : 'hover:bg-muted')}
              data-testid={`director-words-${style.id}`}
            >
              {style.name}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{WORD_STYLES.find((s) => s.id === wordsStyle)?.when}</p>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Title at the start</span>
          <Input value={film.text.title} placeholder="Your app's name" maxLength={60} onChange={(e) => update((f) => ({ ...f, text: { ...f.text, title: e.target.value } }))} className="h-8 text-sm" data-testid="director-title" />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Words at the end</span>
          <Input value={film.text.end} placeholder="Download it free" maxLength={60} onChange={(e) => update((f) => ({ ...f, text: { ...f.text, end: e.target.value } }))} className="h-8 text-sm" data-testid="director-end" />
        </label>
        <p className="text-[11px] text-muted-foreground">Put stars around words to color them, like *this*.</p>
        <div className="flex flex-wrap items-center gap-3">
          <ColorPick label="Words" value={colors.ink} onChange={(ink) => update((f) => ({ ...f, text: { ...f.text, ink } }))} testId="director-ink" />
          <ColorPick label="Highlight" value={colors.highlight} onChange={(accent) => update((f) => ({ ...f, text: { ...f.text, accent } }))} testId="director-accent" />
          {(film.text.ink || film.text.accent) && (
            <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => update((f) => ({ ...f, text: { ...f.text, ink: undefined, accent: undefined } }))}>
              Reset colors
            </button>
          )}
        </div>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>Captions on moments</span>
          <Switch checked={film.text.captions} onCheckedChange={(on) => update((f) => ({ ...f, text: { ...f.text, captions: on } }))} aria-label="Captions on moments" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>Show where taps land</span>
          <Switch checked={film.text.taps} onCheckedChange={(on) => update((f) => ({ ...f, text: { ...f.text, taps: on } }))} aria-label="Show where taps land" />
        </label>
      </Section>

      <Section title="Icon and end card" testId="director-card">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[11px] border border-dashed bg-muted/40">
            {film.text.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={film.text.icon} alt="Your app's icon" className="h-full w-full object-cover" data-testid="director-icon" />
            ) : (
              <ImagePlusIcon className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => iconInput.current?.click()} data-testid="director-icon-pick">
              {film.text.icon ? 'Change icon' : 'Add your app icon'}
            </Button>
            {film.text.icon && (
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => update((f) => ({ ...f, text: { ...f.text, icon: undefined, logo: false } }))}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={iconInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            data-testid="director-icon-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setIconNote(null);
              iconFromFile(file)
                .then((icon) => update((f) => ({ ...f, text: { ...f.text, icon } })))
                .catch((error) => {
                  console.error('Director could not read the icon', error);
                  setIconNote("That picture couldn't be read. Try a PNG or JPEG.");
                });
            }}
          />
        </div>
        {iconNote && <p className="text-[11px] text-amber-600 dark:text-amber-400">{iconNote}</p>}
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1">
            Icon at the top
            <InfoTip label="About the icon at the top">Your app&apos;s icon at the top while the video plays, with rings going out from it. Add the icon first.</InfoTip>
          </span>
          <Switch
            checked={!!film.text.logo && !!film.text.icon}
            disabled={!film.text.icon}
            onCheckedChange={(on) => update((f) => ({ ...f, text: { ...f.text, logo: on } }))}
            aria-label="Icon at the top"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1">
            End card
            <InfoTip label="About the end card">The last seconds show your icon, your app&apos;s name, the words at the end and where to get it.</InfoTip>
          </span>
          <Switch checked={!!card?.on} onCheckedChange={(on) => setCard({ on })} aria-label="End card" />
        </label>
        {card?.on && (
          <div className="space-y-2.5 rounded-md border bg-muted/30 p-2.5" data-testid="director-card-options">
            <label className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">Name on the card</span>
              <Input
                value={card.name}
                placeholder={plainWords(film.text.title) || "Your app's name"}
                maxLength={40}
                onChange={(e) => setCard({ name: e.target.value })}
                className="h-8 text-sm"
                data-testid="director-card-name"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1">
                White card
                <InfoTip label="About the white card">A white card covers the video at the end. Off keeps your background and moves the phone down under the card.</InfoTip>
              </span>
              <Switch checked={card.light} onCheckedChange={(light) => setCard({ light })} aria-label="White card" />
            </label>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Store badges</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Store badges">
                <BadgeChip label="App Store" on={card.appStore} onChange={(appStore) => setCard({ appStore })} />
                <BadgeChip label="Google Play" on={card.googlePlay} onChange={(googlePlay) => setCard({ googlePlay })} />
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Sound" testId="director-sound">
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>Keep the recording&apos;s sound</span>
          <Switch
            checked={film.sound.recording}
            onCheckedChange={(on) => {
              player.sound = on;
              update((f) => ({ ...f, sound: { recording: on } }));
            }}
            aria-label="Keep the recording's sound"
          />
        </label>
      </Section>
    </div>
  );
}
