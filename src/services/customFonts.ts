// Fonts the user imported from their own machine.
//
// The built-in list (services/fontService.ts) is a fixed set of Google and
// system families. This module lets someone drop in a .ttf/.otf/.woff/.woff2
// and use it like any other family, which is the only way to get a licensed or
// genuinely display-y typeface into a screenshot.
//
// How a face reaches the pixels:
//   1. the file is stored as a Blob in the Dexie `fonts` table, so it survives
//      reloads and is available to every project on this device
//   2. on registration the blob becomes a base64 data: URL and one shared
//      <style data-custom-fonts> element gets an @font-face rule for it
//
// Step 2 is deliberately a real stylesheet rule rather than only a
// `document.fonts.add(new FontFace(...))`. PNG export runs through
// html-to-image, which rebuilds the artboard inside an SVG foreignObject and
// can only carry fonts it finds as CSSFontFaceRules in document.styleSheets. A
// FontFace added through the JS API is invisible there, and the export would
// silently fall back to a system serif. The rule's src has to be a data: URL
// for the same reason: a blob: URL does not resolve inside the foreignObject.

import { useSyncExternalStore } from 'react';
import { db } from '@/database';
import { ALL_FONTS } from './fontService';

/** What the file input accepts, and what browsers can actually render. */
export const FONT_FILE_ACCEPT = '.ttf,.otf,.woff,.woff2';

/** Well past any real display face; a bad file should fail fast, not hang. */
const MAX_FONT_BYTES = 12 * 1024 * 1024;

const STYLE_ELEMENT_ID = 'custom-font-faces';

export type CustomFontFormat = 'woff2' | 'woff' | 'truetype' | 'opentype';

const FORMATS: Record<string, { format: CustomFontFormat; mimeType: string }> = {
  woff2: { format: 'woff2', mimeType: 'font/woff2' },
  woff: { format: 'woff', mimeType: 'font/woff' },
  ttf: { format: 'truetype', mimeType: 'font/ttf' },
  otf: { format: 'opentype', mimeType: 'font/otf' },
};

/** Metadata for an imported font, without the bytes. */
export interface CustomFont {
  id: string;
  /** The CSS family name. Unique across built-ins and other imports. */
  family: string;
  fileName: string;
  format: CustomFontFormat;
  mimeType: string;
  size: number;
  createdAt: Date;
}

/** The Dexie row: metadata plus the file itself. */
export interface CustomFontRow extends CustomFont {
  blob: Blob;
}

// --- registry ---------------------------------------------------------------

const registry = new Map<string, CustomFont>();
/** id -> data: URL, so re-registering does not re-encode the blob. */
const dataUrls = new Map<string, string>();
const listeners = new Set<() => void>();

const EMPTY: CustomFont[] = [];
let snapshot: CustomFont[] = EMPTY;

function publish() {
  snapshot = [...registry.values()].sort((a, b) => a.family.localeCompare(b.family));
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Every imported font, family-sorted. Re-renders when one is added or removed.
 * Returns an empty list during SSR and the first client render.
 */
export function useCustomFonts(): CustomFont[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY
  );
}

/** Imported families, for anything that validates a font name (MCP, the AI). */
export function customFontFamilies(): string[] {
  return snapshot.map((font) => font.family);
}

export function isCustomFontFamily(family: string): boolean {
  const needle = family.trim().toLowerCase();
  return snapshot.some((font) => font.family.toLowerCase() === needle);
}

// --- stylesheet -------------------------------------------------------------

function styleElement(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ELEMENT_ID);
  if (existing) return existing as HTMLStyleElement;
  const element = document.createElement('style');
  element.id = STYLE_ELEMENT_ID;
  element.setAttribute('data-custom-fonts', '');
  document.head.appendChild(element);
  return element;
}

function rebuildStyleElement() {
  const rules = [...registry.values()]
    .map((font) => {
      const src = dataUrls.get(font.id);
      if (!src) return '';
      // font-display: block, not swap: an export that fires before the face is
      // ready should wait for it rather than bake in a fallback. The bytes are
      // inline, so the block period is never visible.
      return [
        '@font-face {',
        `  font-family: '${font.family}';`,
        `  src: url(${src}) format('${font.format}');`,
        '  font-display: block;',
        '}',
      ].join('\n');
    })
    .filter(Boolean);
  styleElement().textContent = rules.join('\n');
}

// --- naming -----------------------------------------------------------------

/**
 * A CSS family name from a file name.
 * "Bricolage_Grotesque-Regular.woff2" -> "Bricolage Grotesque".
 */
function familyFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const spaced = base
    .replace(/[_+-]+/g, ' ')
    // Split runs like "BricolageGrotesque", but leave "OSGFont" alone.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  // Trailing tokens that name the file, not the typeface. Google's downloads
  // are full of "VariableFont wght" and "Regular".
  const trimmed = spaced.replace(
    /\s+(variable\s*font|static|wght|opsz|regular|book|roman|normal|400)$/gi,
    ''
  );
  // Anything a bare CSS identifier cannot hold, so the family never has to be
  // quoted at a call site that forgot to.
  const safe = trimmed.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return safe || 'Custom Font';
}

function takenFamilies(): Set<string> {
  const taken = new Set<string>();
  for (const font of ALL_FONTS) taken.add(font.family.toLowerCase());
  for (const font of registry.values()) taken.add(font.family.toLowerCase());
  return taken;
}

