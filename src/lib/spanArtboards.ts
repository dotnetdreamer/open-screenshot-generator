// Elements that carry on past the edge of their artboard onto the one beside
// it (BaseElement.spanArtboards).
//
// The artboards are treated as one strip: laid edge to edge in canvas order,
// with no gaps and their tops level, which is how a store listing shows the
// exported PNGs and the same model a spanned background picture uses
// (backgroundImageSlice). An element keeps its position relative to its own
// artboard. Where it lands on a neighbour is worked out here, at render time,
// from the artboard order and widths, so nothing about it is stored.
//
// The part on a neighbour is a span copy: the same element, moved into the
// neighbour's coordinates, drawn by the neighbour and clipped by it. Every
// render site draws them (the canvas, StaticArtboard, the video compositor),
// and the PNG export gets them for free because it rasterizes the canvas DOM.

import type { ArtboardElement, ArtboardState, ElementAnimation, Point, Size } from '@/types/artboard';
import { textOutlineReach } from '@/lib/textOutline';
import { POP_PEAK_SCALE, slideDistanceFor } from '@/lib/video/animation';
import { devicePerspectiveTransform, isDevice3dStyle } from '@/lib/devicePerspective';

/** A change to the two span settings of the selected elements; absent keys stay as they are. */
export interface SpanChange {
  spanArtboards?: boolean;
  spanBehind?: boolean;
}

/** True when this element continues onto neighbouring artboards. */
export function spansArtboards(element: ArtboardElement): boolean {
  // A sound has no box, so there is nothing of it to continue.
  return element.spanArtboards === true && element.type !== 'audio';
}

/** Where each artboard starts in the strip, in artboard pixels. */
export function artboardStripOffsets(boards: Pick<ArtboardState, 'size'>[]): number[] {
  const offsets: number[] = [];
  let x = 0;
  for (const board of boards) {
    offsets.push(x);
    x += board.size.width;
  }
  return offsets;
}

// --- what an element paints -------------------------------------------------
//
// A copy is drawn on every artboard the element can paint a pixel of, so this
// measures how far anything the element draws can reach: its box, its
// artwork's own transform, its effects and its animation. The estimates lean
// generous on purpose: a copy that turns out to be clipped away costs one
// render, while a copy left out loses real pixels at the seam.

/**
 * How far a CSS Gaussian reaches past what it blurs, in multiples of the
 * length the CSS was given. A drop-shadow's blur length is two standard
 * deviations and a blur() length is one, and a tail stays visible to roughly
 * three deviations, so three lengths covers both with room to spare.
 */
const GAUSSIAN_REACH = 3;

/** The drop-shadow every flat device frame casts from `.device-container` in globals.css: 0 2px 5px. */
const DEVICE_FRAME_SHADOW_REACH = 2 + 5 * GAUSSIAN_REACH;

/**
 * How far past its artwork an element's effects paint, in artboard pixels.
 *
 * The filters are composed (elementVisualStyle puts the blur after the drop
 * shadow, so it spreads the shadow as well), and a text outline widens the
 * glyphs both of them start from, so the reaches add up rather than the
 * largest one winning. A flat device frame also casts the small shadow its
 * container class gives it.
 */
export function paintOverspill(element: ArtboardElement): number {
  let pad = 0;
  if (element.shadow) {
    const { x = 0, y = 0, blur = 0 } = element.shadow;
    pad += Math.max(Math.abs(x), Math.abs(y)) + Math.max(0, blur) * GAUSSIAN_REACH;
  }
  if (typeof element.blur === 'number' && element.blur > 0) pad += element.blur * GAUSSIAN_REACH;
  if (element.type === 'text') pad += textOutlineReach(element);
  if (element.type === 'device' || element.type === 'video-device') pad += DEVICE_FRAME_SHADOW_REACH;
  return Math.ceil(pad);
}

/** Edges rather than x and width, so an edge can be infinite without NaN creeping in. */
export interface PaintRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What an element counts as painting when its transform cannot be evaluated: every artboard. */
const EVERYWHERE: PaintRect = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

/** A 4x4 transform in column-major order, the order CSS matrix3d() lists it in. */
type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a times b: the transform that applies b first, then a. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const translation = (x: number, y: number): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];

