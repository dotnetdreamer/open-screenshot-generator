"use client";

// Discover: the community feed.
//
// One dialog with three views (the grid, a post, the share form), switched in
// place rather than stacked as nested dialogs, which is the same shape the
// template picker uses for its agent screen. Views switch instead of stacking
// because two Radix overlays on a phone leave two scroll containers fighting
// each other.
//
// Nothing in here knows where a post comes from. Everything goes through
// discoverApi (src/lib/discover/api.ts), which is mock data today and an HTTP
// client later.

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeftIcon,
  CompassIcon,
  Loader2Icon,
  SearchIcon,
  SparklesIcon,
  UploadIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { BASE_PATH } from '@/lib/basePath';
import { discoverApi } from '@/lib/discover/api';
import { SURFACE_LABELS } from '@/lib/discover/format';
import { useDiscoverFeed } from '@/lib/discover/useFeed';
import type { ArtboardState, Project } from '@/types/artboard';
import type {
  DiscoverFeedQuery,
  DiscoverPost,
  DiscoverSort,
  DiscoverScope,
  DiscoverSurface,
  DiscoverTagCount,
} from '@/types/discover';
import { PostCard } from './PostCard';
import { PostDetailView } from './PostDetailView';
import { SharePostView } from './SharePostView';

/**
 * The feed tabs. Sort and scope are one control on purpose: "Saved" is a
 * different set of posts, not a different order, and splitting them into two
 * rows of controls buys nothing for a feed this size.
 */
const FEED_TABS: {
  id: string;
  label: string;
  sort: DiscoverSort;
  scope: DiscoverScope;
}[] = [
  { id: 'for-you', label: 'For you', sort: 'for-you', scope: 'all' },
  { id: 'trending', label: 'Trending', sort: 'trending', scope: 'all' },
  { id: 'newest', label: 'Newest', sort: 'newest', scope: 'all' },
  { id: 'top', label: 'Top', sort: 'top', scope: 'all' },
  { id: 'following', label: 'Following', sort: 'newest', scope: 'following' },
  { id: 'saved', label: 'Saved', sort: 'newest', scope: 'saved' },
  { id: 'mine', label: 'Yours', sort: 'newest', scope: 'mine' },
];

interface DiscoverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Which screen to open on. 'share' is how the toolbar button and the export
   * toast skip the grid and land the user straight on the share form.
   */
  initialView?: 'feed' | 'share';
  /** The templates the app already loaded. They seed the mock feed. */
  templates: Project[];
  isLoadingTemplates?: boolean;
  /** Post to open straight away, from a ?post= link. */
  initialPostId?: string | null;
  /** Clear the deep link once it has been consumed. */
  onInitialPostConsumed?: () => void;
  /** Open the design behind a post as a new project. */
  onUseTemplate: (post: DiscoverPost) => void;
  /** The open project, which is what "Share your design" posts. */
  projectName: string;
  artboards: ArtboardState[];
  captureArtboard: (artboard: ArtboardState) => Promise<string | null>;
}

