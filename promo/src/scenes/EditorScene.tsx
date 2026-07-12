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
import { Chip, Headline, Kicker } from "../components/text";
import { SelectionFrame } from "../components/SelectionFrame";
import { Window } from "../components/Window";

export const EditorScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const win = spring({
    frame: frame - 10,
    fps,
    config: { damping: 20, stiffness: 90, mass: 1.1 },
  });
  const kenBurns = interpolate(frame, [20, 220], [1, 1.09], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const panY = interpolate(frame, [20, 220], [0, -26], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const W = 1080;
  const H = 660;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 200,
          display: "flex",
          flexDirection: "column",
          gap: 34,
          width: 620,
        }}
      >
        <Kicker delay={6}>The editor</Kicker>
        <Headline delay={12} size={62}>
          {"Nudge every pixel\ninto place"}
        </Headline>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 18,
            marginTop: 10,
          }}
        >
          <Chip delay={40}>All your artboards on one canvas</Chip>
          <Chip delay={50}>Layers, properties, undo everywhere</Chip>
          <Chip delay={60}>Tilt and spin devices in 3D</Chip>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 64,
          top: 206,
          width: W,
          height: H,
          opacity: Math.min(1, win * 1.5),
          transform: `perspective(1600px) translateY(${interpolate(
            win,
            [0, 1],
            [90, 0]
          )}px) rotateY(-4deg) rotateX(1.5deg) scale(${interpolate(
            win,
            [0, 1],
            [0.94, 1]
          )})`,
          transformStyle: "preserve-3d",
        }}
      >
        <Window width={W} height={H}>
          <Img
            src={staticFile("shots/editor-cinevault.png")}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center top",
              transform: `scale(${kenBurns}) translateY(${panY}px)`,
              transformOrigin: "42% 30%",
            }}
          />
        </Window>
        <SelectionFrame appearAt={26} radius={18} />
      </div>
    </AbsoluteFill>
  );
};
