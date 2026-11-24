"use client";

// Director's side panel: the moment picked on the timeline, then how the
// camera moves, the phone moved by hand, the backdrop, the phone, the shape
// of the video, the words and the sound.

import React, { useMemo } from 'react';
import { Trash2Icon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { studioModelFor } from '@/lib/device3dStudio';
import { BACKDROPS, brandBackdrop, type Backdrop } from '@/lib/director/looks';
import { FILM_PHONES, finishFor, MOMENT_WORDS } from '@/lib/director/film';
import type { FilmPlayer } from '@/lib/director/player';
import type { DirectorStyle, Film, FilmFormat, Moment, MotionTake, Rect01, ShotChoice } from '@/lib/director/types';
import type { DeviceType } from '@/types/artboard';
import { cn } from '@/lib/utils';
import { FocusEditor } from './FocusEditor';
import { PhoneLinkPanel } from './PhoneLinkPanel';
import type { LiveTurn } from './DirectorViewport';

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
];

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
          background: `radial-gradient(circle at 25% 30%, ${a.color} 0%, transparent 55%), radial-gradient(circle at 78% 75%, ${b.color} 0%, transparent 55%), linear-gradient(${backdrop.top}, ${backdrop.bottom})`,
        }}
      />
      <span className="max-w-[3.5rem] truncate">{backdrop.name}</span>
    </button>
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
          <FocusEditor video={player.video} focus={moment.focus} onChange={(focus: Rect01) => update(moment.id, { focus, shot: moment.shot === 'auto' ? 'close' : moment.shot })} />
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
  brandColors,
  live,
  getToken,
  onSignIn,
  onLiveChange,
  update,
  editMoment,
  removeMoment,
}: {
  film: Film;
  player: FilmPlayer;
  selected: Moment | null;
  /** The open project's colors, for the backdrop made from them. */
  brandColors: [string, string, string] | null;
  live: LiveTurn;
  getToken: () => string | null;
  onSignIn?: () => void;
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

  return (
    <div className="text-sm" data-testid="director-inspector">
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

      <Section title="Move it by hand" testId="director-hand">
        <PhoneLinkPanel
          film={film}
          player={player}
          live={live}
          getToken={getToken}
          onSignIn={onSignIn}
          onLiveChange={onLiveChange}
          update={update}
          onTake={(take: MotionTake) => update((f) => ({ ...f, take, motion: 'hand' }))}
        />
      </Section>

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
          onValueChange={(value) => update((f) => ({ ...f, phone: { deviceType: value as DeviceType } }))}
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
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Title at the start</span>
          <Input value={film.text.title} placeholder="Your app's name" maxLength={60} onChange={(e) => update((f) => ({ ...f, text: { ...f.text, title: e.target.value } }))} className="h-8 text-sm" data-testid="director-title" />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Words at the end</span>
          <Input value={film.text.end} placeholder="Download it free" maxLength={60} onChange={(e) => update((f) => ({ ...f, text: { ...f.text, end: e.target.value } }))} className="h-8 text-sm" data-testid="director-end" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>Captions on moments</span>
          <Switch checked={film.text.captions} onCheckedChange={(on) => update((f) => ({ ...f, text: { ...f.text, captions: on } }))} aria-label="Captions on moments" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          <span>Show where taps land</span>
          <Switch checked={film.text.taps} onCheckedChange={(on) => update((f) => ({ ...f, text: { ...f.text, taps: on } }))} aria-label="Show where taps land" />
        </label>
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
