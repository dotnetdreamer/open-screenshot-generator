/**
 * An icon export from start to finish: the plan's pictures drawn from the
 * captures, its text written, the .icns put together, and the lot packed for
 * where it goes (a zip, a folder, or an app's own project; see projectWrite.ts
 * for the last two).
 */

import { ICNS_ENTRIES, type PlannedFile } from './exportPlan';
import { buildIcns } from './icns';
import { drawRecipe, encodePng, type IconCaptures, type RecipeOptions } from './raster';
import { buildZip } from './zip';

export interface IconFile {
  /** Inside the export's folder, with forward slashes. */
  path: string;
  bytes: Uint8Array;
}

/** A pause for the page between pictures, so the progress line can move. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Thrown when the user stops an export while its files are still being made. Nothing has been saved by then. */
export class ExportStopped extends Error {
  constructor() {
    super('The export was stopped.');
    this.name = 'ExportStopped';
  }
}

export async function renderIconFiles(
  plan: readonly PlannedFile[],
  captures: IconCaptures,
  options: RecipeOptions,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean
): Promise<IconFile[]> {
  const encoder = new TextEncoder();
  const files: IconFile[] = [];
  // The Mac pictures by pixel size, for the .icns that follows them.
  const macPngs = new Map<number, Uint8Array>();
  for (let index = 0; index < plan.length; index++) {
    if (shouldStop?.()) throw new ExportStopped();
    const planned = plan[index];
    if (planned.text !== undefined) {
      files.push({ path: planned.path, bytes: encoder.encode(planned.text) });
    } else if (planned.recipe) {
      const { canvas, noAlpha } = drawRecipe(planned.recipe, captures, options);
      const bytes = await encodePng(canvas, noAlpha);
      if (planned.recipe.kind === 'mac') macPngs.set(planned.recipe.size, bytes);
      files.push({ path: planned.path, bytes });
    } else if (planned.icns) {
      const entries = ICNS_ENTRIES.flatMap((entry) => {
        const png = macPngs.get(entry.pixels);
        return png ? [{ type: entry.type, png }] : [];
      });
      files.push({ path: planned.path, bytes: buildIcns(entries) });
    }
    onProgress?.(index + 1, plan.length);
    await breathe();
  }
  return files;
}

/** The files in one zip, under one folder, so unzipping it makes that folder. */
export function zipIconFiles(folder: string, files: readonly IconFile[]): Blob {
  const bytes = buildZip(files.map((file) => ({ path: `${folder}/${file.path}`, bytes: file.bytes })));
  return new Blob([bytes], { type: 'application/zip' });
}
