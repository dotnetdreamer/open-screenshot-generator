import React from "react";
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { SHOT } from "./style";

/**
 * A captured app screenshot floating as a rounded glass card in scene space.
 * Shots are 3200x2400; the card renders them at SHOT.w unless overridden.
 */
export const ShotCard: React.FC<{
  src: string;
  from?: number;
  x?: number;
  y?: number;
  w?: number;
  accent?: string;
  opacity?: number;
  pop?: boolean;
}> = ({ src, from = 0, x = SHOT.x, y = SHOT.y, w = SHOT.w, accent = "#8B5CF6", opacity = 1, pop = true }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from) return null;
  const spr = pop
    ? spring({ frame: frame - from, fps, config: { damping: 16, mass: 0.8 } })
    : 1;
  const fade = interpolate(frame, [from, from + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        borderRadius: 30,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.17)",
        boxShadow: `0 46px 130px rgba(0,0,0,0.6), 0 0 100px ${accent}26, inset 0 1px 0 rgba(255,255,255,0.12)`,
        background: "#0A0E1D",
        transform: `scale(${0.95 + 0.05 * spr}) translateY(${(1 - spr) * 36}px)`,
        transformOrigin: "50% 40%",
        opacity: opacity * fade,
      }}
    >
      <Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />
    </div>
  );
};
