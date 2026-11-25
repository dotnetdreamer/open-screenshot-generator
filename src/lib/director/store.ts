// Where films are kept: a Dexie database of their own, beside the project
// database, the way the Website view keeps its sites. A project export, a
// cloud save or a version never carries a film, and AGENTS.md rule 1 would
// drop a film stored on the project at the next keystroke anyway.
//
// A film holds no recordings: each clip's recording is a row in the project
// database's `media` table (shared by every view), named by id. A film saved
// before films had clips is read as a film of one clip (upgradeFilm).

import Dexie, { type Table } from 'dexie';
import { upgradeFilm } from './timeline';
import type { Film } from './types';

class DirectorDatabase extends Dexie {
  films!: Table<Film, string>;

  constructor() {
    super('OpenScreenshotGeneratorDirector');
    this.version(1).stores({ films: 'id, projectId, updatedAt' });
  }
}

let database: DirectorDatabase | null = null;

function db(): DirectorDatabase {
  database ??= new DirectorDatabase();
  return database;
}

/** Every film on this device, newest first. */
export async function listFilms(): Promise<Film[]> {
  const rows = await db().films.toArray();
  return rows.map((row) => upgradeFilm(row)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFilm(id: string): Promise<Film | undefined> {
  const row = await db().films.get(id);
  return row ? upgradeFilm(row) : undefined;
}

export async function saveFilm(film: Film): Promise<void> {
  // A film made outside a project is stored under '' so the index can find it.
  await db().films.put({ ...film, projectId: film.projectId ?? '' });
}

export async function deleteFilm(id: string): Promise<void> {
  await db().films.delete(id);
}
