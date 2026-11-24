// The QR encoder checked against ISO/IEC 18004's own tables and worked
// examples, and by reading each symbol back with a small reader written here
// from the standard's layout: function patterns, both copies of the format and
// version bits, the blocks with their error correction, and the bytes inside.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, formatBits, isDark, qrPath, reedSolomon, versionBits, type QrCode, type QrEcc } from '@/lib/qr';

const LEVELS: QrEcc[] = ['L', 'M', 'Q', 'H'];

// Table 1: all codewords, data and error correction, for versions 1 to 40.
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991,
  1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362,
  3532, 3706];

// Table 7: data codewords for versions 1 to 40, by level.
const DATA_CODEWORDS: Record<QrEcc, number[]> = {
  L: [19, 34, 55, 80, 108, 136, 156, 194, 232, 274, 324, 370, 428, 461, 523, 589, 647, 721, 795, 861, 932, 1006,
    1094, 1174, 1276, 1370, 1468, 1531, 1631, 1735, 1843, 1955, 2071, 2191, 2306, 2434, 2566, 2702, 2812, 2956],
  M: [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453, 507, 563, 627, 669, 714, 782, 860,
    914, 1000, 1062, 1128, 1193, 1267, 1373, 1455, 1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334],
  Q: [13, 22, 34, 48, 62, 76, 88, 110, 132, 154, 180, 206, 244, 261, 295, 325, 367, 397, 445, 485, 512, 568, 614,
    664, 718, 754, 808, 871, 911, 985, 1033, 1115, 1171, 1231, 1286, 1354, 1426, 1502, 1582, 1666],
  H: [9, 16, 26, 36, 46, 60, 66, 86, 100, 122, 140, 158, 180, 197, 223, 253, 283, 313, 341, 385, 406, 442, 464, 514,
    538, 596, 628, 661, 701, 745, 793, 845, 901, 961, 986, 1054, 1096, 1142, 1222, 1276],
};

// Table 9: error correction blocks for versions 1 to 40, by level.
const BLOCK_COUNTS: Record<QrEcc, number[]> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19,
    19, 20, 21, 22, 24, 25],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33,
    35, 37, 38, 40, 43, 45, 47, 49],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43,
    45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51,
    54, 57, 60, 63, 66, 70, 74, 77, 81],
};

// Annex E: alignment pattern centres for versions 1 to 40.
const ALIGNMENT = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46],
  [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]];

// Annex C: the format bits after masking, by level, for masks 0 to 7.
const FORMAT_STRINGS: Record<QrEcc, string[]> = {
  L: ['111011111000100', '111001011110011', '111110110101010', '111100010011101', '110011000101111',
    '110001100011000', '110110001000001', '110100101110110'],
  M: ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001',
    '100000011001110', '100111110010111', '100101010100000'],
  Q: ['011010101011111', '011000001101000', '011111100110001', '011101000000110', '010010010110100',
    '010000110000011', '010111011011010', '010101111101101'],
  H: ['001011010001001', '001001110111110', '001110011100111', '001100111010000', '000011101100010',
    '000001001010101', '000110100001100', '000100000111011'],
};

// Annex D: the version bits for versions 7 to 40.
const VERSION_STRINGS = ['000111110010010100', '001000010110111100', '001001101010011001', '001010010011010011',
  '001011101111110110', '001100011101100010', '001101100001000111', '001110011000001101', '001111100100101000',
  '010000101101111000', '010001010001011101', '010010101000010111', '010011010100110010', '010100100110100110',
  '010101011010000011', '010110100011001001', '010111011111101100', '011000111011000100', '011001000111100001',
  '011010111110101011', '011011000010001110', '011100110000011010', '011101001100111111', '011110110101110101',
  '011111001001010000', '100000100111010101', '100001011011110000', '100010100010111010', '100011011110011111',
  '100100101100001011', '100101010000101110', '100110101001100100', '100111010101000001', '101000110001101001'];

// Table 10: the mask conditions, with i the row and j the column.
const MASK_RULES: ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

