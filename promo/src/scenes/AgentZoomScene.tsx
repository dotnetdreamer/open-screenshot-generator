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
import { C, FONT_BODY } from "../theme";

/**
 * The AI agent, screen-recording style: the real agent dialog, a cursor that
 * clicks the prompt, a camera zoom onto it, then a pan down to the free
 * account mode. Screenshot is 2830x1410; the window shows it at 1500x747,
 * so scene coords = (210, 282) + original px * 0.53.
 */
const WIN_W = 1500;
const BAR = 52;
const IMG_H = 747;
const WIN_X = 210;
const WIN_Y = 230;

// Screenshot regions mapped to scene coordinates (origin + px * 1500/2830).
const TEXTAREA = { x: 249, y: 651, w: 1426, h: 87 };
const ACCOUNT_BTN = { x: 259, y: 835, w: 181, h: 35 };

/** Screen-fixed caption pill that stays crisp while the camera zooms. */
export const CaptionPill: React.FC<{
  children: string;
  from: number;
  until?: number;
  size?: number;
  bottom?: number;
}> = ({ children, from, until, size = 27, bottom = 52 }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [from, from + 9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut =
    until === undefined
      ? 1
      : interpolate(frame, [until - 9, until], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const o = Math.min(fadeIn, fadeOut);
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom,
        transform: `translate(-50%, ${interpolate(o, [0, 1], [16, 0])}px)`,
        opacity: o,
        background: "rgba(6,13,13,0.78)",
        border: `1px solid ${C.stroke}`,
        borderRadius: 999,
        padding: "16px 34px",
        fontFamily: FONT_BODY,
        fontWeight: 500,
        fontSize: size,
        color: C.ink,
        whiteSpace: "nowrap",
        boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
      }}
    >
      {children}
    </div>
  );
};

export const AgentZoomScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const win = spring({
    frame: frame - 6,
    fps,
    config: { damping: 20, stiffness: 95, mass: 1 },
  });

  // Headline hands the stage to the zoom.
  const headlineOut = interpolate(frame, [38, 52], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Camera
        keyframes={[
          { frame: 0, x: 960, y: 540, scale: 1 },
          { frame: 42, x: 960, y: 540, scale: 1 },
          { frame: 72, x: 962, y: 695, scale: 1.3 },
          { frame: 98, x: 962, y: 695, scale: 1.3 },
          { frame: 124, x: 430, y: 825, scale: 2.3 },
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
            <SelectionFrame appearAt={48} radius={10} handleSize={14} />
          </div>
        )}
        {frame >= 116 && (
          <div style={{ position: "absolute", ...rect(ACCOUNT_BTN) }}>
            <SelectionFrame appearAt={116} radius={10} handleSize={12} />
          </div>
        )}

        <Cursor
          path={[
            { frame: 16, x: 1560, y: 1000 },
            { frame: 44, x: 1010, y: 675 },
            { frame: 96, x: 1010, y: 675 },
            { frame: 112, x: 352, y: 848 },
          ]}
          clicks={[46, 114]}
        />
      </Camera>

      <div
        style={{
          position: "absolute",
          top: 66,
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
        <Headline delay={6} size={54} align="center">
          Say what you want
        </Headline>
      </div>

      <CaptionPill from={52} until={100}>
        It picks the template, places your screens and writes the copy
      </CaptionPill>
      <CaptionPill from={116}>
        Free with the Claude, ChatGPT or Gemini account you already have
      </CaptionPill>
    </AbsoluteFill>
  );
};

function rect(r: { x: number; y: number; w: number; h: number }) {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}
