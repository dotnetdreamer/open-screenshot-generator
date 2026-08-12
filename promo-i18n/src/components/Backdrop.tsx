import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { BEATS, F_DISPLAY, lerpHex, P } from "../style";

/**
 * The room the video is filmed in.
 *
 * Two jobs. It carries the act colour, interpolated across the beats so the
 * background has already turned green by the time a string is being written,
 * and it says what the video is about before a word of copy does: the words
 * drifting behind everything are the same sentence in the languages the demo
 * adds, at a size that reads as texture rather than text.
 */

/** "Stay healthy", in the languages this project ships. */
const WORDS = [
  "Bleib gesund",
  "健康でいてね",
  "Mantente sano",
  "Restez en bonne santé",
  "Fique saudável",
  "Blijf gezond",
  "Håll dig frisk",
  "건강하세요",
  "保持健康",
  "Rimani in salute",
];

const ACT_COLOURS: { at: number; col: string }[] = [
  { at: BEATS.hook, col: P.add },
  { at: BEATS.add, col: P.add },
  { at: BEATS.read, col: P.read },
  { at: BEATS.write, col: P.write },
  { at: BEATS.keep, col: P.base },
  { at: BEATS.out, col: P.add },
];

/** The act colour on a frame, cross faded over the 40 frames after each beat. */
export const accentAt = (frame: number): string => {
  let out = ACT_COLOURS[0].col;
  for (let i = 1; i < ACT_COLOURS.length; i++) {
    const { at, col } = ACT_COLOURS[i];
    const t = interpolate(frame, [at, at + 40], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    out = lerpHex(out, col, t);
  }
  return out;
};

export const Backdrop: React.FC<{ words?: boolean }> = ({ words = true }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const accent = accentAt(frame);
  const drift = frame * 0.55;

  return (
    <AbsoluteFill style={{ background: P.bg, overflow: "hidden" }}>
      {/* Two slow lobes of colour, moving against each other. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 55% at ${28 + Math.sin(frame * 0.006) * 8}% ${
            34 + Math.cos(frame * 0.005) * 10
          }%, ${accent}33 0%, transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(55% 50% at ${74 + Math.cos(frame * 0.0045) * 7}% ${
            70 + Math.sin(frame * 0.0065) * 9
          }%, ${P.hot}22 0%, transparent 72%)`,
        }}
      />

      {words && (
        <AbsoluteFill style={{ opacity: 0.055 }}>
          {WORDS.map((word, i) => {
            const lane = i % 5;
            const dir = i % 2 === 0 ? 1 : -1;
            const span = width * 2.2;
            const raw = (drift * (0.5 + lane * 0.12) * dir + i * 520) % span;
            const x = dir > 0 ? raw - span / 2 : span / 2 - raw;
            return (
              <div
                key={word}
                style={{
                  position: "absolute",
                  top: height * (0.08 + lane * 0.2) + (i > 4 ? 90 : 0),
                  left: x,
                  whiteSpace: "nowrap",
                  fontFamily: F_DISPLAY,
                  fontWeight: 800,
                  fontSize: 130,
                  letterSpacing: -2,
                  color: P.ink,
                }}
              >
                {word}
              </div>
            );
          })}
        </AbsoluteFill>
      )}

      {/* Vignette, so plates and copy always sit on something darker. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(75% 70% at 50% 48%, transparent 40%, rgba(2,3,10,0.72) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
