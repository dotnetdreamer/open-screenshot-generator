import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Aurora } from "./Aurora";
import { HookScene } from "./HookScene";
import { OutroScene } from "./OutroScene";
import { Step1Scene } from "./Step1Scene";
import { Step2Scene } from "./Step2Scene";
import { Step3Scene } from "./Step3Scene";
import { P } from "./style";

export const STEPS_DURATION = 900; // 30s @ 30fps

type SceneSpec = {
  from: number;
  duration: number;
  component: React.FC;
};

/** Beats: hook 0-75, steps at 75/330/615, outro at 790 (music risers match). */
const SCENES: SceneSpec[] = [
  { from: 0, duration: 82, component: HookScene },
  { from: 70, duration: 266, component: Step1Scene },
  { from: 328, duration: 293, component: Step2Scene },
  { from: 613, duration: 185, component: Step3Scene },
  { from: 790, duration: 110, component: OutroScene },
];

/** Crossfade + slight scale settle for each scene. */
const Shell: React.FC<{ duration: number; children: React.ReactNode }> = ({
  duration,
  children,
}) => {
  const frame = useCurrentFrame();
  const opacity =
    interpolate(frame, [0, 10], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [duration - 10, duration], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const scale = interpolate(frame, [0, 20], [1.015, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>{children}</AbsoluteFill>
  );
};

export const StepsPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: P.bg }}>
      <Audio
        src={staticFile("music-steps.m4a")}
        volume={(f) =>
          interpolate(f, [0, 24, STEPS_DURATION - 70, STEPS_DURATION], [0, 0.85, 0.85, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
      <Aurora />
      {SCENES.map(({ from, duration, component: Comp }, i) => (
        <Sequence key={i} from={from} durationInFrames={duration}>
          <Shell duration={duration}>
            <Comp />
          </Shell>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
