"use client";

// The project's frames as Capture sees them: a column per frame, in canvas
// order, and a row per language with the base language on top, so a row reads
// like that language's store page. A cell shows what the frame holds in that
// language, and a click chooses it as the place for the next screenshot.

import React, { useId, useState } from 'react';
import { EyeOffIcon, FilmIcon, Link2Icon, Loader2Icon, PlayIcon, RouteIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cellKey, type CaptureCell, type CaptureTarget } from '@/lib/capture/frames';
import { useThumbnail } from '@/lib/capture/thumbnails';
import { localeName } from '@/lib/i18n/locales';
import { useMediaUrl } from '@/lib/mediaStore';
import type { CaptureScreen } from '@/types/artboard';
import { cn } from '@/lib/utils';
import { Gated } from '../growth/GrowthShared';
import { InfoTip } from './InfoTip';

const CELL_WIDTH = 96;

function Picture({ src, faded }: { src: string; faded: boolean }) {
  // A small copy, twice the cell's width for a Retina display: see thumbnails.ts.
  const url = useThumbnail(src, CELL_WIDTH * 2);
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    // Absolute: as a flex item an image is never narrower than its own width,
    // so the 192px copy would overflow the 96px cell.
    <img src={url} alt="" draggable={false} className={cn('absolute inset-0 h-full w-full object-cover', faded && 'opacity-60 saturate-50')} />
  );
}

function Recording({ mediaId }: { mediaId: string }) {
  const url = useMediaUrl(mediaId);
  if (!url) return <FilmIcon className="m-auto h-5 w-5 text-muted-foreground" />;
  // Muted and never played: only a frame is wanted. WebKit paints none for a
  // video that has not played, so it is moved a little way in, which does.
  return (
    <video
      src={url}
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.5, video.duration / 2);
      }}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

export function frameTitle(target: CaptureTarget): string {
  return target.frameCount > 1 ? `${target.boardName}, frame ${target.frameNumber}` : target.boardName;
}

function screenSummary(screen: CaptureScreen | undefined): string {
  if (!screen) return 'You open this screen yourself';
  return screen.link ? `Opens with ${screen.link}` : 'First screen of your app';
}

type ScreenMode = 'start' | 'link' | 'hand';

/** The three answers, each with when to pick it and what happens then. */
const SCREEN_CHOICES: ReadonlyArray<{ mode: ScreenMode; title: string; hint: string }> = [
  {
    mode: 'start',
    title: 'The first screen of my app',
    hint: 'Choose this if the screenshot shows what people see right after they open your app. Capture takes it in every language for you.',
  },
  {
    mode: 'link',
    title: 'A screen with a link',
    hint: 'Choose this if your app can open the screen from a link, like myapp://settings. Capture takes it in every language for you. Not sure? Ask your developer.',
  },
  {
    mode: 'hand',
    title: "Another screen, I'll go there myself",
    hint: 'Choose this for any other screen, like one you can only reach by tapping around in your app. You take the screenshot in each language yourself.',
  },
];

