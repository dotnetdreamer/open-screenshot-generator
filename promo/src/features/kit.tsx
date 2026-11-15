import React from "react";
import { AbsoluteFill } from "remotion";
import { RECTS } from "./rects.generated";
import { type Beat } from "./style";
import { AppWindow, BeatCopy, CAP_H, CAP_W, PAD, type CamKey, type Hue, type Rect } from "./ui";

/**
 * A control's rect in a capture, by name (scripts/gather-rects.js), or the
 * fallback while a capture has not been made yet. Every camera, ring and
 * cursor position in the film goes through here, so a re-capture that moves a
 * button moves everything that points at it.
 */
export function R(capture: string, name: string, fallback: Rect = { x: CAP_W * 0.3, y: CAP_H * 0.3, w: CAP_W * 0.4, h: CAP_H * 0.4 }): Rect {
  return RECTS[capture.replace(/^features2\//, "")]?.[name] ?? fallback;
}

/** True when a capture's rects exist, so a beat can tell real footage from a stand-in. */
export const has = (capture: string) => Boolean(RECTS[capture.replace(/^features2\//, "")]);

/** Centre of a rect, for the cursor. */
export const mid = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Where the window sits in a product beat: the right of the frame, copy on the left. */
export const WIN = { x: 748, width: 1072 };
export const winHeight = (width = WIN.width) => Math.round((width * CAP_H) / CAP_W) + 34;

/**
 * The layout most product beats share: the copy column on the left, a window of
 * real footage on the right with its camera, and anything extra on top.
 */
export const ProductBeat: React.FC<{
  local: number;
  beat: Beat;
  hue?: Hue;
  shots: { src: string; at?: number }[];
  cam?: CamKey[];
  overlay?: React.ReactNode;
  title?: string;
  extra?: React.ReactNode;
  copyTop?: number;
  hideCopy?: boolean;
  subAt?: number[];
}> = ({ local, beat, hue = "teal", shots, cam, overlay, title = "Juniper", extra, copyTop, hideCopy, subAt }) => {
  const h = winHeight();
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: WIN.x, top: (1080 - h) / 2 + 26 }}>
        <AppWindow local={local} width={WIN.width} shots={shots} cam={cam} overlay={overlay} title={title} glow={hue === "gold" ? "rgba(212,175,55,0.2)" : hue === "green" ? "rgba(127,200,160,0.2)" : undefined} />
      </div>
      {hideCopy ? null : (
        <div style={{ position: "absolute", left: PAD, top: copyTop ?? 0, bottom: copyTop === undefined ? 0 : undefined, display: "flex", alignItems: "center" }}>
          <BeatCopy beat={beat} local={local} hue={hue} width={570} size={64} subAt={subAt} />
        </div>
      )}
      {extra}
    </AbsoluteFill>
  );
};
