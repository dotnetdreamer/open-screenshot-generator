import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type CamKey = { f: number; x: number; y: number; s: number };

/**
 * Portrait camera over scene-space content: each key focuses scene point
 * (x, y) at zoom s, eased cubic in-out between keys, with a handheld micro
 * sway so held shots never feel frozen.
 */
export const Cam: React.FC<{
  keys: CamKey[];
  sway?: number;
  children: React.ReactNode;
}> = ({ keys, sway = 1, children }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const ease = Easing.inOut(Easing.cubic);
  const opts = {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;
  const fs = keys.map((k) => k.f);
  const one = keys.length === 1;
  const x = one ? keys[0].x : interpolate(frame, fs, keys.map((k) => k.x), opts);
  const y = one ? keys[0].y : interpolate(frame, fs, keys.map((k) => k.y), opts);
  const s = one ? keys[0].s : interpolate(frame, fs, keys.map((k) => k.s), opts);

  const swx = (Math.sin(frame * 0.043) * 3 + Math.sin(frame * 0.017) * 2) * sway;
  const swy = (Math.cos(frame * 0.037) * 3 + Math.sin(frame * 0.023) * 2) * sway;
  const rot = Math.sin(frame * 0.021) * 0.12 * sway;

  return (
    <div style={{ position: "absolute", inset: 0, transform: `rotate(${rot}deg)` }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${width / 2 - s * x + swx}px, ${height / 2 - s * y + swy}px) scale(${s})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
};
