/**
 * The things on a Limelight stage, as three.js objects.
 *
 * A device is the 3D Studio's own model (DeviceStudioRenderer's builders over
 * the measured phones in device3dModels.ts), so a phone on the stage has the
 * same corners, cameras and finishes it has on the canvas. The builders make
 * a device one unit wide; here it is scaled to its real width in centimetres,
 * which is what puts an iPad and an iPhone side by side at their true sizes.
 *
 * A title is its words drawn on a canvas at a size that stays sharp in a 4K
 * frame, on a plane as tall as the text is in centimetres.
 *
 * A picture card is a rounded rectangle with the picture on its face, and a
 * glossy edge when it has depth, like an app icon you could pick up.
 */

import * as THREE from 'three';
import {
  buildFoldable,
  buildPhone,
  createMaterials,
  phoneDevice,
  ringShade,
  type BuiltDevice,
  type PhoneMaterials,
} from '@/components/open-screenshot-generator/elements/DeviceStudioRenderer';
import { clampOpening, studioFinishOf, type PhoneModel } from '@/lib/device3dStudio';
import { revealLook, revealProgress } from '../animate';
import { highlightStarts } from '../edit';
import { stageModelFor } from '../models';
import { CAP_SHARE, canvasFamily, faceReady, loadTitleFaces } from '../fonts';
import type { ActorFrame, DeviceActor, PictureActor, ScreenFrame, TextActor } from '../types';
import { ScreenCanvas, pictureSize, type Picture } from './screen';
import { SHADOW_LAYER } from './shadow';

const DEG = Math.PI / 180;
const euler = new THREE.Euler();

/** Turns an object the way the 3D Studio turns a device: roll after pitch after yaw. */
export function applyTurn(object: THREE.Object3D, turn: ActorFrame['turn']) {
  euler.set(turn.pitch * DEG, turn.yaw * DEG, turn.roll * DEG, 'ZXY');
  object.quaternion.setFromEuler(euler);
}

function placeActor(object: THREE.Object3D, frame: ActorFrame) {
  object.position.set(frame.position.x, frame.position.y, frame.position.z);
  applyTurn(object, frame.turn);
  object.scale.setScalar(Math.max(1e-4, frame.scale));
  object.visible = frame.opacity > 0.001 && frame.scale > 1e-4;
}

export interface ActorView {
  readonly id: string;
  /** Placed, turned and scaled to the actor's frame. */
  readonly root: THREE.Group;
  /** Rebuilt rather than updated when this changes. */
  readonly buildKey: string;
  dispose(): void;
}

export function deviceBuildKey(actor: DeviceActor): string {
  return actor.device;
}

export class DeviceView implements ActorView {
  readonly id: string;
  readonly root = new THREE.Group();
  readonly buildKey: string;
  readonly model: PhoneModel;
  private readonly inner = new THREE.Group();
  private readonly built: BuiltDevice;
  private readonly materials: PhoneMaterials;
  private readonly screen: ScreenCanvas;
  private finishKey = '';
  private fit: DeviceActor['fit'] | '' = '';
  private posedAs = '';

  constructor(actor: DeviceActor, anisotropy: number) {
    const model = stageModelFor(actor.device);
    if (!model) throw new Error(`No 3D model for ${actor.device}`);
    this.id = actor.id;
    this.model = model;
    this.buildKey = deviceBuildKey(actor);
    this.materials = createMaterials(model);
    this.built = model.fold ? buildFoldable(model, this.materials) : phoneDevice(buildPhone(model, this.materials));
    // The builders make the device one unit wide; a unit here is a centimetre.
    this.inner.scale.setScalar(model.width / 10);
    this.inner.add(this.built.group);
    this.root.add(this.inner);
    this.root.userData.actorId = actor.id;
    this.root.traverse((object) => {
      object.userData.actorId = actor.id;
      if ((object as THREE.Mesh).isMesh) object.layers.enable(SHADOW_LAYER);
    });
    this.screen = new ScreenCanvas(anisotropy);
  }

