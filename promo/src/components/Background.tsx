import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { C } from "../theme";
import { Particles3D } from "./Particles3D";
import { WaveField3D } from "./WaveField3D";

/**
 * Persistent backdrop for the whole video: near-black base, drifting brand
 * glows, a faint dot grid, and a three.js layer (rolling wave field of
 * glowing dots + floating dust) with a slow scene sway, under a vignette.
 */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;

  const g1x = 30 + Math.sin(t * 0.33) * 18;
  const g1y = 28 + Math.cos(t * 0.26) * 13;
  const g2x = 74 - Math.sin(t * 0.24) * 16;
  const g2y = 70 + Math.sin(t * 0.29) * 12;
  const g1a = 0.16 + Math.sin(t * 0.5) * 0.04;
  const g2a = 0.07 + Math.cos(t * 0.4) * 0.025;

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 700px at ${g1x}% ${g1y}%, rgba(111,179,181,${g1a}), transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(1000px 800px at ${g2x}% ${g2y}%, rgba(212,175,55,${g2a}), transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.4px)",
          backgroundSize: "44px 44px",
          backgroundPosition: `0px ${-(frame * 0.12) % 44}px`,
        }}
      />
      <AbsoluteFill>
        <ThreeCanvas
          width={width}
          height={height}
          camera={{ fov: 50, position: [0, 0, 8] }}
        >
          <group
            position={[Math.sin(t * 0.12) * 0.25, Math.cos(t * 0.1) * 0.15, 0]}
            rotation={[0, 0, Math.sin(t * 0.08) * 0.012]}
          >
            <Particles3D />
            <WaveField3D />
          </group>
        </ThreeCanvas>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(1400px 900px at 50% 46%, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
