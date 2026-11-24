// Pictures with a WebP made from their PNG (scripts/pictures/to-webp.mjs).
//
// The PNG stays in public/ under its name, and every name stored anywhere (the
// templates, the image library, the designs built from them, every project
// saved before, pages and scripts) stays the PNG's. The site keeps serving the
// PNG, so an installed copy of the CLI from before, and anything else that
// asks for it, gets it as it shipped.
//
// The app asks for the WebP instead, a fraction of the size, wherever a
// picture is loaded: `currentPicturePath` on the way to the screen
// (withBasePath) and to the desktop app's downloads (pictureDownloads.ts), the
// desktop app's own answer for the PNG name (src-tauri/src/web_assets.rs), and
// the CLI's server (cli/src/editor/assets.ts). The desktop app and the CLI
// carry or download only the WebP.
//
// scripts/pictures/to-webp.mjs writes pictureRenames.json: every picture it
// has made a WebP for.

import renamed from './pictureRenames.json';

/** Folder and name without the extension, e.g. "/data/projects/kassa-money-screen-1". */
const RENAMED = new Set<string>(
  Object.entries(renamed as Record<string, string[]>).flatMap(([dir, names]) =>
    names.map((name) => `${dir}${name}`)
  )
);

/**
 * The file a picture name points at: the WebP for a listed PNG name, and any
 * other path as it is. Every name that shipped ends in a lower case
 * ".png", which is all the desktop app and the CLI look for too.
 */
export function currentPicturePath(path: string): string {
  if (path.charCodeAt(0) !== 47 /* "/" */ || !path.endsWith('.png')) return path;
  const stem = path.slice(0, -4);
  return RENAMED.has(stem) ? `${stem}.webp` : path;
}
