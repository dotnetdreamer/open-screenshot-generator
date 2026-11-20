/**
 * The scene's soundtrack while the preview plays.
 *
 * The track is made once for the scene (musicRender.ts) and played from the
 * playhead. While it plays, the sound's own clock is the playhead's: the
 * picture follows the music, so a slow frame never lets the two drift
 * apart, and what the speaker plays is behind the clock by the output's
 * latency, which is taken off.
 */

import { musicKey, renderSceneMusic } from './musicRender';
import type { LimelightScene } from './types';

export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private key: string | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  /** The context's time the sound starts at, and the scene's time it starts from. */
  private startsAt = 0;
  private from = 0;
  private volume = 1;
  private muted = false;

  /**
   * Makes the scene's track ready to play. A scene with the same track,
   * length and cuts keeps the one it has. Resolves to whether there is one.
   */
  async prepare(scene: LimelightScene | null): Promise<boolean> {
    const key = scene ? musicKey(scene) : null;
    this.volume = scene?.music?.volume ?? 1;
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
    if (key === this.key) return !!this.buffer;
    this.key = key;
    this.stop();
    this.buffer = null;
    if (!scene || !key) return false;
    try {
      const buffer = await renderSceneMusic(scene);
      // A newer scene asked in the meantime: this one is no longer wanted.
      if (this.key !== key) return !!this.buffer;
      this.buffer = buffer;
    } catch (error) {
      console.warn('Limelight could not make the music', error);
      this.buffer = null;
    }
    return !!this.buffer;
  }

  get ready(): boolean {
    return !!this.buffer;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : this.volume;
  }

  /** Plays from `time` seconds into the scene. False when there is nothing to play. */
  play(time: number): boolean {
    if (!this.buffer || typeof AudioContext === 'undefined') return false;
    this.stop();
    const ctx = (this.ctx ??= new AudioContext({ latencyHint: 'interactive' }));
    void ctx.resume().catch(() => {});
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    const gain = ctx.createGain();
    gain.gain.value = this.muted ? 0 : this.volume;
    source.connect(gain).connect(ctx.destination);
    // A moment ahead, so the start is on time rather than late.
    this.startsAt = ctx.currentTime + 0.03;
    this.from = Math.max(0, time);
    if (this.from < this.buffer.duration) source.start(this.startsAt, this.from);
    this.source = source;
    this.gain = gain;
    return true;
  }

  /** The scene's time the listener hears now, or null when nothing plays. */
  time(): number | null {
    const ctx = this.ctx;
    if (!ctx || !this.source || ctx.state !== 'running') return null;
    const latency = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0;
    return this.from + Math.max(0, ctx.currentTime - this.startsAt - latency);
  }

  stop() {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // Never started: it was past the end of the track.
    }
    this.source.disconnect();
    this.gain?.disconnect();
    this.source = null;
    this.gain = null;
  }

  /** Lets go of the track and the sound device. */
  dispose() {
    this.stop();
    this.buffer = null;
    this.key = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
