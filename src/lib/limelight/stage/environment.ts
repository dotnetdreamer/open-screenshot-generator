/**
 * The light a Limelight stage is lit by, and the backdrop behind it.
 *
 * Each look is a small room made of glowing panels, rendered once into a
 * prefiltered environment map (PMREM) that the glass and metal of the devices
 * reflect. Nothing is downloaded: a room is a few dozen triangles and takes a
 * few milliseconds to bake, and the last few are kept so switching back is
 * free. The key panel stands where the look's light is, so the highlight on a
 * phone's edge moves when the light does, and it stays put in the world while
 * the camera moves round, as in a real studio.
 *
 * The backdrop is a full-screen triangle drawn first, behind everything, in
 * the colours picked: it ignores the camera, so it never shows an edge, and
 * it skips tone mapping, so a #ffffff backdrop is white in the video.
 */

import * as THREE from 'three';
import type { LimelightBackdrop, LimelightEnvironment, LimelightLight } from '../types';

/** Unit vector from the stage toward a light at this azimuth and elevation. */
export function lightDirection(light: Pick<LimelightLight, 'azimuth' | 'elevation'>): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(light.azimuth);
  const el = THREE.MathUtils.degToRad(light.elevation);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

interface Panel {
  width: number;
  height: number;
  /** Linear RGB, above 1 for a light. */
  color: [number, number, number];
  direction: THREE.Vector3;
  distance?: number;
}

interface Room {
  top: [number, number, number];
  floor: [number, number, number];
  panels: Panel[];
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The room of each look, with its key panel where the light is. */
function roomFor(environment: LimelightEnvironment, light: LimelightLight): Room {
  const key = lightDirection(light);
  const opposite = lightDirection({ azimuth: light.azimuth + 180, elevation: 12 });
  opposite.z = Math.abs(opposite.z) + 0.6;
  switch (environment) {
    case 'daylight':
      return {
        top: [0.78, 0.79, 0.8],
        floor: [0.32, 0.31, 0.3],
        panels: [
          { width: 22, height: 15, color: [5, 5, 5], direction: key },
          { width: 22, height: 14, color: [2.4, 2.4, 2.4], direction: opposite },
          { width: 40, height: 6, color: [3.5, 3.5, 3.5], direction: v(0, 1, 0.1), distance: 18 },
          { width: 5, height: 26, color: [2, 2, 2], direction: v(1, 0.1, -0.5) },
          { width: 5, height: 26, color: [2, 2, 2], direction: v(-1, 0.1, -0.5) },
        ],
      };
    case 'sunset':
      return {
        top: [0.42, 0.2, 0.14],
        floor: [0.06, 0.03, 0.08],
        panels: [
          { width: 18, height: 8, color: [9, 4.2, 1.6], direction: key },
          { width: 18, height: 12, color: [0.5, 0.45, 1.1], direction: opposite },
          { width: 4, height: 26, color: [3, 1.1, 1.6], direction: v(1, 0.15, -0.55) },
          { width: 4, height: 26, color: [1.2, 0.8, 2.4], direction: v(-1, 0.15, -0.55) },
          { width: 30, height: 5, color: [1.4, 0.8, 0.6], direction: v(0, 1, 0.15), distance: 18 },
        ],
      };
    case 'night':
      return {
        top: [0.05, 0.07, 0.16],
        floor: [0.01, 0.012, 0.03],
        panels: [
          { width: 14, height: 10, color: [3.2, 3.4, 4], direction: key },
          { width: 3, height: 28, color: [0.5, 3.2, 5], direction: v(1, 0.15, -0.5) },
          { width: 3, height: 28, color: [5, 0.6, 3.4], direction: v(-1, 0.15, -0.5) },
          { width: 30, height: 4, color: [0.8, 1, 2], direction: v(0, 1, 0.15), distance: 18 },
        ],
      };
    case 'noir':
      return {
        top: [0.02, 0.02, 0.022],
        floor: [0.004, 0.004, 0.005],
        panels: [
          { width: 12, height: 30, color: [9, 9, 9], direction: key },
          { width: 3, height: 26, color: [0.9, 0.9, 0.9], direction: v(-1, 0.1, -0.5) },
        ],
      };
    case 'studio':
    default:
      // The 3D Studio's own room (DeviceStudioRenderer), so a phone looks the
      // same on the stage as on the canvas.
      return {
        top: [0.42, 0.43, 0.46],
        floor: [0.07, 0.07, 0.08],
        panels: [
          { width: 16, height: 11, color: [7, 7, 7], direction: key },
          { width: 18, height: 12, color: [1.4, 1.4, 1.4], direction: opposite },
          { width: 34, height: 5, color: [3.2, 3.2, 3.2], direction: v(0, 1, 0.15), distance: 18 },
          { width: 4, height: 26, color: [2.6, 2.6, 2.6], direction: v(1, 0.15, -0.55) },
          { width: 4, height: 26, color: [2.6, 2.6, 2.6], direction: v(-1, 0.15, -0.55) },
          { width: 30, height: 7, color: [0.55, 0.55, 0.55], direction: v(0, -0.25, 1) },
        ],
      };
  }
}

function buildRoom(room: Room): THREE.Scene {
  const scene = new THREE.Scene();
  const sphere = new THREE.SphereGeometry(40, 32, 16);
  const position = sphere.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  const top = new THREE.Color(...room.top);
  const floor = new THREE.Color(...room.floor);
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) / 40 + 1) / 2;
    const c = floor.clone().lerp(top, Math.pow(t, 0.7));
    colors.push(c.r, c.g, c.b);
  }
  sphere.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const panel of room.panels) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(...panel.color), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(panel.width, panel.height), material);
    mesh.position.copy(panel.direction.clone().normalize().multiplyScalar(panel.distance ?? 20));
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }
  return scene;
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
}

