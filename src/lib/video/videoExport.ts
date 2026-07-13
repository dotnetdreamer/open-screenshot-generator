// App Preview video export: renders an artboard to an H.264 MP4 entirely
// client-side. Static elements are rasterized ONCE (html-to-image sprites at
// full artboard resolution), then every output frame is composited on a canvas
// (sprites + seeked video frames + procedural gestures + animation transforms)
// and encoded with WebCodecs, muxed by mp4-muxer. No server, no ffmpeg.
//
// Deliberate limits, matching what the canvas renders:
// - Screen recordings composite into FLAT device frames only. 3D / perspective
//   devices export as static sprites (their screenshot, or an empty screen).
// - Output is video-only (no audio track). App Store previews are watched
//   muted ~98% of the time and Apple accepts silent previews.

import { toPng } from 'html-to-image';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type {
  ArtboardState,
  ArtboardElement,
  GestureElementProps,
  VideoElementProps,
  VideoDeviceElementProps,
} from '@/types/artboard';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';
import { getMediaAsset, getMediaUrl } from '@/lib/mediaStore';
import { withBasePath } from '@/lib/basePath';
import { animationStateAt, animationEndTime } from './animation';
import { drawGesture, gesturePhaseAt, gestureEndTime } from './gestures';

export interface VideoExportSettings {
  fps: number; // 30 or 60
  durationSeconds: number; // 1..30 (Apple accepts 15-30)
  width: number; // output px; forced even for H.264
  height: number;
  bitrate?: number; // default 12 Mbps (Apple's H.264 target range)
  // App Store safe mode: only the first screen recording, full-bleed, no
  // frames/text/overlays — guaranteed to satisfy Review Guideline 2.3.4.
  rawRecordingOnly?: boolean;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ArtboardVideoInfo {
  hasVideo: boolean; // any recording present (video element or device screen)
  hasMotion: boolean; // gestures or enter/exit animations
  contentEndSeconds: number; // when the last recording/animation finishes
  suggestedDuration: number; // contentEnd rounded up, clamped to 1..30
}

/** What on this artboard needs a video export, and how long it runs. */
export async function analyzeArtboardForVideo(ab: ArtboardState): Promise<ArtboardVideoInfo> {
  let hasVideo = false;
  let hasMotion = false;
  let end = 0;
  for (const el of ab.elements) {
    if (el.type === 'video' && (el.mediaId || el.videoSrc)) {
      hasVideo = true;
      let duration = el.durationSeconds ?? 0;
      if (!duration && el.mediaId) duration = (await getMediaAsset(el.mediaId))?.duration ?? 0;
      const start = el.trimStart ?? 0;
      const stop = el.trimEnd ?? duration;
      end = Math.max(end, Math.max(0, stop - start));
    } else if (el.type === 'video-device' && el.mediaId) {
      hasVideo = true;
      const duration = el.durationSeconds ?? (await getMediaAsset(el.mediaId))?.duration ?? 0;
      const start = el.trimStart ?? 0;
      const stop = el.trimEnd ?? duration;
      end = Math.max(end, Math.max(0, stop - start));
    } else if (el.type === 'gesture') {
      hasMotion = true;
      if (!el.gestureRepeat) end = Math.max(end, gestureEndTime(el));
    }
    if (el.animation) {
      hasMotion = true;
      end = Math.max(end, animationEndTime(el.animation));
    }
  }
  return {
    hasVideo,
    hasMotion,
    contentEndSeconds: end,
    suggestedDuration: Math.min(30, Math.max(1, Math.ceil(end) || 15)),
  };
}

/**
 * True when the project is an App Preview video project: it carries a
 * recording mockup, a raw recording, a gesture hint or an animation. Drives
 * which export dialog the toolbar opens.
 */
export function projectHasVideoContent(artboards: ArtboardState[]): boolean {
  return artboards.some((ab) =>
    ab.elements.some(
      (el) =>
        el.type === 'video-device' ||
        (el.type === 'video' && (el.mediaId || el.videoSrc)) ||
        el.type === 'gesture' ||
        !!el.animation
    )
  );
}

// ---------------------------------------------------------------------------
// Frame plan: one entry per element, in z (array) order.

interface VideoSource {
  video: HTMLVideoElement;
  trimStart: number;
  trimEnd: number; // absolute seconds in the source
}

type Layer =
  | { kind: 'sprite'; el: ArtboardElement; sprite: HTMLImageElement }
  | { kind: 'video'; el: VideoElementProps; source: VideoSource }
  | {
      kind: 'device-video';
      el: VideoDeviceElementProps;
      source: VideoSource;
      // Full frame with its normal (black) screen — drawn UNDER the video.
      chrome: HTMLImageElement;
      // Notch / island / punch-hole alone on transparency — drawn OVER the
      // video (null for devices without a cutout).
      notch: HTMLImageElement | null;
      // screen rect relative to the element box (unrotated px)
      screen: { x: number; y: number; width: number; height: number; radius: number };
    }
  | { kind: 'gesture'; el: GestureElementProps };

const SPRITE_FILTER = (node: Node) => {
  const el = node as HTMLElement;
  return !(
    el?.hasAttribute?.('data-export-exclude') ||
    el?.hasAttribute?.('data-interaction-handle') ||
    el?.hasAttribute?.('data-screen-video')
  );
};

async function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

function elementNode(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector(`[data-element-id="${id}"]`) as HTMLElement | null;
}

/**
 * Rasterize one element wrapper at its layout size. The wrapper is positioned
 * with left/top and rotated with a transform; html-to-image keeps BOTH on the
 * cloned root, which would shift the artwork out of the sprite by the
 * element's canvas position — so zero them for the capture and let the canvas
 * compositor re-apply position/rotation.
 */
async function captureSprite(
  root: HTMLElement,
  el: ArtboardElement,
  extraFilter?: (node: Node) => boolean
): Promise<HTMLImageElement | null> {
  const node = elementNode(root, el.id);
  if (!node) return null;
  const boxW = el.size.width * (el.scale || 1);
  const boxH = el.size.height * (el.scale || 1);
  const prev = {
    left: node.style.left,
    top: node.style.top,
    transform: node.style.transform,
  };
  node.style.left = '0px';
  node.style.top = '0px';
  node.style.transform = 'none';
  try {
    const dataUrl = await toPng(node, {
      width: Math.max(1, Math.round(boxW)),
      height: Math.max(1, Math.round(boxH)),
      pixelRatio: 1,
      cacheBust: true,
      filter: extraFilter ? (n: Node) => SPRITE_FILTER(n) && extraFilter(n) : SPRITE_FILTER,
    });
    return await dataUrlToImage(dataUrl);
  } finally {
    node.style.left = prev.left;
    node.style.top = prev.top;
    node.style.transform = prev.transform;
  }
}

/**
 * Notch / island / punch-hole alone on transparency. The recording must sit
 * UNDER the cutout but OVER the frame's screen, and the frame's own
 * background paints behind the screen inset, so a "transparent screen" chrome
 * capture cannot work — instead the full chrome goes under the video and this
 * overlay goes on top. Ancestors are kept for layout but stripped of their
 * backgrounds; only the tagged notch div paints.
 */
async function captureNotchOverlay(
  root: HTMLElement,
  el: VideoDeviceElementProps
): Promise<HTMLImageElement | null> {
  const node = elementNode(root, el.id);
  if (!node) return null;
  const notch = node.querySelector('[data-device-notch]') as HTMLElement | null;
  if (!notch) return null;
  const frameDiv = node.querySelector(`[data-device-frame="${el.id}"]`) as HTMLElement | null;
  const screenDiv = node.querySelector(`[data-device-screen="${el.id}"]`) as HTMLElement | null;
  const prevFrame = frameDiv
    ? { background: frameDiv.style.backgroundColor, shadow: frameDiv.style.boxShadow, border: frameDiv.style.border }
    : null;
  const prevScreen = screenDiv?.style.backgroundColor;
  if (frameDiv) {
    frameDiv.style.backgroundColor = 'transparent';
    frameDiv.style.boxShadow = 'none';
    frameDiv.style.border = 'none';
  }
  if (screenDiv) screenDiv.style.backgroundColor = 'transparent';
  try {
    return await captureSprite(root, el, (n) => {
      if (!(n instanceof Element)) return true; // keep text nodes etc.
      return n === notch || n.contains(notch) || notch.contains(n);
    });
  } finally {
    if (frameDiv && prevFrame) {
      frameDiv.style.backgroundColor = prevFrame.background;
      frameDiv.style.boxShadow = prevFrame.shadow;
      frameDiv.style.border = prevFrame.border;
    }
    if (screenDiv && prevScreen !== undefined) screenDiv.style.backgroundColor = prevScreen;
  }
}

async function loadVideoSource(
  el: { mediaId?: string; videoSrc?: string },
  trimStart: number | undefined,
  trimEnd: number | undefined
): Promise<VideoSource | null> {
  let url: string | null = null;
  if (el.mediaId) url = await getMediaUrl(el.mediaId);
  else if (el.videoSrc) url = withBasePath(el.videoSrc);
  if (!url) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('A recording failed to load for export.'));
  });
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const start = Math.max(0, trimStart ?? 0);
  const stop = Math.min(duration || Infinity, trimEnd ?? duration);
  return { video, trimStart: start, trimEnd: Math.max(start, stop) };
}

