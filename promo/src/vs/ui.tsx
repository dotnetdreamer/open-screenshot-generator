import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { F_BODY, F_HEAD, F_MONO, V, clamp, outQuint, ramp, rise, rnd } from "./style";

/** True for the 1080x1920 cut. Every scene reads this instead of hard sizes. */
export const useTall = () => {
  const { width, height } = useVideoConfig();
  return height > width;
};

/** Pads the safe area: wider margins on the landscape cut. */
export const usePad = () => (useTall() ? 84 : 132);

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export const Kicker: React.FC<{
  children: React.ReactNode;
  color?: string;
  local?: number;
  delay?: number;
  size?: number;
}> = ({ children, color = V.teal, local = 999, delay = 0, size = 20 }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      fontFamily: F_BODY,
      fontWeight: 600,
      fontSize: size,
      letterSpacing: "0.24em",
      textTransform: "uppercase",
      color,
      ...rise(local, delay, 22, 16),
    }}
  >
    <span
      style={{
        width: size * 0.42,
        height: size * 0.42,
        borderRadius: 99,
        background: color,
        boxShadow: `0 0 18px ${color}`,
      }}
    />
    {children}
  </div>
);

/**
 * Display headline. Pass `accent` words as a separate node; the copy rules for
 * this project forbid dashes inside a sentence and trailing periods, so the
 * strings here are written to read cleanly without either.
 */
export const Head: React.FC<{
  children: React.ReactNode;
  size?: number;
  local?: number;
  delay?: number;
  color?: string;
  align?: "left" | "center";
  width?: number | string;
}> = ({ children, size = 88, local = 999, delay = 0, color = V.ink, align = "left", width }) => (
  <div
    style={{
      fontFamily: F_HEAD,
      fontWeight: 700,
      fontSize: size,
      lineHeight: 1.04,
      letterSpacing: "-0.028em",
      color,
      textAlign: align,
      maxWidth: width,
      textShadow: "0 6px 40px rgba(0,0,0,0.55)",
      ...rise(local, delay, 30, 40),
    }}
  >
    {children}
  </div>
);

export const Sub: React.FC<{
  children: React.ReactNode;
  size?: number;
  local?: number;
  delay?: number;
  color?: string;
  align?: "left" | "center";
  width?: number | string;
}> = ({ children, size = 30, local = 999, delay = 0, color = V.sub, align = "left", width }) => (
  <div
    style={{
      fontFamily: F_BODY,
      fontWeight: 400,
      fontSize: size,
      lineHeight: 1.45,
      color,
      textAlign: align,
      maxWidth: width,
      ...rise(local, delay, 26, 26),
    }}
  >
    {children}
  </div>
);

export const Gold: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: V.gold }}>{children}</span>
);

