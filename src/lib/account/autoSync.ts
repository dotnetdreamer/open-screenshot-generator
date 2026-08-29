// Keeping a project up to date in storage the user owns, without anybody
// clicking Save.
//
// ## What this is, and what it is not
//
// The sibling of src/lib/cloud/autoSave.ts, and the differences between the two
// are the whole design. That one keeps a copy in OUR cloud; this one writes to
// a real person's Google Drive or their GitHub account. Everything below falls
// out of that one fact:
//
//   - the switch DEFAULTS OFF. Filling our own storage is our problem to solve
//     for people; filling theirs is something they ask for
//   - it only ever UPDATES a copy somebody already made. There is no first
//     push, no "create it for them after ten seconds". Clicking through a
//     gallery of templates must never leave a trail of folders in a Drive
//   - it is slower, and the numbers are argued rather than tuned. A push here
//     costs the user's bandwidth, their storage quota, and, on GitHub, a
//     permanent commit in a history that cannot be pruned
//   - it never resolves a disagreement. Neither provider offers a conditional
//     write (Drive v3 removed etags and takes no If-Match; a gist PATCH takes
//     no precondition), so all this can do is notice that the remote mark moved
//     and stop. Overwriting anyway is a person's decision
//   - it never signs anybody out. A token that expired while a timer was
//     running is a chip that says reconnect, not a session cleared underneath
//     somebody who is still typing
//
// ## Why some states are terminal
//
// A backoff says "the wait is the problem". For a gist being asked to hold a
// screen recording, or a project whose blobs this browser has evicted, waiting
// changes nothing, so those stop for good and say why. Only the person clicking
// the chip starts them again.
//
// ## The web token, honestly
//
// On the web build with Google, the access token lasts about an hour and
// renewal goes through Google Identity Services, which may want a popup that a
// background timer has no user gesture to open. The renewal is ATTEMPTED rather
// than pre-emptively refused, because it often works while the user's Google
// session is alive; when it does not, this parks at `needs-attention` and one
// click on the chip (which is a gesture) puts it right. Desktop holds a refresh
// token and does not have the problem.

import { isDetachedPanelWindow } from '@/lib/panels/url';
import { syncProjectToAccount } from './index';
import { getAccountLink } from './links';
import {
  AccountAuthError,
  AccountBlockedError,
  AccountCancelledError,
  AccountConflictError,
  type CloudProviderId,
  type CloudProjectSummary,
} from './types';

/**
 * How eager a push is, per destination.
 *
 * `quiet` is how long the edits have to stop before one; `maxDefer` is the
 * ceiling measured from the first unsaved change, so continuous editing still
 * lands; `minGap` is the floor between two pushes whatever else happens.
 *
 * These started far slower on the reasoning that writing to somebody else's
 * storage should be timid. That was the wrong instinct twice over, and it is
 * worth recording why, because the two providers turn out not to be alike.
 *
 * The first mistake: `minGap` counts from the LAST push and a manual save
 * counts as one, so a five minute floor meant somebody who saved by hand,
 * ticked the switch and started editing saw no request at all for five minutes.
 * A feature indistinguishable from a broken one is broken.
 *
 * The second: timidity needs a reason, and for DRIVE there is none. A push is
 * three requests carrying a 50 to 300KB manifest, with blobs skipped once
 * uploaded; against a quota of 325,000 units a minute per user that rounds to
 * nothing, and Drive prunes its own revision history. It is the user's storage
 * and they asked for this, so the only real cost is their bandwidth, which a
 * few hundred KB a minute of continuous editing does not threaten. Drive is
 * therefore only modestly slower than the cloud saver next door (5s/30s/8s),
 * and the margin is for its three requests and its uncompressed body, not for
 * anything about whose disk it is.
 *
 * GITHUB has one constraint, and it is real and worth naming: every gist write
 * is a content creating request against a documented secondary limit of 500 an
 * hour, and that budget is PER USER and shared with everything else they do on
 * github.com. Spending it on background saves could block their own pushes and
 * comments. A 60 second floor is at most 60 an hour, about 12 per cent of it.
 * Every write is also a permanent commit nobody can prune, so the gist's own
 * history stays readable at that rate.
 */
