// Saving a project to the cloud, opening one, and sharing one by link.
//
// Everything above `cloudApi` is transport; everything here is the four things a
// person actually does. The rule this file exists to keep is the one in
// links.ts: IndexedDB stays the source of truth for the open project, and
// nothing in here writes to `db.projects` except through `importBundle`, which
// is the same door the local .json import already uses.
//
// The bundle format is shared with bring-your-own-storage on purpose
// (src/lib/account/projectBundle.ts). A project saved to Drive, exported to a
// file and saved here are the same document, so a fix to how recordings or
// imported fonts travel lands in all three at once.

import { db } from '@/database';
import { BASE_PATH } from '@/lib/basePath';
import { ensureUniqueElementIds, normalizeLocalization } from '@/lib/i18n/localization';
import { migrateVideoDevices } from '@/lib/video/migrateVideoDevices';
import { importBundle, serializeProject, splitProgress } from '@/lib/account/projectBundle';
import { packJson, unpackJson } from '@/lib/compressJson';
import type {
  BundledFont,
  BundledFontMeta,
  BundledMedia,
  BundledMediaMeta,
  ProgressFn,
  ProjectBundle,
  ProjectManifest,
} from '@/lib/account/types';
import type { Project } from '@/types/artboard';
import { cloudApi } from './api';
import {
  deleteCloudLink,
  deleteCloudLinkByRecord,
  getCloudLink,
  putCloudLink,
  setCloudLinkSharing,
} from './links';
import {
  CloudRequestError,
  CloudSignInRequiredError,
  type CloudAssetSummary,
  type CloudProject,
  type CloudVisibility,
} from './types';

export * from './types';
export { cloudApi } from './api';
export {
  getCloudLink,
  listCloudLinks,
  deleteCloudLink,
  setCloudLinkCollabKey,
  type CloudProjectLink,
} from './links';

/**
 * Something is already up there for this project and it is not what this device
 * last pushed. Carries the remote row so the prompt can name a date.
 */
export class CloudConflictError extends Error {
  readonly remote: CloudProject;
  constructor(remote: CloudProject) {
    super('There is a newer copy of this project in the cloud.');
    this.name = 'CloudConflictError';
    this.remote = remote;
  }
}

// The document is gzipped on its way up and read back by whichever encoding the
// record says it was stored in. Shared with the local version history, which
// stores the same document the same way: see src/lib/compressJson.ts.

// ---------------------------------------------------------------------------
// saving
// ---------------------------------------------------------------------------

export interface SaveToCloudOptions {
  onProgress?: ProgressFn;
  /**
   * Push over whatever is up there.
   *
   * The save refuses by default when the remote row has moved since this device
   * last wrote it, because that means another device saved in between and one of
   * the two copies is about to be lost. The prompt this throws for is the only
   * place that decides which.
   */
  force?: boolean;
}

export interface SaveToCloudResult {
  project: CloudProject;
  /** Blobs that did not make it. Empty on a clean save. */
  failedAssets: string[];
}

/**
 * Push the local project and everything it references.
 *
 * Two phases, matching the two routes: the document goes first and comes back
 * with the list of blobs the server does not have, then those go one request
 * each. A blob that fails is reported rather than fatal — the document is
 * saved, the project reopens, and the next save retries exactly what is missing.
 */
