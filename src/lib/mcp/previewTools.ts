// The App Preview half of the MCP surface, kept pure the way localeTools.ts is:
// everything here takes and returns plain data, so the layout only has to
// resolve a board id and commit. Nothing in this file touches React.
//
// What an MCP client needs to make a preview video, in order:
//   1. `list_preview_scenes` / `add_preview_scene` for a finished board, or
//      `add_element` with a `video-device` for a hand-built one.
//   2. `upload_recording` to get real footage into the phone (the image-only
//      `upload_asset` refuses a video: it probes the bytes with an <img>).
//   3. `set_animation` per layer and `set_preview_duration` on the board.
//   4. `get_preview_timeline` to read back what that adds up to, since the
//      model cannot see the canvas.

import type {
  ArtboardElement,
  ArtboardState,
  ElementAnimation,
  ElementAnimationPreset,
  GestureType,
} from '@/types/artboard';
import { db } from '@/database';
import { probeVideoBlob, type VideoProbeResult } from '@/lib/mediaStore';
import { ENTER_DURATION_DEFAULT, EXIT_DURATION_DEFAULT, animationEndTime } from '@/lib/video/animation';
import { GESTURE_DURATION_DEFAULT, GESTURE_TRIGGER_DEFAULT, gestureEndTime } from '@/lib/video/gestures';
import { PREVIEW_DURATION_MAX, artboardTimeline } from '@/lib/video/timeline';
import { PREVIEW_SCENES } from '@/lib/previewScenes';

/** Every enter/exit preset, for the tool schemas and the error messages. */
export const ANIMATION_PRESETS: ElementAnimationPreset[] = [
  'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'scale-up', 'pop',
];

export const GESTURE_TYPES: GestureType[] = [
  'tap', 'double-tap', 'swipe-left', 'swipe-right', 'swipe-up', 'swipe-down',
];

/** Device frames a recording actually composites into. See videoExport. */
export const VIDEO_DEVICE_TYPES = [
  'iphone', 'iphone-x', 'iphone-13', 'iphone-14', 'iphone-15', 'iphone-15-pro',
  'iphone-17-pro-max', 'ipad-pro-13', 'ipad-11', 'android-bar', 'android-notch',
  'android-punch-hole', 'tablet', 'tablet-7', 'tablet-10',
];

// ---------------------------------------------------------------------------
// Ready-made scenes
// ---------------------------------------------------------------------------

export interface McpPreviewSceneSummary {
  sceneId: string;
  name: string;
  /** What the scene is for, verbatim from the palette tile. */
  description: string;
  /** Categories this scene suits, so a second search does not have to guess. */
  suits: string;
  /** Layers the board arrives with. */
  layers: number;
  durationSeconds: number;
  /** Named layers a caller will usually want to rewrite. */
  editableTextLayers: string[];
}