/** "Sofia" against an existing "Sofia" becomes "Sofia 2". */
function uniqueFamily(preferred: string): string {
  const taken = takenFamilies();
  if (!taken.has(preferred.toLowerCase())) return preferred;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${preferred} ${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${preferred} ${Date.now()}`;
}

// --- import / load / delete -------------------------------------------------

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that font file.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Put a stored font on the page: encode it, add its @font-face rule, and wait
 * for the browser to accept the bytes. Rejects when the file is not a font the
 * browser can parse, which is the only reliable validation available.
 */
async function registerFont(row: CustomFontRow): Promise<void> {
  const { blob, ...meta } = row;
  if (!dataUrls.has(meta.id)) {
    // Re-wrap so the data: URL carries the font MIME type even when the file
    // came off a system that reported application/octet-stream.
    const typed = blob.type === meta.mimeType ? blob : new Blob([blob], { type: meta.mimeType });
    dataUrls.set(meta.id, await blobToDataUrl(typed));
  }
  const source = dataUrls.get(meta.id)!;

  // Parse check before anything is shown: FontFace.load() throws on a file the
  // engine cannot decode, and a bad @font-face rule otherwise fails silently.
  await new FontFace(meta.family, `url(${source}) format('${meta.format}')`).load();

  registry.set(meta.id, meta);
  rebuildStyleElement();
  publish();

  // Warm the face declared by the stylesheet (the one above was only a probe),
  // so the first export cannot race the load.
  try {
    await document.fonts.load(`16px "${meta.family}"`);
  } catch {
    // Non-fatal: the rule is in place and the text will still render.
  }
}

let loadOnce: Promise<void> | null = null;

/**
 * Register every font in Dexie. Safe to call repeatedly; the work happens once.
 * A font that no longer parses is dropped rather than failing the whole load.
 */
export function loadCustomFonts(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!loadOnce) {
    loadOnce = (async () => {
      let rows: CustomFontRow[];
      try {
        rows = await db.fonts.toArray();
      } catch (error) {
        console.error('Could not read imported fonts', error);
        return;
      }
      for (const row of rows) {
        try {
          await registerFont({ ...row, createdAt: asDate(row.createdAt) });
        } catch (error) {
          console.error(`Dropping unreadable font "${row.family}"`, error);
        }
      }
    })();
  }
  return loadOnce;
}

/**
 * Store a font file and make it usable straight away.
 * Returns the created record, whose `family` may differ from the file name
 * when that name was already taken.
 */
export async function importFontFile(file: File): Promise<CustomFont> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const spec = FORMATS[extension];
  if (!spec) {
    throw new Error('That is not a font file. Pick a .ttf, .otf, .woff or .woff2 file.');
  }
  if (file.size === 0) {
    throw new Error('That font file is empty.');
  }
  if (file.size > MAX_FONT_BYTES) {
    throw new Error(`That font is ${Math.round(file.size / 1024 / 1024)} MB. The limit is 12 MB.`);
  }

  await loadCustomFonts();

  const row: CustomFontRow = {
    id: `font_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    family: uniqueFamily(familyFromFileName(file.name)),
    fileName: file.name,
    format: spec.format,
    mimeType: spec.mimeType,
    size: file.size,
    createdAt: new Date(),
    blob: file,
  };

  // Register first: a file that does not parse must not leave a dead row
  // behind that reappears on every reload.
  await registerFont(row);
  try {
    await db.fonts.put(row);
  } catch {
    unregister(row.id);
    throw new Error('Could not save that font to this device.');
  }

  return registry.get(row.id)!;
}

// --- carrying fonts with a project -----------------------------------------

/**
 * Rows, bytes included, for the families named. Anything not imported on this
 * device (a built-in, or a family whose file lives on someone else's machine)
 * is skipped rather than reported, since only imports need carrying.
 */
export async function getCustomFontRows(families: Iterable<string>): Promise<CustomFontRow[]> {
  const wanted = new Set(
    [...families].map((family) => family.trim().toLowerCase()).filter(Boolean)
  );
  if (wanted.size === 0) return [];
  const rows = await db.fonts.toArray();
  return rows.filter((row) => wanted.has(row.family.toLowerCase()));
}

/**
 * Install a font that arrived with a project.
 *
 * A family already on this device wins and the incoming copy is dropped: text
 * elements reference fonts by family name, so the local one already resolves
 * them, and re-opening the same project must not pile up duplicates.
 *
 * Throws if the file does not parse, which the caller should treat as "this
 * one font is missing" rather than failing the whole import.
 */
export async function installCustomFont(font: CustomFontRow): Promise<void> {
  await loadCustomFonts();
  if (isCustomFontFamily(font.family)) return;
  // Ids collide only across devices, and only by accident; keep the family
  // (which the document points at) and give the row a free id.
  const taken = await db.fonts.get(font.id);
  const row: CustomFontRow = {
    ...font,
    id: taken ? `font_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : font.id,
    createdAt: asDate(font.createdAt),
  };
  await registerFont(row);
  await db.fonts.put(row);
}

function unregister(id: string) {
  registry.delete(id);
  dataUrls.delete(id);
  rebuildStyleElement();
  publish();
}

/**
 * Forget an imported font. Text elements keep the family name and fall back to
 * the browser default, so re-importing the same file restores them.
 */
export async function deleteCustomFont(id: string): Promise<void> {
  unregister(id);
  await db.fonts.delete(id);
}

function asDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function formatFontSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