const CADENCE: Record<CloudProviderId, { quiet: number; maxDefer: number; minGap: number }> = {
  google: { quiet: 8_000, maxDefer: 90_000, minGap: 20_000 },
  github: { quiet: 15_000, maxDefer: 180_000, minGap: 60_000 },
};

/**
 * What a failure waits, growing.
 *
 * Slower than the hosted saver's ladder because the response is unreadable
 * here: `transport.ts` returns parsed JSON and discards the Response, so
 * `Retry-After` and `X-RateLimit-Reset` cannot be honoured. A floor generous
 * enough to be right without them beats a tight one that guesses.
 */
const BACKOFF_MS = [60_000, 300_000, 900_000, 1_800_000];
/** Offline is not a failure worth backing off over, it is a wait. */
const OFFLINE_RETRY_MS = 30_000;

export type AccountSyncState =
  /** The switch is off, or this window is not allowed to sync. */
  | 'disabled'
  /** Nobody is connected to any storage. */
  | 'signed-out'
  /**
   * Nothing has ever been saved to the account for this project, so there is
   * nothing to keep up to date. The resting state for most projects, and the
   * reason ticking the switch is safe.
   */
  | 'unlinked'
  /** Armed, with nothing that needs pushing. */
  | 'waiting'
  /** Edits are waiting for the threshold. */
  | 'pending'
  | 'syncing'
  | 'synced'
  /** A push failed on something that might work next time. */
  | 'retrying'
  /** Held while a live editing session is running. */
  | 'paused-collab'
  /** The remote copy moved. Stopped until somebody answers. */
  | 'conflict'
  /** This project cannot go to this storage. Stopped for good. */
  | 'blocked'
  /** The sign in stopped working. One click fixes it. */
  | 'needs-attention';

export interface AccountSyncStatus {
  state: AccountSyncState;
  /** Which storage this is about, for copy that names it. */
  provider: CloudProviderId | null;
  /** When the remote copy was last written, from this device. */
  savedAt: number | null;
  /** Why it is stopped, ready to put in front of somebody. */
  message: string | null;
  /** The remote copy a conflict is with, so the UI can offer the choice. */
  conflict: CloudProjectSummary | null;
}

/**
 * The snapshot before anything is configured.
 *
 * Frozen and shared because `useSyncExternalStore` compares by identity: a
 * fresh object per read would re-render the chip on every commit of the editor.
 */
export const IDLE_ACCOUNT_SYNC_STATUS: AccountSyncStatus = Object.freeze({
  state: 'disabled' as AccountSyncState,
  provider: null,
  savedAt: null,
  message: null,
  conflict: null,
});

export interface AccountSyncConfig {
  /** The local project id, or null when nothing is open. */
  projectId: string | null;
  /** Which storage is connected, and as whom. */
  provider: CloudProviderId | null;
  accountId: string | null;
  connected: boolean;
  /** The user's own switch, from Settings. Off unless they turned it on. */
  enabled: boolean;
  /**
   * A live editing session is running.
   *
   * Held rather than synced, because in a room the edit rate is set by however
   * many people are typing, and none of them is the person whose Drive quota
   * and bandwidth would pay for it. The last state before the room opened is
   * still up there, and the first push after it closes carries everything.
   */
  collabActive: boolean;
  /**
   * Bumped every time a project is opened, imported or created.
   *
   * The id alone cannot see that: opening the account's copy of the project
   * already open keeps the same id, and without this the syncer would carry a
   * conflict across the very open that answered it.
   */
  openToken: number;
}

const BLANK_CONFIG: AccountSyncConfig = {
  projectId: null,
  provider: null,
  accountId: null,
  connected: false,
  enabled: false,
  collabActive: false,
  openToken: 0,
};

/** Why a push is being attempted. Only `manual` overrides a stop. */
type PushReason = 'threshold' | 'manual' | 'hidden';

