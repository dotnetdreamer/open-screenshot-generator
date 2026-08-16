import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import {
  F_BODY,
  F_HEAD,
  F_MONO,
  V,
  clamp,
  holdFade,
  outQuint,
  ramp,
  rise,
  rnd,
} from "./style";
import { Gold, Head, Kicker, Panel, Sub, Teal, useTall, usePad } from "./ui";

/**
 * The "new way" beats. Every visual here is real app output: the wall strips
 * are exported template previews, and the UI panels are crops of live captures
 * (promo/scripts/capture-vs*.js). Re-run those after any UI change.
 */

const WALL = [
  "cinevault-stream", "calora-macros", "luxe-glow", "coinly-crypto",
  "playverse-games", "lotus-calm", "trackio-fitness", "castique-podcast",
  "breathora-breathing", "kicksy-sneakers", "plannio-student", "nexmind",
  "beatforge-studio", "tripora-travel", "connectly-chat", "budgetly-finance",
  "vowly-wedding", "feasto", "inquira", "droply-habits",
  "lingua-learn", "nookly-focus", "finexa-crypto", "beauty-glam",
];

const vs = (f: string) => staticFile(`vs/${f}`);

/** Copy block shared by every new-way beat. */
const Copy: React.FC<{
  local: number;
  kicker: string;
  head: React.ReactNode;
  sub?: React.ReactNode;
  align?: "left" | "center";
  headSize?: number;
  headWidth?: number | string;
  subWidth?: number | string;
}> = ({ local, kicker, head, sub, align = "left", headSize, headWidth, subWidth }) => {
  const tall = useTall();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: tall ? 18 : 20,
        alignItems: align === "center" ? "center" : "flex-start",
      }}
    >
      <Kicker local={local} delay={2} size={tall ? 17 : 19}>
        {kicker}
      </Kicker>
      <Head
        size={headSize ?? (tall ? 70 : 74)}
        local={local}
        delay={8}
        align={align}
        width={headWidth ?? (tall ? "100%" : 620)}
      >
        {head}
      </Head>
      {sub && (
        <Sub
          size={tall ? 29 : 27}
          local={local}
          delay={20}
          align={align}
          width={subWidth ?? (tall ? "100%" : 560)}
        >
          {sub}
        </Sub>
      )}
    </div>
  );
};

