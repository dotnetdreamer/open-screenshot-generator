// The optimistic overlay: what this browser has just done, before the server
// has said so.
//
// The backend owns likes, saves, follows and comments now — a post arrives from
// the feed already carrying `likedByViewer` and `savedByViewer` for whoever is
// signed in. So this file is no longer a store of the viewer's activity. It is
// the thin layer on top that makes a tap feel instant: the request goes out, the
// heart fills in immediately, and if the request fails the overlay is rolled
// back and the server's answer stands.
//
// Two deliberate differences from the version that backed the mock feed:
//
//   1. **Nothing is persisted.** The truth is on the server and travels with the
//      account, so writing it to localStorage as well would only create a second
//      copy to disagree with — most visibly on a second device, where the
//      hearts would be filled in from a browser rather than from an account.
//   2. **Entries are intentions, not facts.** `liked[postId] === false` means
//      "this viewer just un-liked it", which is different from absent. That is
//      what lets `viewerStats` adjust the server's count by exactly the delta.
//
// A signed-out visitor never gets an entry in here, because every write path
// refuses before it starts.

import { useEffect, useState } from 'react';

export interface DiscoverOverlay {
  /** postId -> the state the viewer has just asked for. */
  liked: Record<string, boolean>;
  savedPosts: Record<string, boolean>;
  /** authorId -> following. */
  followed: Record<string, boolean>;
  /** commentId -> liked. */
  likedComments: Record<string, boolean>;
}

/** The old name, kept so format.ts and the two cards need no import churn. */
export type DiscoverLocalState = DiscoverOverlay;

const EMPTY_STATE: DiscoverOverlay = {
  liked: {},
  savedPosts: {},
  followed: {},
  likedComments: {},
};

let current: DiscoverOverlay = EMPTY_STATE;
const listeners = new Set<() => void>();

export function getLocalState(): DiscoverOverlay {
  return current;
}

function update(mutate: (state: DiscoverOverlay) => DiscoverOverlay): void {
  current = mutate(current);
  listeners.forEach((fn) => fn());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPostLiked(postId: string, liked: boolean): void {
  update((state) => ({ ...state, liked: { ...state.liked, [postId]: liked } }));
}

export function setPostSaved(postId: string, saved: boolean): void {
  update((state) => ({ ...state, savedPosts: { ...state.savedPosts, [postId]: saved } }));
}

export function setAuthorFollowed(authorId: string, following: boolean): void {
  update((state) => ({ ...state, followed: { ...state.followed, [authorId]: following } }));
}

export function setCommentLiked(commentId: string, liked: boolean): void {
  update((state) => ({
    ...state,
    likedComments: { ...state.likedComments, [commentId]: liked },
  }));
}

/**
 * Forget one intention, because the server has now spoken about it.
 *
 * Called on a failed write, so the button snaps back to whatever the post
 * actually says. Deleting the key rather than writing the opposite matters: the
 * opposite would be a new intention, and the next render would try to apply it
 * as a delta on top of the server's own count.
 */
export function forgetPostIntent(postId: string): void {
  update((state) => {
    const liked = { ...state.liked };
    const savedPosts = { ...state.savedPosts };
    delete liked[postId];
    delete savedPosts[postId];
    return { ...state, liked, savedPosts };
  });
}

export function forgetAuthorIntent(authorId: string): void {
  update((state) => {
    const followed = { ...state.followed };
    delete followed[authorId];
    return { ...state, followed };
  });
}

export function forgetCommentIntent(commentId: string): void {
  update((state) => {
    const likedComments = { ...state.likedComments };
    delete likedComments[commentId];
    return { ...state, likedComments };
  });
}

/**
 * Drop every pending intention.
 *
 * Called when the community session changes. A heart left filled in from the
 * account somebody just signed out of is worse than a moment of the truth.
 */
export function resetLocalState(): void {
  update(() => EMPTY_STATE);
}

// ---------------------------------------------------------------------------
// Reading it
// ---------------------------------------------------------------------------

/** Whether the viewer likes this post, overlay first, server second. */
export function isLiked(state: DiscoverOverlay, postId: string, serverValue?: boolean): boolean {
  const intent = state.liked[postId];
  return intent === undefined ? !!serverValue : intent;
}

export function isSaved(state: DiscoverOverlay, postId: string, serverValue?: boolean): boolean {
  const intent = state.savedPosts[postId];
  return intent === undefined ? !!serverValue : intent;
}

export function isFollowed(state: DiscoverOverlay, authorId: string, serverValue?: boolean): boolean {
  const intent = state.followed[authorId];
  return intent === undefined ? !!serverValue : intent;
}

export function isCommentLiked(state: DiscoverOverlay, commentId: string): boolean {
  return !!state.likedComments[commentId];
}

/**
 * The overlay, re-rendering on change.
 *
 * Starts empty on the server and on the first client render, so a static export
 * hydration pass never sees a value the server could not produce.
 */
export function useDiscoverLocalState(): DiscoverOverlay {
  const [state, setState] = useState<DiscoverOverlay>(EMPTY_STATE);

  useEffect(() => {
    setState(getLocalState());
    return subscribe(() => setState(getLocalState()));
  }, []);

  return state;
}
