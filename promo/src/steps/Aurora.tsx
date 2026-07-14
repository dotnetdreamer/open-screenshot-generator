import React, { useMemo } from "react";
import * as THREE from "three";
import { ThreeCanvas } from "@remotion/three";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { ACTS, BEATS, lerpHex } from "./style";

/**
 * The film's living backdrop: a domain-warped fbm "silk aurora" shader plane
 * plus a field of additive drifting motes. Everything derives from the frame
 * number, and the palette + energy pulse follow the step beats.
 */

const AURORA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const AURORA_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uT;
uniform float uEnergy;
uniform float uAspect;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = m * p;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  vec2 p = vec2(uv.x * uAspect, uv.y) * 2.2;
  float t = uT * 0.10;

  vec2 q = vec2(fbm(p + t * 0.5), fbm(p + vec2(5.2, 1.3) - t * 0.35));
  vec2 r = vec2(
    fbm(p + q * 1.9 + vec2(1.7, 9.2) + t * 0.7),
    fbm(p + q * 1.9 + vec2(8.3, 2.8) - t * 0.4)
  );
  float f = fbm(p + r * 2.4);

  vec3 col = vec3(0.010, 0.012, 0.030);
  float rib1 = smoothstep(0.44, 0.92, f);
  float rib2 = smoothstep(0.52, 0.96, fbm(p * 1.4 - r * 1.6 + t * 0.6));
  float glow = pow(clamp(q.y * 1.1, 0.0, 1.0), 4.0);
  col += uA * pow(rib1, 2.0) * (0.30 + 0.24 * uEnergy);
  col += uB * pow(rib2, 2.4) * (0.24 + 0.20 * uEnergy);
  col += uC * glow * 0.14;

  float band = dot(p, normalize(vec2(0.4, 0.9)));
  float beam = pow(max(0.0, 1.0 - abs(fract(band * 0.33 - uT * 0.016) - 0.5) * 2.6), 6.0);
  col += mix(uA, uB, 0.5) * beam * (0.06 + 0.12 * uEnergy);

  float centerDim = smoothstep(0.0, 0.6, abs(uv.y - 0.52));
  col *= 0.38 + 0.62 * centerDim;

  vec2 d = uv - 0.5;
  d.x *= uAspect;
  col *= 1.0 - dot(d, d) * 1.1;

  // soft rolloff so ribbon crossings never blow out to white
  col = col / (1.0 + col * 0.9);

  float g = hash(uv * vec2(1920.0, 1080.0) + fract(uT) * 13.7);
  col += (g - 0.5) * 0.03;

  gl_FragColor = vec4(col, 1.0);
}
`;

const MOTES_VERT = /* glsl */ `
attribute float aSeed;
attribute float aSize;
uniform float uT;
varying float vSeed;
void main() {
  vSeed = aSeed;
  vec3 p = position;
  float sp = 0.12 + fract(aSeed * 7.31) * 0.3;
  p.y = mod(p.y + uT * sp, 15.0) - 7.5;
  p.x += sin(uT * 0.25 + aSeed * 40.0) * 0.35;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * (5.0 / -mv.z);
}
`;

const MOTES_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uC1;
uniform vec3 uC2;
uniform float uT;
varying float vSeed;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.08, length(d));
  float tw = 0.45 + 0.55 * sin(uT * (1.5 + fract(vSeed * 3.7) * 2.0) + vSeed * 80.0);
  vec3 col = mix(uC1, uC2, fract(vSeed * 5.13));
  gl_FragColor = vec4(col, a * tw * 0.55);
}
`;

/** Deterministic LCG so the mote field never changes between renders. */
const seeded = (n: number) => {
  let s = 1234567 + n * 9301;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
};

const actColors = (frame: number): [string, string, string] => {
  let cur = ACTS[0].cols;
  for (const act of ACTS) {
    if (frame < act.at) break;
    const t = Math.min(1, (frame - act.at) / 24);
    cur = [
      lerpHex(cur[0], act.cols[0], t),
      lerpHex(cur[1], act.cols[1], t),
      lerpHex(cur[2], act.cols[2], t),
    ];
  }
  return cur as [string, string, string];
};

const energyAt = (frame: number) => {
  let e = 0.45;
  for (const b of BEATS) {
    if (frame >= b) e += 0.85 * Math.exp(-(frame - b) / 14);
  }
  return Math.min(e, 1.6);
};

const AuroraPlane: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uT: { value: 0 },
          uEnergy: { value: 0.5 },
          uAspect: { value: width / height },
          uA: { value: new THREE.Color("#8B5CF6") },
          uB: { value: new THREE.Color("#F471B5") },
          uC: { value: new THREE.Color("#22D3EE") },
        },
        vertexShader: AURORA_VERT,
        fragmentShader: AURORA_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    [width, height]
  );
  const [a, b, c] = actColors(frame);
  mat.uniforms.uT.value = frame / fps;
  mat.uniforms.uEnergy.value = energyAt(frame);
  (mat.uniforms.uA.value as THREE.Color).set(a);
  (mat.uniforms.uB.value as THREE.Color).set(b);
  (mat.uniforms.uC.value as THREE.Color).set(c);
  return (
    <mesh material={mat} frustumCulled={false} renderOrder={-1}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};

const COUNT = 220;

const Motes: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { positions, seeds, sizes } = useMemo(() => {
    const rnd = seeded(7);
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    const sizes = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (rnd() - 0.5) * 6;
      positions[i * 3 + 1] = (rnd() - 0.5) * 15;
      positions[i * 3 + 2] = (rnd() - 0.5) * 3;
      seeds[i] = rnd();
      sizes[i] = 8 + rnd() * 30;
    }
    return { positions, seeds, sizes };
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uT: { value: 0 },
          uC1: { value: new THREE.Color("#8B5CF6") },
          uC2: { value: new THREE.Color("#22D3EE") },
        },
        vertexShader: MOTES_VERT,
        fragmentShader: MOTES_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );
  const [a, , c] = actColors(frame);
  mat.uniforms.uT.value = frame / fps;
  (mat.uniforms.uC1.value as THREE.Color).set(a);
  (mat.uniforms.uC2.value as THREE.Color).set(c);
  return (
    <points material={mat} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
      </bufferGeometry>
    </points>
  );
};

export const Aurora: React.FC = () => {
  const { width, height } = useVideoConfig();
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <ThreeCanvas width={width} height={height}>
        <AuroraPlane />
        <Motes />
      </ThreeCanvas>
    </div>
  );
};
