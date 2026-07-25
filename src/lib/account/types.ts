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
}

/**
 * The serialized form of a project: the JSON document plus the binary media it
 * references. Media (screen recordings) lives in its own Dexie table and is
 * referenced by id, so it has to travel alongside the JSON or the restored
 * project comes back with dead video elements.
 */
export interface ProjectBundle {
  manifest: ProjectManifest;
  media: BundledMedia[];
}

export interface ProjectManifest {
  /** Bumped when the on-disk shape changes, so old files stay readable. */
  formatVersion: 1;
  id: string;
  name: string;
  timestamp: string; // ISO; JSON has no Date
  projectData: Project['projectData'];
  /** Metadata for each blob in `media`, so a restore can rebuild the row. */
  media: BundledMediaMeta[];
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

/** Progress for long saves (media upload dominates). */
export type ProgressFn = (step: string, ratio?: number) => void;

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
    onProgress?: ProgressFn
  ): Promise<CloudProjectSummary>;
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

/** The user closed the consent window / cancelled the flow. Not an error state. */
export class AccountCancelledError extends Error {
  constructor(message = 'Sign-in was cancelled.') {
    super(message);
    this.name = 'AccountCancelledError';
  }
}
