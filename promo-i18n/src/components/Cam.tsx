import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type CamKey = { f: number; x: number; y: number; s: number };

/**
 * The only camera in the video.
 *
 * Every key says "put scene point (x, y) in the middle of the frame at zoom s",
 * eased cubic in and out between keys, with a handheld sway on top so a held
 * shot never looks like a still. Scenes never cut inside themselves: they move
 * the camera and swap the plate underneath it, which is what makes a stack of
 * screenshots read as one continuous session.
 */
export const Cam: React.FC<{
  keys: CamKey[];
  sway?: number;
  children: React.ReactNode;
}> = ({ keys, sway = 1, children }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const opts = {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;
  const fs = keys.map((k) => k.f);
  const one = keys.length === 1;
  const x = one ? keys[0].x : interpolate(frame, fs, keys.map((k) => k.x), opts);
  const y = one ? keys[0].y : interpolate(frame, fs, keys.map((k) => k.y), opts);
  const s = one ? keys[0].s : interpolate(frame, fs, keys.map((k) => k.s), opts);

  const swx = (Math.sin(frame * 0.041) * 3 + Math.sin(frame * 0.017) * 2) * sway;
  const swy = (Math.cos(frame * 0.035) * 3 + Math.sin(frame * 0.022) * 2) * sway;
  const rot = Math.sin(frame * 0.019) * 0.1 * sway;

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
