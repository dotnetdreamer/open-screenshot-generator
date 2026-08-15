import Dexie, { Table } from 'dexie';
import type { Project } from './types/artboard';
import type { Operation } from './lib/ai/operationLog';
import type { MediaAsset } from './lib/mediaStore';
import type { CustomFontRow } from './services/customFonts';
import type { DiscoverPostRow } from './lib/discover/localPosts';

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
  }
}

export const db = new ProjectDatabase();
