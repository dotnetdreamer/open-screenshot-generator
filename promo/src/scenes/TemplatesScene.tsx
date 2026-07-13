import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { Headline, Kicker, Sub } from "../components/text";
import { C } from "../theme";

export const ROW_A = [
  "strips/breathora-breathing.png",
  "strips/vowly-wedding.png",
  "strips/castique-podcast.png",
  "strips/trackio-fitness.png",
  "strips/luxe-glow.png",
  "strips/coinly-crypto.png",
];
export const ROW_B = [
  "strips/connectly-chat.png",
  "strips/cinevault-stream.png",
  "strips/inquira.png",
  "strips/tripora-travel.png",
  "strips/nexmind.png",
  "strips/playverse-games.png",
];

export const CARD_H = 210;
const CARD_W = CARD_H * 3; // preview strips are 3:1
const GAP = 28;
const SPAN = (CARD_W + GAP) * ROW_A.length;

export const Row: React.FC<{ srcs: string[]; y: number; dir: 1 | -1; speed: number }> = ({
  srcs,
  y,
  dir,
  speed,
}) => {
  const frame = useCurrentFrame();
  const shift = (frame * speed) % SPAN;
  const x = dir === 1 ? -shift : shift - SPAN;
  return (
    <div
      style={{
        position: "absolute",
        top: y,
        left: 0,
        display: "flex",
        gap: GAP,
        transform: `translateX(${x}px)`,
      }}
    >
      {[...srcs, ...srcs, ...srcs].map((s, i) => (
        <div
          key={i}
          style={{
            width: CARD_W,
            height: CARD_H,
            borderRadius: 18,
            overflow: "hidden",
            border: `1px solid ${C.stroke}`,
            boxShadow: "0 22px 44px rgba(0,0,0,0.42)",
            flexShrink: 0,
            background: C.bgSoft,
          }}
        >
          <Img
            src={staticFile(s)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ))}
    </div>
  );
};

export const TemplatesScene: React.FC = () => {
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 128,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
        }}
      >
        <Kicker delay={6}>Templates</Kicker>
        <Headline delay={12} size={72} align="center">
          Never start from a blank page
        </Headline>
        <Sub delay={30} align="center" maxWidth={960}>
          60+ ready-made sets: fitness, podcasts, crypto, weddings, chat and
          more. Pick one and make it yours
        </Sub>
      </div>

      <Row srcs={ROW_A} y={508} dir={1} speed={1.6} />
      <Row srcs={ROW_B} y={508 + CARD_H + 36} dir={-1} speed={1.25} />

      {/* Edge fades so the marquee dissolves into the backdrop */}
      <div
        style={{
          position: "absolute",
          top: 480,
          bottom: 60,
          left: 0,
          width: 260,
          background: `linear-gradient(90deg, ${C.bg}, transparent)`,
          zIndex: 5,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 480,
          bottom: 60,
          right: 0,
          width: 260,
          background: `linear-gradient(270deg, ${C.bg}, transparent)`,
          zIndex: 5,
        }}
      />
    </AbsoluteFill>
  );
};
