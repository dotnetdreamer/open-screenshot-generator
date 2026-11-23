import React from "react";
import { Img, staticFile } from "remotion";
import { ACCENTS, C, F_MONO, F_SANS, F_SERIF, H, SHOT, W, beat, ramp } from "./style";
import { CARD, FEATURES } from "./copy";

/**
 * The last card: a frosted sheet that drops over the rack and lists all
 * eighteen, two columns of nine, with the address. Screen space, on top of
 * the depth of field, so it stays sharp.
 */

const CARD_W = 940;
const CARD_H = 1190;
const DROP = 20;
const SAMPLES = 9;

/** The sheet falls for DROP frames, lands on the card's beat, and rebounds a little. */
const dropY = (f: number) => {
  const local = f - beat(SHOT.CARD);
  if (local < 0) {
    const u = Math.min(1, -local / DROP);
    return -(CARD_H + 160) * (0.3 * u + 0.7 * u * u);
  }
  return -14 * Math.exp(-local / 5) * Math.sin(local * 0.45);
};

const Sheet: React.FC<{ f: number }> = ({ f }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      borderRadius: 20,
      padding: "44px 54px 30px",
      fontFamily: F_SANS,
      color: C.ink,
      display: "flex",
      flexDirection: "column",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 14 }}>
      <Img src={staticFile("logo.svg")} style={{ width: 40, height: 40 }} />
      <span style={{ fontSize: 25, fontWeight: 600, color: C.inkSub, letterSpacing: "-0.01em" }}>{CARD.kicker}</span>
    </div>
    <div style={{ textAlign: "center", lineHeight: 1, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 76, fontWeight: 800, letterSpacing: "-0.04em" }}>{CARD.count} </span>
      <span style={{ fontFamily: F_SERIF, fontStyle: "italic", fontSize: 86, color: C.coral, letterSpacing: "-0.01em" }}>
        {CARD.accent}
      </span>
    </div>
    <div style={{ height: 2, background: "rgba(40,38,36,0.12)", margin: "28px 0 24px" }} />
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridAutoFlow: "column",
        gridTemplateRows: "repeat(9, 1fr)",
        columnGap: 34,
        flex: 1,
      }}
    >
      {FEATURES.map((feat, k) => (
        <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ width: 5, height: 25, borderRadius: 3, background: ACCENTS[k], marginTop: 5, flexShrink: 0 }} />
          <span style={{ fontFamily: F_MONO, fontSize: 15, color: "#9A948B", marginTop: 9, width: 22, flexShrink: 0 }}>
            {String(k + 1).padStart(2, "0")}
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{feat.name}</span>
            <span style={{ fontSize: 16.5, fontWeight: 500, color: "#7C766E", whiteSpace: "nowrap" }}>{feat.sub}</span>
          </div>
        </div>
      ))}
    </div>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginTop: 22 }}>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          background: "#1B1A19",
          color: "#FFFFFF",
          borderRadius: 999,
          padding: "17px 34px",
          fontSize: 25,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          boxShadow: "0 8px 20px rgba(30,20,20,0.25)",
        }}
      >
        {CARD.pill}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 120,
            left: -160 + ramp(f, beat(SHOT.CARD) + 50, 40, (t) => t) * 760,
            background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.28), rgba(255,255,255,0))",
            transform: "skewX(-20deg)",
          }}
        />
      </div>
      <span style={{ fontSize: 16, fontWeight: 500, color: "#8E877E" }}>{CARD.note}</span>
    </div>
  </div>
);

export const EndCard: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < beat(SHOT.CARD) - DROP) return null;
  const y = dropY(frame);
  const moving = frame < beat(SHOT.CARD) + 14;
  const left = (W - CARD_W) / 2;
  const top = (H - CARD_H) / 2 + 8;
  return (
    <>
      {/* the frosted glass is drawn once, at the sheet's current place */}
      <div
        style={{
          position: "absolute",
          left,
          top: top + y,
          width: CARD_W,
          height: CARD_H,
          borderRadius: 20,
          background: "rgba(251,248,243,0.86)",
          backdropFilter: "blur(26px) saturate(1.25)",
          WebkitBackdropFilter: "blur(26px) saturate(1.25)",
          boxShadow: "0 30px 70px rgba(70,30,40,0.30), inset 0 1px 0 rgba(255,255,255,0.9)",
          border: "1px solid rgba(255,255,255,0.6)",
        }}
      />
      {Array.from({ length: moving ? SAMPLES : 1 }, (_, i) => {
        const t = moving ? frame - 0.6 * (i / (SAMPLES - 1)) : frame;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left,
              top: top + dropY(t),
              width: CARD_W,
              height: CARD_H,
              opacity: 1 / (i + 1),
            }}
          >
            <Sheet f={frame} />
          </div>
        );
      })}
    </>
  );
};
