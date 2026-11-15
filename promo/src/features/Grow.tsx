import React from "react";
import { AbsoluteFill } from "remotion";
import { COPY, V, outExpo, ramp } from "./style";
import { FILES } from "./rects.generated";
import { ProductBeat, R, mid } from "./kit";
import { Cursor, GREEN, Ring, Still, Words } from "./ui";

type P = { local: number; len: number };

const OVERVIEW = "features2/growth/overview.png";
const IMPACT = "features2/growth/impact.png";

/** Bars 37 and 38: Juniper's numbers, beside its designs. */
export const Stats: React.FC<P> = ({ local }) => {
  const chart = R(OVERVIEW, "chart", { x: 272, y: 444, w: 1152, h: 344 });
  const first = R(OVERVIEW, "tile-times-seen", { x: 272, y: 283, w: 182, h: 145 });
  const rate = R(OVERVIEW, "tile-download-rate", { x: 660, y: 283, w: 182, h: 145 });
  const last = R(OVERVIEW, "tile-rating", { x: 1242, y: 283, w: 182, h: 145 });
  return (
    <ProductBeat
      local={local}
      beat={COPY.stats}
      hue="green"
      title="Juniper: Growth"
      shots={[{ src: OVERVIEW }]}
      cam={[
        { at: 0, z: 1 },
        { at: 20, z: 1 },
        { at: 48, z: 1.75, x: first.x + 300, y: first.y + first.h / 2 + 40 },
        { at: 82, z: 1.75, x: last.x + last.w - 300, y: last.y + last.h / 2 + 40 },
        { at: 118, z: 1.3, x: chart.x + chart.w / 2, y: chart.y + chart.h / 2 - 30 },
      ]}
      overlay={
        <>
          <Ring rect={rate} local={local} delay={40} color={GREEN} hold={50} />
          <Ring rect={chart} local={local} delay={98} color={GREEN} />
        </>
      }
    />
  );
};

/** Bar 39, the break: the question, on its own. */
export const Ask: React.FC<P> = ({ local }) => {
  const p = ramp(local, 0, 30, outExpo);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: 0.32 * p, filter: "blur(18px)", transform: `scale(${1.12 - 0.04 * p})` }}>
        <Still src={FILES.has(IMPACT) ? IMPACT : OVERVIEW} style={{ width: "100%", height: "100%", objectFit: "cover" } as React.CSSProperties} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Words text={COPY.ask} accent="work?" accentColor={GREEN} local={local} delay={2} stagger={4} size={118} align="center" width={1500} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Bars 40 and 41, on the drop: the before and after, and whether it was luck. */
export const Answer: React.FC<P> = ({ local }) => {
  // A dedicated capture if the Growth pass made one, else the card on the overview.
  const own = FILES.has(IMPACT);
  const src = own ? IMPACT : OVERVIEW;
  const card = R(src, "impact-card", { x: 272, y: 77, w: 1152, h: 190 });
  const before = R(IMPACT, "before", { x: 289, y: 146, w: 68, h: 48 });
  const after = R(IMPACT, "after", { x: 421, y: 146, w: 68, h: 48 });
  const numbers = { x: before.x - 6, y: before.y - 4, w: after.x + after.w - before.x + 12, h: before.h + 8 };
  const lift = R(IMPACT, "change", { x: 513, y: 150, w: 69, h: 44 });
  // The measured line's box runs the card's width; the sentence itself is about 360 px.
  const line = R(IMPACT, "days-measured", { x: 289, y: 213, w: 1008, h: 16 });
  const sure = { x: line.x - 4, y: line.y - 3, w: 362, h: line.h + 6 };
  return (
    <ProductBeat
      local={local}
      beat={COPY.answer}
      hue="green"
      title="Juniper: Growth"
      shots={[{ src }]}
      cam={[
        { at: 0, z: 1.25, x: card.x + card.w / 2, y: card.y + card.h / 2 + 60 },
        { at: 30, z: 2.1, x: numbers.x + 300, y: numbers.y + 20 },
        { at: 118, z: 2.25, x: numbers.x + 300, y: numbers.y + 26 },
      ]}
      overlay={
        <>
          <Ring rect={numbers} local={local} delay={30} color={V.sub} hold={40} />
          <Ring rect={lift} local={local} delay={44} color={GREEN} />
          <Ring rect={sure} local={local} delay={70} color={V.gold} radius={6} />
        </>
      }
    />
  );
};

