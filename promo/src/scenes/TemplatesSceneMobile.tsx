import React from "react";
import { AbsoluteFill } from "remotion";
import { Headline, Kicker, Sub } from "../components/text";
import { C } from "../theme";
import { CARD_H, Row, ROW_A, ROW_B } from "./TemplatesScene";

// Third row for the taller canvas: same strips, reshuffled so neighbors differ.
const ROW_C = [
  "strips/trackio-fitness.png",
  "strips/playverse-games.png",
  "strips/breathora-breathing.png",
  "strips/cinevault-stream.png",
  "strips/luxe-glow.png",
  "strips/vowly-wedding.png",
];

const ROWS_TOP = 780;
const ROW_GAP = 36;

/** Portrait cut of the templates scene: header on top, three marquee rows. */
export const TemplatesSceneMobile: React.FC = () => {
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 250,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
        }}
      >
        <Kicker delay={6}>Templates</Kicker>
        <Headline delay={12} size={66} align="center">
          {"Never start from\na blank page"}
        </Headline>
        <Sub delay={30} align="center" maxWidth={860}>
          60+ ready-made sets: fitness, podcasts, crypto, weddings, chat and
          more. Pick one and make it yours
        </Sub>
      </div>

      <Row srcs={ROW_A} y={ROWS_TOP} dir={1} speed={1.6} />
      <Row srcs={ROW_B} y={ROWS_TOP + CARD_H + ROW_GAP} dir={-1} speed={1.25} />
      <Row srcs={ROW_C} y={ROWS_TOP + (CARD_H + ROW_GAP) * 2} dir={1} speed={1.45} />

      {/* Edge fades so the marquee dissolves into the backdrop */}
      <div
        style={{
          position: "absolute",
          top: ROWS_TOP - 30,
          bottom: 60,
          left: 0,
          width: 140,
          background: `linear-gradient(90deg, ${C.bg}, transparent)`,
          zIndex: 5,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: ROWS_TOP - 30,
          bottom: 60,
          right: 0,
          width: 140,
          background: `linear-gradient(270deg, ${C.bg}, transparent)`,
          zIndex: 5,
        }}
      />
    </AbsoluteFill>
  );
};
