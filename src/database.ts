import Dexie, { Table } from 'dexie';
import type { Project } from './types/artboard';
import type { Operation } from './lib/ai/operationLog';

export class ProjectDatabase extends Dexie {
  projects!: Table<Project, string>; // <Type, KeyType>
  // One row per AI generate request, with its full timeline (stages, the
  // messages exchanged with the provider, screenshots, and any error) so a
  // failed run can be inspected after the fact. See src/lib/ai/operationLog.ts.
  operations!: Table<Operation, string>;

  constructor() {
    super('ProjectDatabase');
    this.version(1).stores({ // Bump version for schema change
      projects: 'id, name, timestamp' // Added name field
    });
    this.version(2).stores({
      projects: 'id, name, timestamp',
      operations: 'id, startedAt, status, provider',
    });
  }
}

export const db = new ProjectDatabase();
