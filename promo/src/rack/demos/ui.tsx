import React from "react";
import { F_MONO, F_SANS, clamp, outCubic, seat } from "../style";

/**
 * Shared pieces for the little screens. A screen is 548 x 184 px; every demo
 * is a pure function of `f`, the frames since its module was patched.
 */

export const SW = 548;
export const SH = 184;

export const UI = {
  text: "#F2EEE7",
  sub: "rgba(242,238,231,0.62)",
  dim: "rgba(242,238,231,0.34)",
  line: "rgba(255,255,255,0.09)",
  panel: "#1E1D1B",
  panel2: "#262422",
  green: "#86D9A0",
  coral: "#EC7352",
  gold: "#E5C24E",
  teal: "#86CFC6",
  lilac: "#C2A7E9",
  blue: "#8DB8F2",
  // Juniper, the made-up app from the feature reel
  forest: "#2D6A4F",
  forest2: "#1F4E3A",
  mint: "#DDEDE2",
  berry: "#4C55C9",
  berry2: "#7A80E6",
  cream: "#F6F2E9",
};

/** 0 to 1 from frame `a` over `len` frames. */
export const p = (f: number, a: number, len: number, ease: (t: number) => number = outCubic) => ease(clamp((f - a) / len));
export const pop = (f: number, a: number, len = 12) => seat(clamp((f - a) / len));

export const Abs: React.FC<{
  x: number;
  y: number;
  w?: number;
  h?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ x, y, w, h, style, children }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, ...style }}>{children}</div>
);

/** The small caps label in a screen's top left corner (and optional right one). */
export const Label: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <>
    <div
      style={{
        position: "absolute",
        left: 14,
        top: 10,
        fontFamily: F_MONO,
        fontSize: 11,
        letterSpacing: "0.08em",
        color: UI.sub,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
    {right ? (
      <div
        style={{
          position: "absolute",
          right: 14,
          top: 10,
          fontFamily: F_MONO,
          fontSize: 11,
          letterSpacing: "0.06em",
          color: UI.dim,
          whiteSpace: "nowrap",
        }}
      >
        {right}
      </div>
    ) : null}
  </>
);

export const Txt: React.FC<{
  size?: number;
  weight?: number;
  color?: string;
  mono?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ size = 14, weight = 500, color = UI.text, mono, style, children }) => (
  <span
    style={{
      fontFamily: mono ? F_MONO : F_SANS,
      fontSize: size,
      fontWeight: weight,
      color,
      letterSpacing: mono ? "0.01em" : "-0.01em",
      whiteSpace: "nowrap",
      lineHeight: 1.15,
      ...style,
    }}
  >
    {children}
  </span>
);

export const Check: React.FC<{ s?: number; on?: number; color?: string }> = ({ s = 16, on = 1, color = UI.green }) => (
  <svg width={s} height={s} viewBox="0 0 16 16" style={{ flexShrink: 0, opacity: on, transform: `scale(${0.6 + 0.4 * on})` }}>
    <circle cx={8} cy={8} r={7.2} fill={color} opacity={0.18} />
    <path d="M4.6 8.3 L7 10.6 L11.6 5.6" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Chip: React.FC<{
  children: React.ReactNode;
  color?: string;
  bg?: string;
  size?: number;
  style?: React.CSSProperties;
}> = ({ children, color = UI.text, bg = "rgba(255,255,255,0.08)", size = 12, style }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "4px 9px",
      borderRadius: 999,
      background: bg,
      color,
      fontFamily: F_SANS,
      fontSize: size,
      fontWeight: 600,
      whiteSpace: "nowrap",
      lineHeight: 1,
      ...style,
    }}
  >
    {children}
  </span>
);

export const Bar: React.FC<{ v: number; w: number; h?: number; color?: string; track?: string }> = ({
  v, w, h = 6, color = UI.green, track = "rgba(255,255,255,0.08)",
}) => (
  <div style={{ width: w, height: h, borderRadius: h / 2, background: track, overflow: "hidden", flexShrink: 0 }}>
    <div style={{ width: `${clamp(v) * 100}%`, height: "100%", borderRadius: h / 2, background: color }} />
  </div>
);

export const Stars: React.FC<{ n: number; s?: number; color?: string }> = ({ n, s = 12, color = UI.gold }) => (
  <span style={{ display: "inline-flex", gap: 1 }}>
    {Array.from({ length: 5 }, (_, i) => (
      <svg key={i} width={s} height={s} viewBox="0 0 24 24">
        <path
          d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.2 1.3-6.6-4.9-4.6 6.6-.8z"
          fill={i < n ? color : "rgba(255,255,255,0.16)"}
        />
      </svg>
    ))}
  </span>
);

/** Juniper's icon: a sprig with berries on forest green, in a given look. */
export const JuniperIcon: React.FC<{ s: number; look?: "light" | "dark" | "tinted"; round?: boolean }> = ({
  s, look = "light", round,
}) => {
  const bg =
    look === "dark"
      ? "linear-gradient(160deg, #1C2420, #0F1411)"
      : look === "tinted"
        ? "linear-gradient(160deg, #3A3F45, #24282C)"
        : `linear-gradient(160deg, ${UI.forest}, ${UI.forest2})`;
  const leaf = look === "dark" ? "#6FC193" : look === "tinted" ? "#C9D3DE" : "#E9F4EC";
  const berry = look === "tinted" ? "#9FB0C2" : look === "dark" ? UI.berry2 : "#A9AEF5";
  return (
    <div
      style={{
        width: s,
        height: s,
        borderRadius: round ? "50%" : s * 0.225,
        background: bg,
        position: "relative",
        boxShadow: "0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <svg viewBox="0 0 100 100" width={s} height={s} style={{ position: "absolute", inset: 0 }}>
        <path d="M30 78 C 42 60, 52 46, 70 26" stroke={leaf} strokeWidth={6} strokeLinecap="round" fill="none" />
        <path d="M44 58 C 34 52, 30 44, 31 36 C 40 38, 46 46, 44 58 Z" fill={leaf} />
        <path d="M56 44 C 58 34, 64 28, 72 26 C 71 35, 65 42, 56 44 Z" fill={leaf} />
        <circle cx={58} cy={64} r={8.5} fill={berry} />
        <circle cx={70} cy={56} r={7} fill={berry} opacity={0.9} />
        <circle cx={66} cy={70} r={6} fill={berry} opacity={0.8} />
      </svg>
    </div>
  );
};

/** A phone outline with whatever is inside. */
export const Phone: React.FC<{ w: number; h: number; children?: React.ReactNode; color?: string }> = ({
  w, h, children, color = "rgba(255,255,255,0.75)",
}) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: w * 0.18,
      border: `${Math.max(1.5, w * 0.045)}px solid ${color}`,
      position: "relative",
      overflow: "hidden",
      flexShrink: 0,
    }}
  >
    {children}
  </div>
);

export const typedText = (text: string, f: number, perChar = 1.2) => text.slice(0, clamp(Math.floor(f / perChar), 0, text.length));

/** A blinking caret for typed text. */
export const Caret: React.FC<{ f: number; h?: number; color?: string }> = ({ f, h = 14, color = UI.coral }) => (
  <span
    style={{
      display: "inline-block",
      width: 2,
      height: h,
      marginLeft: 1,
      background: color,
      verticalAlign: "middle",
      opacity: Math.floor(f / 14) % 2 === 0 ? 1 : 0,
    }}
  />
);
