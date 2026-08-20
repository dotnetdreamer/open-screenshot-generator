// Versions: what a project looked like at a point in time, kept across reloads.
//
// ## Why this exists next to undo rather than inside it
//
// The undo stack is a hundred full project snapshots in React state, and it is
// deliberately not persisted: writing it to disk is exactly the shape that
// caused the WKWebView crash loop in issue #19, where every snapshot carried a
// copy of every inline image. Undo answers "take back what I just did", within
// one sitting. This answers a different question, "put it back the way it was
// this morning", and it answers it after a reload, after a crash, and after a
// week.
//
// So a version is coarse on purpose. Five things write one, and all five are in
// the editor rather than here: the state a project was in when it was opened, a
// checkpoint every so often while it is edited, one before anything
// whole-project (a device conversion, a translation run, a restore), one on an
// export, and one whenever somebody names it. `thinVersions` below is what
// keeps that list at a size a person can read.
//
// ## What a version costs
//
// The document only. Media is referenced by id and lives in the `media` table
// already, so a version of a project with a 90MB recording is still a few tens
// of kilobytes: the ids it references are recorded so a future sweep of unused
// blobs can see that a version still needs them.
//
// A typical project is 50 to 300KB of JSON, which gzips to 20 to 40KB. The caps
// below are set so the whole history of a project is a couple of megabytes.

import { db } from '@/database';
import { packJson, unpackJson, type JsonEncoding } from '@/lib/compressJson';
import { collectMediaIds } from '@/lib/account/projectBundle';
import type { ArtboardState } from '@/types/artboard';

/** Why a version exists. It is what the row is labelled with, and how it thins. */
export type VersionKind =
  /** Somebody pressed Save a version and named it. Never thinned away. */
  | 'named'
  /** The periodic checkpoint while a project is being edited. */
  | 'auto'
  /** Taken before something that is hard to undo, including a restore. */
  | 'safety';

export interface ProjectVersion {
  id: string;
  projectId: string;
  createdAt: Date;
  /** What the list shows: a name somebody typed, or what was about to happen. */
  label: string;
  kind: VersionKind;
  /** The project's name at the time, so a restored copy can be called something. */
  projectName: string;
  boards: number;
  /** The document, gzipped. A Blob so the bytes are never a string on the row. */
  doc: Blob;
  encoding: JsonEncoding;
  bytes: number;
  /**
   * The media rows this document points at.
   *
   * Nothing sweeps unused blobs today. When something does, it has to treat a
   * version as a reason to keep one, or restoring last week's project brings
   * back a canvas full of holes.
   */
  assetIds: string[];
}

/** A row without its payload. What the panel lists. */
export type ProjectVersionMeta = Omit<ProjectVersion, 'doc'>;

/** Never more than this many for one project, whatever the thinning says. */
const MAX_VERSIONS = 60;
/** Nor more than this many bytes of them. */
const MAX_BYTES = 24 * 1024 * 1024;

export interface SaveVersionOptions {
  kind: VersionKind;
  label: string;
}

/**
 * Write one version. Returns null when there is nothing worth writing.
 *
 * Fire and forget from the editor's point of view: it is called from commit
 * paths, so it must never block one, and a failure here must never cost
 * somebody an edit.
 */
export async function saveVersion(
  projectId: string | null,
  boards: ArtboardState[],
  projectName: string,
  options: SaveVersionOptions
): Promise<ProjectVersionMeta | null> {
  if (!projectId || !boards?.length) return null;
  try {
    const json = JSON.stringify({ projectName, boards });
    const { blob, encoding } = await packJson(json);
    const row: ProjectVersion = {
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      createdAt: new Date(),
      label: options.label,
      kind: options.kind,
      projectName,
      boards: boards.length,
      doc: blob,
      encoding,
      bytes: blob.size,
      assetIds: collectMediaIds(boards),
    };
    await db.projectVersions.put(row);
    await thinVersions(projectId);
    const { doc: _doc, ...meta } = row;
    return meta;
  } catch (error) {
    console.error('Could not save a version of this project', error);
    return null;
  }
}

