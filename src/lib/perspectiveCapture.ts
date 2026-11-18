// Perspective in exported PNGs on WebKit.
//
// A capture is painted from an SVG <foreignObject> image (see exportRaster.ts),
// and an image is painted in software. WebKit's software painter keeps only
// the affine part of a transform: it drops the perspective row, so a
// perspective phone or a tilted picture comes out as a flat parallelogram in
// every PNG the Mac app exports, while the same board looks right on screen,
// where the GPU draws it. Measured 2026-11-18 in a real WKWebView and in
// Playwright's WebKit: matrix3d() homographies, perspective() + rotateY(), and
// a parent's `perspective` with a rotated child all lose it. Chromium keeps it.
//
// So where the engine loses it, each element whose plane is bent by
// perspective is captured flat on its own, warped by its exact 4x4 transform
// on the GPU (WebGL interpolates texture coordinates with the perspective
// divide, so the warp is exact rather than a mesh approximation), and the
// picture takes the element's place in the serialized capture. The live board
// is never touched beyond a marker attribute: the capture used to blow the
// live node up in place, which is the issue #19 glitch.

import type { Options } from 'html-to-image/lib/types';
import {
  IDENTITY,
  bendsPlane,
  elementPlaneTransform,
  parseCssTransform,
  planeScale,
  warpQuad,
  type Matrix4,
  type ParentPerspective,
  type WarpQuad,
} from '@/lib/perspectiveWarp';

const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;charset=utf-8,';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const MARKER = 'data-osg-warp';
// Room around an element for what it paints outside its own box: the device
// frame's drop shadow reaches about 16px.
const PAD = 48;
// Largest side and area of a raster made here. A board-sized phone at the
// export's density fits easily; these only stop a runaway.
const MAX_SIDE = 8192;
const MAX_AREA = 48_000_000;

/** One element's warped picture, waiting to replace it in the capture. */
export interface PerspectiveWarp {
  id: string;
  dataUrl: string;
  /** The picture's box inside the element's padding box, in CSS px. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The element becomes a positioned box when it was static. */
  makePositioned: boolean;
}

export interface PreparedWarps {
  warps: PerspectiveWarp[];
  /** Takes the marker attributes back off the live elements. */
  release: () => void;
}

type Capture = (node: HTMLElement, options: Options) => Promise<string>;

let probe: Promise<boolean> | null = null;

/**
 * Whether this engine drops perspective when it paints a capture. Answered
 * once by painting a square turned away from the viewer through the same SVG
 * image path. In perspective its near side is taller than its far side. What
 * WebKit paints instead is symmetric end to end (a parallelogram, measured as
 * column heights 38 to 48 and back to 38), so the two ends come out the same
 * height. Any failure answers no, which leaves captures exactly as they were.
 */
