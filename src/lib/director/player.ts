// Playing a film on screen. The player keeps a hidden <video> for each
// recording the film uses. While a clip plays, its video is the clock, so
// picture and camera never drift apart; where clips meet, the next clip's
// video, already waiting at its first frame, takes over; after the last clip,
// and in a film with no recording yet, a wall clock carries the film on.
//
// It draws only while playing (one requestAnimationFrame loop) and once after
// a seek or a change. Listeners hear about time at most ten times a second;
// anything that has to move every frame (the playhead) reads `time` in its
// own frame callback. Screen listeners hear when the picture on the phone's
// screen comes from another video, or from none.

import { hiddenVideo, loadVideo } from './video';

/** Frames that come sooner than this after the last one drawn are skipped. */
const MIN_FRAME_GAP_MS = 12;

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** One clip as the player sees it: which recording, where it sits in the film, and where it starts in the recording. */
export interface PlayerSegment {
  mediaId: string;
  /** Film seconds. */
  start: number;
  end: number;
  /** Recording seconds at `start`. */
  in: number;
}

export interface PlayerSchedule {
  segments: PlayerSegment[];
  /** The film's length, the end hold included. */
  duration: number;
}

export class FilmPlayer {
  /** Draws film time `t`; `newFrame` says the screen showed a new picture since the last call. */
  render: ((t: number, newFrame: boolean) => void) | null = null;
  loop = true;
  private schedule: PlayerSchedule = { segments: [], duration: 1 };
  private readonly videos = new Map<string, FrameVideo>();
  private readonly loading = new Map<string, Promise<void>>();
  /** Recordings whose video has its first frame. */
  private readonly loaded = new Set<string>();
  private readonly frameHandles = new Map<FrameVideo, number>();
  private current: FrameVideo | null = null;
  private segIndex = -1;
  private t = 0;
  private playing = false;
  private raf = 0;
  private newFrame = true;
  private wallStart = 0;
  private wallFrom = 0;
  private onWallClock = true;
  private lastEmit = 0;
  private lastDrawAt = 0;
  private readonly listeners = new Set<() => void>();
  private readonly screenListeners = new Set<() => void>();
  private disposed = false;
  /** The film keeps the recordings' sound. A browser can still refuse it until a click, so each play asks again. */
  private wantSound = false;
  /** Director is out of sight. */
  private away = false;

  /** The video on the phone's screen now; null in a film without a recording. */
  get video(): HTMLVideoElement | null {
    return this.current;
  }

  /** The hidden video of one recording, once loaded. */
  videoFor(mediaId: string): HTMLVideoElement | null {
    return this.videos.get(mediaId) ?? null;
  }

  /**
   * Makes a video ready for each recording (`urls` by media id). Recordings
   * no longer in the film let go of theirs. Resolves when every video has its
   * first frame; a recording that can't be played rejects with why.
   */
  async load(urls: Map<string, string>): Promise<void> {
    for (const [mediaId, video] of this.videos) {
      if (urls.has(mediaId)) continue;
      this.dropVideo(video);
      this.videos.delete(mediaId);
      this.loading.delete(mediaId);
      this.loaded.delete(mediaId);
    }
    const waits: Promise<void>[] = [];
    for (const [mediaId, url] of urls) {
      let wait = this.loading.get(mediaId);
      if (!wait) {
        const video = hiddenVideo() as FrameVideo;
        this.videos.set(mediaId, video);
        this.watchFrames(video);
        video.addEventListener('seeked', () => {
          if (video !== this.current) return;
          this.newFrame = true;
          if (!this.playing) this.draw();
        });
        wait = loadVideo(video, url).then(
          () => {
            this.loaded.add(mediaId);
          },
          (error) => {
            this.loading.delete(mediaId);
            throw error;
          }
        );
        this.loading.set(mediaId, wait);
      }
      waits.push(wait);
    }
    await Promise.all(waits);
    if (this.disposed) return;
    // The screen may now have a video where it had none.
    this.place(this.t);
    if (!this.playing) await this.seek(this.t);
  }

