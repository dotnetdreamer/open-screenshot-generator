import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Cam } from "./Cam";
import { Focus } from "./Focus";
import { ShotCard } from "./ShotCard";
import { Tap } from "./Tap";
import { Chip, CopyPanel, Flash, StepTag, Streak, Sub } from "./Ui";
import { mid, P, RECTS, sr } from "./style";

const CUT = 40;

const pvBtn = sr(RECTS.editor.previewBtn);
const pvBtnC = mid(pvBtn);
const board = sr(RECTS.preview.artboard);
const boardC = mid(board);

/**
 * Step 3: tap Preview in the toolbar, then the store-ready screen fills a
 * fullscreen dark stage with the filmstrip below.
 */
export const Step3Scene: React.FC = () => {
  return (
    <AbsoluteFill>
      {/* Part A: dive onto the Preview button */}
      <Sequence from={0} durationInFrames={CUT + 4} layout="none">
        <Cam
          keys={[
            { f: 0, x: 940, y: 640, s: 2.0 },
            { f: 26, x: pvBtnC.x, y: pvBtnC.y + 6, s: 2.9 },
            { f: 40, x: pvBtnC.x, y: pvBtnC.y + 8, s: 3.2 },
          ]}
        >
          <ShotCard src="steps/04-uploaded.png" accent={P.step3} pop={false} />
          <Focus rect={pvBtn} from={8} until={CUT - 4} accent={P.step3} pad={10} radius={10} dim={0.5} />
          <Tap
            path={[
              { f: 0, x: 900, y: 800 },
              { f: 22, x: pvBtnC.x + 6, y: pvBtnC.y + 8 },
            ]}
            taps={[27]}
            until={38}
            accent={P.step3}
          />
        </Cam>
      </Sequence>

      {/* Part B: fullscreen preview */}
      <Sequence from={CUT} layout="none">
        <Cam
          keys={[
            { f: 0, x: 540, y: 1010, s: 1.04 },
            { f: 34, x: boardC.x, y: boardC.y, s: 1.1 },
            { f: 72, x: boardC.x, y: boardC.y - 46, s: 1.98 },
            { f: 114, x: boardC.x, y: boardC.y + 36, s: 1.6 },
            { f: 154, x: boardC.x, y: boardC.y + 92, s: 1.44 },
          ]}
        >
          <ShotCard src="steps/05-preview.png" accent={P.step3} pop={false} />
          <Focus
            rect={board}
            from={10}
            until={64}
            accent={P.step3}
            pad={14}
            radius={10}
            dim={0.25}
            ticks={false}
          />
        </Cam>
        <div
          style={{
            position: "absolute",
            top: 1540,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <Chip text="1290 × 2796" from={92} accent={P.step3} />
          <Chip text="App Store ready" from={100} accent={P.step3} />
          <Chip text="Play Store too" from={108} accent={P.step3} />
        </div>
      </Sequence>

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
          <StepTag n={3} label="Preview and ship" accent={P.step3} from={4} />
          <Sub text="Exactly what the stores will show" from={14} />
        </CopyPanel>
      </div>

      <Flash at={CUT} color="#DCFCE7" />
      <Streak at={CUT + 2} accent={P.step3} />
    </AbsoluteFill>
  );
};
