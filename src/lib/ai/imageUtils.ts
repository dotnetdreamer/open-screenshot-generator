/**
 * Screenshot ingest for the AI agent.
 *
 * Every uploaded file becomes two data URLs:
 *   - `dataUrl`   full quality, long edge capped at the tallest canvas we
 *                 support (2796px). This is what lands in a device frame and
 *                 gets persisted with the project in IndexedDB.
 *   - `aiDataUrl` long edge capped at 1024px, JPEG q0.8. This is what we send
 *                 to a model or attach to a chat window. Twenty of these stay
 *                 well inside every provider's per-image and per-request caps,
 *                 and the extra pixels buy the model nothing.
 */

export interface UploadedScreenshot {
  id: string;
  fileName: string;
  /** Full-resolution data URL, stored in the project. */
  dataUrl: string;
  /** Downscaled JPEG data URL, sent to the model. */
  aiDataUrl: string;
  width: number;
  height: number;
}

const STORAGE_MAX_EDGE = 2796;
const AI_MAX_EDGE = 1024;
const AI_QUALITY = 0.8;

let counter = 0;

export async function readScreenshotFile(file: File): Promise<UploadedScreenshot> {
  const bitmap = await decode(file);
  try {
    const storage = render(bitmap, STORAGE_MAX_EDGE, false);
    const ai = render(bitmap, AI_MAX_EDGE, true);
    return {
      id: `shot_${Date.now()}_${counter++}`,
      fileName: file.name,
      // Re-encoding a PNG as PNG is lossless but can inflate; only re-encode
      // when we actually had to scale down, otherwise keep the original bytes.
      dataUrl:
        storage.scaled || !isBrowserSafeType(file.type)
          ? storage.canvas.toDataURL('image/png')
          : await fileToDataUrl(file),
      aiDataUrl: ai.canvas.toDataURL('image/jpeg', AI_QUALITY),
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close?.();
  }
}

function isBrowserSafeType(type: string): boolean {
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp';
}

/**
 * `imageOrientation: 'from-image'` applies the EXIF rotation phone cameras
 * write, which `<img>` does automatically but `createImageBitmap` does not.
 * Some Safari builds reject the option, so fall back to the plain call.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

function render(
  bitmap: ImageBitmap,
  maxEdge: number,
  flatten: boolean
): { canvas: HTMLCanvasElement; scaled: boolean } {
  const longest = Math.max(bitmap.width, bitmap.height);
  const factor = longest > maxEdge ? maxEdge / longest : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * factor));
  canvas.height = Math.max(1, Math.round(bitmap.height * factor));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not read the image.');
  ctx.imageSmoothingQuality = 'high';
  if (flatten) {
    // JPEG has no alpha, so paint white first or transparent PNGs go black.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, scaled: factor < 1 };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/** Strips the `data:<type>;base64,` prefix. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

export function dataUrlMediaType(dataUrl: string): string {
  const match = /^data:([^;,]+)/.exec(dataUrl);
  return match ? match[1] : 'image/jpeg';
}