const TOO_LONG = { message: 'The text is too long for a QR code' };

/** The most bytes a version holds: the 4 mode bits and an 8 or 16 bit length come first. */
function byteCapacity(version: number, ecc: QrEcc): number {
  return Math.floor((DATA_CODEWORDS[ecc][version - 1] * 8 - 4 - (version < 10 ? 8 : 16)) / 8);
}

/** Repeatable random numbers (mulberry32), so a failure can be run again. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Code points that take 1, 2, 3 and 4 bytes in UTF-8, leaving out the surrogates. */
const WIDTHS = [[0x20, 0x7e], [0x80, 0x7ff], [0x800, 0xd7ff], [0x10000, 0x10ffff]];

/** A string of exactly `bytes` UTF-8 bytes, with characters of every width. */
function textOfBytes(random: () => number, bytes: number): string {
  let text = '';
  for (let left = bytes; left > 0;) {
    const width = 1 + Math.floor(random() * Math.min(4, left));
    const [lo, hi] = WIDTHS[width - 1];
    text += String.fromCodePoint(lo + Math.floor(random() * (hi - lo + 1)));
    left -= width;
  }
  return text;
}

const utf8 = (text: string) => Array.from(new TextEncoder().encode(text));

function readBits(qr: QrCode, cells: number[][]): number {
  return cells.reduce((bits, [x, y]) => (bits << 1) | (isDark(qr, x, y) ? 1 : 0), 0);
}

/** Both copies of the format bits, most significant first, from the places in the standard's figure 25. */
function formatCopies(qr: QrCode): [number, number] {
  const s = qr.size;
  const first = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3],
    [8, 2], [8, 1], [8, 0]];
  const second: number[][] = [];
  for (let y = s - 1; y >= s - 7; y--) second.push([8, y]);
  for (let x = s - 8; x < s; x++) second.push([x, 8]);
  return [readBits(qr, first), readBits(qr, second)];
}

/** Both copies of the version bits, most significant first: bit 17 is nearest the timing pattern's far end. */
function versionCopies(qr: QrCode): [number, number] {
  const s = qr.size;
  const topRight: number[][] = [];
  const bottomLeft: number[][] = [];
  for (let a = 5; a >= 0; a--) {
    for (let b = s - 9; b >= s - 11; b--) {
      topRight.push([b, a]);
      bottomLeft.push([a, b]);
    }
  }
  return [readBits(qr, topRight), readBits(qr, bottomLeft)];
}

/** Modules that hold function patterns or the format and version bits, marked from the standard's layout. */
function functionModules(version: number): Uint8Array {
  const size = 17 + 4 * version;
  const fixed = new Uint8Array(size * size);
  const mark = (x0: number, y0: number, width: number, height: number) => {
    for (let y = y0; y < y0 + height; y++) for (let x = x0; x < x0 + width; x++) fixed[y * size + x] = 1;
  };
  mark(0, 0, 9, 9); // top left finder, separator and format bits
  mark(size - 8, 0, 8, 9); // top right finder, separator and the format bits under it
  mark(0, size - 8, 9, 8); // bottom left finder, separator, format bits and the dark module
  mark(6, 0, 1, size); // timing patterns
  mark(0, 6, size, 1);
  const centres = ALIGNMENT[version - 1];
  for (const cy of centres) {
    for (const cx of centres) {
      const onFinder = (cx < 9 && cy < 9) || (cx > size - 9 && cy < 9) || (cx < 9 && cy > size - 9);
      if (!onFinder) mark(cx - 2, cy - 2, 5, 5);
    }
  }
  if (version >= 7) {
    mark(size - 11, 0, 3, 6);
    mark(0, size - 11, 6, 3);
  }
  return fixed;
}

/**
 * Reads a symbol the way a decoder does, without error correction: the level
 * and mask from the format bits, the codewords in placement order, the blocks
 * (each checked against its error correction), then the byte mode segment and
 * the padding after it.
 */
