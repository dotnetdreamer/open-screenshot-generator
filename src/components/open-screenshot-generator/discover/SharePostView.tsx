"use client";

// Share the open project to the feed.
//
// The screens are captured from the live canvas with the same html-to-image
// pass the PNG export uses, so what gets posted is exactly what would be
// uploaded to the store, not a re-render that might disagree with it. Capture
// starts as soon as this view opens, because it is the slow part and there is
// no reason to make the user wait for it after they have finished typing.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircleIcon, CheckIcon, ImageIcon, Loader2Icon, SendIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { artboardBackground } from '@/lib/artboardBackground';
import { discoverApi } from '@/lib/discover/api';
import { composeStrip, downscaleBoard, guessSurface, type CapturedBoard } from '@/lib/discover/capture';
import { parseTags, SURFACE_LABELS } from '@/lib/discover/format';
import type { ArtboardState } from '@/types/artboard';
import type { DiscoverPost, DiscoverSurface, PublishImageInput } from '@/types/discover';

/** Capturing every board of a 12 screen project is slow and nobody reads 12. */
const MAX_BOARDS = 5;

/**
 * How long one board gets before it is given up on.
 *
 * html-to-image inlines the webfont stylesheet as part of the capture, and a
 * font request that never settles (a flaky network, a blocked font host, a
 * browser refusing new connections) leaves its promise pending forever. Without
 * this the share form sits on "Capturing screen 1 of 5" with no way forward.
 * Generous, because a big board on a slow machine legitimately takes seconds.
 */
const CAPTURE_TIMEOUT_MS = 30_000;

/**
 * And how long the whole set gets. Five boards that each take just under the
 * per-board limit would otherwise leave the form spinning for two and a half
 * minutes. Past this the boards that made it become the post and the rest are
 * named as skipped, which is a far better answer than a spinner.
 */
const CAPTURE_BUDGET_MS = 75_000;

/** Resolve to null instead of hanging when a capture stalls. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

interface SharePostViewProps {
  projectName: string;
  artboards: ArtboardState[];
  /** Rasterize one board from the live canvas. Null when it is not mounted. */
  captureArtboard: (artboard: ArtboardState) => Promise<string | null>;
  onPublished: (post: DiscoverPost) => void;
  onCancel: () => void;
}

type CaptureState =
  | { status: 'idle' }
  | { status: 'capturing'; done: number; total: number }
  | { status: 'ready'; boards: CapturedBoard[] }
  | { status: 'error'; message: string };

