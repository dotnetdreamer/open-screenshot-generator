/**
 * What the top edge of a header is made of.
 *
 * On an iPhone the header art starts under the status bar, and the strip above
 * it takes the colour of the art's top edge. The store listing preview draws
 * that strip by stretching the top row of the art, and for one row of pixels
 * it draws the art again with only the layers that reach that row.
 *
 * The ground alone is not enough. A picture laid over a white artboard as a
 * layer is the top edge of that art, and a strip cut from the ground would
 * come out white above it.
 */

import type { ArtboardElement, ArtboardState, DeviceFrameElementProps, ShapeElementProps } from '@/types/artboard';
import { isDevice3dStyle } from '@/lib/devicePerspective';
import { boundsOf } from './check';
import type { PixelRect } from './specs';

/**
 * Layers that cost too much to draw a second time for one row of pixels: a 3D
 * device spends a WebGL context, a video a decoder. A sound has nothing to draw.
 */
function costly(layer: ArtboardElement): boolean {
  if (layer.type === 'video' || layer.type === 'video-device' || layer.type === 'audio') return true;
  return layer.type === 'device' && isDevice3dStyle((layer as DeviceFrameElementProps).styleType);
}

export interface HeaderTopEdge {
  /** The board with only the layers that reach its top rows. */
  board: ArtboardState;
  /**
   * What sets the colour across the edge: the board's own `ground`, a
   * `picture` whose colour cannot be told without drawing it, or the fill of
   * the solid rectangle lying over it.
   */
  cover: 'ground' | 'picture' | { fill: string };
}

/**
 * The top `depth` pixels of a header, as far across as `shown`, which is the
 * part an iPhone shows. `cover` goes by the front-most layer that lies over at
 * least half of that width, because a logo in one corner does not change what
 * the status bar sits on.
 */
export function headerTopEdge(board: ArtboardState, shown: PixelRect, depth: number): HeaderTopEdge {
  const reaching = board.elements.filter((layer) => {
    if (costly(layer)) return false;
    const box = boundsOf(layer);
    return box.y < depth && box.y + box.height > 0 && box.x < shown.x + shown.width && box.x + box.width > shown.x;
  });
  let cover: HeaderTopEdge['cover'] = 'ground';
  for (const layer of reaching) {
    if (layer.type === 'text') continue;
    const box = boundsOf(layer);
    const across = Math.min(box.x + box.width, shown.x + shown.width) - Math.max(box.x, shown.x);
    if (across < shown.width / 2) continue;
    const shape = layer.type === 'shape' ? (layer as ShapeElementProps) : null;
    const flat =
      shape !== null &&
      shape.shapeType === 'rectangle' &&
      !shape.fillGradient &&
      !!shape.fillColor &&
      (shape.fillOpacity ?? 1) >= 0.95 &&
      (shape.opacity ?? 1) >= 0.95;
    cover = flat ? { fill: shape.fillColor } : 'picture';
  }
  return { board: { ...board, elements: reaching }, cover };
}