function readSymbol(qr: QrCode): { ecc: QrEcc; mask: number; bytes: number[] } {
  const version = (qr.size - 17) / 4;
  const [format] = formatCopies(qr);
  const named = LEVELS.flatMap((ecc) => [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => ({ ecc, mask })))
    .find(({ ecc, mask }) => formatBits(ecc, mask) === format);
  assert.ok(named, 'the format bits name a level and a mask');
  const { ecc, mask } = named;

  const fixed = functionModules(version);
  const total = TOTAL_CODEWORDS[version - 1];
  const codewords = new Uint8Array(total);
  let bit = 0;
  let free = 0;
  for (let right = qr.size - 1, up = true; right > 0; right -= 2, up = !up) {
    if (right === 6) right = 5;
    for (let k = 0; k < qr.size; k++) {
      const i = up ? qr.size - 1 - k : k;
      for (const j of [right, right - 1]) {
        if (fixed[i * qr.size + j]) continue;
        free++;
        if (bit === total * 8) continue;
        const value = qr.modules[i * qr.size + j] ^ (MASK_RULES[mask](i, j) ? 1 : 0);
        codewords[bit >> 3] |= value << (7 - (bit & 7));
        bit++;
      }
    }
  }
  assert.ok(free - total * 8 >= 0 && free - total * 8 < 8, 'only remainder bits are left over');

  const blocks = BLOCK_COUNTS[ecc][version - 1];
  const dataTotal = DATA_CODEWORDS[ecc][version - 1];
  const eccLength = (total - dataTotal) / blocks;
  assert.ok(Number.isInteger(eccLength));
  const shortLength = Math.floor(dataTotal / blocks);
  const longFrom = blocks - (dataTotal % blocks);
  const data: number[][] = Array.from({ length: blocks }, () => []);
  const checks: number[][] = Array.from({ length: blocks }, () => []);
  let next = 0;
  for (let i = 0; i <= shortLength; i++) {
    for (let b = 0; b < blocks; b++) if (i < shortLength + (b >= longFrom ? 1 : 0)) data[b].push(codewords[next++]);
  }
  for (let i = 0; i < eccLength; i++) for (let b = 0; b < blocks; b++) checks[b].push(codewords[next++]);
  for (let b = 0; b < blocks; b++) assert.deepEqual(Array.from(reedSolomon(data[b], eccLength)), checks[b]);

  const stream = data.flat();
  let at = 0;
  const read = (length: number) => {
    let value = 0;
    for (let i = 0; i < length; i++, at++) value = (value << 1) | ((stream[at >> 3] >> (7 - (at & 7))) & 1);
    return value;
  };
  assert.equal(read(4), 0b0100, 'byte mode');
  const bytes = Array.from({ length: read(version < 10 ? 8 : 16) }, () => read(8));
  assert.equal(read(Math.min(4, stream.length * 8 - at)), 0, 'terminator');
  while (at % 8) assert.equal(read(1), 0, 'zero bits up to the byte');
  for (let i = 0; at < stream.length * 8; i++) assert.equal(read(8), i % 2 ? 0x11 : 0xec, 'pad codewords');
  return { ecc, mask, bytes };
}

/** The four penalty rules of the standard's table 11, scored here apart from the encoder. */
function penaltyScore(qr: QrCode): number {
  const s = qr.size;
  const lines: string[] = [];
  for (let a = 0; a < s; a++) {
    let row = '';
    let column = '';
    for (let b = 0; b < s; b++) {
      row += isDark(qr, b, a) ? '1' : '0';
      column += isDark(qr, a, b) ? '1' : '0';
    }
    lines.push(row, column);
  }
  let score = 0;
  for (const line of lines) {
    for (const run of line.match(/0{5,}|1{5,}/g) ?? []) score += 3 + run.length - 5;
    // The quiet zone around the symbol is light.
    const padded = `0000${line}0000`;
    for (let at = padded.indexOf('1011101'); at !== -1; at = padded.indexOf('1011101', at + 1)) {
      if (padded.slice(at - 4, at) === '0000' || padded.slice(at + 7, at + 11) === '0000') score += 40;
    }
  }
  for (let y = 0; y + 1 < s; y++) {
    for (let x = 0; x + 1 < s; x++) {
      const dark = isDark(qr, x, y);
      if (isDark(qr, x + 1, y) === dark && isDark(qr, x, y + 1) === dark && isDark(qr, x + 1, y + 1) === dark) score += 3;
    }
  }
  const dark = qr.modules.reduce((sum, module) => sum + module, 0);
  return score + Math.floor(Math.abs(dark * 20 - s * s * 10) / (s * s)) * 10;
}

