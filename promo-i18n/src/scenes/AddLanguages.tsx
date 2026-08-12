import React from "react";
import { AbsoluteFill } from "remotion";
import { Cam } from "../components/Cam";
import { Focus } from "../components/Focus";
import { Plate } from "../components/Plate";
import { Pointer } from "../components/Pointer";
import { Chip, CopyPanel, Flash, StepTag, Sub } from "../components/Ui";
import { c, P, RECTS, sr } from "../style";

const A = P.add;

const addBtn = c(RECTS.addLanguage);
const dialog = c(RECTS.dialog);
const search = c(RECTS.searchFiltered);
const row = c(RECTS.germanRow);
const apply1 = c(RECTS.applyOne);
const apply3 = c(RECTS.applyThree);
const switcher = c(RECTS.switcher);

/**
 * Act one: a project with no languages gets three.
 *
 * The camera never cuts. It walks the toolbar button, the dialog, the search
 * box, the German row and the confirm button in the order a user's hand would,
 * and the plate underneath swaps to the screenshot of what that click did.
 * Everything on screen was captured from the running editor by
 * scripts/capture-i18n.js: the ticks, the counts and the button that renames
 * itself from "Add 1 language" to "Add 3 languages" are all real.
 */
export const AddLanguages: React.FC = () => {
  return (
    <AbsoluteFill>
      <Cam
        keys={[
          { f: 0, x: 960, y: 540, s: 0.88 },
          { f: 40, x: addBtn.x, y: addBtn.y + 90, s: 1.5 },
          { f: 68, x: addBtn.x, y: addBtn.y + 60, s: 2.0 },
          { f: 92, x: addBtn.x, y: addBtn.y + 70, s: 2.05 },
          { f: 120, x: dialog.x, y: dialog.y, s: 0.95 },
          { f: 150, x: search.x, y: search.y + 30, s: 1.35 },
          { f: 184, x: row.x + 60, y: row.y, s: 1.6 },
          { f: 214, x: row.x + 60, y: row.y, s: 1.62 },
          { f: 250, x: apply1.x - 60, y: apply1.y, s: 1.45 },
          // Framed off the plate's bottom edge rather than the button's centre:
          // the confirm button sits low enough that centring it would put a
          // third of the frame on the backdrop below the app window.
          { f: 300, x: apply3.x - 80, y: 780, s: 1.5 },
          { f: 344, x: apply3.x - 80, y: 775, s: 1.52 },
          { f: 372, x: 960, y: 540, s: 0.88 },
          { f: 410, x: switcher.x, y: switcher.y + 80, s: 1.75 },
          { f: 450, x: switcher.x, y: switcher.y + 80, s: 1.8 },
        ]}
      >
        <Plate src="shots/01-base.png" accent={A} />
        <Plate src="shots/02-dialog.png" at={100} accent={A} />
        <Plate src="shots/03-german.png" at={156} fade={5} accent={A} />
        <Plate src="shots/03-german-on.png" at={206} fade={4} accent={A} />
        <Plate src="shots/04-picked.png" at={266} fade={5} accent={A} />
        <Plate src="shots/05-added.png" at={358} fade={5} accent={A} />

        <Focus rect={sr(RECTS.addLanguage)} from={50} until={96} accent={A} pad={10} radius={10} />
        <Focus rect={sr(RECTS.germanRow)} from={168} until={236} accent={A} pad={8} radius={12} dim={0.45} />
        <Focus rect={sr(RECTS.applyOne)} from={240} until={262} accent={A} pad={8} radius={10} dim={0.45} ticks={false} />
        {/* Where the translations in the next act come from. */}
        <Focus rect={sr(RECTS.machineSwitch)} from={272} until={300} accent={A} pad={8} radius={12} dim={0.5} />
        <Focus rect={sr(RECTS.applyThree)} from={304} until={344} accent={A} pad={8} radius={10} dim={0.45} />
        <Focus rect={sr(RECTS.switcher)} from={404} until={450} accent={A} pad={9} radius={10} dim={0.4} />

        {/* Every click frame sits inside a hold, so the ripple lands on the
            control rather than somewhere on the way to the next one. */}
        <Pointer
          path={[
            { f: 16, x: addBtn.x - 320, y: addBtn.y + 260 },
            { f: 62, x: addBtn.x + 6, y: addBtn.y + 8 },
            { f: 98, x: addBtn.x + 6, y: addBtn.y + 8 },
            { f: 142, x: search.x - 180, y: search.y + 6 },
            { f: 186, x: row.x - 40, y: row.y + 4 },
            { f: 214, x: row.x - 40, y: row.y + 4 },
            { f: 252, x: apply1.x, y: apply1.y + 4 },
            { f: 300, x: apply3.x, y: apply3.y + 4 },
            { f: 338, x: apply3.x, y: apply3.y + 4 },
          ]}
          clicks={[90, 200, 328]}
          until={352}
          accent={A}
        />
      </Cam>

      <div style={{ position: "absolute", top: 62, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <CopyPanel from={6} until={116}>
          <StepTag n={1} label="Add the languages you ship in" accent={A} from={8} />
          <Sub text="One dialog, every store locale" from={22} />
        </CopyPanel>
      </div>

      <div style={{ position: "absolute", bottom: 78, left: 0, right: 0, textAlign: "center" }}>
        <Chip text="Search it, tick it" from={186} until={246} accent={A} />
        <Chip text="Deutsch, 日本語 and Español, in one go" from={254} until={300} accent={A} />
        <Chip text="Machine translations to start from" from={306} until={356} accent={A} />
        <Chip text="One globe, every language the project ships" from={382} accent={A} />
      </div>

      <Flash at={202} color="#DDD6FE" />
      <Flash at={330} color="#DDD6FE" />
    </AbsoluteFill>
  );
};
