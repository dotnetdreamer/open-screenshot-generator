import React from "react";
import { Composition } from "remotion";
import {
  FAST_DURATION,
  MOBILE_DURATION,
  Promo,
  PromoFast,
  PromoMobile,
  TOTAL_DURATION,
} from "./Promo";
import { AI_DURATION, PromoAI, PromoAIMobile } from "./PromoAI";
import { STEPS_DURATION, StepsPromo } from "./steps/StepsPromo";

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
      <Composition
        id="PromoAI"
        component={PromoAI}
        durationInFrames={AI_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="PromoAIMobile"
        component={PromoAIMobile}
        durationInFrames={AI_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="PromoSteps"
        component={StepsPromo}
        durationInFrames={STEPS_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="PromoMobile"
        component={PromoMobile}
        durationInFrames={MOBILE_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
