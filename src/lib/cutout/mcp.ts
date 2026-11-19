// The background remover for the agents and MCP clients: remove_background,
// list_my_images, save_to_my_images and delete_my_image
// (src/lib/mcp/desktopMcpServer.ts). The layout's MCP api calls these, which
// keeps the MCP module's own imports as they were (the CLI lists its tools by
// loading that module in Node).

import { withBasePath } from '@/lib/basePath';
import { ASSET_REF_PREFIX, assetIdFromRef, getMediaAsset } from '@/lib/mediaStore';
import { downloadCutoutModel, getCutoutStatus } from './engine';
import { addLibraryImageFromMedia, deleteLibraryImage, getLibraryImage, listLibraryImages, markLibraryImagePlaced, refOf, type LibraryImageRow } from './library';
import { addPictureBlob } from './add';
import { cutPictureFile } from './queue';
import { encodeRgba } from './picture';
import { db } from '@/database';

export interface McpMyImage {
  id: string;
  name: string;
  /** Pass this as imageSrc. Null while the picture is still being cut. */
  ref: string | null;
  width?: number;
  height?: number;
  state: LibraryImageRow['state'];
  /** How the background was removed, when it was. */
  engine?: string;
  createdAt: string;
}

export interface McpCutout {
  ref: string;
  width: number;
  height: number;
  engine: string;
  myImageId?: string;
  replaced?: { artboardId: string; elementId: string };
  note?: string;
}

function summarize(row: LibraryImageRow): McpMyImage {
  return {
    id: row.id,
    name: row.name,
    ref: row.state === 'ready' || row.state === 'plain' ? refOf(row) : null,
    width: row.width,
    height: row.height,
    state: row.state,
    engine: row.engine,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function listMyImagesForMcp(): Promise<McpMyImage[]> {
  const rows = await listLibraryImages();
  // The refs go to an agent, which may place them: see markLibraryImagePlaced.
  for (const row of rows) if (!row.placed && refOf(row) && (row.state === 'ready' || row.state === 'plain')) await markLibraryImagePlaced(row.id);
  return rows.map(summarize);
}

/** A picture from an asset ref, a data: URL, an http(s) link or a path the app serves. */
export async function pictureFromSource(source: string): Promise<Blob> {
  const trimmed = source.trim();
  if (!trimmed) throw new Error('source must be an asset ref, a data: URL or an image link');
  if (trimmed.startsWith(ASSET_REF_PREFIX)) {
    const asset = await getMediaAsset(assetIdFromRef(trimmed));
    if (!asset) throw new Error(`No asset "${assetIdFromRef(trimmed)}". Call list_assets or list_my_images for a ref that exists.`);
    return asset.blob;
  }
  const url = trimmed.startsWith('/') ? withBasePath(trimmed) : trimmed;
  if (!/^(data:|https?:|blob:|\/)/i.test(url)) throw new Error('source must be an asset ref, a data: URL or an http(s) image link');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`That picture could not be fetched (HTTP ${response.status})`);
  return response.blob();
}

export async function saveToMyImagesForMcp(input: { source: string; name?: string }): Promise<McpMyImage> {
  const blob = await pictureFromSource(input.source);
  const row = await addPictureBlob(blob, input.name?.trim() || 'Picture', { cut: false });
  await markLibraryImagePlaced(row.id);
  return summarize(row);
}

export async function deleteMyImageForMcp(id: string): Promise<boolean> {
  const row = await getLibraryImage(id);
  if (!row || row.deletedAt) return false;
  await deleteLibraryImage(id);
  return true;
}

export interface ElementPicture {
  boardId: string;
  elementId: string;
  src: string;
  name?: string;
}

/**
 * Cuts the subject out. `findImage` reads an image element from the newest
 * document and `replaceImage` writes the cut into it (the layout supplies
 * both), so an element changed while the cut ran is never overwritten.
 */
export async function removeBackgroundForMcp(
  input: { source?: string; elementId?: string; artboardId?: string; name?: string; trim?: boolean; saveToMyImages?: boolean; download?: boolean },
  host: {
    findImage: (elementId: string, artboardId?: string) => ElementPicture;
    replaceImage: (target: ElementPicture, ref: string, detail: string) => { artboardId: string; elementId: string };
  }
): Promise<McpCutout> {
  const target = input.elementId ? host.findImage(input.elementId, input.artboardId) : null;
  const source = target?.src ?? input.source;
  if (!source) throw new Error('Pass source (a picture) or elementId (an image element)');
  const blob = await pictureFromSource(source);
  // In place the picture keeps its frame, so the subject stays where it was.
  const trim = target ? false : input.trim !== false;
  const status = getCutoutStatus();
  const modelHere = status.phase === 'ready';
  const files = await cutPictureFile(blob, { settings: { trim }, download: !!input.download }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as { stopped?: boolean })?.stopped) throw error;
    // A tool call does not wait minutes for a download: it starts it and says
    // to call again. The panel's button already waited for it.
    if (modelHere || input.download) throw new Error(message);
    const currentStatus = getCutoutStatus();
    if (!currentStatus.model && currentStatus.error) throw new Error(currentStatus.error);
    void downloadCutoutModel({ automatic: true }).catch(() => undefined);
    throw new Error('The cut-out model is downloading for the first time. Call remove_background again in a minute or two.');
  });
  const name = input.name?.trim() || target?.name || 'Cut-out';
  let myImageId: string | undefined;
  const mediaId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.media.put({ id: mediaId, blob: files.picture, name, mimeType: 'image/png', width: files.width, height: files.height, createdAt: new Date() });
  const ref = `asset:${mediaId}`;
  if (input.saveToMyImages !== false) {
    const source = await encodeRgba(files.source.rgba, files.source.width, files.source.height, files.source.hasAlpha ? 'image/png' : 'image/jpeg', 0.92);
    const row = await addLibraryImageFromMedia({
      name,
      mediaId,
      width: files.width,
      height: files.height,
      thumb: files.thumb,
      engine: files.engine,
      placed: true,
      cut: {
        source,
        sourceWidth: files.source.width,
        sourceHeight: files.source.height,
        mask: files.mask,
        settings: files.settings,
        rect: files.rect,
      },
    });
    myImageId = row.id;
  }
  const replaced = target ? host.replaceImage(target, ref, name) : undefined;
  const notes: string[] = [];
  if (!modelHere && files.engine === 'vision') {
    notes.push("Cut with the Mac's own subject cut-out. For sharper edges on hair and fine detail, the user can download the cut-out model in Remove background.");
  }
  if (files.engine === 'existing') notes.push('The picture already had a transparent background, so it was kept as it was.');
  return {
    ref,
    width: files.width,
    height: files.height,
    engine: files.engine,
    ...(myImageId ? { myImageId } : {}),
    ...(replaced ? { replaced } : {}),
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}