  /** The device's height in centimetres at scale 1. */
  get height(): number {
    return this.model.height / 10;
  }

  update(actor: DeviceActor, frame: ActorFrame, screen: ScreenFrame, pictures: (id: string | null | undefined) => Picture | null, camera: THREE.Camera, fov: number) {
    placeActor(this.root, frame);
    this.applyFinish(actor);
    if (this.model.fold) {
      const posture = { opening: clampOpening(actor.fold, this.model.fold.opening), across: false };
      const key = `${posture.opening}`;
      if (key !== this.posedAs) {
        this.posedAs = key;
        this.built.pose(posture);
      }
    }
    for (const mesh of this.built.glareMeshes) mesh.visible = actor.glare > 0.001;
    this.materials.glare.opacity = actor.glare;

    const drawn = this.screen.update(screen, pictures);
    if (drawn === 'resized' || actor.fit !== this.fit) {
      this.fit = actor.fit;
      this.built.setShot({
        texture: this.screen.texture,
        image: { naturalWidth: this.screen.canvas.width, naturalHeight: this.screen.canvas.height },
        fit: actor.fit,
      });
      // Freshly laid meshes cast shadows and answer picks too.
      this.root.traverse((object) => {
        object.userData.actorId = actor.id;
        if ((object as THREE.Mesh).isMesh) object.layers.enable(SHADOW_LAYER);
      });
    }

    if (this.model.fold) {
      // A foldable shows its picture on the display the camera sees, so it
      // is told how it is turned as seen from the camera, which is how the
      // 3D Studio's fixed camera sees it.
      this.root.updateMatrixWorld();
      const seen = camera.quaternion.clone().invert().multiply(this.root.getWorldQuaternion(new THREE.Quaternion()));
      const angles = new THREE.Euler().setFromQuaternion(seen, 'ZXY');
      this.built.view({ orientation: { yaw: angles.y / DEG, pitch: angles.x / DEG, roll: angles.z / DEG }, lens: fov }, seen);
    }
  }

  /** Draws the screen again next frame, for a picture that arrived late. */
  invalidateScreen() {
    this.screen.invalidate();
  }

  private applyFinish(actor: DeviceActor) {
    const finish = studioFinishOf({ bodyColor3d: actor.color, finish3d: actor.finish }, this.model);
    const key = `${finish.frame}/${finish.back}/${finish.accent ?? ''}`;
    if (key === this.finishKey) return;
    this.finishKey = key;
    const m = this.materials;
    const frame = new THREE.Color(finish.frame);
    const back = new THREE.Color(finish.back);
    m.frame.color.copy(frame);
    m.satin.color.copy(frame);
    m.accent.color.set(finish.accent ?? finish.frame);
    m.backMetal.color.copy(frame);
    m.backGlass.color.copy(back);
    m.backGloss.color.copy(back);
    m.windowGlass.color.copy(back);
    m.padGlass.color.copy(back);
    m.ring.color.copy(ringShade(frame));
  }

  dispose() {
    this.built.dispose();
    for (const geometry of this.built.geometries) geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.screen.dispose();
  }
}

export function pictureBuildKey(actor: PictureActor): string {
  return `picture|${actor.width.toFixed(3)}|${actor.height.toFixed(3)}|${actor.corner.toFixed(3)}|${actor.depth.toFixed(3)}`;
}

/** A rounded rectangle centred on the origin, `r` its corners' radius. */
function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const x = -w / 2;
  const y = -h / 2;
  const shape = new THREE.Shape();
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (radius < 1e-4) {
    shape.moveTo(x, y);
    shape.lineTo(x + w, y);
    shape.lineTo(x + w, y + h);
    shape.lineTo(x, y + h);
    shape.closePath();
    return shape;
  }
  // Each corner a quarter of a squircle rather than of a circle: the curve
  // eases into the straight edge the way an app icon's does.
  const k = 0.18;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + w - radius, y);
  shape.bezierCurveTo(x + w - radius * k, y, x + w, y + radius * k, x + w, y + radius);
  shape.lineTo(x + w, y + h - radius);
  shape.bezierCurveTo(x + w, y + h - radius * k, x + w - radius * k, y + h, x + w - radius, y + h);
  shape.lineTo(x + radius, y + h);
  shape.bezierCurveTo(x + radius * k, y + h, x, y + h - radius * k, x, y + h - radius);
  shape.lineTo(x, y + radius);
  shape.bezierCurveTo(x, y + radius * k, x + radius * k, y, x + radius, y);
  return shape;
}

