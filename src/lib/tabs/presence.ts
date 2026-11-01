// Is another editor window of this app open right now?
//
// Asked once, at startup, before a window brings back "what was open last
// time": if another window is still open, that list is ITS working set, and a
// second window reopening the same projects would put two writers on each of
// them. The answer comes from the Web Locks API, because a lock is let go by the
// browser itself when a window closes, crashes or is killed, so there is no
// heartbeat to miss and no stale entry to clean up.
//
// Every editor window holds one lock named after itself for as long as it
// lives, and the question is whether anyone else holds one.

const WINDOW_LOCK_PREFIX = 'open-screenshot-generator.editor-window:';

interface LockManagerLike {
  request(name: string, options: { mode: 'exclusive' | 'shared' }, callback: () => Promise<void>): Promise<void>;
  query(): Promise<{ held?: Array<{ name?: string }> }>;
}

function lockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  return locks && typeof locks.request === 'function' && typeof locks.query === 'function' ? locks : null;
}

/** This window's id for the lock. One per document, never persisted. */
export const EDITOR_WINDOW_ID = `ew_${Math.random().toString(36).slice(2, 10)}`;

let held = false;

/**
 * Hold this window's lock until the window goes away. Safe to call more than
 * once; only the first call asks.
 */
export function holdEditorWindowLock(): void {
  const locks = lockManager();
  if (!locks || held) return;
  held = true;
  void locks
    .request(WINDOW_LOCK_PREFIX + EDITOR_WINDOW_ID, { mode: 'exclusive' }, () => new Promise<void>(() => {}))
    .catch(() => {
      held = false;
    });
}

/**
 * The ids of every editor window alive now, this one included. Null when this
 * browser cannot say. A window's id dies with it, a reload included, which is
 * what tells a tab's stored undo stack (historyStore.ts) whether it still counts.
 */
export async function liveEditorWindowIds(): Promise<Set<string> | null> {
  const locks = lockManager();
  if (!locks) return null;
  try {
    const state = await locks.query();
    const ids = new Set<string>();
    for (const lock of state.held ?? []) {
      if (typeof lock.name === 'string' && lock.name.startsWith(WINDOW_LOCK_PREFIX)) {
        ids.add(lock.name.slice(WINDOW_LOCK_PREFIX.length));
      }
    }
    return ids;
  } catch {
    return null;
  }
}

/**
 * True when another editor window holds its lock, false when none does, and
 * null when this browser cannot say (no Web Locks, or an insecure origin).
 */
export async function otherEditorWindowsOpen(): Promise<boolean | null> {
  const locks = lockManager();
  if (!locks) return null;
  try {
    const state = await locks.query();
    const own = WINDOW_LOCK_PREFIX + EDITOR_WINDOW_ID;
    return (state.held ?? []).some(
      (lock) => typeof lock.name === 'string' && lock.name.startsWith(WINDOW_LOCK_PREFIX) && lock.name !== own
    );
  } catch {
    return null;
  }
}
