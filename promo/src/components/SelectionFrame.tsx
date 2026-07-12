import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "../theme";

/**
 * The brand motif: a design-tool selection around content. Dashed
 * marching-ants border plus four gold corner handles that snap in.
 */
export const SelectionFrame: React.FC<{
  /** Frame (local to the parent sequence) at which the selection appears. */
  appearAt?: number;
  handleSize?: number;
  radius?: number;
}> = ({ appearAt = 0, handleSize = 18, radius = 18 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const appear = spring({
    frame: frame - appearAt,
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.6 },
  });
  const opacity = interpolate(frame - appearAt, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const h = handleSize;
  const off = -h / 2;
  const corners: Array<[string, string]> = [
    ["0%", "0%"],
    ["100%", "0%"],
    ["0%", "100%"],
    ["100%", "100%"],
  ];

  return (
    <div style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}>
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx={radius}
          fill="none"
          stroke={C.teal}
          strokeWidth={2}
          strokeDasharray="10 8"
          strokeDashoffset={-frame * 0.9}
        />
      </svg>
      {corners.map(([left, top], i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left,
            top,
            width: h,
            height: h,
            marginLeft: off,
            marginTop: off,
            borderRadius: 5,
            background: C.gold,
            boxShadow: "0 2px 10px rgba(0,0,0,0.45)",
            transform: `scale(${appear})`,
          }}
        />
      ))}
    </div>
  );
};