export async function saveProjectToCloud(
  projectId: string,
  options: SaveToCloudOptions = {}
): Promise<SaveToCloudResult> {
  const { onProgress, force } = options;

  const accountId = cloudApi.accountId();
  if (!accountId) throw new CloudSignInRequiredError();

  const project = await db.projects.get(projectId);
  if (!project) throw new Error('This project is not in your local library yet.');

  await assertNoUnexpectedRemote(projectId, accountId, force === true);

  onProgress?.('Packaging project', 0);
  const bundle = await serializeProject(project, onProgress);

  onProgress?.('Compressing', 0.4);
  const { blob: doc, encoding } = await packJson(JSON.stringify(bundle.manifest));

  const manifestAssets = [
    ...bundle.media.map((item) => ({ id: item.meta.id, kind: 'media' as const })),
    ...bundle.fonts.map((font) => ({ id: font.meta.id, kind: 'font' as const })),
  ];

  onProgress?.('Saving project', 0.5);
  const saved = await cloudApi.saveProject({
    projectId,
    name: project.name || 'Untitled project',
    boards: project.projectData?.length ?? 0,
    formatVersion: bundle.manifest.formatVersion,
    doc,
    docEncoding: encoding,
    manifestAssets,
  });

  // Uploading only what the server asked for is the whole reason a re-save of a
  // project with a 90MB recording costs a few hundred kilobytes.
  const failedAssets: string[] = [];
  const wanted = saved.missing;
  // Each upload restates `asset_bytes` on the project row and so moves its
  // `updated`. The link has to end up holding the LAST stamp, or the next save
  // compares against one from before the uploads and reports a conflict with
  // itself.
  let updated = saved.project.updated;
  for (const [index, entry] of wanted.entries()) {
    const source =
      entry.kind === 'font'
        ? bundle.fonts.find((font) => font.meta.id === entry.id)
        : bundle.media.find((item) => item.meta.id === entry.id);
    if (!source) {
      // Referenced by the document but not in the bundle: the local blob was
      // cleared while the element kept pointing at it. Nothing to upload.
      continue;
    }
    onProgress?.(`Uploading file ${index + 1} of ${wanted.length}`, 0.5 + (0.5 * index) / wanted.length);
    try {
      const stamp = await cloudApi.uploadAsset(saved.project.id, {
        assetId: entry.id,
        kind: entry.kind,
        blob: source.blob,
        meta: source.meta as unknown as Record<string, unknown>,
      });
      if (stamp) updated = stamp;
    } catch (error) {
      // One failed recording must not cost the save. It is recorded on the link
      // so the UI can say the copy is partial, and the next save retries it.
      console.error(`Could not upload ${entry.id} to the cloud`, error);
      failedAssets.push(entry.id);
      if (error instanceof CloudSignInRequiredError) throw error;
    }
  }

  const stored: CloudProject = { ...saved.project, updated };
  await putCloudLink(projectId, accountId, stored, failedAssets);
  onProgress?.('Saved', 1);
  return { project: stored, failedAssets };
}

/**
 * Refuse a save that would silently overwrite somebody else's newer copy.
 *
 * Two cases, and they read differently to the person in front of it:
 *   - this device has saved before and the remote row has moved since, so
 *     another device wrote in between
 *   - this device has never saved this project, and there is already one up
 *     there under the same id, which is the same project saved from a laptop
 *
 * Both raise CloudConflictError so the caller can ask once and retry with
 * `force`. A remote row that matches what we last wrote is not a conflict and
 * costs one small request to confirm.
 */
async function assertNoUnexpectedRemote(
  projectId: string,
  accountId: string,
  force: boolean
): Promise<void> {
  if (force) return;

  const link = await getCloudLink(projectId, accountId);
  if (link) {
    let remote: CloudProject | null = null;
    try {
      remote = await cloudApi.getProject(link.recordId);
    } catch (error) {
      // A lookup that failed for any reason other than "signed out" must not
      // block the save: the point of the check is to catch a real divergence,
      // not to make saving depend on a second request succeeding.
      if (error instanceof CloudSignInRequiredError) throw error;
      return;
    }
    if (!remote) {
      // Deleted elsewhere. Saving recreates it, which is what the user asked
      // for, so drop the stale link and carry on.
      await deleteCloudLink(projectId);
      return;
    }
    if (remote.updated !== link.remoteUpdated) throw new CloudConflictError(remote);
    return;
  }

  let listed: CloudProject[] = [];
  try {
    listed = (await cloudApi.listProjects()).projects;
  } catch (error) {
    if (error instanceof CloudSignInRequiredError) throw error;
    return;
  }
  const existing = listed.find((entry) => entry.projectId === projectId);
  if (existing) throw new CloudConflictError(existing);
}

// ---------------------------------------------------------------------------
// opening
// ---------------------------------------------------------------------------

