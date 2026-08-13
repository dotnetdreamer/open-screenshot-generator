// MD5, because App Store Connect asks for one.
//
// The commit step of an asset upload (PATCH /v1/appScreenshots/{id}) carries
// `sourceFileChecksum`, an MD5 hex digest of the exact bytes that were PUT.
// WebCrypto deliberately does not implement MD5, and pulling a dependency in
// for ~60 lines of arithmetic is not worth it, so here it is. This is a
// checksum for an upload integrity check, never a security primitive.
//
// RFC 1321 reference implementation, transcribed.

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i + 1)) * 2^32)
const K = (() => {
  const table = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) {
    table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  }
  return table;
})();

function rotateLeft(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

/** Little-endian hex of one 32-bit word, which is the order MD5 digests use. */
function wordToHex(value: number): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

export function md5Hex(input: Uint8Array): string {
  const byteLength = input.length;
  // One 0x80 byte, then zeros, then an 8-byte little-endian bit count, padded
  // out to a whole number of 64-byte blocks.
  const paddedLength = (((byteLength + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[byteLength] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLength = byteLength * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const block = new Uint32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      block[i] = view.getUint32(offset + i * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }

      const sum = (f + a + K[i] + block[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[i])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return wordToHex(a0) + wordToHex(b0) + wordToHex(c0) + wordToHex(d0);
}
