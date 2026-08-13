import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Cam } from "../components/Cam";
import { Plate } from "../components/Plate";
import { Chip, CopyPanel, Flash, StepTag, Sub } from "../components/Ui";
import { c, F_BODY, F_DISPLAY, P, RECTS } from "../style";

const A = P.base;

/** The headline sits 47 CSS px lower whenever the locale strip is up. */
const withStrip = c(RECTS.headline);
const noStrip = c(RECTS.headlineBase);

/** Cut frames, and what is on screen after each one. */
const CUTS = [
  { at: 0, label: "Deutsch", code: "de-DE", strip: true },
  { at: 96, label: "English (US)", code: "en-US", strip: false },
  { at: 168, label: "日本語", code: "ja", strip: true },
  { at: 206, label: "Español", code: "es-ES", strip: true },
  { at: 244, label: "English (US)", code: "en-US", strip: false },
];

/** Which language is on screen right now, for the corner badge. */
const currentCut = (frame: number) =>
  CUTS.reduce((best, cut) => (frame >= cut.at ? cut : best), CUTS[0]);

/**
 * Act four: the base language was never touched.
 *
 * Four hard cuts, all of them pinned on the same headline, so the only thing
 * that moves between them is the writing. The camera jumps 47 pixels on each
 * cut because the locale strip appears and disappears with the language, which
 * is the one honest way to film this: the English board really is one strip
 * shorter than the German one.
 */
export const BackToBase: React.FC = () => {
  const frame = useCurrentFrame();
  const cut = currentCut(frame);

  return (
    <AbsoluteFill>
      <Cam
        keys={[
          { f: 0, x: withStrip.x, y: withStrip.y + 60, s: 1.22 },
          { f: 62, x: withStrip.x, y: withStrip.y + 46, s: 1.34 },
          { f: 95, x: withStrip.x, y: withStrip.y + 46, s: 1.34 },
          { f: 96, x: noStrip.x, y: noStrip.y + 46, s: 1.34 },
          { f: 150, x: noStrip.x + 20, y: noStrip.y + 62, s: 1.28 },
          { f: 167, x: noStrip.x + 20, y: noStrip.y + 62, s: 1.28 },
          { f: 168, x: withStrip.x + 20, y: withStrip.y + 62, s: 1.28 },
          { f: 243, x: withStrip.x + 20, y: withStrip.y + 62, s: 1.26 },
          { f: 244, x: noStrip.x + 20, y: noStrip.y + 62, s: 1.26 },
          { f: 270, x: noStrip.x + 90, y: noStrip.y + 140, s: 1.08 },
        ]}
      >
        <Plate src="shots/11-deutsch.png" accent={A} />
        <Plate src="shots/14-back-to-base.png" at={96} fade={2} accent={A} />
        <Plate src="shots/12-japanese.png" at={168} fade={2} accent={A} />
        <Plate src="shots/13-spanish.png" at={206} fade={2} accent={A} />
        <Plate src="shots/14-back-to-base.png" at={244} fade={2} accent={A} />
      </Cam>

      <div style={{ position: "absolute", top: 62, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <CopyPanel from={4} until={92}>
          <StepTag n={4} label="The base language never moved" accent={A} from={6} />
          <Sub text="Edits in a translation stay in that translation" from={20} />
        </CopyPanel>
      </div>

      {/* Which language the board on screen is in. Changes on the cut, not over
          it, so it reads as a label rather than an animation. */}
      <div
        style={{
          position: "absolute",
          top: 64,
          right: 74,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 22px",
          borderRadius: 16,
          background: "rgba(8,12,26,0.82)",
          border: `1.5px solid ${A}66`,
          boxShadow: `0 12px 34px rgba(0,0,0,0.45)`,
        }}
      >
        <span style={{ fontFamily: F_DISPLAY, fontWeight: 700, fontSize: 30, color: P.ink }}>
          {cut.label}
        </span>
        <span style={{ fontFamily: F_BODY, fontWeight: 600, fontSize: 20, color: P.sub }}>
          {cut.code}
        </span>
      </div>

      <div style={{ position: "absolute", bottom: 78, left: 0, right: 0, textAlign: "center" }}>
        <Chip text="Your German wording, still there" from={20} until={88} accent={A} />
        <Chip text="Back to English, exactly as it was" from={104} until={160} accent={A} />
        <Chip text="One layout, every language" from={214} accent={A} />
      </div>

      <Flash at={95} color="#FEF3C7" />
      <Flash at={168} color="#FEF3C7" />
      <Flash at={206} color="#FEF3C7" />
      <Flash at={244} color="#FEF3C7" />
    </AbsoluteFill>
  );
};