/** Baked environment maps, a few kept so switching between looks costs nothing. */
export class EnvironmentCache {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly maps = new Map<string, THREE.Texture>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  get(environment: LimelightEnvironment, light: LimelightLight): THREE.Texture {
    // Light angles to the nearest degree: a slider dragged a hair does not bake a new room.
    const key = `${environment}|${Math.round(light.azimuth)}|${Math.round(light.elevation)}`;
    const cached = this.maps.get(key);
    if (cached) {
      this.maps.delete(key);
      this.maps.set(key, cached);
      return cached;
    }
    const room = buildRoom(roomFor(environment, light));
    const texture = this.pmrem.fromScene(room, 0.02).texture;
    disposeScene(room);
    this.maps.set(key, texture);
    while (this.maps.size > 4) {
      const [oldest, map] = this.maps.entries().next().value as [string, THREE.Texture];
      this.maps.delete(oldest);
      map.dispose();
    }
    return texture;
  }

  dispose() {
    for (const map of this.maps.values()) map.dispose();
    this.maps.clear();
    this.pmrem.dispose();
  }
}

const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const BACKDROP_FRAGMENT = /* glsl */ `
uniform vec3 top;
uniform vec3 bottom;
uniform vec3 second;
uniform float style;
uniform float aspect;
uniform float dither;
uniform vec2 shift;
uniform float time;
varying vec2 vUv;

float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// A soft light: 1 at its centre, falling off like a lamp seen through haze.
float light(vec2 p, vec2 centre, float radius) {
  vec2 d = p - centre;
  return exp(-dot(d, d) / (radius * radius));
}

void main() {
  vec3 color;
  if (style < 2.5) {
    float t;
    if (style < 0.5) {
      t = 0.0;
    } else if (style < 1.5) {
      t = 1.0 - vUv.y;
    } else {
      // Light in the middle, a little above centre, darker toward the corners.
      vec2 p = vUv - vec2(0.5, 0.56);
      p.x *= aspect;
      t = clamp(length(p) / (0.55 * max(aspect, 1.0) + 0.35), 0.0, 1.0);
      t = t * t * (3.0 - 2.0 * t);
    }
    color = mix(top, bottom, t);
  } else {
    // Three lights on the ground colour, measured in the frame's short side
    // so they are the same size in a tall frame and a wide one, and placed
    // by the frame's half sides so a wide frame spreads them across.
    vec2 ext = 0.5 * vec2(aspect, 1.0) / min(aspect, 1.0);
    vec2 p = (vUv - 0.5) * 2.0 * ext;
    float t = time;
    vec2 a = vec2(0.0, 0.02) * ext + 0.05 * vec2(sin(t * 0.31), cos(t * 0.23)) + shift;
    vec2 b = vec2(-0.85, -0.7) * ext + 0.07 * vec2(cos(t * 0.27 + 1.3), sin(t * 0.19 + 0.4)) + shift * 1.6;
    vec2 c = vec2(0.8, 0.75) * ext + 0.06 * vec2(sin(t * 0.21 + 2.1), cos(t * 0.33 + 0.9)) + shift * 0.6;
    // One light behind the middle, a smaller one of the second hue low in a
    // corner and a faint one high in the other: mostly the ground colour,
    // so what stands in front reads, with colour where the eye goes.
    color = bottom
      + top * 0.7 * light(p, a, 0.38)
      + second * 0.5 * light(p, b, 0.36)
      + top * 0.22 * light(p, c, 0.3);
    // A soft shoulder, so where two lights meet stays a colour rather than white.
    color = color / (1.0 + 0.35 * max(color.r, max(color.g, color.b)));
  }
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  // A gradient drawn straight to the screen in 8 bits bands in dark colours;
  // half a step of noise hides that. The post pass adds its own instead.
  gl_FragColor.rgb += dither * (noise(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;

const STYLE_INDEX: Record<LimelightBackdrop['style'], number> = { solid: 0, linear: 1, radial: 2, glow: 3 };

const hsl = { h: 0, s: 0, l: 0 };

/**
 * A glow's second light: the hue a sixth of the way round from its first,
 * a little deeper, so two lights read as one palette rather than two colours.
 */
export function secondGlow(top: string, out = new THREE.Color()): THREE.Color {
  out.set(top).getHSL(hsl);
  return out.setHSL((hsl.h + (hsl.s < 0.08 ? 0 : 0.16)) % 1, Math.min(1, hsl.s * 1.1), hsl.l * 0.8);
}

export interface Backdrop {
  mesh: THREE.Mesh;
  set: (backdrop: LimelightBackdrop, aspect: number, dither: boolean) => void;
  /** Where a glow's lights are at this moment: they drift with the time and shift with the camera. */
  place: (camera: { azimuth: number; elevation: number }, time: number) => void;
}

/** The backdrop: a triangle that covers the screen, drawn first and never written to the depth buffer. */
export function createBackdrop(): Backdrop {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    vertexShader: BACKDROP_VERTEX,
    fragmentShader: BACKDROP_FRAGMENT,
    uniforms: {
      top: { value: new THREE.Color() },
      bottom: { value: new THREE.Color() },
      second: { value: new THREE.Color() },
      style: { value: 2 },
      aspect: { value: 1 },
      dither: { value: 1 },
      shift: { value: new THREE.Vector2() },
      time: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return {
    mesh,
    set: (backdrop, aspect, dither) => {
      const u = material.uniforms;
      (u.top.value as THREE.Color).set(backdrop.top);
      (u.bottom.value as THREE.Color).set(backdrop.style === 'solid' ? backdrop.top : backdrop.bottom);
      secondGlow(backdrop.top, u.second.value as THREE.Color);
      u.style.value = STYLE_INDEX[backdrop.style] ?? 2;
      u.aspect.value = aspect;
      u.dither.value = dither ? 1 : 0;
    },
    place: (camera, time) => {
      // A light far behind the stage slides the other way as the camera goes
      // round, by about a third of the frame for a quarter turn.
      (material.uniforms.shift.value as THREE.Vector2).set((-camera.azimuth / 90) * 0.35, (-camera.elevation / 90) * 0.3);
      material.uniforms.time.value = time;
    },
  };
}
