// Provider registry + the two operations the UI actually performs.
//
// Everything above this line is provider-specific; everything below is the
// same regardless of where the user's files live.

import { db } from '@/database';
import { migrateVideoDevices } from '@/lib/video/migrateVideoDevices';
import { ensureUniqueElementIds, normalizeLocalization } from '@/lib/i18n/localization';
import type { Project } from '@/types/artboard';
import { googleDriveProvider } from './providers/googleDrive';
import { githubProvider } from './providers/github';
import {
  collectMediaIds,
  importBundle,
  serializeProject,
  splitProgress,
} from './projectBundle';
import {
  deleteAccountLink,
  deleteAccountLinkByRemote,
  getAccountLink,
  hashDocument,
  putAccountLink,
} from './links';
import { getSession, setSession } from './store';
import {
  AccountAuthError,
  AccountBlockedError,
  AccountConflictError,
  type AccountSession,
  type CloudProvider,
  type CloudProviderId,
  type CloudProjectSummary,
  type ProgressFn,
} from './types';

export const CLOUD_PROVIDERS: Record<CloudProviderId, CloudProvider> = {
  google: googleDriveProvider,
  github: githubProvider,
};

export function getProvider(id: CloudProviderId): CloudProvider {
  return CLOUD_PROVIDERS[id];
}


/**
 * Refresh the stored session's token if needed and persist the result, so a
 * renewed access token survives the next reload.
 */
export async function withFreshSession(session: AccountSession): Promise<AccountSession> {
  const provider = getProvider(session.provider);
  const fresh = await provider.ensureFreshSession(session);
  if (fresh.accessToken !== session.accessToken || fresh.expiresAt !== session.expiresAt) {
    setSession(fresh);
  }
  return fresh;
}

/** Sign-in expired: drop the stored session so the UI falls back to signed-out. */
function handleAuthFailure(error: unknown): never {
  if (error instanceof AccountAuthError) setSession(null);
  throw error;
}

export interface SaveToAccountOptions {
  onProgress?: ProgressFn;
  /**
   * Save a second, separate copy instead of updating the one already up there.
   * Both providers decide "update or create" by looking for the manifest id,
   * so a copy has to carry its own id (see newCloudProjectId) or it would
   * overwrite the very file the user chose to keep. The local project row is
   * untouched: this saves a copy to the cloud, it does not fork the library.
   */
  saveAsCopy?: { id: string; name: string };
}

/** Push the active project (and its media) to the connected account. */
export async function saveProjectToAccount(
  projectId: string,
  options: SaveToAccountOptions = {}
): Promise<CloudProjectSummary> {
  const { onProgress, saveAsCopy } = options;
  const stored = getSession();
  if (!stored) throw new AccountAuthError('Connect an account first.');

  const project = await db.projects.get(projectId);
  if (!project) throw new Error('This project is not in your local library yet.');

  try {
    const session = await withFreshSession(stored);
    onProgress?.('Packaging project', 0);
    const bundle = await serializeProject(project, onProgress);
    const outgoing = saveAsCopy
      ? { ...bundle, manifest: { ...bundle.manifest, id: saveAsCopy.id, name: saveAsCopy.name } }
      : bundle;

    /*
     * Reuse the remote id this device already recorded, when there is one.
     *
     * Not an optimisation. Both providers otherwise answer "update or create?"
     * from a LISTING, and a listing is the one thing that can be wrong in the
     * dangerous direction: GitHub serves its API with a 60 second
     * Cache-Control, so a second save inside that minute reads a list that does
     * not yet contain the gist the first save created, concludes there is
     * nothing to update, and creates a duplicate. The transport now sends
     * no-store, which fixes that at the source; this makes the save not depend
     * on the answer in the first place.
     *
     * A copy is deliberately excluded: it is meant to become a new file.
     */
    const known = saveAsCopy
      ? null
      : await getAccountLink(projectId, session.account.id, session.provider);
    const options = {
      // A person is watching this one, so it keeps every bit of today's
      // behaviour, including tidying up blobs the project stopped using. The
      // one exception is a bundle that lost blobs locally: sweeping then would
      // delete the last copies on the strength of rows that are already gone.
      sweepOrphans: bundle.missingMedia.length === 0,
      renameTo: outgoing.manifest.name,
    };
    const provider = getProvider(session.provider);
    let saved: CloudProjectSummary;
    try {
      saved = await provider.saveProject(session, outgoing, onProgress, {
        ...options,
        ...(known ? { knownRemoteId: known.remoteId } : {}),
      });
    } catch (error) {
      // The recorded copy is gone, deleted from Drive or github.com since this
      // device last saw it. Forget it and do what a first save does, which is
      // the one case where creating something is correct: a person asked.
      const message = error instanceof Error ? error.message : String(error);
      if (!known || !/HTTP 404|no longer exists/.test(message)) throw error;
      await deleteAccountLink(projectId);
      saved = await provider.saveProject(session, outgoing, onProgress, options);
    }

    // A copy is a second, independent file; the open project's remote copy is
    // still the first one, so the link must not be moved onto it.
    if (!saveAsCopy) {
      await putAccountLink({
        projectId,
        provider: session.provider,
        accountId: session.account.id,
        remoteId: saved.remoteId,
        documentId: saved.documentId,
        stamp: saved.stamp ?? null,
        docHash: await hashDocument(documentKey(project.name, project.projectData)),
        savedAt: new Date(),
        lastPushedName: saved.name,
        // Clicking Save is also how somebody says yes again after answering a
        // conflict with "stop syncing this one".
        autoSync: true,
      });
    }
    return saved;
  } catch (error) {
    return handleAuthFailure(error);
  }
}