async function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  const max = Math.max(0, (video.duration || 0) - 0.001);
  const target = Math.min(Math.max(t, 0), max);
  if (Math.abs(video.currentTime - target) < 1 / 240 && video.readyState >= 2) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    // Seeks can silently never fire on some containers; a stale frame beats a
    // hung export.
    const timer = setTimeout(finish, 1000);
    video.addEventListener('seeked', finish);
    video.currentTime = target;
  });
}

/** Source-local playback time for output time `t`: trims, then holds the last frame. */
function sourceTimeAt(source: VideoSource, t: number): number {
  const playable = Math.max(0, source.trimEnd - source.trimStart);
  return source.trimStart + Math.min(t, playable);
}

// ---------------------------------------------------------------------------
// Canvas drawing helpers (all in artboard space; ctx is pre-scaled).

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: 'contain' | 'cover' | 'fill',
  radius: number
) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || fit === 'fill') {
    ctx.drawImage(video, x, y, w, h);
  } else {
    const scale = fit === 'cover' ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  ctx.restore();
}

function drawArtboardBackground(ctx: CanvasRenderingContext2D, ab: ArtboardState) {
  ctx.save();
  if (ab.backgroundType === 'gradient' && ab.backgroundGradient) {
    const { color1, color2, angle } = ab.backgroundGradient;
    // CSS angle: 0deg points up, 90deg right. Compute the gradient line
    // through the artboard center at that bearing.
    const rad = ((angle - 90) * Math.PI) / 180;
    const cx = ab.size.width / 2;
    const cy = ab.size.height / 2;
    const half =
      (Math.abs(ab.size.width * Math.cos(rad)) + Math.abs(ab.size.height * Math.sin(rad))) / 2;
    const grad = ctx.createLinearGradient(
      cx - Math.cos(rad) * half,
      cy - Math.sin(rad) * half,
      cx + Math.cos(rad) * half,
      cy + Math.sin(rad) * half
    );
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    ctx.fillStyle = grad;
  } else {
    const bg = ab.backgroundColor;
    ctx.fillStyle = !bg || bg.toLowerCase().includes('var(') || bg.toLowerCase().includes('hsl')
      ? '#FFFFFF'
      : bg;
  }
  ctx.fillRect(0, 0, ab.size.width, ab.size.height);
  ctx.restore();
}

