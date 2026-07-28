// Reusable image assets for the MCP tools.
//
// Sending the same 250KB app icon (or a 500KB screenshot) as a data URL on
// every add_element is the single most expensive thing an agent does over this
// server. upload_asset registers the bytes once and hands back an
// `asset:<id>` reference that add_element / update_element / add_elements
// accept anywhere an image source is taken.
//
// Storage is the Dexie `media` table — the same place App Preview recordings
// live — because it holds Blobs natively instead of re-serialising base64 into
// the project row. Note the reference is resolved back to a data URL *when the
// element is built*, so the artboard itself is unchanged from a hand-written
// one: the saving is on the wire and in the conversation, not in the saved
// project. (Making elements hold the id would mean teaching every renderer and
// both exporters about it.)

import { db } from '@/database';
import type { MediaAsset } from '@/lib/mediaStore';

/** Prefix that marks an image source as a reference into this store. */
export const ASSET_REF_PREFIX = 'asset:';
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

  if (blob.size === 0) throw new Error('That image was empty.');
  const { width, height } = await probeImageBlob(blob);
  if (width === 0 && height === 0) {
    throw new Error('That data did not decode as an image (PNG, JPEG, WebP, GIF or SVG).');
  }

  const id = `${ASSET_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const row: MediaAsset = {
    id,
    blob,
    name: options.name?.trim() || `asset-${id.slice(ASSET_ID_PREFIX.length)}`,
    mimeType: blob.type || options.mimeType || 'image/png',
    width,
    height,
    createdAt: new Date(),
  };
  await db.media.put(row);
  return summarize(row);
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

/** True for a string that points at this store rather than carrying image bytes. */
export function isAssetRef(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith(ASSET_REF_PREFIX);
}

/** Resolve one `asset:<id>` reference to the data URL an element can hold. */
export async function resolveAssetRef(ref: string): Promise<string> {
  const id = ref.trim().slice(ASSET_REF_PREFIX.length);
  const row = await db.media.get(id);
  if (!row) throw new Error(`No asset "${id}". Call list_assets, or upload it again with upload_asset.`);
  return blobToDataUrl(row.blob);
}

/** Every element prop that can carry an image source. */
const IMAGE_SOURCE_PROPS = ['imageSrc', 'screenshotSrc', 'customFrameSrc', 'posterSrc', 'src'] as const;

/**
 * Expand any `asset:<id>` image sources in a props bag. Returns a new object;
 * props that are not references are passed through untouched.
 */
export async function resolveAssetProps(
  props: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const refs = IMAGE_SOURCE_PROPS.filter((key) => isAssetRef(props[key]));
  if (refs.length === 0) return props;
  const resolved = { ...props };
  for (const key of refs) {
    resolved[key] = await resolveAssetRef(props[key] as string);
  }
  return resolved;
}
