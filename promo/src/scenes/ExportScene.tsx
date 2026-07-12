import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Headline, Kicker, Sub } from "../components/text";
import { C, FONT_BODY, FONT_DISPLAY } from "../theme";

const FILES = [
  { name: "01_Iconic_iPhone.png", size: "1290 x 2796", store: "App Store", tint: "#6FB3B5" },
  { name: "02_Watch_More.png", size: "1080 x 1920", store: "Google Play", tint: "#D4AF37" },
  { name: "03_Awarded_iPad_13.png", size: "2064 x 2752", store: "App Store", tint: "#8FD0C2" },
];

const FileCard: React.FC<{
  file: (typeof FILES)[number];
  delay: number;
}> = ({ file, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 15, stiffness: 90, mass: 1 },
  });
  const check = spring({
    frame: frame - delay - 16,
    fps,
    config: { damping: 11, stiffness: 200, mass: 0.6 },
  });
  return (
    <div
      style={{
        width: 480,
        borderRadius: 22,
        border: `1px solid ${C.stroke}`,
        background: C.card,
        padding: 34,
        display: "flex",
        flexDirection: "column",
        gap: 22,
        opacity: Math.min(1, enter * 1.4),
        transform: `translateY(${interpolate(enter, [0, 1], [110, 0])}px)`,
        boxShadow: "0 30px 60px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 14,
            background: `${file.tint}22`,
            border: `1px solid ${file.tint}66`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 17,
            color: file.tint,
            flexShrink: 0,
          }}
        >
          PNG
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 600,
              fontSize: 24,
              color: C.ink,
              whiteSpace: "nowrap",
            }}
          >
            {file.name}
          </div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 400,
              fontSize: 20,
              color: C.sub,
              marginTop: 4,
            }}
          >
            {file.store}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 500,
            fontSize: 22,
            color: C.teal,
            background: "rgba(111,179,181,0.12)",
            border: "1px solid rgba(111,179,181,0.35)",
            borderRadius: 999,
            padding: "8px 20px",
          }}
        >
          {file.size}
        </span>
        <svg width="34" height="34" viewBox="0 0 24 24" style={{ overflow: "visible" }}>
          <circle cx="12" cy="12" r="11" fill="rgba(40,200,64,0.14)" stroke="rgba(40,200,64,0.5)" />
          <path
            d="M6.5 12.5 L10.5 16.5 L17.5 8.5"
            fill="none"
            stroke="#28C840"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={22}
            strokeDashoffset={interpolate(check, [0, 1], [22, 0])}
          />
        </svg>
      </div>
    </div>
  );
};

export const ExportScene: React.FC = () => {
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 150,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
        }}
      >
        <Kicker delay={6}>Export</Kicker>
        <Headline delay={12} size={72} align="center">
          One export, every size they ask for
        </Headline>
        <Sub delay={28} align="center" maxWidth={900}>
          Google Play or the App Store: pick your targets and every artboard
          lands as a pixel-perfect PNG
        </Sub>
      </div>

      <div
        style={{
          position: "absolute",
          top: 560,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 48,
        }}
      >
        {FILES.map((f, i) => (
          <FileCard key={f.name} file={f} delay={36 + i * 12} />
        ))}
      </div>
    </AbsoluteFill>
  );
};
