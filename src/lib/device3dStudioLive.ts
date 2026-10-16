// Live state for 3D Studio devices, outside React.
//
// What travels here is the angle (and lens, light, finish, glare or a
// foldable's opening) a gesture is showing before it commits: the rotate
// handle on the canvas and the Properties panel sliders publish on every
// move, every renderer drawing that element follows, and the commit on
// release arrives through the props like any other edit. Committing per move
// would be one undo entry and one whole-project write per frame (see the
// slider note in PropertiesPanel).

import type { Device3DLight, Device3DOrientation } from '@/types/artboard';

/** What a gesture shows before it lands. Anything unset follows the element. */
export interface StudioLiveState {
  orientation?: Device3DOrientation;
  lens?: number;
  light?: Device3DLight;
  finish?: { frame: string; back: string };
  glare?: number;
  /** A foldable's opening, degrees between its halves. */
  fold?: number;
}

export type StudioLiveEnd = 'commit' | 'cancel';
export type StudioLiveHandler = (elementId: string, state: StudioLiveState | null, reason?: StudioLiveEnd) => void;
type LiveListener = (state: StudioLiveState | null, reason?: StudioLiveEnd) => void;

const live = new Map<string, StudioLiveState>();
const liveListeners = new Map<string, Set<LiveListener>>();

/** The gesture's latest values. Called on every move. */
export function publishStudioLive(elementId: string, state: StudioLiveState): void {
  live.set(elementId, state);
  for (const listener of liveListeners.get(elementId) ?? []) listener(state);
}

/**
 * End the preview. A commit waits for its props to arrive; cancellation
 * restores the committed values immediately.
 */
export function endStudioLive(elementId: string, reason: StudioLiveEnd = 'commit'): void {
  if (!live.has(elementId)) return;
  live.delete(elementId);
  for (const listener of liveListeners.get(elementId) ?? []) listener(null, reason);
}

/** Preview or finish an edit, locally or replayed from a detached panel. */
export const updateStudioLive: StudioLiveHandler = (elementId, state, reason) => {
  if (state) publishStudioLive(elementId, state);
  else endStudioLive(elementId, reason);
};

export function studioLiveState(elementId: string): StudioLiveState | undefined {
  return live.get(elementId);
}

/** Follow one element's live values. Returns the unsubscribe. */
export function subscribeStudioLive(elementId: string, listener: LiveListener): () => void {
  let set = liveListeners.get(elementId);
  if (!set) {
    set = new Set();
    liveListeners.set(elementId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) liveListeners.delete(elementId);
  };
}
