// Blob storage for large media behind the App Preview video feature and, since
// the issue #19 memory work, uploaded images too. Blobs live in the Dexie
// `media` table; elements store only a reference (video: a `mediaId` field,
// images: an `asset:<id>` string in their src prop). This module owns the
// id -> objectURL cache so every consumer (canvas <video>/<img>, the export
// engine) shares one URL per asset instead of leaking a new objectURL per
// render.

import { useEffect, useState } from 'react';
import { db } from '@/database';

/**
 * Prefix that marks an element image source (imageSrc, screenshotSrc,
 * customFrameSrc, posterSrc) as a reference into the media table instead of a
 * URL that carries the bytes itself. Same scheme the MCP upload_asset tool
 * hands out, so an agent-supplied ref and an editor upload are the same thing.
 */
export const ASSET_REF_PREFIX = 'asset:';

/** True for a string that references the media table rather than holding image data. */
export function isAssetRef(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith(ASSET_REF_PREFIX);
}

/** The media-table row id inside an `asset:<id>` reference. */
export function assetIdFromRef(ref: string): string {
  return ref.trim().slice(ASSET_REF_PREFIX.length);
}

export interface MediaAsset {
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
  width?: number;
  height?: number;
  duration?: number; // seconds
  createdAt: Date;
}

export interface VideoProbeResult {
  width: number;
  height: number;
  duration: number; // seconds
}

const urlCache = new Map<string, string>();

/** Read a video blob's dimensions and duration via a throwaway <video>. */
export function probeVideoBlob(blob: Blob): Promise<VideoProbeResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    video.onloadedmetadata = () => {
      const result = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      };
      cleanup();
      resolve(result);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Could not read this video file. Use an MP4, MOV or WebM recording.'));
    };
    video.src = url;
  });
}

/** Store a recording and return its media id (plus the probed metadata). */
export async function saveMedia(
  file: Blob,
  name: string
): Promise<{ id: string; probe: VideoProbeResult }> {
  const probe = await probeVideoBlob(file);
  const id = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const asset: MediaAsset = {
    id,
    blob: file,
    name,
    mimeType: file.type || 'video/mp4',
    width: probe.width,
    height: probe.height,
    duration: probe.duration,
    createdAt: new Date(),
  };
  await db.media.put(asset);
  return { id, probe };
}

export async function getMediaAsset(id: string): Promise<MediaAsset | undefined> {
  return db.media.get(id);
}

/**
 * Object URL for a stored media row, cached per id for the session.
 * Returns null when the row is gone (e.g. cleared site data).
 */
export async function getMediaUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const asset = await db.media.get(id);
  if (!asset) return null;
  const url = URL.createObjectURL(asset.blob);
  // Another caller may have raced us; keep the first minted URL.
  const winner = urlCache.get(id);
  if (winner) {
    URL.revokeObjectURL(url);
    return winner;
  }
  urlCache.set(id, url);
  return url;
}

export async function deleteMedia(id: string): Promise<void> {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
  await db.media.delete(id);
}

/**
 * React hook: resolve a media id to a playable object URL.
 * Returns undefined while loading, null when the asset is missing.
 */
export function useMediaUrl(mediaId: string | undefined): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(mediaId ? undefined : null);
  useEffect(() => {
    let cancelled = false;
    if (!mediaId) {
      setUrl(null);
      return;
    }
    setUrl(undefined);
    getMediaUrl(mediaId).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);
  return url;
}

/**
 * React hook: resolve an element image source to something an <img> can show.
 * `asset:<id>` references become a cached object URL over the Dexie blob;
 * every other shape (public path, http(s), data:) passes through untouched.
 * Returns undefined while a reference is still resolving, and also when the
 * referenced row is gone (cleared site data) — the element then shows its
 * empty-state placeholder, mirroring how a missing recording renders.
 */
export function useImageSrc(src: string | undefined): string | undefined {
  const assetId = isAssetRef(src) ? assetIdFromRef(src) : undefined;
  const mediaUrl = useMediaUrl(assetId);
  if (!assetId) return src;
  return mediaUrl ?? undefined;
}
