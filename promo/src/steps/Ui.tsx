import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { F_BODY, F_DISPLAY, P } from "./style";

/** Small caps pill kicker. */
export const Kick: React.FC<{ text: string; from?: number; accent: string }> = ({
  text,
  from = 0,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spr = spring({ frame: frame - from, fps, config: { damping: 14, mass: 0.6 } });
  if (frame < from) return null;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 26px",
        borderRadius: 999,
        border: `1.5px solid ${accent}55`,
        background: P.glass,
        transform: `scale(${0.7 + 0.3 * spr})`,
        opacity: spr,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: accent,
          boxShadow: `0 0 12px ${accent}`,
        }}
      />
      <span
        style={{
          fontFamily: F_BODY,
          fontWeight: 700,
          fontSize: 24,
          letterSpacing: 5,
          color: P.ink,
          textTransform: "uppercase",
        }}
      >
        {text}
      </span>
    </div>
  );
};

/** Headline with per-word slide + blur reveal. */
export const Title: React.FC<{
  lines: string[];
  from?: number;
  size?: number;
  align?: "center" | "left";
  accentWord?: string;
  accent?: string;
}> = ({ lines, from = 0, size = 68, align = "center", accentWord, accent }) => {
  const frame = useCurrentFrame();
  let wordIndex = -1;
  return (
    <div style={{ textAlign: align }}>
      {lines.map((line, li) => (
        <div key={li} style={{ overflow: "hidden", padding: "0.08em 0" }}>
          {line.split(" ").map((word, wi) => {
            wordIndex += 1;
            const start = from + wordIndex * 3.5;
            const t = interpolate(frame, [start, start + 17], [0, 1], {
              easing: Easing.out(Easing.cubic),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const isAccent = accentWord !== undefined && word === accentWord;
            return (
              <span
                key={wi}
                style={{
                  display: "inline-block",
                  fontFamily: F_DISPLAY,
                  fontWeight: 800,
                  fontSize: size,
                  lineHeight: 1.08,
                  letterSpacing: -1.5,
                  color: isAccent ? "transparent" : P.ink,
                  backgroundImage: isAccent
                    ? `linear-gradient(100deg, ${accent} 0%, #FFFFFF 130%)`
                    : undefined,
                  WebkitBackgroundClip: isAccent ? "text" : undefined,
                  backgroundClip: isAccent ? "text" : undefined,
                  transform: `translateY(${(1 - t) * 115}%) skewY(${(1 - t) * 5}deg)`,
                  filter: `blur(${(1 - t) * 7}px)`,
                  opacity: Math.min(1, t * 1.6),
                  marginRight: "0.26em",
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export const Sub: React.FC<{ text: string; from?: number; size?: number }> = ({
  text,
  from = 0,
  size = 30,
}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [from, from + 16], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        fontFamily: F_BODY,
        fontWeight: 600,
        fontSize: size,
        color: P.sub,
        opacity: t,
        transform: `translateY(${(1 - t) * 22}px)`,
      }}
    >
      {text}
    </div>
  );
};

/** Big glass step number badge with label, springs in with a tilt settle. */
export const StepTag: React.FC<{ n: number; label: string; accent: string; from?: number }> = ({
  n,
  label,
  accent,
  from = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from) return null;
  const spr = spring({ frame: frame - from, fps, config: { damping: 11, mass: 0.7 } });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 22,
        transform: `scale(${0.5 + 0.5 * spr}) rotate(${(1 - spr) * -7}deg)`,
        opacity: Math.min(1, spr * 1.5),
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 28,
          background: `linear-gradient(150deg, ${accent}2E 0%, rgba(255,255,255,0.05) 100%)`,
          border: `2px solid ${accent}88`,
          boxShadow: `0 0 44px ${accent}44, inset 0 1px 0 rgba(255,255,255,0.25)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: F_DISPLAY,
            fontWeight: 800,
            fontSize: 52,
            color: "transparent",
            backgroundImage: `linear-gradient(160deg, #FFFFFF 10%, ${accent} 120%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
          }}
        >
          {n}
        </span>
      </div>
      <div style={{ textAlign: "left" }}>
        <div
          style={{
            fontFamily: F_BODY,
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: 4.5,
            color: accent,
            textTransform: "uppercase",
          }}
        >
          Step {n} of 3
        </div>
        <div
          style={{
            fontFamily: F_DISPLAY,
            fontWeight: 700,
            fontSize: 40,
            color: P.ink,
            letterSpacing: -0.5,
            marginTop: 4,
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
};

export const Chip: React.FC<{ text: string; from?: number; accent?: string }> = ({
  text,
  from = 0,
  accent = P.step2,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from) return null;
  const spr = spring({ frame: frame - from, fps, config: { damping: 12, mass: 0.6 } });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "13px 26px",
        borderRadius: 999,
        background: "rgba(8,12,26,0.72)",
        border: `1.5px solid ${accent}66`,
        boxShadow: `0 8px 30px rgba(0,0,0,0.4), 0 0 22px ${accent}22`,
        transform: `scale(${0.6 + 0.4 * spr}) translateY(${(1 - spr) * 18}px)`,
        opacity: Math.min(1, spr * 1.4),
        fontFamily: F_BODY,
        fontWeight: 700,
        fontSize: 25,
        color: P.ink,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: accent,
          boxShadow: `0 0 10px ${accent}`,
        }}
      />
      {text}
    </div>
  );
};

/** Dark glass panel behind screen-fixed copy so it reads over any zoom. */
export const CopyPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 18,
      padding: "30px 46px 26px",
      borderRadius: 36,
      background: "rgba(5,8,18,0.78)",
      border: "1px solid rgba(255,255,255,0.12)",
      boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
    }}
  >
    {children}
  </div>
);

/** Fullscreen accent flash with fast exponential decay. */
export const Flash: React.FC<{ at: number; color?: string }> = ({ at, color = "#FFFFFF" }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const o = 0.85 * Math.exp(-(frame - at) / 4);
  if (o < 0.01) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle at 50% 46%, ${color} 0%, transparent 62%)`,
        opacity: o,
        pointerEvents: "none",
      }}
    />
  );
};

/** Diagonal light streak that whips across on transitions. */
export const Streak: React.FC<{ at: number; accent: string }> = ({ at, accent }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (frame < at || frame > at + 18) return null;
  const t = interpolate(frame, [at, at + 16], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: -width,
        top: 0,
        width: width * 3,
        height,
        transform: `translateX(${(t * 2 - 0.5) * width * 1.6}px) rotate(-16deg)`,
        background: `linear-gradient(90deg, transparent 30%, ${accent}44 46%, rgba(255,255,255,0.75) 50%, ${accent}44 54%, transparent 70%)`,
        opacity: Math.sin(t * Math.PI),
        pointerEvents: "none",
        mixBlendMode: "screen",
      }}
    />
  );
};
