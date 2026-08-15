"use client";

// One post in the feed grid.
//
// The whole card opens the post. Every action inside it (like, save, use as
// template) stops the click from reaching the card, so a tap on a heart never
// also opens the detail view.
//
// Counters are the server's numbers adjusted by whatever this browser has just
// tapped (viewerStats) rather than refetched, so a like lands instantly and is
// corrected by the next page load rather than by a round trip.
//
// A signed-out visitor sees every one of these numbers and none of the buttons
// that change them: like and save render disabled with a title that says why.
// The server refuses those writes regardless — this is the courtesy half.

import React from 'react';
import {
  BookmarkIcon,
  HeartIcon,
  MessageCircleIcon,
  RepeatIcon,
  SparklesIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { compactCount, coverBox, shortTimeAgo, surfaceLabel, viewerStats } from '@/lib/discover/format';
import { isLiked, isSaved, useDiscoverLocalState } from '@/lib/discover/localState';
import type { DiscoverPost } from '@/types/discover';
import { AuthorAvatar } from './AuthorAvatar';

interface PostCardProps {
  post: DiscoverPost;
  onOpen: (post: DiscoverPost) => void;
  onToggleLike: (post: DiscoverPost, liked: boolean) => void;
  onToggleSave: (post: DiscoverPost, saved: boolean) => void;
  /** Absent when the post has no project behind it (nothing to open). */
  onUseAsTemplate?: (post: DiscoverPost) => void;
  onSelectTag?: (tag: string) => void;
  /**
   * False for a guest. The two buttons that write stay live either way: the
   * owner of onToggleLike/onToggleSave turns the click into a sign-in prompt,
   * because a disabled button cannot tell anybody what it wants from them.
   * This only picks the tooltip.
   */
  canInteract?: boolean;
}

export function PostCard({
  post,
  onOpen,
  onToggleLike,
  onToggleSave,
  onUseAsTemplate,
  onSelectTag,
  canInteract = false,
}: PostCardProps) {
  const local = useDiscoverLocalState();
  const liked = isLiked(local, post.id, post.likedByViewer);
  const saved = isSaved(local, post.id, post.savedByViewer);
  const stats = viewerStats(post, local);
  const cover = post.images[0];
  const box = coverBox(cover);

  return (
    // The whole card opens the post for a click or a tap. Keyboard and screen
    // reader users get there through the title button below instead, so this
    // stays a plain container rather than a role="button" wrapped around half a
    // dozen real buttons.
    <Card
      className="group flex cursor-pointer flex-col overflow-hidden border transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-xl"
      onClick={() => onOpen(post)}
    >
      <div
        className="relative w-full shrink-0 overflow-hidden bg-muted"
        style={{ aspectRatio: box.aspect }}
      >
        {cover?.src ? (
          // Plain img, not next/image: the static export ships no optimizer, and
          // every one of these is an absolute URL on the community backend
          // rather than an asset in public/ — so withBasePath would be wrong
          // here as well as useless.
          <img
            src={cover.src}
            alt={post.title}
            loading="lazy"
            className={cn(
              'h-full w-full transition-transform duration-300 group-hover:scale-[1.03]',
              box.fit === 'contain' ? 'object-contain' : 'object-cover'
            )}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            Preview unavailable
          </div>
        )}

        <div className="pointer-events-none absolute left-2 top-2 flex gap-1.5">
          <Badge variant="secondary" className="bg-background/85 shadow-sm backdrop-blur">
            {surfaceLabel(post.surface)}
          </Badge>
          {post.isMine && (
            <Badge className="shadow-sm">
              <SparklesIcon className="mr-1 h-3 w-3" />
              Yours
            </Badge>
          )}
        </div>

        {post.screens > 1 && (
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium tabular-nums shadow-sm backdrop-blur">
            {post.screens} screens
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <AuthorAvatar author={post.author} className="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-sm font-medium">{post.author.name}</span>
              {post.author.verified && (
                <span
                  title="Verified"
                  className="shrink-0 rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary"
                >
                  ✓
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              @{post.author.handle} · {shortTimeAgo(post.createdAt)}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight">
            <button
              type="button"
              className="line-clamp-1 w-full text-left hover:text-primary"
              onClick={(event) => {
                event.stopPropagation();
                onOpen(post);
              }}
            >
              {post.title}
            </button>
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.caption}</p>
        </div>

        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {post.tags.slice(0, 4).map((tag) => (
              <button
                key={tag}
                type="button"
                className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectTag?.(tag);
                }}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-1 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-8 gap-1.5 px-2', liked && 'text-primary')}
            onClick={(event) => {
              event.stopPropagation();
              onToggleLike(post, !liked);
            }}
            title={
              canInteract
                ? liked
                  ? 'Remove like'
                  : 'Like this post'
                : 'Sign in to like posts'
            }
            aria-pressed={liked}
          >
            <HeartIcon className={cn('h-4 w-4', liked && 'fill-current')} />
            <span className="text-xs tabular-nums">{compactCount(stats.likes)}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(post);
            }}
            title="Read the comments"
          >
            <MessageCircleIcon className="h-4 w-4" />
            <span className="text-xs tabular-nums">{compactCount(stats.comments)}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-muted-foreground"
            title={`Opened as a starting point ${stats.remixes} times`}
            onClick={(event) => event.stopPropagation()}
          >
            <RepeatIcon className="h-4 w-4" />
            <span className="text-xs tabular-nums">{compactCount(stats.remixes)}</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className={cn('ml-auto h-8 w-8', saved && 'text-primary')}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSave(post, !saved);
            }}
            title={
              canInteract
                ? saved
                  ? 'Remove from saved'
                  : 'Save for later'
                : 'Sign in to save posts'
            }
            aria-pressed={saved}
          >
            <BookmarkIcon className={cn('h-4 w-4', saved && 'fill-current')} />
          </Button>

          {onUseAsTemplate && (
            <Button
              size="sm"
              className="h-8"
              onClick={(event) => {
                event.stopPropagation();
                onUseAsTemplate(post);
              }}
              title="Open this design as a new project"
            >
              Use as template
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
