// One writer per project, across every window of the app.
//
// Each editor window writes the projects in its own tabs, and two windows
// writing one project would each save over the other's edits. So a window
// holds a Web Lock named after every project it has a tab for, and takes the
// lock BEFORE it opens or writes a project: a window that cannot have the lock
// does not open the project at all.
//
// A lock rather than a message to the other windows, for two reasons: taking
// one is instant, where a message would mean waiting to hear nobody answer; and
// the browser lets go of a window's locks when it closes, crashes or is
// killed, so a window that died cannot keep a project from opening.
//
// Where the API is missing (an insecure origin, an old engine) every request is
// granted, which is how the editor behaved before there were tabs.

const PREFIX = 'open-screenshot-generator.project:';

interface LockManagerLike {
  request(
    name: string,
    options: { mode: 'exclusive'; ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<void>
  ): Promise<void>;
  query(): Promise<{ held?: Array<{ name?: string }> }>;
}

function locks(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const manager = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  return manager && typeof manager.request === 'function' && typeof manager.query === 'function' ? manager : null;
}

/** What this window holds, so its own locks never count as somebody else's. */
const held = new Map<string, () => void>();
/** Asked for and not answered yet. A second ask for the same project gets the same answer. */
const pending = new Map<string, Promise<boolean>>();
/**
 * Projects this window is handing to another one, counted. The lock stays held
 * until the project and its undo stack are written, but it is no longer this
 * window's to give out: an open or a transfer that asks for it meanwhile is
 * turned down, as it would be in any other window. Let through, it would find
 * the lock held here and go ahead, and then both windows would save the project.
 */
const handingOver = new Map<string, number>();

export interface HoldOptions {
  /**
   * Wait this long for another window to let go, for a project that window is
   * in the middle of handing over. Zero, the default, asks without waiting.
   */
  waitMs?: number;
}

/**
 * Hold the lock for a project. Resolves true once it is held, and false when
 * another window holds it (and did not let go within `waitMs`), or this one is
 * handing it to another window. Safe to call for a project already held.
 */
export function holdProjectLock(projectId: string, options: HoldOptions = {}): Promise<boolean> {
  if (handingOver.has(projectId)) return Promise.resolve(false);
  const manager = locks();
  if (!manager || held.has(projectId)) return Promise.resolve(true);
  const asked = pending.get(projectId);
  if (asked) return asked;
  const waitMs = options.waitMs ?? 0;
  const answer = new Promise<boolean>((resolve) => {
    const abort = waitMs > 0 && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = abort ? setTimeout(() => abort.abort(), waitMs) : null;
    void manager
      .request(
        PREFIX + projectId,
        abort ? { mode: 'exclusive', signal: abort.signal } : { mode: 'exclusive', ifAvailable: true },
        (lock) => {
          if (timer) clearTimeout(timer);
          pending.delete(projectId);
          if (!lock) {
            resolve(false);
            return Promise.resolve();
          }
          resolve(true);
          // Held until released: the callback's promise is the lock.
          return new Promise<void>((release) => held.set(projectId, release));
        }
      )
      .catch((error: unknown) => {
        if (timer) clearTimeout(timer);
        pending.delete(projectId);
        // Given up on: the other window kept it. Anything else means this
        // browser could not answer, which is treated as no lock at all.
        resolve(!(error instanceof DOMException && error.name === 'AbortError'));
      });
  });
  pending.set(projectId, answer);
  return answer;
}

/** Let another window have the project. Safe when it is not held. */
export function releaseProjectLock(projectId: string): void {
  const release = held.get(projectId);
  if (!release) return;
  held.delete(projectId);
  release();
}

/**
 * Start handing a project to another window: from now on, an ask for it here
 * is turned down (see handingOver). The returned function ends the hand-over
 * and lets go of the lock, once the project's last writes are done.
 */
export function startHandOver(projectId: string): () => void {
  handingOver.set(projectId, (handingOver.get(projectId) ?? 0) + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const left = (handingOver.get(projectId) ?? 1) - 1;
    if (left > 0) handingOver.set(projectId, left);
    else handingOver.delete(projectId);
    releaseProjectLock(projectId);
  };
}

/** True when this window holds the project now. */
export function isProjectLockHeld(projectId: string): boolean {
  return held.has(projectId);
}

/**
 * True when this window may write the project: it holds the lock, or this
 * browser has no locks and so no other window to defer to.
 */
export function mayWriteProject(projectId: string): boolean {
  return !locks() || held.has(projectId);
}

/** Every project this window holds. */
export function heldProjectIds(): string[] {
  return [...held.keys()];
}

/**
 * Whether another window has the project in one of its tabs, or is about to:
 * this one is handing it over. Null when this browser cannot tell.
 */
export async function projectOpenElsewhere(projectId: string): Promise<boolean | null> {
  if (handingOver.has(projectId)) return true;
  if (held.has(projectId)) return false;
  const manager = locks();
  if (!manager) return null;
  try {
    const state = await manager.query();
    return (state.held ?? []).some((lock) => lock.name === PREFIX + projectId);
  } catch {
    return null;
  }
}

/** Thrown by an open that another window's lock turned down. */
export class ProjectOpenElsewhereError extends Error {
  constructor(
    readonly projectId: string,
    readonly projectName: string
  ) {
    super(
      `"${projectName || 'That project'}" is open in another window. Close it there or move it to this window, then try again.`
    );
    this.name = 'ProjectOpenElsewhereError';
  }
}

/**
 * Thrown by an open that was stopped before it wrote the project, because a tab
 * of the project left for another window meanwhile. The editor says so itself,
 * so this message only shows if a caller forgot to.
 */
export class OpenStoppedError extends Error {
  constructor(readonly projectId: string) {
    super('That project moved to another window before it opened here.');
    this.name = 'OpenStoppedError';
  }
}
