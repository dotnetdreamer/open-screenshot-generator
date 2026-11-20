// Pictures into the library: from a file the user picked or dropped, or from
// an image an agent sent. Each is decoded once, kept at its working size, and
// given a small copy for lists.

import { addLibraryImage, isOutOfRoom, nameFromFile, OUT_OF_ROOM, type LibraryImageRow } from './library';
import { decodePicture, encodeRgba, thumbnailOf } from './picture';

/** What the file pickers accept: the formats every engine the app runs in can decode. */
export const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,image/gif,image/avif,.heic,.heif';

/**
 * Whether a file may be a picture: an image type, a picture's extension, or
 * no type to go by. A dropped file can be anything, and one that is plainly
 * not a picture (a PDF, a video) is not decoded at all.
 */
export function mayBePicture(file: File): boolean {
  return !file.type || file.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif|gif|avif)$/i.test(file.name);
}

/** A picture the app could not decode or redraw at its working size. */
export class UnreadablePictureError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'UnreadablePictureError';
  }
}

/**
 * Why a picture that could be read was not kept, in words for a toast. The
 * pictures live in the browser's storage (IndexedDB), which refuses them when
 * the computer is out of room for the app, and in a WebKit session that keeps
 * nothing on disk, which cannot store a Blob (Playwright's WebKit; a private
 * Safari window may be the same).
 */
export function notKeptMessage(error: unknown): string {
  if (isOutOfRoom(error)) return OUT_OF_ROOM;
  return "This browser wouldn't keep the pictures. If this is a private window, open the app in a normal one.";
}

export interface AddedPictures {
  added: LibraryImageRow[];
  /** How many of the files were not added. */
  notAdded: number;
  /** Why, in sentences for a toast. Null when every file was added. */
  reason: string | null;
}

/**
 * Adds picture files to the library, waiting for a cut (`cut`) or kept as
 * they are. A file that fails is skipped and the rest still go in; the result
 * says how many failed and why: the files, or the storage that would not keep
 * them. When none could be added it throws with that reason instead.
 */
export async function addPictureFiles(files: File[], options: { cut: boolean }): Promise<AddedPictures> {
  const added: LibraryImageRow[] = [];
  const unreadable: string[] = [];
  let notKept: unknown = null;
  let notKeptCount = 0;
  for (const file of files) {
    if (!mayBePicture(file)) {
      unreadable.push(file.name);
      continue;
    }
    try {
      added.push(await addPictureBlob(file, nameFromFile(file.name), options));
    } catch (error) {
      console.error('Adding a picture failed', file.name, error);
      if (error instanceof UnreadablePictureError) unreadable.push(file.name);
      else {
        notKept ??= error;
        notKeptCount++;
      }
    }
  }
  const reasons: string[] = [];
  if (notKept) reasons.push(notKeptMessage(notKept));
  if (unreadable.length === 1) reasons.push(`${unreadable[0]} isn't a photo the app can open.`);
  else if (unreadable.length) {
    reasons.push(added.length || notKeptCount ? `${unreadable.length} of the files aren't photos the app can open.` : `None of the ${unreadable.length} files are photos the app can open.`);
  }
  const reason = reasons.length ? reasons.join(' ') : null;
  if (added.length === 0 && reason) throw new Error(reason);
  return { added, notAdded: unreadable.length + notKeptCount, reason };
}

/** Adds one picture, from any Blob. */
export async function addPictureBlob(blob: Blob, name: string, options: { cut: boolean }): Promise<LibraryImageRow> {
  let picture: Awaited<ReturnType<typeof decodePicture>>;
  let source: Blob;
  let thumb: Blob;
  try {
    picture = await decodePicture(blob);
    // An opaque photo keeps as a JPEG at a quarter of a PNG's size; anything
    // with transparency stays PNG.
    source = await encodeRgba(picture.rgba, picture.width, picture.height, picture.hasAlpha ? 'image/png' : 'image/jpeg', 0.92);
    thumb = await thumbnailOf(picture.rgba, picture.width, picture.height);
  } catch (error) {
    throw new UnreadablePictureError(error);
  }
  return addLibraryImage({
    name,
    source,
    width: picture.width,
    height: picture.height,
    thumb: await thumb.arrayBuffer(),
    cut: options.cut,
  });
}