test('Reed-Solomon gives the worked examples: HELLO WORLD and 01234567, both at 1-M', () => {
  const hello = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(Array.from(reedSolomon(hello, 10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  const digits = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(Array.from(reedSolomon(digits, 10)), [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
});

test('format bits match the standard for every level and mask', () => {
  assert.equal(formatBits('M', 0), 0b101010000010010);
  assert.equal(formatBits('L', 0), 0b111011111000100);
  for (const ecc of LEVELS) {
    for (let mask = 0; mask < 8; mask++) {
      assert.equal(formatBits(ecc, mask).toString(2).padStart(15, '0'), FORMAT_STRINGS[ecc][mask], `${ecc} mask ${mask}`);
    }
  }
});

test('version bits match the standard for versions 7 to 40', () => {
  assert.equal(versionBits(7), 0b000111110010010100);
  assert.equal(versionBits(40), 0b101000110001101001);
  for (let version = 7; version <= 40; version++) {
    assert.equal(versionBits(version).toString(2).padStart(18, '0'), VERSION_STRINGS[version - 7], `version ${version}`);
  }
});

test('finders, separators, timing and alignment patterns and the dark module sit where the standard puts them', () => {
  for (let version = 1; version <= 40; version++) {
    const qr = encodeQr('patterns', { ecc: LEVELS[version % 4], minVersion: version });
    const s = qr.size;
    assert.equal(qr.version, version);
    assert.equal(s, 17 + 4 * version);
    assert.equal(qr.modules.length, s * s);
    for (const [x0, y0] of [[0, 0], [s - 7, 0], [0, s - 7]]) {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (x < 0 || y < 0 || x >= s || y >= s) continue;
          // Rings around the finder's centre: 0, 1 and 3 dark, 2 light, then the light separator.
          const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
          const ring = inside ? Math.max(Math.abs(dx - 3), Math.abs(dy - 3)) : 4;
          assert.equal(isDark(qr, x, y), ring !== 2 && ring !== 4, `version ${version} finder at ${x},${y}`);
        }
      }
    }
    for (let i = 8; i <= s - 9; i++) {
      assert.equal(isDark(qr, i, 6), i % 2 === 0, `version ${version} timing row at ${i}`);
      assert.equal(isDark(qr, 6, i), i % 2 === 0, `version ${version} timing column at ${i}`);
    }
    const centres = ALIGNMENT[version - 1];
    for (const cy of centres) {
      for (const cx of centres) {
        if ((cx < 9 && cy < 9) || (cx > s - 9 && cy < 9) || (cx < 9 && cy > s - 9)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
            assert.equal(isDark(qr, cx + dx, cy + dy), dark, `version ${version} alignment at ${cx},${cy}`);
          }
        }
      }
    }
    assert.equal(isDark(qr, 8, 4 * version + 9), true, `version ${version} dark module`);
  }
});

test('symbols read back to their bytes, with both copies of the format and version bits, at every version and level', () => {
  const random = seeded(18004);
  for (let version = 1; version <= 40; version++) {
    for (const ecc of LEVELS) {
      // A length only this version holds, so it is also the version picked.
      const fewest = version === 1 ? 0 : byteCapacity(version - 1, ecc) + 1;
      const length = fewest + Math.floor(random() * (byteCapacity(version, ecc) - fewest + 1));
      const text = textOfBytes(random, length);
      const qr = encodeQr(text, { ecc, mask: version % 3 ? undefined : (version + LEVELS.indexOf(ecc)) % 8 });
      assert.equal(qr.version, version, `${length} bytes at ${ecc}`);
      const read = readSymbol(qr);
      assert.equal(read.ecc, ecc);
      assert.equal(read.mask, qr.mask);
      assert.deepEqual(read.bytes, utf8(text), `${version}-${ecc}`);
      const [first, second] = formatCopies(qr);
      assert.equal(first, formatBits(ecc, qr.mask), `${version}-${ecc} first format copy`);
      assert.equal(second, formatBits(ecc, qr.mask), `${version}-${ecc} second format copy`);
      if (version >= 7) {
        const [topRight, bottomLeft] = versionCopies(qr);
        assert.equal(topRight, versionBits(version), `${version}-${ecc} top right version copy`);
        assert.equal(bottomLeft, versionBits(version), `${version}-${ecc} bottom left version copy`);
      }
    }
  }
});

test('every forced mask reads back, and the empty text too', () => {
  const text = 'https://editor.openscrgen.app/remote/#r=0123456789abcdef0123456789abcdef&t=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_';
  for (const ecc of LEVELS) {
    for (let mask = 0; mask < 8; mask++) {
      const qr = encodeQr(text, { ecc, mask });
      assert.equal(qr.mask, mask);
      assert.deepEqual(readSymbol(qr), { ecc, mask, bytes: utf8(text) });
    }
  }
  const empty = encodeQr('');
  assert.equal(empty.version, 1);
  assert.deepEqual(readSymbol(empty).bytes, []);
});

test('the picked mask scores the lowest penalty of the eight, the lowest numbered one on a tie', () => {
  const random = seeded(11);
  const texts = ['a', 'HELLO WORLD', 'https://editor.openscrgen.app/remote/#r=4f1c9a0b7e2d5c3a8b6f0e1d2c3b4a59&t=Zx9_Qm-3kLp8RtYv2NcW7sHd0JfGa1Ub4OeXiKq6',
    textOfBytes(random, 300), textOfBytes(random, 900), 'x'.repeat(60), '',
    // Two masks share the lowest score: masks 4 and 7 at L, 2 and 3 at M, 2 and 7 at Q, 1 and 2 at H.
    'tie 114', 'tie 26', 'tie 20', 'tie 97'];
  for (const text of texts) {
    for (const ecc of LEVELS) {
      const picked = encodeQr(text, { ecc });
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => penaltyScore(encodeQr(text, { ecc, mask })));
      const lowest = Math.min(...scores);
      assert.equal(penaltyScore(picked), lowest, `${text.length} characters at ${ecc}`);
      assert.equal(picked.mask, scores.indexOf(lowest), `${text.length} characters at ${ecc}`);
      assert.deepEqual(picked.modules, encodeQr(text, { ecc, mask: picked.mask }).modules);
    }
  }
});

test('1-M holds 14 bytes and 15 need version 2, counting UTF-8 bytes, not characters', () => {
  assert.equal(encodeQr('a'.repeat(14)).version, 1);
  assert.equal(encodeQr('a'.repeat(15)).version, 2);
  const eAcute = String.fromCharCode(0xe9);
  assert.equal(encodeQr(eAcute.repeat(7)).version, 1);
  assert.equal(encodeQr(eAcute.repeat(7) + 'a').version, 2);
  assert.throws(() => encodeQr('a'.repeat(15), { maxVersion: 1 }), TOO_LONG);
});

test('the smallest version that holds the text, at every version and level', () => {
  for (const ecc of LEVELS) {
    for (let version = 1; version <= 40; version++) {
      const capacity = byteCapacity(version, ecc);
      assert.equal(encodeQr('a'.repeat(capacity), { ecc, mask: 0 }).version, version, `${capacity} bytes at ${ecc}`);
      assert.throws(() => encodeQr('a'.repeat(capacity + 1), { ecc, maxVersion: version, mask: 0 }), TOO_LONG);
      if (version < 40) {
        assert.equal(encodeQr('a'.repeat(capacity + 1), { ecc, mask: 0 }).version, version + 1, `${capacity + 1} bytes at ${ecc}`);
      }
    }
  }
});

test('text past version 40 throws, at every level', () => {
  assert.equal(encodeQr('a'.repeat(2953), { ecc: 'L', mask: 0 }).version, 40);
  assert.throws(() => encodeQr('a'.repeat(2954), { ecc: 'L' }), TOO_LONG);
  assert.throws(() => encodeQr('a'.repeat(2332), { ecc: 'M' }), TOO_LONG);
  assert.throws(() => encodeQr('a'.repeat(1664), { ecc: 'Q' }), TOO_LONG);
  assert.throws(() => encodeQr('a'.repeat(1274), { ecc: 'H' }), TOO_LONG);
  // 1000 four-byte characters are 4000 bytes.
  assert.throws(() => encodeQr(String.fromCodePoint(0x1f600).repeat(1000), { ecc: 'L' }), TOO_LONG);
});

test('a room link fits version 7 at M, 45 modules a side', () => {
  const link = 'https://editor.openscrgen.app/remote/#r=0123456789abcdef0123456789abcdef&t=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_';
  const qr = encodeQr(link);
  assert.equal(qr.ecc, 'M');
  assert.equal(qr.version, 7);
  assert.equal(qr.size, 45);
});

test('options: the default level, minVersion, a forced mask, and the ones refused', () => {
  assert.equal(encodeQr('x').ecc, 'M');
  assert.equal(encodeQr('x', { minVersion: 5 }).version, 5);
  assert.equal(encodeQr('x', { mask: 6 }).mask, 6);
  assert.equal(encodeQr('x', { ecc: 'H', minVersion: 3, maxVersion: 3 }).version, 3);
  assert.throws(() => encodeQr('x', { mask: 8 }), RangeError);
  assert.throws(() => encodeQr('x', { mask: 1.5 }), RangeError);
  assert.throws(() => encodeQr('x', { minVersion: 0 }), RangeError);
  assert.throws(() => encodeQr('x', { maxVersion: 41 }), RangeError);
  assert.throws(() => encodeQr('x', { minVersion: 9, maxVersion: 8 }), RangeError);
  assert.throws(() => encodeQr('x', { ecc: 'X' as QrEcc }), RangeError);
});

test('isDark reads the grid and is light outside it', () => {
  const qr = encodeQr('isDark', { ecc: 'Q' });
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) assert.equal(isDark(qr, x, y), qr.modules[y * qr.size + x] === 1);
  }
  for (const [x, y] of [[-1, 0], [0, -1], [qr.size, 0], [0, qr.size], [-5, -5]]) assert.equal(isDark(qr, x, y), false);
});

