// Blob storage for large media (screen recordings) behind the App Preview
// video feature. Blobs live in the Dexie `media` table; elements store only
// the row id. This module owns the id -> objectURL cache so every consumer
// (canvas <video>, the export engine) shares one URL per asset instead of
// leaking a new objectURL per render.

import { useEffect, useState } from 'react';
import { db } from '@/database';

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
