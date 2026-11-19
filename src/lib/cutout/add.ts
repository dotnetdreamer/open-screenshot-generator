// Pictures into the library: from a file the user picked or dropped, or from
// an image an agent sent. Each is decoded once, kept at its working size, and
// given a small copy for lists.

import { addLibraryImage, nameFromFile, type LibraryImageRow } from './library';
import { decodePicture, encodeRgba, thumbnailOf } from './picture';

/** What the file pickers accept: the formats every engine the app runs in can decode. */
export const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,image/gif,image/avif,.heic,.heif';

/**
 * Adds picture files to the library, waiting for a cut (`cut`) or kept as
 * they are. Pictures that cannot be read are skipped and named in the error
 * when none could be added.
 */
export async function addPictureFiles(files: File[], options: { cut: boolean }): Promise<LibraryImageRow[]> {
  const added: LibraryImageRow[] = [];
  const failed: string[] = [];
  for (const file of files) {
    try {
      added.push(await addPictureBlob(file, nameFromFile(file.name), options));
    } catch (error) {
      console.error('Adding a picture failed', file.name, error);
      failed.push(file.name);
    }
  }
  if (added.length === 0 && failed.length) {
    throw new Error(failed.length === 1 ? `${failed[0]} isn't a photo the app can open` : `None of the ${failed.length} files are photos the app can open`);
  }
  return added;
}

/** Adds one picture, from any Blob. */
export async function addPictureBlob(blob: Blob, name: string, options: { cut: boolean }): Promise<LibraryImageRow> {
  const picture = await decodePicture(blob);
  // An opaque photo keeps as a JPEG at a quarter of a PNG's size; anything
  // with transparency stays PNG.
  const source = await encodeRgba(picture.rgba, picture.width, picture.height, picture.hasAlpha ? 'image/png' : 'image/jpeg', 0.92);
  const thumb = await thumbnailOf(picture.rgba, picture.width, picture.height);
  return addLibraryImage({
    name,
    source,
    width: picture.width,
    height: picture.height,
    thumb: await thumb.arrayBuffer(),
    cut: options.cut,
  });
}
