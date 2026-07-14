import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { F_BODY, F_DISPLAY, P } from "./style";
import { Kick, Title } from "./Ui";

const MiniStep: React.FC<{ n: number; word: string; accent: string; from: number }> = ({
  n,
  word,
  accent,
  from,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from) return null;
  const spr = spring({ frame: frame - from, fps, config: { damping: 10, mass: 0.6 } });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        transform: `scale(${0.4 + 0.6 * spr}) translateY(${(1 - spr) * 40}px)`,
        opacity: Math.min(1, spr * 1.5),
      }}
    >
      <div
        style={{
          width: 108,
          height: 108,
          borderRadius: 32,
          background: `linear-gradient(150deg, ${accent}30 0%, rgba(255,255,255,0.05) 100%)`,
          border: `2px solid ${accent}99`,
          boxShadow: `0 0 50px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.3)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: F_DISPLAY,
          fontWeight: 800,
          fontSize: 56,
          color: P.ink,
        }}
      >
        {n}
      </div>
      <div
        style={{
          fontFamily: F_BODY,
          fontWeight: 700,
          fontSize: 26,
          letterSpacing: 2,
          color: P.sub,
          textTransform: "uppercase",
        }}
      >
        {word}
      </div>
    </div>
  );
};

export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const ghostScale = interpolate(frame, [0, 80], [1.02, 1.2], {
    easing: Easing.out(Easing.quad),
  });
  const drift = interpolate(frame, [0, 80], [1, 1.035]);
  const lineGrow = interpolate(frame, [50, 72], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ transform: `scale(${drift})` }}>
      {/* Ghost numeral */}
      <div
        style={{
          position: "absolute",
          top: 380,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: F_DISPLAY,
          fontWeight: 800,
          fontSize: 1050,
          lineHeight: 1,
          color: "transparent",
          WebkitTextStroke: "2px rgba(255,255,255,0.13)",
          transform: `scale(${ghostScale})`,
          opacity: 0.8,
        }}
      >
        3
      </div>

      <div
        style={{
          position: "absolute",
          top: 400,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 44,
        }}
      >
        <Kick text="App Store and Play Store" from={6} accent={P.hot} />
        <Title
          lines={["Store ready", "screenshots", "in 3 steps"]}
          from={14}
          size={112}
          accentWord="3"
          accent={P.step2}
        />
      </div>

      {/* Connecting line, painted under the badges */}
      <div
        style={{
          position: "absolute",
          top: 1302,
          left: 540 - 260 * lineGrow,
          width: 520 * lineGrow,
          height: 3,
          borderRadius: 2,
          background: `linear-gradient(90deg, ${P.step1}, ${P.step2}, ${P.step3})`,
          opacity: 0.4,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 1250,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 70,
        }}
      >
        <MiniStep n={1} word="Template" accent={P.step1} from={44} />
        <MiniStep n={2} word="Screenshot" accent={P.step2} from={51} />
        <MiniStep n={3} word="Preview" accent={P.step3} from={58} />
      </div>
    </AbsoluteFill>
  );
};
