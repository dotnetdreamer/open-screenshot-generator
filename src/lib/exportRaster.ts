// The one place a live artboard turns into PNG bytes, and the WebKit fix every
// export path needs.
//
// html-to-image rasterizes by cloning the node, inlining every image it finds
// as a data: URL, serializing the clone into an <svg><foreignObject>, handing
// that SVG to an <img>, and drawing the image onto a canvas. So every raster in
// a board reaches the canvas as a data: subresource of that SVG: template
// photos, uploaded screenshots, and the 3D device too, because html-to-image
// clones a <canvas> as an <img> of canvas.toDataURL().
//
// WebKit paints an SVG-as-image without waiting for those subresources to
// decode (https://bugs.webkit.org/show_bug.cgi?id=39059, open since 2010), and
// nothing reports the loss. In the macOS desktop app, which is a WKWebView, the
// exported PNG therefore came out with the text, the gradients and the CSS
// device chrome intact and *every photo missing*: hollow device screens, no
// background art, no 3D device. The board on screen stayed correct, so the only
// way to notice was to open the file.
//
// Marking each embedded image `decoding="sync"` makes WebKit decode it before
// it paints, which is a fix rather than a delay. It has to be done on the
// serialized markup: the images that go missing include ones html-to-image
// mints itself (the 3D canvas), which never exist on the live board. Measured
// in a WKWebView on macOS 26 at 1290x2796, cold caches, photo + screenshot +
// WebGL canvas: unpatched loses all three on every attempt, patched captures
// all three on the first pass. Chromium never had the bug; the hint costs it
// nothing.
//
// Every raster an artboard can hold today arrives as an <img>, which is why one
// attribute covers a whole board. A raster reached through CSS instead
// (background-image: url(...), mask-image) carries no decoding attribute and
// would quietly reopen the hole on macOS, so keep artboard art in elements.

import { toPng, toSvg } from 'html-to-image';
import type { Options } from 'html-to-image/lib/types';
import { resolveFontEmbedCss } from '@/lib/fontEmbed';
import { encodeOpaquePngDataUrl } from '@/lib/pngOpaque';

/** Exactly what html-to-image's toSvg returns. Anything else and we bail. */
const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;charset=utf-8,';

/** html-to-image's own ceiling, so an oversized capture degrades identically. */
const CANVAS_DIMENSION_LIMIT = 16384;

/**
 * Rewrite the serialized capture so every embedded image decodes before the
 * SVG paints. Returns null when the markup is not the shape we expect, so the
 * caller can fall back to plain toPng instead of exporting something mangled.
 */
function withSyncImageDecoding(svgDataUrl: string): string | null {
  if (!svgDataUrl.startsWith(SVG_DATA_URL_PREFIX)) return null;
  const markup = decodeURIComponent(svgDataUrl.slice(SVG_DATA_URL_PREFIX.length));
  // Scoped to the <img> start tag, never to the document as a whole:
  // XMLSerializer escapes a quote inside an attribute value but NOT inside
  // text, so a board whose copy quotes something would have that text deleted
  // from the PNG, and an odd number of quotes in text would splice the markup
  // into invalid XML and lose the capture outright. The attribute run steps
  // over quoted values (which may legally hold a `>`) and stops at the first
  // bare `>`.
  const patched = markup.replace(
    /<img\b((?:[^>"]|"[^"]*")*)/g,
    // Strip before adding: next/image writes decoding="async" and so does
    // html-to-image's canvas clone, and a duplicate attribute is an XML parse
    // error, which would fail the whole capture rather than one image.
    (_match, attributes: string) =>
      `<img decoding="sync"${attributes.replace(/\sdecoding="[^"]*"/g, '')}`
  );
  return SVG_DATA_URL_PREFIX + encodeURIComponent(patched);
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Same reason as the patch above, one level up: decode the capture before
    // it is drawn, not while it is being drawn.
    image.decoding = 'sync';
    image.loading = 'eager';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The capture could not be rasterized.'));
    image.src = url;
  });
}

// html-to-image's getNodeWidth/getNodeHeight. Only reached when a caller omits
// the size, and it has to agree with the viewport toSvg gave the capture:
// offsetWidth would disagree by the scrollbar and stretch the render.
function borderPx(node: HTMLElement, property: string): number {
  const view = node.ownerDocument.defaultView || window;
  const value = view.getComputedStyle(node).getPropertyValue(property);
  return value ? parseFloat(value.replace('px', '')) : 0;
}

