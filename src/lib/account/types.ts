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
  /**
   * Blob ids this device has already put in that remote object.
   *
   * Only gists need it, and only because a gist carries its blobs base64 in
   * files whose names come back nowhere cheap: `readRemoteStamp` reads the
   * commit list, which has no file list in it, and `GET /gists/{id}` would drag
   * every image back down to find out what is already up there. Without this an
   * unattended push re-uploads every screenshot in the project every time.
   *
   * Only ever consulted where there is nothing better. A save somebody clicked
   * reads the gist and uses its real file list instead, which is what repairs a
   * stale entry here: an id this claims was pushed but which is no longer
   * upstream is re-sent by that save. An id missing from here is simply sent
   * again. Absent on links written before images travelled.
   */
  knownMediaIds?: string[];
}

export interface SignInOptions {
  /** GitHub on the web needs a pasted token; there is no secretless flow. */
  token?: string;
  /**
   * GitHub only: scopes to ask for on top of `gist`. The Website view asks
   * for `public_repo`, which its site's repository needs. A token from such a
   * sign-in still saves projects, since it keeps `gist`.
   */
  scopes?: string[];
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
  /**
   * True when screen recordings can travel to this storage.
   *
   * There is no companion flag for images or fonts because both providers carry
   * both: a gist holds text, so they travel base64 encoded there.
   *
   * False for gists, and the split is not fussiness. A gist file over ten
   * megabytes cannot be read back through the API at all (GitHub says clone it
   * instead), and base64 spends four bytes for every three, so the ceiling on
   * a recording is about 7.5MB raw. Recordings are not that. Screenshots are
   * comfortably under it, which is why they no longer share the refusal.
   */
  supportsVideo: boolean;

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

/**
 * The user's own pictures (the background remover's library) as kept in their
 * storage: a list for each computer that backs up there, and a file per
 * picture, apart from any project. See src/lib/account/libraryFiles.ts for the
 * lists, and src/lib/cutout/backup.ts, which merges them with this computer's.
 *
 * This is the one shared list builds from before the lists kept in
 * library.json, which is still read as one more list while it has pictures.
 */
export interface RemoteLibraryManifest {
  formatVersion: 1;
  savedBy?: string;
  updatedAt: number;
  images: RemoteLibraryImage[];
  /** Pictures deleted somewhere, so a sync elsewhere deletes them too. */
  deleted: Array<{ id: string; at: number }>;
}

export interface RemoteLibraryImage {
  id: string;
  name: string;
  /** The finished picture's media id, which the storage finds its file by. */
  mediaId: string;
  mimeType: string;
  width: number;
  height: number;
  engine?: string;
  /** The photo and mask it was cut from, where the storage keeps them. */
  sourceMediaId?: string;
  sourceMimeType?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  maskMediaId?: string;
  settings?: { edge: number; softness: number; cleanColors: boolean; trim: boolean };
  rect?: { x: number; y: number; width: number; height: number };
  createdAt: number;
  updatedAt: number;
}

/**
 * One computer's list of the pictures in the account, in a file of its own
 * that no other computer writes (src/lib/account/libraryFiles.ts). It holds
 * everything that computer knew when it last backed up: the lists it read
 * then, merged with its own pictures.
 */
export interface RemoteLibraryList {
  formatVersion: 1;
  /** The computer that wrote it; the file's name says the same. */
  device: string;
  /** When it was written, by that computer's clock. Each of its lists is later than the one before. */
  updatedAt: number;
  /**
   * The other computers' lists it took in, by computer: the `updatedAt` each
   * had then. A list another one took in since says nothing that one does
   * not, so it is left out of the merge, and a deletion forgotten after
   * TOMBSTONE_DAYS cannot bring its old pictures back.
   */
  seen: Record<string, number>;
  images: RemoteLibraryImage[];
  /** Pictures deleted somewhere, so a sync elsewhere deletes them too. */
  deleted: Array<{ id: string; at: number }>;
  /**
   * Files a backup from that computer is sending, or keeping for its newer
   * pictures, while it runs: written before it sends any, so no other
   * computer takes them out before its list names them. The list's pictures
   * are its last finished backup's meanwhile.
   */
  sending?: string[];
  /** When `sending` was written. Old ones (a backup that never finished) are not kept to. */
  sendingAt?: number;
}

/** What one read of the remote library found. `handle` and `files` are the provider's own. */
export interface RemoteLibraryState {
  /** Every list there: each computer's, and library.json's while a build from before the lists wrote pictures in it. */
  lists: RemoteLibraryList[];
  /** Whether library.json is the note that stops builds from before the lists. */
  fenced: boolean;
  /** The names of list files there that do not read as one. Nothing is taken out of the account while there are some. */
  unreadable: string[];
  /** Media ids already stored there. */
  mediaIds: Set<string>;
  handle: string | null;
  files: Map<string, unknown>;
}

/** The library's side of a storage backend. */
export interface LibraryRemote {
  /** Whether the photos and masks travel too, so a cut can still be changed after a restore. */
  keepsSources: boolean;
  read(session: AccountSession): Promise<RemoteLibraryState>;
  /** The lists and files as they are now, which another computer may have changed since `state` was read. */
  refresh(session: AccountSession, state: RemoteLibraryState): Promise<RemoteLibraryState>;
  /**
   * Sends files not already there, making the folder on the first call. `name`
   * is what the file is called where the storage shows a name to the user.
   * `kept` is every file the account holds once the sync is done, and
   * `device` the computer whose list it adds, for a storage that limits how
   * many files it holds: the old versions about to go do not count against it.
   */
  upload(
    session: AccountSession,
    state: RemoteLibraryState,
    files: Array<{ mediaId: string; blob: Blob; mimeType: string; name?: string }>,
    options?: { onProgress?: ProgressFn; kept?: ReadonlySet<string>; device?: string }
  ): Promise<RemoteLibraryState>;
  /**
   * Writes this computer's list, making its file the first time. `fence`
   * makes library.json the note too, once the list has taken in what it held.
   */
  writeList(session: AccountSession, state: RemoteLibraryState, list: RemoteLibraryList, options?: { fence?: boolean }): Promise<RemoteLibraryState>;
  download(session: AccountSession, state: RemoteLibraryState, mediaId: string, mimeType: string): Promise<Blob>;
  /**
   * Takes out the files no list names any more (Drive puts them in its
   * trash). Returns the media ids of the ones still there because the storage
   * refused or failed; the next sync finds them unnamed and tries again.
   */
  remove(session: AccountSession, state: RemoteLibraryState, mediaIds: string[]): Promise<string[]>;
  /**
   * Puts back files `remove` took out, for pictures another computer named
   * meanwhile: out of the Drive trash, or into the gist again from the copy
   * `from` read. Returns the media ids it could not put back.
   */
  restore(session: AccountSession, from: RemoteLibraryState, mediaIds: string[]): Promise<string[]>;
  /**
   * Takes out other computers' lists, for a storage that limits how many files
   * it holds (a gist): only ones this computer's list took in.
   */
  dropLists?(session: AccountSession, state: RemoteLibraryState, devices: string[]): Promise<void>;
  /**
   * Gives files already there the name `upload` would give them now, for a
   * storage that shows the user names (a renamed picture, a file from before
   * names were used). Only where a name differs. `left` holds the media ids of
   * the files it could not rename, which keep their old names until a sync
   * renames them.
   */
  rename?(
    session: AccountSession,
    state: RemoteLibraryState,
    files: Array<{ mediaId: string; mimeType: string; name: string }>
  ): Promise<{ state: RemoteLibraryState; left: string[] }>;
}

/** Sign-in is gone or was revoked: the UI should drop the session and re-prompt. */
export class AccountAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountAuthError';
  }
}

/**
 * The storage is taking another write to the same place this moment and
 * refused this one: GitHub answers 409 to a gist change made while another
 * change to it is under way (two computers backing up at once did, November
 * 2026). The other write takes a second or two, so trying again works.
 */
export class StorageBusyError extends Error {
  constructor(message = 'GitHub was busy with another change to the same gist. Try again in a moment.') {
    super(message);
    this.name = 'StorageBusyError';
  }
}

/** Runs `job`, again after 1, 2 and 4 seconds while the storage is busy (StorageBusyError). */
export async function whenNotBusy<T>(job: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await job();
    } catch (error) {
      if (!(error instanceof StorageBusyError) || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
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
