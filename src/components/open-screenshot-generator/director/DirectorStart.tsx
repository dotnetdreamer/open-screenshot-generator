"use client";

// The way into a new film, in three steps:
//  1. A template: a shape, a camera, a backdrop and words that go together,
//     each with a short loop showing what it does. Below them, the videos
//     already made.
//  2. Which comes first: the recording (Director finds its moments and moves
//     the camera), or the moves (the user's phone films the camera's moves
//     now, and the recording is added later).
//  3. For the recording first: the recording, from a file or the project.

import React, { useState } from 'react';
import { ArrowLeftIcon, ClapperboardIcon, FilmIcon, HandIcon, SmartphoneIcon, Trash2Icon, UploadIcon, WandSparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { backdropFor, brandBackdrop } from '@/lib/director/looks';
import { filmDuration } from '@/lib/director/frame';
import { MAX_FILM_SECONDS } from '@/lib/director/timeline';
import { FILM_TEMPLATES, templatePreview, type FilmTemplate } from '@/lib/director/templates';
import type { Film, FilmFormat } from '@/lib/director/types';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import type { DirectorProject, DirectorRecording } from './DirectorWorkspace';

const RATIO: Record<FilmFormat, { label: string; css: string }> = {
  vertical: { label: 'Tall 9:16', css: '9 / 16' },
  portrait: { label: 'Portrait 4:5', css: '4 / 5' },
  square: { label: 'Square 1:1', css: '1 / 1' },
  landscape: { label: 'Wide 16:9', css: '16 / 9' },
};

const STYLE_WORDS = { calm: 'Slow, gentle movement', lively: 'Smooth turns and zooms', bold: 'Quick turns and zooms', cinematic: 'Steep angles and fast zooms' } as const;

function formatLength(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} sec`;
  return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} sec` : `${Math.floor(s / 60)} min`;
}