/** Bars 42 and 43: competitors' screenshots beside Juniper's, and the alert when one changes. */
export const Rivals: React.FC<P> = ({ local }) => {
  const SHOT = "features2/growth/competitors.png";
  const ALERT = "features2/growth/competitors-alert.png";
  const you = R(SHOT, "row-juniper", { x: 289, y: 144, w: 375, h: 345 });
  const them = R(SHOT, "row-dayline", { x: 676, y: 144, w: 375, h: 345 });
  const card = R(ALERT, "change-card", { x: 289, y: 270, w: 762, h: 488 });
  const before = R(ALERT, "before", { x: 302, y: 368, w: 736, h: 184 });
  const now = R(ALERT, "now", { x: 302, y: 560, w: 736, h: 184 });
  const title = R(ALERT, "change-title", { x: 342, y: 283, w: 696, h: 21 });
  return (
    <ProductBeat
      local={local}
      beat={COPY.rivals}
      hue="green"
      title="Juniper: Growth"
      shots={[{ src: SHOT }, { src: ALERT, at: 62 }]}
      cam={[
        { at: 0, z: 1 },
        { at: 26, z: 1.75, x: (you.x + them.x + them.w) / 2, y: you.y + you.h / 2 },
        { at: 62, z: 1.75, x: (you.x + them.x + them.w) / 2, y: you.y + you.h / 2 },
        { at: 68, z: 1.45, x: card.x + card.w / 2, y: card.y + card.h / 2 },
        { at: 118, z: 1.6, x: card.x + card.w / 2, y: card.y + card.h / 2 + 10 },
      ]}
      overlay={
        local < 62 ? (
          <>
            <Ring rect={you} local={local} delay={28} color={V.gold} />
            <Ring rect={them} local={local} delay={38} color={V.sub} />
          </>
        ) : (
          <>
            <Ring rect={title} local={local} delay={70} color={GREEN} radius={6} />
            <Ring rect={before} local={local} delay={82} color={V.sub} />
            <Ring rect={now} local={local} delay={92} color={V.gold} />
          </>
        )
      }
    />
  );
};

/** Bars 44 and 45: where Juniper shows up when people search. */
export const Keywords: React.FC<P> = ({ local }) => {
  const SHOT = "features2/growth/keywords.png";
  const tracker = R(SHOT, "row-habit-tracker", { x: 273, y: 516, w: 754, h: 77 });
  const app = R(SHOT, "row-habit-app", { x: 273, y: 670, w: 754, h: 57 });
  const change = R(SHOT, "habit-app-change", { x: 535, y: 670, w: 62, h: 57 });
  const chart = R(SHOT, "rank-chart", { x: 1061, y: 474, w: 346, h: 220 });
  const add = R(SHOT, "add-to-keywords", { x: 1061, y: 872, w: 143, h: 28 });
  return (
    <ProductBeat
      local={local}
      beat={COPY.keys}
      hue="green"
      title="Juniper: Growth"
      shots={[{ src: SHOT }]}
      cam={[
        { at: 0, z: 1 },
        { at: 30, z: 1.7, x: tracker.x + 330, y: (tracker.y + app.y + app.h) / 2 },
        { at: 70, z: 1.7, x: tracker.x + 330, y: (tracker.y + app.y + app.h) / 2 + 20 },
        { at: 100, z: 1.85, x: chart.x + chart.w / 2, y: chart.y + chart.h / 2 + 90 },
        { at: 118, z: 1.9, x: chart.x + chart.w / 2, y: chart.y + chart.h / 2 + 90 },
      ]}
      overlay={
        <>
          <Ring rect={app} local={local} delay={40} color={GREEN} radius={6} hold={40} />
          <Ring rect={change} local={local} delay={48} color={V.gold} radius={6} hold={32} />
          <Ring rect={chart} local={local} delay={96} color={GREEN} />
          <Ring rect={add} local={local} delay={104} color={V.gold} radius={6} />
        </>
      }
    />
  );
};

/** Bars 46 and 47: the reviews waiting for an answer, and a reply drafted for one. */
export const Reviews: React.FC<P> = ({ local }) => {
  const LIST = "features2/growth/reviews.png";
  const REPLY = "features2/growth/reply.png";
  const crash = R(LIST, "review-crashes-on-launch", { x: 272, y: 318, w: 1152, h: 174 });
  const button = mid(R(LIST, "reply-button", { x: 317, y: 444, w: 87, h: 32 }));
  const box = R(REPLY, "reply-box", { x: 330, y: 456, w: 1064, h: 98 });
  const send = R(REPLY, "send-button", { x: 1283, y: 562, w: 111, h: 32 });
  return (
    <ProductBeat
      local={local}
      beat={COPY.reviews}
      hue="green"
      title="Juniper: Growth"
      shots={[{ src: LIST }, { src: REPLY, at: 50 }]}
      cam={[
        { at: 0, z: 1 },
        { at: 24, z: 1.55, x: crash.x + 470, y: crash.y + crash.h / 2 + 20 },
        { at: 50, z: 1.55, x: crash.x + 470, y: crash.y + crash.h / 2 + 20 },
        { at: 62, z: 2.0, x: box.x + 360, y: box.y + 40 },
        { at: 104, z: 2.0, x: box.x + box.w - 360, y: box.y + 40 },
        { at: 118, z: 1.9, x: send.x - 240, y: send.y - 40 },
      ]}
      overlay={
        <>
          {local < 50 ? (
            <Cursor
              local={local}
              appear={22}
              keys={[
                { at: 22, x: button.x + 160, y: button.y + 90 },
                { at: 40, x: button.x, y: button.y },
                { at: 44, x: button.x, y: button.y, click: true },
              ]}
            />
          ) : null}
          {local >= 50 ? <Ring rect={box} local={local} delay={58} color={GREEN} /> : null}
          {local >= 50 ? <Ring rect={send} local={local} delay={104} color={V.gold} radius={8} /> : null}
        </>
      }
    />
  );
};