// Apply position/rotation/scale plus the animation state, then draw within the
// element's unrotated box.
function withElementTransform(
  ctx: CanvasRenderingContext2D,
  el: ArtboardElement,
  t: number,
  slideDistance: number,
  draw: (boxW: number, boxH: number) => void
) {
  const anim = animationStateAt(el.animation, t, slideDistance);
  if (!anim.visible || anim.opacity <= 0) return;
  const boxW = el.size.width * (el.scale || 1);
  const boxH = el.size.height * (el.scale || 1);
  ctx.save();
  ctx.globalAlpha *= anim.opacity;
  ctx.translate(el.position.x + boxW / 2 + anim.dx, el.position.y + boxH / 2 + anim.dy);
  if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
  if (anim.scale !== 1) ctx.scale(anim.scale, anim.scale);
  ctx.translate(-boxW / 2, -boxH / 2);
  draw(boxW, boxH);
  ctx.restore();
}

// Screen rect relative to the element box — mirrors deviceChrome's
// bezelPx()/screen style math exactly (all four insets derive from width).
function deviceScreenRectLocal(el: VideoDeviceElementProps) {
  const screen = getDeviceDescriptor(el.deviceType).screen;
  const boxW = el.size.width * (el.scale || 1);
  const boxH = el.size.height * (el.scale || 1);
  const padding = screen?.paddingPercent ?? { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 };
  const px = (percent: number) => (boxW * percent) / 100;
  return {
    x: px(padding.left),
    y: px(padding.top),
    width: boxW - px(padding.left) - px(padding.right),
    height: boxH - px(padding.top) - px(padding.bottom),
    radius: screen ? boxW * screen.radiusFactor : boxW * 0.05,
  };
}

