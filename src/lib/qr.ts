// QR codes as ISO/IEC 18004 describes them, in byte mode only.
//
// encodeQr turns the text into UTF-8 bytes and lays them out in the smallest
// version that holds them at the asked error correction level. It picks the
// mask with the lowest penalty under the standard's four rules unless the
// caller names one. qrPath draws the result as a single SVG path.
//
// No ECI header marks the bytes as UTF-8, so a reader that takes byte mode as
// Latin-1 shows letters outside ASCII wrongly. ASCII, such as a link, reads
// the same either way.

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
  /** Modules on each side: 17 + 4 * version. */
  size: number;
  /** Row-major, one entry per module, 1 = dark. */
  modules: Uint8Array;
  version: number;
  ecc: QrEcc;
  mask: number;
}

export interface QrOptions {
  /** Error correction level, M when left out. */
  ecc?: QrEcc;
  /** The smallest version to use, 1 when left out. */
  minVersion?: number;
  /** The largest version to use, 40 when left out. */
  maxVersion?: number;
  /** A mask from 0 to 7. Without one, the encoder picks the mask with the lowest penalty. */
  mask?: number;
}

// The standard's table 9 for versions 1 to 40 (index 0 is unused): the error
// correction codewords in each block, and the number of blocks.
const ECC_PER_BLOCK: Record<QrEcc, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
    28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
    30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCKS: Record<QrEcc, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
    23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
    25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** The two bits that name each level in the format information. */
const LEVEL_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** Where each mask flips a data module: x is the column, y the row. */
const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// Powers of 2 in GF(256) with the polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d),
// and their logarithms. The powers repeat once so a sum of two logs needs no wrap.
const EXP = new Uint8Array(510);
const LOG = new Uint8Array(256);
for (let i = 0, value = 1; i < 255; i++) {
  EXP[i] = EXP[i + 255] = value;
  LOG[value] = i;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}

function multiply(a: number, b: number): number {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

/**
 * The `count` error correction codewords for one block: the remainder of the
 * data times x^count, divided by the generator polynomial whose roots are 2^0
 * to 2^(count - 1). Exported for the tests.
 */
export function reedSolomon(data: ArrayLike<number>, count: number): Uint8Array {
  // The generator's coefficients, highest power first.
  let generator = [1];
  for (let i = 0; i < count; i++) {
    const next = [...generator, 0];
    for (let j = 1; j < next.length; j++) next[j] ^= multiply(generator[j - 1], EXP[i]);
    generator = next;
  }
  const remainder = new Uint8Array(count);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[count - 1] = 0;
    for (let j = 0; j < count; j++) remainder[j] ^= multiply(generator[j + 1], factor);
  }
  return remainder;
}

/** The remainder of `value` divided by `generator`, both read as polynomials over GF(2). */
function bchRemainder(value: number, generator: number): number {
  const degree = 31 - Math.clz32(generator);
  for (let bit = 31 - Math.clz32(value); bit >= degree; bit--) {
    if ((value >>> bit) & 1) value ^= generator << (bit - degree);
  }
  return value;
}

/** The 15 format bits: BCH(15,5) over the level and mask, then XOR 0x5412. Exported for the tests. */
export function formatBits(ecc: QrEcc, mask: number): number {
  const data = ((LEVEL_BITS[ecc] << 3) | mask) << 10;
  return (data | bchRemainder(data, 0x537)) ^ 0x5412;
}

/** The 18 version bits for version 7 and up: BCH(18,6) over the version. Exported for the tests. */
export function versionBits(version: number): number {
  return (version << 12) | bchRemainder(version << 12, 0x1f25);
}

/**
 * Alignment pattern centres along each axis, as in the standard's annex E. The
 * first is at 6 and the last at size - 7. Going back from the last, the others
 * are one even step apart, and the gap down to 6 takes what is left. The step
 * is the even number at or above (size - 13) / (count - 1), except in version
 * 32, where the standard uses 26.
 */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const size = 17 + 4 * version;
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2;
  const positions = [6];
  for (let at = size - 7; positions.length < count; at -= step) positions.splice(1, 0, at);
  return positions;
}

/**
 * Modules left for codewords: the whole square less the three finders with
 * their separators (64 each), the format areas with the dark module (31), the
 * timing patterns, the alignment patterns less what they share with the timing
 * patterns, and from version 7 the two version areas (36).
 */
function codewordModules(version: number): number {
  const size = 17 + 4 * version;
  const count = alignmentPositions(version).length;
  const alignment = count ? 25 * (count * count - 3) - 10 * (count - 2) : 0;
  return size * size - 3 * 64 - 31 - 2 * (size - 16) - alignment - (version >= 7 ? 36 : 0);
}

function dataCodewords(version: number, ecc: QrEcc): number {
  return Math.floor(codewordModules(version) / 8) - ECC_PER_BLOCK[ecc][version] * BLOCKS[ecc][version];
}

/** Bits in the length field of a byte mode segment. */
function lengthBits(version: number): number {
  return version < 10 ? 8 : 16;
}