/** A template's card: its loop plays while the pointer is over it (or it has focus); the still shows otherwise. */
function TemplateCard({ template, colors, onPick }: { template: FilmTemplate; colors: [string, string, string] | null; onPick: () => void }) {
  const [live, setLive] = useState(false);
  const [missing, setMissing] = useState(false);
  const preview = templatePreview(template);
  const backdrop = template.backdrop === 'brand' && colors ? brandBackdrop(colors) : backdropFor({ backdrop: template.backdrop });
  const [a, b] = backdrop.glows;
  const ground = `radial-gradient(circle at 25% 25%, ${a.color} 0%, transparent 55%), radial-gradient(circle at 80% 80%, ${b.color} 0%, transparent 55%), linear-gradient(${backdrop.top}, ${backdrop.bottom})`;
  const ratio = RATIO[template.format];
  // "Your colors" can't use a loop made in other colors: it shows its own backdrop.
  const usePreview = !missing && template.backdrop !== 'brand';
  return (
    <button
      type="button"
      onClick={onPick}
      onPointerEnter={() => setLive(true)}
      onPointerLeave={() => setLive(false)}
      onFocus={() => setLive(true)}
      onBlur={() => setLive(false)}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="director-template"
      data-template-id={template.id}
    >
      <span className="relative flex h-44 items-center justify-center overflow-hidden sm:h-52" style={{ background: ground }}>
        {usePreview ? (
          <span className={cn('overflow-hidden', template.format === 'landscape' ? 'absolute inset-0' : 'relative h-full')} style={template.format === 'landscape' ? undefined : { aspectRatio: ratio.css }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.poster} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setMissing(true)} draggable={false} />
            {live && <video src={preview.video} className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline aria-hidden />}
          </span>
        ) : (
          <span className="flex h-[78%] items-center justify-center rounded-[14px] border-[3px] border-black/70 bg-white/90 shadow-xl" style={{ aspectRatio: '9 / 19.5' }} aria-hidden>
            <ClapperboardIcon className="h-5 w-5 text-black/40" />
          </span>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">{ratio.label}</span>
      </span>
      <span className="flex flex-1 flex-col gap-0.5 px-3 py-2.5">
        <span className="text-sm font-semibold">{template.name}</span>
        <span className="text-xs text-muted-foreground">{template.when}</span>
        <span className="mt-1 text-[11px] font-medium text-muted-foreground/80">{STYLE_WORDS[template.style]}</span>
      </span>
    </button>
  );
}

export function TemplateStep({
  project,
  films,
  onPick,
  onOpenFilm,
  onDeleteFilm,
}: {
  project: DirectorProject | null;
  films: Film[];
  onPick: (template: FilmTemplate) => void;
  onOpenFilm: (film: Film) => void;
  onDeleteFilm: (film: Film) => void;
}) {
  const colors = project?.colors ?? null;
  const templates = FILM_TEMPLATES.filter((template) => !template.needsColors || colors);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:py-10" data-testid="director-start">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg">
          <ClapperboardIcon className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold sm:text-2xl">Show how your app works</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Show your screen recording on a 3D phone with automatic close-ups, or choose the angles yourself
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose a video template</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="director-templates">
          {templates.map((template) => (
            <TemplateCard key={template.id} template={template} colors={colors} onPick={() => onPick(template)} />
          ))}
        </div>
      </section>

      {films.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your saved videos</h2>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3" data-testid="director-films">
            {films.map((film) => {
              const thumb = film.clips.find((clip) => clip.strip?.length)?.strip;
              return (
                <div key={film.id} className="group flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpenFilm(film)}>
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb[Math.min(thumb.length - 1, 2)].url} alt="" className="h-10 w-5 shrink-0 rounded object-cover" />
                    ) : (
                      <FilmIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{film.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {film.clips.length ? formatLength(filmDuration(film)) : 'No screen recording yet'} · Edited {new Date(film.updatedAt).toLocaleDateString()}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${film.name}`}
                    title="Delete video"
                    className="text-muted-foreground opacity-60 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={() => onDeleteFilm(film)}
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Choice({
  icon: Icon,
  title,
  body,
  onClick,
  testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-2xl border-2 bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-base font-semibold">{title}</span>
      <span className="whitespace-pre-line text-sm text-muted-foreground">{body}</span>
    </button>
  );
}

export function BeginStep({ template, onBack, onRecordingFirst, onMovesFirst }: { template: FilmTemplate | null; onBack: () => void; onRecordingFirst: () => void; onMovesFirst: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12" data-testid="director-begin">
      <div>
        <Button type="button" variant="ghost" size="sm" className="-ml-2 h-8 gap-1 px-2 text-muted-foreground" onClick={onBack}>
          <ArrowLeftIcon className="h-4 w-4" />
          Back to templates
        </Button>
        <h1 className="mt-2 text-xl font-semibold sm:text-2xl">What would you like to start with?</h1>
        {template && <p className="mt-1 text-sm text-muted-foreground"><span className="font-medium">{template.name}</span> · {template.when}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Choice
          icon={WandSparklesIcon}
          title="Use a screen recording"
          body="Choose a video of your app in use and let Director add close-ups where you tap, type or scroll"
          onClick={onRecordingFirst}
          testId="director-recording-first"
        />
        <Choice
          icon={HandIcon}
          title="Set the camera angles with your phone"
          body={"Tilt the phone in your hand left or right to show your app from different angles\nRecord those movements now and add your screen recording later"}
          onClick={onMovesFirst}
          testId="director-moves-first"
        />
      </div>
    </div>
  );
}

export function PickRecordingStep({
  project,
  dragging,
  onBack,
  onChoose,
  onUseRecording,
}: {
  project: DirectorProject | null;
  dragging: boolean;
  onBack: () => void;
  onChoose: () => void;
  onUseRecording: (recording: DirectorRecording) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12" data-testid="director-pick">
      <div>
        <Button type="button" variant="ghost" size="sm" className="-ml-2 h-8 gap-1 px-2 text-muted-foreground" onClick={onBack}>
          <ArrowLeftIcon className="h-4 w-4" />
          Back to start options
        </Button>
        <h1 className="mt-2 text-xl font-semibold sm:text-2xl">Choose your screen recording</h1>
      </div>
      <button
        type="button"
        onClick={onChoose}
        className={cn(
          'flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
        )}
        data-testid="director-drop"
      >
        <UploadIcon className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm font-semibold">Choose a video file or drop it here</span>
        <span className="text-xs text-muted-foreground">Choose an MP4 or MOV file for a video up to {MAX_FILM_SECONDS} seconds long</span>
      </button>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          How to record on iPhone
          <InfoTip label="How to record your screen on iPhone">
            <span className="block">Open Control Center and tap Screen Recording to start</span>
            <span className="block">If the button is missing, touch and hold an empty space in Control Center, choose Add a Control and add Screen Recording</span>
            <span className="block">Find the finished recording in Photos</span>
          </InfoTip>
        </span>
        <span className="flex items-center gap-1">
          How to record on Android
          <InfoTip label="How to record your screen on Android">
            <span className="block">Swipe down twice and tap Screen recorder</span>
            <span className="block">To show where you tap, turn on Show touches before recording</span>
          </InfoTip>
        </span>
      </div>
      {project && project.recordings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose a recording from this project</h2>
          <RecordingList recordings={project.recordings} onUse={onUseRecording} />
        </section>
      )}
    </div>
  );
}

export function RecordingList({ recordings, onUse }: { recordings: DirectorRecording[]; onUse: (recording: DirectorRecording) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {recordings.map((recording) => (
        <button
          key={recording.mediaId}
          type="button"
          onClick={() => onUse(recording)}
          className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
        >
          <SmartphoneIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{recording.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{recording.where}</span>
          </span>
          <span className="text-xs font-medium text-primary">Use recording</span>
        </button>
      ))}
    </div>
  );
}
