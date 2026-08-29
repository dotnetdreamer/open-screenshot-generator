// Bring-Your-Own-Storage account layer.
//
// Projects are saved to storage the *user* owns (their Google Drive, their
// GitHub gists). We host nothing and pay for nothing: there is no server in
// this product, and the static export has no API routes to add one.
//
// Every provider implements CloudProvider so the UI (AccountDialog, the
// "Save to account" toolbar button) never branches on which service is
// connected. Adding Dropbox later means adding one file here.

import type { Project } from '@/types/artboard';

export type CloudProviderId = 'google' | 'github';

/** The signed-in user, as shown in the sidebar and the account dialog. */
export interface Account {
  /** Stable id from the provider (Google `sub`, GitHub login). */
  id: string;
  /** Display name, falling back to the email/login when a name is absent. */
  name: string;
  email?: string;
  avatarUrl?: string;
}

/**
 * A persisted sign-in. Tokens live in localStorage, matching how AI provider
 * keys are already stored (src/lib/ai/providers.ts). Called out to the user in
 * the account dialog.
 */
export interface AccountSession {
  provider: CloudProviderId;
  account: Account;
  accessToken: string;
  /** Google desktop (loopback) only: lets us stay signed in across restarts. */
  refreshToken?: string;
  /** Epoch ms when accessToken stops working. Absent = does not expire. */
  expiresAt?: number;
}

/** One project as it exists in the user's cloud storage. */
export interface CloudProjectSummary {
  /** Provider-side handle (Drive folder id, gist id). */
  remoteId: string;
  /** Our project id, so a re-save overwrites instead of duplicating. */
  projectId: string;
  name: string;
  modifiedAt: Date;
  /** Bytes, when the provider reports it. */
  size?: number;
  /**
   * The remote object the manifest itself lives in, when that is not `remoteId`.
   *
   * Drive stores a project as a FOLDER (`remoteId`) holding a `project.json`
   * (this), and only the second one is worth watching: every save PATCHes the
   * folder's name, so the folder's own timestamp moves whether or not the
   * document did. A gist is one object and leaves this unset.
   */
  documentId?: string;
  /**
   * Where the remote copy stands, as the provider counts it: Drive's `version`
   * on project.json, a gist's HEAD sha. Compared against the stored one before
   * an unattended push, which is how the syncer notices another device.
   *
   * Opaque on purpose. Nothing but equality is ever asked of it, because the
   * two providers do not agree on what it means and neither is ordered in a way
   * that survives being parsed (Drive's is an int64 in a string).
   */
  stamp?: string | null;
}

/**
 * The serialized form of a project: the JSON document plus every binary it
 * references. Both kinds live in their own Dexie tables and are referenced
 * indirectly, so both have to travel alongside the JSON:
 *   - media (screen recordings), referenced by row id
 *   - imported fonts, referenced by family name on text elements
 * Without them the restored project comes back with dead video elements and
 * headlines in the browser's default serif.
 */
export interface ProjectBundle {
  manifest: ProjectManifest;
  media: BundledMedia[];
  fonts: BundledFont[];
  /**
   * Media the manifest still references and this bundle does NOT carry, because
   * the blob was gone from IndexedDB when it was built.
   *
   * Populated by the two producers that build a bundle from something the user
   * already has (`serializeProject` from IndexedDB, `bundleFromJson` from an
   * exported file); a bundle read back from a provider leaves it empty. It exists because an incomplete
   * bundle is dangerous rather than merely lossy: a provider that sweeps blobs
   * the bundle omits (Drive does) would delete the last copy of a recording on
   * the strength of a local row that had already been evicted. A manual save
   * carries on with the sweep switched off; an unattended one refuses.
   */
  missingMedia: string[];
}

export interface ProjectManifest {
  /**
   * Bumped when the on-disk shape changes, so old files stay readable.
   * Fonts did NOT bump it: `fonts` is additive and optional, so a file with
   * them still loads in a build that predates them (it ignores the key and
   * restores the project without the font, exactly as before), and a file
   * without them still loads here.
   */
  formatVersion: 1;
  id: string;
  name: string;
  timestamp: string; // ISO; JSON has no Date
  projectData: Project['projectData'];
  /** Metadata for each blob in `media`, so a restore can rebuild the row. */
  media: BundledMediaMeta[];
  /** Metadata for each font in `fonts`. Absent in files written before them. */
  fonts?: BundledFontMeta[];
  savedBy?: string; // app version, for debugging old files
}

export interface BundledMediaMeta {
  id: string;
  name: string;
  mimeType: string;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: string; // ISO
  size: number;
}

export interface BundledMedia {
  meta: BundledMediaMeta;
  blob: Blob;
}

export interface BundledFontMeta {
  id: string;
  /** The CSS family, which is what text elements actually reference. */
  family: string;
  fileName: string;
  format: string;
  mimeType: string;
  createdAt: string; // ISO
  size: number;
}

export interface BundledFont {
  meta: BundledFontMeta;
  blob: Blob;
}

/** Progress for long saves (media upload dominates). */
export type ProgressFn = (step: string, ratio?: number) => void;

