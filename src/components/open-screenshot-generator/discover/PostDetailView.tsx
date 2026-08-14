"use client";

// A single post: the design at full size, who made it, and the thread under it.
//
// This is a view inside the Discover dialog rather than a dialog of its own.
// Stacking a second Radix overlay on top of the first is what the template
// picker already avoids (it holds itself closed while tips or account is up),
// and on a phone a nested dialog would leave two scroll containers fighting.

import React, { useCallback, useEffect, useState } from 'react';
import {
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HeartIcon,
  LinkIcon,
  Loader2Icon,
  RepeatIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { withBasePath } from '@/lib/basePath';
import { discoverApi } from '@/lib/discover/api';
import {
  compactCount,
  fullDate,
  shortTimeAgo,
  surfaceLabel,
  viewerStats,
} from '@/lib/discover/format';
import { useDiscoverLocalState } from '@/lib/discover/localState';
import type { DiscoverComment, DiscoverPost } from '@/types/discover';
import { AuthorAvatar } from './AuthorAvatar';

interface PostDetailViewProps {
  post: DiscoverPost;
  onToggleLike: (post: DiscoverPost, liked: boolean) => void;
  onToggleSave: (post: DiscoverPost, saved: boolean) => void;
  onToggleFollow: (authorId: string, following: boolean) => void;
  onUseAsTemplate?: (post: DiscoverPost) => void;
  onDelete?: (post: DiscoverPost) => void;
  onSelectTag: (tag: string) => void;
  onCopyLink: (post: DiscoverPost) => void;
}

export function PostDetailView({
  post,
  onToggleLike,
  onToggleSave,
  onToggleFollow,
  onUseAsTemplate,
  onDelete,
  onSelectTag,
  onCopyLink,
}: PostDetailViewProps) {
  const local = useDiscoverLocalState();
  const liked = local.likedPostIds.includes(post.id);
  const saved = local.savedPostIds.includes(post.id);
  const following = local.followedAuthorIds.includes(post.author.id);
  const stats = viewerStats(post, local);

  const [imageIndex, setImageIndex] = useState(0);
  const [comments, setComments] = useState<DiscoverComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  // Reset per post, so opening a second post does not land on the first one's
  // fourth screen or keep its half-written comment.
  useEffect(() => {
    setImageIndex(0);
    setDraft('');
    setComments(null);
    let cancelled = false;
    discoverApi
      .listComments(post.id)
      .then((result) => {
        if (!cancelled) setComments(result);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [post.id]);

  const image = post.images[imageIndex] ?? post.images[0];
  const hasMultiple = post.images.length > 1;

  const step = useCallback(
    (delta: number) => {
      setImageIndex((index) => (index + delta + post.images.length) % post.images.length);
    },
    [post.images.length]
  );

  const submitComment = async () => {
    const body = draft.trim();
    if (!body || isPosting) return;
    setIsPosting(true);
    try {
      const comment = await discoverApi.addComment(post.id, body);
      setComments((previous) => [...(previous ?? []), comment]);
      setDraft('');
    } finally {
      setIsPosting(false);
    }
  };

  const removeComment = async (comment: DiscoverComment) => {
    await discoverApi.deleteComment(post.id, comment.id);
    setComments((previous) => (previous ?? []).filter((entry) => entry.id !== comment.id));
  };

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)] lg:overflow-hidden">
      {/* Left: the design itself. Centred vertically because the thread beside
          it is usually the taller column, and a 3:1 strip pinned to the top of
          a 92vh dialog leaves a hole under it. */}
      <div className="flex min-w-0 flex-col justify-center gap-3">
        {/* aspect-ratio sets the shape, max-height keeps a portrait phone board
            from being 1700px tall in a dialog capped at 92vh. The image inside
            is object-contain either way, so the cap letterboxes rather than
            crops. */}
        <div
          className="relative w-full overflow-hidden rounded-lg border bg-muted"
          style={{ aspectRatio: image?.aspect ?? '3 / 1', maxHeight: '58vh' }}
        >
          {image?.src ? (
            <img
              src={withBasePath(image.src)}
              alt={image.label ?? post.title}
              className={cn(
                'h-full w-full',
                image.fit === 'contain' ? 'object-contain' : 'object-cover'
              )}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
              Preview unavailable
            </div>
          )}

          {hasMultiple && (
            <>
              <Button
                variant="secondary"
                size="icon"
                className="absolute left-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-background/85 shadow backdrop-blur"
                onClick={() => step(-1)}
                title="Previous image"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-background/85 shadow backdrop-blur"
                onClick={() => step(1)}
                title="Next image"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-background/85 px-2 py-0.5 text-[11px] tabular-nums shadow backdrop-blur">
                {imageIndex + 1} of {post.images.length}
              </span>
            </>
          )}
        </div>

        {hasMultiple && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {post.images.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setImageIndex(index)}
                className={cn(
                  'h-14 w-20 shrink-0 overflow-hidden rounded-md border bg-muted transition-all',
                  index === imageIndex
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'opacity-70 hover:opacity-100'
                )}
                title={entry.label ?? `Image ${index + 1}`}
              >
                <img
                  src={withBasePath(entry.src)}
                  alt=""
                  className={cn(
                    'h-full w-full',
                    entry.fit === 'contain' ? 'object-contain' : 'object-cover'
                  )}
                />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{surfaceLabel(post.surface)}</span>
          <span>·</span>
          <span>{post.screens === 1 ? '1 screen' : `${post.screens} screens`}</span>
          <span>·</span>
          <span>{compactCount(stats.views)} views</span>
          <span>·</span>
          <span>{fullDate(post.createdAt)}</span>
          {image?.label && (
            <>
              <span>·</span>
              <span className="truncate">{image.label}</span>
            </>
          )}
        </div>
      </div>

      {/* Right: author, copy, actions, thread. */}
      <div className="flex min-h-0 min-w-0 flex-col lg:overflow-hidden">
        <div className="flex items-start gap-3">
          <AuthorAvatar author={post.author} className="h-11 w-11" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-semibold">{post.author.name}</span>
              {post.author.verified && (
                <span className="rounded-full bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                  ✓
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              @{post.author.handle} · {compactCount(post.author.followers)} followers ·{' '}
              {shortTimeAgo(post.createdAt)}
            </div>
            {post.author.bio && (
              <div className="truncate text-xs text-muted-foreground">{post.author.bio}</div>
            )}
          </div>
          {!post.author.isViewer && (
            <Button
              variant={following ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 shrink-0"
              onClick={() => onToggleFollow(post.author.id, !following)}
            >
              {following ? 'Following' : 'Follow'}
            </Button>
          )}
        </div>

        <h2 className="mt-4 text-lg font-semibold leading-tight">{post.title}</h2>
        <p className="mt-1.5 whitespace-pre-line text-sm text-muted-foreground">{post.caption}</p>

        {post.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="cursor-pointer font-normal hover:border-primary/60 hover:text-primary"
                onClick={() => onSelectTag(tag)}
              >
                #{tag}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant={liked ? 'default' : 'outline'}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => onToggleLike(post, !liked)}
            aria-pressed={liked}
          >
            <HeartIcon className={cn('h-4 w-4', liked && 'fill-current')} />
            <span className="tabular-nums">{compactCount(stats.likes)}</span>
          </Button>
          <Button
            variant={saved ? 'secondary' : 'outline'}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => onToggleSave(post, !saved)}
            aria-pressed={saved}
          >
            <BookmarkIcon className={cn('h-4 w-4', saved && 'fill-current')} />
            {saved ? 'Saved' : 'Save'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => onCopyLink(post)}
            title="Copy a link to this post"
          >
            <LinkIcon className="h-4 w-4" />
            Copy link
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDelete(post)}
            >
              <Trash2Icon className="h-4 w-4" />
              Delete
            </Button>
          )}
          {onUseAsTemplate && (
            <Button
              size="sm"
              className="ml-auto h-9 gap-1.5"
              onClick={() => onUseAsTemplate(post)}
            >
              <RepeatIcon className="h-4 w-4" />
              Use as template
            </Button>
          )}
        </div>

        <Separator className="my-4" />

        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {comments === null
              ? 'Comments'
              : comments.length === 1
                ? '1 comment'
                : `${comments.length} comments`}
          </h3>
        </div>

        {/* Native overflow, never a Radix ScrollArea: this column is a flex
            child of a max-h capped dialog, where a ScrollArea viewport cannot
            resolve its height and silently stops scrolling. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {comments === null && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex gap-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {comments?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No comments yet. Be the first to say something useful
            </p>
          )}

          {comments?.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              onDelete={comment.isMine ? () => removeComment(comment) : undefined}
            />
          ))}
        </div>

        <div className="mt-3 flex items-end gap-2 border-t pt-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment"
            rows={2}
            className="min-h-[2.5rem] resize-none"
            onKeyDown={(event) => {
              // Enter posts, Shift+Enter breaks the line: the shape of every
              // comment box people already use.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submitComment();
              }
            }}
          />
          <Button
            size="icon"
            className="h-10 w-10 shrink-0"
            disabled={!draft.trim() || isPosting}
            onClick={() => void submitComment()}
            title="Post comment"
          >
            {isPosting ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <SendIcon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  onDelete,
}: {
  comment: DiscoverComment;
  onDelete?: () => void;
}) {
  const local = useDiscoverLocalState();
  const liked = local.likedCommentIds.includes(comment.id);
  const likes = comment.likes + (liked ? 1 : 0);

  return (
    <div className="flex gap-2">
      <AuthorAvatar author={comment.author} className="h-8 w-8" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-medium">{comment.author.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {shortTimeAgo(comment.createdAt)}
          </span>
        </div>
        <p className="whitespace-pre-line text-sm text-muted-foreground">{comment.body}</p>
        <div className="mt-0.5 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1 px-1.5 text-xs', liked && 'text-primary')}
            onClick={() => void discoverApi.setCommentLike(comment.id, !liked)}
            aria-pressed={liked}
          >
            <HeartIcon className={cn('h-3.5 w-3.5', liked && 'fill-current')} />
            {likes > 0 && <span className="tabular-nums">{compactCount(likes)}</span>}
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-xs text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