/** The byte mode segment, its terminator and the padding, as `capacity` data codewords. */
function dataStream(bytes: Uint8Array, version: number, capacity: number): Uint8Array {
  const out = new Uint8Array(capacity);
  let bit = 0;
  const write = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--, bit++) {
      if ((value >>> i) & 1) out[bit >>> 3] |= 0x80 >>> (bit & 7);
    }
  };
  write(0b0100, 4);
  write(bytes.length, lengthBits(version));
  for (const byte of bytes) write(byte, 8);
  // Up to four zero bits end the data and more zero bits fill the byte. Then
  // the pad codewords 0xec and 0x11 take turns to the end.
  const padStart = Math.ceil(Math.min(bit + 4, capacity * 8) / 8);
  for (let i = padStart; i < capacity; i++) out[i] = (i - padStart) % 2 ? 0x11 : 0xec;
  return out;
}

/** Splits the data into blocks, adds each block's error correction and interleaves the lot. */
function interleave(data: Uint8Array, version: number, ecc: QrEcc): Uint8Array {
  const blockCount = BLOCKS[ecc][version];
  const eccLength = ECC_PER_BLOCK[ecc][version];
  const total = Math.floor(codewordModules(version) / 8);
  // When the total doesn't divide evenly, the last blocks hold one more data codeword.
  const shortLength = Math.floor(total / blockCount) - eccLength;
  const shortBlocks = blockCount - (total % blockCount);
  const blocks: Uint8Array[] = [];
  const checks: Uint8Array[] = [];
  let at = 0;
  for (let b = 0; b < blockCount; b++) {
    const length = shortLength + (b < shortBlocks ? 0 : 1);
    const block = data.subarray(at, at + length);
    at += length;
    blocks.push(block);
    checks.push(reedSolomon(block, eccLength));
  }
  const out = new Uint8Array(total);
  let k = 0;
  for (let i = 0; i <= shortLength; i++) {
    for (const block of blocks) if (i < block.length) out[k++] = block[i];
  }
  for (let i = 0; i < eccLength; i++) {
    for (const check of checks) out[k++] = check[i];
  }
  return out;
}

interface Grid {
  size: number;
  modules: Uint8Array;
  /** 1 where a function pattern or the format and version areas sit. Data and masks leave these alone. */
  fixed: Uint8Array;
}

function set(grid: Grid, x: number, y: number, dark: boolean): void {
  grid.modules[y * grid.size + x] = dark ? 1 : 0;
  grid.fixed[y * grid.size + x] = 1;
}

/** Writes both copies of the format bits, and the module at column 8, row size - 8, which is always dark. */
function drawFormat(grid: Grid, bits: number): void {
  const { size } = grid;
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    // Around the top left finder: bits 0 to 7 down column 8, then bits 8 to 14
    // leftwards along row 8, stepping over the timing patterns.
    if (i < 8) set(grid, 8, i < 6 ? i : i + 1, dark);
    else set(grid, i === 8 ? 7 : 14 - i, 8, dark);
    // Bits 0 to 7 leftwards from the right edge under the top right finder,
    // then bits 8 to 14 down column 8 beside the bottom left finder.
    if (i < 8) set(grid, size - 1 - i, 8, dark);
    else set(grid, 8, size - 15 + i, dark);
  }
  set(grid, 8, size - 8, true);
}

/** A grid for `version` with every function pattern drawn and the format areas held. */
function functionPatterns(version: number): Grid {
  const size = 17 + 4 * version;
  const grid: Grid = { size, modules: new Uint8Array(size * size), fixed: new Uint8Array(size * size) };
  // Timing patterns along row 6 and column 6. The finders cover their ends.
  for (let i = 0; i < size; i++) {
    set(grid, 6, i, i % 2 === 0);
    set(grid, i, 6, i % 2 === 0);
  }
  // Finders in three corners: dark rings at distance 0, 1 and 3 from the
  // centre, light at 2, and the light separator at 4.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && y >= 0 && x < size && y < size) set(grid, x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  // Alignment patterns at every pair of centres except the three finder corners.
  const centres = alignmentPositions(version);
  const last = centres.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && (j === 0 || j === last)) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(grid, centres[j] + dx, centres[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  // Holds the format areas until the mask is known.
  drawFormat(grid, 0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const across = size - 11 + (i % 3);
      const down = Math.floor(i / 3);
      set(grid, across, down, dark); // left of the top right finder, 3 wide and 6 tall
      set(grid, down, across, dark); // above the bottom left finder, 6 wide and 3 tall
    }
  }
  return grid;
}

/**
 * Lays the codeword bits, most significant first, in columns two modules wide,
 * starting at the bottom right and going up and down by turns. Column 6 is the
 * timing pattern and is skipped. Modules left over stay light.
 */
function drawCodewords(grid: Grid, codewords: Uint8Array): void {
  const { size, modules, fixed } = grid;
  const bitCount = codewords.length * 8;
  let i = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (let x = right; x >= right - 1; x--) {
        const at = y * size + x;
        if (fixed[at] || i >= bitCount) continue;
        modules[at] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
        i++;
      }
    }
    upward = !upward;
  }
}

