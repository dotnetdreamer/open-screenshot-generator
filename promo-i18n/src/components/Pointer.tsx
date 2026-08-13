import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

export type Way = { f: number; x: number; y: number };

/**
 * A desktop mouse pointer, because this is a desktop app: an arrow rather than
 * the fingertip a phone promo would use. Glides between waypoints in scene
 * space, and on a click frame it dips and throws two rings. Mount inside the
 * Cam so it scales with whatever it is pointing at.
 */
export const Pointer: React.FC<{
  path: Way[];
  clicks?: number[];
  until?: number;
  accent: string;
  size?: number;
}> = ({ path, clicks = [], until, accent, size = 42 }) => {
  const frame = useCurrentFrame();
  const from = path[0].f;
  if (frame < from - 12) return null;

  const opts = {
    easing: Easing.inOut(Easing.quad),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;
  const fs = path.map((p) => p.f);
  const one = path.length === 1;
  const x = one ? path[0].x : interpolate(frame, fs, path.map((p) => p.x), opts);
  const y = one ? path[0].y : interpolate(frame, fs, path.map((p) => p.y), opts);

  let opacity = interpolate(frame, [from - 10, from], [0, 1], {
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
  for (const t of clicks) {
    if (frame >= t - 4 && frame <= t + 10) {
      press = interpolate(frame, [t - 4, t + 1, t + 10], [1, 0.8, 1], {
        easing: Easing.out(Easing.quad),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
  }

  return (
    <div style={{ position: "absolute", left: 0, top: 0, opacity, pointerEvents: "none" }}>
      {clicks.map((t) =>
        [0, 5].map((delay) => {
          const a = frame - t - delay;
          if (a < 0 || a > 22) return null;
          const p = a / 22;
          const r = size * (0.5 + p * 2.4);
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
                opacity: (1 - p) * 0.85,
              }}
            />
          );
        })
      )}
      {/* The arrow itself, drawn as a rotated triangle plus a tail, so it needs
          no asset and stays crisp at any zoom. */}
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: size,
          height: size,
          transform: `scale(${press})`,
          transformOrigin: "0 0",
          filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.55))",
        }}
      >
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
          <path
            d="M3 2 L3 20.5 L8.2 15.6 L11.4 22.4 L14.7 20.8 L11.6 14.2 L18.6 14.2 Z"
            fill="#FFFFFF"
            stroke="rgba(10,12,26,0.9)"
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
};
