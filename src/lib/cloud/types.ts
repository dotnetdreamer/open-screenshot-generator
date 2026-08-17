// Cloud projects: the editable document, saved to Open Screenshot Generator's
// own backend rather than to storage the user owns.
//
// Three places a project can live now, and they do not compete:
//
//   IndexedDB          the working copy. Always the source of truth while the
//                      editor is open, written on every commit, and completely
//                      unaware that any of this exists.
//   the cloud (here)   a copy on our PocketBase, owned by one signed-in account,
//                      private until its owner turns a link on. This is what
//                      carries a project to another device, and what makes a
//                      shareable URL possible at all.
//   BYOS               a copy in the user's own Drive or gists (src/lib/account).
//                      Unchanged, and still the option for anybody who would
//                      rather we held nothing.
//
// The sign-in is the community one (src/lib/discover/session.ts), which is
// itself minted from whichever storage account is connected. So there is no
// third password and no fourth account: connecting Drive or GitHub is what
// gives somebody a place to save to here.

/** Whether a saved project can be reached by anyone holding its link. */
export type CloudVisibility = 'private' | 'link';

/** One blob the stored document references, as the server has it. */
export interface CloudAssetSummary {
  /** The Dexie row id (`media_…` or a font id), exactly as the document uses it. */
  assetId: string;
  kind: 'media' | 'font';
  size: number;
  /** Enough to rebuild the local row: mimeType, name, width, family, and so on. */
  meta: Record<string, unknown>;
}

/** A project in the cloud, as the list and the detail routes describe it. */
export interface CloudProject {
  /** The PocketBase record id. Stable, and what every route below is keyed by. */
  id: string;
  /** The editor's own project id, so a re-save updates rather than duplicating. */
  projectId: string;
  name: string;
  boards: number;
  docBytes: number;
  assetBytes: number;
  formatVersion: number;
  docEncoding: 'none' | 'gzip';
  visibility: CloudVisibility;
  /** ISO-ish, straight from PocketBase. Absent on a link-shared read. */
  created: string;
  updated: string;
  /**
   * The link key. Only ever present on a response to the owner, and it is a
   * credential: it is the entire permission to read the project.
   */
  shareSlug?: string;
  /** Present on the detail routes, absent on the list. */
  assets?: CloudAssetSummary[];
}

/** What a save answers with: the stored row, and the blobs still to upload. */
export interface CloudSaveResult {
  project: CloudProject;
  missing: Array<{ id: string; kind: 'media' | 'font' }>;
}

/** This build has no backend configured. Thrown from every write path. */
export class CloudDisabledError extends Error {
  constructor() {
    super('Saving to the cloud is not available in this build.');
    this.name = 'CloudDisabledError';
  }
}

/** The server refused, with a message worth putting in front of somebody. */
export class CloudRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloudRequestError';
    this.status = status;
  }
}

/** Attempted while signed out. The UI turns this into a sign-in prompt. */
export class CloudSignInRequiredError extends Error {
  constructor(message = 'Sign in to save to the cloud.') {
    super(message);
    this.name = 'CloudSignInRequiredError';
  }
}