export function SharePostView({
  projectName,
  artboards,
  captureArtboard,
  onPublished,
  onCancel,
}: SharePostViewProps) {
  // Null only if the session lapsed between opening this form and submitting
  // it. DiscoverDialog does not offer this view to a guest at all, and publish()
  // below fails closed anyway.
  const viewer = discoverApi.getViewer();
  // Memoized so runCapture keeps one identity: the capture effect must fire
  // once, not on every keystroke in the form below it.
  const boardsToCapture = useMemo(() => artboards.slice(0, MAX_BOARDS), [artboards]);

  const [capture, setCapture] = useState<CaptureState>({ status: 'idle' });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [title, setTitle] = useState(projectName ? `${projectName} store set` : 'My store set');
  const [caption, setCaption] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [appName, setAppName] = useState(projectName);
  const [surface, setSurface] = useState<DiscoverSurface>(() => guessSurface(artboards[0]?.size));
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Boards that timed out or failed, named so the user is not left guessing. */
  const [skippedBoards, setSkippedBoards] = useState<string[]>([]);

  // Capture runs once per mount. The ref guards against React 18's double
  // effect in development, which would otherwise rasterize every board twice.
  const captureStarted = useRef(false);

  const runCapture = useCallback(async () => {
    if (boardsToCapture.length === 0) {
      setCapture({ status: 'error', message: 'This project has no artboards to share yet.' });
      return;
    }
    setCapture({ status: 'capturing', done: 0, total: boardsToCapture.length });
    const captured: CapturedBoard[] = [];
    const skipped: string[] = [];
    const deadline = Date.now() + CAPTURE_BUDGET_MS;
    try {
      for (const [index, board] of boardsToCapture.entries()) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          skipped.push(board.name);
          continue;
        }
        // Sequential on purpose: html-to-image walks and clones the whole
        // subtree, and running five of those at once on a phone is how you get
        // a blank capture.
        const dataUrl = await withTimeout(
          captureArtboard(board),
          Math.min(CAPTURE_TIMEOUT_MS, remaining)
        );
        if (dataUrl) {
          captured.push({
            id: board.id,
            dataUrl,
            width: board.size.width,
            height: board.size.height,
            name: board.name,
          });
        } else {
          // One board that will not rasterize must not cost the user the post.
          // It is left out and named in the note under the thumbnails.
          skipped.push(board.name);
        }
        setCapture({ status: 'capturing', done: index + 1, total: boardsToCapture.length });
      }
    } catch (cause) {
      setCapture({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'The screens could not be captured.',
      });
      return;
    }

    if (captured.length === 0) {
      setCapture({
        status: 'error',
        message: 'None of the artboards could be captured. Scroll them into view and try again.',
      });
      return;
    }
    setSkippedBoards(skipped);
    setCapture({ status: 'ready', boards: captured });
    setSelected(Object.fromEntries(captured.map((board) => [board.id, true])));
  }, [boardsToCapture, captureArtboard]);

  useEffect(() => {
    if (captureStarted.current) return;
    captureStarted.current = true;
    void runCapture();
  }, [runCapture]);

  const capturedBoards = capture.status === 'ready' ? capture.boards : [];
  const chosenBoards = capturedBoards.filter((board) => selected[board.id]);
  const canPublish =
    capture.status === 'ready' && chosenBoards.length > 0 && title.trim().length > 0 && !isPublishing;

  const publish = async () => {
    if (!canPublish) return;
    setIsPublishing(true);
    setError(null);
    try {
      const background = artboardBackground(artboards[0] ?? { backgroundColor: '#ffffff' })
        .backgroundColor;
      const images: PublishImageInput[] = [];

      // A single board is its own cover: a one board strip would just be the
      // same picture with padding around it.
      if (chosenBoards.length > 1) {
        const strip = await composeStrip(chosenBoards, background);
        // Deliberately unlabelled: the meta row under the carousel already
        // states the screen count, and labelling the cover repeated it.
        images.push({ blob: strip.blob, aspect: '3 / 1', fit: 'contain' });
      }

      for (const board of chosenBoards) {
        const image = await downscaleBoard(board);
        images.push({
          blob: image.blob,
          aspect: `${board.width} / ${board.height}`,
          fit: 'contain',
          label: board.name,
        });
      }

      const post = await discoverApi.publishPost({
        title: title.trim(),
        caption: caption.trim(),
        tags: parseTags(tagInput),
        surface,
        appName: appName.trim() || undefined,
        screens: chosenBoards.length,
        images,
      });
      onPublished(post);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The post could not be published.');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(320px,26rem)] lg:overflow-hidden">
      {/* Left: what will be posted. */}
      <div className="flex min-w-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
        <div>
          <h3 className="text-sm font-semibold">Screens</h3>
          <p className="text-xs text-muted-foreground">
            Captured from the canvas. Untick any you would rather not post
            {artboards.length > MAX_BOARDS
              ? `. The first ${MAX_BOARDS} of ${artboards.length} artboards are used`
              : ''}
          </p>
        </div>

        {capture.status === 'capturing' && (
          <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            Capturing screen {capture.done + 1} of {capture.total}
          </div>
        )}

        {capture.status === 'error' && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1">
              <p>{capture.message}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-8"
                onClick={() => void runCapture()}
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {capture.status === 'ready' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {capture.boards.map((board) => {
              const isOn = !!selected[board.id];
              return (
                <button
                  key={board.id}
                  type="button"
                  onClick={() =>
                    setSelected((previous) => ({ ...previous, [board.id]: !previous[board.id] }))
                  }
                  className={cn(
                    'group relative overflow-hidden rounded-lg border bg-muted transition-all',
                    isOn ? 'border-primary ring-2 ring-primary/25' : 'opacity-60 hover:opacity-90'
                  )}
                  style={{ aspectRatio: `${board.width} / ${board.height}` }}
                  title={isOn ? `Remove ${board.name}` : `Include ${board.name}`}
                  aria-pressed={isOn}
                >
                  <img src={board.dataUrl} alt={board.name} className="h-full w-full object-contain" />
                  <span
                    className={cn(
                      'absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                      isOn
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background/85'
                    )}
                  >
                    {isOn && <CheckIcon className="h-3 w-3" />}
                  </span>
                  <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-1.5 py-0.5 text-[10px] backdrop-blur">
                    {board.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {capture.status === 'ready' && skippedBoards.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {skippedBoards.length === 1
              ? `${skippedBoards[0]} took too long to capture and was left out`
              : `${skippedBoards.length} screens took too long to capture and were left out`}
          </p>
        )}

        {capture.status === 'ready' && chosenBoards.length > 1 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" />
            The cover is a strip of the {chosenBoards.length} screens, and each one is also in the
            post
          </p>
        )}
      </div>

      {/* Right: the post itself. */}
      <div className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
        <div className="space-y-1.5">
          <Label htmlFor="discover-title">Title</Label>
          <Input
            id="discover-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What did you make"
            maxLength={90}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="discover-caption">Caption</Label>
          <Textarea
            id="discover-caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="What you were going for, what you would still change, what worked"
            rows={4}
            maxLength={600}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="discover-app">App name</Label>
            <Input
              id="discover-app"
              value={appName}
              onChange={(event) => setAppName(event.target.value)}
              placeholder="Optional"
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discover-surface">Surface</Label>
            <Select value={surface} onValueChange={(value) => setSurface(value as DiscoverSurface)}>
              <SelectTrigger id="discover-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SURFACE_LABELS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="discover-tags">Tags</Label>
          <Input
            id="discover-tags"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            placeholder="fitness, gradient, bold"
          />
          {parseTags(tagInput).length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {parseTags(tagInput).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Not editable here, and that is the point of signing in: the post
            carries the account it was published from, so a name on a card means
            the same thing every time it appears. */}
        <div className="space-y-1.5">
          <Label>Posting as</Label>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">{viewer?.name ?? 'your account'}</span>
            {viewer?.handle && (
              <span className="text-muted-foreground">@{viewer.handle}</span>
            )}
          </div>
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-sm text-destructive">
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Anyone can see this post and open it as a starting point for their own. You can delete it
          from the feed at any time
        </p>

        <div className="mt-auto flex items-center gap-2 border-t pt-3">
          <Button variant="outline" onClick={onCancel} disabled={isPublishing}>
            Cancel
          </Button>
          <Button className="ml-auto gap-1.5" onClick={() => void publish()} disabled={!canPublish}>
            {isPublishing ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <SendIcon className="h-4 w-4" />
            )}
            {isPublishing ? 'Publishing' : 'Publish to Discover'}
          </Button>
        </div>
      </div>
    </div>
  );
}