/** A flat face for the shape, its texture coordinates running 0 to 1 across the w x h box. */
function faceGeometry(shape: THREE.Shape, w: number, h: number): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(shape, 16);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / w + 0.5, position.getY(i) / h + 0.5);
  uv.needsUpdate = true;
  return geometry;
}

/** The longest side of a card's canvas: sharp for an icon a third as wide as a 4K frame. */
const CARD_SIDE = 1024;

/** Seconds a light takes to sweep across a card's face. */
export const SHINE_SECONDS = 0.8;

/**
 * How far across the face the sweep is at `time`: -0.3 before it starts to
 * 1.3 once it has passed, eased in and out, or null when no sweep shows.
 */
export function shineAt(shine: number | undefined, time: number): number | null {
  if (shine === undefined) return null;
  const u = (time - shine) / SHINE_SECONDS;
  if (u <= 0 || u >= 1) return null;
  const eased = u * u * (3 - 2 * u);
  return -0.3 + 1.6 * eased;
}

const SHINE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHINE_FRAGMENT = /* glsl */ `
uniform float progress;
uniform float strength;
varying vec2 vUv;
void main() {
  // A soft band across the diagonal, top left to bottom right.
  float d = (vUv.x + (1.0 - vUv.y)) * 0.5;
  float band = smoothstep(progress - 0.16, progress, d) * (1.0 - smoothstep(progress, progress + 0.1, d));
  gl_FragColor = vec4(vec3(band * strength), 1.0);
}
`;

export class PictureView implements ActorView {
  readonly id: string;
  readonly root = new THREE.Group();
  readonly buildKey: string;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly face: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly glare: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshPhysicalMaterial>;
  private readonly body: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshPhysicalMaterial> | null = null;
  private readonly shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly sweep: THREE.Mesh<THREE.ShapeGeometry, THREE.ShaderMaterial>;
  private readonly canvasWidth: number;
  private readonly canvasHeight: number;
  private drawn = '';

