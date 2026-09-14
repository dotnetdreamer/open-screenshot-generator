// Reads the sound track of an MP4 or MOV recording straight from its Blob.
//
// Only box headers, the moov box and any moof boxes are read into memory. The
// audio packets inside the requested range are then sliced out of the file,
// each AAC packet gets a 7-byte ADTS header, and the result goes to
// decodeAudioData as a plain .aac stream.
//
// Two reasons this exists instead of handing the whole file to
// decodeAudioData:
// - WebKit rejects QuickTime containers there ("EncodingError: Decoding
//   failed"). A macOS screen recording is a .mov, and the desktop app on macOS
//   is a WKWebView.
// - A recording can be hundreds of MB. Reading it all into an ArrayBuffer and
//   decoding its full length is exactly the memory pressure that gets the
//   WKWebView killed (issue #19). This reads the audio in the trimmed range.
//
// Timing: presentation second p maps to media time editStart + (p - editDelay).
// AAC encoders put about 2112 samples of priming at the start of the stream and
// record them in the edit list. ADTS has no edit list, and engines disagree on
// what to do about it: Chromium outputs the priming, WebKit drops it. So the
// decoded length is compared with what the packets should produce, and any
// shortfall is taken off the front. `offset` in the result says where the
// requested start lands in the decoded buffer.

export class Mp4AudioError extends Error {
  constructor(
    readonly code: 'not-mp4' | 'unsupported-codec' | 'unsupported-layout' | 'truncated',
    message: string
  ) {
    super(message);
    this.name = 'Mp4AudioError';
  }
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex', 'moof', 'traf', 'dinf', 'udta']);
const TOP_LEVEL_OK = new Set(['ftyp', 'styp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid', 'moof', 'mfra', 'sidx', 'meta', 'junk', 'prfl', 'PICT', 'emsg', 'prft']);
const MAX_MOOV_BYTES = 256 * 1024 * 1024;

interface TopBox {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

interface Box {
  type: string;
  start: number;
  body: number;
  end: number;
}

interface AacConfig {
  objectType: number;
  sampleRateIndex: number;
  sampleRate: number;
  channelConfig: number;
  frameLength: number;
  pce: boolean;
}

interface SampleTable {
  count: number;
  sizes: Uint32Array;
  offsets: Float64Array;
  times: Float64Array;
  endTime: number;
}

export interface Mp4AudioTrack {
  trackId: number;
  enabled: boolean;
  codec: string;
  kind?: 'aac' | 'mp3';
  config?: AacConfig;
  supported: boolean;
  timescale: number;
  /** Seconds of silence before the track starts (a leading empty edit). */
  editDelay: number;
  /** Media second that plays at `editDelay`. */
  editStart: number;
  /** Presentation length in seconds. */
  duration: number;
  sampleCount: number;
  table: SampleTable;
}

// ---------------------------------------------------------------------------
// Reading

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const s = Math.max(0, start);
  const e = Math.min(blob.size, end);
  if (e <= s) return new Uint8Array(0);
  return new Uint8Array(await blob.slice(s, e).arrayBuffer());
}

function fourcc(u8: Uint8Array, at: number): string {
  return String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3]);
}

function u32(u8: Uint8Array, at: number): number {
  return ((u8[at] << 24) | (u8[at + 1] << 16) | (u8[at + 2] << 8) | u8[at + 3]) >>> 0;
}

function u64(u8: Uint8Array, at: number): number {
  return u32(u8, at) * 0x100000000 + u32(u8, at + 4);
}

function i32(u8: Uint8Array, at: number): number {
  return (u8[at] << 24) | (u8[at + 1] << 16) | (u8[at + 2] << 8) | u8[at + 3];
}

function i64(u8: Uint8Array, at: number): number {
  return i32(u8, at) * 0x100000000 + u32(u8, at + 4);
}

