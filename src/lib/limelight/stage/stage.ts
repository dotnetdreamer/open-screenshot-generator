/**
 * The Limelight stage: a scene drawn with three.js, the way the video will
 * show it.
 *
 * It draws only when asked (`invalidate`): a still scene costs nothing once
 * its frame is up, and a moving one costs one draw per display frame. While
 * something moves (a drag, playback, scrubbing) frames are drafts: fewer
 * pixels, and a lighter depth of field. A governor watches the time between
 * frames and lowers the pixel count further when frames come late, then
 * raises it again. When the movement stops, one finished frame is drawn at
 * full quality, so what rests on screen is what an export gives.
 *
 * Everything shown comes from `sceneAt(scene, time)`, so a frame drawn here,
 * a still and the agent's look at a moment are the same picture.
 *
 * One WebGL context per stage. The editor's 3D devices hold contexts of
 * their own and browsers drop the oldest past about sixteen, so a stage is
 * one context however many devices it has.
 */

import * as THREE from 'three';
import { frameMediaIds, sceneAt } from '../animate';
import { cameraPose } from '../camera';
import { loadTitleFaces } from '../fonts';
import type { CameraState, DeviceActor, LimelightActor, LimelightLook, LimelightScene, PictureActor, SceneFrame, TextActor } from '../types';
import { DeviceView, PictureView, TextView, deviceBuildKey, pictureBuildKey, type ActorView } from './actors';
import { EnvironmentCache, createBackdrop, lightDirection } from './environment';
import { CameraGuides } from './guides';
import { StageMedia, type MediaLoader } from './media';
import { PostPass } from './post';
import { ContactShadow } from './shadow';

export interface StageInit {
  /**
   * Left out, the stage makes a canvas of its own (`stage.canvas`). A canvas
   * is never handed to a second stage: disposing gives its context back for
   * good (forceContextLoss), so a stage made again needs a new canvas.
   */
  canvas?: HTMLCanvasElement;
  loadMedia: MediaLoader;
  /** After each frame: how long it took to draw and at what pixel ratio. */
  onFrame?: (info: { ms: number; pixelRatio: number; quality: 'draft' | 'final' }) => void;
  /**
   * The browser took the WebGL context away: a background tab under memory
   * pressure, the GPU resetting, too many contexts on the page. The stage
   * draws nothing from then on, so its owner makes a new one (on a new
   * canvas) when the context comes back or, since a context dropped for good
   * never comes back, after a moment.
   */
  onContextLost?: () => void;
  /** The context came back: the stage has to be made again. */
  onContextRestored?: () => void;
}

export interface StillOptions {
  width: number;
  height: number;
  time: number;
  /** PNG unless set. */
  type?: 'image/png' | 'image/jpeg';
}

/** What a view is built from: a change to it builds the view again instead of updating it. */
function buildKey(actor: LimelightActor): string {
  return actor.kind === 'device' ? deviceBuildKey(actor) : actor.kind === 'picture' ? pictureBuildKey(actor) : 'text';
}

/** The film's height in millimetres for a picture of this shape, as camera.ts measures lenses. */
function filmHeight(aspect: number): number {
  return aspect >= 1 ? 24 : 24 / aspect;
}

const DRAFT_PIXEL_RATIO = 1.25;
const FINAL_PIXEL_RATIO = 2;
/** How long after the last movement the finished frame is drawn. */
const SETTLE_MS = 140;