  constructor(actor: PictureActor, anisotropy: number) {
    this.id = actor.id;
    this.buildKey = pictureBuildKey(actor);
    const { width: w, height: h, depth } = actor;
    const radius = actor.corner * Math.min(w, h);
    const shape = roundedRect(w, h, radius);
    const k = CARD_SIDE / Math.max(w, h);
    this.canvasWidth = Math.max(2, Math.round(w * k));
    this.canvasHeight = Math.max(2, Math.round(h * k));
    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
    // Once the picture is on the GPU the canvas lets go of its copy: it is
    // sized again before the next draw, which is the only thing that uploads.
    this.texture.onUpdate = () => {
      this.canvas.width = 1;
      this.canvas.height = 1;
    };
    // Its own colours, like a screen: not tone mapped, so a white icon is white.
    this.face = new THREE.Mesh(faceGeometry(shape, w, h), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, transparent: true }));
    this.face.position.z = depth / 2 + 0.002;
    this.glare = new THREE.Mesh(
      faceGeometry(shape, w, h),
      new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        metalness: 0,
        roughness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: actor.glare,
      })
    );
    this.glare.position.z = depth / 2 + 0.004;
    if (depth > 0.01) {
      // The edge: a little inside the face's outline, then rounded out to it.
      const bevel = Math.min(depth / 2, Math.max(0.001, radius * 0.6), 0.25 * Math.min(w, h));
      const inner = roundedRect(Math.max(0.01, w - 2 * bevel), Math.max(0.01, h - 2 * bevel), Math.max(0, radius - bevel));
      const core = Math.max(0.001, depth - 2 * bevel);
      const geometry = new THREE.ExtrudeGeometry(inner, { depth: core, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 16 });
      geometry.translate(0, 0, -core / 2);
      this.body = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ color: 0x9aa0aa, roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.1 }));
      this.root.add(this.body);
    }
    // A soft shadow just behind and below, which reads as the card standing off whatever is behind it.
    const spread = Math.min(w, h) * 0.3;
    this.shade = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 2 * spread, h + 2 * spread),
      new THREE.MeshBasicMaterial({ map: shadeTexture(), color: 0x000000, transparent: true, depthWrite: false, opacity: 0.4, toneMapped: false })
    );
    this.shade.position.set(0, -Math.min(w, h) * 0.07, -depth / 2 - Math.min(w, h) * 0.05);
    // The light that sweeps across the face: light added, never taken away, and only while it passes.
    this.sweep = new THREE.Mesh(
      faceGeometry(shape, w, h),
      new THREE.ShaderMaterial({
        vertexShader: SHINE_VERTEX,
        fragmentShader: SHINE_FRAGMENT,
        uniforms: { progress: { value: -1 }, strength: { value: 0 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.sweep.position.z = depth / 2 + 0.006;
    this.sweep.visible = false;
    this.root.add(this.shade, this.face, this.glare, this.sweep);
    this.root.traverse((object) => {
      object.userData.actorId = actor.id;
    });
  }

  update(actor: PictureActor, frame: ActorFrame, picture: Picture | null, time: number) {
    placeActor(this.root, frame);
    const opacity = frame.opacity;
    this.face.material.opacity = opacity;
    const progress = shineAt(actor.shine, time);
    this.sweep.visible = progress !== null;
    if (progress !== null) {
      this.sweep.material.uniforms.progress.value = progress;
      this.sweep.material.uniforms.strength.value = 0.55 * opacity;
    }
    this.glare.visible = actor.glare > 0.001;
    this.glare.material.opacity = actor.glare * opacity;
    this.shade.material.opacity = 0.4 * opacity * opacity;
    if (this.body) {
      const material = this.body.material;
      const fading = opacity < 0.999;
      if (material.transparent !== fading) {
        material.transparent = fading;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
    }
    const crop = actor.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const key = `${actor.media}:${picture ? 1 : 0}|${crop.x},${crop.y},${crop.width},${crop.height}`;
    if (key === this.drawn) return;
    this.drawn = key;
    // Sizing the canvas clears it, and gives back the size it let go of after the last upload.
    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const cw = this.canvasWidth;
    const ch = this.canvasHeight;
    if (picture) {
      const size = pictureSize(picture);
      // The crop, then covered into the card's shape round its middle.
      const sw = Math.max(1, crop.width * size.width);
      const sh = Math.max(1, crop.height * size.height);
      const scale = Math.max(cw / sw, ch / sh);
      const w = cw / scale;
      const h = ch / scale;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(picture, crop.x * size.width + (sw - w) / 2, crop.y * size.height + (sh - h) / 2, w, h, 0, 0, cw, ch);
      if (this.body) this.body.material.color.set(edgeColour(ctx, cw, ch));
    } else {
      ctx.fillStyle = '#d9dce3';
      ctx.fillRect(0, 0, cw, ch);
    }
    this.texture.needsUpdate = true;
  }

  /** Draws the picture again next frame, for one that arrived late. */
  invalidate() {
    this.drawn = '';
  }

  dispose() {
    this.face.geometry.dispose();
    this.face.material.dispose();
    this.glare.geometry.dispose();
    this.glare.material.dispose();
    this.shade.geometry.dispose();
    this.shade.material.dispose();
    this.sweep.geometry.dispose();
    this.sweep.material.dispose();
    if (this.body) {
      this.body.geometry.dispose();
      this.body.material.dispose();
    }
    this.texture.dispose();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}

/** The average colour round a card's edge, for its sides: an icon's tile looks made of its own colour. */
function edgeColour(ctx: CanvasRenderingContext2D, w: number, h: number): string {
  try {
    const band = Math.max(1, Math.round(Math.min(w, h) * 0.04));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const [x, y, bw, bh] of [
      [0, 0, w, band],
      [0, h - band, w, band],
      [0, 0, band, h],
      [w - band, 0, band, h],
    ]) {
      const data = ctx.getImageData(x, y, bw, bh).data;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i + 3] < 128) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    }
    if (n === 0) return '#9aa0aa';
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    // A picture from elsewhere taints the canvas: the edge keeps its grey.
    return '#9aa0aa';
  }
}

let shade: THREE.CanvasTexture | null = null;

/** A soft round fall-off, white on clear, shared by every card's shadow. */
function shadeTexture(): THREE.CanvasTexture {
  if (shade) return shade;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // A rounded square blurred by stacking shrinking, faint fills.
    for (let i = 0; i < 24; i++) {
      const inset = 4 + i * 1.6;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      const size = 128 - 2 * inset;
      const r = Math.max(2, 28 - i);
      ctx.beginPath();
      ctx.moveTo(inset + r, inset);
      ctx.arcTo(inset + size, inset, inset + size, inset + size, r);
      ctx.arcTo(inset + size, inset + size, inset, inset + size, r);
      ctx.arcTo(inset, inset + size, inset, inset, r);
      ctx.arcTo(inset, inset, inset + size, inset, r);
      ctx.closePath();
      ctx.fill();
    }
  }
  shade = new THREE.CanvasTexture(canvas);
  return shade;
}

/**
 * The heights a capital letter can have on a title's canvas, in pixels. A
 * title is drawn at the smallest that stays sharp at the size it shows on
 * screen, and again at a bigger one if the camera comes closer or a video is
 * made bigger, never at a smaller one. 160 is sharp in a 4K frame. A caption
 * a phone's height away at 1080p needs about 64, which is a sixth of the
 * pixels.
 */
const CAP_STEPS = [32, 48, 64, 96, 128, 160] as const;
/** More words or letters than this come in a line at a time. */
const MAX_UNITS = 64;

/** A box on the title's canvas, in layout pixels (before a long title is scaled to fit 4096), y down. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A part of a title that comes in on its own: a word, a letter, or the whole title when nothing comes in. */
interface Unit {
  /** Where its letters are, across, and its line's box, top to bottom. */
  box: Box;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** What its quad was last set to, so a still word sends nothing to the GPU. */
  setAs: string;
}

/** The letters of a line as a person sees them: an accent and its letter, or an emoji, stay one. */
function graphemes(text: string): Array<{ text: string; index: number }> {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ segment: string; index: number }> } }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => ({ text: part.segment, index: part.index }));
  const out: Array<{ text: string; index: number }> = [];
  let index = 0;
  for (const char of Array.from(text)) {
    out.push({ text: char, index });
    index += char.length;
  }
  return out;
}

