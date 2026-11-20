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
uniform float style;
uniform float aspect;
uniform float dither;
varying vec2 vUv;

float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
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
  vec3 color = mix(top, bottom, t);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  // A gradient drawn straight to the screen in 8 bits bands in dark colours;
  // half a step of noise hides that. The post pass adds its own instead.
  gl_FragColor.rgb += dither * (noise(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;

/** The backdrop: a triangle that covers the screen, drawn first and never written to the depth buffer. */
export function createBackdrop(): { mesh: THREE.Mesh; set: (backdrop: LimelightBackdrop, aspect: number, dither: boolean) => void } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    vertexShader: BACKDROP_VERTEX,
    fragmentShader: BACKDROP_FRAGMENT,
    uniforms: {
      top: { value: new THREE.Color() },
      bottom: { value: new THREE.Color() },
      style: { value: 2 },
      aspect: { value: 1 },
      dither: { value: 1 },
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
      u.style.value = backdrop.style === 'solid' ? 0 : backdrop.style === 'linear' ? 1 : 2;
      u.aspect.value = aspect;
      u.dither.value = dither ? 1 : 0;
    },
  };
}