/**
 * What the doc hash is taken over.
 *
 * The project's own two mutable parts and nothing else. Deliberately NOT the
 * serialized manifest, even though that is what goes up: building the manifest
 * means reading every referenced blob out of IndexedDB, and a project holding a
 * 90MB recording would pay that read on every tick of a timer only to discover
 * nothing had changed. This is a string comparison over what the editor already
 * has in hand.
 */
function documentKey(name: string, projectData: Project['projectData']): string {
  return `${name}\u0000${JSON.stringify(projectData)}`;
}

/** What one unattended push did, for the state machine that asked for it. */
export type AccountSyncOutcome =
  /** Nothing is linked, or this project's syncing was switched off. Not an error. */
  | { status: 'unlinked' }
  /** The document has not moved since the last push. No request was made. */
  | { status: 'unchanged' }
  | { status: 'saved'; summary: CloudProjectSummary };

/**
 * Push the open project to the copy the user already made, unattended.
 *
 * The narrow door, deliberately separate from `saveProjectToAccount` so that
 * the Save button keeps behaving exactly as it always has. Everything that
 * makes an unattended write different from a clicked one is in here:
 *
 *   - it only ever UPDATES. No link row means no push, so ticking the switch
 *     can never create folders or gists for projects somebody merely opened
 *   - it refuses rather than degrades. A gist that cannot hold this project's
 *     images, or a bundle whose blobs are missing locally, stops for good
 *   - it never sweeps. Deleting remote blobs is decided from a local read, and
 *     a browser that evicted its media table would make that read a wrecking ball
 *   - it checks the remote mark first, and stops on a disagreement rather than
 *     resolving one. Neither provider offers a conditional write, so this
 *     notices another device rather than beating it
 *   - it never clears the session. An expired token from a timer is a chip that
 *     says reconnect, not a sign out somebody did not ask for mid edit
 */
export async function syncProjectToAccount(projectId: string): Promise<AccountSyncOutcome> {
  const stored = getSession();
  if (!stored) throw new AccountAuthError('Connect an account first.');

  const link = await getAccountLink(projectId, stored.account.id, stored.provider);
  if (!link || !link.autoSync) return { status: 'unlinked' };

  const project = await db.projects.get(projectId);
  if (!project) return { status: 'unlinked' };

  const provider = getProvider(stored.provider);

  // Decided locally, before a token is touched or a request is made, because
  // the answer cannot change by waiting and a backoff loop against it would be
  // noise. Media ids come off the document rather than a built bundle for the
  // same reason the hash does: building one reads every blob.
  if (!provider.supportsMedia && collectMediaIds(project.projectData).length > 0) {
    throw new AccountBlockedError(
      `${provider.label} holds text only, and this project has images or recordings of its own. ` +
        'Connect Google Drive to keep it up to date automatically'
    );
  }

  const hash = await hashDocument(documentKey(project.name, project.projectData));
  if (hash && hash === link.docHash && project.name === link.lastPushedName) {
    return { status: 'unchanged' };
  }

  const session = await withFreshSession(stored);

  const head = await provider.readRemoteStamp(session, {
    remoteId: link.remoteId,
    documentId: link.documentId,
  });
  if (!head) {
    // The copy is gone, or is no longer readable. Recreating it would be the
    // one thing this path promises never to do, so forget it instead and let a
    // manual save decide.
    await deleteAccountLink(projectId);
    return { status: 'unlinked' };
  }
  // A stored stamp of null means the last push could not learn where it left
  // the file, which both providers make rare but neither rules out. Pushing on
  // is the same last-writer-wins the Save button has always been, and it is the
  // right degradation: refusing would make the switch quietly do nothing.
  if (link.stamp && head.stamp !== link.stamp) {
    throw new AccountConflictError(
      'This project was changed somewhere else since this device last saved it',
      {
        remoteId: link.remoteId,
        projectId,
        // The name as THIS device last pushed it, which is not necessarily the
        // name it carries now: a rename elsewhere is one of the ways a remote
        // moves. The dialog knows that and does not put this in front of the
        // user for a conflict; it is here so the summary is complete.
        name: link.lastPushedName,
        modifiedAt: head.modifiedAt,
        documentId: link.documentId,
        stamp: head.stamp,
      }
    );
  }

  const bundle = await serializeProject(project);
  if (bundle.missingMedia.length > 0) {
    throw new AccountBlockedError(
      `${bundle.missingMedia.length} file${bundle.missingMedia.length > 1 ? 's' : ''} this project ` +
        'uses are no longer on this device, so an automatic save would send an incomplete copy. ' +
        'Save by hand to send it anyway'
    );
  }

  const saved = await provider.saveProject(session, bundle, undefined, {
    sweepOrphans: false,
    knownRemoteId: link.remoteId,
    renameTo: project.name === link.lastPushedName ? null : project.name,
  });

  await putAccountLink({
    ...link,
    remoteId: saved.remoteId,
    documentId: saved.documentId ?? link.documentId,
    stamp: saved.stamp ?? null,
    docHash: hash,
    savedAt: new Date(),
    lastPushedName: saved.name,
  });
  return { status: 'saved', summary: saved };
}

