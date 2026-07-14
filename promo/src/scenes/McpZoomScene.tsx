import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Camera } from "../components/Camera";
import { Cursor } from "../components/Cursor";
import { SelectionFrame } from "../components/SelectionFrame";
import { Window } from "../components/Window";
import { Headline, Kicker } from "../components/text";
import { C, FONT_BODY } from "../theme";
import { CaptionPill } from "./AgentZoomScene";

/**
 * The desktop MCP server, screen-recording style: the status pill on the
 * canvas, a click that opens the connection dialog, and a zoom onto the
 * one-line Claude Code setup command. The pill and dialog are rebuilt to
 * match the app (they are desktop-only, so there is no web screenshot).
 */
const MONO = "ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace";

const WIN_W = 1240;
const BAR = 52;
const CONTENT_H = 640;
const WIN_X = 340;
const WIN_Y = 200;

// Scene-space rectangles used by the cursor, camera and selection frame.
const PILL = { x: 1410, y: 834, w: 146, h: 34 };
const CARD = { x: 512, y: 350, w: 876, h: 410 };
const CODE = { x: CARD.x + 30, y: CARD.y + 262, w: CARD.w - 60, h: 64 };

const CopyIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#7A8483" strokeWidth={2}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

/**
 * An empty artboard so the canvas reads as the editor before the dialog
 * opens. Positioned in window-content coordinates (origin at WIN_X,
 * WIN_Y + BAR) so it rides the window's entrance animation.
 */
const CanvasArtboard: React.FC = () => (
  <>
    <div
      style={{
        position: "absolute",
        left: 855 - WIN_X,
        top: 330 - (WIN_Y + BAR),
        fontFamily: FONT_BODY,
        fontSize: 13,
        color: "#8A9391",
      }}
    >
      Onboarding
    </div>
    <div
      style={{
        position: "absolute",
        left: 855 - WIN_X,
        top: 352 - (WIN_Y + BAR),
        width: 210,
        height: 398,
        background: "#FFFFFF",
        border: "1px solid #DFE2E1",
        borderRadius: 4,
        boxShadow: "0 10px 30px rgba(15,25,24,0.10)",
      }}
    />
  </>
);

/** The green-dot MCP status pill from the bottom-right of the canvas. */
const McpPill: React.FC = () => {
  const frame = useCurrentFrame();
  const pulse = 0.55 + 0.45 * Math.sin(frame * 0.28);
  return (
    <div
      style={{
        position: "absolute",
        left: PILL.x - WIN_X,
        top: PILL.y - (WIN_Y + BAR),
        width: PILL.w,
        height: PILL.h,
        borderRadius: 999,
        background: "#FFFFFF",
        border: "1px solid #DCDFDE",
        boxShadow: "0 6px 18px rgba(15,25,24,0.14)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontFamily: FONT_BODY,
        fontSize: 14,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: "#22B45B",
          boxShadow: `0 0 ${4 + pulse * 7}px rgba(34,180,91,${0.4 + pulse * 0.4})`,
        }}
      />
      <span style={{ fontWeight: 650, color: "#15201E", letterSpacing: "-0.01em" }}>MCP</span>
      <span style={{ color: "#7A8483", fontVariantNumeric: "tabular-nums" }}>:8722</span>
    </div>
  );
};

