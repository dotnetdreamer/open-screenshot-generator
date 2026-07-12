import React from "react";
import { Composition } from "remotion";
import { FAST_DURATION, Promo, PromoFast, TOTAL_DURATION } from "./Promo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Promo"
        component={Promo}
        durationInFrames={TOTAL_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PromoFast"
        component={PromoFast}
        durationInFrames={FAST_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
