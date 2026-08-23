/**
 * One copy of each uploaded image, shared by every preview that shows it.
 *
 * This is the difference between the results deck working and the tab dying.
 *
 * A ranked deck renders the same five screenshots inside a dozen different
 * designs at once. Handed around as `data:` URLs, that is a dozen separate
 * strings the browser has to decode separately, each one a full-resolution PNG
 * up to 2796px on its long edge: tens of decodes and hundreds of megabytes of
 * bitmap for five files. Stored once in the Dexie media table and referenced as
 * `asset:<id>`, every one of those frames resolves through `useImageSrc` to the
 * SAME object URL, because `getMediaUrl` caches per id, so the browser holds
 * exactly one decoded copy per screenshot no matter how many cards are on
 * screen.
 *
 * It is also what makes the commit path free: `createProjectFromTemplateData`
 * runs `externalizeInlineMedia` before the first Dexie write to sweep inline
 * base64 out of project state, and a project whose frames already carry
 * references gives that sweep nothing to do.
 */

import { saveImageBlobAsset } from '@/lib/mcp/assetStore';
import { isAssetRef } from '@/lib/mediaStore';
import type { PlaceableShot } from './autoFill';
import type { IntakeShot } from './intakeFiles';

/** An intake shot whose bytes live in the media table. */
export interface PersistedShot extends IntakeShot {
  /**
   * `asset:<id>` once the blob is stored. Kept on the same field the AI intake
   * path uses, because the one consumer of it (applyScreenshot, which assigns
   * it to `screenshotSrc`) accepts a reference exactly as happily as a data
   * URL: DeviceFrameElement resolves both through useImageSrc.
   */
  dataUrl: string;
  /** The media row id behind `dataUrl`, when it was stored successfully. */
  assetId?: string;
}

export interface PersistResult {
  shots: PersistedShot[];
  /** File names whose blob could not be stored. Their bytes stay inline. */
  failed: string[];
}

/**
 * Move a batch of freshly decoded shots into the media table.
 *
 * Idempotent: a shot already carrying a reference is passed through untouched,
 * so re-running over a mixed set costs nothing. A single failure keeps that
 * shot's inline data URL rather than dropping the image, because a full disk
 * should cost the user a slower preview, not their upload.
 *
 * `aiDataUrl` is deliberately left alone. It is the 1024px JPEG every model
 * path reads, it is small, and it is what the thumbnails in the strip render.
 */
export async function persistIntakeShots(shots: IntakeShot[]): Promise<PersistResult> {
  const out: PersistedShot[] = [];
  const failed: string[] = [];

  for (const shot of shots) {
    if (isAssetRef(shot.dataUrl)) {
      out.push(shot as PersistedShot);
      continue;
    }
    try {
      const blob = await (await fetch(shot.dataUrl)).blob();
      const asset = await saveImageBlobAsset(blob, { name: shot.fileName, strict: false });
      out.push({ ...shot, dataUrl: asset.ref, assetId: asset.assetId });
    } catch (error) {
      console.warn(`Could not store ${shot.fileName}; keeping it inline.`, error);
      failed.push(shot.fileName);
      out.push(shot as PersistedShot);
    }
  }

  return { shots: out, failed };
}

/** The one place the fill's input is built, so no caller can shape it wrong. */
export function toPlaceable(shots: PersistedShot[]): PlaceableShot[] {
  return shots.map((shot) => ({
    id: shot.id,
    dataUrl: shot.dataUrl,
    width: shot.width,
    height: shot.height,
    device: shot.analysis.device,
  }));
}
