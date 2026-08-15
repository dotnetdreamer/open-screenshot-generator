"use client";

// The Community tab of the "Start a New Project" dialog.
//
// The first thing a new user sees, ahead of the template categories: six
// trending posts, each of which opens as a project. A grid of empty templates
// does not answer "what should my listing look like", and a finished listing
// somebody shipped does.
//
// It is a window onto the same feed, not a second implementation: same
// discoverApi, same PostCard, same seeding. Anything beyond a glance (search,
// filters, comments, the rest of the feed) opens the Discover dialog.

import React, { useMemo } from 'react';
import { ArrowRightIcon, CompassIcon, Loader2Icon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { discoverApi } from '@/lib/discover/api';
import { forgetPostIntent, setPostLiked, setPostSaved } from '@/lib/discover/localState';
import { useDiscoverSession } from '@/lib/discover/session';
import { useDiscoverFeed } from '@/lib/discover/useFeed';
import type { Project } from '@/types/artboard';
import type { DiscoverPost } from '@/types/discover';
import { PostCard } from './PostCard';

/** Enough to fill two rows on a wide dialog without becoming the whole feed. */
const PREVIEW_COUNT = 6;

interface CommunityStartPanelProps {
  templates: Project[];
  isLoadingTemplates: boolean;
  onUseTemplate: (post: DiscoverPost) => void;
  onOpenPost: (post: DiscoverPost) => void;
  onOpenFeed: () => void;
  onShare: () => void;
  /** False with nothing on the canvas: there would be no screens to post. */
  canShare: boolean;
  /** Open the account dialog, which is where a community session comes from. */
  onRequestSignIn?: (hint?: string) => void;
}

export function CommunityStartPanel({
  templates,
  isLoadingTemplates,
  onUseTemplate,
  onOpenPost,
  onOpenFeed,
  onShare,
  canShare,
  onRequestSignIn,
}: CommunityStartPanelProps) {
  // A no-op now that the feed is served rather than built from the catalog. The
  // call stays because the signature does: see DiscoverApi.seed.
  const seedSignature = `${templates.length}`;
  useMemo(() => discoverApi.seed(templates), [seedSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center gap-2 px-1 pb-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <CompassIcon className="h-4 w-4 text-primary" />
            Trending in the community
          </h3>
          <p className="text-xs text-muted-foreground">
            Store graphics other people shipped. Open one as a starting point for your own
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={onShare}
          disabled={!canShare}
          title={
            canShare
              ? 'Post the project you have open'
              : 'Open a project first, then you can share it'
          }
        >
          <UploadIcon className="h-4 w-4" />
          Share your design
        </Button>
        <Button size="sm" className="h-9 gap-1.5" onClick={onOpenFeed}>
          Browse all
          <ArrowRightIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Not keyed on the catalog any more: the feed is served, so it has
          nothing to wait for and remounting on a template load would only throw
          away a page it had already fetched. */}
      <CommunityGrid
        isSeeding={isLoadingTemplates && templates.length === 0}
        onUseTemplate={onUseTemplate}
        onOpenPost={onOpenPost}
        onOpenFeed={onOpenFeed}
        onRequestSignIn={onRequestSignIn}
      />
    </div>
  );
}

function CommunityGrid({
  isSeeding,
  onUseTemplate,
  onOpenPost,
  onOpenFeed,
  onRequestSignIn,
}: {
  isSeeding: boolean;
  onUseTemplate: (post: DiscoverPost) => void;
  onOpenPost: (post: DiscoverPost) => void;
  onOpenFeed: () => void;
  onRequestSignIn?: (hint?: string) => void;
}) {
  const { isSignedIn, capabilities } = useDiscoverSession();
  const canInteract = isSignedIn && capabilities?.writes !== false;

  /** Same bargain as the feed: a guest's press opens the sign-in dialog. */
  const requireSession = (what: string): boolean => {
    if (canInteract) return true;
    onRequestSignIn?.(`Connect Google Drive or GitHub to ${what} in Discover.`);
    return false;
  };

  const { posts, isLoading, error, total } = useDiscoverFeed({
    sort: 'trending',
    scope: 'all',
    limit: PREVIEW_COUNT,
  });

  if (isSeeding || isLoading) {
    return (
      <div className="grid gap-5 p-1 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: PREVIEW_COUNT }).map((_, index) => (
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
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={onOpenFeed}>
          Open Discover
        </Button>
      </div>
    );
  }

  if (posts.length === 0) {
    // A real feed can be genuinely empty, where the seeded one never was. A
    // spinner here would sit forever and read as broken.
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing in the community feed yet. Be the first to share a design
        </p>
        <Button variant="outline" onClick={onOpenFeed}>
          Open Discover
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-5 p-1 md:grid-cols-2 2xl:grid-cols-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onOpen={onOpenPost}
            onToggleLike={(target, liked) => {
              if (!requireSession('like posts')) return;
              setPostLiked(target.id, liked);
              void discoverApi.setLike(target.id, liked).catch(() => forgetPostIntent(target.id));
            }}
            onToggleSave={(target, saved) => {
              if (!requireSession('save posts')) return;
              setPostSaved(target.id, saved);
              void discoverApi.setSaved(target.id, saved).catch(() => forgetPostIntent(target.id));
            }}
            onUseAsTemplate={post.templateProjectId ? onUseTemplate : undefined}
            onSelectTag={onOpenFeed}
            canInteract={canInteract}
          />
        ))}
      </div>

      <div className="flex justify-center py-4">
        <Button variant="outline" className="gap-1.5" onClick={onOpenFeed}>
          See all {total} posts in Discover
          <ArrowRightIcon className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}
