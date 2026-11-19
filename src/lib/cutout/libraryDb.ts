// The user's own pictures get a Dexie database of their own, as Growth and
// Store compliance have, rather than a table in ProjectDatabase: adding one
// there means a new schema version, and a build from before it can then not
// open the projects at all (IndexedDB refuses a version lower than the one on
// disk), which is what anyone switching between builds would hit. The pictures
// themselves are media rows in ProjectDatabase; this holds the list.

import Dexie, { type Table } from 'dexie';
import type { LibraryImageRow } from './library';

class LibraryDatabase extends Dexie {
  images!: Table<LibraryImageRow, string>;

  constructor() {
    // Newest first is every read; a deleted row stays until a sync has told
    // the account (`deletedAt`).
    super('OpenScreenshotGeneratorLibrary');
    this.version(1).stores({ images: 'id, updatedAt' });
  }
}

export const libraryDb = new LibraryDatabase();

// As in src/database.ts: another window on a newer schema closes this one's
// connection rather than being blocked by it.
libraryDb.on('versionchange', () => {
  libraryDb.close();
  return false;
});
