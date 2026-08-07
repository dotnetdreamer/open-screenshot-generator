// Blob storage for large media behind the App Preview video feature and the
// Uploads image library. Blobs live in the Dexie `media` table; elements store
// only the row id (recordings) or a data URL minted on use (uploaded images).
// This module owns the id -> objectURL cache so every consumer (canvas
// <video>, upload thumbnails, the export engine) shares one URL per asset
// instead of leaking a new objectURL per render.

import { useEffect, useState } from 'react';
import { db } from '@/database';

export interface MediaAsset {
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
  // What the blob holds. Non-indexed on purpose: Dexie only needs a version
  // bump for schema (index) changes, and a plain field keeps old rows valid —
  // recordings and MCP assets saved before this field existed simply have no
  // `kind` and are treated as videos / hidden from the Uploads library.
  kind?: 'image' | 'video';
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

/** Read an image blob's natural dimensions via a throwaway <img>. */
export function probeImageBlob(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      const result = { width: img.naturalWidth, height: img.naturalHeight };
      cleanup();
      resolve(result);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Could not read this image file. Use a PNG, JPEG, WebP, GIF or SVG.'));
    };
    img.src = url;
  });
}

/**
 * Store a recording or an uploaded image and return its media id (plus the
 * probed metadata). Images are probed for dimensions only, so `duration` is 0
 * for them; the video path is byte-for-byte the recording flow it always was.
 */
export async function saveMedia(
  file: Blob,
  name: string
): Promise<{ id: string; probe: VideoProbeResult }> {
  const isImage = file.type.startsWith('image/');
  const probe: VideoProbeResult = isImage
    ? { ...(await probeImageBlob(file)), duration: 0 }
    : await probeVideoBlob(file);
  const id = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const asset: MediaAsset = {
    id,
    blob: file,
    name,
    mimeType: file.type || (isImage ? 'image/png' : 'video/mp4'),
    kind: isImage ? 'image' : 'video',
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
 * Every user-uploaded image, newest first — the Uploads palette library.
 * Recordings (kind 'video') and MCP agent assets (no kind, `asset_` ids) are
 * excluded: neither is user-managed library content.
 */
export async function listUploadedImages(): Promise<MediaAsset[]> {
  const rows = await db.media.toArray();
  return rows
    .filter((row) => row.kind === 'image')
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

/** Rename a stored asset (the Uploads panel's inline rename). */
export async function renameMedia(id: string, name: string): Promise<void> {
  await db.media.update(id, { name });
}

/**
 * Read a stored blob out as a data URL, or null when the row is gone.
 * Uploads mint image element sources this way so the project row keeps
 * serializing to plain data URLs; callers should cache the result per
 * interaction rather than hold one per tile (a data URL duplicates the blob
 * in memory as a base64 string).
 */
export async function getMediaDataUrl(id: string): Promise<string | null> {
  const asset = await db.media.get(id);
  if (!asset) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the stored image.'));
    reader.readAsDataURL(asset.blob);
  });
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
