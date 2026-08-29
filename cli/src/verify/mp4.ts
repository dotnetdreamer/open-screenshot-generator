/**
 * MP4 box reading, by hand.
 *
 * Same reason as png.ts: ffprobe is not installed on a contributor's machine
 * and `osg verify` has to behave identically on Windows, Linux and macOS. An
 * MP4's metadata is a tree of length prefixed boxes, and everything a store
 * rule asks about lives in five of them:
 *
 *   moov > mvhd                              timescale and duration, so seconds
 *   moov > trak > mdia > hdlr                'vide' or 'soun', so which track
 *   moov > trak > mdia > mdhd                the track's own timescale
 *   moov > trak > mdia > minf > stbl > stsd  the codec and the coded pixel size
 *   moov > trak > mdia > minf > stbl > stts  sample count, so fps
 *
 * The audio track is not a detail. src/lib/video/videoExport.ts muxes a silent
 * 48kHz AAC track into every export on purpose, because App Store Connect
 * treats a MISSING audio track as a broken one ("Your app preview contains
 * unsupported or corrupted audio"). That mux is best effort by design: a
 * browser with no AudioEncoder still produces a valid video only MP4 rather
 * than failing the export, and a headless Chrome is exactly the browser most
 * likely to lack one. So a preview MP4 that reaches disk with no audio track
 * is a real, uploadable-looking file that App Store Connect will reject, and
 * catching it is half of why this parser exists.
 *
 * Box layout, from ISO/IEC 14496-12:
 *   [4 byte big endian size][4 byte type][payload]
 * size 1 means a 64 bit size follows the type; size 0 means "to end of file".
 */
import fs from 'node:fs';

export interface Mp4Info {
  /** Presentation duration from mvhd, in seconds. */
  durationSeconds: number;
  /** Coded pixel size of the video track. */
  width: number;
  height: number;
  /** The video sample entry's four character code, e.g. 'avc1'. Empty if none. */
  codec: string;
  /** Full codec string from avcC when H.264, e.g. 'avc1.640028'. */
  codecString: string | null;
  /** Frames per second, derived from the sample table rather than declared. */
  fps: number;
  /** Video sample count, the number the fps above was derived from. */
  frames: number;
  hasAudioTrack: boolean;
  bytes: number;
}

interface Box {
  type: string;
  /** First byte of the payload. */
  start: number;
  /** One past the last byte of the payload. */
  end: number;
}

interface TrackInfo {
  handler: string;
  timescale: number;
  /** Track duration in its own timescale, from mdhd. */
  duration: number;
  codec: string;
  codecString: string | null;
  width: number;
  height: number;
  samples: number;
  /** Sum of the stts deltas, the media duration the sample table itself states. */
  sampleDuration: number;
}

// Bounds checked readers. Out of range returns 0 rather than throwing, because
// every caller below has already bounded the box it is reading inside and a
// truncated file should degrade to "we could not tell" rather than to a crash.
const u8 = (b: Buffer, at: number) => (at >= 0 && at + 1 <= b.length ? b.readUInt8(at) : 0);
const u16 = (b: Buffer, at: number) => (at >= 0 && at + 2 <= b.length ? b.readUInt16BE(at) : 0);
const u32 = (b: Buffer, at: number) => (at >= 0 && at + 4 <= b.length ? b.readUInt32BE(at) : 0);
const u64 = (b: Buffer, at: number) =>
  at >= 0 && at + 8 <= b.length ? Number(b.readBigUInt64BE(at)) : 0;

/** Every box directly inside [start, end). Never recurses, never allocates. */
function* boxesIn(buffer: Buffer, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    const declared = u32(buffer, at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    let header = 8;
    let size = declared;
    if (declared === 1) {
      size = u64(buffer, at + 8);
      header = 16;
    } else if (declared === 0) {
      // "Extends to the end of the enclosing box." Only legal on the last one.
      size = end - at;
    }
    // A size that cannot hold its own header, or that runs past the parent, is
    // a malformed file. Stopping keeps the walk finite.
    if (size < header || at + size > end) return;
    yield { type, start: at + header, end: at + size };
    at += size;
  }
}

