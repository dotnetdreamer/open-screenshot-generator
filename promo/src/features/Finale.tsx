import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { COPY, F_BODY, F_HEAD, V, clamp, outExpo, outQuint, ramp } from "./style";
import { R } from "./kit";
import { AppWindow, Burst, GREEN, Line, PAD, Ring, Still, Words, type CamKey } from "./ui";

type P = { local: number; len: number };

/**
 * The montage's eight shots, in COPY.more order: which capture, what the
 * camera frames (the union of the named rects), how close, and the control
 * that gets a ring. Each holds for one beat pair (30 frames).
 */
const MORE: { src: string; frame: string[]; z: number; ring?: string[]; bare?: boolean }[] = [
  { src: "features2/more/tabs.png", frame: ["juniperTab"], z: 1.6, ring: ["juniperTab"] },
  { src: "features2/more/together-canvas.png", frame: ["peerCursor", "peerSelection"], z: 1.55, ring: ["peerSelection"] },
  { src: "features2/more/versions.png", frame: ["panel"], z: 1.7, ring: ["newest"] },
  { src: "features2/more/save-storage.png", frame: ["dialog"], z: 1.85, ring: ["google", "github"] },
  { src: "features2/more/outline.png", frame: ["headline", "outlineControl"], z: 1.3, ring: ["outlineControl"] },
  { src: "features2/more/bg-photo.png", frame: ["board", "tintControl"], z: 1.25, ring: ["tintControl"] },
  // Already two windows side by side, so it goes in no window frame of its own.
  { src: "features2/more/panels.png", frame: ["editor", "panel"], z: 1.12, ring: ["panel"], bare: true },
  { src: "features2/more/discover.png", frame: ["feed"], z: 1.15, ring: ["firstPost"] },
];

