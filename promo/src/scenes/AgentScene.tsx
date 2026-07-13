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
import { Headline, Kicker, Sub } from "../components/text";
import { SelectionFrame } from "../components/SelectionFrame";
import { Window } from "../components/Window";
import { C, FONT_BODY } from "../theme";

export const STEPS = [
  "Reads your screenshots",
  "Picks the right template",
  "Places every screen in a frame",
  "Rewrites the copy for your app",
];

export const Step: React.FC<{ label: string; delay: number }> = ({ label, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.9 },
  });
  const check = spring({
    frame: frame - delay - 10,
    fps,
    config: { damping: 12, stiffness: 190, mass: 0.6 },
  });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        opacity: Math.min(1, enter * 1.4),
        transform: `translateX(${interpolate(enter, [0, 1], [40, 0])}px)`,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "rgba(111,179,181,0.14)",
          border: `1px solid rgba(111,179,181,0.4)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ overflow: "visible" }}>
          <path
            d="M4 12.5 L9.5 18 L20 6.5"
            fill="none"
            stroke={C.teal}
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={30}
            strokeDashoffset={interpolate(check, [0, 1], [30, 0])}
          />
        </svg>
      </div>
      <span
        style={{
          fontFamily: FONT_BODY,
          fontWeight: 500,
          fontSize: 30,
          color: C.ink,
        }}
      >
        {label}
      </span>
    </div>
  );
};

export const AgentScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const win = spring({
    frame: frame - 12,
    fps,
    config: { damping: 20, stiffness: 90, mass: 1.1 },
  });

  // Content area is 2:1 to match the precropped dialog (2830x1410).
  const W = 1060;
  const H = 530 + 52;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 84,
          top: 236,
          width: W,
          height: H,
          opacity: Math.min(1, win * 1.5),
          transform: `perspective(1600px) translateY(${interpolate(
            win,
            [0, 1],
            [90, 0]
          )}px) rotateY(4deg) rotateX(1.5deg) scale(${interpolate(win, [0, 1], [0.94, 1])})`,
        }}
      >
        <Window width={W} height={H} title="Artboard Studio">
          <Img
            src={staticFile("shots/agent-dialog.png")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Window>
        <SelectionFrame appearAt={30} radius={18} />
      </div>

      <div
        style={{
          position: "absolute",
          right: 90,
          top: 210,
          width: 600,
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        <Kicker delay={6}>The AI agent</Kicker>
        <Headline delay={12} size={66}>
          {"Or just say\nwhat you want"}
        </Headline>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            marginTop: 8,
          }}
        >
          {STEPS.map((s, i) => (
            <Step key={s} label={s} delay={44 + i * 14} />
          ))}
        </div>
        <Sub delay={110} size={24} maxWidth={600}>
          Free with the Claude, ChatGPT or Gemini account you already have,
          with built-in providers on desktop, or with your own key
        </Sub>
      </div>
    </AbsoluteFill>
  );
};
