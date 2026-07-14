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
import { Camera } from "../components/Camera";
import { Cursor } from "../components/Cursor";
import { SelectionFrame } from "../components/SelectionFrame";
import { Window } from "../components/Window";
import { Headline, Kicker } from "../components/text";
import { CaptionPill } from "./AgentZoomScene";

/**
 * Portrait (1080x1920) layout of the agent scene: copy on top, window in
 * the middle, captions above the Shorts UI overlay. The wide dialog cannot
 * fit a phone frame at 1x, so the camera zooms deeper than the landscape
 * cut. Screenshot is 2830x1410 shown at 1000x498, so scene coords =
 * (40, 692) + original px * 0.3534.
 */
const WIN_W = 1000;
const BAR = 52;
const IMG_H = 498;
const WIN_X = 40;
const WIN_Y = 640;

// Screenshot regions mapped to scene coordinates (origin + px * 1000/2830).
const TEXTAREA = { x: 66, y: 938, w: 951, h: 58 };
const ACCOUNT_BTN = { x: 73, y: 1061, w: 120, h: 23 };

export const AgentZoomSceneMobile: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const win = spring({
    frame: frame - 6,
    fps,
    config: { damping: 20, stiffness: 95, mass: 1 },
  });

  const headlineOut = interpolate(frame, [38, 52], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Camera
        keyframes={[
          { frame: 0, x: 540, y: 960, scale: 1 },
          { frame: 42, x: 540, y: 960, scale: 1 },
          { frame: 72, x: 330, y: 965, scale: 2 },
          { frame: 98, x: 330, y: 965, scale: 2 },
          { frame: 124, x: 185, y: 1075, scale: 3 },
        ]}
      >
        <div
          style={{
            position: "absolute",
            left: WIN_X,
            top: WIN_Y,
            width: WIN_W,
            height: IMG_H + BAR,
            opacity: Math.min(1, win * 1.5),
            transform: `translateY(${interpolate(win, [0, 1], [70, 0])}px)`,
          }}
        >
          <Window width={WIN_W} height={IMG_H + BAR}>
            <Img
              src={staticFile("shots/agent-dialog.png")}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Window>
        </div>

        {frame >= 48 && (
          <div style={{ position: "absolute", ...rect(TEXTAREA) }}>
            <SelectionFrame appearAt={48} radius={8} handleSize={12} />
          </div>
        )}
        {frame >= 116 && (
          <div style={{ position: "absolute", ...rect(ACCOUNT_BTN) }}>
            <SelectionFrame appearAt={116} radius={6} handleSize={9} />
          </div>
        )}

        <Cursor
          path={[
            { frame: 16, x: 900, y: 1760 },
            { frame: 44, x: 585, y: 950 },
            { frame: 96, x: 585, y: 950 },
            { frame: 112, x: 133, y: 1072 },
          ]}
          clicks={[46, 114]}
          size={28}
        />
      </Camera>

      <div
        style={{
          position: "absolute",
          top: 170,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          opacity: headlineOut,
        }}
      >
        <Kicker delay={2}>The AI agent</Kicker>
        <Headline delay={6} size={62} align="center">
          Say what you want
        </Headline>
      </div>

      <CaptionPill from={52} until={100} size={22} bottom={270}>
        It picks the template, places your screens and writes the copy
      </CaptionPill>
      <CaptionPill from={116} size={22} bottom={270}>
        Free with the Claude, ChatGPT or Gemini account you already have
      </CaptionPill>
    </AbsoluteFill>
  );
};

function rect(r: { x: number; y: number; w: number; h: number }) {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}
