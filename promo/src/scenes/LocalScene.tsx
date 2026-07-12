import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Headline, Kicker, Sub } from "../components/text";
import { C, FONT_BODY } from "../theme";

const PLATFORMS = ["Web", "Windows", "macOS", "Linux"];

export const LocalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
          marginTop: -40,
        }}
      >
        <Kicker delay={6}>Private by design</Kicker>
        <Headline delay={12} size={84} align="center">
          {"Everything stays\non your machine"}
        </Headline>
        <Sub delay={34} align="center" size={30} maxWidth={880}>
          No account. No uploads. Your projects live in your browser and your
          exports are yours
        </Sub>

        <div style={{ display: "flex", gap: 26, marginTop: 46 }}>
          {PLATFORMS.map((p, i) => {
            const enter = spring({
              frame: frame - 52 - i * 8,
              fps,
              config: { damping: 14, stiffness: 120, mass: 0.8 },
            });
            return (
              <div
                key={p}
                style={{
                  fontFamily: FONT_BODY,
                  fontWeight: 600,
                  fontSize: 28,
                  color: C.ink,
                  padding: "18px 42px",
                  borderRadius: 999,
                  border: `1px solid ${C.stroke}`,
                  background: C.card,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  opacity: Math.min(1, enter * 1.4),
                  transform: `translateY(${interpolate(enter, [0, 1], [60, 0])}px) scale(${interpolate(
                    enter,
                    [0, 1],
                    [0.9, 1]
                  )})`,
                }}
              >
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 999,
                    background: C.teal,
                  }}
                />
                {p}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
