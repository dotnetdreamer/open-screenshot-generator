// Feed fetching for the Discover dialog: one query in, a paged list out.
//
// Kept out of the components so the dialog stays about layout, and so the
// swap to a real backend needs no component edits at all: this hook only ever
// touches discoverApi.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoverFeedQuery, DiscoverPost } from '@/types/discover';
import { discoverApi } from './api';

export interface FeedResult {
  posts: DiscoverPost[];
  /** First page in flight: the grid shows skeletons. */
  isLoading: boolean;
  /** A later page in flight: only the Load more button shows a spinner. */
  isLoadingMore: boolean;
  error: string | null;
  total: number;
  hasMore: boolean;
  loadMore: () => void;
  /** Re-run the current query from page one (after publishing, say). */
  refresh: () => void;
}

/**
 * `query` is read as a value, not an identity: callers build it inline, so a
 * dependency on the object would refetch on every render. The serialized query
 * is what drives the effect.
 */
export function useDiscoverFeed(query: DiscoverFeedQuery): FeedResult {
  const [posts, setPosts] = useState<DiscoverPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const queryKey = JSON.stringify(query);
  // Every response carries the request number it belongs to. A slower earlier
  // request landing after a faster later one would otherwise repaint the grid
  // with results for a filter the user has already moved off.
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    setIsLoading(true);
    setError(null);

    discoverApi
      .listFeed({ ...(JSON.parse(queryKey) as DiscoverFeedQuery), cursor: null })
      .then((page) => {
        if (request !== requestRef.current) return;
        setPosts(page.posts);
        setCursor(page.nextCursor);
        setTotal(page.total);
      })
      .catch((cause) => {
        if (request !== requestRef.current) return;
        setError(cause instanceof Error ? cause.message : 'The feed could not be loaded.');
        setPosts([]);
        setCursor(null);
        setTotal(0);
      })
      .finally(() => {
        if (request !== requestRef.current) return;
        setIsLoading(false);
      });
  }, [queryKey, reloadToken]);

  const loadMore = useCallback(() => {
    if (!cursor || isLoadingMore) return;
    const request = requestRef.current;
    setIsLoadingMore(true);
    discoverApi
      .listFeed({ ...(JSON.parse(queryKey) as DiscoverFeedQuery), cursor })
      .then((page) => {
        // The filter changed while this page was in flight: drop it.
        if (request !== requestRef.current) return;
        setPosts((previous) => {
          const seen = new Set(previous.map((post) => post.id));
          return [...previous, ...page.posts.filter((post) => !seen.has(post.id))];
        });
        setCursor(page.nextCursor);
        setTotal(page.total);
      })
      .catch(() => {
        if (request !== requestRef.current) return;
        setError('More posts could not be loaded.');
      })
      .finally(() => {
        if (request !== requestRef.current) return;
        setIsLoadingMore(false);
      });
  }, [cursor, isLoadingMore, queryKey]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    posts,
    isLoading,
    isLoadingMore,
    error,
    total,
    hasMore: cursor !== null,
    loadMore,
    refresh,
  };
}
