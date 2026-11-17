import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { COPY, F_BODY, F_HEAD, F_MONO, V, clamp, outExpo, outQuint, ramp, rnd } from "./style";
import { Burst, JuniperIcon, Line, PAD, Phone, Words } from "./ui";

type P = { local: number; len: number };

const SET = [1, 2, 3, 4, 5].map((n) => `features2/juniper-set/en/b${n}.png`);

/** Our own template sets, the same 24 the hero cut uses (checked for claims about ratings). */
export const WALL = [
  "cinevault-stream", "droply-habits", "coinly-crypto", "lotus-calm", "trackio-fitness", "tripora-travel",
  "kicksy-sneakers", "budgetly-finance", "nexmind", "luxe-glow", "calora-macros", "connectly-chat",
  "playverse-games", "vowly-wedding", "breathora-breathing", "beatforge-studio", "feasto", "lingua-learn",
  "finexa-crypto", "inquira", "nookly-focus", "plannio-student", "castique-podcast", "beauty-glam",
];

/**
 * A tilted wall of real template sets drifting in rows, alternate rows the
 * other way. Used behind the brand and again as the template beat.
 */
export const TemplateWall: React.FC<{ t: number; opacity?: number; tilt?: number; scale?: number; rows?: number; dim?: number }> = ({
  t,
  opacity = 1,
  tilt = 1,
  scale = 1.18,
  rows = 6,
  dim = 0,
}) => {
  const H = 232;
  const W = H * 3;
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 0,
          height: 0,
          transform: `perspective(2600px) rotateX(${22 * tilt}deg) rotateZ(${-11 * tilt}deg) scale(${scale})`,
        }}
      >
        {Array.from({ length: rows }, (_, r) => {
          const dir = r % 2 === 0 ? -1 : 1;
          const speed = 26 + (r % 3) * 9;
          const offset = (rnd(r * 5.3) * W + t * speed * dir) % W;
          const y = (r - rows / 2) * (H + 26);
          return (
            <div key={r} style={{ position: "absolute", left: -W * 3.5 + offset - W, top: y, display: "flex", gap: 26 }}>
              {Array.from({ length: 9 }, (_, i) => {
                const name = WALL[(r * 5 + i * 7) % WALL.length];
                return (
                  <Img
                    key={i}
                    src={staticFile(`vs/wall/${name}.png`)}
                    style={{ width: W, height: H, borderRadius: 14, display: "block", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      {dim > 0 ? <AbsoluteFill style={{ background: `rgba(5,9,10,${dim})` }} /> : null}
    </AbsoluteFill>
  );
};

/** A store page with no screenshots, then (from `fillAt`) Juniper's set landing in the slots. */
const StorePage: React.FC<{ local: number; fillAt: number; width?: number }> = ({ local, fillAt, width = 1060 }) => {
  const slotW = 196;
  const slotH = Math.round((slotW * 2622) / 1206);
  const shimmer = ((local * 9) % 900) - 300;
  return (
    <div
      style={{
        width,
        padding: "34px 36px 0",
        borderRadius: 30,
        background: "linear-gradient(180deg, #111819 0%, #0C1213 100%)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 60px 160px rgba(0,0,0,0.75)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <JuniperIcon size={124} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: F_HEAD, fontWeight: 700, fontSize: 40, color: V.ink, letterSpacing: "-0.02em" }}>
            Juniper: Habit Tracker
          </div>
          <div style={{ fontFamily: F_BODY, fontSize: 24, color: V.sub, marginTop: 6 }}>Build habits that stick</div>
        </div>
        <div
          style={{
            padding: "12px 34px 13px",
            borderRadius: 99,
            background: V.teal,
            color: "#04110F",
            fontFamily: F_BODY,
            fontWeight: 700,
            fontSize: 24,
          }}
        >
          Get
        </div>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 30, height: slotH * 0.9, overflow: "hidden" }}>
        {Array.from({ length: 5 }, (_, i) => {
          const p = ramp(local, fillAt + i * 3, 12, outExpo);
          return (
            <div
              key={i}
              style={{
                flex: "0 0 auto",
                width: slotW,
                height: slotH,
                borderRadius: 22,
                position: "relative",
                overflow: "hidden",
                background: "#182122",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(100deg, rgba(255,255,255,0) ${shimmer - 120 + i * 40}px, rgba(255,255,255,0.06) ${shimmer + i * 40}px, rgba(255,255,255,0) ${shimmer + 120 + i * 40}px)`,
                  opacity: 1 - p,
                }}
              />
              {/* An empty picture slot, so nobody has to guess what is missing */}
              <div
                style={{
                  position: "absolute",
                  inset: 10,
                  borderRadius: 16,
                  border: "2px dashed rgba(255,255,255,0.13)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: 1 - p,
                }}
              >
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.35 }}>
                  <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="#F4F8F7" strokeWidth="1.6" />
                  <circle cx="9" cy="10" r="1.8" fill="#F4F8F7" />
                  <path d="M4.5 18l5-5 3.5 3.5 2.5-2.5 4 4" stroke="#F4F8F7" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
              </div>
              {p > 0 ? (
                <Img
                  src={staticFile(SET[i])}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    opacity: p,
                    transform: `scale(${1.14 - 0.14 * p})`,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** The first three beats: one phone in the dark. */
export const HookA: React.FC<P> = ({ local }) => {
  const appear = ramp(local, 4, 50, outQuint);
  const t = local / 30;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            position: "absolute",
            left: 1120,
            top: 70,
            opacity: appear,
            transform: `translateY(${(1 - appear) * 40 + Math.sin(t * 1.2) * 6}px)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -120,
              top: 80,
              width: 620,
              height: 760,
              borderRadius: 999,
              background: "radial-gradient(closest-side, rgba(127,200,160,0.22), rgba(127,200,160,0))",
              filter: "blur(10px)",
            }}
          />
          <Phone
            src="juniper/en/today.png"
            width={420}
            rotY={-24 + local * 0.08}
            rotX={4}
            glare={clamp((local - 40) / 50)}
            style={{ transform: `perspective(2520px) rotateX(4deg) rotateY(${-24 + local * 0.08}deg) scale(${0.97 + local * 0.0004})` }}
          />
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: PAD + 40, top: 410 }}>
        <Words text={COPY.hookA} local={local} delay={14} stagger={7} size={112} />
      </div>
    </AbsoluteFill>
  );
};

/** Bars 0.75 to 2: the store page has nothing to show. */
export const HookB: React.FC<P> = ({ local }) => {
  const card = ramp(local, 0, 36, outExpo);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 780,
          top: 250,
          opacity: card,
          transform: `perspective(2400px) rotateY(${(1 - card) * -16}deg) translateX(${(1 - card) * 80}px) scale(${0.96 + 0.04 * card})`,
          transformOrigin: "70% 50%",
        }}
      >
        <StorePage local={local} fillAt={9999} width={1060} />
      </div>
      <div style={{ position: "absolute", left: PAD + 20, top: 0, bottom: 0, width: 620, display: "flex", alignItems: "center" }}>
        <Words text={COPY.hookB} accent="a reason" accentColor={V.goldSoft} local={local} delay={8} stagger={4} size={76} width={600} />
      </div>
    </AbsoluteFill>
  );
};

/**
 * Bar 2, on the crash: the slots fill with Juniper's set, then the page
 * falls back into a wall of templates and the name comes up over it.
 */
export const Reveal: React.FC<P> = ({ local }) => {
  const center = ramp(local, 0, 16, outExpo);
  const back = ramp(local, 34, 46, outExpo);
  const brand = ramp(local, 46, 30, outQuint);
  return (
    <AbsoluteFill>
      <TemplateWall t={(local + 240) / 30} opacity={ramp(local, 30, 40, outQuint)} dim={0.62} />
      <Burst local={local} x={960} y={560} count={40} reach={900} colors={[V.goldSoft, "#BFE3CC", V.teal, "#FFFFFF"]} />
      <div
        style={{
          position: "absolute",
          left: 780 - center * 350,
          top: 250 - back * 190,
          transform: `scale(${1 + center * 0.06 - back * 0.56})`,
          transformOrigin: "50% 0%",
          opacity: 1 - ramp(local, 70, 26, outQuint),
        }}
      >
        <StorePage local={local + 120} fillAt={120} width={1060} />
      </div>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 120 }}>
        <div style={{ opacity: brand, transform: `translateY(${(1 - brand) * 30}px)`, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <Img src={staticFile("logo.svg")} style={{ width: 128, height: 128, filter: "drop-shadow(0 20px 50px rgba(0,0,0,0.6))" }} />
          <div style={{ marginTop: 30 }}>
            <Words text={COPY.brand} local={local} delay={52} stagger={4} size={104} align="center" />
          </div>
          <div style={{ marginTop: 22 }}>
            <Line local={local} delay={70} size={34} align="center" color={V.ink}>
              {COPY.brandSub}
            </Line>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Bar 3, the rise into the drop: the first chapter's card over the darkened wall. */
export const ChapterCard: React.FC<P & { n: string; title: string; hue: string; wall?: boolean; t0?: number }> = ({
  local,
  len,
  n,
  title,
  hue,
  wall,
  t0 = 0,
}) => {
  const p = ramp(local, 0, 18, outExpo);
  const push = ramp(local, len - 14, 14, (x) => x * x);
  return (
    <AbsoluteFill>
      {wall ? <TemplateWall t={(local + t0) / 30} opacity={0.9} dim={0.8} /> : null}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${1 + push * 0.5})`,
          opacity: 1 - push,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 46, opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
          <div
            style={{
              fontFamily: F_MONO,
              fontWeight: 700,
              fontSize: 210,
              lineHeight: 1,
              color: hue,
              textShadow: `0 0 60px ${hue}66`,
            }}
          >
            {n}
          </div>
          <div style={{ width: 3, height: 170, background: `linear-gradient(180deg, ${hue}00, ${hue}, ${hue}00)` }} />
          <Words text={title} local={local} delay={4} stagger={3} size={96} width={900} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export { StorePage, SET };
export const clampLocal = clamp;