// The CSS transform functions the editor's artwork uses, as the CSS Transforms
// spec defines them.
function skewXMatrix(degrees: number): Matrix {
  const m = IDENTITY.slice();
  m[4] = Math.tan(toRadians(degrees));
  return m;
}
function skewYMatrix(degrees: number): Matrix {
  const m = IDENTITY.slice();
  m[1] = Math.tan(toRadians(degrees));
  return m;
}
function rotateXMatrix(degrees: number): Matrix {
  const c = Math.cos(toRadians(degrees));
  const s = Math.sin(toRadians(degrees));
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
function rotateYMatrix(degrees: number): Matrix {
  const c = Math.cos(toRadians(degrees));
  const s = Math.sin(toRadians(degrees));
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
function perspectiveMatrix(distance: number): Matrix {
  const m = IDENTITY.slice();
  m[11] = -1 / distance;
  return m;
}

/** A `matrix3d(...)` or `matrix(...)` string, or null for anything else. */
function parseCssMatrix(css: string): Matrix | null {
  const match = /^\s*(matrix3d|matrix)\(([^)]*)\)\s*$/i.exec(css);
  if (!match) return null;
  const values = match[2].split(',').map((value) => Number(value.trim()));
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (match[1].toLowerCase() === 'matrix3d') return values.length === 16 ? values : null;
  if (values.length !== 6) return null;
  const [a, b, c, d, e, f] = values;
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
}

/** ImageElement's `perspective: 1000px`, which its tilts are seen through. */
const IMAGE_VIEWER_DISTANCE = 1000;

/**
 * The transform an element's artwork carries inside its box, in box px from
 * the box's top-left: an image's skew and tilt, or a flat device frame's
 * perspective style. Both turn about the box centre. Null when the artwork
 * fills its box as drawn, 'unknown' for a transform this cannot evaluate.
 */
function artworkTransform(element: ArtboardElement, width: number, height: number): Matrix | null | 'unknown' {
  let inner: Matrix;
  let viewerDistance = 0;
  if (element.type === 'image') {
    const custom = element.matrix3d?.trim();
    if (custom) {
      if (custom === 'none') return null;
      const parsed = parseCssMatrix(custom);
      if (!parsed) return 'unknown';
      inner = parsed;
    } else {
      // In the order ImageElement lists them, which is the order CSS applies.
      const steps: Matrix[] = [];
      if (element.skewX) steps.push(skewXMatrix(element.skewX));
      if (element.skewY) steps.push(skewYMatrix(element.skewY));
      if (element.perspectiveX) steps.push(rotateXMatrix(element.perspectiveX));
      if (element.perspectiveY) steps.push(rotateYMatrix(element.perspectiveY));
      if (steps.length === 0) return null;
      inner = steps.reduce((combined, step) => multiply(combined, step));
    }
    viewerDistance = IMAGE_VIEWER_DISTANCE;
  } else if (element.type === 'device') {
    if (isDevice3dStyle(element.styleType)) return null;
    const css = devicePerspectiveTransform(element.styleType, element.matrix3d);
    if (css === 'none') return null;
    const parsed = parseCssMatrix(css);
    if (!parsed) return 'unknown';
    inner = parsed;
  } else {
    return null;
  }
  const seen = viewerDistance > 0 ? multiply(perspectiveMatrix(viewerDistance), inner) : inner;
  return multiply(multiply(translation(width / 2, height / 2), seen), translation(-width / 2, -height / 2));
}

/**
 * Where the box's corners land under a transform, as a rect in box px. Null
 * when a corner passes behind the viewer, where the projection has no edge.
 */
function transformedRect(m: Matrix, width: number, height: number): PaintRect | null {
  const rect: PaintRect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const [x, y] of [[0, 0], [width, 0], [width, height], [0, height]]) {
    const w = m[3] * x + m[7] * y + m[15];
    if (!(w > 1e-6)) return null;
    const px = (m[0] * x + m[4] * y + m[12]) / w;
    const py = (m[1] * x + m[5] * y + m[13]) / w;
    rect.left = Math.min(rect.left, px);
    rect.right = Math.max(rect.right, px);
    rect.top = Math.min(rect.top, py);
    rect.bottom = Math.max(rect.bottom, py);
  }
  return rect;
}