/** The first direct child of the given type, or null. */
function childBox(buffer: Buffer, parent: Box, type: string): Box | null {
  for (const box of boxesIn(buffer, parent.start, parent.end)) {
    if (box.type === type) return box;
  }
  return null;
}

/** Walk a chain of nested single children, e.g. mdia > minf > stbl. */
function descend(buffer: Buffer, from: Box, path: string[]): Box | null {
  let current: Box | null = from;
  for (const type of path) {
    if (!current) return null;
    current = childBox(buffer, current, type);
  }
  return current;
}

/** mvhd and mdhd share a layout: version, then timescale and duration. */
function readTimescaleAndDuration(buffer: Buffer, box: Box): { timescale: number; duration: number } {
  const version = u8(buffer, box.start);
  if (version === 1) {
    // creation(8) modification(8) timescale(4) duration(8)
    return { timescale: u32(buffer, box.start + 20), duration: u64(buffer, box.start + 24) };
  }
  // creation(4) modification(4) timescale(4) duration(4)
  return { timescale: u32(buffer, box.start + 12), duration: u32(buffer, box.start + 16) };
}

/**
 * The video sample entry's size and codec.
 *
 * A VisualSampleEntry is 86 bytes of fixed header before its sub-boxes: 8 box
 * header, 6 reserved, 2 data reference index, 16 pre_defined and reserved, then
 * width and height as plain 16 bit integers at offsets 32 and 34.
 *
 * Those two are read rather than tkhd's, deliberately. tkhd carries the DISPLAY
 * size as 16.16 fixed point after the display matrix, so a track with a scaling
 * or rotating matrix reports something other than what was encoded, and the
 * store rule is about the coded frame. This CLI's own exports never set a
 * matrix (mp4-muxer writes identity), so the two agree there.
 */
function readVideoSampleEntry(
  buffer: Buffer,
  stsd: Box
): { codec: string; codecString: string | null; width: number; height: number } | null {
  // stsd payload: version+flags(4), entry_count(4), then the entries.
  const entriesStart = stsd.start + 8;
  for (const entry of boxesIn(buffer, entriesStart, stsd.end)) {
    const width = u16(buffer, entry.start + 24);
    const height = u16(buffer, entry.start + 26);
    if (!width || !height) continue;
    let codecString: string | null = null;
    // Sub-boxes (avcC, pasp, colr) start 78 bytes into the payload.
    for (const config of boxesIn(buffer, entry.start + 78, entry.end)) {
      if (config.type === 'avcC') {
        // configurationVersion(1) profile(1) compatibility(1) level(1)
        const hex = (n: number) => n.toString(16).padStart(2, '0');
        codecString = `${entry.type}.${hex(u8(buffer, config.start + 1))}${hex(
          u8(buffer, config.start + 2)
        )}${hex(u8(buffer, config.start + 3))}`;
        break;
      }
    }
    return { codec: entry.type, codecString, width, height };
  }
  return null;
}

/** Total samples and total media duration from the time to sample table. */
function readStts(buffer: Buffer, stts: Box): { samples: number; duration: number } {
  const count = u32(buffer, stts.start + 4);
  let samples = 0;
  let duration = 0;
  for (let i = 0; i < count; i++) {
    const at = stts.start + 8 + i * 8;
    if (at + 8 > stts.end) break;
    const sampleCount = u32(buffer, at);
    const sampleDelta = u32(buffer, at + 4);
    samples += sampleCount;
    duration += sampleCount * sampleDelta;
  }
  return { samples, duration };
}

