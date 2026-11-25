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
  { id: 'calm', name: 'Calm', when: 'Slow camera movements give viewers time to read' },
  { id: 'lively', name: 'Lively', when: 'Moves between the whole phone and close-ups of the action' },
  { id: 'bold', name: 'Bold', when: 'Zooms in quickly and turns the phone farther' },
  { id: 'cinematic', name: 'Cinematic', when: 'Shows the phone from an angle, then pulls back to show the whole phone' },
];

const WORD_STYLES: { id: WordsStyle; name: string; when: string }[] = [
  { id: 'soft', name: 'Slide in', when: 'The words fade in and slide up together' },
  { id: 'headline', name: 'Headline', when: 'Large text lines up along the left edge' },
  { id: 'punchy', name: 'Bold captions', when: 'Bold capital letters pop in one word at a time' },
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
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={label} data-testid={testId} />
      </span>
      {label}
    </label>
  );
}

function SwitchSetting({ label, hint, checked, disabled, onCheckedChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  const hintId = React.useId();
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span id={hintId} className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch aria-label={label} aria-describedby={hint ? hintId : undefined} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
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
  { id: 'vertical', name: 'Tall', ratio: '9:16', when: 'Reels, TikTok and Shorts' },
  { id: 'portrait', name: 'Portrait', ratio: '4:5', when: 'Instagram and Facebook posts' },
  { id: 'square', name: 'Square', ratio: '1:1', when: 'Square social posts' },
  { id: 'landscape', name: 'Wide', ratio: '16:9', when: 'YouTube and websites' },
];

const SHOTS: { id: ShotChoice; name: string }[] = [
  { id: 'auto', name: 'Let Director choose' },
  { id: 'close', name: 'Close-up' },
  { id: 'wide', name: 'Show whole phone' },
  { id: 'skip', name: 'Skip this moment' },
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
      <SliderPrimitive.Thumb className={thumb} aria-label="Clip start time" />
      <SliderPrimitive.Thumb className={thumb} aria-label="Clip end time" />
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
    <Section title="Preview length" testId="director-no-recording">
      <p className="text-xs text-muted-foreground">
        Choose how long to record your phone&apos;s movements before adding your screen recording
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preview length in seconds">
        {LENGTHS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            aria-pressed={film.placeholderLength === seconds}
            onClick={() => update((f) => ({ ...f, placeholderLength: seconds }))}
            className={cn('rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors', film.placeholderLength === seconds ? 'border-primary bg-primary/10' : 'hover:bg-muted')}
          >
            {seconds} sec
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
          <span>Choose where the clip starts and ends</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {formatTime(range[0])} to {formatTime(range[1])}
          </span>
        </div>
        <PartSlider max={Math.max(0.5, clip.duration)} value={range} onChange={setRange} onCommit={(value) => actions.onTrim(clip.id, { in: value[0], out: value[1] })} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => actions.onReplace(clip.id)} data-testid="director-replace-clip">
          <RefreshCwIcon className="h-3.5 w-3.5" />
          Replace entire clip
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={actions.onChangeFrom} disabled={!inClip} title={inClip ? undefined : 'Select a time within this clip first'}>
          <RepeatIcon className="h-3.5 w-3.5" />
          Replace from {formatTime(t)}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={actions.onSplit} disabled={!canSplit} title={canSplit ? undefined : 'Select a time away from either end of this clip'}>
          <ScissorsIcon className="h-3.5 w-3.5" />
          Split at {formatTime(t)}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => actions.onReadAgain(clip.id)} title="Look for taps, scrolling and other activity in this clip again">
          <RefreshCwIcon className="h-3.5 w-3.5" />
          Find moments again
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={index <= 0} onClick={() => actions.onMove(clip.id, index - 1)} aria-label="Move clip earlier" title="Move clip earlier">
            <ArrowLeftIcon className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={index >= film.clips.length - 1} onClick={() => actions.onMove(clip.id, index + 1)} aria-label="Move clip later" title="Move clip later">
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => actions.onRemove(clip.id)}>
          <Trash2Icon className="h-3.5 w-3.5" />
          Remove clip from video
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
          <p className="text-[11px] text-muted-foreground">Drag the box over the area you want to show</p>
          {player.video && <FocusEditor video={player.video} focus={moment.focus} onChange={(focus: Rect01) => update(moment.id, { focus, shot: moment.shot === 'auto' ? 'close' : moment.shot })} />}
        </div>
      )}
      {film.text.captions && (
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Caption for this moment</span>
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
    <Section title="Control the camera with your phone" testId="director-hand">
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

      <Section title="Automatic camera movement" testId="director-style">
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

      <Section title="Phone in the video" testId="director-phone">
        <Select
          value={film.phone.deviceType}
          onValueChange={(value) => update((f) => ({ ...f, phone: { deviceType: value as DeviceType, picked: true } }))}
        >
          <SelectTrigger className="h-8 text-sm" aria-label="Phone model in the video">
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

      <Section title="Text in your video" testId="director-words">
        <div className="grid gap-1.5" role="group" aria-label="How the words appear">
          {WORD_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              aria-pressed={wordsStyle === style.id}
              onClick={() => update((f) => ({ ...f, text: { ...f.text, style: style.id } }))}
              className={cn('rounded-lg border px-2.5 py-1.5 text-left transition-colors', wordsStyle === style.id ? 'border-primary bg-primary/10' : 'hover:bg-muted')}
              data-testid={`director-words-${style.id}`}
            >
              <span className="block text-xs font-semibold">{style.name}</span>
              <span className="block text-[11px] text-muted-foreground">{style.when}</span>
            </button>
          ))}
        </div>
        <label className="block space-y-1">
          <span className="text-xs">Title at the start of the video</span>
          <Input value={film.text.title} placeholder="Your app's name" maxLength={60} onChange={(e) => update((f) => ({ ...f, text: { ...f.text, title: e.target.value } }))} className="h-8 text-sm" data-testid="director-title" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs">Message at the end of the video</span>
          <Input value={film.text.end} placeholder="Download it free" maxLength={60} onChange={(e) => update((f) => ({ ...f, text: { ...f.text, end: e.target.value } }))} className="h-8 text-sm" data-testid="director-end" />
        </label>
        {card?.on && <p className="text-[11px] text-muted-foreground">Your closing message appears below the app name on the ending screen</p>}
        <div className="flex flex-wrap items-center gap-3">
          <ColorPick label="Text color" value={colors.ink} onChange={(ink) => update((f) => ({ ...f, text: { ...f.text, ink } }))} testId="director-ink" />
          <ColorPick label="Highlight color" value={colors.highlight} onChange={(accent) => update((f) => ({ ...f, text: { ...f.text, accent } }))} testId="director-accent" />
          {(film.text.ink || film.text.accent) && (
            <button type="button" className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => update((f) => ({ ...f, text: { ...f.text, ink: undefined, accent: undefined } }))}>
              Reset colors
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">In a title or caption, type <code>*free*</code> to show <strong>free</strong> in the highlight color</p>
        <SwitchSetting
          label="Show my captions"
          hint="To add a caption, turn this on and choose a tap or another moment on the timeline"
          checked={film.text.captions}
          onCheckedChange={(on) => update((f) => ({ ...f, text: { ...f.text, captions: on } }))}
        />
        <SwitchSetting
          label="Show where someone tapped"
          hint="A circle briefly appears on the screen recording where Director finds a tap"
          checked={film.text.taps}
          onCheckedChange={(on) => update((f) => ({ ...f, text: { ...f.text, taps: on } }))}
        />
      </Section>

      <Section title="App icon and ending screen" testId="director-card">
        <p className="text-[11px] text-muted-foreground">For your app icon, choose the picture people tap to open your app</p>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[11px] border border-dashed bg-muted/40">
            {film.text.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={film.text.icon} alt="Current app icon" className="h-full w-full object-cover" data-testid="director-icon" />
            ) : (
              <ImagePlusIcon className="h-4 w-4 text-muted-foreground" />
            )}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => iconInput.current?.click()} data-testid="director-icon-pick">
              {film.text.icon ? 'Change app icon' : 'Add app icon'}
            </Button>
            {film.text.icon && (
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => update((f) => ({ ...f, text: { ...f.text, icon: undefined, logo: false } }))}>
                Remove icon
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
                  setIconNote('Choose a PNG, JPEG or WebP image for your app icon');
                });
            }}
          />
        </div>
        {iconNote && <p className="text-[11px] text-amber-600 dark:text-amber-400">{iconNote}</p>}
        <SwitchSetting
          label="Show icon in the top left"
          hint={film.text.icon ? 'The icon appears in the corner while the video plays' : 'Add an app icon above to turn this on'}
          checked={!!film.text.logo && !!film.text.icon}
          disabled={!film.text.icon}
          onCheckedChange={(on) => update((f) => ({ ...f, text: { ...f.text, logo: on } }))}
        />
        <SwitchSetting
          label="Add an ending screen"
          hint="Finish the video with your app name, icon and a message for viewers"
          checked={!!card?.on}
          onCheckedChange={(on) => setCard({ on })}
        />
        {card?.on && (
          <div className="space-y-2.5 rounded-md border bg-muted/30 p-2.5" data-testid="director-card-options">
            <label className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">App name on the ending screen</span>
              <Input
                value={card.name}
                placeholder={plainWords(film.text.title) || "Your app's name"}
                maxLength={40}
                onChange={(e) => setCard({ name: e.target.value })}
                className="h-8 text-sm"
                data-testid="director-card-name"
              />
              {film.text.title.trim() && <span className="block text-[11px] text-muted-foreground">Leave this blank to use the title from the start of the video</span>}
            </label>
            <SwitchSetting
              label="Make the ending screen white"
              hint="Leave this off to keep the video background behind your app name"
              checked={card.light}
              onCheckedChange={(light) => setCard({ light })}
            />
            <div className="space-y-1">
              <span className="text-xs">Choose which store logos appear at the end</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Store logos on the ending screen">
                <BadgeChip label="App Store" on={card.appStore} onChange={(appStore) => setCard({ appStore })} />
                <BadgeChip label="Google Play" on={card.googlePlay} onChange={(googlePlay) => setCard({ googlePlay })} />
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Sound" testId="director-sound">
        <SwitchSetting
          label="Play the recording's sound"
          hint="Turn this off for a silent video"
          checked={film.sound.recording}
          onCheckedChange={(on) => {
            player.sound = on;
            update((f) => ({ ...f, sound: { recording: on } }));
          }}
        />
      </Section>
    </div>
  );
}