/** The upright rect a rect covers once turned about (cx, cy), the way CSS rotate() turns it. */
function rotatedRect(rect: PaintRect, cx: number, cy: number, degrees: number): PaintRect {
  if (degrees % 360 === 0) return rect;
  const cos = Math.cos(toRadians(degrees));
  const sin = Math.sin(toRadians(degrees));
  const out: PaintRect = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const [x, y] of [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]) {
    const dx = x - cx;
    const dy = y - cy;
    const px = cx + dx * cos - dy * sin;
    const py = cy + dx * sin + dy * cos;
    out.left = Math.min(out.left, px);
    out.right = Math.max(out.right, px);
    out.top = Math.min(out.top, py);
    out.bottom = Math.max(out.bottom, py);
  }
  return out;
}

/**
 * The farthest an element's enter or exit animation takes it from where it
 * rests: a slide's travel along its axis, and the scale a pop overshoots to.
 */
function animationReach(animation: ElementAnimation | undefined, slideDistance: number) {
  let x = 0;
  let y = 0;
  let scale = 1;
  for (const preset of [animation?.enter, animation?.exit]) {
    if (preset === 'slide-left' || preset === 'slide-right') x = slideDistance;
    else if (preset === 'slide-up' || preset === 'slide-down') y = slideDistance;
    else if (preset === 'pop') scale = POP_PEAK_SCALE;
  }
  return { x, y, scale };
}

/**
 * Everything an element can paint, in its own artboard's px: its box, wherever
 * its artwork's own transform pushes past the box, its shadow, blur and
 * outline, the rotation it carries, and the farthest its animation moves or
 * grows it. `slideDistance` is the travel of a slide on the element's own
 * artboard (slideDistanceFor its height).
 */
export function paintRect(element: ArtboardElement, slideDistance: number): PaintRect {
  const scale = element.scale || 1;
  const width = element.size.width * scale;
  const height = element.size.height * scale;
  const transform = artworkTransform(element, width, height);
  const artwork =
    transform === null
      ? { left: 0, top: 0, right: width, bottom: height }
      : transform === 'unknown'
        ? null
        : transformedRect(transform, width, height);
  if (!artwork) return EVERYWHERE;

  const pad = paintOverspill(element);
  const padded = {
    left: artwork.left - pad,
    top: artwork.top - pad,
    right: artwork.right + pad,
    bottom: artwork.bottom + pad,
  };
  // The box turns about its centre and takes its artwork and effects along.
  const cx = width / 2;
  const cy = height / 2;
  let rect = rotatedRect(padded, cx, cy, element.rotation || 0);

  // An animation scales about that same centre and slides in artboard space.
  const motion = animationReach(element.animation, slideDistance);
  if (motion.scale > 1) {
    rect = {
      left: cx + (rect.left - cx) * motion.scale,
      top: cy + (rect.top - cy) * motion.scale,
      right: cx + (rect.right - cx) * motion.scale,
      bottom: cy + (rect.bottom - cy) * motion.scale,
    };
  }
  return {
    left: element.position.x + rect.left - motion.x,
    top: element.position.y + rect.top - motion.y,
    right: element.position.x + rect.right + motion.x,
    bottom: element.position.y + rect.bottom + motion.y,
  };
}

/** One element as a neighbouring artboard draws it. */
export interface SpanCopy {
  /** Unique among one artboard's span copies. */
  key: string;
  /** The element moved into the drawing artboard's coordinates. */
  element: ArtboardElement;
  /** The element as its own artboard holds it. */
  source: ArtboardElement;
  /** The artboard the element belongs to. */
  sourceBoardId: string;
  /**
   * The size of that artboard. Its height sets how far the element's slide
   * animations travel, on every copy, so the halves move together even when
   * the artboards differ in height.
   */
  sourceSize: Size;
  /** Added to the source's x to get the copy's x. */
  shiftX: number;
}

/** Span copies one artboard draws, split by where they sit in its stack. */
export interface BoardSpill {
  /** Under every element of the artboard, above its background. */
  behind: SpanCopy[];
  /** Over every element of the artboard. */
  front: SpanCopy[];
}

/** Shared by every artboard nothing reaches, so the prop keeps one identity. */
export const NO_SPILL: BoardSpill = Object.freeze({ behind: [], front: [] }) as BoardSpill;

/**
 * Geometry a gesture in progress holds for one element, in its own artboard's
 * coordinates. Passed to computeSpill so a mockup being dragged over an edge
 * shows on the next artboard while the drag is still going.
 */
export interface SpanLiveBox {
  position: Point;
  size: ArtboardElement['size'];
  rotation: number;
  scale: number;
  /**
   * The artboard whose copy the pointer is holding. It keeps its copy for the
   * whole gesture even once the element has left it: unmounting the copy
   * would end the drag halfway.
   */
  originBoardId?: string;
}

