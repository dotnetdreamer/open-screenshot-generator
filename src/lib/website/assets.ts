// What the site's files are made from, worked out in the page: the
// screenshots as JPEGs, colours read from pictures, the app icon, the app's
// facts from the App Store, and the heading face.
//
// The heading face is the one the screenshots use, cut down to the letters
// the site's headings have (Google Fonts' `text=` parameter) and put on the
// site itself. A page that loaded it from Google would send every visitor's
// IP address to Google, and the privacy policy says the site has no tracking
// and names GitHub Pages as the only one that sees visitors.

import { bridgeFetch } from '@/lib/account/transport';
import { storeImageSource } from '@/lib/growth/storeImages';
import { GOOGLE_FONTS } from '@/services/fontService';
import { sampleColors, type Weighted } from './theme';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The picture could not be read'));
    image.src = src;
  });
}

function canvasOf(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not draw the picture');
  return context;
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be saved'))), type, quality);
  });
}

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface WebImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  hash: string;
}

/**
 * A screenshot as a JPEG for the web, at most `maxWidth` wide. Store
 * screenshots have no transparency, so a JPEG keeps a phone screenshot near a
 * tenth of its PNG.
 */
export async function webJpeg(dataUrl: string, maxWidth = 760, quality = 0.86): Promise<WebImage> {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvasOf(width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  const bytes = new Uint8Array(await (await blobOf(context.canvas, 'image/jpeg', quality)).arrayBuffer());
  return { bytes, width, height, hash: (await sha1Hex(bytes)).slice(0, 12) };
}

/** The common colours of a picture, read from a small copy of it. `top` reads only that share of it from the top. */
export async function pictureColors(src: string, top = 1): Promise<Weighted[]> {
  const image = await loadImage(src);
  const size = 48;
  const context = canvasOf(size, size);
  const height = Math.max(1, Math.round(image.naturalHeight * top));
  context.drawImage(image, 0, 0, image.naturalWidth, height, 0, 0, size, size);
  return sampleColors(context.getImageData(0, 0, size, size).data);
}

/** A picture as a square PNG data URL of at most `size` pixels, for the icon. */
export async function iconPng(src: string, size = 512): Promise<string> {
  const image = await loadImage(src);
  const side = Math.min(size, Math.max(image.naturalWidth, image.naturalHeight));
  const context = canvasOf(side, side);
  const scale = side / Math.max(image.naturalWidth, image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, (side - width) / 2, (side - height) / 2, width, height);
  return context.canvas.toDataURL('image/png');
}

/** An icon from an address, such as the App Store's artwork or a Google Play image. */
export async function iconFromUrl(url: string): Promise<string> {
  const source = await storeImageSource(url);
  if (source.startsWith('blob:') || source.startsWith('data:')) return iconPng(source);
  // A picture from another site can be drawn, but not read back, unless it
  // comes through the app's own request first.
  const run = await bridgeFetch();
  const response = await run(source, { method: 'GET' });
  if (!response.ok) throw new Error(`The icon could not be loaded (HTTP ${response.status})`);
  const blob = await response.blob();
  const local = URL.createObjectURL(blob);
  try {
    return await iconPng(local);
  } finally {
    URL.revokeObjectURL(local);
  }
}

export async function iconFromFile(file: File): Promise<string> {
  const local = URL.createObjectURL(file);
  try {
    return await iconPng(local);
  } finally {
    URL.revokeObjectURL(local);
  }
}

// --- the App Store's facts ------------------------------------------------------------

export interface StoreFacts {
  name: string;
  developer: string;
  iconUrl: string | null;
  description: string;
  storeUrl: string;
}

/** The App Store id in a link such as https://apps.apple.com/us/app/name/id1234567890. */
export function appStoreIdOf(url: string): string | null {
  return /(?:^|[/=])id(\d{6,})(?:\b|$)/.exec(url.trim())?.[1] ?? null;
}

/** The package name in a Google Play link, such as com.example.app. */
export function playPackageOf(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (!/(^|\.)play\.google\.com$/.test(parsed.hostname)) return null;
    const id = parsed.searchParams.get('id');
    return id && /^[A-Za-z][\w]*(\.[\w]+)+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** What the App Store says about an app, from Apple's public lookup. Null when Apple has no such app. */
export async function lookupStoreFacts(appId: string, signal?: AbortSignal): Promise<StoreFacts | null> {
  const run = await bridgeFetch();
  const response = await run(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&entity=software`, { method: 'GET', signal });
  if (!response.ok) throw new Error(`The App Store answered with an error (${response.status})`);
  const body = (await response.json()) as { results?: Array<Record<string, unknown>> };
  const row = body.results?.find((entry) => entry.kind === 'software' || entry.wrapperType === 'software') ?? body.results?.[0];
  if (!row) return null;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    name: text(row.trackName),
    developer: text(row.sellerName) || text(row.artistName),
    iconUrl: text(row.artworkUrl512) || text(row.artworkUrl100) || null,
    description: text(row.description),
    storeUrl: `https://apps.apple.com/app/id${appId}`,
  };
}

// --- the heading face ---------------------------------------------------------------------

export interface HeadingFace {
  file: string;
  bytes: Uint8Array;
  format: string;
}

/** The weight Google serves of a family that is closest to `weight`, or null for a family with one weight. */
function servedWeight(family: string, weight: number): number | null {
  const font = GOOGLE_FONTS.find((entry) => entry.family === family);
  const weights = (font?.variants ?? []).map(Number).filter(Number.isFinite);
  if (weights.length === 0) return null;
  return weights.reduce((best, next) => (Math.abs(next - weight) < Math.abs(best - weight) ? next : best));
}

/** Whether a family is one of the app's Google Fonts, which the site can carry. */
export function isGoogleFamily(family: string): boolean {
  return GOOGLE_FONTS.some((entry) => entry.family === family);
}

/**
 * The heading face cut down to `text`'s letters, or null when Google has no
 * such family or the letters are too many to ask for (some thousands of
 * Chinese characters); the headings then fall back to the visitor's own face,
 * letter by letter.
 */
export async function fetchHeadingFace(family: string, weight: number, text: string, signal?: AbortSignal): Promise<HeadingFace | null> {
  if (!isGoogleFamily(family)) return null;
  const letters = [...new Set(Array.from(text.replace(/\s+/g, '')))].sort().join('');
  if (!letters || letters.length > 1500) return null;
  const served = servedWeight(family, weight);
  const familyParam = `${family.replace(/ /g, '+')}${served ? `:wght@${served}` : ''}`;
  const cssUrl = `https://fonts.googleapis.com/css2?family=${familyParam}&text=${encodeURIComponent(letters)}&display=swap`;
  const css = await fetch(cssUrl, { signal }).then((response) => {
    if (!response.ok) throw new Error(`Google Fonts answered with an error (${response.status})`);
    return response.text();
  });
  const match = /src:\s*url\(([^)]+)\)\s*format\(['"]?([a-z0-9-]+)['"]?\)/i.exec(css);
  if (!match) return null;
  const fileUrl = match[1].replace(/^['"]|['"]$/g, '');
  const bytes = new Uint8Array(await (await fetch(fileUrl, { signal })).arrayBuffer());
  const format = match[2].toLowerCase();
  const extension = format === 'woff2' ? 'woff2' : format === 'woff' ? 'woff' : format === 'opentype' ? 'otf' : 'ttf';
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { file: `${slug}-${served ?? 'regular'}.${extension}`, bytes, format };
}
