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
import { stageModelFor } from '../models';
import { cssFontFamily, whenBuiltInFacesDeclared } from '@/services/fontService';
import type { ActorFrame, DeviceActor, ScreenFrame, TextActor } from '../types';
import { ScreenCanvas, type Picture } from './screen';
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

/** Pixels from the top of a capital to the baseline on the title's canvas: sharp at 4K. */
const CAP_PIXELS = 160;
/** A capital letter's height as a share of the font size, close enough for the faces the app ships. */
const CAP_SHARE = 0.7;

export class TextView implements ActorView {
  readonly id: string;
  readonly root = new THREE.Group();
  readonly buildKey = 'text';
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private drawnKey = '';
  private fontWait = '';

  constructor(actor: TextActor, anisotropy: number, private readonly onFontReady: () => void) {
    this.id = actor.id;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
    // Opaque with alpha to coverage, so the letters write their depth: depth
    // of field then blurs a title by its own distance. Drawn with blending
    // and no depth, a title took the depth of the backdrop behind it and came
    // out as blurred as the backdrop. Only while it fades does it blend.
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, side: THREE.DoubleSide, alphaToCoverage: true, alphaTest: 0.01 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.root.add(this.mesh);
    this.root.userData.actorId = actor.id;
    this.mesh.userData.actorId = actor.id;
  }

  update(actor: TextActor, frame: ActorFrame, camera: THREE.Camera) {
    placeActor(this.root, frame);
    if (actor.facing === 'camera') this.root.quaternion.copy(camera.quaternion);
    const fading = frame.opacity < 0.999;
    if (fading !== this.material.transparent) {
      this.material.transparent = fading;
      this.material.depthWrite = !fading;
      this.material.alphaToCoverage = !fading;
      this.material.needsUpdate = true;
    }
    this.material.opacity = frame.opacity;
    this.draw(actor);
  }

  private draw(actor: TextActor) {
    const fontPixels = CAP_PIXELS / CAP_SHARE;
    const font = `${actor.weight} ${fontPixels}px ${cssFontFamily(actor.font) || 'sans-serif'}`;
    const key = `${font}|${actor.text}|${actor.color}|${actor.align}|${actor.size}`;
    if (key === this.drawnKey) return;
    // A face that has not loaded yet would draw in the fallback and stay
    // that way, so wait for it once and draw again when it is in: first for
    // the app's built-in families to be declared, then for this face itself
    // (document.fonts.load is the one signal both engines keep, rule 3a).
    if (typeof document !== 'undefined' && document.fonts && this.fontWait !== font) {
      this.fontWait = font;
      void (async () => {
        await whenBuiltInFacesDeclared();
        await document.fonts.load(font);
      })().then(
        () => {
          this.drawnKey = '';
          this.onFontReady();
        },
        () => {}
      );
    }
    this.drawnKey = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const lines = actor.text.split('\n');
    ctx.font = font;
    const lineHeight = fontPixels * 1.2;
    const pad = Math.round(fontPixels * 0.25);
    const widest = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
    // Long text gets a smaller canvas scale rather than a canvas past 4096.
    const k = Math.min(1, 4096 / (widest + 2 * pad));
    const width = Math.ceil((widest + 2 * pad) * k);
    const height = Math.ceil((lines.length * lineHeight + 2 * pad) * k);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, width / k, height / k);
    ctx.font = font;
    ctx.fillStyle = actor.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = actor.align;
    const x = actor.align === 'left' ? pad : actor.align === 'right' ? widest + pad : (widest + 2 * pad) / 2;
    lines.forEach((line, i) => ctx.fillText(line, x, pad + i * lineHeight + fontPixels * 0.92));
    this.texture.needsUpdate = true;
    // The plane, in centimetres: `size` is the height of a capital.
    const perPixel = actor.size / CAP_PIXELS / k;
    this.mesh.scale.set(width * perPixel, height * perPixel, 1);
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