export function DiscoverDialog({
  open,
  onOpenChange,
  initialView = 'feed',
  templates,
  isLoadingTemplates = false,
  initialPostId,
  onInitialPostConsumed,
  onUseTemplate,
  projectName,
  artboards,
  captureArtboard,
}: DiscoverDialogProps) {
  const { toast } = useToast();
  const [view, setView] = useState<'feed' | 'post' | 'share'>('feed');
  const [activePost, setActivePost] = useState<DiscoverPost | null>(null);
  const [tab, setTab] = useState('for-you');
  const [surface, setSurface] = useState<DiscoverSurface | 'all'>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tags, setTags] = useState<DiscoverTagCount[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  // Keystrokes must not fire a query each: the deferred value is what the feed
  // actually asks for, same treatment the template gallery gives its search.
  const deferredSearch = useDeferredValue(search);

  // Seeded during render rather than in an effect, so the very first feed
  // request already has posts to return instead of painting an empty state and
  // then replacing it. seed() is idempotent and returns early once the catalog
  // it was given stops changing.
  const seedSignature = `${templates.length}`;
  useMemo(() => discoverApi.seed(templates), [seedSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    discoverApi.listTags().then(setTags).catch(() => setTags([]));
  }, [open, seedSignature, refreshToken]);

  // Opening from the toolbar or the export toast lands on the share form; every
  // other entry point lands on the grid. Keyed on `open` so switching views
  // inside a session is never overridden.
  useEffect(() => {
    if (!open) return;
    setView(initialView);
    if (initialView === 'share') setActivePost(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A ?post= link opens straight into that post.
  useEffect(() => {
    if (!open || !initialPostId) return;
    let cancelled = false;
    discoverApi.getPost(initialPostId).then((post) => {
      if (cancelled || !post) return;
      setActivePost(post);
      setView('post');
      onInitialPostConsumed?.();
    });
    return () => {
      cancelled = true;
    };
  }, [open, initialPostId, seedSignature, onInitialPostConsumed]);

  const activeTab = FEED_TABS.find((entry) => entry.id === tab) ?? FEED_TABS[0];
  const query: DiscoverFeedQuery = {
    sort: activeTab.sort,
    scope: activeTab.scope,
    surface,
    tag: tag ?? undefined,
    search: deferredSearch.trim() || undefined,
  };

  const openPost = (post: DiscoverPost) => {
    setActivePost(post);
    setView('post');
  };

  const backToFeed = () => {
    setView('feed');
    setActivePost(null);
  };

  const toggleLike = (post: DiscoverPost, liked: boolean) => {
    void discoverApi.setLike(post.id, liked);
  };

  const toggleSave = (post: DiscoverPost, saved: boolean) => {
    void discoverApi.setSaved(post.id, saved);
    toast({
      title: saved ? 'Saved' : 'Removed from saved',
      description: saved ? 'Find it again under Saved' : undefined,
    });
  };

  const toggleFollow = (authorId: string, following: boolean) => {
    void discoverApi.setFollow(authorId, following);
  };

  const useAsTemplate = (post: DiscoverPost) => {
    void discoverApi.recordRemix(post.id);
    onUseTemplate(post);
  };

  const copyLink = async (post: DiscoverPost) => {
    const url =
      typeof window === 'undefined'
        ? ''
        : `${window.location.origin}${BASE_PATH}/?post=${encodeURIComponent(post.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied', description: url });
    } catch {
      toast({
        title: 'Could not copy the link',
        description: url,
        variant: 'destructive',
      });
    }
  };

  const deletePost = async (post: DiscoverPost) => {
    await discoverApi.deletePost(post.id);
    setRefreshToken((token) => token + 1);
    backToFeed();
    toast({ title: 'Post deleted', description: `"${post.title}" is no longer in your feed.` });
  };

  const onPublished = (post: DiscoverPost) => {
    setRefreshToken((token) => token + 1);
    setTab('mine');
    setActivePost(post);
    setView('post');
    toast({
      title: 'Shared to Discover',
      description: 'Your post is in the feed under Yours',
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        // Always reopen on the grid: coming back to a half-written share form
        // from three days ago is nobody's expectation.
        if (!next) {
          setView('feed');
          setActivePost(null);
        }
      }}
    >
      <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-[1400px] flex-col gap-3">
        {view === 'feed' && (
          <>
            <DialogHeader className="space-y-0 text-left">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <DialogTitle className="flex items-center gap-2">
                    <CompassIcon className="h-5 w-5 text-primary" />
                    Discover
                  </DialogTitle>
                  <DialogDescription>
                    Store graphics other people shipped. Open any of them as a starting point for
                    your own
                  </DialogDescription>
                </div>
                <div className="relative w-full sm:w-64">
                  <SearchIcon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search posts, tags, people"
                    className="h-9 pl-8"
                  />
                </div>
                <Button className="h-9 gap-1.5" onClick={() => setView('share')}>
                  <UploadIcon className="h-4 w-4" />
                  Share your design
                </Button>
              </div>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  {FEED_TABS.map((entry) => (
                    <TabsTrigger key={entry.id} value={entry.id}>
                      {entry.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <Select
                value={surface}
                onValueChange={(value) => setSurface(value as DiscoverSurface | 'all')}
              >
                <SelectTrigger className="h-9 w-[11.5rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every surface</SelectItem>
                  {Object.entries(SURFACE_LABELS).map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(tag || surface !== 'all' || search) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setTag(null);
                    setSurface('all');
                    setSearch('');
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>

            {tags.length > 0 && (
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {tags.slice(0, 20).map((entry) => (
                  <button
                    key={entry.tag}
                    type="button"
                    onClick={() => setTag(tag === entry.tag ? null : entry.tag)}
                    className={cn(
                      'shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors',
                      tag === entry.tag
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/70 text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    )}
                  >
                    #{entry.tag}
                    <span className="ml-1 tabular-nums opacity-60">{entry.count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Remounting on a new seed or after a publish is what re-runs the
                query from page one, so pagination can never carry stale rows. */}
            <FeedGrid
              key={`${seedSignature}:${refreshToken}`}
              query={query}
              isSeeding={isLoadingTemplates && templates.length === 0}
              scope={activeTab.scope}
              onOpen={openPost}
              onToggleLike={toggleLike}
              onToggleSave={toggleSave}
              onUseAsTemplate={useAsTemplate}
              onSelectTag={setTag}
              onShare={() => setView('share')}
            />
          </>
        )}

        {view === 'post' && activePost && (
          <>
            <DialogHeader className="space-y-0 text-left">
              <div className="flex items-start gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="-ml-2 h-8 w-8 shrink-0"
                  onClick={backToFeed}
                  aria-label="Back to the feed"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="truncate">{activePost.title}</DialogTitle>
                  <DialogDescription className="truncate">
                    Posted by {activePost.author.name}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <PostDetailView
              post={activePost}
              onToggleLike={toggleLike}
              onToggleSave={toggleSave}
              onToggleFollow={toggleFollow}
              onUseAsTemplate={activePost.templateProjectId ? useAsTemplate : undefined}
              onDelete={activePost.isMine ? (post) => void deletePost(post) : undefined}
              onSelectTag={(selected) => {
                setTag(selected);
                setTab('for-you');
                backToFeed();
              }}
              onCopyLink={(post) => void copyLink(post)}
            />
          </>
        )}

        {view === 'share' && (
          <>
            <DialogHeader className="space-y-0 text-left">
              <div className="flex items-start gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="-ml-2 h-8 w-8 shrink-0"
                  onClick={backToFeed}
                  aria-label="Back to the feed"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <DialogTitle>Share your design</DialogTitle>
                  <DialogDescription>
                    Post the screens from {projectName || 'this project'} to the feed
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <SharePostView
              projectName={projectName}
              artboards={artboards}
              captureArtboard={captureArtboard}
              onPublished={onPublished}
              onCancel={backToFeed}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FeedGridProps {
  query: DiscoverFeedQuery;
  isSeeding: boolean;
  scope: DiscoverScope;
  onOpen: (post: DiscoverPost) => void;
  onToggleLike: (post: DiscoverPost, liked: boolean) => void;
  onToggleSave: (post: DiscoverPost, saved: boolean) => void;
  onUseAsTemplate: (post: DiscoverPost) => void;
  onSelectTag: (tag: string) => void;
  onShare: () => void;
}

function FeedGrid({
  query,
  isSeeding,
  scope,
  onOpen,
  onToggleLike,
  onToggleSave,
  onUseAsTemplate,
  onSelectTag,
  onShare,
}: FeedGridProps) {
  const { posts, isLoading, isLoadingMore, error, total, hasMore, loadMore } =
    useDiscoverFeed(query);
  const showSkeletons = isSeeding || isLoading;

  return (
    // Native overflow container, never a Radix ScrollArea: this is a flex child
    // of a max-h capped dialog, where a ScrollArea viewport cannot resolve its
    // height and silently stops scrolling.
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {showSkeletons ? (
        <div className="grid gap-5 p-1 md:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="overflow-hidden">
              <Skeleton className="w-full rounded-none" style={{ aspectRatio: '3 / 1' }} />
              <div className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
              </div>
            </Card>
          ))}
        </div>
      ) : error ? (
        <p className="py-16 text-center text-sm text-destructive">{error}</p>
      ) : posts.length === 0 ? (
        <EmptyState scope={scope} onShare={onShare} />
      ) : (
        <>
          <div className="grid gap-5 p-1 md:grid-cols-2 2xl:grid-cols-3">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onOpen={onOpen}
                onToggleLike={onToggleLike}
                onToggleSave={onToggleSave}
                onUseAsTemplate={post.templateProjectId ? onUseAsTemplate : undefined}
                onSelectTag={onSelectTag}
              />
            ))}
          </div>

          <div className="flex flex-col items-center gap-2 py-6">
            {hasMore ? (
              <Button variant="outline" onClick={loadMore} disabled={isLoadingMore} className="gap-1.5">
                {isLoadingMore && <Loader2Icon className="h-4 w-4 animate-spin" />}
                Load more
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                That is all {total} {total === 1 ? 'post' : 'posts'} for this filter
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ scope, onShare }: { scope: DiscoverScope; onShare: () => void }) {
  const copy: Record<DiscoverScope, { title: string; body: string }> = {
    all: {
      title: 'Nothing matches that',
      body: 'Try a different tag, surface or search term',
    },
    following: {
      title: 'You are not following anyone yet',
      body: 'Open a post and follow its author to build this tab',
    },
    saved: {
      title: 'Nothing saved yet',
      body: 'Tap the bookmark on a post to keep it here',
    },
    mine: {
      title: 'You have not shared anything yet',
      body: 'Post the project you have open and it shows up here',
    },
  };
  const { title, body } = copy[scope];

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <SparklesIcon className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {scope === 'mine' && (
        <Button className="gap-1.5" onClick={onShare}>
          <UploadIcon className="h-4 w-4" />
          Share your design
        </Button>
      )}
    </div>
  );
}
