import Dexie, { Table } from 'dexie';
import type { Project } from './types/artboard';
import type { Operation } from './lib/ai/operationLog';
import type { MediaAsset } from './lib/mediaStore';

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
  }
}

export const db = new ProjectDatabase();
