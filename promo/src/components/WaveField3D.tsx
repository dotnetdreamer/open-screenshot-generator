import React, { useMemo } from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";

const VERT = /* glsl */ `
uniform float uTime;
attribute float aRand;
varying float vH;
varying float vFade;
varying float vRand;

void main() {
  vec3 p = position;
  float t = uTime;
  float w = 0.0;
  w += sin(p.x * 0.35 + t * 0.9) * 0.45;
  w += sin(p.z * 0.50 - t * 0.6) * 0.35;
  w += sin((p.x + p.z) * 0.22 + t * 0.45) * 0.50;
  w += sin(p.x * 0.80 + p.z * 0.30 - t * 1.3) * 0.15;
  p.y += w;
  vH = w;
  vRand = aRand;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vFade = smoothstep(26.0, 7.0, dist);
  gl_PointSize = (1.2 + (w + 0.9) * 1.0) * (105.0 / dist);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying float vH;
varying float vFade;
varying float vRand;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float a = smoothstep(0.5, 0.05, d);
  vec3 deep = vec3(0.10, 0.23, 0.24);
  vec3 bright = vec3(0.44, 0.70, 0.71);
  vec3 gold = vec3(0.83, 0.69, 0.22);
  float h = clamp((vH + 1.0) / 2.4, 0.0, 1.0);
  vec3 col = mix(deep, bright, h);
  // Rare gold sparkle on the highest crests only.
  col = mix(col, gold, smoothstep(0.82, 1.0, h) * 0.55 * step(0.7, vRand));
  gl_FragColor = vec4(col, a * vFade * 0.5);
}
`;

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * A rolling ocean of glowing dots: a point grid displaced by layered sine
 * waves in the vertex shader (GPU-cheap, one uTime uniform per frame).
 * Teal by height with rare gold crests, fading into the distance.
 */
export const WaveField3D: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const { geometry, uniforms } = useMemo(() => {
    const cols = 130;
    const rows = 55;
    const count = cols * rows;
    const pos = new Float32Array(count * 3);
    const rand = new Float32Array(count);
    const rnd = mulberry32(77123);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pos[i * 3] = (c / (cols - 1) - 0.5) * 34;
        pos[i * 3 + 1] = 0;
        pos[i * 3 + 2] = -1.5 - r * 0.34;
        rand[i] = rnd();
        i++;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
    const uniforms = { uTime: { value: 0 } };
    return { geometry, uniforms };
  }, []);

  return (
    <points geometry={geometry} position={[0, -3.4, 0]}>
      <shaderMaterial
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        uniforms-uTime-value={t}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};
