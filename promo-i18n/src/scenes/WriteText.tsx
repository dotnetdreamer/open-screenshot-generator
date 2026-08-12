import React from "react";
import { AbsoluteFill } from "remotion";
import { Cam } from "../components/Cam";
import { Focus } from "../components/Focus";
import { Plate } from "../components/Plate";
import { Pointer } from "../components/Pointer";
import { Chip, CopyPanel, Flash, StepTag, Sub } from "../components/Ui";
import { c, P, RECTS, sr } from "../style";

const A = P.write;

const headline = c(RECTS.headline);
const content = c(RECTS.content);

/** The typing plates, one every 12 frames: empty box, then two letters at a time. */
const TYPE_AT = 150;
const TYPE_STEP = 12;
const TYPE_SHOTS = [
  "shots/09-type-0.png",
  "shots/09-type-1.png",
  "shots/09-type-2.png",
  "shots/09-type-3.png",
  "shots/09-type-4.png",
  "shots/09-type-5.png",
];

/**
 * Act three, and the reason the video exists: the properties panel is the
 * per-language editor.
 *
 * Select the headline while German is showing and the Content box is German.
 * The DE badge on the label says so, the English original sits under the box
 * for comparison, and what gets typed lands on the board the moment the field
 * is left. The canvas commits on blur rather than per keystroke, which is why
 * the board still says "Gesundheit" through the whole typing run and flips on
 * one frame at the end. That gap is real, and the cut is built on it.
 */
export const WriteText: React.FC = () => {
  return (
    <AbsoluteFill>
      <Cam
        keys={[
          { f: 0, x: headline.x, y: headline.y + 30, s: 1.2 },
          { f: 42, x: headline.x, y: headline.y + 16, s: 1.5 },
          { f: 76, x: content.x - 200, y: content.y + 90, s: 1.25 },
          // Held short of the field's own centre: any tighter and the frame
          // runs off the right edge of the plate into the backdrop.
          { f: 118, x: content.x - 260, y: content.y + 40, s: 1.6 },
          { f: 148, x: content.x - 300, y: content.y + 28, s: 1.85 },
          { f: 244, x: content.x - 300, y: content.y + 28, s: 1.86 },
          { f: 282, x: 960, y: 540, s: 0.9 },
          { f: 316, x: 960, y: 540, s: 0.9 },
          { f: 350, x: headline.x, y: headline.y + 24, s: 1.45 },
          { f: 424, x: headline.x + 90, y: headline.y + 70, s: 1.2 },
          { f: 480, x: 960, y: 520, s: 0.9 },
          { f: 520, x: 960, y: 520, s: 0.9 },
        ]}
      >
        <Plate src="shots/08-selected.png" accent={A} />
        {TYPE_SHOTS.map((src, i) => (
          <Plate key={src} src={src} at={TYPE_AT + i * TYPE_STEP} fade={2} accent={A} />
        ))}
        <Plate src="shots/10-committed.png" at={300} fade={3} accent={A} />

        <Focus rect={sr(RECTS.contentLabel)} from={60} until={124} accent={A} pad={7} radius={9} dim={0.5} />
        <Focus rect={sr(RECTS.content)} from={126} until={272} accent={A} pad={8} radius={10} dim={0.45} />
        <Focus rect={sr(RECTS.headline)} from={330} until={396} accent={A} pad={12} radius={14} dim={0.35} ticks={false} />

        <Pointer
          path={[
            { f: 6, x: headline.x - 40, y: headline.y + 120 },
            { f: 40, x: headline.x + 10, y: headline.y + 10 },
            { f: 56, x: headline.x + 10, y: headline.y + 10 },
            { f: 112, x: content.x - 30, y: content.y + 6 },
            { f: 140, x: content.x - 30, y: content.y + 6 },
          ]}
          clicks={[46, 128]}
          until={158}
          accent={A}
        />
      </Cam>

      <div style={{ position: "absolute", top: 62, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <CopyPanel from={4} until={112}>
          <StepTag n={3} label="Rewrite it in the properties panel" accent={A} from={6} />
          <Sub text="Machine translation is a draft, not a decision" from={20} />
        </CopyPanel>
      </div>

      <div style={{ position: "absolute", bottom: 78, left: 0, right: 0, textAlign: "center" }}>
        <Chip text="The DE badge means this box holds German" from={132} until={210} accent={A} />
        <Chip text="The English original sits right underneath" from={218} until={292} accent={A} />
        <Chip text="Leave the field and the board follows" from={306} until={392} accent={A} />
        <Chip text="Nothing but Deutsch changed" from={402} accent={A} />
      </div>

      <Flash at={298} color="#DCFCE7" />
    </AbsoluteFill>
  );
};