// One copy object per (element object, shift), so an artboard the edit did not
// touch gets back the same copies and the elements drawing them keep their state.
const copyCache = new WeakMap<ArtboardElement, Map<number, ArtboardElement>>();

function shiftedCopy(element: ArtboardElement, shiftX: number): ArtboardElement {
  let byShift = copyCache.get(element);
  if (!byShift) {
    byShift = new Map();
    copyCache.set(element, byShift);
  }
  let copy = byShift.get(shiftX);
  if (!copy) {
    copy = { ...element, position: { x: element.position.x + shiftX, y: element.position.y } } as ArtboardElement;
    byShift.set(shiftX, copy);
  }
  return copy;
}

/** The element with a gesture's geometry in place of its stored one. */
function withLiveBox(stored: ArtboardElement, box: SpanLiveBox | undefined): ArtboardElement {
  return box
    ? ({ ...stored, position: box.position, size: box.size, rotation: box.rotation, scale: box.scale } as ArtboardElement)
    : stored;
}

/**
 * Indexes of the other artboards an element paints onto, plus the artboard a
 * gesture on it started from, which keeps its copy until the gesture ends.
 */
function reachedTargets(
  boards: ArtboardState[],
  offsets: number[],
  sourceIndex: number,
  element: ArtboardElement,
  keepBoardId: string | undefined
): number[] {
  const paint = paintRect(element, slideDistanceFor(boards[sourceIndex].size.height));
  const left = offsets[sourceIndex] + paint.left;
  const right = offsets[sourceIndex] + paint.right;
  const targets: number[] = [];
  boards.forEach((target, targetIndex) => {
    if (targetIndex === sourceIndex) return;
    const reaches =
      left < offsets[targetIndex] + target.size.width &&
      right > offsets[targetIndex] &&
      paint.top < target.size.height &&
      paint.bottom > 0;
    if (reaches || target.id === keepBoardId) targets.push(targetIndex);
  });
  return targets;
}

/**
 * The ids of the artboards that draw a copy of one element, optionally with a
 * gesture's geometry instead of the stored one. The canvas compares this
 * between pointer moves to learn when a drag starts or stops reaching an
 * artboard, which is the only time it has to re-render for one.
 */
export function reachedArtboardIds(boards: ArtboardState[], elementId: string, box?: SpanLiveBox): string[] {
  if (boards.length < 2) return [];
  const offsets = artboardStripOffsets(boards);
  for (let index = 0; index < boards.length; index++) {
    const stored = boards[index].elements.find((element) => element.id === elementId);
    if (!stored) continue;
    if (!spansArtboards(stored)) return [];
    return reachedTargets(boards, offsets, index, withLiveBox(stored, box), box?.originBoardId).map(
      (target) => boards[target].id
    );
  }
  return [];
}

/**
 * Every span copy in the project, keyed by the artboard that draws it.
 *
 * Artboards nothing reaches are left out of the map; read it with spillFor.
 * Copies on one artboard keep the order their sources have: artboards left to
 * right, then each artboard's own stack.
 */
export function computeSpill(
  boards: ArtboardState[],
  live?: ReadonlyMap<string, SpanLiveBox>
): Map<string, BoardSpill> {
  const result = new Map<string, BoardSpill>();
  if (boards.length < 2) return result;
  const offsets = artboardStripOffsets(boards);

  boards.forEach((board, sourceIndex) => {
    for (const stored of board.elements) {
      if (!spansArtboards(stored)) continue;
      const box = live?.get(stored.id);
      const element = withLiveBox(stored, box);
      // Entirely inside its own artboard, so there is nothing to carry over.
      // The cheap test first: almost every element takes this exit.
      if (!box) {
        const paint = paintRect(element, slideDistanceFor(board.size.height));
        if (paint.left >= 0 && paint.right <= board.size.width) continue;
      }

      for (const targetIndex of reachedTargets(boards, offsets, sourceIndex, element, box?.originBoardId)) {
        const target = boards[targetIndex];
        const shiftX = offsets[sourceIndex] - offsets[targetIndex];
        let spill = result.get(target.id);
        if (!spill) {
          spill = { behind: [], front: [] };
          result.set(target.id, spill);
        }
        (element.spanBehind ? spill.behind : spill.front).push({
          key: `${board.id}:${stored.id}`,
          // A live box is new on every move, so caching its copy would only
          // fill the cache with positions nobody asks for again.
          element: box
            ? ({ ...element, position: { x: element.position.x + shiftX, y: element.position.y } } as ArtboardElement)
            : shiftedCopy(stored, shiftX),
          source: stored,
          sourceBoardId: board.id,
          sourceSize: board.size,
          shiftX,
        });
      }
    }
  });

  return result;
}

