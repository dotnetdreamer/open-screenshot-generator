import React from "react";
import { C, F_MONO, G, LAND_BEATS, STEP, beat, landFrame, patchedCount, patchedFrame, perChar, ramp } from "./style";
import { Holes, Jack, Knob, Led, Screw, Toggle } from "./kit";
import { FEATURES, HEADER } from "./copy";
import { typed } from "./Module";

/** Width of the header unit, the rack's inner width. */
export const HEAD_W = 3 * G.MW + 2 * G.CGAP;
/** The jack the first cable comes out of, in header px. */
export const HEAD_JACK = { x: 96, y: 236 };

const TERM = { x: 170, y: 32, w: 1200, h: 236 };

type Line = { text: string; kind: "cmd" | "ok" | "done"; live?: boolean };

/** The terminal's lines at a frame, oldest first. */
const linesAt = (frame: number): Line[] => {
  const out: Line[] = [{ text: HEADER.before, kind: "done" }];
  FEATURES.forEach((feat, k) => {
    const start = landFrame(k) + STEP.typeFrom;
    if (frame < start) return;
    const cmd = `/add ${feat.name}`;
    const shown = typed(cmd, frame - start, perChar(cmd));
    out.push({ text: shown, kind: "cmd", live: frame < patchedFrame(k) });
    if (frame >= patchedFrame(k)) {
      out.push({ text: `patched · ${String(k + 1).padStart(2, "0")}/${FEATURES.length}`, kind: "ok" });
    }
  });
  const last = patchedFrame(FEATURES.length - 1);
  if (frame >= last + 12) {
    out.push({ text: typed(HEADER.after, frame - last - 12, 2), kind: "cmd", live: true });
  }
  if (frame < landFrame(0) + STEP.typeFrom) out.push({ text: "", kind: "cmd", live: true });
  return out;
};

export const Header: React.FC<{ frame: number }> = ({ frame }) => {
  const lines = linesAt(frame).slice(-3);
  const cursorOn = Math.floor(frame / 16) % 2 === 0;
  const count = patchedCount(frame);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: HEAD_W,
        height: G.HEAD,
        borderRadius: 8,
        background: "linear-gradient(180deg, #2A2927 0%, #1D1C1B 60%, #181716 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -2px 0 rgba(0,0,0,0.5)",
      }}
    >
      <Screw x={18} y={18} dark />
      <Screw x={18} y={G.HEAD - 18} dark turn={80} />
      <Screw x={HEAD_W - 18} y={18} dark turn={140} />
      <Screw x={HEAD_W - 18} y={G.HEAD - 18} dark turn={20} />

      {/* left: a knob, the coral line and the jack the first cable leaves from */}
      <Knob x={96} y={70} d={46} tone="dark" angle={40} />
      <div style={{ position: "absolute", left: 62, top: 140, width: 70, height: 6, borderRadius: 3, background: C.coral }} />
      <Jack x={HEAD_JACK.x} y={HEAD_JACK.y} d={36} dark />

      {/* terminal */}
      <div
        style={{
          position: "absolute",
          left: TERM.x,
          top: TERM.y,
          width: TERM.w,
          height: TERM.h,
          borderRadius: 16,
          background: "linear-gradient(180deg, #3A3835, #252321)",
          padding: 7,
          boxShadow: "0 1px 0 rgba(255,255,255,0.12)",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 11,
            background: C.screen,
            boxShadow: "inset 0 4px 14px rgba(0,0,0,0.9)",
            overflow: "hidden",
            fontFamily: F_MONO,
          }}
        >
          <div style={{ position: "absolute", left: 26, top: 18, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 13, height: 13, borderRadius: 7, background: C.coral, boxShadow: `0 0 8px ${C.coral}` }} />
            <span style={{ fontSize: 25, color: C.termDim, letterSpacing: "0.02em" }}>{HEADER.title}</span>
          </div>
          <div style={{ position: "absolute", left: 26, top: 64, right: 20 }}>
            {lines.map((l, i) => (
              <div key={i} style={{ height: 52, display: "flex", alignItems: "center", fontSize: 40, whiteSpace: "pre" }}>
                {l.kind === "cmd" ? (
                  <>
                    <span style={{ color: C.term }}>{"> "}</span>
                    <span style={{ color: C.term }}>{l.text}</span>
                    {l.live && cursorOn ? (
                      <span style={{ display: "inline-block", width: 22, height: 42, marginLeft: 3, background: C.coral }} />
                    ) : null}
                  </>
                ) : l.kind === "ok" ? (
                  <span style={{ color: C.green }}>{`✓ ${l.text}`}</span>
                ) : (
                  <span style={{ color: C.termDim }}>{`✓ ${l.text}`}</span>
                )}
              </div>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(165deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 40%)",
            }}
          />
        </div>
      </div>

      {/* middle: a grille and one LED per module, lit as each is patched */}
      <div
        style={{
          position: "absolute",
          left: 1420,
          top: 46,
          width: 300,
          height: 208,
          borderRadius: 10,
          background: "repeating-linear-gradient(180deg, #121110 0px, #121110 7px, #2C2A28 7px, #2C2A28 13px)",
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.7)",
        }}
      />
      {FEATURES.map((_, k) => {
        const col = Math.floor(k / 6);
        const i = k % 6;
        const on = ramp(frame, patchedFrame(k), 8);
        return <Led key={k} x={1790 + col * 34} y={70 + i * 32} d={13} color={C.green} on={on} />;
      })}
      <Holes x={1900} y={44} len={210} pitch={16} d={4} vertical />

      {/* right: the counter and the big coral knob */}
      <div
        style={{
          position: "absolute",
          left: 1950,
          top: 56,
          width: 520,
          height: 150,
          borderRadius: 12,
          background: "linear-gradient(180deg, #3A3835, #252321)",
          padding: 6,
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 8,
            background: C.screen,
            boxShadow: "inset 0 3px 10px rgba(0,0,0,0.9)",
            fontFamily: F_MONO,
          }}
        >
          <span style={{ position: "absolute", right: 22, top: 16, fontSize: 30, color: "#B9B4AB" }}>
            {`${String(count).padStart(2, "0")} / ${FEATURES.length}`}
          </span>
          <div style={{ position: "absolute", left: 22, right: 22, bottom: 22, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)" }}>
            <div
              style={{
                width: `${(count / FEATURES.length) * 100}%`,
                height: "100%",
                borderRadius: 4,
                background: C.green,
                boxShadow: `0 0 8px ${C.green}`,
              }}
            />
          </div>
        </div>
      </div>
      <Knob x={2560} y={120} d={112} tone="coral" angle={-120 + (count / FEATURES.length) * 240} />
      <Toggle x={2640} y={100} up s={0.9} />
      <Led x={2640} y={190} d={12} color={C.coral} on={frame >= beat(LAND_BEATS[0]) ? 1 : 0} />
    </div>
  );
};
