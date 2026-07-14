import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";

export type CursorWaypoint = {
  /** Local frame at which the pointer tip reaches (x, y). */
  frame: number;
  x: number;
  y: number;
};

/** Expanding teal ring marking a click. */
const Ripple: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > 22) return null;
  const r = interpolate(t, [0, 22], [6, 46], { easing: Easing.out(Easing.cubic) });
  const o = interpolate(t, [0, 22], [0.75, 0]);
  return (
    <div
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: 999,
        border: `3px solid ${C.teal}`,
        opacity: o,
        pointerEvents: "none",
      }}
    />
  );
};

/**
 * A mouse pointer that glides between waypoints (eased per segment) and
 * "presses" at each click frame: the arrow dips slightly and a ripple ring
 * expands from the tip. Coordinates are the pointer tip in scene space, so
 * inside a Camera the cursor magnifies with the UI like a screen recording.
 */
export const Cursor: React.FC<{
  path: CursorWaypoint[];
  /** Local frames at which a click happens (pointer stays wherever it is). */
  clicks?: number[];
  size?: number;
}> = ({ path, clicks = [], size = 34 }) => {
  const frame = useCurrentFrame();

  const frames = path.map((p) => p.frame);
  const opts = {
    easing: Easing.inOut(Easing.quad),
    extrapolateLeft: "clamp" as const,
    extrapolateRight: "clamp" as const,
  };
  const x = interpolate(frame, frames, path.map((p) => p.x), opts);
  const y = interpolate(frame, frames, path.map((p) => p.y), opts);

  const appear = interpolate(frame, [path[0].frame - 8, path[0].frame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Press feel: scale dips around each click.
  let press = 1;
  for (const c of clicks) {
    const d = interpolate(frame, [c - 3, c, c + 7], [1, 0.82, 1], {
      easing: Easing.inOut(Easing.quad),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    press = Math.min(press, d);
  }

  const clickPoints = clicks.map((c) => ({
    at: c,
    x: interpolate(c, frames, path.map((p) => p.x), opts),
    y: interpolate(c, frames, path.map((p) => p.y), opts),
  }));

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {clickPoints.map((p, i) => (
        <Ripple key={i} at={p.at} x={p.x} y={p.y} />
      ))}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        style={{
          position: "absolute",
          // The arrow tip sits at viewBox (3,2); offset so the tip is at (x, y),
          // matching where clicks land and ripples emanate.
          left: x - (3 * size) / 24,
          top: y - (2 * size) / 24,
          opacity: appear,
          transform: `scale(${press})`,
          transformOrigin: `${(3 * size) / 24}px ${(2 * size) / 24}px`,
          filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.45))",
          overflow: "visible",
        }}
      >
        <path
          d="M3 2 L3 19 L7.9 14.6 L10.7 20.9 L13.7 19.6 L10.9 13.4 L17.4 13.4 Z"
          fill="#0E1B1B"
          stroke="#FFFFFF"
          strokeWidth={1.6}
          strokeLinejoin="round"
          paintOrder="stroke"
        />
      </svg>
    </div>
  );
};
