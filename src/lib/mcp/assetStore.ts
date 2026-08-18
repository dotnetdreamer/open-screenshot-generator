// Reusable image assets: the blob side of `asset:<id>` references.
//
// Originally built for the MCP tools (sending the same 250KB app icon as a
// data URL on every add_element was the single most expensive thing an agent
// did over that server); since the issue #19 memory work the SAME references
// are what editor uploads produce and what elements hold in imageSrc /
// screenshotSrc / customFrameSrc / posterSrc. Renderers resolve them through
// useImageSrc (src/lib/mediaStore.ts) and the export bundle carries the blobs
// (src/lib/account/projectBundle.ts), so a reference never has to be expanded
// back into base64 inside project state — which is exactly what made undo
// history, autosave and the recent-projects list balloon into the WKWebView
// memory ceiling.
//
// Storage is the Dexie `media` table — the same place App Preview recordings
// live — because it holds Blobs natively instead of re-serialising base64 into
// the project row.

import { db } from '@/database';
import { ASSET_REF_PREFIX, isAssetRef, assetIdFromRef, type MediaAsset } from '@/lib/mediaStore';

export { ASSET_REF_PREFIX, isAssetRef } from '@/lib/mediaStore';
const ASSET_ID_PREFIX = 'asset_';

export interface StoredAsset {
  assetId: string;
  name: string;
  mimeType: string;
  width?: number;
  height?: number;
  /** Size of the stored blob in bytes. */
  bytes: number;
  createdAt: string;
  /** Pass this wherever an image source is expected. */
  ref: string;
}

function summarize(row: MediaAsset): StoredAsset {
  return {
    assetId: row.id,
    name: row.name,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    bytes: row.blob.size,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
    ref: `${ASSET_REF_PREFIX}${row.id}`,
  };
}

/** Natural pixel size of an image blob; zeroes when it cannot be decoded. */
function probeImageBlob(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const done = (width: number, height: number) => {
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    img.onload = () => done(img.naturalWidth, img.naturalHeight);
    img.onerror = () => done(0, 0);
    img.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the stored asset.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Store an image blob and return its reference. This is what the editor's own
 * upload buttons call (they hold a File already), and what saveImageAsset and
 * the load-time migration (src/lib/externalizeInlineMedia.ts) build on.
 * `strict: false` skips the must-decode check — the migration must never throw
 * away a user's image just because a dimension probe failed (e.g. an SVG with
 * no intrinsic size).
 */
export async function saveImageBlobAsset(
  blob: Blob,
  options: { name?: string; mimeType?: string; strict?: boolean } = {}
): Promise<StoredAsset> {
  if (blob.size === 0) throw new Error('That image was empty.');
  const { width, height } = await probeImageBlob(blob);
  if (width === 0 && height === 0 && options.strict !== false) {
    throw new Error('That data did not decode as an image (PNG, JPEG, WebP, GIF or SVG).');
  }

  const id = `${ASSET_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const row: MediaAsset = {
    id,
    blob,
    name: options.name?.trim() || `asset-${id.slice(ASSET_ID_PREFIX.length)}`,
    mimeType: blob.type || options.mimeType || 'image/png',
    width: width || undefined,
    height: height || undefined,
    createdAt: new Date(),
  };
  await db.media.put(row);
  return summarize(row);
}

/**
 * Store an image and return its reference.
 * `source` is a data: URL, an http(s) URL the app can fetch, or bare base64
 * (in which case pass mimeType).
 */
export async function saveImageAsset(
  source: string,
  options: { name?: string; mimeType?: string } = {}
): Promise<StoredAsset> {
  const trimmed = source.trim();
  if (!trimmed) throw new Error('upload_asset needs a data: URL, an image URL, or base64 data.');

  let blob: Blob;
  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed);
    if (!response.ok) throw new Error(`Could not fetch that image (HTTP ${response.status}).`);
    blob = await response.blob();
  } else {
    // Bare base64: rebuild the data URL so the browser does the decoding.
    const mime = options.mimeType || 'image/png';
    const response = await fetch(`data:${mime};base64,${trimmed.replace(/\s+/g, '')}`);
    blob = await response.blob();
  }

  return saveImageBlobAsset(blob, options);
}

/** Every uploaded image asset, newest first. */
export async function listImageAssets(): Promise<StoredAsset[]> {
  const rows = await db.media.toArray();
  return rows
    .filter((row) => row.id.startsWith(ASSET_ID_PREFIX))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(summarize);
}

export async function deleteImageAsset(assetId: string): Promise<boolean> {
  const id = assetId.startsWith(ASSET_REF_PREFIX) ? assetId.slice(ASSET_REF_PREFIX.length) : assetId;
  const row = await db.media.get(id);
  if (!row || !row.id.startsWith(ASSET_ID_PREFIX)) return false;
  await db.media.delete(id);
  return true;
}

/** Resolve one `asset:<id>` reference to a data URL, for callers that must
 * hand the bytes somewhere the reference cannot follow (nothing in the app
 * itself: elements hold the reference and renderers resolve it to an object
 * URL via useImageSrc). */
export async function resolveAssetRef(ref: string): Promise<string> {
  const id = assetIdFromRef(ref);
  const row = await db.media.get(id);
  if (!row) throw new Error(`No asset "${id}". Call list_assets, or upload it again with upload_asset.`);
  return blobToDataUrl(row.blob);
}

/** Every element prop that can carry an image source. */
const IMAGE_SOURCE_PROPS = ['imageSrc', 'screenshotSrc', 'customFrameSrc', 'posterSrc', 'src'] as const;

/**
 * Check that every `asset:<id>` image source in a props bag points at a real
 * media row, so a typo'd reference fails the tool call with a useful message
 * instead of rendering an empty element. References are kept as-is — elements
 * hold them and renderers resolve them at draw time (src/lib/mediaStore.ts),
 * which is what keeps multi-MB base64 out of project state, undo history and
 * autosave (issue #19).
 */
export async function validateAssetProps(
  props: Record<string, unknown>
): Promise<Record<string, unknown>> {
  for (const key of IMAGE_SOURCE_PROPS) {
    const value = props[key];
    if (!isAssetRef(value)) continue;
    const id = assetIdFromRef(value);
    const row = await db.media.get(id);
    if (!row) {
      throw new Error(`No asset "${id}" for ${key}. Call list_assets, or upload it again with upload_asset.`);
    }
  }
  return props;
}
