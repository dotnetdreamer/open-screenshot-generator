// Pictures the agent takes from the user's code folder (import_project_image).
//
// Rust reads the file, and only from inside a folder a running process was
// started with (claude_code.rs). This side stores the bytes as an asset, the
// same as any upload, and hands back the `asset:` reference, so the picture
// never passes through the model or sits in a tool argument.

import { db } from '@/database';
import { saveImageBlobAsset } from '@/lib/mcp/assetStore';
import type { McpProjectImage } from '@/lib/mcp/desktopMcpServer';
import { desktopTransport } from './desktopTransport';
import { folderNameOf } from './folders';
import type { ClaudeTransport } from './types';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/** Rust's own refusal for any other file, so the agent reads one sentence either way. */
export const NOT_A_PICTURE = 'Only PNG, JPEG, WebP, GIF and SVG files can be imported';

/** The picture type a path names, or null for a file that is not one of the five. */
export function projectImageMimeType(path: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(folderNameOf(path));
  return match ? (MIME_BY_EXTENSION[match[1].toLowerCase()] ?? null) : null;
}

/** An SVG length in CSS pixels: a bare number or one in px. Percentages and other units say nothing here. */
function svgLength(value: string | undefined): number | null {
  const match = value ? /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value) : null;
  const length = match ? Number(match[1]) : NaN;
  return Number.isFinite(length) && length > 0 && length <= 100_000 ? length : null;
}

function svgAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(["'])([^"']*)\\1`, 'i').exec(tag);
  return match?.[2];
}

/**
 * An SVG's own size: its width and height attributes when both are lengths in
 * pixels, else the viewBox. Null with neither, which is common for icons made
 * to fill whatever holds them. The browser's probe cannot size those, so
 * without this an imported logo would be stored with no size at all.
 */
export function svgIntrinsicSize(text: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const width = svgLength(svgAttribute(tag, 'width'));
  const height = svgLength(svgAttribute(tag, 'height'));
  if (width && height) return { width, height };
  const box = svgAttribute(tag, 'viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    return { width: box[2], height: box[3] };
  }
  return null;
}

/** Whatever the IPC handed back, as bytes on an ArrayBuffer of their own. */
function toBytes(data: unknown): Uint8Array<ArrayBuffer> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return bytes;
  }
  // A JSON array of numbers, from a build or a test double that did not send raw bytes.
  if (Array.isArray(data)) return Uint8Array.from(data as number[]);
  throw new Error('That image could not be read');
}

/**
 * Store one picture from the code folder and return its reference. Throws a
 * short sentence the agent can act on: Rust's refusal, or one of the two here.
 */
export async function importProjectImage(
  path: string,
  name?: string,
  transport: Pick<ClaudeTransport, 'readProjectImage'> = desktopTransport
): Promise<McpProjectImage> {
  const mimeType = projectImageMimeType(path);
  if (!mimeType) throw new Error(NOT_A_PICTURE);
  const bytes = toBytes(await transport.readProjectImage(path));
  const svg = mimeType === 'image/svg+xml';
  // The root element sits at the top of the file, so its start is enough.
  const head = svg ? new TextDecoder().decode(bytes.subarray(0, 64 * 1024)) : '';
  if (svg && !/<svg\b/i.test(head)) throw new Error('That SVG file could not be read');
  const ownSize = svg ? svgIntrinsicSize(head) : null;
  const asset = await saveImageBlobAsset(new Blob([bytes], { type: mimeType }), {
    name: name?.trim() || folderNameOf(path),
    mimeType,
    // An SVG with no size of its own fails the browser's probe and is still a
    // good logo; its size comes from its attributes instead.
    strict: !svg,
  });
  let width = asset.width ?? null;
  let height = asset.height ?? null;
  if (ownSize && (ownSize.width !== width || ownSize.height !== height)) {
    ({ width, height } = ownSize);
    await db.media.update(asset.assetId, { width, height }).catch(() => undefined);
  }
  return { ref: asset.ref, name: asset.name, width, height };
}