function union(src: string, names: string[]) {
  const rs = names.map((n) => R(src, n, { x: 420, y: 200, w: 600, h: 400 }));
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.w));
  const y2 = Math.max(...rs.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

export const More: React.FC<P & { items: string[]; first: number }> = ({ local, items, first }) => {
  const i = Math.min(items.length - 1, Math.floor(local / 30));
  const step = local - i * 30;
  const shot = MORE[first + i];
  const focus = union(shot.src, shot.frame);
  const cx = focus.x + focus.w / 2;
  const cy = focus.y + focus.h / 2;
  const cam: CamKey[] = [
    { at: 40, z: shot.z * 0.88, x: cx, y: cy },
    { at: 70, z: shot.z, x: cx, y: cy },
  ];
  const slide = ramp(step, 0, 8, outExpo);
  const ring = shot.ring ? union(shot.src, shot.ring) : null;
  return (
    <AbsoluteFill>
      <div
        key={first + i}
        style={{
          position: "absolute",
          left: 780,
          top: 196,
          transform: `translateX(${(1 - slide) * 80}px)`,
          opacity: slide,
        }}
      >
        <AppWindow
          local={step + 40}
          width={1040}
          shots={[{ src: shot.src }]}
          cam={cam}
          title={shot.bare ? undefined : "Juniper"}
          glow={shot.bare ? "rgba(0,0,0,0)" : undefined}
          style={shot.bare ? { border: "none", background: "transparent", boxShadow: "none" } : undefined}
          overlay={ring ? <Ring rect={ring} local={step} delay={8} color={V.gold} /> : null}
        />
      </div>
      <div style={{ position: "absolute", left: PAD, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", width: 600 }}>
        <div
          style={{
            fontFamily: F_BODY,
            fontWeight: 600,
            fontSize: 20,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: V.goldSoft,
            marginBottom: 20,
            opacity: ramp(local, 0, 10, outQuint),
          }}
        >
          And plenty more
        </div>
        <Words key={first + i} text={items[i]} local={step} delay={0} stagger={1.2} size={72} width={600} />
        <div style={{ display: "flex", gap: 8, marginTop: 34 }}>
          {Array.from({ length: 8 }, (_, d) => (
            <div
              key={d}
              style={{
                width: 26,
                height: 4,
                borderRadius: 2,
                background: d === first + i ? V.gold : d < first + i ? "rgba(212,175,55,0.45)" : "rgba(255,255,255,0.14)",
              }}
            />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Bars 52 and 53: what it costs, in plain words. */
export const Score: React.FC<P> = ({ local }) => {
  const [first, second, third] = COPY.score;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
        <Words text={first} accent="Free" accentColor={V.gold} local={local} delay={0} stagger={4} size={124} align="center" width={1600} />
        <div style={{ height: 14 }} />
        <Words text={second} local={local} delay={28} stagger={3} size={58} align="center" width={1400} color={V.ink} weight={500} />
        <Words text={third} local={local} delay={46} stagger={3} size={58} align="center" width={1400} color={V.ink} weight={500} />
      </div>
    </AbsoluteFill>
  );
};

/** Bars 54 and 55, on the fill: everything again, one beat each, into the final hit. */
const RECAP = [
  "features2/juniper-set/en/b1.png",
  "features2/design/studio3d/turn-24.png",
  "features2/design/panorama/b2.png",
  "features2/design/languages/compare.png",
  "features2/flows/capture-done.png",
  "features2/flows/website-home.png",
  "features2/growth/overview.png",
  "features2/growth/competitors.png",
];

export const Recap: React.FC<P> = ({ local }) => {
  const i = Math.min(RECAP.length - 1, Math.floor(local / 15));
  const step = local - i * 15;
  const src = RECAP[i];
  const portrait = /juniper-set|panorama\/b/.test(src);
  const square = /studio3d/.test(src);
  const z = 1.1 - 0.1 * outQuint(clamp(step / 15));
  const w = portrait ? 420 : square ? 860 : 1400;
  const h = portrait ? (420 * 2622) / 1206 : square ? 860 : (1400 * 900) / 1440;
  const fade = 1 - ramp(local, 108, 12, (t) => t);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: fade }}>
      <div
        style={{
          width: w,
          height: Math.min(h, 960),
          borderRadius: portrait ? 34 : 14,
          overflow: "hidden",
          transform: `scale(${z}) rotate(${(i % 2 === 0 ? -1 : 1) * 1.5}deg)`,
          boxShadow: "0 50px 130px rgba(0,0,0,0.7)",
          border: `1px solid ${V.stroke}`,
        }}
      >
        <Still src={src} style={{ width: "100%", height: "100%", objectFit: "cover" } as React.CSSProperties} />
      </div>
    </AbsoluteFill>
  );
};

/** Bars 56 to 58, on the final hit: the name and the address. */
export const Outro: React.FC<P> = ({ local }) => {
  const logo = ramp(local, 0, 26, (t) => {
    const c = clamp(t);
    return 1 + 2.2 * Math.pow(c - 1, 3) + 1.2 * Math.pow(c - 1, 2);
  });
  const pill = ramp(local, 26, 26, outExpo);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Burst local={local} x={960} y={330} count={64} reach={760} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ transform: `scale(${0.6 + 0.4 * logo})`, opacity: clamp(logo * 1.4) }}>
          <Img src={staticFile("logo.svg")} style={{ width: 150, height: 150, filter: "drop-shadow(0 24px 60px rgba(0,0,0,0.6))" }} />
        </div>
        <div style={{ marginTop: 34 }}>
          <Words text={COPY.brand} local={local} delay={8} stagger={3} size={100} align="center" />
        </div>
        <div
          style={{
            marginTop: 38,
            padding: "16px 44px 18px",
            borderRadius: 99,
            border: "1px solid rgba(212,175,55,0.55)",
            background: "rgba(212,175,55,0.10)",
            opacity: pill,
            transform: `scale(${0.86 + 0.14 * pill})`,
            boxShadow: "0 0 60px rgba(212,175,55,0.18)",
          }}
        >
          <span style={{ fontFamily: F_HEAD, fontSize: 46, fontWeight: 700, color: V.goldSoft, letterSpacing: "-0.01em" }}>{COPY.url}</span>
        </div>
        <div style={{ marginTop: 30 }}>
          <Line local={local} delay={44} size={28} align="center" color={V.sub}>
            {COPY.outroSub}
          </Line>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(90deg, ${V.teal}, ${V.gold}, ${GREEN})`,
          opacity: 0.7 * ramp(local, 20, 30, outQuint),
          transform: `scaleX(${ramp(local, 20, 50, outExpo)})`,
        }}
      />
    </AbsoluteFill>
  );
};
