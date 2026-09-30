// Pictures for Claude to look at. Every image sent is the small JPEG the other
// agent modes send (long edge 1024px): the full-size file is already stored as
// an asset for the design itself, and the extra pixels would only cost tokens.

import { dataUrlMediaType, dataUrlToBase64, readScreenshotFile, type UploadedScreenshot } from '@/lib/ai/imageUtils';
import { resolveAssetRef } from '@/lib/mcp/assetStore';
import type { AgentImage } from './types';

export function screenshotToImage(shot: UploadedScreenshot): AgentImage {
  return { mediaType: dataUrlMediaType(shot.aiDataUrl), data: dataUrlToBase64(shot.aiDataUrl) };
}

/**
 * Read a stored asset back and shrink it for Claude. The Agent panel stores an
 * attachment before it sends, from whichever window it is in; the editor window
 * reads it here from the shared IndexedDB.
 */
export async function assetToImage(ref: string, fileName: string): Promise<AgentImage> {
  const dataUrl = await resolveAssetRef(ref);
  const blob = await (await fetch(dataUrl)).blob();
  const shot = await readScreenshotFile(new File([blob], fileName || 'image.png', { type: blob.type || 'image/png' }));
  return screenshotToImage(shot);
}
