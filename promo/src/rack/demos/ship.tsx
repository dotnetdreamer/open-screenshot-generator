import React from "react";
import { Img, staticFile } from "remotion";
import { F_MONO, F_SANS, clamp } from "../style";
import { Abs, Check, Chip, JuniperIcon, Label, Txt, UI, p, pop } from "./ui";
import type { DemoProps } from "./types";

/** Column one: getting the app ready to launch. Juniper stands in for your app. */

const LOOKS = ["light", "dark", "tinted"] as const;
const LOOK_NAMES = ["Light", "Dark", "Tinted"];

export const AppIconDemo: React.FC<DemoProps> = ({ f }) => {
  const t = Math.max(0, f) / 42;
  const cur = Math.floor(t) % 3;
  const fade = clamp((t % 1) / 0.25);
  const prev = (cur + 2) % 3;
  const icon = (s: number, round?: boolean) => (
    <div style={{ position: "relative", width: s, height: s }}>
      <div style={{ position: "absolute", inset: 0, opacity: f < 42 ? 0 : 1 - fade }}>
        <JuniperIcon s={s} look={LOOKS[prev]} round={round} />
      </div>
      <div style={{ position: "absolute", inset: 0, opacity: f < 42 ? 1 : fade }}>
        <JuniperIcon s={s} look={LOOKS[cur]} round={round} />
      </div>
    </div>
  );
  const ticks = ["iPhone and iPad", "Android", "Google Play", "Mac"];
  return (
    <>
      <Label right="ACTUAL SIZE">APP ICON</Label>
      <Abs x={26} y={34} style={{ transform: `scale(${pop(f, 0, 14)})`, transformOrigin: "50% 60%" }}>
        {icon(92)}
      </Abs>
      <Abs x={14} y={140} style={{ display: "flex", gap: 4 }}>
        {LOOK_NAMES.map((n, i) => (
          <Chip key={n} size={10} bg={i === cur ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.08)"} color={i === cur ? "#161615" : UI.sub}>
            {n}
          </Chip>
        ))}
      </Abs>
      {/* the icon where people will see it */}
      {[
        { x: 160, label: "iPhone", wall: "linear-gradient(170deg, #F2B99F, #C98BB0)", round: false },
        { x: 236, label: "Android", wall: "linear-gradient(170deg, #9CC7E8, #6C8FD1)", round: true },
        { x: 312, label: "Mac", wall: "linear-gradient(170deg, #D9D2C5, #A49B8C)", round: false },
      ].map((d, i) => (
        <Abs key={d.label} x={d.x} y={34} w={66} style={{ opacity: p(f, 4 + i * 4, 10) }}>
          <div
            style={{
              width: 66,
              height: 92,
              borderRadius: 10,
              background: d.wall,
              display: "flex",
              alignItems: d.label === "Mac" ? "flex-end" : "center",
              justifyContent: "center",
              paddingBottom: d.label === "Mac" ? 8 : 0,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {d.label === "Mac" ? (
              <div style={{ position: "absolute", left: 5, right: 5, bottom: 4, height: 28, borderRadius: 7, background: "rgba(255,255,255,0.35)" }} />
            ) : null}
            <div style={{ position: "relative", transform: d.label === "Mac" ? `translateY(${-Math.abs(Math.sin(f / 9)) * 4}px)` : undefined }}>
              {icon(d.label === "Mac" ? 26 : 34, d.round)}
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: 5 }}>
            <Txt size={10} color={UI.sub}>{d.label}</Txt>
          </div>
        </Abs>
      ))}
      <Abs x={398} y={34} w={140}>
        <Txt size={10} color={UI.dim} mono>EXPORT ICONS</Txt>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
          {ticks.map((n, i) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 6, opacity: p(f, 14 + i * 6, 8) }}>
              <Check s={14} on={p(f, 14 + i * 6, 8)} />
              <Txt size={12}>{n}</Txt>
            </div>
          ))}
        </div>
      </Abs>
    </>
  );
};

const checker = "repeating-conic-gradient(#3A3936 0% 25%, #2A2927 0% 50%) 0 0 / 14px 14px";

