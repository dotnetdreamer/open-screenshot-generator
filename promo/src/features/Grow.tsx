import React from "react";
import { AbsoluteFill } from "remotion";
import { COPY, V, outExpo, ramp } from "./style";
import { FILES } from "./rects.generated";
import { ProductBeat, R, mid } from "./kit";
import { CAP_H, CAP_W, Cursor, GREEN, Ring, Still, Words } from "./ui";

type P = { local: number; len: number };

const OVERVIEW = "features2/growth/overview.png";
const IMPACT = "features2/growth/impact.png";
const HEALTH = "features2/growth/health.png";

/**
 * Bars 24 and 25: Juniper's numbers beside its designs, then, on the second
 * bar, Ratings saying version 2.4 crashes more than 2.3 did. That is the
 * update the one star reviews on bar 33 are about.
 */
export const Stats: React.FC<P> = ({ local }) => {
  const visits = R(OVERVIEW, "tile-page-visits", { x: 466, y: 283, w: 182, h: 145 });
  const rate = R(OVERVIEW, "tile-download-rate", { x: 660, y: 283, w: 182, h: 145 });
  const earnings = R(OVERVIEW, "tile-earnings", { x: 1048, y: 283, w: 182, h: 145 });
  const finding = R(HEALTH, "health-finding", { x: 272, y: 317, w: 1152, h: 74 });
  const text = R(HEALTH, "finding-text", { x: 321, y: 336, w: 538, h: 37 });
  // The four middle tiles whole, with no slice of their neighbours at the edges.
  const tilesZ = CAP_W / (earnings.x + earnings.w - visits.x + 20);
  const tiles = { x: (visits.x + earnings.x + earnings.w) / 2, y: visits.y + visits.h / 2 + 40 };
  // The cut to Ratings, on the second bar.
  const AT = 60;
  return (
    <ProductBeat
      local={local}
      beat={COPY.stats}
      subAt={[16, AT + 8]}
      hue="green"
      title="Juniper: Growth"
      shots={[{ src: OVERVIEW }, { src: HEALTH, at: AT }]}
      cam={[
        { at: 0, z: 1 },
        { at: 14, z: 1 },
        { at: 44, z: tilesZ, x: tiles.x, y: tiles.y },
        { at: AT, z: tilesZ + 0.03, x: tiles.x, y: tiles.y + 4 },
        { at: AT + 10, z: 1.5, x: finding.x + finding.w / 2 - 120, y: finding.y + finding.h / 2 + 40 },
        { at: 118, z: 2.0, x: text.x + text.w / 2 + 20, y: text.y + text.h / 2 + 10 },
      ]}
      overlay={
        local < AT ? (
          <Ring rect={rate} local={local} delay={28} color={GREEN} />
        ) : (
          <Ring rect={text} local={local} delay={AT + 16} color={V.gold} pad={9} radius={8} />
        )
      }
    />
  );
};

/** Bar 26, the break: the question, on its own. */
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

/** Bars 27 and 28, on the drop: the before and after, and whether it was luck. */
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

/** Bars 29 and 30: competitors' screenshots beside Juniper's, and the alert when one changes. */
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

/**
 * Bars 31 and 32: where Juniper shows up when people search, how popular each
 * word is (Apple Ads' score, in the desktop app), then the keyword's card: its
 * score, its climb, and the word missing from the store page.
 */
export const Keywords: React.FC<P> = ({ local }) => {
  const SHOT = "features2/growth/keywords.png";
  const tracker = R(SHOT, "row-habit-tracker", { x: 273, y: 254, w: 754, h: 97 });
  const app = R(SHOT, "row-habit-app", { x: 273, y: 448, w: 754, h: 77 });
  const popularity = R(SHOT, "habit-app-popularity", { x: 541, y: 448, w: 95, h: 77 });
  const score = R(SHOT, "detail-popularity", { x: 1061, y: 163, w: 346, h: 57 });
  const chart = R(SHOT, "rank-chart", { x: 1061, y: 283, w: 346, h: 220 });
  const add = R(SHOT, "add-to-keywords", { x: 1061, y: 682, w: 143, h: 28 });
  // The card from its score down to Add to keywords, as close as it fits.
  const cardTop = score.y - 30;
  const cardBottom = add.y + add.h + 30;
  const cardZ = Math.min(1.8, CAP_H / (cardBottom - cardTop));
  const card = { x: chart.x + chart.w / 2, y: (cardTop + cardBottom) / 2 };
  return (
    <ProductBeat
      local={local}
      beat={COPY.keys}
      hue="green"
      title="Juniper: Growth"
      shots={[{ src: SHOT }]}
      cam={[
        { at: 0, z: 1 },
        // The table from its left edge, so no clipped sidebar labels show beside it.
        { at: 30, z: 1.7, x: tracker.x - 8 + CAP_W / 1.7 / 2, y: (tracker.y + app.y + app.h) / 2 },
        { at: 70, z: 1.7, x: tracker.x - 8 + CAP_W / 1.7 / 2, y: (tracker.y + app.y + app.h) / 2 + 20 },
        { at: 96, z: cardZ, x: card.x, y: card.y },
        { at: 118, z: cardZ + 0.05, x: card.x, y: card.y + 8 },
      ]}
      overlay={
        <>
          <Ring rect={app} local={local} delay={40} color={GREEN} radius={6} hold={40} />
          <Ring rect={popularity} local={local} delay={50} color={V.gold} radius={6} hold={30} />
          <Ring rect={score} local={local} delay={88} color={GREEN} radius={8} />
          <Ring rect={add} local={local} delay={104} color={V.gold} radius={6} />
        </>
      }
    />
  );
};

/** Bars 33 and 34: the reviews waiting for an answer, and a reply drafted for one. */
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
