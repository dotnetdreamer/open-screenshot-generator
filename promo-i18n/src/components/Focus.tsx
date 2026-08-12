import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { R } from "../style";

/**
 * Spotlight on one control: dims everything around the rect, rings it and
 * breathes while held. Lives inside the Cam, so it magnifies with the UI it is
 * pointing at. Plain divs on purpose (no SVG masks, which render unreliably).
 */
export const Focus: React.FC<{
  rect: R;
  from: number;
  until?: number;
  accent: string;
  pad?: number;
  radius?: number;
  dim?: number;
  pulse?: boolean;
  ticks?: boolean;
}> = ({ rect, from, until, accent, pad = 14, radius = 18, dim = 0.5, pulse = true, ticks = true }) => {
  const frame = useCurrentFrame();
  if (frame < from) return null;

  const enter = interpolate(frame, [from, from + 12], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  let opacity = enter;
  if (until !== undefined) {
    opacity *= interpolate(frame, [until - 9, until], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  if (opacity <= 0.01) return null;

  const padNow = pad + (1 - enter) * 70;
  const cx = rect.x - padNow;
  const cy = rect.y - padNow;
  const cw = rect.w + padNow * 2;
  const ch = rect.h + padNow * 2;

  const REACH = 1600;
  const dimBg = `rgba(2,4,12,${dim})`;
  const breathe = pulse ? 0.74 + 0.26 * Math.sin((frame - from) * 0.2) : 1;
  const tick = 22;
  const t0 = 12;
  const tickStyle = (extra: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    width: tick,
    height: tick,
    borderColor: accent,
    borderStyle: "solid",
    borderWidth: 0,
    ...extra,
  });

  return (
    <div style={{ position: "absolute", left: 0, top: 0, opacity, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: cx - REACH, top: cy - REACH, width: cw + REACH * 2, height: REACH, background: dimBg }} />
      <div style={{ position: "absolute", left: cx - REACH, top: cy + ch, width: cw + REACH * 2, height: REACH, background: dimBg }} />
      <div style={{ position: "absolute", left: cx - REACH, top: cy, width: REACH, height: ch, background: dimBg }} />
      <div style={{ position: "absolute", left: cx + cw, top: cy, width: REACH, height: ch, background: dimBg }} />
      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          width: cw,
          height: ch,
          borderRadius: radius,
          boxShadow: `0 0 0 3px ${accent}, 0 0 24px 5px ${accent}66, inset 0 0 26px ${accent}22`,
          opacity: breathe,
        }}
      />
      {ticks && (
        <>
          <div style={tickStyle({ left: cx - t0, top: cy - t0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 })} />
          <div style={tickStyle({ left: cx + cw + t0 - tick, top: cy - t0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 })} />
          <div style={tickStyle({ left: cx - t0, top: cy + ch + t0 - tick, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 })} />
          <div style={tickStyle({ left: cx + cw + t0 - tick, top: cy + ch + t0 - tick, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 })} />
        </>
      )}
    </div>
  );
};
