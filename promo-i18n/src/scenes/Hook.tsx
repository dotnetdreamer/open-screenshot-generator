import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Kick, Streak, Sub, Title } from "../components/Ui";
import { F_BODY, F_DISPLAY, P } from "../style";

/** The three languages the demo adds, in the order it adds them. */
const PILLS = [
  { code: "de-DE", name: "Deutsch" },
  { code: "ja", name: "日本語" },
  { code: "es-ES", name: "Español" },
];

/**
 * Four seconds to say what the feature is: one project, more than one
 * language. The pills are the switcher's own rows, blown up to poster size,
 * so the shape a viewer meets here is the shape they meet again on frame 560.
 */
export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
        <Kick text="Open Screenshot Generator" from={4} accent={P.add} />
        <Title
          lines={["One project", "Every language"]}
          from={12}
          size={92}
          accentWord="language"
          accent={P.add}
        />
        <Sub text="Store screenshots that ship in every language you sell in" from={40} size={30} />

        <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
          {PILLS.map((pill, i) => {
            const at = 58 + i * 7;
            if (frame < at) return null;
            const spr = spring({ frame: frame - at, fps, config: { damping: 13, mass: 0.6 } });
            return (
              <div
                key={pill.code}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 26px",
                  borderRadius: 18,
                  background: "rgba(10,14,30,0.8)",
                  border: `1.5px solid ${P.add}55`,
                  boxShadow: `0 14px 40px rgba(0,0,0,0.45), 0 0 26px ${P.add}22`,
                  transform: `translateY(${(1 - spr) * 26}px) scale(${0.86 + 0.14 * spr})`,
                  opacity: Math.min(1, spr * 1.4),
                }}
              >
                <span style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 30, color: P.ink }}>
                  {pill.name}
                </span>
                <span style={{ fontFamily: F_BODY, fontWeight: 600, fontSize: 20, color: P.sub }}>
                  {pill.code}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Leaves on the same whip the next act arrives on. */}
      <AbsoluteFill
        style={{
          opacity: interpolate(frame, [92, 108], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          background: "rgba(4,6,14,0.9)",
        }}
      />
      <Streak at={90} accent={P.add} />
    </AbsoluteFill>
  );
};
