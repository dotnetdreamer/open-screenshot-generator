import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { R } from "./style";

/**
 * Spotlight highlight: dims everything except the target rect, rings it with
 * a glowing stroke and corner ticks, and breathes while held. Lives in scene
 * space (inside a Cam), so it zooms with the UI. Built from plain divs (no
 * SVG masks/filters, which proved unreliable under the render pipeline).
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
}> = ({ rect, from, until, accent, pad = 16, radius = 22, dim = 0.5, pulse = true, ticks = true }) => {
  const frame = useCurrentFrame();
  if (frame < from) return null;

  const enter = interpolate(frame, [from, from + 14], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  let opacity = enter;
  if (until !== undefined) {
    opacity *= interpolate(frame, [until - 10, until], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  if (opacity <= 0.01) return null;

  const padNow = pad + (1 - enter) * 90;
  const cx = rect.x - padNow;
  const cy = rect.y - padNow;
  const cw = rect.w + padNow * 2;
  const ch = rect.h + padNow * 2;

  // Dim curtains around the cutout; generous reach so zooms never show edges.
  const REACH = 1200;
  const dimBg = `rgba(2,4,12,${dim})`;
  const breathe = pulse ? 0.72 + 0.28 * Math.sin((frame - from) * 0.22) : 1;
  const tick = 26;
  const t0 = 14;
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
      {/* four dim curtains */}
      <div style={{ position: "absolute", left: cx - REACH, top: cy - REACH, width: cw + REACH * 2, height: REACH, background: dimBg, zIndex: 10 }} />
      <div style={{ position: "absolute", left: cx - REACH, top: cy + ch, width: cw + REACH * 2, height: REACH, background: dimBg, zIndex: 10 }} />
      <div style={{ position: "absolute", left: cx - REACH, top: cy, width: REACH, height: ch, background: dimBg, zIndex: 10 }} />
      <div style={{ position: "absolute", left: cx + cw, top: cy, width: REACH, height: ch, background: dimBg, zIndex: 10 }} />
      {/* glow ring + crisp ring */}
      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          width: cw,
          height: ch,
          borderRadius: radius,
          boxShadow: `0 0 0 3px ${accent}, 0 0 26px 5px ${accent}66, inset 0 0 30px ${accent}22`,
          opacity: breathe,
        }}
      />
      {ticks && (
        <>
          <div style={tickStyle({ left: cx - t0, top: cy - t0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 10 })} />
          <div style={tickStyle({ left: cx + cw + t0 - tick, top: cy - t0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 10 })} />
          <div style={tickStyle({ left: cx - t0, top: cy + ch + t0 - tick, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 10 })} />
          <div style={tickStyle({ left: cx + cw + t0 - tick, top: cy + ch + t0 - tick, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 10 })} />
        </>
      )}
    </div>
  );
};
