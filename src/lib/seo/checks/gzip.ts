// Copied from github.com/dotnetdreamer/claude-seo osg/checks/gzip.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// gzip the way claude-seo's sitemap check inflates it (scripts/sitemap_discovery.py,
// _gunzip_bounded): Python's gzip.GzipFile over zlib's raw inflate. Members
// follow one another, zero bytes may pad the space between them, each
// member's CRC-32 and length are checked, and the output stops at a limit.
// Written out here rather than left to the browser: WebKit before Safari
// 16.4 has no DecompressionStream, and the browsers stop at the first
// member where Python reads them all.

export class GzipError extends Error {}
/** The output passed the limit: claude-seo says "too large", not "invalid". */
export class GzipTooLarge extends Error {}

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array, from: number, to: number, crc: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = ~crc >>> 0;
  for (let i = from; i < to; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// --- raw inflate (RFC 1951), rejecting what zlib rejects -------------------

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: counts per length and symbols by code, as zlib's inflate_table builds it. */
interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

/**
 * zlib's checks on a code (inflate_table): over-subscribed is an error, and
 * so is incomplete, except a literal or distance code with one code of one
 * bit. A distance code with no codes at all is allowed until one is used.
 */
function buildHuffman(lengths: ArrayLike<number>, kind: 'codes' | 'lens' | 'dists'): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
  counts[0] = 0;
  let max = 15;
  while (max >= 1 && counts[max] === 0) max--;
  let left = 1;
  for (let len = 1; len <= 15; len++) {
    left <<= 1;
    left -= counts[len];
    if (left < 0) throw new GzipError('invalid code: over-subscribed');
  }
  if (max === 0) {
    if (kind === 'codes') throw new GzipError('invalid code lengths set');
    return { counts, symbols: new Uint16Array(0) };
  }
  if (left > 0 && (kind === 'codes' || max !== 1)) throw new GzipError('invalid code: incomplete');
  const offsets = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len] + counts[len];
  const symbols = new Uint16Array(lengths.length);
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  return { counts, symbols };
}

class Bits {
  private bitBuf = 0;
  private bitCount = 0;
  readonly data: Uint8Array;
  pos: number;
  constructor(data: Uint8Array, pos: number) {
    this.data = data;
    this.pos = pos;
  }

  need(n: number): number {
    while (this.bitCount < n) {
      if (this.pos >= this.data.length) throw new GzipError('Compressed file ended before the end-of-stream marker was reached');
      this.bitBuf |= this.data[this.pos++] << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCount -= n;
    return value;
  }

  /** Drop the bits left in the byte under way (a stored block starts on a byte). */
  align(): void {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  decode(code: Huffman): number {
    let value = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      value |= this.need(1);
      const count = code.counts[len];
      if (value - first < count) return code.symbols[index + value - first];
      index += count;
      first += count;
      first <<= 1;
      value <<= 1;
    }
    throw new GzipError('invalid code');
  }
}

/** Fixed codes (RFC 1951 3.2.6): 288 literal and length codes and 32 distance codes, as zlib builds them (30 and 31 are invalid when used). */
let fixed: { lens: Huffman; dists: Huffman } | null = null;
function fixedCodes() {
  if (!fixed) {
    const lens = new Uint8Array(288);
    lens.fill(8, 0, 144);
    lens.fill(9, 144, 256);
    lens.fill(7, 256, 280);
    lens.fill(8, 280, 288);
    fixed = { lens: buildHuffman(lens, 'lens'), dists: buildHuffman(new Uint8Array(32).fill(5), 'dists') };
  }
  return fixed;
}

/** Growable output with a limit. */
class Output {
  buf = new Uint8Array(1 << 16);
  length = 0;
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }

