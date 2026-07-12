import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

/**
 * Wraps a scene with a gentle fade/drift in and out so scenes can
 * overlap on the persistent background without hard cuts.
 */
export const Scene: React.FC<{
  duration: number;
  fadeIn?: boolean;
  fadeOut?: boolean;
  children: React.ReactNode;
}> = ({ duration, fadeIn = true, fadeOut = true, children }) => {
  const frame = useCurrentFrame();
  const inO = fadeIn
    ? interpolate(frame, [0, 14], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const outO = fadeOut
    ? interpolate(frame, [duration - 14, duration], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;
  const drift = fadeOut
    ? interpolate(frame, [duration - 14, duration], [0, -18], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;
  return (
    <AbsoluteFill
      style={{ opacity: Math.min(inO, outO), transform: `translateY(${drift}px)` }}
    >
      {children}
    </AbsoluteFill>
  );
};
