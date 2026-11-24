// Playing a film on screen. The player owns the hidden <video> that is both
// the screen's picture and the clock: while the recording plays, film time is
// the video's own time, so picture and camera never drift apart; once the
// recording has ended, a wall clock carries the film through its end hold.
//
// It draws only while playing (one requestAnimationFrame loop) and once after
// a seek or a change. Listeners hear about time at most ten times a second;
// anything that has to move every frame (the playhead) reads `time` in its
// own frame callback.

import { hiddenVideo, loadVideo } from './video';

/** Frames that come sooner than this after the last one drawn are skipped. */
const MIN_FRAME_GAP_MS = 12;

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface PlayerTiming {
  /** The recording's seconds where the film starts and the recording stops. */
  trimStart: number;
  trimEnd: number;
  /** The film's length, the end hold included. */
  duration: number;
}

export class FilmPlayer {
  readonly video: FrameVideo;
  /** Draws film time `t`; `newFrame` says the video showed a new picture since the last call. */
  render: ((t: number, newFrame: boolean) => void) | null = null;
  loop = true;
  private timing: PlayerTiming = { trimStart: 0, trimEnd: 1, duration: 1 };
  private t = 0;
  private playing = false;
  private raf = 0;
  private frameHandle = 0;
  private newFrame = true;
  private wallStart = 0;
  private wallFrom = 0;
  private onWallClock = false;
  private lastEmit = 0;
  private lastDrawAt = 0;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private loaded = false;
  /** The film keeps the recording's sound. A browser can still refuse it until a click, so each play asks again. */
  private wantSound = false;

  constructor() {
    const video = hiddenVideo() as FrameVideo;
    video.addEventListener('seeked', () => {
      this.newFrame = true;
      if (!this.playing) this.draw();
    });
    this.video = video;
    this.watchFrames();
  }

  /** Marks each new picture the video shows. */
  private watchFrames() {
    const video = this.video;
    if (!video.requestVideoFrameCallback) return;
    const onFrame = () => {
      if (this.disposed) return;
      this.newFrame = true;
      if (!this.playing) this.draw();
      this.frameHandle = video.requestVideoFrameCallback!(onFrame);
    };
    this.frameHandle = video.requestVideoFrameCallback(onFrame);
  }

  async load(url: string): Promise<void> {
    this.loaded = false;
    this.pause();
    await loadVideo(this.video, url);
    this.loaded = true;
    this.newFrame = true;
    // The first frame is ready now: anything waiting to show it can.
    this.video.dispatchEvent(new Event('osg-ready'));
    await this.seek(this.t);
  }

  setTiming(timing: PlayerTiming): void {
    this.timing = timing;
    if (this.t > timing.duration) this.t = timing.duration;
    this.requestDraw();
  }

  set sound(on: boolean) {
    this.wantSound = on;
    this.video.muted = !on;
  }

  get time(): number {
    return this.t;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(force = false) {
    const now = performance.now();
    if (!force && now - this.lastEmit < 100) return;
    this.lastEmit = now;
    for (const listener of this.listeners) listener();
  }

  private recordingTime(t: number): number {
    return Math.min(this.timing.trimEnd, this.timing.trimStart + Math.max(0, t));
  }

  /** Draws the current time again, after a change to the film. */
  requestDraw(): void {
    if (!this.playing) this.draw();
  }

  private draw() {
    if (this.disposed || !this.render) return;
    const fresh = this.newFrame;
    this.newFrame = false;
    this.render(this.t, fresh);
  }

  async play(): Promise<void> {
    if (this.playing || !this.loaded) return;
    if (this.t >= this.timing.duration - 0.03) this.t = 0;
    this.playing = true;
    this.emit(true);
    const recordingLeft = this.timing.trimStart + this.t < this.timing.trimEnd - 0.02;
    if (recordingLeft) {
      this.onWallClock = false;
      this.video.currentTime = this.recordingTime(this.t);
      this.video.muted = !this.wantSound;
      try {
        await this.video.play();
      } catch {
        // Sound needs a click on some browsers: play without it rather than not at all.
        if (!this.video.muted) {
          this.video.muted = true;
          await this.video.play().catch(() => undefined);
        }
      }
    } else {
      this.startWallClock();
    }
    if (!this.playing) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private startWallClock() {
    this.onWallClock = true;
    this.wallStart = performance.now();
    this.wallFrom = this.t;
    this.video.pause();
  }

  private readonly tick = (frameAt: number) => {
    if (!this.playing || this.disposed) return;
    const { trimStart, trimEnd, duration } = this.timing;
    if (!this.onWallClock) {
      const at = this.video.currentTime;
      this.t = Math.max(0, at - trimStart);
      if (at >= trimEnd - 1 / 90 || this.video.ended) {
        this.t = trimEnd - trimStart;
        this.startWallClock();
      }
    } else {
      this.t = this.wallFrom + (performance.now() - this.wallStart) / 1000;
    }
    if (this.t >= duration) {
      if (this.loop) {
        this.t = 0;
        this.onWallClock = false;
        this.video.currentTime = this.recordingTime(0);
        void this.video.play().catch(() => undefined);
      } else {
        this.t = duration;
        this.draw();
        this.pause();
        return;
      }
    }
    // A 120 Hz screen calls back twice as often as the moves need: every
    // other frame is skipped there, so the film plays at 60 and the GPU does half.
    if (frameAt - this.lastDrawAt >= MIN_FRAME_GAP_MS) {
      this.lastDrawAt = frameAt;
      this.draw();
    }
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.video.pause();
    this.emit(true);
    this.draw();
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause();
    else await this.play();
  }

  /** Moves to film time `t`. While playing, it carries on from there. */
  async seek(t: number): Promise<void> {
    this.t = Math.min(this.timing.duration, Math.max(0, t));
    this.emit(true);
    const target = this.recordingTime(this.t);
    if (this.playing) {
      if (this.timing.trimStart + this.t < this.timing.trimEnd - 0.02) {
        this.onWallClock = false;
        this.video.currentTime = target;
        void this.video.play().catch(() => undefined);
      } else {
        this.startWallClock();
      }
      return;
    }
    if (Math.abs(this.video.currentTime - target) > 1 / 240) this.video.currentTime = target;
    else this.draw();
  }

  dispose(): void {
    this.disposed = true;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    if (this.frameHandle && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.frameHandle);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
    this.listeners.clear();
    this.render = null;
  }
}