/**
 * How one save differs from the default, which is what the Save button does.
 *
 * Every field is optional and every default is today's behaviour, so the manual
 * path reads exactly as it did before auto sync existed. They are all here for
 * the same reason: a save a person clicked and a save a timer started are
 * allowed to be different, and the differences are all about what an unattended
 * write may NOT do to storage somebody else owns.
 */
export interface AccountSaveOptions {
  /**
   * Delete remote blobs the project no longer references. True by default.
   *
   * Never true unattended. The sweep is the one destructive act in a save, it
   * is irreversible for the user (a Drive delete from `drive.file` goes to
   * their trash, but a gist file delete does not), and it is decided from a
   * local IndexedDB read that a wiped browser makes wrong.
   */
  sweepOrphans?: boolean;
  /**
   * Rename the remote copy to this. Null means leave the name alone.
   *
   * The Drive save used to PATCH the folder name on every push whether or not
   * it had changed, which is a wasted write and, worse, moves the folder's
   * modifiedTime on a save that changed nothing.
   */
  renameTo?: string | null;
  /**
   * The remote object this project is already known to live in.
   *
   * Supplied only when a link row says so, and it is what makes an unattended
   * push cheap: with it the provider skips the "find my copy" search entirely,
   * which on Drive is two requests and on GitHub is a 100 item listing that
   * silently truncates.
   */
  knownRemoteId?: string;
}

export interface SignInOptions {
  /** GitHub on the web needs a pasted token; there is no secretless flow. */
  token?: string;
  /** Desktop device-flow: surface the user code + URL while we poll. */
  onUserCode?: (info: { userCode: string; verificationUri: string }) => void;
  signal?: AbortSignal;
}

/**
 * A storage backend the user owns. Implementations must be safe to call from
 * both the web build and the Tauri desktop build; where the two need different
 * transports they branch on isTauri() internally.
 */
export interface CloudProvider {
  id: CloudProviderId;
  label: string;
  /** False when the build lacks the client id this provider needs. */
  isConfigured(): boolean;
  /** Why it is unavailable, shown in the dialog when isConfigured() is false. */
  configHint: string;
  /** True when this provider can store binary media (GitHub gists cannot). */
  supportsMedia: boolean;

  signIn(options?: SignInOptions): Promise<AccountSession>;
  signOut(session: AccountSession): Promise<void>;
  /**
   * Return a session with a usable access token, refreshing if needed.
   * Throws AccountAuthError when the user must sign in again.
   */
  ensureFreshSession(session: AccountSession): Promise<AccountSession>;

  listProjects(session: AccountSession): Promise<CloudProjectSummary[]>;
  saveProject(
    session: AccountSession,
    bundle: ProjectBundle,
    onProgress?: ProgressFn,
    options?: AccountSaveOptions
  ): Promise<CloudProjectSummary>;
  /**
   * Where the remote copy stands right now, in one cheap request.
   *
   * The whole point is to be cheaper than a listing and narrower than a load:
   * an unattended push calls this first and refuses when the answer is not the
   * stamp it last wrote. Returns null when the copy is gone, which is a state
   * (somebody deleted it) and not a failure.
   *
   * It cannot PREVENT a clobber, only notice one. Neither provider offers a
   * conditional write: Drive v3 dropped etags and accepts no If-Match on
   * files.update, and a gist PATCH takes no precondition either. So this is
   * check then act, and the window between the two is real. It closes the case
   * that actually happens, a second machine that pushed hours ago, not a
   * simultaneous write.
   */
  readRemoteStamp(
    session: AccountSession,
    remote: { remoteId: string; documentId?: string }
  ): Promise<{ stamp: string; modifiedAt: Date; documentId?: string } | null>;
  loadProject(
    session: AccountSession,
    remoteId: string,
    onProgress?: ProgressFn
  ): Promise<ProjectBundle>;
  deleteProject(session: AccountSession, remoteId: string): Promise<void>;
}

/** Sign-in is gone or was revoked: the UI should drop the session and re-prompt. */
export class AccountAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountAuthError';
  }
}

/**
 * The remote copy moved since this device last wrote it.
 *
 * Only ever thrown by the unattended path. Overwriting anyway is a decision,
 * and the syncer is not the layer that gets to make it: it stops and puts the
 * remote copy in front of the user.
 *
 * Expect false positives and design for them. Drive's `version` counts every
 * server side change to the file "even those not visible to the user", so a
 * stamp can move without the document having done so. That is why the answer
 * offered is keep mine, take theirs, or save a copy, rather than an error.
 */
export class AccountConflictError extends Error {
  constructor(
    message: string,
    /** What is up there now, for the dialog that asks about it. */
    readonly remote: CloudProjectSummary
  ) {
    super(message);
    this.name = 'AccountConflictError';
  }
}

/**
 * This project cannot go to this storage, and retrying will not change that.
 *
 * A gist that is being asked to hold a screen recording, a bundle whose blobs
 * are missing locally. The syncer stops for good rather than backing off,
 * because a backoff implies the wait is the problem and here it is not.
 */
export class AccountBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountBlockedError';
  }
}

/** The user closed the consent window / cancelled the flow. Not an error state. */
export class AccountCancelledError extends Error {
  constructor(message = 'Sign-in was cancelled.') {
    super(message);
    this.name = 'AccountCancelledError';
  }
}