export function captureLosesPerspective(): Promise<boolean> {
  if (probe) return probe;
  probe = (async () => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return false;
    // A 48px square in the middle of a 96px picture, so its near side is not
    // cut off by the edge.
    const size = 96;
    const markup =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<foreignObject width="100%" height="100%"><div xmlns="${XHTML_NS}" ` +
      'style="width:48px;height:48px;margin:24px;background:#000;transform:perspective(48px) rotateY(55deg)"></div>' +
      `</foreignObject></svg>`;
    const image = await loadImage(SVG_DATA_URL_PREFIX + encodeURIComponent(markup));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, size, size).data;
    const heights: number[] = [];
    for (let x = 0; x < size; x++) {
      let run = 0;
      for (let y = 0; y < size; y++) if (pixels[(y * size + x) * 4 + 3] > 127) run++;
      if (run) heights.push(run);
    }
    // Nothing painted means the probe itself failed: keep the old path.
    if (heights.length < 6) return false;
    const third = Math.floor(heights.length / 3);
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.abs(mean(heights.slice(0, third)) - mean(heights.slice(-third))) < 2;
  })().catch(() => false);
  return probe;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'sync';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A picture for the export could not be read.'));
    image.src = src;
  });
}

function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** A computed two- or three-value origin, in px. Percentages resolve against the box. */
function originOf(value: string, width: number, height: number): { x: number; y: number; z: number } {
  const parts = value.trim().split(/\s+/);
  const resolve = (part: string | undefined, size: number) =>
    !part ? size / 2 : part.endsWith('%') ? (px(part) / 100) * size : px(part);
  return { x: resolve(parts[0], width), y: resolve(parts[1], height), z: px(parts[2] || '0') };
}

/** The element's border box inside its parent's border box. */
function offsetInParent(element: HTMLElement, parent: HTMLElement, view: Window): { x: number; y: number } {
  if (element.offsetParent === parent) {
    const style = view.getComputedStyle(parent);
    return { x: element.offsetLeft + px(style.borderLeftWidth), y: element.offsetTop + px(style.borderTopWidth) };
  }
  if (element.offsetParent && element.offsetParent === parent.offsetParent) {
    return { x: element.offsetLeft - parent.offsetLeft, y: element.offsetTop - parent.offsetTop };
  }
  return { x: 0, y: 0 };
}

function parentPerspectiveOf(element: HTMLElement, view: Window): ParentPerspective | null {
  const parent = element.parentElement;
  if (!parent) return null;
  const style = view.getComputedStyle(parent);
  const distance = style.perspective && style.perspective !== 'none' ? px(style.perspective) : 0;
  if (!(distance > 0)) return null;
  const origin = originOf(style.perspectiveOrigin || '50% 50%', parent.offsetWidth, parent.offsetHeight);
  const offset = offsetInParent(element, parent, view);
  return { distance, originX: origin.x, originY: origin.y, offsetX: offset.x, offsetY: offset.y };
}

/** Whether html-to-image will copy this element at all, under the caller's filter. */
function included(element: HTMLElement, root: HTMLElement, filter: Options['filter']): boolean {
  if (!filter) return true;
  for (let node: HTMLElement | null = element; node && node !== root; node = node.parentElement) {
    if (!filter(node)) return false;
  }
  return true;
}

/** The outermost elements under root whose own plane is bent by perspective. */
function findBentElements(root: HTMLElement, filter: Options['filter']): { element: HTMLElement; plane: Matrix4 }[] {
  const view = root.ownerDocument.defaultView || window;
  const found: { element: HTMLElement; plane: Matrix4 }[] = [];
  for (const node of Array.from(root.querySelectorAll('*'))) {
    if (!(node instanceof view.HTMLElement)) continue;
    // Inside one already found: it is painted as part of that one.
    if (found.some((f) => f.element.contains(node))) continue;
    const style = view.getComputedStyle(node);
    const transform = parseCssTransform(style.transform);
    if (!transform) continue;
    if (!node.offsetWidth || !node.offsetHeight) continue;
    const origin = originOf(style.transformOrigin, node.offsetWidth, node.offsetHeight);
    const plane = elementPlaneTransform(transform, origin, parentPerspectiveOf(node, view));
    if (!bendsPlane(plane)) continue;
    if (!included(node, root, filter)) continue;
    found.push({ element: node, plane });
  }
  return found;
}

/** How much the element's ancestors up to the capture root scale it. */
function ancestorScale(element: HTMLElement, root: HTMLElement, view: Window): number {
  let scale = 1;
  for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
    scale *= planeScale(parseCssTransform(view.getComputedStyle(node).transform) || IDENTITY);
  }
  return scale;
}

const VERTEX_SHADER = `
attribute vec4 aPosition;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  gl_Position = aPosition;
  vUv = aUv;
}`;

const FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPicture;
void main() {
  gl_FragColor = texture2D(uPicture, vUv);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/**
 * Draw `picture` (the flat capture, covering the padded box) onto a canvas of
 * the warped quad's bounding box at `ratio` pixels per CSS px. Each corner goes
 * to the GPU with its own w, so the GPU's perspective divide places the pixels
 * between the corners exactly where CSS would. Returns a PNG data URL, or null
 * when WebGL is not available.
 */
function warpPicture(picture: HTMLImageElement, quad: WarpQuad, ratio: number): string | null {
  const width = Math.max(1, Math.ceil(quad.width * ratio));
  const height = Math.max(1, Math.ceil(quad.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  }) as WebGLRenderingContext | null;
  if (!gl) return null;
  try {
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    let source: TexImageSource = picture;
    const longest = Math.max(picture.naturalWidth, picture.naturalHeight);
    if (longest > maxTexture) {
      const k = maxTexture / longest;
      const smaller = document.createElement('canvas');
      smaller.width = Math.floor(picture.naturalWidth * k);
      smaller.height = Math.floor(picture.naturalHeight * k);
      smaller.getContext('2d')?.drawImage(picture, 0, 0, smaller.width, smaller.height);
      source = smaller;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    // x, y, z, w, u, v per corner, corners in the quad's order.
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const data = new Float32Array(24);
    quad.corners.forEach((corner, i) => {
      const sx = (corner.x / corner.w - quad.left) * ratio;
      const sy = (corner.y / corner.w - quad.top) * ratio;
      const nx = (sx / width) * 2 - 1;
      const ny = 1 - (sy / height) * 2;
      data.set([nx * corner.w, ny * corner.w, 0, corner.w, uv[i][0], uv[i][1]], i * 6);
    });
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    const coordinate = gl.getAttribLocation(program, 'aUv');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 4, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(coordinate);
    gl.vertexAttribPointer(coordinate, 2, gl.FLOAT, false, 24, 16);

    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Premultiplied, so linear filtering at a transparent edge does not pull in
    // the black of the transparent pixels around it.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'uPicture'), 0);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    return canvas.toDataURL('image/png');
  } finally {
    // One context per warp, given back at once: a page only gets a handful.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

async function warpElement(
  element: HTMLElement,
  plane: Matrix4,
  root: HTMLElement,
  options: Options,
  density: number,
  capture: Capture,
  id: string
): Promise<PerspectiveWarp | null> {
  const view = root.ownerDocument.defaultView || window;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const quad = warpQuad(plane, -PAD, -PAD, width + 2 * PAD, height + 2 * PAD);
  if (!quad) return null;

  let ratio = Math.min(4, Math.max(0.25, density * ancestorScale(element, root, view)));
  ratio = Math.min(ratio, MAX_SIDE / Math.max(quad.width, quad.height), Math.sqrt(MAX_AREA / (quad.width * quad.height)));
  const flatWidth = width + 2 * PAD;
  const flatHeight = height + 2 * PAD;
  let flatRatio = ratio * 1.25;
  flatRatio = Math.min(flatRatio, MAX_SIDE / Math.max(flatWidth, flatHeight), Math.sqrt(MAX_AREA / (flatWidth * flatHeight)));

  // The element on its own, flat: its own transform replaced by a shift into
  // the padded box. Everything it paints (background, shadow, opacity,
  // filter, clipping) is in this picture, which is why the capture below
  // strips those from its stand-in.
  // The caller's sizing, ground colour and style describe the board, not this
  // element, so only the rest (fonts, filter, cache settings) carries over.
  const shared: Options = { ...options };
  delete shared.width;
  delete shared.height;
  delete shared.canvasWidth;
  delete shared.canvasHeight;
  delete shared.backgroundColor;
  delete shared.style;
  const flatUrl = await capture(element, {
    ...shared,
    width: flatWidth,
    height: flatHeight,
    pixelRatio: flatRatio,
    style: {
      // html-to-image also sets the copy's own width and height to the
      // capture's (applyStyle), which would grow the element to the padded
      // size; `style` is applied after that, so its real size goes back here.
      width: `${width}px`,
      height: `${height}px`,
      position: 'relative',
      left: '0px',
      top: '0px',
      right: 'auto',
      bottom: 'auto',
      margin: '0px',
      transform: `translate(${PAD}px, ${PAD}px)`,
      transformOrigin: '0px 0px',
      transformStyle: 'flat',
      perspective: 'none',
      backfaceVisibility: 'visible',
      willChange: 'auto',
    },
  });
  const picture = await loadImage(flatUrl);
  const dataUrl = warpPicture(picture, quad, ratio);
  if (!dataUrl) return null;

  const style = view.getComputedStyle(element);
  return {
    id,
    dataUrl,
    left: quad.left - px(style.borderLeftWidth),
    top: quad.top - px(style.borderTopWidth),
    width: Math.ceil(quad.width * ratio) / ratio,
    height: Math.ceil(quad.height * ratio) / ratio,
    makePositioned: style.position === 'static',
  };
}

let captures = 0;

/**
 * Warp every perspective element under `root` ahead of its capture, when this
 * engine needs it, and mark each one so applyPerspectiveWarps can find its
 * copy in the serialized capture. `density` is the capture's pixels per CSS px.
 * A warp that fails leaves its element as it was.
 */
export async function preparePerspectiveWarps(
  root: HTMLElement,
  options: Options,
  density: number,
  capture: Capture
): Promise<PreparedWarps> {
  const none: PreparedWarps = { warps: [], release: () => {} };
  if (typeof document === 'undefined') return none;
  if (!(await captureLosesPerspective())) return none;
  const bent = findBentElements(root, options.filter);
  if (!bent.length) return none;

  const token = `c${++captures}`;
  const warps: PerspectiveWarp[] = [];
  const marked: HTMLElement[] = [];
  for (let i = 0; i < bent.length; i++) {
    const { element, plane } = bent[i];
    try {
      const warp = await warpElement(element, plane, root, options, density, capture, `${token}-${i}`);
      if (!warp) continue;
      element.setAttribute(MARKER, warp.id);
      marked.push(element);
      warps.push(warp);
    } catch (error) {
      console.warn('Could not prepare a perspective element for export', error);
    }
  }
  return {
    warps,
    release: () => {
      for (const element of marked) element.removeAttribute(MARKER);
    },
  };
}

// What the flat picture already painted, taken off the element's copy so it
// is not painted twice, plus whatever made it 3D. Layout properties stay, so
// the copy keeps its place and size.
const STAND_IN_STYLE = [
  'transform:none',
  'perspective:none',
  'transform-style:flat',
  'overflow:visible',
  'filter:none',
  'opacity:1',
  'box-shadow:none',
  'background:none',
  'border-color:transparent',
  'outline:none',
  'clip-path:none',
  'mask:none',
  '-webkit-mask:none',
  'backdrop-filter:none',
  '-webkit-backdrop-filter:none',
].join(';');

/**
 * Put each warped picture in place of its element in a serialized capture.
 * Returns null when the markup is not what html-to-image makes, so the caller
 * keeps the capture it had.
 */
export function applyPerspectiveWarps(svgDataUrl: string, warps: PerspectiveWarp[]): string | null {
  if (!warps.length) return svgDataUrl;
  if (!svgDataUrl.startsWith(SVG_DATA_URL_PREFIX)) return null;
  const markup = decodeURIComponent(svgDataUrl.slice(SVG_DATA_URL_PREFIX.length));
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  let placed = 0;
  for (const warp of warps) {
    const copy = doc.querySelector(`[${MARKER}="${warp.id}"]`);
    if (!copy) continue;
    copy.removeAttribute(MARKER);
    const extra = warp.makePositioned ? `${STAND_IN_STYLE};position:relative` : STAND_IN_STYLE;
    copy.setAttribute('style', `${copy.getAttribute('style') || ''};${extra}`);
    while (copy.firstChild) copy.removeChild(copy.firstChild);
    const picture = doc.createElementNS(XHTML_NS, 'img');
    picture.setAttribute('src', warp.dataUrl);
    picture.setAttribute('alt', '');
    picture.setAttribute(
      'style',
      `position:absolute;left:${warp.left}px;top:${warp.top}px;width:${warp.width}px;height:${warp.height}px;` +
        'max-width:none;max-height:none;margin:0;padding:0;border:0;display:block'
    );
    copy.appendChild(picture);
    placed++;
  }
  if (!placed) return svgDataUrl;
  return SVG_DATA_URL_PREFIX + encodeURIComponent(new XMLSerializer().serializeToString(doc));
}
