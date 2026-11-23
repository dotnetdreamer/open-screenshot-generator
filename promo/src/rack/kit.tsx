import React from "react";
import { C, F_MONO } from "./style";

/**
 * Hardware parts drawn in CSS: screws, jacks, knobs, LEDs, a toggle. Light
 * comes from the top left, so every part throws its shadow down and right.
 * Positions are centres, in the parent's px.
 */

const at = (x: number, y: number, w: number, h = w): React.CSSProperties => ({
  position: "absolute",
  left: x - w / 2,
  top: y - h / 2,
  width: w,
  height: h,
});

export const Screw: React.FC<{ x: number; y: number; d?: number; turn?: number; dark?: boolean }> = ({
  x, y, d = 15, turn = 30, dark,
}) => (
  <div
    style={{
      ...at(x, y, d),
      borderRadius: "50%",
      background: dark
        ? "radial-gradient(circle at 35% 30%, #77736E, #3A3835 60%, #1A1918)"
        : "radial-gradient(circle at 35% 30%, #F4F1EC, #B9B2A7 55%, #7E776D)",
      boxShadow: "1px 2px 2px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(0,0,0,0.25)",
    }}
  >
    <div
      style={{
        position: "absolute",
        left: "18%",
        right: "18%",
        top: "50%",
        height: Math.max(1.5, d * 0.13),
        marginTop: -Math.max(1.5, d * 0.13) / 2,
        background: "rgba(0,0,0,0.55)",
        transform: `rotate(${turn}deg)`,
        borderRadius: 1,
      }}
    />
  </div>
);

/** A patch socket: a nut, then the black hole. */
export const Jack: React.FC<{ x: number; y: number; d?: number; dark?: boolean }> = ({ x, y, d = 30, dark }) => (
  <div
    style={{
      ...at(x, y, d),
      borderRadius: "50%",
      background: dark
        ? "radial-gradient(circle at 35% 30%, #8B8681, #45423F 60%, #262422)"
        : "radial-gradient(circle at 35% 30%, #FFFFFF, #C9C3BA 55%, #8A8378)",
      boxShadow: "2px 3px 4px rgba(40,20,10,0.35)",
    }}
  >
    <div
      style={{
        ...at(d / 2, d / 2, d * 0.56),
        borderRadius: "50%",
        background: "radial-gradient(circle at 50% 60%, #050505, #1C1B1A 70%, #3A3835)",
        boxShadow: "inset 0 2px 3px rgba(0,0,0,0.8)",
      }}
    />
  </div>
);

export type KnobTone = "white" | "dark" | "coral" | "cream";

const KNOB: Record<KnobTone, { cap: string; skirt: string; mark: string }> = {
  white: { cap: "radial-gradient(circle at 38% 30%, #FFFFFF, #F1EEE8 45%, #D4CEC4)", skirt: "#E7E2D9", mark: "#2A2826" },
  cream: { cap: "radial-gradient(circle at 38% 30%, #FFFDF8, #EDE6D8 50%, #CFC6B5)", skirt: "#E2DACB", mark: "#2A2826" },
  dark: { cap: "radial-gradient(circle at 38% 30%, #6E6A66, #403D3A 50%, #2A2826)", skirt: "#4A4643", mark: "#F4F1EA" },
  coral: { cap: "radial-gradient(circle at 38% 30%, #FFB49C, #F0805F 50%, #C95B3E)", skirt: "#D9D3C9", mark: "#FFFFFF" },
};