/**
 * Every artboard each element shows on, its own first, for the elements that
 * reach at least one other. An element animates on all of them whenever any
 * one of them is previewing, so its halves never fall out of step.
 */
export function spanArtboardsByElement(spill: Map<string, BoardSpill>): Map<string, string[]> {
  const showing = new Map<string, string[]>();
  for (const [boardId, board] of spill) {
    for (const copy of [...board.behind, ...board.front]) {
      let list = showing.get(copy.source.id);
      if (!list) {
        list = [copy.sourceBoardId];
        showing.set(copy.source.id, list);
      }
      list.push(boardId);
    }
  }
  return showing;
}

/** What one artboard draws of its neighbours' elements. */
export function spillFor(spill: Map<string, BoardSpill> | null | undefined, boardId: string): BoardSpill {
  return spill?.get(boardId) ?? NO_SPILL;
}

/** One layer in paint order: either the artboard's own element or a span copy. */
export type PaintLayer =
  | { kind: 'own'; element: ArtboardElement }
  | { kind: 'span'; element: ArtboardElement; copy: SpanCopy };

/**
 * An artboard's layers, back to front: span copies drawn behind, the
 * artboard's own elements in their stack order, then span copies drawn in
 * front. Shared by every render site so they cannot stack them differently.
 */
export function paintLayers(elements: ArtboardElement[], spill: BoardSpill = NO_SPILL): PaintLayer[] {
  if (spill.behind.length === 0 && spill.front.length === 0) {
    return elements.map((element) => ({ kind: 'own', element }));
  }
  return [
    ...spill.behind.map((copy): PaintLayer => ({ kind: 'span', element: copy.element, copy })),
    ...elements.map((element): PaintLayer => ({ kind: 'own', element })),
    ...spill.front.map((copy): PaintLayer => ({ kind: 'span', element: copy.element, copy })),
  ];
}

/** A rectangle on screen, as getBoundingClientRect reports it. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
}

/**
 * A pointer position in one artboard's pixels, with the gaps the canvas leaves
 * between artboards taken out.
 *
 * The canvas draws the strip with a gap between artboards that the exported
 * set does not have, so the pointer and the artwork drift apart by one gap per
 * edge crossed if the screen distance is used as it is. Across an artboard
 * the mapping is the usual linear one; over a gap the pointer counts as being
 * on the edge, so a dragged element waits at the edge until the pointer
 * reaches the next artboard and then picks up exactly where it is. Past the
 * first and the last artboard it carries on in a straight line.
 *
 * `rects` and `widths` describe every artboard in canvas order; `index` picks
 * the artboard whose pixels the answer is in.
 */
export function stripPointFromClient(
  client: Point,
  rects: ScreenRect[],
  widths: number[],
  index: number
): Point | null {
  if (rects.length === 0 || rects.length !== widths.length) return null;
  const own = rects[index];
  if (!own || !(widths[index] > 0) || !(own.width > 0)) return null;
  const offsets: number[] = [];
  let run = 0;
  for (const width of widths) {
    offsets.push(run);
    run += width;
  }
  // Screen pixels per artboard pixel, per artboard. Every artboard is drawn at
  // the same scale, but the mapping does not rely on it.
  const scaleOf = (i: number) => (widths[i] > 0 && rects[i].width > 0 ? rects[i].width / widths[i] : own.width / widths[index]);
  const along = (i: number) => offsets[i] + (client.x - rects[i].left) / scaleOf(i);

  const last = rects.length - 1;
  let stripX: number;
  if (client.x < rects[0].left) {
    stripX = along(0);
  } else if (client.x >= rects[last].left + rects[last].width) {
    stripX = along(last);
  } else {
    stripX = along(last);
    for (let i = 0; i <= last; i++) {
      const right = rects[i].left + rects[i].width;
      if (client.x < right) {
        stripX = along(i);
        break;
      }
      const next = rects[i + 1];
      if (next && client.x < next.left) {
        stripX = offsets[i + 1];
        break;
      }
    }
  }

  return {
    x: stripX - offsets[index],
    y: (client.y - own.top) / (own.width / widths[index]),
  };
}
