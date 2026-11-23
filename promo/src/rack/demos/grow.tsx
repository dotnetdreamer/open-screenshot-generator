import React from "react";
import { F_SANS, clamp } from "../style";
import { Abs, Caret, Check, Chip, Label, Stars, Txt, UI, p, pop, typedText } from "./ui";
import type { DemoProps } from "./types";

/** Column two: how the app is doing in the stores. The numbers are Juniper's, made up. */

const DOWNLOADS = [22, 25, 24, 28, 27, 31, 30, 29, 34, 33, 36, 35, 39, 41, 40, 44, 47, 46, 51, 55, 54, 58, 62, 61, 66, 70, 69, 74, 79, 84];

export const GrowthDemo: React.FC<DemoProps> = ({ f }) => {
  const W = 318;
  const Hh = 104;
  const max = 90;
  const pts = DOWNLOADS.map((v, i) => [(i / (DOWNLOADS.length - 1)) * W, Hh - (v / max) * Hh] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${Hh} L0 ${Hh} Z`;
  const draw = p(f, 0, 44, (t) => 1 - Math.pow(1 - t, 2));
  const last = pts[Math.max(0, Math.round(draw * (pts.length - 1)))];
  const tiles = [
    { n: "Page visits", v: "12.4k", d: "+18%" },
    { n: "Download rate", v: "16.0%", d: "+2.1" },
    { n: "Rating", v: "4.8", d: "★" },
  ];
  return (
    <>
      <Label right="APP STORE · GOOGLE PLAY">GROWTH · OVERVIEW</Label>
      <Abs x={16} y={34}>
        <Txt size={11} color={UI.sub}>New downloads</Txt>
        <Txt size={11} color={UI.dim} style={{ marginLeft: 8 }}>last 30 days</Txt>
      </Abs>
      <Abs x={16} y={56} w={W} h={Hh}>
        <svg width={W} height={Hh} style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={UI.green} stopOpacity={0.35} />
              <stop offset="1" stopColor={UI.green} stopOpacity={0} />
            </linearGradient>
            <clipPath id="gClip">
              <rect x={0} y={-10} width={W * draw} height={Hh + 20} />
            </clipPath>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={0} x2={W} y1={Hh * g} y2={Hh * g} stroke="rgba(255,255,255,0.06)" />
          ))}
          <g clipPath="url(#gClip)">
            <path d={area} fill="url(#gArea)" />
            <path d={line} fill="none" stroke={UI.green} strokeWidth={2.5} strokeLinejoin="round" />
          </g>
          {draw > 0.02 ? <circle cx={last[0]} cy={last[1]} r={4.5} fill="#FFFFFF" stroke={UI.green} strokeWidth={2.5} /> : null}
        </svg>
      </Abs>
      <Abs x={350} y={32} w={184} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tiles.map((t, i) => (
          <div
            key={t.n}
            style={{
              height: 42,
              borderRadius: 8,
              background: UI.panel2,
              padding: "6px 10px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              opacity: p(f, 8 + i * 6, 10),
              transform: `translateX(${(1 - p(f, 8 + i * 6, 12)) * 16}px)`,
            }}
          >
            <Txt size={10} color={UI.sub}>{t.n}</Txt>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <Txt size={17} weight={800}>{t.v}</Txt>
              <Txt size={10.5} weight={700} color={t.d === "★" ? UI.gold : UI.green}>{t.d}</Txt>
            </div>
          </div>
        ))}
      </Abs>
    </>
  );
};

export const BeforeAfterDemo: React.FC<DemoProps> = ({ f }) => {
  const a = p(f, 0, 20);
  const b = p(f, 10, 24);
  const bar = (h: number, color: string, label: string, value: string, k: number, x: number) => (
    <Abs x={x} y={34} w={90} h={130} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
      <Txt size={14} weight={800} style={{ opacity: k, marginBottom: 4 }}>{value}</Txt>
      <div style={{ width: 54, height: h * k, borderRadius: "6px 6px 2px 2px", background: color }} />
      <Txt size={10} color={UI.sub} style={{ marginTop: 6 }}>{label}</Txt>
    </Abs>
  );
  return (
    <>
      <Label right="DOWNLOAD RATE">BEFORE AND AFTER</Label>
      {bar(62, "rgba(255,255,255,0.22)", "14 days before", "3.1%", a, 22)}
      {bar(88, UI.green, "14 days after", "4.4%", b, 122)}
      {/* the day the new set went live, between the two */}
      <Abs x={117} y={44} w={1} h={102} style={{ borderLeft: `1px dashed ${UI.dim}` }} />
      <Abs x={236} y={36} w={300}>
        <Txt size={11} color={UI.sub} style={{ display: "block" }}>Did the new screenshots work?</Txt>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8, opacity: p(f, 24, 10) }}>
          <Txt size={44} weight={800} color={UI.green}>+{Math.round(42 * p(f, 24, 18))}%</Txt>
          <Txt size={12} color={UI.sub}>download rate</Txt>
        </div>
        <div style={{ marginTop: 10, transform: `scale(${pop(f, 40, 12)})`, transformOrigin: "0 50%" }}>
          <Chip size={12} bg="rgba(134,217,160,0.16)" color={UI.green}>
            <Check s={13} />
            99% sure it is real, not luck
          </Chip>
        </div>
      </Abs>
    </>
  );
};

const KEYS = [
  { k: "habit tracker", from: 9, to: 4, pop: 4 },
  { k: "daily habits", from: 3, to: 2, pop: 3 },
  { k: "streak app", from: 12, to: 7, pop: 2 },
  { k: "routine planner", from: 21, to: 12, pop: 3 },
];

export const KeywordsDemo: React.FC<DemoProps> = ({ f }) => (
  <>
    <Label right="EVERY DAY">KEYWORDS · APP STORE SEARCH</Label>
    <Abs x={16} y={32} style={{ display: "flex", gap: 6 }}>
      <Chip size={10.5}>Top 10 <b style={{ color: UI.green }}>{Math.round(4 + 2 * p(f, 10, 20))}</b></Chip>
      <Chip size={10.5}>Top 50 <b>11</b></Chip>
      <Chip size={10.5} color={UI.sub}>vs a week ago</Chip>
    </Abs>
    <Abs x={16} y={60} w={518}>
      {KEYS.map((r, i) => {
        const t = p(f, 6 + i * 5, 26);
        const rank = Math.round(r.from + (r.to - r.from) * t);
        return (
          <div
            key={r.k}
            style={{
              display: "flex",
              alignItems: "center",
              height: 27,
              borderTop: i ? `1px solid ${UI.line}` : "none",
              opacity: p(f, i * 4, 8),
            }}
          >
            <Txt size={13} weight={600} style={{ width: 190 }}>{r.k}</Txt>
            <div style={{ display: "flex", gap: 2, width: 110, alignItems: "flex-end" }}>
              {Array.from({ length: 5 }, (_, b) => (
                <div
                  key={b}
                  style={{ width: 7, height: 6 + b * 3, borderRadius: 1.5, background: b < r.pop ? UI.teal : "rgba(255,255,255,0.12)" }}
                />
              ))}
            </div>
            <Txt size={16} weight={800} style={{ width: 70 }}>#{rank}</Txt>
            <Txt size={12} weight={700} color={UI.green} style={{ opacity: t }}>{"▲"} {r.from - r.to}</Txt>
          </div>
        );
      })}
    </Abs>
  </>
);

const RIVALS = [
  { c: "#E5735C", stars: 4, r: "4.5", shots: ["#F4C9B8", "#EFA48E", "#F7E2D7", "#E98B71"] },
  { c: "#8DB8F2", stars: 4, r: "4.6", shots: ["#CFE0F8", "#A9C8F3", "#E3EDFB", "#86AEEA"], after: ["#272F55", "#3D4A8C", "#5867C9", "#2E3A70"] },
  { c: "#E3A73B", stars: 3, r: "3.9", shots: ["#F6E2B3", "#F0CD7E", "#F9EFD6", "#E8BC5C"] },
];

export const CompetitorsDemo: React.FC<DemoProps> = ({ f }) => {
  const flash = p(f, 16, 6) * (1 - p(f, 22, 10));
  const changed = f > 19;
  const card = p(f, 22, 14);
  return (
    <>
      <Label right="CHECKED TWICE A DAY">COMPETITORS</Label>
      <Abs x={16} y={32} w={518}>
        {RIVALS.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 44,
              borderTop: i ? `1px solid ${UI.line}` : "none",
              opacity: p(f, i * 4, 8),
            }}
          >
            <div style={{ width: 28, height: 28, borderRadius: 7, background: r.c, flexShrink: 0 }} />
            <div style={{ width: 92 }}>
              <Stars n={r.stars} s={10} />
              <Txt size={11} color={UI.sub} style={{ display: "block", marginTop: 2 }}>{r.r} rating</Txt>
            </div>
            <div style={{ display: "flex", gap: 4, position: "relative" }}>
              {(changed && r.after ? r.after : r.shots).map((c, j) => (
                <div key={j} style={{ width: 17, height: 32, borderRadius: 3, background: c, border: "1px solid rgba(255,255,255,0.2)" }} />
              ))}
              {r.after ? (
                <div style={{ position: "absolute", inset: -3, borderRadius: 5, background: "#FFFFFF", opacity: flash * 0.8 }} />
              ) : null}
            </div>
          </div>
        ))}
      </Abs>
      {/* the alert for the one that changed */}
      <Abs
        x={296}
        y={70}
        w={232}
        style={{
          opacity: card,
          transform: `translateX(${(1 - card) * 40}px)`,
          background: "#2B2926",
          borderRadius: 10,
          padding: "10px 12px",
          boxShadow: "0 8px 20px rgba(0,0,0,0.45)",
          border: `1px solid rgba(141,184,242,0.35)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: UI.blue, boxShadow: `0 0 6px ${UI.blue}` }} />
          <Txt size={12.5} weight={700}>New screenshots</Txt>
        </div>
        <div style={{ marginTop: 7 }}>
          <Chip size={10.5} bg="rgba(141,184,242,0.16)" color={UI.blue}>Show before and after</Chip>
        </div>
      </Abs>
    </>
  );
};

