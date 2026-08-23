/**
 * The upload set, remembered.
 *
 * Re-uploading the same five screenshots because you closed a dialog is the
 * kind of small insult that makes a tool feel disposable. The set the user last
 * brought in survives a reload, a crash and a week away, and the flow offers it
 * back instead of showing an empty drop zone to somebody who has already done
 * the work.
 *
 * The blobs are NOT this module's to own. Every intake shot is already stored
 * once in the Dexie media table by intakeAssets.ts, under the same `asset_`
 * prefix every other editor upload uses, and a project built from that set
 * references those exact rows. So all this keeps is a manifest: which asset
 * ids, in which order, with the analysis already computed. That is small enough
 * for localStorage and means recalling a set costs one read and no second copy
 * of anything.
 */

import { db } from '@/database';
import { ASSET_REF_PREFIX } from '@/lib/mediaStore';
import { readScreenshotFile } from '@/lib/ai/imageUtils';
import type { ShotAnalysis } from './screenshotAnalysis';
import type { PersistedShot } from './intakeAssets';

const MANIFEST_KEY = 'osg.intake.lastSet.v1';

interface ManifestEntry {
  id: string;
  /** Media row id, the same one a saved project's frames point at. */
  assetId: string;
  fileName: string;
  width: number;
  height: number;
  byteLength: number;
  analysis: ShotAnalysis;
}

interface Manifest {
  savedAt: string;
  /** App name the user typed last time, if any. */
  appName?: string;
  entries: ManifestEntry[];
}

function readManifest(): Manifest | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Manifest;
    return Array.isArray(parsed?.entries) && parsed.entries.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeManifest(manifest: Manifest | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (manifest) localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
    else localStorage.removeItem(MANIFEST_KEY);
  } catch {
    // A full or disabled store just means the set is not remembered.
  }
}

/** How many shots the last set holds, without decoding any of them. */
export function peekRememberedCount(): number {
  return readManifest()?.entries.length ?? 0;
}

/** The app name from the last session, for prefilling the details field. */
export function peekRememberedAppName(): string {
  return readManifest()?.appName ?? '';
}

/** When the remembered set was saved, or null when there is none. */
export function peekRememberedAt(): Date | null {
  const savedAt = readManifest()?.savedAt;
  if (!savedAt) return null;
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Replace the remembered set.
 *
 * Pure bookkeeping: the rows already exist, so this writes one small JSON
 * string and touches no blobs at all. A shot that failed to persist (its bytes
 * are still inline) is skipped rather than inlined into localStorage, which
 * would blow the quota on the first screenshot.
 */
export async function rememberIntake(shots: PersistedShot[], appName?: string): Promise<void> {
  const entries: ManifestEntry[] = shots
    .filter((shot) => !!shot.assetId)
    .map((shot) => ({
      id: shot.id,
      assetId: shot.assetId as string,
      fileName: shot.fileName,
      width: shot.width,
      height: shot.height,
      byteLength: shot.byteLength,
      analysis: shot.analysis,
    }));

  writeManifest(
    entries.length > 0
      ? { savedAt: new Date().toISOString(), appName: appName?.trim() || undefined, entries }
      : null
  );
}

/**
 * Rebuild the remembered set.
 *
 * The stored blob is re-read through `readScreenshotFile` rather than turned
 * straight into a data URL, because a shot needs BOTH of its forms: the
 * reference for placement and a genuinely downscaled `aiDataUrl` for the model.
 * Handing a model the full-resolution copy under that name is how you blow
 * every provider's per-image cap on the first request.
 *
 * Any entry whose row has gone (cleared site data) is dropped, and a set that
 * loses everything clears the manifest so the offer stops being made.
 */
export async function recallIntake(): Promise<PersistedShot[]> {
  const manifest = readManifest();
  if (!manifest) return [];

  const shots: PersistedShot[] = [];
  for (const entry of manifest.entries) {
    try {
      const row = await db.media.get(entry.assetId);
      if (!row) continue;
      const file = new File([row.blob], entry.fileName, { type: row.mimeType || 'image/png' });
      const decoded = await readScreenshotFile(file);
      shots.push({
        ...decoded,
        id: entry.id,
        fileName: entry.fileName,
        // The reference, not the re-encoded copy: the row is already here.
        dataUrl: `${ASSET_REF_PREFIX}${entry.assetId}`,
        assetId: entry.assetId,
        width: entry.width,
        height: entry.height,
        analysis: entry.analysis,
        byteLength: entry.byteLength,
      });
    } catch {
      // One unreadable row should not lose the rest of the set.
    }
  }

  if (shots.length === 0) writeManifest(null);
  return shots;
}

/**
 * Stop offering the remembered set.
 *
 * Clears the manifest and NOTHING else. The media rows behind it are ordinary
 * `asset_` rows: a project the user created from this set points its device
 * frames straight at them, so deleting them here would blank the screenshots in
 * a saved project. That is also why they show up in the reusable image library,
 * which is correct, they are the user's own images and every other upload in
 * the editor behaves the same way.
 *
 * Nothing in this app garbage-collects the media table today (`deleteMedia` has
 * no callers and `deleteImageAsset` is reachable only through MCP), so leaving
 * the rows is consistent with every other upload path rather than a new leak.
 */
export async function forgetIntake(): Promise<void> {
  writeManifest(null);
}