/** Top-level boxes, reading only their headers. */
async function topLevelBoxes(blob: Blob): Promise<TopBox[]> {
  const boxes: TopBox[] = [];
  let pos = 0;
  while (pos + 8 <= blob.size) {
    const h = await readBytes(blob, pos, pos + 16);
    let size = u32(h, 0);
    const type = fourcc(h, 4);
    let headerSize = 8;
    if (size === 1) {
      if (h.length < 16) break;
      size = u64(h, 8);
      headerSize = 16;
    } else if (size === 0) {
      size = blob.size - pos;
    }
    if (boxes.length === 0 && (!/^[\x20-\x7e]{4}$/.test(type) || size < 8)) {
      throw new Mp4AudioError('not-mp4', 'Not an MP4 or MOV file.');
    }
    if (size < headerSize) break; // a corrupt tail; keep what came before it
    boxes.push({ type, start: pos, headerSize, size });
    pos += size;
  }
  if (boxes.length === 0 || !boxes.some((b) => TOP_LEVEL_OK.has(b.type))) {
    throw new Mp4AudioError('not-mp4', 'Not an MP4 or MOV file.');
  }
  return boxes;
}

/** Children of a box already in memory. */
function children(u8: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = u32(u8, p);
    const type = fourcc(u8, p + 4);
    let header = 8;
    if (size === 1) {
      size = u64(u8, p + 8);
      header = 16;
    } else if (size === 0) {
      size = to - p;
    }
    if (size < header || p + size > to) break;
    out.push({ type, start: p, body: p + header, end: p + size });
    p += size;
  }
  return out;
}

function child(u8: Uint8Array, box: Box, type: string): Box | null {
  return children(u8, box.body, box.end).find((b) => b.type === type) ?? null;
}

function path(u8: Uint8Array, box: Box, types: string[]): Box | null {
  let cur: Box | null = box;
  for (const t of types) {
    cur = cur && child(u8, cur, t);
    if (!cur) return null;
  }
  return cur;
}