/**
 * The copy of a local project already sitting in the connected account, if any.
 * The save flow asks before it overwrites, and this is the thing it would
 * overwrite. Null when signed out or when nothing has been saved yet.
 */
export async function findAccountProject(projectId: string): Promise<CloudProjectSummary | null> {
  const projects = await listAccountProjects();
  return projects.find((project) => project.projectId === projectId) ?? null;
}

/**
 * Id for a cloud copy. Same millisecond-timestamp shape the editor uses for
 * local projects, plus a random tail: opening a copy imports it under this id,
 * so a collision with an existing local project would silently replace it.
 */
export function newCloudProjectId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Pull a project down and write it into the local library. */
export async function loadProjectFromAccount(
  remoteId: string,
  onProgress?: ProgressFn
): Promise<Project> {
  const stored = getSession();
  if (!stored) throw new AccountAuthError('Connect an account first.');

  try {
    const session = await withFreshSession(stored);
    const provider = getProvider(session.provider);
    // Two loops, one bar: the download counts to three quarters and writing the
    // blobs to this device counts the rest. Reported raw they would each run 0
    // to 100 and the bar would restart halfway through the wait.
    const progress = splitProgress(onProgress);
    const bundle = await provider.loadProject(session, remoteId, progress.download);
    // Same normalization the local load path runs, so a project saved by an
    // older build comes back on the current element shapes. ensureUniqueElementIds
    // repairs boards an older Duplicate Artboard aliased, and normalizeLocalization
    // re-stamps the language config and sweeps overrides whose element or
    // language is gone. Both return their input by reference when clean.
    bundle.manifest.projectData = normalizeLocalization(
      ensureUniqueElementIds(migrateVideoDevices(bundle.manifest.projectData))
    );
    const project = await importBundle(bundle, { onProgress: progress.install });

    // Opening a copy links it, exactly as saving one does.
    //
    // The adoption rule this feature rests on is that auto sync never CREATES
    // anything in somebody's storage, and picking a project out of that storage
    // to open satisfies it just as deliberately as pressing Save: the copy
    // exists, the user chose it, and the local project now IS that copy. It is
    // also what makes the feature worth having across two machines, since
    // otherwise the second one would sync nothing until somebody saved by hand.
    //
    // The stamp is read rather than assumed, and the hash is taken from what
    // just landed, so a project that is opened and not edited pushes nothing.
    const head = await provider
      .readRemoteStamp(session, { remoteId })
      .catch(() => null);
    await putAccountLink({
      projectId: project.id,
      provider: session.provider,
      accountId: session.account.id,
      remoteId,
      documentId: head?.documentId,
      stamp: head?.stamp ?? null,
      docHash: await hashDocument(documentKey(project.name, project.projectData)),
      savedAt: new Date(),
      lastPushedName: project.name,
      autoSync: true,
    });
    return project;
  } catch (error) {
    return handleAuthFailure(error);
  }
}

export async function listAccountProjects(): Promise<CloudProjectSummary[]> {
  const stored = getSession();
  if (!stored) return [];
  try {
    const session = await withFreshSession(stored);
    return await getProvider(session.provider).listProjects(session);
  } catch (error) {
    return handleAuthFailure(error);
  }
}

export async function deleteAccountProject(remoteId: string): Promise<void> {
  const stored = getSession();
  if (!stored) throw new AccountAuthError('Connect an account first.');
  try {
    const session = await withFreshSession(stored);
    await getProvider(session.provider).deleteProject(session, remoteId);
    // The copy is gone, so the permission slip to keep writing to it is too.
    await deleteAccountLinkByRemote(remoteId);
  } catch (error) {
    handleAuthFailure(error);
  }
}

export * from './types';
export { getSession, setSession, clearSession, useAccount, subscribe } from './store';
export {
  getAccountLink,
  putAccountLink,
  setAccountLinkAutoSync,
  deleteAccountLink,
  type AccountProjectLink,
} from './links';
export {
  serializeProject,
  importBundle,
  splitProgress,
  bundleToJson,
  bundleFromJson,
  collectFontFamilies,
  formatBytes,
  mediaBytes,
  fontBytes,
} from './projectBundle';
