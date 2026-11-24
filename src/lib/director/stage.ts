// Director's 3D stage: one phone, its screen showing the recording, a lit
// backdrop and a soft shadow, filmed by a camera the plan moves. three.js,
// loaded only with the Director view.
//
// It draws only when asked (`render`), so a paused film costs nothing. The
// phone is the 3D Studio's own measured model (DeviceStudioRenderer.tsx),
// built in millimetres. The camera always looks straight down -z; the phone
// turns, and the camera slides and moves in to frame the place on the screen
// the plan names, which keeps the maths simple and the picture steady.

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
import { studioModelFor, type PhoneModel } from '@/lib/device3dStudio';
import { displayInsetsOf, finishOf } from '@/lib/device3dModels';
import type { DeviceType } from '@/types/artboard';
import { parseColor, type Backdrop } from './looks';
import { fromYawPitchRoll, toYawPitchRoll, type Quat } from './motion';
import { WIDE_VIEW } from './plan';
import type { Pose } from './types';

/** The lens: a long one, as product films use, so the phone keeps its shape. */
const FOV = 22;
const LIGHT = new THREE.Vector3(0.42, 0.58, 0.7).normalize();

export interface ActiveTap {
  /** Screen fractions of the recording, top left origin. */
  x: number;
  y: number;
  /** Seconds since the tap. */
  age: number;
}

export interface StageFrame {
  pose: Pose;
  /** A turn from a take, used instead of the pose's yaw, pitch and roll. */
  turn?: Quat | null;
  /** Film seconds, for the backdrop's slow drift. */
  t: number;
  /** Moves the phone across the picture, in picture widths and heights (right and up are positive). */
  shift: { x: number; y: number };
  taps: ActiveTap[];
}

export interface ScreenSource {
  image: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap;
  width: number;
  height: number;
}