/** The words of a line with where each starts and ends in it. */
function words(line: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) out.push({ start: match.index, end: match.index + match[0].length });
  return out;
}

const worldPosition = new THREE.Vector3();
const forward = new THREE.Vector3();

export class TextView implements ActorView {
  readonly id: string;
  readonly root = new THREE.Group();
  readonly buildKey = 'text';
  private readonly canvas = document.createElement('canvas');
  /** Made for each size of canvas: see `draw`. */
  private texture: THREE.CanvasTexture | null = null;
  private textureSize = '';
  private units: Unit[] = [];
  private progress: number[] = [];
  /** The capital height drawn at, one of CAP_STEPS; 0 before the first draw. */
  private cap = 0;
  private drawnKey = '';
  private fontWait = '';
  /** The layout's size in layout pixels, and what turns layout pixels into the texture's and into centimetres. */
  private layoutWidth = 1;
  private layoutHeight = 1;
  private uScale = 1;
  private vScale = 1;
  private perPixel = 1;

  constructor(actor: TextActor, private readonly anisotropy: number, private readonly onFontReady: () => void) {
    this.id = actor.id;
    this.root.userData.actorId = actor.id;
  }

  private makeTexture(): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(this.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.anisotropy;
    // Once the words are on the GPU, the canvas's own copy of them is let go
    // (a caption's canvas can be several megabytes). Nothing uploads it again
    // unless it is drawn again, which sizes it first.
    texture.onUpdate = () => {
      this.canvas.width = 1;
      this.canvas.height = 1;
    };
    return texture;
  }

