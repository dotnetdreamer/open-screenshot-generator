import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { P, SHOT } from "../style";

/**
 * One captured editor screenshot, mounted in scene space as a glass card.
 *
 * A scene stacks several of these at the same coordinates and fades between
 * them, so a click and its result are the same rectangle of screen with the
 * pixels swapped, rather than a cut. Shots are 3200x2000 and the card is
 * SHOT.w wide, which puts a CSS pixel of the app on 1.2 scene pixels.
 */
export const Plate: React.FC<{
  src: string;
  /** Global frame the plate takes over on, and how fast it does it. */
  at?: number;
  fade?: number;
  /** Held opacity once it has arrived, for stacking dimmed plates. */
  opacity?: number;
  accent?: string;
}> = ({ src, at = -1, fade = 7, opacity = 1, accent = P.add }) => {
  const frame = useCurrentFrame();
  if (frame < at - fade) return null;
  const t =
    at < 0
      ? 1
      : interpolate(frame, [at - fade, at], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  return (
    <div
      style={{
        position: "absolute",
        left: SHOT.x,
        top: SHOT.y,
        width: SHOT.w,
        borderRadius: 26,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: `0 50px 140px rgba(0,0,0,0.62), 0 0 110px ${accent}22`,
        background: "#0A0E1D",
        opacity: opacity * t,
      }}
    >
      <Img src={staticFile(src)} style={{ width: "100%", display: "block" }} />
    </div>
  );
};