/** Where a bundle's bytes come from: the owner's routes, or a share slug. */
interface BundleSource {
  doc(): Promise<Blob>;
  asset(assetId: string): Promise<Blob>;
}

/**
 * Rebuild a ProjectBundle from a stored document plus whichever blobs are there.
 *
 * A blob that will not load is skipped rather than fatal, matching how the Drive
 * provider and `bundleFromJson` both treat metadata with no payload: the project
 * comes back with that one element blank, which beats refusing to open it.
 */
async function fetchBundle(
  summary: CloudProject,
  source: BundleSource,
  onProgress?: ProgressFn
): Promise<ProjectBundle> {
  onProgress?.('Reading project', 0);
  const manifest = JSON.parse(
    await unpackJson(await source.doc(), summary.docEncoding)
  ) as ProjectManifest;

  if (!Array.isArray(manifest.projectData)) {
    throw new Error('That cloud project is missing its artboard data.');
  }

  // The manifest is the authority on what the document references; the server's
  // asset index is only consulted for the metadata of anything the manifest
  // somehow lacks. Keeps a restore identical to the local .json import.
  const byId = new Map<string, CloudAssetSummary>();
  for (const entry of summary.assets ?? []) byId.set(entry.assetId, entry);

  const mediaMetas: BundledMediaMeta[] = Array.isArray(manifest.media) ? manifest.media : [];
  const fontMetas: BundledFontMeta[] = Array.isArray(manifest.fonts) ? manifest.fonts : [];
  const total = mediaMetas.length + fontMetas.length;
  let done = 0;

  const media: BundledMedia[] = [];
  for (const meta of mediaMetas) {
    done += 1;
    onProgress?.(`Downloading media ${done} of ${total}`, total ? done / total : 1);
    if (!byId.has(meta.id)) continue; // never finished uploading
    try {
      media.push({ meta, blob: await source.asset(meta.id) });
    } catch (error) {
      console.error(`Could not download ${meta.id} from the cloud`, error);
    }
  }

  const fonts: BundledFont[] = [];
  for (const meta of fontMetas) {
    done += 1;
    onProgress?.(`Downloading fonts`, total ? done / total : 1);
    if (!byId.has(meta.id)) continue;
    try {
      fonts.push({ meta, blob: await source.asset(meta.id) });
    } catch (error) {
      console.error(`Could not download the font ${meta.family}`, error);
    }
  }

  // Empty because nothing local was dropped here: this bundle is being read
  // back off the wire, and the two `continue`s above are the server's copy
  // being incomplete rather than this device's. See ProjectBundle.missingMedia.
  return { manifest, media, fonts, missingMedia: [] };
}

/**
 * The same normalization the local load path runs.
 *
 * A project saved by an older build comes back on the current element shapes:
 * `ensureUniqueElementIds` repairs boards an older Duplicate Artboard aliased,
 * and `normalizeLocalization` re-stamps the language config and sweeps overrides
 * whose element or language is gone. Both return their input by reference when
 * there is nothing to fix.
 */
function normalize(bundle: ProjectBundle): ProjectBundle {
  bundle.manifest.projectData = normalizeLocalization(
    ensureUniqueElementIds(migrateVideoDevices(bundle.manifest.projectData))
  );
  return bundle;
}

/**
 * A local project id for a copy.
 *
 * Same millisecond-timestamp shape the editor mints for a new project, plus a
 * random tail: a copy is imported under this id, so a collision with an existing
 * local project would silently replace it.
 */
export function newLocalProjectId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface OpenFromCloudOptions {
  onProgress?: ProgressFn;
  /**
   * Import under a fresh local id instead of the project's own.
   *
   * The default is to restore over the local row, which is what "open my cloud
   * copy" means when the two are the same project. The dialog offers this when
   * the local copy is the newer of the two, so nobody loses today's work to
   * yesterday's backup.
   */
  asCopy?: boolean;
}