  setSchedule(schedule: PlayerSchedule): void {
    this.schedule = schedule;
    if (this.t > schedule.duration) this.t = schedule.duration;
    if (this.playing) {
      // Where clips moved, the clock carries on from the same film time.
      void this.startAt(this.t);
      return;
    }
    this.place(this.t);
    void this.seek(this.t);
  }

  set sound(on: boolean) {
    this.wantSound = on;
    if (this.current) this.current.muted = !on;
  }

  /**
   * True while Director is out of sight: the film pauses, and stays paused
   * whatever asks it to play then (a reading that finishes, a phone's Record),
   * so no sound plays behind the editor.
   */
  set hidden(on: boolean) {
    this.away = on;
    if (on) this.pause();
  }

  get hidden(): boolean {
    return this.away;
  }

  get time(): number {
    return this.t;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get duration(): number {
    return this.schedule.duration;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Hears when the screen's picture comes from another video (`video` changed). */
  onScreen(listener: () => void): () => void {
    this.screenListeners.add(listener);
    return () => {
      this.screenListeners.delete(listener);
    };
  }

  private emit(force = false) {
    const now = performance.now();
    if (!force && now - this.lastEmit < 100) return;
    this.lastEmit = now;
    for (const listener of this.listeners) listener();
  }

  /** Marks each new picture the screen's video shows. */
  private watchFrames(video: FrameVideo) {
    if (!video.requestVideoFrameCallback) return;
    const onFrame = () => {
      if (this.disposed) return;
      if (video === this.current) {
        this.newFrame = true;
        if (!this.playing) this.draw();
      }
      this.frameHandles.set(video, video.requestVideoFrameCallback!(onFrame));
    };
    this.frameHandles.set(video, video.requestVideoFrameCallback(onFrame));
  }

  private dropVideo(video: FrameVideo) {
    const handle = this.frameHandles.get(video);
    if (handle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
    this.frameHandles.delete(video);
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    if (video === this.current) {
      this.current = null;
      for (const listener of this.screenListeners) listener();
    }
  }

  private segmentAt(t: number): number {
    const { segments } = this.schedule;
    for (let i = 0; i < segments.length; i++) if (t < segments[i].end - 1e-6) return t >= segments[i].start - 1e-6 ? i : -1;
    return -1;
  }

  /**
   * The segment and video for film time `t`. After the last clip, the last
   * clip's video stays on the screen (holding its last frame).
   */
  private place(t: number): { seg: PlayerSegment | null; shown: PlayerSegment | null; video: FrameVideo | null } {
    const { segments } = this.schedule;
    const index = this.segmentAt(t);
    const seg = index >= 0 ? segments[index] : null;
    const last = segments[segments.length - 1] ?? null;
    const shown = seg ?? (last && t >= last.end - 1e-6 ? last : null);
    const video = shown ? this.videos.get(shown.mediaId) ?? null : null;
    this.segIndex = index;
    if (video !== this.current) {
      this.current?.pause();
      this.current = video;
      this.newFrame = true;
      for (const listener of this.screenListeners) listener();
    }
    return { seg, shown, video };
  }

  /** Recording seconds a segment shows at film time `t`; after its end, its last frame. */
  private static sourceAt(seg: PlayerSegment, t: number): number {
    const length = seg.end - seg.start;
    return seg.in + Math.min(Math.max(0, t - seg.start), Math.max(0, length - 1 / 60));
  }

  /** Requests a redraw of the current time, after a change to the film. */
  requestDraw(): void {
    if (!this.playing) this.draw();
  }

  private draw() {
    if (this.disposed || !this.render) return;
    const fresh = this.newFrame;
    this.newFrame = false;
    this.render(this.t, fresh);
  }

  /** True when every recording the film plays has its video. */
  private ready(): boolean {
    return this.schedule.segments.every((seg) => this.loaded.has(seg.mediaId));
  }

  async play(): Promise<void> {
    if (this.playing || this.away || !this.ready()) return;
    if (this.t >= this.schedule.duration - 0.03) this.t = 0;
    this.playing = true;
    this.emit(true);
    await this.startAt(this.t);
    if (!this.playing) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Plays from film time `t`: the clip there on its own video, or the wall clock. */
  private async startAt(t: number): Promise<void> {
    const { seg, video } = this.place(t);
    if (seg && video) {
      this.onWallClock = false;
      const target = seg.in + (t - seg.start);
      if (Math.abs(video.currentTime - target) > 1 / 120) video.currentTime = target;
      video.muted = !this.wantSound;
      this.parkNext();
      if (!video.paused) return;
      const stillWanted = () => this.playing && !this.away && !this.disposed && video === this.current;
      try {
        await video.play();
      } catch (error) {
        // Sound needs a click on some browsers: play without it rather than not
        // at all. Only for that refusal, and only while the film still plays: a
        // pause (Director hidden) also cuts a pending play short, and playing
        // muted then would run the video on unseen.
        if ((error as { name?: string })?.name === 'NotAllowedError' && !video.muted && stillWanted()) {
          video.muted = true;
          await video.play().catch(() => undefined);
        }
      }
      // Paused, hidden or moved to another clip while the play was on its way: the video stops too.
      if (!stillWanted()) video.pause();
    } else {
      this.startWallClock(t);
    }
  }

  /** The next clip's video waits at its first frame, so the change is instant. */
  private parkNext() {
    const next = this.schedule.segments[this.segIndex + 1];
    if (!next) return;
    const video = this.videos.get(next.mediaId);
    if (!video || video === this.current) return;
    video.pause();
    if (Math.abs(video.currentTime - next.in) > 1 / 120) video.currentTime = next.in;
  }

  private startWallClock(t: number) {
    this.onWallClock = true;
    this.wallStart = performance.now();
    this.wallFrom = t;
    this.current?.pause();
  }

  private readonly tick = (frameAt: number) => {
    if (!this.playing || this.disposed) return;
    const { segments, duration } = this.schedule;
    const seg = this.segIndex >= 0 ? segments[this.segIndex] : null;
    if (!this.onWallClock && seg && this.current) {
      const video = this.current;
      this.t = seg.start + (video.currentTime - seg.in);
      if (this.t >= seg.end - 1 / 90 || video.ended) {
        const next = segments[this.segIndex + 1];
        if (next) {
          const sameVideo = next.mediaId === seg.mediaId && Math.abs(next.in - (seg.in + seg.end - seg.start)) < 0.05;
          this.t = next.start;
          if (sameVideo) {
            this.segIndex += 1;
            this.parkNext();
          } else void this.startAt(next.start);
        } else {
          this.t = seg.end;
          this.startWallClock(seg.end);
        }
      }
    } else {
      this.t = this.wallFrom + (performance.now() - this.wallStart) / 1000;
    }
    if (this.t >= duration) {
      if (this.loop) {
        this.t = 0;
        void this.startAt(0);
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
    for (const video of this.videos.values()) video.pause();
    this.emit(true);
    this.draw();
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause();
    else await this.play();
  }

  /** Moves to film time `t`. While playing, it carries on from there. */
  async seek(t: number): Promise<void> {
    this.t = Math.min(this.schedule.duration, Math.max(0, t));
    this.emit(true);
    if (this.playing) {
      await this.startAt(this.t);
      return;
    }
    const { shown, video } = this.place(this.t);
    if (video && shown) {
      const target = FilmPlayer.sourceAt(shown, this.t);
      if (Math.abs(video.currentTime - target) > 1 / 240) video.currentTime = target;
      else this.draw();
      this.parkNext();
    } else {
      this.draw();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const video of this.videos.values()) this.dropVideo(video);
    this.videos.clear();
    this.loading.clear();
    this.loaded.clear();
    this.listeners.clear();
    this.screenListeners.clear();
    this.render = null;
  }
}
