import React from "react";
import { AbsoluteFill } from "remotion";
import { Cam } from "../components/Cam";
import { Focus } from "../components/Focus";
import { Plate } from "../components/Plate";
import { Pointer } from "../components/Pointer";
import { Chip, CopyPanel, Flash, StepTag, Sub } from "../components/Ui";
import { c, P, RECTS, sr } from "../style";

const A = P.read;

const menu = c(RECTS.menu);
const german = c(RECTS.menuGerman);
const headline = c(RECTS.headline);
const notice = c(RECTS.notice);

/**
 * Act two: reading the project in German.
 *
 * The point of the act is the two seconds after the click, when every board on
 * the canvas is in a language nobody typed. The camera stays on the boards
 * through it rather than cutting away, because the whole claim is that nothing
 * else moved: same layout, same mockups, same everything but the words.
 */
export const SwitchLanguage: React.FC = () => {
  return (
    <AbsoluteFill>
      <Cam
        keys={[
          { f: 0, x: menu.x, y: menu.y + 60, s: 1.2 },
          { f: 34, x: german.x, y: german.y + 90, s: 1.65 },
          { f: 74, x: german.x, y: german.y + 90, s: 1.68 },
          { f: 104, x: headline.x, y: headline.y + 40, s: 1.25 },
          { f: 160, x: 800, y: 520, s: 0.95 },
          { f: 214, x: 960, y: 540, s: 0.9 },
          // The strip lives at the top of the window, so the camera sits below
          // it and looks up rather than centring on it and framing backdrop.
          { f: 248, x: notice.x - 120, y: 340, s: 1.35 },
          { f: 290, x: notice.x - 120, y: 336, s: 1.38 },
        ]}
      >
        <Plate src="shots/06-menu.png" accent={A} />
        <Plate src="shots/07-german.png" at={96} fade={4} accent={A} />

        <Focus rect={sr(RECTS.menu)} from={8} until={92} accent={A} pad={10} radius={14} dim={0.5} />
        <Focus rect={sr(RECTS.notice)} from={252} until={290} accent={A} pad={8} radius={10} dim={0.42} ticks={false} />

        <Pointer
          path={[
            { f: 4, x: menu.x - 260, y: menu.y + 220 },
            { f: 60, x: german.x - 40, y: german.y + 4 },
            { f: 92, x: german.x - 40, y: german.y + 4 },
          ]}
          clicks={[78]}
          until={96}
          accent={A}
        />
      </Cam>

      <div style={{ position: "absolute", top: 62, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <CopyPanel from={4} until={100}>
          <StepTag n={2} label="Switch the whole project" accent={A} from={6} />
          <Sub text="12 of 12 strings already translated" from={20} />
        </CopyPanel>
      </div>

      <div style={{ position: "absolute", bottom: 78, left: 0, right: 0, textAlign: "center" }}>
        <Chip text="Every board, in Deutsch" from={120} until={196} accent={A} />
        <Chip text="Same layout, same mockups, new words" from={206} until={244} accent={A} />
        <Chip text="Text, fonts and screenshots are per language" from={256} accent={A} />
      </div>

      <Flash at={92} color="#CFFAFE" />
    </AbsoluteFill>
  );
};
