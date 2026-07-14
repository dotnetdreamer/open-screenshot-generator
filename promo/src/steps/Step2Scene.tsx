import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Cam } from "./Cam";
import { Focus } from "./Focus";
import { ShotCard } from "./ShotCard";
import { Tap } from "./Tap";
import { Chip, CopyPanel, Flash, StepTag, Sub } from "./Ui";
import { mid, P, RECTS, sr } from "./style";

const phone = sr(RECTS.selected.phone);
const phoneC = mid(phone);
const btn = sr(RECTS.selected.uploadBtn);
const btnC = mid(btn);

/** The swap lands while the camera is back on the phone, so it reads. */
const SWAP = 176;

/** The uploaded file, flying from off screen into the phone. */
const FlyIn: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < SWAP - 22 || frame > SWAP + 10) return null;
  const t = interpolate(frame, [SWAP - 22, SWAP + 4], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const x = interpolate(t, [0, 1], [phoneC.x + 70, phoneC.x]);
  const y = interpolate(t, [0, 1], [phone.y + phone.h + 620, phoneC.y]);
  const sc = interpolate(t, [0, 1], [1, 0.36]);
  const o =
    interpolate(frame, [SWAP - 22, SWAP - 16], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }) *
    interpolate(frame, [SWAP, SWAP + 8], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const W = 200;
  return (
    <div
      style={{
        position: "absolute",
        left: x - W / 2,
        top: y - (W * 2.02) / 2,
        width: W,
        borderRadius: 22,
        overflow: "hidden",
        border: `2px solid ${P.step2}AA`,
        boxShadow: `0 24px 70px rgba(0,0,0,0.6), 0 0 46px ${P.step2}66`,
        transform: `scale(${sc}) rotate(${(1 - t) * 7}deg)`,
        opacity: o,
      }}
    >
      <Img src={staticFile("steps/upload-screen.png")} style={{ width: "100%", display: "block" }} />
    </div>
  );
};

/**
 * Step 2: close on the phone mockup, tap it, glide to Change Screenshot,
 * tap, and the user's own screen drops into the frame.
 */
export const Step2Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const swapT = interpolate(frame, [SWAP - 4, SWAP + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Cam
        keys={[
          { f: 0, x: phoneC.x, y: 1005, s: 1.12 },
          { f: 42, x: phoneC.x, y: phoneC.y, s: 1.9 },
          { f: 78, x: 760, y: 900, s: 2.35 },
          { f: 112, x: btnC.x, y: btnC.y, s: 3.05 },
          { f: 140, x: btnC.x, y: btnC.y + 4, s: 3.12 },
          { f: 172, x: phoneC.x, y: phoneC.y, s: 2.1 },
          { f: 216, x: phoneC.x, y: phoneC.y, s: 1.55 },
          { f: 292, x: phoneC.x + 12, y: phoneC.y - 8, s: 1.66 },
        ]}
      >
        <ShotCard src="steps/03-selected.png" accent={P.step2} />
        <ShotCard src="steps/04-uploaded.png" accent={P.step2} opacity={swapT} pop={false} />
        <Focus rect={phone} from={26} until={80} accent={P.step2} pad={20} radius={40} />
        <Focus rect={btn} from={116} until={146} accent={P.step2} pad={10} radius={10} dim={0.55} />
        <Focus
          rect={phone}
          from={SWAP + 26}
          until={270}
          accent={P.step2}
          pad={20}
          radius={40}
          dim={0.24}
          ticks={false}
        />
        <FlyIn />
        <Tap
          path={[
            { f: 18, x: 640, y: 1560 },
            { f: 48, x: phoneC.x + 20, y: phoneC.y + 30 },
            { f: 86, x: 880, y: 830 },
            { f: 120, x: btnC.x + 8, y: btnC.y + 6 },
          ]}
          taps={[56, 130]}
          until={150}
          accent={P.step2}
        />
      </Cam>

      <div
        style={{
          position: "absolute",
          top: 150,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <CopyPanel>
          <StepTag n={2} label="Drop in your screenshot" accent={P.step2} from={6} />
          <Sub text="Tap the phone, swap in your screen" from={18} />
        </CopyPanel>
      </div>

      <div style={{ position: "absolute", top: 1552, left: 0, right: 0, textAlign: "center" }}>
        <Chip text="Sized to the frame for you" from={214} accent={P.step2} />
      </div>

      <Flash at={SWAP - 4} color="#CFFAFE" />
    </AbsoluteFill>
  );
};
