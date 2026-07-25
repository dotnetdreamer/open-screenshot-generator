// Turning a stored project into something portable, and back again.
//
// A project row in Dexie is only half the document: screen recordings live in
// the separate `media` table and elements point at them by id (see
// src/lib/mediaStore.ts). Serializing just the row is what the old JSON export
// did, which is why moving a project to another machine left video elements
// blank. Everything here carries the blobs along.
//
// Two shapes come out of the same bundle:
//   - Drive: manifest as project.json + one file per blob (no size ceiling).
//   - A single local .json file: blobs inlined as base64, so an export stays
//     one file and we avoid pulling in a zip dependency.

import { db } from '@/database';
import type { Project, ArtboardState } from '@/types/artboard';
import type {
  BundledMedia,
  BundledMediaMeta,
  ProjectBundle,
  ProjectManifest,
  ProgressFn,
} from './types';

/** Element fields that hold a Dexie media row id, including the legacy one. */
const MEDIA_ID_KEYS = ['mediaId', 'screenVideoMediaId'] as const;

/**
 * Every media row the project references. Walks elements generically rather
 * than narrowing by element type so legacy `screenVideoMediaId` devices (see
 * src/lib/video/migrateVideoDevices.ts) are picked up too.
 */
export function collectMediaIds(projectData: ArtboardState[]): string[] {
  const ids = new Set<string>();
  for (const artboard of projectData ?? []) {
    for (const element of artboard.elements ?? []) {
      const record = element as unknown as Record<string, unknown>;
      for (const key of MEDIA_ID_KEYS) {
        const value = record[key];
        if (typeof value === 'string' && value) ids.add(value);
      }
    }
  }
  return [...ids];
}

/** Read the project row + its blobs out of Dexie. */
export async function serializeProject(
  project: Project,
  onProgress?: ProgressFn
): Promise<ProjectBundle> {
  const mediaIds = collectMediaIds(project.projectData);
  const media: BundledMedia[] = [];

  for (const [index, id] of mediaIds.entries()) {
    onProgress?.(`Reading media ${index + 1} of ${mediaIds.length}`, index / mediaIds.length);
    const asset = await db.media.get(id);
    // A missing row means the blob was cleared (site data wiped) while the
    // element kept pointing at it. Skip rather than fail the whole save.
    if (!asset) continue;
    media.push({
      meta: {
        id: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
        createdAt: toIso(asset.createdAt),
        size: asset.blob.size,
      },
      blob: asset.blob,
    });
  }

  const manifest: ProjectManifest = {
    formatVersion: 1,
    id: project.id,
    name: project.name,
    timestamp: toIso(project.timestamp),
    projectData: project.projectData,
    media: media.map((m) => m.meta),
  };

  return { manifest, media };
}

/**
 * Write a bundle into Dexie and return the project row.
 * Blobs are restored under their original ids so element references resolve
 * without rewriting the document.
 */
export async function importBundle(
  bundle: ProjectBundle,
  options: { projectId?: string; name?: string } = {}
): Promise<Project> {
  for (const item of bundle.media) {
    // Keep whatever is already there: a same-id row is the same recording, and
    // rewriting it would churn a potentially huge blob for nothing.
    const existing = await db.media.get(item.meta.id);
    if (existing) continue;
    await db.media.put({
      id: item.meta.id,
      blob: item.blob,
      name: item.meta.name,
      mimeType: item.meta.mimeType,
      width: item.meta.width,
      height: item.meta.height,
      duration: item.meta.duration,
      createdAt: fromIso(item.meta.createdAt),
    });
  }

  const project: Project = {
    id: options.projectId ?? bundle.manifest.id,
    name: options.name ?? bundle.manifest.name ?? 'Untitled project',
    timestamp: new Date(),
    // Deep copy so the caller's in-memory canvas state never aliases the row.
    projectData: JSON.parse(JSON.stringify(bundle.manifest.projectData)),
  };
  await db.projects.put(project);
  return project;
}

// --- single-file JSON (local export/import) ---------------------------------

/** Manifest plus base64 blobs, for the one-file local export. */
interface InlineBundleFile extends ProjectManifest {
  /** base64 payloads keyed by media id. Absent when the project has no media. */
  mediaData?: Record<string, string>;
}

export async function bundleToJson(
  bundle: ProjectBundle,
  onProgress?: ProgressFn
): Promise<string> {
  const mediaData: Record<string, string> = {};
  for (const [index, item] of bundle.media.entries()) {
    onProgress?.(`Encoding media ${index + 1} of ${bundle.media.length}`, index / bundle.media.length);
    mediaData[item.meta.id] = await blobToBase64(item.blob);
  }
  const file: InlineBundleFile = {
    ...bundle.manifest,
    ...(bundle.media.length ? { mediaData } : {}),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Parse an exported file back into a bundle.
 * Accepts the pre-bundle export too (`{ id, timestamp, projectData }`, no
 * media), so files people already have on disk keep importing.
 */
export function bundleFromJson(parsed: unknown): ProjectBundle {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('This file is not a Open Screenshot Generator project.');
  }
  const file = parsed as Partial<InlineBundleFile> & { projectData?: unknown };
  if (!Array.isArray(file.projectData)) {
    throw new Error('This file is missing its artboard data.');
  }

  const metas = Array.isArray(file.media) ? file.media : [];
  const media: BundledMedia[] = [];
  for (const meta of metas) {
    const encoded = file.mediaData?.[meta.id];
    if (!encoded) continue; // metadata without payload: nothing to restore
    media.push({ meta, blob: base64ToBlob(encoded, meta.mimeType) });
  }

  return {
    manifest: {
      formatVersion: 1,
      id: typeof file.id === 'string' ? file.id : `project_${Date.now()}`,
      name: typeof file.name === 'string' ? file.name : 'Imported project',
      timestamp: typeof file.timestamp === 'string' ? file.timestamp : new Date().toISOString(),
      projectData: file.projectData as ArtboardState[],
      media: metas,
    },
    media,
  };
}

/** Total bytes of media, for the "this is big" warnings. */
export function mediaBytes(bundle: ProjectBundle): number {
  return bundle.media.reduce((sum, item) => sum + item.blob.size, 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- helpers ----------------------------------------------------------------

function toIso(value: Date | string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function fromIso(value: string): Date {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** Blob -> base64 (no data: prefix). FileReader keeps big blobs off the stack. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read media data.'));
    reader.readAsDataURL(blob);
  });
}

/** base64 -> Blob, decoded in chunks so a 100MB recording does not blow the stack. */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const chunkSize = 64 * 1024;
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i);
    parts.push(bytes);
  }
  return new Blob(parts, { type: mimeType || 'application/octet-stream' });
}
