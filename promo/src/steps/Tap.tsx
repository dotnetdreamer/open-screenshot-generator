import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

export type TapPoint = { f: number; x: number; y: number };

/**
 * A touch pointer (fingertip glow, not a desktop arrow): glides between
 * waypoints in scene space and presses with a double ripple on tap frames.
 * Place inside a Cam so it magnifies with the UI.
 */
export const Tap: React.FC<{
  path: TapPoint[];
  taps?: number[];
  until?: number;
  accent: string;
  size?: number;
}> = ({ path, taps = [], until, accent, size = 56 }) => {
  const frame = useCurrentFrame();
  const from = path[0].f;
  if (frame < from - 10) return null;

  const ease = Easing.inOut(Easing.quad);
  const opts = {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;
  const fs = path.map((p) => p.f);
  const one = path.length === 1;
  const x = one ? path[0].x : interpolate(frame, fs, path.map((p) => p.x), opts);
  const y = one ? path[0].y : interpolate(frame, fs, path.map((p) => p.y), opts);

  let opacity = interpolate(frame, [from - 8, from], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (until !== undefined) {
    opacity *= interpolate(frame, [until - 8, until], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  if (opacity <= 0) return null;

  let press = 1;
  for (const t of taps) {
    if (frame >= t - 4 && frame <= t + 12) {
      press = interpolate(frame, [t - 4, t + 1, t + 12], [1, 0.78, 1], {
        easing: Easing.out(Easing.quad),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
  }

  const bobY = Math.sin(frame * 0.11) * 2.5;

  return (
    <div style={{ position: "absolute", left: 0, top: 0, opacity }}>
      {taps.map((t) => {
        const age = frame - t;
        if (age < 0 || age > 28) return null;
        return [0, 5].map((delay) => {
          const a = age - delay;
          if (a < 0 || a > 23) return null;
          const p = a / 23;
          const r = size * (0.6 + p * 2.6);
          return (
            <div
              key={`${t}-${delay}`}
              style={{
                position: "absolute",
                left: x - r / 2,
                top: y - r / 2,
                width: r,
                height: r,
                borderRadius: "50%",
                border: `${3 - p * 2}px solid ${accent}`,
                opacity: (1 - p) * 0.8,
              }}
            />
          );
        });
      })}
      <div
        style={{
          position: "absolute",
          left: x - size / 2,
          top: y - size / 2 + bobY,
          width: size,
          height: size,
          borderRadius: "50%",
          transform: `scale(${press})`,
          background: `radial-gradient(circle at 42% 38%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.55) 34%, ${accent}55 62%, transparent 78%)`,
          boxShadow: `0 6px 26px ${accent}66, 0 2px 10px rgba(0,0,0,0.4)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: x - 5,
          top: y - 5 + bobY,
          width: 10,
          height: 10,
          borderRadius: "50%",
          transform: `scale(${press})`,
          background: "#FFFFFF",
        }}
      />
    </div>
  );
};
