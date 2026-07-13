// Desktop (Tauri) integration helpers.
//
// The same static export runs on the web and inside the Tauri desktop shell.
// Anchor-tag downloads (<a download>) work in real browsers and in WebView2 on
// Windows, but WKWebView on macOS ignores them, so every user-facing "save a
// file" path must go through saveBlobToDisk()/saveDataUrlToDisk() below. In
// Tauri they open a native save dialog and write via the fs plugin; on the web
// they fall back to the classic anchor download.
//
// The Tauri plugins are loaded with dynamic import() so the web bundle never
// pulls them in at module-evaluation time and SSR/static export stays clean.

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Windows-reserved characters make the native save dialog reject the default
// name (browsers sanitize download names themselves, native dialogs do not).
// Strip them everywhere so web and desktop exports name files identically.
export function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|]/g, '_');
}

function splitName(fileName: string): { stem: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { stem: fileName, ext: '' };
  return { stem: fileName.slice(0, dot), ext: fileName.slice(dot + 1).toLowerCase() };
}

function anchorDownload(href: string, fileName: string) {
  const link = document.createElement('a');
  link.download = fileName;
  link.href = href;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Save a Blob to the user's machine.
 * Returns the chosen path in Tauri, null if the user cancelled the dialog,
 * and undefined on the web (browser downloads don't expose a path).
 */
export async function saveBlobToDisk(
  blob: Blob,
  fileName: string
): Promise<string | null | undefined> {
  fileName = sanitizeFileName(fileName);
  if (!isTauri()) {
    const url = URL.createObjectURL(blob);
    try {
      anchorDownload(url, fileName);
    } finally {
      // Delay revoke so the download has started before the URL disappears.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    return undefined;
  }

  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);

  const { stem, ext } = splitName(fileName);
  const path = await save({
    defaultPath: fileName,
    filters: ext ? [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }] : undefined,
    title: `Save ${stem}`,
  });
  if (!path) return null;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(path, bytes);
  return path;
}

/** Save a data: URL (e.g. from html-to-image) to the user's machine. */
export async function saveDataUrlToDisk(
  dataUrl: string,
  fileName: string
): Promise<string | null | undefined> {
  if (!isTauri()) {
    anchorDownload(dataUrl, sanitizeFileName(fileName));
    return undefined;
  }
  const blob = await (await fetch(dataUrl)).blob();
  return saveBlobToDisk(blob, fileName);
}

/**
 * Pick a destination folder for a multi-file export.
 * Tauri only: returns the folder path, or null if the user cancelled.
 * On the web returns undefined (multi-file exports fall back to individual
 * browser downloads, which need no destination).
 */
export async function pickExportDirectory(
  title?: string
): Promise<string | null | undefined> {
  if (!isTauri()) return undefined;
  const { open } = await import('@tauri-apps/plugin-dialog');
  // recursive: true widens the runtime fs scope to the folder's contents,
  // which is what permits the writeFile calls that follow
  const dir = await open({ directory: true, recursive: true, title });
  return dir as string | null;
}

/** Write a Blob into a previously picked folder (Tauri only). */
export async function saveBlobToPath(
  blob: Blob,
  dir: string,
  fileName: string
): Promise<string> {
  const [{ writeFile }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ]);
  const path = await join(dir, sanitizeFileName(fileName));
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return path;
}

/** Write a data: URL into a previously picked folder (Tauri only). */
export async function saveDataUrlToPath(
  dataUrl: string,
  dir: string,
  fileName: string
): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const [{ writeFile }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ]);
  const path = await join(dir, sanitizeFileName(fileName));
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return path;
}

/**
 * Tell the desktop shell the UI is up, so it can close the splash window and
 * reveal the main one. No-op on the web.
 *
 * The main window is hidden until this runs, so it produces no compositor
 * frames and requestAnimationFrame never fires: we cannot wait on a real paint.
 * Waiting on fonts is the closest proxy for "the first frame will not be
 * unstyled". Rust reveals the window regardless after 12s.
 */
export async function signalAppReady(): Promise<void> {
  if (!isTauri()) return;
  try {
    await Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('abs_app_ready');
  } catch {
    // The splash closes on the Rust-side fallback timer anyway.
  }
}

/** Open a URL in the system browser (Tauri) or a new tab (web). */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