  private room(extra: number): void {
    if (this.length + extra > this.limit) throw new GzipTooLarge('too large');
    if (this.length + extra <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(Math.min(size, this.limit + 1));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  push(byte: number): void {
    this.room(1);
    this.buf[this.length++] = byte;
  }

  copy(distance: number, length: number, memberStart: number): void {
    // zlib keeps the window across members' output only within one stream: a distance can't reach before this member.
    if (distance > this.length - memberStart) throw new GzipError('invalid distance too far back');
    this.room(length);
    for (let i = 0; i < length; i++) {
      this.buf[this.length] = this.buf[this.length - distance];
      this.length++;
    }
  }
}

/** One raw deflate stream, from where `bits` stands to its last block. */
function inflateStream(bits: Bits, out: Output): void {
  const memberStart = out.length;
  for (let last = 0; !last; ) {
    last = bits.need(1);
    const type = bits.need(2);
    if (type === 0) {
      bits.align();
      const data = bits.data;
      if (bits.pos + 4 > data.length) throw new GzipError('Compressed file ended before the end-of-stream marker was reached');
      const len = data[bits.pos] | (data[bits.pos + 1] << 8);
      const nlen = data[bits.pos + 2] | (data[bits.pos + 3] << 8);
      bits.pos += 4;
      if (len !== (~nlen & 0xffff)) throw new GzipError('invalid stored block lengths');
      if (bits.pos + len > data.length) throw new GzipError('Compressed file ended before the end-of-stream marker was reached');
      for (let i = 0; i < len; i++) out.push(data[bits.pos + i]);
      bits.pos += len;
      continue;
    }
    if (type === 3) throw new GzipError('invalid block type');
    let lens: Huffman;
    let dists: Huffman;
    if (type === 1) {
      ({ lens, dists } = fixedCodes());
    } else {
      const nlen = bits.need(5) + 257;
      const ndist = bits.need(5) + 1;
      const ncode = bits.need(4) + 4;
      if (nlen > 286 || ndist > 30) throw new GzipError('too many length or distance symbols');
      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) codeLengths[ORDER[i]] = bits.need(3);
      const codes = buildHuffman(codeLengths, 'codes');
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist; ) {
        const symbol = bits.decode(codes);
        if (symbol < 16) {
          lengths[i++] = symbol;
          continue;
        }
        let repeat: number;
        let value = 0;
        if (symbol === 16) {
          if (i === 0) throw new GzipError('invalid bit length repeat');
          value = lengths[i - 1];
          repeat = 3 + bits.need(2);
        } else if (symbol === 17) repeat = 3 + bits.need(3);
        else repeat = 11 + bits.need(7);
        if (i + repeat > nlen + ndist) throw new GzipError('invalid bit length repeat');
        for (; repeat > 0; repeat--) lengths[i++] = value;
      }
      if (lengths[256] === 0) throw new GzipError('invalid code -- missing end-of-block');
      lens = buildHuffman(lengths.subarray(0, nlen), 'lens');
      dists = buildHuffman(lengths.subarray(nlen), 'dists');
    }
    for (;;) {
      const symbol = bits.decode(lens);
      if (symbol < 256) {
        out.push(symbol);
        continue;
      }
      if (symbol === 256) break;
      const lengthIndex = symbol - 257;
      if (lengthIndex >= 29) throw new GzipError('invalid literal/length code');
      const length = LENGTH_BASE[lengthIndex] + bits.need(LENGTH_EXTRA[lengthIndex]);
      if (!dists.symbols.length) throw new GzipError('invalid distance code');
      const distSymbol = bits.decode(dists);
      if (distSymbol >= 30) throw new GzipError('invalid distance code');
      const distance = DIST_BASE[distSymbol] + bits.need(DIST_EXTRA[distSymbol]);
      out.copy(distance, length, memberStart);
    }
  }
}

const FHCRC = 2;
const FEXTRA = 4;
const FNAME = 8;
const FCOMMENT = 16;

/**
 * Python's gzip.GzipFile(...).read(), with _gunzip_bounded's limit: every
 * member, a zero-padded gap between them skipped. Throws GzipError where
 * Python raises (claude-seo's "invalid gzip data") and GzipTooLarge past the limit.
 */
export function gunzip(data: Uint8Array, limit: number): Uint8Array {
  const out = new Output(limit);
  let pos = 0;
  const short = () => new GzipError('Compressed file ended before the end-of-stream marker was reached');
  for (;;) {
    // _read_gzip_header: nothing left is the end; anything else must be a member.
    if (pos >= data.length) break;
    if (pos + 2 > data.length || data[pos] !== 0x1f || data[pos + 1] !== 0x8b) throw new GzipError('Not a gzipped file');
    if (pos + 10 > data.length) throw short();
    const method = data[pos + 2];
    const flags = data[pos + 3];
    if (method !== 8) throw new GzipError('Unknown compression method');
    pos += 10;
    if (flags & FEXTRA) {
      if (pos + 2 > data.length) throw short();
      const extra = data[pos] | (data[pos + 1] << 8);
      pos += 2;
      if (pos + extra > data.length) throw short();
      pos += extra;
    }
    // A name or comment runs to a NUL, or to the end, which Python doesn't mind here.
    if (flags & FNAME) {
      while (pos < data.length && data[pos] !== 0) pos++;
      if (pos < data.length) pos++;
    }
    if (flags & FCOMMENT) {
      while (pos < data.length && data[pos] !== 0) pos++;
      if (pos < data.length) pos++;
    }
    if (flags & FHCRC) {
      if (pos + 2 > data.length) throw short();
      pos += 2;
    }
    const start = out.length;
    const bits = new Bits(data, pos);
    inflateStream(bits, out);
    pos = bits.pos;
    // _read_eof: the CRC-32 and the length mod 2**32, then any zero padding.
    if (pos + 8 > data.length) throw short();
    const crc = (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16) | (data[pos + 3] << 24)) >>> 0;
    const size = (data[pos + 4] | (data[pos + 5] << 8) | (data[pos + 6] << 16) | (data[pos + 7] << 24)) >>> 0;
    pos += 8;
    if (crc !== crc32(out.buf, start, out.length, 0)) throw new GzipError('CRC check failed');
    if (size !== (out.length - start) >>> 0) throw new GzipError('Incorrect length of data produced');
    while (pos < data.length && data[pos] === 0) pos++;
  }
  return out.buf.slice(0, out.length);
}
