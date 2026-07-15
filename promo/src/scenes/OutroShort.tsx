import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Logo } from "../components/Logo";
import { C, FONT_BODY, FONT_DISPLAY } from "../theme";

/** Two-second closer for the short cuts: logo, wordmark, URL pill. */
export const OutroShort: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const name = spring({
    frame: frame - 14,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.8 },
  });
  const free = spring({ frame: frame - 21, fps, config: { damping: 200 } });
  const pill = spring({
    frame: frame - 27,
    fps,
    config: { damping: 11, stiffness: 130, mass: 0.7 },
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
          marginTop: -14,
        }}
      >
        <Logo size={190} startAt={10} speed={2} />
        {/* Two lines: the name on one line would overflow the 1080-wide
            portrait cut, which reuses this scene. */}
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 72,
            lineHeight: 1.04,
            letterSpacing: "-0.02em",
            textAlign: "center",
            color: C.ink,
            opacity: Math.min(1, name * 1.5),
            transform: `translateY(${interpolate(name, [0, 1], [36, 0])}px)`,
          }}
        >
          Open Screenshot
          <br />
          Generator
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 400,
            fontSize: 27,
            color: C.sub,
            opacity: free,
            transform: `translateY(${interpolate(free, [0, 1], [18, 0])}px)`,
            textShadow: "0 2px 18px rgba(6,13,13,0.9)",
          }}
        >
          Free and private by design
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 26,
            color: C.bg,
            background: `linear-gradient(120deg, ${C.teal}, ${C.tealDeep})`,
            borderRadius: 999,
            padding: "16px 38px",
            marginTop: 8,
            boxShadow: "0 18px 50px rgba(111,179,181,0.3)",
            opacity: Math.min(1, pill * 1.5),
            transform: `scale(${interpolate(pill, [0, 1], [0.55, 1])}) translateY(${interpolate(
              pill,
              [0, 1],
              [40, 0]
            )}px)`,
          }}
        >
          openscrgen.app
        </div>
      </div>
    </AbsoluteFill>
  );
};
