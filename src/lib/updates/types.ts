// The desktop app's update state, as src-tauri/src/updater.rs sends it.
//
// Rust owns the state; the page only reads it and asks for a check or an
// install. Every field here mirrors a field there, so a change on one side
// changes the other in the same commit.

/** What this install does about updates. */
export type UpdateMode =
  /** Downloads, verifies and installs updates. */
  | 'install'
  /** Finds out about updates but never installs one. */
  | 'notify'
  /** Never checks. */
  | 'off';

/** Why the mode is not `install`. */
export type UpdateReason =
  /** The build has no update server: a local build, a fork, or a web-only checkout. */
  | 'unconfigured'
  | 'appStore'
  | 'microsoftStore'
  /** The portable zip, which no installer put in place. */
  | 'portable'
  /** A debug build. */
  | 'development';

/** Which releases this install takes. The beta channel also gets every stable release. */
export type UpdateChannel = 'stable' | 'beta';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  /** RFC 3339, as the update server sent it. */
  date: string | null;
  /** The release fixes something serious, so the app asks again rather than waiting. */
  critical: boolean;
  /** Where a person can download the release by hand. Rust lets only https through. */
  downloadPage: string | null;
  /** Bytes, when the server knows. */
  size: number | null;
}

export type UpdatePhase =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'upToDate' }
  /** Notify mode found a newer version. Nothing was downloaded. */
  | { phase: 'available'; update: UpdateInfo }
  | { phase: 'downloading'; update: UpdateInfo; received: number; total: number | null }
  /** Downloaded, and the signature checked out. */
  | { phase: 'ready'; update: UpdateInfo }
  | { phase: 'installing'; update: UpdateInfo }
  | { phase: 'failed'; step: 'check' | 'download'; message: string };

export interface UpdateSnapshot {
  mode: UpdateMode;
  reason: UpdateReason | null;
  currentVersion: string;
  phase: UpdatePhase;
  /** Unix milliseconds of the last check the server answered. */
  checkedAt: number | null;
}