/** Depth-first search below a box. QuickTime hides esds inside a 'wave' box. */
function findDeep(u8: Uint8Array, from: number, to: number, type: string, depth = 0): Box | null {
  if (depth > 6) return null;
  for (const b of children(u8, from, to)) {
    if (b.type === type) return b;
    if (b.type === 'wave' || CONTAINER_BOXES.has(b.type)) {
      const hit = findDeep(u8, b.body, b.end, type, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Codec config

class Bits {
  private pos = 0;
  constructor(private readonly u8: Uint8Array) {}
  left() {
    return this.u8.length * 8 - this.pos;
  }
  read(n: number) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.u8[this.pos >> 3] ?? 0;
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
}

/** The parts of an MPEG-4 AudioSpecificConfig (ISO 14496-3 1.6.2.1) that ADTS needs. */
function parseAudioSpecificConfig(asc: Uint8Array): AacConfig {
  const b = new Bits(asc);
  const aot = () => {
    const v = b.read(5);
    return v === 31 ? 32 + b.read(6) : v;
  };
  const rate = () => {
    const i = b.read(4);
    return i === 15 ? { index: 15, rate: b.read(24) } : { index: i, rate: AAC_RATES[i] };
  };
  let objectType = aot();
  const core = rate();
  const channelConfig = b.read(4);
  if (objectType === 5 || objectType === 29) {
    // Explicit HE-AAC: the core below is plain AAC, which ADTS carries, and
    // the decoder finds the SBR data in the stream.
    rate();
    objectType = aot();
    if (objectType === 22) b.read(4);
  }
  let frameLength = 1024;
  let pce = false;
  if ([1, 2, 3, 4, 6, 7, 17, 19, 20, 21, 22, 23].includes(objectType)) {
    if (b.read(1)) frameLength = 960;
    if (b.read(1)) b.read(14); // dependsOnCoreCoder, then coreCoderDelay
    b.read(1); // extensionFlag
    // A program_config_element would follow, and ADTS cannot carry it out of band.
    if (channelConfig === 0) pce = true;
  }
  return { objectType, sampleRateIndex: core.index, sampleRate: core.rate, channelConfig, frameLength, pce };
}

function readDescriptorLength(u8: Uint8Array, p: { at: number }): number {
  let len = 0;
  for (let i = 0; i < 4; i++) {
    const c = u8[p.at++];
    len = (len << 7) | (c & 0x7f);
    if (!(c & 0x80)) break;
  }
  return len;
}

function parseEsds(u8: Uint8Array, box: Box): { oti: number; asc: Uint8Array | null } {
  const p = { at: box.body + 4 };
  let oti = 0;
  let asc: Uint8Array | null = null;
  while (p.at < box.end) {
    const tag = u8[p.at++];
    const len = readDescriptorLength(u8, p);
    const bodyStart = p.at;
    if (tag === 0x03) {
      p.at += 2; // ES_ID
      const flags = u8[p.at++];
      if (flags & 0x80) p.at += 2;
      if (flags & 0x40) p.at += 1 + u8[p.at];
      if (flags & 0x20) p.at += 2;
      continue; // its child descriptors follow inline
    }
    if (tag === 0x04) {
      oti = u8[p.at];
      p.at += 13;
      continue;
    }
    if (tag === 0x05) {
      asc = u8.slice(bodyStart, bodyStart + len);
      break;
    }
    p.at = bodyStart + len;
  }
  return { oti, asc };
}

/**
 * The AudioSpecificConfig an MP4 esds box expects, from an AudioEncoder's
 * decoderConfig.description. Chromium hands over the 2-byte config itself;
 * WebKit hands over the whole ES_Descriptor around it, which a muxer that
 * copies it byte for byte turns into an audio track AVFoundation cannot open.
 */
export function normalizeAacDescription(description: AllowSharedBufferSource): Uint8Array {
  const u8 = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  if (u8[0] !== 0x03) return u8.slice();
  // parseEsds skips a 4-byte full-box header, so start it 4 bytes early.
  const { asc } = parseEsds(u8, { type: 'esds', start: 0, body: -4, end: u8.length });
  return asc ?? u8.slice();
}

function parseSampleEntry(
  u8: Uint8Array,
  stsd: Box
): Pick<Mp4AudioTrack, 'codec' | 'kind' | 'config' | 'supported'> {
  const entry = children(u8, stsd.body + 8, stsd.end)[0];
  if (!entry) return { codec: '?', supported: false };
  const type = entry.type;
  // QuickTime sound descriptions grow extra fields in versions 1 and 2.
  const version = (u8[entry.body + 8] << 8) | u8[entry.body + 9];
  const fieldsEnd = entry.body + 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
  if (type === 'mp4a') {
    const esdsBox = findDeep(u8, fieldsEnd, entry.end, 'esds');
    if (!esdsBox) return { codec: type, supported: false };
    const { oti, asc } = parseEsds(u8, esdsBox);
    if (oti === 0x69 || oti === 0x6b) return { codec: type, kind: 'mp3', supported: true };
    if (!asc) return { codec: type, supported: false };
    let config = parseAudioSpecificConfig(asc);
    // MPEG-2 AAC Main, LC and SSR carry their profile in the object type indication.
    if (oti === 0x66 || oti === 0x67 || oti === 0x68) config = { ...config, objectType: oti - 0x65 };
    const supported =
      config.objectType >= 1 &&
      config.objectType <= 4 &&
      config.sampleRateIndex < 13 &&
      // ADTS has three bits for the channel layout; 0 means a PCE it cannot carry.
      config.channelConfig >= 1 &&
      config.channelConfig <= 7 &&
      !config.pce &&
      config.frameLength === 1024;
    return { codec: type, kind: 'aac', config, supported };
  }
  if (type === '.mp3' || type === 'mp3 ') return { codec: type, kind: 'mp3', supported: true };
  return { codec: type, supported: false };
}

// ---------------------------------------------------------------------------
// Sample tables

const EMPTY_TABLE: SampleTable = {
  count: 0,
  sizes: new Uint32Array(0),
  offsets: new Float64Array(0),
  times: new Float64Array(0),
  endTime: 0,
};

function parseSampleTable(u8: Uint8Array, stbl: Box, fileSize: number): SampleTable | null {
  const stsz = child(u8, stbl, 'stsz');
  const stz2 = child(u8, stbl, 'stz2');
  const stsc = child(u8, stbl, 'stsc');
  const stco = child(u8, stbl, 'stco');
  const co64 = child(u8, stbl, 'co64');
  const stts = child(u8, stbl, 'stts');
  if (!(stsz || stz2) || !stsc || !(stco || co64) || !stts) return null;

  let count: number;
  let sizeAt: (i: number) => number;
  if (stsz) {
    const constant = u32(u8, stsz.body + 4);
    count = u32(u8, stsz.body + 8);
    sizeAt = constant ? () => constant : (i) => u32(u8, stsz.body + 12 + i * 4);
    if (constant === 1 && count > 0) {
      // Old QuickTime sound addressing, one "sample" per PCM frame.
      throw new Mp4AudioError('unsupported-layout', 'Legacy QuickTime sound sample table.');
    }
  } else {
    const box = stz2!;
    const field = u8[box.body + 7];
    count = u32(u8, box.body + 8);
    const base = box.body + 12;
    sizeAt =
      field === 16
        ? (i) => (u8[base + i * 2] << 8) | u8[base + i * 2 + 1]
        : field === 8
          ? (i) => u8[base + i]
          : (i) => (u8[base + (i >> 1)] >> (i & 1 ? 0 : 4)) & 0xf;
  }
  if (count === 0) return EMPTY_TABLE;
  // A corrupt count must not allocate gigabytes: the sizes have to fit in
  // their box, and the samples in the file.
  const sizeBytes = stsz
    ? u32(u8, stsz.body + 4)
      ? 0
      : count * 4
    : Math.ceil((count * u8[stz2!.body + 7]) / 8);
  const sizeBox = (stsz || stz2)!;
  if (sizeBytes > sizeBox.end - (sizeBox.body + 12) || (stsz && u32(u8, stsz.body + 4) * count > fileSize)) {
    throw new Mp4AudioError('truncated', 'Sample size table is longer than its box.');
  }

  const sizes = new Uint32Array(count);
  for (let i = 0; i < count; i++) sizes[i] = sizeAt(i);

  const chunkBox = (stco || co64)!;
  const chunkCount = u32(u8, chunkBox.body + 4);
  const chunkOffset = co64
    ? (c: number) => u64(u8, co64.body + 8 + c * 8)
    : (c: number) => u32(u8, chunkBox.body + 8 + c * 4);
  const offsets = new Float64Array(count);
  const stscCount = u32(u8, stsc.body + 4);
  let sample = 0;
  for (let e = 0; e < stscCount && sample < count; e++) {
    const at = stsc.body + 8 + e * 12;
    const firstChunk = u32(u8, at) - 1;
    const perChunk = u32(u8, at + 4);
    const nextFirst = e + 1 < stscCount ? u32(u8, at + 12) - 1 : chunkCount;
    for (let c = firstChunk; c < nextFirst && sample < count; c++) {
      let off = chunkOffset(c);
      for (let k = 0; k < perChunk && sample < count; k++) {
        offsets[sample] = off;
        off += sizes[sample];
        sample++;
      }
    }
  }
  if (sample < count) throw new Mp4AudioError('truncated', 'Sample table is shorter than the sample count.');

  const times = new Float64Array(count);
  const sttsCount = u32(u8, stts.body + 4);
  let t = 0;
  sample = 0;
  for (let e = 0; e < sttsCount && sample < count; e++) {
    const n = u32(u8, stts.body + 8 + e * 8);
    const delta = u32(u8, stts.body + 12 + e * 8);
    for (let k = 0; k < n && sample < count; k++) {
      times[sample++] = t;
      t += delta;
    }
  }
  for (; sample < count; sample++) times[sample] = t; // a short stts pins the rest
  return { count, sizes, offsets, times, endTime: t };
}

/** One track's samples out of every moof, for a fragmented MP4 (MediaRecorder writes these). */
function collectFragments(
  fragments: { start: number; u8: Uint8Array }[],
  trackId: number,
  trex: { duration: number; size: number } | undefined,
  fileSize: number,
  startTime: number
): SampleTable {
  const sizes: number[] = [];
  const offsets: number[] = [];
  const times: number[] = [];
  let nextTime = startTime;
  for (const { u8, start } of fragments) {
    let prevDataEnd: number | null = null;
    for (const traf of children(u8, 8, u8.length).filter((b) => b.type === 'traf')) {
      const tfhd = child(u8, traf, 'tfhd');
      if (!tfhd) continue;
      const flags = (u8[tfhd.body + 1] << 16) | (u8[tfhd.body + 2] << 8) | u8[tfhd.body + 3];
      const id = u32(u8, tfhd.body + 4);
      let q = tfhd.body + 8;
      let base: number | null = null;
      if (flags & 0x1) {
        base = u64(u8, q);
        q += 8;
      }
      if (flags & 0x2) q += 4;
      let defDuration = trex?.duration ?? 0;
      let defSize = trex?.size ?? 0;
      if (flags & 0x8) {
        defDuration = u32(u8, q);
        q += 4;
      }
      if (flags & 0x10) {
        defSize = u32(u8, q);
        q += 4;
      }
      if (base === null) base = flags & 0x20000 || prevDataEnd === null ? start : prevDataEnd;
      const tfdt = child(u8, traf, 'tfdt');
      if (id === trackId && tfdt) nextTime = u8[tfdt.body] === 1 ? u64(u8, tfdt.body + 4) : u32(u8, tfdt.body + 4);
      let dataEnd: number = base;
      for (const trun of children(u8, traf.body, traf.end).filter((b) => b.type === 'trun')) {
        const tf = (u8[trun.body + 1] << 16) | (u8[trun.body + 2] << 8) | u8[trun.body + 3];
        const n = u32(u8, trun.body + 4);
        let r = trun.body + 8;
        let off: number;
        if (tf & 0x1) {
          off = base + i32(u8, r);
          r += 4;
        } else {
          off = dataEnd;
        }
        if (tf & 0x4) r += 4;
        const perSample = 4 * (((tf >> 8) & 1) + ((tf >> 9) & 1) + ((tf >> 10) & 1) + ((tf >> 11) & 1));
        if ((perSample && n * perSample > trun.end - r) || (!perSample && n > fileSize)) {
          throw new Mp4AudioError('truncated', 'Track fragment run is longer than its box.');
        }
        for (let k = 0; k < n; k++) {
          let dur = defDuration;
          let size = defSize;
          if (tf & 0x100) {
            dur = u32(u8, r);
            r += 4;
          }
          if (tf & 0x200) {
            size = u32(u8, r);
            r += 4;
          }
          if (tf & 0x400) r += 4;
          if (tf & 0x800) r += 4;
          if (id === trackId) {
            sizes.push(size);
            offsets.push(off);
            times.push(nextTime);
            nextTime += dur;
          }
          off += size;
        }
        dataEnd = off;
      }
      prevDataEnd = dataEnd;
    }
  }
  return {
    count: sizes.length,
    sizes: Uint32Array.from(sizes),
    offsets: Float64Array.from(offsets),
    times: Float64Array.from(times),
    endTime: nextTime,
  };
}

function joinTables(a: SampleTable, b: SampleTable): SampleTable {
  const join = <T extends Uint32Array | Float64Array>(x: T, y: T, out: T) => {
    out.set(x);
    out.set(y, x.length);
    return out;
  };
  const count = a.count + b.count;
  return {
    count,
    sizes: join(a.sizes, b.sizes, new Uint32Array(count)),
    offsets: join(a.offsets, b.offsets, new Float64Array(count)),
    times: join(a.times, b.times, new Float64Array(count)),
    endTime: b.endTime,
  };
}

// ---------------------------------------------------------------------------
// Public API

/**
 * Every sound track in an MP4 or MOV, without reading its media data. An empty
 * list means the file has no sound. Throws Mp4AudioError('not-mp4') for
 * anything that is not ISO-BMFF or QuickTime, WebM included.
 */
export async function probeMp4Audio(blob: Blob): Promise<Mp4AudioTrack[]> {
  const boxes = await topLevelBoxes(blob);
  const moovBox = boxes.find((b) => b.type === 'moov');
  if (!moovBox) {
    throw new Mp4AudioError('truncated', 'This file has no movie header (moov). It may be incomplete.');
  }
  if (moovBox.size > MAX_MOOV_BYTES) throw new Mp4AudioError('unsupported-layout', 'Movie header is too large.');
  const u8 = await readBytes(blob, moovBox.start, moovBox.start + moovBox.size);
  const moov: Box = { type: 'moov', start: 0, body: moovBox.headerSize, end: u8.length };

  const mvhd = child(u8, moov, 'mvhd');
  const movieTimescale = mvhd ? (u8[mvhd.body] === 1 ? u32(u8, mvhd.body + 20) : u32(u8, mvhd.body + 12)) : 1000;
  const mvex = child(u8, moov, 'mvex');
  let fragments: { start: number; u8: Uint8Array }[] | null = null;

  const tracks: Mp4AudioTrack[] = [];
  for (const trak of children(u8, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const hdlr = path(u8, trak, ['mdia', 'hdlr']);
    if (!hdlr || fourcc(u8, hdlr.body + 8) !== 'soun') continue;
    const tkhd = child(u8, trak, 'tkhd');
    const trackId = tkhd ? u32(u8, tkhd.body + (u8[tkhd.body] === 1 ? 20 : 12)) : 0;
    const enabled = tkhd ? (u8[tkhd.body + 3] & 1) === 1 : true;
    const mdhd = path(u8, trak, ['mdia', 'mdhd']);
    if (!mdhd) continue;
    const mdhdV1 = u8[mdhd.body] === 1;
    const timescale = u32(u8, mdhd.body + (mdhdV1 ? 20 : 12)) || 1;
    const mediaDuration = mdhdV1 ? u64(u8, mdhd.body + 24) : u32(u8, mdhd.body + 16);
    const stbl = path(u8, trak, ['mdia', 'minf', 'stbl']);
    const stsd = stbl && child(u8, stbl, 'stsd');
    const codec = stsd ? parseSampleEntry(u8, stsd) : { codec: '?', supported: false };

    // Leading empty edits delay the track; the first real edit says which
    // media time plays from there, which is where AAC priming is skipped.
    let editDelay = 0;
    let editStart = 0;
    let editDuration: number | null = null;
    const elst = path(u8, trak, ['edts', 'elst']);
    if (elst) {
      const v1 = u8[elst.body] === 1;
      const editCount = u32(u8, elst.body + 4);
      let q = elst.body + 8;
      for (let e = 0; e < editCount; e++) {
        const segment = v1 ? u64(u8, q) : u32(u8, q);
        const mediaTime = v1 ? i64(u8, q + 8) : i32(u8, q + 4);
        q += v1 ? 20 : 12;
        if (mediaTime === -1) {
          editDelay += segment / movieTimescale;
          continue;
        }
        editStart = mediaTime / timescale;
        editDuration = segment / movieTimescale;
        break;
      }
    }

    let table = stbl ? parseSampleTable(u8, stbl, blob.size) : null;
    if (mvex) {
      if (!fragments) {
        fragments = [];
        for (const b of boxes.filter((x) => x.type === 'moof')) {
          fragments.push({ start: b.start, u8: await readBytes(blob, b.start, b.start + b.size) });
        }
      }
      const trex = children(u8, mvex.body, mvex.end)
        .filter((b) => b.type === 'trex')
        .map((b) => ({ id: u32(u8, b.body + 4), duration: u32(u8, b.body + 12), size: u32(u8, b.body + 16) }))
        .find((x) => x.id === trackId);
      // Some writers put the first fragment's samples in the moov and the
      // rest in moofs, so the two lists join end to end.
      const head = table ?? EMPTY_TABLE;
      const tail = collectFragments(fragments, trackId, trex, blob.size, head.endTime);
      if (tail.count > 0) table = head.count > 0 ? joinTables(head, tail) : tail;
    }
    table ??= EMPTY_TABLE;

    const mediaSeconds = (table.endTime || mediaDuration) / timescale;
    // A zero-length edit (some fragmented writers) means "the whole media".
    const presented = editDuration && editDuration > 0 ? editDuration : Math.max(0, mediaSeconds - editStart);
    tracks.push({
      trackId,
      enabled,
      ...codec,
      timescale,
      editDelay,
      editStart,
      duration: presented,
      sampleCount: table.count,
      table,
    });
  }
  return tracks;
}

function adtsHeader(out: Uint8Array, at: number, cfg: AacConfig, frameLength: number) {
  const profile = cfg.objectType - 1;
  const ch = cfg.channelConfig;
  out[at] = 0xff;
  out[at + 1] = 0xf1;
  out[at + 2] = (profile << 6) | (cfg.sampleRateIndex << 2) | ((ch >> 2) & 1);
  out[at + 3] = ((ch & 3) << 6) | ((frameLength >> 11) & 3);
  out[at + 4] = (frameLength >> 3) & 0xff;
  out[at + 5] = ((frameLength & 7) << 5) | 0x1f;
  out[at + 6] = 0xfc;
}

function lastIndexAtOrBefore(times: Float64Array, value: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= value) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface Mp4AudioStream {
  data: Uint8Array;
  /** Seconds the packets cover, before the decoder drops anything. */
  covered: number;
  /** Seconds into the decoded audio where `start` plays. */
  offset: number;
  /** Seconds of silence before the track begins, when `start` falls inside an empty edit. */
  lead: number;
  /** Seconds of sound to play from `offset`. */
  duration: number;
  packets: number;
}

/**
 * The packets covering presentation seconds [start, end) as an ADTS (or raw
 * MP3) byte stream. A few packets before `start` come along, because an AAC
 * frame overlaps the one before it and the first decoded frame is the decoder
 * warming up.
 */
async function extractAudioStream(
  blob: Blob,
  track: Mp4AudioTrack,
  startSeconds: number,
  endSeconds: number
): Promise<Mp4AudioStream> {
  const { table, timescale } = track;
  const start = Math.max(0, startSeconds);
  const end = Math.min(endSeconds, track.editDelay + track.duration);
  if (!(end > start) || table.count === 0) {
    return { data: new Uint8Array(0), covered: 0, offset: 0, lead: 0, duration: 0, packets: 0 };
  }

  const lead = Math.max(0, track.editDelay - start);
  const mediaStart = track.editStart + Math.max(0, start - track.editDelay);
  const mediaEnd = track.editStart + (end - track.editDelay);
  // Three packets of pre-roll: an engine that drops the 2112 priming samples
  // (WebKit does) would otherwise cut into the requested start.
  const first = Math.max(0, lastIndexAtOrBefore(table.times, mediaStart * timescale) - 3);
  const last = Math.min(table.count - 1, lastIndexAtOrBefore(table.times, mediaEnd * timescale) + 1);

  const header = track.kind === 'aac' ? 7 : 0;
  let total = 0;
  for (let i = first; i <= last; i++) total += table.sizes[i] + header;
  const out = new Uint8Array(total);

  // Packets close together in the file are read with one slice.
  const GAP = 64 * 1024;
  const MAX_RUN = 4 * 1024 * 1024;
  let w = 0;
  let i = first;
  while (i <= last) {
    let j = i;
    const runStart = table.offsets[i];
    let runEnd = runStart + table.sizes[i];
    while (
      j + 1 <= last &&
      table.offsets[j + 1] >= runEnd &&
      table.offsets[j + 1] - runEnd <= GAP &&
      table.offsets[j + 1] + table.sizes[j + 1] - runStart <= MAX_RUN
    ) {
      j++;
      runEnd = table.offsets[j] + table.sizes[j];
    }
    const bytes = await readBytes(blob, runStart, runEnd);
    if (bytes.length < runEnd - runStart) throw new Mp4AudioError('truncated', 'Audio data runs past the end of the file.');
    for (let k = i; k <= j; k++) {
      const size = table.sizes[k];
      if (header && track.config) adtsHeader(out, w, track.config, size + header);
      const from = table.offsets[k] - runStart;
      out.set(bytes.subarray(from, from + size), w + header);
      w += size + header;
    }
    i = j + 1;
  }
  const coveredEnd = last + 1 < table.count ? table.times[last + 1] : table.endTime;
  return {
    data: out,
    covered: Math.max(0, coveredEnd - table.times[first]) / timescale,
    offset: mediaStart - table.times[first] / timescale,
    lead,
    duration: end - start - lead,
    packets: last - first + 1,
  };
}

export interface DecodedMp4Audio {
  buffer: AudioBuffer;
  offset: number;
  lead: number;
  duration: number;
}

/**
 * Decode the first enabled sound track of an MP4 or MOV between presentation
 * seconds [start, end), at `context`'s sample rate. Null when the file has no
 * sound track. Play it with `source.start(when + lead, offset, duration)`.
 */
export async function decodeMp4Audio(
  blob: Blob,
  context: BaseAudioContext,
  start: number,
  end: number
): Promise<DecodedMp4Audio | null> {
  const tracks = await probeMp4Audio(blob);
  const playable = (t: Mp4AudioTrack) => t.supported && t.sampleCount > 0;
  const track = tracks.find((t) => t.enabled && playable(t)) ?? tracks.find(playable);
  if (!track) {
    // A sound track with no samples (a writer that never got any audio) is
    // silence, not an unreadable codec.
    const unreadable = tracks.find((t) => t.sampleCount > 0);
    if (unreadable) throw new Mp4AudioError('unsupported-codec', `Unsupported audio codec (${unreadable.codec}).`);
    return null;
  }
  const stream = await extractAudioStream(blob, track, start, end);
  if (stream.packets === 0) return null;
  const buffer = await context.decodeAudioData(stream.data.buffer as ArrayBuffer);
  // Whatever the decoder dropped came off the front (the priming), so the
  // requested start sits that much earlier in the buffer. Capped at a few
  // frames, so a stream that decodes short for some other reason is not
  // shifted by seconds.
  const dropped = Math.min(Math.max(0, stream.covered - buffer.duration), 0.25);
  return { buffer, offset: Math.max(0, stream.offset - dropped), lead: stream.lead, duration: stream.duration };
}