export interface AccountAutoSyncerOptions {
  /**
   * Commit the debounced local write first.
   *
   * The push reads the stored Dexie row and the editor's own save trails the
   * canvas by 600ms, so without this every sync would carry the document as it
   * was one keystroke ago.
   */
  flushLocal: () => Promise<unknown> | void;
}

export class AccountAutoSyncer {
  private readonly options: AccountAutoSyncerOptions;
  private config: AccountSyncConfig = BLANK_CONFIG;
  private status: AccountSyncStatus = IDLE_ACCOUNT_SYNC_STATUS;
  private readonly listeners = new Set<() => void>();
  /**
   * True in a detached panel window, where this must do nothing at all.
   *
   * AGENTS.md rule 29: the editor window is the only writer, and a panel is the
   * same bundle on the same origin sharing the same IndexedDB. Two of them
   * pushing the same project would each read the other's stamp and report a
   * conflict with it. Today the layout is not even mounted in a panel window
   * (src/app/page.tsx routes those to DetachedPanelsWindow), so this is a
   * second lock on a door that is already shut, and it is deliberately read
   * once at construction so the answer cannot change under a running timer.
   */
  private readonly muted =
    typeof window !== 'undefined' && isDetachedPanelWindow();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private attached = false;
  private inFlight = false;
  /** Stopped until a person acts. Only `syncNow` clears it. */
  private stopped = false;
  /**
   * The face the stop was wearing, kept so it can be put back.
   *
   * Turning the switch off and on again writes `disabled` over the status, and
   * without this the chip would come back saying "synced" for a project that is
   * still stopped on a conflict: the timer would correctly refuse to push and
   * the mark would correctly claim it had. A stop is answered by a person, not
   * by a toggle.
   */
  private stoppedFace: Pick<AccountSyncStatus, 'state' | 'message' | 'conflict'> | null = null;

  private dirty = false;
  /** The first unsaved change since the last push, for the maxDefer ceiling. */
  private dirtySince = 0;
  private lastChangeAt = 0;
  private lastPushAt = 0;
  /** False until the link table has answered, so nothing pushes blind. */
  private linkChecked = false;
  /** Somebody has saved this project to the account, so there is a copy to update. */
  private hasLink = false;
  private failures = 0;
  private retryAt = 0;
  /** Bumped on every arm, so a slow link read cannot land on the next project. */
  private linkToken = 0;

  constructor(options: AccountAutoSyncerOptions) {
    this.options = options;
  }

  // --- what the UI reads ----------------------------------------------------

  getStatus = (): AccountSyncStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // --- what the editor tells it ---------------------------------------------

  configure(next: AccountSyncConfig): void {
    const previous = this.config;
    this.config = next;
    if (
      previous.projectId !== next.projectId ||
      previous.provider !== next.provider ||
      previous.accountId !== next.accountId ||
      previous.openToken !== next.openToken
    ) {
      this.arm();
    } else {
      this.settle();
    }
    this.reschedule();
  }

  /**
   * A commit landed on the open project.
   *
   * Cheap on purpose: this runs once per commit, and a drag commits per pixel.
   * It moves two numbers and re-arms one timer.
   */
  noteChange(projectId: string | null): void {
    if (!projectId || projectId !== this.config.projectId) return;
    const now = Date.now();
    this.lastChangeAt = now;
    if (!this.dirty) {
      this.dirty = true;
      this.dirtySince = now;
    }
    // A running push notices this when it finishes, a backoff is already
    // counting, and a stop is waiting for a person. None of them is displaced
    // by an edit.
    if (!this.stopped && this.status.state !== 'syncing' && this.status.state !== 'retrying') {
      this.setStatus({ state: this.resolveIdleState('pending') });
    }
    this.reschedule();
  }

