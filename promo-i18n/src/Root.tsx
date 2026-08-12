import React from "react";
import { Composition } from "remotion";
import { Languages } from "./Languages";
import { DURATION } from "./style";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Languages"
      component={Languages}
      durationInFrames={DURATION}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
