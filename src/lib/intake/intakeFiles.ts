/**
 * Getting images into the flow, by every route a person actually uses.
 *
 * A drop zone that only accepts a click and a flat file drag is the floor, not
 * the feature. People drag a folder straight out of their simulator's export,
 * they hit paste after a screen capture, they drag a group of files out of the
 * Finder in whatever order the Finder felt like. This module makes all of those
 * arrive in the right order, without duplicates, and without silently swallowing
 * the twentieth file.
 */

import { readScreenshotFile, type UploadedScreenshot } from '@/lib/ai/imageUtils';
import { analyzeScreenshot, type ShotAnalysis } from './screenshotAnalysis';

/** An uploaded image plus everything derived from it. */
export interface IntakeShot extends UploadedScreenshot {
  analysis: ShotAnalysis;
  /** Size in bytes of the decoded source, for the duplicate check. */
  byteLength: number;
}

/** How many images the flow will take at once. */
export const INTAKE_MAX = 20;

const IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp|gif|bmp|avif|heic|heif)$/i;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;

function looksLikeImage(file: File): boolean {
  return IMAGE_TYPES.test(file.type) || (!file.type && IMAGE_EXTENSION.test(file.name));
}

/**
 * Order files the way a human numbered them.
 *
 * "screen-10.png" sorts after "screen-9.png", which a plain string compare gets
 * backwards, and getting it backwards means the user's board order is wrong
 * before they have touched anything.
 */
export function naturalSort(files: File[]): File[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Walk a dropped directory entry.
 *
 * webkitGetAsEntry is non-standard and the only way to read a dropped folder,
 * so its absence is not an error: the caller falls back to dataTransfer.files,
 * which holds the loose files either way.
 */
async function readEntry(entry: FileSystemEntry, depth: number): Promise<File[]> {
  if (depth > 4) return [];
  if (entry.isFile) {
    return new Promise<File[]>((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([])
      );
    });
  }
  if (!entry.isDirectory) return [];

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const entries: FileSystemEntry[] = [];
  // readEntries hands back at most 100 at a time and signals the end with an
  // empty batch, so one call is not enough for a real screenshots folder.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(
        (found) => resolve(found),
        () => resolve([])
      );
    });
    if (batch.length === 0) break;
    entries.push(...batch);
    if (entries.length > 500) break;
  }
  const nested = await Promise.all(entries.map((child) => readEntry(child, depth + 1)));
  return nested.flat();
}

/**
 * Every image in a drop, folders included, in a sensible order.
 * macOS writes a `.DS_Store` into every folder it has ever opened; those and
 * other dot files are dropped rather than shown as failed reads.
 */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .filter((item) => item.kind === 'file')
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => !!entry);

  const collected = entries.length > 0
    ? (await Promise.all(entries.map((entry) => readEntry(entry, 0)))).flat()
    : Array.from(dataTransfer.files ?? []);

  return naturalSort(collected.filter((file) => !file.name.startsWith('.') && looksLikeImage(file)));
}

/**
 * Clean up a browse or folder pick the way a drop is cleaned up.
 *
 * `<input webkitdirectory>` hands back the folder's ENTIRE contents, which for
 * a simulator export means .DS_Store, a metadata JSON and any recordings
 * alongside the screenshots, in whatever order the browser felt like. Without
 * this those files eat slots against the cap before being reported as "could
 * not be read", and screen-10.png sorts before screen-9.png.
 */
export function normalizePickedFiles(files: File[]): File[] {
  return naturalSort(files.filter((file) => !file.name.startsWith('.') && looksLikeImage(file)));
}

/** Images on the clipboard, for the paste path. */
export function collectPastedFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const files = Array.from(clipboardData.files ?? []).filter(looksLikeImage);
  if (files.length > 0) return naturalSort(files);
  // Safari and Chrome put a screen capture on the clipboard as an item with no
  // File entry until you ask for one.
  const fromItems = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
  return fromItems;
}

export interface ReadResult {
  shots: IntakeShot[];
  /** Files that could not be decoded, by name. */
  failed: string[];
  /** Files skipped because the same image was already in the set. */
  duplicates: number;
  /** Files dropped because the set was already full. */
  overflow: number;
}

/**
 * Decode, analyse and de-duplicate a batch of files.
 *
 * Duplicates are matched on the image's own content, through the 64-bit average
 * hash the analysis pass already computes, together with its pixel dimensions.
 *
 * The obvious cheaper key, byte length plus dimensions, is wrong, and wrong in
 * the direction that costs the user work: two DIFFERENT screens of the same app
 * exported the same way routinely land on the identical byte count, and the set
 * then silently arrives one screenshot short. Dragging the same folder in twice
 * is the case worth catching, and a content hash catches it exactly, including
 * when the same capture was re-exported at a different compression level.
 */
export async function readIntakeFiles(
  files: File[],
  existing: IntakeShot[] = []
): Promise<ReadResult> {
  const room = Math.max(0, INTAKE_MAX - existing.length);
  const accepted = files.slice(0, room);
  const overflow = files.length - accepted.length;

  // All three signals must agree. Requiring the byte count as well as the
  // content signature means a false positive needs two images identical in
  // structure, in colour, in dimensions AND in compressed size, which in
  // practice means the same file. The cost of being wrong here is a screenshot
  // the user thinks they uploaded and did not.
  const seen = new Set(
    existing.map(
      (shot) => `${shot.analysis.fingerprint}:${shot.width}x${shot.height}:${shot.byteLength}`
    )
  );
  const shots: IntakeShot[] = [];
  const failed: string[] = [];
  let duplicates = 0;

  const read = await Promise.all(
    accepted.map(async (file) => {
      try {
        const base = await readScreenshotFile(file);
        return { base, byteLength: file.size, name: file.name };
      } catch {
        return { base: null, byteLength: 0, name: file.name };
      }
    })
  );

  for (const entry of read) {
    if (!entry.base) {
      failed.push(entry.name);
      continue;
    }
    // Analysis reads `dataUrl`, the full-quality copy, not `aiDataUrl`.
    // aiDataUrl is a JPEG flattened onto white, so every pixel in it has alpha
    // 255 and the transparent-corner test for an already-framed mockup could
    // never fire. The sample is downscaled to 64px either way, so the only cost
    // is decoding the larger image once.
    //
    // It has to run BEFORE the duplicate check, because the fingerprint it
    // computes is what the check is keyed on.
    const analysis = await analyzeScreenshot(entry.base.dataUrl, entry.base.width, entry.base.height);
    const key = `${analysis.fingerprint}:${entry.base.width}x${entry.base.height}:${entry.byteLength}`;
    // An empty fingerprint means the sample could not be read at all. Let it
    // through rather than collapsing every unreadable image into one.
    if (analysis.fingerprint && seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    shots.push({ ...entry.base, analysis, byteLength: entry.byteLength });
  }

  return { shots, failed, duplicates, overflow };
}

/** Move an item within the strip. Returns a new array. */
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}
