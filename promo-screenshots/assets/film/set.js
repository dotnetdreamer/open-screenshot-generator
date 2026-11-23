// The studio: a glossy floor, a ring of sixteen LED panels on risers, a truss with
// spotlights over them, an LED band above that, a ceiling grid with softboxes,
// a low round stage in the middle. Everything but the screens' content is built here.
import * as THREE from "../vendor/three.bundle.js";
import { R, N, a, SCREEN, polar } from "./world.js";

const GLOSS_FLOOR = {
  name: "GlossFloor",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    texel: { value: new THREE.Vector2(1 / 720, 1 / 900) },
    strength: { value: 0.95 },
    blur: { value: 4.0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    uniform float strength;
    uniform float blur;
    varying vec4 vUv;
    varying vec3 vWorld;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      // A glossy floor, not a mirror: a disc of taps, stretched along the view's vertical.
      const int TAPS = 16;
      vec3 acc = vec3(0.0);
      float ws = 0.0;
      for (int i = 0; i < TAPS; i++) {
        float fi = float(i);
        float ang = fi * 2.39996;
        float rad = sqrt((fi + 0.5) / float(TAPS));
        vec2 o = vec2(cos(ang), sin(ang) * 2.6) * rad * blur * texel;
        float w = 1.0 - rad * 0.6;
        acc += texture2D(tDiffuse, uv + o).rgb * w;
        ws += w;
      }
      vec3 refl = acc / ws;
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = 0.45 + 0.55 * pow(1.0 - clamp(V.y, 0.0, 1.0), 2.5);
      // Polished concrete: broad smudges in how much it reflects, fine speckle in the base.
      float smudge = 0.78 + 0.22 * noise(vWorld.xz * 0.9) + 0.08 * noise(vWorld.xz * 7.0);
      float speck = 0.9 + 0.1 * hash(floor(vWorld.xz * 260.0));
      vec3 col = color * speck + refl * strength * fres * smudge;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

function bandTexture() {
  // The LED band above the truss: a slow teal to gold dusk, with the tile grid of an LED wall.
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 256;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 2048, 0);
  const stops = ["#1C4D53", "#2E6E70", "#B5813A", "#E0A85A", "#7B4A66", "#2B5C66", "#1C4D53"];
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  x.fillStyle = g;
  x.fillRect(0, 0, 2048, 256);
  const v = x.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, "rgba(0,0,0,0.55)");
  v.addColorStop(0.5, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.25)");
  x.fillStyle = v;
  x.fillRect(0, 0, 2048, 256);
  x.strokeStyle = "rgba(0,0,0,0.35)";
  x.lineWidth = 2;
  for (let i = 0; i <= 2048; i += 32) {
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i, 256);
    x.stroke();
  }
  for (let j = 0; j <= 256; j += 32) {
    x.beginPath();
    x.moveTo(0, j);
    x.lineTo(2048, j);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

const CONE = {
  uniforms: { color: { value: new THREE.Color(1, 0.78, 0.5) }, intensity: { value: 0.21 } },
  vertexShader: /* glsl */ `
    varying float vAlong;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vAlong = clamp(0.5 - position.y, 0.0, 1.0); // cone geometry spans y -0.5..0.5, apex at +0.5
      vec4 w = modelMatrix * vec4(position, 1.0);
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - w.xyz);
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float intensity;
    varying float vAlong;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
      float fall = pow(1.0 - vAlong, 1.2) * smoothstep(0.0, 0.08, vAlong) * (1.0 - smoothstep(0.7, 1.0, vAlong));
      gl_FragColor = vec4(color * intensity * edge * fall, 1.0);
    }`,
};

export function buildSet(scene, { width, height }) {
  const set = new THREE.Group();
  scene.add(set);

  // ---- floor (planar reflection, blurred) ----
  const floor = new THREE.Reflector(new THREE.CircleGeometry(R + 1.4, 160), {
    color: new THREE.Color(0.012, 0.01, 0.009),
    textureWidth: Math.round(width / 2),
    textureHeight: Math.round(height / 2),
    clipBias: 0.002,
    shader: GLOSS_FLOOR,
    multisample: 0,
  });
  floor.material.uniforms.texel.value.set(2 / width, 2 / height);
  floor.rotation.x = -Math.PI / 2;
  set.add(floor);

  const black = new THREE.MeshStandardMaterial({ color: 0x0b0a0a, roughness: 0.55, metalness: 0.2 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f0c0b, roughness: 0.92, metalness: 0, side: THREE.BackSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.38, metalness: 0.85 });

  // ---- the wall behind the screens ----
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.7, R + 0.7, 14, 96, 1, true), wallMat);
  wall.position.y = 7;
  set.add(wall);

  // ---- risers and bezels, one per screen ----
  const riserGeo = new THREE.BoxGeometry(SCREEN.w + 0.12, SCREEN.y0, 0.7);
  const bezelGeo = new THREE.BoxGeometry(SCREEN.w + 0.07, SCREEN.h + 0.07, 0.1);
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.4, metalness: 0.5 });
  for (let i = 0; i < N; i++) {
    const ang = a(i);
    const riser = new THREE.Mesh(riserGeo, black);
    riser.position.set(...polar(R + 0.12, ang, SCREEN.y0 / 2));
    riser.rotation.y = ang + Math.PI;
    set.add(riser);
    const bezel = new THREE.Mesh(bezelGeo, bezelMat);
    bezel.position.set(...polar(R + 0.06, ang, SCREEN.yc));
    bezel.rotation.y = ang + Math.PI;
    set.add(bezel);
  }

  // ---- truss ring over the screens, with three spot cans per screen ----
  const trussY = 5.12;
  for (const [dy, dr] of [[0, 0], [0.34, 0], [0, 0.34], [0.34, 0.34]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 0.55 - dr, 0.025, 6, 220), metal);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = trussY + dy;
    set.add(ring);
  }
  // The brand teal strip that runs along the truss (the reference's blue line).
  const strip = new THREE.Mesh(
    new THREE.TorusGeometry(R - 0.38, 0.018, 6, 260),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 1.25, 1.35) }),
  );
  strip.rotation.x = Math.PI / 2;
  strip.position.y = trussY + 0.52;
  set.add(strip);

  const canGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.3, 20, 1, true);
  const lensGeo = new THREE.CircleGeometry(0.105, 24);
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 3.2, 1.2) });
  const cool = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 3.6, 3.8) });
  const canMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < N; i++) {
    for (let k = -1; k <= 1; k++) {
      const ang = a(i) + k * 0.115;
      const pos = polar(R - 0.72, ang, trussY - 0.16);
      const can = new THREE.Group();
      can.position.set(...pos);
      // Aim the can at the floor just in front of the screen, so its lens faces the camera's side.
      const target = new THREE.Vector3(...polar(R - 2.6, ang, 0.4));
      can.lookAt(target);
      const body = new THREE.Mesh(canGeo, canMat);
      body.rotation.x = Math.PI / 2;
      can.add(body);
      const lens = new THREE.Mesh(lensGeo, k === 0 ? cool : warm);
      lens.position.z = 0.15;
      can.add(lens);
      set.add(can);
    }
  }

  // ---- LED band above the truss ----
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.25, R + 0.25, 1.9, 128, 1, true),
    new THREE.MeshBasicMaterial({ map: bandTexture(), side: THREE.BackSide, color: new THREE.Color(1.05, 1.05, 1.05) }),
  );
  band.position.y = 6.75;
  set.add(band);

  // ---- ceiling grid and softboxes ----
  const ceilY = 9.6;
  const beamGeo = new THREE.BoxGeometry(0.12, 0.12, 2 * R);
  for (const x of [-4.5, 0, 4.5]) {
    const b1 = new THREE.Mesh(beamGeo, metal);
    b1.position.set(x, ceilY, 0);
    set.add(b1);
    const b2 = new THREE.Mesh(beamGeo, metal);
    b2.rotation.y = Math.PI / 2;
    b2.position.set(0, ceilY, x);
    set.add(b2);
  }
  const softMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.5, 2.3) });
  const softGeo = new THREE.PlaneGeometry(1.3, 1.3);
  for (const [x, z] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5], [0, -6.2], [0, 6.2], [-6.2, 0], [6.2, 0]]) {
    const sb = new THREE.Mesh(softGeo, softMat);
    sb.position.set(x, ceilY - 0.4, z);
    sb.rotation.x = Math.PI / 2;
    set.add(sb);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 1.42), canMat);
    frame.position.set(x, ceilY - 0.35, z);
    set.add(frame);
  }

  // ---- light cones from the ceiling spots onto the screens (haze) ----
  const coneGeo = new THREE.ConeGeometry(1, 1, 40, 1, true);
  const cones = new THREE.Group();
  for (let i = 0; i < N; i++) {
    for (const k of [-0.6, 0.6]) {
      // From the ceiling spots down onto the floor beside each prop, so no cone crosses a screen.
      const ang = a(i) + k * 0.2;
      const top = new THREE.Vector3(...polar(R - 4.6, ang, ceilY - 0.3));
      const bottom = new THREE.Vector3(...polar(R - 1.7, ang + k * 0.05, 0.0));
      const len = top.distanceTo(bottom);
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(CONE.uniforms),
        vertexShader: CONE.vertexShader,
        fragmentShader: CONE.fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      if (k > 0) mat.uniforms.color.value.setRGB(0.9, 0.72, 0.55);
      const cone = new THREE.Mesh(coneGeo, mat);
      cone.scale.set(0.95, len, 0.95);
      cone.position.copy(top).lerp(bottom, 0.5);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), bottom.clone().sub(top).normalize());
      cones.add(cone);
    }
  }
  set.add(cones);

  // ---- round stage in the middle, ringed by small bulbs ----
  const stage = new THREE.Mesh(
    new THREE.CylinderGeometry(4.1, 4.15, 0.12, 128),
    new THREE.MeshStandardMaterial({ color: 0x0d0c0c, roughness: 0.32, metalness: 0.35 }),
  );
  stage.position.y = 0.06;
  set.add(stage);
  const bulbGeo = new THREE.SphereGeometry(0.035, 12, 8);
  const bulbWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.4, 1.4) });
  const bulbTeal = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3.6, 3.8) });
  for (let k = 0; k < 64; k++) {
    const ang = (k / 64) * Math.PI * 2;
    const b = new THREE.Mesh(bulbGeo, k % 3 === 0 ? bulbTeal : bulbWarm);
    b.position.set(...polar(4.18, ang, 0.1));
    set.add(b);
  }

  return { floor, set };
}

/** The lights that follow the camera round the ring, so the prop in front of it is lit. */
export function buildLights(scene) {
  THREE.RectAreaLightUniformsLib.init();
  const hemi = new THREE.HemisphereLight(0x7a6a62, 0x0c0a09, 0.5);
  scene.add(hemi);
  const key = new THREE.SpotLight(0xffd2a0, 60, 14, 0.62, 0.65, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);
  // The screen in front of the camera lights its prop in its own colour.
  const glow = new THREE.RectAreaLight(0xffffff, 3.2, 3.2, 4.0);
  scene.add(glow);
  // A cool rim from behind the props, from the truss.
  const rim = new THREE.SpotLight(0x9fe3e6, 24, 12, 0.7, 0.8, 1.6);
  scene.add(rim);
  scene.add(rim.target);
  return { hemi, key, glow, rim };
}
