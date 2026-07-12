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
import { Intro } from "./scenes/Intro";
import { EditorScene } from "./scenes/EditorScene";
import { DevicesScene } from "./scenes/DevicesScene";
import { TemplatesScene } from "./scenes/TemplatesScene";
import { AgentScene } from "./scenes/AgentScene";
import { ExportScene } from "./scenes/ExportScene";
import { LocalScene } from "./scenes/LocalScene";
import { Outro } from "./scenes/Outro";

type SceneSpec = {
  from: number;
  duration: number;
  component: React.FC;
  fadeIn?: boolean;
  fadeOut?: boolean;
};

/**
 * Timelines (30 fps): scenes overlap by 10-15 frames and crossfade over the
 * persistent background. The fast cut keeps every scene but tightens each
 * slot; internal animation delays all land within the shorter windows.
 */
const FULL: SceneSpec[] = [
  { from: 0, duration: 135, component: Intro, fadeIn: false },
  { from: 120, duration: 225, component: EditorScene },
  { from: 330, duration: 225, component: DevicesScene },
  { from: 540, duration: 225, component: TemplatesScene },
  { from: 750, duration: 255, component: AgentScene },
  { from: 990, duration: 195, component: ExportScene },
  { from: 1170, duration: 195, component: LocalScene },
  { from: 1350, duration: 210, component: Outro, fadeOut: false },
];

const FAST: SceneSpec[] = [
  { from: 0, duration: 105, component: Intro, fadeIn: false },
  { from: 95, duration: 150, component: EditorScene },
  { from: 235, duration: 150, component: DevicesScene },
  { from: 375, duration: 150, component: TemplatesScene },
  { from: 515, duration: 165, component: AgentScene },
  { from: 670, duration: 135, component: ExportScene },
  { from: 795, duration: 135, component: LocalScene },
  { from: 920, duration: 160, component: Outro, fadeOut: false },
];

export const TOTAL_DURATION = 1560;
export const FAST_DURATION = 1080;

const PromoBase: React.FC<{ scenes: SceneSpec[] }> = ({ scenes }) => {
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Background />
      <Audio
        src={staticFile("music.m4a")}
        volume={(f) =>
          interpolate(
            f,
            [0, 30, durationInFrames - 70, durationInFrames - 5],
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

export const Promo: React.FC = () => <PromoBase scenes={FULL} />;
export const PromoFast: React.FC = () => <PromoBase scenes={FAST} />;