export const RemoveBgDemo: React.FC<DemoProps> = ({ f }) => {
  const reveal = p(f, 4, 34, (t) => t);
  const done = f > 38;
  const glow = done ? 0.5 + 0.5 * Math.sin((f - 38) / 7) : 0;
  return (
    <>
      <Label right="ON YOUR COMPUTER">REMOVE BACKGROUND</Label>
      <Abs x={14} y={30} w={244} h={142} style={{ borderRadius: 9, overflow: "hidden" }}>
        {/* the photo: a warm shop counter, out of focus */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 18% 30%, rgba(255,214,150,0.55) 0 10%, transparent 11%), radial-gradient(circle at 80% 22%, rgba(255,190,120,0.45) 0 8%, transparent 9%), radial-gradient(circle at 64% 60%, rgba(255,230,190,0.3) 0 7%, transparent 8%), radial-gradient(circle at 34% 70%, rgba(250,170,110,0.35) 0 6%, transparent 7%), linear-gradient(180deg, #7B5A44 0%, #4A372B 62%, #8A6A50 62.5%, #6B5140 100%)",
            filter: "saturate(1.1)",
          }}
        />
        {/* transparency, uncovered left to right */}
        <div style={{ position: "absolute", inset: 0, background: checker, clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)` }} />
        <Img
          src={staticFile("rack/cutout-perfume.png")}
          style={{
            position: "absolute",
            left: 122 - 41,
            top: 10,
            height: 126,
            filter: done ? `drop-shadow(0 0 ${3 + glow * 4}px rgba(255,255,255,${0.55 + glow * 0.3}))` : undefined,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: reveal * 244 - 1,
            width: 2,
            background: "#FFFFFF",
            boxShadow: `0 0 10px 3px ${UI.teal}`,
            opacity: reveal > 0 && reveal < 1 ? 1 : 0,
          }}
        />
      </Abs>
      <Abs x={272} y={30} w={262}>
        <Txt size={11} color={UI.sub} mono>YOUR PICTURES</Txt>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 82px)", gap: 6, marginTop: 7 }}>
          {["perfume", "sunglasses-amber", "earbuds", "cap", "", ""].map((n, i) => {
            const fresh = i === 0;
            const show = fresh ? pop(f, 40, 12) : 1;
            return (
              <div
                key={i}
                style={{
                  height: 46,
                  borderRadius: 6,
                  background: checker,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  outline: fresh && f > 40 ? `2px solid ${UI.teal}` : "none",
                  opacity: n ? 1 : 0.35,
                }}
              >
                {n ? (
                  <Img
                    src={staticFile(`rack/cutout-${n}.png`)}
                    style={{ maxHeight: 40, maxWidth: 74, transform: `scale(${show})`, opacity: fresh ? clamp(show) : 0.85 }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 10 }}>
          {["Erase", "Bring back", "Soften"].map((n, i) => (
            <Chip key={n} size={10} style={{ opacity: p(f, 44 + i * 4, 8) }}>{n}</Chip>
          ))}
        </div>
      </Abs>
    </>
  );
};

export const HeaderArtDemo: React.FC<DemoProps> = ({ f }) => {
  const fix = p(f, 8, 22);
  const ready = f > 30;
  return (
    <>
      <Label right="3840 × 1646">APP STORE HEADER ART</Label>
      <Abs
        x={14}
        y={30}
        w={520}
        h={112}
        style={{
          borderRadius: 9,
          overflow: "hidden",
          background: `radial-gradient(circle at 78% 30%, rgba(122,128,230,0.75), transparent 45%), linear-gradient(115deg, ${UI.forest2} 0%, ${UI.forest} 45%, #3C4FA8 100%)`,
        }}
      >
        {/* phones on the right of the art */}
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 330 + i * 52 - fix * 40,
              top: 14 + (i === 1 ? -6 : 6),
              width: 46,
              height: 96,
              borderRadius: 9,
              border: "2px solid rgba(255,255,255,0.85)",
              background: i === 1 ? UI.cream : "linear-gradient(180deg, #DDEDE2, #F6F2E9)",
              transform: `rotate(${(i - 1) * 6}deg)`,
            }}
          >
            <div style={{ margin: "10px 6px 0", height: 6, borderRadius: 3, background: UI.forest, opacity: 0.8 }} />
            <div style={{ margin: "5px 6px 0", height: 22, borderRadius: 4, background: i === 1 ? UI.berry2 : UI.mint }} />
          </div>
        ))}
        <div style={{ position: "absolute", left: 30 + fix * 104, top: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <JuniperIcon s={30} />
            <Txt size={26} weight={800} color="#FFFFFF">Juniper</Txt>
          </div>
          <Txt size={12} color="rgba(255,255,255,0.75)" style={{ display: "block", marginTop: 6 }}>Habit tracker</Txt>
        </div>
        {/* the part an iPhone shows */}
        <div
          style={{
            position: "absolute",
            left: 118,
            top: 8,
            width: 290,
            height: 96,
            border: `2px dashed ${UI.green}`,
            borderRadius: 6,
            boxShadow: "0 0 0 999px rgba(0,0,0,0.18)",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 6,
              bottom: 4,
              fontFamily: F_SANS,
              fontSize: 10,
              fontWeight: 600,
              color: UI.green,
            }}
          >
            Shown on an iPhone
          </span>
        </div>
      </Abs>
      <Abs x={14} y={150} style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Chip size={11} bg={ready ? "rgba(134,217,160,0.18)" : "rgba(236,115,82,0.18)"} color={ready ? UI.green : UI.coral}>
          {ready ? <Check s={12} /> : null}
          {ready ? "Ready" : "1 to fix"}
        </Chip>
        <Txt size={11} color={UI.dim}>New in iOS 27, built from this project</Txt>
      </Abs>
    </>
  );
};

