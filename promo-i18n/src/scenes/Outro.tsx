import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Chip, Sub, Title } from "../components/Ui";
import { F_BODY, P } from "../style";

/**
 * Where to get it. Same wordmark, tagline and address as the other cuts, so
 * the three videos end on one card rather than three.
 */
export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const urlT = interpolate(frame, [34, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <Title lines={["Open Screenshot", "Generator"]} from={8} size={88} />
        <Sub text="App Store and Play Store screenshots, in every language you ship" from={22} size={30} />

        <div
          style={{
            marginTop: 16,
            padding: "16px 44px",
            borderRadius: 999,
            border: `2px solid ${P.add}77`,
            background: "rgba(10,14,30,0.7)",
            boxShadow: `0 0 44px ${P.add}33`,
            opacity: urlT,
            transform: `scale(${0.9 + 0.1 * urlT})`,
            fontFamily: F_BODY,
            fontWeight: 700,
            fontSize: 40,
            letterSpacing: 1,
            color: P.ink,
          }}
        >
          openscrgen.app
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 18 }}>
          <Chip text="Free and open source" from={56} accent={P.write} size={22} />
          <Chip text="No sign up" from={62} accent={P.read} size={22} />
          <Chip text="Runs in your browser" from={68} accent={P.add} size={22} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