function nodeWidth(node: HTMLElement): number {
  return node.clientWidth + borderPx(node, 'border-left-width') + borderPx(node, 'border-right-width');
}

function nodeHeight(node: HTMLElement): number {
  return node.clientHeight + borderPx(node, 'border-top-width') + borderPx(node, 'border-bottom-width');
}

/** html-to-image's checkCanvasDimensions, so a huge capture clamps the same way. */
function clampCanvas(canvas: HTMLCanvasElement): void {
  const { width, height } = canvas;
  if (width <= CANVAS_DIMENSION_LIMIT && height <= CANVAS_DIMENSION_LIMIT) return;
  if (width > height) {
    canvas.height = Math.round(height * (CANVAS_DIMENSION_LIMIT / width));
    canvas.width = CANVAS_DIMENSION_LIMIT;
  } else {
    canvas.width = Math.round(width * (CANVAS_DIMENSION_LIMIT / height));
    canvas.height = CANVAS_DIMENSION_LIMIT;
  }
}

/**
 * Resolve the node's web fonts here rather than leaving it to html-to-image.
 *
 * Its own pass cannot read a cross-origin stylesheet, and what it does instead
 * is download every font file the whole sheet mentions, for every capture: the
 * app's Google Fonts sheet turned one export into thousands of parallel woff2
 * requests and a wall of net::ERR_INSUFFICIENT_RESOURCES. See fontEmbed.ts.
 *
 * A caller that already has the CSS (videoExport resolves it once and reuses it
 * across dozens of sprites) passes it in and this is a no-op.
 */
async function withEmbeddedFonts(node: HTMLElement, options: Options): Promise<Options> {
  if (options.fontEmbedCSS != null || options.skipFonts) return options;
  try {
    return { ...options, fontEmbedCSS: await resolveFontEmbedCss(node) };
  } catch (error) {
    // Deliberately not falling through to html-to-image's own pass: that is
    // the thing this exists to keep off the network. A capture in the fallback
    // face beats a capture that never finishes.
    console.warn('Could not resolve the fonts for this capture', error);
    return { ...options, fontEmbedCSS: '' };
  }
}

/**
 * Capture `node` as a PNG data URL. Drop-in for html-to-image's `toPng` and
 * the only capture entry point the app should call: PNG export, store upload,
 * Discover share, the MCP export tools and the App Preview sprite pass all go
 * through here so none of them can quietly lose images on macOS again.
 */
export async function captureNodeToPng(node: HTMLElement, options: Options = {}): Promise<string> {
  const capture = await withEmbeddedFonts(node, options);
  const svgDataUrl = await toSvg(node, capture);
  const patched = withSyncImageDecoding(svgDataUrl);
  // A future html-to-image could serialize differently. Exporting through the
  // library unchanged is the right failure: correct everywhere but macOS,
  // rather than blank everywhere.
  if (!patched) return toPng(node, capture);

  // Same fallback one step later. If the rewritten markup is somehow not
  // something this browser will parse, rasterize what the library built, so a
  // board that used to export still exports.
  const image = await loadSvgImage(patched).catch(() => loadSvgImage(svgDataUrl));
  // decode() is a hint some engines resolve early; onload has already fired, so
  // a rejection here means nothing beyond "no extra guarantee".
  try {
    await image.decode();
  } catch {
    // proceed with what onload gave us
  }

  const width = options.width || nodeWidth(node);
  const height = options.height || nodeHeight(node);
  const ratio = options.pixelRatio || window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = (options.canvasWidth || width) * ratio;
  canvas.height = (options.canvasHeight || height) * ratio;
  if (!options.skipAutoScale) clampCanvas(canvas);

  // A sprite capture wants the transparency; a board passes its own colour so
  // edge antialiasing blends into the design instead of into nothing. That
  // colour is also what makes the board's canvas opaque, which is the whole
  // requirement App Store Connect states: no alpha channel, transparent pixels
  // or not (see pngOpaque.ts).
  const opaque = !!options.backgroundColor;
  const context = canvas.getContext('2d', opaque ? { alpha: false } : undefined);
  if (!context) throw new Error('This browser could not prepare the export canvas.');
  if (options.backgroundColor) {
    context.fillStyle = options.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (opaque) {
    const withoutAlpha = await encodeOpaquePngDataUrl(canvas);
    if (withoutAlpha) return withoutAlpha;
  }
  return canvas.toDataURL();
}