export function listPreviewScenes(query?: string): McpPreviewSceneSummary[] {
  const needle = query?.trim().toLowerCase();
  const matches = PREVIEW_SCENES.filter((scene) => {
    if (!needle) return true;
    return `${scene.label} ${scene.blurb} ${scene.id} ${scene.keywords ?? ''}`.toLowerCase().includes(needle);
  });
  // A query nobody matches is far more useful answered with the whole list than
  // with nothing: the caller wanted a preview scene either way.
  return (matches.length > 0 ? matches : PREVIEW_SCENES).map((scene) => ({
    sceneId: scene.id,
    name: scene.label,
    description: scene.blurb,
    suits: scene.keywords ?? '',
    layers: scene.elements.length,
    durationSeconds: 18,
    editableTextLayers: scene.elements
      .filter((el) => el.type === 'text')
      .map((el) => el.name || 'Text')
      .slice(0, 12),
  }));
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export interface AnimationInput {
  enter?: string | null;
  enterDelay?: number;
  enterDuration?: number;
  exit?: string | null;
  exitStart?: number;
  exitDuration?: number;
  /** Drop the animation entirely; the layer is then on screen the whole time. */
  clear?: boolean;
}

/**
 * Merge an animation patch onto whatever the element already had.
 *
 * `null` on `enter`/`exit` removes that half (and its timings with it), which
 * is the only way to take an exit back off; `clear` removes the whole thing.
 * Returns `{ animation: undefined }` for a removal, because the spread in
 * updateElement drops an undefined key off the element entirely.
 */
export function buildAnimationPatch(
  current: ElementAnimation | undefined,
  input: AnimationInput
): { animation?: ElementAnimation } | { error: string } {
  if (input.clear) return { animation: undefined };

  const next: ElementAnimation = { ...(current ?? {}) };

  if (input.enter === null) {
    delete next.enter;
    delete next.enterDelay;
    delete next.enterDuration;
  } else if (input.enter !== undefined) {
    if (!ANIMATION_PRESETS.includes(input.enter as ElementAnimationPreset)) {
      return { error: `Unknown enter preset "${input.enter}". Use one of: ${ANIMATION_PRESETS.join(', ')}.` };
    }
    next.enter = input.enter as ElementAnimationPreset;
  }

  if (input.exit === null) {
    delete next.exit;
    delete next.exitStart;
    delete next.exitDuration;
  } else if (input.exit !== undefined) {
    if (!ANIMATION_PRESETS.includes(input.exit as ElementAnimationPreset)) {
      return { error: `Unknown exit preset "${input.exit}". Use one of: ${ANIMATION_PRESETS.join(', ')}.` };
    }
    next.exit = input.exit as ElementAnimationPreset;
  }

  if (input.enterDelay !== undefined) next.enterDelay = Math.max(0, input.enterDelay);
  if (input.enterDuration !== undefined) next.enterDuration = Math.max(0, input.enterDuration);
  if (input.exitStart !== undefined) next.exitStart = Math.max(0, input.exitStart);
  if (input.exitDuration !== undefined) next.exitDuration = Math.max(0, input.exitDuration);

  // An exit with no start never fires, which reads as "the tool did nothing".
  if (next.exit && next.exitStart === undefined) {
    return { error: 'An exit needs exitStart (the second it begins). Without it the layer never leaves.' };
  }
  if (next.exit && next.enter) {
    const enterEnd = (next.enterDelay ?? 0) + (next.enterDuration ?? ENTER_DURATION_DEFAULT);
    if ((next.exitStart ?? 0) < enterEnd) {
      return {
        error:
          `exitStart ${next.exitStart} is before the enter finishes at ${enterEnd.toFixed(2)}s, ` +
          'so the layer would leave while it is still arriving. Move exitStart later or shorten the enter.',
      };
    }
  }

  if (!next.enter && !next.exit) return { animation: undefined };
  return { animation: next };
}

// ---------------------------------------------------------------------------
// Reading a board back as a timeline
// ---------------------------------------------------------------------------

export interface McpTimelineClip {
  elementId: string;
  name: string;
  type: ArtboardElement['type'];
  /** 'animation' | 'gesture' | 'recording' | 'static' */
  kind: 'animation' | 'gesture' | 'recording' | 'static';
  /** Second the layer appears. */
  start: number;
  /** Second it is gone, or the board length when it stays. */
  end: number;
  detail?: string;
}

export interface McpPreviewTimeline {
  artboardId: string;
  name: string;
  /** What the export and the canvas player will use. */
  durationSeconds: number;
  /** True when previewDurationSeconds is set rather than derived. */
  durationIsExplicit: boolean;
  /** Second the last animation, gesture or recording finishes. */
  contentEndSeconds: number;
  /** False when nothing on the board moves: this is a still, not a preview. */
  hasMotion: boolean;
  /** False until a recording is dropped in; the store exports need one. */
  hasRecording: boolean;
  clips: McpTimelineClip[];
  /** Anything that will bite at export time. */
  warnings: string[];
}

export function summarizePreviewTimeline(board: ArtboardState): McpPreviewTimeline {
  const timeline = artboardTimeline(board);
  const duration = timeline.duration || 0;
  const clips: McpTimelineClip[] = [];
  let hasRecording = false;

  for (const el of board.elements) {
    const name = el.name || el.type;
    if (el.type === 'video' || el.type === 'video-device') {
      const sourced = !!(el.mediaId || el.videoSrc);
      if (sourced) hasRecording = true;
      const start = el.trimStart ?? 0;
      const stop = el.trimEnd ?? el.durationSeconds ?? duration;
      clips.push({
        elementId: el.id,
        name,
        type: el.type,
        kind: sourced ? 'recording' : 'static',
        start: 0,
        end: sourced ? Math.min(duration, Math.max(0, stop - start)) : duration,
        detail: sourced
          ? `plays ${start.toFixed(2)}s to ${stop.toFixed(2)}s of the source`
          : 'no recording yet, shows its poster',
      });
      continue;
    }
    if (el.type === 'gesture') {
      const trigger = el.gestureRepeat ? 0 : el.triggerTime ?? GESTURE_TRIGGER_DEFAULT;
      const length = el.gestureDuration ?? GESTURE_DURATION_DEFAULT;
      clips.push({
        elementId: el.id,
        name,
        type: el.type,
        kind: 'gesture',
        start: trigger,
        end: el.gestureRepeat ? duration : Math.min(duration, trigger + length),
        detail: el.gestureRepeat ? `${el.gestureType}, loops` : el.gestureType,
      });
      continue;
    }
    if (el.animation) {
      const anim = el.animation;
      const start = anim.enter ? anim.enterDelay ?? 0 : 0;
      const end =
        anim.exit && anim.exitStart !== undefined
          ? Math.min(duration, anim.exitStart + (anim.exitDuration ?? EXIT_DURATION_DEFAULT))
          : duration;
      clips.push({
        elementId: el.id,
        name,
        type: el.type,
        kind: 'animation',
        start,
        end,
        detail: [anim.enter && `${anim.enter} in`, anim.exit && `${anim.exit} out`].filter(Boolean).join(', '),
      });
      continue;
    }
    clips.push({
      elementId: el.id,
      name,
      type: el.type,
      kind: 'static',
      start: 0,
      end: duration,
      detail: 'not animated',
    });
  }

  const warnings: string[] = [];
  if (!timeline.hasMotion) {
    warnings.push(
      'Nothing on this board moves, so the project still exports as screenshots. Add a video-device element, a gesture, or an animation.'
    );
  }
  if (!hasRecording) {
    warnings.push(
      'No recording on this board yet. The two App-Store-legal export modes need one; call upload_recording and set mediaId on the video-device.'
    );
  }
  if (timeline.hasMotion && duration < 15) {
    warnings.push(
      `This board is ${duration}s. App Store Connect rejects previews under 15 seconds (it takes 15 to 30). Call set_preview_duration.`
    );
  }
  if (duration > 30) {
    warnings.push(`This board is ${duration}s. App Store Connect takes 15 to 30 seconds.`);
  }
  const overrun = board.elements.filter(
    (el) => el.animation && animationEndTime(el.animation) > duration + 0.01
  );
  if (overrun.length > 0) {
    warnings.push(
      `${overrun.length} layer(s) are still animating past the end of the board: ${overrun
        .map((el) => el.name || el.id)
        .join(', ')}. They will be cut off.`
    );
  }
  const lateGestures = board.elements.filter(
    (el) => el.type === 'gesture' && !el.gestureRepeat && gestureEndTime(el) > duration + 0.01
  );
  if (lateGestures.length > 0) {
    warnings.push(
      `${lateGestures.length} gesture hint(s) fire past the end of the board and will not be seen.`
    );
  }

  return {
    artboardId: board.id,
    name: board.name,
    durationSeconds: duration,
    durationIsExplicit: board.previewDurationSeconds !== undefined,
    contentEndSeconds: Math.round(timeline.contentEndSeconds * 100) / 100,
    hasMotion: timeline.hasMotion,
    hasRecording,
    clips,
    warnings,
  };
}

/** Clamp a requested board length into what the timeline bar allows. */
export function clampPreviewDuration(seconds: number): number {
  return Math.max(1, Math.min(PREVIEW_DURATION_MAX, Math.round(seconds)));
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

export interface StoredRecording {
  mediaId: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number;
  bytes: number;
}

/**
 * Store a screen recording and hand back the `mediaId` a `video-device` or
 * `video` element takes.
 *
 * Deliberately NOT part of upload_asset: that one probes the bytes with an
 * `<img>` and rejects anything that is not an image, and it hands back an
 * `asset:<id>` reference that gets expanded into a data URL when the element is
 * built. Inlining a recording that way would put tens of megabytes of base64
 * into the project row. Recordings stay blobs and elements hold only the id.
 */
export async function saveRecordingAsset(
  source: string,
  options: { name?: string; mimeType?: string } = {}
): Promise<StoredRecording> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('upload_recording needs a data: URL, an http(s) URL, or bare base64 video data.');
  }

  let blob: Blob;
  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed);
    if (!response.ok) throw new Error(`Could not fetch that recording (HTTP ${response.status}).`);
    blob = await response.blob();
  } else {
    const mime = options.mimeType || 'video/mp4';
    const response = await fetch(`data:${mime};base64,${trimmed.replace(/\s+/g, '')}`);
    blob = await response.blob();
  }
  if (blob.size === 0) throw new Error('That recording was empty.');

  let probe: VideoProbeResult;
  try {
    probe = await probeVideoBlob(blob);
  } catch {
    throw new Error('That data did not decode as a video. Use an MP4, MOV or WebM screen recording.');
  }

  const { id } = await saveProbedRecording(blob, options.name?.trim() || 'recording', probe);
  return {
    mediaId: id,
    name: options.name?.trim() || 'recording',
    mimeType: blob.type || options.mimeType || 'video/mp4',
    width: probe.width,
    height: probe.height,
    durationSeconds: Math.round(probe.duration * 100) / 100,
    bytes: blob.size,
  };
}

/**
 * Write the row. Split out from the probe so the blob is only decoded once:
 * mediaStore.saveMedia probes again, and a second decode of a 40MB capture is
 * a visible stall on the bridge's single connection.
 */
async function saveProbedRecording(
  blob: Blob,
  name: string,
  probe: VideoProbeResult
): Promise<{ id: string }> {
  const id = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.media.put({
    id,
    blob,
    name,
    mimeType: blob.type || 'video/mp4',
    width: probe.width,
    height: probe.height,
    duration: probe.duration,
    createdAt: new Date(),
  });
  return { id };
}

/** Every stored recording, newest first. */
export async function listRecordings(): Promise<StoredRecording[]> {
  const rows = await db.media.toArray();
  return rows
    .filter((row) => row.id.startsWith('media_') && (row.mimeType || '').startsWith('video/'))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((row) => ({
      mediaId: row.id,
      name: row.name,
      mimeType: row.mimeType,
      width: row.width ?? 0,
      height: row.height ?? 0,
      durationSeconds: Math.round((row.duration ?? 0) * 100) / 100,
      bytes: row.blob.size,
    }));
}
