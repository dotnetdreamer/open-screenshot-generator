import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT_BODY, FONT_DISPLAY } from "../theme";

/** Small uppercase label above a headline. */
export const Kicker: React.FC<{ children: string; delay?: number }> = ({
  children,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        fontFamily: FONT_BODY,
        fontWeight: 600,
        fontSize: 22,
        letterSpacing: "0.32em",
        color: C.gold,
        textTransform: "uppercase",
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
      }}
    >
      {children}
    </div>
  );
};

/**
 * Headline with staggered word reveal (each word slides up from a mask).
 * Use "\n" in the string for deliberate line breaks.
 */
export const Headline: React.FC<{
  children: string;
  delay?: number;
  size?: number;
  align?: "left" | "center";
  maxWidth?: number;
}> = ({ children, delay = 0, size = 76, align = "left", maxWidth }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lines = children.split("\n");
  let wordIndex = 0;
  return (
    <h1
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.08,
        color: C.ink,
        margin: 0,
        textAlign: align,
        maxWidth,
        letterSpacing: "-0.015em",
      }}
    >
      {lines.map((line, li) => {
        const lineWords = line.split(" ");
        return (
          <div key={li}>
            {lineWords.map((w, wi) => {
              const i = wordIndex++;
              const p = spring({
                frame: frame - delay - i * 3,
                fps,
                config: { damping: 18, stiffness: 130, mass: 0.8 },
              });
              return (
                <span
                  key={wi}
                  style={{
                    display: "inline-block",
                    overflow: "hidden",
                    verticalAlign: "bottom",
                    paddingBottom: "0.12em",
                    marginBottom: "-0.12em",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      transform: `translateY(${interpolate(p, [0, 1], [110, 0])}%)`,
                      opacity: Math.min(1, p * 1.6),
                    }}
                  >
                    {w}
                  </span>
                  {wi < lineWords.length - 1 ? " " : null}
                </span>
              );
            })}
          </div>
        );
      })}
    </h1>
  );
};

/** Supporting paragraph. */
export const Sub: React.FC<{
  children: React.ReactNode;
  delay?: number;
  size?: number;
  align?: "left" | "center";
  maxWidth?: number;
}> = ({ children, delay = 0, size = 28, align = "left", maxWidth = 760 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return (
    <p
      style={{
        fontFamily: FONT_BODY,
        fontWeight: 400,
        fontSize: size,
        lineHeight: 1.5,
        color: C.sub,
        margin: 0,
        textAlign: align,
        maxWidth,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [22, 0])}px)`,
        textShadow: "0 2px 16px rgba(6,13,13,0.85)",
      }}
    >
      {children}
    </p>
  );
};

/** Feature chip: gold dot + label in a soft card. */
export const Chip: React.FC<{ children: string; delay?: number; size?: number }> = ({
  children,
  delay = 0,
  size = 26,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: 16, stiffness: 120, mass: 0.9 },
  });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 16,
        padding: "16px 26px",
        borderRadius: 999,
        background: C.card,
        border: `1px solid ${C.stroke}`,
        fontFamily: FONT_BODY,
        fontWeight: 500,
        fontSize: size,
        color: C.ink,
        opacity: Math.min(1, p * 1.4),
        transform: `translateX(${interpolate(p, [0, 1], [-36, 0])}px)`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: C.gold,
          flexShrink: 0,
        }}
      />
      {children}
    </div>
  );
};