/** The MCP connection dialog, rebuilt to match the desktop app. */
const McpDialog: React.FC<{ appearAt: number }> = ({ appearAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({
    frame: frame - appearAt,
    fps,
    config: { damping: 17, stiffness: 160, mass: 0.7 },
  });
  if (frame < appearAt) return null;

  const label: React.CSSProperties = {
    fontFamily: FONT_BODY,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#8A9391",
  };

  const clients = ["Claude Code", "Claude Desktop", "VS Code", "Cursor"];

  return (
    <div
      style={{
        position: "absolute",
        left: CARD.x,
        top: CARD.y,
        width: CARD.w,
        height: CARD.h,
        borderRadius: 14,
        background: "#FFFFFF",
        border: "1px solid #E0E3E2",
        boxShadow: "0 30px 70px rgba(10,20,18,0.28)",
        padding: 30,
        boxSizing: "border-box",
        fontFamily: FONT_BODY,
        opacity: Math.min(1, pop * 1.6),
        transform: `scale(${interpolate(pop, [0, 1], [0.9, 1])})`,
        transformOrigin: "82% 118%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 24, fontWeight: 650, color: "#101815", letterSpacing: "-0.01em" }}>
          MCP server
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "#1C8A4B",
            background: "rgba(34,180,91,0.13)",
            borderRadius: 999,
            padding: "3px 11px",
          }}
        >
          Running
        </span>
      </div>
      <div style={{ marginTop: 7, fontSize: 15, color: "#68716F" }}>
        Let external AI tools drive Artboard Studio
      </div>

      <div style={{ marginTop: 24, ...label }}>Server URL</div>
      <div
        style={{
          marginTop: 7,
          height: 44,
          borderRadius: 8,
          border: "1px solid #E2E4E4",
          background: "#F6F7F7",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 12,
        }}
      >
        <code style={{ fontFamily: MONO, fontSize: 15, color: "#232B29", flex: 1 }}>
          http://127.0.0.1:8722/mcp
        </code>
        <CopyIcon />
      </div>

      <div style={{ marginTop: 22, ...label }}>Set up your client</div>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        {clients.map((c, i) => (
          <span
            key={c}
            style={{
              fontSize: 13.5,
              fontWeight: 550,
              padding: "8px 16px",
              borderRadius: 999,
              background: i === 0 ? "#15201E" : "#F1F2F2",
              color: i === 0 ? "#FFFFFF" : "#525B59",
              border: i === 0 ? "1px solid #15201E" : "1px solid #E4E6E5",
            }}
          >
            {c}
          </span>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          left: CODE.x - CARD.x,
          top: CODE.y - CARD.y,
          width: CODE.w,
          height: CODE.h,
          borderRadius: 8,
          border: "1px solid #E2E4E4",
          background: "#F6F7F7",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 12,
          boxSizing: "border-box",
        }}
      >
        <code style={{ fontFamily: MONO, fontSize: 14.5, color: "#232B29", flex: 1, whiteSpace: "nowrap" }}>
          claude mcp add --transport http artboard-studio http://127.0.0.1:8722/mcp
        </code>
        <CopyIcon />
      </div>

      <div style={{ position: "absolute", left: 30, bottom: 24, fontSize: 13.5, color: "#7A8483" }}>
        Design tools over local HTTP: artboards, elements, styling, export
      </div>
    </div>
  );
};

export const McpZoomScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const win = spring({
    frame: frame - 4,
    fps,
    config: { damping: 20, stiffness: 95, mass: 1 },
  });
  const headlineOut = interpolate(frame, [40, 54], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Camera
        keyframes={[
          { frame: 0, x: 960, y: 540, scale: 1 },
          { frame: 46, x: 960, y: 540, scale: 1 },
          { frame: 74, x: 950, y: 616, scale: 2.0 },
        ]}
      >
        <div
          style={{
            position: "absolute",
            left: WIN_X,
            top: WIN_Y,
            width: WIN_W,
            height: CONTENT_H + BAR,
            opacity: Math.min(1, win * 1.5),
            transform: `translateY(${interpolate(win, [0, 1], [70, 0])}px)`,
          }}
        >
          <Window width={WIN_W} height={CONTENT_H + BAR}>
            <div style={{ position: "absolute", inset: 0, background: "#EDEEEE" }} />
            <CanvasArtboard />
            <McpPill />
          </Window>
        </div>

        <McpDialog appearAt={34} />

        {frame >= 78 && (
          <div style={{ position: "absolute", left: CODE.x, top: CODE.y, width: CODE.w, height: CODE.h }}>
            <SelectionFrame appearAt={78} radius={8} handleSize={12} />
          </div>
        )}

        <Cursor
          path={[
            { frame: 10, x: 1660, y: 990 },
            { frame: 30, x: 1494, y: 854 },
            { frame: 52, x: 1494, y: 854 },
            { frame: 72, x: 1336, y: 641 },
          ]}
          clicks={[32, 75]}
        />
      </Camera>

      <div
        style={{
          position: "absolute",
          top: 60,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          opacity: headlineOut,
        }}
      >
        <Kicker delay={0}>MCP built in</Kicker>
        <Headline delay={3} size={54} align="center">
          Claude Code can drive it
        </Headline>
      </div>

      <CaptionPill from={76}>
        One command connects Claude Code, VS Code or Cursor
      </CaptionPill>
    </AbsoluteFill>
  );
};
