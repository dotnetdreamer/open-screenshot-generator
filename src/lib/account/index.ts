// Provider registry + the two operations the UI actually performs.
//
// Everything above this line is provider-specific; everything below is the
// same regardless of where the user's files live.

import { db } from '@/database';
import { migrateVideoDevices } from '@/lib/video/migrateVideoDevices';
import type { Project } from '@/types/artboard';
import { googleDriveProvider } from './providers/googleDrive';
import { githubProvider } from './providers/github';
import { importBundle, serializeProject } from './projectBundle';
import { getSession, setSession } from './store';
import {
  AccountAuthError,
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

/** Push the active project (and its media) to the connected account. */
export async function saveProjectToAccount(
  projectId: string,
  onProgress?: ProgressFn
): Promise<CloudProjectSummary> {
  const stored = getSession();
  if (!stored) throw new AccountAuthError('Connect an account first.');

  const project = await db.projects.get(projectId);
  if (!project) throw new Error('This project is not in your local library yet.');

  try {
    const session = await withFreshSession(stored);
    onProgress?.('Packaging project', 0);
    const bundle = await serializeProject(project, onProgress);
    return await getProvider(session.provider).saveProject(session, bundle, onProgress);
  } catch (error) {
    return handleAuthFailure(error);
  }
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
    const bundle = await getProvider(session.provider).loadProject(session, remoteId, onProgress);
    // Same normalization the local load path runs, so a project saved by an
    // older build comes back on the current element shapes.
    bundle.manifest.projectData = migrateVideoDevices(bundle.manifest.projectData);
    return await importBundle(bundle);
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
  } catch (error) {
    handleAuthFailure(error);
  }
}

export * from './types';
export { getSession, setSession, clearSession, useAccount, subscribe } from './store';
export { serializeProject, importBundle, bundleToJson, bundleFromJson, formatBytes, mediaBytes } from './projectBundle';