  /**
   * Somebody saved this project to the account by hand.
   *
   * That save wrote the same link row this reads and pushed the same document,
   * so the only thing left is to stop counting it as unsaved and start the gap
   * again. It is also the moment a project becomes syncable at all, and the way
   * back from every stopped state.
   */
  noteSaved(): void {
    this.lastPushAt = Date.now();
    this.dirty = false;
    this.failures = 0;
    this.retryAt = 0;
    this.stopped = false;
    this.stoppedFace = null;
    this.hasLink = true;
    this.linkChecked = true;
    this.setStatus({
      state: this.resolveIdleState('synced'),
      savedAt: this.lastPushAt,
      message: null,
      conflict: null,
    });
    this.reschedule();
  }

  /** The project's copy is gone, or the user asked to stop syncing this one. */
  noteUnlinked(): void {
    this.hasLink = false;
    this.linkChecked = true;
    this.stopped = false;
    this.stoppedFace = null;
    this.setStatus({ state: this.resolveIdleState(), message: null, conflict: null });
    this.reschedule();
  }

  /** The chip's retry: clears a stop or a backoff and pushes right now. */
  syncNow(): void {
    this.stopped = false;
    this.stoppedFace = null;
    this.failures = 0;
    this.retryAt = 0;
    void this.push('manual');
  }

  // --- lifecycle ------------------------------------------------------------

  /**
   * Two listeners, both saving work that would otherwise wait.
   *
   * `visibilitychange` is the one that matters: switching tab or app is the
   * most common way an editing session ends, and a push started there still has
   * time to finish. `pagehide` deliberately gets nothing, because a request
   * killed mid flight can still land while this device never records that it
   * did, and the next push would then report a conflict with itself.
   */
  attach(): void {
    if (this.attached || typeof document === 'undefined') return;
    if (this.muted) return;
    this.attached = true;
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('online', this.handleOnline);
  }