function readTrack(buffer: Buffer, trak: Box): TrackInfo | null {
  const mdia = childBox(buffer, trak, 'mdia');
  if (!mdia) return null;

  const hdlr = childBox(buffer, mdia, 'hdlr');
  // hdlr payload: version+flags(4) pre_defined(4) handler_type(4)
  const handler = hdlr ? buffer.toString('latin1', hdlr.start + 8, hdlr.start + 12) : '';

  const mdhd = childBox(buffer, mdia, 'mdhd');
  const timing = mdhd ? readTimescaleAndDuration(buffer, mdhd) : { timescale: 0, duration: 0 };

  const track: TrackInfo = {
    handler,
    timescale: timing.timescale,
    duration: timing.duration,
    codec: '',
    codecString: null,
    width: 0,
    height: 0,
    samples: 0,
    sampleDuration: 0,
  };

  const stbl = descend(buffer, mdia, ['minf', 'stbl']);
  if (stbl) {
    const stsd = childBox(buffer, stbl, 'stsd');
    if (stsd && handler === 'vide') {
      const entry = readVideoSampleEntry(buffer, stsd);
      if (entry) {
        track.codec = entry.codec;
        track.codecString = entry.codecString;
        track.width = entry.width;
        track.height = entry.height;
      }
    }
    const stts = childBox(buffer, stbl, 'stts');
    if (stts) {
      const counted = readStts(buffer, stts);
      track.samples = counted.samples;
      track.sampleDuration = counted.duration;
    }
  }

  return track;
}

const round3 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);

/**
 * What the store rules need to know about an MP4, or null when the buffer has
 * no moov box and so is not an MP4 this can read.
 *
 * Best effort past that point: a file with a moov but no video track comes back
 * with an empty codec and a zero size, because "there is no video track here"
 * is a finding checkMp4 should report, not a reason to say nothing at all.
 */
export function readMp4Info(buffer: Buffer): Mp4Info | null {
  if (buffer.length < 16) return null;

  let moov: Box | null = null;
  for (const box of boxesIn(buffer, 0, buffer.length)) {
    if (box.type === 'moov') {
      moov = box;
      break;
    }
  }
  if (!moov) return null;

  const mvhd = childBox(buffer, moov, 'mvhd');
  const movie = mvhd ? readTimescaleAndDuration(buffer, mvhd) : { timescale: 0, duration: 0 };

  const tracks: TrackInfo[] = [];
  for (const box of boxesIn(buffer, moov.start, moov.end)) {
    if (box.type !== 'trak') continue;
    const track = readTrack(buffer, box);
    if (track) tracks.push(track);
  }

  const video = tracks.find((track) => track.handler === 'vide') ?? null;
  const hasAudioTrack = tracks.some((track) => track.handler === 'soun');

  // Prefer the video track's own sample table for the fps denominator. The
  // sample deltas ARE the frame timing, so count over that duration is exact,
  // where mvhd's duration includes any edit list padding and rounds to the
  // movie timescale.
  let fps = 0;
  if (video && video.samples > 0) {
    const seconds =
      video.timescale > 0 && video.sampleDuration > 0
        ? video.sampleDuration / video.timescale
        : video.timescale > 0 && video.duration > 0
          ? video.duration / video.timescale
          : movie.timescale > 0
            ? movie.duration / movie.timescale
            : 0;
    if (seconds > 0) fps = video.samples / seconds;
  }

  // 0xffffffff is the "unknown duration" sentinel, and reporting 49 days would
  // send every duration rule the wrong way.
  const rawDuration = movie.duration === 0xffffffff ? 0 : movie.duration;
  let durationSeconds = movie.timescale > 0 ? rawDuration / movie.timescale : 0;
  if (durationSeconds === 0 && video && video.timescale > 0 && video.sampleDuration > 0) {
    durationSeconds = video.sampleDuration / video.timescale;
  }

  return {
    durationSeconds: round3(durationSeconds),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    codec: video?.codec ?? '',
    codecString: video?.codecString ?? null,
    fps: round3(fps),
    frames: video?.samples ?? 0,
    hasAudioTrack,
    bytes: buffer.length,
  };
}

/**
 * The same, for a path. Reads the whole file: mp4-muxer's `fastStart:
 * 'in-memory'` puts moov at the front, but a recording dropped in by the user
 * can have it at the back, and seeking around a file to save a few megabytes of
 * read on something verify already has to size is not worth the branch.
 */
export function readMp4File(file: string): Mp4Info | null {
  return readMp4Info(fs.readFileSync(file));
}
