// Turning a stored project into something portable, and back again.
//
// A project row in Dexie is only part of the document. Two other tables hold
// things elements only reference:
//   - screen recordings in `media`, pointed at by row id (src/lib/mediaStore.ts)
//   - imported fonts in `fonts`, pointed at by family name
//     (src/services/customFonts.ts)
// Serializing just the row is what the old JSON export did, which is why moving
// a project to another machine left video elements blank. Everything here
// carries the binaries along.
//
// Two shapes come out of the same bundle:
//   - Drive: manifest as project.json + one file per blob (no size ceiling).
//   - A single local .json file: blobs inlined as base64, so an export stays
//     one file and we avoid pulling in a zip dependency.

import { db } from '@/database';
import {
  getCustomFontRows,
  installCustomFont,
  type CustomFontFormat,
} from '@/services/customFonts';
import type { Project, ArtboardState } from '@/types/artboard';
import type {
  BundledFont,
  BundledFontMeta,
  BundledMedia,
  BundledMediaMeta,
  ProjectBundle,
  ProjectManifest,
  ProgressFn,
} from './types';

/** Element fields that hold a Dexie media row id, including the legacy one. */
const MEDIA_ID_KEYS = ['mediaId', 'screenVideoMediaId'] as const;

/**
 * Every locale override row on a board, flattened. The locale overlay stores a
 * per-language recording under `localized[locale][elementId].mediaId` and a
 * per-language typeface under `.fontFamily`, so both collectors below have to
 * walk it as well as the elements themselves. Miss it and a German screen
 * recording or an imported Arabic font is dropped from the bundle, which is
 * silent until the copy is reopened with a dead reference.
 */
function localeOverridesOf(artboard: ArtboardState): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const byElement of Object.values(artboard.localized ?? {})) {
    for (const override of Object.values(byElement ?? {})) {
      if (override) rows.push(override as unknown as Record<string, unknown>);
    }
  }
  return rows;
}

/**
 * Every media row the project references. Walks elements generically rather
 * than narrowing by element type so legacy `screenVideoMediaId` devices (see
 * src/lib/video/migrateVideoDevices.ts) are picked up too.
 */
export function collectMediaIds(projectData: ArtboardState[]): string[] {
  const ids = new Set<string>();
  const take = (record: Record<string, unknown>) => {
    for (const key of MEDIA_ID_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value) ids.add(value);
    }
  };
  for (const artboard of projectData ?? []) {
    for (const element of artboard.elements ?? []) {
      take(element as unknown as Record<string, unknown>);
    }
    for (const override of localeOverridesOf(artboard)) take(override);
  }
  return [...ids];
}

/**
 * Every font family the project's text elements ask for. Built-ins are in here
 * too; `getCustomFontRows` is what narrows it to the ones that need carrying.
 */
export function collectFontFamilies(projectData: ArtboardState[]): string[] {
  const families = new Set<string>();
  const take = (family: unknown) => {
    if (typeof family === 'string' && family.trim()) families.add(family.trim());
  };
  for (const artboard of projectData ?? []) {
    for (const element of artboard.elements ?? []) {
      if (element.type !== 'text') continue;
      take((element as { fontFamily?: unknown }).fontFamily);
    }
    // Not narrowed to text elements: an override row carries no type, and only
    // text elements can hold a fontFamily override in the first place.
    for (const override of localeOverridesOf(artboard)) take(override.fontFamily);
  }
  return [...families];
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

  onProgress?.('Reading fonts', 1);
  const fonts: BundledFont[] = (
    await getCustomFontRows(collectFontFamilies(project.projectData))
  ).map((row) => ({
    meta: {
      id: row.id,
      family: row.family,
      fileName: row.fileName,
      format: row.format,
      mimeType: row.mimeType,
      createdAt: toIso(row.createdAt),
      size: row.blob.size,
    },
    blob: row.blob,
  }));

  const manifest: ProjectManifest = {
    formatVersion: 1,
    id: project.id,
    name: project.name,
    timestamp: toIso(project.timestamp),
    projectData: project.projectData,
    media: media.map((m) => m.meta),
    // Left off entirely when unused, so a project on built-in fonts writes the
    // same file it wrote before fonts travelled.
    ...(fonts.length ? { fonts: fonts.map((f) => f.meta) } : {}),
  };

  return { manifest, media, fonts };
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
  for (const font of bundle.fonts ?? []) {
    try {
      await installCustomFont({
        id: font.meta.id,
        family: font.meta.family,
        fileName: font.meta.fileName,
        format: font.meta.format as CustomFontFormat,
        mimeType: font.meta.mimeType,
        size: font.meta.size,
        createdAt: fromIso(font.meta.createdAt),
        blob: font.blob,
      });
    } catch (error) {
      // One unreadable face must not cost the user the whole project. The text
      // falls back to the browser default, which is what would have happened
      // before fonts travelled at all.
      console.error(`Could not install the font "${font.meta.family}"`, error);
    }
  }

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
  /** base64 payloads keyed by font id. Absent when no font was imported. */
  fontData?: Record<string, string>;
}

/**
 * base64 font payloads keyed by id. Shared with the gist provider, which keeps
 * them in their own file rather than inline in the manifest.
 */
export async function encodeFontPayloads(fonts: BundledFont[]): Promise<Record<string, string>> {
  const payloads: Record<string, string> = {};
  for (const font of fonts) payloads[font.meta.id] = await blobToBase64(font.blob);
  return payloads;
}

/** Metadata plus payloads back into bundled fonts. A meta with no payload is dropped. */
export function decodeFontPayloads(
  metas: BundledFontMeta[] | undefined,
  payloads: Record<string, string> | undefined
): BundledFont[] {
  const fonts: BundledFont[] = [];
  for (const meta of metas ?? []) {
    const encoded = payloads?.[meta.id];
    if (!encoded) continue;
    fonts.push({ meta, blob: base64ToBlob(encoded, meta.mimeType) });
  }
  return fonts;
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
  if (bundle.fonts.length) onProgress?.('Encoding fonts', 1);
  const fontData = await encodeFontPayloads(bundle.fonts);
  const file: InlineBundleFile = {
    ...bundle.manifest,
    ...(bundle.media.length ? { mediaData } : {}),
    ...(bundle.fonts.length ? { fontData } : {}),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Parse an exported file back into a bundle.
 * Accepts every older shape, so files people already have on disk keep
 * importing: the pre-bundle export (`{ id, timestamp, projectData }`, no
 * media), and the pre-font one (media but no `fonts`/`fontData`).
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

  const fontMetas = Array.isArray(file.fonts) ? file.fonts : [];
  const fonts = decodeFontPayloads(fontMetas, file.fontData);

  return {
    manifest: {
      formatVersion: 1,
      id: typeof file.id === 'string' ? file.id : `project_${Date.now()}`,
      name: typeof file.name === 'string' ? file.name : 'Imported project',
      timestamp: typeof file.timestamp === 'string' ? file.timestamp : new Date().toISOString(),
      projectData: file.projectData as ArtboardState[],
      media: metas,
      ...(fontMetas.length ? { fonts: fontMetas } : {}),
    },
    media,
    fonts,
  };
}

/** Total bytes of media, for the "this is big" warnings. */
export function mediaBytes(bundle: ProjectBundle): number {
  return bundle.media.reduce((sum, item) => sum + item.blob.size, 0);
}

/** Total bytes of imported fonts. */
export function fontBytes(bundle: ProjectBundle): number {
  return bundle.fonts.reduce((sum, font) => sum + font.blob.size, 0);
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