  detach(): void {
    if (this.attached && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility);
      window.removeEventListener('online', this.handleOnline);
    }
    this.attached = false;
    this.clearTimer();
  }

  private handleVisibility = (): void => {
    if (document.visibilityState !== 'hidden') return;
    if (!this.dirty) return;
    void this.push('hidden');
  };

  private handleOnline = (): void => {
    if (this.status.state !== 'retrying') return;
    // Back on a connection, so the rest of the backoff is about a network that
    // is no longer the problem. Shortly rather than immediately, since `online`
    // fires before a captive portal or a VPN has settled.
    this.retryAt = Date.now() + 2_000;
    this.reschedule();
  };

  // --- the schedule ---------------------------------------------------------

  /** The timings for whatever is connected, or Drive's as a resting default. */
  private cadence(): { quiet: number; maxDefer: number; minGap: number } {
    return CADENCE[this.config.provider ?? 'google'];
  }

  /** When the next push is due, or null when there is nothing to push. */
  private dueAt(): number | null {
    if (this.muted) return null;
    const { projectId, connected, enabled, collabActive } = this.config;
    if (!projectId || !connected || !enabled || collabActive) return null;
    if (this.stopped || this.inFlight) return null;
    // No copy to update is the resting case, and it is the adoption rule in
    // code: nothing is ever created out here on a timer.
    if (!this.linkChecked || !this.hasLink) return null;
    if (!this.dirty) return null;

    const { quiet, maxDefer, minGap } = this.cadence();
    // Quiet since the last edit, but never later than the ceiling measured from
    // the FIRST unsaved one, which is what keeps a long uninterrupted session
    // from deferring forever.
    const due = Math.min(this.lastChangeAt + quiet, this.dirtySince + maxDefer);
    return Math.max(due, this.lastPushAt + minGap, this.retryAt, Date.now());
  }

  private reschedule(): void {
    this.clearTimer();
    const due = this.dueAt();
    if (due === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.push('threshold');
    }, Math.max(0, due - Date.now()));
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  // --- arming ---------------------------------------------------------------

  /** Start again for whatever is open now. */
  private arm(): void {
    this.clearTimer();
    this.stopped = false;
    this.stoppedFace = null;
    this.dirty = false;
    this.dirtySince = 0;
    this.lastChangeAt = 0;
    this.lastPushAt = 0;
    this.hasLink = false;
    this.linkChecked = false;
    this.failures = 0;
    this.retryAt = 0;
    this.setStatus({
      ...IDLE_ACCOUNT_SYNC_STATUS,
      provider: this.config.provider,
      state: this.resolveIdleState(),
    });

    const { projectId, accountId, provider } = this.config;
    const token = ++this.linkToken;
    if (!projectId) return;

    void getAccountLink(projectId, accountId, provider)
      .then((link) => {
        // A project switch during the read makes this answer somebody else's.
        if (token !== this.linkToken) return;
        this.linkChecked = true;
        if (link?.autoSync) {
          this.hasLink = true;
          const savedAt = link.savedAt instanceof Date ? link.savedAt.getTime() : 0;
          this.lastPushAt = savedAt;
          this.setStatus({
            state: this.resolveIdleState('synced'),
            savedAt: savedAt || null,
          });
        } else {
          this.setStatus({ state: this.resolveIdleState() });
        }
        this.reschedule();
      })
      .catch(() => {
        // getAccountLink swallows its own failures, so this is only reachable
        // if IndexedDB is gone. An unknown link is the same situation as none.
        if (token !== this.linkToken) return;
        this.linkChecked = true;
        this.reschedule();
      });
  }

  /**
   * The state to show when nothing is happening.
   *
   * The order is the order of the answers a person needs: a switch that is off
   * outranks everything, then being signed out, then a live session, then
   * having nothing up there to keep up to date.
   */
  private resolveIdleState(preferred: AccountSyncState = 'waiting'): AccountSyncState {
    const { connected, enabled, collabActive } = this.config;
    if (!enabled) return 'disabled';
    if (!connected) return 'signed-out';
    if (collabActive) return 'paused-collab';
    if (this.linkChecked && !this.hasLink) return 'unlinked';
    return preferred;
  }

  /** Re-read the config into the current state, without re-arming. */
  private settle(): void {
    const { connected, enabled, collabActive } = this.config;
    if (!enabled) {
      this.setStatus({ state: 'disabled', message: null, conflict: null });
      return;
    }
    if (!connected) {
      this.setStatus({ state: 'signed-out', message: null, conflict: null });
      return;
    }
    // A stop is about this project and this storage. Neither a room opening nor
    // the switch being flicked off and on is an answer to it, so it is put back
    // exactly as it was rather than recomputed.
    if (this.stopped && this.stoppedFace) {
      this.setStatus(this.stoppedFace);
      return;
    }
    if (collabActive) {
      this.setStatus({ state: 'paused-collab', message: null });
      return;
    }
    this.setStatus({
      state: this.resolveIdleState(
        this.dirty ? 'pending' : this.status.savedAt ? 'synced' : 'waiting'
      ),
      message: null,
    });
  }

  // --- the push -------------------------------------------------------------

  private async push(reason: PushReason): Promise<void> {
    if (this.muted) return;
    const { projectId, connected, enabled, collabActive } = this.config;
    if (!projectId || !connected || !enabled) return;
    // A manual retry is still refused mid room: the answer would be the same
    // one second later, and the point of the hold is that it is not this
    // device's edit rate driving the writes.
    if (collabActive) return;
    if (this.inFlight) return;
    if (this.stopped && reason !== 'manual') return;
    if (!this.dirty && reason !== 'manual') return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.retryAt = Date.now() + OFFLINE_RETRY_MS;
      // A manual push with nothing unsaved gives `dueAt` nothing to schedule,
      // so saying "retrying" here would leave the chip waiting on a timer that
      // does not exist and cannot be created by coming back online. Everything
      // is already up there; say that instead.
      if (this.dueAt() === null) {
        this.setStatus({
          state: this.resolveIdleState(this.status.savedAt ? 'synced' : 'waiting'),
          message: null,
        });
        return;
      }
      this.setStatus({ state: 'retrying', message: 'Waiting for a connection' });
      this.reschedule();
      return;
    }

    this.inFlight = true;
    this.clearTimer();
    // Read before the await: an edit arriving while the push runs is NOT
    // covered by it, and comparing against this mark is how the next schedule
    // knows that.
    const changeMark = this.lastChangeAt;
    // And the generation, which is a different question: `configure` re-arms on
    // a change of project, PROVIDER, ACCOUNT or openToken, and comparing the
    // project id alone would let a Drive push resolve onto a syncer that has
    // since been re-armed for a gist. The success path would then claim a copy
    // that was never written, and the failure path would park the new target on
    // the old one's conflict, which is exactly what openToken exists to stop.
    // arm() bumps this counter unconditionally, so one comparison covers all four.
    const armMark = this.linkToken;
    this.setStatus({ state: 'syncing', message: null });

    try {
      await this.options.flushLocal();
      const outcome = await syncProjectToAccount(projectId);
      if (armMark !== this.linkToken || this.config.projectId !== projectId) return;

      this.failures = 0;
      this.retryAt = 0;

      if (outcome.status === 'unlinked') {
        this.hasLink = false;
        this.setStatus({ state: this.resolveIdleState(), message: null, conflict: null });
        return;
      }

      this.hasLink = true;
      this.lastPushAt = Date.now();
      this.dirty = this.lastChangeAt > changeMark;
      if (this.dirty) this.dirtySince = Math.max(this.lastChangeAt, this.lastPushAt);
      this.setStatus({
        state: this.dirty ? 'pending' : 'synced',
        // An unchanged document made no request, so the time it was last
        // actually written is the one already on the chip.
        savedAt: outcome.status === 'saved' ? this.lastPushAt : this.status.savedAt,
        message: null,
        conflict: null,
      });
    } catch (error) {
      if (armMark !== this.linkToken || this.config.projectId !== projectId) return;
      this.handleFailure(error);
    } finally {
      this.inFlight = false;
      this.reschedule();
    }
  }

  private handleFailure(error: unknown): void {
    if (error instanceof AccountConflictError) {
      this.stop({ state: 'conflict', message: error.message, conflict: error.remote });
      return;
    }
    if (error instanceof AccountBlockedError) {
      this.stop({ state: 'blocked', message: error.message, conflict: null });
      return;
    }
    if (error instanceof AccountAuthError || error instanceof AccountCancelledError) {
      // Deliberately NOT a sign out. The stored session is left exactly as it
      // is, because clearing it from a timer would drop somebody out of their
      // account in the middle of an edit for a renewal that one click can fix.
      this.stop({
        state: 'needs-attention',
        message: error instanceof AccountAuthError ? error.message : 'Sign in again to keep syncing',
        conflict: null,
      });
      return;
    }

    this.failures += 1;
    this.retryAt = Date.now() + BACKOFF_MS[Math.min(this.failures - 1, BACKOFF_MS.length - 1)];
    this.setStatus({
      state: 'retrying',
      message: error instanceof Error ? error.message : 'That did not reach your storage',
      conflict: null,
    });
    console.warn('Syncing to your storage did not land, will retry', error);
  }

  /** Stop until a person answers, remembering what to say when they look. */
  private stop(face: Pick<AccountSyncStatus, 'state' | 'message' | 'conflict'>): void {
    this.stopped = true;
    this.stoppedFace = face;
    this.setStatus(face);
  }

  // --- status ---------------------------------------------------------------

  private setStatus(patch: Partial<AccountSyncStatus>): void {
    const next: AccountSyncStatus = { ...this.status, provider: this.config.provider, ...patch };
    // One invariant, in the one place every state change passes through: with
    // the switch off there is nothing to report, so a push already in the air
    // when it was turned off cannot land the chip back on screen saying synced.
    if (!this.config.enabled) next.state = 'disabled';
    const current = this.status;
    if (
      next.state === current.state &&
      next.provider === current.provider &&
      next.savedAt === current.savedAt &&
      next.message === current.message &&
      next.conflict === current.conflict
    ) {
      return;
    }
    this.status = next;
    this.listeners.forEach((listener) => listener());
  }
}
