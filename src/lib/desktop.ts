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
    anchorDownload(dataUrl, fileName);
    return undefined;
  }
  const blob = await (await fetch(dataUrl)).blob();
  return saveBlobToDisk(blob, fileName);
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