export const Teal: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: V.teal }}>{children}</span>
);

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** Glass card that holds a piece of real product footage. */
export const Panel: React.FC<{
  children: React.ReactNode;
  local?: number;
  delay?: number;
  radius?: number;
  glow?: string;
  style?: React.CSSProperties;
}> = ({ children, local = 999, delay = 0, radius = 22, glow = "rgba(111,179,181,0.20)", style }) => {
  const p = ramp(local, delay, 32, outQuint);
  return (
    <div
      style={{
        position: "relative",
        borderRadius: radius,
        overflow: "hidden",
        background: V.bgLift,
        border: `1px solid ${V.stroke}`,
        boxShadow: `0 40px 120px rgba(0,0,0,0.65), 0 0 90px ${glow}`,
        opacity: p,
        transform: `translateY(${(1 - p) * 26}px) scale(${0.975 + p * 0.025})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Film grain. Static pattern, animated by nudging the background position. */
export const Grain: React.FC<{ frame: number; opacity?: number }> = ({ frame, opacity = 0.055 }) => {
  const n = Math.floor(frame / 2) % 6;
  return (
    <AbsoluteFill
      style={{
        opacity,
        mixBlendMode: "overlay",
        pointerEvents: "none",
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='220' height='220' filter='url(%23n)' opacity='0.9'/></svg>\")",
        backgroundPosition: `${n * 37}px ${n * 53}px`,
      }}
    />
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.62 }) => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background: `radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 42%, rgba(0,0,0,${strength}) 100%)`,
    }}
  />
);

/** Faint engineering grid, the "before" side's paper. */
export const GridLines: React.FC<{ opacity?: number; size?: number; color?: string }> = ({
  opacity = 0.5,
  size = 64,
  color = "rgba(255,255,255,0.035)",
}) => (
  <AbsoluteFill
    style={{
      opacity,
      backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
      backgroundSize: `${size}px ${size}px`,
    }}
  />
);

/**
 * Slow warm sweep behind the "new way" beats. Two offset radial pools drifting
 * on sine paths, which keeps the backdrop alive without a WebGL pass.
 */
export const Glow: React.FC<{ frame: number; hue?: "gold" | "teal"; strength?: number }> = ({
  frame,
  hue = "teal",
  strength = 1,
}) => {
  const t = frame / 30;
  const a = hue === "gold" ? "212,175,55" : "111,179,181";
  const b = hue === "gold" ? "111,179,181" : "212,175,55";
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(46% 46% at ${34 + Math.sin(t * 0.35) * 8}% ${
            32 + Math.cos(t * 0.27) * 9
          }%, rgba(${a},${0.2 * strength}) 0%, rgba(${a},0) 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(50% 50% at ${68 + Math.cos(t * 0.31) * 7}% ${
            70 + Math.sin(t * 0.23) * 8
          }%, rgba(${b},${0.15 * strength}) 0%, rgba(${b},0) 72%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Drifting motes. Deterministic positions, so renders are reproducible. */
export const Motes: React.FC<{ frame: number; count?: number; color?: string }> = ({
  frame,
  count = 26,
  color = "rgba(212,175,55,0.5)",
}) => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => {
        const t = frame / 30;
        const x = rnd(i * 3.1) * width;
        const y = (rnd(i * 7.7) * height + t * (12 + rnd(i) * 26)) % (height + 80) - 40;
        const s = 1.4 + rnd(i * 2.3) * 3;
        const o = 0.25 + 0.55 * Math.abs(Math.sin(t * 0.6 + i));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x + Math.sin(t * 0.5 + i) * 18,
              top: y,
              width: s,
              height: s,
              borderRadius: 99,
              background: color,
              opacity: o,
              filter: "blur(0.4px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Old-way chrome
// ---------------------------------------------------------------------------

/**
 * The HUD that rides the whole "old way" act: a label top left and a pair of
 * counters top right that keep climbing across scene cuts, so the drudgery
 * reads as one continuous session rather than four separate gags.
 */
export const OldHud: React.FC<{
  frame: number;
  from: number;
  to: number;
  files: [number, number];
  hours: [number, number];
  opacity?: number;
}> = ({ frame, from, to, files, hours, opacity = 1 }) => {
  const pad = usePad();
  const tall = useTall();
  const p = clamp((frame - from) / (to - from));
  const f = Math.round(files[0] + (files[1] - files[0]) * p);
  const h = (hours[0] + (hours[1] - hours[0]) * p).toFixed(1);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <div
        style={{
          position: "absolute",
          left: pad,
          top: pad * 0.72,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: F_BODY,
          fontWeight: 600,
          fontSize: tall ? 19 : 20,
          letterSpacing: "0.26em",
          textTransform: "uppercase",
          color: V.old.sub,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 99, background: V.red }} />
        The old way
      </div>
      <div
        style={{
          position: "absolute",
          right: pad,
          top: pad * 0.72,
          display: "flex",
          gap: tall ? 26 : 38,
          fontFamily: F_MONO,
          fontSize: tall ? 19 : 20,
          color: V.old.sub,
          letterSpacing: "0.04em",
        }}
      >
        <span>
          <span style={{ color: V.old.ink }}>{f}</span> files
        </span>
        <span>
          <span style={{ color: V.old.ink }}>{h}</span> hrs
        </span>
      </div>
    </AbsoluteFill>
  );
};

/** Wraps a scene's contents in the drained "before" grade. */
export const OldGrade: React.FC<{ children: React.ReactNode; amount?: number }> = ({
  children,
  amount = 1,
}) => (
  <AbsoluteFill
    style={{
      filter: `saturate(${1 - 0.86 * amount}) contrast(${1 + 0.06 * amount}) brightness(${
        1 - 0.06 * amount
      })`,
    }}
  >
    {children}
  </AbsoluteFill>
);