/** Flips the data modules the mask picks. Applying the same mask twice undoes it. */
function applyMask(grid: Grid, mask: number): void {
  const { size, modules, fixed } = grid;
  const flips = MASKS[mask];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = y * size + x;
      if (!fixed[at] && flips(x, y)) modules[at] ^= 1;
    }
  }
}

function isLight(line: Uint8Array, from: number, to: number): boolean {
  for (let i = Math.max(from, 0); i < Math.min(to, line.length); i++) if (line[i]) return false;
  return true;
}

/** Penalty rules 1 and 3 along one row or column. */
function linePenalty(line: Uint8Array): number {
  const n = line.length;
  let score = 0;
  // Rule 1: a run of five or more modules of one colour scores 3, plus 1 for
  // each module past five.
  for (let start = 0, i = 1; i <= n; i++) {
    if (i < n && line[i] === line[start]) continue;
    if (i - start >= 5) score += i - start - 2;
    start = i;
  }
  // Rule 3: dark, light, three dark, light, dark (a finder's 1:1:3:1:1) with
  // four light modules before it or after it scores 40. Past the edge counts
  // as light, since the quiet zone is.
  for (let i = 0; i + 7 <= n; i++) {
    if (line[i] && !line[i + 1] && line[i + 2] && line[i + 3] && line[i + 4] && !line[i + 5] && line[i + 6]
      && (isLight(line, i - 4, i) || isLight(line, i + 7, i + 11))) score += 40;
  }
  return score;
}

/** The standard's penalty score for a finished symbol. */
function penalty({ size, modules }: Grid): number {
  let score = 0;
  const line = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) line[j] = modules[i * size + j];
    score += linePenalty(line);
    for (let j = 0; j < size; j++) line[j] = modules[j * size + i];
    score += linePenalty(line);
  }
  // Rule 2: 3 for each 2 by 2 square of one colour, overlaps included.
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const at = y * size + x;
      const colour = modules[at];
      if (modules[at + 1] === colour && modules[at + size] === colour && modules[at + size + 1] === colour) score += 3;
    }
  }
  // Rule 4: 10 for each whole 5 percent that the dark share is away from half.
  let dark = 0;
  for (let i = 0; i < modules.length; i++) dark += modules[i];
  return score + Math.floor(Math.abs(dark * 20 - modules.length * 10) / modules.length) * 10;
}

/** The mask that gives the lowest penalty. The lowest numbered mask wins a tie. */
function bestMask(grid: Grid, ecc: QrEcc): number {
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(grid, mask);
    drawFormat(grid, formatBits(ecc, mask));
    const score = penalty(grid);
    applyMask(grid, mask);
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Encodes `text` as UTF-8 bytes in a byte mode QR code. A lone surrogate
 * becomes U+FFFD, as TextEncoder writes it. Throws when the bytes don't fit in
 * maxVersion at the asked level.
 */
export function encodeQr(text: string, options: QrOptions = {}): QrCode {
  const { ecc = 'M', minVersion = 1, maxVersion = 40, mask } = options;
  if (!['L', 'M', 'Q', 'H'].includes(ecc)) throw new RangeError(`Unknown QR error correction level ${ecc}`);
  const versionsOk = Number.isInteger(minVersion) && Number.isInteger(maxVersion)
    && minVersion >= 1 && maxVersion <= 40 && minVersion <= maxVersion;
  if (!versionsOk) throw new RangeError('QR versions run from 1 to 40, and minVersion must not be above maxVersion');
  if (mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) {
    throw new RangeError('A QR mask is a whole number from 0 to 7');
  }
  const bytes = new TextEncoder().encode(text);
  let version = minVersion;
  while (4 + lengthBits(version) + bytes.length * 8 > dataCodewords(version, ecc) * 8) {
    if (version === maxVersion) throw new Error('The text is too long for a QR code');
    version++;
  }
  const grid = functionPatterns(version);
  drawCodewords(grid, interleave(dataStream(bytes, version, dataCodewords(version, ecc)), version, ecc));
  const chosen = mask ?? bestMask(grid, ecc);
  applyMask(grid, chosen);
  drawFormat(grid, formatBits(ecc, chosen));
  return { size: grid.size, modules: grid.modules, version, ecc, mask: chosen };
}

/** Whether the module in column `x`, row `y` is dark. Anything outside the symbol is light. */
export function isDark(qr: QrCode, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < qr.size && y < qr.size && qr.modules[y * qr.size + x] === 1;
}

/**
 * An SVG path `d` with each dark module as a unit square, moved in by `margin`
 * modules to leave the quiet zone. Each horizontal run of dark modules is one
 * rectangle. Use it in a viewBox of `0 0 N N`, where N = qr.size + 2 * margin,
 * over a light background, since the path draws only the dark modules.
 */
export function qrPath(qr: QrCode, margin = 4): string {
  const { size, modules } = qr;
  const parts: string[] = [];
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!modules[y * size + x]) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < size && modules[y * size + end]) end++;
      parts.push(`M${x + margin} ${y + margin}h${end - x}v1h${x - end}z`);
      x = end;
    }
  }
  return parts.join('');
}
