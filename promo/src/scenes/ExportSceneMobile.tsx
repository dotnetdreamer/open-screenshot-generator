import React from "react";
import { AbsoluteFill } from "remotion";
import { Headline, Kicker, Sub } from "../components/text";
import { FileCard, FILES } from "./ExportScene";

/** Portrait cut of the export scene: header on top, cards stacked below. */
export const ExportSceneMobile: React.FC = () => {
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 220,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
        }}
      >
        <Kicker delay={6}>Export</Kicker>
        <Headline delay={12} size={66} align="center">
          {"One export, every\nsize they ask for"}
        </Headline>
        <Sub delay={28} align="center" maxWidth={860}>
          Google Play or the App Store: pick your targets and every artboard
          lands as a pixel-perfect PNG
        </Sub>
      </div>

      <div
        style={{
          position: "absolute",
          top: 800,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 40,
        }}
      >
        {FILES.map((f, i) => (
          <FileCard key={f.name} file={f} delay={36 + i * 12} width={800} />
        ))}
      </div>
    </AbsoluteFill>
  );
};
