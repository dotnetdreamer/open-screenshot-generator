// What this device remembers about a project it has saved to the user's own
// storage.
//
// ## Why this table exists at all
//
// Until auto sync there was nothing to remember: the Save button asked the
// provider "do you already have this project?" every time, and paid two round
// trips (Drive) or a hundred item listing (GitHub gists) for the answer. A
// timer cannot afford that, and more importantly a timer must not GUESS it.
// Three things live here that no request can reconstruct:
//
//   - `remoteId`, so an unattended push writes the copy the user actually made
//     and never creates a second one
//   - `stamp`, the provider's own mark on the copy as this device last left it.
//     A push that finds a different mark stops, because something else has been
//     at the file and neither provider offers a conditional write to settle it
//   - `docHash`, so a project that is open but unedited costs zero requests
//
// ## Why it cannot live on the project row
//
// `handleArtboardsUpdate` rewrites that row from exactly four fields on every
// commit (AGENTS.md rule 1), so a fifth would survive until the next keystroke.
// The same reason src/lib/cloud/links.ts exists, and this is its sibling for
// the other destination.
//
// ## The adoption rule
//
// A row is minted by a MANUAL save and by nothing else. That is the whole
// safety model of this feature in one sentence: auto sync only ever updates a
// copy a person deliberately made, so ticking the box can never create folders
// in a stranger's Drive or gists on their account for projects they only
// opened. `getAccountLink` returning null is what the syncer reads as "nothing
// to do here", and it is the common case.

import { db } from '@/database';
import type { CloudProviderId } from './types';

export interface AccountProjectLink {
  /** The LOCAL project id. Primary key: one remote copy per local project. */
  projectId: string;
  /** Which storage it went to. A copy in Drive is not a copy in gists. */
  provider: CloudProviderId;
  /**
   * The provider account that made it.
   *
   * Signing out and back in as somebody else must not leave the first person's
   * remotes attached to projects the second person now sees, so every read
   * checks this and treats a mismatch as "not saved". Same rule getCloudLink
   * follows for our own cloud.
   */
  accountId: string;
  /** Drive folder id, or gist id. What a push writes into. */
  remoteId: string;
  /**
   * Drive only: the id of `project.json` inside that folder.
   *
   * The stamp is read from the document and never from the folder, because
   * every save that renames moves the folder's own timestamp and the syncer
   * would then keep finding a conflict with the last thing it did itself.
   */
  documentId?: string;
  /** The provider's mark on the copy as this device left it. Null when unknown. */
  stamp: string | null;
  /**
   * SHA-256 of the manifest JSON this device last pushed.
   *
   * Not a safety feature, a quiet one: the editor calls `noteChange` on commits
   * that do not always change the document (an undo back to where it started, a
   * selection that rides along with a commit), and without this an open project
   * would keep paying for pushes that write the same bytes.
   */
  docHash: string | null;
  /** When this device last pushed. */
  savedAt: Date;
  /** The name that went up with it, so a push can skip an unchanged rename. */
  lastPushedName: string;
  /**
   * Whether unattended pushes are allowed for THIS project.
   *
   * The Settings switch is the global answer; this is the per project one, and
   * it exists so answering a conflict with "stop syncing this one" is possible
   * without turning the feature off everywhere. A manual save turns it back on,
   * which is also how a project first gets it.
   */
  autoSync: boolean;
}

/** The link for a local project, or null. Never throws. */
export async function getAccountLink(
  projectId: string | null,
  accountId: string | null,
  provider: CloudProviderId | null
): Promise<AccountProjectLink | null> {
  if (!projectId) return null;
  try {
    const row = await db.accountLinks.get(projectId);
    if (!row) return null;
    // A copy in somebody else's Drive, or in the same person's gists rather
    // than their Drive, is not the copy this session may write to.
    if (accountId && row.accountId !== accountId) return null;
    if (provider && row.provider !== provider) return null;
    return row;
  } catch {
    return null;
  }
}

/** Record a save. Called by both the manual path and the syncer. */
export async function putAccountLink(link: AccountProjectLink): Promise<void> {
  try {
    await db.accountLinks.put(link);
  } catch (error) {
    // A lost hint is not worth failing a save that already landed upstream. The
    // cost is one redundant listing on the next manual save.
    console.error('Could not remember where this project was saved', error);
  }
}

/** Turn unattended pushes on or off for one project. */
export async function setAccountLinkAutoSync(projectId: string, autoSync: boolean): Promise<void> {
  try {
    const row = await db.accountLinks.get(projectId);
    if (!row) return;
    await db.accountLinks.put({ ...row, autoSync });
  } catch (error) {
    console.error('Could not change syncing for this project', error);
  }
}

/** Forget a link, because the remote copy is gone. */
export async function deleteAccountLink(projectId: string): Promise<void> {
  try {
    await db.accountLinks.delete(projectId);
  } catch {
    // Already gone, or the table is unreachable. Nothing depends on it.
  }
}

/** Forget a link by the remote id, which is what the account project list knows. */
export async function deleteAccountLinkByRemote(remoteId: string): Promise<void> {
  try {
    const rows = await db.accountLinks.where('remoteId').equals(remoteId).toArray();
    for (const row of rows) await db.accountLinks.delete(row.projectId);
  } catch {
    // as above
  }
}

/**
 * SHA-256 of a string, hex, or null where WebCrypto is not available.
 *
 * Null is a working answer and not a failure: the hash only ever suppresses a
 * push that would have written identical bytes, so losing it costs requests and
 * never correctness. `crypto.subtle` is absent on an insecure origin, which is
 * a shape the desktop shell can present.
 */
export async function hashDocument(text: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