// ---------------------------------------------------------------------------
// Encoder

const H264_CODEC_CANDIDATES = [
  'avc1.640033', // High 5.1
  'avc1.64002A', // High 4.2 (60fps at preview sizes)
  'avc1.640028', // High 4.0 (Apple's stated preview profile ceiling)
  'avc1.4D0028', // Main 4.0
  'avc1.42E01F', // Constrained Baseline 3.1
];

async function pickEncoderConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number
): Promise<VideoEncoderConfig> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('This browser has no WebCodecs video encoder. Use the desktop app, Chrome or Edge.');
  }
  for (const codec of H264_CODEC_CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return support.config ?? config;
    } catch {
      // try the next profile
    }
  }
  throw new Error('This browser cannot encode H.264 MP4. Use the desktop app, Chrome or Edge.');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Video export cancelled', 'AbortError');
}

// ---------------------------------------------------------------------------

/**
 * Render one artboard to an MP4 blob. The artboard must be mounted on the
 * canvas (sprites capture from its live DOM).
 */
export async function exportArtboardVideo(
  artboard: ArtboardState,
  settings: VideoExportSettings
): Promise<Blob> {
  const { fps, durationSeconds, onProgress, signal } = settings;
  const outW = Math.max(2, Math.floor(settings.width / 2) * 2);
  const outH = Math.max(2, Math.floor(settings.height / 2) * 2);
  const bitrate = settings.bitrate ?? 12_000_000;
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));

  const root = document.querySelector(`[data-artboard-dom-id="${artboard.id}"]`) as HTMLElement | null;
  if (!root && !settings.rawRecordingOnly) {
    throw new Error('The artboard is not on the canvas.');
  }

  onProgress?.(0, totalFrames);

  // ---- Build the layer plan ----
  const layers: Layer[] = [];
  // Let the 3D device renderers re-render supersampled, same as PNG export.
  window.dispatchEvent(new CustomEvent('artboard:export', { detail: { phase: 'begin' } }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    if (settings.rawRecordingOnly) {
      // First recording only, full-bleed. Guideline-2.3.4-safe output.
      for (const el of artboard.elements) {
        if (el.type === 'video' && (el.mediaId || el.videoSrc)) {
          const source = await loadVideoSource(el, el.trimStart, el.trimEnd);
          if (source) {
            layers.push({ kind: 'video', el: { ...el, position: { x: 0, y: 0 }, size: artboard.size, scale: 1, rotation: 0, borderRadius: 0, objectFit: 'cover', animation: undefined }, source });
            break;
          }
        }
        if (el.type === 'video-device' && el.mediaId) {
          const source = await loadVideoSource({ mediaId: el.mediaId }, el.trimStart, el.trimEnd);
          if (source) {
            const full: VideoElementProps = {
              id: `${el.id}_raw`, type: 'video', position: { x: 0, y: 0 }, size: artboard.size,
              rotation: 0, scale: 1, objectFit: 'cover',
            };
            layers.push({ kind: 'video', el: full, source });
            break;
          }
        }
      }
      if (layers.length === 0) throw new Error('No screen recording found on this artboard.');
    } else {
      for (const el of artboard.elements) {
        throwIfAborted(signal);
        if (el.type === 'video' && (el.mediaId || el.videoSrc)) {
          const source = await loadVideoSource(el, el.trimStart, el.trimEnd);
          if (source) {
            layers.push({ kind: 'video', el, source });
            continue;
          }
          // Missing media row: fall through to a static sprite (placeholder).
        }
        if (el.type === 'video-device' && el.mediaId) {
          const source = await loadVideoSource({ mediaId: el.mediaId }, el.trimStart, el.trimEnd);
          if (source) {
            const chrome = await captureSprite(root!, el);
            if (chrome) {
              const notch = await captureNotchOverlay(root!, el);
              layers.push({ kind: 'device-video', el, source, chrome, notch, screen: deviceScreenRectLocal(el) });
              continue;
            }
          }
          // Recording missing from this browser's media store: fall through to
          // a static sprite so the phone (and its poster) still renders.
        }
        if (el.type === 'gesture') {
          layers.push({ kind: 'gesture', el });
          continue;
        }
        const sprite = await captureSprite(root!, el);
        if (sprite) layers.push({ kind: 'sprite', el, sprite });
      }
    }
  } finally {
    window.dispatchEvent(new CustomEvent('artboard:export', { detail: { phase: 'end' } }));
  }

  // ---- Encoder + muxer ----
  const config = await pickEncoderConfig(outW, outH, fps, bitrate);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: outW, height: outH },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure(config);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing context.');

  // Artboard -> output mapping: cover + center so a 1290x2796 board still
  // fills an 886x1920 export edge to edge.
  const coverScale = Math.max(outW / artboard.size.width, outH / artboard.size.height);
  const offsetX = (outW - artboard.size.width * coverScale) / 2;
  const offsetY = (outH - artboard.size.height * coverScale) / 2;
  const slideDistance = artboard.size.height * 0.05;

  try {
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted(signal);
      if (encoderError) throw encoderError;
      const t = i / fps;

      // Seek every video to its frame time before drawing.
      for (const layer of layers) {
        if (layer.kind === 'video' || layer.kind === 'device-video') {
          await seekVideo(layer.source.video, sourceTimeAt(layer.source, t));
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, outW, outH);
      ctx.setTransform(coverScale, 0, 0, coverScale, offsetX, offsetY);

      if (!settings.rawRecordingOnly) drawArtboardBackground(ctx, artboard);

      for (const layer of layers) {
        switch (layer.kind) {
          case 'sprite':
            withElementTransform(ctx, layer.el, t, slideDistance, (boxW, boxH) => {
              ctx.drawImage(layer.sprite, 0, 0, boxW, boxH);
            });
            break;
          case 'video':
            withElementTransform(ctx, layer.el, t, slideDistance, (boxW, boxH) => {
              ctx.globalAlpha *= layer.el.opacity ?? 1;
              drawFitted(
                ctx,
                layer.source.video,
                0,
                0,
                boxW,
                boxH,
                layer.el.objectFit || 'cover',
                layer.el.borderRadius || 0
              );
            });
            break;
          case 'device-video':
            withElementTransform(ctx, layer.el, t, slideDistance, (boxW, boxH) => {
              const s = layer.screen;
              // Frame (black screen) first, recording clipped into the screen
              // rect over it, cutout back on top — same stack as the DOM.
              ctx.drawImage(layer.chrome, 0, 0, boxW, boxH);
              drawFitted(
                ctx,
                layer.source.video,
                s.x,
                s.y,
                s.width,
                s.height,
                layer.el.objectFit || 'cover',
                s.radius
              );
              if (layer.notch) ctx.drawImage(layer.notch, 0, 0, boxW, boxH);
            });
            break;
          case 'gesture': {
            const phase = gesturePhaseAt(layer.el, t);
            if (phase !== null) {
              withElementTransform(ctx, layer.el, t, slideDistance, (boxW, boxH) => {
                drawGesture(ctx, layer.el, { x: 0, y: 0, width: boxW, height: boxH }, phase);
              });
            }
            break;
          }
        }
      }

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      // Backpressure: don't let raw frames pile up in the encoder queue.
      while (encoder.encodeQueueSize > 4) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (encoderError) throw encoderError;
      }

      onProgress?.(i + 1, totalFrames);
    }

    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
  } finally {
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // already closed
    }
    for (const layer of layers) {
      if (layer.kind === 'video' || layer.kind === 'device-video') {
        layer.source.video.removeAttribute('src');
        layer.source.video.load();
      }
    }
  }

  const buffer = (muxer.target as ArrayBufferTarget).buffer;
  return new Blob([buffer], { type: 'video/mp4' });
}
