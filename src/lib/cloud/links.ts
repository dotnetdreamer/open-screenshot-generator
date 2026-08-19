// What the editor remembers locally about a project it has saved to the cloud.
//
// ## Why this is its own Dexie table
//
// The obvious home for "which cloud row is this project" is the project row
// itself. It cannot go there. `handleArtboardsUpdate` in
// OpenScreenshotGeneratorLayout rewrites that row from exactly four fields on
// every commit — id, name, timestamp, projectData — so a fifth field survives
// until the next keystroke and then silently disappears. `ProjectLocalization`
// is mirrored onto every artboard for the same reason.
//
// A separate table also keeps the promise this feature has to keep: nothing
// about cloud saving touches how projects are stored locally. Delete every row
// in here and the editor behaves exactly as it did before, minus the "already in
// your cloud" hints.

import { db } from '@/database';
import type { CloudProject, CloudVisibility } from './types';

export interface CloudProjectLink {
  /** The LOCAL project id. Primary key: one cloud copy per local project. */
  projectId: string;
  /** The PocketBase record id. */
  recordId: string;
  /**
   * Which community account saved it.
   *
   * Signing out and back in as somebody else must not leave the first person's
   * links attached to projects the second person now sees, so every read checks
   * this and treats a mismatch as "not saved".
   */
  accountId: string;
  /** When this device last pushed. */
  savedAt: Date;
  /**
   * The server's `updated` at that moment.
   *
   * The overwrite prompt is the whole reason it is stored: if the row up there
   * has moved on since, something else saved it, and blindly pushing over that
   * would lose whichever copy was not on this machine.
   */
  remoteUpdated: string;
  visibility: CloudVisibility;
  /** Empty unless the link is on. A credential, so it is never logged. */
  shareSlug: string;
  /**
   * Blobs that were still missing when the last save finished.
   *
   * A save uploads the document first and the recordings after it, so a
   * connection that drops in the middle leaves the cloud copy referencing files
   * that are not there. Recording which ones lets the UI say the copy is partial
   * instead of pretending it is fine, and the next save retries exactly these.
   */
  pendingAssets: string[];
  /**
   * The room key for editing this project together, once somebody has asked for
   * one. See src/lib/collab/links.ts.
   *
   * It is deliberately not on the server. The key is the half of an invite that
   * never leaves the people holding the link: it encrypts the session, and a
   * copy on our box would make "end to end" a claim rather than a fact. The
   * cost is that the same project invited from two devices is two rooms, which
   * is the right way round for a secret.
   */
  collabKey?: string;
}

/** The link for a local project, or null. Never throws. */
export async function getCloudLink(
  projectId: string,
  accountId: string | null
): Promise<CloudProjectLink | null> {
  if (!projectId) return null;
  try {
    const row = await db.cloudLinks.get(projectId);
    if (!row) return null;
    // A link minted by another account is not this viewer's to use, and showing
    // it would offer them an overwrite of somebody else's project.
    if (accountId && row.accountId && row.accountId !== accountId) return null;
    return row;
  } catch {
    return null;
  }
}

/** Every link this device holds, newest first. Used to annotate the local list. */
export async function listCloudLinks(accountId: string | null): Promise<CloudProjectLink[]> {
  try {
    const rows = await db.cloudLinks.orderBy('savedAt').reverse().toArray();
    return accountId ? rows.filter((row) => !row.accountId || row.accountId === accountId) : rows;
  } catch {
    return [];
  }
}

/** Record a successful save. */
export async function putCloudLink(
  projectId: string,
  accountId: string,
  project: CloudProject,
  pendingAssets: string[]
): Promise<void> {
  try {
    // The room key is the one field on this row the server knows nothing about,
    // so a save must carry it forward rather than write it away: the auto saver
    // runs every minute, and losing it would silently end a live session's
    // invite link between one edit and the next.
    const existing = await db.cloudLinks.get(projectId);
    await db.cloudLinks.put({
      projectId,
      recordId: project.id,
      accountId,
      savedAt: new Date(),
      remoteUpdated: project.updated,
      visibility: project.visibility,
      shareSlug: project.shareSlug ?? '',
      pendingAssets,
      ...(existing?.collabKey ? { collabKey: existing.collabKey } : {}),
    });
  } catch (error) {
    // A lost hint is not worth failing a save that already succeeded upstream.
    console.error('Could not remember the cloud link for this project', error);
  }
}

/**
 * Update just the sharing half, after the share toggle.
 *
 * `remoteUpdated` moves with it, because switching sharing on or off is a write
 * to the same row. Leaving the old stamp here would make the very next save
 * think another device had been at it.
 */
export async function setCloudLinkSharing(
  projectId: string,
  visibility: CloudVisibility,
  shareSlug: string,
  remoteUpdated?: string
): Promise<void> {
  try {
    const row = await db.cloudLinks.get(projectId);
    if (!row) return;
    await db.cloudLinks.put({
      ...row,
      visibility,
      shareSlug,
      remoteUpdated: remoteUpdated || row.remoteUpdated,
    });
  } catch (error) {
    console.error('Could not remember the share link for this project', error);
  }
}

/**
 * Remember the room key for editing this project together.
 *
 * Written next to the share slug because the two are only useful as a pair: the
 * slug says where the starting copy is, the key opens the room it is edited in.
 */
export async function setCloudLinkCollabKey(projectId: string, collabKey: string): Promise<void> {
  try {
    const row = await db.cloudLinks.get(projectId);
    if (!row) return;
    await db.cloudLinks.put({ ...row, collabKey });
  } catch (error) {
    console.error('Could not remember the room key for this project', error);
  }
}

/** Forget a link, because the cloud copy is gone. */
export async function deleteCloudLink(projectId: string): Promise<void> {
  try {
    await db.cloudLinks.delete(projectId);
  } catch {
    // Already gone, or the table is unreachable. Either way there is nothing to
    // do about it and nothing depends on it.
  }
}

/** Forget a link by the cloud record id, which is what the projects list knows. */
export async function deleteCloudLinkByRecord(recordId: string): Promise<void> {
  try {
    const rows = await db.cloudLinks.where('recordId').equals(recordId).toArray();
    for (const row of rows) await db.cloudLinks.delete(row.projectId);
  } catch {
    // as above
  }
}
