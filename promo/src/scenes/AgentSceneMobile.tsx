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
import { Step, STEPS } from "./AgentScene";

/** Portrait cut of the agent scene: copy and steps on top, dialog below. */
export const AgentSceneMobile: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const win = spring({
    frame: frame - 12,
    fps,
    config: { damping: 20, stiffness: 90, mass: 1.1 },
  });

  // Content area is 2:1 to match the precropped dialog (2830x1410).
  const W = 950;
  const H = 475 + 52;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 84,
          top: 170,
          width: 912,
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
            <Step key={s} label={s} delay={40 + i * 12} />
          ))}
        </div>
        <Sub delay={96} size={24} maxWidth={880}>
          Free with the Claude, ChatGPT or Gemini account you already have,
          with built-in providers on desktop, or with your own key
        </Sub>
      </div>

      <div
        style={{
          position: "absolute",
          left: (1080 - W) / 2,
          top: 1010,
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
    </AbsoluteFill>
  );
};