export class LimelightStage {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
  private readonly actorsRoot = new THREE.Group();
  private readonly keyLight = new THREE.DirectionalLight(0xffffff, 1);
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.15);
  private readonly backdrop = createBackdrop();
  private readonly environments: EnvironmentCache;
  private readonly shadow = new ContactShadow();
  private readonly post: PostPass | null;
  private readonly media: StageMedia;
  private readonly views = new Map<string, ActorView>();
  private readonly guides = new CameraGuides();
  private guidesOn = false;
  private readonly onFrame?: StageInit['onFrame'];
  private readonly anisotropy: number;

  /** The scene drawn. */
  private current: LimelightScene | null = null;
  /** The newest scene the view gave, which goes back on the stage when a hold ends. */
  private given: LimelightScene | null = null;
  /** While a video is made, the scene it films. */
  private filming: LimelightScene | null = null;
  private time = 0;
  private override: CameraState | null = null;
  private cssWidth = 1;
  private cssHeight = 1;
  private devicePixelRatio = 1;
  private interactive = false;
  /** The governor's share of the draft pixel ratio, 0.5 to 1. */
  private draftScale = 1;
  private lastDraftAt = 0;
  private draftIntervals: number[] = [];
  private frameRequest = 0;
  private settleTimer = 0;
  private disposed = false;
  private lost = false;
  /** Set once the context was ever lost: what was made in it can't be deleted in another. */
  private contextWasLost = false;
  private readonly onContextLost?: () => void;
  private grainSeed = 0;
  private sizedAs = { pixelRatio: 0, width: 0, height: 0 };
  private output: { target: THREE.WebGLRenderTarget; width: number; height: number; post: boolean } | null = null;

  constructor(init: StageInit) {
    this.canvas = init.canvas ?? document.createElement('canvas');
    this.onFrame = init.onFrame;
    this.onContextLost = init.onContextLost;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps a finish's hue and saturation, as the 3D Studio does.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    this.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.environments = new EnvironmentCache(this.renderer);
    this.post = PostPass.supported(this.renderer) ? new PostPass() : null;
    this.media = new StageMedia(init.loadMedia, () => {
      for (const view of this.views.values()) {
        if (view instanceof DeviceView) view.invalidateScreen();
        else if (view instanceof PictureView) view.invalidate();
      }
      this.invalidate();
    });

    this.scene.add(this.backdrop.mesh);
    this.scene.add(this.shadow.plane);
    this.scene.add(this.actorsRoot);
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);
    this.scene.add(this.ambient);
    this.scene.add(this.guides.group);

    this.canvas.addEventListener('webglcontextlost', this.handleLost);
    if (init.onContextRestored) {
      const restored = init.onContextRestored;
      this.canvas.addEventListener('webglcontextrestored', () => restored(), { once: true });
    }
  }

  private handleLost = (event: Event) => {
    // Asks the browser to give the context back when it can.
    event.preventDefault();
    this.lost = true;
    this.contextWasLost = true;
    this.onContextLost?.();
  };

  /** True once the WebGL context is gone: the stage draws nothing until it is made again. */
  get isLost(): boolean {
    return this.lost;
  }

  /** True while a video is being made from this stage (between `hold` and `release`). */
  get isFilming(): boolean {
    return this.filming !== null;
  }

  /** True when this browser can draw depth of field, vignette and grain. */
  get hasPostEffects(): boolean {
    return this.post !== null;
  }

  setScene(scene: LimelightScene) {
    this.given = scene;
    if (!this.filming) this.show(scene);
  }

  private show(scene: LimelightScene) {
    if (scene === this.current) return;
    this.current = scene;
    this.syncViews(scene);
    this.invalidate();
  }

  /**
   * Keeps `scene` on the stage while a video of it is made: the view's newer
   * scenes (an agent's edit, which no dialog stops) wait until `release`, so
   * every frame of the video is the same scene. That holds for one given
   * before the hold too, while the export was still getting ready.
   */
  hold(scene: LimelightScene) {
    this.filming = scene;
    this.show(scene);
  }

  /** Ends a hold: the newest scene the view gave goes back on the stage. */
  release() {
    const filmed = this.filming;
    this.filming = null;
    const next = this.given ?? filmed;
    if (next) this.show(next);
  }

  setTime(time: number) {
    if (time === this.time) return;
    this.time = time;
    this.invalidate();
  }

  /** A camera that wins over the scene's while the viewport is being dragged; null hands back. */
  setCameraOverride(camera: CameraState | null) {
    this.override = camera;
    this.invalidate();
  }

  setViewport(cssWidth: number, cssHeight: number, devicePixelRatio: number) {
    const w = Math.max(1, Math.round(cssWidth));
    const h = Math.max(1, Math.round(cssHeight));
    if (w === this.cssWidth && h === this.cssHeight && devicePixelRatio === this.devicePixelRatio) return;
    this.cssWidth = w;
    this.cssHeight = h;
    this.devicePixelRatio = devicePixelRatio || 1;
    this.invalidate();
  }

  /** Drafts while true; the finished frame follows a moment after it turns false. */
  setInteractive(interactive: boolean) {
    if (interactive === this.interactive) return;
    this.interactive = interactive;
    window.clearTimeout(this.settleTimer);
    if (interactive) {
      this.lastDraftAt = 0;
      this.draftIntervals = [];
    } else {
      this.settleTimer = window.setTimeout(() => this.invalidate(), SETTLE_MS);
    }
    this.invalidate();
  }

  invalidate() {
    if (this.disposed || this.frameRequest) return;
    this.frameRequest = window.requestAnimationFrame(() => {
      this.frameRequest = 0;
      this.drawToCanvas();
    });
  }

  /**
   * The video's camera as the viewport shows it now: a drag's live camera
   * while there is one. Looking from outside, it is the scene's own camera,
   * so the director's view never ends up in a shot.
   */
  viewCamera(): CameraState | null {
    if (!this.current) return null;
    if (this.guidesOn) return sceneAt(this.current, this.time).camera;
    return this.override ?? sceneAt(this.current, this.time).camera;
  }

  /** The director's view: the camera's path, shots and pyramid drawn, seen through the override camera. */
  setGuides(on: boolean) {
    if (on === this.guidesOn) return;
    this.guidesOn = on;
    this.invalidate();
  }

  /** The actor under a point of the canvas, in CSS pixels from its top left. */
  pick(x: number, y: number): string | null {
    if (!this.current) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((x / this.cssWidth) * 2 - 1, -(y / this.cssHeight) * 2 + 1), this.camera);
    const hits = raycaster.intersectObject(this.actorsRoot, true);
    for (const hit of hits) {
      if (!hit.object.visible) continue;
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.actorId) object = object.parent;
      if (object?.userData.actorId) return object.userData.actorId as string;
    }
    return null;
  }

  /** Where an actor is on the canvas, in CSS pixels, as of the last frame. */
  actorBox(actorId: string): { left: number; top: number; width: number; height: number } | null {
    const view = this.views.get(actorId);
    if (!view || !view.root.visible) return null;
    view.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(view.root);
    if (box.isEmpty()) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      corner.project(this.camera);
      if (corner.z > 1) return null;
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    }
    const left = ((minX + 1) / 2) * this.cssWidth;
    const right = ((maxX + 1) / 2) * this.cssWidth;
    const top = ((1 - maxY) / 2) * this.cssHeight;
    const bottom = ((1 - minY) / 2) * this.cssHeight;
    return { left, top, width: right - left, height: bottom - top };
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private syncViews(scene: LimelightScene) {
    const wanted = new Set<string>();
    for (const actor of scene.actors) {
      wanted.add(actor.id);
      const existing = this.views.get(actor.id);
      const key = buildKey(actor);
      if (existing && existing.buildKey === key) continue;
      if (existing) {
        this.actorsRoot.remove(existing.root);
        existing.dispose();
        this.views.delete(actor.id);
      }
      try {
        const view =
          actor.kind === 'device'
            ? new DeviceView(actor, this.anisotropy)
            : actor.kind === 'picture'
              ? new PictureView(actor, this.anisotropy)
              : new TextView(actor, this.anisotropy, () => this.invalidate());
        this.views.set(actor.id, view);
        this.actorsRoot.add(view.root);
      } catch (error) {
        console.error('Limelight could not build an actor', actor.id, error);
      }
    }
    for (const [id, view] of this.views) {
      if (wanted.has(id)) continue;
      this.actorsRoot.remove(view.root);
      view.dispose();
      this.views.delete(id);
    }
    this.shadow.invalidate();
  }

  private applyLook(look: LimelightLook, aspect: number, dither: boolean) {
    this.scene.environment = this.environments.get(look.environment, look.light);
    this.scene.environmentIntensity = 0.95 * look.light.intensity;
    this.keyLight.position.copy(lightDirection(look.light).multiplyScalar(500));
    this.keyLight.target.position.set(0, 0, 0);
    this.keyLight.intensity = 1.1 * look.light.intensity;
    this.renderer.toneMappingExposure = look.exposure;
    this.backdrop.set(look.backdrop, aspect, dither);
    this.shadow.setStrength(look.shadow);
  }

  /**
   * Places the camera and every actor for this frame. `pixelsTall` is the
   * height of the picture being drawn, which titles size their canvas by.
   * Returns the camera state used.
   */
  private stageFrame(scene: LimelightScene, frame: SceneFrame, cameraState: CameraState, aspect: number, pixelsTall: number) {
    const pose = cameraPose(cameraState, aspect);
    const camera = this.camera;
    camera.aspect = aspect;
    camera.fov = pose.fov;
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    // Near and far from the camera's own distance, so depth keeps its precision for depth of field.
    camera.near = Math.min(Math.max(cameraState.distance * 0.02, 0.2), 50);
    camera.far = cameraState.distance * 40 + 600;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    let shadowKey = `${scene.look.shadow}`;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const actor of scene.actors) {
      const view = this.views.get(actor.id);
      if (!view) continue;
      const actorFrame = frame.actors[actor.id];
      if (!actorFrame) {
        view.root.visible = false;
        continue;
      }
      if (view instanceof DeviceView && actor.kind === 'device') {
        const screen = frame.screens[actor.id] ?? { media: null, transition: 'cut', progress: 1 };
        view.update(actor as DeviceActor, actorFrame, screen, this.media.get, camera, pose.fov);
        if (view.root.visible) {
          const reach = (view.height * actorFrame.scale) / 2;
          minX = Math.min(minX, actorFrame.position.x - reach);
          maxX = Math.max(maxX, actorFrame.position.x + reach);
          minZ = Math.min(minZ, actorFrame.position.z - reach);
          maxZ = Math.max(maxZ, actorFrame.position.z + reach);
          const p = actorFrame.position;
          const t = actorFrame.turn;
          shadowKey += `|${actor.device}:${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)},${t.yaw.toFixed(1)},${t.pitch.toFixed(1)},${t.roll.toFixed(1)},${actorFrame.scale.toFixed(3)},${actor.fold ?? ''}`;
        }
      } else if (view instanceof TextView && actor.kind === 'text') {
        view.update(actor as TextActor, actorFrame, camera, frame.time, pixelsTall);
      } else if (view instanceof PictureView && actor.kind === 'picture') {
        view.update(actor as PictureActor, actorFrame, this.media.get(actor.media), frame.time);
      }
    }
    this.backdrop.place(cameraState, frame.time);
    if (minX <= maxX) {
      const half = Math.max(maxX - minX, maxZ - minZ) / 2 + 14;
      this.shadow.update(this.renderer, this.actorsRoot, { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, half }, shadowKey);
    } else {
      this.shadow.setStrength(0);
    }
    return pose;
  }

  private usesPost(look: LimelightLook): boolean {
    // The director's view is a plan of the stage: no blur, no vignette.
    if (this.guidesOn) return false;
    return this.post !== null && (look.depthOfField || look.vignette > 0.001 || look.grain > 0.001);
  }

  private drawToCanvas() {
    const scene = this.current;
    if (!scene || this.disposed || this.lost) return;
    const started = performance.now();
    const quality: 'draft' | 'final' = this.interactive ? 'draft' : 'final';
    if (quality === 'draft') this.govern(started);
    const cap = quality === 'draft' ? DRAFT_PIXEL_RATIO * this.draftScale : FINAL_PIXEL_RATIO;
    const pixelRatio = Math.max(0.5, Math.min(this.devicePixelRatio, cap));
    // Setting a canvas's size clears it even when the size is the same, so only on a change.
    if (pixelRatio !== this.sizedAs.pixelRatio || this.cssWidth !== this.sizedAs.width || this.cssHeight !== this.sizedAs.height) {
      this.sizedAs = { pixelRatio, width: this.cssWidth, height: this.cssHeight };
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(this.cssWidth, this.cssHeight, false);
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const aspect = this.cssWidth / this.cssHeight;
    const frame = sceneAt(scene, this.time);
    // This moment's pictures stay decoded however many there are: eight
    // phones changing picture at once show sixteen.
    this.media.show(frameMediaIds(frame));
    const cameraState = this.override ?? frame.camera;
    const post = this.usesPost(scene.look);
    this.applyLook(scene.look, aspect, !post);
    const pose = this.stageFrame(scene, frame, cameraState, aspect, size.y);
    this.guides.group.visible = this.guidesOn;
    if (this.guidesOn) this.guides.update(scene, this.time);
    if (post && this.post) {
      this.grainSeed = (this.grainSeed + 1) % 1000;
      this.post.render(this.renderer, this.scene, this.camera, size.x, size.y, this.postSettings(scene, cameraState, pose.focusDistance, aspect, quality), null);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
    this.onFrame?.({ ms: performance.now() - started, pixelRatio, quality });
  }

  private postSettings(scene: LimelightScene, camera: CameraState, focusDistance: number, aspect: number, quality: 'draft' | 'final') {
    return {
      depthOfField: scene.look.depthOfField,
      focusDistance,
      lens: camera.lens,
      fNumber: camera.aperture,
      filmHeight: filmHeight(aspect),
      vignette: scene.look.vignette,
      grain: scene.look.grain,
      // The grain moves with the video's time in a still, and with every frame on screen.
      seed: quality === 'final' ? Math.round(this.time * 30) % 1000 : this.grainSeed,
      quality,
    };
  }

  /** Lowers the draft's pixels when frames come late, and raises them again when there is room. */
  private govern(now: number) {
    if (this.lastDraftAt > 0) {
      const interval = now - this.lastDraftAt;
      if (interval < 250) {
        this.draftIntervals.push(interval);
        if (this.draftIntervals.length > 8) this.draftIntervals.shift();
        if (this.draftIntervals.length >= 6) {
          const average = this.draftIntervals.reduce((a, b) => a + b, 0) / this.draftIntervals.length;
          if (average > 24 && this.draftScale > 0.5) {
            this.draftScale = Math.max(0.5, this.draftScale * 0.85);
            this.draftIntervals = [];
          } else if (average < 17.5 && this.draftScale < 1) {
            this.draftScale = Math.min(1, this.draftScale * 1.08);
            this.draftIntervals = [];
          }
        }
      }
    }
    this.lastDraftAt = now;
  }

  /**
   * One frame of the scene as RGBA pixels, top row first, at any size up to
   * 4096 a side, drawn at full quality, for a still or a frame of a video.
   * Waits for the screens' pictures first. With `keepView`, the canvas is
   * not drawn again afterwards (a video export asks for frame after frame,
   * and draws the canvas once at the end).
   */
  async renderPixels(options: { width: number; height: number; time: number; keepView?: boolean }): Promise<{ pixels: Uint8Array; width: number; height: number }> {
    const scene = this.current;
    if (!scene) throw new Error('There is no scene on the stage');
    if (this.lost) throw new Error('The 3D view stopped working. Close Limelight and open it again.');
    const limit = Math.min(4096, this.renderer.capabilities.maxTextureSize);
    const k = Math.min(1, limit / Math.max(options.width, options.height));
    // Even sizes, which a video encoder needs.
    const width = Math.max(2, Math.round((options.width * k) / 2) * 2);
    const height = Math.max(2, Math.round((options.height * k) / 2) * 2);
    const frame = sceneAt(scene, options.time);
    // Only this moment's pictures, held until the frame is read back: a scene
    // can show more pictures than the stage keeps decoded.
    const release = await this.media.hold(frameMediaIds(frame));
    try {
      // The titles' faces first, for the letters they show. `fonts.ready`
      // only waits for loads already started, and a title asks for its face
      // when it is first drawn, which for a new stage is this very frame: the
      // first picture an agent saw of a title in a face nobody had used yet
      // was in the fallback. And `fonts.ready` itself is never waited on: it
      // has no limit, so one stalled download held a frame for 43 seconds,
      // where `loadTitleFaces` gives a face 4 seconds once.
      const faces = scene.actors
        .filter((actor): actor is TextActor => actor.kind === 'text' && !actor.hidden)
        .map((actor) => ({ weight: actor.weight, font: actor.font, text: actor.text }));
      await loadTitleFaces(faces);
      if (this.disposed) throw new Error('The stage was closed');
      if (this.lost) throw new Error('The 3D view stopped working. Close Limelight and open it again.');
      return this.drawPixels(scene, frame, width, height, options.time, options.keepView === true);
    } finally {
      release();
    }
  }

  private drawPixels(scene: LimelightScene, frame: SceneFrame, width: number, height: number, time: number, keepView: boolean): { pixels: Uint8Array; width: number; height: number } {
    const aspect = width / height;
    const cameraState = frame.camera;
    const guides = this.guidesOn;
    this.guidesOn = false;
    const post = this.usesPost(scene.look);
    this.guidesOn = guides;
    const output = this.outputFor(width, height, post);
    const raw = new Uint8Array(width * height * 4);
    // A still is the video's own picture: no guides in it.
    this.guides.group.visible = false;
    try {
      this.applyLook(scene.look, aspect, !post);
      // A picture that arrived during the wait is drawn now.
      for (const view of this.views.values()) {
        if (view instanceof DeviceView) view.invalidateScreen();
        else if (view instanceof PictureView) view.invalidate();
      }
      const pose = this.stageFrame(scene, frame, cameraState, aspect, height);
      if (post && this.post) {
        this.post.render(this.renderer, this.scene, this.camera, width, height, { ...this.postSettings(scene, cameraState, pose.focusDistance, aspect, 'final'), seed: Math.round(time * 30) % 1000 }, output);
      } else {
        this.renderer.setRenderTarget(output);
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);
      }
      this.renderer.readRenderTargetPixels(output, 0, 0, width, height, raw);
    } finally {
      this.renderer.setRenderTarget(null);
      // The canvas shows its own moment again.
      this.shadow.invalidate();
      if (!keepView) this.invalidate();
    }
    // WebGL rows run bottom up.
    const pixels = new Uint8Array(raw.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) pixels.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return { pixels, width, height };
  }

  /** One target for stills and video frames, kept while the size and the kind stay the same. */
  private outputFor(width: number, height: number, post: boolean): THREE.WebGLRenderTarget {
    const kept = this.output;
    if (kept && kept.width === width && kept.height === height && kept.post === post) return kept.target;
    kept?.target.dispose();
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, samples: post ? 0 : 4, depthBuffer: !post });
    if (!post) {
      // The materials tone-map and encode to sRGB themselves, as they do for
      // the canvas (see post.ts on the flag), so the target keeps their bytes
      // as they come: plain RGBA8. Left to three.js, an sRGB texture is
      // SRGB8_ALPHA8 while the flag makes its multisampled buffer RGBA8, and
      // WebGL won't resolve one into the other, so the picture came out black.
      target.texture.colorSpace = THREE.SRGBColorSpace;
      target.texture.internalFormat = 'RGBA8';
      (target as THREE.WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    }
    this.output = { target, width, height, post };
    return target;
  }

  /** Lets go of the still target, which can be a 4K one, once a picture or a video is made. */
  releaseOutput() {
    this.output?.target.dispose();
    this.output = null;
  }

  /** One frame of the scene as a picture file, PNG unless asked. */
  async renderStill(options: StillOptions): Promise<Blob> {
    const { pixels, width, height } = await this.renderPixels(options);
    this.releaseOutput();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The picture could not be made');
    const image = ctx.createImageData(width, height);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    const type = options.type ?? 'image/png';
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be made'))), type, 0.92)
    );
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameRequest) window.cancelAnimationFrame(this.frameRequest);
    window.clearTimeout(this.settleTimer);
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.media.dispose();
    if (!this.contextWasLost) {
      // Buffers and textures made in a context that was lost belong to it,
      // and deleting them in the one that came back is a WebGL error, so
      // after a loss they are left to go with the canvas.
      for (const view of this.views.values()) view.dispose();
      this.guides.dispose();
      this.output?.target.dispose();
      this.shadow.dispose();
      this.post?.dispose();
      this.environments.dispose();
      (this.backdrop.mesh.material as THREE.Material).dispose();
      this.backdrop.mesh.geometry.dispose();
      this.renderer.dispose();
    }
    this.views.clear();
    // Gives the context back now rather than at garbage collection.
    if (!this.lost) this.renderer.forceContextLoss();
  }
}
