// One-way sweep of inline base64 media OUT of project state (issue #19).
//
// Projects saved before the memory fix carry uploaded screenshots, images and
// even demo recordings as base64 data URLs inside element props. Every undo
// snapshot, autosave write and recent-projects fetch then duplicates those
// megabytes, which is what walked the macOS WKWebView process into its memory
// ceiling. This module moves the bytes into the Dexie `media` table on load
// and leaves an `asset:<id>` reference (images) or a `mediaId` (recordings)
// behind — the same references new uploads produce.
//
// Runs on every project load, like migrateVideoDevices: cheap when there is
// nothing to convert (a string prefix check per prop) and returns the input
// array by reference in that case. Failures keep the inline original — a
// project must never lose an image to a migration.

import type { ArtboardState, ArtboardElement } from '@/types/artboard';
import { saveImageBlobAsset } from '@/lib/mcp/assetStore';
import { saveMedia } from '@/lib/mediaStore';

/** Element/override props that can carry an inline image. */
const IMAGE_KEYS = ['imageSrc', 'screenshotSrc', 'customFrameSrc', 'posterSrc'] as const;

/** The board's own props that can carry one. */
const BOARD_IMAGE_KEYS = ['backgroundImage'] as const;

/**
 * Data URLs at or under this length stay inline: a tiny SVG icon costs less
 * as a string than as a blob row plus an object URL, and history duplicating
 * it is harmless.
 */
const INLINE_LIMIT = 2048;

function isInlineImage(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:') && value.length > INLINE_LIMIT;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

/**
 * Externalize the image props of one element or locale-override record.
 * Returns a replacement record, or null when nothing needed converting.
 */
async function externalizeImageKeys(
  record: Record<string, unknown>,
  name: string,
  keys: readonly string[] = IMAGE_KEYS
): Promise<Record<string, unknown> | null> {
  let out: Record<string, unknown> | null = null;
  for (const key of keys) {
    const value = record[key];
    if (!isInlineImage(value)) continue;
    try {
      const blob = await dataUrlToBlob(value);
      const asset = await saveImageBlobAsset(blob, { name: `${name}-${key}`, strict: false });
      out = out ?? { ...record };
      out[key] = asset.ref;
    } catch (error) {
      console.error(`Could not externalize ${key}; keeping it inline.`, error);
    }
  }
  return out;
}

/** Externalize one element: image props plus an inline data: recording. */
async function externalizeElement(el: ArtboardElement): Promise<ArtboardElement | null> {
  const record = el as unknown as Record<string, unknown>;
  let out = await externalizeImageKeys(record, el.type);

  // Recordings embedded as data: URLs (template demo clips, MCP-supplied
  // footage) move into the media table exactly like an uploaded recording.
  const videoSrc = record.videoSrc;
  if (
    (el.type === 'video' || el.type === 'video-device') &&
    !record.mediaId &&
    typeof videoSrc === 'string' &&
    videoSrc.startsWith('data:')
  ) {
    try {
      const blob = await dataUrlToBlob(videoSrc);
      const { id, probe } = await saveMedia(blob, `${el.type}-migrated`);
      out = out ?? { ...record };
      out.mediaId = id;
      out.videoSrc = undefined;
      if (out.durationSeconds === undefined) out.durationSeconds = probe.duration;
      if (out.naturalVideoWidth === undefined) out.naturalVideoWidth = probe.width;
      if (out.naturalVideoHeight === undefined) out.naturalVideoHeight = probe.height;
    } catch (error) {
      console.error('Could not externalize an inline recording; keeping it inline.', error);
    }
  }

  return out as ArtboardElement | null;
}

/**
 * Sweep inline media out of every element and locale override.
 * Returns the input array by reference when nothing changed.
 */
export async function externalizeInlineMedia(artboards: ArtboardState[]): Promise<ArtboardState[]> {
  let changed = false;
  const next: ArtboardState[] = [];

  for (const artboard of artboards ?? []) {
    let boardChanged = false;

    // The board's own background picture, which is not on any element.
    const board = await externalizeImageKeys(
      artboard as unknown as Record<string, unknown>,
      `${artboard.id}-board`,
      BOARD_IMAGE_KEYS
    );
    if (board) boardChanged = true;

    const elements: ArtboardElement[] = [];
    for (const el of artboard.elements ?? []) {
      const migrated = await externalizeElement(el);
      elements.push(migrated ?? el);
      if (migrated) boardChanged = true;
    }

    // Locale overrides can hold per-language screenshots/images too
    // (localized[locale][elementId].screenshotSrc — see src/lib/i18n).
    let localized = artboard.localized;
    if (localized) {
      let locChanged = false;
      const nextLocalized: typeof localized = {};
      for (const [locale, byElement] of Object.entries(localized)) {
        let elChanged = false;
        const nextByElement: typeof byElement = {};
        for (const [elementId, override] of Object.entries(byElement ?? {})) {
          if (!override) continue;
          const migrated = await externalizeImageKeys(
            override as unknown as Record<string, unknown>,
            `${locale}-override`
          );
          nextByElement[elementId] = (migrated as typeof override) ?? override;
          if (migrated) elChanged = true;
        }
        nextLocalized[locale] = elChanged ? nextByElement : byElement;
        if (elChanged) locChanged = true;
      }
      if (locChanged) {
        localized = nextLocalized;
        boardChanged = true;
      }
    }

    next.push(
      boardChanged
        ? ({ ...artboard, ...(board ?? {}), elements, localized } as ArtboardState)
        : artboard
    );
    if (boardChanged) changed = true;
  }

  return changed ? next : artboards;
}
