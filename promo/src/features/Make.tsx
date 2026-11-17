import React from "react";
import { AbsoluteFill } from "remotion";
import { COPY, F_BODY, F_HEAD, TEMPLATE_COUNTS, V, clamp, outExpo, outQuint, ramp } from "./style";
import { FILES } from "./rects.generated";
import { ProductBeat, R, WIN, mid, winHeight } from "./kit";
import { TemplateWall } from "./Hook";
import { BeatCopy, CAP_H, CAP_W, Cursor, PAD, Ring, Spot, Still } from "./ui";

type P = { local: number; len: number };

const LANG_LABELS = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "ja", label: "日本語" },
  { code: "ar", label: "العربية" },
];

/** Bars 4 to 5.25, on the drop: the templates. */
export const Templates: React.FC<P> = ({ local }) => (
  <AbsoluteFill>
    <TemplateWall t={(local + 600) / 22} tilt={0.8} scale={1.05} rows={7} />
    <AbsoluteFill
      style={{
        background: "linear-gradient(90deg, rgba(5,9,10,0.97) 0%, rgba(5,9,10,0.9) 36%, rgba(5,9,10,0.25) 62%, rgba(5,9,10,0.05) 100%)",
      }}
    />
    <div style={{ position: "absolute", left: PAD, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <BeatCopy beat={COPY.tpl} local={local} width={640} size={72} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 34, width: 640 }}>
        {TEMPLATE_COUNTS.map((c, i) => {
          const p = ramp(local, 34 + i * 5, 18, outQuint);
          return (
            <div
              key={c.label}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 9,
                padding: "8px 16px 10px",
                borderRadius: 99,
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${V.stroke}`,
                opacity: p,
                transform: `translateY(${(1 - p) * 12}px)`,
              }}
            >
              <span style={{ fontFamily: F_HEAD, fontWeight: 700, fontSize: 26, color: V.gold }}>{Math.round(c.n * p)}</span>
              <span style={{ fontFamily: F_BODY, fontSize: 20, color: V.sub }}>{c.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  </AbsoluteFill>
);

/** Bars 5.25 to 6.5: drop the screenshots in, every design shows them, pick one, edit it. */
export const Drop: React.FC<P> = ({ local }) => {
  const EMPTY = "features2/design/quickstart-empty.png";
  const DROP = "features2/design/quickstart-drop.png";
  const EDIT = "features2/design/editor.png";
  const zone = R(EMPTY, "dropZone", { x: 65, y: 119, w: 1310, h: 280 });
  const first = R(DROP, "firstMatch", { x: 65, y: 464, w: 426, h: 383 });
  const use = mid(R(DROP, "firstMatchUse", { x: 417, y: 782, w: 61, h: 28 }));
  const head = R(EDIT, "selectedHeadline", { x: 360, y: 143, w: 228, h: 140 });
  const props = R(EDIT, "propertiesPanel", { x: 1120, y: 96, w: 320, h: 640 });
  const h = winHeight();
  const top = (1080 - h) / 2 + 26;
  const k = WIN.width / CAP_W;
  return (
    <ProductBeat
      local={local}
      beat={COPY.drop}
      subAt={[30, 80]}
      shots={[{ src: EMPTY }, { src: DROP, at: 32 }, { src: EDIT, at: 76 }]}
      cam={[
        { at: 0, z: 1 },
        { at: 32, z: 1 },
        { at: 56, z: 1.55, x: first.x + first.w / 2 + 120, y: first.y + first.h / 2 - 40 },
        { at: 74, z: 1.55, x: first.x + first.w / 2 + 120, y: first.y + first.h / 2 - 40 },
        { at: 80, z: 1 },
        { at: 118, z: 1.45, x: (head.x + props.x + props.w) / 2, y: head.y + 220 },
      ]}
      overlay={
        <>
          {local < 76 ? <Ring rect={first} local={local} delay={44} color={V.gold} /> : null}
          {local < 76 ? (
            <Cursor
              local={local}
              appear={46}
              keys={[
                { at: 46, x: use.x - 220, y: use.y - 160 },
                { at: 64, x: use.x, y: use.y },
                { at: 68, x: use.x, y: use.y, click: true },
              ]}
            />
          ) : null}
          {local >= 76 ? <Ring rect={head} local={local} delay={86} color={V.gold} /> : null}
          {local >= 76 ? <Ring rect={props} local={local} delay={94} color={V.teal} /> : null}
        </>
      }
      extra={
        <>
          {[0, 1, 2, 3, 4].map((i) => {
            const screens = ["today", "detail", "stats", "add", "trophies"];
            const p = ramp(local, 4 + i * 4, 20, outExpo);
            const gone = ramp(local, 26 + i, 8, outQuint);
            if (gone >= 1) return null;
            const fromX = 120 + i * 78;
            const fromY = 840 + (i % 2) * 30;
            const toX = WIN.x + (zone.x + zone.w * (0.22 + i * 0.13)) * k - 40;
            const toY = top + 34 + (zone.y + zone.h * 0.5) * k - 87;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: fromX + (toX - fromX) * p,
                  top: fromY + (toY - fromY) * p - Math.sin(p * Math.PI) * 140,
                  width: 80,
                  height: 174,
                  borderRadius: 12,
                  overflow: "hidden",
                  boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
                  transform: `rotate(${(1 - p) * (i - 2) * 7}deg) scale(${1 - gone * 0.35})`,
                  opacity: clamp(p * 3) * (1 - gone),
                }}
              >
                <Still src={`juniper/en/${screens[i]}.png`} style={{ width: "100%", height: "100%" }} />
              </div>
            );
          })}
        </>
      }
    />
  );
};

const STUDIO = Array.from({ length: 48 }, (_, i) => `features2/design/studio3d/turn-${String(i).padStart(2, "0")}.png`);
const FINISHES = [...FILES].filter((f) => f.startsWith("features2/design/studio3d/finish-")).slice(0, 3);

/** Bars 6.5 to 7.75: the app's own 3D phones, turning. */
export const Studio3D: React.FC<P> = ({ local }) => {
  const idx = Math.min(47, Math.max(0, Math.floor((local * 48) / 116)));
  const enter = ramp(local, 0, 30, outExpo);
  const tiles = [...FINISHES, "features2/design/studio3d/pixel.png"];
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 740,
          top: -50,
          width: 1180,
          height: 1180,
          opacity: enter,
          transform: `scale(${0.92 + 0.08 * enter + local * 0.0005})`,
          WebkitMaskImage: "radial-gradient(closest-side, #000 62%, rgba(0,0,0,0) 100%)",
        }}
      >
        <Still src={STUDIO[idx]} style={{ width: "100%", height: "100%" }} />
      </div>
      <div style={{ position: "absolute", left: PAD, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <BeatCopy beat={COPY.studio} local={local} width={600} size={72} />
        <div style={{ display: "flex", gap: 14, marginTop: 40 }}>
          {tiles.map((src, i) => {
            const p = ramp(local, 56 + i * 6, 18, outExpo);
            return (
              <div
                key={src}
                style={{
                  width: 132,
                  height: 172,
                  borderRadius: 18,
                  overflow: "hidden",
                  border: `1px solid ${V.stroke}`,
                  background: "#0B1112",
                  opacity: p,
                  transform: `translateY(${(1 - p) * 20}px)`,
                  boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
                }}
              >
                {/* The renders are square with the phone in the middle third: crop to the phone */}
                <Still src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.75)" } as React.CSSProperties} />
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Bars 7.75 to 9: one picture running across three screenshots. */
export const Panorama: React.FC<P> = ({ local }) => {
  const H = 640;
  const W = Math.round((H * 1206) / 2622);
  const close = ramp(local, 36, 26, outExpo);
  const gap = 96 - 82 * close;
  const total = W * 3 + gap * 2;
  const enter = ramp(local, 0, 30, outExpo);
  // Once the gaps close, push in on the seam between the first two boards, where the
  // phone crosses from one screenshot into the next.
  const push = ramp(local, 62, 56, (t) => 1 - Math.pow(1 - t, 3));
  const seamX = W + gap / 2;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 1300 - total / 2,
          top: 540 - H / 2 + 30,
          display: "flex",
          gap,
          opacity: enter,
          transformOrigin: `${seamX}px 55%`,
          transform: `perspective(2400px) rotateY(${(1 - enter) * -14}deg) translateY(${(1 - enter) * 40}px) scale(${1 + push * 0.32})`,
        }}
      >
        {[1, 2, 3].map((n) => (
          <div key={n} style={{ width: W, height: H, borderRadius: 22, overflow: "hidden", boxShadow: "0 40px 100px rgba(0,0,0,0.6)" }}>
            <Still src={`features2/design/panorama/b${n}.png`} style={{ width: "100%", height: "100%" }} />
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: PAD, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
        <BeatCopy beat={COPY.pano} local={local} width={560} size={70} />
      </div>
    </AbsoluteFill>
  );
};

/** Bars 9 to 10.25: the same three boards turning through four languages. */
export const Languages: React.FC<P> = ({ local }) => {
  const H = 640;
  const W = Math.round((H * 1206) / 2622);
  const FLIP = [24, 54, 84];
  const enter = ramp(local, 0, 30, outExpo);
  const langAt = (delay: number) => FLIP.filter((f) => local >= f + delay + 6).length;
  const labelIdx = FLIP.filter((f) => local >= f + 6).length;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 1310 - (W * 3 + 52) / 2,
          top: 540 - H / 2 + 60,
          display: "flex",
          gap: 26,
          opacity: enter,
          transform: `translateY(${(1 - enter) * 40}px)`,
        }}
      >
        {[1, 2, 3].map((n, bi) => {
          const delay = bi * 3;
          const li = langAt(delay);
          // Flip angle: each change turns the card edge-on and back.
          let angle = 0;
          for (const f of FLIP) {
            const d = local - (f + delay);
            if (d >= 0 && d < 12) angle = d < 6 ? (d / 6) * 90 : -90 + ((d - 6) / 6) * 90;
          }
          return (
            <div
              key={n}
              style={{
                width: W,
                height: H,
                borderRadius: 22,
                overflow: "hidden",
                boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
                transform: `perspective(1800px) rotateY(${angle}deg)`,
              }}
            >
              <Still src={`features2/juniper-set/${LANG_LABELS[li].code}/b${n}.png`} style={{ width: "100%", height: "100%" }} />
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 1310, top: 540 - H / 2 - 20, transform: "translateX(-50%)", display: "flex", gap: 10 }}>
        {LANG_LABELS.map((l, i) => {
          const on = i === labelIdx;
          return (
            <div
              key={l.code}
              style={{
                padding: "8px 18px 10px",
                borderRadius: 99,
                fontFamily: F_BODY,
                fontWeight: 600,
                fontSize: 21,
                color: on ? "#04110F" : V.sub,
                background: on ? V.teal : "rgba(255,255,255,0.05)",
                border: on ? "none" : `1px solid ${V.stroke}`,
                opacity: ramp(local, 8 + i * 3, 14, outQuint),
              }}
            >
              {l.label}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: PAD, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
        <BeatCopy beat={COPY.lang} local={local} width={560} size={70} />
      </div>
    </AbsoluteFill>
  );
};

/** Bars 10.25 to 11.5: a preview video on the timeline, a recording in the phone and music under it. */
export const Video: React.FC<P> = ({ local }) => {
  const SHOT = "features2/design/video/editor-timeline.png";
  // Measured on the capture: the track area runs 0 s at x 350 to 12 s at x 1106.
  const timeline = R(SHOT, "timeline", { x: 349, y: 605, w: 760, h: 225 });
  const sound = R(SHOT, "clip_sound", { x: 350, y: 773, w: 757, h: 14 });
  const recording = R(SHOT, "clip_video", { x: 350, y: 737, w: 757, h: 14 });
  const panel = R(SHOT, "soundProperties", { x: 1121, y: 140, w: 319, h: 380 });
  const play = clamp((local - 18) / 96);
  return (
    <ProductBeat
      local={local}
      beat={COPY.video}
      title="Juniper preview"
      shots={[{ src: SHOT }]}
      cam={[
        { at: 0, z: 1 },
        { at: 22, z: 1 },
        { at: 50, z: 1.75, x: timeline.x + timeline.w / 2, y: timeline.y + timeline.h / 2 - 10 },
        { at: 88, z: 1.75, x: timeline.x + timeline.w / 2 + 60, y: sound.y - 50 },
        { at: 118, z: 1.5, x: (timeline.x + timeline.w + panel.x + panel.w) / 2 - 80, y: (panel.y + sound.y) / 2 + 40 },
      ]}
      overlay={
        <>
          <div
            style={{
              position: "absolute",
              left: timeline.x + 1 + (timeline.w - 4) * play,
              top: timeline.y + 40,
              width: 2,
              height: timeline.h - 44,
              background: V.gold,
              boxShadow: `0 0 10px ${V.gold}`,
              opacity: ramp(local, 18, 10, outQuint),
            }}
          />
          <Ring rect={recording} local={local} delay={58} color={V.teal} radius={6} pad={4} hold={30} />
          <Ring rect={sound} local={local} delay={70} color={V.gold} radius={6} pad={4} />
          <Ring rect={{ x: panel.x + 8, y: panel.y, w: panel.w - 16, h: 100 }} local={local} delay={100} color={V.gold} />
        </>
      }
    />
  );
};

/** Bars 11.5 to 12.75: Capture takes every screen in every language. */
export const Capture: React.FC<P> = ({ local }) => {
  const LIVE = "features2/flows/capture-live.png";
  const DONE = "features2/flows/capture-done.png";
  const button = R(LIVE, "take-all", { x: 622, y: 77, w: 250, h: 36 });
  const grid = R(LIVE, "grid", { x: 364, y: 129, w: 805, h: 914 });
  const device = R(LIVE, "device-screen", { x: 106, y: 181, w: 182, h: 396 });
  const status = R(LIVE, "clean-status-bar", { x: 64, y: 845, w: 267, h: 54 });
  // The board columns start right of the language labels.
  const cells = { x: grid.x + 166, y: grid.y + 20, w: grid.w - 166, h: CAP_H - grid.y - 20 };
  const wipe = ramp(local, 50, 46, (t) => t);
  const b = mid(button);
  return (
    <ProductBeat
      local={local}
      beat={COPY.capture}
      shots={[{ src: LIVE }]}
      cam={[
        { at: 0, z: 1 },
        { at: 16, z: 1 },
        { at: 40, z: 1.55, x: (device.x + b.x) / 2 + 60, y: (device.y + device.h / 2 + b.y) / 2 + 40 },
        { at: 66, z: 1.3, x: cells.x + cells.w / 2, y: cells.y + 300 },
        { at: 118, z: 1.42, x: cells.x + cells.w / 2, y: cells.y + 300 },
      ]}
      overlay={
        <>
          {FILES.has(DONE) ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: CAP_W,
                height: CAP_H,
                clipPath: `inset(${cells.y}px ${CAP_W - (cells.x + cells.w * wipe)}px 0px ${cells.x}px)`,
              }}
            >
              <Still src={DONE} style={{ width: CAP_W, height: CAP_H }} />
            </div>
          ) : null}
          <Ring rect={device} local={local} delay={18} color={V.teal} hold={34} radius={24} />
          <Ring rect={status} local={local} delay={20} color={V.teal} hold={32} />
          <Cursor
            local={local}
            appear={14}
            vanish={62}
            keys={[
              { at: 14, x: b.x - 180, y: b.y + 240 },
              { at: 40, x: b.x, y: b.y },
              { at: 45, x: b.x, y: b.y, click: true },
              { at: 72, x: b.x + 60, y: b.y + 40 },
            ]}
          />
        </>
      }
    />
  );
};

/** Bars 12.75 to 14: say what you want, and the agent builds it. */
export const Agent: React.FC<P> = ({ local }) => {
  // The scrolled shot: at 900 px tall the start screen cannot show the prompt and Start together.
  const START = "features2/flows/agent-start-scrolled.png";
  const CHAT = "features2/flows/agent-chat.png";
  const prompt = R(START, "prompt", { x: 65, y: 285, w: 1310, h: 80 });
  const ready = R(START, "claude-ready", { x: 65, y: 563, w: 1310, h: 74 });
  const tab = R(START, "tab-claude-code", { x: 69, y: 459, w: 126, h: 32 });
  const go = R(START, "start-button", { x: 65, y: 767, w: 208, h: 40 });
  const panel = R(CHAT, "chat-panel", { x: 1021, y: 132, w: 419, h: 768 });
  const last = R(CHAT, "last-message", { x: 1033, y: 713, w: 395, h: 42 });
  // The step list above the result: languages added, translations written, result checked.
  const langs = { x: panel.x + 12, y: 422, w: panel.w - 24, h: 92 };
  // The typed prompt only fills the left of its box.
  const words = { x: prompt.x + 6, y: prompt.y + 8, w: 740, h: 30 };
  const g = mid(go);
  return (
    <ProductBeat
      local={local}
      beat={COPY.agent}
      shots={[{ src: START }, { src: CHAT, at: 58 }]}
      cam={[
        { at: 0, z: 1.15, x: 640, y: 420 },
        { at: 22, z: 1.85, x: words.x + 380, y: words.y + 60 },
        { at: 36, z: 1.85, x: words.x + 380, y: words.y + 60 },
        { at: 52, z: 1.5, x: 420, y: (tab.y + go.y + go.h) / 2 + 10 },
        { at: 58, z: 1.5, x: 420, y: (tab.y + go.y + go.h) / 2 + 10 },
        { at: 64, z: 1.3, x: 880, y: 300 },
        { at: 82, z: 1.3, x: 880, y: 300 },
        { at: 116, z: 1.7, x: panel.x + panel.w / 2 - 60, y: (langs.y + last.y + last.h) / 2 },
      ]}
      overlay={
        <>
          {local < 58 ? <Ring rect={words} local={local} delay={20} color={V.gold} hold={24} radius={8} /> : null}
          {local < 58 ? <Ring rect={tab} local={local} delay={38} color={V.teal} radius={8} /> : null}
          {local < 58 ? <Ring rect={{ x: ready.x, y: ready.y, w: 520, h: ready.h }} local={local} delay={42} color={V.teal} /> : null}
          {local >= 58 ? <Ring rect={langs} local={local} delay={86} color={V.teal} /> : null}
          {local >= 58 ? <Ring rect={last} local={local} delay={98} color={V.gold} /> : null}
          {local < 58 ? (
            <Cursor
              local={local}
              appear={34}
              keys={[
                { at: 34, x: g.x + 260, y: g.y - 140 },
                { at: 50, x: g.x, y: g.y },
                { at: 54, x: g.x, y: g.y, click: true },
              ]}
            />
          ) : null}
        </>
      }
    />
  );
};

export { Spot };
