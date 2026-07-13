import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ThreeCanvas } from "@remotion/three";
import {
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/** Load a texture and block the frame until it is ready. */
const useImageTexture = (url: string) => {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const handle = delayRender(`texture ${url}`);
    const loader = new THREE.TextureLoader();
    loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      setTex(t);
      continueRender(handle);
    });
  }, [url]);
  return tex;
};

const Phone: React.FC<{
  screen: string;
  x: number;
  y: number;
  z: number;
  height: number;
  baseRotY: number;
  rotZ: number;
  phase: number;
  delay: number;
}> = ({ screen, x, y, z, height, baseRotY, rotZ, phase, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const tex = useImageTexture(staticFile(screen));

  const H = height;
  const W = H * 0.492;
  const D = 0.16;
  const bezel = 0.05;

  const body = useMemo(() => new RoundedBoxGeometry(W, H, D, 5, 0.11), [W, H]);
  const island = useMemo(
    () => new RoundedBoxGeometry(W * 0.3, 0.075, 0.02, 2, 0.036),
    [W]
  );

  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 16, stiffness: 70, mass: 1.2 },
  });

  const bob = Math.sin(t * 1.3 + phase) * 0.05;
  const rotY = baseRotY + Math.sin(t * 0.45 + phase) * 0.16;
  const rotX = Math.sin(t * 0.35 + phase * 1.7) * 0.05;
  const scale = interpolate(enter, [0, 1], [0.75, 1]);

  return (
    <group
      position={[x, y + bob + interpolate(enter, [0, 1], [-2.6, 0]), z]}
      rotation={[rotX, rotY, rotZ]}
      scale={scale}
    >
      <mesh geometry={body}>
        <meshStandardMaterial color="#252b2e" metalness={0.82} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0, D / 2 + 0.002]}>
        <planeGeometry args={[W - bezel * 2, H - bezel * 2]} />
        {tex ? (
          <meshBasicMaterial map={tex} toneMapped={false} />
        ) : (
          <meshBasicMaterial color="#0a0d0e" />
        )}
      </mesh>
      <mesh geometry={island} position={[0, H / 2 - 0.15, D / 2 + 0.012]}>
        <meshStandardMaterial color="#050708" metalness={0.2} roughness={0.6} />
      </mesh>
    </group>
  );
};

type PhoneSpec = React.ComponentProps<typeof Phone>;

/** Landscape spread: hero phone center, two wingmen left and right. */
const WIDE: PhoneSpec[] = [
  {
    screen: "devices/app-feed-light.png",
    x: 2.05,
    y: 0.35,
    z: -1.3,
    height: 2.95,
    baseRotY: -0.34,
    rotZ: 0.09,
    phase: 2.1,
    delay: 30,
  },
  {
    screen: "devices/app-dashboard-sky.png",
    x: -2.0,
    y: -0.05,
    z: -1.5,
    height: 2.8,
    baseRotY: 0.38,
    rotZ: -0.07,
    phase: 3.4,
    delay: 40,
  },
  {
    screen: "devices/app-player-dark.png",
    x: 0.05,
    y: 0,
    z: 0,
    height: 3.6,
    baseRotY: -0.22,
    rotZ: -0.05,
    phase: 0.7,
    delay: 18,
  },
];

/** Portrait stack for the mobile cut: hero center, wingmen tucked diagonally. */
const TALL: PhoneSpec[] = [
  {
    screen: "devices/app-feed-light.png",
    x: -1.42,
    y: 1.12,
    z: -1.7,
    height: 2.65,
    baseRotY: 0.36,
    rotZ: 0.08,
    phase: 2.1,
    delay: 30,
  },
  {
    screen: "devices/app-dashboard-sky.png",
    x: 1.48,
    y: -1.1,
    z: -1.6,
    height: 2.55,
    baseRotY: -0.34,
    rotZ: -0.09,
    phase: 3.4,
    delay: 40,
  },
  {
    screen: "devices/app-player-dark.png",
    x: 0.02,
    y: 0.05,
    z: 0,
    height: 3.45,
    baseRotY: -0.22,
    rotZ: -0.05,
    phase: 0.7,
    delay: 18,
  },
];

/**
 * Real three.js scene for the device mockups: lit, slowly turning phone
 * models with the skeleton screenshots as emissive screens. The "tall"
 * layout rearranges the phones for the portrait (mobile) composition.
 */
export const Devices3D: React.FC<{
  width: number;
  height: number;
  layout?: "wide" | "tall";
}> = ({ width, height, layout = "wide" }) => {
  const phones = layout === "tall" ? TALL : WIDE;
  return (
    <ThreeCanvas
      width={width}
      height={height}
      camera={{ fov: 32, position: [0, 0, 9.2] }}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 6, 6]} intensity={1.9} />
      <pointLight position={[-7, -2, 3]} intensity={60} color="#6FB3B5" />
      <pointLight position={[7, -5, -1]} intensity={38} color="#D4AF37" />
      {phones.map((p) => (
        <Phone key={p.screen} {...p} />
      ))}
    </ThreeCanvas>
  );
};
