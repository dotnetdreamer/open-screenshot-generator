import Dexie, { Table } from 'dexie';

export interface ProjectData {
  timestamp: number;
  projectData: any; // Or a more specific type for your project data
}

export class ProjectDatabase extends Dexie {
  projects!: Table<ProjectData, number>;

  constructor() {
    super('ProjectDatabase');
    this.version(1).stores({
      projects: '++id, timestamp' // Primary key 'id' and indexed 'timestamp'
    });
  }
}

export const db = new ProjectDatabase();