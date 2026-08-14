"use client";

// One post in the feed grid.
//
// The whole card opens the post. Every action inside it (like, save, use as
// template) stops the click from reaching the card, so a tap on a heart never
// also opens the detail view.
//
// Counters are the API's numbers plus this browser's own activity, computed at
// render from the local store (viewerStats) rather than refetched, so a like
// lands instantly.

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
import { withBasePath } from '@/lib/basePath';
import { compactCount, coverBox, shortTimeAgo, surfaceLabel, viewerStats } from '@/lib/discover/format';
import { useDiscoverLocalState } from '@/lib/discover/localState';
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
}

export function PostCard({
  post,
  onOpen,
  onToggleLike,
  onToggleSave,
  onUseAsTemplate,
  onSelectTag,
}: PostCardProps) {
  const local = useDiscoverLocalState();
  const liked = local.likedPostIds.includes(post.id);
  const saved = local.savedPostIds.includes(post.id);
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
          // Plain img, not next/image: a post published in this browser renders
          // from a blob: URL minted out of IndexedDB, which next/image cannot
          // size or optimize, and the static export serves everything unchanged
          // anyway.
          <img
            src={withBasePath(cover.src)}
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
            title={liked ? 'Remove like' : 'Like this post'}
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
            title={saved ? 'Remove from saved' : 'Save for later'}
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