const SOCIAL = [
  { label: "Post", size: "1080×1080", w: 64, h: 64, bg: `linear-gradient(160deg, ${UI.forest}, ${UI.forest2})` },
  { label: "Story", size: "1080×1920", w: 46, h: 82, bg: `linear-gradient(170deg, ${UI.berry2}, ${UI.berry})` },
  { label: "Link preview", size: "1200×630", w: 108, h: 57, bg: `linear-gradient(160deg, ${UI.cream}, #E9E1CF)` },
  { label: "X header", size: "1500×500", w: 120, h: 40, bg: `linear-gradient(100deg, ${UI.forest2}, #3C4FA8)` },
  { label: "Play feature", size: "1024×500", w: 92, h: 45, bg: `linear-gradient(120deg, #E3A73B, #E5735C)` },
];

export const SocialDemo: React.FC<DemoProps> = ({ f }) => (
  <>
    <Label right="LINK PREVIEWS · POSTS · STORIES">SOCIAL GRAPHICS</Label>
    <Abs x={14} y={30} w={520} h={124} style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
      {SOCIAL.map((s, i) => {
        const k = pop(f, 2 + i * 5, 14);
        const light = s.label === "Link preview";
        return (
          <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: s.w,
                height: s.h,
                borderRadius: 6,
                background: s.bg,
                transform: `scale(${k})`,
                opacity: clamp(k * 1.4),
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 3px 8px rgba(0,0,0,0.35)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 6,
                  top: 6,
                  width: Math.min(40, s.w * 0.45),
                  height: 5,
                  borderRadius: 3,
                  background: light ? UI.forest : "rgba(255,255,255,0.9)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 6,
                  top: 14,
                  width: Math.min(28, s.w * 0.3),
                  height: 4,
                  borderRadius: 2,
                  background: light ? "rgba(45,106,79,0.45)" : "rgba(255,255,255,0.5)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: s.w * 0.12,
                  bottom: -s.h * 0.12,
                  width: Math.min(s.w, s.h) * 0.42,
                  height: Math.min(s.w, s.h) * 0.8,
                  borderRadius: 5,
                  border: `2px solid ${light ? UI.forest : "rgba(255,255,255,0.85)"}`,
                  background: light ? UI.mint : "rgba(255,255,255,0.18)",
                }}
              />
            </div>
            <div style={{ textAlign: "center", opacity: p(f, 6 + i * 5, 10) }}>
              <Txt size={10.5} weight={600} style={{ display: "block" }}>{s.label}</Txt>
              <Txt size={9} color={UI.dim} mono style={{ display: "block", marginTop: 2 }}>{s.size}</Txt>
            </div>
          </div>
        );
      })}
    </Abs>
    <Abs x={14} y={158} style={{ opacity: p(f, 34, 10) }}>
      <Txt size={11} color={UI.green}>{"✓ Made from your screenshots, ready at once"}</Txt>
    </Abs>
  </>
);

const PAGES = ["Home", "Support", "Privacy"];

