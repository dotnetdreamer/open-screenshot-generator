/**
 * `osg video`: the MP4 app preview run.
 *
 * Two things here are not obvious.
 *
 * The recording never crosses the JSON-RPC boundary. A screen capture is tens
 * of megabytes and `upload_recording` caps a request body at 32 MiB, so the
 * file is published on the CLI's own origin and the tool is handed the URL it
 * already knows how to fetch. That is what the /__osg/media/ route and its
 * Range support in editor/server.ts exist for.
 *
 * And MP4 is the one thing this CLI cannot do in every browser. `VideoEncoder`
 * with an avc1 config is unsupported on plain Chromium builds, so the encoder
 * is probed in the page before a single frame is rendered. Finding out 20
 * minutes into a render that the browser has no H.264 is a waste of everyone's
 * afternoon.
 */
import fs from 'node:fs';
import path from 'node:path';
import { flagNumber, flagString } from '../args.js';
import type { CommandContext } from '../context.js';
import type { SavedFile, Session } from '../driver/session.js';
import { EXIT, driverError, usageError } from '../errors.js';
import { bold, debug, emit, humanBytes, humanMs, info, ok, step, warn } from '../log.js';
import { openProject, printFileTable, waitForFiles } from './render.js';

/**
 * The three renders of one board, mapped onto VideoExportRequest
 * (src/components/open-screenshot-generator/ExportDialog.tsx).
 *
 *   store-raw   the recording alone, nothing drawn over it
 *   store-text  the recording with the board's text and gesture hints kept
 *   styled      the full designed board, animations and all
 *
 * The first two are what App Store guideline 2.3.4 asks for: a preview has to
 * be footage of the app, not a motion graphic about it.
 */
const MODES = {
  'store-raw': { rawRecordingOnly: true, keepOverlays: false, label: 'raw recording' },
  'store-text': { rawRecordingOnly: true, keepOverlays: true, label: 'raw recording with overlays' },
  styled: { rawRecordingOnly: false, keepOverlays: false, label: 'styled board' },
} as const;

type VideoMode = keyof typeof MODES;

/** Same ladder pickEncoderConfig walks in src/lib/video/videoExport.ts. */
const H264_CANDIDATES = ['avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4D0028', 'avc1.42E01F'];

const DEFAULT_FPS = 30;
const DEFAULT_FILE_WAIT_MS = 180_000;
/** Apple's window for an app preview. */
const MIN_STORE_SECONDS = 15;
const MAX_STORE_SECONDS = 30;

interface TimelineFacts {
  artboardId: string;
  name: string;
  durationSeconds: number;
  hasMotion: boolean;
  hasRecording: boolean;
  warnings: string[];
}

interface BoardElement {
  id: string;
  type: string;
  name?: string;
  mediaId?: string;
  videoSrc?: string;
}

/**
 * Probe the encoders the export will actually use, at the size it will use.
 *
 * The audio half looks like a detail and is not. createSilentAudioTrack in
 * src/lib/video/videoExport.ts mutes-and-continues when the browser cannot
 * encode AAC, and App Store Connect reads a preview with no audio track as one
 * with corrupt audio and rejects it. A headless browser is exactly where that
 * silently happens, so it is worth saying before the render, not after.
 */
async function probeEncoders(
  session: Session,
  width: number,
  height: number,
  fps: number
): Promise<{ ok: boolean; codec: string | null; reason: string | null; audio: boolean }> {
  return session.evaluate(`(async () => {
  let audio = false;
  try {
    if (typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined') {
      const support = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      });
      audio = !!support.supported;
    }
  } catch (error) {}
  if (typeof VideoEncoder === 'undefined') {
    return { ok: false, codec: null, reason: 'this browser has no WebCodecs VideoEncoder', audio: audio };
  }
  for (const codec of ${JSON.stringify(H264_CANDIDATES)}) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: codec,
        width: ${width},
        height: ${height},
        bitrate: 6000000,
        framerate: ${fps},
        latencyMode: 'quality',
        avc: { format: 'avc' },
      });
      if (support.supported) return { ok: true, codec: codec, reason: null, audio: audio };
    } catch (error) {}
  }
  return { ok: false, codec: null, reason: 'no H.264 profile is supported', audio: audio };
})()`);
}

async function timelineOf(session: Session, artboardId: string): Promise<TimelineFacts | null> {
  try {
    const raw = (await session.call('get_preview_timeline', { artboardId })) as Partial<TimelineFacts>;
    if (!raw || typeof raw !== 'object') return null;
    return {
      artboardId,
      name: raw.name ?? artboardId,
      durationSeconds: raw.durationSeconds ?? 0,
      hasMotion: !!raw.hasMotion,
      hasRecording: !!raw.hasRecording,
      warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    };
  } catch (error) {
    debug(`no timeline for ${artboardId}: ${(error as Error).message}`);
    return null;
  }
}