test('qrPath covers exactly the dark modules, one rectangle for each horizontal run', () => {
  const random = seeded(3);
  for (const [text, margin] of [['https://editor.openscrgen.app/remote/#r=abc', 4], [textOfBytes(random, 500), 0], ['margin 2', 2]] as const) {
    const qr = encodeQr(text, { ecc: 'Q' });
    const d = margin === 4 ? qrPath(qr) : qrPath(qr, margin);
    const n = qr.size + 2 * margin;
    const painted = new Uint8Array(n * n);
    let consumed = 0;
    for (const match of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      assert.equal(match.index, consumed, 'only rectangles in the path');
      consumed += match[0].length;
      const [x, y, width, back] = match.slice(1).map(Number);
      assert.equal(back, width);
      // Each run is as long as it can be.
      assert.equal(isDark(qr, x - margin - 1, y - margin), false);
      assert.equal(isDark(qr, x - margin + width, y - margin), false);
      for (let i = 0; i < width; i++) {
        assert.equal(painted[y * n + x + i], 0, 'rectangles do not overlap');
        painted[y * n + x + i] = 1;
      }
    }
    assert.equal(consumed, d.length);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) assert.equal(painted[y * n + x] === 1, isDark(qr, x - margin, y - margin), `${x},${y}`);
    }
  }
});
