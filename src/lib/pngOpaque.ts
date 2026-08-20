// PNG without an alpha channel, encoded here because no browser will do it.
//
// App Store Connect rejects a screenshot whose PNG carries an alpha channel,
// even one where every pixel is fully opaque: "Images can't contain alpha
// channels or transparencies". Our exports were always opaque (the capture
// fills the artboard's own background colour first) and still carried the
// channel, because a canvas is RGBA and its PNG encoder writes what it has.
//
// Measured, rather than assumed, on a 400x400 fill:
//   Chromium  toDataURL            -> colour type 6 (RGBA)
//   Chromium  toDataURL, alpha:false -> colour type 6
//   Chromium  toBlob,    alpha:false -> colour type 2 (RGB)
//   WebKit    all four of those      -> colour type 6
// The desktop app is a WKWebView, so the Chromium trick fixes nothing where the
// export actually happens. Encoding the file here is the only thing that holds
// on both engines, and it happens to produce a smaller file than the browser
// did: a quarter of the bytes are the dropped channel, and on three real
// 2064x2752 boards the result came out 33 to 37 percent smaller than what
// toDataURL wrote.
//
// Filter 1 (Sub) on every row, rather than PNG's per-row adaptive choice.
// Measured on those same boards: Sub was the smallest of the five fixed
// filters, and 1 to 4 percent SMALLER than full adaptive selection while taking
// half as long (~0.7s versus ~1.1s per board), because the minimum-sum
// heuristic that picks the filter is only a guess at what deflate will do.

/** Every row filtered the same way. See the note above for why this one. */
const FILTER_SUB = 1;
const BYTES_PER_PIXEL = 3;

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, payload, CRC of type+payload. */
function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

function ihdr(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(13);
  const view = new DataView(payload.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  payload[8] = 8; // bit depth
  payload[9] = 2; // colour type 2: truecolour, no alpha. The whole point.
  payload[10] = 0; // deflate
  payload[11] = 0; // adaptive filtering, per row
  payload[12] = 0; // no interlace
  return payload;
}

/**
 * RGBA pixels to filtered PNG scanlines, dropping the alpha byte.
 *
 * Dropping rather than compositing: the caller draws onto an opaque canvas, so
 * the colour bytes are already the flattened result and an alpha byte here is
 * always 255.
 */
function filteredScanlines(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const stride = width * BYTES_PER_PIXEL;
  const raw = new Uint8Array((stride + 1) * height);
  let out = 0;
  for (let y = 0; y < height; y++) {
    raw[out++] = FILTER_SUB;
    const rowStart = y * width * 4;
    // Sub: each byte minus the same channel of the pixel to its left, which is
    // zero for the first pixel of the row.
    for (let x = 0; x < width; x++) {
      const source = rowStart + x * 4;
      const left = source - 4;
      if (x === 0) {
        raw[out] = data[source];
        raw[out + 1] = data[source + 1];
        raw[out + 2] = data[source + 2];
      } else {
        raw[out] = (data[source] - data[left]) & 255;
        raw[out + 1] = (data[source + 1] - data[left + 1]) & 255;
        raw[out + 2] = (data[source + 2] - data[left + 2]) & 255;
      }
      out += BYTES_PER_PIXEL;
    }
  }
  return raw;
}

/** zlib stream for the IDAT chunk. CompressionStream('deflate') IS zlib. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  // Not awaited before close(): the reader below is what drains the stream, and
  // awaiting a write that only resolves once it is read would deadlock.
  void writer.write(bytes);
  void writer.close();
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    merged.set(part, at);
    at += part.length;
  }
  return merged;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The export could not be read back.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * `canvas` as a PNG data URL with no alpha channel, or null when this browser
 * cannot do it (no CompressionStream) or the canvas cannot be read (a tainted
 * one, which nothing in the export path produces). Null means "use the
 * browser's own encoder", which is what every export did before.
 *
 * The canvas must have been drawn through an `{ alpha: false }` context, or
 * anything semi-transparent in it is silently flattened against black.
 */
export async function encodeOpaquePngDataUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const context = canvas.getContext('2d');
    if (!context) return null;
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const compressed = await deflate(filteredScanlines(data, width, height));
    const blob = new Blob(
      [PNG_SIGNATURE, chunk('IHDR', ihdr(width, height)), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))],
      { type: 'image/png' }
    );
    return await blobToDataUrl(blob);
  } catch (error) {
    console.warn('Could not write an alpha-free PNG; falling back to the browser encoder', error);
    return null;
  }
}