const REVIEW = "Tolle App, aber ich vermisse Widgets";
const REPLY = "Danke! Widgets sind schon in Arbeit.";

export const ReviewsDemo: React.FC<DemoProps> = ({ f }) => {
  const press = f >= 6 && f < 12 ? 0.94 : 1;
  const typing = typedText(REPLY, f - 12, 1.05);
  const sent = f > 54;
  return (
    <>
      <Label right="TO DO · REPLIED">REVIEWS</Label>
      <Abs x={14} y={30} w={520} h={54} style={{ background: UI.panel2, borderRadius: 9, padding: "8px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Stars n={4} s={11} />
          <Chip size={9.5} color={UI.sub}>Deutsch</Chip>
        </div>
        <Txt size={13.5} style={{ display: "block", marginTop: 5 }}>{REVIEW}</Txt>
      </Abs>
      <Abs x={14} y={92} style={{ transform: `scale(${press})`, transformOrigin: "0 50%" }}>
        <Chip size={11} bg="rgba(194,167,233,0.16)" color={UI.lilac}>{"✨"} Suggest a reply</Chip>
      </Abs>
      <Abs
        x={14}
        y={120}
        w={520}
        h={48}
        style={{
          borderRadius: 9,
          border: `1px solid ${f > 10 ? "rgba(194,167,233,0.45)" : UI.line}`,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: p(f, 8, 8),
        }}
      >
        <span style={{ fontFamily: F_SANS, fontSize: 13.5, color: UI.text, whiteSpace: "nowrap" }}>
          {typing}
          {!sent && f > 10 ? <Caret f={f} h={14} color={UI.lilac} /> : null}
        </span>
        <Chip
          size={11}
          bg={sent ? "rgba(134,217,160,0.18)" : "rgba(255,255,255,0.9)"}
          color={sent ? UI.green : "#161615"}
          style={{ opacity: p(f, 46, 8) }}
        >
          {sent ? "✓ Sent" : "Send reply"}
        </Chip>
      </Abs>
    </>
  );
};

const RISKS = [
  { n: "Critical", c: UI.coral },
  { n: "High", c: "#F09A63" },
  { n: "Medium", c: UI.gold },
  { n: "Low", c: UI.teal },
];

export const ComplianceDemo: React.FC<DemoProps> = ({ f }) => {
  const ticks = 10;
  // the whole list ticked before the cut to column three, 37 frames after patching
  const done = Math.floor(clamp((f - 2) / 28) * ticks);
  const ready = f > 31;
  return (
    <>
      <Label right="APP STORE · GOOGLE PLAY">STORE COMPLIANCE</Label>
      <Abs x={16} y={32} w={250}>
        <Txt size={19} weight={800}>Ready for review?</Txt>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginTop: 12 }}>
          {Array.from({ length: ticks }, (_, i) => (
            <div
              key={i}
              style={{
                height: 20,
                borderRadius: 5,
                background: i < done ? "rgba(134,217,160,0.18)" : "rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {i < done ? <Check s={13} /> : null}
            </div>
          ))}
        </div>
        <Txt size={11} color={ready ? UI.green : UI.sub} weight={ready ? 700 : 500} style={{ display: "block", marginTop: 9 }}>
          {ready ? "✓ " : ""}Checklist {done} of {ticks}
        </Txt>
      </Abs>
      <Abs x={290} y={34} w={244}>
        <Txt size={11} color={UI.sub} mono>WHY APPS GET REJECTED</Txt>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
          {RISKS.map((r, i) => (
            <Chip key={r.n} size={10.5} bg={`${r.c}22`} color={r.c} style={{ opacity: p(f, 4 + i * 4, 8) }}>
              {r.n}
            </Chip>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 16, opacity: p(f, 22, 10) }}>
          <Chip size={11.5} bg="rgba(255,255,255,0.9)" color="#161615">Check my app</Chip>
          <Chip size={11.5}>I got rejected</Chip>
        </div>
      </Abs>
    </>
  );
};
