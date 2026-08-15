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
// discoverApi (src/lib/discover/api.ts), which talks to the community backend
// in infra/vps.
//
// ## Guests read, accounts write
//
// The feed, the search, a post and its comments all work signed out, and that
// is the ordinary state for most visitors. Everything that writes — posting,
// commenting, liking, saving, following — needs the community session, which is
// minted from whichever storage account is already connected (see
// lib/discover/session.ts). So this dialog has one extra job the mock version
// did not: telling somebody, once and without nagging, that signing in is what
// unlocks the buttons they can see but not press.

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
import {
  DiscoverRequestError,
  DiscoverSignInRequiredError,
  discoverApi,
} from '@/lib/discover/api';
import { SURFACE_LABELS } from '@/lib/discover/format';
import {
  forgetAuthorIntent,
  forgetPostIntent,
  resetLocalState,
  setAuthorFollowed,
  setPostLiked,
  setPostSaved,
} from '@/lib/discover/localState';
import { isDiscoverConfigured, useDiscoverSession } from '@/lib/discover/session';
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
  /** Open the account dialog, which is where a community session comes from. */
  onRequestSignIn?: (hint?: string) => void;
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
  onRequestSignIn,
}: DiscoverDialogProps) {
  const { toast } = useToast();
  const { isSignedIn, viewer, capabilities } = useDiscoverSession();
  // Writing needs both halves: somebody signed in, and a box that is accepting
  // writes. `writes_enabled` is the operator's read-only switch, and honouring
  // it here is what stops every button answering 503 during a migration.
  const canInteract = isSignedIn && capabilities?.writes !== false;
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
    // A guest who arrived from the toolbar's Share button or the export toast
    // lands on the feed instead, with the sign-in prompt the button would have
    // given them. Landing on a share form they cannot submit is worse.
    if (initialView === 'share' && !canInteract) {
      setView('feed');
      setActivePost(null);
      return;
    }
    setView(initialView);
    if (initialView === 'share') setActivePost(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canInteract]);

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

  /**
   * Open a post, then ask the server for it again.
   *
   * The card already holds everything the detail view renders, so it is shown
   * immediately — waiting on a round trip to display data that is already in
   * memory would be a spinner for nothing. The refetch behind it does two
   * things the card cannot: it is what counts the view (the counter lives on
   * GET /posts/:id, so a feed that never calls it would leave every post on
   * zero forever), and it brings back a comment count that may have moved since
   * the page was fetched.
   *
   * A failure is ignored on purpose. The post is already on screen and correct
   * enough; replacing it with an error because a counter did not update would
   * be strictly worse.
   */
  const openPost = (post: DiscoverPost) => {
    setActivePost(post);
    setView('post');
    void discoverApi
      .getPost(post.id)
      .then((fresh) => {
        // Only if the viewer has not moved on: a slow response must not haul
        // them back to a post they already navigated away from.
        if (fresh) setActivePost((current) => (current?.id === fresh.id ? fresh : current));
      })
      .catch(() => {
        // Already showing the card's copy.
      });
  };

  const backToFeed = () => {
    setView('feed');
    setActivePost(null);
  };

  /**
   * Ask for a sign-in, once, in the same words every time.
   *
   * Called from the two places somebody can reach a write without one: a stale
   * session that answered 401, and a button that slipped past `canInteract`
   * between renders.
   */
  const promptSignIn = (what: string) => {
    resetLocalState();
    if (onRequestSignIn) {
      onRequestSignIn(`Connect Google Drive or GitHub to ${what} in Discover.`);
      return;
    }
    toast({
      title: 'Sign in first',
      description: `Connect an account to ${what}.`,
    });
  };

  /**
   * Every toggle, in one shape: paint it, send it, put it back if it failed.
   *
   * The overlay is written before the request goes out so the heart fills in on
   * the tap rather than on the round trip, and `forget` on failure drops the
   * intention so the button snaps back to whatever the server actually says.
   * Without that, a like that failed stays filled in until the feed is
   * refetched, which is the worst of both: it looks saved and is not.
   */
  const write = async (
    action: () => Promise<void>,
    optimistic: () => void,
    rollback: () => void,
    what: string
  ) => {
    optimistic();
    try {
      await action();
    } catch (error) {
      rollback();
      if (error instanceof DiscoverSignInRequiredError) {
        promptSignIn(what);
        return;
      }
      toast({
        title: 'That did not go through',
        description:
          error instanceof DiscoverRequestError ? error.message : 'Check your connection and try again.',
        variant: 'destructive',
      });
    }
  };

  const toggleLike = (post: DiscoverPost, liked: boolean) => {
    void write(
      () => discoverApi.setLike(post.id, liked),
      () => setPostLiked(post.id, liked),
      () => forgetPostIntent(post.id),
      'like posts'
    );
  };

  const toggleSave = (post: DiscoverPost, saved: boolean) => {
    void write(
      () => discoverApi.setSaved(post.id, saved),
      () => setPostSaved(post.id, saved),
      () => forgetPostIntent(post.id),
      'save posts'
    );
    toast({
      title: saved ? 'Saved' : 'Removed from saved',
      description: saved ? 'Find it again under Saved' : undefined,
    });
  };

  const toggleFollow = (authorId: string, following: boolean) => {
    void write(
      () => discoverApi.setFollow(authorId, following),
      () => setAuthorFollowed(authorId, following),
      () => forgetAuthorIntent(authorId),
      'follow people'
    );
  };

  const useAsTemplate = (post: DiscoverPost) => {
    // Never awaited and never gated: opening a design has to work for a guest,
    // and recordRemix swallows its own failures for exactly that reason.
    void discoverApi.recordRemix(post.id);
    onUseTemplate(post);
  };

  /** The share form is the one view a guest cannot enter at all. */
  const openShare = () => {
    if (!canInteract) {
      promptSignIn('share your designs');
      return;
    }
    setView('share');
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
      <DialogContent
        className={cn(
          'flex max-h-[92vh] w-[95vw] max-w-[1400px] flex-col gap-3',
          // The post view takes the height it is allowed rather than the height
          // its text happens to need. Everything it gains goes to the comment
          // thread, which is the only child that scrolls: without a definite
          // height here, flex-1 has no spare space to hand it and the thread
          // ends up a two-line sliver next to a half-empty image column.
          //
          // lg only, because that is where the two columns are. Below it the
          // view is one column that scrolls as a whole, so a fixed height would
          // buy a short post nothing but empty space under it.
          view === 'post' && 'lg:h-[92vh]'
        )}
      >
        {view === 'feed' && (
          <>
            <DialogHeader className="shrink-0 space-y-0 text-left">
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
                <Button className="h-9 gap-1.5" onClick={openShare}>
                  <UploadIcon className="h-4 w-4" />
                  Share your design
                </Button>
              </div>
            </DialogHeader>

            {/* Every row above the grid is shrink-0. They are flex children of
                a height-capped dialog, and the grid below is the only thing
                that should give: without this they are squeezed proportionally
                and their contents get sliced off mid-pill. */}
            <div className="flex shrink-0 flex-wrap items-center gap-2">
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

            {!isSignedIn && isDiscoverConfigured() && capabilities?.enabled !== false && (
              // One line, not a modal and not a nag: everything below it works,
              // and the buttons that do not are already labelled with why.
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  You are browsing as a guest. Sign in to post, comment, like and save
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => promptSignIn('post, comment and save')}
                >
                  Sign in
                </Button>
              </div>
            )}

            {capabilities?.enabled === false && (
              <div className="shrink-0 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                The community feed is switched off right now. Everything else in the editor works as
                usual
              </div>
            )}

            {capabilities?.note && (
              <div className="shrink-0 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {capabilities.note}
              </div>
            )}

            {tags.length > 0 && (
              // `overflow-x: auto` computes overflow-y to auto as well, so
              // without shrink-0 this row is not merely short, it clips its own
              // pills in half lengthwise. The fade on the right edge is the only
              // hint that a horizontal scroller has more in it, since the bar
              // itself is hidden.
              <div className="relative -mx-1 shrink-0">
                <div className="flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                {/* Over background when there is nothing left to scroll to, so
                    it needs no measuring to stay out of the way. */}
                <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />
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
              onShare={openShare}
              canInteract={canInteract}
            />
          </>
        )}

        {view === 'post' && activePost && (
          <>
            <DialogHeader className="shrink-0 space-y-0 text-left">
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
              canInteract={canInteract}
              onSignIn={() => promptSignIn('join the conversation')}
            />
          </>
        )}

        {view === 'share' && (
          <>
            <DialogHeader className="shrink-0 space-y-0 text-left">
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
  canInteract: boolean;
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
  canInteract,
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
        <EmptyState scope={scope} onShare={onShare} canInteract={canInteract} />
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
                canInteract={canInteract}
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

function EmptyState({
  scope,
  onShare,
  canInteract,
}: {
  scope: DiscoverScope;
  onShare: () => void;
  canInteract: boolean;
}) {
  const signedOut: Partial<Record<DiscoverScope, { title: string; body: string }>> = {
    following: {
      title: 'Following is for signed-in accounts',
      body: 'Sign in and follow somebody to build this tab',
    },
    saved: {
      title: 'Saved posts travel with your account',
      body: 'Sign in and the bookmark button starts working',
    },
    mine: {
      title: 'Your posts live on your account',
      body: 'Sign in to share the project you have open',
    },
  };

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
  const { title, body } = (!canInteract && signedOut[scope]) || copy[scope];

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <SparklesIcon className="h-8 w-8 text-muted-foreground" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {scope === 'mine' && canInteract && (
        <Button className="gap-1.5" onClick={onShare}>
          <UploadIcon className="h-4 w-4" />
          Share your design
        </Button>
      )}
    </div>
  );
}
