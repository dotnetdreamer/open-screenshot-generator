import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Cam } from "./Cam";
import { Focus } from "./Focus";
import { ShotCard } from "./ShotCard";
import { Tap } from "./Tap";
import { Chip, CopyPanel, Flash, StepTag, Streak, Sub } from "./Ui";
import { mid, P, RECTS, sr } from "./style";

const CUT = 122;

const strip = sr(RECTS.start.strip);
const stripC = mid(strip);

/**
 * Step 1: the start dialog, camera dives onto the first template card
 * (Zenfit Yoga), a tap opens it, and the loaded editor sweeps in.
 */
export const Step1Scene: React.FC = () => {
  return (
    <AbsoluteFill>
      {/* Part A: template picker, dive to the first card */}
      <Sequence from={0} durationInFrames={CUT + 4} layout="none">
        <Cam
          keys={[
            { f: 0, x: 540, y: 1010, s: 0.9 },
            { f: 38, x: 540, y: 1010, s: 0.99 },
            { f: 82, x: stripC.x, y: stripC.y + 20, s: 1.9 },
            { f: 112, x: stripC.x, y: stripC.y + 24, s: 2.55 },
            { f: 124, x: stripC.x, y: stripC.y + 28, s: 3.0 },
          ]}
        >
          <ShotCard src="steps/01-start.png" accent={P.step1} />
          <Focus rect={strip} from={60} until={CUT} accent={P.step1} pad={14} radius={16} />
          <Tap
            path={[
              { f: 30, x: 700, y: 1420 },
              { f: 62, x: 380, y: 1010 },
              { f: 90, x: stripC.x - 18, y: stripC.y + 10 },
            ]}
            taps={[102]}
            until={120}
            accent={P.step1}
          />
        </Cam>
      </Sequence>

      {/* Part B: the whole template lands on the canvas */}
      <Sequence from={CUT} layout="none">
        <Cam
          keys={[
            { f: 0, x: 540, y: 1000, s: 1.12 },
            { f: 26, x: 540, y: 1055, s: 0.99 },
            { f: 90, x: 560, y: 1042, s: 1.05 },
            { f: 136, x: 545, y: 1052, s: 1.02 },
          ]}
        >
          <ShotCard src="steps/02-editor.png" accent={P.step1} />
        </Cam>
        <div style={{ position: "absolute", top: 1552, left: 0, right: 0, textAlign: "center" }}>
          <Chip text="5 screens, ready to edit" from={34} accent={P.step1} />
        </div>
      </Sequence>

      {/* Screen-fixed copy */}
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
          <StepTag n={1} label="Pick a template" accent={P.step1} from={6} />
          <Sub text="Tap one, the whole set opens" from={18} />
        </CopyPanel>
      </div>

      <Flash at={CUT} color="#EDE9FE" />
      <Streak at={CUT + 2} accent={P.step1} />
    </AbsoluteFill>
  );
};
