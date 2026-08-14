// What this browser has done in the feed: likes, saves, follows, and the
// comments the viewer wrote. Plus the viewer's display identity.
//
// A real backend owns all of this per account. Until then it lives in
// localStorage, exactly like the account session (src/lib/account/store.ts) and
// the AI provider keys: one JSON blob, a subscribe/notify store so the card,
// the post detail and the filter chips all read the same value without props
// threading, and a hook that starts empty on the first render so static-export
// hydration can never mismatch.
//
// Only ids and short strings are kept here. Images the viewer publishes are
// blobs and live in IndexedDB instead (see localPosts.ts), because a few
// hundred kilobytes of base64 would blow the 5MB localStorage budget.

import { useEffect, useState } from 'react';
import type { DiscoverComment } from '@/types/discover';

const STORAGE_KEY = 'open-screenshot-generator.discover';

export interface ViewerIdentity {
  handle: string;
  name: string;
}

export interface DiscoverLocalState {
  likedPostIds: string[];
  savedPostIds: string[];
  followedAuthorIds: string[];
  likedCommentIds: string[];
  /** Comments the viewer wrote, keyed by post id. */
  comments: Record<string, DiscoverComment[]>;
  /** Overrides the name/handle taken from the connected storage account. */
  viewer: ViewerIdentity | null;
}

const EMPTY_STATE: DiscoverLocalState = {
  likedPostIds: [],
  savedPostIds: [],
  followedAuthorIds: [],
  likedCommentIds: [],
  comments: {},
  viewer: null,
};

let current: DiscoverLocalState = EMPTY_STATE;
let hydrated = false;
const listeners = new Set<() => void>();

function read(): DiscoverLocalState {
  if (typeof window === 'undefined') return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<DiscoverLocalState>;
    return {
      ...EMPTY_STATE,
      ...parsed,
      // A hand-edited or half-written blob must not crash the feed, so every
      // collection is coerced back to its expected shape.
      likedPostIds: Array.isArray(parsed.likedPostIds) ? parsed.likedPostIds : [],
      savedPostIds: Array.isArray(parsed.savedPostIds) ? parsed.savedPostIds : [],
      followedAuthorIds: Array.isArray(parsed.followedAuthorIds) ? parsed.followedAuthorIds : [],
      likedCommentIds: Array.isArray(parsed.likedCommentIds) ? parsed.likedCommentIds : [],
      comments: parsed.comments && typeof parsed.comments === 'object' ? parsed.comments : {},
      viewer: parsed.viewer?.handle ? parsed.viewer : null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

function write(state: DiscoverLocalState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full quota: the activity holds for this session only.
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  current = read();
}

export function getLocalState(): DiscoverLocalState {
  hydrate();
  return current;
}

function update(mutate: (state: DiscoverLocalState) => DiscoverLocalState): void {
  hydrate();
  current = mutate(current);
  write(current);
  listeners.forEach((fn) => fn());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function toggleId(list: string[], id: string, on: boolean): string[] {
  const has = list.includes(id);
  if (on === has) return list;
  return on ? [...list, id] : list.filter((entry) => entry !== id);
}

export function setPostLiked(postId: string, liked: boolean): void {
  update((state) => ({ ...state, likedPostIds: toggleId(state.likedPostIds, postId, liked) }));
}

export function setPostSaved(postId: string, saved: boolean): void {
  update((state) => ({ ...state, savedPostIds: toggleId(state.savedPostIds, postId, saved) }));
}

export function setAuthorFollowed(authorId: string, following: boolean): void {
  update((state) => ({
    ...state,
    followedAuthorIds: toggleId(state.followedAuthorIds, authorId, following),
  }));
}

export function setCommentLiked(commentId: string, liked: boolean): void {
  update((state) => ({
    ...state,
    likedCommentIds: toggleId(state.likedCommentIds, commentId, liked),
  }));
}

export function addLocalComment(comment: DiscoverComment): void {
  update((state) => ({
    ...state,
    comments: {
      ...state.comments,
      [comment.postId]: [...(state.comments[comment.postId] ?? []), comment],
    },
  }));
}

export function removeLocalComment(postId: string, commentId: string): void {
  update((state) => ({
    ...state,
    comments: {
      ...state.comments,
      [postId]: (state.comments[postId] ?? []).filter((c) => c.id !== commentId),
    },
  }));
}

export function setViewerIdentity(viewer: ViewerIdentity | null): void {
  update((state) => ({ ...state, viewer }));
}

/** Drops every like, save, follow and comment made in this browser. */
export function resetLocalState(): void {
  update(() => EMPTY_STATE);
}

/**
 * The viewer's feed activity, re-rendering on change.
 * Starts empty on the server and on the first client render, so a static-export
 * hydration pass never sees a value that the server could not produce.
 */
export function useDiscoverLocalState(): DiscoverLocalState {
  const [state, setState] = useState<DiscoverLocalState>(EMPTY_STATE);

  useEffect(() => {
    setState(getLocalState());
    return subscribe(() => setState(getLocalState()));
  }, []);

  return state;
}