  /**
   * Places the title and its words for this moment. `pixelsTall` is the
   * height of the picture being drawn, which with the camera says how big the
   * letters show and so how sharp the canvas has to be.
   */
  update(actor: TextActor, frame: ActorFrame, camera: THREE.PerspectiveCamera, time: number, pixelsTall: number) {
    placeActor(this.root, frame);
    if (actor.facing === 'camera') this.root.quaternion.copy(camera.quaternion);
    const wanted = this.root.visible || this.cap === 0 ? this.capFor(actor, frame, camera, pixelsTall) : this.cap;
    this.draw(actor, Math.max(this.cap, wanted));
    this.animate(actor, frame, time);
  }

  /** The smallest capital height that is sharp at the size the title shows in this frame. */
  private capFor(actor: TextActor, frame: ActorFrame, camera: THREE.PerspectiveCamera, pixelsTall: number): number {
    this.root.getWorldPosition(worldPosition);
    camera.getWorldDirection(forward);
    const depth = worldPosition.sub(camera.position).dot(forward);
    if (depth <= 0.01) return this.cap || CAP_STEPS[0];
    const pixels = (actor.size * Math.max(frame.scale, 1) * pixelsTall) / (2 * depth * Math.tan((camera.fov * Math.PI) / 360));
    // A quarter to spare: the camera moving in a little, and a pop going past its size, stay sharp.
    return CAP_STEPS.find((step) => step >= pixels * 1.25) ?? CAP_STEPS[CAP_STEPS.length - 1];
  }