/** Publish the file, store it, and put it in every video layer on the targets. */
async function attachRecording(
  session: Session,
  recording: string,
  targets: TimelineFacts[]
): Promise<{ mediaId: string; layers: number }> {
  const url = session.serveFile(recording, path.basename(recording));
  const bytes = fs.statSync(recording).size;
  step(`recording: ${path.basename(recording)}, ${humanBytes(bytes)}`);

  const stored = (await session.call('upload_recording', {
    source: url,
    name: path.basename(recording),
  })) as { mediaId?: string };
  if (!stored?.mediaId) {
    throw driverError(
      'upload_recording stored the file but returned no media id.',
      'Re-run with --verbose to see what the page answered.'
    );
  }

  let layers = 0;
  for (const target of targets) {
    const board = (await session.call('get_artboard', { artboardId: target.artboardId })) as {
      elements?: BoardElement[];
    };
    for (const element of board?.elements ?? []) {
      if (element.type !== 'video-device' && element.type !== 'video') continue;
      // An explicit --recording is an instruction, so it replaces whatever the
      // layer was pointing at rather than only filling empty ones.
      await session.call('update_element', {
        artboardId: target.artboardId,
        elementId: element.id,
        mediaId: stored.mediaId,
      });
      layers++;
    }
  }
  if (layers === 0) {
    warn('no video layer to put the recording in, the boards have no phone playing a recording');
  }
  return { mediaId: stored.mediaId, layers };
}

function resolveMode(ctx: CommandContext): VideoMode {
  const asked = (flagString(ctx.args.flags, 'mode') ?? ctx.config.video?.mode ?? 'store-raw').trim();
  if (asked in MODES) return asked as VideoMode;
  throw usageError(`Unknown video mode "${asked}".`, `Use one of: ${Object.keys(MODES).join(', ')}.`);
}

function resolveFps(ctx: CommandContext): number {
  const fps = flagNumber(ctx.args.flags, 'fps') ?? ctx.config.video?.fps ?? DEFAULT_FPS;
  if (fps !== 30 && fps !== 60) {
    throw usageError(`--fps ${fps} is not a preview frame rate.`, 'Apple takes 30 or 60.');
  }
  return fps;
}