export const WebsiteDemo: React.FC<DemoProps> = ({ f }) => {
  const page = Math.floor(Math.max(0, f) / 30) % 3;
  const steps = [
    { n: "Getting your screenshots", at: 6 },
    { n: "Waiting for GitHub to put it online", at: 18 },
  ];
  const online = f > 32;
  return (
    <>
      <Label right="ON YOUR GITHUB">WEBSITE</Label>
      <Abs x={14} y={30} w={300} h={142} style={{ borderRadius: 8, overflow: "hidden", background: UI.cream }}>
        <div style={{ height: 20, background: "#E8E2D6", display: "flex", alignItems: "center", gap: 4, padding: "0 7px" }}>
          {["#E5735C", "#E3A73B", "#7FB98F"].map((c) => (
            <div key={c} style={{ width: 6, height: 6, borderRadius: 3, background: c }} />
          ))}
          <div
            style={{
              marginLeft: 8,
              flex: 1,
              height: 12,
              borderRadius: 6,
              background: "#FFFFFF",
              fontFamily: F_MONO,
              fontSize: 8.5,
              color: "#6B7A71",
              display: "flex",
              alignItems: "center",
              paddingLeft: 6,
            }}
          >
            you.github.io/juniper
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, padding: "7px 10px 0" }}>
          {PAGES.map((n, i) => (
            <span
              key={n}
              style={{
                fontFamily: F_SANS,
                fontSize: 10,
                fontWeight: 700,
                color: i === page ? UI.forest : "#9AA39C",
                borderBottom: i === page ? `2px solid ${UI.forest}` : "2px solid transparent",
                paddingBottom: 2,
              }}
            >
              {n}
            </span>
          ))}
        </div>
        {page === 0 ? (
          <div style={{ display: "flex", padding: "10px 12px", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <JuniperIcon s={26} />
              <div style={{ fontFamily: F_SANS, fontSize: 17, fontWeight: 800, color: "#16231C", marginTop: 5 }}>Juniper</div>
              <div style={{ height: 5, width: 110, borderRadius: 3, background: "#D9D2C2", marginTop: 6 }} />
              <div style={{ height: 5, width: 84, borderRadius: 3, background: "#D9D2C2", marginTop: 4 }} />
              <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                <div style={{ width: 46, height: 14, borderRadius: 4, background: "#16231C" }} />
                <div style={{ width: 46, height: 14, borderRadius: 4, background: "#16231C" }} />
              </div>
            </div>
            <div style={{ width: 52, height: 92, borderRadius: 9, border: "2px solid #16231C", background: UI.mint }} />
          </div>
        ) : (
          <div style={{ padding: "12px 14px" }}>
            <div style={{ fontFamily: F_SANS, fontSize: 15, fontWeight: 800, color: "#16231C" }}>
              {page === 1 ? "How can we help?" : "Privacy policy"}
            </div>
            {[150, 190, 130, 170, 110].map((w, i) => (
              <div key={i} style={{ height: 5, width: w, borderRadius: 3, background: "#D9D2C2", marginTop: 7 }} />
            ))}
          </div>
        )}
      </Abs>
      <Abs x={328} y={34} w={206}>
        {steps.map((s) => (
          <div key={s.n} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 9, opacity: p(f, s.at, 8) }}>
            <Check s={14} on={p(f, s.at + 6, 8)} />
            <Txt size={11.5} style={{ whiteSpace: "normal", lineHeight: 1.25 }}>{s.n}</Txt>
          </div>
        ))}
        <div style={{ marginTop: 6, transform: `scale(${pop(f, 32, 12)})`, transformOrigin: "0 50%" }}>
          <Chip size={12} bg="rgba(134,217,160,0.18)" color={UI.green}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: UI.green, boxShadow: `0 0 6px ${UI.green}` }} />
            {online ? "Online, for free" : "Publishing"}
          </Chip>
        </div>
      </Abs>
    </>
  );
};

const AREAS = ["Basics", "Titles and links", "AI search", "Speed"];

export const SeoDemo: React.FC<DemoProps> = ({ f }) => {
  const v = p(f, 2, 32);
  const score = Math.round(v * 94);
  const R = 46;
  const L = 2 * Math.PI * R;
  const col = score < 50 ? UI.coral : score < 80 ? UI.gold : UI.green;
  return (
    <>
      <Label right="CHECK MY SITE">SEO</Label>
      <Abs x={26} y={32} w={120} h={120}>
        <svg width={120} height={120} viewBox="0 0 120 120">
          <circle cx={60} cy={60} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10} />
          <circle
            cx={60}
            cy={60}
            r={R}
            fill="none"
            stroke={col}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={`${L * v * 0.94} ${L}`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <Txt size={34} weight={800}>{score}</Txt>
          <Txt size={10} color={UI.dim}>of 100</Txt>
        </div>
      </Abs>
      <Abs x={170} y={34} w={364}>
        {AREAS.map((a, i) => {
          // all four done before the cut to column two, 37 frames after patching
          const at = 4 + i * 6;
          return (
            <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, height: 27 }}>
              <Txt size={12.5} style={{ width: 118 }}>{a}</Txt>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <div style={{ width: `${p(f, at, 16) * (88 + i * 3)}%`, height: "100%", background: UI.green, borderRadius: 3 }} />
              </div>
              <Check s={14} on={p(f, at + 12, 6)} />
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 6, marginTop: 6, opacity: p(f, 40, 10) }}>
          <Chip size={10} bg="rgba(236,115,82,0.16)" color={UI.coral}>Fix now 0</Chip>
          <Chip size={10}>Make my fix plan</Chip>
        </div>
      </Abs>
    </>
  );
};