/** Pull one of the account's own cloud projects into the local library. */
export async function loadProjectFromCloud(
  recordId: string,
  options: OpenFromCloudOptions = {}
): Promise<Project> {
  const { onProgress, asCopy } = options;
  const accountId = cloudApi.accountId();
  if (!accountId) throw new CloudSignInRequiredError();

  const summary = await cloudApi.getProject(recordId);
  if (!summary) throw new CloudRequestError('That project is no longer in your cloud.', 404);

  // Downloading and then writing the blobs to this device are both slow enough
  // to be worth reporting, and splitProgress keeps them on one rising bar.
  const progress = splitProgress(onProgress);
  const bundle = normalize(
    await fetchBundle(
      summary,
      {
        doc: () => cloudApi.fetchDoc(recordId),
        asset: (assetId) => cloudApi.fetchAsset(recordId, assetId),
      },
      progress.download
    )
  );

  const localId = asCopy ? newLocalProjectId() : summary.projectId;
  const project = await importBundle(bundle, {
    projectId: localId,
    name: asCopy ? `${summary.name} copy` : summary.name,
    onProgress: progress.install,
  });

  // A copy is a new project with no cloud row of its own. Only the in-place
  // restore inherits the link, and it inherits the remote's `updated` too, so
  // the next save from this device is not immediately a conflict with itself.
  if (!asCopy) await putCloudLink(localId, accountId, summary, []);
  return project;
}

/**
 * Open a project somebody shared by link.
 *
 * Always a copy, always under a new local id, and never linked to the cloud row:
 * the recipient did not save this and must not be offered an overwrite of
 * somebody else's project. Works signed out, which is the point of a link.
 */
export async function openSharedProject(
  slug: string,
  onProgress?: ProgressFn
): Promise<Project> {
  const summary = await cloudApi.getShared(slug);
  if (!summary) throw new CloudRequestError('That link is not valid any more.', 404);

  const progress = splitProgress(onProgress);
  const bundle = normalize(
    await fetchBundle(
      summary,
      {
        doc: () => cloudApi.fetchSharedDoc(slug),
        asset: (assetId) => cloudApi.fetchSharedAsset(slug, assetId),
      },
      progress.download
    )
  );

  return importBundle(bundle, {
    projectId: newLocalProjectId(),
    name: summary.name,
    onProgress: progress.install,
  });
}

// ---------------------------------------------------------------------------
// listing, deleting, sharing
// ---------------------------------------------------------------------------

export async function listCloudProjects(): Promise<{ projects: CloudProject[]; limit: number }> {
  return cloudApi.listProjects();
}

export async function deleteCloudProject(recordId: string): Promise<void> {
  await cloudApi.deleteProject(recordId);
  await deleteCloudLinkByRecord(recordId);
}

/**
 * Turn the shareable link on or off, and remember which.
 *
 * Turning it on always produces a NEW slug, including when it was already on.
 * That is the server's decision and it is the right one: "stop sharing" has to
 * be final, so a revoked URL can never be reissued.
 */
export async function setCloudProjectShared(
  recordId: string,
  localProjectId: string | null,
  on: boolean
): Promise<{ visibility: CloudVisibility; shareSlug: string; updated: string; url: string }> {
  const result = await cloudApi.setShared(recordId, on);
  if (localProjectId) {
    await setCloudLinkSharing(localProjectId, result.visibility, result.shareSlug, result.updated);
  }
  return { ...result, url: result.shareSlug ? buildShareUrl(result.shareSlug) : '' };
}

/**
 * The URL a person copies.
 *
 * Built from where the editor is actually running rather than from a configured
 * origin: the same build serves editor.openscrgen.app, a GitHub Pages sub-path
 * and localhost, and a link that always pointed at production would be wrong on
 * two of the three.
 */
export function buildShareUrl(slug: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${BASE_PATH}/?shared=${encodeURIComponent(slug)}`;
}

/** The `?shared=` slug on the current URL, if there is one. */
export function readSharedSlugFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const slug = new URLSearchParams(window.location.search).get('shared');
  return slug && /^[a-z0-9]{22}$/.test(slug) ? slug : null;
}

/** Take `?shared=` back off the URL once it has been acted on. */
export function clearSharedSlugFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('shared')) return;
  url.searchParams.delete('shared');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
