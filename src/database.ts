import Dexie, { Table } from 'dexie';
import type { Project } from './types/artboard';
import type { Operation } from './lib/ai/operationLog';
import type { MediaAsset } from './lib/mediaStore';
import type { CustomFontRow } from './services/customFonts';
import type { DiscoverPostRow } from './lib/discover/localPosts';
import type { CloudProjectLink } from './lib/cloud/links';
import type { AccountProjectLink } from './lib/account/links';
import type { ProjectVersion } from './lib/versions/store';

export class ProjectDatabase extends Dexie {
  projects!: Table<Project, string>; // <Type, KeyType>
  // One row per AI generate request, with its full timeline (stages, the
  // messages exchanged with the provider, screenshots, and any error) so a
  // failed run can be inspected after the fact. See src/lib/ai/operationLog.ts.
  operations!: Table<Operation, string>;
  // Large binary assets (screen recordings for App Preview videos). Stored as
  // Blobs in their own table so a 100MB recording is written once, NOT
  // re-serialized as base64 inside the project row on every save. Elements
  // reference rows by id (mediaId / screenVideoMediaId); URLs are minted at
  // runtime via src/lib/mediaStore.ts.
  media!: Table<MediaAsset, string>;
  // Font files the user imported from their own machine. Kept out of `media`
  // because every consumer of that table reads whole rows (blobs included) to
  // filter by id prefix, and a font is loaded on every app start.
  // See src/services/customFonts.ts.
  fonts!: Table<CustomFontRow, string>;
  // Posts the viewer published to the Discover feed from their own project.
  // The captured artboard PNGs are blobs, so they live here rather than in the
  // localStorage blob that holds the rest of the feed activity.
  // See src/lib/discover/localPosts.ts.
  discoverPosts!: Table<DiscoverPostRow, string>;
  // Which local project corresponds to which project saved to the cloud, plus
  // the share link if there is one. Kept in its own table rather than on the
  // project row on purpose: `handleArtboardsUpdate` rewrites that row from four
  // fields on every commit, so a fifth one would survive exactly until the next
  // keystroke. See src/lib/cloud/links.ts.
  cloudLinks!: Table<CloudProjectLink, string>;
  // Point-in-time copies of a project: the state it was in when it was opened,
  // a checkpoint every so often while it is edited, one before anything
  // whole-project, and the ones somebody named. The undo stack is per session
  // and lives in React state; this is what survives a reload.
  // Each row holds the document gzipped as a Blob, never as a string on the
  // row, for the same reason media does (issue #19).
  // See src/lib/versions/store.ts.
  projectVersions!: Table<ProjectVersion, string>;
  // Which local project corresponds to which copy in the user's OWN storage
  // (their Drive folder, their gist), and where that copy stood when this
  // device last wrote it. The sibling of `cloudLinks` for the other
  // destination, and for the same reason it is a table rather than a field:
  // `handleArtboardsUpdate` would wipe it on the next keystroke.
  // A row here is also the permission slip for unattended syncing: no row means
  // nobody ever saved this project there by hand, so nothing is pushed.
  // See src/lib/account/links.ts.
  accountLinks!: Table<AccountProjectLink, string>;

  constructor() {
    super('ProjectDatabase');
    this.version(1).stores({ // Bump version for schema change
      projects: 'id, name, timestamp' // Added name field
    });
    this.version(2).stores({
      projects: 'id, name, timestamp',
      operations: 'id, startedAt, status, provider',
    });
    this.version(3).stores({
      projects: 'id, name, timestamp',
      operations: 'id, startedAt, status, provider',
      media: 'id, createdAt',
    });
    this.version(4).stores({
      projects: 'id, name, timestamp',
      operations: 'id, startedAt, status, provider',
      media: 'id, createdAt',
      fonts: 'id, family, createdAt',
    });
    this.version(5).stores({
      projects: 'id, name, timestamp',
      operations: 'id, startedAt, status, provider',
      media: 'id, createdAt',
      fonts: 'id, family, createdAt',
      discoverPosts: 'id, createdAt',
    });
    this.version(6).stores({
      projects: 'id, name, timestamp',
      operations: 'id, startedAt, status, provider',
      media: 'id, createdAt',
      fonts: 'id, family, createdAt',
      discoverPosts: 'id, createdAt',
      // Keyed by the LOCAL project id, so "is this project in the cloud" is a
      // point read on the id the editor already has. `recordId` is indexed for
      // the other direction, which is what opening a cloud project uses.
      cloudLinks: 'projectId, recordId, savedAt',
    });
    this.version(7).stores({
      projects: 'id, name, timestamp',
      operations: 'id, startedAt, status, provider',
      media: 'id, createdAt',
      fonts: 'id, family, createdAt',
      discoverPosts: 'id, createdAt',
      cloudLinks: 'projectId, recordId, savedAt',
      // Compound index because every read is "this project's versions, newest
      // first": one index answers the list, the thinning pass and the delete.
      projectVersions: 'id, [projectId+createdAt], projectId, createdAt',
    });
    this.version(8).stores({
      projects: 'id, name, timestamp',
      operations: 'id, startedAt, status, provider',
      media: 'id, createdAt',
      fonts: 'id, family, createdAt',
      discoverPosts: 'id, createdAt',
      cloudLinks: 'projectId, recordId, savedAt',
      projectVersions: 'id, [projectId+createdAt], projectId, createdAt',
      // Keyed by the LOCAL project id, because every read is "may I sync the
      // project that is open". `remoteId` is indexed for the other direction,
      // which is what deleting a copy from the account dialog uses.
      accountLinks: 'projectId, remoteId, savedAt',
    });
  }
}

export const db = new ProjectDatabase();

// More than one window of this app can be open at once now: a detached panel
// window on a second monitor (src/lib/panels) is a second document on the same
// origin, so it shares this database. That only matters across an app update,
// where one window opens a newer schema while another still holds the old
// connection. Dexie's defaults for that are silent and unhelpful: the stale
// window's connection is closed with a console warning, and every later read or
// write rejects with DatabaseClosedError into call sites that all swallow it,
// which reads as "the app quietly stopped saving".
//
// So both handlers are registered, and both are deliberately quiet rather than
// clever. Nothing here can migrate a document that is already on screen; what
// it can do is make the failure legible instead of invisible.

/** Another window opened a newer schema. Let go, and say so. */
db.on('versionchange', () => {
  console.warn(
    'Another window of Open Screenshot Generator opened a newer version of the local database. Reload this window to catch up.'
  );
  db.close();
  return false;
});

/** We are the newer schema and an older window will not let go. */
db.on('blocked', () => {
  console.warn(
    'Another window of Open Screenshot Generator is holding the local database open on an older version. Close it, or reload it, to finish upgrading.'
  );
});
