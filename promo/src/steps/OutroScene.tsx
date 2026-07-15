import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { F_BODY, P } from "./style";
import { Chip, Sub, Title } from "./Ui";

/** Logo in a glass tile with a slowly turning conic accent ring. */
const LogoTile: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from) return null;
  const spr = spring({ frame: frame - from, fps, config: { damping: 12, mass: 0.8 } });
  const angle = frame * 1.6;
  return (
    <div
      style={{
        position: "relative",
        width: 196,
        height: 196,
        transform: `scale(${0.5 + 0.5 * spr}) rotate(${(1 - spr) * -10}deg)`,
        opacity: Math.min(1, spr * 1.4),
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 56,
          background: `conic-gradient(from ${angle}deg, transparent 0%, ${P.step1} 18%, ${P.step2} 38%, transparent 55%, ${P.step3} 78%, transparent 100%)`,
          filter: "blur(1.5px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 5,
          borderRadius: 52,
          background: "#0A0E1D",
          border: "1px solid rgba(255,255,255,0.14)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 30px 80px rgba(0,0,0,0.5), 0 0 70px ${P.step1}33`,
        }}
      >
        <Img src={staticFile("logo.svg")} style={{ width: 104, height: 104 }} />
      </div>
    </div>
  );
};

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const urlSpr = spring({ frame: frame - 36, fps, config: { damping: 13, mass: 0.7 } });

  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: 470,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 44,
        }}
      >
        <LogoTile from={4} />
        {/* Two lines: the name on one line would overflow the 1080-wide canvas. */}
        <Title lines={["Open Screenshot", "Generator"]} from={12} size={86} />
        <Sub text="App Store and Play Store screenshots in minutes" from={24} size={32} />

        {frame >= 36 && (
          <div
            style={{
              padding: "20px 42px",
              borderRadius: 999,
              background: "rgba(8,12,26,0.8)",
              border: `1.5px solid ${P.step2}77`,
              boxShadow: `0 14px 44px rgba(0,0,0,0.45), 0 0 34px ${P.step2}2A`,
              fontFamily: F_BODY,
              fontWeight: 700,
              fontSize: 30,
              color: P.ink,
              transform: `scale(${0.7 + 0.3 * urlSpr}) translateY(${(1 - urlSpr) * 24}px)`,
              opacity: Math.min(1, urlSpr * 1.4),
            }}
          >
            openscrgen.app
          </div>
        )}

        <div style={{ display: "flex", gap: 18 }}>
          <Chip text="Free" from={48} accent={P.step3} />
          <Chip text="No sign up" from={54} accent={P.step2} />
          <Chip text="Runs in your browser" from={60} accent={P.step1} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
