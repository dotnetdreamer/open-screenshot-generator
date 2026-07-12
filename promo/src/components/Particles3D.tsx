import React, { useMemo } from "react";
import * as THREE from "three";
import { useCurrentFrame, useVideoConfig } from "remotion";

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * Deterministic 3D dust field rendered with three.js: adds cinematic depth
 * behind every scene. Drift and sway are pure functions of the frame.
 */
export const Particles3D: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const { geometry, sprite } = useMemo(() => {
    const rnd = mulberry32(20260712);
    const count = 280;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * 26;
      pos[i * 3 + 1] = (rnd() - 0.5) * 15;
      pos[i * 3 + 2] = -rnd() * 11;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));

    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const sprite = new THREE.CanvasTexture(c);
    return { geometry, sprite };
  }, []);

  return (
    <group
      position={[Math.sin(t * 0.16) * 0.5, Math.cos(t * 0.13) * 0.4 - t * 0.035, 0]}
      rotation={[0, 0, Math.sin(t * 0.07) * 0.05]}
    >
      <points geometry={geometry}>
        <pointsMaterial
          map={sprite}
          color="#8fc7c9"
          size={0.085}
          sizeAttenuation
          transparent
          opacity={0.42}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
};
