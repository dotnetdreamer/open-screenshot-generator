import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type CameraKeyframe = {
  /** Local frame at which this keyframe is fully reached. */
  frame: number;
  /** Point (in scene coordinates) that should sit at the canvas center. */
  x: number;
  y: number;
  scale: number;
};

/**
 * Screen-recording style camera: pans and zooms the scene toward a focus
 * point, easing between keyframes. Children are laid out in normal scene
 * coordinates; at scale 1 with focus at the canvas center the camera is
 * an identity transform. Keep captions that must stay crisp outside of it.
 */
export const Camera: React.FC<{
  keyframes: CameraKeyframe[];
  children: React.ReactNode;
}> = ({ keyframes, children }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const frames = keyframes.map((k) => k.frame);
  const opts = {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp" as const,
    extrapolateRight: "clamp" as const,
  };
  const x = interpolate(frame, frames, keyframes.map((k) => k.x), opts);
  const y = interpolate(frame, frames, keyframes.map((k) => k.y), opts);
  const scale = interpolate(frame, frames, keyframes.map((k) => k.scale), opts);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transformOrigin: "0 0",
        transform: `translate(${width / 2 - scale * x}px, ${
          height / 2 - scale * y
        }px) scale(${scale})`,
      }}
    >
      {children}
    </div>
  );
};