/** Two-column on the wide cut, stacked copy-over-visual on the tall one. */
const Split: React.FC<{
  copy: React.ReactNode;
  visual: React.ReactNode;
  flip?: boolean;
  gap?: number;
}> = ({ copy, visual, flip, gap }) => {
  const tall = useTall();
  const pad = usePad();
  return (
    <AbsoluteFill
      style={{
        flexDirection: tall ? "column" : flip ? "row-reverse" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: gap ?? (tall ? 54 : 86),
        padding: pad,
      }}
    >
      {copy}
      {visual}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 1. Templates for every store slot
// ---------------------------------------------------------------------------

export const NewTemplates: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const pad = usePad();
  const fade = holdFade(local, len, 12, 14);
  const rows = tall ? 3 : 2;
  const per = Math.ceil(WALL.length / rows);
  const cardW = tall ? 660 : 480;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 38 : 44,
          padding: pad,
        }}
      >
        <div style={{ width: tall ? "100%" : 1420 }}>
          <Copy
            local={local}
            align="center"
            kicker="Templates"
            headSize={tall ? 66 : 72}
            headWidth={tall ? "100%" : 1420}
            subWidth={tall ? "100%" : 900}
            head={
              <>
                <Gold>96 templates</Gold> for every store slot
              </>
            }
            sub="Phone, tablet, Apple Watch, Mac, feature graphics and app preview videos, all in one place"
          />
        </div>

        {/* Marquee rows. Each row drifts the opposite way and wraps by doubling
            the strip list, so there is never a visible seam. */}
        <div style={{ display: "flex", flexDirection: "column", gap: tall ? 14 : 16, width: "100%" }}>
          {Array.from({ length: rows }, (_, r) => {
            const items = WALL.slice(r * per, r * per + per);
            const dir = r % 2 === 0 ? -1 : 1;
            const span = items.length * (cardW + 20);
            const offset = ((local * (0.9 + r * 0.15) * dir) % span + span) % span;
            return (
              <div
                key={r}
                style={{
                  position: "relative",
                  height: cardW / 3,
                  overflow: "hidden",
                  opacity: ramp(local, 16 + r * 8, 26),
                  maskImage:
                    "linear-gradient(90deg, transparent 0, #000 9%, #000 91%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(90deg, transparent 0, #000 9%, #000 91%, transparent 100%)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: dir === -1 ? -offset : offset - span,
                    top: 0,
                    display: "flex",
                    gap: 20,
                  }}
                >
                  {[...items, ...items, ...items].map((slug, i) => (
                    <div
                      key={`${slug}-${i}`}
                      style={{
                        width: cardW,
                        height: cardW / 3,
                        borderRadius: 14,
                        overflow: "hidden",
                        border: `1px solid ${V.stroke}`,
                        boxShadow: "0 18px 44px rgba(0,0,0,0.55)",
                        flexShrink: 0,
                      }}
                    >
                      <Img
                        src={vs(`wall/${slug}.png`)}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* The real category bar, straight off the start screen. Landscape
            only: at 1080 wide its labels fall below reading size. */}
        {!tall && <div
          style={{
            width: 1180,
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${V.stroke}`,
            ...rise(local, 40, 28, 22),
          }}
        >
          <Img src={vs("ui-tabs.png")} style={{ width: "100%", display: "block" }} />
        </div>}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 2. The canvas holds the layout
// ---------------------------------------------------------------------------

export const NewCanvas: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const fade = holdFade(local, len, 12, 14);
  // Slow push in, so the artboard row keeps moving under the copy.
  const push = 1 + ramp(local, 0, len, (t) => t) * 0.06;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Split
        copy={
          <Copy
            local={local}
            kicker="The editor"
            head={
              <>
                Drop your screenshot in and the <Teal>layout holds</Teal>
              </>
            }
            sub="Frames, headlines and backgrounds stay where the template put them, so five screens stay a set"
          />
        }
        visual={
          <Panel
            local={local}
            delay={10}
            radius={18}
            style={{
              width: tall ? "100%" : 1000,
              transform: `scale(${push})`,
            }}
          >
            <Img src={vs("canvas-cinevault.png")} style={{ width: "100%", display: "block" }} />
          </Panel>
        }
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 3. One export, every size
// ---------------------------------------------------------------------------

const OUT_SIZES = [
  "1290 × 2796", "2064 × 2752", "1668 × 2420",
  "1080 × 1920", "1440 × 2560", "1024 × 500",
];

export const NewExport: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const fade = holdFade(local, len, 12, 14);

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Split
        flip
        copy={
          <Copy
            local={local}
            kicker="Export"
            head={
              <>
                Every store size out of <Gold>one export</Gold>
              </>
            }
            sub="Tick the formats your app needs and the canvas and mockups convert on the way out, your project stays untouched"
          />
        }
        visual={
          <div
            style={{
              position: "relative",
              display: "flex",
              // Side by side has nowhere to go at 1080 wide, so the portrait
              // cut puts the dialog above the files it produces.
              flexDirection: tall ? "column" : "row",
              alignItems: "center",
              gap: tall ? 26 : 34,
            }}
          >
            <Panel
              local={local}
              delay={10}
              radius={16}
              glow="rgba(212,175,55,0.18)"
              style={{ width: tall ? 620 : 545, flexShrink: 0 }}
            >
              <Img src={vs("ui-export.png")} style={{ width: "100%", display: "block" }} />
            </Panel>

            {/* Files landing, one per size */}
            <div
              style={{
                display: "flex",
                flexDirection: tall ? "row" : "column",
                flexWrap: tall ? "wrap" : "nowrap",
                justifyContent: "center",
                // Without an explicit cap the wrapped row just grows past the
                // frame instead of breaking onto a second line.
                maxWidth: tall ? 912 : undefined,
                gap: tall ? 12 : 13,
              }}
            >
              {OUT_SIZES.map((s, i) => {
                const on = ramp(local, 34 + i * 8, 18);
                return (
                  <div
                    key={s}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: tall ? "10px 14px" : "13px 18px",
                      borderRadius: 10,
                      background: V.glass,
                      border: `1px solid ${V.strokeSoft}`,
                      fontFamily: F_MONO,
                      fontSize: tall ? 17 : 20,
                      color: V.ink,
                      opacity: on,
                      transform: tall
                        ? `translateY(${(1 - on) * 18}px)`
                        : `translateX(${(1 - on) * -26}px)`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ color: V.teal, fontSize: tall ? 15 : 17 }}>PNG</span>
                    {s}
                  </div>
                );
              })}
            </div>
          </div>
        }
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 4. 57 languages, inside the design
// ---------------------------------------------------------------------------

const HEADLINES: [string, string][] = [
  ["en-US", "Watch more anytime"],
  ["de-DE", "Jederzeit mehr sehen"],
  ["ja-JP", "いつでももっと見る"],
  ["fr-FR", "Regardez plus à tout moment"],
  ["pt-BR", "Assista mais a qualquer hora"],
];

export const NewLangs: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const fade = holdFade(local, len, 12, 14);
  const step = 17;
  const idx = Math.min(HEADLINES.length - 1, Math.max(0, Math.floor((local - 26) / step)));
  const sub = clamp(((local - 26) % step) / 8);

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Split
        copy={
          <Copy
            local={local}
            kicker="Translation"
            head={
              <>
                <Teal>57 languages</Teal> translated inside the design
              </>
            }
            sub="One layout carries them all, so a change to the design reaches every locale at once"
          />
        }
        visual={
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: tall ? 20 : 26,
              alignItems: "stretch",
              width: tall ? "100%" : 620,
            }}
          >
            {/* The headline swapping locale in place */}
            <div
              style={{
                position: "relative",
                height: tall ? 132 : 148,
                borderRadius: 16,
                background: V.bgLift,
                border: `1px solid ${V.stroke}`,
                padding: tall ? "20px 24px" : "24px 30px",
                overflow: "hidden",
                ...rise(local, 8, 28, 24),
              }}
            >
              <div
                style={{
                  fontFamily: F_MONO,
                  fontSize: tall ? 16 : 18,
                  color: V.teal,
                  letterSpacing: "0.08em",
                }}
              >
                {HEADLINES[idx][0]}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontFamily: F_HEAD,
                  fontWeight: 700,
                  fontSize: tall ? 38 : 44,
                  color: V.ink,
                  opacity: sub,
                  transform: `translateY(${(1 - sub) * 16}px)`,
                }}
              >
                {HEADLINES[idx][1]}
              </div>
            </div>

            <Panel local={local} delay={16} radius={16} style={{ width: "100%" }}>
              <Img src={vs("ui-languages.png")} style={{ width: "100%", display: "block" }} />
            </Panel>
          </div>
        }
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 5. Preview videos
// ---------------------------------------------------------------------------

export const NewVideo: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const fade = holdFade(local, len, 12, 14);
  const play = ramp(local, 26, 74, (t) => t);

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Split
        flip
        copy={
          <Copy
            local={local}
            kicker="App preview videos"
            head={
              <>
                Preview videos exported to <Gold>MP4 right here</Gold>
              </>
            }
            sub="Drop a screen recording into a phone frame, add tap hints, and get a file App Store Connect accepts"
          />
        }
        visual={
          <div style={{ width: tall ? "100%" : 940, display: "flex", flexDirection: "column", gap: 18 }}>
            <Panel local={local} delay={10} radius={16} glow="rgba(212,175,55,0.16)">
              <Img src={vs("ui-video-templates.png")} style={{ width: "100%", display: "block" }} />
            </Panel>

            {/* Transport bar, so the beat reads as video and not another gallery */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: tall ? "14px 18px" : "16px 22px",
                borderRadius: 12,
                background: V.glass,
                border: `1px solid ${V.strokeSoft}`,
                ...rise(local, 22, 26, 18),
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 99,
                  background: V.gold,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="12" height="14" viewBox="0 0 12 14">
                  <path d="M0 0 L12 7 L0 14 Z" fill="#0A0B0B" />
                </svg>
              </span>
              <div
                style={{
                  flex: 1,
                  height: 5,
                  borderRadius: 99,
                  background: "rgba(255,255,255,0.10)",
                  overflow: "hidden",
                }}
              >
                <div style={{ height: "100%", width: `${play * 100}%`, background: V.gold }} />
              </div>
              <span style={{ fontFamily: F_MONO, fontSize: tall ? 16 : 18, color: V.sub }}>
                886 × 1920 · 30 fps · H.264
              </span>
            </div>
          </div>
        }
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 6. The agent
// ---------------------------------------------------------------------------

// Worded to match the template shown as the result below, so the beat reads as
// one action rather than a prompt and an unrelated picture.
const PROMPT = "Put my screenshots into a warm minimal template and write the copy";
const PROVIDERS = ["Free built in", "Your Claude", "Your ChatGPT", "Your Gemini", "Your API key"];

/**
 * Rebuilt rather than screenshotted. A crop of the agent screen shrinks to an
 * unreadable grey slab at this size, and the beat is about the sentence you
 * type and the set that comes back, not about the dialog's chrome.
 */
export const NewAgent: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const fade = holdFade(local, len, 12, 14);
  const chars = Math.round(clamp((local - 18) / 44) * PROMPT.length);
  const caret = Math.floor(local / 8) % 2 === 0;
  const done = chars >= PROMPT.length;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Split
        copy={
          <Copy
            local={local}
            kicker="AI agent"
            head={
              <>
                Or just <Teal>say what you want</Teal> and let the agent build it
              </>
            }
            sub="Runs free on the built in providers, on your own Claude, ChatGPT or Gemini account, or on your API key"
          />
        }
        visual={
          <div
            style={{
              width: tall ? "100%" : 900,
              display: "flex",
              flexDirection: "column",
              gap: tall ? 18 : 22,
            }}
          >
            {/* The prompt, typing itself */}
            <div
              style={{
                borderRadius: 16,
                background: V.bgLift,
                border: `1px solid ${done ? V.teal : V.stroke}`,
                boxShadow: done ? `0 0 60px rgba(111,179,181,0.18)` : "none",
                padding: tall ? "22px 24px" : "26px 30px",
                fontFamily: F_BODY,
                fontSize: tall ? 26 : 30,
                lineHeight: 1.4,
                color: V.ink,
                minHeight: tall ? 118 : 130,
                ...rise(local, 6, 26, 20),
              }}
            >
              {PROMPT.slice(0, chars)}
              <span style={{ opacity: caret ? 1 : 0, color: V.teal }}>|</span>
            </div>

            {/* Where it can run */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: tall ? 10 : 12 }}>
              {PROVIDERS.map((p, i) => {
                const on = ramp(local, 46 + i * 5, 14);
                return (
                  <span
                    key={p}
                    style={{
                      padding: tall ? "10px 16px" : "12px 20px",
                      borderRadius: 99,
                      border: `1px solid ${i === 0 ? V.teal : V.stroke}`,
                      background: i === 0 ? "rgba(111,179,181,0.10)" : V.glass,
                      fontFamily: F_BODY,
                      fontWeight: 500,
                      fontSize: tall ? 20 : 23,
                      color: i === 0 ? V.teal : V.sub,
                      opacity: on,
                      transform: `translateY(${(1 - on) * 12}px)`,
                    }}
                  >
                    {p}
                  </span>
                );
              })}
            </div>

            {/* And what comes back */}
            <Panel
              local={local}
              delay={62}
              radius={14}
              glow="rgba(111,179,181,0.22)"
              style={{ width: "100%" }}
            >
              <Img src={vs("wall/lotus-calm.png")} style={{ width: "100%", display: "block" }} />
            </Panel>
          </div>
        }
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 7. Nothing leaves the machine
// ---------------------------------------------------------------------------

export const NewPrivate: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const pad = usePad();
  const fade = holdFade(local, len, 12, 16);
  const ring = ramp(local, 14, 40);

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 40 : 44,
          padding: pad,
        }}
      >
        {/* A shield drawn by stroke-dashoffset, so it reads as "sealed" */}
        <svg width={tall ? 130 : 148} height={tall ? 130 : 148} viewBox="0 0 100 100">
          <path
            d="M50 8 L84 22 V50 C84 72 68 86 50 92 C32 86 16 72 16 50 V22 Z"
            fill="none"
            stroke={V.teal}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeDasharray="300"
            strokeDashoffset={300 * (1 - ring)}
            opacity={0.9}
          />
          <path
            d="M35 50 L46 61 L67 39"
            fill="none"
            stroke={V.gold}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="60"
            strokeDashoffset={60 * (1 - ramp(local, 40, 20))}
          />
        </svg>

        <Head size={tall ? 64 : 82} local={local} delay={10} align="center" width={tall ? "100%" : 1200}>
          Nothing leaves your machine
        </Head>
        <Sub size={tall ? 26 : 30} local={local} delay={22} align="center" width={tall ? "100%" : 860}>
          Your screenshots, fonts and projects stay in the browser or the desktop app, and the
          agent only talks to a provider when you ask it to
        </Sub>

        <div
          style={{
            display: "flex",
            gap: tall ? 12 : 18,
            flexWrap: "wrap",
            justifyContent: "center",
            ...rise(local, 36, 26, 20),
          }}
        >
          {["No account", "No upload", "No watermark", "Open source"].map((t) => (
            <span
              key={t}
              style={{
                padding: tall ? "11px 18px" : "13px 24px",
                borderRadius: 99,
                border: `1px solid ${V.stroke}`,
                background: V.glass,
                fontFamily: F_BODY,
                fontWeight: 500,
                fontSize: tall ? 21 : 24,
                color: V.ink,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
