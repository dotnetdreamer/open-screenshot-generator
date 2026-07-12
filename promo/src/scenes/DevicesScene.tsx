import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Chip, Headline, Kicker } from "../components/text";
import { Devices3D } from "../components/Devices3D";
import { WatchMock } from "../components/DeviceMocks";

export const DevicesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const watch = spring({
    frame: frame - 48,
    fps,
    config: { damping: 17, stiffness: 80, mass: 1.1 },
  });
  const watchBob = Math.sin((frame / fps) * 1.4 + 4.1) * 10;

  return (
    <AbsoluteFill>
      {/* Real three.js scene on the right */}
      <div style={{ position: "absolute", right: 0, top: 0, width: 1180, height: 1080 }}>
        <Devices3D width={1180} height={1080} />
      </div>

      {/* Watch stays 2.5D, in front of the canvas */}
      <div
        style={{
          position: "absolute",
          left: 800,
          top: 620 + interpolate(watch, [0, 1], [150, 0]) + watchBob,
          opacity: Math.min(1, watch * 1.5),
          transform: "perspective(1800px) rotateY(-12deg) rotateZ(-8deg)",
          filter: "drop-shadow(-16px 40px 45px rgba(0,0,0,0.6))",
          zIndex: 4,
        }}
      >
        <WatchMock screen="devices/watch-detail-blue.png" height={250} />
      </div>

      <div
        style={{
          position: "absolute",
          left: 120,
          top: 230,
          display: "flex",
          flexDirection: "column",
          gap: 34,
          width: 660,
          zIndex: 10,
        }}
      >
        <Kicker delay={6}>Device mockups</Kicker>
        <Headline delay={12} size={72}>
          {"Put your app\nin their hands"}
        </Headline>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 18,
            marginTop: 10,
          }}
        >
          <Chip delay={42}>iPhone, Android, tablet, desktop</Chip>
          <Chip delay={52}>Even the Apple Watch</Chip>
          <Chip delay={62}>Quick presets or full 3D control</Chip>
        </div>
      </div>
    </AbsoluteFill>
  );
};
