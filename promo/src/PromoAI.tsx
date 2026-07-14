import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import { Background } from "./components/Background";
import { Scene } from "./components/Scene";
import { AgentZoomScene } from "./scenes/AgentZoomScene";
import { AgentZoomSceneMobile } from "./scenes/AgentZoomSceneMobile";
import { McpZoomScene } from "./scenes/McpZoomScene";
import { McpZoomSceneMobile } from "./scenes/McpZoomSceneMobile";
import { OutroShort } from "./scenes/OutroShort";

/**
 * The 10-second AI cut: agent prompt zoom, MCP connect zoom, closer.
 * Same crossfade-over-persistent-background structure as the main cuts.
 * The portrait cut (1080x1920, for phones, Shorts and Reels) keeps the
 * timing and swaps in the portrait scene layouts; OutroShort is centered
 * and fits both canvases.
 */
export const AI_DURATION = 300;

const LANDSCAPE = [
  { from: 0, duration: 150, component: AgentZoomScene, fadeIn: false },
  { from: 140, duration: 105, component: McpZoomScene },
  { from: 235, duration: 65, component: OutroShort, fadeOut: false },
];

const PORTRAIT = [
  { from: 0, duration: 150, component: AgentZoomSceneMobile, fadeIn: false },
  { from: 140, duration: 105, component: McpZoomSceneMobile },
  { from: 235, duration: 65, component: OutroShort, fadeOut: false },
];

const PromoAIBase: React.FC<{ scenes: typeof LANDSCAPE }> = ({ scenes }) => {
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Background />
      <Audio
        src={staticFile("music.m4a")}
        volume={(f) =>
          interpolate(
            f,
            [0, 16, durationInFrames - 44, durationInFrames - 4],
            [0, 0.85, 0.85, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          )
        }
      />
      {scenes.map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.duration}>
          <Scene
            duration={s.duration}
            fadeIn={s.fadeIn ?? true}
            fadeOut={s.fadeOut ?? true}
          >
            <s.component />
          </Scene>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export const PromoAI: React.FC = () => <PromoAIBase scenes={LANDSCAPE} />;
export const PromoAIMobile: React.FC = () => <PromoAIBase scenes={PORTRAIT} />;