function ScreenRoute({
  target,
  reason,
  onSave,
}: {
  target: CaptureTarget;
  reason: string | null;
  onSave: (screen: CaptureScreen | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ScreenMode>('hand');
  const [link, setLink] = useState('');
  const uid = useId();
  // The saved answer is read as the popover opens, so its first render, and
  // the focus that goes with it, already show the right answer.
  const openChange = (next: boolean) => {
    if (next) {
      setMode(!target.screen ? 'hand' : target.screen.link ? 'link' : 'start');
      setLink(target.screen?.link ?? '');
    }
    setOpen(next);
  };
  const linkOk = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(link.trim());
  const set = !!target.screen;
  return (
    <Popover open={open} onOpenChange={openChange}>
      <Gated reason={reason}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={`${screenSummary(target.screen)}. Click to change`}
            aria-label={`Choose the screen for ${frameTitle(target)}`}
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
              set && 'text-primary'
            )}
          >
            {target.screen?.link ? <Link2Icon className="h-3.5 w-3.5" /> : <RouteIcon className="h-3.5 w-3.5" />}
          </button>
        </PopoverTrigger>
      </Gated>
      <PopoverContent
        align="start"
        className="w-96 space-y-3"
        // Focus starts on the chosen answer. The popover's own choice would be its
        // first button, the (i), and focus there opens its tooltip over the answers.
        // A saved link is the exception: its box takes the focus as it appears.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
        }}
      >
        <div className="flex items-start gap-1.5">
          <p className="flex-1 text-sm font-medium">Which screen goes in this frame?</p>
          <InfoTip label="How Capture takes every language">
            <p>Capture restarts your app in each language, opens the screen, waits until nothing is moving, and takes the screenshot.</p>
            <p>All the new screenshots go in together, so one undo takes them all back out.</p>
          </InfoTip>
        </div>
        <RadioGroup value={mode} onValueChange={(value) => setMode(value as ScreenMode)} className="gap-3">
          {/* The whole row picks the answer. The radio is named by the title alone and
              described by the line under it. */}
          {SCREEN_CHOICES.map((choice) => (
            <label key={choice.mode} className="flex cursor-pointer items-start gap-2">
              <RadioGroupItem
                value={choice.mode}
                aria-labelledby={`${uid}-${choice.mode}`}
                aria-describedby={`${uid}-${choice.mode}-hint`}
                className="mt-0.5"
              />
              <span className="space-y-0.5">
                <span id={`${uid}-${choice.mode}`} className="block text-sm leading-snug">
                  {choice.title}
                </span>
                <span id={`${uid}-${choice.mode}-hint`} className="block text-xs text-muted-foreground">
                  {choice.hint}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
        {mode === 'link' && (
          <div className="space-y-1">
            <Input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="myapp://settings"
              aria-label="Link to this screen"
              className="h-8 text-xs"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {link.trim() && !linkOk ? 'A link looks like myapp://settings' : 'Paste the link that opens this screen. Not sure? Ask your developer.'}
            </p>
            {target.platform === 'ios' && (
              <div className="flex items-start gap-1">
                <p className="flex-1 text-xs text-muted-foreground">On iPhone and iPad, your app needs a few lines of code before Capture can open links</p>
                <InfoTip label="For developers: links on iPhone and iPad">
                  <p>iPhone asks before it opens a link from another app, and Capture can&apos;t tap Open.</p>
                  <p>
                    So Capture hands the link to your app when your app starts, as -OSGLink. Read the link with
                    UserDefaults.standard.string(forKey: &quot;OSGLink&quot;) and open the screen, the same way your onOpenURL does.
                  </p>
                </InfoTip>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={mode === 'link' && !linkOk}
            onClick={() => {
              onSave(mode === 'hand' ? undefined : mode === 'start' ? {} : { link: link.trim() });
              setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface CaptureGridProps {
  targets: CaptureTarget[];
  /** The base language first. */
  locales: string[];
  baseLocale: string;
  cells: Map<string, CaptureCell>;
  /** Screenshots taken by a run and not yet in the project, by cell. */
  pending: Map<string, string>;
  /** The cell a run is taking now. */
  working: string | null;
  selectedKey: string | null;
  /** The cell that just got a screenshot, for a moment. */
  flashKey: string | null;
  /** The language Capture last opened the app in. */
  appLocale: string | null;
  onSelect: (key: string) => void;
  onOpenInLanguage: (locale: string) => void;
  openReason: string | null;
  onSetScreen: (target: CaptureTarget, screen: CaptureScreen | undefined) => void;
  screenReason: string | null;
}

export function CaptureGrid({
  targets,
  locales,
  baseLocale,
  cells,
  pending,
  working,
  selectedKey,
  flashKey,
  appLocale,
  onSelect,
  onOpenInLanguage,
  openReason,
  onSetScreen,
  screenReason,
}: CaptureGridProps) {
  return (
    <div className="overflow-x-auto pb-2" data-testid="capture-grid">
      {/* globals.css gives every table the full width, every thead the primary
          colour and every other row a band; this grid is laid out by its
          cells, so it says no to all three. */}
      <table className="w-max overflow-visible rounded-none border-separate border-spacing-x-2 border-spacing-y-3">
        <thead className="bg-transparent text-foreground">
          <tr>
            <th className="sticky left-0 z-10 bg-background" />
            {targets.map((target) => (
              <th key={target.key} scope="col" className="align-bottom font-normal">
                <div className="flex items-end gap-0.5" style={{ width: CELL_WIDTH }}>
                  {/* The whole name, on as many lines as it needs: two artboards
                      can share the start of their names. */}
                  <span className="min-w-0 flex-1 break-words text-left text-xs font-medium leading-snug" data-testid="capture-frame-name">
                    {frameTitle(target)}
                  </span>
                  {target.kind === 'screenshot' && (
                    <ScreenRoute target={target} reason={screenReason} onSave={(screen) => onSetScreen(target, screen)} />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {locales.map((locale) => {
            const name = localeName(locale);
            const isBase = locale === baseLocale;
            return (
              <tr key={locale} className="!bg-transparent">
                <th scope="row" className="sticky left-0 z-10 bg-background pr-2 text-left align-middle font-normal">
                  <div className="flex w-36 flex-col gap-1">
                    <span className="truncate text-sm font-medium" dir="auto">
                      {name}
                    </span>
                    {isBase && <span className="-mt-1 text-xs text-muted-foreground">Main language</span>}
                    <Gated reason={openReason}>
                      <Button
                        variant={appLocale === locale ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-7 w-fit gap-1 px-2 text-xs"
                        title={`Restart your app in ${name}`}
                        aria-label={appLocale === locale ? `Open app again in ${name}` : `Open app in ${name}`}
                        onClick={() => onOpenInLanguage(locale)}
                      >
                        <PlayIcon className="h-3 w-3" />
                        {appLocale === locale ? 'Open app again' : 'Open app'}
                      </Button>
                    </Gated>
                  </div>
                </th>
                {targets.map((target) => {
                  const key = cellKey(target.key, locale);
                  const cell = cells.get(key);
                  const pendingSrc = pending.get(key);
                  const src = pendingSrc ?? cell?.src;
                  const own = !!pendingSrc || !!cell?.own;
                  const selected = selectedKey === key;
                  const hidden = !!cell?.hidden;
                  const label = `${frameTitle(target)} in ${name}`;
                  return (
                    <td key={key} className="align-top">
                      <button
                        type="button"
                        onClick={() => onSelect(key)}
                        aria-pressed={selected}
                        aria-label={label}
                        title={hidden ? `${frameTitle(target)} is hidden in ${name}` : label}
                        data-capture-cell={key}
                        className={cn(
                          'relative flex overflow-hidden rounded-[12px] border bg-muted transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                          flashKey === key && 'animate-pulse'
                        )}
                        style={{ width: CELL_WIDTH, aspectRatio: target.screenAspect ?? 0.46 }}
                      >
                        {hidden ? (
                          <span className="m-auto flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                            <EyeOffIcon className="h-4 w-4" />
                            Hidden
                          </span>
                        ) : target.kind === 'recording' && cell?.mediaId ? (
                          <Recording mediaId={cell.mediaId} />
                        ) : src ? (
                          <Picture src={src} faded={!own} />
                        ) : (
                          <span className="m-auto text-[10px] text-muted-foreground">Empty</span>
                        )}
                        {!hidden && !own && src && (
                          <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1 text-[10px] text-muted-foreground">
                            Example
                          </span>
                        )}
                        {target.kind === 'recording' && !hidden && (
                          <span className="absolute right-1 top-1 rounded bg-background/85 p-0.5 text-muted-foreground">
                            <FilmIcon className="h-3 w-3" />
                          </span>
                        )}
                        {working === key && (
                          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                            <Loader2Icon className="h-5 w-5 animate-spin text-primary" />
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