const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BACKDROP_FRAGMENT = /* glsl */ `
uniform vec3 top;
uniform vec3 bottom;
uniform vec3 glowA;
uniform vec3 glowB;
uniform vec4 placeA; // x, y, radius, strength
uniform vec4 placeB;
uniform float aspect;
uniform vec2 drift;
varying vec2 vUv;

float glow(vec2 p, vec4 place) {
  float d = length(p - place.xy) / place.z;
  return exp(-d * d * 1.6) * place.w;
}

// A tiny noise to keep the gradients from banding in an 8-bit video.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
  vec3 col = mix(bottom, top, smoothstep(-0.05, 1.05, vUv.y));
  col += glowA * glow(p, vec4(placeA.xy + drift, placeA.zw));
  col += glowB * glow(p, vec4(placeB.xy - drift * 0.7, placeB.zw));
  // A soft fall-off towards the corners.
  float v = length(vec2((vUv.x - 0.5) * 1.1, vUv.y - 0.5));
  col *= 1.0 - 0.22 * smoothstep(0.35, 0.85, v);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

const TAP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A finger's touch: a soft dot that lands, then a ring that spreads and fades.
// Drawn on the glass, so it turns with the phone. A light fill with a dark
// edge reads on a white screen and on a black one.
const TAP_FRAGMENT = /* glsl */ `
uniform vec3 taps[3];
uniform float aspect;
varying vec2 vUv;

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  float light = 0.0;
  float dark = 0.0;
  for (int i = 0; i < 3; i++) {
    vec3 tp = taps[i];
    if (tp.z < 0.0 || tp.z > 0.95) continue;
    float r = length((p - tp.xy) * vec2(aspect, 1.0));
    float grow = smoothstep(0.0, 0.07, tp.z) * (1.0 - smoothstep(0.22, 0.45, tp.z));
    float dotR = 0.028 * grow;
    float fill = (1.0 - smoothstep(dotR - 0.003, dotR, r)) * grow;
    float edge = (1.0 - smoothstep(0.0, 0.0035, abs(r - dotR))) * grow;
    float k = clamp((tp.z - 0.05) / 0.75, 0.0, 1.0);
    float ringR = mix(0.03, 0.095, 1.0 - pow(1.0 - k, 3.0));
    float fade = (1.0 - k) * step(0.05, tp.z);
    float ring = (1.0 - smoothstep(0.0, 0.0045, abs(r - ringR))) * fade;
    float ringEdge = (1.0 - smoothstep(0.0045, 0.009, abs(r - ringR))) * fade;
    light = max(light, max(fill * 0.55, ring * 0.85));
    dark = max(dark, max(edge * 0.35, ringEdge * 0.22));
  }
  float alpha = max(light, dark);
  if (alpha < 0.002) discard;
  vec3 col = light >= dark ? vec3(1.0) : vec3(0.0);
  gl_FragColor = vec4(col, alpha);
}
`;

function color(value: string, fallback: [number, number, number] = [0.5, 0.5, 0.5]): THREE.Color {
  const rgb = parseColor(value) ?? fallback;
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

interface ShadowShape {
  texture: THREE.Texture;
  /** The shape's share of the picture across and down; the rest is room for the blur. */
  across: number;
  down: number;
}

/** A soft rounded rectangle in black, see-through around it, for the shadow planes. */
function shadowTexture(aspect: number, blur: number): ShadowShape {
  const h = 256;
  const w = Math.max(32, Math.round(h * aspect));
  const pad = Math.round(blur * 2.2);
  const canvas = document.createElement('canvas');
  canvas.width = w + pad * 2;
  canvas.height = h + pad * 2;
  const ctx = canvas.getContext('2d')!;
  // shadowBlur blurs in every browser, where ctx.filter does not: draw the
  // shape far outside the canvas and keep only its shadow.
  const away = canvas.width * 4;
  ctx.shadowColor = '#000';
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = away;
  ctx.fillStyle = '#000';
  const r = w * 0.16;
  const x = pad - away;
  const y = pad;
  // By hand: CanvasRenderingContext2D.roundRect is newer than the oldest web view the app runs in.
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, across: w / canvas.width, down: h / canvas.height };
}

/** The reflections: a room in the backdrop's colours with softboxes in its light. */
function buildEnvironment(backdrop: Backdrop): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.SphereGeometry(40, 32, 16);
  const top = color(backdrop.room.top);
  const floor = color(backdrop.room.floor);
  const colors: number[] = [];
  const pos = room.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) / 40 + 1) / 2;
    const c = floor.clone().lerp(top, Math.pow(t, 0.7));
    colors.push(c.r, c.g, c.b);
  }
  room.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(room, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const light = color(backdrop.room.light);
  const panel = (width: number, height: number, intensity: number, dir: THREE.Vector3, distance = 20) => {
    const mat = new THREE.MeshBasicMaterial({ color: light.clone().multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    mesh.position.copy(dir.clone().normalize().multiplyScalar(distance));
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  panel(16, 11, 6.5, LIGHT.clone());
  panel(18, 12, 1.3, new THREE.Vector3(-0.6, 0.2, 0.8));
  panel(34, 5, 3, new THREE.Vector3(0, 1, 0.15), 18);
  panel(4, 26, 2.6, new THREE.Vector3(1, 0.15, -0.55));
  panel(4, 26, 2.6, new THREE.Vector3(-1, 0.15, -0.55));
  const glowA = color(backdrop.glows[0].color);
  const tint = new THREE.MeshBasicMaterial({ color: glowA.multiplyScalar(1.4), side: THREE.DoubleSide });
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(14, 22), tint);
  rim.position.set(-14, 4, -12);
  rim.lookAt(0, 0, 0);
  scene.add(rim);
  return scene;
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
}

interface Display {
  width: number;
  height: number;
  z: number;
  centerY: number;
}

export class DirectorStage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 5000);
  private readonly phone = new THREE.Group();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
  /** From behind and to the side, so the frame's edge catches a line of light against a dark backdrop. */
  private readonly rimLight = new THREE.DirectionalLight(0xffffff, 1.4);
  private readonly backdropMaterial: THREE.ShaderMaterial;
  private readonly tapMaterial: THREE.ShaderMaterial;
  private readonly shadowSoft: THREE.Mesh;
  private readonly shadowNear: THREE.Mesh;
  /** The shadow shapes' share of their planes, for sizing the planes. */
  private shadowFit = { soft: { across: 1, down: 1 }, near: { across: 1, down: 1 } };
  private envTexture: THREE.Texture | null = null;
  private device: BuiltDevice | null = null;
  private mats: PhoneMaterials | null = null;
  private model: PhoneModel | null = null;
  private display: Display = { width: 66, height: 143, z: 4, centerY: 0 };
  private tapMesh: THREE.Mesh | null = null;
  private screen: { texture: THREE.Texture; width: number; height: number; uploaded: boolean } | null = null;
  private phoneKey = '';
  private lookKey = '';
  private backdrop: Backdrop | null = null;
  private width = 1;
  private height = 1;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: { preserveDrawingBuffer?: boolean } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      // Let the browser pick the GPU: asking for the fast one wakes a laptop's
      // second graphics chip for a film that doesn't need it.
      powerPreference: 'default',
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(0x000000, 1);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.backdropMaterial = new THREE.ShaderMaterial({
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      uniforms: {
        top: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
        glowA: { value: new THREE.Color() },
        glowB: { value: new THREE.Color() },
        placeA: { value: new THREE.Vector4() },
        placeB: { value: new THREE.Vector4() },
        aspect: { value: 1 },
        drift: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const backdrop = new THREE.Mesh(tri, this.backdropMaterial);
    backdrop.frustumCulled = false;
    backdrop.renderOrder = -10;
    this.scene.add(backdrop);

    const shadowMat = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false, toneMapped: false });
    this.shadowSoft = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat(0.4));
    this.shadowNear = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat(0.35));
    this.shadowSoft.renderOrder = -5;
    this.shadowNear.renderOrder = -4;
    this.scene.add(this.shadowSoft, this.shadowNear);

    this.tapMaterial = new THREE.ShaderMaterial({
      vertexShader: TAP_VERTEX,
      fragmentShader: TAP_FRAGMENT,
      uniforms: { taps: { value: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1)] }, aspect: { value: 0.46 } },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    this.scene.add(this.keyLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.14));
    this.keyLight.position.copy(LIGHT).multiplyScalar(500);
    this.rimLight.position.set(-420, 260, -380);
    this.scene.add(this.rimLight);
    this.scene.add(this.phone);
  }

  /** The canvas's size in CSS pixels and its pixel ratio. */
  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(2, Math.round(width));
    this.height = Math.max(2, Math.round(height));
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
  }

  /** The canvas's size in device pixels. */
  get drawingSize(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  setLook(backdrop: Backdrop): void {
    const key = JSON.stringify(backdrop);
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.backdrop = backdrop;
    const u = this.backdropMaterial.uniforms;
    (u.top.value as THREE.Color).copy(color(backdrop.top));
    (u.bottom.value as THREE.Color).copy(color(backdrop.bottom));
    const [a, b] = backdrop.glows;
    (u.glowA.value as THREE.Color).copy(color(a.color));
    (u.glowB.value as THREE.Color).copy(color(b.color));
    (u.placeA.value as THREE.Vector4).set(a.x, a.y, a.r, a.strength);
    (u.placeB.value as THREE.Vector4).set(b.x, b.y, b.r, b.strength);
    const env = buildEnvironment(backdrop);
    const next = this.pmrem.fromScene(env, 0.02).texture;
    disposeScene(env);
    this.envTexture?.dispose();
    this.envTexture = next;
    this.scene.environment = next;
    this.scene.environmentIntensity = 0.95;
    this.rimLight.color.copy(color(backdrop.glows[0].color)).lerp(new THREE.Color(1, 1, 1), 0.55);
    this.rimLight.intensity = backdrop.dark ? 1.6 : 0.6;
    (this.shadowSoft.material as THREE.MeshBasicMaterial).opacity = backdrop.shadow * 0.75;
    (this.shadowNear.material as THREE.MeshBasicMaterial).opacity = backdrop.shadow * 0.55;
  }

  /** Builds the phone. A foldable is shown opened flat. */
  setPhone(deviceType: DeviceType, finishId?: string): void {
    const key = `${deviceType}/${finishId ?? ''}`;
    if (key === this.phoneKey) return;
    const model = studioModelFor(deviceType);
    if (!model) throw new Error(`No 3D model for ${deviceType}`);
    this.clearPhone();
    this.phoneKey = key;
    this.model = model;
    const mats = createMaterials(model);
    this.mats = mats;
    let device: BuiltDevice;
    if (model.fold) {
      device = buildFoldable(model, mats);
      device.pose({ opening: 180, across: false });
      const insets = displayInsetsOf(model);
      this.display = { width: model.display.width, height: model.display.height, z: model.thickness / 2, centerY: (insets.bottom - insets.top) / 2 };
    } else {
      const built = buildPhone(model, mats);
      device = phoneDevice(built);
      this.display = { width: built.display.width, height: built.display.height, z: built.display.z, centerY: built.display.centerY };
    }
    // The builders scale the phone to a width of 1; the stage works in millimetres.
    device.group.scale.setScalar(1);
    this.device = device;
    this.phone.add(device.group);

    const finish = finishOf(model, finishId);
    const frame = new THREE.Color(finish.frame);
    const back = new THREE.Color(finish.back);
    mats.frame.color.copy(frame);
    mats.satin.color.copy(frame);
    mats.accent.color.copy(frame);
    mats.backMetal.color.copy(frame);
    mats.backGlass.color.copy(back);
    mats.backGloss.color.copy(back);
    mats.windowGlass.color.copy(back);
    mats.padGlass.color.copy(back);
    mats.ring.color.copy(ringShade(frame));
    mats.glare.opacity = 0.16;
    for (const mesh of device.glareMeshes) mesh.visible = true;

    const tapGeometry = new THREE.PlaneGeometry(this.display.width, this.display.height);
    this.tapMesh = new THREE.Mesh(tapGeometry, this.tapMaterial);
    this.tapMesh.position.set(0, this.display.centerY, this.display.z + 0.05);
    this.tapMesh.renderOrder = 5;
    this.phone.add(this.tapMesh);
    (this.tapMaterial.uniforms.aspect as { value: number }).value = this.display.width / this.display.height;

    const aspect = model.width / model.height;
    const soft = shadowTexture(aspect, 46);
    const near = shadowTexture(aspect, 16);
    const set = (mesh: THREE.Mesh, shape: ShadowShape) => {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      // The picture's own alpha is the shadow: as a map, not an alphaMap,
      // which would read the colour and lose the blur.
      mat.map = shape.texture;
      mat.needsUpdate = true;
    };
    set(this.shadowSoft, soft);
    set(this.shadowNear, near);
    this.shadowFit = { soft: { across: soft.across, down: soft.down }, near: { across: near.across, down: near.down } };
    if (this.screen) this.applyScreen();
  }

  private clearPhone() {
    if (this.device) {
      this.device.setShot(null);
      this.phone.remove(this.device.group);
      for (const geometry of this.device.geometries) geometry.dispose();
      this.device.dispose();
      this.device = null;
    }
    if (this.mats) {
      for (const material of Object.values(this.mats)) (material as THREE.Material).dispose();
      this.mats = null;
    }
    if (this.tapMesh) {
      this.phone.remove(this.tapMesh);
      this.tapMesh.geometry.dispose();
      this.tapMesh = null;
    }
    this.phoneKey = '';
  }

  /** True when the picture has pixels to send: a video only once it shows a frame. */
  private static ready(image: unknown): boolean {
    if (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement) return image.readyState >= 2 && image.videoWidth > 0;
    return true;
  }

  /** The recording (or a picture) shown on the screen. Null shows the screen off. */
  setScreen(source: ScreenSource | null): void {
    // The same video at the same size: only the fit changes. A new size needs a
    // new texture, because a texture's storage keeps the size it was made with.
    if (this.screen && source && this.screen.texture.image === source.image && this.screen.width === source.width && this.screen.height === source.height) {
      if (!this.screen.uploaded) this.screenChanged();
      this.applyScreen();
      return;
    }
    this.screen?.texture.dispose();
    this.screen = null;
    if (source) {
      // A video needs three.js's VideoTexture: a plain Texture reads a
      // video's size from its width attribute (0 here) and gives it storage
      // of that size for good.
      const texture =
        typeof HTMLVideoElement !== 'undefined' && source.image instanceof HTMLVideoElement
          ? new THREE.VideoTexture(source.image)
          : new THREE.Texture(source.image as TexImageSource);
      texture.colorSpace = THREE.SRGBColorSpace;
      // Mipmaps keep small text on the screen from shimmering when the phone
      // is small in the picture.
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      this.screen = { texture, width: source.width, height: source.height, uploaded: false };
      this.screenChanged();
    }
    this.applyScreen();
  }

  private applyScreen() {
    if (!this.device) return;
    this.device.setShot(this.screen ? { texture: this.screen.texture, image: { naturalWidth: this.screen.width, naturalHeight: this.screen.height }, fit: 'cover' } : null);
  }

  /**
   * The screen's picture changed (a new video frame): send it to the GPU with
   * the next render. Never before the video has a frame: the first upload sets
   * the texture's size for good, and a video with no frame yet has none.
   */
  screenChanged(): void {
    if (!this.screen || !DirectorStage.ready(this.screen.texture.image)) return;
    const image = this.screen.texture.image as { videoWidth?: number; videoHeight?: number };
    if (image.videoWidth && (image.videoWidth !== this.screen.width || image.videoHeight !== this.screen.height)) {
      // Another recording in the same video element: a texture of the new size.
      this.setScreen({ image: this.screen.texture.image as HTMLVideoElement, width: image.videoWidth, height: image.videoHeight ?? 0 });
      return;
    }
    this.screen.texture.needsUpdate = true;
    this.screen.uploaded = true;
  }

  /**
   * A place on the recording to a place on the display, both in fractions.
   * The recording fills the display like CSS cover, so a recording of another
   * shape loses a little at two edges.
   */
  recordingToDisplay(x: number, y: number): { x: number; y: number } {
    if (!this.screen) return { x, y };
    const imageAspect = this.screen.width / this.screen.height;
    const screenAspect = this.display.width / this.display.height;
    if (imageAspect > screenAspect) {
      const keep = screenAspect / imageAspect;
      return { x: (x - (1 - keep) / 2) / keep, y };
    }
    const keep = imageAspect / screenAspect;
    return { x, y: (y - (1 - keep) / 2) / keep };
  }

  /** The phone's proportions for the planner, in phone heights. */
  shape(): { width: number; screenW: number; screenH: number } {
    const model = this.model;
    if (!model) return { width: 0.48, screenW: 0.44, screenH: 0.94 };
    return { width: model.width / model.height, screenW: this.display.width / model.height, screenH: this.display.height / model.height };
  }

  render(frame: StageFrame): void {
    if (this.disposed || !this.model) return;
    const model = this.model;
    const { pose } = frame;
    const turn = frame.turn ?? fromYawPitchRoll(pose.yaw, pose.pitch, pose.roll);
    const q = new THREE.Quaternion(turn[0], turn[1], turn[2], turn[3]);
    this.phone.quaternion.copy(q);
    this.phone.updateMatrixWorld(true);

    // Frame the place on the screen the pose names.
    const H = model.height;
    const viewH = (WIDE_VIEW * H) / Math.max(0.2, pose.zoom);
    const viewW = viewH * (this.width / this.height);
    const distance = viewH / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const onScreen = this.recordingToDisplay(pose.fx, pose.fy);
    const local = new THREE.Vector3(
      (onScreen.x - 0.5) * this.display.width,
      (0.5 - onScreen.y) * this.display.height + this.display.centerY,
      this.display.z
    );
    const focus = local.applyQuaternion(q);
    const cx = focus.x - frame.shift.x * viewW;
    const cy = focus.y - frame.shift.y * viewH - pose.lift * H;
    this.camera.position.set(cx, cy, focus.z + distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(cx, cy, focus.z);
    this.camera.near = Math.max(1, distance - H * 1.5);
    this.camera.far = distance + H * 4;
    this.camera.fov = FOV;
    this.camera.updateProjectionMatrix();

    // The shadow falls on a wall behind the phone, away from the light.
    const angles = frame.turn ? toYawPitchRoll(frame.turn) : pose;
    const wall = -H * 0.55;
    const reach = (0 - wall) / LIGHT.z;
    const along = (mesh: THREE.Mesh, fit: { across: number; down: number }, depth: number, grow: number) => {
      mesh.position.set(-LIGHT.x * reach * depth, -LIGHT.y * reach * depth, wall);
      const yaw = THREE.MathUtils.degToRad(angles.yaw);
      const pitch = THREE.MathUtils.degToRad(angles.pitch);
      const w = model.width * Math.abs(Math.cos(yaw)) + model.thickness * Math.abs(Math.sin(yaw));
      const h = H * Math.abs(Math.cos(pitch)) + model.thickness * Math.abs(Math.sin(pitch));
      mesh.scale.set((w * grow) / fit.across, (h * grow) / fit.down, 1);
      mesh.rotation.set(0, 0, THREE.MathUtils.degToRad(angles.roll));
    };
    along(this.shadowSoft, this.shadowFit.soft, 0.55, 1.12);
    along(this.shadowNear, this.shadowFit.near, 0.3, 0.98);

    const u = this.backdropMaterial.uniforms;
    (u.aspect as { value: number }).value = this.width / this.height;
    // The glows drift slowly, and a little against the camera, so the space behind feels deep.
    (u.drift.value as THREE.Vector2).set(
      0.03 * Math.sin(frame.t * 0.21) - (cx / viewH) * 0.04,
      0.025 * Math.cos(frame.t * 0.17) - (cy / viewH) * 0.04
    );

    const taps = this.tapMaterial.uniforms.taps.value as THREE.Vector3[];
    for (let i = 0; i < 3; i++) {
      const tap = frame.taps[i];
      if (tap) {
        const p = this.recordingToDisplay(tap.x, tap.y);
        taps[i].set(p.x, p.y, tap.age);
      } else taps[i].set(0, 0, -1);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Where a place on the recording lands in the picture, in CSS pixels, after the last render. */
  project(x: number, y: number): { x: number; y: number } {
    const p = this.recordingToDisplay(x, y);
    const v = new THREE.Vector3((p.x - 0.5) * this.display.width, (0.5 - p.y) * this.display.height + this.display.centerY, this.display.z);
    v.applyMatrix4(this.phone.matrixWorld).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPhone();
    this.screen?.texture.dispose();
    this.screen = null;
    this.envTexture?.dispose();
    this.pmrem.dispose();
    this.backdropMaterial.dispose();
    this.tapMaterial.dispose();
    for (const mesh of [this.shadowSoft, this.shadowNear]) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      mesh.geometry.dispose();
    }
    this.renderer.dispose();
  }

  /** Frees the GPU right away, without waiting for the browser to collect the canvas. */
  loseContext(): void {
    this.renderer.forceContextLoss();
  }
}
