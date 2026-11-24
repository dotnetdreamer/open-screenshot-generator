// Pictures the desktop app downloads the first time it shows them.
//
// The desktop app ships without template art and the image library's
// pictures. Its Rust side (src-tauri/src/web_assets.rs) downloads one whenever
// the page asks for it, so a picture shows up even when nothing here runs.
// This module asks first wherever a missing picture would otherwise end up in
// a design: opening a template or a project gets its pictures before the
// canvas does, counted off in the status bar; a library picture goes on an
// artboard once it is here; an agent's element waits for its picture too. When
// one does not come, the caller says so instead of leaving an empty frame.
//
// On the web every picture is on the site already, and so is everything in a
// dev build (the dev server serves public/), so each call here does nothing:
// the Rust side only lists pictures that its build left out.

import { isTauri } from '@/lib/desktop';
import { currentPicturePath } from '@/lib/pictureRenames';
import pictureFields from './pictureFields.json';

const PICTURE = /\.(webp|png|jpe?g)$/i;

/** How many downloads run at once. */
const AT_ONCE = 4;

/**
 * Why a picture did not download, as web_assets.rs words it: the site could
 * not be reached, the site does not have it, the site's copy is not the one
 * this version lists, or it could not be kept on this computer.
 */
export type DownloadReason = 'unreachable' | 'missing' | 'changed' | 'local';

export interface DownloadFailure {
  path: string;
  reason: DownloadReason;
}

/** A root-absolute picture path, the only kind the desktop app may have to download. */
function isPicturePath(value: string): boolean {
  return value.charCodeAt(0) === 47 /* "/" */ && value.charCodeAt(1) !== 47 && PICTURE.test(value);
}

/**
 * The fields a project keeps a picture in, at any depth: on elements, on
 * artboards, in a language's overrides and in a device set. Text is never
 * read, so words that happen to look like a picture's path stay words.
 * scripts/pictures/to-webp.mjs reads the same list.
 */
const PICTURE_KEYS = new Set<string>(pictureFields);

/** Every picture `value` (a project, a template, an element) shows, by the file it is now, once each. */
export function picturePaths(value: unknown, found: Set<string> = new Set()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) picturePaths(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        if (PICTURE_KEYS.has(key) && isPicturePath(item)) found.add(currentPicturePath(item));
      } else {
        picturePaths(item, found);
      }
    }
  }
  return [...found];
}

/** Whether a picture at `src` may still have to be downloaded before it can be shown. */
export function mayNeedDownload(src: unknown): src is string {
  return typeof src === 'string' && isPicturePath(src) && isTauri();
}

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

/** Which of `paths` this computer does not have yet, by their files' names. Empty on the web and in a dev build. */
export async function picturesToDownload(paths: string[]): Promise<string[]> {
  if (!isTauri() || paths.length === 0) return [];
  try {
    const missing = await invoke<unknown>('abs_downloads_missing', { paths: [...new Set(paths.map(currentPicturePath))] });
    return Array.isArray(missing) ? missing.filter((path): path is string => typeof path === 'string') : [];
  } catch (error) {
    console.error('Could not ask which pictures are on this computer', error);
    return [];
  }
}

function reasonOf(error: unknown): DownloadReason {
  const head = String(error instanceof Error ? error.message : error).split(':', 1)[0];
  return head === 'unreachable' || head === 'missing' || head === 'changed' || head === 'local' ? head : 'local';
}

/** One download per picture at a time, so every caller hears how that download really went. */
const inFlight = new Map<string, Promise<DownloadFailure | null>>();

function downloadOne(path: string): Promise<DownloadFailure | null> {
  const running = inFlight.get(path);
  if (running) return running;
  const download = invoke('abs_downloads_fetch', { path })
    .then(() => null)
    .catch((error: unknown): DownloadFailure => {
      console.error(`Could not download ${path}`, error);
      return { path, reason: reasonOf(error) };
    })
    .finally(() => inFlight.delete(path));
  inFlight.set(path, download);
  return download;
}

/**
 * Downloads `paths`, a few at a time, and resolves with the ones that did not
 * download. `onProgress` hears the count after each one lands.
 */
export async function downloadPictures(
  paths: string[],
  onProgress?: (done: number, total: number) => void
): Promise<DownloadFailure[]> {
  const failed: DownloadFailure[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next];
      next += 1;
      const failure = await downloadOne(path);
      if (failure) failed.push(failure);
      done += 1;
      onProgress?.(done, paths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, paths.length) }, worker));
  return failed;
}

/**
 * Downloads every picture `value` names that this computer does not have yet.
 * `total` is how many were missing, `failed` the ones still missing after.
 */
export async function downloadPicturesFor(
  value: unknown,
  onProgress?: (done: number, total: number) => void
): Promise<{ total: number; failed: DownloadFailure[] }> {
  const missing = await picturesToDownload(picturePaths(value));
  if (!missing.length) return { total: 0, failed: [] };
  onProgress?.(0, missing.length);
  const failed = await downloadPictures(missing, onProgress);
  return { total: missing.length, failed };
}

/** Gets one picture before it goes on an artboard. Null once it is here, or the reason it is not. */
export async function ensurePicture(path: string): Promise<DownloadFailure | null> {
  const missing = await picturesToDownload([path]);
  if (!missing.length) return null;
  return downloadOne(missing[0]);
}

/** Whether every failure is the internet's, which the user can fix by getting back online. */
function onlyUnreachable(failed: DownloadFailure[]): boolean {
  return failed.every((failure) => failure.reason === 'unreachable');
}

/** What a toast says about pictures that did not download, by what they were for. */
export function picturesFailedCopy(
  failed: DownloadFailure[],
  what: 'template' | 'project' | 'picture'
): { title: string; description: string } {
  const offline = onlyUnreachable(failed);
  const later = 'Try again later, or update the app.';
  if (what === 'template') {
    return offline
      ? { title: "This template's pictures didn't download", description: 'Check your internet connection and try again.' }
      : { title: "This template's pictures aren't available", description: later };
  }
  if (what === 'project') {
    return offline
      ? { title: "Some pictures in this project didn't download", description: 'Check your internet connection, then open the project again.' }
      : { title: "Some pictures in this project aren't available", description: later };
  }
  return offline
    ? { title: "That picture didn't download", description: 'Check your internet connection and try again.' }
    : { title: "That picture isn't available", description: later };
}

/** Thrown when a template cannot start because its pictures did not download. */
export class PicturesNotDownloadedError extends Error {
  constructor(readonly failed: DownloadFailure[]) {
    super(
      onlyUnreachable(failed)
        ? "This template's pictures didn't download. Check the internet connection and try again."
        : "This template's pictures aren't available from the app's site right now. Try again later, or update the app."
    );
    this.name = 'PicturesNotDownloadedError';
  }
}
