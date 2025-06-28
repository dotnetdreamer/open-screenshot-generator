import Dexie, { Table } from 'dexie';
import type { ArtboardState } from './types/artboard';

export interface Project {
  id: string;
  name: string;
  timestamp: Date;
  projectData: ArtboardState[];
}

export class ProjectDatabase extends Dexie {
  projects!: Table<Project, string>; // <Type, KeyType>

  constructor() {
    super('ProjectDatabase');
    this.version(1).stores({ // Bump version for schema change
      projects: 'id, name, timestamp' // Added name field
    });
  }
}

export const db = new ProjectDatabase();