export async function run(ctx: CommandContext): Promise<number> {
  const started = Date.now();
  const flags = ctx.args.flags;
  const only = flagString(flags, 'only');
  const mode = resolveMode(ctx);
  const fps = resolveFps(ctx);
  const timeoutFlag = flagNumber(flags, 'timeout');
  const waitMs = timeoutFlag && timeoutFlag > 0 ? timeoutFlag * 1000 : DEFAULT_FILE_WAIT_MS;

  const recordingArg = flagString(flags, 'recording') ?? ctx.config.video?.recording;
  const recording = recordingArg ? path.resolve(ctx.root, recordingArg) : null;
  if (recording && !fs.existsSync(recording)) {
    throw usageError(`No recording at ${recording}`, 'Point --recording at a screen capture, or set video.recording in the config.');
  }

  const session = await ctx.session();
  const status = await openProject(ctx, session);
  if (status.artboards.length === 0) {
    throw driverError('The project opened with no artboards.', 'Check the project file, or rebuild it with `osg new`.');
  }

  let boards = status.artboards;
  if (only) {
    const board = boards.find((artboard) => artboard.id === only || artboard.name === only);
    if (!board) {
      throw usageError(
        `No artboard "${only}" in this project.`,
        `It has: ${boards.map((artboard) => `${artboard.id} (${artboard.name})`).join(', ')}.`
      );
    }
    await session.call('set_active_artboard', { artboardId: board.id });
    boards = [board];
  }

  // Apple's preview canvas, in the orientation the board is already in. The
  // export resizes to it whatever the board's own size is.
  const first = boards[0];
  const landscape = first.width > first.height;
  const sizeMode = landscape ? 'appstore-landscape' : 'appstore-portrait';
  const width = landscape ? 1920 : 886;
  const height = landscape ? 886 : 1920;

  const encoder = await probeEncoders(session, width, height, fps);
  if (!encoder.ok) {
    warn(`this browser cannot encode H.264 MP4: ${encoder.reason}`);
    warn('MP4 needs a branded Chrome or Edge. Chromium and Chrome for Testing ship without the proprietary codecs.');
    warn('Point --browser at a Chrome or Edge executable, or install one, then run this again.');
  } else {
    debug(`encoder: ${encoder.codec}`);
  }
  if (!encoder.audio) {
    warn('this browser cannot encode AAC, so the MP4 will have no audio track');
    warn('App Store Connect reads a preview with no audio track as corrupted audio and rejects it. Use Chrome or Edge.');
  }

  // Which boards the export will even look at: one with neither motion nor a
  // recording is a still, and handleExportVideo skips it.
  let targets: TimelineFacts[] = [];
  for (const board of boards) {
    const facts = await timelineOf(session, board.id);
    if (facts && (facts.hasMotion || facts.hasRecording)) targets.push(facts);
  }
  if (targets.length === 0) {
    throw usageError(
      'No artboard in this project has a recording, a gesture or an animation.',
      'An app preview needs a video board. Add one with `osg edit --tool add_preview_scene`.'
    );
  }

  let attached: { mediaId: string; layers: number } | null = null;
  if (recording) {
    attached = await attachRecording(session, recording, targets);
    // The timeline changes once footage is in: hasRecording flips and the
    // suggested duration follows the clip.
    const refreshed: TimelineFacts[] = [];
    for (const target of targets) {
      const facts = await timelineOf(session, target.artboardId);
      if (facts) refreshed.push(facts);
    }
    if (refreshed.length) targets = refreshed;
  }

  const config = MODES[mode];
  if (config.rawRecordingOnly && !targets.some((target) => target.hasRecording)) {
    throw usageError(
      `Mode ${mode} renders the screen recording itself, and no board has one.`,
      'Pass --recording <file>, or use --mode styled to render the designed board instead.'
    );
  }

  for (const target of targets) {
    for (const warning of target.warnings) warn(`${target.name}: ${warning}`);
  }

  const askedDuration = flagNumber(flags, 'duration') ?? ctx.config.video?.duration;
  const suggested = Math.max(0, ...targets.map((target) => target.durationSeconds));
  const durationSeconds = askedDuration ?? Math.min(MAX_STORE_SECONDS, Math.max(MIN_STORE_SECONDS, Math.round(suggested) || MIN_STORE_SECONDS));
  if (durationSeconds > MAX_STORE_SECONDS) {
    throw usageError(
      `--duration ${durationSeconds} is longer than an app preview may be.`,
      `App Store Connect takes ${MIN_STORE_SECONDS} to ${MAX_STORE_SECONDS} seconds.`
    );
  }
  if (durationSeconds < MIN_STORE_SECONDS) {
    warn(`${durationSeconds}s is under Apple's ${MIN_STORE_SECONDS} second floor, the upload will be rejected`);
  }

  step(
    `video: ${config.label}, ${targets.length} ${targets.length === 1 ? 'board' : 'boards'}, ` +
      `${width}x${height}, ${durationSeconds}s at ${fps} fps`
  );
  if (attached) info(`  recording in ${attached.layers} ${attached.layers === 1 ? 'layer' : 'layers'} as ${attached.mediaId}`);

  const since = Date.now();
  let saved: SavedFile[];
  try {
    saved = await session.exportVideo({
      fps,
      durationSeconds,
      sizeMode,
      rawRecordingOnly: config.rawRecordingOnly,
      keepOverlays: config.keepOverlays,
      currentArtboardOnly: !!only,
    });
  } catch (error) {
    throw driverError(
      `The video export failed: ${(error as Error).message}`,
      encoder.ok
        ? 'Re-run with --verbose to see the page console, or with --headed to watch it.'
        : 'This browser has no H.264 encoder. Point --browser at Chrome or Edge.'
    );
  }

  if (saved.length === 0) {
    throw driverError(
      'The editor rendered no video.',
      'Nothing matched the selection. Check --only, and that the board has a recording for a store mode.'
    );
  }

  const filenames = [...new Set(saved.map((file) => file.filename))];
  const { written, missing, unexpected } = await waitForFiles(ctx.outDir, filenames, { timeoutMs: waitMs, since });
  if (missing.length) {
    throw driverError(
      `${missing.length} of ${filenames.length} videos never arrived in ${ctx.outDir}: ${missing.join(', ')}`,
      unexpected.length
        ? `The browser saved these instead: ${unexpected.join(', ')}. Clear the output directory, or render into a fresh --out.`
        : `An MP4 is large and lands after the render finishes. Raise --timeout above ${Math.round(waitMs / 1000)}s, ` +
          `or check that ${ctx.outDir} is writable.`,
      { missing, unexpected, written: written.map((file) => file.filename) }
    );
  }

  const bytes = written.reduce((sum, file) => sum + file.bytes, 0);
  printFileTable(written);
  ok(
    `${written.length} ${written.length === 1 ? 'video' : 'videos'}, ${humanBytes(bytes)}, ` +
      `${humanMs(Date.now() - started)} ${bold('->')} ${ctx.outDir}`
  );

  if (ctx.json) {
    emit({
      command: 'video',
      outDir: ctx.outDir,
      project: { file: ctx.projectFile, name: status.projectName },
      mode,
      fps,
      durationSeconds,
      sizeMode,
      width,
      height,
      encoder: encoder.codec,
      audioTrack: encoder.audio,
      recording: recording ?? null,
      mediaId: attached?.mediaId ?? null,
      boards: targets.map((target) => ({
        id: target.artboardId,
        name: target.name,
        hasRecording: target.hasRecording,
        durationSeconds: target.durationSeconds,
      })),
      files: written.map((file) => ({ filename: file.filename, path: file.path, bytes: file.bytes })),
      bytes,
      durationMs: Date.now() - started,
    });
  }

  return EXIT.ok;
}