  private draw(actor: TextActor, cap: number) {
    const fontPixels = cap / CAP_SHARE;
    const font = `${actor.weight} ${fontPixels}px ${canvasFamily(actor.font)}`;
    const by = actor.reveal?.by ?? 'none';
    const face = { weight: actor.weight, font: actor.font, text: actor.text };
    // Whether the face has loaded for these letters is part of what was
    // drawn: words drawn in the fallback are drawn again once it is in,
    // whoever waited for it.
    const highlight = actor.highlight ? `${actor.highlight.color}:${actor.highlight.words}` : '';
    const key = `${font}|${faceReady(face)}|${actor.text}|${actor.color}|${highlight}|${actor.align}|${actor.size}|${by}`;
    if (key === this.drawnKey) return;
    // A face that has not loaded yet would draw in the fallback and stay
    // that way, so it is asked for once for these words, and the stage draws
    // again when it is in. A still or a video frame waits for it before
    // drawing (stage.ts).
    const family = `${actor.weight}|${actor.font}|${actor.text}`;
    if (typeof document !== 'undefined' && document.fonts && this.fontWait !== family) {
      this.fontWait = family;
      void loadTitleFaces([face], 10_000).then(
        () => {
          this.drawnKey = '';
          this.onFontReady();
        },
        () => {}
      );
    }
    this.drawnKey = key;
    this.cap = cap;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const lines = actor.text.split('\n');
    ctx.font = font;
    const lineHeight = fontPixels * 1.2;
    const pad = Math.round(fontPixels * 0.25);
    const lineWidths = lines.map((line) => ctx.measureText(line).width);
    const widest = Math.max(1, ...lineWidths);
    const layoutWidth = widest + 2 * pad;
    const layoutHeight = lines.length * lineHeight + 2 * pad;
    // Long text gets a smaller canvas scale rather than a canvas past 4096.
    const k = Math.min(1, 4096 / layoutWidth, 4096 / layoutHeight);
    const width = Math.max(1, Math.ceil(layoutWidth * k));
    const height = Math.max(1, Math.ceil(layoutHeight * k));
    // Setting the size clears the canvas, which the draw below wants anyway.
    this.canvas.width = width;
    this.canvas.height = height;
    // three.js gives a texture its storage on the first upload and only copies
    // into that after, so a canvas of another size needs a texture of its own:
    // copied into the old one, a bigger canvas was a WebGL error and the words
    // stayed as they were.
    if (!this.texture || this.textureSize !== `${width}x${height}`) {
      this.texture?.dispose();
      this.texture = this.makeTexture();
      this.textureSize = `${width}x${height}`;
    }
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.font = font;
    ctx.fillStyle = actor.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const lefts = lineWidths.map((w) => pad + (actor.align === 'left' ? 0 : actor.align === 'right' ? widest - w : (widest - w) / 2));
    const marked = highlightStarts(lines, actor.highlight?.words ?? 0);
    lines.forEach((line, i) => {
      const y = pad + i * lineHeight + fontPixels * 0.92;
      const from = marked[i];
      if (!actor.highlight || from >= line.length) {
        ctx.fillText(line, lefts[i], y);
        return;
      }
      // The words before the highlight in the title's colour, the rest in the highlight's.
      if (from > 0) ctx.fillText(line.slice(0, from), lefts[i], y);
      ctx.fillStyle = actor.highlight.color;
      ctx.fillText(line.slice(from), lefts[i] + ctx.measureText(line.slice(0, from)).width, y);
      ctx.fillStyle = actor.color;
    });
    this.texture.needsUpdate = true;
    this.layoutWidth = layoutWidth;
    this.layoutHeight = layoutHeight;
    this.uScale = k / width;
    this.vScale = k / height;
    // Centimetres per layout pixel: `size` is the height of a capital.
    this.perPixel = actor.size / cap;

    // The parts that come in on their own, each a line tall.
    const boxes: Box[] = [];
    if (by !== 'none') {
      lines.forEach((line, i) => {
        const y0 = pad + i * lineHeight;
        const parts =
          by === 'letter'
            ? graphemes(line)
                .filter((g) => g.text.trim() !== '')
                .map((g) => ({ start: g.index, end: g.index + g.text.length }))
            : words(line);
        const spans = parts.map((part) => ({ a: ctx.measureText(line.slice(0, part.start)).width, b: ctx.measureText(line.slice(0, part.end)).width }));
        spans.forEach((span, j) => {
          // Each part reaches halfway to its neighbours, so a word keeps its
          // letters' edges, and to the canvas's edge at either end of a line.
          const left = j === 0 ? lefts[i] - pad : lefts[i] + (spans[j - 1].b + span.a) / 2;
          const right = j === spans.length - 1 ? lefts[i] + lineWidths[i] + pad : lefts[i] + (span.b + spans[j + 1].a) / 2;
          boxes.push({ x0: Math.max(0, left), y0, x1: Math.min(layoutWidth, right), y1: y0 + lineHeight });
        });
      });
    }
    // Too many parts, or none: the whole title is one.
    const whole = boxes.length === 0 || boxes.length > MAX_UNITS;
    this.setUnits(whole ? [{ x0: 0, y0: 0, x1: layoutWidth, y1: layoutHeight }] : boxes, actor.id);
  }