/** A knurled knob; `angle` is the pointer in degrees, 0 pointing up. */
export const Knob: React.FC<{ x: number; y: number; d: number; tone: KnobTone; angle: number }> = ({
  x, y, d, tone, angle,
}) => {
  const k = KNOB[tone];
  return (
    <div style={{ ...at(x, y, d) }}>
      {/* soft cast shadow, long and to the lower right */}
      <div
        style={{
          ...at(d * 0.72, d * 0.78, d * 1.08, d * 1.0),
          borderRadius: "50%",
          background: "rgba(80,40,30,0.28)",
          filter: `blur(${d * 0.09}px)`,
        }}
      />
      {/* skirt with ticks */}
      <div
        style={{
          ...at(d / 2, d / 2, d),
          borderRadius: "50%",
          background: `repeating-conic-gradient(from 0deg, ${k.skirt} 0deg 6deg, rgba(0,0,0,0.18) 6deg 9deg)`,
          boxShadow: "inset 0 -2px 3px rgba(0,0,0,0.25), 0 1px 1px rgba(0,0,0,0.2)",
        }}
      />
      {/* cap */}
      <div
        style={{
          ...at(d / 2, d / 2, d * 0.8),
          borderRadius: "50%",
          background: k.cap,
          boxShadow: "inset 0 1px 1px rgba(255,255,255,0.7), 0 2px 3px rgba(0,0,0,0.25)",
          transform: `rotate(${angle}deg)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "7%",
            width: Math.max(2.5, d * 0.07),
            height: "34%",
            marginLeft: -Math.max(2.5, d * 0.07) / 2,
            background: k.mark,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
};

export const Led: React.FC<{ x: number; y: number; d?: number; color: string; on: number }> = ({
  x, y, d = 13, color, on,
}) => (
  <div
    style={{
      ...at(x, y, d),
      borderRadius: "50%",
      background: on > 0.02
        ? `radial-gradient(circle at 40% 35%, #FFFFFF, ${color} 55%)`
        : "radial-gradient(circle at 40% 35%, #F4F1EA, #CFC8BD 60%)",
      boxShadow: on > 0.02
        ? `0 0 ${d * on}px ${d * 0.35 * on}px ${color}, inset 0 0 0 1px rgba(0,0,0,0.15)`
        : "inset 0 1px 2px rgba(0,0,0,0.25)",
      opacity: 0.55 + 0.45 * Math.max(on, 0.3),
    }}
  />
);

/** A small bat toggle seen from the front. */
export const Toggle: React.FC<{ x: number; y: number; up?: boolean; s?: number }> = ({ x, y, up = true, s = 1 }) => (
  <div style={{ ...at(x, y, 30 * s, 44 * s) }}>
    <div
      style={{
        ...at(15 * s, 24 * s, 22 * s),
        borderRadius: "50%",
        background: "radial-gradient(circle at 35% 30%, #FFFFFF, #BEB7AC 60%, #8E877C)",
        boxShadow: "2px 3px 3px rgba(0,0,0,0.25)",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 11 * s,
        top: up ? 2 * s : 22 * s,
        width: 8 * s,
        height: 22 * s,
        borderRadius: 4 * s,
        background: "linear-gradient(90deg, #8D867B, #F6F3EE 45%, #A49D92)",
        boxShadow: "2px 2px 2px rgba(0,0,0,0.25)",
      }}
    />
  </div>
);

/** The little warning triangle printed by the jacks. */
export const Tri: React.FC<{ x: number; y: number; s?: number; color: string }> = ({ x, y, s = 16, color }) => (
  <svg style={{ ...at(x, y, s) }} viewBox="0 0 16 16">
    <path d="M8 2 L15 14 L1 14 Z" fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
  </svg>
);

/** A row of rail holes, `len` px long along x. */
export const Holes: React.FC<{ x: number; y: number; len: number; pitch?: number; d?: number; vertical?: boolean }> = ({
  x, y, len, pitch = 18, d = 5, vertical,
}) => (
  <div
    style={{
      position: "absolute",
      left: vertical ? x - d / 2 : x,
      top: vertical ? y : y - d / 2,
      width: vertical ? d : len,
      height: vertical ? len : d,
      backgroundImage: `radial-gradient(circle at ${d / 2}px ${d / 2}px, ${C.hole} ${d * 0.34}px, rgba(0,0,0,0.12) ${d * 0.42}px, transparent ${d * 0.5}px)`,
      backgroundSize: vertical ? `${d}px ${pitch}px` : `${pitch}px ${d}px`,
      backgroundRepeat: vertical ? "repeat-y" : "repeat-x",
      opacity: 0.85,
    }}
  />
);

export const Mono: React.FC<{
  children: React.ReactNode;
  size: number;
  color: string;
  weight?: number;
  style?: React.CSSProperties;
}> = ({ children, size, color, weight = 500, style }) => (
  <span
    style={{
      fontFamily: F_MONO,
      fontSize: size,
      fontWeight: weight,
      color,
      letterSpacing: "0.01em",
      whiteSpace: "pre",
      ...style,
    }}
  >
    {children}
  </span>
);

/** Fine film grain, a fresh offset every frame. */
export const grainUrl = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.4 -0.2'/></filter><rect width='256' height='256' filter='url(%23n)'/></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/"/g, "'").replace(/</g, "%3C").replace(/>/g, "%3E")}")`;
})();