/** Every version of a project, newest first, without the payloads. */
export async function listVersions(projectId: string | null): Promise<ProjectVersionMeta[]> {
  if (!projectId) return [];
  try {
    const rows = await db.projectVersions.where('projectId').equals(projectId).toArray();
    return rows
      .map(({ doc: _doc, ...meta }) => meta)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch {
    return [];
  }
}

/** The document a version holds, ready to put on the canvas. */
export async function readVersion(
  versionId: string
): Promise<{ boards: ArtboardState[]; projectName: string; meta: ProjectVersionMeta } | null> {
  try {
    const row = await db.projectVersions.get(versionId);
    if (!row) return null;
    const parsed = JSON.parse(await unpackJson(row.doc, row.encoding)) as {
      projectName?: string;
      boards?: ArtboardState[];
    };
    if (!Array.isArray(parsed.boards) || !parsed.boards.length) return null;
    const { doc: _doc, ...meta } = row;
    return { boards: parsed.boards, projectName: parsed.projectName || row.projectName, meta };
  } catch (error) {
    console.error('Could not read that version', error);
    return null;
  }
}

export async function deleteVersion(versionId: string): Promise<void> {
  try {
    await db.projectVersions.delete(versionId);
  } catch {
    // Already gone, or the table is unreachable. Nothing depends on it.
  }
}

/** Called when a project is deleted, so its versions go with it. */
export async function deleteVersionsForProject(projectId: string): Promise<void> {
  try {
    await db.projectVersions.where('projectId').equals(projectId).delete();
  } catch {
    // as above
  }
}

/**
 * Thin the list to something a person can read and a disk can hold.
 *
 * The curve is Time Machine's, and it is the one that matches how people
 * actually look backwards: everything from the last hour (you are still in the
 * mistake), one an hour for the last day (you remember roughly when), one a day
 * beyond that (you remember roughly which day).
 *
 * Named versions are never thinned. Somebody typed a name because that state
 * meant something, and a retention rule that deletes those is a retention rule
 * nobody trusts.
 */
export async function thinVersions(projectId: string): Promise<void> {
  let rows: ProjectVersion[];
  try {
    rows = await db.projectVersions.where('projectId').equals(projectId).toArray();
  } catch {
    return;
  }
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const keptBuckets = new Set<string>();
  const keep: ProjectVersion[] = [];
  const drop: ProjectVersion[] = [];

  for (const row of rows) {
    const age = now - row.createdAt.getTime();
    if (row.kind === 'named' || age < hour) {
      keep.push(row);
      continue;
    }
    // One per bucket, and because the list is newest first the one kept is the
    // newest in that bucket.
    const bucket =
      age < day
        ? `h${Math.floor(row.createdAt.getTime() / hour)}`
        : `d${Math.floor(row.createdAt.getTime() / day)}`;
    if (keptBuckets.has(bucket)) {
      drop.push(row);
      continue;
    }
    keptBuckets.add(bucket);
    keep.push(row);
  }

  // Then the hard caps, applied to what survived the curve, oldest first, and
  // never to a named one.
  let total = keep.reduce((sum, row) => sum + row.bytes, 0);
  let count = keep.length;
  for (let i = keep.length - 1; i >= 0; i -= 1) {
    if (count <= MAX_VERSIONS && total <= MAX_BYTES) break;
    const row = keep[i];
    if (row.kind === 'named') continue;
    drop.push(row);
    count -= 1;
    total -= row.bytes;
  }

  if (!drop.length) return;
  try {
    await db.projectVersions.bulkDelete(drop.map((row) => row.id));
  } catch {
    // Leaving a few extra rows is harmless; failing a save over it is not.
  }
}

/** Bytes held by one project's versions, for the panel's footer. */
export function totalBytes(versions: ProjectVersionMeta[]): number {
  return versions.reduce((sum, version) => sum + version.bytes, 0);
}
