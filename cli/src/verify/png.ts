/**
 * PNG header reading, by hand.
 *
 * `osg verify` has to answer three things about every rendered screenshot, on
 * Windows, Linux and macOS identically: how big is it, does it carry an alpha
 * channel, and is it a PNG at all. `sips` is macOS only, ImageMagick and
 * ffprobe are installed nowhere by default, and an image library would be a
 * fourth runtime dependency for what is twenty five bytes of header. So this
 * reads the header.
 *
 * The alpha question is the one that earns the file. App Store Connect rejects
 * a screenshot whose PNG carries an alpha channel even when every pixel in it
 * is fully opaque ("Images can't contain alpha channels or transparencies"),
 * which is why the app hand-encodes a colour type 2 PNG instead of letting the
 * browser write RGBA: see src/lib/pngOpaque.ts, which measured Chromium and
 * WebKit both writing colour type 6 from a canvas. A file produced by an older
 * build, by a browser without CompressionStream, or by any other tool is
 * exactly what verify exists to catch.
 *
 * Layout, from the PNG spec (https://www.w3.org/TR/png-3/):
 *   8 byte signature, then chunks of
 *   [4 byte big endian length][4 byte type][length bytes of data][4 byte CRC]
 * IHDR is always the first chunk and always 13 bytes. tRNS, when present, is
 * required to appear before the first IDAT, so the walk can stop at IDAT.
 */
import fs from 'node:fs';

/** The 8 bytes every PNG starts with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A chunk length is a 4 byte unsigned int the spec caps at 2^31 - 1. */
const MAX_CHUNK_LENGTH = 0x7fffffff;

export interface PngInfo {
  width: number;
  height: number;
  /** Bits per sample: 1, 2, 4, 8 or 16. Store uploads are 8. */
  bitDepth: number;
  /** 0 grey, 2 truecolour, 3 indexed, 4 grey+alpha, 6 truecolour+alpha. */
  colorType: number;
  /** An alpha channel in IHDR, or a tRNS chunk, which is transparency too. */
  hasAlpha: boolean;
  /** 0 none, 1 Adam7. Kept because a rule may one day want it. */
  interlace: number;
  /** File size. checkPng needs it for the Play byte cap without a second stat. */
  bytes: number;
}

/** Human name for a colour type, for messages that have to explain a number. */
export const PNG_COLOR_TYPES: Record<number, string> = {
  0: 'greyscale',
  2: 'truecolour',
  3: 'indexed',
  4: 'greyscale with alpha',
  6: 'truecolour with alpha',
};

/**
 * Header facts about a PNG, or null when the buffer is not one.
 *
 * Never throws: a caller is handing this arbitrary bytes off disk, and "this
 * is not a PNG" is a finding to report, not an exception to unwind.
 */
export function readPngInfo(buffer: Buffer): PngInfo | null {
  if (buffer.length < 8 + 12 + 13 || !buffer.subarray(0, 8).equals(SIGNATURE)) return null;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let sawTrns = false;
  let sawIhdr = false;

  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length > MAX_CHUNK_LENGTH) return sawIhdr ? finish() : null;
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    // A chunk that runs past the end of the file is a truncated download. What
    // was read before it is still true, so report that rather than nothing.
    if (dataEnd + 4 > buffer.length) break;

    if (type === 'IHDR') {
      if (length !== 13) return null;
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer.readUInt8(dataStart + 8);
      colorType = buffer.readUInt8(dataStart + 9);
      interlace = buffer.readUInt8(dataStart + 12);
      sawIhdr = true;
      // A zero side is not a decodable image, and letting it through would put
      // a divide by zero into every aspect ratio rule downstream.
      if (width === 0 || height === 0) return null;
    } else if (type === 'tRNS') {
      // tRNS on an indexed or opaque image is still transparency, and the store
      // rule is about transparency, not about the channel count.
      sawTrns = true;
    } else if (type === 'IDAT' || type === 'IEND') {
      // Pixels start here. Nothing after this point can change the answer.
      break;
    }

    offset = dataEnd + 4;
  }

  if (!sawIhdr) return null;
  return finish();

  function finish(): PngInfo {
    return {
      width,
      height,
      bitDepth,
      colorType,
      hasAlpha: colorType === 4 || colorType === 6 || sawTrns,
      interlace,
      bytes: buffer.length,
    };
  }
}

/**
 * The same, for a path. Reads the whole file because `bytes` has to be the real
 * byte count and a store byte cap is one of the rules; the parse itself only
 * ever touches the first few hundred bytes.
 *
 * A read error propagates: verify globs its own output directory, so a missing
 * file there is a bug in the caller, not a finding about the file.
 */
export function readPngFile(file: string): PngInfo | null {
  return readPngInfo(fs.readFileSync(file));
}