  private setUnits(boxes: Box[], actorId: string) {
    for (const unit of this.units) {
      this.root.remove(unit.mesh);
      unit.mesh.geometry.dispose();
      unit.mesh.material.dispose();
    }
    this.units = boxes.map((box) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
      // Top left, top right, bottom left, bottom right, as PlaneGeometry lays them.
      geometry.setIndex([0, 2, 1, 2, 3, 1]);
      // Opaque with alpha to coverage, so the letters write their depth and
      // depth of field blurs a title by its own distance. While a word fades
      // it blends, and still writes its depth: drawn without it, a title took
      // the depth of the backdrop behind it and came out as blurred.
      const material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, side: THREE.DoubleSide, alphaToCoverage: true, alphaTest: 0.01 });
      const mesh = new THREE.Mesh(geometry, material);
      // The quads move every frame of a reveal; culling them would need their bounds worked out again each time.
      mesh.frustumCulled = false;
      mesh.userData.actorId = actorId;
      this.root.add(mesh);
      return { box, mesh, setAs: '' };
    });
    // Each in its place from the start: a word that hasn't come in yet is
    // hidden, not nowhere, so the selection outline round a title picked
    // before its words come in shows where they will be, not a dot.
    for (const unit of this.units) this.setQuad(unit, unit.box, unit.box);
  }

  private animate(actor: TextActor, frame: ActorFrame, time: number) {
    const progress = revealProgress(actor.reveal, this.units.length, time, this.progress);
    const style = actor.reveal?.style;
    this.units.forEach((unit, i) => {
      const look = style ? revealLook(style, progress[i] ?? 1) : null;
      const opacity = frame.opacity * (look ? look.opacity : 1);
      const box = unit.box;
      const lineHeight = box.y1 - box.y0;
      const drop = look ? look.drop * lineHeight : 0;
      const scale = look ? look.scale : 1;
      const visible = opacity > 0.002 && scale > 0.01 && (!look?.masked || drop < lineHeight - 0.5);
      unit.mesh.visible = visible;
      if (!visible) return;
      // Where the word shows and which part of the canvas it shows there.
      let place: Box;
      let sample: Box;
      if (look?.masked) {
        // Coming up from behind its line: the part still below the line is cut away.
        sample = { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 - drop };
        place = { x0: box.x0, y0: box.y0 + drop, x1: box.x1, y1: box.y1 };
      } else {
        sample = box;
        const cx = (box.x0 + box.x1) / 2;
        const cy = (box.y0 + box.y1) / 2 + drop;
        const hw = ((box.x1 - box.x0) / 2) * scale;
        const hh = (lineHeight / 2) * scale;
        place = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
      }
      this.setQuad(unit, place, sample);
      const material = unit.mesh.material;
      const fading = opacity < 0.999;
      if (fading !== material.transparent) {
        material.transparent = fading;
        material.alphaToCoverage = !fading;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
    });
  }

  private setQuad(unit: Unit, place: Box, sample: Box) {
    const key = `${place.x0.toFixed(2)},${place.y0.toFixed(2)},${place.x1.toFixed(2)},${place.y1.toFixed(2)},${sample.y1.toFixed(2)},${this.perPixel}`;
    if (key === unit.setAs) return;
    unit.setAs = key;
    const geometry = unit.mesh.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const cx = this.layoutWidth / 2;
    const cy = this.layoutHeight / 2;
    const k = this.perPixel;
    const x0 = (place.x0 - cx) * k;
    const x1 = (place.x1 - cx) * k;
    const yTop = (cy - place.y0) * k;
    const yBottom = (cy - place.y1) * k;
    position.setXYZ(0, x0, yTop, 0);
    position.setXYZ(1, x1, yTop, 0);
    position.setXYZ(2, x0, yBottom, 0);
    position.setXYZ(3, x1, yBottom, 0);
    const u0 = sample.x0 * this.uScale;
    const u1 = sample.x1 * this.uScale;
    // The canvas texture is flipped, so v runs up from the canvas's bottom.
    const vTop = 1 - sample.y0 * this.vScale;
    const vBottom = 1 - sample.y1 * this.vScale;
    uv.setXY(0, u0, vTop);
    uv.setXY(1, u1, vTop);
    uv.setXY(2, u0, vBottom);
    uv.setXY(3, u1, vBottom);
    position.needsUpdate = true;
    uv.needsUpdate = true;
    // The selection outline measures the title from these.
    geometry.boundingBox = null;
    geometry.boundingSphere = null;
  }

  dispose() {
    for (const unit of this.units) {
      unit.mesh.geometry.dispose();
      unit.mesh.material.dispose();
    }
    this.units = [];
    this.texture?.dispose();
    this.texture = null;
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}
