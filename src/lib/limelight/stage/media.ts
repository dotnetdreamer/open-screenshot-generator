/**
 * The pictures a stage's screens show, decoded once and kept small.
 *
 * A screenshot from a phone is often 1320 x 2868: decoded whole that is
 * about 15 MB, and the macOS web view gives the page roughly 500 MB before it
 * is killed (issue #19). So each picture is decoded, scaled down to the
 * screen canvas's MAX_SIDE, and only the small copy is kept, a dozen at most.
 *
 * A still or a video frame first holds the pictures its moment shows
 * (`hold`), and the canvas says what its frame shows (`show`): the cache lets
 * go of others to stay at a dozen, never of a picture a frame needs. A scene
 * can show more pictures than the cache keeps, so a frame waits only for its
 * own, never for every picture in the scene. Without `show`, eight phones
 * changing picture at once needed sixteen: each one read pushed another out,
 * and the screens went black while pictures were read again and again.
 */

import { MAX_SIDE, pictureSize, type Picture } from './screen';

export type MediaLoader = (id: string) => Promise<Blob | null>;
export type PictureDecoder = (blob: Blob) => Promise<Picture>;

/** How many pictures are kept decoded when no frame needs more. */
export const KEEP = 12;

async function decode(blob: Blob): Promise<Picture> {
  let full: ImageBitmap | HTMLImageElement;
  if (typeof createImageBitmap === 'function') {
    full = await createImageBitmap(blob);
  } else {
    const url = URL.createObjectURL(blob);
    try {
      full = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('The picture could not be read'));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const { width, height } = pictureSize(full);
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  if (k >= 1) return full;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  }
  if ('close' in full) full.close();
  return canvas;
}

function close(picture: Picture) {
  if ('close' in picture) picture.close();
}

export class StageMedia {
  private readonly pictures = new Map<string, Picture>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly missing = new Set<string>();
  /** What the frames being drawn show: kept whatever the count, until each lets go. */
  private readonly pins = new Set<Set<string>>();
  /** What the canvas's frame shows, kept the same way until the next frame says otherwise. */
  private showing: ReadonlySet<string> = new Set();
  private disposed = false;

  constructor(
    private readonly load: MediaLoader,
    private readonly onReady: (id: string) => void,
    private readonly decodePicture: PictureDecoder = decode
  ) {}

  /** The picture, or null while it loads (onReady says when it arrives) or when there is none. */
  get = (id: string | null | undefined): Picture | null => {
    if (!id) return null;
    const picture = this.pictures.get(id);
    if (picture) {
      // Most recently used last, so the oldest goes first when there are too many.
      this.pictures.delete(id);
      this.pictures.set(id, picture);
      return picture;
    }
    if (!this.missing.has(id) && !this.loading.has(id)) this.fetch(id);
    return null;
  };

  /**
   * Loads every picture in `ids` (or finds it missing) and keeps them all,
   * however many, until the function it gives back is called.
   */
  async hold(ids: Iterable<string>): Promise<() => void> {
    const held = new Set(ids);
    this.pins.add(held);
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      this.pins.delete(held);
      this.trim();
    };
    try {
      const waits: Promise<void>[] = [];
      for (const id of held) {
        if (this.pictures.has(id) || this.missing.has(id)) continue;
        if (!this.loading.has(id)) this.fetch(id);
        const pending = this.loading.get(id);
        if (pending) waits.push(pending);
      }
      await Promise.all(waits);
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  /**
   * The pictures the canvas's frame shows, before it asks for them (`get`):
   * kept like a held frame's until the next frame's take their place.
   */
  show(ids: ReadonlySet<string>) {
    this.showing = ids;
    this.trim();
  }

  /** How many pictures are decoded now. */
  get size(): number {
    return this.pictures.size;
  }

  /** Drops a picture so the next look reads it again: its file changed. */
  forget(id: string) {
    const picture = this.pictures.get(id);
    if (picture) close(picture);
    this.pictures.delete(id);
    this.missing.delete(id);
  }

  private isHeld(id: string): boolean {
    if (this.showing.has(id)) return true;
    for (const held of this.pins) if (held.has(id)) return true;
    return false;
  }

  /** Down to KEEP, oldest first, never a picture a frame needs. */
  private trim() {
    if (this.pictures.size <= KEEP) return;
    for (const [id, picture] of this.pictures) {
      if (this.pictures.size <= KEEP) break;
      if (this.isHeld(id)) continue;
      this.pictures.delete(id);
      close(picture);
    }
  }

  private fetch(id: string) {
    const pending = (async () => {
      try {
        const blob = await this.load(id);
        if (this.disposed) return;
        if (!blob) {
          this.missing.add(id);
          return;
        }
        const picture = await this.decodePicture(blob);
        if (this.disposed) {
          close(picture);
          return;
        }
        this.pictures.set(id, picture);
        this.trim();
      } catch (error) {
        console.error('Limelight could not read a picture', id, error);
        this.missing.add(id);
      } finally {
        this.loading.delete(id);
      }
      if (!this.disposed) this.onReady(id);
    })();
    this.loading.set(id, pending);
  }

  dispose() {
    this.disposed = true;
    for (const picture of this.pictures.values()) close(picture);
    this.pictures.clear();
  }
}
